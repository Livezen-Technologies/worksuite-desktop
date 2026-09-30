import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.1.0' }, safeStorage: {} }));

import type { RestaurantOutboxItem, RestaurantPairing } from '@shared/restaurant';
import { DesktopError } from '../../../electron/main/errors';
import { Database } from '../../../electron/services/db';
import { Vault } from '../../../electron/services/vault';
import { apply, batch, batchKey, dropWithDependents, held, needsOf, retried } from '../../../electron/services/restaurant/outbox';
import { RestaurantSync, type RestaurantSyncDeps } from '../../../electron/services/restaurant/sync';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
let seq = 0;

function item(over: Partial<RestaurantOutboxItem> = {}): RestaurantOutboxItem {
  seq++;
  return {
    id: `id-${seq}`,
    seq,
    ref: `t7-${seq}`,
    op: 'add_items',
    data: {},
    label: `item ${seq}`,
    needs: null,
    state: 'waiting',
    attempts: 0,
    message: null,
    conflict_ids: [],
    order: null,
    created_at: '2026-09-30T10:00:00Z',
    updated_at: '2026-09-30T10:00:00Z',
    ...over,
  };
}

const line = (n: number) => ({ item_id: 3, qty: 1, client_line_id: `l-${n}` });

describe('restaurant outbox: what is sent, and in which order', () => {
  it('sends waiting items in the order they were made, one batch at a time', () => {
    const many = Array.from({ length: 60 }, () => item());
    const sent = batch([...many].reverse());
    expect(sent).toHaveLength(50);
    expect(sent.map((i) => i.seq)).toEqual(many.slice(0, 50).map((i) => i.seq));
  });

  it('names the order an earlier queued item makes, and holds what needs an order the server did not take', () => {
    const create = item({ op: 'create_order', data: { uuid: U1, lines: [line(1)] } });
    const add = item({ op: 'add_items', data: { order_uuid: U1, lines: [line(2)] } });
    add.needs = needsOf([create], add.data);
    const other = item({ op: 'send', data: { order_uuid: U2 } });
    expect(add.needs).toBe(U1);
    expect(needsOf([create], other.data)).toBeNull();

    expect(held([create, add, other]).size).toBe(0);
    const refused = { ...create, state: 'refused' as const };
    expect([...held([refused, add, other])]).toEqual([add.id]);
    expect(batch([refused, add, other]).map((i) => i.id)).toEqual([other.id]);
    /* Kept off its table but made: what needs it still goes. */
    const kept = { ...create, state: 'conflict' as const, order: { id: 50, uuid: U1, number: '0012', status: 'sent' } };
    expect(batch([kept, add]).map((i) => i.id)).toEqual([add.id]);
  });

  it('asks the same batch with the same key, and another with another', () => {
    const a = [item(), item()];
    expect(batchKey(7, a)).toBe(batchKey(7, a.map((i) => ({ ...i }))));
    expect(batchKey(7, a)).not.toBe(batchKey(7, [a[0]!]));
    expect(batchKey(7, a)).toMatch(/^rt7-sync-[0-9a-f]{40}$/);
  });

  it('folds the answer in: taken leaves, a conflict stays marked, a refusal waits for a person, silence stays waiting', () => {
    const [a, b, c, d, e] = [item(), item(), item({ op: 'create_order', data: { uuid: U1 } }), item(), item()];
    const done = apply(
      [a, b, c, d, e],
      [a, b, c, d, e],
      [
        { client_ref: a.ref, status: 'applied' },
        { client_ref: b.ref, status: 'replayed' },
        { client_ref: c.ref, status: 'conflict', conflict_ids: [9], message: 'Taken, with something for a manager to look at.', order: { id: 50, uuid: U1, number: '0012', status: 'sent' } },
        { client_ref: d.ref, status: 'refused', message: 'Every line made offline carries the device\'s own line id.' },
      ],
      '2026-09-30T10:05:00Z',
    );
    expect(done.applied).toBe(2);
    expect(done.items.map((i) => [i.id, i.state])).toEqual([
      [c.id, 'conflict'],
      [d.id, 'refused'],
      [e.id, 'waiting'],
    ]);
    expect(done.items[0]).toMatchObject({ conflict_ids: [9], order: { id: 50, number: '0012' } });
    expect(done.items[2]!.attempts).toBe(1);
    expect(batch(done.items).map((i) => i.id)).toEqual([e.id]);
  });

  it('reads the server’s [] for "no order" as no order', () => {
    const a = item();
    const done = apply([a], [a], [{ client_ref: a.ref, status: 'conflict', conflict_id: 4, order: [] }], 'now');
    expect(done.items[0]).toMatchObject({ state: 'conflict', order: null, conflict_ids: [4] });
  });

  it('drops an order with what needs it, and sends a refusal again under a new reference', () => {
    const create = item({ op: 'create_order', data: { uuid: U1 }, state: 'refused' });
    const add = item({ data: { order_uuid: U1 }, needs: U1 });
    const other = item();
    expect(dropWithDependents([create, add, other], create.id).items).toEqual([other]);
    const again = retried(create, 't7-new', 'later');
    expect(again).toMatchObject({ ref: 't7-new', state: 'waiting', message: null, conflict_ids: [] });
  });
});

