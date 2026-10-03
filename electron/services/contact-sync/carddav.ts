import type { FetchLike } from '../http';
import { all, escapeXml, first, parseXml, textOf, type XmlNode } from './xml';

/**
 * A CardDAV client (RFC 6352) for iCloud (contacts.icloud.com, the Apple ID and an app-specific password) and any
 * other CardDAV server (Nextcloud, Zoho, Fastmail, Radicale…), over an injected fetch so tests use recorded answers.
 *
 *   discover    PROPFIND current-user-principal (the address, then /.well-known/carddav) → addressbook-home-set →
 *               the address books under it, with their CTag (getctag) and sync-token
 *   changes     REPORT sync-collection with the saved token (RFC 6578): changed hrefs with etags, and 404s for the
 *               deleted. A token the server no longer knows (403/409 valid-sync-token, or 410) is `ExpiredToken`.
 *   list        PROPFIND Depth 1 getetag — for servers without sync-collection, after the CTag changed
 *   fetch       REPORT addressbook-multiget, 100 hrefs at a time
 *   put         If-Match the etag we hold (412: changed there since), or If-None-Match: * for a new card
 *   delete      If-Match; 404 is already gone
 *
 * 429 and 503 answers are retried after Retry-After (at most three times, at most 30 s each).
 */
export class CardDavError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: 'auth' | 'expired' | 'conflict' | 'not_found' | 'rate_limited' | 'http',
  ) {
    super(message);
  }
}

export interface AddressBook {
  href: string;
  name: string;
  ctag: string | null;
  syncToken: string | null;
}

export interface Changes {
  changed: Array<{ href: string; etag: string | null }>;
  deleted: string[];
  token: string | null;
}

export interface CardData {
  href: string;
  etag: string | null;
  data: string;
}

export interface CardDavOptions {
  fetch: FetchLike;
  base: string;
  username: string;
  password: string;
  sleep?: (ms: number) => Promise<void>;
}

const NS = 'xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav" xmlns:cs="http://calendarserver.org/ns/"';

export class CardDavClient {
  private readonly sleep: (ms: number) => Promise<void>;
  /** Where relative hrefs resolve: the address given, until discovery finds the account's own host (iCloud's pNN-contacts). */
  private root: string;

  constructor(private readonly o: CardDavOptions) {
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.root = o.base;
  }

  private abs(href: string): string {
    return new URL(href, this.root).toString();
  }

  async request(method: string, href: string, body?: string, headers: Record<string, string> = {}): Promise<{ status: number; text: string; headers: Headers }> {
    const auth = Buffer.from(`${this.o.username}:${this.o.password}`, 'utf8').toString('base64');
    for (let attempt = 0; ; attempt++) {
      const res = await this.o.fetch(this.abs(href), {
        method,
        headers: { Authorization: `Basic ${auth}`, ...(body ? { 'Content-Type': headers['Content-Type'] ?? 'application/xml; charset=utf-8' } : {}), ...headers },
        body,
        signal: AbortSignal.timeout(60_000),
      });
      if ((res.status === 429 || res.status === 503) && attempt < 3) {
        const after = Number(res.headers.get('retry-after'));
        const wait = Number.isFinite(after) && after > 0 ? after : 2 ** (attempt + 1);
        if (wait > 30) throw new CardDavError('The server asked to slow down', res.status, 'rate_limited');
        await this.sleep(wait * 1000);
        continue;
      }
      const text = await res.text();
      if (res.status === 401) throw new CardDavError('The server refused the user name or password. For iCloud, use an app-specific password.', 401, 'auth');
      if (res.status === 429 || res.status === 503) throw new CardDavError('The server asked to slow down', res.status, 'rate_limited');
      return { status: res.status, text, headers: res.headers };
    }
  }

  private async propfind(href: string, depth: 0 | 1, props: string): Promise<XmlNode[]> {
    const r = await this.request('PROPFIND', href, `<?xml version="1.0" encoding="utf-8"?><d:propfind ${NS}><d:prop>${props}</d:prop></d:propfind>`, { Depth: String(depth) });
    if (r.status === 404) return [];
    if (r.status !== 207) throw new CardDavError(`PROPFIND answered ${r.status}`, r.status, 'http');
    return all(parseXml(r.text), 'response');
  }

  /** The address books this account can see. */
  async discover(): Promise<AddressBook[]> {
    let principal: string | null = null;
    for (const start of [this.o.base, '/.well-known/carddav']) {
      const res = await this.propfind(start, 0, '<d:current-user-principal/>');
      principal = textOf(first(first(res[0] ?? { name: '', children: [], text: '' }, 'current-user-principal') ?? { name: '', children: [], text: '' }, 'href')) || null;
      if (principal) break;
    }
    if (!principal) throw new CardDavError('This server does not look like a CardDAV server (no principal).', 404, 'http');

    const home = await this.propfind(principal, 0, '<card:addressbook-home-set/>');
    const homeHref = textOf(first(first(home[0] ?? { name: '', children: [], text: '' }, 'addressbook-home-set') ?? { name: '', children: [], text: '' }, 'href'));
    if (!homeHref) throw new CardDavError('No address books were found for this account.', 404, 'http');
    // iCloud answers with the account's own server (https://p01-contacts.icloud.com/…): everything after goes there.
    this.root = new URL(homeHref, this.root).origin + '/';

    const books = await this.propfind(homeHref, 1, '<d:resourcetype/><d:displayname/><cs:getctag/><d:sync-token/>');
    return books
      .filter((r) => {
        const rt = first(r, 'resourcetype');
        return !!rt && !!first(rt, 'addressbook');
      })
      .map((r) => ({
        href: textOf(first(r, 'href')),
        name: textOf(first(r, 'displayname')) || 'Contacts',
        ctag: textOf(first(r, 'getctag')) || null,
        syncToken: textOf(first(r, 'sync-token')) || null,
      }));
  }

