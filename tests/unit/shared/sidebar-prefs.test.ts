import { describe, expect, it } from 'vitest';
import { APP_CATALOGUE, GUEST_APPS, navApps, visibleApps, type AppDefinition } from '@shared/apps';
import {
  applySidebarOp,
  EMPTY_SIDEBAR_PREFS,
  hiddenSidebarItems,
  mergeSidebar,
  moveKey,
  normaliseSidebarPrefs,
  reorderKeys,
  sidebarDefaults,
  type SidebarDefault,
  type SidebarPrefRow,
  type SidebarPrefsData,
  type SidebarSection,
} from '@shared/sidebar-prefs';

/** Each person's own sidebar (shared/sidebar-prefs): the merge over the apps through the gates, and each change. */

interface It {
  id: string;
}
const its = (...ids: string[]): It[] => ids.map((id) => ({ id }));
const defs = (section: SidebarSection, ...ids: string[]): Array<SidebarDefault<It>> => ids.map((id) => ({ item: { id }, section }));
const row = (key: string, patch: Partial<SidebarPrefRow> = {}): SidebarPrefRow => ({ key, parent: null, pinned: false, hidden: false, position: null, pinned_position: null, section: null, ...patch });
const ids = (xs: It[]) => xs.map((x) => x.id);

const DEFAULTS = [...defs('work', 'home', 'mail', 'chat', 'calendar', 'tasks'), ...defs('business', 'crm', 'sales', 'billing')];
const ALLOWED = [...DEFAULTS.map((d) => d.item), ...its('projects', 'payroll')];
const merge = (rows: SidebarPrefRow[], defaults = DEFAULTS, allowed: It[] = ALLOWED) => {
  const m = mergeSidebar(defaults, allowed, rows);
  return { pinned: ids(m.pinned), work: ids(m.work), business: ids(m.business) };
};

