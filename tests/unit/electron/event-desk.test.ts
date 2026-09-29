import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.2.57' }, safeStorage: {}, BrowserWindow: class {} }));

import type { CopyRow } from '@shared/event-desk';
import { isProxyPathAllowed } from '../../../electron/services/api-proxy';
import { Database } from '../../../electron/services/db';
import { EventDesk, deviceHash, unreachable, type EventDeskDeps } from '../../../electron/services/event-desk';
import { Vault } from '../../../electron/services/vault';
import { DesktopError } from '../../../electron/main/errors';

const ORIGIN = 'https://ws.example';
const KEY = 'k3y_-Ab';
const QR = 'EV1-ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const T0 = Date.parse('2026-10-20T04:00:00Z');

function secrets() {
  const m = new Map<string, string>();
  return {
    m,
    get: (k: string) => m.get(k) ?? null,
    set: (k: string, v: string) => void m.set(k, v),
    delete: (k: string) => void m.delete(k),
    deletePrefix: (p: string) => {
      let n = 0;
      for (const k of [...m.keys()]) if (k.startsWith(p) && m.delete(k)) n++;
      return n;
    },
  };
}

type Handler = (body: Record<string, unknown>, query: URLSearchParams) => { status?: number; body: unknown } | 'down';

/** WorkSuite, as a table of routes; 'down' is a network that does not answer. */
function server(routes: Record<string, Handler>) {
  const calls: Array<{ method: string; path: string; body: Record<string, unknown>; query: URLSearchParams }> = [];
  let down = false;
  const http = {
    url: (path: string, query?: Record<string, string | number | boolean | null | undefined>) => {
      const u = new URL(path, ORIGIN);
      for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
      return u.toString();
    },
    raw: async (method: string, url: string, init: { body?: BodyInit }) => {
      const u = new URL(url);
      const path = u.pathname.replace('/api/events/v1', '');
      const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      calls.push({ method, path, body, query: u.searchParams });
      if (down) throw new DesktopError('NETWORK_UNREACHABLE', 'Cannot reach WorkSuite server.');
      const h = routes[`${method} ${path}`];
      if (!h) return new Response(JSON.stringify({ status: 'error', message: `No route ${method} ${path}` }), { status: 404, headers: { 'content-type': 'application/json' } });
      const r = h(body, u.searchParams);
      if (r === 'down') throw new DesktopError('NETWORK_UNREACHABLE', 'Cannot reach WorkSuite server.');
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
    },
  };
  return {
    http,
    calls,
    setDown: (v: boolean) => {
      down = v;
    },
  };
}

const ok = (data: unknown, message = '') => ({ body: { status: 'success', message, data } });
const no = (status: number, message: string, errors: Record<string, unknown>) => ({ status, body: { status: 'error', message, errors } });

function copyRow(over: Partial<CopyRow> = {}): CopyRow {
  return {
    id: 101,
    number: 'EVT-REG-000101',
    name: 'Dilani Perera',
    company: 'Lanka Tea',
    ticket_type_id: 1,
    status: 'CONFIRMED',
    payment_due: false,
    hash: deviceHash(KEY, QR),
    ticket_active: true,
    revoked: null,
    photo_file_id: null,
    presence: [],
    ...over,
  };
}

function bootstrapPage(rows: CopyRow[]) {
  return {
    event: { id: 7, name: 'Tech Summit', status: 'LIVE', timezone: 'Asia/Colombo', start: { utc: '2026-10-20T03:30:00Z' }, end: { utc: '2026-10-21T12:30:00Z' }, checkin_policy: 'ONCE', reentry_allowed: true, days: [{ day: 1, date: '2026-10-20', label: 'Day 1', start: null, end: null }] },
    gate: { id: 3, name: 'Main entrance', direction: 'BOTH', active: true, auto_print: false },
    ticket_types: [{ id: 1, name: 'General', role: 'ATTENDEE', access_days: null, allowed_gate_ids: null, reentry: true, daily_checkin: false, admitted_here: true }],
    rules: { duplicate_behavior: 'warn', require_payment: 'block', auto_checkin: false, photo_verification: false, walk_ins: true },
    hash: { algorithm: 'HMAC-SHA256' },
    cursor: 40,
    cache_expires: { utc: '2026-10-22T12:30:00Z' },
    generated: null,
    total: rows.length,
    warning: 'Offline, a ticket let in at another gate is only seen when that device syncs: duplicates across devices may show late (EV-OFF-011).',
    items: rows,
    more: false,
    next_after_id: rows.at(-1)?.id ?? 0,
    count: rows.length,
  };
}

