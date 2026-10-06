import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({
  app: { isPackaged: false, setBadgeCount: () => undefined },
  Menu: { buildFromTemplate: (t: unknown) => t },
  Tray: class {},
  nativeImage: { createFromPath: () => ({}) },
}));
import { SupportDesk, latestTicket, pulseFrom, type SupportPulseFigures } from '../../../electron/services/support-desk';
import { supportItems, trayMenu, type TrayModel } from '../../../electron/tray/tray';
import { DesktopError } from '../../../electron/main/errors';
import { slaShort, supportNoticePrefs } from '../../../shared/support';
import type { HttpClient } from '../../../electron/services/http';

/**
 * The tray / menu-bar mini dashboard, D-05 (desktop T23, FR-DSK-04, FR-WSP-02, FR-SLA-07): my open, due today and at
 * risk (`GET dashboard/mine`, or the badges on a server without it), unassigned and overdue, the four soonest SLAs
 * opening their quick-reply windows, Quick reply to latest, Online / Away, and the red dot for a breach.
 */
const NOW = Date.parse('2026-10-04T09:43:00Z');
const t = (id: number, over: Record<string, unknown> = {}) =>
  ({ id, reference: `CFX-00${id}`, subject: `Subject ${id}`, requester: { name: `Requester ${id}`, email: null }, unread: 0, sla: { state: 'ok', target: 'next_response', due_at: new Date(NOW + 18 * 60_000).toISOString(), policy_id: 1, paused_ms: 0 }, ...over }) as never;
const BADGES = { assigned_open: 12, unassigned: 7, overdue: 3, at_risk: 2, unread: 4 };

afterEach(() => vi.useRealTimers());

describe('the figures', () => {
  it('says an SLA in a few words', () => {
    expect(slaShort({ state: 'ok', target: 'next_response', due_at: new Date(NOW + 18 * 60_000).toISOString() }, NOW)).toBe('Next 18m');
    expect(slaShort({ state: 'breached', target: 'resolution', due_at: new Date(NOW - 65 * 60_000).toISOString() }, NOW)).toBe('Res overdue 1h 5m');
    expect(slaShort({ state: 'paused', target: 'resolution', due_at: null }, NOW)).toBe('Paused');
    expect(slaShort({ state: 'none', target: null, due_at: null }, NOW)).toBeNull();
  });

  it('takes my numbers from the dashboard, the queues from the badges, and the four soonest SLAs', () => {
    const f = pulseFrom({ open: 12, due_today: 3, at_risk: 2 }, BADGES, [t(1284), t(1276, { sla: { state: 'breached', target: 'resolution', due_at: new Date(NOW - 60_000).toISOString() } }), t(1292), t(1281), t(1300)], 'available', NOW);
    expect(f).toMatchObject({ open: 12, dueToday: 3, atRisk: 2, unassigned: 7, overdue: 3, unread: 4, breached: true, presence: 'available' });
    expect(f.next.map((n) => n.reference)).toEqual(['CFX-001284', 'CFX-001276', 'CFX-001292', 'CFX-001281']);
    expect(f.next[0]).toMatchObject({ id: 1284, requester: 'Requester 1284', sla: 'Next 18m', breached: false });
  });

  it('falls back to the badges where the server has no dashboard yet, and shows no "due today" then', () => {
    const f = pulseFrom(null, BADGES, [], null, NOW);
    expect(f).toMatchObject({ open: 12, dueToday: null, atRisk: 2, breached: false, presence: null });
    expect(pulseFrom(null, null, [], null, NOW)).toMatchObject({ open: 0, unassigned: null, overdue: null });
  });

  it('picks the latest ticket for a quick reply: unread first, then the next SLA, then the newest', () => {
    expect(latestTicket([t(1), t(2, { unread: 1 })], [])).toBe(2);
    expect(latestTicket([t(1)], [{ id: 9 } as never])).toBe(9);
    expect(latestTicket([t(1)], [])).toBe(1);
    expect(latestTicket([], [])).toBeNull();
  });

  it('keeps the quick-reply shortcut on unless turned off', () => {
    expect(supportNoticePrefs(undefined).quickShortcut).toBe(true);
    expect(supportNoticePrefs({ quickShortcut: false }).quickShortcut).toBe(false);
  });
});

function desk(over: { dashboard?: unknown } = {}) {
  const get = vi.fn(async (path: string, opts?: { query?: Record<string, unknown> }) => {
    if (path === '/api/support/v1/dashboard/mine') {
      if (over.dashboard instanceof Error) throw over.dashboard;
      return over.dashboard ?? { open: 12, due_today: 3, at_risk: 2 };
    }
    if (path === '/api/support/v1/tickets') return opts?.query?.sort === 'sla' ? { items: [t(1284)] } : { items: [t(1290), t(1291, { unread: 2 })] };
    if (path === '/api/chat/presence/me') return { status: 'online', choice: 'away' };
    return {};
  });
  const post = vi.fn(async () => ({}));
  const changed = vi.fn();
  const d = new SupportDesk({ http: { get, post } as unknown as HttpClient, enabled: () => true, badges: () => BADGES, onChanged: changed });
  return { d, get, post, changed };
}

