/**
 * The remote-control message channel (WS-MEET-ENH-01 §B.4, §E.2, §E.4).
 *
 * Control messages go controller → LiveKit → sharer over the data channel,
 * and every participant in a room can publish there, guests included. The
 * media server is an untrusted relay: the grant key decides what is accepted.
 *
 *   aad = grant_id "|" seq "|" type "|" lease_until
 *   ct  = AES-256-GCM(key, iv, JSON payload, aad)                        SEC-08
 *   mac = HMAC-SHA256(key, grant_id ␟ seq ␟ type ␟ lease_until ␟ iv ‖ ct) SEC-05
 *
 * Byte for byte what the server's `RemoteControlChannel` and the web's
 * `channel.ts` produce; all three are tested against the same vector
 * (tests/fixtures/rc-channel.vector.json). Web Crypto only, so the one file
 * runs in the main process (which receives and injects) and in a meeting
 * window (which, as the controller, seals).
 */

export interface Envelope {
  g: string;
  s: number;
  t: string;
  l: number;
  iv: string;
  ct: string;
  m: string;
}

export interface Caps {
  mouse: boolean;
  keyboard: boolean;
  clipboard: 'off' | 'text' | 'text_files';
  file_transfer: boolean;
  monitor_switch: boolean;
}

export interface GrantClaims {
  typ?: string;
  grant_id: string;
  session_id: number;
  meeting_id: string;
  sharer_user_id?: number;
  sharer_device_id?: number;
  sharer_identity: string;
  controller_user_id?: number;
  controller_identity: string;
  caps: Caps;
  iat?: number;
  exp: number;
  lease_s: number;
  lease_renew_s: number;
  nonce?: string;
  key_version: number;
  policy_version?: number;
  input_priority?: string;
  local_priority_hold_ms?: number;
  idle_pause_s?: number;
}

export interface ChannelKeys {
  aes: CryptoKey;
  hmac: CryptoKey;
}

/** The control message types of §F.1. `pointer` and `annot` travel on their own topic, never here. */
export const TYPES = ['ptr.move', 'ptr.button', 'ptr.wheel', 'key', 'special', 'lease', 'clip', 'display', 'state'] as const;
export type ControlType = (typeof TYPES)[number];

/** LiveKit topics. Moves may be lost; everything else must arrive, in order (RC-INP-02). */
export const TOPIC_LOSSY = 'rc.ctl.move';
export const TOPIC_RELIABLE = 'rc.ctl';
export const TOPIC_POINTER = 'rc.pointer';

const SEP = '\x1f';
const enc = new TextEncoder();
const dec = new TextDecoder();

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error('Web Crypto is not available, so remote control cannot run here.');
  return c.subtle;
}

export function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

export function unb64(s: string): Uint8Array<ArrayBuffer> | null {
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The two keys a 32-byte grant key becomes. Neither can be exported. */
export async function importKeys(raw: Uint8Array): Promise<ChannelKeys> {
  if (raw.length !== 32) throw new Error('A grant key is 32 bytes.');
  const s = subtle();
  const bytes = new Uint8Array(raw);
  return {
    aes: await s.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']),
    hmac: await s.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']),
  };
}

function aad(g: string, s: number, t: string, l: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(enc.encode(`${g}|${s}|${t}|${l}`));
}

function macInput(g: string, s: number, t: string, l: number, iv: Uint8Array, ct: Uint8Array): Uint8Array<ArrayBuffer> {
  return concat(enc.encode(`${g}${SEP}${s}${SEP}${t}${SEP}${l}${SEP}`), iv, ct);
}

export async function seal(keys: ChannelKeys, grantId: string, seq: number, type: string, leaseUntil: number, payload: unknown, iv?: Uint8Array): Promise<Envelope> {
  const s = subtle();
  const nonce = new Uint8Array(iv ?? globalThis.crypto.getRandomValues(new Uint8Array(12)));
  const plain = new Uint8Array(enc.encode(JSON.stringify(payload)));
  const ct = new Uint8Array(await s.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad(grantId, seq, type, leaseUntil), tagLength: 128 }, keys.aes, plain));
  const mac = new Uint8Array(await s.sign('HMAC', keys.hmac, macInput(grantId, seq, type, leaseUntil, nonce, ct)));
  return { g: grantId, s: seq, t: type, l: leaseUntil, iv: b64(nonce), ct: b64(ct), m: b64(mac) };
}