const device = { id: 31, name: 'Desk 1', event_id: 7, gate: { id: 3, name: 'Main entrance' }, status: 'ACTIVE', status_label: 'Active', online: true, device_ref: { type: 'desktop', id: '44', trusted: true }, queue_size: 0, last_sync: null };

function desk(routes: Record<string, Handler> = {}, over: Partial<EventDeskDeps> = {}) {
  const db = new Database(':memory:');
  const vault = new Vault(Vault.generateKey());
  const s = secrets();
  const srv = server({
    'POST /events/7/devices': () => ok({ device, id: 31, device_key: KEY, reregistered: false }, 'Device registered. Keep its key on the device: it is shown once.'),
    'GET /events/7': () => ok({ id: 7, name: 'Tech Summit', org_id: 5 }),
    'GET /events/7/checkin/bootstrap': () => ok(bootstrapPage([copyRow()])),
    'GET /events/7/checkin/changes': () => ok({ items: [], removed: [], cursor: 40, more: false }),
    'POST /devices/31/heartbeat': () => ok({ status: 'ACTIVE', wipe: false, cache_expires: null, event_status: 'LIVE', offline_allowed: true, device }),
    ...routes,
  });
  let now = T0;
  const changed = vi.fn();
  const notify = vi.fn();
  let user: string | null = 'u1';
  const d = new EventDesk({
    db,
    vault: () => vault,
    http: srv.http as unknown as EventDeskDeps['http'],
    secrets: s,
    origin: () => ORIGIN,
    user: () => user,
    deviceRef: () => '44',
    platform: 'linux',
    appVersion: '0.2.57',
    caps: () => ({ offlineCache: true, offlineQueue: 'allowed' }),
    notify,
    changed,
    now: () => now,
    ...over,
  });
  return {
    d,
    db,
    s,
    srv,
    changed,
    notify,
    tick: (ms: number) => {
      now += ms;
    },
    as: (u: string | null) => {
      user = u;
    },
  };
}

describe('event desk: this computer as a check-in device, and its key', () => {
  it('registers as a desktop device by its sync device id, keeps the key in the credential store, and never gives it back', async () => {
    const h = desk();
    const r = await h.d.register({ event_id: 7, gate_id: 3, name: 'Desk 1' });

    expect(h.srv.calls[0]).toMatchObject({ method: 'POST', path: '/events/7/devices', body: { name: 'Desk 1', gate_id: 3, device_ref_type: 'desktop', device_ref_id: '44', platform: 'linux', app_version: 'desktop 0.2.57' } });
    expect(r.registration).toMatchObject({ event_id: 7, event_name: 'Tech Summit', org_id: 5, device_id: 31, gate_id: 3, gate_name: 'Main entrance' });
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(JSON.stringify(h.d.registrations())).not.toContain(KEY);
    expect(JSON.stringify(h.d.status(7))).not.toContain(KEY);
    expect([...h.s.m.keys()]).toEqual([`event-desk:${ORIGIN}`]);
    expect(h.s.m.get(`event-desk:${ORIGIN}`)).toContain(KEY);
  });

  it('keeps registering, a new key, the copy and the queue away from pages (the API proxy refuses them)', () => {
    expect(isProxyPathAllowed('/api/events/v1/events/7/devices', 'POST')).toBe(false);
    expect(isProxyPathAllowed('/api/events/v1/events/7/devices', 'GET')).toBe(true);
    expect(isProxyPathAllowed('/api/events/v1/devices/31/key', 'POST')).toBe(false);
    expect(isProxyPathAllowed('/api/events/v1/devices/31/heartbeat', 'POST')).toBe(false);
    expect(isProxyPathAllowed('/api/events/v1/events/7/checkin/bootstrap?device_id=31', 'GET')).toBe(false);
    expect(isProxyPathAllowed('/api/events/v1/events/7/checkin/changes', 'GET')).toBe(false);
    expect(isProxyPathAllowed('/api/events/v1/events/7/checkin/sync', 'POST')).toBe(false);
    expect(isProxyPathAllowed('/api/events/v1/events/7/checkin/search?q=di', 'GET')).toBe(true);
    expect(isProxyPathAllowed('/api/events/v1/events/7/walk-ins', 'POST')).toBe(true);
  });

  it('hashes as the server does: HMAC-SHA256 of the text trimmed and in capitals, under the key as given', () => {
    // hash_hmac('sha256', 'EV1-ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', 'k3y_-Ab') in PHP.
    expect(deviceHash(KEY, ` ${QR.toLowerCase()} `)).toBe('fa81f7e88ef1878f3151e35fc7ab7f6a33c5b7e8a0b20a3f155294fbd2c0670d');
    expect(deviceHash(KEY, QR)).toBe(createHmac('sha256', KEY).update(QR).digest('hex'));
  });

  it('takes the gate’s copy after registering, encrypted, and without the key in it', async () => {
    const h = desk();
    await h.d.register({ event_id: 7, gate_id: 3, name: 'Desk 1' });
    await h.d.sync(7);
    expect(h.srv.calls.some((c) => c.path === '/events/7/checkin/bootstrap' && c.query.get('device_id') === '31')).toBe(true);
    const raw = h.db.get<{ payload: string }>('SELECT payload FROM event_desk_copy')!.payload;
    expect(raw).not.toContain('Dilani');
    expect(raw.startsWith('v1:')).toBe(true);
    expect(h.d.status(7).copy).toMatchObject({ rows: 1, event_status: 'LIVE', gate: 'Main entrance' });
  });
});

