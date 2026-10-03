import { ICLOUD_CARDDAV, PROVIDER_LABEL, type ConnectInput, type ContactSyncStatus, type DeviceAccountState, type MacContactsStatus, type OutboundOp, type SyncCounts, type SyncPreview, type SyncRecord } from '@shared/contact-sync';
import { DesktopError } from '../../main/errors';
import { logger } from '../../main/log';
import type { IpcRouter } from '../../ipc/router';
import type { FetchLike } from '../http';
import type { SecureStore } from '../secure-store';
import { CardDavClient, CardDavError, type AddressBook } from './carddav';
import { loadNative, macStatus, type MacContactsNative } from './mac';
import { parseVCard, serializeVCard } from './vcard';

const log = logger('contact-sync');

/**
 * iCloud, CardDAV and Mac Contacts accounts, synced from this computer (worksuite-desktop#175).
 *
 * The password (Apple's app-specific password, or the CardDAV server's) is kept only in the OS keystore
 * (`contactSync:<server>#<account>`) — the Keychain on a Mac — and used only here. WorkSuite holds the account (no
 * secret), the links and the rules. A run:
 *
 *   1. asks WorkSuite where this account got to (`state`: the saved position per address book, and the records it
 *      already has with their etags);
 *   2. reads each address book's changes — sync-collection from the saved token, or, when the server has no tokens,
 *      the etags once the CTag changed, compared with what WorkSuite has (a record WorkSuite has and the book no
 *      longer lists was deleted there);
 *   3. sends them to `ingest` in batches; the last batch answers with what WorkSuite changed;
 *   4. writes those to the server (a new card under a name derived from the contact, so a run that is interrupted
 *      and repeated never creates it twice), and confirms each with the new position (`ack`).
 *
 * Runs every 15 minutes while the app is open and signed in, and on Sync now.
 */
export interface ContactSyncDeps {
  http: { get<T>(path: string, opts?: { query?: Record<string, string | number | boolean | null | undefined> }): Promise<T>; post<T>(path: string, body?: unknown): Promise<T> };
  fetch: FetchLike;
  secrets: Pick<SecureStore, 'get' | 'set' | 'delete' | 'deletePrefix' | 'getStatus'>;
  origin: () => string | null;
  /** Signed in, and allowed to open Contacts. */
  allowed: () => boolean;
  deviceId?: () => string;
  mac?: () => Promise<MacContactsNative | null>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

interface ServerAccount {
  id: number;
  provider: string;
  mode: 'server' | 'device';
  email: string | null;
  server_url: string | null;
  status: string;
}

interface Saved {
  books?: Record<string, { token?: string | null; ctag?: string | null }>;
}

const BATCH = 500;
const TICK_MS = 15 * 60_000;

export class ContactSync {
  private running = new Set<number>();
  private last = new Map<number, { at: string; error: string | null }>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly d: ContactSyncDeps) {}

  private origin(): string {
    const o = this.d.origin();
    if (!o) throw new DesktopError('NOT_SIGNED_IN', 'Sign in to WorkSuite first.');
    return o;
  }

  private guard(): void {
    if (!this.d.allowed()) throw new DesktopError('APP_ACCESS_DENIED', "You don't have access to Contacts.");
  }

  private secretName(accountId: number): string {
    return `contactSync:${this.origin()}#${accountId}`;
  }

  private creds(accountId: number): { username: string; password: string } | null {
    const v = this.d.secrets.get(this.secretName(accountId));
    if (!v) return null;
    try {
      const o = JSON.parse(v) as { username?: string; password?: string };
      return o.username && o.password ? { username: o.username, password: o.password } : null;
    } catch {
      return null;
    }
  }

  private client(base: string, c: { username: string; password: string }): CardDavClient {
    return new CardDavClient({ fetch: this.d.fetch, base, username: c.username, password: c.password, sleep: this.d.sleep });
  }

  private async mac(): Promise<MacContactsStatus> {
    return macStatus(this.d.mac ? await this.d.mac() : await loadNative());
  }

