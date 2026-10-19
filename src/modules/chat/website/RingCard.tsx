import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { WebchatFollowUp, WebchatJoined, WebchatRingChat, WebchatRingOutcome, WebchatRingState } from '@shared/types';
import { call, errorMessage, isMac } from '../../../core/bridge';
import { toast } from '../../../core/toasts';
import { Avatar, cx } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { write, writerProblem, useWriter } from '../../ai/writer';
import { useCanned } from './api';
import { text } from '../../../core/i18n';
import { markdownText } from '../../../core/markdown';
import { clock, firstName, handoverIn, returningLine, ringsFor, silencedFor, stageLabel, stepLabel, visitLabel, waited, youJoinedLine } from './Ringing';
import { BrandMark } from '../../../components/BrandMark';

/**
 * The website chat ringing card (worksuite-desktop#225), in the call window over other apps:
 *
 * - one chat ringing: who and where, what they are reading, what they wrote, quick replies, a reply box whose Send
 *   joins the chat and sends in one step, Join chat, Transfer (a chat given to me) and Silence;
 * - several: compact cards, each with what the visitor wrote, its own reply box, Join and Silence;
 * - after joining from it: a mini chat — "You joined the chat", what I sent, a reply box and Open full chat — until I
 *   open the full chat or minimise it.
 *
 * The window is as tall as the card: it measures itself (`ring:fit`), so nothing is cut off and nothing is left empty.
 */

const QUICK = ['Hi! How can I help?', 'One moment, checking for you', 'Can I call you back?'];

/** The window takes the card's height: the call window's (`ring:fit`), or the tray's ringing menu's (R-06). */
export function useFit(channel: 'ring:fit' | 'ring:trayFit' = 'ring:fit'): (el: HTMLDivElement | null) => void {
  const observer = useRef<ResizeObserver | null>(null);
  useEffect(() => () => observer.current?.disconnect(), []);
  return (el) => {
    observer.current?.disconnect();
    if (!el || typeof ResizeObserver === 'undefined') return;
    const report = () => void call(channel, { height: Math.max(80, Math.min(1200, Math.ceil(el.getBoundingClientRect().height))) }).catch(() => undefined);
    observer.current = new ResizeObserver(report);
    observer.current.observe(el);
    report();
  };
}

const minimise = () => void call('ring:minimise').catch(() => undefined);

/**
 * The native window's title strip (R-05, V-04): WorkSuite's mark, what the window is — "WorkSuite · Website chat" — and,
 * on the ringing chat, that it stays on top of other apps (RING-40); minimise at its end where the card has one.
 */
export function WindowStrip({ title, badge, canMinimise }: { title: string; badge?: string; canMinimise?: boolean }) {
  return (
    <div className="drag flex h-8 shrink-0 items-center gap-2 bg-[#0B1430] px-3.5 text-[12px] text-[#C9CFE3]">
      <BrandMark size={18} />
      {title}
      <span className="flex-1" />
      {badge ? <span className="rounded-[4px] bg-[#1F2A5B] px-1.5 py-0.5 text-[11px] text-[#B3C0FF]">{badge}</span> : null}
      {canMinimise ? (
        <button type="button" aria-label="Minimise notification" title="Minimise (Esc)" onClick={minimise} className="no-drag -mr-1.5 flex h-6 w-6 items-center justify-center rounded-[6px] text-[#8C92B5] hover:bg-white/7 hover:text-white">
          <Icon name="minus" size={13} />
        </button>
      ) : null}
    </div>
  );
}

/**
 * What I type to a ringing visitor (R-05, R-06; UX-ALR-04): kept in the main process as well as here, so the call
 * window and the tray's menu show the same words and a colleague joining first does not lose them.
 */
export function useRingDraft(id: number, kept: string | undefined): [string, (v: string) => void] {
  const [draft, set] = useState(kept ?? '');
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; text: string } | null>(null);
  const tell = (t: string) => void call('ring:draft', { id, text: t }).catch(() => undefined);
  useEffect(
    () => () => {
      // Said at once when the card goes, so the last words typed are not lost.
      if (pending.current) {
        clearTimeout(pending.current.timer);
        tell(pending.current.text);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id],
  );
  const setDraft = (v: string) => {
    set(v);
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = {
      text: v,
      timer: setTimeout(() => {
        pending.current = null;
        tell(v);
      }, 200),
    };
  };
  return [draft, setDraft];
}

/** The card's frame: dark, the header's red dot and status, and minimise. */
function Frame({ dot, status, badge, children, hint, after, footer }: { dot: 'ringing' | 'silenced' | 'joined'; status: string; badge?: ReactNode; children: ReactNode; hint: string; after?: ReactNode; footer?: ReactNode }) {
  // Esc minimises, wherever focus is in the card.
  return (
    <div className="flex flex-col bg-[#131838] text-[13px] text-[#E6E8F5]" onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), minimise())}>
      <div className="drag flex items-center gap-2 py-2.5 pr-3 pl-4">
        <span className={cx('h-[9px] w-[9px] rounded-full', dot === 'joined' ? 'bg-[#22C55E] shadow-[0_0_0_4px_rgba(34,197,94,0.18)]' : dot === 'silenced' ? 'bg-[#F5B94A] shadow-[0_0_0_4px_rgba(245,185,74,0.18)]' : 'bg-[#EF5A4C] shadow-[0_0_0_4px_rgba(239,90,76,0.2)] motion-safe:animate-pulse')} />
        <span className="flex-1 truncate text-[11px] font-bold tracking-[.08em] text-[#AEB3D1] uppercase">{status}</span>
        {badge}
        <button type="button" aria-label="Minimise notification" title="Minimise (Esc)" onClick={minimise} className="no-drag flex h-7 w-7 items-center justify-center rounded-[7px] text-[#8C92B5] hover:bg-white/7 hover:text-white">
          <Icon name="minus" size={14} />
        </button>
      </div>
      {children}
      {after}
      <p className="drag px-4 pt-3 pb-3.5 text-[11px] text-[#8C92B5]">{hint}</p>
      {footer}
    </div>
  );
}

const BADGE = {
  green: 'bg-[rgba(34,197,94,0.12)] text-[#6EE7A0]',
  red: 'bg-[rgba(239,90,76,0.16)] text-[#FFB4A4]',
  blue: 'bg-[rgba(102,118,255,0.16)] text-[#C3CAFF]',
  // A VIP visitor (R-02 design): amber on the dark card.
  vip: 'bg-[#5A2A14] text-[#F7C08F]',
  plain: 'bg-[#1B2341] text-[#CBD1E8]',
} as const;

export function Badge({ tone, children }: { tone: keyof typeof BADGE; children: ReactNode }) {
  return <span className={cx('shrink-0 rounded-full px-2 py-[3px] text-[11px] font-semibold whitespace-nowrap', BADGE[tone])}>{children}</span>;
}

