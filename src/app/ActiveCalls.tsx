import { useEffect, useState } from 'react';
import type { ActiveCall } from '@shared/types';
import { call, on } from '../core/bridge';
import { navigate } from '../core/tabs';
import { Icon } from '../components/Icon';
import { useNow } from '../modules/calls/parts';
import { useWebsiteCall } from '../modules/chat/website/call';

/**
 * "In a meeting · Design review · 12:04" in the main window's title bar,
 * for every call or meeting going on in another window of this app. One
 * click brings that window back — out of the floating card, out of the
 * Dock or taskbar — and in front.
 *
 * A website visitor's voice call held by this window shows the same pill
 * (V-03: the top bar's call alert with its time); a click opens its chat.
 */
export function ActiveCalls() {
  const [list, setList] = useState<ActiveCall[]>([]);
  useEffect(() => {
    let alive = true;
    void call('calls:list').then((l) => alive && setList(l), () => undefined);
    const off = on<ActiveCall[]>('calls:changed', (l) => setList(Array.isArray(l) ? l : []));
    return () => {
      alive = false;
      off();
    };
  }, []);
  const web = useWebsiteCall();
  // Its audio connected (the time runs from then), and still on.
  const webLive = !!web && web.since !== null && (web.phase === 'connected' || web.phase === 'reconnecting');
  if (!list.length && !webLive) return null;
  return (
    <>
      {list.map((c) => (
        <CallPill key={c.windowId} kind={c.kind === 'meet' ? 'meet' : 'call'} title={c.title.replace(/^Call · /, '')} since={c.since} onOpen={() => void call('calls:focus', { windowId: c.windowId })} />
      ))}
      {webLive ? (
        <CallPill kind="call" title={web.held ? `${web.visitor} · on hold` : web.visitor} since={web.since!} onOpen={() => navigate(`/chat?view=website&website=${web.conversationId}`)} />
      ) : null}
    </>
  );
}

function CallPill({ kind, title, since, onOpen }: { kind: 'meet' | 'call'; title: string; since: number; onOpen: () => void }) {
  const now = useNow();
  const s = Math.max(0, Math.floor((now - since) / 1000));
  const clock = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const what = kind === 'meet' ? 'In a meeting' : 'On a call';
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${what}: ${title} — back to it`}
      aria-label={`${what}: ${title}, ${clock}. Back to it`}
      className="no-drag flex h-8 max-w-[280px] items-center gap-2 rounded-full bg-[#1F7A4D] pr-3 pl-2.5 text-[12.5px] font-semibold text-white hover:bg-[#23905A]"
    >
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
      </span>
      <Icon name={kind === 'meet' ? 'video' : 'phone'} size={14} className="shrink-0" />
      <span className="min-w-0 truncate">{title}</span>
      <span className="font-mono text-[11.5px] text-white/80 tabular-nums">{clock}</span>
    </button>
  );
}
