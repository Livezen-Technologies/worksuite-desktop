import type { TreeNode } from './api';
import type { Drive, Item } from './ctx';
import type { MenuItem } from './Menu';
import { railActions, type RailAction, type RailEnv, type RailOrder, type RailSort } from './railTree';
import { revealLabel } from './sync';

/** Change colour ▸: the Drive designs' folder colours. */
export const FOLDER_COLOURS: Array<{ label: string; hex: string | null }> = [
  { label: 'Default', hex: null },
  { label: 'Red', hex: '#d93f3f' },
  { label: 'Orange', hex: '#e8772e' },
  { label: 'Yellow', hex: '#e9a23b' },
  { label: 'Green', hex: '#2f9e5b' },
  { label: 'Teal', hex: '#0e7c86' },
  { label: 'Blue', hex: '#2f6fde' },
  { label: 'Purple', hex: '#7b4fd1' },
  { label: 'Pink', hex: '#d24f97' },
  { label: 'Grey', hex: '#6b7280' },
];

/** What only the rail can do itself: the name turns into a field there. */
export interface RailUi {
  rename: (n: TreeNode) => void;
}

/**
 * A sidebar folder's menu (right-click, ⋯ or ⇧F10), built from `railActions`
 * — so what is offered is decided in one tested place — and carried out by the
 * same Drive actions as a file row's menu.
 */
export function railFolderMenu(n: TreeNode, d: Drive, env: RailEnv, ui: RailUi): MenuItem[] {
  const item: Item = { type: 'folder', f: n };
  const files = n.file_count;
  const one: Record<RailAction, () => MenuItem> = {
    open: () => ({ label: 'Open', hint: 'Enter', strong: true, run: () => d.openFolder(n.id) }),
    'open-tab': () => ({ label: 'Open in new tab', icon: 'external', run: () => d.openPlaceIn({ view: 'folder', folder: n.id }, 'tab') }),
    'open-window': () => ({ label: 'Open in new window', icon: 'app-window', run: () => d.openPlaceIn({ view: 'folder', folder: n.id }, 'window') }),
    'new-folder': () => ({ label: 'New folder inside…', icon: 'folder-plus', run: () => d.newFolder(n.id) }),
    'upload-files': () => ({ label: 'Upload files here…', icon: 'upload', run: () => d.upload(n.id) }),
    'upload-folder': () => ({ label: 'Upload a folder here…', icon: 'folder-input', run: () => d.uploadFolder(n.id) }),
    'new-doc': () => ({
      label: 'New document',
      icon: 'file-text',
      run: () => undefined,
      submenu: [
        { label: 'Document', icon: 'file-text', run: () => d.newDocument('document', n.id) },
        { label: 'Spreadsheet', icon: 'file-sheet', run: () => d.newDocument('spreadsheet', n.id) },
        { label: 'Presentation', icon: 'board', run: () => d.newDocument('presentation', n.id) },
      ],
    }),
    share: () => ({ label: 'Share…', icon: 'users', run: () => d.share(item) }),
    'copy-link': () => ({ label: 'Copy link', icon: 'link', run: () => d.copyLink(item) }),
    'manage-access': () => ({ label: 'Manage access', icon: 'shield', run: () => d.details(item, 'access') }),
    rename: () => ({ label: 'Rename', hint: 'F2', icon: 'compose', run: () => ui.rename(n) }),
    move: () => ({ label: 'Move to…', icon: 'folder-up', run: () => d.move([item], 'move') }),
    copy: () => ({ label: 'Copy to…', icon: 'copy', run: () => d.move([item], 'copy') }),
    colour: () => ({
      label: 'Change colour',
      icon: 'droplet',
      run: () => undefined,
      submenu: FOLDER_COLOURS.map((c) => ({ label: c.label, hint: (n.color ?? null) === c.hex ? '✓' : undefined, run: () => d.setColour(n, c.hex) })),
    }),
    star: () => ({ label: n.starred ? 'Remove from Starred' : 'Add to Starred', icon: 'star', run: () => d.star(item, !n.starred) }),
    pin: () => ({ label: n.pinned ? 'Unpin' : 'Pin to top', icon: n.pinned ? 'pin-off' : 'pin', run: () => d.pin(n, !n.pinned) }),
    offline: () => ({ label: 'Available offline', hint: env.synced ? 'On' : 'Off', icon: 'cloud-off', run: () => d.keepOffline(n, !env.synced) }),
    details: () => ({ label: 'Details', icon: 'info', run: () => d.details(item) }),
    activity: () => ({ label: 'Activity', icon: 'activity', run: () => d.details(item, 'activity') }),
    // A folder's own versions are its files': Details lists what changed in it.
    versions: () => ({ label: 'Version history', icon: 'history', run: () => d.details(item, 'activity') }),
    zip: () => ({ label: 'Download as ZIP', icon: 'download', run: () => d.downloadFolder(n) }),
    reveal: () => ({ label: revealLabel(), icon: 'folder-open', run: () => d.reveal(n) }),
    bin: () => ({ label: 'Move to Bin…', hint: files ? `${files.toLocaleString()} ${files === 1 ? 'file' : 'files'}` : undefined, icon: 'trash', danger: true, run: () => d.trash([item]) }),
    leave: () => ({ label: 'Leave folder', icon: 'logout', danger: true, run: () => d.leave(n) }),
    remove: () => ({ label: 'Remove from my Drive', icon: 'x-circle', danger: true, run: () => d.leave(n) }),
  };
  const out: MenuItem[] = [];
  for (const g of railActions(n, env)) {
    if (out.length) out.push({ sep: true });
    for (const a of g.actions) out.push(one[a]());
  }
  return out;
}

