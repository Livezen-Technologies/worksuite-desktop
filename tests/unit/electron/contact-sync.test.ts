import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: class {}, safeStorage: {} }));

import type { FetchLike } from '../../../electron/services/http';
import { ContactSync, type ContactSyncDeps } from '../../../electron/services/contact-sync';
import { CardDavClient, CardDavError } from '../../../electron/services/contact-sync/carddav';
import { loadNative, localOnly, macStatus } from '../../../electron/services/contact-sync/mac';
import { parseVCard, serializeVCard } from '../../../electron/services/contact-sync/vcard';
import { parseXml, all, textOf, first } from '../../../electron/services/contact-sync/xml';

/**
 * Contact sync on the desktop (worksuite-desktop#175): vCards, a CardDAV client and the relay to WorkSuite, against
 * recorded answers. No Apple, Nextcloud or WorkSuite server is reached; the Mac's Contacts need a native module that is
 * not in this build, and the tests check that nothing pretends otherwise.
 */

const APPLE = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'PRODID:-//Apple Inc.//iOS 17.0//EN',
  'N:Perera;Nimal;;;',
  'FN:Nimal Perera',
  'ORG:Dialog Axiata;Engineering;',
  'TITLE:Lead engineer',
  'item1.EMAIL;type=INTERNET;type=pref:nimal@dialog.lk',
  'item1.X-ABLabel:_$!<Work>!$_',
  'EMAIL;type=INTERNET;type=HOME:nimal@gmail.com',
  'TEL;type=CELL;type=VOICE;type=pref:077 123 4567',
  'TEL;type=WORK;type=VOICE:+94 11 234 5678',
  'item2.ADR;type=HOME:;;12 Flower Rd;Colombo 07;Western;00700;Sri Lanka',
  'item2.X-ABADR:lk',
  'BDAY;X-APPLE-OMIT-YEAR=1604:1604-05-14',
  'NOTE:Met at the expo\\, 2026\\nPrefers WhatsApp',
  'X-SOCIALPROFILE;type=linkedin:http://linkedin.com/in/nimal',
  'CATEGORIES:Suppliers,Key accounts',
  'REV:2026-09-01T10:00:00Z',
  'UID:ABC-123',
  'PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQ',
  ' AAAQABAAD',
  'END:VCARD',
].join('\r\n');