/**
 * Who the card is about, in chips (R-01, RING-UI-01; RING-06, RING-20): the ladder's step — "Priority · step 1 of 3",
 * red at risk, green when it is mine — then "3rd visit" (or new / returning where the count is not known).
 */
function RingChips({ c }: { c: WebchatRingChat }) {
  const step = stepLabel(c);
  const visits = visitLabel(c.visits);
  return (
    <span className="flex flex-wrap gap-1.5 pt-0.5">
      {c.atRisk || c.mine ? <Badge tone={c.atRisk ? 'red' : 'green'}>{stageLabel(c)}</Badge> : step ? <Badge tone="blue">{step}</Badge> : <Badge tone="blue">{stageLabel(c)}</Badge>}
      {c.priority === 'vip' ? <Badge tone="vip">VIP</Badge> : null}
      {visits ? <Badge tone="plain">{visits}</Badge> : <Badge tone="plain">{c.returning ? 'Returning' : 'New visitor'}</Badge>}
    </span>
  );
}

/** Who the visitor is: name, new or returning, site · place · device, and how long they have waited. */
function Visitor({ c, now, hidden, joined, pulse, chips }: { c: Pick<WebchatRingChat, 'visitor' | 'site' | 'place' | 'device' | 'since'>; now: number; hidden: boolean; joined?: boolean; pulse?: boolean; chips?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 pt-0.5 pb-3">
      {/* Ringing, the avatar pulses (R-01, RING-30): under three times a second, and still with reduced motion. */}
      <span className={cx('relative rounded-full', pulse && 'motion-safe:[animation:ws-ring-pulse_1.6s_ease-out_infinite]')}>
        <Avatar name={hidden ? '?' : c.visitor} size={44} />
        <span className="absolute -right-px -bottom-px h-[11px] w-[11px] rounded-full border-2 border-[#131838] bg-[#22C55E]" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="flex items-center gap-2">
          <b className="truncate text-[16px] text-white">{hidden ? 'A website visitor' : c.visitor}</b>
        </span>
        <span className="truncate text-[12px] text-[#AEB3D1]">{hidden ? 'Unlock WorkSuite to see who.' : [c.site, c.place, c.device].filter(Boolean).join(' · ') || 'Website chat'}</span>
        {!hidden ? chips : null}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <span className={cx('font-mono text-[15px] font-bold tabular-nums', joined ? 'text-[#AEB3D1]' : 'text-[#F2B77E]')}>{waited(c.since, now)}</span>
        <span className="text-[10px] text-[#8C92B5]">{joined ? 'waited' : 'waiting'}</span>
      </span>
    </div>
  );
}

/** "Returning visitor · last chat with you on 16 Aug" (worksuite-desktop#291), on a ringing card. */
export function ReturningLine({ r, className }: { r: NonNullable<WebchatRingChat['returnVisit']>; className?: string }) {
  const words = returningLine(r);
  return (
    <p className={cx('flex min-w-0 items-center gap-1.5 text-[11.5px] font-semibold text-[#B3C0FF]', className)} title={words}>
      <Icon name="history" size={12} className="shrink-0" />
      <span className="truncate">{words}</span>
    </p>
  );
}

/** "Reading: …" on its own line, so it is never cut off by the rest. */
function Reading({ page }: { page: string }) {
  return (
    <div className="mx-4 flex items-center gap-2 rounded-[9px] bg-white/[.04] px-2.5 py-2 text-[12px] text-[#AEB3D1]">
      <Icon name="eye" size={14} className="shrink-0" />
      <span className="truncate">Reading: {page}</span>
    </div>
  );
}

function Theirs({ text }: { text: string }) {
  return <div className="max-w-[85%] self-start rounded-[4px_14px_14px_14px] border border-white/6 bg-[#1E2450] px-3 py-2 text-[14px] leading-[1.45] break-words whitespace-pre-wrap">{text}</div>;
}

function Mine({ text, last }: { text: string; last: boolean }) {
  return (
    <div className="flex max-w-[85%] flex-col items-end gap-[3px] self-end">
      <div className="rounded-[14px_14px_4px_14px] bg-[#4F5FEF] px-3 py-2 text-[14px] leading-[1.45] break-words whitespace-pre-wrap text-white">{text}</div>
      {last ? <span className="text-[11px] text-[#8C92B5]">Sent</span> : null}
    </div>
  );
}

/**
 * The reply box: what is typed, the AI button (a reply to what the visitor wrote, when this workspace has the
 * writing assistant) and Send. Enter sends.
 */
const LOOK = {
  // The cards' own box: dark, blue Send.
  card: { box: 'rounded-[12px] border bg-[#0E1231] py-1 pr-1 pl-3', on: 'border-[#6676FF]', off: 'border-white/10', input: 'h-[38px] text-[14px] text-[#E6E8F5] placeholder:text-[#8C92B5]', ai: 'h-[34px] w-[34px] text-[#AEB8FF] hover:bg-white/7', send: 'h-[38px] rounded-[9px] px-3 text-[13px] font-semibold', ready: 'bg-[#4F5FEF] hover:brightness-110', idle: 'bg-[#3A4170] text-white/70', icon: 15 },
  // The native alert's (R-05): a white pill in a blue ring, green Send & join.
  alert: { box: 'rounded-full bg-white py-1 pr-1 pl-3 shadow-[0_0_0_3px_rgba(74,99,232,0.45)]', on: '', off: '', input: 'h-9 text-[13.5px] text-[#161A2C] placeholder:text-[#6B7083]', ai: 'h-9 w-9 rounded-full text-[#273498] hover:bg-[#EEF1FD]', send: 'h-9 rounded-full px-3 text-[13px] font-bold', ready: 'bg-[#2F9E67] hover:brightness-110', idle: 'bg-[#2F9E67]/60 text-white/90', icon: 14 },
  // The tray's ringing menu (R-06): smaller, a blue border on white.
  menu: { box: 'rounded-full border border-primary bg-surface py-[3px] pr-[3px] pl-2.5 shadow-[0_0_0_3px_var(--color-selection)]', on: '', off: '', input: 'h-[26px] text-[12px] text-ink placeholder:text-ink-3', ai: 'h-[26px] w-[26px] rounded-full text-primary hover:bg-selection', send: 'h-[26px] rounded-full px-2.5 text-[11.5px] font-bold', ready: 'bg-[#2F9E67] hover:brightness-110', idle: 'bg-[#2F9E67]/60 text-white/90', icon: 11 },
} as const;