describe('mergeSidebar', () => {
  it('is the default sidebar with no preferences', () => {
    expect(merge([])).toEqual({ pinned: [], work: ['home', 'mail', 'chat', 'calendar', 'tasks'], business: ['crm', 'sales', 'billing'] });
  });

  it('puts pinned apps first, by pinned_position, and takes them out of their sections', () => {
    const m = merge([row('crm', { pinned: true, pinned_position: 1 }), row('chat', { pinned: true, pinned_position: 0 })]);
    expect(m.pinned).toEqual(['chat', 'crm']);
    expect(m.work).toEqual(['home', 'mail', 'calendar', 'tasks']);
    expect(m.business).toEqual(['sales', 'billing']);
  });

  it('pins an allowed app that is not in the sidebar by default (a browser app pinned from the launcher)', () => {
    expect(merge([row('projects', { pinned: true, pinned_position: 0 })]).pinned).toEqual(['projects']);
  });

  it('orders pinned apps without a pinned_position after the others, in default order', () => {
    const m = merge([row('projects', { pinned: true }), row('tasks', { pinned: true }), row('crm', { pinned: true, pinned_position: 5 }), row('mail', { pinned: true })]);
    expect(m.pinned).toEqual(['crm', 'mail', 'tasks', 'projects']);
  });

  it('leaves hidden apps out everywhere, a hidden pin too', () => {
    const m = merge([row('mail', { hidden: true }), row('crm', { hidden: true, pinned: true, pinned_position: 0 })]);
    expect(m).toEqual({ pinned: [], work: ['home', 'chat', 'calendar', 'tasks'], business: ['sales', 'billing'] });
  });

  it('orders a section by saved position', () => {
    const rows = ['tasks', 'calendar', 'chat', 'mail', 'home'].map((k, i) => row(k, { position: i }));
    expect(merge(rows).work).toEqual(['tasks', 'calendar', 'chat', 'mail', 'home']);
  });

  it('never draws an app the person cannot open, however it was saved', () => {
    const allowed = ALLOWED.filter((a) => a.id !== 'chat' && a.id !== 'crm' && a.id !== 'payroll');
    const rows = [row('chat', { pinned: true, pinned_position: 0 }), row('payroll', { pinned: true, pinned_position: 1 }), row('crm', { position: 0 }), row('admin', { pinned: true, pinned_position: 2 })];
    const m = merge(rows, DEFAULTS, allowed);
    expect(m.pinned).toEqual([]);
    expect([...m.work, ...m.business]).not.toContain('chat');
    expect(m.business).toEqual(['sales', 'billing']);
  });

  it('never adds an app from a preference: an unknown key, or a non-default app that is not pinned', () => {
    const m = merge([row('ghost', { position: 0 }), row('projects', { position: 0 }), row('payroll', { hidden: false, position: 2 })]);
    expect([...m.pinned, ...m.work, ...m.business]).not.toContain('ghost');
    expect([...m.work, ...m.business]).not.toContain('projects');
    expect([...m.work, ...m.business]).not.toContain('payroll');
  });

  it('shows a newly available app at its default place among a saved order (after its default neighbour)', () => {
    // Saved before Meetings existed for the person: tasks, calendar, chat, mail, home.
    const rows = ['tasks', 'calendar', 'chat', 'mail', 'home'].map((k, i) => row(k, { position: i }));
    const defaults = [...defs('work', 'home', 'mail', 'chat', 'calendar', 'meetings', 'tasks'), ...defs('business', 'crm')];
    const allowed = [...defaults.map((d) => d.item)];
    expect(merge(rows, defaults, allowed).work).toEqual(['tasks', 'calendar', 'meetings', 'chat', 'mail', 'home']);
  });

  it('puts a new app that is first by default first, and keeps several new ones in their default order', () => {
    const rows = [row('chat', { position: 0 }), row('mail', { position: 1 })];
    const defaults = defs('work', 'activity', 'home', 'mail', 'chat', 'phone', 'meet');
    expect(merge(rows, defaults, defaults.map((d) => d.item)).work).toEqual(['activity', 'home', 'chat', 'phone', 'meet', 'mail']);
  });

  it('keeps the saved order when nothing is new', () => {
    const rows = [row('sales', { position: 0 }), row('billing', { position: 1 }), row('crm', { position: 2 })];
    expect(merge(rows).business).toEqual(['sales', 'billing', 'crm']);
  });

  it('breaks equal positions by default order', () => {
    const rows = [row('tasks', { position: 0 }), row('home', { position: 0 }), row('chat', { position: 1 }), row('mail', { position: 1 }), row('calendar', { position: 2 })];
    expect(merge(rows).work).toEqual(['home', 'tasks', 'mail', 'chat', 'calendar']);
  });

  it('returns an unpinned app to its own place: its saved position, else its default slot', () => {
    // Pinned while its section was reordered (tasks, calendar…), then unpinned: back after its default neighbour.
    const rows = [row('tasks', { position: 0 }), row('calendar', { position: 1 }), row('home', { position: 2 }), row('mail', { position: 3 })];
    expect(merge(rows).work).toEqual(['tasks', 'calendar', 'home', 'mail', 'chat']);
    expect(merge([...rows.slice(0, 2), row('chat', { position: 1.5 }), ...rows.slice(2)]).work).toEqual(['tasks', 'calendar', 'chat', 'home', 'mail']);
  });

  it('reads only top-level rows (the desktop has no submenus), the first for each key', () => {
    const m = merge([row('mail', { parent: 'chat', hidden: true }), row('crm', { pinned: true, pinned_position: 0 }), row('crm', { hidden: true })]);
    expect(m.work).toContain('mail');
    expect(m.pinned).toEqual(['crm']);
  });

  it('ignores a position saved in another section than the app is in now (the server’s rule)', () => {
    // Saved by the web, whose blocks are not the desktop's: CRM was last in its `core`; it takes its default place here.
    const placed = [row('billing', { position: 0, section: 'business' }), row('sales', { position: 1, section: 'business' })];
    expect(merge([row('crm', { position: 2, section: 'core' }), ...placed]).business).toEqual(['crm', 'billing', 'sales']);
    // A position with no section stored is used.
    expect(merge([row('crm', { position: 2 }), ...placed]).business).toEqual(['billing', 'sales', 'crm']);
    // Saved in `work`, the app now in `business`: its default place.
    expect(merge([row('sales', { position: 0, section: 'work' })]).business).toEqual(['crm', 'sales', 'billing']);
  });

  it('keeps sections apart: a position never moves an app into another section', () => {
    const m = merge([row('crm', { position: 0 }), row('home', { position: 9 })]);
    expect(m.business[0]).toBe('crm');
    expect(m.work).not.toContain('crm');
  });

  it('works on the real catalogue: everything through the gates, nothing else', () => {
    const apps = navApps(visibleApps({ apps: ['mail', 'chat', 'crm', 'projects'], permissions: ['crm.view'] }));
    const defaults = sidebarDefaults(apps);
    const m = mergeSidebar(defaults, apps, [row('projects', { pinned: true, pinned_position: 0 }), row('finance', { pinned: true, pinned_position: 1 })]);
    expect(m.pinned.map((a) => a.id)).toEqual(['projects']);
    expect(m.work.map((a) => a.id)).toEqual(apps.filter((a) => a.sidebar === 'work' && a.surface === 'native').map((a) => a.id));
    expect(m.business.map((a) => a.id)).toContain('crm');
  });
});

