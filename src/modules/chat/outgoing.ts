import type { PickedFile, UploadTarget } from '@shared/ipc/contract';
import type { Transfer } from '@shared/types';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { holdWhileSending } from '../../core/closeGuard';
import { createStore } from '../../core/store';
import type { Staged } from './attach';
import { rememberVoice } from './kit/voice';
import { isTimed, voiceRetried, voiceSendEnded, voiceSendStarted } from './kit/voiceMetrics';

export type MediaPhase = 'preparing' | 'queued' | 'uploading' | 'processing' | 'sending' | 'sent' | 'failed' | 'cancelled';
export interface OutgoingMedia {
  id: string;
  owner: string;
  roomId: string;
  name: string;
  size: number;
  mime: string;
  preview?: string;
  source?: Staged;
  originalQuality?: boolean;
  prepared?: PickedFile & { preview?: string; mime?: string };
  transferId?: string;
  target: Extract<UploadTarget, { kind: 'chat' }>;
  phase: MediaPhase;
  progress: number | null;
  /** While its bytes go: how many have gone, and how fast (bytes a second). */
  sent?: number;
  speed?: number;
  error: string | null;
  /** Waiting to be tried again by itself after a temporary failure: when (#300). */
  retryAt?: string | null;
  createdAt: string;
}
export const outgoing = createStore<{ jobs: OutgoingMedia[] }>({ jobs: [] });
const owner = () => `${app.get().auth?.server?.origin ?? ''}:${app.get().auth?.user?.id ?? ''}`;
let preparing = Promise.resolve();
const update = (id: string, patch: Partial<OutgoingMedia>) => outgoing.set({ jobs: outgoing.get().jobs.map((j) => j.id === id ? { ...j, ...patch } : j) });

export function transferPhase(t: Transfer): MediaPhase {
  if (t.state === 'done') return 'sent';
  if (t.state === 'failed') return 'failed';
  if (t.state === 'cancelled') return 'cancelled';
  if (t.state !== 'running' || t.phase === 'waiting') return 'queued';
  return t.phase === 'preparing' ? 'preparing' : t.phase === 'processing' ? 'processing' : t.phase === 'sending' ? 'sending' : 'uploading';
}

/**
 * How far along sending is, 0–1, across every step, so one bar fills once and never runs backwards: getting ready
 * and waiting for a slot take the first few percent, the bytes most of the bar, then the server's check and the post.
 * `moving` is false while a step has no measure of its own (the bar shimmers there instead).
 */
export function sendShare(phase: MediaPhase, progress: number | null): { share: number; moving: boolean } {
  switch (phase) {
    case 'preparing': return { share: 0.02, moving: false };
    case 'queued': return { share: 0.04, moving: false };
    case 'uploading': return { share: 0.05 + 0.83 * Math.min(1, Math.max(0, progress ?? 0)), moving: progress !== null };
    case 'processing': return { share: 0.9, moving: false };
    case 'sending': return { share: 0.96, moving: false };
    case 'sent': return { share: 1, moving: true };
    default: return { share: 0, moving: true };
  }
}

