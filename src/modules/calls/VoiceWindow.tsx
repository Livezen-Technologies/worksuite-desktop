import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Track } from 'livekit-client';
import { call, isMac } from '../../core/bridge';
import { Icon } from '../../components/Icon';
import { cx, initials } from '../../components/ui';
import { formatClock } from '../chat/parts';
import { RoundButton, VideoView, Wave } from './parts';
import { session } from './session';

/**
 * A voice call's window (CallWindow, CallVoice): the person on the dark
 * gradient, how the call is going, and the controls on a frosted panel —
 * outgoing, in the call, can't connect, ended. It can shrink to a bar that
 * floats over other apps ("Minimised") and come back.
 */
export interface Ringback {
  volume: number;
  muted: boolean;
  setVolume: (v: number) => void;
  toggle: () => void;
}

const GRADIENT = 'radial-gradient(120% 70% at 50% 25%, var(--ws-call-glow, #23407A) 0%, var(--ws-call-mid, #13224A) 45%, var(--ws-call-base, #0B1530) 100%)';

export function VoiceWindow({
  name,
  where,
  status,
  clock,
  ringing,
  onChat,
  onShare,
  problem,
  unreachable,
  picker,
  ringback,
}: {
  name: string;
  where: string | null;
  status: [string, string];
  clock: string | null;
  ringing: boolean;
  onChat: () => void;
  onShare: () => void;
  problem: ReactNode;
  unreachable: ReactNode;
  picker: ReactNode;
  ringback: Ringback;
}) {
  useSyncExternalStore(session.subscribe, session.snapshot);
  const s = session;
  const [pinned, setPinned] = useState(true);
  const [compact, setCompact] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [audioMenu, setAudioMenu] = useState(false);
  const lp = s.room?.localParticipant;
  const remotes = s.room ? [...s.room.remoteParticipants.values()] : [];
  const muted = lp ? !lp.isMicrophoneEnabled : false;
  const camera = lp?.isCameraEnabled ?? false;
  const sharing = lp?.isScreenShareEnabled ?? false;
  const speaking = remotes.some((p) => p.isSpeaking) || !!lp?.isSpeaking;
  const connected = s.phase === 'connected';
  const outgoing = ((s.phase === 'calling' || s.phase === 'ringing') && !!s.conn?.i_started) || ((s.phase === 'placing' || s.phase === 'devices') && !s.params?.uuid);
  const steady = connected && !s.reconnecting && !s.remoteLost;
  const remoteVideo = remotes.map((p) => p.getTrackPublication(Track.Source.ScreenShare)?.track ?? p.getTrackPublication(Track.Source.Camera)?.track).find((t) => t && !t.isMuted);

  useEffect(() => {
    void call('windows:state').then((w) => (setPinned(w.alwaysOnTop), setMaximized(w.maximized)), () => undefined);
  }, []);
  // A call that ends while shrunk comes back to full size to say so.
  useEffect(() => {
    if (compact && (s.phase === 'ended' || s.phase === 'unreachable' || s.phase === 'error')) {
      void call('windows:setCompact', { value: false }).then(setCompact, () => undefined);
    }
  }, [compact, s.phase]);

  const shrink = (value: boolean) => void call('windows:setCompact', { value }).then(setCompact, () => undefined);
  const title =
    s.phase === 'ended' ? `Call ended · ${name}` : connected ? `Call in progress · ${name}` : outgoing ? 'Outgoing voice call' : 'Voice call';

  if (compact) {
    return (
      <div role="dialog" aria-label="Call in progress" className="drag flex h-full items-center gap-2.5 bg-[#0F1B3D] pr-2.5 pl-3 text-white" style={{ paddingRight: isMac ? 10 : 140 }}>
        <span className={cx('flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-[#E3F4F5] text-[13px] font-bold text-[#0B6770]', connected && 'shadow-[0_0_0_2px_#3DD68C]')}>{initials(name)}</span>
        <button type="button" onClick={() => shrink(false)} title="Open the call window" className="no-drag flex min-w-0 flex-1 flex-col text-left">
          <b className="truncate text-[13px]">{name}</b>
          <span className={cx('truncate text-[11.5px] tabular-nums', steady ? 'text-[#9EE6C3]' : 'text-[#C9D3EE]')}>
            {steady ? `${clock ?? '0:00'}${muted ? ' · muted' : ''}` : status[0]}
          </span>
        </button>
        <button type="button" aria-label={muted ? 'Unmute' : 'Mute'} onClick={() => void s.toggleMic()} className={cx('no-drag flex h-9 w-9 shrink-0 items-center justify-center rounded-full', muted ? 'bg-white text-[#0F1B3D]' : 'bg-white/12 text-white')}>
          <Icon name={muted ? 'mic-off' : 'mic'} size={17} />
        </button>
        <button type="button" aria-label="Open call window" onClick={() => shrink(false)} className="no-drag flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/12 text-white">
          <Icon name="maximize" size={16} />
        </button>
        <button type="button" aria-label="Hang up" onClick={() => void s.hangUp()} className="no-drag flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#E5484D] text-white">
          <Icon name="phone-off" size={17} />
        </button>
      </div>
    );
  }

  const bar = (
    <div className="drag flex h-11 shrink-0 items-center gap-2 pr-2.5" style={{ paddingLeft: isMac ? 78 : 14, paddingRight: isMac ? 10 : 140 }}>
      <span className="flex min-w-0 flex-1 items-center justify-center gap-1.5 text-[12.5px] font-semibold text-[#C9D3EE]">
        <Icon name="lock" size={12} />
        <span className="truncate">{title}</span>
      </span>
      <button
        type="button"
        aria-label="Keep on top"
        aria-pressed={pinned}
        title="Keep on top"
        onClick={() => void call('windows:setAlwaysOnTop', { value: !pinned }).then(setPinned)}
        className={cx('no-drag flex h-[30px] w-[30px] items-center justify-center rounded-[8px]', pinned ? 'bg-white/16 text-white' : 'text-[#8FA0CC] hover:text-white')}
      >
        <Icon name="pin" size={14} />
      </button>
      {s.phase !== 'ended' ? (
        <button type="button" aria-label="Minimise" title="Shrink to a bar that stays on top" onClick={() => shrink(true)} className="no-drag flex h-[30px] w-[30px] items-center justify-center rounded-[8px] text-[#C9D3EE] hover:text-white">
          <Icon name="minimize" size={14} />
        </button>
      ) : null}
      <button
        type="button"
        aria-label={maximized ? 'Restore the window' : 'Maximise the window'}
        title={maximized ? 'Restore' : 'Maximise'}
        onClick={() => void call('windows:toggleMaximize').then(setMaximized, () => undefined)}
        className="no-drag flex h-[30px] w-[30px] items-center justify-center rounded-[8px] text-[#C9D3EE] hover:text-white"
      >
        <Icon name={maximized ? 'app-window' : 'maximize'} size={14} />
      </button>
    </div>
  );

  if (s.phase === 'ended') {
    return (
      <div role="dialog" aria-label="Call ended" className="flex h-full flex-col text-white" style={{ background: GRADIENT }} onMouseMove={() => s.stay()}>
        {bar}
        <div className="flex flex-1 flex-col items-center justify-center gap-2.5 pb-10">
          <span className="flex h-[110px] w-[110px] items-center justify-center rounded-full bg-[rgba(227,244,245,.5)] text-[36px] font-bold text-[#0B6770]">{initials(name)}</span>
          <b className="text-[20px]">Call ended</b>
          <span className="text-[13px] text-[#AFC0E8]">
            {name}
            {s.endedAfter ? ` · ${formatClock(s.endedAfter / 1000)}` : ''}
          </span>
          <div className="mt-[22px] flex gap-2">
            <RoundButton icon="phone" label="Call again" tone="green" onClick={() => void s.again()} />
            <RoundButton icon="chat" label="Message" onClick={() => (onChat(), void call('windows:close'))} />
            <RoundButton icon="minus" label="Close" onClick={() => void call('windows:close')} />
          </div>
        </div>
      </div>
    );
  }

  const glow = muted || !connected ? (outgoing ? '0 0 0 12px rgba(127,162,255,.16), 0 0 0 26px rgba(127,162,255,.08), 0 0 0 42px rgba(127,162,255,.04)' : 'none') : speaking ? '0 0 0 10px rgba(61,214,140,.18), 0 0 0 22px rgba(61,214,140,.08)' : '0 0 0 10px rgba(61,214,140,.1), 0 0 0 22px rgba(61,214,140,.04)';

  return (
    <div role="dialog" aria-label={title} className="flex h-full flex-col overflow-hidden text-white" style={{ background: GRADIENT }}>
      {bar}
      <div className="flex min-h-0 flex-1 flex-col items-center gap-2.5 overflow-y-auto px-[18px] pt-[34px] pb-3 scroll-thin">
        {remoteVideo ? (
          <VideoView track={remoteVideo} className="aspect-video w-full rounded-[12px] bg-[#24365F] object-contain" />
        ) : (
          <span className="relative flex h-[120px] w-[120px] shrink-0 items-center justify-center rounded-full bg-[#E3F4F5] text-[38px] font-bold text-[#0B6770] transition-shadow" style={{ boxShadow: glow }} aria-hidden>
            {initials(name)}
            {muted ? (
              <span className="absolute right-1 bottom-1 flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-[#13224A] bg-[#0F1B3D] text-[#FFD9A8]">
                <Icon name="mic-off" size={14} />
              </span>
            ) : null}
          </span>
        )}
        <b className="mt-3.5 max-w-full truncate text-center text-[22px] tracking-[-0.2px]">{name}</b>
        {where && !connected ? <span className="text-[12.5px] text-[#AFC0E8]">{where}</span> : null}
        <span role="status" className={cx('flex items-center gap-1.5 text-[13.5px] font-semibold tabular-nums', steady ? 'text-[#9EE6C3]' : outgoing ? 'text-[#C9D3EE]' : status[1])}>
          {steady ? <span className="h-[7px] w-[7px] rounded-full bg-[#3DD68C]" /> : null}
          {status[0]}
        </span>
        {remotes.length > 1 ? <span className="text-[12px] text-[#AFC0E8]">{remotes.length + 1} in the call</span> : null}
        {connected ? <Wave live={speaking} muted={muted} /> : null}
        {connected && muted ? (
          <span className="flex items-center gap-1.5 rounded-[12px] bg-white/10 px-2.5 py-1 text-[11.5px] text-[#FFD9A8]">
            <Icon name="mic-off" size={13} />
            You are muted
          </span>
        ) : null}
        {connected && s.noise ? <span className="rounded-[12px] bg-[rgba(61,214,140,.14)] px-2.5 py-1 text-[11.5px] text-[#9EE6C3]">Noise suppression on</span> : null}
        {ringing ? (
          <label className="mt-3.5 flex w-[250px] items-center gap-2 text-[11.5px] text-[#AFC0E8]">
            <Icon name={ringback.muted ? 'volume-off' : 'volume'} size={14} />
            <input type="range" min={0} max={1} step={0.05} value={ringback.volume} aria-label="Ringtone" disabled={ringback.muted} onChange={(e) => ringback.setVolume(Number(e.target.value))} className="no-drag min-w-0 flex-1 accent-[#7FA2FF]" />
            <button type="button" onClick={ringback.toggle} className="no-drag font-semibold whitespace-nowrap text-[#C9D3EE] hover:text-white">
              {ringback.muted ? 'Ringtone on' : 'Mute the ringtone'}
            </button>
          </label>
        ) : null}
        <div className="w-full">{problem}</div>
        {unreachable}
      </div>
      <div className="mx-3 mb-3.5 flex shrink-0 flex-col items-center gap-3.5 rounded-[22px] bg-white/7 px-1.5 pt-3.5 pb-3 backdrop-blur-[8px]">
        {s.phase === 'error' ? (
          <div className="flex justify-center gap-0.5">
            <RoundButton icon="refresh" label="Retry" tone="white" size={52} onClick={() => s.params && void s.start(s.params)} />
            <RoundButton icon="chat" label="Chat" size={52} onClick={onChat} />
            <RoundButton icon="phone-off" label="End the call" tone="red" size={60} onClick={() => void s.hangUp(false).then(() => call('windows:close'))} />
          </div>
        ) : s.phase === 'unreachable' ? (
          <div className="flex justify-center gap-0.5">
            <RoundButton icon="phone" label="Call again" tone="green" size={52} onClick={() => void s.again()} />
            <RoundButton icon="chat" label="Chat" size={52} onClick={onChat} />
            <RoundButton icon="x" label="Close" size={52} onClick={() => void call('windows:close')} />
          </div>
        ) : connected ? (
          <>
            <div className="grid grid-cols-[repeat(3,74px)] justify-center gap-x-[18px] gap-y-3">
              <RoundButton icon={muted ? 'mic-off' : 'mic'} label={muted ? 'Unmute' : 'Mute'} tone={muted ? 'white' : 'dim'} pressed={muted} onClick={() => void s.toggleMic()} />
              <RoundButton icon={s.sound ? 'volume' : 'volume-off'} label={s.sound ? 'Speaker' : 'Speaker off'} tone={s.sound ? 'dim' : 'white'} pressed={!s.sound} onClick={() => s.toggleSound()} />
              <RoundButton icon={camera ? 'video-off' : 'video'} label={camera ? 'Stop video' : 'Add video'} tone={camera ? 'white' : 'dim'} pressed={camera} onClick={() => void s.toggleCamera()} />
              <RoundButton icon="screen-share" label={sharing ? 'Stop sharing' : 'Share screen'} tone={sharing ? 'white' : 'dim'} pressed={sharing} onClick={onShare} />
              <span className="relative">
                <RoundButton icon="audio-lines" label="Audio" pressed={audioMenu} onClick={() => (setAudioMenu(!audioMenu), void s.listSpeakers())} />
                {audioMenu ? <AudioMenu onClose={() => setAudioMenu(false)} /> : null}
              </span>
              <RoundButton icon="chat" label="Chat" onClick={onChat} />
            </div>
            <RoundButton icon="phone-off" label="Hang up" tone="red" size={64} onClick={() => void s.hangUp()} />
          </>
        ) : (
          <>
            <div className="flex justify-center gap-0.5">
              <RoundButton icon={muted ? 'mic-off' : 'mic'} label={muted ? 'Unmute' : 'Mute'} tone={muted ? 'white' : 'dim'} size={52} disabled={!lp} onClick={() => void s.toggleMic()} />
              <RoundButton icon={s.sound ? 'volume' : 'volume-off'} label={s.sound ? 'Speaker' : 'Speaker off'} tone={s.sound ? 'dim' : 'white'} size={52} onClick={() => s.toggleSound()} />
              <RoundButton icon="chat" label="Chat" size={52} onClick={onChat} />
            </div>
            <RoundButton icon="phone-off" label={outgoing ? 'Cancel call' : 'Hang up'} tone="red" size={60} onClick={() => void s.hangUp()} />
          </>
        )}
      </div>
      {picker}
    </div>
  );
}

