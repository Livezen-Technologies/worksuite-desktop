import { describe, expect, it } from 'vitest';
import { APP_CATALOGUE, navApps, type AppDefinition } from '@shared/apps';
import {
  addGroup,
  cleanIds,
  columnsFor,
  defaultStoredPrefs,
  fitGridHeight,
  FULL_COLUMN,
  FULL_SEARCH,
  FULL_SIDEBAR,
  fullscreenChrome,
  fullscreenRect,
  fullscreenSidebar,
  GRID_GAP_PX,
  GRID_PAD,
  gridStep,
  hasMoreBelow,
  LAUNCHER_SIZES,
  launcherLayout,
  launcherSections,
  popoverChrome,
  sectionBlocks,
  sectionStep,
  tileHeight,
  TOP_BAR_PX,
  wholeRows,
  launcherShortcutProblem,
  launcherView,
  matchScore,
  moveToGroup,
  movePinned,
  noteUse,
  normaliseStored,
  pinApp,
  PIN_MAX,
  removeGroup,
  renameGroup,
  reorderApps,
  resetPrefs,
  resolvePrefs,
  searchApps,
  setHidden,
  sortApps,
  unpinApp,
  visibleArea,
  type LauncherPrefs,
} from '@shared/launcher';

const apps: AppDefinition[] = navApps(APP_CATALOGUE).filter((a) => a.id !== 'home');
const base = (patch: Partial<LauncherPrefs> = {}): LauncherPrefs => ({ ...resolvePrefs(null), ...patch });
const ids = (list: AppDefinition[]) => list.map((a) => a.id);

