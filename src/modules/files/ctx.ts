import { createContext, useContext, type DragEvent } from 'react';
import type { MenuItem } from './Menu';
import { OFFICE_EXTS, PREVIEW_EXTS, TONE, ZIP_EXTS, can, extOf, openWay, type DriveFile, type DriveFolder, type Key } from './api';

/** A thing in the Drive: a file or a folder, as a row carries it. */
export type Item = { type: 'file'; f: DriveFile } | { type: 'folder'; f: DriveFolder };

/**
 * What any view may ask of the page: every action goes through here, so a
 * menu, a key and a button all do the same thing.
 */
export interface Drive {
  folderId: number | null;
  open: (item: Item, list?: DriveFile[]) => void;
  openFolder: (id: number | null) => void;
  preview: (files: DriveFile[], index: number) => void;
  download: (files: DriveFile[], open?: boolean) => void;
  downloadFolder: (f: DriveFolder) => void;
  trash: (items: Item[]) => void;
  rename: (item: Item) => void;
  move: (items: Item[], mode: 'move' | 'copy') => void;
  duplicate: (f: DriveFile) => void;
  zip: (files: DriveFile[]) => void;
  archive: (f: DriveFile) => void;
  share: (item: Item) => void;
  secureLink: (f: DriveFile) => void;
  publicLink: (item: Item) => void;
  sendToChat: (item: Item, discuss?: boolean) => void;
  lock: (f: DriveFolder, on: boolean) => void;
  star: (item: Item, on: boolean) => void;
  details: (item: Item, tab?: string) => void;
  office: (f: DriveFile) => void;
  inBrowser: (f: DriveFile) => void;
  newFolder: () => void;
  upload: () => void;
  /** Files from Finder upload into the folder; rows dragged from a list move there. */
  drop: (e: DragEvent, folder: number | null) => void;
  refresh: () => void;
}

export const DriveCtx = createContext<Drive | null>(null);

export function useDrive(): Drive {
  const d = useContext(DriveCtx);
  if (!d) throw new Error('useDrive outside Files');
  return d;
}

export const keyOf = (i: Item): Key => (i.type === 'file' ? `f:${i.f.id}` : `d:${i.f.id}`);

/** The file menu (right-click, ⋯ and the details panel), each item only when the server allows it. */
export function fileMenu(f: DriveFile, d: Drive, list?: DriveFile[]): MenuItem[] {
  const a = f.access;
  const e = extOf(f.name, f.extension);
  const item: Item = { type: 'file', f };
  const way = openWay(f);
  const out: Array<MenuItem | null> = [
    { label: 'Open', hint: 'Enter', strong: true, run: () => d.open(item, list) },
    way === 'preview' ? null : PREVIEWABLE(e) ? { label: 'Preview', hint: 'Space', run: () => d.preview(list ?? [f], Math.max(0, (list ?? [f]).indexOf(f))) } : null,
    OFFICE_EXTS.includes(e) && can(a, 'edit') ? { label: 'Edit in Office', icon: 'external', run: () => d.office(f) } : null,
    can(a, 'download') ? { label: 'Open locally', icon: 'laptop', run: () => d.download([f], true) } : null,
    { label: 'Open in the browser', icon: 'globe', run: () => d.inBrowser(f) },
    { sep: true },
    can(a, 'share') ? { label: 'Share…', icon: 'users', run: () => d.share(item) } : null,
    can(a, 'download') ? { label: 'Secure link…', icon: 'lock', run: () => d.secureLink(f) } : null,
    can(a, 'share') && a?.owner ? { label: 'Copy public link', icon: 'link', run: () => d.publicLink(item) } : null,
    can(a, 'chat_share') ? { label: 'Send to Chat…', icon: 'send', run: () => d.sendToChat(item) } : null,
    can(a, 'chat_share') ? { label: 'Discuss in Chat…', icon: 'chat', run: () => d.sendToChat(item, true) } : null,
    { sep: true },
    can(a, 'rename') ? { label: 'Rename', hint: 'F2', icon: 'compose', run: () => d.rename(item) } : null,
    can(a, 'move') ? { label: 'Move…', icon: 'folder-up', run: () => d.move([item], 'move') } : null,
    can(a, 'download') ? { label: 'Copy to…', icon: 'copy', run: () => d.move([item], 'copy') } : null,
    can(a, 'download') ? { label: 'Duplicate', icon: 'copy', run: () => d.duplicate(f) } : null,
    can(a, 'download') ? { label: 'Zip', icon: 'archive', run: () => d.zip([f]) } : null,
    ZIP_EXTS.includes(e) ? { label: 'View contents', icon: 'package', run: () => d.archive(f) } : null,
    { label: 'Versions', icon: 'history', run: () => d.details(item, 'versions') },
    can(a, 'download') ? { label: 'Download', icon: 'download', run: () => d.download([f]) } : null,
    { label: f.starred ? 'Remove star' : 'Star', icon: 'star', run: () => d.star(item, !f.starred) },
    { sep: true },
    can(a, 'delete') ? { label: 'Move to trash', hint: 'Del', icon: 'trash', danger: true, run: () => d.trash([item]) } : null,
  ];
  return tidy(out);
}

/** The folder menu. */
export function folderMenu(f: DriveFolder, d: Drive): MenuItem[] {
  const a = f.access;
  const item: Item = { type: 'folder', f };
  const owner = !!a?.owner;
  const out: Array<MenuItem | null> = [
    { label: 'Open', hint: 'Enter', strong: true, run: () => d.openFolder(f.id) },
    { label: 'Details', icon: 'info', run: () => d.details(item) },
    { sep: true },
    can(a, 'share') ? { label: 'Share…', icon: 'users', run: () => d.share(item) } : null,
    can(a, 'share') && owner ? { label: 'Get link…', icon: 'link', run: () => d.publicLink(item) } : null,
    can(a, 'chat_share') ? { label: 'Send to Chat…', icon: 'send', run: () => d.sendToChat(item) } : null,
    can(a, 'download') ? { label: 'Download (zip)', icon: 'download', run: () => d.downloadFolder(f) } : null,
    owner ? { label: f.is_locked ? 'Remove the password lock' : 'Password lock…', icon: 'lock', run: () => d.lock(f, !f.is_locked) } : null,
    { sep: true },
    can(a, 'rename') ? { label: 'Rename', hint: 'F2', icon: 'compose', run: () => d.rename(item) } : null,
    can(a, 'move') ? { label: 'Move…', icon: 'folder-up', run: () => d.move([item], 'move') } : null,
    { label: f.starred ? 'Remove star' : 'Star', icon: 'star', run: () => d.star(item, !f.starred) },
    { sep: true },
    can(a, 'delete') ? { label: 'Delete folder', hint: 'Del', icon: 'trash', danger: true, run: () => d.trash([item]) } : null,
  ];
  return tidy(out);
}

const PREVIEWABLE = (e: string) => PREVIEW_EXTS.includes(e);

/** No separator first, last, or twice in a row. */
function tidy(list: Array<MenuItem | null>): MenuItem[] {
  const out: MenuItem[] = [];
  for (const m of list) {
    if (!m) continue;
    if ('sep' in m && (!out.length || 'sep' in out[out.length - 1]!)) continue;
    out.push(m);
  }
  while (out.length && 'sep' in out[out.length - 1]!) out.pop();
  return out;
}

export { TONE };
