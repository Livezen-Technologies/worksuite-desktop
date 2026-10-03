import { createHash } from 'node:crypto';
import { attachmentRisk } from '@shared/attachments';
import { attachmentStorePath, mailMediaPrefs, shouldAutoDownload, imageStorePath, storableImageType, type MailMediaPrefs } from '@shared/mail-media';
import { logger } from '../main/log';
import type { HttpClient } from './http';
import type { CacheLimits, OfflineCache } from './offline-cache';

const log = logger('mail-media');

/**
 * Pictures and attachments of mail, kept on this computer (worksuite-desktop#163).
 *
 * Attachments: when the background sync downloads a message's body (#190),
 * the attachments Settings › Mail › Images & media asks for — by size, kind
 * and connection — are downloaded with it and kept encrypted in the local
 * mail store; "Also save to a WorkSuite Files folder" asks the server to file
 * a copy there too. Opening one later is instant and works offline: the
 * download is served from the store (Transfers' `localCopy`).
 *
 * Pictures: a picture the reader allowed is fetched through WorkSuite's
 * image proxy (the sender sees WorkSuite, not this computer) and kept in the
 * store by a hash of its address, so the message shows it at once next time,
 * also offline. Only bitmap types are kept; never SVG.
 */
export interface MailMediaDeps {
  http: Pick<HttpClient, 'post' | 'raw' | 'url'>;
  cache: Pick<OfflineCache, 'has' | 'put' | 'get'>;
  userId: () => string | null;
  prefs: () => { mailMedia?: Partial<MailMediaPrefs>; drive?: { meteredConnection?: boolean } };
  limits: () => CacheLimits;
  online: () => boolean;
}

interface BodyAttachment {
  ref: string;
  name: string;
  mime: string;
  size: number;
}

/** Pictures fetched for one message at most, and each at most this big. */
const MAX_IMAGES = 60;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export function imageHash(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 40);
}

/** The message a body's address names: `/api/mail/messages/12?folder=inbox&mailbox=3`. */
export function messageOfBodyPath(path: string): { uid: string; folder: string; mailbox: string | null } | null {
  const m = /^\/api\/mail\/messages\/(\d{1,20})\?(.*)$/.exec(path);
  if (!m) return null;
  const q = new URLSearchParams(m[2]);
  const folder = q.get('folder');
  return folder ? { uid: m[1]!, folder, mailbox: q.get('mailbox') } : null;
}

export class MailMedia {
  constructor(private readonly deps: MailMediaDeps) {}

  private metered(): boolean {
    return this.deps.prefs().drive?.meteredConnection === true;
  }

  /**
   * A body the background sync just kept: its attachments, downloaded ahead as
   * the settings say. Never a folder's Junk, never a file WorkSuite blocks.
   * @returns attachments kept
   */
  async afterBody(user: string, bodyPath: string, body: string): Promise<number> {
    const msg = messageOfBodyPath(bodyPath);
    if (!msg || /(^|:)(spam|junk)$/i.test(msg.folder)) return 0;
    const prefs = mailMediaPrefs(this.deps.prefs());
    if (prefs.autoDownload === 'off') return 0;
    let atts: BodyAttachment[] = [];
    try {
      const parsed = JSON.parse(body) as { data?: { attachments?: BodyAttachment[] } };
      atts = Array.isArray(parsed.data?.attachments) ? parsed.data!.attachments! : [];
    } catch {
      return 0;
    }
    let kept = 0;
    for (const a of atts.slice(0, 20)) {
      if (!this.deps.online()) break;
      if (!a || typeof a.ref !== 'string' || typeof a.name !== 'string') continue;
      if (!shouldAutoDownload({ name: a.name, mime: String(a.mime ?? ''), size: Number(a.size) || 0 }, prefs, { metered: this.metered() }, attachmentRisk(a.name) === 'blocked')) continue;
      const m = { uid: msg.uid, ref: a.ref, folder: msg.folder, mailbox: msg.mailbox };
      if (this.deps.cache.has(user, attachmentStorePath(m))) continue;
      if (await this.downloadAttachment(user, m, a.mime)) {
        kept++;
        if (prefs.saveTo === 'files') await this.saveToFiles(m, prefs.filesFolder?.id ?? null);
      }
    }
    return kept;
  }

  private async downloadAttachment(user: string, m: { uid: string; ref: string; folder: string; mailbox: string | null }, mime: string): Promise<boolean> {
    const q = new URLSearchParams({ folder: m.folder, dl: '1', ...(m.mailbox ? { mailbox: m.mailbox } : {}) });
    try {
      const res = await this.deps.http.raw('GET', this.deps.http.url(`/api/mail/messages/${m.uid}/attachments/${encodeURIComponent(m.ref)}?${q.toString()}`), { timeoutMs: 120_000 });
      if (res.status !== 200) return false;
      const buf = Buffer.from(await res.arrayBuffer());
      this.keep(user, attachmentStorePath(m), res.headers.get('content-type') || mime || 'application/octet-stream', buf);
      return true;
    } catch (e) {
      log.warn('attachment not downloaded ahead', { error: String(e) });
      return false;
    }
  }

