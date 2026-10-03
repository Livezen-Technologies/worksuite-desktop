import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  windows: [] as Array<Record<string, ReturnType<typeof vi.fn>>>,
  exec: vi.fn(),
  displays: [{ id: 2, bounds: { x: -1920, y: 0, width: 1920, height: 1080 } }],
}));
vi.mock('electron', () => ({
  BrowserWindow: class {
    constructor() {
      const w = {
        setIgnoreMouseEvents: vi.fn(),
        setAlwaysOnTop: vi.fn(),
        setVisibleOnAllWorkspaces: vi.fn(),
        setContentProtection: vi.fn(),
        loadURL: vi.fn().mockResolvedValue(undefined),
        isDestroyed: vi.fn(() => false),
        setBounds: vi.fn(),
        showInactive: vi.fn(),
        hide: vi.fn(),
        destroy: vi.fn(),
      };
      mocks.windows.push(w);
      return w;
    }
  },
  screen: { getAllDisplays: () => mocks.displays, screenToDipPoint: (p: { x: number; y: number }) => ({ x: p.x / 2, y: p.y / 2 }) },
}));
vi.mock('node:child_process', () => ({ execFile: mocks.exec }));
import { ShareOutline, windowRectangle } from '../../../electron/services/share-outline';
import type { GrantedSource } from '../../../electron/services/screen-share';
const originalPlatform = process.platform;
const originalSession = process.env.XDG_SESSION_TYPE;
const platform = (p: string) => Object.defineProperty(process, 'platform', { value: p });
const source: GrantedSource = { id: 'screen:2:0', name: 'Screen 2', kind: 'screen', displayId: '2', windowId: null, at: 0 };
const windowSource = { ...source, id: 'window:42:0', kind: 'window' as const, displayId: null, windowId: '42' };
beforeEach(() => {
  vi.useFakeTimers();
  mocks.windows.length = 0;
  mocks.exec.mockReset();
  platform('linux');
  process.env.XDG_SESSION_TYPE = 'x11';
});
afterEach(() => {
  vi.useRealTimers();
  platform(originalPlatform);
  if (originalSession === undefined) delete process.env.XDG_SESSION_TYPE;
  else process.env.XDG_SESSION_TYPE = originalSession;
});
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('desktop sharing outline', () => {
  it('marks the selected display without taking focus or mouse input, and removes it on stop', async () => {
    const outline = new ShareOutline();
    outline.start(9, source);
    await flush();
    const win = mocks.windows[0]!;
    expect(win.setBounds).toHaveBeenCalledWith(mocks.displays[0]!.bounds);
    expect(win.setIgnoreMouseEvents).toHaveBeenCalledWith(true);
    expect(win.showInactive).toHaveBeenCalledOnce();
    expect(decodeURIComponent(win.loadURL!.mock.calls[0]![0])).toContain('border:3px solid #E5484D');
    outline.stop(9);
    expect(win.destroy).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2000);
    expect(win.showInactive).toHaveBeenCalledOnce();
  });

  it('follows window movement, hides a missing window and ignores a bounds reply after stopping', async () => {
    const bounds = vi.fn().mockResolvedValueOnce({ x: 10, y: 20, width: 300, height: 200 }).mockResolvedValueOnce(null);
    const outline = new ShareOutline(bounds);
    outline.start(9, windowSource);
    await flush();
    const win = mocks.windows[0]!;
    expect(win.setBounds).toHaveBeenCalledWith({ x: 10, y: 20, width: 300, height: 200 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(win.hide).toHaveBeenCalledOnce();
    let resolve!: (r: { x: number; y: number; width: number; height: number }) => void;
    bounds.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    outline.stop(9);
    resolve({ x: 30, y: 40, width: 300, height: 200 });
    await flush();
    expect(win.setBounds).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('replaces an old source and never outlines a fallback display or Wayland surface', async () => {
    const outline = new ShareOutline();
    outline.start(9, source);
    await flush();
    outline.start(9, { ...source, displayId: 'missing' });
    await flush();
    expect(mocks.windows[0]!.destroy).toHaveBeenCalledOnce();
    expect(mocks.windows[1]!.hide).toHaveBeenCalledOnce();
    outline.stop(9);
    process.env.XDG_SESSION_TYPE = 'wayland';
    outline.start(9, source);
    expect(mocks.windows).toHaveLength(2);
  });
});

describe('read-only shared window bounds', () => {
  it('reads X11 coordinates and refuses unviewable windows and invalid IDs', async () => {
    mocks.exec.mockImplementation((_file, _args, _options, done) =>
      done(null, '  Absolute upper-left X: -10\n  Absolute upper-left Y: 20\n  Width: 300\n  Height: 200\n  Map State: IsViewable\n'),
    );
    expect(await windowRectangle('42')).toEqual({ x: -10, y: 20, width: 300, height: 200 });
    expect(mocks.exec.mock.calls[0]![1]).toEqual(['-id', '0x2a']);
    expect(await windowRectangle('42; command')).toBeNull();
    expect(mocks.exec).toHaveBeenCalledOnce();
    mocks.exec.mockImplementation((_file, _args, _options, done) => done(null, 'Map State: IsUnMapped'));
    expect(await windowRectangle('42')).toBeNull();
  });

  it('converts Windows physical bounds to Electron DIP, and leaves macOS points unchanged', async () => {
    mocks.exec.mockImplementation((_file, _args, _options, done) => done(null, '{"X":-100,"Y":20,"Width":600,"Height":400}'));
    platform('win32');
    expect(await windowRectangle('42')).toEqual({ x: -50, y: 10, width: 300, height: 200 });
    platform('darwin');
    expect(await windowRectangle('42')).toEqual({ x: -100, y: 20, width: 600, height: 400 });
    expect(mocks.exec.mock.calls[1]![1].join(' ')).not.toContain('AXIsProcessTrusted');
  });

  it('falls back safely on native errors, invalid output and Wayland', async () => {
    mocks.exec.mockImplementation((_file, _args, _options, done) => done(new Error('Unavailable'), ''));
    expect(await windowRectangle('42')).toBeNull();
    platform('darwin');
    mocks.exec.mockImplementation((_file, _args, _options, done) => done(null, '{}'));
    expect(await windowRectangle('42')).toBeNull();
    platform('linux');
    process.env.XDG_SESSION_TYPE = 'wayland';
    mocks.exec.mockClear();
    expect(await windowRectangle('42')).toBeNull();
    expect(mocks.exec).not.toHaveBeenCalled();
  });
});
