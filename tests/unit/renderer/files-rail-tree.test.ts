import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: true, platform: 'darwin', registerDropped: vi.fn() }));

const { canDropInto, dropZone, folderCaps, folderKind, railActions, renameProblem, reorderIds, sortTree, treeKey, visibleRows, childrenOf, siblingsOf } = await import('../../../src/modules/files/railTree');
const { railFolderMenu, quickLinkMenu, foldersHeadMenu, FOLDER_COLOURS } = await import('../../../src/modules/files/railMenu');
import type { ItemAccess, TreeNode } from '../../../src/modules/files/api';
import type { RailEnv } from '../../../src/modules/files/railTree';
import type { Drive } from '../../../src/modules/files/ctx';

const node = (id: number, name: string, over: Partial<TreeNode> = {}, children: TreeNode[] = []): TreeNode =>
  ({ id, parent_id: null, name, description: null, path: name, color: null, is_archived: false, is_locked: false, file_count: 0, total_size: 0, starred: false, children, ...over }) as TreeNode;

const access = (over: Partial<ItemAccess>): ItemAccess => ({ level: 'view', owner: false, via: 'direct', can_download: true, capabilities: ['open', 'preview', 'download', 'copy_link'], ...over });

const ENV: RailEnv = { syncAvailable: true, synced: false, docs: true };
const flat = (groups: ReturnType<typeof railActions>) => groups.flatMap((g) => g.actions);

/*
 *  Business (1)
 *    Clients (2)
 *      Acme (3)
 *    Invoices (4)
 *  CareMe (5)
 *  Tenders (6, system)
 */
const tree = (): TreeNode[] => [
  node(1, 'Business', {}, [node(2, 'Clients', { parent_id: 1 }, [node(3, 'Acme', { parent_id: 2 })]), node(4, 'Invoices', { parent_id: 1 })]),
  node(5, 'CareMe'),
  node(6, 'Tenders', { is_system: true, system_by: 'Created by Tenders' }),
];

describe('which actions a folder menu offers', () => {
  it('gives my own folder every group, in the order of the design', () => {
    const groups = railActions(node(1, 'Business'), ENV);
    expect(groups.map((g) => g.group)).toEqual(['open', 'create', 'share', 'organise', 'offline', 'info', 'other', 'danger']);
    expect(flat(groups)).toEqual([
      'open', 'open-tab', 'open-window',
      'new-folder', 'upload-files', 'upload-folder', 'new-doc',
      'share', 'copy-link', 'manage-access',
      'rename', 'move', 'copy', 'colour', 'star', 'pin',
      'offline',
      'details', 'activity', 'versions',
      'zip',
      'bin',
    ]);
  });

  it('hides Rename, Move, Bin and the rest a view-only share does not allow, and offers Leave instead of Delete', () => {
    const f = node(9, 'Shared plans', { access: access({}) });
    expect(folderKind(f)).toBe('shared');
    const acts = flat(railActions(f, ENV));
    for (const no of ['rename', 'move', 'bin', 'share', 'manage-access', 'colour', 'new-folder', 'upload-files', 'offline']) expect(acts).not.toContain(no);
    expect(acts).toEqual(expect.arrayContaining(['open', 'copy-link', 'copy', 'star', 'pin', 'details', 'zip', 'leave']));
  });

  it('says Remove from my Drive when the folder reaches me through a team rather than as a person', () => {
    const acts = flat(railActions(node(9, 'Team folder', { access: access({ via: 'inherited', level: 'edit', capabilities: ['open', 'download', 'add_files', 'rename', 'edit'] }) }), ENV));
    expect(acts).toContain('remove');
    expect(acts).not.toContain('leave');
    expect(acts).toEqual(expect.arrayContaining(['new-folder', 'rename', 'colour']));
  });

  it('keeps a system folder’s name and place, whatever its access says', () => {
    const f = node(6, 'Tenders', { is_system: true, access: access({ owner: true, via: 'owner', level: 'full', capabilities: ['open', 'download', 'rename', 'move', 'delete', 'share', 'add_files', 'edit'] }) });
    expect(folderKind(f)).toBe('system');
    expect([...folderCaps(f)]).not.toEqual(expect.arrayContaining(['rename']));
    const acts = flat(railActions(f, ENV));
    for (const no of ['rename', 'move', 'bin', 'leave', 'remove']) expect(acts).not.toContain(no);
    expect(acts).toEqual(expect.arrayContaining(['open', 'share', 'star', 'colour', 'new-folder']));
  });

  it('offers Available offline only where sync is, never for a locked folder, and Show in Finder only when kept here', () => {
    expect(flat(railActions(node(1, 'A'), { ...ENV, syncAvailable: false }))).not.toContain('offline');
    expect(flat(railActions(node(1, 'A', { is_locked: true }), ENV))).not.toContain('offline');
    expect(flat(railActions(node(1, 'A'), ENV))).not.toContain('reveal');
    expect(flat(railActions(node(1, 'A'), { ...ENV, synced: true }))).toContain('reveal');
    expect(flat(railActions(node(1, 'A'), { ...ENV, docs: false }))).not.toContain('new-doc');
  });
});

