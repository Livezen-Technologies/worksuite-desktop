import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.1.0' }, safeStorage: {} }));

import type { SalonOutboxItem } from '@shared/types';
import { Database } from '../../../electron/services/db';
import { Vault } from '../../../electron/services/vault';
import { DesktopError } from '../../../electron/main/errors';
import { adoptClient, apply, batch, choicesFor, dropWithDependents, held, needsOf, substitute } from '../../../electron/services/salon-outbox';
import { SalonSync, dayIn, nationalDigits, prune, searchClients, type SalonSyncDeps } from '../../../electron/services/salon-sync';

const C1 = 'C-11111111-1111-4111-8111-111111111111';
const V1 = 'V-22222222-2222-4222-8222-222222222222';
const C2 = 'C-33333333-3333-4333-8333-333333333333';

let seq = 0;
function item(over: Partial<SalonOutboxItem> = {}): SalonOutboxItem {
  seq++;
  const payload = over.payload ?? {};
  return {
    id: `id-${seq}`,
    seq,
    key: `desk5-${seq}`,
    kind: 'visit.book',
    local_id: null,
    payload,
    needs: needsOf(payload),
    label: `item ${seq}`,
    detail: null,
    created_at: '2026-09-28T04:00:00Z',
    updated_at: '2026-09-28T04:00:00Z',
    state: 'waiting',
    attempts: 0,
    message: null,
    next: null,
    choices: [],
    ...over,
  };
}

/* A walk-in made while WorkSuite was out of reach: a new client, their visit starting now, and the check-in. */
function walkIn(): SalonOutboxItem[] {
  return [
    item({ kind: 'client.create', local_id: C1, payload: { name: 'Amaya Senanayake', mobile: '0771234567' } }),
    item({ kind: 'visit.book', local_id: V1, payload: { client_id: `local:${C1}`, starts_at: 'now', items: [{ service_id: 3, provider_id: 9 }] } }),
    item({ kind: 'visit.check_in', payload: { visit_id: `local:${V1}`, ack: true, statement: 'read out' } }),
  ];
}

