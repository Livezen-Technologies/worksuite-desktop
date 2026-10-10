// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TreeNode } from '../../../src/modules/files/api';
import type { Drive } from '../../../src/modules/files/ctx';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: true, platform: 'darwin', registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

const { toast } = await import('../../../src/core/toasts');
const { DriveCtx } = await import('../../../src/modules/files/ctx');
const { Rail, HOVER_OPEN_MS } = await import('../../../src/modules/files/Rail');

const node = (id: number, name: string, over: Partial<TreeNode> = {}, children: TreeNode[] = []): TreeNode =>
  ({ id, parent_id: null, name, description: null, path: name, color: null, is_archived: false, is_locked: false, file_count: 3, total_size: 0, starred: false, children, ...over }) as TreeNode;

const TREE: TreeNode[] = [
  node(1, 'Business', {}, [node(2, 'Clients', { parent_id: 1 }, [node(3, 'Acme', { parent_id: 2 })]), node(4, 'Invoices', { parent_id: 1 })]),
  node(5, 'CareMe'),
  node(6, 'Tenders', { is_system: true, system_by: 'Created by Tenders' }),
  node(7, 'From Nimal', { access: { level: 'view', owner: false, via: 'direct', can_download: true, capabilities: ['open', 'download', 'copy_link'] } }),
];

type Spy = ReturnType<typeof vi.fn>;
let d: Record<keyof Drive, Spy>;
let onPlace: Spy;
let onDrop: Spy;

function mount(tree: TreeNode[] = TREE) {
  d = new Proxy<Record<string, unknown>>({ officeRouting: { legacy: false } }, { get: (t, k: string) => (t[k] ??= vi.fn()) }) as never;
  onPlace = vi.fn();
  onDrop = vi.fn();
  return render(
    <DriveCtx.Provider value={d as never}>
      <Rail place={{ view: 'folder', folder: 5 }} counts={undefined} tree={tree} used={0} quota={null} ancestors={[]} onPlace={onPlace} newItems={[]} onUpload={vi.fn()} onDrop={onDrop} canPartners={false} />
    </DriveCtx.Provider>,
  );
}

const item = (name: string) => screen.getByRole('treeitem', { name });
const menuNames = () => within(screen.getByRole('menu')).getAllByRole('menuitem').map((b) => b.textContent);
/** A drag's data: what a list, the rail or Finder would carry. */
function transfer(data: Record<string, string>, files: File[] = []) {
  const types = [...Object.keys(data), ...(files.length ? ['Files'] : [])];
  return { types, files, getData: (t: string) => data[t] ?? '', setData: vi.fn(), dropEffect: 'none', effectAllowed: 'all' };
}

// jsdom has no DragEvent, and a plain Event drops where the pointer is.
(window as unknown as { DragEvent: unknown }).DragEvent ??= class extends MouseEvent {
  dataTransfer = null;
};

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('the folder tree', () => {
  it('is a tree of treeitems, each with its level, place and whether it is open', () => {
    mount();
    const tree = screen.getByRole('tree', { name: 'Folders' });
    const rows = within(tree).getAllByRole('treeitem');
    // By hand (the default): the order the server keeps, and by name where nobody has arranged them.
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['Business', 'CareMe', 'From Nimal', 'Tenders']);
    expect(item('Business').getAttribute('aria-expanded')).toBe('false');
    expect(item('CareMe').getAttribute('aria-expanded')).toBeNull();
    expect(item('CareMe').getAttribute('aria-selected')).toBe('true');
    expect(item('Business').getAttribute('aria-level')).toBe('1');
    expect(item('Tenders').getAttribute('aria-posinset')).toBe('4');
    expect(item('Tenders').getAttribute('aria-setsize')).toBe('4');
    // One stop for Tab: the folder being looked at.
    expect(rows.filter((r) => r.tabIndex === 0)).toEqual([item('CareMe')]);
  });

  it('marks a system folder with a lock that says who made it', () => {
    mount();
    expect(within(item('Tenders')).getByRole('img', { name: 'Created by Tenders' }).getAttribute('title')).toBe('Created by Tenders');
    expect(item('Tenders').getAttribute('draggable')).toBe('false');
  });
});

