import { describe, expect, it, vi } from 'vitest';
import { AX_RESTARTED_ARG, restartForAccessibility, watchAccessibility } from '../../../electron/services/remote-control/accessibility-watch';

function fakeApp() {
  const listeners = new Map<string, () => void>();
  return { on: vi.fn((event: string, fn: () => void) => listeners.set(event, fn)), fire: (event: string) => listeners.get(event)?.() };
}

describe('Accessibility is asked again when WorkSuite becomes active (worksuite-desktop#147)', () => {
  it('checks again and tells every window when the app becomes active or a window takes focus', async () => {
    const app = fakeApp();
    const recheck = vi.fn(async () => undefined);
    const changed = vi.fn();
    watchAccessibility({ app, platform: 'darwin', recheck, changed });
    expect(app.on).toHaveBeenCalledWith('did-become-active', expect.any(Function));
    expect(app.on).toHaveBeenCalledWith('browser-window-focus', expect.any(Function));
    app.fire('did-become-active');
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    app.fire('browser-window-focus');
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
    expect(recheck).toHaveBeenCalledTimes(2);
  });

  it('answers activation and focus arriving together with one check', async () => {
    const app = fakeApp();
    let finish!: () => void;
    const recheck = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const changed = vi.fn();
    watchAccessibility({ app, platform: 'darwin', recheck, changed });
    app.fire('did-become-active');
    app.fire('browser-window-focus');
    expect(recheck).toHaveBeenCalledTimes(1);
    finish();
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  });

  it('still updates the windows when a check fails', async () => {
    const app = fakeApp();
    const changed = vi.fn();
    const check = watchAccessibility({ app, platform: 'darwin', recheck: () => Promise.reject(new Error('x')), changed });
    await check();
    expect(changed).toHaveBeenCalled();
  });

  it('watches nothing on other platforms', () => {
    const app = fakeApp();
    watchAccessibility({ app, platform: 'win32', recheck: vi.fn(), changed: vi.fn() });
    expect(app.on).not.toHaveBeenCalled();
  });
});

describe('Restart WorkSuite', () => {
  it('stops control (and so the input helper), ends check helpers, then relaunches the app marked as restarted', async () => {
    const order: string[] = [];
    await restartForAccessibility({
      stopControl: async () => void order.push('control'),
      stopProbes: () => void order.push('probes'),
      relaunch: (safe, args) => void order.push(`relaunch ${safe} ${args.join(' ')}`),
    });
    expect(order).toEqual(['control', 'probes', `relaunch false ${AX_RESTARTED_ARG}`]);
  });

  it('relaunches even if stopping control fails', async () => {
    const relaunch = vi.fn();
    await restartForAccessibility({ stopControl: () => Promise.reject(new Error('offline')), stopProbes: vi.fn(), relaunch });
    expect(relaunch).toHaveBeenCalledWith(false, [AX_RESTARTED_ARG]);
  });
});