describe('the service', () => {
  it('reads the dashboard, my next SLAs and my presence, and tells the tray', async () => {
    const { d, get, changed } = desk();
    d.start();
    await vi.waitFor(() => expect(d.get()).not.toBeNull());
    expect(d.get()).toMatchObject({ open: 12, dueToday: 3, presence: 'away', next: [{ id: 1284 }] });
    expect(get).toHaveBeenCalledWith('/api/support/v1/tickets', expect.objectContaining({ query: { view: 'mine', sort: 'sla', limit: 4 } }));
    expect(changed).toHaveBeenCalled();
    expect(await d.latest()).toBe(1291);
    d.stop();
    expect(d.get()).toBeNull();
  });

  it('a server without dashboard/mine: the badges stand in, and it is not asked again at once', async () => {
    const { d, get } = desk({ dashboard: new DesktopError('NOT_FOUND' as never, 'Not found', 404) });
    d.start();
    await vi.waitFor(() => expect(d.get()).not.toBeNull());
    expect(d.get()).toMatchObject({ open: 12, dueToday: null });
    await d.refresh();
    expect(get.mock.calls.filter((c) => c[0] === '/api/support/v1/dashboard/mine')).toHaveLength(1);
    d.stop();
  });

  it('reads again once after a burst of desk hints, and not for presence', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { d, get } = desk();
    d.start();
    await vi.waitFor(() => expect(d.get()).not.toBeNull());
    const before = get.mock.calls.length;
    d.handle({ type: 'support.presence', ticket_id: 1, present: [] } as never);
    for (let i = 0; i < 5; i++) d.handle({ type: 'support.changed', organization_id: 10, kind: 'created' } as never);
    await vi.advanceTimersByTimeAsync(3_000);
    await vi.waitFor(() => expect(get.mock.calls.length).toBe(before + 3));
    d.stop();
  });

  it('sets Online or Away as Chat’s presence', async () => {
    const { d, post } = desk();
    d.start();
    await vi.waitFor(() => expect(d.get()).not.toBeNull());
    await d.setPresence('available');
    expect(post).toHaveBeenCalledWith('/api/chat/presence', { status: 'available', active: true });
    expect(d.get()?.presence).toBe('available');
    d.stop();
  });
});

describe('the tray section', () => {
  const figures: SupportPulseFigures = pulseFrom({ open: 12, due_today: 3, at_risk: 2 }, BADGES, [t(1284), t(1276)], 'available', NOW);
  const actions = { openRoute: vi.fn(), supportQuickReply: vi.fn(), supportQuickLatest: vi.fn(), supportPresence: vi.fn() };
  const label = (items: ReturnType<typeof supportItems>, starts: string) => items.find((i) => typeof i.label === 'string' && i.label.startsWith(starts))!;

  it('lists my numbers, each opening its view', () => {
    const items = supportItems(figures, actions);
    expect(label(items, 'My open').label).toBe('My open 12 · 4 unread · 3 due today');
    label(items, 'Unassigned').click!({} as never, undefined, {} as never);
    expect(actions.openRoute).toHaveBeenCalledWith('/support?view=unassigned');
    label(items, 'Overdue 3').click!({} as never, undefined, {} as never);
    expect(actions.openRoute).toHaveBeenCalledWith('/support?view=overdue');
    expect(label(items, 'At risk').label).toBe('At risk 2');
  });

  it('opens a next-SLA ticket in its quick-reply window, and the latest with ⌃⌥R', () => {
    const items = supportItems(figures, actions, 'Control+Alt+R');
    const row = label(items, 'CFX-001284');
    expect(row.label).toBe('CFX-001284 · Subject 1284 — Next 18m');
    expect(row.sublabel).toBe('Requester 1284');
    row.click!({} as never, undefined, {} as never);
    expect(actions.supportQuickReply).toHaveBeenCalledWith(1284);
    const latest = label(items, 'Quick reply to latest');
    expect(latest).toMatchObject({ accelerator: 'Control+Alt+R', registerAccelerator: false });
    latest.click!({} as never, undefined, {} as never);
    expect(actions.supportQuickLatest).toHaveBeenCalled();
  });

  it('switches Online / Away', () => {
    const items = supportItems(figures, actions);
    expect(label(items, 'Online')).toMatchObject({ type: 'radio', checked: true });
    label(items, 'Away').click!({} as never, undefined, {} as never);
    expect(actions.supportPresence).toHaveBeenCalledWith('away');
  });

  it('is in the tray menu only for somebody with Support', () => {
    const base = { signedIn: true, userName: 'Ayesha', organization: 'CreativeFX', offline: false, pending: 0, error: null, unreadChat: 0, unreadMail: 0, unreadOther: 0, badge: true, notificationsPausedUntil: null, attendance: null, updateReady: false, remoteControl: null, webchatRinging: [], quickAsk: null, aiChanges: 0, support: figures, apps: [] } as TrayModel;
    const all = { open: vi.fn(), openRoute: vi.fn(), clockIn: vi.fn(), clockOut: vi.fn(), pauseNotifications: vi.fn(), openSettings: vi.fn(), checkUpdates: vi.fn(), quit: vi.fn(), lock: vi.fn(), pauseRemoteControl: vi.fn(), stopRemoteControl: vi.fn(), joinWebchat: vi.fn(), quickAsk: vi.fn(), aiChanges: vi.fn(), ringingSettings: vi.fn() };
    const has = (apps: string[]) => trayMenu({ ...base, apps }, all).some((i) => typeof i.label === 'string' && i.label.startsWith('My open'));
    expect(has(['support'])).toBe(true);
    expect(has(['chat'])).toBe(false);
  });
});
