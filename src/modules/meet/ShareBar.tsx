import { useEffect, useState } from 'react';
import type { ShareBarAction, ShareBarState } from '@shared/share-bar';
import { call, on } from '../../core/bridge';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { hms } from './MeetRoom';

/**
 * The sharing bar (WS-MEET-ENH-01 D03): the strip at the top of the screen you
 * are sharing.
 *
 * It exists because the call window is behind whatever you are showing.
 * Stopping a share used to mean finding that window again, and people solved
 * that by not sharing.
 *
 * Its own window, so what it says is drawn over the shared screen rather than
 * inside the capture — the window is content-protected in the main process,
 * like the share outline it sits with. It owns no state: the meeting's window
 * reports, main keeps the latest, and every button goes back the same way, so
 * there is one truth about whether a microphone is live.
 *
 * The design also draws an annotate button here. It is deliberately absent:
 * in this app the people watching point and draw over a share, and the person
 * sharing clears or turns that off from the call's own sharing menu. A button
 * for a tool the sharer does not have would be a promise, not a feature.
 */
export function ShareBarWindow() {
  const [state, setState] = useState<ShareBarState | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // The bar can open before, or after, the meeting has reported anything.
    void call('meet:barRead')
      .then((r) => setState(r.state ?? null))
      .catch(() => undefined);

    return on<ShareBarState | null>('meet:bar', (s) => setState(s ?? null));
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(t);
  }, []);

  const act = (id: ShareBarAction) => void call('meet:barAction', { id }).catch(() => undefined);
  // Nothing is claimed before the meeting has said anything: a bar that showed
  // a live microphone while it was muted would be worse than a bar with no
  // icons on it yet.
  const known = state !== null;
  const elapsed = state ? Math.max(0, now - state.since) : 0;

  return (
    <div className="drag flex h-full w-full items-center gap-2 rounded-[14px] bg-[#0F172A] px-2.5 text-white shadow-[0_12px_30px_rgba(0,0,0,.45)]">
      <span
        className={cx(
          'no-drag flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[12px] font-semibold',
          state?.paused ? 'bg-[#3A2A10] text-[#F6C77A]' : 'bg-[#14532D] text-[#BBF7D0]',
        )}
        title={state?.label ? `Sharing ${state.label}` : 'Sharing your screen'}
      >
        <Icon name="screen-share" size={14} />
        <span className="max-w-[220px] truncate">{state?.paused ? 'Paused' : state?.label ? `Sharing ${state.label}` : 'Sharing'}</span>
      </span>
      <span className="shrink-0 font-mono text-[12px] text-[#94A3B8]" aria-label="Time shared">
        {known ? hms(elapsed) : '—'}
      </span>
      <span className="flex-1" />
      <div className="no-drag flex shrink-0 items-center gap-1">
        <BarButton label={state?.micOn ? 'Mute' : 'Unmute'} icon={state?.micOn ? 'mic' : 'mic-off'} warn={known && !state?.micOn} onClick={() => act('meet-mute')} disabled={!known} />
        <BarButton
          label={state?.cameraOn ? 'Turn camera off' : 'Turn camera on'}
          icon={state?.cameraOn ? 'video' : 'video-off'}
          warn={known && !state?.cameraOn}
          onClick={() => act('meet-camera')}
          disabled={!known}
        />
        <BarButton label="Chat" icon="chat" badge={state?.unreadChat || undefined} onClick={() => act('meet-chat')} disabled={!known} />
        <button
          type="button"
          disabled={!known}
          onClick={() => act('meet-pause-share')}
          className="h-8 rounded-[9px] border border-[#334155] bg-[#1E293B] px-2.5 text-[12.5px] font-semibold text-[#E2E8F0] hover:bg-[#263449] disabled:opacity-50"
        >
          {state?.paused ? 'Resume' : 'Pause'}
        </button>
        <button
          type="button"
          disabled={!known}
          onClick={() => act('meet-stop-share')}
          className="h-8 rounded-[9px] bg-[#C4321C] px-2.5 text-[12.5px] font-bold text-white hover:bg-[#A8291A] disabled:opacity-50"
        >
          Stop sharing
        </button>
      </div>
    </div>
  );
}

function BarButton({ label, icon, onClick, warn, badge, disabled }: { label: string; icon: string; onClick: () => void; warn?: boolean; badge?: number; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'relative flex h-8 w-8 items-center justify-center rounded-[9px] text-white disabled:opacity-50',
        warn ? 'bg-[#7F1D1D] hover:bg-[#991B1B]' : 'bg-[#1E293B] hover:bg-[#263449]',
      )}
    >
      <Icon name={icon} size={16} />
      {badge ? (
        <span className="absolute -top-1 -right-1 min-w-[16px] rounded-full bg-[#3B5BDB] px-1 text-[10px] font-bold leading-4 text-white">{badge > 99 ? '99+' : badge}</span>
      ) : null}
    </button>
  );
}
