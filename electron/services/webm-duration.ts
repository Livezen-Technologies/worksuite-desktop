/**
 * Gives a recording made with MediaRecorder its length (worksuite-desktop#68).
 *
 * Chromium writes WebM as it goes, so it cannot know how long the recording will be: the file has no Duration, and
 * players then cannot show its length or seek in it. This adds one to the Segment's Info, in the first few kilobytes,
 * leaving every frame as it is. The Segment's size is "unknown" in these files, so growing the Info by a few bytes
 * moves nothing anything points at — unless there is a SeekHead (which Chromium does not write), and then the file
 * is left alone rather than risk breaking it.
 */

const EBML = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const SEEKHEAD = 0x114d9b74;
const INFO = 0x1549a966;
const TIMECODE_SCALE = 0x2ad7b1;
const DURATION = 0x4489;
const VOID = 0xec;

interface Vint {
  value: number;
  length: number;
  /** All ones: the size is unknown (a live stream's Segment or Cluster). */
  unknown: boolean;
}

function width(first: number): number {
  for (let i = 0; i < 8; i++) if (first & (0x80 >> i)) return i + 1;
  return 0;
}

/** An element ID: its bytes as a number, marker bits kept. */
function readId(b: Buffer, at: number): Vint | null {
  if (at >= b.length) return null;
  const n = width(b[at]!);
  if (!n || n > 4 || at + n > b.length) return null;
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + b[at + i]!;
  return { value: v, length: n, unknown: false };
}

/** An element size: the marker bit taken off. */
function readSize(b: Buffer, at: number): Vint | null {
  if (at >= b.length) return null;
  const n = width(b[at]!);
  if (!n || at + n > b.length) return null;
  let v = b[at]! & (0xff >> n);
  let ones = v === 0xff >> n;
  for (let i = 1; i < n; i++) {
    v = v * 256 + b[at + i]!;
    if (b[at + i] !== 0xff) ones = false;
  }
  return { value: v, length: n, unknown: ones };
}

/** A size written in exactly `n` bytes, or null when it does not fit. */
function writeSize(value: number, n: number): Buffer | null {
  if (value >= 2 ** (7 * n) - 1) return null;
  const out = Buffer.alloc(n);
  let v = value;
  for (let i = n - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  out[0]! |= 0x80 >> (n - 1);
  return out;
}

function readUint(b: Buffer, at: number, n: number): number {
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + b[at + i]!;
  return v;
}

/**
 * The start of the file with its Duration set, and how many bytes of the original it replaces — or null when the
 * start is not one this can safely change (not WebM, a SeekHead, the Info not within `head`).
 */
export function withDuration(head: Buffer, durationMs: number): { bytes: Buffer; replaces: number } | null {
  if (!(durationMs > 0)) return null;
  const ebml = readId(head, 0);
  if (!ebml || ebml.value !== EBML) return null;
  const ebmlSize = readSize(head, ebml.length);
  if (!ebmlSize || ebmlSize.unknown) return null;
  let at = ebml.length + ebmlSize.length + ebmlSize.value;

  const seg = readId(head, at);
  if (!seg || seg.value !== SEGMENT) return null;
  const segSize = readSize(head, at + seg.length);
  if (!segSize) return null;
  at += seg.length + segSize.length;

  // The Segment's children, up to its Info.
  for (;;) {
    const id = readId(head, at);
    const size = id ? readSize(head, at + id.length) : null;
    if (!id || !size || size.unknown) return null;
    if (id.value === SEEKHEAD) return null;
    if (id.value === INFO) {
      const start = at + id.length + size.length;
      const end = start + size.value;
      if (end > head.length) return null;
      let scale = 1_000_000;
      let durationAt = -1;
      for (let p = start; p < end; ) {
        const cid = readId(head, p);
        const csize = cid ? readSize(head, p + cid.length) : null;
        if (!cid || !csize) return null;
        const data = p + cid.length + csize.length;
        if (cid.value === TIMECODE_SCALE) scale = readUint(head, data, csize.value) || scale;
        if (cid.value === DURATION && csize.value === 8) durationAt = data;
        p = data + csize.value;
      }
      const value = (durationMs * 1_000_000) / scale;
      const out = Buffer.from(head.subarray(0, end));
      if (durationAt >= 0) {
        out.writeDoubleBE(value, durationAt);
        return { bytes: out, replaces: end };
      }
      // Info grows by the Duration element: ID (2), size (1), a 64-bit float.
      const element = Buffer.alloc(11);
      element.writeUInt16BE(DURATION, 0);
      element[2] = 0x88;
      element.writeDoubleBE(value, 3);
      const newSize = writeSize(size.value + 11, size.length);
      if (!newSize) return null;
      const bytes = Buffer.concat([head.subarray(0, at + id.length), newSize, head.subarray(start, end), element]);
      return { bytes, replaces: end };
    }
    if (id.value !== VOID && id.value !== SEEKHEAD && size.value > head.length) return null;
    at += id.length + size.length + size.value;
    if (at >= head.length) return null;
  }
}
