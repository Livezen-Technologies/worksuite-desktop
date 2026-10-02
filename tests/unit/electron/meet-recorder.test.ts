import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('electron', () => ({ shell: { showItemInFolder: vi.fn() }, app: { getPath: () => tmpdir() } }));

import { MeetRecorder, recordingFileName } from '../../../electron/services/meet-recorder';
import { withDuration } from '../../../electron/services/webm-duration';
import { DesktopError } from '../../../electron/main/errors';
import type { MeetRecordingPrefs } from '../../../shared/types';

/** The start of a WebM as Chromium's MediaRecorder writes it: EBML header, a Segment of unknown size, Info without a Duration. */
function webmHead(): Buffer {
  const ebml = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x82, 0x81, 0x77]); // DocType "w" — enough to be skipped
  const segment = Buffer.from([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  const scale = Buffer.from([0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40]); // TimecodeScale 1,000,000
  const app = Buffer.from([0x4d, 0x80, 0x84, 0x43, 0x68, 0x72, 0x6f]); // MuxingApp "Chro"
  const infoBody = Buffer.concat([scale, app]);
  const info = Buffer.concat([Buffer.from([0x15, 0x49, 0xa9, 0x66, 0x40 | 0, infoBody.length]), infoBody]); // 2-byte size vint
  const tracks = Buffer.from([0x16, 0x54, 0xae, 0x6b, 0x80]);
  const cluster = Buffer.from([0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xe7, 0x81, 0x00]);
  return Buffer.concat([ebml, segment, info, tracks, cluster]);
}

/** A box of an MP4: its size, its type, its body. */
function box(type: string, body: string): Buffer {
  const b = Buffer.alloc(8 + body.length);
  b.writeUInt32BE(8 + body.length, 0);
  b.write(type, 4, 'latin1');
  b.write(body, 8, 'latin1');
  return b;
}

/** A fragmented MP4 as Chromium's MediaRecorder writes it: header, index, then fragments of pictures. */
const MP4 = Buffer.concat([box('ftyp', 'isom0000'), box('moov', 'm'.repeat(16)), box('moof', 'f'), box('mdat', 'xyz')]);

describe('giving a WebM recording its length', () => {
  it('adds a Duration to the Info, growing it, and leaves the frames as they were', () => {
    const head = webmHead();
    const r = withDuration(head, 90_500)!;
    expect(r).not.toBeNull();
    const out = Buffer.concat([r.bytes, head.subarray(r.replaces)]);
    expect(out.length).toBe(head.length + 11);
    const at = out.indexOf(Buffer.from([0x44, 0x89, 0x88]));
    expect(at).toBeGreaterThan(0);
    expect(out.readDoubleBE(at + 3)).toBe(90_500);
    // The cluster is untouched, after the grown Info.
    expect(out.subarray(out.length - 15).equals(head.subarray(head.length - 15))).toBe(true);
    // A second pass sets it again in place.
    const again = withDuration(out, 1000)!;
    expect(again.bytes.length).toBe(again.replaces);
  });

  it('leaves alone what it cannot safely change', () => {
    expect(withDuration(Buffer.from('not a webm at all'), 1000)).toBeNull();
    expect(withDuration(webmHead(), 0)).toBeNull();
    const seek = webmHead();
    seek.set([0x11, 0x4d, 0x9b, 0x74], 21); // a SeekHead where the Info was: offsets would move
    expect(withDuration(seek, 1000)).toBeNull();
  });
});

describe('recording a meeting on this computer', () => {
  let dir: string;
  let config: Record<string, unknown>;
  let prefs: MeetRecordingPrefs;
  let uploaded: Map<string, (o: { fileId: string | null } | { error: string }) => void>;
  let transferState: Record<string, { state: string; fileId: string | null }>;
  const http = { post: vi.fn() };
  const notify = vi.fn();
  const openPath = vi.fn(async (_p: string) => '');

  const make = (free: number | null = 10 * 1024 ** 3) =>
    new MeetRecorder({
      db: { getConfig: <T>(k: string) => config[k] as T, setConfig: (k: string, v: unknown) => void (config[k] = JSON.parse(JSON.stringify(v))) },
      http,
      transfers: {
        uploadOwn: vi.fn(async () => {
          const id = `t${uploaded.size + 1}`;
          transferState[id] = { state: 'running', fileId: null };
          return id;
        }),
        uploadStatus: (id: string) => (transferState[id] ? { ...transferState[id]!, error: null, bytes: 0, total: 0 } : null) as never,
        whenUploaded: (id: string, cb: (o: { fileId: string | null } | { error: string }) => void) => void uploaded.set(id, cb),
        resume: vi.fn(),
      } as never,
      prefs: () => prefs,
      userId: () => '7',
      freeSpace: async () => free,
      notify,
      openPath,
    });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ws-rec-'));
    config = {};
    prefs = { method: 'local', quality: '720p', layout: 'grid', folder: 'Meeting Recordings', localFolder: dir, keepLocal: 'delete' };
    uploaded = new Map();
    transferState = {};
    notify.mockReset();
    openPath.mockClear();
    http.post.mockReset().mockImplementation(async (path: string, body?: { action?: string }) => {
      if (path === '/api/meet/recordings/folder') return { id: 44 };
      if (body?.action === 'ready') return { size: MP4.length };
      return {};
    });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('names files so no file system refuses them', () => {
    expect(recordingFileName('Q3: plan / review?', new Date(2026, 9, 1, 9, 5), '.webm')).toBe('Q3 plan review 2026-10-01 090500.webm');
  });

  it('writes as it goes, then finishes, uploads to Drive, checks it, and deletes the local copy as chosen', async () => {
    const rec = make();
    const { id } = await rec.start({ meeting: 'm-uuid-123', title: 'Board', layout: 'grid', mime: 'video/mp4' });
    expect(http.post).toHaveBeenCalledWith('/api/meet/m-uuid-123/recordings/local', expect.objectContaining({ client_id: id, action: 'start' }));
    await rec.chunk(id, new Uint8Array(MP4.subarray(0, 30)));
    await rec.chunk(id, new Uint8Array(MP4.subarray(30)));
    const part = rec.list()[0]!;
    expect(part.state).toBe('recording');
    expect(part.bytes).toBe(MP4.length);
    await rec.stop(id, 60_000);
    await vi.waitFor(() => expect(uploaded.size).toBe(1));
    const view = rec.list()[0]!;
    expect(http.post).toHaveBeenCalledWith('/api/meet/recordings/folder', { name: 'Meeting Recordings', meeting: 'm-uuid-123', client_id: id });
    expect(view.state).toBe('uploading');
    expect(view.fileName).toMatch(/^Board .*\.mp4$/);
    const local = join(dir, view.fileName!);
    expect(await readFile(local)).toEqual(MP4);
    expect(view.transferId).toBe('t1');

    uploaded.get('t1')!({ fileId: '901' });
    await vi.waitFor(() => expect(rec.list()[0]!.state).toBe('ready'));
    expect(http.post).toHaveBeenCalledWith('/api/meet/m-uuid-123/recordings/local', expect.objectContaining({ action: 'ready', file_id: 901 }));
    expect(rec.list()[0]!.driveFileId).toBe(901);
    expect(existsSync(local)).toBe(false);
    // Ready to play, and the person is told so.
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ id, state: 'ready', driveFileId: 901 }), 'ready');
  });

  it('keeps the local copy when Drive does not have the same file, and says so', async () => {
    http.post.mockImplementation(async (path: string, body?: { action?: string }) => (path.endsWith('/folder') ? { id: 44 } : body?.action === 'ready' ? { size: 999 } : {}));
    const rec = make();
    const { id } = await rec.start({ meeting: 'm-uuid-123', title: 'Board', layout: 'grid', mime: 'video/mp4' });
    await rec.chunk(id, new Uint8Array(MP4));
    await rec.stop(id, 1000);
    await vi.waitFor(() => expect(uploaded.size).toBe(1));
    uploaded.get('t1')!({ fileId: '901' });
    await vi.waitFor(() => expect(rec.list()[0]!.state).toBe('failed'));
    expect(rec.list()[0]!.failedAt).toBe('registering');
    expect(existsSync(join(dir, rec.list()[0]!.fileName!))).toBe(true);
  });

  it('does not start without room on the disk, nor when the server says this person may not record', async () => {
    await expect(make(100 * 1024 ** 2).start({ meeting: 'm-uuid-123', title: 'Board', layout: 'grid', mime: 'video/webm' })).rejects.toThrow(/GB free/);
    http.post.mockRejectedValueOnce(new DesktopError('PERMISSION_DENIED', 'Only the host can record', 403));
    const rec = make();
    await expect(rec.start({ meeting: 'm-uuid-123', title: 'Board', layout: 'grid', mime: 'video/webm' })).rejects.toThrow('Only the host can record');
    expect(rec.list()).toEqual([]);
  });

  it('a failed upload is tried again as the same upload, never a second file', async () => {
    const rec = make();
    const { id } = await rec.start({ meeting: 'm-uuid-123', title: 'Board', layout: 'grid', mime: 'video/mp4' });
    await rec.chunk(id, new Uint8Array(MP4));
    await rec.stop(id, 1000);
    await vi.waitFor(() => expect(uploaded.size).toBe(1));
    transferState.t1!.state = 'failed';
    uploaded.get('t1')!({ error: 'offline' });
    await vi.waitFor(() => expect(rec.list()[0]!.state).toBe('failed'));
    uploaded.clear();
    await rec.retry(rec.list()[0]!.id);
    expect(rec.list()[0]!.state).toBe('uploading');
    expect(uploaded.has('t1')).toBe(true);
  });

  it('after a crash mid-recording, finishes what reached the disk and uploads it', async () => {
    const rec = make();
    const { id } = await rec.start({ meeting: 'm-uuid-123', title: 'Board', layout: 'grid', mime: 'video/mp4' });
    // The fragment being written when WorkSuite closed is cut short: the whole ones before it still play.
    const cut = Buffer.concat([MP4, box('moof', 'ffff').subarray(0, 6)]);
    await rec.chunk(id, new Uint8Array(cut));
    // WorkSuite closes without stopping; it opens again.
    const after = make();
    await after.recover();
    await vi.waitFor(() => expect(uploaded.size).toBe(1));
    const view = after.list()[0]!;
    expect(view.recovered).toBe(true);
    expect(view.state).toBe('uploading');
    expect((await stat(join(dir, view.fileName!))).size).toBe(cut.length);
    expect(after.pending()).toEqual({ recording: 0, working: 1 });
  });

  it('deletes kept local copies when their time is up', async () => {
    prefs.keepLocal = '7';
    const rec = make();
    const { id } = await rec.start({ meeting: 'm-uuid-123', title: 'Board', layout: 'grid', mime: 'video/mp4' });
    await rec.chunk(id, new Uint8Array(MP4));
    await rec.stop(id, 1000);
    await vi.waitFor(() => expect(uploaded.size).toBe(1));
    uploaded.get('t1')!({ fileId: '5' });
    await vi.waitFor(() => expect(rec.list()[0]!.state).toBe('ready'));
    const file = join(dir, rec.list()[0]!.fileName!);
    expect(existsSync(file)).toBe(true);
    await rec.sweep(Date.now() + 8 * 24 * 3600 * 1000);
    expect(existsSync(file)).toBe(false);
    expect(rec.list()[0]!.fileName).toBeNull();
  });

  it('never discards a recording that is still being made', async () => {
    const rec = make();
    const { id } = await rec.start({ meeting: 'm-uuid-123', title: 'Board', layout: 'grid', mime: 'video/webm' });
    await expect(rec.discard(id)).rejects.toThrow(/Wait until/);
    await writeFile(join(dir, 'x'), 'x');
  });

  it('never uploads a file that is not a whole video: it fails, says why, keeps the file and tells the person', async () => {
    const rec = make();
    const { id } = await rec.start({ meeting: 'm-uuid-123', title: 'Board', layout: 'grid', mime: 'video/mp4' });
    await rec.chunk(id, new Uint8Array([1, 2, 3, 4, 5]));
    await rec.stop(id, 1000);
    await vi.waitFor(() => expect(rec.list()[0]!.state).toBe('failed'));
    const view = rec.list()[0]!;
    expect(view.failedAt).toBe('processing');
    expect(view.error).toMatch(/cannot be played|not a video/);
    expect(uploaded.size).toBe(0);
    expect(existsSync(join(dir, view.fileName!))).toBe(true);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ id, state: 'failed' }), 'failed');
  });

  it('a cancelled upload keeps the recording on this computer, quietly, and Try again uploads it anew', async () => {
    const rec = make();
    const { id } = await rec.start({ meeting: 'm-uuid-123', title: 'Board', layout: 'grid', mime: 'video/mp4' });
    await rec.chunk(id, new Uint8Array(MP4));
    await rec.stop(id, 1000);
    await vi.waitFor(() => expect(uploaded.size).toBe(1));
    transferState.t1!.state = 'cancelled';
    uploaded.get('t1')!({ error: 'The upload was cancelled.' });
    await vi.waitFor(() => expect(rec.list()[0]!.state).toBe('failed'));
    const view = rec.list()[0]!;
    expect(view.error).toMatch(/cancelled\. The recording is kept on this computer/);
    expect(existsSync(join(dir, view.fileName!))).toBe(true);
    expect(notify).not.toHaveBeenCalled();
    await rec.retry(id);
    await vi.waitFor(() => expect(uploaded.size).toBe(2));
  });

  it('keeps when each step began, and plays the finished copy here', async () => {
    const rec = make();
    const { id } = await rec.start({ meeting: 'm-uuid-123', title: 'Board', layout: 'grid', mime: 'video/mp4' });
    expect(rec.list()[0]!.stepAt).toBeTruthy();
    await expect(rec.openLocal(id)).rejects.toThrow(/no finished copy/);
    await rec.chunk(id, new Uint8Array(MP4));
    const before = rec.list()[0]!.stepAt!;
    await new Promise((r) => setTimeout(r, 5));
    await rec.stop(id, 1000);
    await vi.waitFor(() => expect(uploaded.size).toBe(1));
    expect(Date.parse(rec.list()[0]!.stepAt!)).toBeGreaterThan(Date.parse(before));
    await expect(rec.openLocal(id)).resolves.toBe(true);
    expect(openPath).toHaveBeenCalledWith(join(dir, rec.list()[0]!.fileName!));
  });

  it("remembers which transfer has each recording's download, after a restart too", () => {
    const rec = make();
    expect(rec.downloads()).toEqual({});
    rec.rememberDownload(5, 'dl-1');
    rec.rememberDownload(6, 'dl-2');
    rec.rememberDownload(5, 'dl-3');
    expect(make().downloads()).toEqual({ '5': 'dl-3', '6': 'dl-2' });
  });
});
