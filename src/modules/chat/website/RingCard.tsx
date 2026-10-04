import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { WebchatFollowUp, WebchatJoined, WebchatRingChat, WebchatRingState } from '@shared/types';
import { call, errorMessage, isMac } from '../../../core/bridge';
import { toast } from '../../../core/toasts';
import { Avatar, cx } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { write, writerProblem, useWriter } from '../../ai/writer';
import { useCanned } from './api';
import { text } from '../../../core/i18n';
import { clock, firstName, handoverIn, ringsFor, silencedFor, stageLabel, stepLabel, visitLabel, waited, youJoinedLine } from './Ringing';

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

/** The window takes the card's height. */
export function useFit(): (el: HTMLDivElement | null) => void {
  const observer = useRef<ResizeObserver | null>(null);
  useEffect(() => () => observer.current?.disconnect(), []);
  return (el) => {
    observer.current?.disconnect();
    if (!el || typeof ResizeObserver === 'undefined') return;
    const report = () => void call('ring:fit', { height: Math.max(80, Math.min(1200, Math.ceil(el.getBoundingClientRect().height))) }).catch(() => undefined);
    observer.current = new ResizeObserver(report);
    observer.current.observe(el);
    report();
  };
}

const minimise = () => void call('ring:minimise').catch(() => undefined);

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

function Badge({ tone, children }: { tone: keyof typeof BADGE; children: ReactNode }) {
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
function ReplyBox({ id, label, placeholder, sendLabel, draft, setDraft, onSend, busy, visitorSaid, disabled }: {
  id: string; label: string; placeholder: string; sendLabel: string; draft: string; setDraft: (v: string) => void; onSend: () => void; busy: boolean; visitorSaid: string | null; disabled?: boolean;
}) {
  const writer = useWriter();
  const canWrite = !!writer.data?.available && writer.data.actions.some((a) => a.key === 'reply') && !!visitorSaid;
  const [thinking, setThinking] = useState(false);
  const ai = async () => {
    if (!visitorSaid || thinking) return;
    setThinking(true);
    try {
      setDraft(await write('reply', `Visitor: ${visitorSaid}`));
    } catch (e) {
      toast('error', writerProblem(e));
    } finally {
      setThinking(false);
    }
  };
  const ready = !!draft.trim() && !busy && !disabled;
  return (
    <div className={cx('flex items-center gap-1.5 rounded-[12px] border bg-[#0E1231] py-1 pr-1 pl-3', draft ? 'border-[#6676FF]' : 'border-white/10')}>
      <label htmlFor={id} className="sr-only">{label}</label>
      <input
        id={id}
        type="text"
        value={draft}
        disabled={disabled}
        maxLength={4000}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (ready) onSend();
          }
        }}
        placeholder={placeholder}
        className="h-[38px] min-w-0 flex-1 bg-transparent text-[14px] text-[#E6E8F5] outline-none placeholder:text-[#8C92B5]"
      />
      {canWrite ? (
        <button type="button" aria-label="Write with AI" title="Write a reply with AI" disabled={thinking || disabled} onClick={() => void ai()} className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] text-[#AEB8FF] hover:bg-white/7 disabled:opacity-50">
          <Icon name={thinking ? 'spinner' : 'sparkles'} size={16} className={cx(thinking && 'animate-spin')} />
        </button>
      ) : null}
      <button type="button" disabled={!ready} onClick={onSend} className={cx('flex h-[38px] items-center gap-1.5 rounded-[9px] px-3 text-[13px] font-semibold text-white', ready ? 'bg-[#4F5FEF] hover:brightness-110' : 'bg-[#3A4170] text-white/70')}>
        <Icon name="send" size={15} />
        {sendLabel}
      </button>
    </div>
  );
}

/** Quick replies: the team's most used saved replies, or three plain ones; a click puts one in the box. */
function Chips({ pick, enabled }: { pick: (text: string) => void; enabled: boolean }) {
  const canned = useCanned(enabled);
  const chips = (canned.data?.responses ?? []).slice(0, 3).map((r) => ({ label: r.title || r.body, text: r.body }));
  const list = chips.length ? chips : QUICK.map((t) => ({ label: t, text: t }));
  return (
    <div className="flex flex-wrap gap-1.5 px-4 pt-1.5" role="group" aria-label="Quick replies">
      {list.map((c) => (
        <button key={c.label} type="button" onClick={() => pick(c.text)} className="h-[30px] max-w-full truncate rounded-full border border-white/14 bg-white/[.04] px-[11px] text-[12px] font-medium text-[#E6E8F5] hover:bg-white/10">
          {c.label}
        </button>
      ))}
    </div>
  );
}

/** Join chat and Join & send: one request, first come; a moment too late, the card says who has it. */
async function joinSend(id: number, message?: string): Promise<boolean> {
  try {
    const r = await call('ring:joinSend', { id, ...(message ? { message } : {}) });
    return r.ok;
  } catch (e) {
    toast('error', errorMessage(e));
    return false;
  }
}

const silence = (id: number, on: boolean) => void call('ring:silence', { id, on }).catch(() => undefined);

