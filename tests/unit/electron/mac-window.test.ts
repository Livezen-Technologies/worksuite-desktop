import { afterEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';

/**
 * The main window on macOS (worksuite-desktop#221): never under the menu bar or the Dock, whatever zoomed, filled or
 * moved it, and the Window menu a Mac app has.
 */
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.1.0', isPackaged: false, name: 'WorkSuite' },
  screen: {},
  Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
}));

const { keepInWorkArea } = await import('../../../electron/windows/manager');
const { menuTemplate } = await import('../../../electron/main/menu');

// A 1512×982 MacBook display: a 37 px menu bar, and the Dock 70 px tall at the bottom.
const bounds = { x: 0, y: 0, width: 1512, height: 982 };
const area = { x: 0, y: 37, width: 1512, height: 875 };

describe('the main window and the usable area (#221)', () => {
  it('a window spread over the whole display comes back above the Dock and below the menu bar', () => {
    expect(keepInWorkArea(bounds, area)).toEqual(area);
  });

  it('a window whose top is under the menu bar, its traffic lights hidden, comes down below it', () => {
    expect(keepInWorkArea({ x: 200, y: 0, width: 1200, height: 800 }, area)).toEqual({ x: 200, y: 37, width: 1200, height: 800 });
  });

  it('after the Dock moves to the left, a zoomed window is narrowed to what is left', () => {
    const left = { x: 70, y: 37, width: 1442, height: 945 };
    expect(keepInWorkArea({ x: 0, y: 37, width: 1512, height: 875 }, left)).toEqual({ x: 70, y: 37, width: 1442, height: 875 });
  });

  it('leaves a window that fits, and one the person dragged partly behind the Dock', () => {
    expect(keepInWorkArea({ x: 100, y: 80, width: 1200, height: 800 }, area)).toBeNull();
    expect(keepInWorkArea({ x: 100, y: 400, width: 1200, height: 800 }, area)).toBeNull();
    expect(keepInWorkArea(area, area)).toBeNull();
  });
});

describe('the Window menu', () => {
  const real = process.platform;
  afterEach(() => Object.defineProperty(process, 'platform', { value: real }));
  const actions = { checkUpdates: () => undefined, diagnostics: () => undefined, reportProblem: () => undefined, quit: () => undefined };

  it('on a Mac: Minimise, Zoom, Enter Full Screen and Bring All to Front', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const menu = menuTemplate(() => undefined, actions, { ai: false }).find((m) => m.label === 'Window')!;
    expect(menu.role).toBe('window');
    expect((menu.submenu as Array<{ role?: string }>).map((i) => i.role).filter(Boolean)).toEqual(['minimize', 'zoom', 'togglefullscreen', 'front']);
  });

  it('elsewhere the platform\'s own', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(menuTemplate(() => undefined, actions, { ai: false }).some((m) => m.role === 'windowMenu')).toBe(true);
  });
});

describe('Help › Report a Problem', () => {
  it('is in the Help menu and opens the Update Center form for this app', async () => {
    const { reportProblemUrl } = await import('../../../electron/updater/update-center');
    let opened = false;
    const help = menuTemplate(() => undefined, { checkUpdates: () => undefined, diagnostics: () => undefined, reportProblem: () => (opened = true), quit: () => undefined }, { ai: false }).find((m) => m.role === 'help')!;
    const item = (help.submenu as Array<{ label?: string; click?: () => void }>).find((i) => i.label === 'Report a Problem…')!;
    item.click!();
    expect(opened).toBe(true);
    expect(reportProblemUrl('0.2.215')).toBe('https://download.worksuitecloud.com/report-a-problem?app=lk.worksuite.desktop&version=0.2.215&platform=desktop');
  });
});
