import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupportPulseFigures } from '../../../electron/services/support-desk';

/**
 * The tray menu, rearranged (worksuite-desktop#346): short enough for a 768-pixel screen with Quit always last, one
 * summary line per section with its detail in a submenu, no shortcut text on Linux, rebuilt (and handed over again,
 * for AppIndicator) within two seconds of a change, and a word when the desktop shows no tray icons at all.
 */
const sets = vi.hoisted(() => ({ menus: [] as unknown[] }));
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), isPackaged: false, setBadgeCount: () => undefined },
  nativeImage: { createFromPath: () => ({ setTemplateImage: () => undefined }) },
  Menu: { buildFromTemplate: (t: unknown) => t },
  Tray: class {
    setToolTip() {}
    setImage() {}
    setTitle() {}
    on() {}
    destroy() {}
    getBounds() {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    setContextMenu(m: unknown) {
      sets.menus.push(m);
    }
  },
}));

import { callsSummary, fit, forPlatform, headerLabel, indicatorHostRunning, mailSummary, MENU_EVERY_MS, statusLabel, supportSummary, trayMenu, TrayService, TRAY_TOP_LINES, type TrayActions, type TrayModel } from '../../../electron/tray/tray';

const model: TrayModel = {
  signedIn: true, userName: 'Dimuthu Anuraj', organization: 'Livezen Technologies (Private) Limited', offline: false, pending: 0, error: null,
  unreadChat: 11, unreadMail: 209, unreadOther: 0, badge: true, notificationsPausedUntil: null, attendance: null, updateReady: false, remoteControl: null,
  webchatRinging: [], quickAsk: 'Ctrl+Shift+Space', aiChanges: 0, apps: ['chat', 'mail', 'support', 'marketing', 'ai', 'tasks', 'meet'],
};
const actions = (): TrayActions => ({
  open: vi.fn(), openRoute: vi.fn(), clockIn: vi.fn(), clockOut: vi.fn(), pauseNotifications: vi.fn(), openSettings: vi.fn(), checkUpdates: vi.fn(), quit: vi.fn(), lock: vi.fn(),
  pauseRemoteControl: vi.fn(), stopRemoteControl: vi.fn(), joinWebchat: vi.fn(), quickAsk: vi.fn(), aiChanges: vi.fn(), ringingSettings: vi.fn(), setPresence: vi.fn(), updateNow: vi.fn(),
});
const figures = (over: Partial<SupportPulseFigures> = {}): SupportPulseFigures => ({ syncedAt: '2026-10-11T12:00:00Z', open: 0, unread: 0, dueToday: null, overdue: 0, unassigned: 1, atRisk: 0, breached: false, next: [], presence: 'away', ...over }) as SupportPulseFigures;

afterEach(() => {
  vi.useRealTimers();
  sets.menus.length = 0;
});

describe('the menu’s shape', () => {
  it('reads as the issue draws it, and fits a 1366×768 screen with Quit last', () => {
    const items = trayMenu({ ...model, support: figures(), marketing: { queueWaiting: 0, callbacksToday: 0, sending: null }, update: { kind: 'ready', version: '0.2.240', deadline: null } }, actions());
    expect(items.map((i) => i.label ?? '—')).toEqual([
      'Dimuthu Anuraj · Livezen Technologies (…',
      '● Away',
      '—',
      'Open WorkSuite',
      'Quick Ask…',
      'New',
      '—',
      'Chat · 11 unread',
      'Mail · 209 unread',
      'Support · 1 unassigned',
      'Calls · nothing waiting',
      '—',
      'Pause notifications',
      'Restart to update to 0.2.240',
      '—',
      'Settings…',
      'Check for updates',
      'Lock WorkSuite',
      'Quit WorkSuite',
    ]);
    expect(items.length).toBeLessThanOrEqual(TRAY_TOP_LINES);
  });

  it('shows Restart to update only when an update is ready, and never Update Now beside Check for updates', () => {
    const labels = (update: TrayModel['update']) => trayMenu({ ...model, update }, actions()).map((i) => String(i.label ?? ''));
    expect(labels({ kind: 'available', version: '0.2.240', deadline: null }).some((l) => /update now|Restart to update/i.test(l))).toBe(false);
    expect(labels(null).filter((l) => l === 'Check for updates')).toHaveLength(1);
  });

  it('chooses a status from the status line, radio-ticked, and sends it at once', () => {
    const a = actions();
    const status = trayMenu({ ...model, presence: 'busy' }, a).find((i) => i.label === '● Busy')!;
    const choices = status.submenu as Array<{ label: string; checked: boolean; click: () => void }>;
    expect(choices.map((c) => c.label)).toEqual(['Online', 'Away', 'Busy', 'Do not disturb', 'Appear offline']);
    expect(choices.find((c) => c.checked)!.label).toBe('Busy');
    choices[4]!.click();
    expect(a.setPresence).toHaveBeenCalledWith('offline');
  });
});