const TERMINAL: RestaurantPairing = { terminal_id: 7, org_id: 17, branch_id: 3, name: 'Till 1', code: 'T1', mode: 'pos', station_id: null, area_id: null, counter_id: null, pos_register_id: null, paired_at: '2026-09-30T09:00:00Z' };

function setup(over: Partial<RestaurantSyncDeps> = {}, answer?: (method: string, path: string, opts: { body?: unknown; headers?: Record<string, string> }) => unknown) {
  const db = new Database(':memory:');
  const vault = new Vault(Vault.generateKey());
  const calls: Array<{ method: string; path: string; body?: unknown; headers?: Record<string, string>; query?: unknown }> = [];
  const request = vi.fn(async (method: string, path: string, opts: { body?: unknown; headers?: Record<string, string>; query?: unknown } = {}) => {
    calls.push({ method, path, body: opts.body, headers: opts.headers, query: opts.query });
    const a = answer?.(method, path, opts);
    if (a !== undefined) return a;
    if (path.endsWith('/sync')) {
      const ops = (opts.body as { ops: Array<{ client_ref: string }> }).ops;
      return { results: ops.map((o, index) => ({ index, client_ref: o.client_ref, status: 'applied' })), last_seq: 40 };
    }
    if (path.endsWith('/sync/heartbeat')) return { server_time: '2026-09-30T10:00:00Z', last_seq: 42 };
    if (path.endsWith('/pos')) return { branch_id: 3, policy: { offline_actions: ['create_order', 'add_items', 'print_kot', 'cash_payment'] } };
    if (path.endsWith('/floor')) return { tables: [{ id: 1, code: 'A1' }] };
    if (path.includes('/menu/branch/')) return { items: [{ id: 3, name: 'Kottu' }] };
    return {};
  });
  const notify = vi.fn();
  let now = Date.parse('2026-09-30T10:00:00Z');
  const sync = new RestaurantSync({
    db,
    vault: () => vault,
    http: { request } as never,
    origin: () => 'https://ws.example',
    user: () => '5',
    terminal: () => TERMINAL,
    terminalKey: () => `rt_${'cd'.repeat(24)}`,
    caps: () => ({ offlineCache: true, offlineQueue: 'allowed' }),
    appVersion: '0.2.64',
    printers: () => [{ id: 4, status: 'online' }],
    agent: () => ({ enabled: true, mapped: 1, last_claim_at: null, problem: null, printers: [] }),
    notify,
    changed: () => undefined,
    now: () => now,
    ...over,
  });
  return { db, sync, calls, request, notify, tick: (ms: number) => (now += ms) };
}

const createOrder = (uuid = U1) => ({ op: 'create_order' as const, label: 'Takeaway for Nimal', data: { uuid, order_type: 'takeaway' as const, lines: [line(1)], send: true } });