describe('launcher size and place (worksuite-desktop#206)', () => {
  const full = (w: number, h: number) => ({ left: 0, top: 0, width: w, height: h });
  const win = (w: number, h: number) => ({ width: w, height: h });
  const parts = { pinned: false, recent: false, chips: true };
  const SIZES: Array<[number, number]> = [
    [1024, 700],
    [1280, 800],
    [1440, 900],
    [1728, 1117],
    [2560, 1440],
  ];

  it('is a popover min(880px, 100vw − 48px) wide, centred, 12% down the window, of whole rows', () => {
    // [width, height] → [left, top, grid rows, popover height], compact icons (48px, 88px tiles), the chips showing.
    const expected: Record<string, [number, number, number, number]> = {
      '1024x700': [72, 84, 4, 527],
      '1280x800': [200, 96, 5, 617],
      '1440x900': [280, 108, 5, 617],
      '1728x1117': [424, 134, 5, 617],
      '2560x1440': [840, 173, 5, 617],
    };
    for (const [w, h] of SIZES) {
      const l = launcherLayout(win(w, h), full(w, h), { mode: 'popover', size: 'compact' }, parts);
      const [left, top, rows, height] = expected[`${w}x${h}`]!;
      expect(l).toMatchObject({ kind: 'popover', width: 880, left, top, height, icon: 48, rowHeight: 88 });
      expect(l.grid!.rows).toBe(rows);
    }
  });

  it('gives a grid in sections all the room there is, whole rows or not', () => {
    for (const [w, h] of SIZES) {
      const l = launcherLayout(win(w, h), full(w, h), { mode: 'popover', size: 'compact' }, { ...parts, pinned: true, recent: true, sections: true });
      const max = Math.min(640, h - 96, h - 24 - l.top);
      expect(l.height).toBe(max);
      expect(l.grid!.height).toBe(max - popoverChrome({ ...parts, pinned: true, recent: true }));
    }
  });

  it('keeps a 24px margin, stays centred and inside min(640px, 100vh − 96px) at every size from 1024×700 up', () => {
    for (let w = 1024; w <= 2560; w += 37) {
      for (const h of [700, 768, 800, 900, 1117, 1440]) {
        for (const size of LAUNCHER_SIZES) {
          for (const names of [true, false]) {
            for (const p of [parts, { pinned: true, recent: true, chips: true }, { pinned: false, recent: false, chips: false }]) {
              const l = launcherLayout(win(w, h), full(w, h), { mode: 'popover', size, toggles: { names } }, p);
              expect(l.width).toBe(Math.min(880, w - 48));
              // Centred: as much room on the left as on the right (to the pixel, for odd widths).
              expect(Math.abs(l.left - (w - l.left - l.width))).toBeLessThanOrEqual(1);
              expect(l.left).toBeGreaterThanOrEqual(24);
              expect(l.top).toBeGreaterThanOrEqual(52 + 16);
              expect(l.top).toBe(Math.round(h * 0.12));
              expect(l.top + l.height).toBeLessThanOrEqual(h - 24);
              expect(l.height).toBeLessThanOrEqual(Math.min(640, h - 96));
              // Whole rows: the scroller is the rows, their gaps and its padding, and one more row would not fit.
              const g = l.grid!;
              expect(g.height).toBe(GRID_PAD.top + GRID_PAD.bottom + g.rows * l.rowHeight + (g.rows - 1) * GRID_GAP_PX);
              const room = Math.min(640, h - 96, h - 24 - l.top) - popoverChrome(p);
              expect(g.height).toBeLessThanOrEqual(room);
              expect(g.height + l.rowHeight + GRID_GAP_PX).toBeGreaterThan(room);
              expect(l.height).toBe(popoverChrome(p) + g.height);
            }
          }
        }
      }
    }
  });

  it('sizes a tile to its icon and its name, so a row always shows the names', () => {
    expect(tileHeight(44, true)).toBe(84);
    expect(tileHeight(44, false)).toBe(64);
    expect(wholeRows(443, 84, 2)).toEqual({ rows: 4, height: 362 });
    // One row at least, however little room.
    expect(wholeRows(10, 84, 2).rows).toBe(1);
    expect(popoverChrome({ pinned: false, recent: false, chips: true })).toBe(149);
    expect(popoverChrome({ pinned: true, recent: true, chips: true })).toBe(229);
  });

  it('keeps clear of the Dock: never under it, and still centred', () => {
    // A 1440×900 window on a 1440×900 screen whose Dock takes the bottom 80px.
    const area = visibleArea({ innerWidth: 1440, innerHeight: 900, outerWidth: 1440, outerHeight: 900, screenX: 0, screenY: 0 }, { availLeft: 0, availTop: 0, availWidth: 1440, availHeight: 820 });
    expect(area).toEqual({ left: 0, top: 0, width: 1440, height: 820 });
    const l = launcherLayout(win(1440, 900), area, { mode: 'popover', size: 'compact' }, parts);
    expect(l.top + l.height).toBeLessThanOrEqual(820 - 24);
    // A 1024×700 window whose bottom 120px is under the Dock: shorter, whole rows still.
    const low = launcherLayout(win(1024, 700), full(1024, 580), { mode: 'popover', size: 'compact' }, parts);
    expect(low.top + low.height).toBeLessThanOrEqual(580 - 24);
    expect(low.grid!.rows).toBe(3);
    // A Dock down the right side, over the window's last 120px: narrower on both sides, so still centred.
    const side = launcherLayout(win(1280, 800), full(1000, 800), { mode: 'popover', size: 'compact' }, parts);
    expect(side.width).toBe(672);
    expect(side.left + side.width).toBeLessThanOrEqual(1000 - 24);
    expect(side.left).toBe(1280 - side.left - side.width);
    // A taskbar on the left, and the menu bar above a window that starts under it.
    expect(visibleArea({ innerWidth: 1200, innerHeight: 800, screenX: 0, screenY: 0 }, { availLeft: 60, availTop: 25, availWidth: 1860, availHeight: 1055 })).toEqual({ left: 60, top: 25, width: 1140, height: 775 });
    const fs = launcherLayout(win(1440, 900), area, { mode: 'fullscreen', size: 'compact' });
    expect(fs.top + fs.height).toBe(820);
  });

  it('uses the whole window when there is no work area to go by', () => {
    expect(visibleArea({ innerWidth: 1280, innerHeight: 800 }, null)).toEqual(full(1280, 800));
    expect(visibleArea({ innerWidth: 1280, innerHeight: 800, screenX: 0, screenY: 0 }, { availWidth: 0, availHeight: 0 })).toEqual(full(1280, 800));
    // Numbers from another screen altogether: not nothing.
    expect(visibleArea({ innerWidth: 1280, innerHeight: 800, screenX: 5000, screenY: 0 }, { availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1080 })).toEqual(full(1280, 800));
  });

  it('is a bottom sheet of four columns and 48px icons below 480px', () => {
    const l = launcherLayout(win(400, 800), full(400, 800), { mode: 'popover', size: 'large' });
    expect(l).toMatchObject({ kind: 'sheet', columns: 4, fixedColumns: 4, icon: 48, width: 400, left: 0, height: 720, grid: null });
    expect(l.top + l.height).toBe(800);
    expect(launcherLayout(win(479, 700), full(479, 700), { mode: 'fullscreen', size: 'compact' }).kind).toBe('sheet');
    expect(launcherLayout(win(480, 700), full(480, 700), { mode: 'popover', size: 'compact' }).kind).toBe('popover');
  });

  it('has three icon sizes in the popover, each a step larger in full screen', () => {
    const at = (mode: 'popover' | 'fullscreen', size: 'compact' | 'comfortable' | 'large') => launcherLayout(win(1280, 800), full(1280, 800), { mode, size }).icon;
    expect([at('popover', 'compact'), at('popover', 'comfortable'), at('popover', 'large')]).toEqual([48, 52, 64]);
    expect([at('fullscreen', 'compact'), at('fullscreen', 'comfortable'), at('fullscreen', 'large')]).toEqual([52, 56, 72]);
  });

  it('puts full screen under the top bar, in one centred column of at most 1160px with 116px tiles and the categories in a sidebar', () => {
    // [width, height] → columns, with the sidebar (240px and 32px of gap) taking its share of the column.
    const cols: Record<string, number> = { '1024x700': 5, '1280x800': 6, '1440x900': 6, '1728x1117': 6, '2560x1440': 6 };
    for (const [w, h] of SIZES) {
      const l = launcherLayout(win(w, h), full(w, h), { mode: 'fullscreen', size: 'comfortable' }, parts);
      // Never over the top bar, and so never over the traffic lights or the window buttons in it.
      expect(l).toMatchObject({ kind: 'fullscreen', left: 0, top: TOP_BAR_PX, width: w, height: h - TOP_BAR_PX, icon: 56, tileMin: 116, gap: 8, rowHeight: 116, sidebar: true });
      expect(l.column!.width).toBe(Math.min(1160, w));
      expect(l.columns).toBe(cols[`${w}x${h}`]);
      expect(l.column!.gridRoom).toBe(h - TOP_BAR_PX - fullscreenChrome(parts, true));
    }
    expect(TOP_BAR_PX).toBeGreaterThanOrEqual(52);
    // Nothing under the column: the footer runs along the bottom of the window (worksuite-desktop#233).
    expect(FULL_COLUMN).toEqual({ maxWidth: 1160, padTop: 40, padSide: 24, padBottom: 0 });
    expect(FULL_SEARCH).toEqual({ height: 56 });
    expect(FULL_SIDEBAR).toEqual({ width: 240, gap: 32, minColumn: 760 });
    // The search row, the footer; the chips only when the categories are not in the sidebar; Pinned and Recent share a row.
    expect(fullscreenChrome(parts, true)).toBe(40 + 72 + 64);
    expect(fullscreenChrome(parts)).toBe(40 + 72 + 40 + 64);
    expect(fullscreenChrome({ pinned: true, recent: true, chips: true }, true)).toBe(40 + 72 + 68 + 64);
    // Under a menu bar or a work area that starts lower: lower too.
    expect(fullscreenRect(win(1280, 800), { left: 0, top: 70, width: 1280, height: 730 }).top).toBe(70);
  });

  it('puts the categories back as chips when the sidebar is off, there are none, or the column is too narrow for it', () => {
    const at = (w: number, sidebar: boolean | undefined, chips = true) => launcherLayout(win(w, 800), full(w, 800), { mode: 'fullscreen', size: 'compact', toggles: { sidebar } }, { ...parts, chips });
    expect(at(1280, true)).toMatchObject({ sidebar: true, columns: 6 });
    // Asked for by default.
    expect(at(1280, undefined).sidebar).toBe(true);
    // Off: the whole column for the apps.
    expect(at(1280, false)).toMatchObject({ sidebar: false, columns: 9 });
    // No categories (grouping off): nothing to list.
    expect(at(1280, true, false).sidebar).toBe(false);
    // 808px of window: a 760px column inside the padding, just enough; one less, chips.
    expect(at(808, true).sidebar).toBe(true);
    expect(at(807, true).sidebar).toBe(false);
    expect(fullscreenSidebar(808, true, true)).toBe(true);
    // The popover and the sheet never have one.
    expect(launcherLayout(win(1280, 800), full(1280, 800), { mode: 'popover', size: 'compact', toggles: { sidebar: true } }, parts).sidebar).toBe(false);
    expect(launcherLayout(win(420, 800), full(420, 800), { mode: 'fullscreen', size: 'compact', toggles: { sidebar: true } }, parts).sidebar).toBe(false);
  });

  it('fits full screen\'s grid to its content, or to the whole rows and headings that fit', () => {
    const blocks = sectionBlocks(
      [
        { label: 'Communication', items: [1, 2, 3] },
        { label: 'Work', items: Array.from({ length: 12 }) },
      ],
      9,
      96,
      4,
    );
    // Heading, row; heading, row, row (12 tiles in 9 columns).
    expect(blocks).toEqual([
      { height: 32, gapBefore: 0, heading: true },
      { height: 96, gapBefore: 0 },
      { height: 32, gapBefore: 0, heading: true },
      { height: 96, gapBefore: 0 },
      { height: 96, gapBefore: 4 },
    ]);
    // Everything fits: all of it, no empty space under it.
    expect(fitGridHeight(blocks, 1000)).toBe(8 + 32 + 96 + 32 + 96 + 4 + 96 + 12);
    // Room for all but the last row: down to the end of the row before it, never through a row.
    expect(fitGridHeight(blocks, 300)).toBe(8 + 32 + 96 + 32 + 96 + 12);
    // Room for the second heading but none of its rows: it stops before that heading, not under it.
    expect(fitGridHeight(blocks, 8 + 32 + 96 + 32 + 12)).toBe(8 + 32 + 96 + 12);
    expect(fitGridHeight([], 300)).toBe(20);
  });

  it('fits as many columns as the grid is wide', () => {
    expect(columnsFor(728)).toBe(8);
    expect(columnsFor(88)).toBe(1);
    expect(columnsFor(178)).toBe(2);
    expect(columnsFor(0)).toBe(1);
    expect(columnsFor(1016, 104, 4)).toBe(9);
    expect(columnsFor(960, 104, 4)).toBe(8);
  });

  it('draws the bottom fade only while there is more below', () => {
    expect(hasMoreBelow({ scrollTop: 0, clientHeight: 400, scrollHeight: 900 })).toBe(true);
    expect(hasMoreBelow({ scrollTop: 500, clientHeight: 400, scrollHeight: 900 })).toBe(false);
    expect(hasMoreBelow({ scrollTop: 0, clientHeight: 400, scrollHeight: 400 })).toBe(false);
    expect(hasMoreBelow({ scrollTop: 0, clientHeight: 400, scrollHeight: 401 })).toBe(false);
  });
});

