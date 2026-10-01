import { Track, type Participant, type Room } from 'livekit-client';
import { apiPost } from '../../../core/api';
import { errorMessage } from '../../../core/bridge';
import { downsample, UtteranceSplitter, wav, type Utterance } from './audio';
import { transcribe, type SpeechLanguage } from './engine';
import type { TranscriptSegment } from '../../meetings/transcripts/api';

/**
 * Transcribing a meeting as it happens (worksuite-desktop#81).
 *
 * Each person's microphone is listened to on its own, so every segment carries the name of whoever said it — the
 * person's name in the meeting; a guest who gave none is an unidentified speaker, never a guess. Speech is cut where
 * people pause, transcribed (on this computer first), and the segments go to the meeting's transcript as they are
 * ready, timed from when transcription started.
 */
export class LiveTranscriber {
  /** Pieces waiting or being transcribed. */
  pending = 0;
  error: string | null = null;
  engine: 'local' | 'online' | null = null;
  private audio: AudioContext | null = null;
  private taps = new Map<string, { source: MediaStreamAudioSourceNode; node: ScriptProcessorNode; splitter: UtteranceSplitter; offset: number }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private queue: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(
    private readonly room: Room,
    private readonly transcriptId: number,
    private readonly language: SpeechLanguage,
    private readonly changed: () => void,
  ) {}

  start(): void {
    this.startedAt = Date.now();
    this.audio = new AudioContext();
    this.sync();
    this.timer = setInterval(() => this.sync(), 1_000);
  }

  /** Stop listening, finish what was said, and wait for the last pieces. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const [id] of this.taps) this.untap(id, true);
    await this.queue.catch(() => undefined);
    await this.audio?.close().catch(() => undefined);
    this.audio = null;
  }

  /** Who is speaking now, by their microphone: new ones are listened to, gone ones finished. */
  private sync(): void {
    if (!this.audio || this.stopped) return;
    const all: Participant[] = [this.room.localParticipant, ...this.room.remoteParticipants.values()];
    const live = new Map<string, { p: Participant; track: MediaStreamTrack }>();
    for (const p of all) {
      const pub = p.getTrackPublication(Track.Source.Microphone);
      const t = pub?.track?.mediaStreamTrack;
      if (t && t.readyState === 'live') live.set(`${p.identity}:${t.id}`, { p, track: t });
    }
    for (const id of [...this.taps.keys()]) if (!live.has(id)) this.untap(id, true);
    for (const [id, { p, track }] of live) if (!this.taps.has(id)) this.tap(id, p, track);
  }

  private tap(id: string, p: Participant, track: MediaStreamTrack): void {
    const ctx = this.audio!;
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const node = ctx.createScriptProcessor(4096, 1, 1);
    const offset = Date.now() - this.startedAt;
    const speaker = speakerName(p);
    const splitter = new UtteranceSplitter((u) => this.enqueue(speaker, offset, u));
    node.onaudioprocess = (e) => splitter.push(downsample(new Float32Array(e.inputBuffer.getChannelData(0)), ctx.sampleRate));
    source.connect(node);
    // A ScriptProcessor runs only while connected onwards; its output is silence.
    node.connect(ctx.destination);
    this.taps.set(id, { source, node, splitter, offset });
  }

  private untap(id: string, flush: boolean): void {
    const t = this.taps.get(id);
    if (!t) return;
    if (flush) t.splitter.flush();
    t.node.onaudioprocess = null;
    t.source.disconnect();
    t.node.disconnect();
    this.taps.delete(id);
  }

  private enqueue(speaker: string, offset: number, u: Utterance): void {
    this.pending++;
    this.changed();
    this.queue = this.queue.then(async () => {
      try {
        const r = await transcribe(wav(u.samples), this.language);
        this.engine = r.engine;
        const at = offset + u.startMs;
        const segments: TranscriptSegment[] = r.segments.map((s) => ({ start_ms: at + s.start_ms, end_ms: at + s.end_ms, speaker, text: s.text, uncertain: s.uncertain }));
        if (segments.length) await apiPost(`/api/meetings/transcripts/${this.transcriptId}/segments`, { segments, engine: r.engine });
        this.error = null;
      } catch (e) {
        this.error = `Part of what was said could not be transcribed: ${errorMessage(e)}`;
      } finally {
        this.pending--;
        this.changed();
      }
    });
  }
}

/** Who a microphone belongs to, as the meeting names them; nobody is guessed. */
export function speakerName(p: Participant): string {
  const name = (p.name ?? '').trim();
  return name && name !== 'Guest' ? name : '';
}
