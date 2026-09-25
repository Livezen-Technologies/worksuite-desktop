import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../../core/api';
import { call, errorMessage, on } from '../../core/bridge';
import { useTab } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { CallAvatar } from './parts';
import { answerCall } from './start';
import { playTone, ringVolume, saveRingVolume } from './tones';

const QUICK_REPLIES = ["Can't talk now — I'll call you back.", "I'm in a meeting. I'll message you shortly.", 'Call you in 5 minutes.'];

/**
 * An incoming call (Chat, "Incoming WorkSuite call"): its own small window on
 * top of everything, opened by the shell when the call rings — whatever the
 * person is doing and whichever screen they are on.
 */
export function RingScreen() {
  const { query } = useTab();
  const uuid = query.get('uuid') ?? '';
  const roomId = query.get('room_id') ?? '';
  const name = query.get('name') ?? 'Someone';
  const where = query.get('room');
  const video = query.get('mode') === 'video';
  const silent = query.get('silent') === '1';
  const expires = Math.max(1, Number(query.get('expires')) || 45);
  const [volume, setVolume] = useState(ringVolume);
  const [muted, setMuted] = useState(silent);
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const tone = useRef<ReturnType<typeof playTone> | null>(null);
  const close = () => void call('windows:close');

  // Still ringing? It may have been answered or given up while this opened.
  useEffect(() => {
    void apiGet<{ status: string }>(`/api/chat/calls/${uuid}`).then(
      (c) => c.status !== 'ringing' && close(),
      () => close(),
    );
    const t = setTimeout(close, expires * 1000);
    const off = on<{ type: string; uuid?: string }>('realtime:event', (e) => {
      if (e.type === 'chat.call.stopped' && e.uuid === uuid) close();
    });
    return () => {
      clearTimeout(t);
      off();
    };
  }, [uuid, expires]);

  useEffect(() => {
    if (muted) return;
    tone.current = playTone('ring', volume);
    return () => {
      tone.current?.stop();
      tone.current = null;
    };
  }, [muted]); // eslint-disable-line react-hooks/exhaustive-deps

  const decline = async () => {
    setBusy(true);
    await apiPost(`/api/chat/calls/${uuid}/decline`).catch(() => undefined);
    close();
  };

  const answer = async (withVideo: boolean) => {
    setBusy(true);
    tone.current?.stop();
    try {
      await answerCall(uuid, roomId, withVideo, where ? `${name} · ${where}` : name);
      close();
    } catch (e) {
      setBusy(false);
      toast('error', errorMessage(e));
    }
  };

  const reply = async (message: string) => {
    if (!message.trim()) return;
    setBusy(true);
    try {
      await apiPost('/api/chat/messages', { room_id: Number(roomId), message: message.trim(), client_message_id: `desktop-${crypto.randomUUID()}` });
    } catch (e) {
      toast('error', errorMessage(e));
    }
    await decline();
  };

  return (
    <div role="alertdialog" aria-label="Incoming WorkSuite call" className="flex h-full flex-col gap-3 bg-[#0F1B3D] p-[18px] text-white">
      <div className="drag flex justify-between text-[11.5px] font-semibold text-[#AFC0E8]">
        <span>Incoming WorkSuite call</span>
        <span>Always on top</span>
      </div>
      <div className="flex items-center gap-3.5">
        <CallAvatar name={name} size={52} glow="incoming" />
        <div className="flex min-w-0 flex-col gap-[3px]">
          <span className="truncate text-[17px] font-bold">{name}</span>
          <span className="truncate text-[12.5px] text-[#C3CEEA]">
            {video ? 'Video call' : 'Voice call'}
            {where ? ` · ${where}` : ''}
          </span>
        </div>
      </div>
      {replying ? (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5">
          {QUICK_REPLIES.map((r) => (
            <button key={r} type="button" disabled={busy} onClick={() => void reply(r)} className="truncate rounded-[8px] bg-[#2A3A66] px-2.5 py-1.5 text-left text-[12px] font-semibold hover:bg-[#344777]">
              {r}
            </button>
          ))}
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void reply(text);
            }}
          >
            <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a reply…" aria-label="Reply with a message" className="h-8 min-w-0 flex-1 rounded-[8px] border-0 bg-white px-2.5 text-[12.5px] text-[#151A2D] outline-none" />
            <button type="submit" disabled={busy || !text.trim()} className="h-8 rounded-[8px] bg-white px-3 text-[12px] font-bold text-[#151A2D] disabled:opacity-60">
              Send
            </button>
          </form>
        </div>
      ) : (
        <>
          <div className="flex gap-2.5">
            <button type="button" disabled={busy} onClick={() => void decline()} className="h-10 flex-1 rounded-[10px] bg-[#C4321C] text-[13.5px] font-bold hover:bg-[#A8291A]">
              Decline
            </button>
            <button type="button" disabled={busy} onClick={() => void answer(video)} className="h-10 flex-1 rounded-[10px] bg-[#1F7A4D] text-[13.5px] font-bold hover:bg-[#1A6841]">
              Accept
            </button>
          </div>
          <label className="flex items-center gap-2 text-[12px] text-[#AFC0E8]">
            Ringtone
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              aria-label="Ringtone volume"
              onChange={(e) => {
                const v = Number(e.target.value);
                setVolume(v);
                saveRingVolume(v);
                tone.current?.setVolume(v);
              }}
              className="min-w-0 flex-1 accent-[#7FA2FF]"
            />
            <button type="button" onClick={() => setMuted(!muted)} className="font-semibold hover:text-white">
              {muted ? 'Unmute' : 'Mute the ringtone'}
            </button>
          </label>
        </>
      )}
      <div className="mt-auto flex justify-center gap-4 text-[12px] font-semibold text-[#AFC0E8]">
        {video && !replying ? (
          <button type="button" disabled={busy} onClick={() => void answer(false)} className="hover:text-white">
            Answer with voice only
          </button>
        ) : null}
        <button type="button" onClick={() => setReplying(!replying)} className="hover:text-white">
          {replying ? 'Back' : 'Reply with message…'}
        </button>
      </div>
    </div>
  );
}
