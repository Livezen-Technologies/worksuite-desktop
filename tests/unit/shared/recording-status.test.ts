import { describe, expect, it } from 'vitest';
import { downloadStatus, etaLabel, explainTransferProblem, FINALIZE_STALL_MS, localRecordingStatus, serverRecordingStatus, TRANSFER_STALL_MS } from '../../../shared/recording-status';
import type { LocalRecording, Transfer } from '../../../shared/types';

/**
 * Recording status (worksuite-desktop#89): one set of words, numbers and actions for a recording wherever it is
 * listed — measured progress only, stuck steps said with what to do, and a download told apart from playability.
 */

const NOW = Date.parse('2026-10-01T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const rec = (o: Partial<LocalRecording> = {}): LocalRecording => ({
  id: 'r1',
  meeting: 'm-uuid-123',
  title: 'Board',
  state: 'uploading',
  error: null,
  failedAt: null,
  bytes: 300,
  uploaded: 0,
  startedAt: ago(3_600_000),
  endedAt: ago(60_000),
  durationMs: 3_540_000,
  fileName: 'Board 2026-10-01 1100.webm',
  driveFileId: null,
  deleteAfter: null,
  recovered: false,
  stepAt: ago(30_000),
  transferId: 't1',
  ...o,
});

const tr = (o: Partial<Transfer> = {}): Transfer => ({
  id: 't1',
  direction: 'upload',
  name: 'Board.webm',
  source: '/x',
  destination: 'WorkSuite Files',
  bytes: 0,
  total: 300,
  state: 'running',
  speed: 0,
  error: null,
  createdAt: ago(60_000),
  position: null,
  retryAt: null,
  attempts: 0,
  movedAt: ago(1_000),
  held: null,
  ...o,
});

describe('a recording made on this computer', () => {
  it('goes Recording → Finalizing → Queued → Uploading to Drive → Ready to play', () => {
    const recording = localRecordingStatus(rec({ state: 'recording', bytes: 5_000_000 }), null, NOW);
    expect(recording.label).toBe('Recording');
    expect(recording.progress).toEqual({ percent: null, done: 5_000_000, total: null, etaSeconds: null });
    expect(recording.savedLocally).toBe(true);

    const finalizing = localRecordingStatus(rec({ state: 'processing' }), null, NOW);
    expect(finalizing.label).toBe('Finalizing');
    expect(finalizing.progress?.percent).toBeNull();
    expect(finalizing.stalled).toBe(false);

    const queued = localRecordingStatus(rec(), tr({ state: 'queued', position: 3 }), NOW);
    expect(queued.label).toBe('Queued');
    expect(queued.note).toMatch(/number 3 in the transfer queue/);
    expect(queued.actions).toEqual(['pause', 'cancel']);

    const uploading = localRecordingStatus(rec(), tr({ bytes: 150, speed: 10 }), NOW);
    expect(uploading.label).toBe('Uploading to Drive');
    expect(uploading.progress).toEqual({ percent: 50, done: 150, total: 300, etaSeconds: 15 });
    expect(uploading.actions).toEqual(['pause', 'cancel']);

    const ready = localRecordingStatus(rec({ state: 'ready', driveFileId: 9, transferId: null }), null, NOW);
    expect(ready.label).toBe('Ready to play');
    expect(ready.playable).toBe(true);
    expect(ready).toMatchObject({ savedLocally: true, savedToDrive: true });
    expect(ready.actions).toEqual(['play', 'openInDrive', 'reveal']);
    // The local copy deleted as chosen: in Drive only.
    expect(localRecordingStatus(rec({ state: 'ready', driveFileId: 9, fileName: null }), null, NOW)).toMatchObject({ savedLocally: false, savedToDrive: true, actions: ['play', 'openInDrive'] });
  });

  it('never makes up a percentage: an upload of unknown size moves without one', () => {
    const s = localRecordingStatus(rec(), tr({ total: 0, bytes: 1024 }), NOW);
    expect(s.progress?.percent).toBeNull();
    expect(s.progress?.etaSeconds).toBeNull();
    expect(localRecordingStatus(rec(), tr({ bytes: 100, speed: 0 }), NOW).progress?.etaSeconds).toBeNull();
  });

  it('is Paused when its upload is, and says why — the connection, the disk, Drive storage', () => {
    const lost = localRecordingStatus(rec(), tr({ state: 'paused', error: 'The connection was lost. Resume to continue.' }), NOW);
    expect(lost.label).toBe('Paused');
    expect(lost.note).toMatch(/connection was lost/);
    expect(lost.actions).toEqual(['resume', 'cancel']);
    expect(localRecordingStatus(rec(), tr({ state: 'paused' }), NOW).note).toMatch(/Resume to carry on/);
    const held = localRecordingStatus(rec(), tr({ state: 'queued', held: 'connection' }), NOW);
    expect(held.note).toMatch(/Waiting for the connection/);
    expect(held.tone).toBe('warning');
    const full = localRecordingStatus(rec({ state: 'failed', failedAt: 'uploading', error: 'The upload stopped: The server answered 507.. It continues from where it was when you try again.' }), null, NOW);
    expect(full.note).toMatch(/Drive is out of storage space/);
    expect(full.actions).toEqual(['retry', 'reveal']);
  });

  it('says when it is stuck, instead of moving for ever', () => {
    const slow = localRecordingStatus(rec({ state: 'processing', stepAt: ago(FINALIZE_STALL_MS + 1) }), null, NOW);
    expect(slow.stalled).toBe(true);
    expect(slow.note).toMatch(/taking much longer/);
    expect(slow.actions).toEqual(['reveal']);

    const idle = localRecordingStatus(rec(), tr({ bytes: 100, movedAt: ago(TRANSFER_STALL_MS + 1) }), NOW);
    expect(idle.stalled).toBe(true);
    expect(idle.note).toMatch(/Nothing has been uploaded/);
    expect(idle.note).toMatch(/stays on this computer/);
    expect(localRecordingStatus(rec(), tr({ bytes: 100, movedAt: ago(TRANSFER_STALL_MS - 1000) }), NOW).stalled).toBe(false);
  });

  it('a waiting retry says when', () => {
    const s = localRecordingStatus(rec(), tr({ state: 'queued', retryAt: new Date(NOW + 30_000).toISOString(), attempts: 1, error: 'fetch failed' }), NOW);
    expect(s.note).toMatch(/connection was lost.*Trying again in 30 s \(attempt 2\)/);
  });
});