describe('the menu built from them', () => {
  // Every Drive action a spy, the same one each time it is asked for.
  const drive = () => new Proxy<Record<string, unknown>>({ officeRouting: { legacy: false } }, { get: (t, k: string) => (t[k] ??= vi.fn()) }) as never as Drive;

  it('separates the groups, says how many files go to the bin, and runs the same Drive actions', () => {
    const d = drive();
    const rename = vi.fn();
    const n = node(1, 'Business', { file_count: 12 });
    const items = railFolderMenu(n, d, ENV, { rename });
    const labels = items.map((m) => ('sep' in m ? '—' : m.label));
    expect(labels.slice(0, 4)).toEqual(['Open', 'Open in new tab', 'Open in new window', '—']);
    expect(labels).toContain('Pin to top');
    expect(labels.filter((l) => l === '—')).toHaveLength(7);
    const bin = items.find((m) => !('sep' in m) && m.label === 'Move to Bin…');
    expect(bin && !('sep' in bin) && bin.hint).toBe('12 files');
    const pick = (label: string) => {
      const m = items.find((x) => !('sep' in x) && x.label === label);
      if (!m || 'sep' in m) throw new Error(label);
      return m;
    };
    pick('Rename').run();
    expect(rename).toHaveBeenCalledWith(n);
    pick('Upload files here…').run();
    expect(d.upload).toHaveBeenCalledWith(1);
    pick('New folder inside…').run();
    expect(d.newFolder).toHaveBeenCalledWith(1);
    pick('Copy to…').run();
    expect(d.move).toHaveBeenCalledWith([{ type: 'folder', f: n }], 'copy');
    const colour = pick('Change colour');
    expect(colour.submenu?.map((m) => ('sep' in m ? '' : m.label))).toEqual(FOLDER_COLOURS.map((c) => c.label));
    const red = colour.submenu!.find((m) => !('sep' in m) && m.label === 'Red');
    if (red && !('sep' in red)) red.run();
    expect(d.setColour).toHaveBeenCalledWith(n, '#d93f3f');
    pick('New document').submenu!.forEach((m) => !('sep' in m) && m.run());
    expect(d.newDocument).toHaveBeenCalledWith('spreadsheet', 1);
    pick('Open in new window').run();
    expect(d.openPlaceIn).toHaveBeenCalledWith({ view: 'folder', folder: 1 }, 'window');
  });

  it('gives quick links their own few actions', () => {
    const d = drive();
    const go = { open: vi.fn(), storage: vi.fn(), openIn: vi.fn() };
    const names = (v: Parameters<typeof quickLinkMenu>[0]) => quickLinkMenu(v, d, go)?.map((m) => ('sep' in m ? '—' : m.label)) ?? null;
    expect(names('folder')).toEqual(['New folder', 'Upload files', '—', 'Storage details']);
    expect(names('recent')).toContain('Clear recent list');
    expect(names('starred')).toContain('Unstar all…');
    expect(names('shared')).toEqual(['Open', 'Open in new tab']);
    expect(names('my_shares')).toEqual(['Open', 'Open in new tab']);
    expect(names('home')).toBeNull();
    const tab = quickLinkMenu('shared', d, go)!.find((m) => !('sep' in m) && m.label === 'Open in new tab');
    if (tab && !('sep' in tab)) tab.run();
    expect(go.openIn).toHaveBeenCalledWith('tab');
  });

  it('gives the Folders header New folder, Sort by, Collapse all and Show starred first', () => {
    const d = drive();
    const set = { sort: vi.fn(), starredFirst: vi.fn(), collapseAll: vi.fn() };
    const items = foldersHeadMenu(d, { sort: 'manual', starredFirst: false }, set);
    expect(items.map((m) => ('sep' in m ? '—' : m.label))).toEqual(['New folder', '—', 'Sort by', 'Collapse all', 'Show starred first']);
    const sort = items[2]!;
    if ('sep' in sort) throw new Error('sort');
    expect(sort.submenu!.map((m) => ('sep' in m ? '' : `${m.label}${m.hint ?? ''}`))).toEqual(['Name', 'Modified', 'Manual✓']);
  });
});

