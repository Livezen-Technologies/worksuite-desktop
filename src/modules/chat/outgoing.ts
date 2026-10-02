import type { PickedFile, UploadTarget } from '@shared/ipc/contract';
import type { Transfer } from '@shared/types';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { holdWhileSending } from '../../core/closeGuard';
import { createStore } from '../../core/store';
import type { Staged } from './attach';

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
  error: string | null;
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

/** Durable native transfers also reconstruct outgoing bubbles in a freshly opened window. */
export function outgoingForRoom(roomId: string, transfers: Transfer[]): OutgoingMedia[] {
  const local = outgoing.get().jobs.filter((j) => j.roomId === roomId && j.owner === owner());
  const result = local.map((j) => {
    const t = transfers.find((t) => t.id === j.transferId || t.chat?.clientMessageId === j.id);
    return t ? { ...j, transferId: t.id, phase: transferPhase(t), progress: t.phase === 'uploading' && t.total > 0 ? t.bytes / t.total : null, error: t.error } : j;
  });
  for (const t of transfers) {
    if (t.chat?.roomId !== roomId || result.some((j) => j.id === t.chat!.clientMessageId)) continue;
    result.push({ id: t.chat.clientMessageId, owner: owner(), roomId, name: t.name, size: t.total, mime: '', target: { kind: 'chat', ...t.chat }, transferId: t.id, phase: transferPhase(t), progress: t.total > 0 && t.phase === 'uploading' ? t.bytes / t.total : null, error: t.error, createdAt: t.createdAt });
  }
  return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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
        update(id, { prepared: file, source: undefined, name: file.name, size: file.size, ...(file.mime ? { mime: file.mime } : {}), ...(file.preview ? { preview: file.preview } : {}) });
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

/** Synchronous enqueue: the bubble exists before preparation or IPC starts. */
export function queueMedia(roomId: string, sources: Staged[], extra: { caption?: string; replyTo?: number; voice?: boolean; durationMs?: number }, originalQuality = false): void {
  const jobs = sources.map((source, i): OutgoingMedia => {
    const id = `desktop-${crypto.randomUUID()}`;
    const createdAt = new Date(Date.now() + i).toISOString();
    const mime = source.kind === 'blob' ? source.blob.type : '';
    const preview = source.kind === 'blob' && /^(image|video|audio)\//.test(mime) ? URL.createObjectURL(source.blob) : undefined;
    return { id, owner: owner(), roomId, name: source.kind === 'blob' ? source.name : source.file.name, size: source.kind === 'blob' ? source.blob.size : source.file.size, mime, preview, source, originalQuality, target: { kind: 'chat', roomId, clientMessageId: id, submittedAt: createdAt, ...(i === 0 ? extra : {}) }, phase: 'preparing', progress: null, error: null, createdAt };
  });
  outgoing.set({ jobs: [...outgoing.get().jobs, ...jobs] });
  jobs.forEach((j) => launch(j.id, originalQuality));
}

export async function cancelMedia(j: OutgoingMedia): Promise<void> {
  update(j.id, { phase: 'cancelled' });
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
