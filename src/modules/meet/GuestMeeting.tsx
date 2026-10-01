import { useEffect, useRef, useState } from 'react';
import { DisconnectReason, Room, RoomEvent, Track, type Participant, type Track as MediaTrack } from 'livekit-client';
import type { GuestMeetInfo } from '@shared/guest-meet';
import { Button, Spinner } from '../../components/ui';
import { call, errorMessage } from '../../core/bridge';
import { DeviceSettings, Preview, useMeetDevices } from './devices';
import { GuestChat, guestWaiting } from './GuestChat';
import { GuestJoinForm } from './GuestJoinForm';

type Phase = 'loading' | 'lobby' | 'joining' | 'waiting' | 'in' | 'left' | 'ended' | 'removed' | 'error';
export function GuestMeeting() {
  const [info, setInfo] = useState<GuestMeetInfo | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [name, setName] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  const [farewell, setFarewell] = useState('You left the meeting.');
  const [room, setRoom] = useState<Room | null>(null);
  const connection = useRef<Room | null>(null);
  const mounted = useRef(true);
  const [another, setAnother] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [, update] = useState(0);
  const d = useMeetDevices(phase === 'lobby', { startOff: true });
  const load = async () => {
    try {
      const next = await call('guest:info');
      if (!mounted.current) return;
      setInfo(next); setError('');
      setPhase(next.ended ? 'ended' : 'lobby');
      if (next.ended) setFarewell('This meeting has ended.');
    } catch (e) { if (mounted.current) { setError(errorMessage(e)); setPhase('error'); } }
  };
  useEffect(() => {
    mounted.current = true;
    queueMicrotask(() => { if (mounted.current) void load(); });
    return () => { mounted.current = false; const active = connection.current; connection.current = null; void active?.disconnect(); };
  }, []);
  // Public policy only; failure disables guest chat until it can be verified again.
  useEffect(() => {
    if (!room) return;
    let active = true;
    const timer = setInterval(() => {
      void call('guest:info').then((next) => { if (active) setInfo(next); }, () => { if (active) setInfo((old) => old ? { ...old, chat: 'off' } : null); });
    }, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [room]);
  const join = async () => {
    if (!info || !name.trim() || phase !== 'lobby' || info.locked || !info.guests || info.ended) return;
    setPhase('joining'); setError('');
    let active: Room | null = null;
    try {
      const token = await call('guest:join', { name: name.trim(), pass: pass || undefined });
      if (!mounted.current) return;
      active = new Room({ audioCaptureDefaults: { deviceId: d.prefs.micId || undefined }, videoCaptureDefaults: { deviceId: d.prefs.camId || undefined }, audioOutput: d.prefs.speakerId ? { deviceId: d.prefs.speakerId } : undefined });
      const session = active;
      connection.current = session;
      const refresh = () => update((n) => n + 1);
      let admitted = false;
      const enter = async () => {
        if (connection.current !== session || !session.localParticipant.permissions?.canPublish || guestWaiting(session.localParticipant)) return;
        setPhase('in');
        if (admitted) return;
        admitted = true;
        try { await session.localParticipant.setMicrophoneEnabled(d.prefs.mic); await session.localParticipant.setCameraEnabled(d.prefs.cam); }
        catch (e) { setError(errorMessage(e)); }
      };
      session.on(RoomEvent.ParticipantPermissionsChanged, (_previous, participant) => { refresh(); if (participant === session.localParticipant) void enter(); })
        .on(RoomEvent.ParticipantMetadataChanged, (_previous, participant) => { refresh(); if (participant === session.localParticipant) void enter(); })
        .on(RoomEvent.ParticipantConnected, refresh).on(RoomEvent.ParticipantDisconnected, refresh)
        .on(RoomEvent.TrackSubscribed, refresh).on(RoomEvent.TrackUnsubscribed, refresh)
        .on(RoomEvent.LocalTrackPublished, refresh).on(RoomEvent.LocalTrackUnpublished, refresh)
        .on(RoomEvent.TrackMuted, refresh).on(RoomEvent.TrackUnmuted, refresh)
        .on(RoomEvent.Reconnecting, () => setReconnecting(true)).on(RoomEvent.Reconnected, () => setReconnecting(false))
        .on(RoomEvent.Disconnected, (reason) => {
          if (connection.current !== session) return;
          connection.current = null; setRoom(null); setReconnecting(false);
          setPhase(reason === DisconnectReason.ROOM_DELETED ? 'ended' : reason === DisconnectReason.PARTICIPANT_REMOVED ? 'removed' : 'left');
          setFarewell(reason === DisconnectReason.ROOM_DELETED ? 'The host ended the meeting.' : reason === DisconnectReason.PARTICIPANT_REMOVED ? 'The host removed you or declined your request.' : 'Connection lost. You can rejoin without creating an account.');
        });
      await session.connect(token.url, token.token);
      if (connection.current !== session || !mounted.current) { await session.disconnect(); return; }
      setRoom(session);
      if (guestWaiting(session.localParticipant) || !session.localParticipant.permissions?.canPublish) setPhase('waiting');
      else await enter();
    } catch (e) {
      if (active) { connection.current = null; await active.disconnect(); }
      if (mounted.current) { setRoom(null); setError(errorMessage(e)); setPhase('lobby'); }
    }
  };
  const leave = async () => {
    const active = connection.current; connection.current = null;
    await active?.disconnect(); setRoom(null); setPhase('left'); setFarewell('You left the meeting.');
  };
  const run = (action: Promise<unknown>) => void action.catch((e) => setError(errorMessage(e)));
  const sources = useState<Awaited<ReturnType<typeof call<'media:screenSources'>>> | null>(null);
  const sharingAllowed = room?.localParticipant.permissions?.canPublishSources?.includes(3 /* TrackSource.SCREEN_SHARE */) === true;
  const sharing = room?.localParticipant.isScreenShareEnabled === true;
  const pick = async (id: string) => {
    if (!room || !sharingAllowed) return;
    try { await call('media:screenPick', { id, audio: false }); await room.localParticipant.setScreenShareEnabled(true, { audio: false }); sources[1](null); }
    catch (e) { setError(errorMessage(e)); }
  };
  const terminal = ['left', 'ended', 'removed', 'error'].includes(phase);
  return <main className="flex h-full flex-col overflow-y-auto bg-ground p-5 text-ink">
    <header className="drag mb-4 flex items-center justify-between gap-4 pl-16"><h1 className="font-bold">{info?.title || 'WorkSuite Meet'} · Guest</h1><Button className="no-drag" size="sm" onClick={() => run(call('windows:close'))}>Close</Button></header>
    {phase === 'loading' ? <Spinner /> : null}
    {error ? <p role="alert" className="mb-3 text-danger">{error}</p> : null}
    {another ? <GuestJoinForm server={info?.origin} onBack={() => setAnother(false)} onOpened={() => run(call('windows:close'))} /> : terminal ? <section className="flex flex-col gap-4">
      <h2>{farewell}</h2>
      {phase === 'left' || phase === 'error' ? <Button onClick={() => void load()}>Rejoin</Button> : null}
      <Button onClick={() => setAnother(true)}>Join Another Meeting</Button>
      <Button variant="ghost" onClick={() => run(call('guest:signIn'))}>Sign In</Button>
    </section> : phase === 'lobby' || phase === 'joining' ? <section className="grid gap-6 md:grid-cols-2">
      <div><Preview d={d} name={name} /><DeviceSettings d={d} /></div>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void join(); }}>
        <h2 className="text-xl font-bold">Check your devices before joining</h2>
        {info?.host_name ? <p>Organized by {info.host_name}</p> : null}
        <label>Your display name<input className="mt-1 block w-full rounded border border-line bg-surface p-3" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} disabled={phase === 'joining'} required /></label>
        {info?.needs_passcode ? <label>Passcode<input className="mt-1 block w-full rounded border border-line bg-surface p-3" type="password" value={pass} onChange={(e) => setPass(e.target.value)} maxLength={128} required /></label> : null}
        {info?.locked ? <p>The host has locked this meeting.</p> : !info?.guests ? <p>Guest access is disabled. Sign in to join.</p> : null}
        <Button type="submit" loading={phase === 'joining'} disabled={!name.trim() || !!info?.locked || !info?.guests || (info.needs_passcode && !pass.trim())}>Join as Guest</Button>
        <p className="text-ink-3">The host controls admission and meeting permissions.</p>
      </form>
    </section> : room ? <>
      {reconnecting ? <p role="status">Reconnecting… Your guest session is being restored.</p> : null}
      {phase === 'waiting' ? <p role="status">Waiting for the host to let you in. Your camera and microphone are not shared.</p> : <>
        <div className="mb-4 flex flex-wrap gap-2">
          <Button onClick={() => run(room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled))}>{room.localParticipant.isMicrophoneEnabled ? 'Mute' : 'Unmute'}</Button>
          <Button onClick={() => run(room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled))}>{room.localParticipant.isCameraEnabled ? 'Camera off' : 'Camera on'}</Button>
          {sharing ? <Button onClick={() => run(room.localParticipant.setScreenShareEnabled(false))}>Stop sharing</Button> : sharingAllowed ? <Button onClick={() => run(call('media:screenSources').then(sources[1]))}>Share screen</Button> : <span>The host controls screen sharing.</span>}
        </div>
        {sources[0] ? <section><h2>Choose what to share</h2>{sources[0].sources.map((source) => <Button key={source.id} onClick={() => void pick(source.id)}>{source.name}</Button>)}<Button onClick={() => sources[1](null)}>Cancel</Button></section> : null}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{[room.localParticipant, ...room.remoteParticipants.values()].filter((p) => !guestWaiting(p)).map((p) => <GuestParticipant key={p.identity} participant={p} />)}</div>
        <section className="mt-4"><h2 className="font-bold">People</h2>{[room.localParticipant, ...room.remoteParticipants.values()].filter((p) => !guestWaiting(p)).map((p) => <p key={p.identity}>{p.name || 'Participant'}{p.identity.startsWith('g-') ? ' · Guest' : ''}</p>)}</section>
        <GuestChat room={room} chat={info?.chat ?? null} />
      </>}
      <Button className="mt-4" variant="danger" onClick={() => void leave()}>Leave meeting</Button>
    </> : null}
  </main>;
}
function GuestParticipant({ participant }: { participant: Participant }) {
  const tracks = [...participant.trackPublications.values()].filter((pub) => pub.track && !pub.isMuted);
  return <section className="rounded border border-line bg-surface p-3"><b>{participant.name || 'Participant'}{participant.identity.startsWith('g-') ? ' · Guest' : ''}</b>{tracks.map((pub) => <GuestTrack key={pub.trackSid} track={pub.track!} local={participant.isLocal} />)}</section>;
}
function GuestTrack({ track, local }: { track: MediaTrack; local: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (local && track.kind === Track.Kind.Audio) return;
    const el = track.attach();
    if (el instanceof HTMLVideoElement) { el.className = 'w-full rounded'; el.muted = local; }
    container.current?.appendChild(el);
    return () => { track.detach(el); el.remove(); };
  }, [track, local]);
  return <div ref={container} />;
}