describe('the order folders are shown in', () => {
  const names = (ns: TreeNode[]) => ns.map((n) => n.name);
  const list = () => [
    node(1, 'beta', { updated_at: '2026-10-01 09:00:00', sort_order: 30 }),
    node(2, 'Alpha 10', { updated_at: '2026-10-03 09:00:00', sort_order: 10, starred: true }),
    node(3, 'Alpha 9', { updated_at: '2026-09-01 09:00:00', sort_order: 20 }),
    node(4, 'gamma', { updated_at: '2026-10-02 09:00:00', sort_order: 40, pinned: true }),
  ];

  it('sorts by name naturally, newest first, or by hand — pinned always on top', () => {
    expect(names(sortTree(list(), { sort: 'name', starredFirst: false }))).toEqual(['gamma', 'Alpha 9', 'Alpha 10', 'beta']);
    expect(names(sortTree(list(), { sort: 'modified', starredFirst: false }))).toEqual(['gamma', 'Alpha 10', 'beta', 'Alpha 9']);
    expect(names(sortTree(list(), { sort: 'manual', starredFirst: false }))).toEqual(['gamma', 'Alpha 10', 'Alpha 9', 'beta']);
  });

  it('puts starred ones next when asked, and sorts every level', () => {
    expect(names(sortTree(list(), { sort: 'name', starredFirst: true }))).toEqual(['gamma', 'Alpha 10', 'Alpha 9', 'beta']);
    const nested = sortTree([node(1, 'Top', {}, [node(3, 'b', { parent_id: 1 }), node(2, 'a', { parent_id: 1 })])], { sort: 'name', starredFirst: false });
    expect(names(nested[0]!.children)).toEqual(['a', 'b']);
  });
});

describe('the keyboard in the tree', () => {
  const rows = (open: number[] = []) => visibleRows(tree(), new Set(open));

  it('lists what can be seen, with each row’s level and place among its siblings', () => {
    expect(rows().map((r) => r.id)).toEqual([1, 5, 6]);
    const r = rows([1, 2]);
    expect(r.map((x) => [x.id, x.depth])).toEqual([[1, 0], [2, 1], [3, 2], [4, 1], [5, 0], [6, 0]]);
    expect(r.find((x) => x.id === 4)).toMatchObject({ pos: 2, size: 2, parent: 1, hasChildren: false });
    expect(r.find((x) => x.id === 1)).toMatchObject({ expanded: true, hasChildren: true });
  });

  it('moves with the arrows, Home and End', () => {
    const r = rows([1]);
    expect(treeKey(r, 1, { key: 'ArrowDown' }, true)).toEqual({ kind: 'focus', id: 2 });
    expect(treeKey(r, 2, { key: 'ArrowUp' }, true)).toEqual({ kind: 'focus', id: 1 });
    expect(treeKey(r, 6, { key: 'ArrowDown' }, true)).toBeNull();
    expect(treeKey(r, 4, { key: 'Home' }, true)).toEqual({ kind: 'focus', id: 1 });
    expect(treeKey(r, 1, { key: 'End' }, true)).toEqual({ kind: 'focus', id: 6 });
    expect(treeKey(r, null, { key: 'ArrowDown' }, true)).toEqual({ kind: 'focus', id: 1 });
  });

  it('opens and closes with → and ←, and goes into a folder or up to its parent', () => {
    expect(treeKey(rows(), 1, { key: 'ArrowRight' }, true)).toEqual({ kind: 'expand', id: 1 });
    expect(treeKey(rows([1]), 1, { key: 'ArrowRight' }, true)).toEqual({ kind: 'focus', id: 2 });
    expect(treeKey(rows([1]), 4, { key: 'ArrowRight' }, true)).toBeNull();
    expect(treeKey(rows([1]), 1, { key: 'ArrowLeft' }, true)).toEqual({ kind: 'collapse', id: 1 });
    expect(treeKey(rows([1]), 4, { key: 'ArrowLeft' }, true)).toEqual({ kind: 'focus', id: 1 });
    expect(treeKey(rows([1]), 5, { key: 'ArrowLeft' }, true)).toBeNull();
  });

  it('opens with Enter, renames with F2, bins with ⌘⌫ (Ctrl+Backspace elsewhere) and opens the menu with ⇧F10 or the Menu key', () => {
    const r = rows();
    expect(treeKey(r, 5, { key: 'Enter' }, true)).toEqual({ kind: 'open', id: 5 });
    expect(treeKey(r, 5, { key: 'F2' }, true)).toEqual({ kind: 'rename', id: 5 });
    expect(treeKey(r, 5, { key: 'Backspace', metaKey: true }, true)).toEqual({ kind: 'bin', id: 5 });
    expect(treeKey(r, 5, { key: 'Backspace', ctrlKey: true }, true)).toBeNull();
    expect(treeKey(r, 5, { key: 'Backspace', ctrlKey: true }, false)).toEqual({ kind: 'bin', id: 5 });
    expect(treeKey(r, 5, { key: 'Backspace' }, true)).toBeNull();
    expect(treeKey(r, 5, { key: 'F10', shiftKey: true }, true)).toEqual({ kind: 'menu', id: 5 });
    expect(treeKey(r, 5, { key: 'F10' }, true)).toBeNull();
    expect(treeKey(r, 5, { key: 'ContextMenu' }, true)).toEqual({ kind: 'menu', id: 5 });
    expect(treeKey(r, 5, { key: 'a' }, true)).toBeNull();
  });
});

