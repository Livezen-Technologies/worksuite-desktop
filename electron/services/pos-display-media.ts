import type { PosDisplayMedia } from '@shared/pos';
import { logger } from '../main/log';
import type { Database } from './db';
import type { PosDesk } from './pos-desk';
import type { Vault } from './vault';

const log = logger('pos-display');

/**
 * POS: the customer display's promotions and the company's logo, kept on this till (worksuite-desktop#294).
 *
 * WorkSuite says what this till shows now — the pictures switched on, inside their window, meant for every till or
 * this one, in order, with how long each stays and how the next comes in (`GET api/pos/device/display`, one version
 * for all of it) — and each picture and the logo are read once through the till's own door
 * (`display/slides/{id}/image`, `display/logo`). Read again every half hour while the display is open, and whenever
 * the catalogue is refreshed; an unchanged version costs one short answer, a changed one fetches only the pictures that
 * changed.
 *
 * Kept sealed (AES-256-GCM, `pos_display_media`) where the desktop policy lets this computer keep data offline, so
 * the display goes on showing them with WorkSuite out of reach; in memory otherwise. Pictures past a size (each, and
 * all together) are not kept. An older server without the door's `display` (404) has none: the display shows the
 * company's name and the app's mark. Forgotten with the till (another pairing, forgetting it, a wipe).
 *
 * Only the customer display's own window is answered (pos-ipc.ts checks the sender's route): it reads pictures, and
 * nothing of the sale, the cashier or a customer comes from here.
 */
export const DISPLAY_MEDIA_MS = 30 * 60_000;
/** One picture at most (the server takes up to 5 MB). */
export const SLIDE_MAX_BYTES = 6 * 1024 * 1024;
/** All the pictures together. */
export const MEDIA_MAX_BYTES = 48 * 1024 * 1024;
const MAX_SLIDES = 20;

export interface PosDisplayMediaDeps {
  db: Pick<Database, 'get' | 'run'>;
  vault: () => Pick<Vault, 'encrypt' | 'decrypt'>;
  desk: Pick<PosDesk, 'pairing' | 'door' | 'bytes'>;
  origin: () => string | null;
  /** Whether the desktop policy lets this computer keep data offline. */
  keep: () => boolean;
  now?: () => number;
}

interface Picture {
  mime: string;
  b64: string;
}

export interface KeptMedia {
  version: string;
  interval: number;
  transition: 'fade' | 'slide';
  company: string | null;
  accent: string | null;
  slides: Array<{ id: number; v: string; title: string | null } & Picture>;
  logo: (Picture & { v: string }) | null;
  fetched_at: string;
}

const MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const str = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : typeof v === 'string' && /^\d{1,12}$/.test(v) && Number(v) > 0 ? Number(v) : null);

/** The door's answer to `GET display`, checked; null when it is not one. */
export function displayAnswerOf(b: Record<string, unknown> | null): {
  version: string;
  interval: number;
  transition: 'fade' | 'slide';
  slides: Array<{ id: number; v: string; title: string | null; bytes: number }>;
  logo: boolean;
  company: string | null;
  accent: string | null;
} | null {
  if (!b || !Array.isArray(b.slides)) return null;
  const version = str(b.version, 64);
  if (!version) return null;
  const n = typeof b.interval === 'number' && Number.isFinite(b.interval) ? Math.round(b.interval) : 8;
  const slides: Array<{ id: number; v: string; title: string | null; bytes: number }> = [];
  for (const x of (b.slides as unknown[]).slice(0, MAX_SLIDES)) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    const id = int(r.id);
    if (!id || (typeof r.mime === 'string' && !MIME.has(r.mime))) continue;
    slides.push({ id, v: str(r.version, 64) ?? version, title: str(r.title, 120), bytes: typeof r.bytes === 'number' ? r.bytes : 0 });
  }
  const accent = str(b.accent, 7);
  return {
    version,
    interval: Math.max(3, Math.min(120, n || 8)),
    transition: b.transition === 'slide' ? 'slide' : 'fade',
    slides,
    logo: b.logo === true,
    company: str(b.company, 150),
    accent: accent && /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : null,
  };
}

/** The picture's type from its first bytes — the door's word is not enough to keep it. */
export function sniffImage(b: Buffer): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** What the display is handed: data URLs, the settings, and whether its screen takes touch. */
export function mediaFor(k: KeptMedia | null, touch: boolean): PosDisplayMedia {
  return {
    slides: (k?.slides ?? []).map((s) => ({ id: s.id, src: `data:${s.mime};base64,${s.b64}`, title: s.title })),
    logo: k?.logo ? `data:${k.logo.mime};base64,${k.logo.b64}` : null,
    company: k?.company ?? null,
    accent: k?.accent ?? null,
    interval: k?.interval ?? 8,
    transition: k?.transition ?? 'fade',
    touch,
    version: k?.version ?? null,
  };
}

export class PosDisplayMediaStore {
  private memory = new Map<string, KeptMedia>();
  private last = new Map<string, number>();
  private running: Promise<KeptMedia | null> | null = null;

  constructor(private readonly d: PosDisplayMediaDeps) {}

  private now(): number {
    return this.d.now?.() ?? Date.now();
  }

  private key(): { origin: string; terminal: number; usable: boolean } | null {
    const origin = this.d.origin();
    const p = this.d.desk.pairing();
    return origin && p ? { origin, terminal: p.terminal.id, usable: p.usable } : null;
  }