describe('event desk: scanning', () => {
  it('asks the server, with this device, its gate and a fresh scan id each time', async () => {
    const h = desk({
      'POST /events/7/scan': (b) => ok({ result: 'VALID', action: 'CHECK_IN', colour: 'green', label: 'Valid', reason: 'Welcome.', warning: null, done: false, via: 'qr', attendee: null, ticket: null, registration: { id: 101, number: 'EVT-REG-000101', status: 'CONFIRMED', status_label: 'Confirmed', payment_status: null }, presence: null, options: ['check_in'], checkin_event_id: null, client: b.client_uuid }, 'Valid: Welcome.'),
    });
    await h.d.register({ event_id: 7, gate_id: 3, name: 'Desk 1' });
    const a = await h.d.scan({ event_id: 7, code: QR, mode: 'scan' });
    const b = await h.d.scan({ event_id: 7, code: QR, mode: 'scan' });
    expect(a).toMatchObject({ source: 'server', message: 'Valid: Welcome.', view: { result: 'VALID', options: ['check_in'] } });
    const sent = h.srv.calls.filter((c) => c.path === '/events/7/scan');
    expect(sent[0]!.body).toMatchObject({ code: QR, gate_id: 3, device_id: 31 });
    expect(sent[0]!.body.client_uuid).not.toBe(sent[1]!.body.client_uuid);
    expect(b.source).toBe('server');
  });

  it('shows the server’s refusal in its own words', async () => {
    const h = desk({ 'POST /events/7/check-out': () => no(409, 'This ticket is not checked in.', { code: 'not_inside' }) });
    await h.d.register({ event_id: 7, gate_id: 3, name: 'Desk 1' });
    expect(await h.d.scan({ event_id: 7, code: QR, mode: 'check_out' })).toEqual({ source: 'refused', status: 409, code: 'not_inside', message: 'This ticket is not checked in.', wipe: false });
  });

  it('answers from its copy when WorkSuite does not, keeps the check-in, and warns of a second entry', async () => {
    const h = desk({ 'POST /events/7/scan': () => 'down', 'POST /events/7/check-in': () => 'down' });
    await h.d.register({ event_id: 7, gate_id: 3, name: 'Desk 1' });
    await h.d.sync(7);

    const first = await h.d.scan({ event_id: 7, code: QR, mode: 'scan' });
    expect(first).toMatchObject({ source: 'local', queued: false, view: { result: 'VALID', options: ['check_in'], attendee: { name: 'Dilani Perera' } } });

    const inn = await h.d.scan({ event_id: 7, code: QR, mode: 'check_in' });
    expect(inn).toMatchObject({ source: 'local', queued: true, view: { done: true, action: 'CHECK_IN', presence: { state: 'INSIDE', entries: 1 } } });
    expect(inn.source === 'local' && inn.message).toContain('duplicates across devices may show late');

    const again = await h.d.scan({ event_id: 7, code: QR, mode: 'scan' });
    expect(again).toMatchObject({ source: 'local', view: { result: 'VALID', warning: 'Already checked in.' } });

    const q = h.d.queue(7);
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ action: 'CHECK_IN', local_result: 'VALID', state: 'waiting', label: 'Dilani Perera · EVT-REG-000101' });
    expect(q[0]!.device_sequence).toBeGreaterThanOrEqual(T0);
    expect(h.d.status(7)).toMatchObject({ waiting: 1, reachable: false });
    expect(h.d.pending()).toBe(1);
  });

  it('keeps a refused scan as the attempt it was, and says a code not in the copy is not one of the gate’s', async () => {
    const h = desk({ 'POST /events/7/scan': () => 'down' });
    await h.d.register({ event_id: 7, gate_id: 3, name: 'Desk 1' });
    await h.d.sync(7);
    const r = await h.d.scan({ event_id: 7, code: 'EV1-ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ', mode: 'scan' });
    expect(r).toMatchObject({ source: 'local', queued: true, view: { result: 'INVALID_TICKET' } });
    expect(r.source === 'local' && r.view.reason).toContain('not in this gate’s offline copy');
    expect(h.d.queue(7)[0]).toMatchObject({ local_result: 'INVALID_TICKET', action: 'CHECK_IN' });
  });

  it('refuses offline where the company does not let this computer queue check-ins', async () => {
    const h = desk({ 'POST /events/7/scan': () => 'down' }, { caps: () => ({ offlineCache: true, offlineQueue: 'drafts_only' }) });
    await h.d.register({ event_id: 7, gate_id: 3, name: 'Desk 1' });
    const r = await h.d.scan({ event_id: 7, code: QR, mode: 'scan' });
    expect(r).toMatchObject({ source: 'refused', code: 'offline' });
    expect(r.source === 'refused' && r.message).toContain('only a trusted computer keeps check-ins');
    expect(h.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM event_desk_copy')!.n).toBe(0);
  });

  it('wipes the key, the copy and the queue when the server says the device was revoked (EV-CHK-033)', async () => {
    let revoked = false;
    const h = desk({
      'POST /events/7/scan': () => (revoked ? no(403, 'This device was revoked: its copy of the event is to be wiped.', { code: 'device_revoked', wipe: true }) : 'down'),
      'POST /events/7/check-in': () => 'down',
    });
    await h.d.register({ event_id: 7, gate_id: 3, name: 'Desk 1' });
    await h.d.sync(7);
    await h.d.scan({ event_id: 7, code: QR, mode: 'check_in' });
    revoked = true;

    const r = await h.d.scan({ event_id: 7, code: QR, mode: 'scan' });
    expect(r).toMatchObject({ source: 'refused', code: 'device_revoked', wipe: true });
    expect(h.d.registration(7)).toBeNull();
    expect(h.s.m.size).toBe(0);
    expect(h.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM event_desk_copy')!.n).toBe(0);
    expect(h.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM event_desk_queue')!.n).toBe(0);
    expect(h.d.status(7).wiped).toContain('1 scan made offline and not yet sent was removed');
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'This desk was revoked at Tech Summit', link: '/events/7/desk' }));
  });

  it('wipes when the heartbeat says so', async () => {
    const h = desk({ 'POST /devices/31/heartbeat': () => ok({ status: 'REVOKED', wipe: true, device }) });
    await h.d.register({ event_id: 7, gate_id: 3, name: 'Desk 1' });
    await h.d.sync(7);
    expect(h.d.registration(7)).toBeNull();
    expect(h.d.status(7).wiped).toContain('revoked');
  });
});

