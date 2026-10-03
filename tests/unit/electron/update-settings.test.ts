import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false, getVersion: () => '0.2.126', getLocale: () => 'en', isHardwareAccelerationEnabled: () => true },
  nativeImage: { createFromPath: () => ({}) },
  Notification: class {
    static isSupported = () => true;
    on() {
      return this;
    }
    show() {}
    close() {}
  },
}));

import { SettingsService } from '../../../electron/services/settings';
import { DEFAULT_POLICY, normalizePolicy } from '../../../electron/services/policy';
import { NotificationService } from '../../../electron/services/notifications';
import { DiagnosticsService, type DiagnosticsDeps } from '../../../electron/services/diagnostics';
import type { Database } from '../../../electron/services/db';
import type { HttpClient } from '../../../electron/services/http';
import type { Vault } from '../../../electron/services/vault';
import type { Preferences } from '../../../shared/types';
import { preferencesPatchSchema } from '../../../shared/ipc/contract';

function database() {
  const values = new Map<string, unknown>();
  return {
    getConfig: (key: string) => values.get(key),
    setConfig: (key: string, value: unknown) => values.set(key, structuredClone(value)),
    tx: (f: () => void) => f(),
    run: () => undefined,
    all: () => [],
  } as unknown as Database;
}

describe('Settings › About › Updates switches (worksuite-desktop#205)', () => {
  it('are on by default and saved per device', () => {
    const db = database();
    const s = new SettingsService(db);
    expect(s.effective().updates).toEqual({ autoDownload: true, installOnQuit: true, notifyReady: true });
    s.update({ updates: { autoDownload: false } as Preferences['updates'] });
    expect(s.effective().updates).toEqual({ autoDownload: false, installOnQuit: true, notifyReady: true });
    s.update({ updates: { notifyReady: false } as Preferences['updates'] });
    expect(new SettingsService(db).effective().updates).toEqual({ autoDownload: false, installOnQuit: true, notifyReady: false });
  });

  it('are accepted one at a time over IPC', () => {
    expect(preferencesPatchSchema.safeParse({ updates: { installOnQuit: false } }).success).toBe(true);
    expect(preferencesPatchSchema.safeParse({ updates: { installOnQuit: 'no' } }).success).toBe(false);
  });

  it('downloads always when the organisation enforces updates, and keeps its channel', () => {
    const s = new SettingsService(database());
    s.update({ updates: { autoDownload: false, installOnQuit: false, notifyReady: true }, updateChannel: 'dev' });
    s.setPolicy({ ...DEFAULT_POLICY, auto_update: 'enforced', update_channel: 'beta' });
    expect(s.effective()).toMatchObject({ updateChannel: 'beta', updates: { autoDownload: true, installOnQuit: false } });
    expect(s.locks().map((l) => l.key)).toContain('updateChannel');
    expect(s.raw().updates.autoDownload).toBe(false);
  });

  it('falls back to the most stable allowed channel when the policy no longer allows the saved one, keeping the choice', () => {
    const s = new SettingsService(database());
    s.update({ updateChannel: 'dev', updateChannelChosen: true });
    s.setPolicy({ ...DEFAULT_POLICY, auto_update: 'user_choice', allowed_update_channels: ['stable', 'beta'] });
    expect(s.effective().updateChannel).toBe('stable');
    expect(s.raw().updateChannel).toBe('dev');
    s.setPolicy({ ...DEFAULT_POLICY, auto_update: 'user_choice', allowed_update_channels: ['stable', 'dev'] });
    expect(s.effective().updateChannel).toBe('dev');
    expect(s.locks().map((l) => l.key)).not.toContain('updateChannel');
  });

  it("follows the organisation's default channel until the person picks one", () => {
    const s = new SettingsService(database());
    s.setPolicy({ ...DEFAULT_POLICY, auto_update: 'user_choice', allowed_update_channels: ['stable', 'beta'], update_channel_default: 'beta' });
    expect(s.effective().updateChannel).toBe('beta');
    s.update({ updateChannel: 'stable', updateChannelChosen: true });
    expect(s.effective().updateChannel).toBe('stable');
  });
});

