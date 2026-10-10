import { useEffect, useRef, useState } from 'react';
import { ApiError, apiPost } from '../../core/api';
import { call, errorMessage, on } from '../../core/bridge';
import { useTab } from '../../core/tab-context';
import { Icon } from '../../components/Icon';
import { CallAvatar } from '../calls/parts';
import { playTone, ringVolume } from '../calls/tones';
import { openMeeting } from './api';

/**
 * Somebody rings you into a meeting that is on (worksuite-desktop#79): the
 * same small window on top of everything as an incoming call, with who is
 * inviting you, the meeting, Accept and Decline. It rings by your own
 * notification and Do not disturb settings — the server says whether this
 * one is silent, and does not ring at all when you are not taking calls.
 *
 * It stops however the invitation stops: answered here, answered on another
 * of your devices, cancelled, given up after its time, or the meeting ending.
 * Accepting opens the meeting's own join screen — with the microphone and
 * camera off — where its passcode and waiting room still apply.
 */
export function MeetRingScreen() {
  const { query } = useTab();
  const ring = Number(query.get('ring')) || 0;
  const uuid = query.get('uuid') ?? '';
  const name = query.get('name') ?? 'Someone';
  const title = query.get('title') ?? 'Meeting';
  const silent = query.get('silent') === '1';
  const expires = Math.max(1, Number(query.get('expires')) || 45);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(silent);
  const tone = useRef<ReturnType<typeof playTone> | null>(null);
  const close = () => void call('windows:close');

  useEffect(() => {
    const t = setTimeout(close, expires * 1000);
    const off = on<{ type?: string; ring_id?: number }>('realtime:event', (e) => {
      if (e?.type === 'meet.ring.stopped' && Number(e.ring_id) === ring) close();
    });
    return () => {
      clearTimeout(t);
      off();
    };
  }, [ring, expires]);

  useEffect(() => {
    if (muted) return;
    tone.current = playTone('ring', ringVolume());
    return () => {
      tone.current?.stop();
      tone.current = null;
    };
  }, [muted]);

  /**
   * Accept, Audio only, or Decline (WS-MEET-ENH-01 D04).
   *
   * Both ways of accepting are the same answer to the server — the invitation
   * does not care which devices you use — and differ only in what the join
   * screen starts with: Accept leaves both off, Audio only leaves the
   * microphone as you last had it and the camera off. Neither is remembered:
   * the next meeting is not this one.
   */
  const answer = async (accept: boolean, audioOnly = false) => {
    setBusy(true);
    tone.current?.stop();
    try {
      const r = await apiPost<{ state: string; uuid: string; title?: string }>(`/api/meet/rings/${ring}/answer`, { answer: accept ? 'accept' : 'decline' });
      // Answered here first, or on another device as accepted: open it. Declined anywhere: nothing to open.
      if (accept && (r.state === 'accepted' || r.state === 'ringing')) await openMeeting(r.uuid || uuid, r.title ?? title, { quiet: !audioOnly, audioOnly });
      close();
    } catch (e) {
      setBusy(false);
      setError(e instanceof ApiError && e.status === 410 ? 'This meeting has ended.' : errorMessage(e));
    }
  };

  return (
    <div role="alertdialog" aria-label={`${name} invites you to ${title}`} className="drag flex h-full flex-col bg-[#0F1B3D] text-white">
      <div className="flex items-center gap-2 pt-3 pr-3 pl-4 text-[11.5px] font-semibold text-[#AFC0E8]">
        <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px] bg-[#3B5BDB] text-[10px] font-extrabold text-white">W</span>
        <span className="flex-1">WorkSuite · Invitation to a meeting</span>
        <button type="button" aria-label="Dismiss" title="Stop ringing here" onClick={close} className="no-drag flex h-[26px] w-[26px] items-center justify-center rounded-full bg-white/8 text-[#C3CEEA] hover:text-white">
          <Icon name="x" size={14} />
        </button>
      </div>
      <div className="flex items-center gap-3.5 px-4 pt-3 pb-3">
        <CallAvatar name={name} size={52} glow="incoming" />
        <div className="flex min-w-0 flex-col gap-[3px]">
          <span className="truncate text-[17px] font-bold">{name}</span>
          <span className="truncate text-[12.5px] text-[#C3CEEA]">invites you to join “{title}”</span>
        </div>
      </div>
      <div className="no-drag flex flex-1 flex-col gap-2.5 px-4 pb-2">
        <div className="flex gap-2.5">
          <button type="button" disabled={busy} onClick={() => void answer(false)} className="flex h-10 flex-1 items-center justify-center gap-2 rounded-[10px] bg-[#C4321C] text-[13.5px] font-bold hover:bg-[#A8291A] disabled:opacity-60">
            <Icon name="phone-off" size={16} />
            Decline
          </button>
          <button type="button" autoFocus disabled={busy} onClick={() => void answer(true)} className="flex h-10 flex-1 items-center justify-center gap-2 rounded-[10px] bg-[#1F7A4D] text-[13.5px] font-bold hover:bg-[#1A6841] disabled:opacity-60">
            <Icon name="video" size={16} />
            Accept
          </button>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void answer(true, true)}
          title="Join with your microphone and the camera off"
          className="flex h-9 items-center justify-center gap-2 rounded-[10px] bg-white/10 text-[13px] font-semibold text-white hover:bg-white/16 disabled:opacity-60"
        >
          <Icon name="mic" size={15} />
          Audio only
        </button>
        {error ? (
          <p role="alert" className="text-[12px] text-[#FFB4A2]">
            {error}
          </p>
        ) : (
          <p className="text-[11.5px] text-[#AFC0E8]">Accept opens the meeting with your microphone and camera off; Audio only leaves your microphone as it was.</p>
        )}
        <button type="button" onClick={() => setMuted(!muted)} className="mt-auto self-center text-[12px] font-semibold text-[#AFC0E8] hover:text-white">
          {muted ? 'Ringtone on' : 'Mute the ringtone'}
        </button>
      </div>
      <div className="h-[3px] shrink-0 bg-white/8" aria-hidden>
        <div className="animate-drain h-[3px] bg-[#7FA2FF]" style={{ animationDuration: `${expires}s` }} />
      </div>
    </div>
  );
}
