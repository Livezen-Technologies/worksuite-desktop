import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';

/**
 * L-06 "Desktop — wall mode on a second display" in the main process (WS-WCHAT MAP-UI-06; MAP-16, MAP-24, WF-M3): the
 * sheet's screens in the design's words, its choices with their defaults, the wall on the screen it picked — kept awake
 * only when it says so, moved when opened again elsewhere, closed by the tray, and gone with its unplugged display.
 */
type Listener = (...a: unknown[]) => void;
const fx = vi.hoisted(() => ({
  windows: [] as Array<{ id: number; opts: Record<string, unknown>; destroyed: boolean; full: boolean; bounds: unknown; sent: string[]; events: Record<string, Listener[]>; url: string }>,
  screenEvents: {} as Record<string, Listener[]>,
  displays: [] as Array<{ id: number; bounds: { x: number; y: number; width: number; height: number }; label?: string; internal?: boolean }>,
  blockers: new Set<number>(),
  nextBlocker: 1,
}));

vi.mock('electron', () => {
  let nextId = 1;
  class FakeWindow {
    id = nextId++;
    entry: (typeof fx.windows)[number];
    webContents: { send: (c: string) => void; on: () => void };
    constructor(opts: Record<string, unknown>) {
      this.entry = { id: this.id, opts, destroyed: false, full: !!opts.fullscreen, bounds: null, sent: [], events: {}, url: '' };
      fx.windows.push(this.entry);
      this.webContents = { send: (c: string) => void this.entry.sent.push(c), on: () => undefined };
    }
    static getAllWindows() {
      return all.filter((w) => !w.entry.destroyed);
    }
    isDestroyed() {
      return this.entry.destroyed;
    }
    isFullScreen() {
      return this.entry.full;
    }
    setFullScreen(v: boolean) {
      this.entry.full = v;
    }
    setBounds(b: unknown) {
      this.entry.bounds = b;
    }
    show() {}
    focus() {}
    on(name: string, fn: Listener) {
      (this.entry.events[name] ??= []).push(fn);
      return this;
    }
    once(name: string, fn: Listener) {
      return this.on(name, fn);
    }
    loadURL(u: string) {
      this.entry.url = u;
      return Promise.resolve();
    }
    close() {
      if (this.entry.destroyed) return;
      this.entry.destroyed = true;
      for (const fn of this.entry.events.closed ?? []) fn();
    }
  }
  const all: FakeWindow[] = [];
  const Tracked = new Proxy(FakeWindow, {
    construct(target, args) {
      const w = new target(...(args as [Record<string, unknown>]));
      all.push(w);
      return w;
    },
  });
  return {
    app: { getPath: () => tmpdir(), getVersion: () => '0.1.0', isPackaged: false, on: () => undefined },
    BrowserWindow: Tracked,
    screen: {
      getAllDisplays: () => fx.displays,
      getPrimaryDisplay: () => fx.displays[0],
      on: (name: string, fn: Listener) => void (fx.screenEvents[name] ??= []).push(fn),
      removeListener: (name: string, fn: Listener) => void (fx.screenEvents[name] = (fx.screenEvents[name] ?? []).filter((f) => f !== fn)),
    },
    powerSaveBlocker: {
      start: () => {
        const id = fx.nextBlocker++;
        fx.blockers.add(id);
        return id;
      },
      stop: (id: number) => void fx.blockers.delete(id),
      isStarted: (id: number) => fx.blockers.has(id),
    },
    Notification: class {},
    nativeImage: { createFromPath: () => ({ setTemplateImage: () => undefined }) },
  };
});

import { WALL_MODE_DEFAULTS } from '@shared/types';
import { wallDisplays, wallPrefsOf, wallTarget } from '../../../electron/services/live-desk';
import { LIVE_ROUTE, WindowManager, windowRoute } from '../../../electron/windows/manager';

const LAPTOP = { id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 }, label: 'Built-in Retina Display', internal: true };
const LG = { id: 7, bounds: { x: 1440, y: 0, width: 2560, height: 1440 }, label: 'LG UltraFine 27″', internal: false };
const TV = { id: 9, bounds: { x: 4000, y: 0, width: 1920, height: 1080 }, label: '', internal: false };

beforeEach(() => {
  fx.windows.length = 0;
  fx.screenEvents = {};
  fx.displays = [LAPTOP, LG];
  fx.blockers.clear();
});

