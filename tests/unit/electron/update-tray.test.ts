import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { isPackaged: false }, Menu: {}, Tray: class {}, nativeImage: {} }));

import { trayUpdateItems } from '../../../electron/tray/tray';
import { HttpClient } from '../../../electron/services/http';

/** The tray's update lines, and the server refusing this version (UPDATE_REQUIRED). */

describe('the tray menu', () => {
  const updateNow = vi.fn();

  it('offers "Update available: X · Update Now"', () => {
    const items = trayUpdateItems({ kind: 'available', version: '2.7.0', deadline: null }, { updateNow });
    expect(items.map((i) => i.label ?? i.type)).toEqual(['Update available: 2.7.0', 'Update Now', 'separator']);
    expect(items[0]!.enabled).toBe(false);
    (items[1]!.click as () => void)();
    expect(updateNow).toHaveBeenCalled();
  });

  it('says a required update must be installed by a time, with the time left', () => {
    const now = new Date(2026, 8, 27, 15, 45, 23);
    const deadline = new Date(2026, 8, 27, 18, 0, 0).toISOString();
    const items = trayUpdateItems({ kind: 'required', version: '2.7.0', deadline }, { updateNow }, now);
    expect(items.map((i) => i.label ?? i.type)).toEqual(['⚠ Update Required', 'Install by 18:00 · 02:14:37', 'Update & Restart', 'separator']);
  });

  it('has nothing to say without an update', () => {
    expect(trayUpdateItems(null, { updateNow })).toEqual([]);
  });
});

describe('a server that no longer accepts this version', () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const tokens = { accessToken: () => 'x', refresh: async () => 'ok' as const };

  it('says so whatever the status, so modules lock (UPDATE_REQUIRED)', async () => {
    const directive = vi.fn();
    const http = new HttpClient({
      fetch: async () => json(409, { status: 'error', message: 'Update WorkSuite Desktop to continue.', code: 'UPDATE_REQUIRED' }),
      origin: () => 'https://ws.example',
      tokens,
      clientHeaders: () => ({}),
      onReachability: () => undefined,
      onAuthLost: () => undefined,
      onDeviceDirective: directive,
    });
    await expect(http.get('/api/mail/messages')).rejects.toMatchObject({ code: 'UPDATE_REQUIRED' });
    expect(directive).toHaveBeenCalledWith('UPDATE_REQUIRED', 'Update WorkSuite Desktop to continue.');
  });
});