  private async saveToFiles(m: { uid: string; ref: string; folder: string; mailbox: string | null }, folderId: number | null): Promise<void> {
    const q = new URLSearchParams({ folder: m.folder, ...(m.mailbox ? { mailbox: m.mailbox } : {}) });
    await this.deps.http.post(`/api/mail/messages/${m.uid}/attachments/${encodeURIComponent(m.ref)}/save?${q.toString()}`, { ...(m.mailbox ? { mailbox: m.mailbox } : {}), ...(folderId ? { folder_id: folderId } : {}) }).catch((e: unknown) => log.warn('attachment not saved to Files', { error: String(e) }));
  }

  private keep(user: string, path: string, contentType: string, bytes: Buffer): void {
    this.deps.cache.put(user, 'mail', path, { status: 200, contentType, body: bytes.toString('base64') }, this.deps.limits());
  }

  /**
   * The reader's message: which of its attachments are kept here (they open
   * at once, also offline) — with `auto`, after downloading those the
   * settings want that are not kept yet.
   */
  async kept(user: string, m: { uid: string; folder: string; mailbox: string | null; items: BodyAttachment[] }, auto: boolean): Promise<string[]> {
    const prefs = mailMediaPrefs(this.deps.prefs());
    const junk = /(^|:)(spam|junk)$/i.test(m.folder);
    const out: string[] = [];
    for (const a of m.items) {
      const at = { uid: m.uid, ref: a.ref, folder: m.folder, mailbox: m.mailbox };
      let has = this.deps.cache.has(user, attachmentStorePath(at));
      if (!has && auto && !junk && this.deps.online() && shouldAutoDownload(a, prefs, { metered: this.metered() }, attachmentRisk(a.name) === 'blocked')) {
        has = await this.downloadAttachment(user, at, a.mime);
        if (has && prefs.saveTo === 'files') await this.saveToFiles(at, prefs.filesFolder?.id ?? null);
      }
      if (has) out.push(a.ref);
    }
    return out;
  }

  /** A download's bytes from the store, by its own address; null when it was never kept. */
  localAttachment(user: string, storePath: string): { bytes: Buffer; contentType: string } | null {
    const hit = this.deps.cache.get(user, storePath);
    if (!hit || hit.status !== 200) return null;
    return { bytes: Buffer.from(hit.body, 'base64'), contentType: hit.contentType };
  }

  /** Keep a download that just finished, so the next open is instant (the reader opened it). */
  keepDownloaded(user: string, storePath: string, contentType: string, bytes: Buffer): void {
    if (bytes.byteLength > 0 && bytes.byteLength <= mailAttachmentKeepMax()) this.keep(user, storePath, contentType, bytes);
  }

  /**
   * The allowed pictures of a message as data: URLs: those kept here at once;
   * with `fetch`, the rest through WorkSuite's image proxy, then kept.
   * `enabled: false` when the organisation turned the proxy off (nothing is
   * then fetched — pictures are never loaded from the sender directly).
   */
  async images(user: string, urls: string[], mailbox: string | null, fetch: boolean): Promise<{ enabled: boolean; images: Record<string, string> }> {
    const wanted = [...new Set(urls.filter((u) => /^https?:\/\//i.test(u) && u.length <= 2000))].slice(0, MAX_IMAGES);
    const images: Record<string, string> = {};
    const missing: string[] = [];
    for (const u of wanted) {
      const hit = this.deps.cache.get(user, imageStorePath(imageHash(u), mailbox));
      const type = hit ? storableImageType(hit.contentType) : null;
      if (hit && type) images[u] = `data:${type};base64,${hit.body}`;
      else missing.push(u);
    }
    if (!fetch || missing.length === 0 || !this.deps.online()) return { enabled: true, images };
    let links: Record<string, string> = {};
    try {
      const r = await this.deps.http.post<{ enabled: boolean; links: Record<string, string> }>('/api/mail/image-links', { urls: missing });
      if (!r?.enabled) return { enabled: false, images };
      links = r.links ?? {};
    } catch (e) {
      log.warn('image links refused', { error: String(e) });
      return { enabled: true, images };
    }
    const queue = missing.filter((u) => typeof links[u] === 'string' && links[u]!.startsWith('/mail-image?'));
    const worker = async () => {
      while (queue.length) {
        const u = queue.shift()!;
        try {
          const res = await this.deps.http.raw('GET', this.deps.http.url(links[u]!), { auth: false, timeoutMs: 20_000 });
          const type = storableImageType(res.headers.get('content-type') ?? '');
          if (res.status !== 200 || !type) continue;
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.byteLength === 0 || buf.byteLength > IMAGE_MAX_BYTES) continue;
          this.keep(user, imageStorePath(imageHash(u), mailbox), type, buf);
          images[u] = `data:${type};base64,${buf.toString('base64')}`;
        } catch {
          // One picture that does not come is a placeholder; the others still show.
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    return { enabled: true, images };
  }
}

/** A finished download is kept for next time up to this size. */
export function mailAttachmentKeepMax(): number {
  return 25 * 1024 * 1024;
}
