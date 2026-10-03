import type { MailBodiesProgress } from '@shared/types';
import { folderOffline, mailBodiesKept, type FolderOffline } from '@shared/mailto';
import { logger } from '../main/log';
import type { HttpClient } from './http';
import type { CacheLimits, OfflineCache } from './offline-cache';

const log = logger('mail-bodies');

/**
 * "Download message bodies" (Settings › Mail › Accounts & offline, #190).
 *
 * Before this, the setting only allowed a message to be kept once it had
 * been opened: nothing was downloaded ahead, so the local store stayed at a
 * few hundred kilobytes and mail read offline was mostly missing.
 *
 * Now, for every mailbox that keeps bodies, each folder whose offline policy
 * is "recent" (Inbox, Sent and Drafts unless changed) is listed back to the
 * mailbox's keep period, and the bodies this computer does not have yet are
 * fetched — unread Inbox mail first, then newest first — through the same
 * API the reader uses, with `peek=1` so nothing is marked read, and saved
 * encrypted in the offline cache under the key an offline open looks for.
 * Inline pictures travel inside the body; attachments stay on the server
 * until opened.
 *
 * Polite by design: one pass at a time, two requests at once at most, a
 * pause between them, at most PER_PASS bodies a pass, and it stops as soon as
 * the server is out of reach or the person signs out.
 */
export interface BodyPrefs {
  mailCacheDays: number;
  mailCacheDaysByMailbox?: Record<string, number>;
  mailFolderOffline?: Record<string, FolderOffline>;
}

export interface MailBodiesDeps {
  http: Pick<HttpClient, 'get' | 'raw' | 'url'>;
  cache: Pick<OfflineCache, 'has' | 'put'>;
  userId: () => string | null;
  prefs: () => BodyPrefs;
  limits: () => CacheLimits;
  /** The server is reachable and somebody is signed in. */
  online: () => boolean;
  now?: () => number;
  /** Pause between downloads, in milliseconds (tests: 0). */
  pauseMs?: number;
}

interface ListedMailbox {
  id: number;
  archived?: boolean | number;
  protocol?: string;
}

interface ListedRow {
  id: number;
  is_read?: boolean;
  created_at?: string;
}

/** A folder's messages read back this far at most, per pass. */
const MAX_PAGES = 40;
const PER_PAGE = 50;

/** Bodies downloaded per pass at most; the next pass carries on. */
export const PER_PASS = 200;

/** A pass every so often while signed in, and soon after a change. */
export const EVERY_MS = 5 * 60_000;

/** The folders' lists are read again this often (between, only what is missing is fetched). */
export const RELIST_MS = 30 * 60_000;

interface Wanted {
  path: string;
  unreadInbox: boolean;
  at: number;
}

/** The folders a mailbox keeps bodies for: its own "recent" choices, else Inbox, Sent and Drafts. */
export function bodyFolders(prefs: BodyPrefs, mailbox: string): string[] {
  const out = new Set<string>();
  for (const f of ['inbox', 'sent', 'drafts']) if (folderOffline(prefs, mailbox, f) === 'recent') out.add(f);
  for (const [key, policy] of Object.entries(prefs.mailFolderOffline ?? {})) {
    const at = key.indexOf(':');
    if (at > 0 && key.slice(0, at) === mailbox && policy === 'recent') out.add(key.slice(at + 1));
  }
  return [...out];
}

/** A server time ("2026-10-03 18:40:00" in UTC, or ISO) in milliseconds; NaN when it is not one. */
export function stampMs(s: string | undefined): number {
  if (!s) return Number.NaN;
  const iso = /^\d{4}-\d\d-\d\d \d\d:\d\d(:\d\d)?$/.test(s) ? `${s.replace(' ', 'T')}Z` : s;
  return Date.parse(iso);
}

/** The path a body is kept under — the one the reader asks for, without `peek`. */
export function bodyPath(mailbox: string, folder: string, id: number): string {
  return `/api/mail/messages/${id}?${new URLSearchParams({ folder, mailbox }).toString()}`;
}

export class MailBodies {
  private readonly state = new Map<string, MailBodiesProgress>();
  private timer: NodeJS.Timeout | null = null;
  private soon: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private stopped = true;
  /** Each mailbox's wanted bodies as last listed, and when, and under which settings. */
  private readonly listed = new Map<string, { at: number; key: string; want: Wanted[] }>();

  constructor(private readonly deps: MailBodiesDeps) {}

  /** Each mailbox's download, for Settings (offline:mailStats). */
  progress(): Record<string, MailBodiesProgress> {
    return Object.fromEntries([...this.state.entries()].map(([k, v]) => [k, { ...v }]));
  }

  start(): void {
    this.stopped = false;
    this.kick(20_000);
    if (!this.timer) {
      this.timer = setInterval(() => void this.pass(), EVERY_MS);
      this.timer.unref?.();
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.soon) clearTimeout(this.soon);
    this.timer = null;
    this.soon = null;
    this.state.clear();
    this.listed.clear();
  }