describe('sections', () => {
  it('groups All apps by category, in the categories\' order, under their names', () => {
    const p = base();
    const view = launcherView({ apps, prefs: p });
    const sections = launcherSections(view, p, true);
    expect(sections.map((s) => s.label)).toEqual(['Communication', 'Work', 'Business', 'People', 'Operations', 'Admin'].filter((l) => view.categories.some((c) => c.label === l)));
    expect(sections.map((s) => s.label)).toContain('Communication');
    // Every tile once, with its place in the grid, in order.
    expect(sections.flatMap((s) => s.items.map((x) => x.index))).toEqual(view.tiles.map((_, i) => i));
    for (const s of sections) for (const x of s.items) expect(x.app.group).toBe(s.id);
    // No headings: one section.
    expect(launcherSections(view, p, false)).toEqual([{ id: 'all', label: null, items: view.tiles.map((app, index) => ({ app, index })) }]);
  });

  it('uses the person\'s own groups when they group by them', () => {
    let p = addGroup(base(), 'Daily')!.prefs;
    p = { ...moveToGroup(p, 'mail', 'daily'), groupBy: 'mine' };
    const view = launcherView({ apps, prefs: p });
    const sections = launcherSections(view, p, true);
    expect(sections[0]).toMatchObject({ id: 'daily', label: 'Daily' });
    expect(sections[0]!.items.map((x) => x.app.id)).toEqual(['mail']);
    expect(sections[1]).toMatchObject({ id: 'other', label: 'Other apps' });
  });
});

