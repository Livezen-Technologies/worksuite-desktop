import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const shown = vi.hoisted(() => [] as Array<{ title: string; body: string }>);
vi.mock('electron', () => ({
  app: { isPackaged: false },
  nativeImage: { createFromPath: () => ({}) },
  Notification: class {
    static isSupported = () => true;
    constructor(private readonly o: { title: string; body: string }) {}
    on() {
      return this;
    }
    show() {
      shown.push({ title: this.o.title, body: this.o.body });
    }
    close() {}
  },
}));

import { NotificationService } from '../../../electron/services/notifications';
import type { Database } from '../../../electron/services/db';
import type { HttpClient } from '../../../electron/services/http';
import type { Vault } from '../../../electron/services/vault';
import type { Preferences } from '../../../shared/types';

const stamp = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().replace('T', ' ').slice(0, 19);

function service(list: () => unknown[]) {
  const db = { tx: (f: () => void) => f(), run: () => undefined, all: () => [] } as unknown as Database;
  const vault = { encrypt: (x: unknown) => JSON.stringify(x), decrypt: () => null } as unknown as Vault;
  const http = { get: vi.fn(async (path: string) => (path === '/api/notifications' ? { items: list() } : {})), post: vi.fn() } as unknown as HttpClient;
  const prefs = { notificationsEnabled: true, backgroundServices: { notifications: true }, moduleNotifications: {}, notificationPrivacy: 'FULL', notificationSounds: false, dndEnabled: false } as unknown as Preferences;
  return new NotificationService(db, () => vault, http, () => prefs);
}

describe('a notification the realtime push missed (worksuite-desktop#16)', () => {
  beforeEach(() => {
    shown.length = 0;
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  });
  afterEach(() => vi.useRealTimers());

  it('pops up on the next poll, once; what was there at sign-in, read, or old does not', async () => {
    let items: unknown[] = [{ id: 1, title: 'Old news', category: 'files', created_at: stamp(60_000), read_at: null }];
    const s = service(() => items);
    s.start('5');
    await vi.waitFor(() => expect((s as unknown as { listed: boolean }).listed).toBe(true));
    expect(shown).toEqual([]);

    items = [
      { id: 4, title: 'Asha shared “Budget.xlsx” with you', body: 'You can view this file.', category: 'files', link: '/files?view=shared&file=9', created_at: stamp(30_000), read_at: null },
      { id: 3, title: 'Read already', category: 'files', created_at: stamp(30_000), read_at: stamp(10_000) },
      { id: 2, title: 'From yesterday', category: 'files', created_at: stamp(86_400_000), read_at: null },
      ...items,
    ];
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => expect(shown).toEqual([{ title: 'Asha shared “Budget.xlsx” with you', body: 'You can view this file.' }]));

    await vi.advanceTimersByTimeAsync(60_000);
    expect(shown).toHaveLength(1);
    s.stop();
  });

  it('is not shown twice when the push arrives as well', async () => {
    const items: unknown[] = [];
    const s = service(() => items);
    s.start('5');
    await vi.waitFor(() => expect((s as unknown as { listed: boolean }).listed).toBe(true));
    s.handleRealtime({ type: 'notification', id: 7, title: 'Shared with you', body: '', category: 'files', link: '/files?view=shared&file=9' });
    items.push({ id: 7, title: 'Shared with you', category: 'files', created_at: stamp(1_000), read_at: null });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(shown.map((n) => n.title)).toEqual(['Shared with you']);
    s.stop();
  });
});
