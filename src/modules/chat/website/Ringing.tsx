import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { WebchatCall, WebchatHandoff, WebchatRingChat, WebchatRingState } from '@shared/types';
import { call, errorMessage, isMac, on } from '../../../core/bridge';
import { parseTs } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Avatar, cx } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { useNow } from '../../calls/parts';
import { playOnce, playTone } from '../../calls/tones';
import { FollowUpCard, JoinedCard, RingCard, RingStack, followUpStatus, useFit } from './RingCard';

/**
 * Website chats ringing like calls (WS-WCHAT ENH-01): the native call window
 * over other apps (RING-UI-06), and the bar under the main window's tabs
 * (RING-45). What rings, and for whom, is the main process's (WebchatRinger);
 * these only show it, play the tone, and pass on Join and Silence.
 */

const EMPTY: WebchatRingState = { chats: [], tone: 'off', volume: 80, outcome: null, hidden: false, shortcut: false };

export function useRingState(): WebchatRingState {
  const [s, setS] = useState<WebchatRingState>(EMPTY);
  useEffect(() => {
    let live = true;
    void call('ring:state').then(
      (x) => live && setS(x),
      () => undefined,
    );
    const off = on<WebchatRingState>('ring:changed', (x) => setS(x));
    return () => {
      live = false;
      off();
    };
  }, []);
  return s;
}

/** Plays the tone while the state says so, at the person's volume (RING-21). */
export function useRingTone(s: WebchatRingState, enabled = true): void {
  const kind = enabled ? s.tone : 'off';
  const volume = s.volume / 100;
  useEffect(() => {
    if (kind === 'off') return;
    const t = playTone(kind === 'strong' ? 'webchat-strong' : 'webchat', volume);
    return () => t.stop();
  }, [kind, volume]);
}

/**
 * The "visitor replied" chime (worksuite-desktop#230): once each time the ringer says so — it has already weighed my
 * sound setting, Do not disturb and the volume. Played by the main window only, so it never sounds twice.
 */
export function useFollowUpChime(s: WebchatRingState): void {
  const chime = s.chime;
  const volume = s.volume / 100;
  // The first state from the main process is where we start: nothing plays for chimes from before this window opened.
  const heard = useRef<number | null>(null);
  useEffect(() => {
    if (chime === undefined) return;
    if (heard.current !== null && chime > heard.current) playOnce('reply', volume);
    heard.current = chime;
  }, [chime, volume]);
}

