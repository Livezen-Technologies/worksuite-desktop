import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { WebchatCall, WebchatHandoff, WebchatMic, WebchatReturnVisit, WebchatRingChat, WebchatRingState } from '@shared/types';
import { returningWords } from '@shared/website-returning';
import { call, errorMessage, isMac, on } from '../../../core/bridge';
import { parseTs, stampDayLabel } from '../../../core/time';
import { text } from '../../../core/i18n';
import { toast } from '../../../core/toasts';
import { cx } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { useNow } from '../../../components/CallKit';
import { playOnce, playTone } from '../../calls/tones';
import { FollowUpCard, JoinedCard, OutcomeCard, ParticipantCard, RingCard, RingStack, SilencedCard, WindowStrip, followUpStatus, useFit } from './RingCard';

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
      // A main process that has nothing to say (or an older one) leaves the empty state, never an unreadable one.
      (x) => live && x && Array.isArray(x.chats) && setS(x),
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

/** Plays the tone while the state says so, at the person's volume, in their ringtone, where they chose (RING-21, RING-42). */
export function useRingTone(s: WebchatRingState, enabled = true): void {
  const kind = enabled ? s.tone : 'off';
  const volume = s.volume / 100;
  const ringtone = s.ringtone ?? 'classic';
  const ringOn = s.ringOn ?? 'both';
  useEffect(() => {
    if (kind === 'off') return;
    const t = playTone(kind === 'strong' ? 'webchat-strong' : 'webchat', volume, { ringtone, ringOn });
    return () => t.stop();
  }, [kind, volume, ringtone, ringOn]);
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

/**
 * Where on the ladder it is, as the card's chip says it (R-01, R-02; RING-06): "Priority · step 1 of 3" — the first
 * step rings the priority agents who are free — then the rest of them, then everyone. Null where no step applies: a
 * chat given to me, an offline enquiry, at risk (its own red chip), or a supervisor told at risk.
 */
export function stepLabel(c: Pick<WebchatRingChat, 'atRisk' | 'mine' | 'stage' | 'offline'>): string | null {
  if (c.atRisk || c.mine || c.offline) return null;
  switch (c.stage) {
    case 'first':
    case null:
      return text('Priority · step {n} of 3', { n: 1 });
    case 'priority':
      return text('Priority · step {n} of 3', { n: 2 });
    case 'everyone':
    case 'released':
      return text('Everyone · step {n} of 3', { n: 3 });
    default:
      return null;
  }
}

/** "3rd visit" (R-01, RING-20), from the visitor's count of visits; null for a first visit or where it is not known. */
export function visitLabel(visits: number | null | undefined): string | null {
  if (!visits || visits < 2) return null;
  const tens = visits % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : visits % 10 === 1 ? 'st' : visits % 10 === 2 ? 'nd' : visits % 10 === 3 ? 'rd' : 'th';
  return text('{n} visit', { n: `${visits}${suffix}` });
}

/**
 * A returning visitor's line on the ringing card (worksuite-desktop#291): "Returning visitor · last chat with you on
 * 16 Aug" — with a colleague by first name, or only "· last chat on 16 Aug" when nobody had it. The ringer has said
 * whether the last chat was mine (`withYou`).
 */
export function returningLine(r: WebchatReturnVisit): string {
  return returningWords(r, null, (stamp) => stampDayLabel(stamp, 'short'), text);
}

/**
 * The card's footer line (R-01, RING-UI-01; RING-23): it rings until somebody joins, and for how many colleagues
 * besides me — none for a chat given to me, which rings for me alone (RING-05).
 */
export function ringsFor(c: Pick<WebchatRingChat, 'mine' | 'othersRinging'>): string {
  if (c.mine) return text('Rings for you until you join');
  const n = c.othersRinging;
  if (n === null || n === undefined) return text('Rings until someone joins');
  if (n === 0) return text('Rings until someone joins · only you');
  return n === 1 ? text('Rings until someone joins · 1 other ringing') : text('Rings until someone joins · {n} others ringing', { n });
}

/**
 * The silenced card's line (R-04, RING-UI-04; RING-11, RING-24): silenced for me alone — "still ringing for 2
 * colleagues" as the server counts them; just "Silenced for you" where it does not say, or nobody else is rung.
 */
export function silencedFor(c: Pick<WebchatRingChat, 'mine' | 'othersRinging'>): string {
  const n = c.othersRinging;
  if (c.mine || !n) return text('Silenced for you');
  return n === 1 ? text('Silenced for you · still ringing for 1 colleague') : text('Silenced for you · still ringing for {n} colleagues', { n });
}

/**
 * The line where I joined (R-03 "YOU JOIN"; RING-22, RING-28): "You joined the chat · ringing stopped for 2
 * colleagues" — only "You joined the chat" when it rang for nobody else, or that is not known.
 */
export function youJoinedLine(colleagues: number | null | undefined): string {
  if (!colleagues) return text('You joined the chat');
  return colleagues === 1 ? text('You joined the chat · ringing stopped for 1 colleague') : text('You joined the chat · ringing stopped for {n} colleagues', { n: colleagues });
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
export function handoffDetail(h: Pick<WebchatHandoff, 'kind' | 'mode' | 'from' | 'toAny' | 'department' | 'onCall'>): string | null {
  const who = h.from ? firstName(h.from) : null;
  const team = h.department ? `Sent to the ${h.department} team — the first to ${h.kind === 'invite' ? 'join' : 'accept'} takes it` : null;
  // On a voice call with the visitor now (V-03, WF-V3): Join chat or Accept brings you into the call too.
  const call = h.onCall ? 'On a voice call now — you join the call too' : null;
  if (h.kind === 'invite') return [call, team].filter(Boolean).join(' · ') || null;
  const mode = h.mode === 'cold'
    ? who ? `Handed over now — ${who} has left; it rings for you until you join` : 'It rings for everybody covering the website until someone joins'
    : who ? `Warm transfer — ${who} stays until you join` : 'Warm transfer — nothing changes until you accept';
  return [call, mode, team].filter(Boolean).join(' · ');
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
  // A colleague joined while I was typing (UX-ALR-04): my words and the choice, above whatever else still rings.
  const offer = s.outcome?.draft && !s.hidden ? <ParticipantCard o={s.outcome} /> : null;

  let body: ReactNode;
  // A visitor on the line comes before everything else (VOICE-10).
  if (firstCall) body = <CallCard s={s} c={firstCall} rest={otherCalls} more={s.chats.length + handoffs.length} now={now} />;
  // Every chat silenced for me: the compact "still waiting" card (R-04, RING-24) — at risk clears a silence, so it
  // never hides one. One chat: the full card with its reply box; several: a compact card each (#225).
  else if (top && !asks && s.chats.every((c) => c.silenced)) body = <SilencedCard s={s} c={top} now={now} />;
  else if (top) body = s.chats.length > 1 ? <RingStack s={s} chats={s.chats} now={now} after={asks} /> : <RingCard key={top.id} s={s} c={top} now={now} after={asks} />;
  else if (handoffs[0]) body = <HandoffCard s={s} h={handoffs[0]} rest={handoffs.slice(1)} now={now} />;
  // A chat just joined from the card: a mini chat until the full chat is opened or the card minimised (#225).
  else if (s.joined) body = <JoinedCard j={s.joined} now={now} colleagues={s.youJoined?.id === s.joined.conversationId ? s.youJoined.colleagues : null} />;
  // A visitor who wrote again in my chat while I was away from it (#230).
  else if (s.followUps?.[0]) body = <FollowUpCard s={s} f={s.followUps[0]} rest={s.followUps.slice(1)} now={now} />;
  // How the ring ended (R-03, RING-UI-03).
  else body = offer ? null : <OutcomeCard s={s} />;
  return (
    <div ref={fit}>
      {offer}
      {body}
    </div>
  );
}

/**
 * The incoming call's device line (V-04, VOICE-11, VOICE-14): which headset or microphone the call would use, or that
 * there is none — then Answer is off, as the server would not ring this computer for calls either.
 */
export function deviceLine(mic: WebchatMic | null | undefined): string {
  if (!mic) return 'Audio only, in WorkSuite';
  if (!mic.ready) return 'No microphone — plug one in to answer';
  return mic.label ? `${mic.headset ? 'Headset' : 'Microphone'}: ${mic.label} · mic ready` : 'Microphone ready';
}

/** "techubiz.com · in chat with Nuwan" (V-04): where the visitor is, and whose chat it is. */
export function callWhere(c: Pick<WebchatCall, 'site' | 'owner'>): string {
  return [c.site, c.owner ? `in chat with ${firstName(c.owner)}` : null].filter(Boolean).join(' · ') || 'Website voice call';
}

/**
 * A visitor's voice call as the call window's card (V-04, VOICE-UI-03): the native window's title, the phone in its
 * ring, INCOMING VOICE CALL with how long it has rung, who, where and whose chat, the last message, Answer and
 * Decline, then the device line with the answer shortcut. Answering brings WorkSuite forward on the chat, on the call.
 */
function CallCard({ s, c, rest, more, now }: { s: WebchatRingState; c: WebchatCall; rest: WebchatCall[]; more: number; now: number }) {
  const answerKey = isMac ? '⌘⇧A' : 'Ctrl+Shift+A';
  // No microphone here: nothing to answer with (VOICE-11). Locked: nobody is shown, so nothing is answered either.
  const noMic = s.mic?.ready === false;
  const contact = s.hidden ? null : [c.phone, c.email].filter(Boolean).join(' · ') || null;
  const status = s.outcome ? s.outcome.text : s.elsewhere ? 'Ringing on your other device — shown here without sound' : more ? `${more} more waiting` : null;
  return (
    <section aria-label="Incoming voice call" className="flex h-full flex-col overflow-hidden border border-stage-green bg-stage-2 text-[13px] text-stage-ink">
      <div className="sr-only" role="alert" aria-live="assertive">
        {s.hidden ? 'A website visitor is calling.' : `Voice call: ${c.visitor}${c.site ? ` on ${c.site}` : ''} is calling.`}
      </div>
      <WindowStrip title="WorkSuite · Website voice call" />
      <div className="drag flex items-center gap-4 px-[18px] pt-[18px] pb-2">
        <span aria-hidden className="flex h-[82px] w-[82px] shrink-0 items-center justify-center rounded-full border-2 border-green/45 motion-safe:[animation:ws-ring-pulse_1.6s_ease-out_infinite]">
          <span className="flex h-[62px] w-[62px] items-center justify-center rounded-full bg-green text-white">
            <Icon name="phone" size={26} />
          </span>
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="text-[11px] font-bold tracking-[1px] text-stage-success uppercase">
            <span>Incoming voice call</span>
            {c.requestedAt ? (
              <>
                {' · '}
                <span role="timer" className="font-mono tabular-nums" aria-label={`Calling for ${waited(c.requestedAt, now)}`}>{waited(c.requestedAt, now)}</span>
              </>
            ) : null}
          </span>
          <b className="truncate text-[19px] font-bold text-white">{s.hidden ? 'A website visitor' : c.visitor}</b>
          <span className="truncate text-[13px] text-stage-ink-3">{s.hidden ? 'Unlock WorkSuite to see who.' : callWhere(c)}</span>
          {!s.hidden && c.page ? <span className="truncate text-[12px] text-navy-ink">Reading {c.page}</span> : null}
          {/* The details the visitor gave before calling (UX-WGT-10): who to ring back if the line drops. */}
          {contact ? <span className="truncate text-[12px] text-navy-ink">{contact}</span> : null}
        </span>
      </div>
      {!s.hidden && c.preview ? (
        <p className="mx-[18px] mt-1.5 line-clamp-2 rounded-[10px] border border-navy-3 bg-navy-2 px-3 py-2.5 text-[13px] break-words">
          Last message: <span>“{c.preview}”</span>
        </p>
      ) : null}
      <div className="flex gap-2.5 px-[18px] py-3.5">
        <button
          type="button"
          disabled={s.hidden || noMic}
          title={noMic ? 'No microphone on this computer' : undefined}
          onClick={() => answerCall(c.id, true)}
          className="flex h-[46px] flex-1 items-center justify-center gap-2 rounded-full bg-green text-[15px] font-bold text-white hover:brightness-110 disabled:opacity-50"
        >
          Answer
        </button>
        <button type="button" onClick={() => answerCall(c.id, false)} className="h-[46px] w-[124px] shrink-0 rounded-full bg-red text-[14px] font-bold text-white hover:brightness-110">
          Decline
        </button>
      </div>
      {rest.length ? (
        <ul className="flex flex-col border-t border-primary" aria-label="Other calls">
          {rest.slice(0, 3).map((x) => (
            <li key={`c${x.id}`} className="flex h-[46px] items-center gap-2 border-b border-primary px-[18px]">
              <Icon name="phone" size={13} className="shrink-0 text-stage-success" />
              <span className="min-w-0 flex-1 truncate">
                <b className="text-white">{s.hidden ? 'A visitor' : x.visitor}</b>
                <span className="text-stage-accent"> · Voice call{x.site && !s.hidden ? ` · ${x.site}` : ''}</span>
              </span>
              <button type="button" disabled={s.hidden || noMic} onClick={() => answerCall(x.id, true)} className="h-8 rounded-[7px] bg-navy-3 px-2.5 text-[12px] font-bold text-white hover:bg-stage-4 disabled:opacity-50">
                Answer
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {status ? <p className="px-[18px] pt-2 text-[11.5px] text-stage-accent" role="status">{status}</p> : null}
      <div className="drag mt-auto flex items-center justify-between gap-3 px-[18px] pt-2 pb-3 text-[12px] text-ink-4">
        <span className={cx('flex min-w-0 items-center gap-1.5 truncate', noMic && 'text-stage-danger')}>
          {noMic ? <Icon name="mic-off" size={13} className="shrink-0" /> : null}
          {deviceLine(s.mic)}
        </span>
        {s.answerShortcut ? (
          <kbd className="shrink-0 font-mono" aria-label={`${answerKey} to answer`} title={`${answerKey} answers from any app`}>
            {answerKey}
          </kbd>
        ) : null}
      </div>
    </section>
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
    <div className="flex h-full flex-col bg-stage-2 text-[13px] text-stage-ink">
      <div className="sr-only" role="alert" aria-live="assertive">
        {s.hidden ? 'A colleague is asking you into a website chat.' : `${handoffTitle(h)}: ${handoffHeadline(h)}.`}
      </div>
      <section aria-label={invite ? 'Invitation' : 'Transfer request'} className="flex flex-col gap-2.5 px-[18px] pt-4">
        <div className="drag flex items-center gap-2">
          <span className={cx('rounded-[6px] px-2 py-[3px] text-[11px] font-bold tracking-[1.2px] text-white uppercase', invite ? 'bg-teal' : 'bg-blue')}>{handoffTitle(h)}</span>
          <span className="flex-1" />
          {left !== null ? (
            // "1:40 left" on an invitation, "0:48" on a transfer, as designed.
            <span role="timer" aria-label={`Rings for ${clock(left)} more`} className="font-mono text-[13px] text-navy-ink tabular-nums">{invite ? `${clock(left)} left` : clock(left)}</span>
          ) : null}
        </div>
        <b className="text-[16px] leading-snug font-bold text-white">{handoffHeadline(h, s.hidden)}</b>
        {!s.hidden && (h.site || h.page) ? <span className="-mt-1.5 truncate text-[12px] text-stage-accent">{[h.site, h.page ? `Reading ${h.page}` : null].filter(Boolean).join(' · ')}</span> : null}
        {!s.hidden && h.note ? (
          <p className="rounded-[10px] bg-navy-2 px-3 py-2.5 text-[13px] break-words text-stage-ink" title="Only staff see this note">{invite ? `“${h.note}”` : h.note}</p>
        ) : null}
        {detail ? <span className="text-[12px] text-stage-accent">{detail}</span> : null}
        <div className="flex gap-2.5">
          <button type="button" disabled={s.hidden} onClick={() => answer(h.id, true)} className="h-11 flex-1 rounded-full bg-green text-[15px] font-bold text-white hover:brightness-110 disabled:opacity-50">
            {invite ? 'Join chat' : 'Accept'}
          </button>
          <button type="button" onClick={() => answer(h.id, false)} className="h-11 w-[116px] shrink-0 rounded-full border border-stage-4 font-semibold text-stage-ink hover:bg-white/5">
            Decline
          </button>
        </div>
      </section>
      {rest.length ? <HandoffRows s={s} list={rest.slice(0, 3)} more={rest.length - 3} now={now} first /> : null}
      <p className="drag mt-auto px-[18px] pt-2.5 pb-3 text-[11px] text-indigo-bright">{s.outcome ? s.outcome.text : s.elsewhere ? 'Ringing on your other device — shown here without sound' : 'A colleague is asking you into a website chat'}</p>
    </div>
  );
}

/** Other invitations and transfers, under the card, each with Join and Decline. */
function HandoffRows({ s, list, more, first, now }: { s: WebchatRingState; list: WebchatHandoff[]; more: number; first: boolean; now?: number }) {
  return (
    <ul className={cx('flex flex-col', first ? 'mt-3 border-t border-primary' : '')} aria-label="Invitations and transfers">
      {list.map((h) => (
        <li key={`h${h.id}`} className="flex h-[46px] items-center gap-2 border-b border-primary px-4">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted" />
          <span className="min-w-0 flex-1 truncate">
            <b className="text-white">{s.hidden ? 'A visitor' : h.visitor}</b>
            <span className="text-stage-accent"> · {handoffTitle(h)}{h.from && !s.hidden ? ` from ${h.from}` : ''}</span>
          </span>
          {now !== undefined && handoffLeft(h, now) !== null ? <span className="shrink-0 font-mono text-[12px] text-navy-ink tabular-nums">{clock(handoffLeft(h, now)!)}</span> : null}
          <button type="button" disabled={s.hidden} onClick={() => answer(h.id, true)} className="h-8 rounded-[7px] bg-navy-3 px-2.5 text-[12px] font-bold text-white hover:bg-stage-4 disabled:opacity-50">
            {h.kind === 'invite' ? 'Join' : 'Accept'}
          </button>
          <button type="button" aria-label={`Decline ${handoffTitle(h).toLowerCase()} for ${s.hidden ? 'a visitor' : h.visitor}`} onClick={() => answer(h.id, false)} className="h-8 rounded-[7px] px-2 text-[12px] font-semibold text-navy-ink hover:bg-white/5">
            Decline
          </button>
        </li>
      ))}
      {more > 0 ? <li className="px-4 py-1 text-[11.5px] text-stage-accent">+{more} more asking</li> : null}
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
      <div role="status" aria-label="Voice call ringing" className="flex h-9 shrink-0 items-center gap-2.5 border-b border-success-line bg-success-bg px-3.5 text-[12.5px] text-success-ink dark:text-success">
        <Icon name="phone" size={15} className="shrink-0 motion-safe:animate-pulse" />
        <b className="shrink-0">Incoming voice call</b>
        <span className="min-w-0 flex-1 truncate">
          {s.hidden ? '' : `${c.visitor}${c.site ? ` · ${c.site}` : ''}`}
          {c.requestedAt ? ` · ${waited(c.requestedAt, now)}` : ''}
          {(s.calls?.length ?? 0) > 1 ? ` · +${(s.calls?.length ?? 0) - 1} more` : ''}
        </span>
        {/* Without a microphone there is nothing to answer with (V-04, VOICE-11): the bar says so instead. */}
        {s.mic?.ready === false ? <span className="shrink-0 text-[12px]">No microphone</span> : null}
        <button type="button" disabled={s.mic?.ready === false} onClick={() => answerCall(c.id, true)} className="h-7 rounded-[7px] bg-success px-3 font-bold text-white hover:brightness-110 disabled:opacity-50">
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
      <div role="status" aria-label="Website chat invitation" className="flex h-9 shrink-0 items-center gap-2.5 border-b border-info-line bg-selection px-3.5 text-[12.5px] text-ink">
        <Icon name="users" size={15} className="shrink-0 text-primary" />
        <b className="shrink-0">{handoffTitle(h)}</b>
        <span className="min-w-0 flex-1 truncate">{s.hidden ? '' : `${handoffAsk(h)} · ${h.visitor}`}{(s.handoffs?.length ?? 0) > 1 ? ` · +${(s.handoffs?.length ?? 0) - 1} more` : ''}</span>
        {handoffLeft(h, now) !== null ? <span className="shrink-0 font-mono text-[12px] text-ink-2 tabular-nums" aria-label={`Rings for ${clock(handoffLeft(h, now)!)} more`}>{clock(handoffLeft(h, now)!)}</span> : null}
        <button type="button" onClick={() => answer(h.id, true)} className="h-7 rounded-[7px] bg-success px-3 font-bold text-white hover:brightness-110">
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
      <div role="status" aria-label="Visitor waiting for your reply" className="flex h-9 shrink-0 items-center gap-2.5 border-b border-warning-line bg-warning-bg px-3.5 text-[12.5px] text-warning-strong dark:text-warning">
        <Icon name="chat" size={15} className="shrink-0" />
        <b className="shrink-0">{followUpStatus(f)}</b>
        <span className="min-w-0 flex-1 truncate">
          {s.hidden ? '' : `${f.visitor}${said ? `: “${said}”` : ''}`} · waiting {waited(f.since, now)}
          {more > 0 ? ` · +${more} more` : ''}
        </span>
        {!f.mine && f.stage === 'team' ? (
          <button type="button" onClick={() => void call('ring:followUp', { id: f.id, action: 'takeOver' }).catch((e) => toast('error', errorMessage(e)))} className="h-7 rounded-[7px] bg-success px-3 font-bold text-white hover:brightness-110">
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
      className={cx('flex h-9 shrink-0 items-center gap-2.5 border-b px-3.5 text-[12.5px]', all ? 'border-warning-line bg-warning-bg text-warning-strong dark:text-warning' : 'border-danger-line bg-danger-bg text-danger-ink dark:text-danger')}
    >
      <Icon name={all ? 'bell-off' : 'bell'} size={15} className={cx('shrink-0', !all && 'motion-safe:animate-pulse')} />
      <b className="shrink-0">{all ? `${s.chats.length === 1 ? 'A chat' : `${s.chats.length} chats`} waiting · silenced for you` : 'Website chat ringing'}</b>
      <span className="min-w-0 flex-1 truncate">
        {s.hidden ? '' : `${top.visitor}${top.site ? ` · ${top.site}` : ''} · ${stageLabel(top)}`} · {waited(top.since, now)}
        {more > 0 ? ` · +${more} waiting` : ''}
      </span>
      <button type="button" onClick={() => join(top.id)} className="h-7 rounded-[7px] bg-success px-3 font-bold text-white hover:brightness-110">
        Join
      </button>
      <button type="button" onClick={() => silence(top.id, !top.silenced)} className="h-7 rounded-[7px] border border-current/30 px-2.5 font-semibold hover:bg-black/5">
        {top.silenced ? 'Unsilence' : 'Silence'}
      </button>
    </div>
  );
}

/**
 * The title bar's alert (R-01, DsTopBar "alert: ringing / silenced"; RING-25, RING-24): a red "Website chat ringing"
 * pill with how long the top chat has waited, on every module while anything rings; amber "Silenced · N waiting" once
 * every chat ringing is silenced for me. A visitor's call has its own pill (ActiveCalls). A click opens Website Chats'
 * inbox — never the chat itself, which would join it.
 */
export function RingAlertPill() {
  const s = useRingState();
  const now = useNow();
  if (!s.chats.length) return null;
  const live = s.chats.filter((c) => !c.silenced);
  const top = live[0] ?? s.chats[0]!;
  const silenced = !live.length;
  const time = waited(top.since, now);
  // Several ringing: "3 website chats ringing" (R-06, DsTopBar ring-text), as the tray and the dock count them.
  const label = silenced ? text('Silenced · {n} waiting', { n: s.chats.length }) : live.length > 1 ? text('{n} website chats ringing', { n: live.length }) : text('Website chat ringing');
  return (
    <button
      type="button"
      onClick={() => void call('ring:openInbox').catch(() => undefined)}
      aria-label={`${label}, ${time}. ${text('Open Website Chats')}`}
      title={text('Open Website Chats')}
      className={cx(
        'no-drag flex h-8 shrink-0 items-center gap-2 rounded-full px-3 text-[12px] whitespace-nowrap',
        silenced ? 'border border-stage-amber bg-stage-gray-2 font-semibold text-stage-danger hover:bg-stage-gray-2' : 'bg-badge font-bold text-white hover:bg-badge',
      )}
    >
      <Icon name={silenced ? 'bell-off' : 'bell'} size={14} className={cx('shrink-0', !silenced && 'motion-safe:animate-pulse')} />
      {label}
      <span role="timer" className={cx('font-mono text-[11px] tabular-nums', !silenced && 'rounded-full bg-danger px-[7px] py-0.5')}>{time}</span>
    </button>
  );
}