describe('where a dragged folder may go', () => {
  it('never into itself or anything inside it', () => {
    expect(canDropInto(tree(), [1], 1)).toBe(false);
    expect(canDropInto(tree(), [1], 2)).toBe(false);
    expect(canDropInto(tree(), [1], 3)).toBe(false);
    expect(canDropInto(tree(), [2], 4)).toBe(true);
    expect(canDropInto(tree(), [3], 5)).toBe(true);
    expect(canDropInto(tree(), [2], null)).toBe(true);
    expect(canDropInto(tree(), [], 3)).toBe(true);
    expect(canDropInto(tree(), [5, 1], 3)).toBe(false);
  });

  it('never moves a system folder', () => {
    expect(canDropInto(tree(), [6], 5)).toBe(false);
    expect(canDropInto(tree(), [6], null)).toBe(false);
  });

  it('places beside a row at its top or bottom quarter, inside it otherwise — and only inside unless reordering', () => {
    expect(dropZone(2, 28, true)).toBe('before');
    expect(dropZone(14, 28, true)).toBe('inside');
    expect(dropZone(26, 28, true)).toBe('after');
    expect(dropZone(2, 28, false)).toBe('inside');
  });

  it('works out the siblings’ new order', () => {
    expect(reorderIds([1, 5, 6], 6, 1, 'before')).toEqual([6, 1, 5]);
    expect(reorderIds([1, 5, 6], 1, 5, 'after')).toEqual([5, 1, 6]);
    expect(reorderIds([2, 4], 3, 2, 'after')).toEqual([2, 3, 4]);
    expect(reorderIds([2, 4], 3, 99, 'before')).toEqual([2, 4, 3]);
  });

  it('finds a folder’s siblings and children', () => {
    expect(siblingsOf(tree(), 4).map((n) => n.id)).toEqual([2, 4]);
    expect(siblingsOf(tree(), 5).map((n) => n.id)).toEqual([1, 5, 6]);
    expect(childrenOf(tree(), 2).map((n) => n.id)).toEqual([3]);
    expect(childrenOf(tree(), null).map((n) => n.id)).toEqual([1, 5, 6]);
  });
});

describe('a new name', () => {
  const sibs = [node(2, 'Clients'), node(4, 'Invoices')];
  it('may not be empty, a path, or one already beside it (whatever its case)', () => {
    expect(renameProblem('  ', sibs, 2)).toMatch(/needs a name/);
    expect(renameProblem('a/b', sibs, 2)).toMatch(/can’t contain/);
    expect(renameProblem('invoices', sibs, 2)).toBe('There is already a folder called “invoices” here.');
    expect(renameProblem('Clients', sibs, 2)).toBeNull();
    expect(renameProblem('Quotes', sibs, 2)).toBeNull();
    expect(renameProblem('x'.repeat(121), sibs, 2)).toMatch(/120/);
  });
});