export type QuickLink = 'folder' | 'recent' | 'starred' | 'shared' | 'my_shares' | 'home';

/** A quick link's menu (My Drive, Recent, Starred, Shared…), or null for one without. */
export function quickLinkMenu(v: QuickLink, d: Drive, go: { open: () => void; storage: () => void; openIn: (where: 'tab' | 'window') => void }): MenuItem[] | null {
  switch (v) {
    case 'folder':
      return [
        { label: 'New folder', icon: 'folder-plus', run: () => d.newFolder(null) },
        { label: 'Upload files', icon: 'upload', run: () => d.upload(null) },
        { sep: true },
        { label: 'Storage details', icon: 'disk', run: go.storage },
      ];
    case 'recent':
      return [{ label: 'Open', strong: true, run: go.open }, { sep: true }, { label: 'Clear recent list', icon: 'clock', run: d.clearRecent }];
    case 'starred':
      return [{ label: 'Open', strong: true, run: go.open }, { sep: true }, { label: 'Unstar all…', icon: 'star', danger: true, run: d.unstarAll }];
    case 'shared':
    case 'my_shares':
      return [
        { label: 'Open', strong: true, run: go.open },
        { label: 'Open in new tab', icon: 'external', run: () => go.openIn('tab') },
      ];
    default:
      return null;
  }
}

/** The Folders header's menu (right-click or ⋯): New folder, Sort by, Collapse all, Show starred first. */
export function foldersHeadMenu(d: Drive, order: RailOrder, set: { sort: (s: RailSort) => void; starredFirst: (on: boolean) => void; collapseAll: () => void }): MenuItem[] {
  const sorts: Array<[RailSort, string]> = [
    ['name', 'Name'],
    ['modified', 'Modified'],
    ['manual', 'Manual'],
  ];
  return [
    { label: 'New folder', icon: 'folder-plus', run: () => d.newFolder(null) },
    { sep: true },
    {
      label: 'Sort by',
      icon: 'list',
      run: () => undefined,
      submenu: sorts.map(([k, label]) => ({ label, hint: order.sort === k ? '✓' : undefined, run: () => set.sort(k) })),
    },
    { label: 'Collapse all', icon: 'chevrons-up-down', run: set.collapseAll },
    { label: 'Show starred first', hint: order.starredFirst ? '✓' : undefined, icon: 'star', run: () => set.starredFirst(!order.starredFirst) },
  ];
}