/** One chat ringing (#225, design 1). */
export function RingCard({ s, c, now, after }: { s: WebchatRingState; c: WebchatRingChat; now: number; after?: ReactNode }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const joinKey = isMac ? '⌘⇧J' : 'Ctrl+Shift+J';
  const handover = c.mine ? handoverIn(c.handoverAt, now) : null;
  const send = async (withText: boolean) => {
    if (busy) return;
    setBusy(true);
    const ok = await joinSend(c.id, withText ? draft.trim() : undefined);
    setBusy(false);
    if (ok) setDraft('');
  };
  // "Rings until someone joins" is the footer's now (R-01), beside how many others it rings for.
  const hint = s.outcome ? s.outcome.text : s.elsewhere ? 'Ringing on your other device — shown here without sound' : `Enter sends and joins${s.shortcut ? ` · ${joinKey} join` : ''} · Esc minimises`;
  const others = s.chats.length - 1;
  return (
    <Frame
      dot={c.silenced ? 'silenced' : 'ringing'}
      status={c.silenced ? 'Incoming website chat · silenced' : 'Incoming website chat'}
      hint={hint}
      after={after}
      footer={
        <>
          {/* The footer (R-01, RING-UI-01; RING-23): it rings until someone joins, for how many others, and +N waiting. */}
          <div className="drag flex items-center justify-between gap-3 bg-[#0C1430] px-4 py-2.5 text-[12px] text-[#9AA3C4]">
            <span className="min-w-0 truncate">{ringsFor(c)}</span>
            {others > 0 ? (
              <button type="button" onClick={() => void call('ring:openInbox').catch(() => undefined)} className="no-drag shrink-0 font-bold text-[#B3C0FF] hover:text-white">
                {text('+{n} waiting', { n: others })}
              </button>
            ) : null}
          </div>
        </>
      }
    >
      <div className="sr-only" role="alert" aria-live="assertive">
        {s.hidden ? 'A website chat is waiting.' : `Website chat: ${c.visitor}${c.site ? ` on ${c.site}` : ''} is waiting.`}
      </div>
      <Visitor c={c} now={now} hidden={s.hidden} pulse={!c.silenced} chips={<RingChips c={c} />} />
      {!s.hidden && c.page ? <Reading page={c.page} /> : null}
      {!s.hidden && c.preview ? (
        <div className="flex flex-col gap-2 px-4 pt-3 pb-1">
          <Theirs text={c.preview} />
        </div>
      ) : null}
      {c.mine && c.by ? <p className="px-4 pt-1 text-[11.5px] text-[#AEB3D1]">Assigned to you by {c.by}</p> : null}
      {!s.hidden ? (
        <>
          <Chips pick={setDraft} enabled={!s.hidden} />
          <div className="px-4 pt-2.5">
            <ReplyBox id={`ring-reply-${c.id}`} label="Reply to visitor" placeholder="Type a reply to join and send" sendLabel="Join & send" draft={draft} setDraft={setDraft} onSend={() => void send(true)} busy={busy} visitorSaid={c.preview} />
          </div>
        </>
      ) : null}
      <div className="flex gap-2 px-4 pt-3">
        <button type="button" disabled={s.hidden || busy} onClick={() => void send(false)} className="flex h-11 flex-[1.4] items-center justify-center gap-2 rounded-[11px] bg-[#22A35A] text-[14px] font-bold text-white hover:brightness-110 disabled:opacity-50">
          <Icon name="chat" size={16} />
          Join chat
        </button>
        {c.mine ? (
          <button type="button" disabled={s.hidden} onClick={() => void call('ring:join', { id: c.id, then: 'transfer' }).catch((e) => toast('error', errorMessage(e)))} className="h-11 flex-1 rounded-[11px] border border-white/14 text-[13px] font-semibold hover:bg-white/7 disabled:opacity-50">
            Transfer
          </button>
        ) : null}
        {/* Silence in words, as the design has it (R-01): a personal mute on all my devices until at risk (RING-11). */}
        <button
          type="button"
          aria-label={c.silenced ? 'Unsilence ringing' : 'Silence ringing'}
          aria-pressed={c.silenced}
          title={c.silenced ? 'Unsilence ringing' : 'Silence ringing'}
          onClick={() => silence(c.id, !c.silenced)}
          className={cx('flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-[11px] border border-white/14 px-3 text-[13px] font-semibold hover:bg-white/7', c.silenced && 'bg-white/10')}
        >
          <Icon name="bell-off" size={16} />
          {/* Taken back in R-04's word: Unsilence. */}
          {c.silenced ? text('Unsilence') : text('Silence')}
        </button>
      </div>
      {handover !== null ? (
        // A chat given to me passes on if I do not join it in time (RING-UI-02): the same countdown as in the stack.
        <div className="px-4 pt-2.5">
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
    </Frame>
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
  const [draft, setDraft] = useState('');
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
      {s.outcome ? <p className="px-1 text-[11.5px] text-[#AEB3D1]">{s.outcome.text}</p> : null}
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
        <span className="min-w-0 flex-1">{s.outcome ? s.outcome.text : text('It rings for you again if it becomes at risk.')}</span>
        {others > 0 ? (
          <button type="button" onClick={() => void call('ring:openInbox').catch(() => undefined)} className="no-drag shrink-0 font-bold text-[#B3C0FF] hover:text-white">
            {text('+{n} waiting', { n: others })}
          </button>
        ) : null}
      </p>
    </section>
  );
}

const outcomeAction = (action: 'view' | 'missed' | 'dismiss') => void call('ring:outcome', { action }).catch(() => undefined);

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