describe('sidebarDefaults', () => {
  it('lists native apps by their section, in order; browser apps and apps without a section are not there', () => {
    const d = sidebarDefaults(APP_CATALOGUE as AppDefinition[]);
    expect(d.every((x) => x.item.surface === 'native' && x.item.sidebar === x.section)).toBe(true);
    expect(d.map((x) => x.item.id)).not.toContain('projects');
    expect(d.map((x) => x.item.id)).not.toContain('notes');
  });

  it('puts all of guest mode’s apps in one section', () => {
    const d = sidebarDefaults(GUEST_APPS, true);
    expect(d.map((x) => x.item.id)).toEqual(GUEST_APPS.map((a) => a.id));
    expect(new Set(d.map((x) => x.section))).toEqual(new Set(['work']));
  });
});

describe('hiddenSidebarItems', () => {
  it('lists the removed apps that Restore would bring back: allowed and in the sidebar by default', () => {
    const rows = [row('mail', { hidden: true }), row('crm', { hidden: true }), row('projects', { hidden: true }), row('ghost', { hidden: true })];
    const allowed = ALLOWED.filter((a) => a.id !== 'crm');
    expect(ids(hiddenSidebarItems(DEFAULTS, allowed, rows))).toEqual(['mail']);
  });
});

describe('applySidebarOp', () => {
  const data = (...items: SidebarPrefRow[]): SidebarPrefsData => ({ items, updated_at: 'then' });

  it('pins to the end of Pinned', () => {
    const d = applySidebarOp(data(row('crm', { pinned: true, pinned_position: 3 })), { kind: 'pin', key: 'mail', pinned: true });
    expect(d.items.find((r) => r.key === 'mail')).toMatchObject({ pinned: true, pinned_position: 4 });
    expect(applySidebarOp(EMPTY_SIDEBAR_PREFS, { kind: 'pin', key: 'mail', pinned: true }).items).toEqual([row('mail', { pinned: true, pinned_position: 0 })]);
  });

  it('changes nothing pinning what is pinned', () => {
    const d = data(row('mail', { pinned: true, pinned_position: 0 }));
    expect(applySidebarOp(d, { kind: 'pin', key: 'mail', pinned: true })).toBe(d);
  });

  it('shows a removed app again by pinning it, as the server does', () => {
    const removed = data(row('crm', { hidden: true, position: 3, section: 'business' }), row('mail', { pinned: true, pinned_position: 0 }));
    expect(applySidebarOp(removed, { kind: 'pin', key: 'crm', pinned: true }).items[0]).toEqual(row('crm', { pinned: true, pinned_position: 1, position: 3, section: 'business' }));
    // Pinned and hidden (an older row): shown, where it was in Pinned.
    const both = data(row('crm', { pinned: true, hidden: true, pinned_position: 4 }));
    expect(applySidebarOp(both, { kind: 'pin', key: 'crm', pinned: true }).items).toEqual([row('crm', { pinned: true, pinned_position: 4 })]);
  });

  it('unpins, keeping the app’s own position, and drops a row left at its defaults', () => {
    const d = data(row('mail', { pinned: true, pinned_position: 0, position: 2 }), row('crm', { pinned: true, pinned_position: 1 }));
    const after = applySidebarOp(applySidebarOp(d, { kind: 'pin', key: 'mail', pinned: false }), { kind: 'pin', key: 'crm', pinned: false });
    expect(after.items).toEqual([row('mail', { position: 2 })]);
  });

  it('hides, which also unpins and keeps its position; shows again', () => {
    const hidden = applySidebarOp(data(row('mail', { pinned: true, pinned_position: 0 })), { kind: 'hide', key: 'mail', hidden: true });
    expect(hidden.items).toEqual([row('mail', { hidden: true })]);
    expect(applySidebarOp(hidden, { kind: 'hide', key: 'mail', hidden: false }).items).toEqual([]);
    const placed = applySidebarOp(data(row('chat', { position: 2, section: 'work' })), { kind: 'hide', key: 'chat', hidden: true });
    expect(placed.items).toEqual([row('chat', { hidden: true, position: 2, section: 'work' })]);
  });

  it('orders Pinned: positions 0…n−1 for the pinned apps listed', () => {
    const d = data(row('a', { pinned: true, pinned_position: 0 }), row('b', { pinned: true, pinned_position: 1 }));
    const after = applySidebarOp(d, { kind: 'order', body: { scope: 'pinned', keys: ['b', 'a', 'c'] } });
    expect(after.items).toEqual([row('a', { pinned: true, pinned_position: 1 }), row('b', { pinned: true, pinned_position: 0 })]);
  });

  it('orders a section: positions 0…n−1, with the section kept beside each', () => {
    const after = applySidebarOp(data(row('chat', { hidden: true })), { kind: 'order', body: { scope: 'section', section: 'work', keys: ['tasks', 'home'] } });
    expect(after.items).toEqual([row('chat', { hidden: true }), row('tasks', { position: 0, section: 'work' }), row('home', { position: 1, section: 'work' })]);
  });

  it('resets to nothing, and stamps the time given', () => {
    expect(applySidebarOp(data(row('a', { hidden: true })), { kind: 'reset' }, 'now')).toEqual({ items: [], updated_at: 'now' });
  });

  it('round-trips through the merge: pin, reorder, hide, unpin', () => {
    let d: SidebarPrefsData = EMPTY_SIDEBAR_PREFS;
    d = applySidebarOp(d, { kind: 'pin', key: 'crm', pinned: true });
    d = applySidebarOp(d, { kind: 'pin', key: 'projects', pinned: true });
    d = applySidebarOp(d, { kind: 'order', body: { scope: 'pinned', keys: ['projects', 'crm'] } });
    d = applySidebarOp(d, { kind: 'order', body: { scope: 'section', section: 'work', keys: ['chat', 'home', 'mail', 'calendar', 'tasks'] } });
    d = applySidebarOp(d, { kind: 'hide', key: 'calendar', hidden: true });
    expect(merge(d.items)).toEqual({ pinned: ['projects', 'crm'], work: ['chat', 'home', 'mail', 'tasks'], business: ['sales', 'billing'] });
    d = applySidebarOp(d, { kind: 'pin', key: 'crm', pinned: false });
    expect(merge(d.items).business).toEqual(['crm', 'sales', 'billing']);
  });
});