describe('salon outbox: what is sent, and in which order', () => {
  it('finds the local ids a payload names, however deep, and puts the real ids in their place', () => {
    const p = { client_id: `local:${C1}`, items: [{ service_id: 3, for: `local:${C2}` }], note: 'local is a word' };
    expect(needsOf(p).sort()).toEqual([C1, C2].sort());
    expect(substitute(p, C1, 71)).toEqual({ client_id: 71, items: [{ service_id: 3, for: `local:${C2}` }], note: 'local is a word' });
  });

  it('sends waiting items in the order they were made, one batch at a time', () => {
    const many = Array.from({ length: 60 }, () => item());
    const sent = batch([...many].reverse());
    expect(sent).toHaveLength(50);
    expect(sent.map((i) => i.seq)).toEqual(many.slice(0, 50).map((i) => i.seq));
  });

  it('holds back everything behind a refusal, through a chain', () => {
    const [client, visit, checkIn] = walkIn();
    const other = item();
    const items = [{ ...client!, state: 'refused' as const }, visit!, checkIn!, other];
    expect([...held(items)].sort()).toEqual([visit!.id, checkIn!.id].sort());
    expect(batch(items).map((i) => i.id)).toEqual([other.id]);
  });

  it('lets accepted and already-done items go, and names the real ids in what follows', () => {
    const items = walkIn();
    const done = apply(items, items.slice(0, 2), [
      { key: items[0]!.key, status: 'accepted', server_id: 71 },
      { key: items[1]!.key, status: 'duplicate', server_id: 904 },
    ], '2026-09-28T05:00:00Z');
    expect(done.accepted).toBe(1);
    expect(done.duplicates).toBe(1);
    expect(done.items).toHaveLength(1);
    expect(done.items[0]!.payload).toEqual({ visit_id: 904, ack: true, statement: 'read out' });
    expect(done.items[0]!.needs).toEqual([]);
    expect(done.items[0]!.key).toBe(items[2]!.key);
    expect(done.resolved).toEqual([{ local_id: C1, server_id: 71 }, { local_id: V1, server_id: 904 }]);
  });

  it('keeps a refusal with what the server said, until a person decides', () => {
    const [b] = [item({ payload: { client_id: 71, starts_at: '2026-09-28 10:00' } })];
    const next = { starts_at: '2026-09-28T05:30:00Z', date: '2026-09-28', label: '11:00' };
    const done = apply([b!], [b!], [{ key: b!.key, status: 'refused', message: 'Nimali is busy then.', next, choices: ['take_next', 'choose_time', 'drop'] }], 'T');
    expect(done.refused).toHaveLength(1);
    expect(done.items[0]).toMatchObject({ state: 'refused', message: 'Nimali is busy then.', next, choices: ['take_next', 'time', 'retry', 'drop'], updated_at: 'T' });
  });

  it('stops for the round when the server says "not now", and keeps the rest waiting under the same key', () => {
    const items = [item(), item()];
    const done = apply(items, items, [{ key: items[0]!.key, status: 'queued', message: 'Still being sent from another attempt.' }], 'T');
    expect(done.stop).toBe(true);
    expect(done.items.map((i) => [i.state, i.attempts, i.key])).toEqual([
      ['waiting', 1, items[0]!.key],
      ['waiting', 1, items[1]!.key],
    ]);
  });

  it('sends again, as a new attempt, an item refused only because what it named was not there yet', () => {
    const items = walkIn();
    const first = apply(items, items, [
      { key: items[0]!.key, status: 'refused', message: 'Somebody with that mobile is already a client.', next: { candidates: [{ id: 5, name: 'Amaya S', phone: '+94771234567', email: null }] } },
      { key: items[1]!.key, status: 'refused', message: `It needs ${C1}, which the server has not accepted. Send or resolve that first.`, choices: ['drop'] },
      { key: items[2]!.key, status: 'refused', message: `It needs ${V1}, which the server has not accepted. Send or resolve that first.`, choices: ['drop'] },
    ], 'T');
    expect(first.items[0]!.choices).toEqual(['client', 'retry', 'drop']);
    expect(batch(first.items)).toEqual([]);

    const edited = { ...first.items[0]!, state: 'waiting' as const, key: 'desk5-again' };
    const second = apply([edited, first.items[1]!, first.items[2]!], [edited], [{ key: 'desk5-again', status: 'accepted', server_id: 88 }], 'T');
    const book = second.items.find((i) => i.kind === 'visit.book')!;
    expect(book).toMatchObject({ state: 'waiting', payload: { client_id: 88 }, needs: [], message: null });
    expect(book.key).not.toBe(items[1]!.key);
    expect(book.key.startsWith('desk5-')).toBe(true);
    expect(second.items.find((i) => i.kind === 'visit.check_in')!.state).toBe('refused');
  });

  it('drops an item with everything that needs it', () => {
    const items = [...walkIn(), item()];
    const r = dropWithDependents(items, items[0]!.id);
    expect(r.dropped).toHaveLength(3);
    expect(r.items).toEqual([items[3]]);
  });

  it('"it is this client": the new client leaves, and what named it names the real one and goes again', () => {
    const items = walkIn().map((i, n) => (n === 1 ? { ...i, state: 'refused' as const, message: 'It needs …' } : i));
    const out = adoptClient(items, items[0]!.id, 5);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ kind: 'visit.book', state: 'waiting', payload: { client_id: 5 }, needs: [] });
    expect(out[0]!.key).not.toBe(items[1]!.key);
    expect(out[1]!.needs).toEqual([V1]);
  });

  it('offers what fits the refusal', () => {
    expect(choicesFor('visit.book', null, ['edit', 'drop'])).toEqual(['time', 'retry', 'drop']);
    expect(choicesFor('client.create', null, ['edit', 'drop'])).toEqual(['edit', 'retry', 'drop']);
    expect(choicesFor('visit.check_in', null, ['edit', 'drop'])).toEqual(['edit', 'retry', 'drop']);
    expect(choicesFor('visit.check_in', { starts_at: 'x' }, ['take_next', 'choose_time', 'drop'])).toEqual(['retry', 'drop']);
    expect(choicesFor('client.create', { candidates: [] }, ['take_next', 'choose_time', 'drop'])).toEqual(['retry', 'drop']);
    expect(choicesFor('visit.check_in', null, ['launch_missiles'])).toEqual(['retry', 'drop']);
  });
});

/* ── the service ──────────────────────────────────────────────────────── */

const NOW = Date.parse('2026-09-28T04:30:00Z'); // 10:00 in Colombo
const ORIGIN = 'https://ws.example';

type Handler = (opts: { query?: Record<string, unknown>; body?: unknown; headers?: Record<string, string> }) => unknown;

