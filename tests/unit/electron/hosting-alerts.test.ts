import { describe, expect, it, vi } from 'vitest';
import { HostingAlerts } from '../../../electron/services/hosting-alerts';
import { hostingAlerts, hostingBadge, hostingCached, hostingNoticeLink } from '../../../shared/hosting';
import { hostingBadgeCount, trayHostingItems } from '../../../electron/tray/tray';

vi.mock('electron', () => ({ app: { isPackaged: false, setBadgeCount: vi.fn() }, nativeImage: { createFromPath: vi.fn() }, Menu: { buildFromTemplate: vi.fn() }, Tray: vi.fn() }));

describe('hosting alerts and the tray badge (HDM-DSK-04)', () => {
  const today = '2026-10-26';
  it('counts monitors down and what expires within 7 days, once per rung', () => {
    const r = hostingAlerts(
      {
        domains: [{ id: 1, name: 'creativefx.lk', expires_on: '2026-10-30', auto_renew: false }, { id: 2, name: 'mylearnplus.com', expires_on: '2026-12-06' }],
        certificates: [{ id: 3, host: 'shop.techhubiz.com', expires_on: '2026-10-27' }],
        monitors: [{ id: 9, name: 'shop.techhubiz.com', last_state: 'down', incident_id: 44, last_error: 'HTTP 502' }, { id: 10, last_state: 'up' }],
      },
      today,
    );
    expect(r.tray).toEqual({ down: 1, expiring: 2 });
    expect(r.alerts.map((a) => a.id)).toEqual(['hosting:domain:1:r7', 'hosting:certificate:3:r1', 'hosting:monitor:9:44']);
    expect(r.alerts[0]).toMatchObject({ title: 'creativefx.lk expires in 4 days', body: 'Domain · auto-renew off', link: '/hosting?domain=1' });
    expect(hostingBadge(r.tray)).toBe(3);
  });
  it('takes the overview’s monitors down (every company) over what this computer read', () => {
    expect(hostingAlerts({ overview: { monitors: { down: 2 } }, domains: [{ id: 1, name: 'a.lk', expires_on: '2026-10-28' }] }, today).tray).toEqual({ down: 2, expiring: 1 });
  });
  it('reads a monitor’s state as the server names it, once per outage a day', () => {
    const r = hostingAlerts({ monitors: [{ id: 3, name: 'db', state: 'down', last_error: 'timeout' }, { id: 4, state: 'up' }] }, today);
    expect(r.tray.down).toBe(1);
    expect(r.alerts[0]).toMatchObject({ id: 'hosting:monitor:3:2026-10-26', title: 'db is down', body: 'timeout' });
  });

  it('raises each alert once and keeps the tray up to date', async () => {
    const seen = new Set<string>();
    const sink = { addLocal: vi.fn((i: { id: string }) => (seen.has(i.id) ? false : (seen.add(i.id), true))), notify: vi.fn() };
    const tray = vi.fn();
    const get = vi.fn(async (p: string) => {
      if (p.startsWith('/api/hosting/domains')) return { domains: [{ id: 1, name: 'creativefx.lk', expires_on: '2026-10-30' }], summary: { total: 1 }, meta: { total: 1, page: 1, per_page: 200, pages: 1, sort: 'expires_on' } };
      if (p.startsWith('/api/hosting/monitors')) {
        expect(p).toContain('state=down');
        return { monitors: [{ id: 9, name: 'db', state: 'down' }], summary: { total: 1, down: 1 }, meta: { total: 1, page: 1, per_page: 200, pages: 1, sort: 'name' } };
      }
      throw Object.assign(new Error('nf'), { status: 404 });
    });
    const a = new HostingAlerts({ get } as never, sink, tray, () => today);
    expect(await a.tick()).toBe(2);
    expect(await a.tick()).toBe(0);
    expect(sink.notify).toHaveBeenCalledWith(expect.objectContaining({ module: 'hosting', link: '/hosting?tab=monitors' }));
    expect(tray).toHaveBeenLastCalledWith({ down: 1, expiring: 1 });
  });

  it('stays quiet, with no tray line, for somebody without Hosting', async () => {
    const sink = { addLocal: vi.fn(() => true), notify: vi.fn() };
    const tray = vi.fn();
    const a = new HostingAlerts({ get: vi.fn(async () => Promise.reject(new Error('403'))) } as never, sink, tray);
    expect(await a.tick()).toBe(0);
    expect(tray).toHaveBeenLastCalledWith(null);
    expect(sink.notify).not.toHaveBeenCalled();
  });

  it('puts the lines and the badge in the tray only for somebody who has Hosting', () => {
    const openRoute = vi.fn();
    const m = { signedIn: true, apps: ['hosting'], hosting: { down: 2, expiring: 1 } };
    const items = trayHostingItems(m, { openRoute });
    expect(items.map((i) => i.label)).toEqual(['2 monitors down', '1 expiring within 7 days', 'Open Hosting']);
    expect(hostingBadgeCount(m)).toBe(3);
    expect(hostingBadgeCount({ ...m, apps: ['mail'] })).toBe(0);
    expect(trayHostingItems({ ...m, apps: [] }, { openRoute })).toEqual([]);
  });
});

describe('hosting links and the offline cache', () => {
  it('opens each notice on its screen', () => {
    expect(hostingNoticeLink('hosting.domain_expiring', { domain_id: 4 })).toBe('/hosting?domain=4');
    expect(hostingNoticeLink('hosting.monitor_down')).toBe('/hosting?tab=monitors');
    expect(hostingNoticeLink('hosting.sync_failed')).toBe('/hosting?tab=accounts');
    expect(hostingNoticeLink('asset.handover')).toBeNull();
  });
  it('keeps the register, never a transfer code, a live lookup or metrics', () => {
    for (const p of ['/api/hosting/domains?page=2', '/api/hosting/domains/4', '/api/hosting/domains/4/dns', '/api/hosting/overview', '/api/hosting/sync-runs']) expect(hostingCached(p)).toBe(true);
    for (const p of ['/api/hosting/domains/4/auth-code', '/api/hosting/domains/4/lookup', '/api/hosting/servers/2/metrics', '/api/hosting/export/csv']) expect(hostingCached(p)).toBe(false);
  });
});