export function waited(since: string, now: number): string {
  const s = Math.max(0, Math.round((now - parseTs(since).getTime()) / 1000));
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Which step of the ladder reached me, in words (RING-06). */
export function stageLabel(c: Pick<WebchatRingChat, 'atRisk' | 'mine' | 'stage' | 'offline'>): string {
  if (c.atRisk) return 'At risk';
  if (c.mine) return 'Assigned to you';
  if (c.offline) return 'Offline enquiry';
  switch (c.stage) {
    case 'priority':
      return 'Priority staff';
    case 'everyone':
    case 'released':
      return 'Everyone';
    case 'supervisor':
      return 'Supervisors';
    default:
      return 'New chat';
  }
}

const join = (id: number) =>
  void call('ring:join', { id }).catch((e) => toast('error', errorMessage(e)));
const silence = (id: number, onOff: boolean) => void call('ring:silence', { id, on: onOff }).catch(() => undefined);
const answer = (id: number, accept: boolean) => void call('ring:handoff', { id, accept }).catch((e) => toast('error', errorMessage(e)));
const answerCall = (id: number, accept: boolean) => void call('ring:call', { id, accept }).catch((e) => toast('error', errorMessage(e)));

/** What a handoff card is called (TEAM-UI-02): an INVITATION, or a TRANSFER TO YOU. */
export function handoffTitle(h: Pick<WebchatHandoff, 'kind'>): string {
  return h.kind === 'invite' ? 'Invitation' : 'Transfer to you';
}

/** Who asks, and for what, in a line. */
export function handoffAsk(h: Pick<WebchatHandoff, 'kind' | 'mode' | 'from' | 'department' | 'toAny'>): string {
  const who = h.from ?? 'WorkSuite';
  const to = h.department ? ` (the ${h.department} team)` : '';
  if (h.kind === 'invite') return `${who} invites you to join${to}`;
  if (h.toAny && !h.from) return 'Nobody took this chat — it needs someone';
  return h.mode === 'cold' ? `${who} handed this chat over${to}` : `${who} asks you to take over${to}`;
}

/** "Nuwan" for "Nuwan Silva": the cards speak of a colleague the way the design does (C-09). */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/**
 * The card's headline (C-09, TEAM-UI-02): "Nuwan invites you to a chat with Visitor 4F2A", "Nuwan is handing you
 * Visitor 4F2A"; a chat nobody took, or an owner who went offline, is WorkSuite's, with nobody named.
 */
export function handoffHeadline(h: Pick<WebchatHandoff, 'kind' | 'from' | 'toAny' | 'visitor'>, hidden = false): string {
  const visitor = hidden ? 'a website visitor' : h.visitor;
  const who = h.from ? firstName(h.from) : null;
  if (h.kind === 'invite') return `${who ?? 'WorkSuite'} invites you to a chat with ${visitor}`;
  if (who) return `${who} is handing you ${visitor}`;
  return h.toAny ? `${hidden ? 'A website visitor' : h.visitor} needs someone — nobody took the chat` : `You're asked to take over ${visitor}`;
}

/**
 * What else the card says, under the note (C-09; TEAM-25, TEAM-41, TEAM-42): warm or handed over now, and a department
 * that is asked as one — the first to answer takes it.
 */
export function handoffDetail(h: Pick<WebchatHandoff, 'kind' | 'mode' | 'from' | 'toAny' | 'department'>): string | null {
  const who = h.from ? firstName(h.from) : null;
  const team = h.department ? `Sent to the ${h.department} team — the first to ${h.kind === 'invite' ? 'join' : 'accept'} takes it` : null;
  if (h.kind === 'invite') return team;
  const mode = h.mode === 'cold'
    ? who ? `Handed over now — ${who} has left; it rings for you until you join` : 'It rings for everybody covering the website until someone joins'
    : who ? `Warm transfer — ${who} stays until you join` : 'Warm transfer — nothing changes until you accept';
  return team ? `${mode} · ${team}` : mode;
}

/**
 * Seconds left on an invitation or transfer ringing for me, or null when it rings until somebody takes it: by the
 * server's count when it gave one (C-09), so a computer whose clock is off still counts down true.
 */
export function handoffLeft(h: Pick<WebchatHandoff, 'expiresAt' | 'endsAt'>, now: number): number | null {
  // Only what reads as a time: a state of another shape (an older main process) shows no countdown rather than throwing.
  const ends = typeof h.endsAt === 'number' ? h.endsAt : typeof h.expiresAt === 'string' && h.expiresAt ? parseTs(h.expiresAt).getTime() : null;
  return ends === null || !Number.isFinite(ends) ? null : Math.max(0, Math.round((ends - now) / 1000));
}

/** m:ss for a count of seconds. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Seconds until a chat given to me passes on, or null when it does not (RING-05, RING-12). */
export function handoverIn(handoverAt: string | null | undefined, now: number): number | null {
  if (!handoverAt) return null;
  return Math.max(0, Math.round((parseTs(handoverAt).getTime() - now) / 1000));
}

/**
 * The call window (RING-UI-06, RING-23): the top chat as a card — who, where,
 * what they are reading and asked, how long, Join and Silence — and the
 * others under it with their own Join. It never takes the keyboard; it is
 * announced once through a live region.
 */
export function WebchatRingWindow() {
  const s = useRingState();
  const now = useNow();
  useRingTone(s);
  // The window is as tall as what it shows (#225): measured here, once, whichever card that is.
  const fit = useFit();
  const top = s.chats[0];
  const handoffs = s.handoffs ?? [];
  const [firstCall, ...otherCalls] = s.calls ?? [];
  // Invitations and transfers ringing beside chats, under the chat card.
  const asks = handoffs.length && top ? <HandoffRows s={s} list={handoffs.slice(0, 2)} more={handoffs.length - 2} now={now} first /> : null;

  let body: ReactNode;
  // A visitor on the line comes before everything else (VOICE-10).
  if (firstCall) body = <CallCard s={s} c={firstCall} rest={otherCalls} more={s.chats.length + handoffs.length} now={now} />;
  // One chat: the full card with its reply box; several: a compact card each (#225).
  else if (top) body = s.chats.length > 1 ? <RingStack s={s} chats={s.chats} now={now} after={asks} /> : <RingCard s={s} c={top} now={now} after={asks} />;
  else if (handoffs[0]) body = <HandoffCard s={s} h={handoffs[0]} rest={handoffs.slice(1)} now={now} />;
  // A chat just joined from the card: a mini chat until the full chat is opened or the card minimised (#225).
  else if (s.joined) body = <JoinedCard j={s.joined} now={now} />;
  // A visitor who wrote again in my chat while I was away from it (#230).
  else if (s.followUps?.[0]) body = <FollowUpCard s={s} f={s.followUps[0]} rest={s.followUps.slice(1)} now={now} />;
  else {
    body = (
      <div className="drag flex min-h-[72px] items-center gap-3 bg-[#0F1B3D] px-4 py-4 text-[13px] text-[#E6ECFA]" role="status" aria-live="polite">
        <Icon name="check-circle" size={18} className="shrink-0 text-[#3DD68C]" />
        <span className="min-w-0 flex-1">{s.outcome?.text ?? 'Nothing is ringing.'}</span>
      </div>
    );
  }
  return <div ref={fit}>{body}</div>;
}

/**
 * A visitor's voice call as the call window's card (VOICE-UI-03): who, where, what they last wrote, how long they
 * have waited, and Answer or Decline. Answering brings WorkSuite forward on the chat, on the call.
 */
function CallCard({ s, c, rest, more, now }: { s: WebchatRingState; c: WebchatCall; rest: WebchatCall[]; more: number; now: number }) {
  const answerKey = isMac ? '⌘⇧A' : 'Ctrl+Shift+A';
  return (
    <div className="flex h-full flex-col bg-[#0F1B3D] text-[13px] text-[#E6ECFA]">
      <div className="sr-only" role="alert" aria-live="assertive">
        {s.hidden ? 'A website visitor is calling.' : `Voice call: ${c.visitor}${c.site ? ` on ${c.site}` : ''} is calling.`}
      </div>
      <div className="drag flex items-center gap-2 px-4 pt-3 text-[11.5px] font-bold tracking-[.06em] text-[#8FE3B7] uppercase">
        <span className="h-2 w-2 rounded-full bg-[#3DD68C] motion-safe:animate-pulse" />
        <span className="flex-1">Incoming voice call</span>
        <span className="rounded-full bg-[#1C3A2E] px-2 py-0.5 text-[10.5px] tracking-normal text-[#8FE3B7] normal-case">{c.stage === 'first' ? 'Your chat' : 'Everyone'}</span>
      </div>
      <div className="flex gap-3 px-4 pt-3">
        <span className="relative shrink-0 rounded-full motion-safe:[animation:ws-ring-pulse_1.6s_ease-out_infinite]">
          <Avatar name={s.hidden ? '?' : c.visitor} size={46} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <b className="truncate text-[15px] text-white">{s.hidden ? 'A website visitor' : c.visitor}</b>
          <span className="truncate text-[12px] text-[#AFC0E8]">{s.hidden ? 'Unlock WorkSuite to see who.' : [c.site, c.place, c.owner ? `With ${c.owner}` : null].filter(Boolean).join(' · ') || 'Website voice call'}</span>
          {!s.hidden && c.page ? <span className="truncate text-[12px] text-[#C9D5F5]">Reading {c.page}</span> : null}
        </span>
        {c.requestedAt ? (
          <span className="shrink-0 font-mono text-[12px] text-[#AFC0E8]" aria-label={`Calling for ${waited(c.requestedAt, now)}`}>
            {waited(c.requestedAt, now)}
          </span>
        ) : null}
      </div>
      {!s.hidden && c.preview ? <p className="mx-4 mt-2 line-clamp-2 rounded-[8px] bg-[#16254F] px-2.5 py-1.5 text-[12.5px] text-[#E6ECFA]">“{c.preview}”</p> : null}
      <div className="flex gap-2 px-4 pt-3">
        <button type="button" disabled={s.hidden} onClick={() => answerCall(c.id, true)} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-[9px] bg-[#3DD68C] text-[14px] font-bold text-[#0B2A1D] hover:brightness-105 disabled:opacity-50">
          <Icon name="phone" size={16} />
          Answer
        </button>
        <button type="button" onClick={() => answerCall(c.id, false)} className="h-11 flex-1 rounded-[9px] bg-[#C2412D] text-[14px] font-bold text-white hover:brightness-110">
          Decline
        </button>
      </div>
      {rest.length ? (
        <ul className="mt-3 flex flex-col border-t border-[#22305C]" aria-label="Other calls">
          {rest.slice(0, 3).map((x) => (
            <li key={`c${x.id}`} className="flex h-[46px] items-center gap-2 border-b border-[#22305C] px-4">
              <Icon name="phone" size={13} className="shrink-0 text-[#8FE3B7]" />
              <span className="min-w-0 flex-1 truncate">
                <b className="text-white">{s.hidden ? 'A visitor' : x.visitor}</b>
                <span className="text-[#AFC0E8]"> · Voice call{x.site && !s.hidden ? ` · ${x.site}` : ''}</span>
              </span>
              <button type="button" disabled={s.hidden} onClick={() => answerCall(x.id, true)} className="h-8 rounded-[7px] bg-[#22305C] px-2.5 text-[12px] font-bold text-white hover:bg-[#2B3C70] disabled:opacity-50">
                Answer
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="drag mt-auto px-4 pt-2 pb-2.5 text-[11px] text-[#8FA6E0]">
        {s.outcome ? s.outcome.text : s.elsewhere ? 'Ringing on your other device — shown here without sound' : `${more ? `${more} more waiting · ` : ''}Audio only, in WorkSuite${s.answerShortcut ? ` · ${answerKey} to answer` : ''}`}
      </p>
    </div>
  );
}

/**
 * An invitation or a transfer as the call window's card (C-09, TEAM-UI-02; TEAM-23, TEAM-41, TEAM-42): the call-style
 * card the design draws — INVITATION or TRANSFER TO YOU with its countdown, who asks for what, the staff-only note,
 * warm or handed over now, and Join chat or Accept beside Decline. Others ringing too are rows under it.
 */
export function HandoffCard({ s, h, rest, now }: { s: WebchatRingState; h: WebchatHandoff; rest: WebchatHandoff[]; now: number }) {
  const left = handoffLeft(h, now);
  const invite = h.kind === 'invite';
  const detail = s.hidden ? null : handoffDetail(h);
  return (
    <div className="flex h-full flex-col bg-[#111B3B] text-[13px] text-[#F1F4FB]">
      <div className="sr-only" role="alert" aria-live="assertive">
        {s.hidden ? 'A colleague is asking you into a website chat.' : `${handoffTitle(h)}: ${handoffHeadline(h)}.`}
      </div>
      <section aria-label={invite ? 'Invitation' : 'Transfer request'} className="flex flex-col gap-2.5 px-[18px] pt-4">
        <div className="drag flex items-center gap-2">
          <span className={cx('rounded-[6px] px-2 py-[3px] text-[11px] font-bold tracking-[1.2px] text-white uppercase', invite ? 'bg-[#1F7A6E]' : 'bg-[#4A63E8]')}>{handoffTitle(h)}</span>
          <span className="flex-1" />
          {left !== null ? (
            // "1:40 left" on an invitation, "0:48" on a transfer, as designed.
            <span role="timer" aria-label={`Rings for ${clock(left)} more`} className="font-mono text-[13px] text-[#C9CFE3] tabular-nums">{invite ? `${clock(left)} left` : clock(left)}</span>
          ) : null}
        </div>
        <b className="text-[16px] leading-snug font-bold text-white">{handoffHeadline(h, s.hidden)}</b>
        {!s.hidden && (h.site || h.page) ? <span className="-mt-1.5 truncate text-[12px] text-[#AFC0E8]">{[h.site, h.page ? `Reading ${h.page}` : null].filter(Boolean).join(' · ')}</span> : null}
        {!s.hidden && h.note ? (
          <p className="rounded-[10px] bg-[#1A2550] px-3 py-2.5 text-[13px] break-words text-[#DFE3F0]" title="Only staff see this note">{invite ? `“${h.note}”` : h.note}</p>
        ) : null}
        {detail ? <span className="text-[12px] text-[#B3C0FF]">{detail}</span> : null}
        <div className="flex gap-2.5">
          <button type="button" disabled={s.hidden} onClick={() => answer(h.id, true)} className="h-11 flex-1 rounded-full bg-[#2F9E67] text-[15px] font-bold text-white hover:brightness-110 disabled:opacity-50">
            {invite ? 'Join chat' : 'Accept'}
          </button>
          <button type="button" onClick={() => answer(h.id, false)} className="h-11 w-[116px] shrink-0 rounded-full border border-[#3A4468] font-semibold text-[#F1F4FB] hover:bg-white/5">
            Decline
          </button>
        </div>
      </section>
      {rest.length ? <HandoffRows s={s} list={rest.slice(0, 3)} more={rest.length - 3} now={now} first /> : null}
      <p className="drag mt-auto px-[18px] pt-2.5 pb-3 text-[11px] text-[#8FA6E0]">{s.outcome ? s.outcome.text : s.elsewhere ? 'Ringing on your other device — shown here without sound' : 'A colleague is asking you into a website chat'}</p>
    </div>
  );
}

/** Other invitations and transfers, under the card, each with Join and Decline. */
function HandoffRows({ s, list, more, first, now }: { s: WebchatRingState; list: WebchatHandoff[]; more: number; first: boolean; now?: number }) {
  return (
    <ul className={cx('flex flex-col', first ? 'mt-3 border-t border-[#22305C]' : '')} aria-label="Invitations and transfers">
      {list.map((h) => (
        <li key={`h${h.id}`} className="flex h-[46px] items-center gap-2 border-b border-[#22305C] px-4">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#8FA6E0]" />
          <span className="min-w-0 flex-1 truncate">
            <b className="text-white">{s.hidden ? 'A visitor' : h.visitor}</b>
            <span className="text-[#AFC0E8]"> · {handoffTitle(h)}{h.from && !s.hidden ? ` from ${h.from}` : ''}</span>
          </span>
          {now !== undefined && handoffLeft(h, now) !== null ? <span className="shrink-0 font-mono text-[12px] text-[#C9CFE3] tabular-nums">{clock(handoffLeft(h, now)!)}</span> : null}
          <button type="button" disabled={s.hidden} onClick={() => answer(h.id, true)} className="h-8 rounded-[7px] bg-[#22305C] px-2.5 text-[12px] font-bold text-white hover:bg-[#2B3C70] disabled:opacity-50">
            {h.kind === 'invite' ? 'Join' : 'Accept'}
          </button>
          <button type="button" aria-label={`Decline ${handoffTitle(h).toLowerCase()} for ${s.hidden ? 'a visitor' : h.visitor}`} onClick={() => answer(h.id, false)} className="h-8 rounded-[7px] px-2 text-[12px] font-semibold text-[#C9D5F5] hover:bg-white/5">
            Decline
          </button>
        </li>
      ))}
      {more > 0 ? <li className="px-4 py-1 text-[11.5px] text-[#AFC0E8]">+{more} more asking</li> : null}
    </ul>
  );
}

/**
 * The bar under the main window's tabs while a chat rings (RING-45), amber
 * when every chat ringing is silenced for me (RING-24). It plays the tone
 * itself only when the call window is off in Settings, so it never rings
 * twice.
 */
export function RingingBar({ tone }: { tone: boolean }) {
  const s = useRingState();
  const now = useNow();
  useRingTone(s, tone);
  useFollowUpChime(s);
  const [top] = s.chats;
  const h = s.handoffs?.[0];
  const [c] = s.calls ?? [];
  const f = s.followUps?.[0];
  if (c) {
    // A visitor calling (VOICE-10): before everything else.
    return (
      <div role="status" aria-label="Voice call ringing" className="flex h-9 shrink-0 items-center gap-2.5 border-b border-[#A9DDBF] bg-success-bg px-3.5 text-[12.5px] text-[#0F5132] dark:text-success">
        <Icon name="phone" size={15} className="shrink-0 motion-safe:animate-pulse" />
        <b className="shrink-0">Incoming voice call</b>
        <span className="min-w-0 flex-1 truncate">
          {s.hidden ? '' : `${c.visitor}${c.site ? ` · ${c.site}` : ''}`}
          {c.requestedAt ? ` · ${waited(c.requestedAt, now)}` : ''}
          {(s.calls?.length ?? 0) > 1 ? ` · +${(s.calls?.length ?? 0) - 1} more` : ''}
        </span>
        <button type="button" onClick={() => answerCall(c.id, true)} className="h-7 rounded-[7px] bg-[#1F7A4D] px-3 font-bold text-white hover:brightness-110">
          Answer
        </button>
        <button type="button" onClick={() => answerCall(c.id, false)} className="h-7 rounded-[7px] border border-current/30 px-2.5 font-semibold hover:bg-black/5">
          Decline
        </button>
      </div>
    );
  }
  if (!top && h) {
    // A colleague asking me in, with nothing else ringing (TEAM-23).
    return (
      <div role="status" aria-label="Website chat invitation" className="flex h-9 shrink-0 items-center gap-2.5 border-b border-[#C9D3F2] bg-selection px-3.5 text-[12.5px] text-ink">
        <Icon name="users" size={15} className="shrink-0 text-primary" />
        <b className="shrink-0">{handoffTitle(h)}</b>
        <span className="min-w-0 flex-1 truncate">{s.hidden ? '' : `${handoffAsk(h)} · ${h.visitor}`}{(s.handoffs?.length ?? 0) > 1 ? ` · +${(s.handoffs?.length ?? 0) - 1} more` : ''}</span>
        {handoffLeft(h, now) !== null ? <span className="shrink-0 font-mono text-[12px] text-ink-2 tabular-nums" aria-label={`Rings for ${clock(handoffLeft(h, now)!)} more`}>{clock(handoffLeft(h, now)!)}</span> : null}
        <button type="button" onClick={() => answer(h.id, true)} className="h-7 rounded-[7px] bg-[#1F7A4D] px-3 font-bold text-white hover:brightness-110">
          {h.kind === 'invite' ? 'Join chat' : 'Accept'}
        </button>
        <button type="button" onClick={() => answer(h.id, false)} className="h-7 rounded-[7px] border border-current/30 px-2.5 font-semibold hover:bg-black/5">
          Decline
        </button>
      </div>
    );
  }
  if (!top && f) {
    // A visitor who wrote again in my chat (#230): who, what, how long, Open chat and Snooze.
    const said = [...f.recent].reverse().find((m) => m.from === 'visitor')?.body;
    const more = (s.followUps?.length ?? 1) - 1;
    return (
      <div role="status" aria-label="Visitor waiting for your reply" className="flex h-9 shrink-0 items-center gap-2.5 border-b border-[#F2D39B] bg-warning-bg px-3.5 text-[12.5px] text-[#7A4308] dark:text-warning">
        <Icon name="chat" size={15} className="shrink-0" />
        <b className="shrink-0">{followUpStatus(f)}</b>
        <span className="min-w-0 flex-1 truncate">
          {s.hidden ? '' : `${f.visitor}${said ? `: “${said}”` : ''}`} · waiting {waited(f.since, now)}
          {more > 0 ? ` · +${more} more` : ''}
        </span>
        {!f.mine && f.stage === 'team' ? (
          <button type="button" onClick={() => void call('ring:followUp', { id: f.id, action: 'takeOver' }).catch((e) => toast('error', errorMessage(e)))} className="h-7 rounded-[7px] bg-[#1F7A4D] px-3 font-bold text-white hover:brightness-110">
            Take over
          </button>
        ) : null}
        <button type="button" onClick={() => void call('ring:followUp', { id: f.id, action: 'open' }).catch((e) => toast('error', errorMessage(e)))} className={cx('h-7 rounded-[7px] px-3 font-bold', !f.mine && f.stage === 'team' ? 'border border-current/30 hover:bg-black/5' : 'bg-primary text-white hover:bg-primary-hover')}>
          Open chat
        </button>
        <button type="button" onClick={() => void call('ring:followUp', { id: f.id, action: 'snooze' }).catch(() => undefined)} className="h-7 rounded-[7px] border border-current/30 px-2.5 font-semibold hover:bg-black/5">
          Snooze 5 min
        </button>
      </div>
    );
  }
  if (!top) return null;
  const all = s.chats.every((c) => c.silenced);
  const more = s.chats.length - 1;
  return (
    <div
      role="status"
      aria-label="Website chat ringing"
      className={cx('flex h-9 shrink-0 items-center gap-2.5 border-b px-3.5 text-[12.5px]', all ? 'border-[#F2D39B] bg-warning-bg text-[#7A4308] dark:text-warning' : 'border-[#F6C4B8] bg-danger-bg text-[#8C2A14] dark:text-danger')}
    >
      <Icon name={all ? 'bell-off' : 'bell'} size={15} className={cx('shrink-0', !all && 'motion-safe:animate-pulse')} />
      <b className="shrink-0">{all ? `${s.chats.length === 1 ? 'A chat' : `${s.chats.length} chats`} waiting · silenced for you` : 'Website chat ringing'}</b>
      <span className="min-w-0 flex-1 truncate">
        {s.hidden ? '' : `${top.visitor}${top.site ? ` · ${top.site}` : ''} · ${stageLabel(top)}`} · {waited(top.since, now)}
        {more > 0 ? ` · +${more} waiting` : ''}
      </span>
      <button type="button" onClick={() => join(top.id)} className="h-7 rounded-[7px] bg-[#1F7A4D] px-3 font-bold text-white hover:brightness-110">
        Join
      </button>
      <button type="button" onClick={() => silence(top.id, !top.silenced)} className="h-7 rounded-[7px] border border-current/30 px-2.5 font-semibold hover:bg-black/5">
        {top.silenced ? 'Unsilence' : 'Silence'}
      </button>
    </div>
  );
}
