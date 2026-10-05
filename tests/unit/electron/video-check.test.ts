import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { videoIssue, videoProblem, webmFrames, webmProblem } from '../../../electron/services/video-check';

/** Ready to play only once the file plays (worksuite-desktop#89): a recording's file read before it is uploaded. */

function box(type: string, body: string): Buffer {
  const b = Buffer.alloc(8 + body.length);
  b.writeUInt32BE(8 + body.length, 0);
  b.write(type, 4, 'latin1');
  b.write(body, 8, 'latin1');
  return b;
}

const ftyp = box('ftyp', 'isom0000');
const moov = box('moov', 'm'.repeat(32));
const mdat = box('mdat', 'x'.repeat(500));

describe('is it a whole video', () => {
  let dir: string;
  let n = 0;
  const file = async (bytes: Buffer) => {
    const p = join(dir, `f${n++}`);
    await writeFile(p, bytes);
    return p;
  };
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ws-video-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('an MP4 needs its header, its index and its pictures, every box inside the file', async () => {
    expect(await videoProblem(await file(Buffer.concat([ftyp, moov, mdat])))).toBeNull();
    expect(await videoProblem(await file(Buffer.concat([ftyp, mdat, moov])))).toBeNull();
    expect(await videoProblem(await file(Buffer.concat([ftyp, mdat])))).toMatch(/no index/);
    expect(await videoProblem(await file(Buffer.concat([moov, mdat])))).toMatch(/not a video/);
    // A header and an index but no frames: what Chromium's MP4 writer left behind in #240.
    expect(await videoIssue(await file(Buffer.concat([ftyp, moov])))).toEqual({ kind: 'no-video', message: 'Nothing was recorded: the file has no video in it.' });
    expect(await videoProblem(await file(Buffer.concat([ftyp, moov, mdat.subarray(0, 100)])))).toMatch(/part-way/);
    expect(await videoIssue(await file(Buffer.alloc(0)))).toMatchObject({ kind: 'empty' });
    expect(await videoProblem(join(dir, 'missing.mp4'))).toMatch(/missing/);
  });

  it('a fragmented one plays up to its last whole fragment', async () => {
    const frag = Buffer.concat([ftyp, moov, box('moof', 'f'), box('mdat', 'x')]);
    expect(await videoProblem(await file(Buffer.concat([frag, box('moof', 'f'.repeat(40)).subarray(0, 20)])))).toBeNull();
    expect(await videoProblem(await file(Buffer.concat([frag, box('moof', 'ff').subarray(0, 5)])))).toBeNull();
    expect(await videoProblem(await file(Buffer.concat([ftyp, moov, box('moof', 'f'.repeat(40)).subarray(0, 20)])))).toMatch(/part-way/);
  });

  it('a WebM must hold at least one frame of its video track (#240)', async () => {
    const el = (id: number[], body: Buffer | number[]) => Buffer.concat([Buffer.from(id), Buffer.from([0x80 | (Buffer.from(body).length)]), Buffer.from(body)]);
    const unknown = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
    const ebml = el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], Buffer.from('webm')));
    const entry = (num: number, type: number) => el([0xae], Buffer.concat([el([0xd7], [num]), el([0x83], [type])]));
    const tracks = el([0x16, 0x54, 0xae, 0x6b], Buffer.concat([entry(1, 2), entry(2, 1)])); // 1 sound, 2 video
    const head = Buffer.concat([ebml, Buffer.from([0x18, 0x53, 0x80, 0x67, ...unknown]), tracks]);
    const cluster = (...blocks: Buffer[]) => Buffer.concat([Buffer.from([0x1f, 0x43, 0xb6, 0x75, ...unknown]), el([0xe7], [0]), ...blocks]);
    const block = (track: number) => el([0xa3], [0x80 | track, 0, 0, 0x80, 1, 2, 3]);

    expect(webmProblem(Buffer.concat([head, cluster(block(1), block(2))]))).toBeNull();
    expect(webmFrames(Buffer.concat([head, cluster(block(1), block(2), block(2))]))).toMatchObject({ videoTracks: 1, videoFrames: 2, frames: 3 });
    // A header only — the 1.2 KB file of #240 — or sound only: nothing was recorded.
    expect(webmProblem(head)).toBe('Nothing was recorded: the file has no video in it.');
    expect(webmProblem(Buffer.concat([head, cluster(block(1), block(1))]))).toMatch(/no video/);
    expect(webmProblem(Buffer.from('text'))).toMatch(/not a video/);
    expect(await videoProblem(await file(Buffer.concat([head, cluster(block(2))])))).toBeNull();
    expect(await videoIssue(await file(head))).toMatchObject({ kind: 'no-video' });
    // A frame in a BlockGroup counts too.
    expect(webmProblem(Buffer.concat([head, cluster(el([0xa0], el([0xa1], [0x82, 0, 0, 1])))]))).toBeNull();
  });
});
