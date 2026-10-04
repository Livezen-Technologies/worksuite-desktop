import { useEffect, useRef, useState } from 'react';
import type { WebchatRingChat, WebchatRingState } from '@shared/types';
import { call, errorMessage } from '../../../core/bridge';
import { text } from '../../../core/i18n';
import { toast } from '../../../core/toasts';
import { cx } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { useNow } from '../../calls/parts';
import { ReplyBox, joinSend, useFit, useRingDraft } from './RingCard';
import { useRingState, waited } from './Ringing';

/**
 * The tray's ringing menu (R-06, RING-UI-07, X-UI-11; RING-43, UX-ALR-02): opened from the menu-bar or tray icon
 * while chats ring. "3 WEBSITE CHATS RINGING"; the most urgent chat expanded — who, "At risk · 3:12 · Kandy", Join,
 * what they last wrote and a reply box whose Send & join joins and stops the ring — and every other chat a row with
 * Reply and Join; then Open Website Chats, Ringing settings… and Quit WorkSuite. Reply on a row expands that one.
 */

/** "At risk", "Assigned to you", "Silenced for you" or "Waiting", with how long — and, expanded, the visitor's town. */
export function trayLine(c: Pick<WebchatRingChat, 'atRisk' | 'mine' | 'silenced' | 'since' | 'place'>, now: number, expanded: boolean): string {
  const what = c.atRisk ? text('At risk') : c.mine ? text('Assigned to you') : c.silenced ? text('Silenced for you') : text('Waiting');
  const town = expanded ? (c.place?.split(',')[0]?.trim() ?? null) : null;
  return [what, waited(c.since, now), town].filter(Boolean).join(' · ');
}

const tray = (action: 'inbox' | 'settings' | 'quit' | 'close') => void call('ring:tray', { action }).catch(() => undefined);
const join = (id: number) => void call('ring:join', { id }).catch((e) => toast('error', errorMessage(e)));

function JoinLink({ c, name }: { c: WebchatRingChat; name: string }) {
  return (
    <button type="button" aria-label={`Join ${name}`} onClick={() => join(c.id)} className="flex h-[26px] shrink-0 items-center rounded-full bg-[#2F9E67] px-[11px] text-[12px] font-bold text-white hover:brightness-110">
      {text('Join')}
    </button>
  );
}

/** The expanded row: the chat, what they last wrote, and the reply box (UX-ALR-02). */
function Expanded({ s, c, now }: { s: WebchatRingState; c: WebchatRingChat; now: number }) {
  const [draft, setDraft] = useRingDraft(c.id, s.drafts?.[c.id]);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const words = draft.trim();
    if (!words || busy) return;
    setBusy(true);
    // Joins, sends and stops the ring for everyone in one request; the menu stays where I am (R-06).
    const ok = await joinSend(c.id, words);
    setBusy(false);
    if (ok) setDraft('');
  };
  return (
    <li aria-label={c.visitor} className={cx('flex flex-col gap-[7px] rounded-[10px] px-2.5 py-2', c.atRisk ? 'bg-danger-bg' : 'bg-selection')}>
      <div className="flex items-center gap-2">
        <span className="flex min-w-0 flex-1 flex-col">
          <b className="truncate text-[14px] font-bold">{c.visitor}</b>
          <span className={cx('truncate text-[12px]', c.atRisk ? 'text-danger' : 'text-ink-2')}>{trayLine(c, now, true)}</span>
        </span>
        <JoinLink c={c} name={c.visitor} />
      </div>
      {c.preview ? <p className="line-clamp-2 text-[12px] text-ink-2 italic">{`"${c.preview}"`}</p> : null}
      <ReplyBox id={`tray-reply-${c.id}`} label={text('Reply to {name}', { name: c.visitor })} placeholder={text('Type a reply…')} sendLabel="Send & join" sendAria="Send and join" draft={draft} setDraft={setDraft} onSend={() => void send()} busy={busy} visitorSaid={c.preview} look="menu" />
    </li>
  );
}

export function RingTrayWindow() {
  const s = useRingState();
  const now = useNow();
  const fit = useFit('ring:trayFit');
  // The most urgent chat is expanded (RING-23 order); Reply on another expands it instead.
  const [open, setOpen] = useState<number | null>(null);
  const shown = s.chats.slice(0, 5);
  const expanded = shown.find((c) => c.id === open) ?? shown[0];
  const first = useRef<HTMLDivElement | null>(null);
  // Opened to be typed in: the reply box has the keyboard at once.
  const expandedId = expanded?.id ?? null;
  useEffect(() => {
    if (expandedId !== null) (first.current?.querySelector('input') as HTMLInputElement | null)?.focus();
  }, [expandedId]);
  const header = s.chats.length === 1 ? text('Website chat ringing') : text('{n} website chats ringing', { n: s.chats.length });
  return (
    <div
      ref={(el) => {
        first.current = el;
        fit(el);
      }}
      onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), tray('close'))}
      className="flex flex-col"
    >
      <section aria-label="Tray menu" className="flex flex-col gap-0.5 border border-line bg-surface p-2 text-[13px] text-ink">
        {s.hidden || !expanded ? (
          <p className="px-2.5 py-2 text-ink-2">{s.hidden ? text('Unlock WorkSuite to see who.') : text('Nothing is ringing.')}</p>
        ) : (
          <>
            <div className="px-2.5 py-2 text-[11px] font-bold tracking-[0.8px] text-danger uppercase">{header}</div>
            <ul className="flex flex-col gap-0.5" aria-label={text('Chats ringing')}>
              {shown.map((c) =>
                c.id === expanded.id ? (
                  <Expanded key={c.id} s={s} c={c} now={now} />
                ) : (
                  <li key={c.id} aria-label={c.visitor} className="flex items-center gap-2 rounded-[8px] px-2.5 py-2 hover:bg-subtle">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[14px] font-semibold">{c.visitor}</span>
                      <span className={cx('truncate text-[12px]', c.atRisk ? 'text-danger' : 'text-ink-2')}>{trayLine(c, now, false)}</span>
                    </span>
                    <button type="button" aria-label="Reply" title={text('Reply to {name}', { name: c.visitor })} onClick={() => setOpen(c.id)} className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border border-line bg-surface text-primary hover:bg-selection">
                      <Icon name="reply" size={12} />
                    </button>
                    <JoinLink c={c} name={c.visitor} />
                  </li>
                ),
              )}
            </ul>
            {s.chats.length > shown.length ? <p className="px-2.5 text-[11.5px] text-ink-2">{text('+{n} more waiting', { n: s.chats.length - shown.length })}</p> : null}
            <p className="px-2.5 pt-0.5 pb-1 text-[11px] text-ink-2">{text('Reply from here: sending joins the chat and stops the ring.')}</p>
          </>
        )}
        <div role="separator" className="my-1 h-px bg-line" />
        <button type="button" onClick={() => tray('inbox')} className="rounded-[6px] px-2.5 py-2 text-left text-[13px] hover:bg-subtle">
          {text('Open Website Chats')}
        </button>
        <button type="button" onClick={() => tray('settings')} className="rounded-[6px] px-2.5 py-2 text-left text-[13px] hover:bg-subtle">
          {text('Ringing settings…')}
        </button>
        <button type="button" onClick={() => tray('quit')} className="rounded-[6px] px-2.5 py-2 text-left text-[13px] hover:bg-subtle">
          {text('Quit WorkSuite')}
        </button>
      </section>
    </div>
  );
}