describe('normaliseSidebarPrefs', () => {
  it('reads the server’s state, as a PHP server may send it', () => {
    const d = normaliseSidebarPrefs({
      items: [
        { key: 'crm', parent: null, pinned: '1', hidden: 0, position: '2', pinned_position: 3, section: 'business', extra: true },
        { key: 'hr', pinned: false, pinned_position: 5, section: '' },
      ],
      updated_at: '2026-10-07T09:00:00+00:00',
    });
    expect(d).toEqual({ items: [row('crm', { pinned: true, position: 2, pinned_position: 3, section: 'business' }), row('hr')], updated_at: '2026-10-07T09:00:00+00:00' });
  });

  it('drops rows without a usable key, and is null for what is not the state at all', () => {
    expect(normaliseSidebarPrefs({ items: [{ key: '' }, { key: 5 }, null, { key: 'x'.repeat(101) }, { key: 'mail' }] })?.items).toEqual([row('mail')]);
    expect(normaliseSidebarPrefs(null)).toBeNull();
    expect(normaliseSidebarPrefs({ prefs: null })).toBeNull();
    expect(normaliseSidebarPrefs({ items: 'nope' })).toBeNull();
  });
});

describe('reorderKeys and moveKey', () => {
  it('puts the dragged key before or after the target', () => {
    expect(reorderKeys(['a', 'b', 'c', 'd'], 'd', 'b', 'before')).toEqual(['a', 'd', 'b', 'c']);
    expect(reorderKeys(['a', 'b', 'c', 'd'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a', 'd']);
    expect(reorderKeys(['a', 'b', 'c'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a']);
  });

  it('is the same array when nothing moves, or a key is not in the list', () => {
    const keys = ['a', 'b', 'c'];
    expect(reorderKeys(keys, 'a', 'a', 'before')).toBe(keys);
    expect(reorderKeys(keys, 'a', 'b', 'before')).toBe(keys);
    expect(reorderKeys(keys, 'b', 'a', 'after')).toBe(keys);
    expect(reorderKeys(keys, 'x', 'a', 'before')).toBe(keys);
    expect(reorderKeys(keys, 'a', 'x', 'before')).toBe(keys);
  });

  it('moves one place up or down, and not past either end', () => {
    expect(moveKey(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveKey(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    const keys = ['a', 'b'];
    expect(moveKey(keys, 'a', -1)).toBe(keys);
    expect(moveKey(keys, 'b', 1)).toBe(keys);
    expect(moveKey(keys, 'x', 1)).toBe(keys);
  });
});
