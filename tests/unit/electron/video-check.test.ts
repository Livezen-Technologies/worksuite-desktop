import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { videoProblem, webmProblem } from '../../../electron/services/video-check';

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
    expect(await videoProblem(await file(Buffer.concat([ftyp, moov])))).toMatch(/no pictures/);
    expect(await videoProblem(await file(Buffer.concat([ftyp, moov, mdat.subarray(0, 100)])))).toMatch(/part-way/);
    expect(await videoProblem(await file(Buffer.alloc(0)))).toMatch(/empty/);
    expect(await videoProblem(join(dir, 'missing.mp4'))).toMatch(/missing/);
  });

  it('a fragmented one plays up to its last whole fragment', async () => {
    const frag = Buffer.concat([ftyp, moov, box('moof', 'f'), box('mdat', 'x')]);
    expect(await videoProblem(await file(Buffer.concat([frag, box('moof', 'f'.repeat(40)).subarray(0, 20)])))).toBeNull();
    expect(await videoProblem(await file(Buffer.concat([frag, box('moof', 'ff').subarray(0, 5)])))).toBeNull();
    expect(await videoProblem(await file(Buffer.concat([ftyp, moov, box('moof', 'f'.repeat(40)).subarray(0, 20)])))).toMatch(/part-way/);
  });

  it('a WebM must hold pictures', async () => {
    const head = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80, 0x18, 0x53, 0x80, 0x67, 0x80]);
    const cluster = Buffer.from([0x1f, 0x43, 0xb6, 0x75, 0x80, 1, 2, 3]);
    expect(webmProblem(Buffer.concat([head, cluster]))).toBeNull();
    expect(webmProblem(head)).toMatch(/no pictures/);
    expect(webmProblem(Buffer.from('text'))).toMatch(/not a video/);
    expect(await videoProblem(await file(Buffer.concat([head, cluster])))).toBeNull();
  });
});
