import { createContext, useContext, type DragEvent } from 'react';
import type { ExternalAppId, OfficeMode } from '@shared/office';
import { canOpen } from '../../core/access';
import { knownApps } from '../office/local';
import { cachedOfficeActions, prefetchOfficeActions, type OfficeRouting } from './office';
import type { MenuItem } from './Menu';
import { IMAGE_EDIT_EXTS, OFFICE_EXTS, PREVIEW_EXTS, TONE, ZIP_EXTS, can, extOf, openWay, type DriveFile, type DriveFolder, type Key } from './api';
import { app } from '../../core/app-state';
import { computerWord } from './sync';

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
  /** An Office file in its tab (or, on a server without the Office API, the web's editor); `mode` only when chosen. */
  office: (f: DriveFile, mode?: OfficeMode | null) => void;
  /** An Office file in Word, Excel, PowerPoint or the default app here (OO-DSK-050). */
  openIn: (f: DriveFile, app: ExternalAppId) => void;
  /** How the server routes Office files (web-api §6). */
  officeRouting: OfficeRouting;
  /** The code editor, the image editor and the media player (Files part 2). */
  editText: (f: DriveFile) => void;
  /** The photo editor; `version` reopens that version's layers; `list` fills its strip. */
  editImage: (f: DriveFile, version?: number | null, list?: DriveFile[]) => void;
  /** Batch edit (BAT-01). */
  batchEdit: (files: DriveFile[]) => void;
  play: (files: DriveFile[], index: number) => void;
  inBrowser: (f: DriveFile) => void;
  /** Keep a folder on this computer (Drive sync): opens Sync devices with the folder chosen. */
  syncFolder: (f: DriveFolder) => void;
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
  // Sending into a conversation is Chat's: offered only to whoever has it.
  const chat = can(a, 'chat_share') && canOpen('chat');
  // Office files (OO-DRV-020/040): Edit, Open read-only and Open in another app, as the server's answer for this
  // file says (asked when its menu first opens; until then Drive's own access decides, and the server refuses anyway).
  const r = d.officeRouting;
  const fmt = r.types?.formats[e];
  const office = !r.legacy && (fmt ? fmt.route === 'office' : OFFICE_EXTS.includes(e));
  if (office) prefetchOfficeActions(f.id);
  const oa = office ? cachedOfficeActions(f.id) : null;
  const canEdit = oa ? oa.actions.edit : can(a, 'edit') && (fmt ? fmt.editable || fmt.legacy : true);
  const inApps = office && (oa ? oa.actions.open_in_external_app : can(a, 'download'));
  const out: Array<MenuItem | null> = [
    { label: 'Open', hint: 'Enter', strong: true, run: () => d.open(item, list) },
    way === 'preview' ? null : PREVIEWABLE(e) ? { label: 'Preview', hint: 'Space', run: () => d.preview(list ?? [f], Math.max(0, (list ?? [f]).indexOf(f))) } : null,
    IMAGE_EDIT_EXTS.includes(e) && (can(a, 'upload_version') || can(a, 'download')) ? { label: 'Edit photo', hint: 'E', icon: 'compose', run: () => d.editImage(f, null, list?.filter((x) => IMAGE_EDIT_EXTS.includes(extOf(x.name, x.extension)))) } : null,
    office && canEdit ? { label: 'Edit', icon: 'compose', run: () => d.office(f, 'EDIT') } : null,
    office && (oa ? oa.actions.open_read_only : true) ? { label: 'Open read-only', icon: 'eye', run: () => d.office(f, 'VIEW') } : null,
    r.legacy && OFFICE_EXTS.includes(e) && can(a, 'edit') ? { label: 'Edit in Office', icon: 'external', run: () => d.office(f) } : null,
    ...(inApps ? knownApps(e).map((x) => ({ label: `Open in ${x.label}`, icon: 'laptop', run: () => d.openIn(f, x.id) })) : []),
    !office && can(a, 'download') ? { label: 'Open locally', icon: 'laptop', run: () => d.download([f], true) } : null,
    { label: 'Open in the browser', icon: 'globe', run: () => d.inBrowser(f) },
    { sep: true },
    can(a, 'share') ? { label: 'Share…', icon: 'users', run: () => d.share(item) } : null,
    can(a, 'download') ? { label: 'Secure link…', icon: 'lock', run: () => d.secureLink(f) } : null,
    can(a, 'share') && a?.owner ? { label: 'Copy public link', icon: 'link', run: () => d.publicLink(item) } : null,
    chat ? { label: 'Send to Chat…', icon: 'send', run: () => d.sendToChat(item) } : null,
    chat ? { label: 'Discuss in Chat…', icon: 'chat', run: () => d.sendToChat(item, true) } : null,
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
  const chat = can(a, 'chat_share') && canOpen('chat');
  const out: Array<MenuItem | null> = [
    { label: 'Open', hint: 'Enter', strong: true, run: () => d.openFolder(f.id) },
    { label: 'Details', icon: 'info', run: () => d.details(item) },
    { sep: true },
    can(a, 'share') ? { label: 'Share…', icon: 'users', run: () => d.share(item) } : null,
    can(a, 'share') && owner ? { label: 'Get link…', icon: 'link', run: () => d.publicLink(item) } : null,
    chat ? { label: 'Send to Chat…', icon: 'send', run: () => d.sendToChat(item) } : null,
    can(a, 'download') ? { label: 'Download (zip)', icon: 'download', run: () => d.downloadFolder(f) } : null,
    owner ? { label: f.is_locked ? 'Remove the password lock' : 'Password lock…', icon: 'lock', run: () => d.lock(f, !f.is_locked) } : null,
    owner && !f.is_locked && app.get().sync?.available ? { label: `Keep on this ${computerWord()}…`, icon: 'laptop', run: () => d.syncFolder(f) } : null,
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