export function ReplyBox({ id, label, placeholder, sendLabel, sendAria, draft, setDraft, onSend, busy, visitorSaid, disabled, look = 'card', onKeys }: {
  id: string; label: string; placeholder: string; sendLabel: string; sendAria?: string; draft: string; setDraft: (v: string) => void; onSend: () => void; busy: boolean; visitorSaid: string | null; disabled?: boolean; look?: keyof typeof LOOK;
  /** Keys the box does not handle itself (the saved replies list's arrows, R-05). */
  onKeys?: (e: KeyboardEvent<HTMLInputElement>) => boolean;
}) {
  const L = LOOK[look];
  const writer = useWriter();
  const canWrite = !!writer.data?.available && writer.data.actions.some((a) => a.key === 'reply') && !!visitorSaid;
  const [thinking, setThinking] = useState(false);
  const ai = async () => {
    if (!visitorSaid || thinking) return;
    setThinking(true);
    try {
      // To the visitor without Markdown's marks: their widget shows a reply as it is written (#261).
      setDraft(markdownText(await write('reply', `Visitor: ${visitorSaid}`)));
    } catch (e) {
      toast('error', writerProblem(e));
    } finally {
      setThinking(false);
    }
  };
  const ready = !!draft.trim() && !busy && !disabled;
  return (
    <div className={cx('flex items-center gap-1.5', L.box, draft ? L.on : L.off)}>
      <label htmlFor={id} className="sr-only">{label}</label>
      <input
        id={id}
        type="text"
        value={draft}
        disabled={disabled}
        maxLength={4000}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (onKeys?.(e)) return;
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (ready) onSend();
          }
        }}
        placeholder={placeholder}
        className={cx('min-w-0 flex-1 bg-transparent outline-none', L.input)}
      />
      {canWrite ? (
        <button type="button" aria-label="Write with AI" title="Write a reply with AI" disabled={thinking || disabled} onClick={() => void ai()} className={cx('flex items-center justify-center rounded-[9px] disabled:opacity-50', L.ai)}>
          <Icon name={thinking ? 'spinner' : 'sparkles'} size={16} className={cx(thinking && 'animate-spin')} />
        </button>
      ) : null}
      <button type="button" aria-label={sendAria} disabled={!ready} onClick={onSend} className={cx('flex shrink-0 items-center gap-1.5 whitespace-nowrap text-white', L.send, ready ? L.ready : L.idle)}>
        <Icon name="send" size={L.icon} />
        {sendLabel}
      </button>
    </div>
  );
}

/**
 * Quick replies: the team's most used saved replies, or plain ones; a click puts one in the box (and which saved reply
 * it was, counted once sent — RDC-03). With `onSaved`, the native alert's "/ saved" chip opens the whole list (R-05).
 */
function Chips({ pick, enabled, max = 3, onSaved, savedOpen, className }: { pick: (text: string, cannedId?: number) => void; enabled: boolean; max?: number; onSaved?: () => void; savedOpen?: boolean; className?: string }) {
  const canned = useCanned(enabled);
  const responses = canned.data?.responses ?? [];
  const chips = responses.slice(0, max).map((r) => ({ label: r.title || r.body, text: r.body, id: r.id }));
  const list = chips.length ? chips : QUICK.slice(0, max).map((t) => ({ label: t, text: t, id: undefined }));
  return (
    <div className={cx('flex flex-wrap gap-1.5 px-4 pt-1.5', className)} role="group" aria-label="Quick replies">
      {list.map((c) => (
        <button key={c.label} type="button" onClick={() => pick(c.text, c.id)} className="h-[28px] max-w-full truncate rounded-full border border-[#2A3870] bg-[#1A2550] px-2.5 text-[12px] font-medium text-[#DFE3F0] hover:bg-[#22306A]">
          {c.label}
        </button>
      ))}
      {onSaved && responses.length ? (
        <button type="button" aria-expanded={!!savedOpen} aria-label="Saved replies" onClick={onSaved} className="h-[28px] rounded-full border border-[#2A3870] bg-[#1A2550] px-2.5 font-mono text-[12px] text-[#B3C0FF] hover:bg-[#22306A]">
          / saved
        </button>
      ) : null}
    </div>
  );
}

/** A saved reply matches what follows "/" in the box: its shortcut, title or words. */
export function savedMatches<T extends { shortcut: string | null; title: string; body: string }>(list: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((r) => [r.shortcut, r.title, r.body].some((v) => v?.toLowerCase().includes(q)));
}

/**
 * The team's saved replies in the native alert (R-05, UX-ALR-01): opened by the "/ saved" chip, or by typing "/" in
 * the reply box, narrowed by what follows; picking one puts it in the box.
 */
function SavedReplies({ query, pick }: { query: string; pick: (text: string, cannedId: number) => void }) {
  const canned = useCanned(true);
  const list = savedMatches(canned.data?.responses ?? [], query).slice(0, 6);
  return (
    <ul role="listbox" aria-label="Saved replies" className="mx-[18px] mt-2 flex max-h-[180px] flex-col overflow-y-auto rounded-[10px] border border-[#2A3870] bg-[#0E1534] py-1">
      {list.length ? (
        list.map((r) => (
          <li key={r.id} role="option" aria-selected={false} tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r.body, r.id)} className="flex cursor-pointer flex-col gap-0.5 px-3 py-1.5 hover:bg-[#1A2550]">
            <span className="truncate text-[12.5px] font-semibold text-white">
              {r.shortcut ? <span className="mr-1.5 font-mono text-[#B3C0FF]">/{r.shortcut}</span> : null}
              {r.title || r.body}
            </span>
            {r.title ? <span className="truncate text-[11.5px] text-[#AAB2C9]">{r.body}</span> : null}
          </li>
        ))
      ) : (
        <li className="px-3 py-1.5 text-[12px] text-[#AAB2C9]">{canned.isLoading ? text('Loading…') : text('No saved replies match.')}</li>
      )}
    </ul>
  );
}

/**
 * Join chat and Join & send: one request, first come; a moment too late, the card says who has it. `open`: the thread
 * opens after (R-05, RING-41); `cannedId`: the saved reply it came from (RDC-03).
 */
export async function joinSend(id: number, message?: string, opts: { open?: boolean; cannedId?: number; visitor?: string } = {}): Promise<boolean> {
  try {
    // `visitor`: a Needs you row of the tray's mini-dashboard or the Live map window, which may not ring for me (UX-ALR-03).
    const r = await call('ring:joinSend', { id, ...(message ? { message } : {}), ...(opts.open ? { open: true } : {}), ...(message && opts.cannedId ? { cannedId: opts.cannedId } : {}), ...(opts.visitor ? { visitor: opts.visitor } : {}) });
    return r.ok;
  } catch (e) {
    toast('error', errorMessage(e));
    return false;
  }
}

const silence = (id: number, on: boolean) => void call('ring:silence', { id, on }).catch(() => undefined);