function bootstrap(over: Record<string, unknown> = {}) {
  return {
    desk: { id: 5, org_id: 17, location_id: 16, name: 'Front desk', status: 'active' },
    at: '2026-09-28T04:30:00Z',
    timezone: 'Asia/Colombo',
    location: { id: 16, name: 'Colombo 05', hours: [] },
    menu: [{ id: 3, name: 'Cut' }],
    stylists: [{ id: 9, name: 'Nimali' }],
    clients: [
      { id: 29, name: 'Dilini Perera', phone: '+94771234567', email: 'dilini@example.com', allergy: { severity: 'severe', substance: 'PPD' } },
      { id: 30, name: 'Kasun Silva', phone: '+94712223333', email: null, allergy: null },
    ],
    visits: [
      { id: 900, date: '2026-09-28', start: '11:00', starts_at: '2026-09-28T05:30:00Z', status: 'confirmed', client: { id: 29, name: 'Dilini Perera' } },
      { id: 901, date: '2026-09-27', start: '09:00', starts_at: '2026-09-27T03:30:00Z', status: 'completed', client: { id: 30, name: 'Kasun Silva' } },
    ],
    settings: { offline_writes: true, cache_days_ahead: 14, currency: 'LKR' },
    ...over,
  };
}

function harness(opts: { caps?: ReturnType<SalonSyncDeps['caps']>; routes?: Record<string, Handler>; user?: string } = {}) {
  const db = new Database(':memory:');
  const vault = new Vault(Vault.generateKey());
  const calls: Array<{ method: string; path: string; query?: Record<string, unknown>; body?: unknown; headers?: Record<string, string> }> = [];
  const notes: Array<{ id: string; title: string; body: string; link: string }> = [];
  const state = { user: opts.user ?? 'u1', now: NOW, down: false, caps: opts.caps ?? { offlineCache: true, offlineQueue: 'allowed' as const } };
  const routes: Record<string, Handler> = {
    'GET /api/salon/v1/desk/bootstrap': () => bootstrap(),
    'GET /api/salon/v1/options': () => ({ may: { book: true, pay: true }, currency: 'LKR', company: 'Lotus', ack_severity: 'moderate', locations: [] }),
    'GET /api/salon/v1/desk/delta': () => ({ at: '2026-09-28T04:31:00Z', after: null, more: false, visits: [] }),
    'POST /api/salon/v1/desk/heartbeat': () => ({ ok: true }),
    'POST /api/salon/v1/desk/outbox': (o) => ({ results: ((o.body as { items: Array<{ key: string }> }).items).map((i, n) => ({ key: i.key, status: 'accepted', server_id: 500 + n })) }),
    ...opts.routes,
  };
  const http = {
    request: vi.fn(async (method: string, path: string, o: { query?: Record<string, unknown>; body?: unknown; headers?: Record<string, string> } = {}) => {
      calls.push({ method, path, query: o.query, body: o.body, headers: o.headers });
      if (state.down) throw new DesktopError('NETWORK_UNREACHABLE', 'WorkSuite cannot be reached.');
      const h = routes[`${method} ${path}`];
      if (!h) throw new DesktopError('NOT_FOUND', `no route ${method} ${path}`, 404);
      return h(o);
    }),
  };
  const changed = vi.fn();
  const sync = new SalonSync({
    db,
    vault: () => vault,
    http: http as unknown as SalonSyncDeps['http'],
    origin: () => ORIGIN,
    user: () => state.user,
    desk: () => ({ desk_id: 5, name: 'Front desk' }),
    deskKey: () => 'desk-key-secret',
    caps: () => state.caps,
    appVersion: '0.2.43',
    notify: (n) => notes.push(n),
    changed,
    now: () => state.now,
  });
  return { db, vault, sync, calls, notes, state, routes, changed };
}

