import { describe, expect, it } from 'vitest';
import { APP_CATALOGUE, navApps, type AppDefinition } from '@shared/apps';
import {
  addGroup,
  cleanIds,
  columnsFor,
  defaultStoredPrefs,
  gridStep,
  launcherLayout,
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

describe('launcher size and place', () => {
  const full = (w: number, h: number) => ({ left: 0, top: 0, width: w, height: h });

  it('is a 760×600 popover in a big window, centred under the title bar', () => {
    const l = launcherLayout(full(1440, 900), { mode: 'popover', size: 'compact' });
    expect(l).toMatchObject({ kind: 'popover', width: 760, height: 600, left: 340, top: 56, icon: 44, columns: null });
  });

  it('never takes more than 90% of the window, and stays inside it, at every width from 1024 up', () => {
    for (let w = 1024; w <= 2560; w += 37) {
      for (const h of [640, 700, 768, 900, 1440]) {
        const l = launcherLayout(full(w, h), { mode: 'popover', size: 'large' });
        expect(l.width).toBeLessThanOrEqual(Math.floor(w * 0.9));
        expect(l.height).toBeLessThanOrEqual(Math.floor(h * 0.9));
        expect(l.left).toBeGreaterThanOrEqual(0);
        expect(l.top).toBeGreaterThanOrEqual(0);
        expect(l.left + l.width).toBeLessThanOrEqual(w);
        expect(l.top + l.height).toBeLessThanOrEqual(h);
      }
    }
    // The main window's smallest: 1024×640 → 576 high, not 600.
    expect(launcherLayout(full(1024, 640), { mode: 'popover', size: 'compact' }).height).toBe(576);
  });

  it('keeps clear of the Dock: the part of the window under it is not used', () => {
    // A 1440×900 window on a 1440×900 screen whose Dock takes the bottom 80px.
    const area = visibleArea({ innerWidth: 1440, innerHeight: 900, outerWidth: 1440, outerHeight: 900, screenX: 0, screenY: 0 }, { availLeft: 0, availTop: 0, availWidth: 1440, availHeight: 820 });
    expect(area).toEqual({ left: 0, top: 0, width: 1440, height: 820 });
    const l = launcherLayout(area, { mode: 'popover', size: 'compact' });
    expect(l.top + l.height).toBeLessThanOrEqual(820);
    // A taskbar on the left, and the menu bar above a window that starts under it.
    expect(visibleArea({ innerWidth: 1200, innerHeight: 800, screenX: 0, screenY: 0 }, { availLeft: 60, availTop: 25, availWidth: 1860, availHeight: 1055 })).toEqual({ left: 60, top: 25, width: 1140, height: 775 });
    const fs = launcherLayout(area, { mode: 'fullscreen', size: 'compact' });
    expect(fs.top + fs.height).toBe(820);
  });

  it('uses the whole window when there is no work area to go by', () => {
    expect(visibleArea({ innerWidth: 1280, innerHeight: 800 }, null)).toEqual(full(1280, 800));
    expect(visibleArea({ innerWidth: 1280, innerHeight: 800, screenX: 0, screenY: 0 }, { availWidth: 0, availHeight: 0 })).toEqual(full(1280, 800));
    // Numbers from another screen altogether: not nothing.
    expect(visibleArea({ innerWidth: 1280, innerHeight: 800, screenX: 5000, screenY: 0 }, { availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1080 })).toEqual(full(1280, 800));
  });

  it('is a bottom sheet of four columns and 48px icons below 480px', () => {
    const l = launcherLayout(full(400, 800), { mode: 'popover', size: 'large' });
    expect(l).toMatchObject({ kind: 'sheet', columns: 4, icon: 48, width: 400, left: 0, height: 720 });
    expect(l.top + l.height).toBe(800);
    expect(launcherLayout(full(479, 700), { mode: 'fullscreen', size: 'compact' }).kind).toBe('sheet');
    expect(launcherLayout(full(480, 700), { mode: 'popover', size: 'compact' }).kind).toBe('popover');
  });

  it('has three icon sizes and a full-screen mode', () => {
    expect(launcherLayout(full(1280, 800), { mode: 'popover', size: 'compact' }).icon).toBe(44);
    expect(launcherLayout(full(1280, 800), { mode: 'popover', size: 'comfortable' }).icon).toBe(52);
    expect(launcherLayout(full(1280, 800), { mode: 'popover', size: 'large' }).icon).toBe(64);
    expect(launcherLayout(full(1280, 800), { mode: 'fullscreen', size: 'compact' })).toMatchObject({ kind: 'fullscreen', left: 0, top: 0, width: 1280, height: 800 });
  });

  it('fits as many 88px columns as the grid is wide', () => {
    expect(columnsFor(728)).toBe(8);
    expect(columnsFor(88)).toBe(1);
    expect(columnsFor(178)).toBe(2);
    expect(columnsFor(0)).toBe(1);
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
    expect(p.toggles).toEqual({ recent: false, badges: true, browserMark: true, names: true });
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
