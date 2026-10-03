import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, apiDelete, apiGet, apiPost } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { dateLabel, dayWords } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Avatar, Button, Chip } from '../../components/ui';
import type { MessageContext } from './types';

/**
 * The people card (ENH-MAIL-03 DMO-PPL-01, DMO-PPL-05, DMO-OOF-02): a click
 * on a sender's name shows who they are — title, company, phone, email,
 * colleague or customer — whether they are away, your recent mail with them,
 * and what you can do: email, chat, call, meet, add to contacts, make VIP.
 */

export interface PersonActions {
  email: () => void;
  meet?: () => void;
  addContact?: () => void;
  chat?: (userId: number) => void;
}

export function useVips(enabled = true) {
  return useQuery({
    queryKey: ['mail', 'vips'],
    queryFn: async () => {
      try {
        return (await apiGet<{ vips: Array<{ address: string; name: string | null }> }>('/api/mail/vips')).vips;
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.status === 503)) return null;
        throw e;
      }
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}

function useAway(email: string, enabled: boolean) {
  return useQuery({
    queryKey: ['mail', 'away', email.toLowerCase()],
    queryFn: async () => {
      try {
        return await apiGet<{ known: boolean; away: boolean; until?: string | null; subject?: string | null }>('/api/mail/people/out-of-office', { email });
      } catch {
        return null;
      }
    },
    enabled,
    staleTime: 10 * 60_000,
  });
}

export function PersonButton({ name, email, context, actions, className }: { name: string; email: string; context: MessageContext | null | undefined; actions: PersonActions; className?: string }) {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const open = () => {
    const r = btn.current?.getBoundingClientRect();
    const left = Math.max(8, Math.min((r?.left ?? 8), window.innerWidth - 340));
    setAt({ top: (r?.bottom ?? 40) + 6, left });
  };
  return (
    <>
      <button ref={btn} type="button" aria-haspopup="dialog" aria-expanded={!!at} onClick={() => (at ? setAt(null) : open())} className={className}>
        {name}
      </button>
      {at ? <PeopleCard email={email} name={name} context={context} actions={actions} at={at} onClose={() => setAt(null)} /> : null}
    </>
  );
}

export function PeopleCard({ email, name, context, actions, at, onClose }: { email: string; name: string; context: MessageContext | null | undefined; actions: PersonActions; at: { top: number; left: number }; onClose: () => void }) {
  const qc = useQueryClient();
  const box = useRef<HTMLDivElement>(null);
  const s = context?.sender ?? null;
  const vips = useVips(true);
  const away = useAway(email, !!s?.is_colleague);
  const isVip = (vips.data ?? []).some((v) => v.address.toLowerCase() === email.toLowerCase());

  useEffect(() => {
    box.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const down = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', key);
    window.addEventListener('mousedown', down);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('mousedown', down);
    };
  }, [onClose]);

  const toggleVip = async () => {
    try {
      if (isVip) await apiDelete('/api/mail/vips', { address: email });
      else await apiPost('/api/mail/vips', { address: email, name });
      void qc.invalidateQueries({ queryKey: ['mail', 'vips'] });
      void qc.invalidateQueries({ queryKey: ['mail', 'focus'] });
      toast('success', isVip ? text('{name} is no longer a VIP.', { name }) : text('{name} is a VIP: their mail is always in Focused and in the VIP view.', { name }));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const phone = s?.mobile || s?.phone || null;
  const recent = context?.history?.messages.slice(0, 5) ?? [];
  const role = [s?.job_title, s?.department, s?.company].filter(Boolean).join(' · ');

  return createPortal(
    <div ref={box} role="dialog" aria-label={text('About {name}', { name })} tabIndex={-1} style={{ top: at.top, left: at.left }} className="fixed z-[70] w-[330px] rounded-[12px] border border-line bg-surface p-4 text-[13px] shadow-xl outline-none">
      <div className="flex items-start gap-3">
        <Avatar name={name || email} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold text-ink">{s?.name || name || email}</p>
          {role ? <p className="truncate text-ink-2">{role}</p> : null}
          <p className="truncate text-ink-3 selectable">{email}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {s?.is_colleague ? <Chip tone="indigo">{text('Colleague')}</Chip> : null}
            {s?.is_customer ? <Chip tone="teal">{text('Customer')}</Chip> : null}
            {isVip ? <Chip tone="warning">{text('VIP')}</Chip> : null}
            {away.data?.away ? <Chip tone="danger">{away.data.until ? text('Out of office until {day}', { day: dayWords(away.data.until) }) : text('Out of office')}</Chip> : null}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button size="sm" icon="mail" onClick={() => (onClose(), actions.email())}>
          {text('Email')}
        </Button>
        {s?.user_id && actions.chat ? (
          <Button size="sm" icon="chat" onClick={() => (onClose(), actions.chat!(s.user_id!))}>
            {text('Chat')}
          </Button>
        ) : null}
        {phone ? (
          <Button size="sm" icon="phone" onClick={() => void call('app:openExternal', { url: `tel:${phone.replace(/[^\d+]/g, '')}` })}>
            {text('Call')}
          </Button>
        ) : null}
        {actions.meet ? (
          <Button size="sm" icon="video" onClick={() => (onClose(), actions.meet!())}>
            {text('Meet')}
          </Button>
        ) : null}
        {actions.addContact ? (
          <Button size="sm" icon="user-plus" onClick={() => (onClose(), actions.addContact!())}>
            {s?.contact_id ? text('Open contact') : text('Add to contacts')}
          </Button>
        ) : null}
        {vips.data !== null ? (
          <Button size="sm" variant="ghost" icon="star" onClick={() => void toggleVip()}>
            {isVip ? text('Remove VIP') : text('Make VIP')}
          </Button>
        ) : null}
      </div>
      {phone ? <p className="mt-2 text-ink-2 selectable">{phone}</p> : null}
      {recent.length ? (
        <div className="mt-3 border-t border-line pt-2">
          <p className="mb-1 text-[11.5px] font-bold uppercase tracking-wide text-ink-3">{text('Recent mail ({n})', { n: context?.history?.total ?? recent.length })}</p>
          <ul className="flex flex-col gap-0.5">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-[12.5px]">
                <span className={r.is_read ? 'min-w-0 flex-1 truncate text-ink-2' : 'min-w-0 flex-1 truncate font-semibold text-ink'}>{r.subject}</span>
                {r.has_attachment ? <Icon name="paperclip" size={12} className="text-ink-3" /> : null}
                <span className="shrink-0 text-ink-3">{dateLabel(r.at)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {context?.related?.meetings?.length ? (
        <p className="mt-2 text-[12.5px] text-ink-3">{text('{n} meetings together', { n: context.related.meetings.length })}</p>
      ) : null}
    </div>,
    document.body,
  );
}
