import { openChatWindow } from '../chat/window';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../../core/api';
import { call, errorMessage, on } from '../../core/bridge';
import { useTab } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { CallAvatar } from './parts';
import { answerCall } from './start';
import { playTone, ringVolume, saveRingVolume } from './tones';
import { BrandMark } from '../../components/BrandMark';

const QUICK_REPLIES = ["Can't talk now — I'll call you back.", "I'm in a meeting. I'll message you shortly.", 'Call you in 5 minutes.'];

/**
 * An incoming call (Chat, "Incoming WorkSuite call"; the ChatNotify card): its
 * own small window on top of everything, opened by the shell when the call
 * rings — whatever the person is doing and whichever screen they are on. The
 * bar along the bottom runs out when the call stops ringing. Dismiss only
 * stops it ringing here; Decline tells the caller.
 */
export function RingScreen() {
  const { query } = useTab();
  const uuid = query.get('uuid') ?? '';
  const roomId = query.get('room_id') ?? '';
  const locked = useStore(app, s => !!s.lock?.locked);
  const details = useStore(app, s => !!s.prefs?.lockedShowCallerDetails);
  const sounds = useStore(app, s => s.prefs?.notificationSounds ?? true);
  const prefs = useStore(app, s => s.prefs);
  const name = locked && !details ? 'Incoming caller' : query.get('name') ?? 'Someone';
  const where = locked && !details ? null : query.get('room');
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
    const minutes = new Date().getHours() * 60 + new Date().getMinutes();
    const time = (v: string) => { const [h, m] = v.split(':').map(Number); return (h ?? 0) * 60 + (m ?? 0); };
    const from = time(prefs?.dndFrom ?? '00:00'); const to = time(prefs?.dndTo ?? '00:00');
    const dnd = prefs?.dndEnabled && (from === to || (from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to));
    if (muted || !sounds || dnd || locked && (prefs?.lockedCallNotifications === false || prefs?.lockedNotificationSounds === false)) return;
    tone.current = playTone('ring', volume);
    return () => {
      tone.current?.stop();
      tone.current = null;
    };
  }, [muted, sounds, locked, prefs?.lockedAnswerCalls, prefs?.lockedNotificationSounds, prefs?.dndEnabled, prefs?.dndFrom, prefs?.dndTo]); // eslint-disable-line react-hooks/exhaustive-deps

  const decline = async () => {
    setBusy(true);
    await apiPost(`/api/chat/calls/${uuid}/decline`).catch(() => undefined);
    close();
  };

  const answer = async (withVideo: boolean) => {
    setBusy(true);
    tone.current?.stop();
    try {
      await answerCall(uuid, roomId, withVideo && !locked, where ? `${name} · ${where}` : name);
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
    <div role="alertdialog" aria-label="Incoming WorkSuite call" className="drag flex h-full flex-col bg-navy text-white" onKeyDown={(e) => e.key === 'Escape' && replying && setReplying(false)}>
      <div className="flex items-center gap-2 pt-3 pr-3 pl-4 text-[11.5px] font-semibold text-stage-accent">
        <BrandMark size={18} />
        <span className="flex-1">WorkSuite · Incoming {video ? 'video' : 'voice'} call</span>
        <span className="rounded-[9px] bg-white/10 px-2 py-0.5 text-[10.5px]">Always on top</span>
        <button type="button" aria-label="Dismiss" title="Stop ringing here" onClick={close} className="no-drag flex h-[26px] w-[26px] items-center justify-center rounded-full bg-white/8 text-stage-ink-2 hover:text-white">
          <Icon name="x" size={14} />
        </button>
      </div>
      <div className="flex items-center gap-3.5 px-4 pt-3 pb-3">
        <CallAvatar name={name} size={52} glow="incoming" />
        <div className="flex min-w-0 flex-col gap-[3px]">
          <span className="truncate text-[17px] font-bold">{name}</span>
          <span className="truncate text-[12.5px] text-stage-ink-2">
            {video ? 'Video call' : 'Voice call'}
            {where ? ` · ${where}` : ''}
          </span>
        </div>
      </div>
      {replying ? (
        <div className="no-drag flex min-h-0 flex-1 flex-col gap-1.5 px-4 pb-2">
          <div className="flex flex-wrap gap-1.5">
            {QUICK_REPLIES.map((r) => (
              <button key={r} type="button" disabled={busy} onClick={() => void reply(r)} className="max-w-full truncate rounded-[12px] bg-white/8 px-2.5 py-[5px] text-left text-[11.5px] font-semibold text-stage-ink hover:bg-white/14">
                {r}
              </button>
            ))}
          </div>
          <form
            className="mt-auto flex items-center gap-2 rounded-[12px] border border-indigo-bright bg-white/8 py-1 pr-1 pl-3"
            onSubmit={(e) => {
              e.preventDefault();
              void reply(text);
            }}
          >
            <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={`Reply to ${name.split(' ')[0]}…`} aria-label="Reply with a message" className="bare-focus h-8 min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-ink-4" />
            <button type="submit" aria-label="Send reply" disabled={busy || !text.trim()} className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-brand-soft text-white disabled:opacity-50">
              <Icon name="send" size={15} />
            </button>
          </form>
          <div className="flex justify-between text-[11px] text-ink-4">
            <span>Enter to send · the call is declined</span>
            <button type="button" onClick={() => setReplying(false)} className="font-semibold hover:text-white">
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="no-drag flex flex-1 flex-col gap-2.5 px-4 pb-2">
          <div className="flex gap-2.5">
            <button type="button" disabled={busy} onClick={() => void decline()} className="flex h-10 flex-1 items-center justify-center gap-2 rounded-[10px] bg-orange text-[13.5px] font-bold hover:bg-danger">
              <Icon name="phone-off" size={16} />
              Decline
            </button>
            <button type="button" disabled={busy || locked && !prefs?.lockedAnswerCalls} onClick={() => void answer(video)} className="flex h-10 flex-1 items-center justify-center gap-2 rounded-[10px] bg-success text-[13.5px] font-bold hover:bg-success">
              <Icon name={video ? 'video' : 'phone'} size={16} />
              {locked && !prefs?.lockedAnswerCalls ? 'Unlock to answer' : 'Answer'}
            </button>
          </div>
          <label className="flex items-center gap-2 text-[11.5px] text-stage-accent">
            <Icon name={muted ? 'volume-off' : 'volume'} size={14} />
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              disabled={muted}
              aria-label="Ringtone volume"
              onChange={(e) => {
                const v = Number(e.target.value);
                setVolume(v);
                saveRingVolume(v);
                tone.current?.setVolume(v);
              }}
              className="min-w-0 flex-1 accent-indigo-bright"
            />
            <button type="button" onClick={() => setMuted(!muted)} className="font-semibold whitespace-nowrap text-navy-ink hover:text-white">
              {muted ? 'Ringtone on' : 'Mute the ringtone'}
            </button>
          </label>
          <div className="mt-auto flex justify-center gap-4 text-[12px] font-semibold text-stage-accent">
            {video ? (
              <button type="button" disabled={busy || locked && !prefs?.lockedAnswerCalls} onClick={() => void answer(false)} className="hover:text-white">
                Answer with voice only
              </button>
            ) : null}
            <button type="button" disabled={locked && !prefs?.lockedAllowChat} onClick={() => locked ? void openChatWindow(Number(roomId), 'Chat').catch(e => toast('error', errorMessage(e))) : setReplying(true)} className="hover:text-white disabled:opacity-50">
              {locked ? prefs?.lockedAllowChat ? 'Open text chat' : 'Unlock to chat' : 'Reply with message…'}
            </button>
          </div>
        </div>
      )}
      <div className="h-[3px] shrink-0 bg-white/8" aria-hidden>
        <div className="animate-drain h-[3px] bg-indigo-bright" style={{ animationDuration: `${expires}s` }} />
      </div>
    </div>
  );
}