/** Durable native transfers also reconstruct outgoing bubbles in a freshly opened window. */
export function outgoingForRoom(roomId: string, transfers: Transfer[]): OutgoingMedia[] {
  const local = outgoing.get().jobs.filter((j) => j.roomId === roomId && j.owner === owner());
  const result = local.map((j) => {
    const t = transfers.find((t) => t.id === j.transferId || t.chat?.clientMessageId === j.id);
    return t ? { ...j, transferId: t.id, phase: transferPhase(t), progress: t.phase === 'uploading' && t.total > 0 ? t.bytes / t.total : null, sent: t.bytes, speed: t.speed, error: t.error, retryAt: t.state === 'queued' ? (t.retryAt ?? null) : null, ...(!j.preview && t.chat?.preview ? { preview: t.chat.preview } : {}) } : j;
  });
  for (const t of transfers) {
    if (t.chat?.roomId !== roomId || result.some((j) => j.id === t.chat!.clientMessageId)) continue;
    // A voice message cancelled is gone from the conversation (#300), in every window and after a restart.
    if (t.chat.voice && t.state === 'cancelled') continue;
    const { preview, ...chat } = t.chat;
    result.push({ id: chat.clientMessageId, owner: owner(), roomId, name: t.name, size: t.total, mime: '', ...(preview ? { preview } : {}), target: { kind: 'chat', ...chat }, transferId: t.id, phase: transferPhase(t), progress: t.total > 0 && t.phase === 'uploading' ? t.bytes / t.total : null, sent: t.bytes, speed: t.speed, error: t.error, retryAt: t.state === 'queued' ? (t.retryAt ?? null) : null, createdAt: t.createdAt });
  }
  return result.filter((j) => !(j.target.voice && j.phase === 'cancelled')).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function launch(id: string, originalQuality: boolean): void {
  preparing = holdWhileSending(preparing.catch(() => undefined).then(async () => {
    const j = outgoing.get().jobs.find((j) => j.id === id);
    if (!j || j.phase === 'cancelled' || j.owner !== owner()) return;
    try {
      let file: (PickedFile & { preview?: string; mime?: string }) | undefined = j.prepared;
      if (!file) {
        const source = j.source!;
        if (source.kind === 'blob' && (source.blob.size === 0 || source.blob.size > 100 * 1024 * 1024)) throw new Error('Recorded or pasted media must be between 1 byte and 100 MB. Choose a file from disk for larger attachments.');
        const data = source.kind === 'blob' ? new Uint8Array(await source.blob.arrayBuffer()) : undefined;
        file = await call('transfers:prepareMedia', { name: j.name, originalQuality, ...(data ? { data } : { handle: source.kind === 'disk' ? source.file.handle : undefined }) });
        if (file.preview && j.preview?.startsWith('blob:')) URL.revokeObjectURL(j.preview);
        // A voice message keeps the recording's own type: by its name a `.webm` would read as a video (#285).
        update(id, { prepared: file, source: undefined, name: file.name, size: file.size, ...(file.mime && !j.target.voice ? { mime: file.mime } : {}), ...(file.preview ? { preview: file.preview } : {}) });
      }
      if (outgoing.get().jobs.find((j) => j.id === id)?.phase === 'cancelled' || j.owner !== owner()) return;
      const [t] = await call('transfers:upload', { handles: [file.handle], target: j.target });
      if (!t) throw new Error('The attachment could not be queued. Retry to send it.');
      if (outgoing.get().jobs.find((j) => j.id === id)?.phase === 'cancelled') { await call('transfers:cancel', { id: t.id }); return; }
      update(id, { transferId: t.id, phase: transferPhase(t) });
    } catch (e) {
      if (outgoing.get().jobs.find((j) => j.id === id)?.phase !== 'cancelled') update(id, { phase: 'failed', error: errorMessage(e) });
    }
  }));
}

/**
 * Synchronous enqueue: the bubble exists before preparation or IPC starts. A voice message's length and loudness,
 * measured while it was recorded, go with it and are its bubble's at once (#285).
 */
export function queueMedia(roomId: string, sources: Staged[], extra: { caption?: string; replyTo?: number; voice?: boolean; durationMs?: number; waveform?: number[] }, originalQuality = false, timing: { pressedAt?: number } = {}): void {
  const jobs = sources.map((source, i): OutgoingMedia => {
    const id = `desktop-${crypto.randomUUID()}`;
    const createdAt = new Date(Date.now() + i).toISOString();
    const mime = source.kind === 'blob' ? source.blob.type : '';
    const preview = source.kind === 'blob' && /^(image|video|audio)\//.test(mime) ? URL.createObjectURL(source.blob) : undefined;
    return { id, owner: owner(), roomId, name: source.kind === 'blob' ? source.name : source.file.name, size: source.kind === 'blob' ? source.blob.size : source.file.size, mime, preview, source, originalQuality, target: { kind: 'chat', roomId, clientMessageId: id, submittedAt: createdAt, ...(i === 0 ? extra : {}) }, phase: 'preparing', progress: null, error: null, createdAt };
  });
  outgoing.set({ jobs: [...outgoing.get().jobs, ...jobs] });
  if (extra.voice && jobs[0]) {
    rememberVoice(jobs[0].id, { ms: extra.durationMs ?? null, peaks: extra.waveform ?? null });
    // Timed from Send to its bubble and to the server's confirmation (#300).
    voiceSendStarted(jobs[0].id, { bytes: jobs[0].size, durationMs: extra.durationMs ?? 0, mime: jobs[0].mime, pressedAt: timing.pressedAt });
  }
  jobs.forEach((j) => launch(j.id, originalQuality));
}

/**
 * Cancel: the upload stops and the server is told to throw away what it has. A voice message's bubble goes with it
 * (#300), and its recording on this computer (the transfer manager deletes its own copy); a file's stays as Cancelled,
 * to send again.
 */
export async function cancelMedia(j: OutgoingMedia): Promise<void> {
  update(j.id, { phase: 'cancelled' });
  if (j.target.voice) {
    voiceSendEnded(j.id, 'cancelled');
    const gone = outgoing.get().jobs.find((x) => x.id === j.id);
    if (gone?.preview?.startsWith('blob:')) URL.revokeObjectURL(gone.preview);
    outgoing.set({ jobs: outgoing.get().jobs.filter((x) => x.id !== j.id) });
  }
  if (j.transferId) await call('transfers:cancel', { id: j.transferId });
}
export async function retryMedia(j: OutgoingMedia): Promise<void> {
  if (j.transferId) { await call('transfers:retry', { id: j.transferId }); return; }
  update(j.id, { phase: 'preparing', error: null }); launch(j.id, j.originalQuality ?? true);
}

/** Called once after server history contains the confirmed id; never confuse confirmation with a receipt. */
export function acknowledgeMedia(ids: Set<string>): void {
  const removed = outgoing.get().jobs.filter((j) => ids.has(j.id));
  if (!removed.length) return;
  removed.forEach((j) => { if (j.preview?.startsWith('blob:')) URL.revokeObjectURL(j.preview); });
  outgoing.set({ jobs: outgoing.get().jobs.filter((j) => !ids.has(j.id)) });
}

/**
 * The send timings' ends (#300): a timed voice message is confirmed when its transfer is done (the server answered
 * the post), and given up when it fails for good or a local step failed. Retries are counted on the way.
 */
export function observeVoiceSends(transfers: Transfer[] = app.get().transfers ?? []): void {
  for (const j of outgoing.get().jobs) {
    if (!j.target.voice || !isTimed(j.id)) continue;
    const t = transfers.find((t) => t.id === j.transferId || t.chat?.clientMessageId === j.id);
    if (t?.attempts) voiceRetried(j.id, t.attempts);
    if (t?.state === 'done') voiceSendEnded(j.id, 'sent');
    else if (t?.state === 'failed' || (!t && j.phase === 'failed')) voiceSendEnded(j.id, 'failed');
    else if (t?.state === 'cancelled') voiceSendEnded(j.id, 'cancelled');
  }
}
app.subscribe(() => observeVoiceSends());
outgoing.subscribe(() => observeVoiceSends());
