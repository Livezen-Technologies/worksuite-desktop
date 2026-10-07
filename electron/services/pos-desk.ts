import { createHash } from 'node:crypto';
import type { PosTerminal, PosTillState } from '@shared/pos';
import { DesktopError } from '../main/errors';
import type { HttpClient } from './http';
import type { SecureStore } from './secure-store';

/**
 * POS: which till this computer is, and the credential that proves it (`Pos\Libraries\DeviceAuth`).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TILL'S CREDENTIAL IS A SECRET, SO IT LIVES WITH THE OTHER SECRETS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Somebody with `pos.access` pairs this computer with a till (`POST api/pos/terminals/{id}/pair`, done here, never
 * through the API proxy, which refuses it). WorkSuite answers once with `wsp_<till>_<64 hex>`, stores only its
 * sha256, and from then on the till's own door (`/api/pos/device/*`: heartbeat, sales, catalogue, a sale's receipt,
 * refund, void) takes that credential instead of anybody's session: a till keeps sending its sales overnight, after a
 * power cut, with nobody signed in. So it is kept in the OS credential store (secure-store.ts), filed under the server that issued it, and
 * sent only by this process, only to the device door. No renderer, IPC answer, log or diagnostic bundle carries it.
 *
 * The till belongs to the computer, not to whoever is signed in: cashiers take turns at it. A plain sign-out keeps
 * it; a remote wipe, or signing out with "remove WorkSuite's data", forgets it. When WorkSuite refuses it (revoked,
 * lapsed after 90 idle days, paired again on another device) it is dropped at once and the screens ask for a pairing.
 *
 * Each pairing gets its own receipt prefix — a hash of this installation, the till and the moment it was paired — so
 * a till paired again, here or on another computer, can never reuse a receipt number the server already holds under
 * the till's channel (which would come back as "already had" for a different sale).
 */
const PREFIX = 'pos-till:';
const TOKEN = /^wsp_[1-9][0-9]{0,9}_[a-f0-9]{64}$/;
/**
 * The door's calls: its own, one of its sales by its (URL-encoded) receipt number, and Phase 2's — held sales, tenders
 * and balances, approvals, customers and loyalty, stock and top sellers, the X report, the receipt template, the
 * device's name and unpairing — and the customer display's (#294): its promotions and logo, and a number looked up.
 */
const DOOR = new RegExp(
  '^(' +
    [
      'heartbeat',
      'sales',
      'catalogue',
      // worksuite-desktop#296: the copy a page at a time, search while it is not there, a product's small picture.
      'catalogue\\/changes',
      'products\\/search',
      'products\\/\\d{1,12}\\/image',
      'products\\/lookup',
      'price',
      'sales\\/[A-Za-z0-9%._:-]{1,120}\\/(receipt|refund|void|email)',
      'tenders',
      'held',
      'held\\/\\d{1,12}\\/(recall|discard)',
      'vouchers\\/[A-Za-z0-9-]{4,40}',
      'store-credit\\/\\d{1,12}',
      'approvers',
      'approvals',
      'approval-requests',
      'approval-requests\\/\\d{1,12}(\\/cancel)?',
      'customers',
      'customers\\/\\d{1,12}',
      'customers\\/by-phone',
      'display',
      'display\\/logo',
      'display\\/slides\\/\\d{1,12}\\/image',
      'loyalty',
      'top-sellers',
      'stock',
      'session\\/report',
      'sessions\\/\\d{1,12}\\/report',
      'receipt-template',
      'name',
      'unpair',
    ].join('|') +
    ')$',
);

/** The platform this computer says it is, in the server's words (`Terminals::PLATFORMS`). */
export function platformOf(p: string): 'windows' | 'macos' | 'linux' | null {
  return p === 'win32' ? 'windows' : p === 'darwin' ? 'macos' : p === 'linux' ? 'linux' : null;
}

type Secrets = Pick<SecureStore, 'get' | 'set' | 'delete' | 'deletePrefix'>;

interface Stored {
  terminal: PosTerminal;
  token: string | null;
  expires_at: string | null;
  paired_at: string;
  prefix: string;
  state: PosTillState;
}

export interface PosPairing {
  terminal: PosTerminal;
  paired_at: string;
  prefix: string;
  state: PosTillState;
  /** Whether the till still holds a credential it can present. */
  usable: boolean;
}

export interface DeviceAnswer {
  status: number;
  body: Record<string, unknown> | null;
}

export interface PosDeskDeps {
  secrets: Secrets;
  http: Pick<HttpClient, 'request' | 'raw' | 'url'>;
  /** The WorkSuite server this computer is signed in to. */
  origin: () => string | null;
  installId: () => string;
  /** How the till's dashboard names this computer. */
  device: () => { name: string; info: string };
  appVersion: string;
  now?: () => number;
}