describe('MAP-UI-06 · the sheet’s screens and choices', () => {
  it('“Display 1 · Built-in · this window” and “Display 2 · LG UltraFine 27″”, an unnamed screen “External”', () => {
    expect(wallDisplays([LAPTOP, LG], 1)).toEqual([
      { id: 1, display: 'Display 1', detail: 'Built-in · this window' },
      { id: 7, display: 'Display 2', detail: 'LG UltraFine 27″' },
    ]);
    // The main window closed: no screen is "this window".
    expect(wallDisplays([LAPTOP, LG, TV], null).map((d) => d.detail)).toEqual(['Built-in', 'LG UltraFine 27″', 'External']);
  });

  it('opens where the sheet picked while that screen is connected; else the first that is not the main one', () => {
    expect(wallTarget([LAPTOP, LG, TV], 1, 9)).toEqual({ id: 9, display: 'Display 3', name: null });
    expect(wallTarget([LAPTOP, LG, TV], 1, 1)).toEqual({ id: 1, display: 'Display 1', name: 'Built-in Retina Display' });
    expect(wallTarget([LAPTOP, LG], 1, 42)).toEqual({ id: 7, display: 'Display 2', name: 'LG UltraFine 27″' });
    expect(wallTarget([LAPTOP, LG], 1)).toEqual({ id: 7, display: 'Display 2', name: 'LG UltraFine 27″' });
  });

  it('keeps awake and cycles by default; opening at start is the person’s choice', () => {
    expect(WALL_MODE_DEFAULTS).toEqual({ displayId: null, keepAwake: true, cycle: true, openAtStart: false });
    expect(wallPrefsOf(undefined)).toEqual(WALL_MODE_DEFAULTS);
    expect(wallPrefsOf({ displayId: 7, keepAwake: false, openAtStart: true })).toEqual({ displayId: 7, keepAwake: false, cycle: true, openAtStart: true });
  });

  it('the sheet is the Live dashboard’s, so it closes with Chat', () => {
    expect(windowRoute('app://bundle/index.html#/window/wall-sheet')).toBe(LIVE_ROUTE);
  });
});

describe('MAP-24 · the wall window', () => {
  const manager = () => new WindowManager({} as never, '/preload.js');

  it('fills the picked screen, kept awake only when the sheet says so, and moves when opened again elsewhere', () => {
    const m = manager();
    m.showWall(7, { keepAwake: true });
    const wall = fx.windows[0]!;
    expect(wall.opts).toMatchObject({ ...LG.bounds, fullscreen: true, frame: false, title: 'Website chats — live' });
    expect(wall.url).toMatch(/#\/window\/wall$/);
    expect(fx.blockers.size).toBe(1);
    expect(m.wallOpen()).toBe(true);

    // Opened again on the laptop's screen with keep-awake off: the same window, moved, the screen let sleep, told to re-read.
    m.showWall(1, { keepAwake: false });
    expect(fx.windows).toHaveLength(1);
    expect(wall.bounds).toEqual(LAPTOP.bounds);
    expect(wall.full).toBe(true);
    expect(fx.blockers.size).toBe(0);
    expect(wall.sent).toContain('live:wallChanged');
  });

  it('closes from the tray, letting the screen sleep', () => {
    const m = manager();
    expect(m.closeWall()).toBe(false);
    m.showWall(7);
    expect(fx.blockers.size).toBe(1);
    expect(m.closeWall()).toBe(true);
    expect(m.wallOpen()).toBe(false);
    expect(fx.blockers.size).toBe(0);
    expect(fx.screenEvents['display-removed']).toEqual([]);
  });

  it('closes when its display is unplugged — and only its own — and says so', () => {
    const m = manager();
    const gone = vi.fn();
    m.onWallGone = gone;
    m.showWall(7);
    for (const fn of fx.screenEvents['display-removed'] ?? []) fn({}, { id: 9 });
    expect(m.wallOpen()).toBe(true);
    for (const fn of fx.screenEvents['display-removed'] ?? []) fn({}, { id: 7 });
    expect(m.wallOpen()).toBe(false);
    expect(gone).toHaveBeenCalledTimes(1);
    expect(fx.blockers.size).toBe(0);
  });

  it('the sheet is one small window titled “Wall mode”, closed once the wall opens', () => {
    const m = manager();
    const made: Array<{ kind: string; hash: string; title?: string }> = [];
    const sheet = { setResizable: vi.fn(), setMinimizable: vi.fn(), setMaximizable: vi.fn(), setFullScreenable: vi.fn() };
    vi.spyOn(m as never as { create: (k: string, o: { hash: string; title?: string }) => unknown }, 'create').mockImplementation((kind, o) => {
      made.push({ kind, ...o });
      return sheet;
    });
    m.showWallSheet();
    expect(made).toEqual([{ kind: 'wall-sheet', hash: '/window/wall-sheet', title: 'Wall mode' }]);
    expect(sheet.setResizable).toHaveBeenCalledWith(false);
  });
});
