import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  globalShortcut: { register: vi.fn(() => true), unregister: vi.fn() },
  app: { getPath: () => '/tmp', getVersion: () => '0.0.0', isPackaged: false, on: () => undefined },
  Menu: { buildFromTemplate: vi.fn() },
  nativeImage: { createFromPath: vi.fn() },
  Tray: class {},
}));

import { HORIZON_MS, MarketingService, POLL_MS } from '../../../electron/services/marketing';
import { trayMarketingItems } from '../../../electron/tray/tray';
import { contract } from '@shared/ipc/contract';
import { INVOKE_CHANNELS } from '@shared/ipc/channels';
import { callbackNotice, callbackRoute, callbacksToday, dueCallbacks, NEXT_CONTACT_ROUTE, NEXT_CONTACT_SHORTCUT, sendingLabel, stampMs } from '@shared/marketing';
import type { Incoming } from '../../../electron/services/notifications';

/**
 * Marketing on the desktop (WS-MKT-SRS-001 D01, MKT-DSK-01, MKT-CAL-12): callback reminders at the minute with Call
 * now and Snooze, the next-contact shortcut only for someone who may work a call queue, and the tray's counts.
 */
const T0 = Date.UTC(2026, 9, 6, 8, 0, 0);
const utc = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

/** Timers that run only when the test moves time on. */
function fakeClock() {
  let now = T0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void; every?: number }>();
  return {
    now: () => now,
    setTimeout: (fn: () => void, ms: number) => {
      timers.set(++seq, { at: now + ms, fn });
      return seq;
    },
    clearTimeout: (h: unknown) => void timers.delete(h as number),
    setInterval: (fn: () => void, ms: number) => {
      timers.set(++seq, { at: now + ms, fn, every: ms });
      return seq;
    },
    clearInterval: (h: unknown) => void timers.delete(h as number),
    pending: () => [...timers.values()].filter((t) => !t.every).length,
    advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, t] = next;
        now = t.at;
        if (t.every) t.at += t.every;
        else timers.delete(id);
        t.fn();
      }
      now = until;
    },
  };
}

