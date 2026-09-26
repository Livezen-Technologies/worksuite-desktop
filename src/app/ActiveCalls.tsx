import { useEffect, useState } from 'react';
import type { ActiveCall } from '@shared/types';
import { call, on } from '../core/bridge';
import { Icon } from '../components/Icon';
import { useNow } from '../modules/calls/parts';

/**
 * "In a meeting · Design review · 12:04" in the main window's title bar,
 * for every call or meeting going on in another window of this app. One
 * click brings that window back — out of the floating card, out of the
 * Dock or taskbar — and in front.
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
  if (!list.length) return null;
  return (
    <>
      {list.map((c) => (
        <CallPill key={c.windowId} c={c} />
      ))}
    </>
  );
}

function CallPill({ c }: { c: ActiveCall }) {
  const now = useNow();
  const s = Math.max(0, Math.floor((now - c.since) / 1000));
  const clock = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const what = c.kind === 'meet' ? 'In a meeting' : 'On a call';
  return (
    <button
      type="button"
      onClick={() => void call('calls:focus', { windowId: c.windowId })}
      title={`${what}: ${c.title} — back to it`}
      aria-label={`${what}: ${c.title}, ${clock}. Back to it`}
      className="no-drag flex h-8 max-w-[280px] items-center gap-2 rounded-full bg-[#1F7A4D] pr-3 pl-2.5 text-[12.5px] font-semibold text-white hover:bg-[#23905A]"
    >
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
      </span>
      <Icon name={c.kind === 'meet' ? 'video' : 'phone'} size={14} className="shrink-0" />
      <span className="min-w-0 truncate">{c.title.replace(/^Call · /, '')}</span>
      <span className="font-mono text-[11.5px] text-white/80 tabular-nums">{clock}</span>
    </button>
  );
}