  /** A pass soon: after the setting changed, the server came back, or a sync brought new mail (`relist`). */
  kick(delayMs = 2_000, relist = false): void {
    if (this.stopped) return;
    if (relist) this.listed.clear();
    if (this.soon) clearTimeout(this.soon);
    this.soon = setTimeout(() => {
      this.soon = null;
      void this.pass();
    }, delayMs);
    this.soon.unref?.();
  }

  /** One pass over every mailbox; a pass already going is joined, not doubled. */
  pass(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.run()
      .catch((e) => log.warn('mail body download stopped', { error: String(e) }))
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  private ok(): boolean {
    return !this.stopped && this.deps.online() && this.deps.userId() !== null && this.deps.limits().enabled;
  }

  private async run(): Promise<void> {
    if (!this.ok()) return;
    const user = this.deps.userId()!;
    const listed = await this.deps.http.get<{ mailboxes?: ListedMailbox[] }>('/api/mail/mailboxes');
    const boxes = (listed?.mailboxes ?? []).filter((b) => !b.archived && (b.protocol ?? 'imap') === 'imap');
    const seen = new Set<string>();
    let budget = PER_PASS;
    for (const b of boxes) {
      const box = String(b.id);
      seen.add(box);
      if (!this.ok()) return;
      budget -= await this.mailbox(user, box, budget);
    }
    for (const k of [...this.state.keys()]) if (!seen.has(k)) this.state.delete(k);
  }

  /** @returns bodies downloaded */
  private async mailbox(user: string, box: string, budget: number): Promise<number> {
    const prefs = this.deps.prefs();
    const days = (prefs.mailCacheDaysByMailbox?.[box] ?? prefs.mailCacheDays) as number;
    const prev = this.state.get(box);
    if (!days) {
      this.state.set(box, { stored: 0, wanted: 0, running: false, doneAt: new Date(this.now()).toISOString(), error: null });
      return 0;
    }
    const p: MailBodiesProgress = { stored: prev?.stored ?? 0, wanted: prev?.wanted ?? 0, running: true, doneAt: prev?.doneAt ?? null, error: null };
    this.state.set(box, p);
    const cutoff = this.now() - days * 86_400_000;
    let fetched = 0;
    try {
      const folders = bodyFolders(prefs, box);
      const key = `${days}|${folders.join(',')}`;
      const last = this.listed.get(box);
      const fresh = !!last && last.key === key && this.now() - last.at < RELIST_MS;
      const want = fresh ? last.want.filter((w) => w.at === 0 || w.at >= cutoff) : await this.list(box, folders, cutoff, prefs);
      if (!fresh) this.listed.set(box, { at: this.now(), key, want });
      const missing = want.filter((w) => !this.deps.cache.has(user, w.path));
      p.wanted = want.length;
      p.stored = want.length - missing.length;

      // Two at a time.
      const queue = missing.slice(0, Math.max(0, budget));
      const worker = async (): Promise<void> => {
        while (queue.length && this.ok()) {
          const next = queue.shift()!;
          if (await this.download(user, next.path)) {
            p.stored++;
            fetched++;
          }
          if (this.deps.pauseMs !== 0) await new Promise((r) => setTimeout(r, this.deps.pauseMs ?? 150));
        }
      };
      await Promise.all([worker(), worker()]);
      p.doneAt = new Date(this.now()).toISOString();
    } catch (e) {
      p.error = e instanceof Error ? e.message : String(e);
    } finally {
      p.running = false;
    }
    return fetched;
  }

  /** What the window holds, folder by folder: unread Inbox mail first, then newest first. */
  private async list(box: string, folders: string[], cutoff: number, prefs: BodyPrefs): Promise<Wanted[]> {
    const want: Wanted[] = [];
    for (const folder of folders) {
      for (let page = 1; page <= MAX_PAGES; page++) {
        if (!this.ok()) return want;
        const r = await this.deps.http.get<{ messages?: ListedRow[]; has_more?: boolean }>('/api/mail/messages', { query: { folder, mailbox: box, page, per_page: PER_PAGE } });
        const rows = r?.messages ?? [];
        let older = false;
        for (const m of rows) {
          const at = stampMs(m.created_at);
          if (Number.isFinite(at) && at < cutoff) {
            older = true;
            continue;
          }
          const path = bodyPath(box, folder, m.id);
          if (mailBodiesKept(prefs, path)) want.push({ path, unreadInbox: folder === 'inbox' && m.is_read === false, at: Number.isFinite(at) ? at : 0 });
        }
        if (older || !r?.has_more || rows.length === 0) break;
      }
    }
    return want.sort((a, b) => Number(b.unreadInbox) - Number(a.unreadInbox) || b.at - a.at);
  }

  /** One body, read with peek=1 and saved under the reader's own key. */
  private async download(user: string, path: string): Promise<boolean> {
    const res = await this.deps.http.raw('GET', this.deps.http.url(`${path}&peek=1`), { timeoutMs: 60_000 });
    const type = res.headers.get('content-type') ?? '';
    if (res.status !== 200 || !type.includes('json')) return false;
    const body = await res.text();
    this.deps.cache.put(user, 'mail', path, { status: 200, contentType: type, body }, this.deps.limits());
    return true;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}