/** The outcome's words where a card says them in a line: not words kept for me, which have their own card (UX-ALR-04). */
export function outcomeLine(s: Pick<WebchatRingState, 'outcome'>): string | null {
  return s.outcome && !s.outcome.draft ? s.outcome.text : null;
}

/**
 * One chat ringing, as the native incoming-chat window over another app (R-05, RING-UI-06, X-UI-10; RING-40/41/46,
 * UX-ALR-01): the title strip — "WorkSuite · Website chat", Always on top — the visitor in the pulsing ring with
 * INCOMING WEBSITE CHAT and how long they have waited, the site and the page they are on, what they wrote, quick
 * replies with "/ saved", a reply box whose Send & join joins, sends, stops the ring for everyone and opens the thread,
 * then Join chat and Silence, and "Rings until someone joins" with the keys. The step and visit chips (R-01) stay.
 */
export function RingCard({ s, c, now, after }: { s: WebchatRingState; c: WebchatRingChat; now: number; after?: ReactNode }) {
  const [draft, setDraft] = useRingDraft(c.id, s.drafts?.[c.id]);
  const [canned, setCanned] = useState<number | null>(null);
  const [savedOpen, setSavedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const joinKey = isMac ? '⌘⇧J' : 'Ctrl+Shift+J';
  const handover = c.mine ? handoverIn(c.handoverAt, now) : null;
  const send = async (withText: boolean) => {
    if (busy) return;
    const words = withText ? draft.trim() : '';
    setBusy(true);
    // Both open the thread (RING-41): with words, they are in it, delivered (WF-X1).
    const ok = await joinSend(c.id, words || undefined, { open: true, ...(words && canned ? { cannedId: canned } : {}) });
    setBusy(false);
    if (ok && words) {
      setDraft('');
      setCanned(null);
    }
  };
  const type = (v: string) => {
    setDraft(v);
    setCanned(null);
    // "/" first opens the saved replies, narrowed by what follows.
    setSavedOpen(v.startsWith('/'));
  };
  const pick = (t: string, id?: number) => {
    // A saved reply goes to the visitor without Markdown's marks (#261).
    setDraft(markdownText(t));
    setCanned(id ?? null);
    setSavedOpen(false);
  };
  const name = s.hidden ? 'A website visitor' : c.visitor;
  const time = waited(c.since, now);
  const status = outcomeLine(s) ?? (s.elsewhere ? 'Ringing on your other device — shown here without sound' : null);
  const others = s.chats.length - 1;
  return (
    <section aria-label="WorkSuite incoming website chat" className="flex flex-col bg-[#111B3B] text-[13px] text-[#F1F4FB]" onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), savedOpen ? setSavedOpen(false) : minimise())}>
      <WindowStrip title="WorkSuite · Website chat" badge="Always on top" canMinimise />
      <div className="sr-only" role="alert" aria-live="assertive">
        {s.hidden ? 'A website chat is waiting.' : `Website chat: ${c.visitor}${c.site ? ` on ${c.site}` : ''} is waiting.`}
      </div>
      <div className="drag flex items-center gap-4 px-[18px] pt-[18px] pb-2">
        {/* Ringing, the ring pulses (RING-30): under three times a second, and still with reduced motion. */}
        <span aria-hidden className="flex h-[82px] w-[82px] shrink-0 items-center justify-center rounded-full border-2 border-[rgba(99,123,242,0.35)] motion-safe:[animation:ws-ring-pulse_1.6s_ease-out_infinite]">
          <Avatar name={s.hidden ? '?' : c.visitor} size={62} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="text-[11px] font-bold tracking-[1px] text-[#F7B0A4] uppercase">
            <span>Incoming website chat</span>
            {' · '}
            <span role="timer" aria-label={`Waiting ${time}`} className="font-mono tabular-nums">{time}</span>
          </span>
          <b className="truncate text-[19px] font-bold text-white">{name}</b>
          <span className="truncate text-[13px] text-[#AAB2C9]">{s.hidden ? 'Unlock WorkSuite to see who.' : [c.site, c.page].filter(Boolean).join(' · ') || 'Website chat'}</span>
          {!s.hidden ? <RingChips c={c} /> : null}
        </span>
      </div>
      {c.mine && c.by && !s.hidden ? <p className="px-[18px] text-[11.5px] text-[#AEB3D1]">Assigned to you by {c.by}</p> : null}
      {/* A returning visitor (#291): whose their last chat was, and when; their new message is under it. */}
      {c.returnVisit && !s.hidden ? <ReturningLine r={c.returnVisit} className="px-[18px]" /> : null}
      {!s.hidden && c.preview ? <p className="mx-[18px] mt-1.5 rounded-[10px] border border-[#24306A] bg-[#1A2550] px-3 py-2.5 text-[13px] leading-[1.45] break-words whitespace-pre-wrap">{c.preview}</p> : null}
      {!s.hidden ? (
        <>
          <Chips pick={pick} enabled={!s.hidden} max={2} onSaved={() => setSavedOpen((o) => !o)} savedOpen={savedOpen} className="px-[18px] pt-3" />
          {savedOpen ? <SavedReplies query={draft.startsWith('/') ? draft.slice(1) : ''} pick={pick} /> : null}
          <div className="mx-[18px] mt-2.5">
            <ReplyBox id={`ring-reply-${c.id}`} label="Reply and join" placeholder={text('Type a reply…')} sendLabel="Send & join" sendAria="Send and join" draft={draft} setDraft={type} onSend={() => void send(true)} busy={busy} visitorSaid={c.preview} look="alert" />
          </div>
          <p className="drag px-[22px] pt-1.5 text-[11.5px] text-[#8B93AD]">Sending joins you to the chat, stops the ring for everyone and opens the thread.</p>
        </>
      ) : null}
      <div className="flex gap-2.5 px-[18px] py-3">
        <button type="button" disabled={s.hidden || busy} onClick={() => void send(false)} className="h-[42px] flex-1 rounded-full bg-[#2F9E67] text-[14.5px] font-bold text-white hover:brightness-110 disabled:opacity-50">
          Join chat
        </button>
        {c.mine ? (
          <button type="button" disabled={s.hidden} onClick={() => void call('ring:join', { id: c.id, then: 'transfer' }).catch((e) => toast('error', errorMessage(e)))} className="h-[42px] shrink-0 rounded-full border border-[#3A4468] px-4 text-[13.5px] font-semibold hover:bg-white/5 disabled:opacity-50">
            Transfer
          </button>
        ) : null}
        {/* Silence in words (R-05): a personal mute on all my devices until at risk (RING-11). */}
        <button type="button" aria-pressed={c.silenced} onClick={() => silence(c.id, !c.silenced)} className={cx('h-[42px] w-[104px] shrink-0 rounded-full border border-[#3A4468] text-[13.5px] font-semibold text-[#F1F4FB] hover:bg-white/5', c.silenced && 'bg-white/10')}>
          {c.silenced ? text('Unsilence') : text('Silence')}
        </button>
      </div>
      {handover !== null ? (
        // A chat given to me passes on if I do not join it in time (RING-UI-02): the same countdown as in the stack.
        <div className="px-[18px] pb-2">
          <Handover
            left={handover}
            pass={
              <button type="button" onClick={() => void call('ring:pass', { id: c.id }).catch((e) => toast('error', errorMessage(e)))} className="font-semibold text-[#AEB8FF] hover:underline">
                Pass now
              </button>
            }
          />
        </div>
      ) : null}
      {after}
      {status ? <p role="status" className="drag px-[18px] pt-1 text-[11.5px] text-[#B3C0FF]">{status}</p> : null}
      {/* The footer (R-05; R-01 RING-23): it rings until someone joins — for how many others — and the keys. */}
      <div className="drag flex items-center justify-between gap-3 px-[18px] pt-1 pb-3 text-[12px] text-[#8B93AD]">
        <span className="min-w-0 truncate">{ringsFor(c)}</span>
        {others > 0 ? (
          <button type="button" onClick={() => void call('ring:openInbox').catch(() => undefined)} className="no-drag shrink-0 font-bold text-[#B3C0FF] hover:text-white">
            {text('+{n} waiting', { n: others })}
          </button>
        ) : null}
        <span className="shrink-0 font-mono">{s.shortcut ? `↵ send · ${joinKey} join` : '↵ send'}</span>
      </div>
    </section>
  );
}