describe('the policy key allowed_update_channels', () => {
  it('keeps known channels in order, and never none', () => {
    expect(normalizePolicy({ allowed_update_channels: ['dev', 'stable'] }, true).allowed_update_channels).toEqual(['stable', 'dev']);
    expect(normalizePolicy({ allowed_update_channels: ['beta'] }, true).allowed_update_channels).toEqual(['stable', 'beta']);
    expect(normalizePolicy({ allowed_update_channels: ['stable', 'beta'], update_channel_default: 'beta' }, true).update_channel_default).toBe('beta');
    expect(normalizePolicy({ allowed_update_channels: ['stable'], update_channel_default: 'dev' }, true).update_channel_default).toBe('stable');
    expect(normalizePolicy({ allowed_update_channels: ['nightly'] }, true).allowed_update_channels).toEqual(['stable', 'beta', 'dev']);
    expect(normalizePolicy({ allowed_update_channels: [] }, true).allowed_update_channels).toEqual(['stable', 'beta', 'dev']);
    expect(normalizePolicy({}, false).allowed_update_channels).toEqual(['stable', 'beta', 'dev']);
  });
});

describe('the bell entry for an update', () => {
  function service() {
    const db = database();
    const vault = { encrypt: (x: unknown) => JSON.stringify(x), decrypt: () => null } as unknown as Vault;
    const http = { get: vi.fn(async (path: string) => (path === '/api/notifications' ? { items: [{ id: 9, title: 'Server news', category: 'files', created_at: '2026-10-03 10:00:00', read_at: null }], unread: 1 } : {})), post: vi.fn(async () => ({})) } as unknown as HttpClient;
    const prefs = { notificationsEnabled: true, backgroundServices: { notifications: true }, moduleNotifications: {}, notificationPrivacy: 'FULL' } as unknown as Preferences;
    return { s: new NotificationService(db, () => vault, http, () => prefs), http };
  }

  it('is added once per version, listed first, counted and read locally', async () => {
    const { s, http } = service();
    expect(s.addLocal({ id: 'update:0.2.127', title: 'WorkSuite 0.2.127 is ready', body: 'WorkSuite 0.2.127 is ready. Restart to update.', link: '/settings/about' })).toBe(true);
    expect(s.addLocal({ id: 'update:0.2.127', title: 'again', body: 'again', link: null })).toBe(false);
    expect(s.counts().notifications).toBe(1);
    (s as unknown as { userId: string }).userId = '5';
    const list = await s.refreshList();
    expect(list.items.map((i) => i.id)).toEqual(['local:update:0.2.127', '9']);
    expect(list.items[0]).toMatchObject({ module: 'system', title: 'WorkSuite 0.2.127 is ready', link: '/settings/about', read: false });
    expect(list.unread).toBe(2);
    await s.markRead(['local:update:0.2.127']);
    expect((http.post as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).not.toContain('/api/notifications/local%3Aupdate%3A0.2.127/read');
    expect(s.cached()[0]).toMatchObject({ id: 'local:update:0.2.127', read: true });
  });
});

describe('Diagnostics', () => {
  it('include the update log in the report and the last event in the check', async () => {
    const history = [
      { t: '2026-10-03T10:00:00.000Z', event: 'check', channel: 'beta' },
      { t: '2026-10-03T10:00:05.000Z', event: 'download-done', version: '0.2.127-beta.1', detail: 'sha256 verified' },
    ];
    const deps: DiagnosticsDeps = {
      serverOrigin: () => null,
      timedFetch: async () => ({ ok: true, status: 200, ms: 1 }),
      signedIn: () => false,
      realtimeState: () => 'idle',
      updaterState: () => ({ state: 'STAGED', error: null, lastCheckedAt: '2026-10-03T10:00:00.000Z', channel: 'beta' }),
      updateHistory: () => history,
      services: () => ({}),
      dbCheck: () => 'ok',
      secureStorage: () => ({ available: true, backend: 'keychain', persistent: true }),
      policy: () => null,
      deviceInfo: () => ({}),
      settings: () => ({}),
      offline: () => null,
      crashes: () => ({}),
      safeMode: () => false,
      userDataPath: '/tmp',
    };
    const d = new DiagnosticsService(deps);
    const check = (await d.run()).find((c) => c.id === 'updater');
    expect(check?.detail).toContain('last event: download-done 0.2.127-beta.1 at 2026-10-03T10:00:05.000Z');
    const preview = await d.preview();
    const file = preview.files.find((f) => f.name === 'updates.json');
    expect(file).toBeTruthy();
    expect(JSON.parse(file!.preview)).toMatchObject({ state: { state: 'STAGED', channel: 'beta' }, history: [{ event: 'check' }, { event: 'download-done', version: '0.2.127-beta.1' }] });
  });
});