describe('the folder menu', () => {
  it('opens on right-click with the groups of the design', () => {
    mount();
    fireEvent.contextMenu(item('Business'), { clientX: 40, clientY: 200 });
    const names = menuNames();
    for (const n of ['Open', 'Open in new tab', 'Open in new window', 'New folder inside…', 'Upload files here…', 'Upload a folder here…', 'New document', 'Share…', 'Copy link', 'Manage access', 'Rename', 'Move to…', 'Copy to…', 'Change colour', 'Add to Starred', 'Pin to top', 'Details', 'Activity', 'Version history', 'Download as ZIP']) {
      expect(names.some((x) => x?.startsWith(n))).toBe(true);
    }
    expect(names.find((x) => x?.startsWith('Move to Bin…'))).toBe('Move to Bin…3 files');
    expect(screen.getByRole('menu').getAttribute('aria-label')).toBe('Actions — Business');
  });

  it('opens from the ⋯ that shows on hover, for people who do not right-click', () => {
    mount();
    fireEvent.click(within(item('CareMe')).getByRole('button', { name: 'More actions for CareMe' }));
    expect(screen.getByRole('menu', { name: 'Actions — CareMe' })).toBeTruthy();
    expect(onPlace).not.toHaveBeenCalled();
  });

  it('gives a system folder no Rename, Move or Bin, and a view-only share Leave folder instead', () => {
    mount();
    fireEvent.contextMenu(item('Tenders'));
    let names = menuNames();
    for (const no of ['Rename', 'Move to…', 'Move to Bin…']) expect(names.some((x) => x?.startsWith(no))).toBe(false);
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.contextMenu(item('From Nimal'));
    names = menuNames();
    for (const no of ['Rename', 'Move to…', 'Move to Bin…', 'Share…', 'New folder inside…']) expect(names.some((x) => x?.startsWith(no))).toBe(false);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Leave folder' }));
    expect(d.leave).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
  });

  it('carries out the same Drive actions as a folder row in the list', () => {
    mount();
    fireEvent.contextMenu(item('CareMe'));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Pin to top/ }));
    expect(d.pin).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }), true);
    fireEvent.contextMenu(item('CareMe'));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Move to Bin…/ }));
    expect(d.trash).toHaveBeenCalledWith([{ type: 'folder', f: expect.objectContaining({ id: 5 }) }]);
  });
});