const outcomeAct = (action: 'view' | 'missed' | 'dismiss' | 'participant') => void call('ring:outcome', { action }).catch(() => undefined);

/**
 * A colleague joined while I was typing to the visitor (R-05, R-06; UX-ALR-04): "Nuwan joined — send to the chat as a
 * participant?", my words as I left them, and the choice — Send to the chat (as a participant, TEAM-02), View, or
 * Discard. Nothing is sent without it.
 */
export function ParticipantCard({ o }: { o: WebchatRingOutcome }) {
  return (
    <section role="alert" aria-label="A colleague joined first" className="flex flex-col gap-2.5 bg-[#111B3B] px-[18px] py-3.5 text-[13px] text-[#F1F4FB]">
      <div className="drag flex items-center gap-2.5">
        <Avatar name={o.by ?? '?'} size={34} />
        <b className="min-w-0 flex-1 text-[14px] leading-snug">{o.text}</b>
      </div>
      <p aria-label="Your reply, not sent" className="rounded-[10px] border border-[#24306A] bg-[#1A2550] px-3 py-2.5 leading-[1.45] break-words whitespace-pre-wrap">{o.draft}</p>
      <div className="flex gap-2">
        <button type="button" onClick={() => outcomeAct('participant')} className="h-10 flex-1 rounded-full bg-[#2F9E67] text-[13.5px] font-bold text-white hover:brightness-110">
          {text('Send to the chat')}
        </button>
        <button type="button" onClick={() => outcomeAct('view')} className="h-10 shrink-0 rounded-full border border-[#3A4468] px-4 text-[13px] font-semibold hover:bg-white/5">
          {text('View')}
        </button>
        <button type="button" onClick={() => outcomeAct('dismiss')} className="h-10 shrink-0 rounded-full border border-[#3A4468] px-4 text-[13px] font-semibold hover:bg-white/5">
          {text('Discard')}
        </button>
      </div>
    </section>
  );
}

/** The kind of card a chat is in the stack (R-02, RING-UI-02): at risk, assigned to me, or waiting. */
function rowKind(c: Pick<WebchatRingChat, 'atRisk' | 'mine'>): 'risk' | 'mine' | 'waiting' {
  return c.atRisk ? 'risk' : c.mine ? 'mine' : 'waiting';
}

const ROW = {
  risk: 'border-[#8A3432] bg-[#4A1714] shadow-[0_16px_40px_rgba(0,0,0,0.45)]',
  mine: 'border-[#273498] bg-[#1B2570]',
  waiting: 'border-white/10 bg-[#131838]',
} as const;

/** The handover countdown on a chat given to me (R-02; RING-05, RING-12): the bar, the time, and Pass to next. */
function Handover({ left, pass }: { left: number; pass: ReactNode }) {
  return (
    <div role="timer" aria-label={`Passes on in ${clock(left)}`}>
      <div className="h-[5px] overflow-hidden rounded-full bg-[#273050]">
        <div className="h-full rounded-full bg-[#8FA2FF] transition-[width] duration-1000 ease-linear" style={{ width: `${Math.min(100, (left / 60) * 100)}%` }} />
      </div>
      <p className="mt-1 flex items-center gap-2 text-[11.5px] text-[#B3C0FF]">
        <span className="flex-1">Passes to the next available agent in {clock(left)} if you don't join</span>
        {pass}
      </p>
    </div>
  );
}

/**
 * One of several chats ringing (#225, design 2; R-02, RING-UI-02): what they wrote, a reply box, Join. At risk it is
 * the red card — AT RISK, "Stronger tone · supervisors told" — and Silence does not hold it (RING-06); assigned to me
 * it is the blue one — ASSIGNED TO YOU, in turn or from whom, the handover countdown and Pass to next (RING-05,
 * RING-12); waiting, a compact row with its site and step.
 */
