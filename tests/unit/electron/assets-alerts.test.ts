import { describe, expect, it, vi } from 'vitest';
import { AssetAlerts } from '../../../electron/services/assets-alerts';

describe('asset alerts and the tray line (D03)', () => {
  const mine = { assets: [{ id: 1, name: 'iPhone 15', asset_code: 'AST-0179', assignment_id: 7, acknowledge_required: true, acknowledged_at: null }] };

  it('shows each alert once and keeps the tray count', async () => {
    const seen = new Set<string>();
    const sink = { addLocal: vi.fn((i: { id: string }) => (seen.has(i.id) ? false : (seen.add(i.id), true))), notify: vi.fn() };
    const tray = vi.fn();
    const get = vi.fn(async (p: string) => (p.endsWith('/mine') ? mine : Promise.reject(new Error('403'))));
    const a = new AssetAlerts({ get } as never, sink, tray, () => '2026-10-25');
    expect(await a.tick()).toBe(1);
    expect(await a.tick()).toBe(0);
    expect(sink.notify).toHaveBeenCalledWith(expect.objectContaining({ module: 'assets', link: '/assets?tab=mine&confirm=7' }));
    expect(tray).toHaveBeenLastCalledWith({ waiting: 1 });
  });

  it('stays quiet, with no tray line, for somebody without Assets', async () => {
    const sink = { addLocal: vi.fn(() => true), notify: vi.fn() };
    const tray = vi.fn();
    const a = new AssetAlerts({ get: vi.fn(async () => Promise.reject(new Error('403'))) } as never, sink, tray);
    expect(await a.tick()).toBe(0);
    expect(tray).toHaveBeenLastCalledWith(null);
    expect(sink.notify).not.toHaveBeenCalled();
  });
});