describe('keyboard navigation', () => {
  it('moves a row at a time with the grid as wide as it is, and stops at the edges', () => {
    expect(gridStep(0, 'ArrowDown', 30, 8)).toBe(8);
    expect(gridStep(9, 'ArrowUp', 30, 8)).toBe(1);
    expect(gridStep(1, 'ArrowUp', 30, 8)).toBe(1);
    expect(gridStep(29, 'ArrowRight', 30, 8)).toBe(29);
    expect(gridStep(25, 'ArrowDown', 30, 8)).toBe(25);
    expect(gridStep(4, 'Home', 30, 8)).toBe(0);
    expect(gridStep(4, 'End', 30, 8)).toBe(29);
    expect(gridStep(0, 'ArrowDown', 0, 4)).toBe(0);
  });

  it('moves between sections a row at a time, each section starting a row of its own', () => {
    // Sections of 3, 12 and 2 tiles, 9 columns: rows [0–2], [3–11], [12–14], [15–16].
    const sizes = [3, 12, 2];
    expect(sectionStep(1, 'ArrowDown', sizes, 9)).toBe(4);
    expect(sectionStep(2, 'ArrowDown', sizes, 9)).toBe(5);
    expect(sectionStep(8, 'ArrowDown', sizes, 9)).toBe(14);
    expect(sectionStep(14, 'ArrowDown', sizes, 9)).toBe(16);
    expect(sectionStep(16, 'ArrowDown', sizes, 9)).toBe(16);
    expect(sectionStep(11, 'ArrowUp', sizes, 9)).toBe(2);
    expect(sectionStep(4, 'ArrowUp', sizes, 9)).toBe(1);
    expect(sectionStep(0, 'ArrowUp', sizes, 9)).toBe(0);
    expect(sectionStep(2, 'ArrowRight', sizes, 9)).toBe(3);
    expect(sectionStep(5, 'End', sizes, 9)).toBe(16);
    // One section: the same as gridStep.
    expect(sectionStep(0, 'ArrowDown', [30], 8)).toBe(8);
  });
});

