import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Track } from 'livekit-client';
import { call, errorMessage } from '../../core/bridge';
import { useTab, useTabTitle } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { cx } from '../../components/ui';
import { formatClock, VoiceRecorder } from '../chat/parts';
import { Thread } from '../chat/Thread';
import { CallAvatar, Pill, useNow } from './parts';
import { ScreenPicker } from './ScreenPicker';
import { session, type CallParams } from './session';
import { CallWorkspace } from './ui/CallWorkspace';
import type { ControlButton, MenuEntry } from './ui/CoreCallControls';
import { personOf } from './ui/people';
import { callUi } from './ui/state';
import { playTone, ringVolume, saveRingVolume } from './tones';
import { VoiceWindow } from './VoiceWindow';

/** The call window (CallVoice for a voice call, CallVideo for video). */
export function CallScreen() {
  const { query } = useTab();
  useSyncExternalStore(session.subscribe, session.snapshot);
  const ui = useSyncExternalStore(callUi.subscribe, callUi.get);
  const [picking, setPicking] = useState<'start' | 'change' | null>(null);
  const [recording, setRecording] = useState(false);
  const [sent, setSent] = useState(false);
  const now = useNow();
  const video = query.get('mode') === 'video';
  const roomId = Number(query.get('room_id'));
  const s = session;
  const room = s.room;
  const lp = room?.localParticipant;
  const remotes = room ? [...room.remoteParticipants.values()] : [];
  const name = (remotes.length === 1 && remotes[0]!.name) || query.get('name') || 'Call';
  const clock = s.connectedAt ? formatClock((now - s.connectedAt) / 1000) : null;

  // Start once per window; a remount (StrictMode, a reload of the tree) finds it started.
  useEffect(() => {
    const p: CallParams = { roomId, mode: video ? 'video' : 'audio', name: query.get('name') ?? 'Call', uuid: query.get('uuid') ?? undefined };
    if (Number.isInteger(roomId) && roomId > 0) void session.start(p);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The caller hears it ring, as loud as they choose.
  const ringing = s.phase === 'ringing' && !!s.conn?.i_started;
  const [ringbackVolume, setRingbackVolume] = useState(ringVolume);
  const [ringbackMuted, setRingbackMuted] = useState(false);
  const tone = useRef<ReturnType<typeof playTone> | null>(null);
  useEffect(() => {
    if (!ringing || ringbackMuted) return;
    tone.current = playTone('ringback', ringVolume());
    return () => {
      tone.current?.stop();
      tone.current = null;
    };
  }, [ringing, ringbackMuted]);
  const ringback = {
    volume: ringbackMuted ? 0 : ringbackVolume,
    muted: ringbackMuted,
    setVolume: (v: number) => {
      setRingbackVolume(v);
      saveRingVolume(v);
      tone.current?.setVolume(v);
    },
    toggle: () => setRingbackMuted(!ringbackMuted),
  };

  const status = (() => {
    switch (s.phase) {
      case 'devices':
      case 'placing':
        return ['Connecting…', 'text-[#FDE68A]'];
      case 'ringing':
        return [s.conn?.i_started ? 'Ringing…' : 'Connecting…', s.conn?.i_started ? 'text-[#AFC0E8]' : 'text-[#FDE68A]'];
      case 'connected':
        return [`Connected · ${clock ?? '0:00'}`, 'text-[#9EE6C3]'];
      case 'ended':
        return [`Call ended${s.endedAfter ? ` · ${formatClock(s.endedAfter / 1000)}` : ''}`, 'text-[#AFC0E8]'];
      case 'unreachable':
        return [s.unreachable?.reason === 'busy' ? 'On another call' : s.unreachable?.reason === 'offline' ? 'Not available right now' : 'No answer', 'text-[#FFD2C4]'];
      default:
        return ['Connecting…', 'text-[#FDE68A]'];
    }
  })() as [string, string];
  useTabTitle(s.phase === 'connected' ? `Call in progress · ${name}` : video ? 'Video call' : 'Voice call');

  const openChat = () => void call('windows:open', { kind: 'chat-mini', route: `/chat?room=${roomId}`, title: name ?? 'Chat', alwaysOnTop: true });
  const muted = lp ? !lp.isMicrophoneEnabled : false;
  const camera = lp?.isCameraEnabled ?? false;
  const sharing = lp?.isScreenShareEnabled ?? false;
  const live = s.phase === 'connected' || s.phase === 'ringing';

  const problem = s.problem ? (
    <div className="no-drag self-stretch rounded-[12px] border border-[rgba(229,72,77,.35)] bg-[rgba(229,72,77,.16)] px-3 py-2.5 text-[12px] leading-normal text-[#FFD2C4]" role="alert">
      {s.problem.message}
      {s.problem.pane ? (
        <>
          <br />
          <button type="button" className="font-bold text-white hover:underline" onClick={() => void call('media:privacySettings', { pane: s.problem!.pane! })}>
            Open system {s.problem.pane === 'camera' ? 'camera' : 'sound'} settings
          </button>
        </>
      ) : null}
    </div>
  ) : null;

  const unreachable =
    s.phase === 'unreachable' ? (
      <div className="no-drag flex flex-col items-center gap-2 self-stretch text-center text-[12.5px] text-[#C3CEEA]">
        {s.unreachable?.voicemail && !sent ? (
          recording ? (
            <div className="self-stretch rounded-[10px] bg-surface px-2 py-1.5 text-ink">
              <VoiceRecorder
                onCancel={() => setRecording(false)}
                onDone={(blob, ms) => {
                  setRecording(false);
                  void s.voicemail(blob, ms).then(
                    () => (setSent(true), toast('success', 'Voice message sent.')),
                    (e) => toast('error', errorMessage(e)),
                  );
                }}
              />
            </div>
          ) : (
            <>
              <span>Leave a voice message? It is sent to the conversation.</span>
              <Pill on onClick={() => setRecording(true)}>Leave a voice message</Pill>
            </>
          )
        ) : sent ? (
          <span>Your voice message was sent.</span>
        ) : null}
      </div>
    ) : null;

  const picker = picking ? (
    <ScreenPicker
      changing={picking === 'change'}
      onClose={() => setPicking(null)}
      onPick={(pick) => {
        setPicking(null);
        void s.share(pick);
      }}
    />
  ) : null;

  // A voice call stays a voice call until somebody shows a picture: a camera
  // or a shared screen, on either side. Then it is the call surface, and the
  // shared screen gets the room it needs.
  const anyVideo = !!lp?.isCameraEnabled || sharing || remotes.some((p) => !!p.getTrackPublication(Track.Source.Camera)?.track || !!p.getTrackPublication(Track.Source.ScreenShare)?.track);
  if (!video && !anyVideo) {
    return (
      <VoiceWindow
        name={name}
        where={query.get('room')}
        status={status}
        clock={clock}
        ringing={ringing}
        onChat={openChat}
        onShare={() => (sharing ? void s.share(null) : setPicking('start'))}
        problem={problem}
        unreachable={unreachable}
        picker={picker}
        ringback={ringback}
      />
    );
  }

  const people = [...(lp ? [personOf(lp, true)] : []), ...remotes.map((p) => personOf(p, false))];
  const paused = s.sharePaused;
  const panelOn = (tab: string) => ui.panelOpen && ui.panelTab === tab;
  const buttons: ControlButton[] = live
    ? [
        { id: 'mic', icon: muted ? 'mic-off' : 'mic', label: muted ? 'Unmute' : 'Mute', tone: muted ? 'warn' : undefined, onClick: () => void s.toggleMic() },
        { id: 'sound', icon: s.sound ? 'volume' : 'volume-off', label: s.sound ? 'Turn sound off' : 'Turn sound on', tone: s.sound ? undefined : 'warn', onClick: () => s.toggleSound() },
        ...(s.phase === 'connected'
          ? ([
              { id: 'camera', icon: camera ? 'video' : 'video-off', label: camera ? 'Turn camera off' : 'Turn camera on', tone: camera ? undefined : 'warn', onClick: () => void s.toggleCamera() },
              sharing
                ? {
                    id: 'share',
                    icon: 'screen-share',
                    label: 'Sharing — options',
                    tone: 'active',
                    menu: [
                      { heading: `Sharing ${s.shareLabel ?? 'your screen'}` },
                      { label: 'Share something else', hint: 'Another screen or window, without stopping', icon: 'monitor', onClick: () => setPicking('change') },
                      { label: paused ? 'Resume sharing' : 'Pause sharing', hint: paused ? undefined : 'The other side sees "Screen sharing paused"', icon: paused ? 'play' : 'pause', onClick: () => void s.pauseShare(!paused) },
                      { label: 'Stop sharing', icon: 'stop', danger: true, onClick: () => void s.share(null) },
                    ],
                  }
                : { id: 'share', icon: 'screen-share', label: 'Share your screen', onClick: () => setPicking('start') },
            ] as ControlButton[])
          : []),
        ...(roomId > 0 ? [{ id: 'chat', icon: 'chat', label: panelOn('Chat') ? 'Hide chat' : 'Chat', tone: panelOn('Chat') ? ('active' as const) : undefined, onClick: () => callUi.togglePanel('Chat') }] : []),
      ]
    : [];
  const more: MenuEntry[] = s.phase === 'connected' ? [{ label: s.noise ? 'Noise suppression: on' : 'Noise suppression: off', icon: 'audio-lines', checked: s.noise, onClick: () => void s.toggleNoise() }] : [];

  const overlay =
    s.phase !== 'connected' ? (
      <div className="flex max-w-[420px] flex-col items-center gap-3 text-center">
        <CallAvatar name={name} size={130} glow={ringing ? 'ring' : null} />
        <b className="text-[18px]">{name}</b>
        <span className={cx('font-mono', status[1])}>{status[0]}</span>
        {problem}
        {unreachable}
        {s.phase === 'ended' || s.phase === 'unreachable' ? (
          <button type="button" onClick={() => void call('windows:close')} className="no-drag h-10 rounded-full bg-[#2A3A66] px-6 font-bold text-white hover:bg-[#344777]">
            Close
          </button>
        ) : s.phase === 'error' ? (
          <div className="flex gap-2">
            <button type="button" onClick={() => s.params && void s.start(s.params)} className="no-drag h-10 rounded-full bg-white px-5 font-bold text-[#0F1B3D]">Retry</button>
            <button type="button" onClick={() => void s.hangUp(false).then(() => call('windows:close'))} className="no-drag h-10 rounded-full bg-[#C4321C] px-5 font-bold text-white">End the call</button>
          </div>
        ) : null}
      </div>
    ) : s.problem ? (
      <div className="max-w-[420px]">{problem}</div>
    ) : null;

  return (
    <>
      <CallWorkspace
        title={s.phase === 'connected' ? `Call in progress · ${name}` : video ? 'Video call' : 'Voice call'}
        clock={clock}
        badges={s.phase === 'connected' && s.noise ? <span className="hidden rounded-full bg-[rgba(18,61,51,.85)] px-2 py-0.5 text-[11.5px] font-semibold text-[#9EE6C3] md:inline">Noise suppression on</span> : null}
        people={people}
        lastSpeaker={s.lastSpeaker}
        overlay={overlay}
        tabs={
          roomId > 0 && s.phase === 'connected'
            ? [
                {
                  id: 'Chat',
                  label: 'Conversation',
                  content: (
                    <div className="h-full">
                      <Thread roomId={String(roomId)} room={undefined} mini bare rooms={[]} />
                    </div>
                  ),
                },
              ]
            : []
        }
        buttons={buttons}
        more={more}
        end={{ label: s.phase === 'ringing' && s.conn?.i_started ? 'Cancel the call' : 'Hang up', onClick: () => void s.hangUp() }}
        status={sharing ? (paused ? `Sharing ${s.shareLabel ?? 'your screen'} — paused` : `You are sharing ${s.shareLabel ?? 'your screen'}`) : null}
      />
      {picker}
    </>
  );
}