/** The payload of an envelope that authenticates under these keys, or null. */
export async function open(keys: ChannelKeys, env: Envelope): Promise<Record<string, unknown> | null> {
  const iv = unb64(env.iv);
  const ct = unb64(env.ct);
  const mac = unb64(env.m);
  if (!env.g || !(env.s >= 0) || !env.t || !iv || iv.length !== 12 || !ct || ct.length < 16 || !mac) return null;
  const s = subtle();
  const ok = await s.verify('HMAC', keys.hmac, mac, macInput(env.g, env.s, env.t, env.l, iv, ct));
  if (!ok) return null;
  try {
    const pt = await s.decrypt({ name: 'AES-GCM', iv, additionalData: aad(env.g, env.s, env.t, env.l), tagLength: 128 }, keys.aes, ct);
    const payload: unknown = JSON.parse(dec.decode(pt));
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** An envelope from the wire, or null when it isn't shaped like one. Nothing about it is trusted yet. */
export function parseEnvelope(text: string): Envelope | null {
  if (text.length > 16_384) return null;
  try {
    const v = JSON.parse(text) as Partial<Envelope>;
    if (!v || typeof v !== 'object') return null;
    if (typeof v.g !== 'string' || typeof v.s !== 'number' || typeof v.t !== 'string' || typeof v.l !== 'number') return null;
    if (typeof v.iv !== 'string' || typeof v.ct !== 'string' || typeof v.m !== 'string') return null;
    return { g: v.g, s: v.s, t: v.t, l: v.l, iv: v.iv, ct: v.ct, m: v.m };
  } catch {
    return null;
  }
}

// ── keys the shared computer never takes from a controller (RC-KBD-05, SEC-15) ──

/** A key combination as `Ctrl+Alt+Shift+Esc`: modifiers in a fixed order, then the key. */
export function chordOf(e: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean; code?: string; key?: string }): string {
  const mods = [e.ctrl && 'Ctrl', e.alt && 'Alt', e.shift && 'Shift', e.meta && 'Meta'].filter(Boolean) as string[];
  const key = (e.code ?? e.key ?? '').replace(/^Key/, '').replace(/^Digit/, '').replace(/^Escape$/, 'Esc');
  return [...mods, key].join('+');
}

/** The emergency stop and the chords that lock or switch the shared session. Never injected. */
export function reservedChords(emergency = 'Ctrl+Alt+Shift+Esc'): Set<string> {
  const mac = emergency.replace('Ctrl', 'Meta');
  return new Set([emergency, mac, 'Meta+Alt+Shift+Esc', 'Meta+L', 'Ctrl+Meta+Q']);
}

/** "Ctrl+Alt+Shift+Esc" → Electron accelerators for it (Command stands in for Ctrl on a Mac as well). */
export function acceleratorsFor(chord: string, platform: string): string[] {
  const parts = chord.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return [];
  const map: Record<string, string> = { Ctrl: 'Control', Alt: 'Alt', Shift: 'Shift', Meta: 'Super', Esc: 'Escape' };
  const one = parts.map((p) => map[p] ?? p).join('+');
  if (platform !== 'darwin') return [one];
  const cmd = parts.map((p) => (p === 'Ctrl' ? 'Command' : p === 'Meta' ? 'Command' : (map[p] ?? p))).join('+');
  return cmd === one ? [one] : [one, cmd];
}

// ── the shared computer's side of §B.4 ────────────────────────────────────

export type Refusal = 'wrong_grant' | 'bad_mac' | 'stale_sequence' | 'wrong_sender' | 'lease' | 'expired' | 'state' | 'capability' | 'out_of_bounds' | 'reserved_chord' | 'input_burst' | 'unknown_type';

export type Verdict = { ok: true; type: ControlType; payload: Record<string, unknown> } | { ok: false; reason: Refusal };

const LIMITS: Record<'pointer' | 'key' | 'click', number> = { pointer: 120, key: 30, click: 10 };

/**
 * Decides, for every message that reaches the shared computer, whether it
 * may be injected.
 *
 * The order is §B.4's: first "is it genuine" (grant, MAC, sequence, lease,
 * sender), then "is it allowed now" (state, capability, bounds, reserved
 * chords, rate). A genuine message that is not allowed is dropped and
 * counted; a burst pauses control and is reported as a security event.
 */
export class ControlReceiver {
  /**
   * The last sequence number seen, per channel: moves travel on the lossy one
   * and may be overtaken, so a click must not be refused because a later
   * move arrived first. A replay is still stale on its own channel.
   */
  private lastSeq = { move: -1, other: -1 };
  private windows: Record<'pointer' | 'key' | 'click', number[]> = { pointer: [], key: [], click: [] };
  private readonly reserved: Set<string>;

  constructor(
    readonly claims: GrantClaims,
    private readonly keys: ChannelKeys,
    private readonly now: () => number = () => Date.now(),
    emergencyChord = 'Ctrl+Alt+Shift+Esc',
  ) {
    this.reserved = reservedChords(emergencyChord);
  }

  async accept(env: Envelope, sender: string, active: boolean): Promise<Verdict> {
    if (env.g !== this.claims.grant_id) return { ok: false, reason: 'wrong_grant' };
    const payload = await open(this.keys, env);
    if (payload === null) return { ok: false, reason: 'bad_mac' };
    // SEC-07: the relay's addressing is not trusted, but the sender must still be the controller.
    if (sender !== this.claims.controller_identity) return { ok: false, reason: 'wrong_sender' };
    const lane = env.t === 'ptr.move' ? 'move' : 'other';
    if (env.s <= this.lastSeq[lane]) return { ok: false, reason: 'stale_sequence' };
    const nowS = Math.floor(this.now() / 1000);
    if (nowS >= this.claims.exp) return { ok: false, reason: 'expired' };
    if (env.l < nowS) return { ok: false, reason: 'lease' };
    // A genuine, newer message moves the sequence on even if it is refused below: replaying it cannot help.
    this.lastSeq[lane] = env.s;

    const type = env.t as ControlType;
    if (!(TYPES as readonly string[]).includes(type)) return { ok: false, reason: 'unknown_type' };
    if (type === 'lease') return { ok: true, type, payload };
    if (!active) return { ok: false, reason: 'state' };

    const caps = this.claims.caps;
    const needs = type.startsWith('ptr.') ? caps.mouse : type === 'key' || type === 'special' ? caps.keyboard : type === 'clip' ? caps.clipboard !== 'off' : type === 'display' ? caps.monitor_switch : false;
    if (!needs) return { ok: false, reason: 'capability' };

    if (type.startsWith('ptr.') && ('x' in payload || 'y' in payload)) {
      const x = Number(payload.x);
      const y = Number(payload.y);
      if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return { ok: false, reason: 'out_of_bounds' };
    }

    if (type === 'key' || type === 'special') {
      const chord = type === 'special' ? String(payload.combo ?? '') : chordOf(payload as never);
      if (this.reserved.has(chord)) return { ok: false, reason: 'reserved_chord' };
    }

    const bucket = type === 'ptr.move' || type === 'ptr.wheel' ? 'pointer' : type === 'ptr.button' ? 'click' : type === 'key' || type === 'special' ? 'key' : null;
    if (bucket) {
      const t = this.now();
      const w = this.windows[bucket].filter((at) => at > t - 1000);
      w.push(t);
      this.windows[bucket] = w;
      if (w.length > LIMITS[bucket]) return { ok: false, reason: 'input_burst' };
    }

    return { ok: true, type, payload };
  }
}

/**
 * The controller's side: sequence numbers, the lease, and sealing. Moves are
 * coalesced by the caller to at most 60 a second (RC-INP-02); this numbers
 * and seals. The lease it stamps is renewed every `lease_renew_s`.
 */
export class ControlSender {
  private seq = 0;
  private leaseUntil: number;

  constructor(
    readonly claims: GrantClaims,
    private readonly keys: ChannelKeys,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.leaseUntil = Math.floor(now() / 1000) + claims.lease_s;
  }

  renew(): void {
    this.leaseUntil = Math.floor(this.now() / 1000) + this.claims.lease_s;
  }

  async next(type: ControlType, payload: unknown): Promise<Uint8Array<ArrayBuffer>> {
    this.seq += 1;
    const env = await seal(this.keys, this.claims.grant_id, this.seq, type, this.leaseUntil, payload);
    return new Uint8Array(enc.encode(JSON.stringify(env)));
  }
}

/** Coordinates on the shared picture: 0–1 from its corner, not the video element's box (SEC-13). */
export function normalise(clientX: number, clientY: number, box: { left: number; top: number; width: number; height: number }, videoW: number, videoH: number): { x: number; y: number } | null {
  if (!videoW || !videoH || !box.width || !box.height) return null;
  // object-fit: contain — the picture is centred in the box with bars either side.
  const scale = Math.min(box.width / videoW, box.height / videoH);
  const w = videoW * scale;
  const h = videoH * scale;
  const left = box.left + (box.width - w) / 2;
  const top = box.top + (box.height - h) / 2;
  const x = (clientX - left) / w;
  const y = (clientY - top) / h;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 };
}