describe('vCards', () => {
  it('read Apple’s cards: labels, a birthday without a year, escaped notes, categories as groups', () => {
    const { card, uid } = parseVCard(APPLE);
    expect(uid).toBe('ABC-123');
    expect([card.first_name, card.last_name, card.display_name]).toEqual(['Nimal', 'Perera', 'Nimal Perera']);
    expect([card.company, card.department, card.job_title]).toEqual(['Dialog Axiata', 'Engineering', 'Lead engineer']);
    expect(card.emails).toEqual([
      { type: 'internet,pref,work', value: 'nimal@dialog.lk' },
      { type: 'internet,home', value: 'nimal@gmail.com' },
    ]);
    expect(card.phones?.map((p) => p.value)).toEqual(['077 123 4567', '+94 11 234 5678']);
    expect(card.addresses?.[0]).toMatchObject({ street: '12 Flower Rd', city: 'Colombo 07', zip: '00700', country: 'Sri Lanka' });
    expect(card.birthday).toBe('--05-14');
    expect(card.notes).toBe('Met at the expo, 2026\nPrefers WhatsApp');
    expect(card.groups).toEqual(['Suppliers', 'Key accounts']);
    expect(card.updated_at).toBe('2026-09-01T10:00:00Z');
  });

  it('write what WorkSuite maps and keep every other line as it came', () => {
    const { card } = parseVCard(APPLE);
    const out = serializeVCard({ ...card, job_title: 'Head of engineering', phones: [{ type: 'mobile', value: '+94771234567' }] }, APPLE, 'ABC-123');
    const again = parseVCard(out);
    expect(again.card.job_title).toBe('Head of engineering');
    expect(again.card.phones).toEqual([{ type: 'cell', value: '+94771234567' }]);
    expect(again.card.birthday).toBe('--05-14');
    expect(again.uid).toBe('ABC-123');
    // Untouched: the photo, the social profile, the categories, Apple's product id — and no stale label lines.
    expect(out).toContain('X-SOCIALPROFILE;type=linkedin:http://linkedin.com/in/nimal');
    expect(out).toContain('CATEGORIES:Suppliers,Key accounts');
    expect(out).toContain('PRODID:-//Apple Inc.//iOS 17.0//EN');
    expect(out.replace(/\r\n /g, '')).toContain('PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQAAAQABAAD');
    expect(out).not.toContain('X-ABLabel');
    expect(out).not.toContain('X-ABADR');
    expect(out.match(/^TEL/gm)).toHaveLength(1);
    for (const line of out.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  });

  it('a new card gets a version, the uid it is given, and a name', () => {
    const out = serializeVCard({ first_name: 'Asha', last_name: 'Fernando', emails: [{ type: 'work', value: 'asha@x.lk' }], birthday: '1990-02-03' }, null, 'worksuite-9-4');
    expect(out.startsWith('BEGIN:VCARD\r\nVERSION:3.0\r\n')).toBe(true);
    expect(out).toContain('UID:worksuite-9-4');
    expect(out).toContain('FN:Asha Fernando');
    expect(out).toContain('N:Fernando;Asha;;;');
    expect(out).toContain('EMAIL;TYPE=INTERNET,WORK:asha@x.lk');
    expect(out).toContain('BDAY;VALUE=DATE:1990-02-03');
  });
});

/* ------------------------------------------------------------------------ */

interface Seen {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}

type Answer = { status: number; body?: string; headers?: Record<string, string> };

/** A CardDAV server from recorded answers. */
function server(routes: Array<[string, RegExp, Answer | ((s: Seen) => Answer)]>) {
  const seen: Seen[] = [];
  const fetch: FetchLike = async (url, init) => {
    const s: Seen = { method: String(init.method), url, headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)), body: init.body as string | undefined };
    seen.push(s);
    for (const [m, re, a] of routes) {
      if (m === s.method && re.test(url + (s.body ?? ''))) {
        const r = typeof a === 'function' ? a(s) : a;
        return new Response(r.body ?? '', { status: r.status, headers: r.headers });
      }
    }
    return new Response('', { status: 404 });
  };
  return { fetch, seen };
}

const ms = (responses: string) => `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav" xmlns:cs="http://calendarserver.org/ns/">${responses}</d:multistatus>`;
const prop = (href: string, props: string) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;

const DISCOVERY: Array<[string, RegExp, Answer]> = [
  ['PROPFIND', /contacts\.icloud\.com\/<\?xml.*current-user-principal/, { status: 207, body: ms(prop('/', '<d:current-user-principal><d:href>/1234/principal/</d:href></d:current-user-principal>')) }],
  ['PROPFIND', /\/1234\/principal\/.*addressbook-home-set/, { status: 207, body: ms(prop('/1234/principal/', '<card:addressbook-home-set><d:href>https://p01-contacts.icloud.com/1234/carddavhome/</d:href></card:addressbook-home-set>')) }],
  [
    'PROPFIND',
    /carddavhome\/<\?xml.*resourcetype/,
    {
      status: 207,
      body: ms(
        prop('/1234/carddavhome/', '<d:resourcetype><d:collection/></d:resourcetype>') +
          prop('/1234/carddavhome/card/', '<d:resourcetype><d:collection/><card:addressbook/></d:resourcetype><d:displayname>card</d:displayname><cs:getctag>C1</cs:getctag><d:sync-token>https://x/sync/T1</d:sync-token>'),
      ),
    },
  ],
];

