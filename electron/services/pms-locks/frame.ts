/**
 * The framed ASCII links hotel lock servers speak on TCP (Salto's SHIP, Saflok's PMS interface): STX, the command
 * and its fields joined by the link's separator, ETX, then an LRC byte — the XOR of every byte after STX up to and
 * including ETX. A single ACK / NAK byte acknowledges a frame; ENQ asks whether the other end is there.
 *
 * Latin-1 on the wire, so SHIP's separator (0xB3) is one byte. The fields come from WorkSuite's payload, already
 * limited to printable ASCII by the contract's schema.
 */
export const STX = 0x02;
export const ETX = 0x03;
export const ENQ = 0x05;
export const ACK = 0x06;
export const NAK = 0x15;

export function lrc(bytes: Uint8Array): number {
  let x = 0;
  for (const b of bytes) x ^= b;
  return x;
}

/** One frame: STX command SEP field SEP field … ETX LRC. */
export function frame(command: string, fields: readonly string[], separator: string): Buffer {
  const body = Buffer.from([command, ...fields].join(separator), 'latin1');
  const tail = Buffer.concat([body, Buffer.from([ETX])]);
  return Buffer.concat([Buffer.from([STX]), tail, Buffer.from([lrc(tail)])]);
}

export interface Parsed {
  /** ACK / NAK bytes seen before a frame. */
  acks: number[];
  /** The first whole frame, split into command and fields; null while it has not all arrived. */
  frame: { command: string; fields: string[]; lrcOk: boolean } | null;
  /** Bytes after that frame. */
  rest: Buffer;
}

/** Read what has arrived so far: leading ACK / NAK bytes, then at most one frame. */
export function parse(buf: Buffer, separator: string): Parsed {
  const acks: number[] = [];
  let i = 0;
  while (i < buf.length && buf[i] !== STX) {
    const b = buf[i] ?? 0;
    if (b === ACK || b === NAK) acks.push(b);
    i++;
  }
  if (i >= buf.length) return { acks, frame: null, rest: Buffer.alloc(0) };
  const end = buf.indexOf(ETX, i + 1);
  if (end < 0 || end + 1 >= buf.length) return { acks, frame: null, rest: buf.subarray(i) };
  const tail = buf.subarray(i + 1, end + 1);
  const text = buf.subarray(i + 1, end).toString('latin1');
  const [command, ...fields] = text.split(separator);
  return { acks, frame: { command: command ?? '', fields, lrcOk: lrc(tail) === buf[end + 1] }, rest: buf.subarray(end + 2) };
}
