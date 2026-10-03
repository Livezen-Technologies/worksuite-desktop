import { useEffect, useState } from 'react';
import type { WebchatRingChat, WebchatRingState } from '@shared/types';
import { call, errorMessage, isMac, on } from '../../../core/bridge';
import { parseTs } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Avatar, cx } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { useNow } from '../../calls/parts';
import { playTone } from '../../calls/tones';

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
const pass = (id: number) => void call('ring:pass', { id }).catch((e) => toast('error', errorMessage(e)));

/** The server's accept time by default: how long a chat given to me rings before it passes on (RING-05). */
const ACCEPT_SECONDS = 60;

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
  const [top, ...rest] = s.chats;
  const joinKey = isMac ? '⌘⇧J' : 'Ctrl+Shift+J';
  const handover = top ? handoverIn(top.handoverAt, now) : null;

  if (!top) {
    return (
      <div className="drag flex h-full items-center gap-3 bg-[#0F1B3D] px-4 text-[13px] text-[#E6ECFA]" role="status" aria-live="polite">
        <Icon name="check-circle" size={18} className="shrink-0 text-[#3DD68C]" />
        <span className="min-w-0 flex-1">{s.outcome?.text ?? 'Nothing is ringing.'}</span>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col bg-[#0F1B3D] text-[13px] text-[#E6ECFA]">
      <div className="sr-only" role="alert" aria-live="assertive">
        {s.hidden ? 'A website chat is waiting.' : `Website chat: ${top.visitor}${top.site ? ` on ${top.site}` : ''} is waiting.`}
      </div>
      <div className={cx('drag flex items-center gap-2 px-4 pt-3 text-[11.5px] font-bold tracking-[.06em] uppercase', top.atRisk ? 'text-[#FF8A73]' : 'text-[#AFC0E8]')}>
        <span className={cx('h-2 w-2 rounded-full', top.silenced ? 'bg-[#F5B94A]' : 'bg-[#F0503A] motion-safe:animate-pulse')} />
        <span className="flex-1">{top.silenced ? 'Silenced for you' : 'Website chat ringing'}</span>
        <span className={cx('rounded-full px-2 py-0.5 text-[10.5px] tracking-normal normal-case', top.atRisk ? 'bg-[#5A1F17] text-[#FFB4A4]' : top.mine ? 'bg-[#1C3A2E] text-[#8FE3B7]' : 'bg-[#22305C] text-[#C9D5F5]')}>{stageLabel(top)}</span>
      </div>
      <div className="flex gap-3 px-4 pt-3">
        <span className={cx('relative shrink-0 rounded-full', !top.silenced && 'motion-safe:[animation:ws-ring-pulse_1.6s_ease-out_infinite]')}>
          <Avatar name={s.hidden ? '?' : top.visitor} size={46} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <b className="truncate text-[15px] text-white">{s.hidden ? 'A website visitor' : top.visitor}</b>
          <span className="truncate text-[12px] text-[#AFC0E8]">
            {s.hidden ? 'Unlock WorkSuite to see who.' : [top.site, top.place, top.device, top.returning ? 'Returning' : null].filter(Boolean).join(' · ') || 'Website chat'}
          </span>
          {!s.hidden && top.page ? <span className="truncate text-[12px] text-[#C9D5F5]">Reading {top.page}</span> : null}
        </span>
        <span className="shrink-0 font-mono text-[12px] text-[#AFC0E8]" aria-label={`Waiting ${waited(top.since, now)}`}>
          {waited(top.since, now)}
        </span>
      </div>
      {!s.hidden && top.preview ? <p className="mx-4 mt-2 line-clamp-2 rounded-[8px] bg-[#16254F] px-2.5 py-1.5 text-[12.5px] text-[#E6ECFA]">“{top.preview}”</p> : null}
      {top.mine && top.by ? <p className="mx-4 mt-1.5 text-[11.5px] text-[#AFC0E8]">Assigned to you by {top.by}</p> : null}
      {top.mine && handover !== null ? (
        // A chat given to me passes on if I do not join it in time (RING-UI-02).
        <div className="mx-4 mt-2" role="timer" aria-label={`Passes on in ${clock(handover)}`}>
          <div className="h-1 overflow-hidden rounded-full bg-[#22305C]">
            <div className="h-full rounded-full bg-[#8FA6E0] transition-[width] duration-1000 ease-linear" style={{ width: `${Math.min(100, (handover / ACCEPT_SECONDS) * 100)}%` }} />
          </div>
          <p className="mt-1 text-[11.5px] text-[#AFC0E8]">Passes to the next available agent in {clock(handover)} if you don't join</p>
        </div>
      ) : null}
      <div className="flex gap-2 px-4 pt-3">
        <button type="button" disabled={s.hidden} onClick={() => join(top.id)} className="h-11 flex-1 rounded-[9px] bg-[#3DD68C] text-[14px] font-bold text-[#0B2A1D] hover:brightness-105 disabled:opacity-50">
          Join chat
        </button>
        {top.mine && handover !== null ? (
          <button type="button" onClick={() => pass(top.id)} className="h-11 flex-1 rounded-[9px] border border-[#33477E] text-[14px] font-semibold hover:bg-white/5">
            Pass to next
          </button>
        ) : (
          <button type="button" onClick={() => silence(top.id, !top.silenced)} className="h-11 flex-1 rounded-[9px] border border-[#33477E] text-[14px] font-semibold hover:bg-white/5">
            {top.silenced ? 'Unsilence' : 'Silence'}
          </button>
        )}
      </div>
      {rest.length ? (
        <ul className="mt-3 flex flex-col border-t border-[#22305C]" aria-label="Other chats waiting">
          {rest.slice(0, 3).map((c) => (
            <li key={c.id} className="flex h-[46px] items-center gap-2 border-b border-[#22305C] px-4">
              <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', c.atRisk ? 'bg-[#F0503A]' : c.silenced ? 'bg-[#F5B94A]' : 'bg-[#8FA6E0]')} />
              <span className="min-w-0 flex-1 truncate">
                <b className="text-white">{s.hidden ? 'A visitor' : c.visitor}</b>
                <span className="text-[#AFC0E8]"> · {stageLabel(c)}{c.site && !s.hidden ? ` · ${c.site}` : ''}</span>
              </span>
              <span className="font-mono text-[11.5px] text-[#AFC0E8]">{waited(c.since, now)}</span>
              <button type="button" disabled={s.hidden} onClick={() => join(c.id)} className="h-8 rounded-[7px] bg-[#22305C] px-2.5 text-[12px] font-bold text-white hover:bg-[#2B3C70] disabled:opacity-50">
                Join
              </button>
            </li>
          ))}
          {rest.length > 3 ? <li className="px-4 py-1 text-[11.5px] text-[#AFC0E8]">+{rest.length - 3} more waiting</li> : null}
        </ul>
      ) : null}
      <p className="drag mt-auto px-4 pt-2 pb-2.5 text-[11px] text-[#8FA6E0]">
        {s.outcome ? s.outcome.text : s.elsewhere ? 'Ringing on your other device — shown here without sound' : `Rings until someone joins${s.shortcut ? ` · ${joinKey} to join` : ''}`}
      </p>
    </div>
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
  const [top] = s.chats;
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