describe('search', () => {
  it('finds an app by its keywords: "bill" finds Invoices', () => {
    expect(ids(searchApps(apps, 'bill'))).toContain('billing');
    expect(ids(searchApps(apps, 'bill'))[0]).toBe('billing');
    expect(ids(searchApps(apps, 'todo'))).toEqual(['tasks']);
  });

  it('puts a name that starts with the search first, then a word of a name, then keywords', () => {
    const inv = APP_CATALOGUE.find((a) => a.id === 'billing')!;
    expect(matchScore(inv, 'inv')).toBeGreaterThan(matchScore(inv, 'payments'));
    expect(ids(searchApps(apps, 'sales'))[0]).toBe('sales');
    expect(matchScore(inv, 'zzz')).toBe(0);
    // Every word must match.
    expect(ids(searchApps(apps, 'mail inbox'))).toEqual(['mail']);
    expect(searchApps(apps, 'mail qwerty')).toEqual([]);
  });

  it('matches the name the person sees, translated', () => {
    const tasks = APP_CATALOGUE.find((a) => a.id === 'tasks')!;
    expect(matchScore(tasks, 'aufg', () => 'Aufgaben')).toBeGreaterThan(0);
  });
});

describe('what the launcher lists', () => {
  it('counts each category and filters the grid by one', () => {
    const v = launcherView({ apps, prefs: base() });
    expect(v.categories[0]).toMatchObject({ id: 'all', label: 'All apps', count: apps.length });
    const comms = v.categories.find((c) => c.id === 'communication')!;
    const only = launcherView({ apps, prefs: base(), category: 'communication' });
    expect(only.tiles.length).toBe(comms.count);
    expect(only.tiles.every((a) => a.group === 'communication')).toBe(true);
    // A category that has gone falls back to All apps.
    expect(launcherView({ apps, prefs: base(), category: 'nope' }).current).toBe('all');
  });

  it('reads category by category under All apps', () => {
    const v = launcherView({ apps, prefs: base() });
    const groups = v.tiles.map((a) => a.group);
    expect(groups).toEqual([...groups].sort((a, b) => ['communication', 'work', 'business', 'people', 'operations', 'admin'].indexOf(a) - ['communication', 'work', 'business', 'people', 'operations', 'admin'].indexOf(b)));
  });

  it('leaves hidden apps out of the grid, and finds them in search', () => {
    const prefs = base({ hidden: ['mail'] });
    expect(ids(launcherView({ apps, prefs }).tiles)).not.toContain('mail');
    expect(ids(launcherView({ apps, prefs, query: 'mail' }).tiles)).toContain('mail');
    expect(launcherView({ apps, prefs }).shownCount).toBe(apps.length - 1);
  });

  it('never lists an app the person may not open, pinned or not', () => {
    const mine = apps.filter((a) => ['mail', 'chat'].includes(a.id));
    const v = launcherView({ apps: mine, prefs: base({ pinned: ['crm', 'mail'] }) });
    expect(ids(v.pinned)).toEqual(['mail']);
    expect(ids(v.tiles)).toEqual(['mail', 'chat']);
  });

  it('shows no chips without groups, and the person\'s own groups with Other apps', () => {
    expect(launcherView({ apps, prefs: base({ groupBy: 'none' }) }).categories).toEqual([]);
    let p = base({ groupBy: 'mine' });
    const made = addGroup(p, 'Daily')!;
    p = moveToGroup(moveToGroup(made.prefs, 'mail', made.id), 'tasks', made.id);
    const v = launcherView({ apps, prefs: p });
    expect(v.categories.map((c) => c.label)).toEqual(['All apps', 'Daily', 'Other apps']);
    expect(ids(launcherView({ apps, prefs: p, category: made.id }).tiles)).toEqual(['mail', 'tasks']);
    // Under All apps, Daily comes first.
    expect(ids(v.tiles).slice(0, 2)).toEqual(['mail', 'tasks']);
    // An empty group of one's own still shows, to drop apps on.
    const empty = addGroup(p, 'Later')!.prefs;
    expect(launcherView({ apps, prefs: empty }).categories.some((c) => c.label === 'Later')).toBe(true);
  });
});

