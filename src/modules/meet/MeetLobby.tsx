import { useEffect, useRef, useState } from 'react';
import { createLocalAudioTrack, createLocalVideoTrack, Room, type LocalAudioTrack, type LocalVideoTrack } from 'livekit-client';
import { app } from '../../core/app-state';
import { call } from '../../core/bridge';
import { useStore } from '../../core/store';
import { timeLabel } from '../../core/time';
import { Avatar, cx } from '../../components/ui';
import { VideoView } from '../calls/parts';
import { CLEAN_AUDIO, deviceProblem } from '../calls/session';
import { meet } from './session';

type Devices = Record<'audioinput' | 'videoinput' | 'audiooutput', MediaDeviceInfo[]>;

/** Ready to join? (MeetLobby): see yourself, pick devices, then in — or knock. */
export function MeetLobby() {
  const info = meet.info!;
  const name = useStore(app, (s) => s.auth?.user?.name ?? '');
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(info.mode !== 'audio');
  const [devices, setDevices] = useState<Devices>({ audioinput: [], videoinput: [], audiooutput: [] });
  const [micId, setMicId] = useState<string>('');
  const [camId, setCamId] = useState<string>('');
  const [speakerId, setSpeakerId] = useState<string>('');
  const [passcode, setPasscode] = useState('');
  const [video, setVideo] = useState<LocalVideoTrack | null>(null);
  const [level, setLevel] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const waiting = meet.phase === 'waiting';
  const joining = meet.phase === 'joining';

  // Permission first (macOS asks once), then the device lists have names.
  useEffect(() => {
    void (async () => {
      await call('media:access', { kind: 'microphone' });
      await call('media:access', { kind: 'camera' });
      const [a, v, o] = await Promise.all([Room.getLocalDevices('audioinput'), Room.getLocalDevices('videoinput'), Room.getLocalDevices('audiooutput').catch(() => [])]);
      setDevices({ audioinput: a, videoinput: v, audiooutput: o });
    })().catch(() => undefined);
  }, []);

  // The camera preview, while the camera is meant to be on.
  useEffect(() => {
    if (!cam || waiting || joining) return;
    let track: LocalVideoTrack | null = null;
    let gone = false;
    void createLocalVideoTrack({ deviceId: camId || undefined }).then(
      (t) => {
        if (gone) return t.stop();
        track = t;
        setVideo(t);
        setProblem(null);
      },
      (e) => setProblem(deviceProblem(e, 'camera').message),
    );
    return () => {
      gone = true;
      track?.stop();
      setVideo(null);
    };
  }, [cam, camId, waiting, joining]);

  // A level meter, so a silent microphone shows before anyone else hears it.
  const raf = useRef(0);
  useEffect(() => {
    if (!mic || waiting || joining) return;
    let track: LocalAudioTrack | null = null;
    let ctx: AudioContext | null = null;
    let gone = false;
    void createLocalAudioTrack({ ...CLEAN_AUDIO, deviceId: micId || undefined }).then(
      (t) => {
        if (gone) return t.stop();
        track = t;
        ctx = new AudioContext();
        const an = ctx.createAnalyser();
        an.fftSize = 256;
        ctx.createMediaStreamSource(new MediaStream([t.mediaStreamTrack])).connect(an);
        const buf = new Uint8Array(an.frequencyBinCount);
        const tick = () => {
          an.getByteTimeDomainData(buf);
          let peak = 0;
          for (const b of buf) peak = Math.max(peak, Math.abs(b - 128));
          setLevel(Math.min(5, Math.round((peak / 128) * 10)));
          raf.current = requestAnimationFrame(tick);
        };
        tick();
      },
      (e) => setProblem(deviceProblem(e).message),
    );
    return () => {
      gone = true;
      cancelAnimationFrame(raf.current);
      track?.stop();
      void ctx?.close();
      setLevel(0);
    };
  }, [mic, micId, waiting, joining]);

  const pill = (on: boolean) => cx('h-11 rounded-full px-4 font-bold text-white', on ? 'bg-white/20 hover:bg-white/30' : 'bg-[#C4321C]');
  const select = 'h-[34px] w-full rounded-[8px] border border-line bg-surface px-1.5 text-[13px] font-normal text-ink';
  const others = info.joined_count;
  return (
    <div className="grid h-full items-center gap-8 overflow-y-auto bg-ground px-11 py-9 text-[13px] [grid-template-columns:1.35fr_1fr] scroll-thin">
      <div className="flex flex-col gap-3.5">
        <div className={cx('relative h-[420px] overflow-hidden rounded-2xl', cam ? 'bg-[#24365F]' : 'bg-[#16254F]')}>
          {cam && video ? (
            <VideoView track={video} mirror className="h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 text-[#C3CEEA]">
              <Avatar name={name} size={90} />
              {cam ? 'Starting the camera…' : 'Camera is off'}
            </div>
          )}
          <span className="absolute top-3.5 left-3.5 rounded-[8px] bg-[rgba(11,18,38,.7)] px-2.5 py-1 font-semibold text-white">{name.split(' ')[0] || 'You'} (you)</span>
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2.5">
            <button type="button" aria-label={mic ? 'Mute microphone' : 'Unmute microphone'} onClick={() => setMic(!mic)} className={pill(mic)}>{mic ? 'Mic on' : 'Mic off'}</button>
            <button type="button" aria-label={cam ? 'Turn camera off' : 'Turn camera on'} onClick={() => setCam(!cam)} className={pill(cam)}>{cam ? 'Camera on' : 'Camera off'}</button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          <label className="flex flex-col gap-1 font-semibold text-ink">
            Camera
            <select value={camId} onChange={(e) => setCamId(e.target.value)} className={select}>
              <option value="">System default</option>
              {devices.videoinput.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Camera'}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 font-semibold text-ink">
            Microphone
            <select value={micId} onChange={(e) => setMicId(e.target.value)} className={select}>
              <option value="">System default</option>
              {devices.audioinput.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 font-semibold text-ink">
            Speaker
            <select value={speakerId} onChange={(e) => setSpeakerId(e.target.value)} className={select}>
              <option value="">System default</option>
              {devices.audiooutput.filter((d) => d.deviceId !== 'default').map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Speaker'}</option>)}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-2 text-ink-2">
          <span>Mic level</span>
          <span className="flex gap-[3px]" aria-label={`Microphone level ${level} of 5`}>
            {[1, 2, 3, 4, 5].map((i) => <span key={i} className={cx('h-3 w-1.5 rounded-[2px]', i <= level ? 'bg-success' : 'bg-line')} />)}
          </span>
          <span className="flex-1" />
          {problem ? <span className="font-semibold text-danger">{problem}</span> : null}
        </div>
      </div>
      <div className="flex flex-col gap-3.5">
        <h1 className="text-[26px] font-bold text-ink">{waiting ? 'Asking to join…' : 'Ready to join?'}</h1>
        <div className="flex flex-col gap-1">
          <b className="text-[16px] text-ink">{info.title || 'Meeting'}</b>
          <span className="text-ink-3">
            {info.host_name ? `Organizer: ${info.host_name}` : ''}
            {info.scheduled_at ? ` · Scheduled ${timeLabel(info.scheduled_at)}` : ''}
          </span>
        </div>
        <span className="text-ink-2">{others > 0 ? `${others} ${others === 1 ? 'person is' : 'people are'} in the meeting` : 'Nobody is in the meeting yet'}</span>
        <label className="flex flex-col gap-[5px] font-semibold text-ink">
          Joining as
          <input value={name} readOnly className="h-[38px] rounded-[8px] border border-line bg-subtle px-2.5 font-medium text-ink" />
        </label>
        {info.needs_passcode ? (
          <label className="flex flex-col gap-[5px] font-semibold text-ink">
            Meeting passcode
            <input type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} autoFocus className="h-[38px] rounded-[8px] border border-line bg-surface px-2.5 text-ink outline-none focus:border-primary" />
          </label>
        ) : null}
        {waiting ? <div className="rounded-[10px] border border-[#F1D9B5] bg-[#FFF9EC] px-3.5 py-3 font-semibold text-[#7A3B05] dark:bg-warning-bg dark:text-warning" role="status">Waiting for the host to admit you…</div> : null}
        {meet.error ? <div className="rounded-[10px] bg-danger-bg px-3.5 py-2.5 text-danger" role="alert">{meet.error}</div> : null}
        <div className="flex gap-2.5">
          {waiting ? (
            <button type="button" onClick={() => void meet.leave()} className="h-11 rounded-[10px] border border-line bg-surface px-[18px] text-[14px] font-bold text-ink">
              Cancel
            </button>
          ) : (
            <button
              type="button"
              disabled={joining || (info.needs_passcode && !passcode.trim())}
              onClick={() => void meet.join({ mic, cam, micId: micId || undefined, camId: camId || undefined, speakerId: speakerId || undefined, passcode: passcode.trim() || undefined })}
              className="h-11 rounded-[10px] bg-primary px-[22px] text-[14px] font-bold text-white hover:bg-primary-hover disabled:opacity-60"
            >
              {joining ? 'Joining…' : info.is_host ? 'Join now' : 'Ask to join'}
            </button>
          )}
        </div>
        <span className="text-[12px] text-ink-3">{info.is_host ? 'You are the host: you let people in and can record.' : 'The host lets people in. The meeting may be recorded.'}</span>
      </div>
    </div>
  );
}