describe('the summary lines', () => {
  it('says the most important count, and warns only for what is overdue', () => {
    expect(supportSummary(figures({ unassigned: 0 }))).toBe('Support · all clear');
    expect(supportSummary(figures({ overdue: 2 }))).toBe('Support · 2 overdue ⚠');
    expect(supportSummary(figures({ unassigned: 0, open: 4 }))).toBe('Support · 4 open');
    expect(callsSummary({ queueWaiting: 3, callbacksToday: 9, sending: null })).toBe('Calls · 3 waiting');
    expect(callsSummary({ queueWaiting: 0, callbacksToday: 1, sending: null })).toBe('Calls · 1 callback today');
    expect(mailSummary({ unreadMail: 0, mail: null })).toBe('Mail · all read');
  });

  it('puts the connection on the status line instead of a line of its own', () => {
    expect(statusLabel({ offline: true, pending: 0, presence: 'available' })).toBe('○ Offline · reconnecting');
    expect(statusLabel({ offline: true, pending: 3, presence: 'available' })).toBe('○ Offline · 3 waiting to send');
    expect(statusLabel({ offline: false, pending: 0, presence: 'dnd' })).toBe('● Do not disturb');
    expect(trayMenu({ ...model, offline: true }, actions()).some((i) => /^(Connected|Offline)$/.test(String(i.label)))).toBe(false);
  });

  /**
   * "Local AI: Ready" (board D06) is a line that reads, not a control: there
   * is nothing to decide in a menu, and nothing may be confirmed from one. It
   * is absent rather than negative while no model can answer — a menu this
   * long does not spend a line advertising something nobody has set up.
   */
  it('says Local AI is ready, with the model, and offers nothing to click', () => {
    const items = trayMenu({ ...model, localAi: { model: 'Gemma 3 4B' } }, actions());
    const line = items.find((i) => String(i.label).startsWith('Local AI'));
    expect(line?.label).toBe('Local AI: Ready · Gemma 3 4B');
    expect(line?.enabled).toBe(false);
    expect(line?.click).toBeUndefined();

    expect(trayMenu({ ...model, localAi: null }, actions()).some((i) => /Local AI/.test(String(i.label)))).toBe(false);
    expect(trayMenu(model, actions()).some((i) => /Local AI/.test(String(i.label)))).toBe(false);
    // Somebody without the AI app never sees it, as with Quick Ask and the waiting changes.
    expect(trayMenu({ ...model, localAi: { model: 'Gemma 3 4B' }, apps: ['mail'] }, actions()).some((i) => /Local AI/.test(String(i.label)))).toBe(false);
  });

  it('keeps labels to about forty characters', () => {
    expect(fit('x'.repeat(60))).toHaveLength(40);
    expect(headerLabel('A very long person name indeed', 'An even longer organisation name')).toMatch(/…$/);
    expect(headerLabel('Nuwan', null)).toBe('Nuwan');
  });
});

describe('Linux', () => {
  it('drops the shortcut text AppIndicator cannot align, in submenus too', () => {
    const items = forPlatform([{ label: 'Quick Ask…', accelerator: 'Ctrl+Shift+Space', registerAccelerator: false }, { label: 'Live', submenu: [{ label: 'Open Live dashboard', accelerator: 'CmdOrCtrl+Shift+D' }] }], 'linux');
    expect(items[0]).toEqual({ label: 'Quick Ask…' });
    expect((items[1]!.submenu as Array<{ accelerator?: string }>)[0]!.accelerator).toBeUndefined();
    expect(forPlatform([{ label: 'x', accelerator: 'A' }], 'darwin')[0]!.accelerator).toBe('A');
  });

  it('hands over a new menu within two seconds of a change, once for a burst', () => {
    vi.useFakeTimers();
    const t = new TrayService(actions());
    t.start();
    expect(sets.menus).toHaveLength(1);
    for (let i = 0; i < 10; i++) t.update({ ...model, unreadChat: 20 + i });
    expect(sets.menus).toHaveLength(1);
    vi.advanceTimersByTime(MENU_EVERY_MS);
    expect(sets.menus).toHaveLength(2);
    expect((sets.menus[1] as Array<{ label?: string }>).some((i) => i.label === 'Chat · 29 unread')).toBe(true);
    t.destroy();
  });

  it('knows when the desktop shows no tray icons', async () => {
    const answer = (out: string | null) => vi.fn((_c: string, _a: string[], _o: unknown, cb: (e: Error | null, out: string) => void) => cb(out === null ? new Error('no gdbus') : null, out ?? '')) as never;
    expect(await indicatorHostRunning(answer('(true,)\n'))).toBe(true);
    expect(await indicatorHostRunning(answer('(false,)\n'))).toBe(false);
    expect(await indicatorHostRunning(answer(null))).toBeNull();
  });
});