/** The voice window's Audio menu: which speaker the call plays through, and noise suppression. */
function AudioMenu({ onClose }: { onClose: () => void }) {
  useSyncExternalStore(session.subscribe, session.snapshot);
  const s = session;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => !ref.current?.parentElement?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);
  const item = 'no-drag flex h-8 w-full items-center gap-2 rounded-[8px] px-2.5 text-left text-[12.5px] text-white hover:bg-white/10';
  const pick = (id: string) => void s.setSpeaker(id);
  return (
    <div ref={ref} role="menu" aria-label="Audio" className="absolute bottom-[calc(100%+6px)] left-1/2 z-20 w-60 -translate-x-1/2 rounded-[12px] bg-[#13224A] p-1.5 shadow-[0_16px_40px_rgba(0,0,0,.45)]">
      <div className="px-2.5 pt-1 pb-1 text-[10.5px] font-bold tracking-[0.6px] text-[#8FA0CC] uppercase">Speaker</div>
      {[{ deviceId: '', label: 'System default' }, ...s.speakers.map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Speaker ${i + 1}` }))].map((d) => (
        <button key={d.deviceId || 'default'} type="button" role="menuitemradio" aria-checked={s.speakerId === d.deviceId} onClick={() => pick(d.deviceId)} className={item}>
          <Icon name={s.speakerId === d.deviceId ? 'check' : 'volume'} size={14} className={s.speakerId === d.deviceId ? 'text-[#9EE6C3]' : 'text-[#8FA0CC]'} />
          <span className="truncate">{d.label}</span>
        </button>
      ))}
      <div className="my-1 h-px bg-white/10" />
      <button type="button" role="menuitemcheckbox" aria-checked={s.noise} onClick={() => void s.toggleNoise()} className={item}>
        <Icon name="audio-lines" size={14} className={s.noise ? 'text-[#9EE6C3]' : 'text-[#8FA0CC]'} />
        <span className="flex-1">Noise suppression</span>
        <span className="text-[11px] text-[#AFC0E8]">{s.noise ? 'On' : 'Off'}</span>
      </button>
    </div>
  );
}