  /** What changed since the token (RFC 6578). */
  async changes(book: string, token: string): Promise<Changes> {
    const body = `<?xml version="1.0" encoding="utf-8"?><d:sync-collection ${NS}><d:sync-token>${escapeXml(token)}</d:sync-token><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>`;
    const r = await this.request('REPORT', book, body, { Depth: '1' });
    if (r.status === 403 || r.status === 409 || r.status === 410 || (r.status >= 400 && /valid-sync-token/i.test(r.text))) {
      throw new CardDavError('The saved sync token has expired', r.status, 'expired');
    }
    if (r.status !== 207) throw new CardDavError(`sync-collection answered ${r.status}`, r.status, 'http');
    const doc = parseXml(r.text);
    const out: Changes = { changed: [], deleted: [], token: textOf(all(doc, 'sync-token').pop()) || null };
    for (const resp of all(doc, 'response')) {
      const href = textOf(first(resp, 'href'));
      if (!href || href.replace(/\/$/, '') === new URL(book, this.root).pathname.replace(/\/$/, '')) continue;
      // A deletion is a response whose own status (not a propstat's) is 404.
      const direct = resp.children.find((c) => c.name === 'status');
      if (direct && /\s404\s/.test(` ${textOf(direct)} `)) out.deleted.push(href);
      else out.changed.push({ href, etag: textOf(first(resp, 'getetag')) || null });
    }
    return out;
  }

  /** Every card's href and etag (for servers without sync-collection). */
  async list(book: string): Promise<Array<{ href: string; etag: string | null }>> {
    const bookPath = new URL(book, this.root).pathname.replace(/\/$/, '');
    return (await this.propfind(book, 1, '<d:getetag/><d:resourcetype/>'))
      .map((r) => ({ href: textOf(first(r, 'href')), etag: textOf(first(r, 'getetag')) || null }))
      .filter((x) => x.href && x.href.replace(/\/$/, '') !== bookPath);
  }

  /** The cards themselves, 100 at a time. */
  async fetchCards(book: string, hrefs: string[]): Promise<CardData[]> {
    const out: CardData[] = [];
    for (let i = 0; i < hrefs.length; i += 100) {
      const chunk = hrefs.slice(i, i + 100);
      const body = `<?xml version="1.0" encoding="utf-8"?><card:addressbook-multiget ${NS}><d:prop><d:getetag/><card:address-data/></d:prop>${chunk.map((h) => `<d:href>${escapeXml(h)}</d:href>`).join('')}</card:addressbook-multiget>`;
      const r = await this.request('REPORT', book, body, { Depth: '1' });
      if (r.status !== 207) throw new CardDavError(`addressbook-multiget answered ${r.status}`, r.status, 'http');
      for (const resp of all(parseXml(r.text), 'response')) {
        const data = textOf(first(resp, 'address-data'));
        if (data) out.push({ href: textOf(first(resp, 'href')), etag: textOf(first(resp, 'getetag')) || null, data });
      }
    }
    return out;
  }

  /** Write a card. `etag` null creates it (and refuses to overwrite one that exists). Returns the new etag. */
  async put(href: string, vcard: string, etag: string | null): Promise<string | null> {
    const r = await this.request('PUT', href, vcard, { 'Content-Type': 'text/vcard; charset=utf-8', ...(etag ? { 'If-Match': etag } : { 'If-None-Match': '*' }) });
    if (r.status === 412) throw new CardDavError('The card changed on the server since it was read', 412, 'conflict');
    if (r.status === 404) throw new CardDavError('The card is gone', 404, 'not_found');
    if (r.status < 200 || r.status >= 300) throw new CardDavError(`PUT answered ${r.status}`, r.status, 'http');
    const tag = r.headers.get('etag');
    if (tag) return tag;
    // Some servers (iCloud among them) do not answer with the new etag: ask.
    const res = await this.propfind(href, 0, '<d:getetag/>');
    return textOf(first(res[0] ?? { name: '', children: [], text: '' }, 'getetag')) || null;
  }

  async remove(href: string, etag: string | null): Promise<void> {
    const r = await this.request('DELETE', href, undefined, etag ? { 'If-Match': etag } : {});
    if (r.status === 404 || r.status === 410) return;
    if (r.status === 412) throw new CardDavError('The card changed on the server since it was read', 412, 'conflict');
    if (r.status < 200 || r.status >= 300) throw new CardDavError(`DELETE answered ${r.status}`, r.status, 'http');
  }
}
