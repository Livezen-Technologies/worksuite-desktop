import { open } from 'node:fs/promises';

/**
 * Whether a recording made on this computer is a video a player can open (worksuite-desktop#89), before it is
 * uploaded and before anything says it is ready to play. The server reads the copy in Drive by the same rules.
 *
 * A WebM must start as one and hold at least one frame of its video track near the start (worksuite-desktop#240: a
 * recording whose clusters hold only a header, or only sound, is not a video). An MP4 is read box by box from the
 * top: it needs its header (`ftyp`), its index (`moov`) and pictures (`mdat` or `moof` fragments), with every box
 * inside the file — except that a fragmented one, as Chromium records it, plays up to its last whole fragment, so
 * the one being written when WorkSuite closed may be cut short.
 */

const EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const HEAD = 4 * 1024 * 1024;

/** What is wrong, by kind, so the screens can offer what fixes it: an empty or picture-less file is never retried. */
export type VideoIssueKind = 'missing' | 'empty' | 'no-video' | 'cut' | 'not-video' | 'no-index';
export interface VideoIssue {
  kind: VideoIssueKind;
  message: string;
}

const ISSUE: Record<VideoIssueKind, string> = {
  missing: 'The recording file is missing or could not be read.',
  empty: 'Nothing was recorded: the file is empty.',
  'no-video': 'Nothing was recorded: the file has no video in it.',
  cut: 'The recording file is incomplete: it ends part-way through, so it cannot be played.',
  'not-video': 'The recording file is not a video WorkSuite can play.',
  'no-index': 'The recording file is incomplete: it has no index, so it cannot be played.',
};

const issue = (kind: VideoIssueKind): VideoIssue => ({ kind, message: ISSUE[kind] });

/** Nothing reached the file: recording again is the only fix (worksuite-desktop#240). */
export function isNothingRecorded(kind: VideoIssueKind | null | undefined): boolean {
  return kind === 'empty' || kind === 'no-video';
}

// ── WebM ──────────────────────────────────────────────────────────────────

const ID = {
  segment: 0x18538067,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  trackNumber: 0xd7,
  trackType: 0x83,
  cluster: 0x1f43b675,
  blockGroup: 0xa0,
  block: 0xa1,
  simpleBlock: 0xa3,
} as const;
/** Masters whose children are read in place, whatever their size says (Chromium writes "unknown" for some). */
const DESCEND = new Set<number>([ID.segment, ID.tracks, ID.trackEntry, ID.cluster, ID.blockGroup]);

function readId(b: Buffer, at: number): { id: number; len: number } | null {
  const first = b[at];
  if (first === undefined || first === 0) return null;
  const len = first >= 0x80 ? 1 : first >= 0x40 ? 2 : first >= 0x20 ? 3 : first >= 0x10 ? 4 : 0;
  if (!len || at + len > b.length) return null;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + b[at + i]!;
  return { id, len };
}

/** A size (or a track number): its value without the length marker; `unknown` when every bit is set. */
function readVint(b: Buffer, at: number): { value: number; len: number; unknown: boolean } | null {
  const first = b[at];
  if (first === undefined || first === 0) return null;
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8 || at + len > b.length) return null;
  let value = first & (0xff >> len);
  let ones = value === 0xff >> len;
  for (let i = 1; i < len; i++) {
    const byte = b[at + i]!;
    value = value * 256 + byte;
    if (byte !== 0xff) ones = false;
  }
  return { value, len, unknown: ones };
}

function readUint(b: Buffer, at: number, len: number): number {
  let v = 0;
  for (let i = 0; i < len && i < 8; i++) v = v * 256 + b[at + i]!;
  return v;
}

/** What a WebM's start holds: its tracks, and how many frames of each kind reached it. */
export function webmFrames(head: Buffer): { segment: boolean; clusters: number; videoTracks: number; videoFrames: number; frames: number } {
  const types = new Map<number, number>();
  const blocks = new Map<number, number>();
  let segment = false;
  let clusters = 0;
  let entry: { number: number | null; type: number | null } | null = null;
  const closeEntry = () => {
    if (entry?.number !== null && entry?.number !== undefined && entry.type !== null) types.set(entry.number, entry.type);
    entry = null;
  };
  let pos = 0;
  for (let n = 0; pos < head.length && n < 1_000_000; n++) {
    const id = readId(head, pos);
    if (!id) break;
    const size = readVint(head, pos + id.len);
    if (!size) break;
    const body = pos + id.len + size.len;
    if (id.id === ID.segment) segment = true;
    if (id.id === ID.cluster) clusters++;
    if (id.id === ID.trackEntry) {
      closeEntry();
      entry = { number: null, type: null };
    }
    if (id.id === ID.cluster) closeEntry();
    if (DESCEND.has(id.id)) {
      pos = body;
      continue;
    }
    if (size.unknown || body + size.value > head.length) break;
    if (entry && id.id === ID.trackNumber) entry.number = readUint(head, body, size.value);
    if (entry && id.id === ID.trackType) entry.type = readUint(head, body, size.value);
    if (id.id === ID.simpleBlock || id.id === ID.block) {
      const track = readVint(head, body);
      if (track) blocks.set(track.value, (blocks.get(track.value) ?? 0) + 1);
    }
    pos = body + size.value;
  }
  closeEntry();
  const video = [...types].filter(([, t]) => t === 1).map(([num]) => num);
  const frames = [...blocks.values()].reduce((a, b) => a + b, 0);
  return { segment, clusters, videoTracks: video.length, videoFrames: video.reduce((a, num) => a + (blocks.get(num) ?? 0), 0), frames };
}

/** What is wrong with the start of a WebM, or null when it holds video frames. */
export function webmIssue(head: Buffer): VideoIssue | null {
  if (!head.subarray(0, 4).equals(EBML)) return issue('not-video');
  const f = webmFrames(head);
  if (!f.segment) return issue('cut');
  // Without a Tracks element nothing says which frames are video: then any frame will do.
  return (f.videoTracks ? f.videoFrames : f.frames) > 0 ? null : issue('no-video');
}

/** What is wrong with the start of a WebM, in a sentence, or null when it holds video frames. */
export function webmProblem(head: Buffer): string | null {
  return webmIssue(head)?.message ?? null;
}

// ── any recording ─────────────────────────────────────────────────────────

/** What is wrong with a recording's file, by kind, or null when it is a whole video. */
export async function videoIssue(path: string): Promise<VideoIssue | null> {
  const fh = await open(path, 'r').catch(() => null);
  if (!fh) return issue('missing');
  try {
    const size = (await fh.stat()).size;
    if (size === 0) return issue('empty');
    const head = Buffer.alloc(Math.min(HEAD, size));
    await fh.read(head, 0, head.length, 0);
    if (head.subarray(0, 4).equals(EBML)) return webmIssue(head);
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
        return issue('cut');
      }
      if (!/^[\x20-\x7e]{4}$/.test(type)) return issue('not-video');
      seen.add(type);
      pos += len;
    }
    if (!seen.has('ftyp')) return issue('not-video');
    if (!seen.has('moov')) return issue('no-index');
    if (!seen.has('mdat') && !seen.has('moof')) return issue('no-video');
    return null;
  } finally {
    await fh.close();
  }
}

/** What is wrong with a recording's file, in a sentence, or null when it is a whole video. */
export async function videoProblem(path: string): Promise<string | null> {
  return (await videoIssue(path))?.message ?? null;
}