  private keep(): boolean {
    try {
      return this.d.keep();
    } catch {
      return false;
    }
  }

  /** What this till holds now, or null. */
  kept(): KeptMedia | null {
    const k = this.key();
    if (!k) return null;
    const mem = this.memory.get(`${k.origin}|${k.terminal}`);
    if (mem) return mem;
    const row = this.d.db.get<{ payload: string }>('SELECT payload FROM pos_display_media WHERE origin = ? AND terminal_id = ?', k.origin, k.terminal);
    return row ? (this.d.vault().decrypt<KeptMedia>(row.payload) ?? null) : null;
  }

  private store(origin: string, terminal: number, m: KeptMedia | null): void {
    const key = `${origin}|${terminal}`;
    if (!m) {
      this.memory.delete(key);
      this.d.db.run('DELETE FROM pos_display_media WHERE origin = ? AND terminal_id = ?', origin, terminal);
      return;
    }
    if (this.keep()) {
      this.memory.delete(key);
      this.d.db.run(
        'INSERT INTO pos_display_media (origin, terminal_id, version, payload, fetched_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(origin, terminal_id) DO UPDATE SET version = excluded.version, payload = excluded.payload, fetched_at = excluded.fetched_at',
        origin,
        terminal,
        m.version,
        this.d.vault().encrypt(m),
        m.fetched_at,
      );
    } else {
      this.d.db.run('DELETE FROM pos_display_media WHERE origin = ? AND terminal_id = ?', origin, terminal);
      this.memory.set(key, m);
    }
  }

  /** Read again when it is half an hour since the last time (or `force`): in the background, never twice at once. */
  maybeRefresh(force = false): void {
    const k = this.key();
    if (!k || !k.usable) return;
    const at = this.last.get(`${k.origin}|${k.terminal}`) ?? 0;
    if (!force && this.now() - at < DISPLAY_MEDIA_MS) return;
    void this.refresh();
  }

  /** Ask the door what this till shows now and fetch what changed. Answers what is kept afterwards. */
  async refresh(): Promise<KeptMedia | null> {
    if (this.running) return this.running;
    this.running = this.run()
      .catch((e: unknown) => {
        log.info('pos display media not refreshed', { error: String((e as Error)?.message ?? e) });
        return this.kept();
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  private async run(): Promise<KeptMedia | null> {
    const k = this.key();
    if (!k || !k.usable) return this.kept();
    this.last.set(`${k.origin}|${k.terminal}`, this.now());
    const a = await this.d.desk.door('GET', 'display');
    // An older server: no promotions, and nothing kept from a server that once had them.
    if (a.status === 404) {
      this.store(k.origin, k.terminal, null);
      return null;
    }
    if (a.status !== 200) return this.kept();
    const want = displayAnswerOf(a.body);
    if (!want) return this.kept();
    const have = this.kept();
    if (have && have.version === want.version) return have;

    const byId = new Map((have?.slides ?? []).map((s) => [`${s.id}|${s.v}`, s] as const));
    const slides: KeptMedia['slides'] = [];
    let total = 0;
    for (const s of want.slides) {
      const old = byId.get(`${s.id}|${s.v}`);
      let pic: Picture | null = old ? { mime: old.mime, b64: old.b64 } : null;
      if (!pic) pic = await this.picture(`display/slides/${s.id}/image`);
      if (!pic) continue;
      const size = Math.ceil((pic.b64.length * 3) / 4);
      if (total + size > MEDIA_MAX_BYTES) {
        log.info('pos display media: the pictures are more than the till keeps; the rest are left out', { kept: slides.length });
        break;
      }
      total += size;
      slides.push({ id: s.id, v: s.v, title: s.title, ...pic });
    }
    let logo: KeptMedia['logo'] = null;
    if (want.logo) {
      // The logo's own version is the answer's: read again only when something changed, kept when it cannot be read.
      const fresh = await this.picture('display/logo');
      logo = fresh ? { ...fresh, v: want.version } : (have?.logo ?? null);
    }
    const m: KeptMedia = {
      version: want.version,
      interval: want.interval,
      transition: want.transition,
      company: want.company,
      accent: want.accent,
      slides,
      logo,
      fetched_at: new Date(this.now()).toISOString(),
    };
    // A picture that could not be read now is tried again on the next refresh: the version is not taken as current.
    if (slides.length < want.slides.length) m.version = `${want.version}~partial`;
    this.store(k.origin, k.terminal, m);
    return m;
  }

  private async picture(path: string): Promise<Picture | null> {
    try {
      const r = await this.d.desk.bytes(path, SLIDE_MAX_BYTES);
      if (r.status !== 200 || !r.bytes) return null;
      const mime = sniffImage(r.bytes);
      return mime ? { mime, b64: r.bytes.toString('base64') } : null;
    } catch (e) {
      log.info('pos display picture not read', { path, error: String((e as Error)?.message ?? e) });
      return null;
    }
  }

  /** What this till kept on this server (another pairing, or forgetting it). */
  forget(origin: string, terminal: number): void {
    this.store(origin, terminal, null);
    this.last.delete(`${origin}|${terminal}`);
  }

  /** Every till's (a wipe). */
  forgetAll(): void {
    this.memory.clear();
    this.last.clear();
    this.d.db.run('DELETE FROM pos_display_media');
  }
}