describe('the CardDAV client', () => {
  it('finds the address books through the principal and its home', async () => {
    const s = server(DISCOVERY);
    const dav = new CardDavClient({ fetch: s.fetch, base: 'https://contacts.icloud.com', username: 'amal@icloud.com', password: 'abcd-efgh-ijkl-mnop' });
    expect(await dav.discover()).toEqual([{ href: '/1234/carddavhome/card/', name: 'card', ctag: 'C1', syncToken: 'https://x/sync/T1' }]);
    expect(s.seen[0]!.headers.Authorization).toBe(`Basic ${Buffer.from('amal@icloud.com:abcd-efgh-ijkl-mnop').toString('base64')}`);
    expect(s.seen[0]!.headers.Depth).toBe('0');
  });

  it('reads changes from a sync token, sees deletions, and says when the token expired', async () => {
    const s = server([
      ['REPORT', /sync-token>OLD</, { status: 403, body: '<d:error xmlns:d="DAV:"><d:valid-sync-token/></d:error>' }],
      [
        'REPORT',
        /sync-collection/,
        {
          status: 207,
          body: ms(prop('/card/a.vcf', '<d:getetag>"e2"</d:getetag>') + '<d:response><d:href>/card/gone.vcf</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response><d:sync-token>T2</d:sync-token>'),
        },
      ],
    ]);
    const dav = new CardDavClient({ fetch: s.fetch, base: 'https://dav.example.com', username: 'u', password: 'p' });
    expect(await dav.changes('/card/', 'T1')).toEqual({ changed: [{ href: '/card/a.vcf', etag: '"e2"' }], deleted: ['/card/gone.vcf'], token: 'T2' });
    await expect(dav.changes('/card/', 'OLD')).rejects.toMatchObject({ kind: 'expired' });
  });

  it('waits out a short Retry-After, and refuses a stale etag as a conflict', async () => {
    let n = 0;
    const waits: number[] = [];
    const s = server([
      ['PUT', /a\.vcf/, () => (++n === 1 ? { status: 429, headers: { 'Retry-After': '2' } } : { status: 412 })],
      ['PUT', /new\.vcf/, { status: 201, headers: { ETag: '"n1"' } }],
    ]);
    const dav = new CardDavClient({ fetch: s.fetch, base: 'https://dav.example.com', username: 'u', password: 'p', sleep: async (ms) => void waits.push(ms) });
    await expect(dav.put('/card/a.vcf', 'BEGIN:VCARD', '"e1"')).rejects.toBeInstanceOf(CardDavError);
    expect(waits).toEqual([2000]);
    expect(s.seen.filter((x) => x.method === 'PUT')[1]!.headers['If-Match']).toBe('"e1"');
    expect(await dav.put('/card/new.vcf', 'BEGIN:VCARD', null)).toBe('"n1"');
    expect(s.seen.at(-1)!.headers['If-None-Match']).toBe('*');
  });

  it('a wrong password says so', async () => {
    const s = server([['PROPFIND', /./, { status: 401 }]]);
    await expect(new CardDavClient({ fetch: s.fetch, base: 'https://contacts.icloud.com', username: 'u', password: 'p' }).discover()).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('the XML reader', () => {
  it('ignores prefixes and decodes entities and CDATA', () => {
    const doc = parseXml('<D:multistatus xmlns:D="DAV:"><D:response><D:href>/a&amp;b.vcf</D:href><C:address-data><![CDATA[BEGIN:VCARD\r\nEND:VCARD]]></C:address-data></D:response></D:multistatus>');
    const r = all(doc, 'response');
    expect(r).toHaveLength(1);
    expect(textOf(first(r[0]!, 'href'))).toBe('/a&b.vcf');
    expect(textOf(first(r[0]!, 'address-data'))).toBe('BEGIN:VCARD\r\nEND:VCARD');
  });
});

/* ------------------------------------------------------------------------ */

function relay(opts: { cursor?: string | null; known?: Array<{ id: string; etag: string | null }>; ops?: unknown[] } = {}) {
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  const store = new Map<string, string>();
  const http = {
    get: vi.fn(async (path: string) => {
      if (path.endsWith('/state')) return { cursor: opts.cursor ?? null, known: opts.known ?? [] };
      return [{ id: 4, provider: 'icloud', mode: 'device', email: 'amal@icloud.com', server_url: 'https://contacts.icloud.com', status: 'active' }];
    }),
    post: vi.fn(async (path: string, body?: unknown) => {
      posts.push({ path, body: body as Record<string, unknown> });
      if (path === '/api/contacts/sync/accounts') return { id: 4, provider: 'icloud', mode: 'device', email: 'amal@icloud.com', server_url: null, status: 'new' };
      if (path.endsWith('/ingest')) {
        const b = body as { preview?: boolean; final?: boolean };
        if (b.preview) return { found: 1, new: 1, matched: 0, duplicates: 0, to_provider: 2 };
        return { counts: { found: 1, new: 1 }, ops: b.final ? (opts.ops ?? []) : [] };
      }
      return { counts: { pushed_new: 1 } };
    }),
  };
  const secrets = {
    get: (k: string) => store.get(k) ?? null,
    set: (k: string, v: string) => void store.set(k, v),
    delete: (k: string) => void store.delete(k),
    deletePrefix: (p: string) => {
      let n = 0;
      for (const k of [...store.keys()]) if (k.startsWith(p) && store.delete(k)) n++;
      return n;
    },
    getStatus: () => ({ available: true, backend: 'keychain', persistent: true }),
  };
  return { http: http as unknown as ContactSyncDeps['http'] & typeof http, posts, store, secrets };
}

const CARD_A = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Kamal Silva\r\nN:Silva;Kamal;;;\r\nTEL;type=CELL:0777000111\r\nUID:A\r\nEND:VCARD\r\n';

function icloud(extra: Array<[string, RegExp, Answer | ((s: Seen) => Answer)]> = []) {
  return server([
    ...extra,
    ...DISCOVERY,
    ['PROPFIND', /card\/<\?xml.*getetag/, { status: 207, body: ms(prop('/1234/carddavhome/card/', '<d:resourcetype><d:collection/></d:resourcetype>') + prop('/1234/carddavhome/card/a.vcf', '<d:getetag>"ea"</d:getetag>')) }],
    ['REPORT', /addressbook-multiget/, { status: 207, body: ms(prop('/1234/carddavhome/card/a.vcf', `<d:getetag>"ea"</d:getetag><card:address-data>${CARD_A}</card:address-data>`)) }],
    ['PUT', /worksuite-77-4\.vcf/, { status: 201, headers: { ETag: '"new"' } }],
  ]);
}

describe('the relay to WorkSuite', () => {
  it('connects: checks the sign-in, makes the account without the password, keeps the password here', async () => {
    const r = relay();
    const s = icloud();
    const sync = new ContactSync({ http: r.http, fetch: s.fetch, secrets: r.secrets, origin: () => 'https://ws.example.com', allowed: () => true });
    expect(await sync.connect({ provider: 'icloud', username: 'amal@icloud.com', password: 'abcd-efgh-ijkl-mnop' })).toEqual({ accountId: 4 });
    expect(JSON.stringify(r.posts[0]!.body)).not.toContain('abcd-efgh');
    expect(r.store.get('contactSync:https://ws.example.com#4')).toContain('abcd-efgh-ijkl-mnop');
  });

  it('a first run reads the whole book, relays it, writes what WorkSuite asks and saves the position', async () => {
    const r = relay({ ops: [{ op: 'create', link_id: null, contact_id: 77, external_id: null, etag: null, card: { first_name: 'Only', last_name: 'Here' }, raw: null }] });
    r.store.set('contactSync:https://ws.example.com#4', JSON.stringify({ username: 'u', password: 'p' }));
    const s = icloud();
    const sync = new ContactSync({ http: r.http, fetch: s.fetch, secrets: r.secrets, origin: () => 'https://ws.example.com', allowed: () => true });

    const out = await sync.run(4);

    const ingest = r.posts.find((p) => p.path.endsWith('/ingest'))!.body as { records: Array<{ id: string; etag: string; card: { first_name: string } }>; final: boolean };
    expect(ingest.final).toBe(true);
    expect(ingest.records).toHaveLength(1);
    expect(ingest.records[0]).toMatchObject({ id: '/1234/carddavhome/card/a.vcf', etag: '"ea"', card: { first_name: 'Kamal' } });
    const put = s.seen.find((x) => x.method === 'PUT')!;
    expect(put.url).toBe('https://p01-contacts.icloud.com/1234/carddavhome/card/worksuite-77-4.vcf');
    expect(put.headers['If-None-Match']).toBe('*');
    const ack = r.posts.find((p) => p.path.endsWith('/ack'))!.body as { results: Array<{ record: { id: string; etag: string } }>; cursor: string; done: boolean };
    expect(ack.done).toBe(true);
    expect(ack.results[0]!.record).toMatchObject({ id: '/1234/carddavhome/card/worksuite-77-4.vcf', etag: '"new"' });
    expect(JSON.parse(ack.cursor)).toEqual({ books: { '/1234/carddavhome/card/': { token: 'https://x/sync/T1', ctag: 'C1' } } });
    expect(out.counts).toMatchObject({ found: 1, new: 1, pushed_new: 1 });
  });

  it('a later run reads only the changes since the token; what WorkSuite has unchanged is not sent again', async () => {
    const r = relay({ cursor: JSON.stringify({ books: { '/1234/carddavhome/card/': { token: 'https://x/sync/T0', ctag: 'C0' } } }), known: [{ id: '/1234/carddavhome/card/a.vcf', etag: '"ea"' }] });
    r.store.set('contactSync:https://ws.example.com#4', JSON.stringify({ username: 'u', password: 'p' }));
    const s = icloud([['REPORT', /sync-collection/, { status: 207, body: ms(prop('/1234/carddavhome/card/a.vcf', '<d:getetag>"ea"</d:getetag>') + '<d:response><d:href>/1234/carddavhome/card/b.vcf</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response><d:sync-token>T9</d:sync-token>') }]]);
    const sync = new ContactSync({ http: r.http, fetch: s.fetch, secrets: r.secrets, origin: () => 'https://ws.example.com', allowed: () => true });

    await sync.run(4);

    const ingest = r.posts.find((p) => p.path.endsWith('/ingest'))!.body as { records: unknown[]; deleted: string[] };
    expect(ingest.records).toEqual([]);
    expect(ingest.deleted).toEqual(['/1234/carddavhome/card/b.vcf']);
    expect(s.seen.some((x) => x.body?.includes('addressbook-multiget'))).toBe(false);
    const ack = r.posts.find((p) => p.path.endsWith('/ack'))!.body as { cursor: string };
    expect(JSON.parse(ack.cursor).books['/1234/carddavhome/card/'].token).toBe('T9');
  });

  it('a full read reports what the book no longer lists as deleted; a preview writes nothing', async () => {
    const r = relay({ known: [{ id: '/1234/carddavhome/card/a.vcf', etag: '"old"' }, { id: '/1234/carddavhome/card/gone.vcf', etag: '"g"' }] });
    r.store.set('contactSync:https://ws.example.com#4', JSON.stringify({ username: 'u', password: 'p' }));
    const s = icloud();
    const sync = new ContactSync({ http: r.http, fetch: s.fetch, secrets: r.secrets, origin: () => 'https://ws.example.com', allowed: () => true });

    const p = await sync.run(4, true);
    expect(p.preview).toEqual({ found: 1, new: 1, matched: 0, duplicates: 0, to_provider: 2 });
    expect(r.posts.some((x) => x.path.endsWith('/ack'))).toBe(false);
    expect(s.seen.some((x) => x.method === 'PUT' || x.method === 'DELETE')).toBe(false);

    await sync.run(4);
    const ingest = r.posts.filter((x) => x.path.endsWith('/ingest')).at(-1)!.body as { deleted: string[]; records: unknown[] };
    expect(ingest.deleted).toEqual(['/1234/carddavhome/card/gone.vcf']);
    expect(ingest.records).toHaveLength(1);
  });

  it('without the password on this computer it asks for it rather than failing quietly', async () => {
    const r = relay();
    const sync = new ContactSync({ http: r.http, fetch: icloud().fetch, secrets: r.secrets, origin: () => 'https://ws.example.com', allowed: () => true });
    await expect(sync.run(4)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });
});

describe('Mac Contacts', () => {
  it('is reported as needing the native module, not as working', async () => {
    expect(await loadNative('darwin', async () => Promise.reject(new Error('Cannot find module')))).toBeNull();
    const s = macStatus(null, 'darwin');
    expect(s).toMatchObject({ platform: true, native: false, permission: 'unavailable' });
    expect(s.reason).toMatch(/native Contacts module/);
    expect(macStatus(null, 'linux').platform).toBe(false);
  });

  it('reads only the Mac’s own containers, never iCloud’s', () => {
    expect(
      localOnly([
        { id: '1', name: 'On My Mac', type: 'local' },
        { id: '2', name: 'iCloud', type: 'cardDAV' },
        { id: '3', name: 'Exchange', type: 'exchange' },
      ]).map((c) => c.id),
    ).toEqual(['1']);
  });

  it('connecting it says why it cannot yet', async () => {
    const r = relay();
    const sync = new ContactSync({ http: r.http, fetch: icloud().fetch, secrets: r.secrets, origin: () => 'https://ws.example.com', allowed: () => true, mac: async () => null });
    await expect(sync.connect({ provider: 'macos' })).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    expect(r.posts).toEqual([]);
  });
});