function StackRow({ s, c, now }: { s: WebchatRingState; c: WebchatRingChat; now: number }) {
  // Kept like the single card's, so a colleague joining first does not lose it (UX-ALR-04).
  const [draft, setDraft] = useRingDraft(c.id, s.drafts?.[c.id]);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await joinSend(c.id, draft.trim() || undefined);
    setBusy(false);
    if (ok) setDraft('');
  };
  const name = s.hidden ? 'A visitor' : c.visitor;
  const kind = rowKind(c);
  const handover = kind === 'mine' ? handoverIn(c.handoverAt, now) : null;
  const step = stepLabel(c);
  const pass = () => void call('ring:pass', { id: c.id }).catch((e) => toast('error', errorMessage(e)));
  return (
    <li className={cx('flex flex-col gap-2.5 rounded-[14px] border py-3 pr-3 pl-3.5', ROW[kind])} aria-label={name}>
      {kind !== 'waiting' ? (
        <div className="flex items-center gap-2">
          <span className={cx('rounded-[6px] px-2 py-[3px] text-[11px] font-bold tracking-[1.2px] text-white uppercase', kind === 'risk' ? 'bg-[#D9483B]' : 'bg-[#637BF2]')}>{stageLabel(c)}</span>
          <span className={cx('min-w-0 flex-1 truncate text-[12px]', kind === 'risk' ? 'text-[#F5B1A7]' : 'text-[#B3C0FF]')}>
            {kind === 'risk' ? text('Stronger tone · supervisors told') : c.by && !s.hidden ? text('From {name}', { name: c.by }) : text('In turn')}
          </span>
        </div>
      ) : null}
      <div className="flex items-center gap-2.5">
        <span className={cx('rounded-full', kind === 'risk' && 'ring-[3px] ring-[#EF6B5A]')}>
          <Avatar name={s.hidden ? '?' : c.visitor} size={36} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-1.5">
            <b className="truncate text-[14px] text-white">{name}</b>
            {!s.hidden && c.priority === 'vip' ? <Badge tone="vip">VIP</Badge> : null}
            {!s.hidden && (c.site || (kind === 'waiting' && step)) ? (
              <span className="truncate text-[11px] text-[#8C92B5]">{[c.site, kind === 'waiting' && step ? step.toLowerCase() : null].filter(Boolean).join(' · ')}</span>
            ) : null}
          </span>
          <span className="truncate text-[13px] text-[#C9CDE6]">{s.hidden ? 'Unlock WorkSuite to see who.' : (c.preview ?? (c.page ? `Reading ${c.page}` : 'Waiting for someone'))}</span>
          {c.returnVisit && !s.hidden ? <ReturningLine r={c.returnVisit} /> : null}
        </span>
        <span className={cx('shrink-0 font-mono text-[13px] font-bold tabular-nums', kind === 'risk' ? 'text-[#FF8A73]' : kind === 'mine' ? 'text-white' : 'text-[#F2B77E]')}>{waited(c.since, now)}</span>
      </div>
      {handover !== null ? (
        <Handover
          left={handover}
          pass={
            <button type="button" onClick={pass} className="font-semibold text-[#AEB8FF] hover:underline">
              {text('Pass to next')}
            </button>
          }
        />
      ) : null}
      <div className="flex gap-1.5">
        <span className="flex h-9 flex-1 items-center rounded-[9px] border border-white/10 bg-[#0E1231] px-2.5">
          <label htmlFor={`ring-row-${c.id}`} className="sr-only">Reply to {name}</label>
          <input
            id={`ring-row-${c.id}`}
            type="text"
            value={draft}
            disabled={s.hidden}
            maxLength={4000}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim()) {
                e.preventDefault();
                void go();
              }
            }}
            placeholder="Reply to join…"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[#E6E8F5] outline-none placeholder:text-[#8C92B5]"
          />
        </span>
        <button type="button" disabled={s.hidden || busy} onClick={() => void go()} className="h-9 rounded-[9px] bg-[#22A35A] px-3.5 text-[13px] font-bold text-white hover:brightness-110 disabled:opacity-50">
          {draft.trim() ? 'Join & send' : 'Join chat'}
        </button>
        {kind === 'mine' && handover === null ? (
          // Mine without a countdown (the server does not pass it on): Pass to next is still mine to choose (RING-12).
          <button type="button" onClick={pass} className="h-9 shrink-0 rounded-[9px] border border-white/14 px-2.5 text-[12px] font-semibold hover:bg-white/7">
            {text('Pass to next')}
          </button>
        ) : kind !== 'mine' ? (
          <button type="button" aria-label={`${c.silenced ? 'Unsilence' : 'Silence'} ${name}`} aria-pressed={c.silenced} onClick={() => silence(c.id, !c.silenced)} className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border border-white/14 hover:bg-white/7', c.silenced && 'bg-white/10')}>
            <Icon name="bell-off" size={15} />
          </button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Several chats ringing (#225, design 2; R-02, RING-UI-02; RING-23): "N website chats ringing", most urgent on top — at
 * risk, then assigned to me, then the longest waiting — and Open inbox; a card each. Only the top one sounds (the
 * ringer's tone follows it).
 */
export function RingStack({ s, chats, now, after }: { s: WebchatRingState; chats: WebchatRingChat[]; now: number; after?: ReactNode }) {
  const shown = chats.slice(0, 3);
  return (
    <div className="flex flex-col gap-2.5 bg-[#0F1438] p-2.5 text-[13px] text-[#E6E8F5]" onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), minimise())}>
      <div className="sr-only" role="alert" aria-live="assertive">{`${chats.length} website chats are waiting.`}</div>
      <div className="drag flex items-center gap-2 px-1 text-[12px] text-[#C9CDE6]">
        <span className="h-2 w-2 rounded-full bg-[#EF5A4C] motion-safe:animate-pulse" />
        <b className="font-semibold">{chats.length} website chats ringing</b>
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-[#8C92B5]">{text('Most urgent on top')}</span>
        <button type="button" onClick={() => void call('ring:openInbox').catch(() => undefined)} className="no-drag font-semibold text-[#AEB8FF] hover:text-white">
          Open inbox
        </button>
        <button type="button" aria-label="Minimise notification" onClick={minimise} className="no-drag flex h-7 w-7 items-center justify-center rounded-[7px] text-[#8C92B5] hover:bg-white/7 hover:text-white">
          <Icon name="minus" size={14} />
        </button>
      </div>
      <ul className="flex flex-col gap-2.5" aria-label="Chats waiting">
        {shown.map((c) => <StackRow key={c.id} s={s} c={c} now={now} />)}
      </ul>
      {chats.length > shown.length ? <p className="px-1 text-[11.5px] text-[#AEB3D1]">+{chats.length - shown.length} more waiting</p> : null}
      {after}
      {outcomeLine(s) ? <p className="px-1 text-[11.5px] text-[#AEB3D1]">{outcomeLine(s)}</p> : null}
    </div>
  );
}

/**
 * After joining from the card (#225; R-03 "YOU JOIN"): a mini chat until I open the full chat or minimise it — Yours,
 * what they asked, "You joined the chat · ringing stopped for 2 colleagues", and a reply box.
 */
export function JoinedCard({ j, now, colleagues = null }: { j: WebchatJoined; now: number; colleagues?: number | null }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const r = await call('ring:reply', { message: text });
      if (r.ok) setDraft('');
      else toast('error', r.why ?? 'The reply was not sent.');
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Frame dot="joined" status="Website chat · you joined" badge={<Badge tone="green">{text('Yours')}</Badge>} hint="The visitor sees you joined · Esc to minimise">
      <Visitor c={j} now={now} hidden={false} joined />
      {j.page ? <Reading page={j.page} /> : null}
      <div className="flex flex-col gap-2 px-4 pt-3 pb-1">
        {j.preview ? <Theirs text={j.preview} /> : null}
        <div role="status" className="self-center text-center text-[12px] text-[#8C92B5]">{youJoinedLine(colleagues)}</div>
        {j.sent.map((t, i) => <Mine key={i} text={t} last={i === j.sent.length - 1} />)}
      </div>
      <div className="px-4 pt-2.5">
        <ReplyBox id="ring-joined-reply" label={`Reply to ${j.visitor}`} placeholder={text('Type a reply…')} sendLabel="Send" draft={draft} setDraft={setDraft} onSend={() => void send()} busy={busy} visitorSaid={j.preview} />
      </div>
      <div className="flex gap-2 px-4 pt-3">
        <button type="button" onClick={() => void call('ring:closeJoined', { open: true }).catch(() => undefined)} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-[11px] bg-[#4F5FEF] text-[14px] font-bold text-white hover:brightness-110">
          Open full chat
          <Icon name="external" size={14} />
        </button>
      </div>
    </Frame>
  );
}

/**
 * A chat silenced for me that is still waiting (R-04, RING-UI-04; RING-11, RING-24): the compact card — who, "Silenced
 * for you · still ringing for 2 colleagues", how long, Join chat and Unsilence — that rings again at risk. Others
 * silenced too are "+N waiting", as the full card says it.
 */
export function SilencedCard({ s, c, now }: { s: WebchatRingState; c: WebchatRingChat; now: number }) {
  const [busy, setBusy] = useState(false);
  const others = s.chats.length - 1;
  const name = s.hidden ? text('A website visitor') : c.visitor;
  const go = async () => {
    if (busy) return;
    setBusy(true);
    await joinSend(c.id);
    setBusy(false);
  };
  return (
    <section aria-label={text('Silenced chat')} className="flex flex-col gap-2.5 bg-[#111B3B] px-4 py-3.5 text-[13px] text-[#F1F4FB]" onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), minimise())}>
      <div className="drag flex items-center gap-2.5">
        <Avatar name={s.hidden ? '?' : c.visitor} size={38} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <b className="truncate text-[14px] text-white">{text('{name} is still waiting', { name })}</b>
          <span className="truncate text-[12px] text-[#F3C77E]">{silencedFor(c)}</span>
        </span>
        <span role="timer" aria-label={text('waiting {time}', { time: waited(c.since, now) })} className="shrink-0 font-mono text-[13px] tabular-nums">{waited(c.since, now)}</span>
      </div>
      <div className="flex gap-2">
        <button type="button" disabled={s.hidden || busy} onClick={() => void go()} className="h-10 flex-1 rounded-full bg-[#2F9E67] text-[14px] font-bold text-white hover:brightness-110 disabled:opacity-50">
          {text('Join chat')}
        </button>
        <button type="button" onClick={() => silence(c.id, false)} className="h-10 w-[124px] shrink-0 rounded-full border border-[#3A4468] text-[13px] font-semibold hover:bg-white/5">
          {text('Unsilence')}
        </button>
      </div>
      <p className="drag flex items-center gap-3 text-[12px] text-[#9AA3C4]">
        <span className="min-w-0 flex-1">{outcomeLine(s) ?? text('It rings for you again if it becomes at risk.')}</span>
        {others > 0 ? (
          <button type="button" onClick={() => void call('ring:openInbox').catch(() => undefined)} className="no-drag shrink-0 font-bold text-[#B3C0FF] hover:text-white">
            {text('+{n} waiting', { n: others })}
          </button>
        ) : null}
      </p>
    </section>
  );
}