describe('the person\'s preferences', () => {
  it('pins at most 8, and reorders the pinned row', () => {
    let p = base();
    for (const id of ['mail', 'chat', 'tasks', 'calendar', 'files', 'notes', 'meet', 'crm']) p = pinApp(p, id)!;
    expect(p.pinned).toHaveLength(PIN_MAX);
    expect(pinApp(p, 'billing')).toBeNull();
    expect(pinApp(p, 'mail')).toBe(p);
    p = movePinned(p, 0, 2);
    expect(p.pinned.slice(0, 3)).toEqual(['chat', 'tasks', 'mail']);
    p = unpinApp(p, 'tasks');
    expect(p.pinned).not.toContain('tasks');
    expect(pinApp(p, 'billing')!.pinned.at(-1)).toBe('billing');
  });

  it('hides an app, which takes it off the pinned row; pinning shows it again', () => {
    let p = pinApp(base(), 'mail')!;
    p = setHidden(p, 'mail', true);
    expect(p.hidden).toEqual(['mail']);
    expect(p.pinned).toEqual([]);
    expect(setHidden(p, 'mail', false).hidden).toEqual([]);
    expect(pinApp(p, 'mail')!.hidden).toEqual([]);
  });

  it('makes, renames and removes groups; an app is in one group at most', () => {
    const a = addGroup(base(), 'Sales desk')!;
    expect(a.id).toBe('sales-desk');
    const b = addGroup(a.prefs, 'Sales desk')!;
    expect(b.id).toBe('sales-desk-2');
    expect(addGroup(base(), '   ')).toBeNull();
    let p = moveToGroup(b.prefs, 'crm', a.id);
    p = moveToGroup(p, 'crm', b.id);
    expect(p.groups.map((g) => g.apps)).toEqual([[], ['crm']]);
    expect(moveToGroup(p, 'crm', 'nope')).toBe(p);
    expect(moveToGroup(p, 'crm', null).groups.every((g) => g.apps.length === 0)).toBe(true);
    expect(renameGroup(p, a.id, 'Front').groups[0]!.name).toBe('Front');
    expect(renameGroup(p, a.id, ' ').groups[0]!.name).toBe('Sales desk');
    expect(removeGroup(p, b.id).groups.map((g) => g.id)).toEqual([a.id]);
  });

  it('sorts by my order, A to Z, or most used', () => {
    const some = apps.filter((a) => ['mail', 'chat', 'tasks', 'billing'].includes(a.id));
    expect(ids(sortApps(some, base({ sort: 'az' })))).toEqual(['chat', 'billing', 'mail', 'tasks']);
    let used = base({ sort: 'used' });
    used = noteUse(noteUse(noteUse(used, 'tasks'), 'tasks'), 'billing');
    expect(ids(sortApps(some, used))).toEqual(['tasks', 'billing', 'chat', 'mail']);
    const reordered = reorderApps(base({ sort: 'az' }), ['mail', 'chat', 'tasks', 'billing'], 'billing', 'mail');
    expect(reordered.sort).toBe('mine');
    expect(ids(sortApps(some, reordered))).toEqual(['billing', 'mail', 'chat', 'tasks']);
    // Dropped at the end.
    expect(reorderApps(base(), ['mail', 'chat'], 'mail', null).order).toEqual(['chat', 'mail']);
  });

  it('starts from the organization\'s pinned apps and order until the person sets their own, and Reset goes back to them', () => {
    const org = { pinned: ['mail', 'tasks', 'BAD id'], order: ['tasks', 'mail'] };
    expect(resolvePrefs(null, org)).toMatchObject({ pinned: ['mail', 'tasks'], order: ['tasks', 'mail'], size: 'compact', mode: 'popover', sort: 'mine', openIn: 'new-tab', shortcut: 'Mod+Shift+K' });
    const own = { ...defaultStoredPrefs(), pinned: ['chat'] };
    expect(resolvePrefs(own, org).pinned).toEqual(['chat']);
    expect(resolvePrefs(own, org).order).toEqual(['tasks', 'mail']);
    const reset = resetPrefs(123);
    expect(reset.updatedAt).toBe(123);
    expect(resolvePrefs(reset, org).pinned).toEqual(['mail', 'tasks']);
    expect(resolvePrefs(reset, { pinned: Array.from({ length: 12 }, (_, i) => `app${i}`) }).pinned).toHaveLength(PIN_MAX);
  });

  it('survives whatever is stored: bad values become defaults', () => {
    const p = normaliseStored({
      size: 'huge',
      mode: 'fullscreen',
      pinned: ['mail', 'mail', 7, 'chat', 'a', 'b', 'c', 'd', 'e', 'f', 'g'],
      hidden: 'mail',
      groups: [{ id: 'x', name: 'X', apps: ['mail'] }, { id: 'y', name: 'Y', apps: ['mail', 'chat'] }, { id: 'BAD', name: 'Z' }, { id: 'x', name: 'dupe' }],
      sort: 'random',
      openIn: 'window',
      shortcut: 'K',
      toggles: { recent: false, badges: 'yes' },
      usage: { mail: 3, chat: -1, 'BAD KEY': 2 },
      updatedAt: 'now',
    });
    expect(p.size).toBe('compact');
    expect(p.mode).toBe('fullscreen');
    expect(p.pinned).toEqual(['mail', 'chat', 'a', 'b', 'c', 'd', 'e', 'f']);
    expect(p.hidden).toEqual([]);
    expect(p.groups).toEqual([{ id: 'x', name: 'X', apps: ['mail'] }, { id: 'y', name: 'Y', apps: ['chat'] }]);
    expect(p.sort).toBe('mine');
    expect(p.openIn).toBe('window');
    expect(p.shortcut).toBe('Mod+Shift+K');
    expect(p.toggles).toEqual({ recent: false, badges: true, browserMark: true, names: true, sidebar: true });
    expect(p.usage).toEqual({ mail: 3 });
    expect(p.updatedAt).toBe(0);
    expect(normaliseStored(null)).toEqual(defaultStoredPrefs());
    expect(normaliseStored({ pinned: null, order: undefined })).toMatchObject({ pinned: null, order: null });
    expect(cleanIds(['ok', 'ok', 'NO', 3], 5)).toEqual(['ok']);
  });
});