describe('renaming in place', () => {
  it('turns the name into a field on F2; Enter saves', async () => {
    mount();
    act(() => item('CareMe').focus());
    fireEvent.keyDown(item('CareMe'), { key: 'F2' });
    const field = screen.getByRole('textbox', { name: 'Rename “CareMe”' });
    fireEvent.change(field, { target: { value: 'Care Me' } });
    d.renameTo.mockResolvedValue(undefined);
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(d.renameTo).toHaveBeenCalledWith({ type: 'folder', f: expect.objectContaining({ id: 5 }) }, 'Care Me'));
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  });

  it('says so when the name is already beside it, and Esc puts the old name back', () => {
    mount();
    fireEvent.contextMenu(item('CareMe'));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Rename/ }));
    const field = screen.getByRole('textbox', { name: 'Rename “CareMe”' });
    fireEvent.change(field, { target: { value: 'business' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toBe('There is already a folder called “business” here.');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(d.renameTo).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(item('CareMe')).toBeTruthy();
  });

  it('throws a typed name away on Esc, even as the field loses focus', () => {
    mount();
    act(() => item('CareMe').focus());
    fireEvent.keyDown(item('CareMe'), { key: 'F2' });
    const field = screen.getByRole('textbox');
    act(() => field.focus());
    fireEvent.change(field, { target: { value: 'Something else' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.activeElement).toBe(item('CareMe'));
    expect(d.renameTo).not.toHaveBeenCalled();
  });

  it('shows the server’s reason when it refuses', async () => {
    mount();
    act(() => item('CareMe').focus());
    fireEvent.keyDown(item('CareMe'), { key: 'F2' });
    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: 'Care' } });
    d.renameTo.mockRejectedValue(new Error('There is already a folder called “Care” there.'));
    fireEvent.keyDown(field, { key: 'Enter' });
    expect((await screen.findByRole('alert')).textContent).toBe('There is already a folder called “Care” there.');
  });

  it('never offers it for a system folder', () => {
    mount();
    act(() => item('Tenders').focus());
    fireEvent.keyDown(item('Tenders'), { key: 'F2' });
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('the keyboard', () => {
  it('walks the tree with the arrows, opens with → and Enter, and bins with ⌘⌫', () => {
    mount();
    act(() => item('CareMe').focus());
    fireEvent.keyDown(item('CareMe'), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(item('Business'));
    fireEvent.keyDown(item('Business'), { key: 'ArrowRight' });
    expect(item('Business').getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(item('Business'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(item('Clients'));
    expect(item('Clients').getAttribute('aria-level')).toBe('2');
    fireEvent.keyDown(item('Clients'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(item('Business'));
    fireEvent.keyDown(item('Business'), { key: 'ArrowLeft' });
    expect(item('Business').getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(item('Business'), { key: 'Enter' });
    expect(onPlace).toHaveBeenCalledWith({ view: 'folder', folder: 1 });
    fireEvent.keyDown(item('Business'), { key: 'Backspace', metaKey: true });
    expect(d.trash).toHaveBeenCalledWith([{ type: 'folder', f: expect.objectContaining({ id: 1 }) }]);
  });

  it('opens the menu with ⇧F10 and the Menu key, and comes back to the folder when it closes', () => {
    mount();
    act(() => item('CareMe').focus());
    fireEvent.keyDown(item('CareMe'), { key: 'F10', shiftKey: true });
    expect(screen.getByRole('menu', { name: 'Actions — CareMe' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(item('CareMe'));
    fireEvent.keyDown(item('CareMe'), { key: 'ContextMenu' });
    expect(screen.getByRole('menu', { name: 'Actions — CareMe' })).toBeTruthy();
  });

  it('does not bin a system folder or one shared with me', () => {
    mount();
    for (const name of ['Tenders', 'From Nimal']) {
      act(() => item(name).focus());
      fireEvent.keyDown(item(name), { key: 'Delete' });
    }
    expect(d.trash).not.toHaveBeenCalled();
  });
});

describe('dragging onto the tree', () => {
  it('moves rows from the list into a folder, highlighting it', () => {
    mount();
    const dt = transfer({ 'application/x-ws-drive': JSON.stringify(['f:11', 'd:9']) });
    fireEvent.dragOver(item('CareMe'), { dataTransfer: dt });
    expect(item('CareMe').querySelector('.ring-2')).toBeTruthy();
    fireEvent.drop(item('CareMe'), { dataTransfer: dt });
    expect(onDrop).toHaveBeenCalledWith(expect.anything(), 5);
  });

  it('uploads files from Finder into the folder', () => {
    mount();
    const dt = transfer({}, [new File(['x'], 'scan.pdf')]);
    fireEvent.dragOver(item('Business'), { dataTransfer: dt });
    fireEvent.drop(item('Business'), { dataTransfer: dt });
    expect(onDrop).toHaveBeenCalledWith(expect.anything(), 1);
  });

  it('refuses a folder dropped into itself or a folder within it', () => {
    mount();
    fireEvent.keyDown(item('Business'), { key: 'ArrowRight' });
    act(() => item('Business').focus());
    fireEvent.keyDown(item('Business'), { key: 'ArrowRight' });
    const dt = transfer({ 'application/x-ws-drive': JSON.stringify(['d:1']) });
    fireEvent.drop(item('Clients'), { dataTransfer: dt });
    expect(onDrop).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('error', 'A folder can’t go inside itself or a folder within it.');
  });

  it('opens a closed folder after hovering for a second', () => {
    vi.useFakeTimers();
    mount();
    const dt = transfer({ 'application/x-ws-drive': JSON.stringify(['f:11']) });
    fireEvent.dragOver(item('Business'), { dataTransfer: dt });
    act(() => vi.advanceTimersByTime(HOVER_OPEN_MS - 50));
    expect(item('Business').getAttribute('aria-expanded')).toBe('false');
    fireEvent.dragOver(item('Business'), { dataTransfer: dt });
    act(() => vi.advanceTimersByTime(100));
    expect(item('Business').getAttribute('aria-expanded')).toBe('true');
  });

  it('reorders the rail’s own folders by dragging one above another', () => {
    mount();
    const dt = transfer({ 'application/x-ws-drive': JSON.stringify(['d:5']), 'application/x-ws-rail': '5' });
    fireEvent.dragStart(item('CareMe'), { dataTransfer: dt });
    const target = item('Business');
    target.getBoundingClientRect = () => ({ top: 100, height: 28, left: 0, width: 200, bottom: 128, right: 200, x: 0, y: 100, toJSON: () => null });
    fireEvent.dragOver(target, { dataTransfer: dt, clientY: 102 });
    expect(target.querySelector('[data-drop="before"]')).toBeTruthy();
    fireEvent.drop(target, { dataTransfer: dt, clientY: 102 });
    expect(d.reorder).toHaveBeenCalledWith([5, 1, 7, 6], undefined);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('nests a rail folder by dropping it onto another', () => {
    mount();
    const dt = transfer({ 'application/x-ws-drive': JSON.stringify(['d:5']), 'application/x-ws-rail': '5' });
    fireEvent.dragStart(item('CareMe'), { dataTransfer: dt });
    const target = item('Business');
    target.getBoundingClientRect = () => ({ top: 100, height: 28, left: 0, width: 200, bottom: 128, right: 200, x: 0, y: 100, toJSON: () => null });
    fireEvent.dragOver(target, { dataTransfer: dt, clientY: 114 });
    fireEvent.drop(target, { dataTransfer: dt, clientY: 114 });
    expect(onDrop).toHaveBeenCalledWith(expect.anything(), 1);
  });
});

describe('the Folders header and the quick links', () => {
  it('has a ⋯ menu with New folder, Sort by, Collapse all and Show starred first', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Folders options' }));
    expect(menuNames()).toEqual(['New folder', 'Sort by', 'Collapse all', 'Show starred first']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show starred first' }));
    expect(JSON.parse(localStorage.getItem('files.rail-order')!)).toEqual({ sort: 'manual', starredFirst: true });
  });

  it('sorts by name when asked, and remembers it', () => {
    mount([node(1, 'b'), node(2, 'a'), node(3, 'c', { pinned: true })]);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Folders' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Sort by/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Name' }));
    expect(screen.getAllByRole('treeitem').map((r) => r.getAttribute('aria-label'))).toEqual(['c', 'a', 'b']);
  });

  it('gives Recent and Starred their menus', () => {
    mount();
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Recent/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear recent list' }));
    expect(d.clearRecent).toHaveBeenCalled();
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Starred/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unstar all…' }));
    expect(d.unstarAll).toHaveBeenCalled();
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Shared with me/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open in new tab' }));
    expect(d.openPlaceIn).toHaveBeenCalledWith({ view: 'shared', folder: null }, 'tab');
    fireEvent.contextMenu(screen.getByRole('button', { name: /^My Drive/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Storage details' }));
    expect(onPlace).toHaveBeenCalledWith({ view: 'storage', folder: null });
  });
});
