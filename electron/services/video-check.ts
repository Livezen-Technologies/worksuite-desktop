import { open } from 'node:fs/promises';

/**
 * Whether a recording made on this computer is a video a player can open (worksuite-desktop#89), before it is
 * uploaded and before anything says it is ready to play. The server reads the copy in Drive by the same rules.
 *
 * A WebM must start as one and hold its Segment and at least one Cluster of pictures near the start. An MP4 is
 * read box by box from the top: it needs its header (`ftyp`), its index (`moov`) and pictures (`mdat` or `moof`
 * fragments), with every box inside the file — except that a fragmented one, as Chromium records it, plays up to
 * its last whole fragment, so the one being written when WorkSuite closed may be cut short.
 */

const EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const SEGMENT = Buffer.from([0x18, 0x53, 0x80, 0x67]);
const CLUSTER = Buffer.from([0x1f, 0x43, 0xb6, 0x75]);
const HEAD = 4 * 1024 * 1024;

const CUT = 'The recording file is incomplete: it ends part-way through, so it cannot be played.';

/** What is wrong with the start of a WebM, or null when it holds pictures. */
export function webmProblem(head: Buffer): string | null {
  if (!head.subarray(0, 4).equals(EBML)) return 'The recording file is not a video WorkSuite can play.';
  return head.includes(SEGMENT) && head.includes(CLUSTER) ? null : 'The recording file is incomplete: it has no pictures in it, so it cannot be played.';
}

/** What is wrong with a recording's file, or null when it is a whole video. */
export async function videoProblem(path: string): Promise<string | null> {
  const fh = await open(path, 'r').catch(() => null);
  if (!fh) return 'The recording file is missing or could not be read.';
  try {
    const size = (await fh.stat()).size;
    if (size === 0) return 'Nothing was recorded: the file is empty.';
    const head = Buffer.alloc(Math.min(HEAD, size));
    await fh.read(head, 0, head.length, 0);
    if (head.subarray(0, 4).equals(EBML)) return webmProblem(head);
    const seen = new Set<string>();
    const fragmented = () => seen.has('ftyp') && seen.has('moov') && seen.has('moof');
    const h = Buffer.alloc(16);
    let pos = 0;
    for (let boxes = 0; pos < size && boxes < 100_000; boxes++) {
      const { bytesRead } = await fh.read(h, 0, 16, pos);
      let len = bytesRead >= 8 ? h.readUInt32BE(0) : 0;
      const type = h.toString('latin1', 4, 8);
      let hdr = 8;
      if (bytesRead >= 8 && len === 1 && bytesRead >= 16) {
        len = Number(h.readBigUInt64BE(8));
        hdr = 16;
      } else if (bytesRead >= 8 && len === 0) len = size - pos;
      const whole = bytesRead >= 8 && !(len === 1 && hdr === 8) && len >= hdr && pos + len <= size;
      if (!whole) {
        // Cut off part-way: only the fragment being written when it stopped is lost.
        if (fragmented()) break;
        return CUT;
      }
      if (!/^[\x20-\x7e]{4}$/.test(type)) return 'The recording file is not a video WorkSuite can play.';
      seen.add(type);
      pos += len;
    }
    if (!seen.has('ftyp')) return 'The recording file is not a video WorkSuite can play.';
    if (!seen.has('moov')) return 'The recording file is incomplete: it has no index, so it cannot be played.';
    if (!seen.has('mdat') && !seen.has('moof')) return 'The recording file has no pictures in it.';
    return null;
  } finally {
    await fh.close();
  }
}