function service(over: { canCall?: boolean; allowed?: boolean; answers?: Record<string, unknown> } = {}) {
  const clock = fakeClock();
  const answers: Record<string, unknown> = {
    '/api/marketing/queue/callbacks': [
      { id: 7, queue_item_id: 103, due_at: utc(T0 + 30 * 60_000), note: 'Call after 2 pm', contact: { name: 'Iresha Dias', organisation: 'Dias Printers' } },
      { id: 8, queue_item_id: 105, due_at: utc(T0 + 2 * 3_600_000), note: null, contact: { name: 'Ruwan W.', organisation: 'SriLogix' } },
    ],
    '/api/marketing/queue': { waiting: 38, campaigns: [], items: [], claim: null },
    '/api/marketing/campaigns': { data: [{ id: 1, status: 'sending', progress: 62 }], total: 1, current_page: 1, last_page: 1, per_page: 5 },
    ...over.answers,
  };
  const get = vi.fn(async (path: string) => {
    const a = answers[path];
    if (a instanceof Error) throw a;
    return a;
  });
  const keys = { register: vi.fn((_acc: string, _fn: () => void) => true), unregister: vi.fn((_acc: string) => undefined) };
  const notify = vi.fn<(n: Incoming) => void>();
  const openRoute = vi.fn<(r: string) => void>();
  const onTray = vi.fn();
  let allowed = over.allowed ?? true;
  const s = new MarketingService({
    http: { get: get as never },
    allowed: () => allowed,
    canCall: () => over.canCall ?? true,
    notify,
    openRoute,
    onTray,
    shortcuts: keys,
    clock,
  });
  return { s, clock, get, keys, notify, openRoute, onTray, setAllowed: (v: boolean) => (allowed = v) };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('callbacks from the server', () => {
  it('keeps the well-formed ones due within the horizon, soonest first', () => {
    const raw = [
      { id: 2, due_at: utc(T0 + 3_600_000), contact: { name: 'B' } },
      { id: 1, due_at: utc(T0 + 60_000), contact: { name: 'A' } },
      { id: 3, due_at: utc(T0 + HORIZON_MS + 60_000), contact: { name: 'Later' } },
      { id: 4, due_at: utc(T0 - 3_600_000), contact: { name: 'Long past' } },
      { id: 'x', due_at: utc(T0) },
      { id: 5 },
      null,
    ];
    expect(dueCallbacks(raw, T0, HORIZON_MS).map((c) => c.id)).toEqual([1, 2]);
    expect(dueCallbacks({ data: raw }, T0, HORIZON_MS).map((c) => c.id)).toEqual([1, 2]);
    expect(dueCallbacks('nonsense', T0, HORIZON_MS)).toEqual([]);
  });

  it('reads stamps without a zone as UTC', () => {
    expect(stampMs('2026-10-06 08:00:00')).toBe(T0);
    expect(stampMs('2026-10-06T08:00:00Z')).toBe(T0);
    expect(stampMs('not a date')).toBeNull();
  });

  it('counts today’s and words the reminder as the design does', () => {
    expect(callbacksToday([{ due_at: utc(T0 + 60_000) }, { due_at: utc(T0 + 3 * 86_400_000) }], T0)).toBe(1);
    const [c] = dueCallbacks([{ id: 7, due_at: utc(T0), note: 'Call after 2 pm', contact: { name: 'Iresha Dias', organisation: 'Dias Printers' } }], T0, HORIZON_MS);
    expect(callbackNotice(c!)).toEqual({ title: 'Callback due · Iresha Dias', body: 'Dias Printers · “Call after 2 pm”' });
    expect(sendingLabel({ count: 1, progress: 62.4 })).toBe('1 · 62%');
    expect(sendingLabel({ count: 2, progress: null })).toBe('2');
  });
});

describe('the reminders', () => {
  it('rings at the minute a callback is due; Call now claims that callback, a click on the banner only opens the queue', async () => {
    const h = service();
    h.s.start();
    await settle();
    expect(h.notify).not.toHaveBeenCalled();
    h.clock.advance(30 * 60_000 - 1);
    expect(h.notify).not.toHaveBeenCalled();
    h.clock.advance(1);
    expect(h.notify).toHaveBeenCalledTimes(1);
    const n = h.notify.mock.calls[0]![0];
    expect(n).toMatchObject({ module: 'marketing', title: 'Callback due · Iresha Dias', link: '/marketing/queue' });
    expect(n.buttons?.labels).toEqual(['Call now', 'Snooze 15 min']);
    n.buttons!.onAction(0);
    expect(h.openRoute).toHaveBeenCalledWith('/marketing/queue?next=1&item=103');
    expect(callbackRoute({ queueItemId: null })).toBe(NEXT_CONTACT_ROUTE);
  });

  it('a snooze brings the same reminder back fifteen minutes later, once', async () => {
    const h = service();
    h.s.start();
    await settle();
    h.clock.advance(30 * 60_000);
    const first = h.notify.mock.calls[0]![0];
    first.buttons!.onAction(1);
    h.clock.advance(15 * 60_000 - 1);
    expect(h.notify).toHaveBeenCalledTimes(1);
    h.clock.advance(1);
    expect(h.notify).toHaveBeenCalledTimes(2);
    expect(h.notify.mock.calls[1]![0].id).not.toBe(first.id);
    expect(h.notify.mock.calls[1]![0].title).toBe('Callback due · Iresha Dias');
  });

  it('a snoozed reminder does not come back once its callback is done', async () => {
    const h = service();
    h.s.start();
    await settle();
    h.clock.advance(30 * 60_000);
    h.notify.mock.calls[0]![0].buttons!.onAction(1);
    // Called back in the meantime: the server no longer lists it.
    h.get.mockImplementation(async (path: string) => (path === '/api/marketing/queue/callbacks' ? [] : null) as never);
    await h.s.refresh();
    h.clock.advance(60 * 60_000);
    expect(h.notify).toHaveBeenCalledTimes(1);
  });

  it('keeps nothing from a look that was still waiting when its person signed out', async () => {
    let answer: (v: unknown) => void = () => undefined;
    const h = service();
    h.get.mockImplementation((path: string) => (path === '/api/marketing/queue/callbacks' ? new Promise((r) => (answer = r)) : Promise.resolve(null)) as never);
    h.s.start();
    await settle();
    // Signed out, and somebody else signs in, while the first look waits on a slow server.
    h.s.reset();
    h.get.mockImplementation(async () => [] as never);
    h.s.start();
    answer([{ id: 9, queue_item_id: 1, due_at: utc(T0 + 60_000), note: 'theirs', contact: { name: 'Previous person’s contact' } }]);
    await settle();
    await settle();
    h.clock.advance(3_600_000);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it('a later look does not ring a reminder again, and drops one whose callback went away', async () => {
    const h = service();
    h.s.start();
    await settle();
    h.clock.advance(30 * 60_000);
    expect(h.notify).toHaveBeenCalledTimes(1);
    await h.s.refresh();
    expect(h.clock.pending()).toBe(1);
    h.get.mockImplementation(async (path: string) => (path === '/api/marketing/queue/callbacks' ? [] : null) as never);
    await h.s.refresh();
    expect(h.clock.pending()).toBe(0);
    h.clock.advance(3 * 3_600_000);
    expect(h.notify).toHaveBeenCalledTimes(1);
  });

  it('looks again on its own every few minutes', async () => {
    const h = service();
    h.s.start();
    await settle();
    const asked = h.get.mock.calls.length;
    h.clock.advance(POLL_MS);
    await settle();
    expect(h.get.mock.calls.length).toBeGreaterThan(asked);
  });

  it('stays quiet on a server without the endpoint, and does not ask it again', async () => {
    const missing = Object.assign(new Error('Not found'), { status: 404 });
    const h = service({ answers: { '/api/marketing/queue/callbacks': missing } });
    h.s.start();
    await settle();
    await h.s.refresh();
    expect(h.get.mock.calls.filter((c) => c[0] === '/api/marketing/queue/callbacks')).toHaveLength(1);
    expect(h.notify).not.toHaveBeenCalled();
    expect(h.onTray).toHaveBeenLastCalledWith(expect.objectContaining({ callbacksToday: 0, queue: 38 }));
  });

  it('times nothing and shows nothing for someone without Marketing, and forgets everything on reset', async () => {
    const none = service({ allowed: false });
    none.s.start();
    await settle();
    expect(none.get).not.toHaveBeenCalled();
    expect(none.onTray).toHaveBeenLastCalledWith(null);

    const h = service();
    h.s.start();
    await settle();
    expect(h.clock.pending()).toBe(2);
    h.s.reset();
    expect(h.clock.pending()).toBe(0);
    expect(h.onTray).toHaveBeenLastCalledWith(null);
    h.clock.advance(3 * 3_600_000);
    expect(h.notify).not.toHaveBeenCalled();
  });
});

describe('the tray and the next-contact shortcut', () => {
  it('publishes the queue, today’s callbacks and what is sending', async () => {
    const h = service();
    h.s.start();
    await settle();
    expect(h.onTray).toHaveBeenLastCalledWith({ queue: 38, callbacksToday: 2, sending: { count: 1, progress: 62 }, shortcut: null });
  });

  it('has no queue line for someone who may not work a call queue, and never holds the shortcut for them', async () => {
    const h = service({ canCall: false });
    h.s.start();
    await settle();
    expect(h.get.mock.calls.map((c) => c[0])).not.toContain('/api/marketing/queue');
    expect(h.onTray).toHaveBeenLastCalledWith(expect.objectContaining({ queue: null }));
    expect(h.s.configure({ shortcut: true })).toEqual({ shortcut: false });
    expect(h.keys.register).not.toHaveBeenCalled();
  });

  it('holds the shortcut while asked, opens the queue with it, and lets it go', async () => {
    const h = service();
    h.s.start();
    await settle();
    expect(h.s.configure({ shortcut: true })).toEqual({ shortcut: true });
    expect(h.keys.register).toHaveBeenCalledWith(NEXT_CONTACT_SHORTCUT, expect.any(Function));
    expect(h.onTray).toHaveBeenLastCalledWith(expect.objectContaining({ shortcut: NEXT_CONTACT_SHORTCUT }));
    h.keys.register.mock.calls[0]![1]();
    expect(h.openRoute).toHaveBeenCalledWith(NEXT_CONTACT_ROUTE);
    h.s.configure({ shortcut: false });
    expect(h.keys.unregister).toHaveBeenCalledWith(NEXT_CONTACT_SHORTCUT);
    h.s.configure({ shortcut: true });
    h.s.reset();
    expect(h.keys.unregister).toHaveBeenCalledTimes(2);
  });

  it('the tray menu says the design’s lines, only with Marketing', () => {
    const openRoute = vi.fn();
    const nextContact = vi.fn();
    const mk = { queue: 38, callbacksToday: 9, sending: { count: 1, progress: 62 }, shortcut: NEXT_CONTACT_SHORTCUT };
    const items = trayMarketingItems({ signedIn: true, apps: ['marketing'], marketing: mk }, { openRoute, nextContact });
    expect(items.map((i) => i.label ?? i.type)).toEqual(['Call queue waiting: 38', 'Callbacks today: 9', 'Sending now: 1 · 62%', 'Next contact', 'separator']);
    expect(items[3]).toMatchObject({ accelerator: NEXT_CONTACT_SHORTCUT, registerAccelerator: false });
    items[0]!.click!(undefined as never, undefined as never, undefined as never);
    expect(openRoute).toHaveBeenCalledWith('/marketing/queue');
    expect(trayMarketingItems({ signedIn: true, apps: ['mail'], marketing: mk }, { openRoute, nextContact })).toEqual([]);
    expect(trayMarketingItems({ signedIn: true, apps: ['marketing'], marketing: { ...mk, queue: null, callbacksToday: 0, sending: { count: 0, progress: null } } }, { openRoute, nextContact })).toEqual([]);
  });
});

describe('the contract', () => {
  it('lists the channels with their schemas', () => {
    expect(INVOKE_CHANNELS).toContain('marketing:configure');
    expect(INVOKE_CHANNELS).toContain('marketing:refresh');
    expect(contract['marketing:configure'].input.safeParse({ shortcut: true }).success).toBe(true);
    expect(contract['marketing:configure'].input.safeParse({ shortcut: true, route: '/x' }).success).toBe(false);
  });
});