/** A receipt prefix for one pairing: the till's code and six hex digits no other pairing shares. */
export function tillPrefix(code: string, terminalId: number, installId: string, pairedAt: string): string {
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || `T${terminalId}`;
  const tag = createHash('sha256').update(`${installId}:${terminalId}:${pairedAt}`).digest('hex').slice(0, 6).toUpperCase();
  return `${clean}-${tag}`;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** A till as the server described it, or null when it is not one. */
export function terminalOf(v: unknown): PosTerminal | null {
  if (!v || typeof v !== 'object') return null;
  const t = v as Record<string, unknown>;
  const id = num(t.id);
  const org = num(t.org_id);
  if (!id || !org) return null;
  return {
    id,
    code: str(t.code) ?? `T${id}`,
    name: str(t.name) ?? str(t.code) ?? `Till ${id}`,
    org_id: org,
    org_name: str(t.org_name),
    branch_name: str(t.branch_name),
    warehouse_id: num(t.warehouse_id),
    warehouse_name: str(t.warehouse_name),
  };
}

export class PosDesk {
  constructor(private readonly d: PosDeskDeps) {}

  private slot(): string | null {
    const o = this.d.origin();
    return o ? `${PREFIX}${o}` : null;
  }

  private read(): Stored | null {
    const slot = this.slot();
    const raw = slot ? this.d.secrets.get(slot) : null;
    if (!raw) return null;
    try {
      const v = JSON.parse(raw) as Partial<Stored>;
      const terminal = terminalOf(v.terminal);
      if (!terminal || typeof v.prefix !== 'string' || typeof v.paired_at !== 'string') return null;
      const token = typeof v.token === 'string' && TOKEN.test(v.token) ? v.token : null;
      const state: PosTillState = !token ? 'revoked' : v.state === 'pos_off' ? 'pos_off' : 'paired';
      return { terminal, token, expires_at: typeof v.expires_at === 'string' ? v.expires_at : null, paired_at: v.paired_at, prefix: v.prefix, state };
    } catch {
      return null;
    }
  }

  private write(s: Stored): void {
    const slot = this.slot();
    if (slot) this.d.secrets.set(slot, JSON.stringify(s));
  }

  /** Which till this computer is on this server — never the credential. */
  pairing(): PosPairing | null {
    const s = this.read();
    return s ? { terminal: s.terminal, paired_at: s.paired_at, prefix: s.prefix, state: s.state, usable: !!s.token } : null;
  }

  /**
   * Pair this computer with a till. A till another device holds is taken over only when the person said so
   * (`take_over`); the server answers 409 otherwise, and that goes back as CONFLICT for the screen to ask.
   */
  async pair(terminalId: number, takeOver: boolean, deviceName?: string): Promise<{ pairing: PosPairing; message: string }> {
    const origin = this.d.origin();
    if (!origin) throw new DesktopError('NOT_SIGNED_IN', 'No WorkSuite server is configured.');
    const dev = this.d.device();
    const platform = platformOf(process.platform);
    const data = await this.d.http.request<{ token?: unknown; expires_at?: unknown; terminal?: unknown }>('POST', `/api/pos/terminals/${terminalId}/pair`, {
      // `platform` is Phase 2's (an older server ignores it); the name is the person's, or this computer's.
      body: { device_name: (deviceName?.trim() || dev.name).slice(0, 120), device_info: dev.info.slice(0, 255), app_version: `desktop ${this.d.appVersion}`.slice(0, 32), take_over: takeOver, ...(platform ? { platform } : {}) },
    });
    const token = typeof data?.token === 'string' ? data.token : '';
    const terminal = terminalOf(data?.terminal);
    if (!TOKEN.test(token) || !terminal || !token.startsWith(`wsp_${terminal.id}_`)) {
      throw new DesktopError('SERVER_ERROR', 'WorkSuite paired the till but did not hand over a credential this app can use. Pair it again.');
    }
    const pairedAt = new Date(this.d.now?.() ?? Date.now()).toISOString();
    const stored: Stored = {
      terminal,
      token,
      expires_at: typeof data.expires_at === 'string' ? data.expires_at : null,
      paired_at: pairedAt,
      prefix: tillPrefix(terminal.code, terminal.id, this.d.installId(), pairedAt),
      state: 'paired',
    };
    this.write(stored);
    return { pairing: this.pairing()!, message: `This computer is now ${terminal.name}.` };
  }

  /** Forget this computer's till on this server. */
  forget(): void {
    const slot = this.slot();
    if (slot) this.d.secrets.delete(slot);
  }

  /** Forget every till this computer holds, on every server (a wipe). */
  forgetAll(): number {
    return this.d.secrets.deletePrefix(PREFIX);
  }

  /**
   * A call through the till's own door, with its credential. The answer is the server's, status and body: the
   * device door speaks in real codes (401 pair again, 503 POS is off, 5xx try later, 4xx show somebody).
   */
  async device(path: 'heartbeat' | 'sales', body: unknown): Promise<DeviceAnswer> {
    return this.door('POST', path, { body });
  }

  /**
   * Any of the door's calls (`Pos\Controllers\DeviceController`): the heartbeat and the sales, what the till sells
   * (`catalogue`, `products/lookup`, `price`) so it refreshes with nobody signed in, and one of its own sales by its
   * receipt number (`sales/{ref}/receipt|refund|void|email`), and Phase 2's counter (held sales, approvals, customers,
   * the X report, the template, the device's name, unpairing). Nothing else is sent the credential.
   */
  async door(method: 'GET' | 'POST', path: string, o: { body?: unknown; query?: Record<string, string | number | undefined> } = {}): Promise<DeviceAnswer> {
    if (!DOOR.test(path)) throw new DesktopError('INTERNAL', 'Not a call of the till’s door.');
    const s = this.read();
    if (!s?.token) throw new DesktopError('NOT_FOUND', 'This computer is not a paired till. Pair it in POS.');
    const res = await this.d.http.raw(method, this.d.http.url(`/api/pos/device/${path}`, o.query), {
      auth: false,
      headers: { Authorization: `Bearer ${s.token}`, Accept: 'application/json', ...(o.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
      // A sale is sent while the cashier waits; a lost answer is harmless (the ref makes a resend the same sale).
      timeoutMs: path === 'sales' ? 12_000 : 20_000,
    });
    let json: Record<string, unknown> | null = null;
    if ((res.headers.get('content-type') ?? '').includes('json')) json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const now = this.read();
    if (now && now.token === s.token) {
      if (res.status === 401) {
        // Refused: revoked, lapsed, or paired again elsewhere. The credential is dead; keep which till it was.
        this.write({ ...now, token: null, state: 'revoked' });
      } else if (res.status === 503) {
        if (now.state !== 'pos_off') this.write({ ...now, state: 'pos_off' });
      } else if (res.ok && now.state !== 'paired') {
        this.write({ ...now, state: 'paired' });
      }
    }
    return { status: res.status, body: json };
  }

  /**
   * A picture through the door (the customer display's promotions and logo, #294): its bytes and type, at most `max`
   * bytes — a bigger one, or one that is not an image, is refused here rather than kept.
   */
  async bytes(path: string, max: number): Promise<{ status: number; type: string | null; bytes: Buffer | null }> {
    if (!DOOR.test(path) || !path.startsWith('display/')) throw new DesktopError('INTERNAL', 'Not a picture of the till’s door.');
    const s = this.read();
    if (!s?.token) throw new DesktopError('NOT_FOUND', 'This computer is not a paired till. Pair it in POS.');
    const res = await this.d.http.raw('GET', this.d.http.url(`/api/pos/device/${path}`), {
      auth: false,
      headers: { Authorization: `Bearer ${s.token}`, Accept: 'image/jpeg, image/png, image/webp' },
      timeoutMs: 30_000,
    });
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase() || null;
    if (!res.ok || !type || !/^image\/(jpeg|png|webp)$/.test(type)) return { status: res.status, type, bytes: null };
    const length = Number(res.headers.get('content-length') ?? 0);
    if (length > max) return { status: 413, type, bytes: null };
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length > max ? { status: 413, type, bytes: null } : { status: res.status, type, bytes };
  }

  /**
   * A product's picture through the door (`products/{id}/image?size=thumb`), as bytes: the answer's status, its type and, when
   * it is an image no bigger than `max`, its bytes (worksuite-desktop#296).
   */
  async thumbBytes(path: string, query: Record<string, string | number | undefined>, max = 2 * 1024 * 1024): Promise<{ status: number; type: string | null; bytes: Buffer | null }> {
    if (!DOOR.test(path) || !/^products\/\d{1,12}\/image$/.test(path)) throw new DesktopError('INTERNAL', 'Not a call of the till’s door.');
    const s = this.read();
    if (!s?.token) throw new DesktopError('NOT_FOUND', 'This computer is not a paired till. Pair it in POS.');
    const res = await this.d.http.raw('GET', this.d.http.url(`/api/pos/device/${path}`, query), { auth: false, headers: { Authorization: `Bearer ${s.token}`, Accept: 'image/*' }, timeoutMs: 20_000 });
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase() || null;
    if (!res.ok || !type?.startsWith('image/')) return { status: res.status, type, bytes: null };
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, type, bytes: buf.length > 0 && buf.length <= max ? buf : null };
  }

  /**
   * Tell WorkSuite the till is alive and how much waits; learn its current name, branch and warehouse. `extra`: the
   * catalogue copy it holds (worksuite-desktop#296), for the Tills screen.
   */
  async heartbeat(pending: number, extra?: { catalogue_version?: string; catalogue_synced_at?: string }): Promise<DeviceAnswer> {
    const a = await this.device('heartbeat', { app_version: `desktop ${this.d.appVersion}`.slice(0, 32), pending_count: pending, ...(extra ?? {}) });
    const terminal = a.status === 200 ? terminalOf(a.body?.terminal) : null;
    const s = this.read();
    if (terminal && s && terminal.id === s.terminal.id) this.write({ ...s, terminal });
    return a;
  }
}
