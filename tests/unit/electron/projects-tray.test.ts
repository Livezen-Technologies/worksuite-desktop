import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { isPackaged: false }, Menu: {}, Tray: class {}, nativeImage: {} }));

import { EMPTY_TIMER, type ProjectTimerState } from '@shared/projects';
import { trayProjectItems } from '../../../electron/tray/tray';

/** The Projects timer in the tray (PRJ-DSK-02, D02). */
describe('the tray’s Projects timer', () => {
  const now = Date.parse('2026-10-09T15:12:48Z');
  const state: ProjectTimerState = {
    ...EMPTY_TIMER,
    available: true,
    running: { id: 41, startedAt: '2026-10-09T14:00:00Z', taskId: 412, taskNumber: 'TSK-0412', task: 'Bidder KYC document upload', projectId: 18, projectCode: 'PRJ-0018', project: 'e-Auction portal', billable: true, note: null },
    recent: [
      { taskId: 409, projectId: 18, number: 'TSK-0409', title: 'Payment gateway — 3-D Secure flow', minutes: 1350 },
      { taskId: null, projectId: 21, number: 'PRJ-0021', title: 'SFCL website — no task', minutes: 250 },
    ],
    todayMinutes: 328,
    weekMinutes: 1803,
  };
  const actions = { openRoute: vi.fn(), projectTimerStop: vi.fn(), projectTimerSwitch: vi.fn(), projectTimerResume: vi.fn(), projectTimerWindow: vi.fn() };

  it('shows what runs, Stop, Switch to, the day’s and week’s totals and Open timesheet', () => {
    const items = trayProjectItems({ signedIn: true, apps: ['projects'], projectTimer: state }, actions, now);
    expect(items.map((i) => i.label ?? i.type)).toEqual([
      'Timer running · billable',
      '● TSK-0412 · Bidder KYC document upload — 1:12',
      'Stop timer',
      'Show mini timer',
      'Switch to',
      'Today 6:40 · This week 31:15',
      'Open timesheet',
      'separator',
    ]);
    const sw = items.find((i) => i.label === 'Switch to')!;
    const sub = sw.submenu as Array<{ label: string; click: () => void }>;
    expect(sub.map((s) => s.label)).toEqual(['TSK-0409 Payment gateway — 3-D Secure flow  22:30', 'PRJ-0021 SFCL website — no task  4:10']);
    sub[1]!.click();
    expect(actions.projectTimerSwitch).toHaveBeenCalledWith({ taskId: null, projectId: 21 });
    (items.find((i) => i.label === 'Open timesheet')!.click as () => void)();
    expect(actions.openRoute).toHaveBeenCalledWith('/projects/time');
  });

  it('offers Start timer on… and Resume when nothing runs, and nothing without Projects', () => {
    const idle = { ...state, running: null, paused: { taskId: 412, projectId: 18, label: 'TSK-0412 · Bidder KYC document upload' } };
    expect(trayProjectItems({ signedIn: true, apps: ['projects'], projectTimer: idle }, actions, now).map((i) => i.label ?? i.type)).toEqual([
      'Resume — TSK-0412 · Bidder KYC document upload',
      'Start timer on',
      'Today 5:28 · This week 30:03',
      'Open timesheet',
      'separator',
    ]);
    expect(trayProjectItems({ signedIn: true, apps: ['tasks'], projectTimer: state }, actions, now)).toEqual([]);
    expect(trayProjectItems({ signedIn: true, apps: ['projects'], projectTimer: { ...state, available: false } }, actions, now)).toEqual([]);
  });
});