  async status(): Promise<ContactSyncStatus> {
    this.guard();
    let accounts: DeviceAccountState[] = [];
    try {
      const list = await this.d.http.get<ServerAccount[]>('/api/contacts/sync/accounts');
      accounts = list
        .filter((a) => a.mode === 'device')
        .map((a) => ({ accountId: a.id, hasSecret: a.provider === 'macos' || this.creds(a.id) !== null, running: this.running.has(a.id), lastRun: this.last.get(a.id)?.at ?? null, lastError: this.last.get(a.id)?.error ?? null }));
    } catch (e) {
      log.warn('accounts unavailable', String(e));
    }
    return { persistent: this.d.secrets.getStatus().persistent, accounts, mac: await this.mac() };
  }

  /** Check the sign-in against the server, then create the account in WorkSuite and keep the password here. */
  async connect(input: ConnectInput): Promise<{ accountId: number }> {
    this.guard();
    let base: string | null = null;
    let username = input.username ?? '';
    if (input.provider === 'macos') {
      const s = await this.mac();
      if (!s.native) throw new DesktopError('UNSUPPORTED', s.reason ?? 'Mac Contacts cannot be read here.');
      throw new DesktopError('UNSUPPORTED', 'Mac Contacts sync needs the native Contacts module to be finished before it can be turned on.');
    }
    if (!input.password || !username) throw new DesktopError('INVALID_CREDENTIALS', 'Enter the user name and password.');
    base = input.provider === 'icloud' ? ICLOUD_CARDDAV : (input.serverUrl ?? '');
    if (!/^https:\/\//i.test(base)) throw new DesktopError('IPC_VALIDATION_FAILED', 'The CardDAV address must start with https://');

    const books = await this.carddav(() => this.client(base, { username, password: input.password! }).discover());
    if (!books.length) throw new DesktopError('NOT_FOUND', 'No address books were found for this account.');

    username = username.trim();
    const account = await this.d.http.post<ServerAccount>('/api/contacts/sync/accounts', {
      provider: input.provider,
      email: username,
      server_url: input.provider === 'carddav' ? base : null,
      org_id: input.orgId ?? null,
      device_id: this.d.deviceId?.() ?? null,
      settings: input.settings,
    });
    this.d.secrets.set(this.secretName(account.id), JSON.stringify({ username, password: input.password }));
    return { accountId: account.id };
  }

  setPassword(accountId: number, password: string): void {
    this.guard();
    const c = this.creds(accountId);
    if (!c) throw new DesktopError('NOT_FOUND', 'This account was not connected on this computer.');
    this.d.secrets.set(this.secretName(accountId), JSON.stringify({ username: c.username, password }));
  }

  forget(accountId: number): void {
    this.d.secrets.delete(this.secretName(accountId));
    this.last.delete(accountId);
  }

  /** Every secret for every server: the computer is being cleared. */
  wipe(): void {
    this.d.secrets.deletePrefix('contactSync:');
    this.last.clear();
  }

  private async account(accountId: number): Promise<ServerAccount> {
    const a = (await this.d.http.get<ServerAccount[]>('/api/contacts/sync/accounts')).find((x) => x.id === accountId);
    if (!a) throw new DesktopError('NOT_FOUND', 'Account not found.');
    if (a.mode !== 'device') throw new DesktopError('UNSUPPORTED', 'This account is synced by WorkSuite itself.');
    return a;
  }

  private async carddav<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof CardDavError) {
        if (e.kind === 'auth') throw new DesktopError('INVALID_CREDENTIALS', e.message);
        if (e.kind === 'rate_limited') throw new DesktopError('RATE_LIMITED', e.message);
        throw new DesktopError('SERVER_ERROR', e.message);
      }
      throw e;
    }
  }

  /** One run (or, with `preview`, the counts of a first run, writing nothing). */
  async run(accountId: number, preview = false): Promise<{ preview: SyncPreview | null; counts: SyncCounts | null }> {
    this.guard();
    if (this.running.has(accountId)) throw new DesktopError('CONFLICT', 'This account is already syncing.');
    const account = await this.account(accountId);
    if (account.provider === 'macos') {
      const s = await this.mac();
      throw new DesktopError('UNSUPPORTED', s.reason ?? 'Mac Contacts sync needs the native Contacts module.');
    }
    const creds = this.creds(accountId);
    if (!creds) throw new DesktopError('INVALID_CREDENTIALS', `Enter the ${PROVIDER_LABEL[account.provider as 'icloud']} password again on this computer.`);

    this.running.add(accountId);
    const base = account.provider === 'icloud' ? ICLOUD_CARDDAV : (account.server_url ?? '');
    const api = `/api/contacts/sync/accounts/${accountId}`;
    try {
      const out = await this.carddav(() => this.syncOnce(api, this.client(base, creds), preview));
      this.last.set(accountId, { at: (this.d.now?.() ?? new Date()).toISOString(), error: null });
      return out;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.last.set(accountId, { at: (this.d.now?.() ?? new Date()).toISOString(), error: message });
      if (!preview) await this.d.http.post(`${api}/ack`, { results: [], error: message }).catch(() => undefined);
      throw e;
    } finally {
      this.running.delete(accountId);
    }
  }

  private async syncOnce(api: string, dav: CardDavClient, preview: boolean): Promise<{ preview: SyncPreview | null; counts: SyncCounts | null }> {
    const state = await this.d.http.get<{ cursor: string | null; known: Array<{ id: string; etag: string | null }> }>(`${api}/state`);
    const saved: Saved = preview ? {} : safeJson<Saved>(state.cursor) ?? {};
    const known = new Map(state.known.map((k) => [k.id, k.etag]));
    const books = await dav.discover();
    const next: Saved = { books: {} };
    const records: SyncRecord[] = [];
    const deleted: string[] = [];

    for (const book of books) {
      const was = saved.books?.[book.href];
      let hrefs: string[] = [];
      let read = false;

      if (was?.token && book.syncToken) {
        try {
          const ch = await dav.changes(book.href, was.token);
          hrefs = ch.changed.filter((c) => !c.etag || known.get(c.href) !== c.etag).map((c) => c.href);
          deleted.push(...ch.deleted);
          next.books![book.href] = { token: ch.token ?? book.syncToken, ctag: book.ctag };
          read = true;
        } catch (e) {
          if (!(e instanceof CardDavError && e.kind === 'expired')) throw e;
          log.info('sync token expired; reading the book again', { book: book.href });
        }
      } else if (was?.ctag && book.ctag && was.ctag === book.ctag) {
        next.books![book.href] = was;
        read = true;
      }

      if (!read) {
        const listed = await dav.list(book.href);
        const here = new Set(listed.map((l) => l.href));
        hrefs = listed.filter((l) => !l.etag || known.get(l.href) !== l.etag).map((l) => l.href);
        // What WorkSuite has from this book that the book no longer lists was deleted there.
        const path = pathOf(book.href);
        for (const id of known.keys()) if (pathOf(id).startsWith(path) && !here.has(id)) deleted.push(id);
        next.books![book.href] = { token: book.syncToken, ctag: book.ctag };
      }

      for (const c of await dav.fetchCards(book.href, hrefs)) {
        const { card } = parseVCard(c.data);
        records.push({ id: c.href, etag: c.etag, card, raw: c.data, updated_at: card.updated_at ?? null });
      }
    }

    if (preview) {
      const total: SyncPreview = { found: 0, new: 0, matched: 0, duplicates: 0, to_provider: 0 };
      for (let i = 0; i < Math.max(1, records.length); i += BATCH) {
        const p = await this.d.http.post<SyncPreview>(`${api}/ingest`, { records: records.slice(i, i + BATCH), preview: true });
        total.found += p.found;
        total.new += p.new;
        total.matched += p.matched;
        total.duplicates += p.duplicates;
        total.to_provider = Math.max(total.to_provider, p.to_provider);
      }
      return { preview: total, counts: null };
    }

    let ops: OutboundOp[] = [];
    let counts: SyncCounts | null = null;
    const batches = Math.max(1, Math.ceil(records.length / BATCH));
    for (let b = 0; b < batches; b++) {
      const last = b === batches - 1;
      const r = await this.d.http.post<{ counts: SyncCounts; ops: OutboundOp[] }>(`${api}/ingest`, { records: records.slice(b * BATCH, (b + 1) * BATCH), deleted: b === 0 ? deleted : [], final: last });
      counts = addCounts(counts, r.counts);
      if (last) ops = r.ops;
    }

    const results = await this.push(dav, books, ops, api);
    const ack = await this.d.http.post<{ counts: SyncCounts }>(`${api}/ack`, { results, cursor: JSON.stringify(next), done: true });
    return { preview: null, counts: addCounts(counts, ack.counts) };
  }

  private async push(dav: CardDavClient, books: AddressBook[], ops: OutboundOp[], api: string): Promise<Array<Record<string, unknown>>> {
    const results: Array<Record<string, unknown>> = [];
    const target = books.find((b) => /^(contacts|card)$/i.test(b.name)) ?? books[0];
    const fresh: SyncRecord[] = [];

    for (const op of ops) {
      const base = { op: op.op, link_id: op.link_id, contact_id: op.contact_id };
      try {
        if (op.op === 'create') {
          if (!target || !op.card || !op.contact_id) continue;
          const uid = `worksuite-${op.contact_id}-${api.split('/').pop()}`;
          const href = `${target.href.replace(/\/?$/, '/')}${uid}.vcf`;
          const vcard = serializeVCard(op.card, null, uid);
          let etag: string | null;
          try {
            etag = await dav.put(href, vcard, null);
          } catch (e) {
            // Created by an earlier run that did not get to confirm it.
            if (!(e instanceof CardDavError && e.kind === 'conflict')) throw e;
            etag = (await dav.fetchCards(target.href, [href]))[0]?.etag ?? null;
          }
          results.push({ ...base, record: { id: href, etag, raw: vcard } });
        } else if (op.op === 'update') {
          if (!op.external_id || !op.card) continue;
          const uid = (op.raw && parseVCard(op.raw).uid) || `worksuite-${op.contact_id}`;
          const vcard = serializeVCard(op.card, op.raw, uid);
          const etag = await dav.put(op.external_id, vcard, op.etag);
          results.push({ ...base, record: { id: op.external_id, etag, raw: vcard } });
        } else if (op.external_id) {
          await dav.remove(op.external_id, op.etag);
          results.push(base);
        }
      } catch (e) {
        if (e instanceof CardDavError && e.kind === 'conflict' && op.external_id) {
          // Changed on the server since it was read: take that change in now; ours goes again next run.
          const book = books.find((b) => op.external_id!.startsWith(pathOf(b.href))) ?? target;
          if (book) {
            for (const c of await dav.fetchCards(book.href, [op.external_id])) {
              const { card } = parseVCard(c.data);
              fresh.push({ id: c.href, etag: c.etag, card, raw: c.data, updated_at: card.updated_at ?? null });
            }
          }
        }
        if (e instanceof CardDavError && e.kind === 'not_found' && op.external_id) {
          await this.d.http.post(`${api}/ingest`, { records: [], deleted: [op.external_id] });
          continue;
        }
        if (e instanceof CardDavError && (e.kind === 'auth' || e.kind === 'rate_limited')) throw e;
        results.push({ ...base, error: e instanceof Error ? e.message : String(e) });
      }
    }

    if (fresh.length) await this.d.http.post(`${api}/ingest`, { records: fresh });
    return results;
  }

  /** Every 15 minutes while signed in: each account connected on this computer that has finished its first sync. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (!this.d.allowed() || !this.d.origin()) return;
    let list: ServerAccount[] = [];
    try {
      list = await this.d.http.get<ServerAccount[]>('/api/contacts/sync/accounts');
    } catch {
      return;
    }
    for (const a of list) {
      if (a.mode !== 'device' || a.provider === 'macos' || a.status === 'new' || this.running.has(a.id) || !this.creds(a.id)) continue;
      try {
        await this.run(a.id);
      } catch (e) {
        log.warn('contact sync failed', { account: a.id, error: String(e) });
      }
    }
  }

  register(router: IpcRouter): void {
    router.handle('contactSync:status', () => this.status());
    router.handle('contactSync:connect', (input) => this.connect(input));
    router.handle('contactSync:run', (input) => this.run(input.accountId, input.preview ?? false));
    router.handle('contactSync:setPassword', (input) => this.setPassword(input.accountId, input.password));
    router.handle('contactSync:forget', (input) => this.forget(input.accountId));
    router.handle('contactSync:macAccess', async () => {
      this.guard();
      const native = this.d.mac ? await this.d.mac() : await loadNative();
      if (native && native.authorizationStatus() === 'not-determined') await native.requestAccess();
      return macStatus(native);
    });
  }
}

function safeJson<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/** The path of an href, with a trailing slash for a collection. */
function pathOf(href: string): string {
  try {
    return new URL(href, 'https://x.invalid').pathname;
  } catch {
    return href;
  }
}

function addCounts(a: SyncCounts | null, b: SyncCounts | null | undefined): SyncCounts | null {
  if (!b) return a;
  if (!a) return { ...b };
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + (typeof v === 'number' ? v : 0);
  return out;
}
