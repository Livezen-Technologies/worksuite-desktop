import { createConnection, type Socket } from 'node:net';
import { networkInterfaces } from 'node:os';
import type { DiscoveredPrinter, LabelLanguage, PrinterState } from '@shared/label';
import { sendRaw, type PrintResult } from '../salon-print';

const STX = '\u0002';
const ETX = '\u0003';
/** Drop STX, ETX and line ends from a printer's answer. */
const plain = (s: string) => s.split(STX).join('').split(ETX).join('').replace(/[\r\n]/g, '');

/**
 * How Label Studio's bytes leave this computer (FR-DSK-02, §16): to an OS queue through the existing raw path —
 * salon-print.ts `sendRaw`: CUPS `lp -o raw` or the Windows spooler's RAW data type, no shell, the printer's name
 * never on a command line — or straight to a LAN printer's raw port (9100). Nothing else: no file, no USB write, no
 * arbitrary address. A TCP target is only ever a printer this computer was given (the caller checks the allow-list).
 */

export type SendOutcome = { ok: true } | { ok: false; reason: string; state: PrinterState; uncertain: boolean };

export type Connect = (port: number, host: string) => Socket;

const TCP_TIMEOUT_MS = 15_000;

/** Bytes to a raw-TCP printer. `uncertain` once any byte was written: the printer may have printed part of it. */
export function sendTcp(host: string, port: number, bytes: Buffer, connect: Connect = (p, h) => createConnection({ port: p, host: h })): Promise<SendOutcome> {
  return new Promise((resolve) => {
    let wrote = false;
    let settled = false;
    const sock = connect(port, host);
    const done = (r: SendOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      resolve(r);
    };
    const timer = setTimeout(() => done({ ok: false, reason: 'The printer did not answer in time.', state: 'offline', uncertain: wrote }), TCP_TIMEOUT_MS);
    sock.once('connect', () => {
      wrote = true;
      sock.end(bytes, () => done({ ok: true }));
    });
    sock.once('error', (e: NodeJS.ErrnoException) => {
      const offline = e.code === 'ECONNREFUSED' || e.code === 'EHOSTUNREACH' || e.code === 'ETIMEDOUT' || e.code === 'ENETUNREACH';
      done({ ok: false, reason: offline ? 'The printer cannot be reached on the network.' : e.message, state: offline ? 'offline' : 'error', uncertain: wrote });
    });
  });
}

/** Bytes to an OS queue through sendRaw. The spooler either took the whole document or none of it. */
export async function sendSpooler(queue: string, bytes: Buffer, raw: (p: string, b: Buffer) => Promise<PrintResult> = (p, b) => sendRaw(p, b)): Promise<SendOutcome> {
  const r = await raw(queue, bytes);
  return r.ok ? r : { ok: false, reason: r.reason, state: 'error', uncertain: false };
}

/** Ask a raw-TCP printer something and read what it says back, briefly. */
export function ask(host: string, port: number, question: string, connect: Connect = (p, h) => createConnection({ port: p, host: h }), timeoutMs = 1_500): Promise<string | null> {
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const sock = connect(port, host);
    const done = (v: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      resolve(v);
    };
    const timer = setTimeout(() => done(out || null), timeoutMs);
    sock.once('connect', () => sock.write(question));
    sock.on('data', (d: Buffer) => {
      out += d.toString('latin1');
      if (out.length > 4096) done(out);
      // ~HS answers three STX…ETX strings; ~HI one.
      if (out.split(ETX).length - 1 >= (question === '~HS' ? 3 : 1)) done(out);
    });
    sock.once('error', () => done(null));
  });
}

/**
 * A Zebra's `~HS` host status (ZPL II manual): three strings. String 1 field 2 is "paper out", field 3 "paused";
 * string 2 field 3 is "head up", field 4 "ribbon out". Anything else that answers is ready.
 */
export function parseZebraStatus(text: string | null): PrinterState {
  if (!text) return 'offline';
  const parts = text.split(STX).map((s) => plain(s).split(','));
  const s1 = parts.find((p) => p.length >= 12);
  const s2 = parts.filter((p) => p.length >= 11)[1];
  if (!s1) return 'unknown';
  if (s1[1] === '1') return 'paper_out';
  if (s2?.[2] === '1') return 'head_open';
  if (s2?.[3] === '1') return 'ribbon_out';
  if (s1[2] === '1') return 'paused';
  return 'ready';
}

export async function zebraStatus(host: string, port: number, connect?: Connect): Promise<PrinterState> {
  return parseZebraStatus(await ask(host, port, '~HS', connect));
}

/** The /24 networks of this computer's own IPv4 interfaces (no more than two), as `a.b.c.`. */
export function localSubnets(ifaces: ReturnType<typeof networkInterfaces> = networkInterfaces()): string[] {
  const out = new Set<string>();
  for (const list of Object.values(ifaces)) {
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      if (/^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(i.address)) out.add(i.address.split('.').slice(0, 3).join('.') + '.');
    }
  }
  return [...out].slice(0, 2);
}

/** Whether anything answers on a port, quickly. */
export function probe(host: string, port: number, connect: Connect = (p, h) => createConnection({ port: p, host: h }), timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect(port, host);
    const timer = setTimeout(() => (sock.destroy(), resolve(false)), timeoutMs);
    sock.once('connect', () => (clearTimeout(timer), sock.destroy(), resolve(true)));
    sock.once('error', () => (clearTimeout(timer), sock.destroy(), resolve(false)));
  });
}

/**
 * LAN discovery (D04): every address of this computer's private /24 networks, 32 at a time, on the raw port; what
 * answers is asked `~HI` — a Zebra names its model, anything else is listed as an unknown raw printer. Private
 * networks only; nothing is sent but the probe and `~HI`.
 */
export async function discoverLan(opts: { subnets?: string[]; port?: number; connect?: Connect; known?: Set<string> } = {}): Promise<DiscoveredPrinter[]> {
  const port = opts.port ?? 9100;
  const hosts = (opts.subnets ?? localSubnets()).flatMap((n) => Array.from({ length: 254 }, (_, i) => `${n}${i + 1}`));
  const found: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < hosts.length) {
      const h = hosts[next++]!;
      if (await probe(h, port, opts.connect)) found.push(h);
    }
  };
  await Promise.all(Array.from({ length: 32 }, worker));
  const out: DiscoveredPrinter[] = [];
  for (const address of found.sort((a, b) => Number(a.split('.')[3]) - Number(b.split('.')[3]))) {
    const hi = await ask(address, port, '~HI', opts.connect);
    const model = hi ? plain(hi).split(',')[0]!.trim().slice(0, 60) || null : null;
    const language: LabelLanguage = model ? 'zpl' : 'unknown';
    out.push({ address, port, model, language, added: opts.known?.has(`tcp:${address}:${port}`) ?? false });
  }
  return out;
}