describe('salon sync: the day copy', () => {
  it('takes the day whole, with the desk key, and keeps it encrypted', async () => {
    const h = harness();
    const s = await h.sync.sync();
    expect(s.reachable).toBe(true);
    expect(s.copy).toMatchObject({ visits: 2, clients: 2 });
    const boot = h.calls.find((c) => c.path.endsWith('/desk/bootstrap'))!;
    expect(boot.headers).toEqual({ 'X-Salon-Desk-Key': 'desk-key-secret' });
    expect(boot.query).toEqual({ desk: 5 });
    expect(h.calls.find((c) => c.path.endsWith('/options'))!.query).toEqual({ org: 17 });

    const raw = h.db.get<{ payload: string }>('SELECT payload FROM salon_copy')!.payload;
    expect(raw).not.toContain('Dilini');
    expect(h.sync.copy()).toMatchObject({ desk_id: 5, timezone: 'Asia/Colombo', options: { currency: 'LKR', ack_severity: 'moderate' } });
    expect(h.changed).toHaveBeenCalled();
  });

  it('then asks only for what changed, a little before where it left off, and merges it', async () => {
    const h = harness();
    await h.sync.sync();
    h.routes['GET /api/salon/v1/desk/delta'] = () => ({
      at: '2026-09-28T04:32:00Z',
      after: null,
      more: false,
      visits: [
        { id: 900, date: '2026-09-28', start: '11:00', starts_at: '2026-09-28T05:30:00Z', status: 'cancelled', cancel: { by: 'client' }, client: { id: 29, name: 'Dilini Perera' } },
        { id: 902, date: '2026-09-29', start: '15:00', starts_at: '2026-09-29T09:30:00Z', status: 'confirmed', client: { id: 30, name: 'Kasun Silva' } },
      ],
    });
    h.state.now += 60_000;
    await h.sync.sync();
    const delta = h.calls.filter((c) => c.path.endsWith('/desk/delta'));
    expect(delta).toHaveLength(1);
    expect(delta[0]!.query).toEqual({ desk: 5, since: '2026-09-28T04:29:55.000Z', after: undefined });
    const visits = h.sync.copy()!.visits as Array<{ id: number; status: string }>;
    expect(visits.map((v) => v.id)).toEqual([901, 900, 902]);
    expect(visits.find((v) => v.id === 900)!.status).toBe('cancelled');

    /* A client cancelling today's visit from their own link raises nothing on the server: the desk hears it here, once. */
    expect(h.notes).toEqual([{ id: 'salon-cancelled-900', title: 'Dilini Perera cancelled', body: "Today's 11:00 visit was cancelled from the client's own link.", link: '/salon?view=today' }]);
  });

  it('takes the day whole again after an hour', async () => {
    const h = harness();
    await h.sync.sync();
    h.state.now += 61 * 60_000;
    await h.sync.sync();
    expect(h.calls.filter((c) => c.path.endsWith('/desk/bootstrap'))).toHaveLength(2);
    expect(h.calls.filter((c) => c.path.endsWith('/desk/delta'))).toHaveLength(0);
  });

  it('keeps no copy where the policy lets this computer keep nothing offline', async () => {
    const h = harness();
    await h.sync.sync();
    h.state.caps = { offlineCache: false, offlineQueue: 'allowed' };
    expect(h.sync.copy()).toBeNull();
    expect(h.sync.clients('dil', 5)).toEqual([]);
    await h.sync.sync();
    expect(h.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM salon_copy')!.n).toBe(0);
  });

  it('finds clients by name, email, or three digits or more of the mobile, with or without the leading zero', async () => {
    const h = harness();
    await h.sync.sync();
    expect(h.sync.clients('dilini', 5).map((c) => c.id)).toEqual([29]);
    expect(h.sync.clients('077 123', 5).map((c) => c.id)).toEqual([29]);
    expect(h.sync.clients('0712', 5).map((c) => c.id)).toEqual([30]);
    expect(h.sync.clients('12', 5)).toEqual([]);
    expect(h.sync.clients('+94 71', 5).map((c) => c.id)).toEqual([30]);
    expect(nationalDigits('+94 77 123 4567')).toBe('771234567');
    expect(nationalDigits('+1 415 555 0100')).toBe('4155550100');
    expect(nationalDigits('+880 17 1234 5678')).toBe('1712345678');
    expect(nationalDigits('077 123 4567')).toBe('771234567');
    expect(h.sync.clients('', 1)).toHaveLength(1);
    expect(h.sync.clients('dilini', 5)[0]!.allergy).toEqual({ severity: 'severe', substance: 'PPD' });
  });

  it("keeps yesterday to the salon's days ahead, on the salon's own calendar", () => {
    const at = Date.parse('2026-09-28T19:00:00Z'); // 00:30 on the 29th in Colombo
    expect(dayIn('Asia/Colombo', at)).toBe('2026-09-29');
    const v = [{ date: '2026-09-27' }, { date: '2026-09-28' }, { date: '2026-10-02' }, { date: '2026-10-03' }];
    expect(prune(v, 'Asia/Colombo', 3, at).map((x) => x.date)).toEqual(['2026-09-28', '2026-10-02']);
    expect(searchClients([{ name: 'A', phone: null, email: null }], 'zzz', 5)).toEqual([]);
  });
});

describe('salon sync: the outbox', () => {
  const walkInInputs = () => [
    { kind: 'client.create' as const, local_id: C1, payload: { name: 'Amaya Senanayake', mobile: '0771234567' }, label: 'New client: Amaya Senanayake' },
    { kind: 'visit.book' as const, local_id: V1, payload: { client_id: `local:${C1}`, starts_at: 'now', items: [{ service_id: 3, provider_id: 9 }] }, label: 'Walk-in: Amaya Senanayake' },
    { kind: 'visit.check_in' as const, payload: { visit_id: `local:${V1}`, ack: true, statement: 'read out' }, label: 'Check-in: Amaya Senanayake' },
  ];

  it('keeps a walk-in made offline, in order, and sends it when WorkSuite answers', async () => {
    const h = harness();
    await h.sync.sync();
    h.state.down = true;
    for (const i of walkInInputs()) h.sync.add(i);
    await h.sync.sync();
    expect(h.sync.status()).toMatchObject({ waiting: 3, refused: 0, reachable: false, can_write: true });
    expect(h.db.get<{ item: string }>('SELECT item FROM salon_outbox LIMIT 1')!.item).not.toContain('Amaya');

    h.state.down = false;
    h.calls.length = 0;
    const s = await h.sync.sync();
    const post = h.calls.find((c) => c.path.endsWith('/desk/outbox'))!;
    const body = post.body as { desk: number; app_version: string; items: Array<{ key: string; kind: string; local_id: string | null; made_at: string }> };
    expect(post.headers).toEqual({ 'X-Salon-Desk-Key': 'desk-key-secret' });
    expect(body.desk).toBe(5);
    expect(body.app_version).toBe('desktop 0.2.43');
    expect(body.items.map((i) => [i.kind, i.local_id])).toEqual([
      ['client.create', C1],
      ['visit.book', V1],
      ['visit.check_in', null],
    ]);
    expect(body.items.every((i) => /^desk5-[0-9a-f-]{36}$/.test(i.key) && i.made_at === '2026-09-28T04:30:00.000Z')).toBe(true);
    expect(s).toMatchObject({ waiting: 0, refused: 0, last_sync: { accepted: 3, refused: 0, duplicates: 0 } });
    expect(h.sync.outbox()).toEqual([]);
    const beat = h.calls.find((c) => c.path.endsWith('/desk/heartbeat'))!;
    expect(beat.body).toEqual({ desk: 5, app_version: 'desktop 0.2.43', queue_depth: 0 });
  });

  it('tells the desk once when WorkSuite would not do something, and takes the next time when asked', async () => {
    const next = { starts_at: '2026-09-28T05:30:00Z', date: '2026-09-28', label: '11:00' };
    let refuse = true;
    const h = harness({
      routes: {
        'POST /api/salon/v1/desk/outbox': (o) => ({
          results: (o.body as { items: Array<{ key: string }> }).items.map((i) => (refuse ? { key: i.key, status: 'refused', message: 'Nimali is busy then.', next, choices: ['take_next', 'choose_time', 'drop'] } : { key: i.key, status: 'accepted', server_id: 77 })),
        }),
      },
    });
    h.state.down = true;
    const added = h.sync.add({ kind: 'visit.book', payload: { client_id: 29, starts_at: '2026-09-28 10:30', items: [{ service_id: 3, provider_id: 9 }] }, label: 'Booking: Dilini Perera' });
    h.state.down = false;
    await h.sync.sync();
    await h.sync.sync();
    expect(h.notes).toHaveLength(1);
    expect(h.notes[0]).toMatchObject({ title: 'A change from the desk needs you', body: 'Booking: Dilini Perera — Nimali is busy then.', link: '/salon?view=outbox' });
    expect(h.sync.status()).toMatchObject({ waiting: 0, refused: 1 });
    const [r] = h.sync.outbox();
    expect(r).toMatchObject({ state: 'refused', choices: ['take_next', 'time', 'retry', 'drop'], next });

    refuse = false;
    h.sync.resolve({ id: added.id, action: 'take_next' });
    await h.sync.sync();
    const sent = h.calls.filter((c) => c.path.endsWith('/desk/outbox')).at(-1)!.body as { items: Array<{ key: string; payload: { starts_at: string } }> };
    expect(sent.items[0]!.payload.starts_at).toBe('2026-09-28T05:30:00Z');
    expect(sent.items[0]!.key).not.toBe(added.key);
    expect(h.sync.outbox()).toEqual([]);
  });

  it('queues only on a trusted computer, for a company that lets its desks book offline', async () => {
    const untrusted = harness({ caps: { offlineCache: true, offlineQueue: 'drafts_only' } });
    expect(() => untrusted.sync.add(walkInInputs()[0]!)).toThrow(/trusted computer/);
    expect(untrusted.sync.status()).toMatchObject({ can_write: false, why_not: expect.stringMatching(/trusted/) });

    const off = harness({ routes: { 'GET /api/salon/v1/desk/bootstrap': () => bootstrap({ settings: { offline_writes: false, cache_days_ahead: 14 } }) } });
    await off.sync.sync();
    expect(() => off.sync.add(walkInInputs()[0]!)).toThrow(/does not let its desks book offline/);
  });

  it('keeps only what a desk makes: its own kinds, local ids and references', () => {
    const h = harness();
    expect(() => h.sync.add({ kind: 'visit.book', local_id: 'V-1', payload: {}, label: 'x' })).toThrow(/local id/);
    expect(() => h.sync.add({ kind: 'visit.book', local_id: C1, payload: {}, label: 'x' })).toThrow(/local id/);
    expect(() => h.sync.add({ kind: 'visit.check_in', local_id: V1, payload: {}, label: 'x' })).toThrow(/local id/);
    expect(() => h.sync.add({ kind: 'visit.book', payload: { client_id: `local:${C2}` }, label: 'x' })).toThrow(/does not have waiting/);
    expect(() => h.sync.add({ kind: 'visit.pay' as never, payload: {}, label: 'x' })).toThrow(/not something a desk does offline/);
    expect(() => h.sync.add({ kind: 'client.create', local_id: C1, payload: { note: 'x'.repeat(21_000) }, label: 'x' })).toThrow(/too large/);
  });

  it("belongs to the person who made it: it waits through a sign-out, and another person sees only that it is there", async () => {
    const h = harness();
    await h.sync.sync();
    h.state.down = true;
    h.sync.add(walkInInputs()[0]!);
    h.sync.signedOut('u1');
    expect(h.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM salon_copy')!.n).toBe(0);

    h.state.user = 'u2';
    expect(h.sync.outbox()).toEqual([]);
    expect(h.sync.status()).toMatchObject({ waiting: 0, others: 1 });
    await h.sync.sync();
    h.state.down = false;
    h.calls.length = 0;
    await h.sync.sync();
    expect(h.calls.some((c) => c.path.endsWith('/desk/outbox'))).toBe(false);
    expect(h.calls.find((c) => c.path.endsWith('/desk/heartbeat'))!.body).toMatchObject({ queue_depth: 1 });

    h.state.user = 'u1';
    await h.sync.sync();
    expect(h.sync.outbox()).toEqual([]);
  });

  it('still keeps the copy current when the outbox is refused whole', async () => {
    const h = harness({ routes: { 'POST /api/salon/v1/desk/outbox': () => { throw new DesktopError('CONFLICT', 'This company does not let desks book offline.', 409); } } });
    h.state.down = true;
    h.sync.add(walkInInputs()[0]!);
    h.state.down = false;
    const s = await h.sync.sync();
    expect(s).toMatchObject({ problem: 'This company does not let desks book offline.', waiting: 1, reachable: true });
    expect(s.copy).not.toBeNull();
  });

  it('says so when the desk is no longer paired', async () => {
    const h = harness({ routes: { 'GET /api/salon/v1/desk/bootstrap': () => { throw new DesktopError('PERMISSION_DENIED', 'This desk is not paired, or was revoked.', 403); } } });
    const s = await h.sync.sync();
    expect(s.problem).toMatch(/not paired, or was revoked/);
  });

  it('forgets a desk it is paired again from, and says how much was never sent', () => {
    const h = harness();
    h.state.down = true;
    h.sync.add(walkInInputs()[0]!);
    h.sync.add(walkInInputs()[1]!);
    expect(h.sync.forgetDesk(ORIGIN, 5)).toBe(2);
    expect(h.sync.outbox()).toEqual([]);
    h.sync.add(walkInInputs()[0]!);
    h.sync.forgetAll();
    expect(h.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM salon_outbox')!.n).toBe(0);
  });
});