const outcomeAction = outcomeAct;

/**
 * How the ring ended (R-03, RING-UI-03; RING-02, RING-03, RING-28), when nothing else is ringing:
 *
 * - a colleague joined — the dark toast, "Nuwan joined the chat with Visitor 4F2A", View;
 * - too late — amber, "You pressed Join a moment late — Dilini already has this chat.";
 * - the visitor left — "Visitor 4F2A left the site before anyone joined", the ring stopped and, when the server put it
 *   there, that the chat is in Missed chats with the email they left; Open in Missed and Dismiss;
 * - the visitor ended the chat — "Visitor 4F2A ended the chat. Ringing stopped.";
 * - anything else, and anything behind the lock, in plain words.
 */
export function OutcomeCard({ s }: { s: WebchatRingState }) {
  const o = s.outcome;
  const visitor = o?.visitor ?? text('The visitor');
  if (o && !s.hidden && o.kind === 'joined' && o.by) {
    return (
      <section role="status" aria-label={text('How the ring ended')} className="drag flex items-center gap-3 bg-[#111B3B] px-3.5 py-3 text-[14px] text-[#F1F4FB]">
        <Avatar name={o.by} size={34} />
        <span className="min-w-0 flex-1">
          <b>{firstName(o.by)}</b> {text('joined the chat with {visitor}', { visitor })}
        </span>
        <button type="button" onClick={() => outcomeAction('view')} className="no-drag shrink-0 text-[13px] font-bold text-[#B3C0FF] hover:text-white">
          {text('View')}
        </button>
      </section>
    );
  }
  if (o && !s.hidden && o.kind === 'late' && o.by) {
    return (
      <section role="status" aria-label={text('How the ring ended')} className="drag border border-[#F0D08F] bg-[#FDF4E3] px-3.5 py-3 text-[14px] text-[#6B4A10]">
        {text('You pressed Join a moment late —')} <b>{firstName(o.by)}</b> {text('already has this chat.')}
      </section>
    );
  }
  if (o && !s.hidden && o.kind === 'visitor_left') {
    const detail = !o.missed ? text('Ringing stopped.') : o.email ? text('Ringing stopped. The chat is in Missed chats with the email they left: {email}', { email: o.email }) : text('Ringing stopped. The chat is in Missed chats.');
    return (
      <section role="status" aria-label={text('How the ring ended')} className="flex flex-col gap-2 border border-[#E4E6ED] bg-white px-3.5 py-3 text-[#161A2C]">
        <div className="drag flex items-center gap-2.5">
          <Icon name="logout" size={20} className="shrink-0 text-[#B7791F]" />
          <span className="min-w-0 flex-1 text-[14px]">
            <b>{text('{visitor} left the site', { visitor })}</b> {text('before anyone joined')}
          </span>
        </div>
        <p className="drag text-[13px] text-[#4E5469]">{detail}</p>
        <div className="flex gap-2">
          {o.missed ? (
            <button type="button" onClick={() => outcomeAction('missed')} className="h-[34px] rounded-[8px] bg-[#273498] px-3.5 text-[13px] font-bold text-white hover:bg-[#1B2570]">
              {text('Open in Missed')}
            </button>
          ) : null}
          <button type="button" onClick={() => outcomeAction('dismiss')} className="h-[34px] rounded-[8px] border border-[#E4E6ED] bg-white px-3.5 text-[13px] font-semibold text-[#161A2C] hover:bg-[#F4F5F9]">
            {text('Dismiss')}
          </button>
        </div>
      </section>
    );
  }
  if (o && !s.hidden && o.kind === 'visitor_ended') {
    return (
      <section role="status" aria-label={text('How the ring ended')} className="drag border border-[#E4E6ED] bg-white px-3.5 py-3 text-[14px] text-[#161A2C]">
        <b>{text('{visitor} ended the chat.', { visitor })}</b> <span className="text-[#6B7083]">{text('Ringing stopped.')}</span>
      </section>
    );
  }
  return (
    <div className="drag flex min-h-[72px] items-center gap-3 bg-[#0F1B3D] px-4 py-4 text-[13px] text-[#E6ECFA]" role="status" aria-live="polite">
      <Icon name="check-circle" size={18} className="shrink-0 text-[#3DD68C]" />
      <span className="min-w-0 flex-1">{o?.text ?? 'Nothing is ringing.'}</span>
    </div>
  );
}

