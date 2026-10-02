import { Track, type Participant, type Room } from 'livekit-client';
import { call } from '../../core/bridge';

/**
 * Recording a meeting on this computer (worksuite-desktop#68).
 *
 * What is recorded is the meeting itself, not the screen: everybody's camera and any shared screen are drawn into a
 * picture in the chosen layout — the room as a grid, the person speaking large, or a shared screen large with the
 * speaker beside it — and everybody's sound, this computer's microphone included, is mixed straight from the call.
 * So nothing else on the screen is recorded, and no system-audio permission is needed.
 *
 * The pieces go to the main process every two seconds and are on disk at once; stopping hands it over to be finished
 * and uploaded there, so the meeting's window can close straight after.
 */

export type RecordingLayout = 'grid' | 'speaker' | 'screen';

const MIMES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

/** The best format this computer can record in; mp4 where Chromium can write it, else WebM. */
export function recordingMime(supported: (t: string) => boolean = (t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)): string | null {
  return MIMES.find(supported) ?? null;
}

export interface Tile {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where each of `n` people goes in a grid on a w×h picture: as square-ish as it gets, gaps between. */
export function gridTiles(n: number, w: number, h: number, gap = 8): Tile[] {
  if (n <= 0) return [];
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const tw = (w - gap * (cols + 1)) / cols;
  const th = (h - gap * (rows + 1)) / rows;
  return Array.from({ length: n }, (_, i) => {
    const r = Math.floor(i / cols);
    // The last row, when it is short, is centred.
    const inRow = r === rows - 1 ? n - r * cols : cols;
    const offset = ((cols - inRow) * (tw + gap)) / 2;
    return { x: gap + offset + (i % cols) * (tw + gap), y: gap + r * (th + gap), w: tw, h: th };
  });
}

/** An image fitted inside a box (`contain`) or covering it (`cover`). */
export function fit(sw: number, sh: number, box: Tile, mode: 'contain' | 'cover'): Tile {
  if (!sw || !sh) return box;
  const scale = mode === 'contain' ? Math.min(box.w / sw, box.h / sh) : Math.max(box.w / sw, box.h / sh);
  const w = sw * scale;
  const h = sh * scale;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

interface Person {
  id: string;
  name: string;
  camera: MediaStreamTrack | null;
  screen: MediaStreamTrack | null;
}

export class LocalRecorder {
  id: string | null = null;
  startedAt = 0;
  /** A problem writing it, in a sentence. */
  error: string | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private audio: AudioContext | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private sources = new Map<string, MediaStreamAudioSourceNode>();
  private videos = new Map<string, HTMLVideoElement>();
  private rec: MediaRecorder | null = null;
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private cancelled = false;
  private writing: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly room: Room,
    private readonly opts: { layout: RecordingLayout; quality: '720p' | '1080p'; speaker: () => string | null; onError: (message: string) => void },
  ) {}

  /** Checks first — the microphone, the disk — then the server says whether this person may record; then it starts. */
  async start(meeting: string, title: string): Promise<void> {
    const mime = recordingMime();
    if (!mime) throw new Error('This computer cannot record video. Record on the server instead (Settings › Meet › Recording).');
    if (this.room.localParticipant.isMicrophoneEnabled && !(await call('media:access', { kind: 'microphone' })).granted) {
      throw new Error('WorkSuite needs microphone access in your system privacy settings to record your voice.');
    }
    const pre = await call('meetrec:preflight');
    if (!pre.ok) throw new Error(pre.why ?? 'A recording cannot start now.');
    const { id } = await call('meetrec:start', { meeting, title, layout: this.opts.layout, mime });
    this.id = id;
    if (this.cancelled) { await call('meetrec:abort', { id }); throw new Error('Recording startup was cancelled.'); }

    const [w, h] = this.opts.quality === '1080p' ? [1920, 1080] : [1280, 720];
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    this.canvas = canvas;
    this.audio = new AudioContext();
    await this.audio.resume();
    this.dest = this.audio.createMediaStreamDestination();
    // Keep audio frames flowing even when every participant is muted.
    const silence = this.audio.createOscillator();
    const muted = this.audio.createGain();
    muted.gain.value = 0;
    silence.connect(muted); muted.connect(this.dest); silence.start();
    this.syncAudio();
    this.draw();
    this.timers.push(setInterval(() => this.draw(), 1000 / 30), setInterval(() => this.syncAudio(), 500));

    const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...this.dest.stream.getAudioTracks()]);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: this.opts.quality === '1080p' ? 5_000_000 : 2_500_000, audioBitsPerSecond: 128_000 });
    rec.ondataavailable = (e) => {
      if (!e.data.size || !this.id) return;
      const recId = this.id;
      this.writing = this.writing
        .then(async () => call('meetrec:chunk', { id: recId, data: new Uint8Array(await e.data.arrayBuffer()) }))
        .catch(() => {
          this.error = 'Part of the recording could not be saved. Check the free space where recordings are saved.';
          this.opts.onError(this.error);
        });
    };
    this.rec = rec;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The recorder did not start. Check microphone permissions and retry.')), 10_000);
      rec.onstart = () => { clearTimeout(timer); resolve(); };
      rec.onerror = () => { clearTimeout(timer); reject(new Error('The recorder could not capture this meeting. Check permissions and retry.')); };
      rec.start(2_000);
    });
    if (this.cancelled) { await this.abort(); throw new Error('Recording startup was cancelled.'); }
    this.startedAt = Date.now();
    await call('meetrec:active', { id });
    rec.onerror = () => { this.error = 'Recording capture failed. Check device permissions and retry.'; this.opts.onError(this.error); void this.abort(); };
  }

  async abort(): Promise<void> {
    this.cancelled = true;
    const id = this.id;
    if (this.rec && this.rec.state !== 'inactive') this.rec.stop();
    this.cleanup();
    if (id) await call('meetrec:abort', { id }).catch(() => undefined);
  }

  /** Stop, hand the last piece over, and let the main process finish and upload it. */
  async stop(): Promise<void> {
    const rec = this.rec;
    const id = this.id;
    if (!rec || !id) return this.cleanup();
    if (rec.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        rec.onstop = () => resolve();
        rec.stop();
      });
    }
    await this.writing.catch(() => undefined);
    await call('meetrec:stop', { id, durationMs: Date.now() - this.startedAt });
    this.cleanup();
  }

  private cleanup(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    for (const s of this.sources.values()) s.disconnect();
    this.sources.clear();
    for (const v of this.videos.values()) v.srcObject = null;
    this.videos.clear();
    void this.audio?.close().catch(() => undefined);
    this.audio = null;
    this.rec?.stream.getTracks().forEach((track) => track.stop());
    this.canvas = null;
    this.rec = null;
    this.id = null;
  }

  // ── what is in the meeting now ─────────────────────────────────────────

  private people(): Person[] {
    const all: Participant[] = [this.room.localParticipant, ...this.room.remoteParticipants.values()];
    return all
      .filter((p) => {
        try {
          return !(p.metadata && (JSON.parse(p.metadata) as { waiting?: boolean }).waiting);
        } catch {
          return true;
        }
      })
      .map((p) => {
        const cam = p.getTrackPublication(Track.Source.Camera);
        const scr = p.getTrackPublication(Track.Source.ScreenShare);
        return {
          id: p.identity,
          name: p.isLocal ? `${p.name || 'You'}` : p.name || 'Guest',
          camera: cam?.track && !cam.isMuted ? cam.track.mediaStreamTrack : null,
          screen: scr?.track && !scr.isMuted ? scr.track.mediaStreamTrack : null,
        };
      });
  }

  private syncAudio(): void {
    if (!this.audio || !this.dest) return;
    const tracks: MediaStreamTrack[] = [];
    const all: Participant[] = [this.room.localParticipant, ...this.room.remoteParticipants.values()];
    for (const p of all) {
      for (const source of [Track.Source.Microphone, Track.Source.ScreenShareAudio]) {
        const pub = p.getTrackPublication(source);
        if (pub?.track && !pub.isMuted) tracks.push(pub.track.mediaStreamTrack);
      }
    }
    const want = new Set(tracks.map((t) => t.id));
    for (const [id, node] of this.sources) {
      if (!want.has(id)) {
        node.disconnect();
        this.sources.delete(id);
      }
    }
    for (const t of tracks) {
      if (this.sources.has(t.id) || t.readyState !== 'live') continue;
      const node = this.audio.createMediaStreamSource(new MediaStream([t]));
      node.connect(this.dest);
      this.sources.set(t.id, node);
    }
  }

  private video(track: MediaStreamTrack | null, live: Set<string>): HTMLVideoElement | null {
    if (!track) return null;
    live.add(track.id);
    let v = this.videos.get(track.id);
    if (!v) {
      v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.srcObject = new MediaStream([track]);
      void v.play().catch(() => undefined);
      this.videos.set(track.id, v);
    }
    return v;
  }

  private draw(): void {
    const canvas = this.canvas;
    const g = canvas?.getContext('2d');
    if (!canvas || !g) return;
    const W = canvas.width;
    const H = canvas.height;
    const live = new Set<string>();
    g.fillStyle = '#0B1020';
    g.fillRect(0, 0, W, H);
    const people = this.people();
    const sharer = this.opts.layout === 'screen' || this.opts.layout === 'speaker' ? people.find((p) => p.screen) : undefined;
    const speakerId = this.opts.speaker();
    const main = people.find((p) => p.id === speakerId) ?? people.find((p) => p.camera) ?? people[0];

    if (this.opts.layout === 'grid' && !people.some((p) => p.screen)) {
      gridTiles(people.length, W, H).forEach((t, i) => this.tile(g, people[i]!, this.video(people[i]!.camera, live), t));
    } else if (sharer || (this.opts.layout === 'grid' && people.some((p) => p.screen))) {
      // A shared screen, large; the person speaking in the corner.
      const who = sharer ?? people.find((p) => p.screen)!;
      const screen = this.video(who.screen, live);
      if (screen && screen.readyState >= 2) {
        const f = fit(screen.videoWidth, screen.videoHeight, { x: 0, y: 0, w: W, h: H }, 'contain');
        g.drawImage(screen, f.x, f.y, f.w, f.h);
      }
      const corner = main ?? who;
      const cw = Math.round(W * 0.2);
      const ch = Math.round((cw * 9) / 16);
      this.tile(g, corner, this.video(corner.camera, live), { x: W - cw - 16, y: H - ch - 16, w: cw, h: ch });
    } else if (main) {
      // The person speaking, large; up to six others along the bottom.
      const others = people.filter((p) => p !== main).slice(0, 6);
      const stripH = others.length ? Math.round(H * 0.18) : 0;
      this.tile(g, main, this.video(main.camera, live), { x: 0, y: 0, w: W, h: H - stripH });
      const tw = others.length ? Math.min((stripH * 16) / 9, (W - 8 * (others.length + 1)) / others.length) : 0;
      others.forEach((p, i) => this.tile(g, p, this.video(p.camera, live), { x: 8 + i * (tw + 8), y: H - stripH + 6, w: tw, h: stripH - 12 }));
    }

    for (const [id, v] of this.videos) {
      if (!live.has(id)) {
        v.srcObject = null;
        this.videos.delete(id);
      }
    }
  }

  private tile(g: CanvasRenderingContext2D, p: Person, v: HTMLVideoElement | null, t: Tile): void {
    g.save();
    g.beginPath();
    g.rect(t.x, t.y, t.w, t.h);
    g.clip();
    g.fillStyle = '#1B2238';
    g.fillRect(t.x, t.y, t.w, t.h);
    if (v && v.readyState >= 2) {
      const f = fit(v.videoWidth, v.videoHeight, t, 'cover');
      g.drawImage(v, f.x, f.y, f.w, f.h);
    } else {
      // Camera off: the person's initials.
      const r = Math.min(t.w, t.h) * 0.18;
      g.fillStyle = '#3B5BDB';
      g.beginPath();
      g.arc(t.x + t.w / 2, t.y + t.h / 2, r, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#FFFFFF';
      g.font = `600 ${Math.round(r * 0.8)}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const initials = p.name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join('') || '?';
      g.fillText(initials, t.x + t.w / 2, t.y + t.h / 2);
    }
    // The name, bottom left.
    const size = Math.max(12, Math.round(Math.min(t.h * 0.07, 22)));
    g.font = `600 ${size}px system-ui, sans-serif`;
    g.textAlign = 'left';
    g.textBaseline = 'bottom';
    const label = p.name.slice(0, 40);
    const lw = g.measureText(label).width + size;
    g.fillStyle = 'rgba(11,16,32,0.6)';
    g.fillRect(t.x + 8, t.y + t.h - size * 1.8 - 6, lw, size * 1.8);
    g.fillStyle = '#FFFFFF';
    g.fillText(label, t.x + 8 + size / 2, t.y + t.h - size * 0.5 - 6);
    g.restore();
  }
}