describe('restaurant sync: the outbox, the heartbeat and the copy', () => {
  it('keeps an offline order sealed, sends it with the terminal key and one idempotency key, and beats', async () => {
    const { sync, calls, db } = setup({}, (_m, path) => (path.endsWith('/sync') ? new Promise(() => undefined) : undefined));
    const kept = sync.add(createOrder());
    expect(kept).toMatchObject({ op: 'create_order', state: 'waiting', needs: null });
    expect(kept.ref).toMatch(/^t7-/);
    expect(kept.data.made_at).toBe('2026-09-30T10:00:00.000Z');
    const raw = db.get<{ item: string }>('SELECT item FROM restaurant_outbox');
    expect(raw!.item).not.toContain('Nimal');
    expect(sync.pending()).toBe(1);
    await new Promise((r) => setTimeout(r, 0));
    const s = calls.find((c) => c.path === '/api/restaurant/v1/sync')!;
    expect(s.headers!['X-Terminal-Key']).toMatch(/^rt_/);
    expect(s.headers!['Idempotency-Key']).toMatch(/^rt7-sync-/);
    expect(s.body).toMatchObject({ branch_id: 3, ops: [{ op: 'create_order', client_ref: kept.ref, data: { uuid: U1 } }] });
    expect(s.query).toMatchObject({ org: 17 });
  });

  it('empties the outbox as the server takes it, then beats and keeps the copy', async () => {
    const { sync, calls } = setup();
    sync.add(createOrder());
    const st = await sync.sync();
    expect(st.waiting).toBe(0);
    expect(st.last_sync).toMatchObject({ applied: 1 });
    expect(st.last_seq).toBe(42);
    const hb = calls.find((c) => c.path.endsWith('/sync/heartbeat'))!;
    expect(hb.body).toMatchObject({ queue_size: 0, app_version: 'desktop 0.2.64', online: true, printers: [{ id: 4, status: 'online' }] });
    const copy = sync.copy()!;
    expect(copy).toMatchObject({ terminal_id: 7, branch_id: 3, floor: { tables: [{ code: 'A1' }] }, menu: { items: [{ name: 'Kottu' }] } });
    expect(st.copy).toMatchObject({ menu: true, floor: true });
  });

  it('keeps a conflict marked and tells the till, and never sends it again', async () => {
    let n = 0;
    const { sync, notify, calls } = setup({}, (_m, path, opts) => {
      if (!path.endsWith('/sync')) return undefined;
      n++;
      const ops = (opts.body as { ops: Array<{ client_ref: string }> }).ops;
      return { results: ops.map((o) => ({ client_ref: o.client_ref, status: 'conflict', conflict_ids: [3], message: 'Taken, with something for a manager to look at.', order: { id: 50, uuid: U1, number: '0012', status: 'sent' } })) };
    });
    sync.add(createOrder());
    await sync.sync();
    await sync.sync();
    expect(n).toBe(1);
    expect(sync.outbox()[0]).toMatchObject({ state: 'conflict', conflict_ids: [3] });
    expect(sync.status()).toMatchObject({ waiting: 0, conflicts: 1 });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ link: '/restaurant?view=outbox' }));
    expect(() => sync.resolve(sync.outbox()[0]!.id, 'retry')).toThrow(DesktopError);
    sync.resolve(sync.outbox()[0]!.id, 'drop');
    expect(sync.outbox()).toEqual([]);
    expect(calls.filter((c) => c.path.endsWith('/sync'))).toHaveLength(1);
  });

  it('stays waiting when WorkSuite is out of reach, and says so', async () => {
    const { sync } = setup({}, () => {
      throw new DesktopError('NETWORK_UNREACHABLE', 'Cannot reach WorkSuite server.');
    });
    sync.add(createOrder());
    const st = await sync.sync();
    expect(st).toMatchObject({ reachable: false, waiting: 1 });
  });

  it('keeps nothing where the policy says not to, nor what the branch does not allow offline', async () => {
    expect(() => setup({ caps: () => ({ offlineCache: true, offlineQueue: 'drafts_only' }) }).sync.add(createOrder())).toThrow(/trusted computer/);
    const { sync } = setup({}, (_m, path) => (path.endsWith('/pos') ? { policy: { offline_actions: ['create_order'] } } : undefined));
    await sync.sync();
    expect(() => sync.add({ op: 'send', label: 'send', data: { order_id: 5 } })).toThrow(/does not let its tills/);
    expect(sync.add(createOrder(U2)).state).toBe('waiting');
  });

  it('refuses the same offline order twice, and an order without its device ids', () => {
    const { sync } = setup({}, (_m, path) => (path.endsWith('/sync') ? new Promise(() => undefined) : undefined));
    sync.add(createOrder());
    expect(() => sync.add(createOrder())).toThrow(/already waiting/);
    expect(() => sync.add({ op: 'add_items', label: 'x', data: { order_id: 5, lines: [{ item_id: 3, qty: 1 }] } } as never)).toThrow();
  });

  it('keeps each person’s outbox apart, and their copy goes at sign-out', async () => {
    let user = '5';
    const { sync } = setup({ user: () => user }, (_m, path) => (path.endsWith('/sync') ? new Promise(() => undefined) : undefined));
    sync.add(createOrder());
    user = '6';
    expect(sync.outbox()).toEqual([]);
    expect(sync.status().others).toBe(1);
    user = '5';
    expect(sync.outbox()).toHaveLength(1);
  });

  it('forgets the old terminal’s copy when unpaired, and its outbox only when asked', async () => {
    const { sync } = setup();
    await sync.sync();
    expect(sync.copy()).not.toBeNull();
    expect(sync.forgetTerminal('https://ws.example', 7, false)).toBe(0);
    expect(sync.copy()).toBeNull();
  });
});
