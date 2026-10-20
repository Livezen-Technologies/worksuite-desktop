import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { app } from '../../core/app-state';
import { apiDelete, apiGet, apiPost, apiPut, apiUrl } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { bytes } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Spinner, cx } from '../../components/ui';
import { can, kindOf, mediaUrl, opened, tagOf, type DriveFile } from './api';
import { useDrive } from './ctx';
import { FileIcon } from './Thumb';
import { VideoStream } from './VideoStream';
import { Select } from '../../components/Select';
import { topBarPaddingRight } from '../../core/window-chrome';

interface Probe {
  kind: 'video' | 'audio' | 'image' | 'other';
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  video_codec: string | null;
  audio_codec: string | null;
  frame_rate: number | null;
  title: string | null;
  artist: string | null;
  album: string | null;
}
interface Track {
  id: number;
  label: string;
  lang: string;
  kind: 'subtitles' | 'captions' | 'descriptions';
  is_default: boolean;
  url: string;
}
interface Marker {
  id: number;
  type: 'chapter' | 'bookmark' | 'comment' | 'marker';
  at_ms: number;
  title: string | null;
  user_id: number | null;
  user_name: string | null;
}
interface Opened {
  file: { id: number; name: string; description: string | null; tags: string[] };
  media: Probe | null;
  state: 'ready' | 'probing' | 'converting' | 'unplayable' | 'unavailable' | 'failed';
  source?: 'original' | 'proxy' | 'image' | null;
  urls?: { source?: string; poster?: string; art?: string; hls?: string; original?: string };
  tracks?: Track[];
  markers?: Marker[];
  playback?: { position_ms: number; completed: boolean } | null;
  jobs: Array<{ kind: string; state: string; progress: number | string; stalled?: boolean; error?: string; id?: number }>;
  ffmpeg: boolean;
  reason?: string | null;
  message?: string;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** "02:14", or "1:02:14" past an hour. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/** A track's address, read through the app so the video (another origin) may use it. */
function trackUrl(u: string): string | null {
  if (u.startsWith('/media/')) return apiUrl(u);
  return mediaUrl(u);
}

/**
 * The media viewer (DriveMedia): the video or sound with its own controls,
 * resuming where you stopped; ‹ › through the files around it; the details,
 * description and tags; and comments pinned to a moment.
 */
export function MediaViewer({ files, start, onClose }: { files: DriveFile[]; start: number; onClose: () => void }) {
  const d = useDrive();
  const qc = useQueryClient();
  const me = useStore(app, (s) => Number(s.auth?.user?.id ?? 0));
  const [i, setI] = useState(start);
  const f = files[i]!;
  const q = useQuery({
    queryKey: ['files', 'media', f.id],
    queryFn: ({ signal }) => apiGet<Opened>(`/api/drive/media/${f.id}`, undefined, signal),
    refetchInterval: (query) => (query.state.data?.jobs.some((j) => !j.stalled && ['running', 'queued'].includes(j.state)) || ['probing', 'converting'].includes(query.state.data?.state ?? '') ? 3000 : false),
  });
  const o = q.data;
  // A server without ffmpeg can't prepare media, but the file itself may still play.
  const fallback = useQuery({
    queryKey: ['files', 'preview', f.id],
    queryFn: ({ signal }) => apiGet<{ url: string | null; download_url: string | null; preview: string | null }>(`/api/drive/preview/${f.id}`, undefined, signal),
    enabled: o?.state === 'unavailable' || o?.state === 'unplayable',
  });
  const direct = o && o.state !== 'ready' ? mediaUrl(fallback.data?.url ?? fallback.data?.download_url?.replace(/[?&]download=1$/, '')) : null;
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [length, setLength] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [subs, setSubs] = useState<string>('off');
  const [note, setNote] = useState('');
  const [desc, setDesc] = useState<string | null>(null);
  const [tag, setTag] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  /** The comments as the server last listed them after a change (it leaves them out of an unreadable file's answer). */
  const [marks, setMarks] = useState<Marker[] | null>(null);
  // What it is: from the server's reading of the file, else from its name.
  const isVideo = o?.media?.kind ? o.media.kind !== 'audio' : kindOf(f.name, f.extension) !== 'audio';
  const src = mediaUrl(o?.urls?.source ?? o?.urls?.original) ?? direct;
  const hlsUrl = o?.urls?.hls?.startsWith('/media/hls/') ? apiUrl(o.urls.hls) : mediaUrl(o?.urls?.hls);
  const playable = !!o && (!!src || !!hlsUrl);
  const activeJob = o?.jobs.find((j) => j.state === 'running' || j.state === 'queued');
  const failedJob = o?.jobs.find((j) => ['probe', 'proxy', 'hls'].includes(j.kind) && (j.state === 'failed' || j.stalled));
  const processing = o?.state === 'failed' || !!failedJob ? 'Failed' : activeJob?.state === 'queued' ? 'Queued' : ['probing', 'converting'].includes(o?.state ?? '') ? 'Preparing Video' : 'Ready';
  const markers = (marks ?? o?.markers ?? []).filter((m) => m.type === 'comment' || m.type === 'chapter' || m.type === 'bookmark').sort((a, b) => a.at_ms - b.at_ms);

  // A new file: its description, and nothing playing yet.
  const [seen, setSeen] = useState<number | null>(null);
  if (seen !== f.id) {
    setSeen(f.id);
    setDesc(null);
    setMarks(null);
    setPlaying(false);
    setAt(0);
    setLength(0);
    setPlaybackError(null);
  }
  const description = desc ?? o?.file.description ?? '';

  useEffect(() => {
    void opened(f.id);
  }, [f.id]);

  // Where you stopped: saved every 15 seconds, on pause, and on the way out.
  const saveProgress = () => {
    const el = media.current;
    if (!el || !el.duration || !Number.isFinite(el.duration)) return;
    void apiPost(`/api/drive/media/${f.id}/progress`, { position_ms: Math.round(el.currentTime * 1000), duration_ms: Math.round(el.duration * 1000) }).catch(() => undefined);
  };
  useEffect(() => {
    const t = setInterval(() => media.current && !media.current.paused && saveProgress(), 15_000);
    return () => {
      clearInterval(t);
      saveProgress();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.id]);

  const loaded = () => {
    const el = media.current;
    if (!el) return;
    setLength(el.duration * 1000);
    el.playbackRate = speed;
    const pos = at > 5000 ? at : o?.playback?.position_ms ?? 0;
    if (pos > 5000 && !o?.playback?.completed && pos < el.duration * 1000 - 5000) {
      el.currentTime = pos / 1000;
      toast('info', `Carrying on from ${clock(pos)}`);
    }
    void el.play().catch(() => undefined);
  };
  const toggle = () => {
    const el = media.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  };
  const seek = (ms: number) => {
    const el = media.current;
    if (el) el.currentTime = Math.max(0, Math.min(el.duration || 0, ms / 1000));
  };
  const go = (n: number) => {
    saveProgress();
    setI(Math.max(0, Math.min(files.length - 1, n)));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if (e.key === 'Escape') onClose();
      else if (e.key === ' ' || e.key === 'k') toggle();
      else if (e.key === 'ArrowRight' && e.shiftKey) go(i + 1);
      else if (e.key === 'ArrowLeft' && e.shiftKey) go(i - 1);
      else if (e.key === 'ArrowRight' || e.key === 'l') seek(at + 5000);
      else if (e.key === 'ArrowLeft' || e.key === 'j') seek(at - 5000);
      else if (e.key === 'm') setMuted(!muted);
      else if (e.key === 'f' && isVideo) void media.current?.requestFullscreen?.().catch(() => undefined);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const addNote = async () => {
    if (!note.trim()) return;
    try {
      const r = await apiPost<{ markers: Marker[] }>(`/api/drive/media/${f.id}/markers`, { type: 'comment', at_ms: Math.round(at), title: note.trim() });
      setMarks(r.markers);
      setNote('');
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const saveMeta = async (patch: { description?: string; tags?: string[] }) => {
    try {
      await apiPut(`/api/drive/media/${f.id}/meta`, patch);
      setSavedAt('Saved');
      void q.refetch();
      void qc.invalidateQueries({ queryKey: ['files', 'list'] });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const prepare = async () => {
    try {
      await apiPost(`/api/drive/media/${f.id}/prepare`, { what: failedJob?.kind ?? (o?.media?.kind === 'video' ? 'hls' : o?.media ? 'proxy' : 'probe') });
      toast('info', 'Making a copy this app can play. The original is not changed.');
      void q.refetch();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const facts: Array<[string, string]> = [
    ['Type', [isVideo ? 'Video' : 'Audio', [o?.media?.video_codec, o?.media?.audio_codec].filter(Boolean).join(' / ').toUpperCase()].filter(Boolean).join(' · ')],
    ...(o?.media?.width && o.media.height ? [['Resolution', `${o.media.width} × ${o.media.height}${o.media.frame_rate ? ` · ${Math.round(o.media.frame_rate)} fps` : ''}`] as [string, string]] : []),
    ...(o?.media?.duration_ms ? [['Length', clock(o.media.duration_ms)] as [string, string]] : []),
    ['Size', bytes(f.size)],
    ['Location', f.folder_path ? `My Drive › ${f.folder_path.replace(/\//g, ' › ')}` : f.folder_name || 'My Drive'],
    ['Owner', f.access?.owner ? 'You' : (f.owner_name ?? '—')],
    ...(o?.media?.artist ? [['Artist', o.media.artist] as [string, string]] : []),
    ...(o?.media?.album ? [['Album', o.media.album] as [string, string]] : []),
  ];
  const editable = can(f.access, 'edit');
  const job = o?.jobs.find((j) => j.state === 'running' || j.state === 'queued');

  return (
    <div role="dialog" aria-modal="true" aria-label={`Play ${f.name}`} className="no-drag fixed inset-0 z-50 flex flex-col bg-[#0D1424] text-[13px] text-[#E6ECFA]">
      <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-[#1E2C57] bg-[#0F1B3D] pl-4" style={{ paddingRight: topBarPaddingRight(16) }}>
        <button type="button" aria-label="Back to folder" onClick={onClose} className="flex h-[34px] w-[34px] items-center justify-center rounded-[8px] hover:bg-white/10"><Icon name="chevron-left" size={18} /></button>
        <span className="rounded-[6px] bg-white/10 px-2 py-0.5 text-[10.5px] font-bold">{tagOf(f.name, f.extension)}</span>
        <div className="flex min-w-0 flex-col">
          <b className="truncate text-[14px]">{f.name}</b>
          <span className="text-[12px] text-[#AFC0E8]">{f.folder_name || 'My Drive'} · {i + 1} of {files.length}</span>
        </div>
        <span className="flex-1" />
        <button type="button" aria-label="Previous file" disabled={i === 0} onClick={() => go(i - 1)} className="h-[34px] w-[34px] rounded-[8px] border border-[#2A3A66] text-[18px] hover:bg-white/10 disabled:opacity-30">‹</button>
        <button type="button" aria-label="Next file" disabled={i >= files.length - 1} onClick={() => go(i + 1)} className="h-[34px] w-[34px] rounded-[8px] border border-[#2A3A66] text-[18px] hover:bg-white/10 disabled:opacity-30">›</button>
        {can(f.access, 'share') ? <button type="button" onClick={() => d.share({ type: 'file', f })} className="h-[34px] rounded-[8px] border border-[#2A3A66] px-3 font-semibold hover:bg-white/10">Share…</button> : null}
        {can(f.access, 'download') ? (
          <>
            <button type="button" onClick={() => d.download([f], true)} className="h-[34px] rounded-[8px] border border-[#2A3A66] px-3 font-semibold hover:bg-white/10">Open locally</button>
            <button type="button" onClick={() => d.download([f])} className="h-[34px] rounded-[8px] bg-[#3B5BDB] px-3.5 font-bold text-white hover:brightness-110">Download Original</button>
          </>
        ) : null}
        <button type="button" aria-label="Close viewer" onClick={onClose} className="ml-1 flex h-[34px] w-[34px] items-center justify-center rounded-[8px] text-[18px] hover:bg-white/10">×</button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 items-center justify-center p-6">
            {q.isLoading ? <Spinner /> : null}
            {o && playable && processing !== 'Ready' ? <div role="status" className="absolute top-2 z-10 rounded bg-[#16254F] p-3">{processing}{activeJob && Number(activeJob.progress) > 0 ? ` · ${activeJob.progress}%` : ''} {processing === 'Failed' ? <Button onClick={() => void prepare()}>Retry preparation</Button> : null}</div> : null}
            {q.error ? <div role="alert" className="text-[#FFB4A3]">{errorMessage(q.error)} <Button onClick={() => void q.refetch()}>Retry</Button></div> : null}
            {playbackError && playbackError === src ? <div role="alert" className="absolute top-2 z-10 rounded bg-[#16254F] p-3">Playback failed. Check your connection and try again. <Button onClick={() => { setPlaybackError(null); media.current?.load(); void q.refetch(); }}>Retry playback</Button> {o?.ffmpeg ? <Button onClick={() => void prepare()}>Make a playable copy</Button> : null}</div> : null}
            {o && !playable && !(fallback.isLoading && fallback.fetchStatus !== 'idle') ? (
              <div className="flex max-w-[420px] flex-col items-center gap-3 text-center">
                <FileIcon f={f} size={72} />
                <b className="text-[15px]">{o.state === 'probing' || o.state === 'converting' || o.state === 'failed' ? processing : o.state === 'unavailable' ? 'This server can’t play media files' : 'This file can’t be played here'}</b>
                {job ? <span className="text-[#AFC0E8]">{job.kind} · {job.state}{Number(job.progress) > 0 ? ` · ${job.progress}%` : ''}</span> : null}
                {failedJob?.error ? <span role="alert" className="text-[#FFB4A3]">{failedJob.error}</span> : null}
                {o.reason || o.message ? <span className="text-[#AFC0E8]">{o.reason ?? o.message}</span> : null}
                {o.ffmpeg && (!job || job.stalled || o.state === 'failed') ? <Button variant="primary" onClick={() => void prepare()}>{processing === 'Failed' ? 'Retry preparation' : 'Make a playable copy'}</Button> : null}
                {can(f.access, 'download') && o.state !== 'probing' ? <Button onClick={() => d.download([f], true)}>Open locally</Button> : null}
              </div>
            ) : null}
            {playable && (src || hlsUrl) ? (
              <div className="flex h-full w-full max-w-[1200px] flex-col justify-center gap-3">
                {isVideo ? (
                  <VideoStream
                    mediaRef={media}
                    hlsUrl={hlsUrl}
                    key={f.id}
                    source={src}
                    poster={mediaUrl(o.urls?.poster) ?? undefined}
                    muted={muted}
                    preload="metadata"
                    onLoadedMetadata={() => { setPlaybackError(null); loaded(); }}
                    onError={() => setPlaybackError(src ?? hlsUrl)}
                    onTimeUpdate={(e) => setAt(e.currentTarget.currentTime * 1000)}
                    onPlay={() => setPlaying(true)}
                    onPause={() => (setPlaying(false), saveProgress())}
                    onEnded={() => (setPlaying(false), saveProgress())}
                    onClick={toggle}
                    onVolumeChange={(e) => setVolume(e.currentTarget.volume)}
                    className="max-h-[calc(100vh-260px)] w-full rounded-[10px] bg-black"
                  >
                    {(o.tracks ?? []).map((t) => (trackUrl(t.url) ? <track key={t.id} kind={t.kind} src={trackUrl(t.url)!} srcLang={t.lang} label={t.label} default={subs === String(t.id)} /> : null))}
                  </VideoStream>
                ) : (
                  <div className="flex flex-col items-center gap-4">
                    {o.urls?.art ? <img src={mediaUrl(o.urls.art) ?? undefined} alt="" className="h-52 w-52 rounded-[18px] object-cover shadow-2xl" /> : <span className="flex h-52 w-52 items-center justify-center rounded-[24px] bg-white/10"><Icon name="music" size={64} /></span>}
                    <b className="text-[16px]">{o.media?.title ?? f.name}</b>
                    {o.media?.artist ? <span className="text-[#AFC0E8]">{o.media.artist}</span> : null}
                    <audio ref={media} key={src} src={src ?? undefined} muted={muted} onLoadedMetadata={() => { setPlaybackError(null); loaded(); }}
                    onError={() => setPlaybackError(src ?? hlsUrl)} onTimeUpdate={(e) => setAt(e.currentTarget.currentTime * 1000)} onPlay={() => setPlaying(true)} onPause={() => (setPlaying(false), saveProgress())} onEnded={() => (setPlaying(false), saveProgress())} />
                  </div>
                )}
                <div className="flex flex-col gap-2 rounded-[10px] bg-[#111A31] px-3.5 py-2.5">
                  <div className="relative h-4">
                    <input type="range" aria-label="Position" min={0} max={Math.max(1, length)} step={250} value={Math.min(at, length)} onChange={(e) => seek(Number(e.target.value))} className="absolute inset-0 w-full accent-[#7FA2FF]" />
                    {length
                      ? markers.map((m) => (
                          <button key={m.id} type="button" title={`${clock(m.at_ms)} · ${m.title ?? ''}`} aria-label={`Go to ${clock(m.at_ms)}`} onClick={() => seek(m.at_ms)} className="absolute top-[-4px] h-2.5 w-2.5 -translate-x-1/2 rounded-full border-2 border-[#111A31] bg-[#FDE68A]" style={{ left: `${(m.at_ms / length) * 100}%` }} />
                        ))
                      : null}
                  </div>
                  <div className="flex items-center gap-2.5 text-[12.5px]">
                    <button type="button" aria-label={playing ? 'Pause (space)' : 'Play (space)'} onClick={toggle} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 hover:bg-white/20">
                      <Icon name={playing ? 'pause' : 'play'} size={15} />
                    </button>
                    <span className="font-mono tabular-nums">{clock(at)} / {clock(length)}</span>
                    <button type="button" aria-label={muted ? 'Unmute (M)' : 'Mute (M)'} onClick={() => setMuted(!muted)} className="flex h-8 w-8 items-center justify-center rounded-[7px] hover:bg-white/10">
                      <Icon name={muted ? 'mic-off' : 'music'} size={15} />
                    </button>
                    <input type="range" aria-label="Volume" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={(e) => media.current && ((media.current.volume = Number(e.target.value)), setMuted(false))} className="w-24 accent-[#7FA2FF]" />
                    <span className="flex-1" />
                    {isVideo && (o.tracks ?? []).length ? (
                      <Select aria-label="Subtitles" value={subs} onChange={(e) => setSubs(e.target.value)} className="h-8 rounded-[7px] border border-[#2A3A66] bg-[#16254F] px-2 text-white">
                        <option value="off">Subtitles: off</option>
                        {(o.tracks ?? []).map((t) => <option key={t.id} value={t.id}>Subtitles: {t.label}</option>)}
                      </Select>
                    ) : null}
                    <Select aria-label="Speed" value={speed} onChange={(e) => (setSpeed(Number(e.target.value)), media.current && (media.current.playbackRate = Number(e.target.value)))} className="h-8 rounded-[7px] border border-[#2A3A66] bg-[#16254F] px-2 text-white">
                      {SPEEDS.map((s) => <option key={s} value={s}>Speed: {s === 1 ? 'Normal' : `${s}×`}</option>)}
                    </Select>
                    {isVideo ? (
                      <>
                        <button type="button" onClick={() => void (media.current as HTMLVideoElement | null)?.requestPictureInPicture?.().catch(() => undefined)} className="h-8 rounded-[7px] border border-[#2A3A66] px-2.5 hover:bg-white/10">Picture in picture</button>
                        <button type="button" aria-label="Full screen (F)" onClick={() => void media.current?.requestFullscreen?.().catch(() => undefined)} className="h-8 rounded-[7px] border border-[#2A3A66] px-2.5 hover:bg-white/10">Full screen</button>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          {files.length > 1 ? (
            <div role="list" aria-label="Files here" className="flex h-[82px] shrink-0 items-center gap-2.5 overflow-x-auto border-t border-[#1E2C57] px-4 scroll-thin">
              {files.map((x, n) => (
                <button key={x.id} type="button" role="listitem" aria-current={n === i ? 'true' : undefined} title={x.name} onClick={() => go(n)} className={cx('flex h-[58px] w-[96px] shrink-0 items-center justify-center rounded-[8px] bg-[#E6ECFA]/10', n === i ? 'outline-3 outline-offset-2 outline-[#7FA2FF]' : 'opacity-55 hover:opacity-90')}>
                  <FileIcon f={x} size={44} />
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <aside aria-label="Details" className="flex w-[320px] shrink-0 flex-col gap-2.5 overflow-y-auto border-l border-[#1E2C57] bg-[#0F1B3D] p-4 text-[12.5px] scroll-thin">
          <h2 className="text-[13px] font-bold">Details</h2>
          {facts.map(([k, v]) => (
            <div key={k} className="flex gap-2.5">
              <span className="w-[76px] shrink-0 text-[#AFC0E8]">{k}</span>
              <span className="min-w-0 break-words">{v}</span>
            </div>
          ))}
          {o?.state === 'ready' ? <span className="text-[#9EE6C3]">{o.source === 'proxy' ? 'Plays a converted copy · the original is unchanged' : 'Plays directly · no conversion needed'}</span> : direct ? <span className="text-[#FFD28A]">Playing the original: this server can’t prepare media, so seeking may be slow and some formats won’t play.</span> : null}
          <label className="mt-1 flex flex-col gap-1 text-[#AFC0E8]">
            Description
            <textarea value={description} disabled={!editable} maxLength={1000} onChange={(e) => (setDesc(e.target.value), setSavedAt(null))} onBlur={() => desc !== null && desc !== (o?.file.description ?? '') && void saveMeta({ description: desc })} aria-label="Description" placeholder={editable ? 'What is in it?' : 'No description'} className="h-16 resize-none rounded-[8px] border border-[#2A3A66] bg-[#16254F] p-2 text-white outline-none focus:border-[#7FA2FF] disabled:opacity-60" />
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="text-[#AFC0E8]">Tags</span>
            <span className="flex flex-wrap gap-1.5">
              {(o?.file.tags ?? []).map((t) => (
                <span key={t} className="flex items-center gap-1 rounded-[10px] bg-[#16254F] px-2 py-0.5 font-semibold">
                  {t}
                  {editable ? <button type="button" aria-label={`Remove tag ${t}`} onClick={() => void saveMeta({ tags: (o?.file.tags ?? []).filter((x) => x !== t) })} className="text-[#AFC0E8] hover:text-white">×</button> : null}
                </span>
              ))}
              {editable ? (
                <input value={tag} maxLength={80} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && tag.trim() && (void saveMeta({ tags: [...(o?.file.tags ?? []), tag.trim()] }), setTag(''))} aria-label="Add a tag" placeholder="+ tag" className="h-6 w-20 rounded-[10px] border border-dashed border-[#2A3A66] bg-transparent px-2 text-white outline-none focus:border-[#7FA2FF]" />
              ) : null}
            </span>
          </div>
          {savedAt ? <span className="text-[#9EE6C3]">{savedAt}</span> : null}
          <div className="mt-1 flex flex-col gap-2 border-t border-[#1E2C57] pt-3">
            <b>Comments · {markers.length}</b>
            {markers.map((m) => (
              <div key={m.id} className="flex items-start gap-2">
                <button type="button" onClick={() => seek(m.at_ms)} className="shrink-0 rounded-[6px] bg-[#16254F] px-1.5 font-mono text-[11.5px] text-[#AFC6FF] hover:bg-[#1E2F63]">{clock(m.at_ms)}</button>
                <span className="min-w-0 flex-1 break-words"><b>{m.user_id === me ? 'You' : (m.user_name ?? 'Someone')}</b> — {m.title}</span>
                {m.user_id === me ? (
                  <button type="button" aria-label="Delete comment" onClick={() => void apiDelete<{ markers: Marker[] }>(`/api/drive/media/${f.id}/markers/${m.id}`).then((r) => setMarks(r.markers), (e) => toast('error', errorMessage(e)))} className="text-[#AFC0E8] hover:text-[#FFB4A3]">×</button>
                ) : null}
              </div>
            ))}
            {playable ? (
              <input value={note} maxLength={255} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void addNote()} aria-label="Comment at current time" placeholder={`Comment at ${clock(at)}…`} className="h-8 rounded-[8px] border border-[#2A3A66] bg-[#16254F] px-2.5 text-white outline-none focus:border-[#7FA2FF]" />
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
