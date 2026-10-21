import { beforeEach, describe, expect, it, vi } from 'vitest';
const notes = vi.hoisted(() => [] as Array<{ options: Record<string, unknown>; events: Record<string, (...args: unknown[]) => void> }>);
const clip = vi.hoisted(() => ({ writeText: vi.fn() }));
vi.mock('electron', () => ({
  app: { isPackaged: false },
  nativeImage: { createFromPath: () => ({}) },
  clipboard: clip,
  Notification: class {
    static isSupported = () => true;
    entry: (typeof notes)[number];
    constructor(options: Record<string, unknown>) {
      this.entry = { options, events: {} };
      notes.push(this.entry);
    }
    on(name: string, fn: (...args: unknown[]) => void) {
      this.entry.events[name] = fn;
      return this;
    }
    show() {}
    close() {}
  },
}));
import { mapServerNotification, NotificationService } from '../../../electron/services/notifications';
import type { Preferences } from '../../../shared/types';
import type { HttpClient } from '../../../electron/services/http';
import type { Database } from '../../../electron/services/db';
import type { Vault } from '../../../electron/services/vault';

/** AMC's new-request banner (WS-AMC-SRS-001 T-02, NOT-02): Open and Give to, which only open screens. */
function service() {
  const prefs = { notificationsEnabled: true, backgroundServices: { notifications: true }, moduleNotifications: {}, notificationPrivacy: 'FULL', notificationSounds: false, dndEnabled: false, language: 'en' } as unknown as Preferences;
  const http = { get: vi.fn(async () => ({ items: [], unread: 0 })), post: vi.fn(async () => ({})), request: vi.fn(async () => ({})) };
  const db = { all: () => [], run: () => undefined, tx: (fn: () => void) => fn() } as unknown as Database;
  const s = new NotificationService(db, () => ({ encrypt: (v: unknown) => JSON.stringify(v), decrypt: () => null }) as unknown as Vault, http as unknown as HttpClient, () => prefs);
  s.onClick = vi.fn();
  return { s, http };
}

beforeEach(() => {
  notes.length = 0;
});

describe('AMC request banner', () => {
  it('puts Open and Give to on a logged request, and each opens its screen', () => {
    const { s, http } = service();
    s.handleRealtime({ type: 'notification', id: 91, event: 'amc.request.logged', category: 'amc', title: 'New request SR-12', body: 'Chiller noise', link: '/amc?view=requests&request=12', data: { request_id: 12 } });
    expect(notes[0]!.options.actions).toEqual([{ type: 'button', text: 'Open' }, { type: 'button', text: 'Give to' }]);
    notes[0]!.events.action!({}, 1);
    expect(s.onClick).toHaveBeenCalledWith('/amc?view=dispatch&give=12', 'amc');
    notes[0]!.events.action!({}, 0);
    expect(s.onClick).toHaveBeenCalledWith('/amc?view=requests&request=12', 'amc');
    notes[0]!.events.click!();
    expect(s.onClick).toHaveBeenLastCalledWith('/amc?view=requests&request=12', 'amc');
    expect(http.post).not.toHaveBeenCalledWith(expect.stringContaining('/api/amc'), expect.anything());
  });

  it('links a listed request to the desktop screen and files it under AMC', () => {
    const n = mapServerNotification({ id: 5, category: 'amc', event_key: 'amc.request.logged', data: { request_id: 7 }, link: '/amc' });
    expect(n.link).toBe('/amc?view=requests&request=7');
    expect(n.module).toBe('amc');
  });
});
