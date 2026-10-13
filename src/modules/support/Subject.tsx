import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Message, TicketShow } from '@shared/support';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { useTextAi } from '../ai/textTools';
import { K, errorText, updateTicket } from './api';

/**
 * The ticket's subject, editable where it is shown (worksuite-desktop#333): a ticket made from a chat used to take the
 * visitor's "Hi," as its subject. The server now takes the first meaningful message; the agent can change it here —
 * click it, Enter or a click outside saves, Esc puts it back — and Suggest asks the AI (the model on this computer
 * first, online when the AI settings allow) for one from the conversation, or, without AI, takes the first
 * meaningful thing the customer said.
 */

const SMALL_TALK = /^(?:hi+|hello|helo|hey|hey there|hi there|hello there|good (?:morning|afternoon|evening)|gm|ayubowan|vanakkam|are you there|is anyone there|anyone there|anybody there|ok(?:ay)?|thanks|thank you|yes|no|please|help|sir|madam)$/;

/** Says what the conversation is about: not a greeting, and three words or more once a greeting is taken off the front. */
export function meaningful(body: string): boolean {
  const plain = body
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain || SMALL_TALK.test(plain)) return false;
  const rest = plain.replace(/^(?:(?:hi|hello|hey|good (?:morning|afternoon|evening)|dear|sir|madam|there)\b\s*)+/, '');
  return rest.split(' ').filter(Boolean).length >= 3;
}

/** The order number a message names ("order 46497", "Order number: #46497"), or null. */
export function orderNumberOf(body: string): string | null {
  return /\border\s*(?:number|no\.?|num|id|#)?\s*[:#-]?\s*#?(\d{3,12})\b/i.exec(body)?.[1] ?? null;
}

/** A subject without AI: the customer's first meaningful sentence, led by the order number they gave. */
export function plainSubject(messages: readonly Pick<Message, 'from' | 'internal' | 'body'>[]): string | null {
  const said = messages.filter((m) => m.from === 'requester' && !m.internal && m.body.trim());
  const order = said.map((m) => orderNumberOf(m.body)).find((x) => x !== null) ?? null;
  const best = said.find((m) => meaningful(m.body));
  if (!best) return null;
  let head = best.body
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:(?:hi|hello|hey|good (?:morning|afternoon|evening)|dear (?:sir|madam|team))\b[\s,.!]*)+/i, '');
  head = (head.split(/(?<=[.!?])\s+/)[0] ?? head).replace(/\.$/, '');
  head = head.charAt(0).toUpperCase() + head.slice(1);
  return (order && !head.includes(order) ? `Order ${order} – ${head}` : head).slice(0, 120);
}

/** The conversation as the AI reads it: who said what, public messages only, the latest last. */
export function transcriptOf(messages: readonly Pick<Message, 'from' | 'internal' | 'body'>[], max = 40): string {
  return messages
    .filter((m) => !m.internal && m.body.trim())
    .slice(-max)
    .map((m) => `${m.from === 'requester' ? 'Customer' : 'Agent'}: ${m.body.trim().slice(0, 800)}`)
    .join('\n');
}

export function EditableSubject({ show, className, level = 'h2' }: { show: TicketShow; className?: string; level?: 'h1' | 'h2' }) {
  const qc = useQueryClient();
  const ai = useTextAi();
  const t = show.ticket;
  const canEdit = show.can.edit === true && !t.merged_into && !t.deleted_at && !show.legacy;
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'suggest' | null>(null);
  const [saved, setSaved] = useState(false);
  const Tag = level;

  const save = async (value: string) => {
    const next = value.trim().replace(/\s+/g, ' ').slice(0, 190);
    setDraft(null);
    if (!next || next === t.subject) return;
    setBusy('save');
    try {
      const fresh = await updateTicket(t.id, t.version, { subject: next });
      if (fresh) qc.setQueryData<TicketShow>(K.ticket(t.id), (d) => (d ? { ...d, ticket: { ...d.ticket, ...fresh } } : d));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: K.ticket(t.id) });
      void qc.invalidateQueries({ queryKey: K.lists });
    }
  };

  const suggest = async () => {
    setBusy('suggest');
    try {
      if (ai.engine) {
        const r = await ai.run('subject', transcriptOf(show.messages)).done;
        const line = r.text.split('\n')[0]!.replace(/^["“']|["”'.]$/g, '').trim();
        if (line) return setDraft(line.slice(0, 190));
      }
      const plain = plainSubject(show.messages);
      if (plain) setDraft(plain);
      else toast('info', text('There is nothing in the conversation to make a subject from yet.'));
    } catch (e) {
      const plain = plainSubject(show.messages);
      if (plain) setDraft(plain);
      else toast('error', errorText(e));
    } finally {
      setBusy(null);
    }
  };

  if (draft !== null) {
    return (
      <div className={cx('flex min-w-0 items-center gap-1.5', className)}>
        <input
          autoFocus
          aria-label={text('Subject')}
          value={draft}
          maxLength={190}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => {
            // Suggest is beside it: a click there keeps editing.
            if ((e.relatedTarget as HTMLElement | null)?.dataset.subjectSuggest) return;
            void save(draft);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void save(draft);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setDraft(null);
            }
          }}
          className="h-9 min-w-0 flex-1 rounded-[8px] border border-primary bg-surface px-2 text-[16px] font-bold text-ink outline-none"
        />
        <button type="button" data-subject-suggest="1" disabled={busy === 'suggest'} onClick={() => void suggest()} title={text('Suggest a subject from the conversation')} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-[8px] border border-line px-2 text-[12px] font-semibold text-ink-2 hover:bg-subtle disabled:opacity-50">
          <Icon name={busy === 'suggest' ? 'spinner' : 'sparkles'} size={13} className={busy === 'suggest' ? 'animate-spin-slow' : 'text-[#7C3AED]'} />
          {text('Suggest')}
        </button>
      </div>
    );
  }
  return (
    <div className={cx('group/subject flex min-w-0 items-start gap-1.5', className)}>
      <Tag className={cx('min-w-0 leading-snug font-extrabold text-ink', level === 'h1' ? 'text-[19px]' : 'text-[17px]')}>
        {canEdit ? (
          <button type="button" onClick={() => setDraft(t.subject)} title={text('Click to change the subject')} className="cursor-text rounded-[6px] text-left hover:bg-subtle focus-visible:bg-subtle">
            {t.subject}
          </button>
        ) : (
          t.subject
        )}
      </Tag>
      {canEdit ? (
        <button type="button" aria-label={text('Change the subject')} onClick={() => setDraft(t.subject)} className="mt-1 shrink-0 rounded-[6px] p-1 text-ink-3 opacity-0 group-hover/subject:opacity-100 hover:text-ink focus-visible:opacity-100">
          <Icon name="pen" size={13} />
        </button>
      ) : null}
      {busy === 'save' ? <Icon name="spinner" size={13} className="mt-1.5 animate-spin-slow text-ink-3" /> : saved ? <span className="mt-1 shrink-0 text-[11.5px] font-semibold text-success">{text('Saved')}</span> : null}
    </div>
  );
}