describe('the launcher\'s shortcut', () => {
  const others = { search: 'Mod+K', palette: 'Mod+Shift+P', ai: 'Mod+Shift+A' };

  it('takes ⌘⇧K, never ⌘K, and nothing another command has', () => {
    expect(launcherShortcutProblem('Mod+Shift+K', others)).toBeNull();
    expect(launcherShortcutProblem('Mod+K', others)).toEqual({ kind: 'taken', command: 'search' });
    expect(launcherShortcutProblem('Mod+K', {})).toEqual({ kind: 'taken', command: 'search' });
    expect(launcherShortcutProblem('Mod+Shift+P', others)).toEqual({ kind: 'taken', command: 'palette' });
    expect(launcherShortcutProblem('Mod+Shift+P', { launcher: 'Mod+Shift+P' })).toBeNull();
  });

  it('needs ⌘/Ctrl or Alt: a plain or shifted key is typing', () => {
    expect(launcherShortcutProblem('K', others)).toEqual({ kind: 'modifier' });
    expect(launcherShortcutProblem('Shift+K', others)).toEqual({ kind: 'modifier' });
    expect(launcherShortcutProblem('Mod+Shift', others)).toEqual({ kind: 'modifier' });
    expect(launcherShortcutProblem('Alt+Space', others)).toBeNull();
  });
});
