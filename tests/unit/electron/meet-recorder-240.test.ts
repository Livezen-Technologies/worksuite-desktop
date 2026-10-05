import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('electron', () => ({ shell: { showItemInFolder: vi.fn() }, app: { getPath: () => tmpdir() } }));

import { MeetRecorder, NOTHING_RECORDED, SCREEN_PERMISSION_NEEDED } from '../../../electron/services/meet-recorder';
import { localRecordingStatus } from '../../../shared/recording-status';
import type { MeetRecordingPrefs, ScreenRecordingAccess } from '../../../shared/types';

/**
 * worksuite-desktop#240: a recording that would be empty does not start; one that is empty is caught before it is
 * uploaded, says the real cause with its fix, and is never offered Try again — only Delete and Fix permission.
 */

const el = (id: number[], body: Buffer | number[]) => Buffer.concat([Buffer.from(id), Buffer.from([0x80 | Buffer.from(body).length]), Buffer.from(body)]);
const unknown = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
const entry = (num: number, type: number) => el([0xae], Buffer.concat([el([0xd7], [num]), el([0x83], [type])]));
/** The start of a WebM as Chromium writes it, with a sound track (1) and a video track (2), and no frames: 1.2 KB of nothing. */
const HEADER_ONLY = Buffer.concat([
  el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], Buffer.from('webm'))),
  Buffer.from([0x18, 0x53, 0x80, 0x67, ...unknown]),
  el([0x16, 0x54, 0xae, 0x6b], Buffer.concat([entry(1, 2), entry(2, 1)])),
]);
const block = (track: number) => el([0xa3], [0x80 | track, 0, 0, 0x80, 1, 2, 3]);
const WITH_VIDEO = Buffer.concat([HEADER_ONLY, Buffer.from([0x1f, 0x43, 0xb6, 0x75, ...unknown]), el([0xe7], [0]), block(1), block(2)]);

describe('recordings that would be, or are, empty (#240)', () => {
  let dir: string;
  let config: Record<string, unknown>;
  let screen: ScreenRecordingAccess;
  const http = { post: vi.fn() };
  const notify = vi.fn();
  const uploadOwn = vi.fn(async () => 't1');

  const make = () =>
    new MeetRecorder({
      db: { getConfig: <T>(k: string) => config[k] as T, setConfig: (k: string, v: unknown) => void (config[k] = JSON.parse(JSON.stringify(v))) },
      http,
      transfers: { uploadOwn, uploadStatus: () => null, whenUploaded: () => undefined, resume: vi.fn() } as never,
      prefs: (): MeetRecordingPrefs => ({ method: 'local', quality: '720p', layout: 'grid', folder: 'Meeting Recordings', localFolder: dir, keepLocal: 'keep' as never }),
      userId: () => '7',
      freeSpace: async () => 10 * 1024 ** 3,
      notify,
      screenAccess: () => screen,
    });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ws-rec-240-'));
    config = {};
    screen = 'granted';
    notify.mockReset();
    uploadOwn.mockClear();
    http.post.mockReset().mockImplementation(async (path: string) => (path.endsWith('/folder') ? { id: 44 } : {}));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const record = async (rec: MeetRecorder, data: Buffer, durationMs = 5_000) => {
    const { id } = await rec.start({ meeting: 'm-uuid-123', title: 'Board', layout: 'grid', mime: 'video/webm;codecs=vp9,opus' });
    await rec.active(id);
    if (data.length) await rec.chunk(id, new Uint8Array(data));
    await rec.stop(id, durationMs);
    return id;
  };

  it('does not start without Screen Recording permission: nothing is written, and the server is not told', async () => {
    screen = 'missing';
    const rec = make();
    expect(await rec.preflight()).toMatchObject({ ok: false, why: SCREEN_PERMISSION_NEEDED, screen: 'missing', fix: 'screen-permission' });
    await expect(rec.start({ meeting: 'm-uuid-123', title: 'Board', layout: 'grid', mime: 'video/webm' })).rejects.toThrow(/Screen Recording permission/);
    expect(http.post).not.toHaveBeenCalled();
    expect(await readdir(dir)).toEqual([]);
    expect(rec.list()).toEqual([]);
    // Granted, or not a Mac: it starts.
    screen = 'not_required';
    expect(await make().preflight()).toMatchObject({ ok: true, fix: null });
  });

  it('a header with no video frames is not uploaded: it says nothing was recorded, and why', async () => {
    const rec = make();
    const id = await record(rec, HEADER_ONLY);
    await vi.waitFor(() => expect(rec.list()[0]!.state).toBe('failed'));
    const view = rec.list()[0]!;
    expect(view).toMatchObject({ failedAt: 'processing', problem: 'no-video', error: NOTHING_RECORDED['no-video'] });
    expect(view.error).not.toMatch(/no pictures/);
    expect(uploadOwn).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ id, problem: 'no-video' }), 'failed');
    // Trying again would find nothing again: it is refused, and the card offers Delete instead.
    await expect(rec.retry(id)).rejects.toThrow(/nothing to try again/);
    expect(localRecordingStatus(view, null).actions).toEqual(['delete']);
    await rec.discard(id);
    expect(rec.list()).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
  });

  it('when permission was turned off meanwhile, says so, with Fix permission and Delete — never Try again', async () => {
    const rec = make();
    const { id } = await rec.start({ meeting: 'm-uuid-123', title: 'Board', layout: 'grid', mime: 'video/webm' });
    await rec.active(id);
    screen = 'missing';
    await rec.stop(id, 5_000);
    await vi.waitFor(() => expect(rec.list()[0]!.state).toBe('failed'));
    const view = rec.list()[0]!;
    expect(view.problem).toBe('screen-permission');
    expect(view.error).toBe("Nothing was recorded because WorkSuite doesn't have Screen Recording permission. Turn it on in System Settings › Privacy & Security › Screen Recording, then record again.");
    const status = localRecordingStatus(view, null);
    expect(status.actions).toEqual(['fixPermission', 'delete']);
    expect(status.actions).not.toContain('retry');
  });

  it('a recording with no length is not finished as one', async () => {
    const rec = make();
    await record(rec, WITH_VIDEO, 0);
    await vi.waitFor(() => expect(rec.list()[0]!.state).toBe('failed'));
    expect(rec.list()[0]!.problem).toBe('no-video');
    expect(uploadOwn).not.toHaveBeenCalled();
  });

  it('a recording with video frames and a length is finished and uploaded', async () => {
    const rec = make();
    await record(rec, WITH_VIDEO);
    await vi.waitFor(() => expect(uploadOwn).toHaveBeenCalledOnce());
    const view = rec.list()[0]!;
    expect(view.state).toBe('uploading');
    expect(view.problem ?? null).toBeNull();
    expect(existsSync(join(dir, view.fileName!))).toBe(true);
  });

  it('a file that is not a whole video is kept to look at, but not offered Try again', async () => {
    const rec = make();
    const id = await record(rec, Buffer.from('not a video at all'));
    await vi.waitFor(() => expect(rec.list()[0]!.state).toBe('failed'));
    const view = rec.list()[0]!;
    expect(view.problem).toBe('unplayable');
    expect(localRecordingStatus(view, null).actions).toEqual(['delete', 'reveal']);
    await expect(rec.retry(id)).rejects.toThrow(/would not help/);
  });
});
