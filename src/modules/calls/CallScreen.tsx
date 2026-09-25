import { useEffect, useState, useSyncExternalStore } from 'react';
import { Track, type Participant } from 'livekit-client';
import { call, errorMessage } from '../../core/bridge';
import { useTab, useTabTitle } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { cx } from '../../components/ui';
import { formatClock, VoiceRecorder } from '../chat/parts';
import { Thread } from '../chat/Thread';
import { CallAvatar, Pill, useNow, VideoView } from './parts';
import { ScreenPicker } from './ScreenPicker';
import { session, type CallParams } from './session';
import { playTone } from './tones';

/** The call window (CallVoice for a voice call, CallVideo for video). */
export function CallScreen() {
  const { query } = useTab();
  useSyncExternalStore(session.subscribe, session.snapshot);
  const [picking, setPicking] = useState(false);
  const [chat, setChat] = useState(true);
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

  // The caller hears it ring.
  const ringing = s.phase === 'ringing' && !!s.conn?.i_started;
  useEffect(() => {
    if (!ringing) return;
    const tone = playTone('ringback');
    return () => tone.stop();
  }, [ringing]);

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
    <div className="no-drag self-stretch rounded-[10px] bg-[#3A1A14] px-3 py-2.5 text-[12px] leading-normal text-[#FFD2C4]" role="alert">
      {s.problem.message}
      {s.problem.pane ? (
        <>
          <br />
          <button type="button" className="font-bold text-[#AFC6FF] hover:text-white" onClick={() => void call('media:privacySettings', { pane: s.problem!.pane! })}>
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

  const controls = (
    <>
      {live ? <Pill warn={muted && video} on={muted && !video} onClick={() => void s.toggleMic()}>{muted ? 'Unmute' : 'Mute'}</Pill> : null}
      {live ? <Pill on={!s.sound} onClick={() => s.toggleSound()}>{video ? (s.sound ? 'Sound' : 'Sound off') : s.sound ? 'Speaker' : 'Speaker off'}</Pill> : null}
      {s.phase === 'connected' ? (
        <>
          <Pill warn={video && !camera} onClick={() => void s.toggleCamera()}>{video ? (camera ? 'Camera on' : 'Camera off') : camera ? 'Stop video' : 'Add video'}</Pill>
          <Pill on={sharing} onClick={() => (sharing ? void s.share(null) : setPicking(true))}>{sharing ? 'Stop sharing' : 'Share screen'}</Pill>
          <Pill onClick={() => void s.toggleNoise()}>{s.noise ? 'Noise off' : 'Noise on'}</Pill>
        </>
      ) : null}
      {s.phase === 'error' ? <Pill on onClick={() => s.params && void s.start(s.params)}>Retry</Pill> : null}
      {video && s.phase === 'connected' ? <Pill onClick={() => setChat(!chat)}>{chat ? 'Hide chat' : 'Chat'}</Pill> : <Pill onClick={openChat}>Chat</Pill>}
    </>
  );

  const end =
    s.phase === 'ended' || s.phase === 'unreachable' ? (
      <button type="button" onClick={() => void call('windows:close')} className="no-drag h-[46px] self-stretch rounded-[23px] bg-[#2A3A66] font-bold text-white">
        Close
      </button>
    ) : s.phase === 'error' ? (
      <button type="button" onClick={() => void s.hangUp(false).then(() => call('windows:close'))} className="no-drag h-[46px] self-stretch rounded-[23px] bg-[#C4321C] font-bold text-white">
        End the call
      </button>
    ) : (
      <button type="button" onClick={() => void s.hangUp()} className={cx('no-drag h-[46px] rounded-[23px] bg-[#C4321C] font-bold text-white hover:bg-[#A8291A]', video ? 'px-[22px]' : 'self-stretch')}>
        {s.phase === 'ringing' && s.conn?.i_started ? 'Cancel call' : 'Hang up'}
      </button>
    );

  const picker = picking ? (
    <ScreenPicker
      onClose={() => setPicking(false)}
      onPick={(id) => {
        setPicking(false);
        void s.share(id);
      }}
    />
  ) : null;

  if (!video) {
    const remoteVideo = remotes.map((p) => p.getTrackPublication(Track.Source.ScreenShare)?.track ?? p.getTrackPublication(Track.Source.Camera)?.track).find((t) => t && !t.isMuted);
    const speaking = remotes.some((p) => p.isSpeaking);
    return (
      <div className="flex h-full flex-col items-center gap-3 overflow-y-auto bg-[#0F1B3D] p-[18px] text-[13px] text-[#E6ECFA] scroll-thin">
        {remoteVideo ? (
          <VideoView track={remoteVideo} className="mt-2 aspect-video w-full rounded-[12px] bg-[#24365F] object-contain" />
        ) : (
          <span className="mt-[26px]">
            <CallAvatar name={name} size={104} glow={ringing ? 'ring' : speaking ? 'speaking' : null} />
          </span>
        )}
        <b className="text-center text-[19px] text-white">{name}</b>
        <span className={cx('font-mono', status[1])}>{status[0]}</span>
        {remotes.length > 1 ? <span className="text-[12px] text-[#AFC0E8]">{remotes.length + 1} in the call</span> : null}
        {problem}
        {unreachable}
        <span className="flex-1" />
        <div className="flex flex-wrap justify-center gap-2.5">{controls}</div>
        {end}
        {picker}
      </div>
    );
  }

  // Video: the stage shows a screen being shared first, else the people.
  const shared = remotes.map((p) => ({ p, t: p.getTrackPublication(Track.Source.ScreenShare)?.track })).find((x) => x.t);
  const cams = remotes.map((p) => ({ p, t: p.getTrackPublication(Track.Source.Camera)?.track }));
  const self = lp?.getTrackPublication(Track.Source.Camera)?.track;
  return (
    <div className="flex h-full bg-[#0B1226] text-[13px] text-[#E6ECFA]">
      <div className="flex min-w-0 flex-1 flex-col gap-3.5 p-4">
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-[14px] bg-[#24365F]">
          {shared?.t ? (
            <VideoView track={shared.t} className="h-full w-full object-contain" />
          ) : cams.length > 1 ? (
            <div className="grid h-full gap-2 p-2" style={{ gridTemplateColumns: `repeat(${cams.length > 4 ? 3 : 2}, minmax(0, 1fr))` }}>
              {cams.map(({ p, t }) => <Tile key={p.identity} p={p} track={t} />)}
            </div>
          ) : cams[0]?.t && !cams[0].t.isMuted ? (
            <VideoView track={cams[0].t} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <CallAvatar name={name} size={160} glow={ringing ? 'ring' : cams[0]?.p.isSpeaking ? 'speaking' : null} />
              {s.phase !== 'connected' ? <span className={cx('font-mono', status[1])}>{status[0]}</span> : <span className="text-[#AFC0E8]">Camera off</span>}
            </div>
          )}
          <div className="absolute top-4 left-4 flex flex-wrap gap-2">
            <span className="rounded-[8px] bg-[rgba(11,18,38,.7)] px-2.5 py-[5px] font-bold">{name}</span>
            <span className={cx('rounded-[8px] bg-[rgba(11,18,38,.7)] px-2.5 py-[5px] font-mono', status[1])}>{status[0]}</span>
            {s.phase === 'connected' && s.noise ? <span className="rounded-[8px] bg-[rgba(18,61,51,.85)] px-2.5 py-[5px] font-semibold text-[#9EE6C3]">Noise cancellation is on</span> : null}
          </div>
          {self && camera ? (
            <div className="absolute right-4 bottom-4 h-[136px] w-[220px] overflow-hidden rounded-[10px] border-2 border-[#7FA2FF] bg-[#3A4B7A]">
              <VideoView track={self} mirror className="h-full w-full object-cover" />
              <span className="absolute bottom-2 left-2 rounded-[6px] bg-[rgba(11,18,38,.7)] px-2 py-[3px] text-[12px] font-semibold">You</span>
            </div>
          ) : null}
          {shared ? (
            <div className="absolute bottom-4 left-4 rounded-[8px] bg-[rgba(11,18,38,.8)] px-3 py-2 text-[12px]">
              {shared.p.name || 'Someone'} is sharing their screen
            </div>
          ) : sharing ? (
            <div className="absolute bottom-4 left-4 rounded-[8px] bg-[rgba(11,18,38,.8)] px-3 py-2 text-[12px]">You are sharing your screen</div>
          ) : null}
          {s.problem || s.phase === 'unreachable' ? (
            <div className="absolute inset-x-4 top-16 mx-auto flex max-w-[420px] flex-col gap-3">
              {problem}
              {unreachable}
            </div>
          ) : null}
        </div>
        <div role="toolbar" aria-label="Call controls" className="flex flex-wrap items-center justify-center gap-2.5 self-center rounded-2xl bg-[#16254F] px-3.5 py-2.5">
          {controls}
          {end}
        </div>
      </div>
      {chat && roomId > 0 && s.phase === 'connected' ? (
        <aside aria-label="Conversation" className="flex w-[330px] shrink-0 flex-col bg-surface text-ink">
          <div className="flex h-12 items-center border-b border-line px-3.5">
            <b className="flex-1">Conversation</b>
            <button type="button" aria-label="Hide the conversation" onClick={() => setChat(false)} className="text-[16px] text-ink-2 hover:text-ink">
              ×
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <Thread roomId={String(roomId)} room={undefined} mini bare rooms={[]} />
          </div>
        </aside>
      ) : null}
      {picker}
    </div>
  );
}

function Tile({ p, track }: { p: Participant; track: Track | undefined }) {
  return (
    <div className={cx('relative flex items-center justify-center overflow-hidden rounded-[12px] bg-[#2F4A7A]', p.isSpeaking && 'shadow-[inset_0_0_0_3px_#3DD68C]')}>
      {track && !track.isMuted ? <VideoView track={track} className="h-full w-full object-cover" /> : <CallAvatar name={p.name || p.identity} size={84} />}
      <span className="absolute bottom-2 left-2 rounded-[6px] bg-[rgba(11,18,38,.7)] px-2 py-[3px] text-[12px] font-semibold">
        {p.name || 'Guest'}
        {!p.isMicrophoneEnabled ? ' · Muted' : ''}
      </span>
    </div>
  );
}
