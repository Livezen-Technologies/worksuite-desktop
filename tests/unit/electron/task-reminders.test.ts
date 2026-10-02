import { beforeEach, describe, expect, it, vi } from 'vitest';
const notes = vi.hoisted(() => [] as Array<{ options: Record<string, unknown>; events: Record<string, (...args: unknown[]) => void> }>);
vi.mock('electron', () => ({
  app: { isPackaged: false },
  nativeImage: { createFromPath: () => ({}) },
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
import { NotificationService } from '../../../electron/services/notifications';
import { reminderAction } from '../../../shared/task-reminders';
import type { Preferences } from '../../../shared/types';
import type { HttpClient } from '../../../electron/services/http';
import type { Database } from '../../../electron/services/db';
import type { Vault } from '../../../electron/services/vault';
const actions = [
  { label: 'Snooze', reminder_run: 17 },
  { label: 'Mark Complete', task_id: 4 },
];
function setup() {
  const prefs = {
    notificationsEnabled: true,
    backgroundServices: { notifications: true },
    moduleNotifications: {},
    notificationPrivacy: 'FULL',
    notificationSounds: false,
    dndEnabled: false,
  } as unknown as Preferences;
  const http = { get: vi.fn(async (_path: string): Promise<Record<string, unknown>> => ({})), post: vi.fn(async () => ({})), request: vi.fn(async () => ({})) };
  const db = { all: () => [], run: () => undefined, tx: (fn: () => void) => fn() } as unknown as Database;
  const service = new NotificationService(
    db,
    () => ({ encrypt: (value: unknown) => JSON.stringify(value), decrypt: () => null }) as unknown as Vault,
    http as unknown as HttpClient,
    () => prefs,
  );
  return { service, http, prefs };
}
function notify(service: NotificationService) {
  service.handleRealtime({
    type: 'notification',
    id: 22,
    event: 'task.reminder',
    category: 'projects',
    title: 'Ship release',
    body: 'Due Oct 4, 2026 10:00 IST',
    link: '/tasks?task=4',
    actions,
  });
}
beforeEach(() => {
  notes.length = 0;
});
describe('task reminder native notifications', () => {
  it('validates action metadata from realtime and the polling response', () => {
    expect(reminderAction('/tasks?task=4', JSON.stringify(actions))).toEqual({ taskId: 4, runId: 17 });
    expect(reminderAction('/tasks?task=5', actions)).toBeNull();
    expect(reminderAction('https://example.com/tasks?task=4', actions)).toBeNull();
    expect(reminderAction('/tasks?task=4', '[bad')).toBeNull();
    expect(reminderAction('/tasks?task=4', [{ label: 'Snooze', reminder_run: -1 }])).toBeNull();
  });
  it('shows title, due time and buttons once, and snoozes the recipient delivery', async () => {
    const { service, http } = setup();
    notify(service);
    notify(service);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.options).toMatchObject({
      title: 'Ship release',
      body: 'Due Oct 4, 2026 10:00 IST',
      actions: [
        { type: 'button', text: 'Snooze 15 min' },
        { type: 'button', text: 'Mark Complete' },
      ],
    });
    notes[0]!.events.action!({}, 0);
    await vi.waitFor(() => expect(http.post).toHaveBeenCalledWith('/api/task-reminder-runs/17/snooze', { minutes: 15 }));
    expect(http.request).not.toHaveBeenCalled();
  });
  it('marks the task complete through the permission-checked task endpoint', async () => {
    const { service, http } = setup();
    notify(service);
    notes[0]!.events.action!({}, 1);
    await vi.waitFor(() => expect(http.request).toHaveBeenCalledWith('PATCH', '/api/tasks/4', { body: { field: 'status', value: 'done' } }));
  });
  it('uses generic content while locked and never mutates a task from a locked banner', () => {
    const { service, http } = setup();
    service.isLocked = () => true;
    service.onClick = vi.fn();
    notify(service);
    expect(notes[0]!.options).toMatchObject({ title: 'WorkSuite', body: 'New WorkSuite notification', actions: undefined });
    notes[0]!.events.action!({}, 1);
    expect(http.request).not.toHaveBeenCalled();
    expect(service.onClick).toHaveBeenCalledWith('/tasks?task=4', 'tasks');
  });
  it('recovers reminder actions through polling and skips server-suppressed banners', async () => {
    const { service, http } = setup();
    let items: unknown[] = [];
    http.get.mockImplementation(async (path: string) => (path === '/api/notifications' ? { items } : {}));
    const poll = service as unknown as { refreshList: (announce?: boolean) => Promise<void> };
    service.start('3');
    await poll.refreshList();
    items = [
      {
        id: 32,
        type: 'task.reminder',
        category: 'projects',
        title: 'Muted reminder',
        link: '/tasks?task=4',
        actions: JSON.stringify(actions),
        created_at: new Date().toISOString(),
        desktop_allowed: false,
      },
      {
        id: 31,
        event_key: 'task.reminder',
        category: 'projects',
        title: 'Polled reminder',
        link: '/tasks?task=4',
        actions: JSON.stringify(actions),
        created_at: new Date().toISOString(),
        desktop_allowed: true,
      },
    ];
    await poll.refreshList(true);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.options.title).toBe('Polled reminder');
    notes[0]!.events.action!({}, 0);
    await vi.waitFor(() => expect(http.post).toHaveBeenCalledWith('/api/task-reminder-runs/17/snooze', { minutes: 15 }));
    service.stop();
  });
  it('respects disabled banners and per-task category preferences', () => {
    const { service, prefs } = setup();
    prefs.moduleNotifications['cat:projects'] = false;
    notify(service);
    expect(notes).toHaveLength(0);
  });
});