describe('a recording in the server list', () => {
  it('reads the server states as ours', () => {
    expect(serverRecordingStatus({ status: 'recording' }).label).toBe('Recording');
    expect(serverRecordingStatus({ status: 'processing', method: 'cloud' }).label).toBe('Processing');
    expect(serverRecordingStatus({ status: 'processing', method: 'local' }).label).toBe('Finalizing');
    expect(serverRecordingStatus({ status: 'uploading' }).progress?.percent).toBeNull();
    const ready = serverRecordingStatus({ status: 'ready', drive_file_id: 4, playable: true });
    expect(ready).toMatchObject({ label: 'Ready to play', playable: true, savedToDrive: true, actions: ['play', 'openInDrive'] });
    expect(serverRecordingStatus({ ready: false }).label).toBe('Processing');
    expect(serverRecordingStatus({ ready: true }).playable).toBe(true);
  });

  it('a stuck one says what to do; a failed cloud one can be tried again', () => {
    const stuck = serverRecordingStatus({ status: 'processing', stalled: true, guidance: 'Ask your administrator.' });
    expect(stuck).toMatchObject({ stalled: true, tone: 'warning', note: 'Ask your administrator.' });
    expect(serverRecordingStatus({ status: 'failed', error: 'No index.' })).toMatchObject({ note: 'No index.', actions: ['retry'] });
    expect(serverRecordingStatus({ status: 'failed', method: 'local' }).actions).toEqual([]);
  });
});

describe('a recording downloaded to this computer', () => {
  it('Downloading, then Downloaded with Open and Show in folder — apart from playability', () => {
    expect(downloadStatus(null, NOW)).toBeNull();
    expect(downloadStatus(tr({ direction: 'download', state: 'cancelled' }), NOW)).toBeNull();
    const going = downloadStatus(tr({ direction: 'download', bytes: 30, speed: 3 }), NOW)!;
    expect(going).toMatchObject({ phase: 'downloading', label: 'Downloading', actions: ['pause', 'cancel'] });
    expect(going.progress).toEqual({ percent: 10, done: 30, total: 300, etaSeconds: 90 });
    expect(downloadStatus(tr({ direction: 'download', state: 'done', bytes: 300 }), NOW)).toMatchObject({ phase: 'downloaded', label: 'Downloaded', actions: ['open', 'reveal'] });
    expect(downloadStatus(tr({ direction: 'download', state: 'paused', error: 'ENOSPC: no space left on device' }), NOW)!.note).toMatch(/disk is full/);
    expect(downloadStatus(tr({ direction: 'download', state: 'failed', error: 'x' }), NOW)!.actions).toEqual(['retry']);
  });
});

describe('the words', () => {
  it('explains what stopped a transfer', () => {
    expect(explainTransferProblem(null)).toBeNull();
    expect(explainTransferProblem('Your storage quota is exceeded')).toMatch(/Drive is out of storage/);
    expect(explainTransferProblem('ENOSPC')).toMatch(/disk is full/);
    expect(explainTransferProblem('ECONNRESET')).toMatch(/connection was lost/);
    expect(explainTransferProblem('The file changed on disk; choose it again.')).toBe('The file changed on disk; choose it again.');
    expect(explainTransferProblem(null, 'metered')).toMatch(/metered/);
  });

  it('says how long is left', () => {
    expect(etaLabel(0)).toBe('');
    expect(etaLabel(20)).toBe('less than a minute left');
    expect(etaLabel(185)).toBe('about 3 min left');
    expect(etaLabel(3 * 3600 + 600)).toBe('about 3 h 10 min left');
  });
});