describe('event desk: the queue goes up when WorkSuite is back', () => {
  it('sends it once, in order, with the device and its sequence, and keeps what the server made of each item', async () => {
    let sent: Record<string, unknown> | null = null;
    const h = desk({
      'POST /events/7/check-in': () => 'down',
      'POST /events/7/checkin/sync': (b) => {
        sent = b;
        const items = b.items as Array<{ client_uuid: string; device_sequence: number }>;
        return ok({
          batch_uuid: b.batch_uuid,
          received: items.length,
          accepted: 1,
          repeated: 0,
          duplicates: 1,
          conflicts: 0,
          rejected: 0,
          items: items.map((i) => ({ client_uuid: i.client_uuid, device_sequence: i.device_sequence, status: 'conflict', flag: 'POSSIBLE_DUPLICATE', reconciliation_id: 9 })),
          changes: { items: [copyRow({ presence: [{ day: null, state: 'INSIDE', entries: 2, last_in: null, last_gate_id: 3 }] })], removed: [], cursor: 52, more: false },
          device: { wipe: false, device },
          replayed: false,
        });
      },
    });
    await h.d.register({ event_id: 7, gate_id: 3, name: 'Desk 1' });
    await h.d.sync(7);
    h.srv.setDown(true);
    await h.d.scan({ event_id: 7, code: QR, mode: 'check_in' });
    h.srv.setDown(false);
    await h.d.sync(7);

    expect(sent).toMatchObject({ device_id: 31, cursor: 40, queue_size: 0, items: [{ action: 'CHECK_IN', token: QR, gate_id: 3, local_result: 'VALID' }] });
    expect(String((sent as unknown as { batch_uuid: string }).batch_uuid)).toMatch(/^batch-/);
    expect(h.d.queue(7)[0]).toMatchObject({ state: 'conflict', flag: 'POSSIBLE_DUPLICATE', reconciliation_id: 9 });
    expect(h.d.status(7)).toMatchObject({ waiting: 0, flagged: 1, last_sync: { duplicates: 1 } });
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Offline check-ins to review', link: '/events/7/checkin/reconciliation' }));

    // Nothing waits: the next sync sends nothing.
    const before = h.srv.calls.filter((c) => c.path === '/events/7/checkin/sync').length;
    await h.d.sync(7);
    expect(h.srv.calls.filter((c) => c.path === '/events/7/checkin/sync').length).toBe(before);
  });

  it('keeps a rejected item for a person to send again or drop', async () => {
    const h = desk({
      'POST /events/7/check-in': () => 'down',
      'POST /events/7/checkin/sync': (b) =>
        ok({ items: (b.items as Array<{ client_uuid: string }>).map((i) => ({ client_uuid: i.client_uuid, status: 'rejected', message: 'This item could not be recorded; it stays in the queue.' })), accepted: 0, rejected: 1 }),
    });
    await h.d.register({ event_id: 7, gate_id: 3, name: 'Desk 1' });
    await h.d.sync(7);
    h.srv.setDown(true);
    await h.d.scan({ event_id: 7, code: QR, mode: 'check_in' });
    h.srv.setDown(false);
    await h.d.sync(7);
    const [item] = h.d.queue(7);
    expect(item).toMatchObject({ state: 'rejected', message: 'This item could not be recorded; it stays in the queue.' });
    expect(() => h.d.forget(7)).toThrow(/1 scan made here offline has not reached WorkSuite yet/);
    expect(h.d.resolveItem(7, item!.client_uuid, 'drop')).toEqual([]);
    expect(h.d.forget(7)).toBe(0);
    expect(h.d.registration(7)).toBeNull();
  });

  it('keeps an offline walk-in with a provisional number (EV-OFF-006)', async () => {
    const h = desk();
    await h.d.register({ event_id: 7, gate_id: 3, name: 'Desk 1' });
    await h.d.sync(7);
    const r = h.d.walkIn({ event_id: 7, ticket_type_id: 1, answers: { first_name: 'Amaya', last_name: 'Silva', phone: '0771234567' } });
    expect(r.provisional_number).toMatch(/^WALKIN-31-\d{6}$/);
    expect(h.d.queue(7)[0]).toMatchObject({ action: 'WALK_IN', provisional_number: r.provisional_number, label: `Amaya Silva · ${r.provisional_number}` });
    expect(() => h.d.walkIn({ event_id: 7, ticket_type_id: 99, answers: {} })).toThrow(/Choose a ticket this gate admits/);
  });

  it('keeps each person’s scans for them: another person at the desk sees only that they are there', async () => {
    const h = desk({ 'POST /events/7/check-in': () => 'down' });
    await h.d.register({ event_id: 7, gate_id: 3, name: 'Desk 1' });
    await h.d.sync(7);
    h.srv.setDown(true);
    await h.d.scan({ event_id: 7, code: QR, mode: 'check_in' });
    h.d.signedOut('u1');
    h.as('u2');
    expect(h.d.queue(7)).toEqual([]);
    expect(h.d.status(7)).toMatchObject({ waiting: 0, others: 1, copy: null });
    expect(h.d.registration(7)).not.toBeNull();
  });

  it('forgets every desk on a full wipe', async () => {
    const h = desk();
    await h.d.register({ event_id: 7, gate_id: 3, name: 'Desk 1' });
    await h.d.sync(7);
    h.d.forgetAll();
    expect(h.s.m.size).toBe(0);
    expect(h.d.registrations()).toEqual([]);
    expect(h.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM event_desk_copy')!.n).toBe(0);
  });

  it('takes a gateway that does not answer as WorkSuite out of reach, but not the server being busy', () => {
    expect(unreachable(new DesktopError('NETWORK_UNREACHABLE', 'x'))).toBe(true);
    expect(unreachable(new DesktopError('TLS_ERROR', 'x'))).toBe(false);
  });
});