/** The follow-up card's actions (worksuite-desktop#230), in the main process. */
async function followUp(id: number, action: 'reply' | 'open' | 'snooze' | 'takeOver', message?: string): Promise<boolean> {
  try {
    const r = await call('ring:followUp', { id, action, ...(message ? { message } : {}) });
    if (!r.ok && r.why) toast('error', r.why);
    return r.ok;
  } catch (e) {
    toast('error', errorMessage(e));
    return false;
  }
}

/** What the card says it is: the visitor wrote, they still wait, or the team was alerted. */
export function followUpStatus(f: Pick<WebchatFollowUp, 'stage' | 'mine' | 'agent' | 'count'>): string {
  if (f.stage === 'team') return f.mine ? 'Still no reply · the team was alerted' : `Team alert · ${f.agent ? `${f.agent}'s chat` : 'no reply yet'}`;
  if (f.stage === 'reminder') return 'Reminder · the visitor is still waiting';
  return f.count > 1 ? `Visitor replied · ${f.count} new messages` : 'Visitor replied';
}

/**
 * A visitor wrote again in my chat while I was away from it (worksuite-desktop#230): who and where, their new message
 * with the one or two before it, how long they have waited, a reply box that sends without leaving what I am doing,
 * Open chat and Snooze 5 min. A colleague's chat the team was alerted about has Take over instead of the reply box.
 * Several: the longest waiting as this card, the others as rows under it.
 */
export function FollowUpCard({ s, f, rest, now }: { s: WebchatRingState; f: WebchatFollowUp; rest: WebchatFollowUp[]; now: number }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const theirs = !f.mine && f.stage === 'team';
  const lastSaid = [...f.recent].reverse().find((m) => m.from === 'visitor')?.body ?? null;
  const send = async () => {
    if (busy || !draft.trim()) return;
    setBusy(true);
    const ok = await followUp(f.id, 'reply', draft.trim());
    setBusy(false);
    if (ok) setDraft('');
  };
  return (
    <Frame
      dot={f.stage === 'replied' ? 'ringing' : 'silenced'}
      status={followUpStatus(f)}
      badge={<Badge tone={f.stage === 'team' ? 'red' : 'green'}>{f.mine ? 'Your chat' : 'Team'}</Badge>}
      hint={s.outcome ? s.outcome.text : 'Enter sends · Esc minimises · the card goes when someone answers'}
    >
      <div className="sr-only" role="alert" aria-live="assertive">
        {s.hidden ? 'A website visitor is waiting for a reply.' : `${f.visitor}${f.site ? ` on ${f.site}` : ''} wrote again and is waiting for a reply.`}
      </div>
      <Visitor c={{ visitor: f.visitor, site: f.site, place: null, device: null, since: f.since }} now={now} hidden={s.hidden} />
      {!s.hidden && f.recent.length ? (
        <div className="flex flex-col gap-2 px-4 pb-1" aria-label="Latest messages">
          {f.recent.map((m, i) => (m.from === 'visitor' ? <Theirs key={i} text={m.body} /> : <Mine key={i} text={m.body} last={false} />))}
        </div>
      ) : null}
      {!s.hidden && !theirs ? (
        <div className="px-4 pt-2.5">
          <ReplyBox id={`followup-reply-${f.id}`} label={`Reply to ${f.visitor}`} placeholder="Type a reply" sendLabel="Send" draft={draft} setDraft={setDraft} onSend={() => void send()} busy={busy} visitorSaid={lastSaid} />
        </div>
      ) : null}
      <div className="flex gap-2 px-4 pt-3">
        {theirs ? (
          <button type="button" disabled={s.hidden} onClick={() => void followUp(f.id, 'takeOver')} className="flex h-11 flex-[1.4] items-center justify-center gap-2 rounded-[11px] bg-[#22A35A] text-[14px] font-bold text-white hover:brightness-110 disabled:opacity-50">
            <Icon name="chat" size={16} />
            Take over
          </button>
        ) : null}
        <button type="button" disabled={s.hidden} onClick={() => void followUp(f.id, 'open')} className={cx('flex h-11 flex-1 items-center justify-center gap-2 rounded-[11px] text-[13px] font-semibold disabled:opacity-50', theirs ? 'border border-white/14 hover:bg-white/7' : 'bg-[#4F5FEF] text-white hover:brightness-110')}>
          Open chat
        </button>
        <button type="button" onClick={() => void followUp(f.id, 'snooze')} className="h-11 flex-1 rounded-[11px] border border-white/14 text-[13px] font-semibold hover:bg-white/7">
          Snooze 5 min
        </button>
      </div>
      {rest.length ? (
        <ul className="mt-3 flex flex-col border-t border-white/10" aria-label="Other visitors waiting for you">
          {rest.slice(0, 3).map((x) => (
            <li key={x.id} className="flex h-[44px] items-center gap-2 border-b border-white/10 px-4">
              <span className="min-w-0 flex-1 truncate">
                <b className="text-white">{s.hidden ? 'A visitor' : x.visitor}</b>
                <span className="text-[#AEB3D1]">{s.hidden ? '' : ` · ${[...x.recent].reverse().find((m) => m.from === 'visitor')?.body ?? 'wrote again'}`}</span>
              </span>
              <span className="shrink-0 font-mono text-[12px] text-[#F2B77E]">{waited(x.since, now)}</span>
              <button type="button" disabled={s.hidden} onClick={() => void followUp(x.id, 'open')} className="h-8 rounded-[7px] bg-white/10 px-2.5 text-[12px] font-bold text-white hover:bg-white/15 disabled:opacity-50">
                Open
              </button>
            </li>
          ))}
          {rest.length > 3 ? <li className="px-4 py-1.5 text-[11.5px] text-[#AEB3D1]">+{rest.length - 3} more waiting for you</li> : null}
        </ul>
      ) : null}
    </Frame>
  );
}
