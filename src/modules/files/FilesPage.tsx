import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Suspense, lazy, useEffect, useRef, useState, type DragEvent } from 'react';
import type { PickedFile } from '@shared/ipc/contract';
import { app } from '../../core/app-state';
import { apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { call, errorMessage, on, registerDropped } from '../../core/bridge';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { useNow } from '../calls/parts';
import type { ModuleProps } from '../registry';
import { ALL_VIEWS, TITLES, TONE, can, kindOf, openWay, pathTo, splitKeys, tree as loadTree, type DriveFile, type DriveFolder, type Key, type TreeNode, type View } from './api';
import { DriveCtx, keyOf, type Drive, type Item } from './ctx';
import { ArchiveDialog, ConfirmDialog, FolderPicker, LinkDialog, LockDialog, NameDialog, SecureLinkDialog, SendToChatDialog } from './Dialogs';
import { Explorer } from './Explorer';
import { Home } from './Home';
import { lockPassword } from './locks';
import type { MenuItem } from './Menu';
import { Preview } from './Preview';
import { isSlidesFile } from '../office/slides/overlay';
import { openPdf } from '../pdf/open';
import { Rail, type Place } from './Rail';
import { CodeEditor } from './CodeEditor';
import { ImageViewer } from './image/Viewer';
import { BatchDialog, BatchTray } from './image/Batch';
import { CreateImageDialog, IMAGE_SIZES } from './image/NewImage';
import type { NewImageSpec } from './image/Editor';
import { Spinner } from '../../components/ui';
import { MediaViewer } from './MediaViewer';
import { ShareDialog } from './Share';
import { UploadTray, UrlDownloads } from './Trays';
import { Shared } from './Shared';
import { Companies, Duplicates, Links, Notifications, Storage, Trash } from './Views';
import { SyncDevices } from './SyncDevices';
import { UploadConflicts, autoChoices, type ConflictChoice, type UploadConflict } from './UploadConflicts';
import { DriveSettings } from './DriveSettings';
import { cachedOfficeActions, driveOfficeDoc, officeOpenWay, openOfficeTab, useOfficeRouting } from './office';
import { openOfficeDoc } from '../office/open-with';
import { TemplateDialog } from './Templates';
import { createDocument } from '../office/api';
import { LocalCopiesTray, externalApps, openInApp } from '../office/local';
import { SidePanel } from '../../components/SidePanel';

/** The photo editor loads only when a picture is edited (EDT-E-14). */
const PhotoEditor = lazy(() => import('./image/Editor'));

type Dialog =
  | { kind: 'name'; title: string; initial: string; action: string; save: (name: string) => Promise<void> }
  | { kind: 'confirm'; title: string; body: string; action: string; run: () => void }
  | { kind: 'pick'; items: Item[]; mode: 'move' | 'copy' }
  | { kind: 'lock'; folder: DriveFolder; on: boolean }
  | { kind: 'archive'; file: DriveFile }
  | { kind: 'share'; item: Item }
  | { kind: 'secure'; file: DriveFile }
  | { kind: 'link'; item: Item }
  | { kind: 'chat'; item: Item; discuss?: boolean }
  | { kind: 'templates' }
  | { kind: 'batch'; files: DriveFile[] }
  | { kind: 'new-image'; preset: number | null };

const DOCS: Array<[string, string, string, string]> = [
  ['docx', 'DOC', 'Document', 'Untitled document'],
  ['xlsx', 'XLS', 'Spreadsheet', 'Untitled spreadsheet'],
  ['pptx', 'PPT', 'Presentation', 'Untitled presentation'],
  ['txt', 'TXT', 'Text file', 'Untitled'],
  ['md', 'MD', 'Markdown note', 'Untitled'],
];
const DOC_TONE: Record<string, string> = { docx: TONE.document!, xlsx: TONE.spreadsheet!, pptx: TONE.presentation!, txt: TONE.other!, md: TONE.other! };
/** Views that are pages of their own rather than a list of files. */
const PAGES: View[] = ['home', 'shared', 'trash', 'storage', 'duplicates', 'links', 'notifications', 'companies', 'devices', 'settings'];

function placeFrom(q: URLSearchParams): Place {
  const f = q.get('folder');
  if (f && /^\d+$/.test(f)) return { view: 'folder', folder: Number(f) };
  const v = q.get('view') as View | null;
  return { view: v && ALL_VIEWS.includes(v) ? v : 'home', folder: null };
}

/** What a list or the rail said about what it dragged: each key's name and the folder it was in. */
export function dragAbout(raw: string): Map<Key, { name?: string; parent?: number | null }> {
  const out = new Map<Key, { name?: string; parent?: number | null }>();
  if (!raw) return out;
  try {
    const v = JSON.parse(raw) as Record<string, { name?: unknown; parent?: unknown }>;
    for (const [k, x] of Object.entries(v)) {
      if (!/^[fd]:\d+$/.test(k) || !x || typeof x !== 'object') continue;
      out.set(k as Key, { name: typeof x.name === 'string' ? x.name : undefined, parent: typeof x.parent === 'number' ? x.parent : x.parent === null ? null : undefined });
    }
  } catch {
    /* not ours */
  }
  return out;
}

function nameIn(nodes: TreeNode[], id: number): string | null {
  for (const n of nodes) {
    if (n.id === id) return n.name;
    const hit = nameIn(n.children, id);
    if (hit) return hit;
  }
  return null;
}

/**
 * Files (the Drive designs): Home, My Drive and its folders, the lists across
 * the Drive, Shared, the recycle bin, storage and settings — with sharing,
 * links, versions, comments, previews and uploads — and Sync devices, where
 * Drive folders are kept on this computer (the SYNC column and "On this Mac"
 * in Details say what is here).
 */
export default function FilesPage(_props: ModuleProps) {
  const qc = useQueryClient();
  const { query, go, navigate, active, openInNewTab, openInWindow } = useTab();
  const place = placeFrom(query);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [preview, setPreview] = useState<{ files: DriveFile[]; index: number } | null>(null);
  const [editor, setEditor] = useState<{ kind: 'code'; file: DriveFile } | { kind: 'image'; file: DriveFile | null; blank?: NewImageSpec; version?: number | null; list?: DriveFile[] } | { kind: 'media'; files: DriveFile[]; index: number } | { kind: 'viewer'; files: DriveFile[]; index: number } | null>(null);
  const [batchJobs, setBatchJobs] = useState<Array<{ id: number | string; label: string; total: number }>>([]);
  // The viewer and editor live in this tab, and name it (DSK-01).
  const editing = editor?.kind === 'image' ? (editor.file?.name ?? editor.blank?.name ?? null) : editor?.kind === 'viewer' ? (editor.files[editor.index]?.name ?? null) : null;
  useTabTitle(editing ? `Files · ${editing}` : place.view === 'home' ? 'Files' : `Files · ${TITLES[place.view]}`);
  const [urlTray, setUrlTray] = useState(false);
  const [clash, setClash] = useState<{ picked: PickedFile[]; conflicts: UploadConflict[]; folder: number | null } | null>(null);
  const [detailsAsk, setDetailsAsk] = useState<{ key: Key; tab?: string; n: number } | null>(null);
  const now = useNow(60_000);
  const perms = useStore(app, (s) => s.bootstrap?.permissions ?? []);
  const officeRouting = useOfficeRouting();
  // Which Microsoft apps are here, found once, for the file menus' "Open in …" (OO-DSK-050).
  useEffect(() => {
    for (const e of ['docx', 'xlsx', 'pptx']) void externalApps(e);
  }, []);
  const uploadsDone = useStore(app, (s) => s.transfers.filter((t) => t.direction === 'upload' && t.state === 'done').length);

  const treeQ = useQuery({ queryKey: ['files', 'tree'], queryFn: ({ signal }) => loadTree(signal), refetchInterval: 120_000 });
  const storage = useQuery({ queryKey: ['files', 'quota'], queryFn: ({ signal }) => apiGet<{ quota: number; used: number; unlimited: boolean }>('/api/users/me/storage', undefined, signal), staleTime: 60_000 });
  const tree = treeQ.data?.tree ?? [];
  const ancestors = place.folder ? (pathTo(tree, place.folder) ?? []) : [];
  const folderId = place.view === 'folder' ? place.folder : null;

  const refresh = () => void qc.invalidateQueries({ queryKey: ['files'] });
  const askDetails = (key: Key, tab?: string) => setDetailsAsk((prev) => ({ key, tab, n: (prev?.n ?? 0) + 1 }));

  // A finished upload shows up at once.
  const [seenUploads, setSeenUploads] = useState(uploadsDone);
  if (seenUploads !== uploadsDone) {
    setSeenUploads(uploadsDone);
    if (uploadsDone > seenUploads) void qc.invalidateQueries({ queryKey: ['files'] });
  }

  const onPlace = (p: Place, q?: string) => {
    const s = new URLSearchParams();
    if (p.view === 'folder' && p.folder) s.set('folder', String(p.folder));
    else if (p.view !== 'home') s.set('view', p.view);
    if (q) s.set('q', q);
    setPreview(null);
    go(`/files${s.toString() ? `?${s}` : ''}`);
  };

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) toast('success', done);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      refresh();
    }
  };

  const uploadFolder = async (folder: number | null = folderId) => {
    try {
      const picked = await call('files:pickFolder', { title: 'Upload a folder to WorkSuite Files' });
      if (!picked.length) return;
      await call('transfers:upload', { handles: picked.map((p) => p.handle), target: { kind: 'files', folderId: folder === null ? null : String(folder) } });
      const top = picked[0]?.relativePath?.split('/')[0] ?? 'the folder';
      toast('info', `Uploading “${top}” — ${picked.length} ${picked.length === 1 ? 'file' : 'files'}, in their folders.`);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  /**
   * Files straight into a folder are checked first for a name already there;
   * each clash is asked about (replace, keep both, skip) before anything goes.
   * Files inside a dropped folder land in folders of their own and are not.
   * A server that cannot answer the question gets the upload unasked.
   */
  const upload = async (files?: File[], folder: number | null = folderId) => {
    try {
      const picked = files ? await registerDropped(files) : await call('files:pickFiles', { multiple: true, title: 'Upload to WorkSuite Files' });
      if (!picked.length) return;
      const loose = picked.filter((p) => !p.relativePath);
      let conflicts: UploadConflict[] = [];
      if (loose.length) {
        conflicts = await apiPost<{ conflicts: UploadConflict[] }>('/api/uploads/conflicts', { folder_id: folder, names: loose.map((p) => p.name) }).then(
          (r) => r.conflicts ?? [],
          () => [],
        );
      }
      // Drive › Settings may answer for every clash (keep both, skip, replace) instead of asking.
      const how = app.get().prefs?.drive.conflict ?? 'ask';
      if (conflicts.length && how !== 'ask') return await sendUploads(picked, conflicts, autoChoices(conflicts, how), folder);
      if (conflicts.length) return setClash({ picked, conflicts, folder });
      await sendUploads(picked, [], [], folder);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const sendUploads = async (picked: PickedFile[], conflicts: UploadConflict[], choices: ConflictChoice[], folder: number | null) => {
    const folderKey = folder === null ? null : String(folder);
    const byName = new Map(conflicts.map((c, i) => [c.name.toLowerCase(), choices[i]!]));
    const plain: string[] = [];
    let sent = 0;
    for (const p of picked) {
      const choice = p.relativePath ? undefined : byName.get(p.name.toLowerCase());
      if (!choice) plain.push(p.handle);
      else if (choice.how === 'replace') await call('transfers:upload', { handles: [p.handle], target: { kind: 'files', folderId: folderKey, replaceFileId: String(choice.fileId) } });
      else if (choice.how === 'both') await call('transfers:upload', { handles: [p.handle], target: { kind: 'files', folderId: folderKey, name: choice.name } });
      if (choice?.how !== 'skip') sent++;
    }
    if (plain.length) await call('transfers:upload', { handles: plain, target: { kind: 'files', folderId: folderKey } });
    if (sent) toast('info', `Uploading ${sent} ${sent === 1 ? 'file' : 'files'} — see Transfers.`);
    else toast('info', 'Nothing was uploaded.');
  };

  /** Where an item is now: what Undo moves it back to. */
  const parentOf = (i: Item): number | null | undefined => (i.type === 'file' ? i.f.folder_id : i.f.parent_id);
  const placeTo = (i: Item, folder: number | null) => (i.type === 'file' ? apiPut(`/api/files/${i.f.id}`, { folder_id: folder }) : apiPost(`/api/drive/folders/${i.f.id}/move`, { parent_id: folder }));

  /**
   * Moves or copies, one at a time. A move says Undo (worksuite-desktop#328), which puts each item back where it was —
   * from `from` when the caller knows (a drag from the rail or a list), else from the row itself.
   */
  const moveTo = (items: Item[], folder: number | null, name: string, mode: 'move' | 'copy', from?: ReadonlyMap<Key, number | null>) =>
    void run(async () => {
      const moved: Array<{ item: Item; back: number | null | undefined }> = [];
      const failed: string[] = [];
      for (const i of items) {
        const back = from?.has(keyOf(i)) ? from.get(keyOf(i)) : parentOf(i);
        try {
          if (mode === 'copy' && i.type === 'file') await apiPost(`/api/files/${i.f.id}/copy`, { folder_id: folder });
          else if (mode === 'copy') await apiPost(`/api/folders/${i.f.id}/copy`, { parent_id: folder });
          else await placeTo(i, folder);
          moved.push({ item: i, back });
        } catch (e) {
          failed.push(`${i.f.name}: ${errorMessage(e)}`);
        }
      }
      const done = moved.length;
      // Undo only when it is known where every one of them was.
      const undo = mode === 'move' && done > 0 && moved.every((m) => m.back !== undefined);
      if (done)
        toast(
          'success',
          `${mode === 'move' ? 'Moved' : 'Copied'} ${done === 1 ? `“${moved[0]!.item.f.name}”` : `${done} items`} to ${name}`,
          undo
            ? {
                label: 'Undo',
                run: () =>
                  void run(async () => {
                    for (const m of moved) await placeTo(m.item, m.back ?? null);
                  }, 'Moved back'),
              }
            : undefined,
        );
      if (failed.length) toast('error', failed.slice(0, 2).join(' · ') + (failed.length > 2 ? ` · and ${failed.length - 2} more` : ''));
    });

  const trashNow = (items: Item[]) =>
    void run(async () => {
      const files = items.filter((i) => i.type === 'file').map((i) => i.f.id);
      const folders = items.filter((i) => i.type === 'folder').map((i) => i.f.id);
      for (const id of files) await apiDelete(`/api/files/${id}`);
      for (const id of folders) await apiDelete(`/api/folders/${id}`);
      // Folders come back with what went in with them (worksuite-desktop#328), so Undo serves both.
      toast('success', `${items.length === 1 ? `“${items[0]!.f.name}”` : `${items.length} items`} moved to the recycle bin`, {
        label: 'Undo',
        run: () =>
          void run(async () => {
            for (const id of folders) await apiPost(`/api/folders/${id}/restore`);
            for (const id of files) await apiPost(`/api/files/${id}/restore`);
          }, 'Restored'),
      });
    });

  /** A rename, with Undo; the reason it failed is thrown, for the field that asked. */
  const renameTo = async (item: Item, name: string) => {
    const was = item.f.name;
    if (name === was) return;
    const put = (to: string) => (item.type === 'file' ? apiPut(`/api/files/${item.f.id}`, { name: to }) : apiPut(`/api/drive/folders/${item.f.id}`, { name: to }));
    await put(name);
    toast('success', `Renamed to “${name}”`, { label: 'Undo', run: () => void run(() => put(was), `Renamed back to “${was}”`) });
    refresh();
  };

  const d: Drive = {
    folderId,
    openFolder: (id) => onPlace({ view: 'folder', folder: id }),
    open: (item, list) => {
      if (item.type === 'folder') return onPlace({ view: 'folder', folder: item.f.id });
      const f = item.f;
      const way = openWay(f);
      if (way === 'preview' && kindOf(f.name, f.extension) === 'image') {
        // Pictures open in the photo viewer (VWR-E), with the folder's other pictures in its filmstrip.
        const all = (list ?? [f]).filter((x) => openWay(x) === 'preview' && kindOf(x.name, x.extension) === 'image');
        return setEditor({ kind: 'viewer', files: all.length ? all : [f], index: Math.max(0, all.findIndex((x) => x.id === f.id)) });
      }
      if (way === 'preview') {
        const all = (list ?? [f]).filter((x) => openWay(x) === 'preview');
        return setPreview({ files: all.length ? all : [f], index: Math.max(0, all.findIndex((x) => x.id === f.id)) });
      }
      if (way === 'media') {
        const all = (list ?? [f]).filter((x) => openWay(x) === 'media');
        return setEditor({ kind: 'media', files: all.length ? all : [f], index: Math.max(0, all.findIndex((x) => x.id === f.id)) });
      }
      if (way === 'code') return setEditor({ kind: 'code', file: f });
      // Office files go where the server routes them (web-api §6): their tab, the code editor, or the web's preview.
      const office = officeOpenWay(f, officeRouting);
      if (office === 'code') return setEditor({ kind: 'code', file: f });
      // Where Settings › Files says for its kind (#322): the built-in editor, WorkSuite Office, the default app, or ask.
      // A file the server keeps out of other apps opens in its tab, as before.
      if (office === 'office') {
        const oa = cachedOfficeActions(f.id);
        if (oa ? !oa.actions.open_in_external_app : !can(f.access, 'download')) return d.office(f);
        return void openOfficeDoc(driveOfficeDoc(f, d)).then((done) => done || d.office(f));
      }
      // A presentation set to "Preview" opens in the slide viewer (#321), with the presentations around it for ‹ ›.
      if (office === 'preview' && isSlidesFile(f.name)) {
        const all = (list ?? [f]).filter((x) => isSlidesFile(x.name));
        return setPreview({ files: all.length ? all : [f], index: Math.max(0, all.findIndex((x) => x.id === f.id)) });
      }
      // A preview-only file opens read-only in the installed app; the browser only when it cannot be downloaded.
      if (office === 'preview') return can(f.access, 'download') ? d.download([f], true) : d.inBrowser(f);
      void apiPost(`/api/drive/opened/${f.id}`, { action: 'opened' }).catch(() => undefined);
      // PDFs open in PDF Studio, a tab each (the preview workspace's hand-off for application/pdf).
      if (way === 'pdf') openPdf({ kind: 'drive', fileId: f.id }, f.name);
      else if (way === 'office') d.office(f);
      else if (way === 'archive') setDialog({ kind: 'archive', file: f });
      else if (can(f.access, 'download')) d.download([f], true);
      else d.inBrowser(f);
    },
    preview: (files, index) => setPreview({ files, index: Math.max(0, index) }),
    download: (files, open) =>
      void (async () => {
        let ok = 0;
        for (const f of files) {
          try {
            await call('transfers:download', { fileId: String(f.id), name: f.name, open: !!open });
            ok++;
          } catch (e) {
            toast('error', `${f.name}: ${errorMessage(e)}`);
          }
        }
        if (ok) toast('info', open ? `Opening ${files[0]!.name}…` : `Downloading ${ok === 1 ? files[0]!.name : `${ok} files`} — see Transfers.`);
      })(),
    downloadFolder: (f) =>
      void run(async () => {
        const pw = lockPassword(f.id);
        const r = await apiPost<{ url: string }>(`/api/folders/${f.id}/download`, pw ? { password: pw } : {});
        await call('app:openExternal', { url: r.url });
      }, `Your browser is downloading “${f.name}” as a zip`),
    trash: (items) => {
      if (!items.length) return;
      const folders = items.filter((i): i is Extract<Item, { type: 'folder' }> => i.type === 'folder');
      if (folders.length || items.length > 1) {
        // How much goes with a folder, so nobody bins a full one thinking it empty (worksuite-desktop#328).
        const inside = folders.reduce((n, f) => n + (f.f.file_count ?? 0), 0);
        setDialog({
          kind: 'confirm',
          title: items.length === 1 ? `Move “${items[0]!.f.name}” to the bin?` : `Move ${items.length} items to the bin?`,
          body: folders.length
            ? `${inside ? `${inside.toLocaleString()} ${inside === 1 ? 'file' : 'files'} inside ${folders.length === 1 ? 'it' : 'them'} go${inside === 1 ? 'es' : ''} too. ` : `${folders.length === 1 ? 'It is' : 'They are'} empty. `}Files stay in the recycle bin for 30 days, and you can undo this straight away.`
            : 'They go to the recycle bin for 30 days.',
          action: 'Move to Bin',
          run: () => trashNow(items),
        });
      } else trashNow(items);
    },
    rename: (item) =>
      setDialog({
        kind: 'name',
        title: item.type === 'file' ? 'Rename file' : 'Rename folder',
        initial: item.f.name,
        action: 'Rename',
        save: (name) => renameTo(item, name),
      }),
    renameTo,
    move: (items, mode) => setDialog({ kind: 'pick', items, mode }),
    moveTo: (items, folder, mode, from) => moveTo(items, folder, folder === null ? 'My Drive' : (nameIn(tree, folder) ?? 'the folder'), mode, from),
    duplicate: (f) => void run(() => apiPost(`/api/files/${f.id}/copy`, { folder_id: f.folder_id }), `Made a copy of “${f.name}”`),
    zip: (files) =>
      setDialog({
        kind: 'name',
        title: files.length === 1 ? `Zip “${files[0]!.name}”` : `Zip ${files.length} files`,
        initial: files.length === 1 ? `${files[0]!.name.replace(/\.[^.]+$/, '')}.zip` : 'Archive.zip',
        action: 'Make zip',
        save: async (name) => {
          const r = await apiPost<{ name: string; files: number }>('/api/drive/compress', { file_ids: files.map((f) => f.id), folder_id: files[0]!.folder_id, name: name.replace(/\.zip$/i, '') });
          toast('success', `Made “${r.name}” with ${r.files} ${r.files === 1 ? 'file' : 'files'}`);
          refresh();
        },
      }),
    archive: (file) => setDialog({ kind: 'archive', file }),
    share: (item) => setDialog({ kind: 'share', item }),
    secureLink: (file) => setDialog({ kind: 'secure', file }),
    publicLink: (item) => setDialog({ kind: 'link', item }),
    sendToChat: (item, discuss) => setDialog({ kind: 'chat', item, discuss }),
    lock: (folder, on) => setDialog({ kind: 'lock', folder, on }),
    star: (item, on) => void run(() => apiPost('/api/drive/star', { type: item.type, id: item.f.id, on }), on ? `Starred “${item.f.name}”` : `Star removed from “${item.f.name}”`),
    details: (item, tab) => {
      const key: Key = item.type === 'file' ? `f:${item.f.id}` : `d:${item.f.id}`;
      const parent = item.type === 'file' ? item.f.folder_id : item.f.parent_id;
      askDetails(key, tab);
      // Lists show the item where it is; a page (Home, Shared…) goes to its folder.
      if (!PAGES.includes(place.view) && (place.view !== 'folder' || place.folder === parent)) return;
      const s = new URLSearchParams();
      if (parent) s.set('folder', String(parent));
      else s.set('view', 'folder');
      if (item.type === 'file') s.set('file', String(item.f.id));
      go(`/files?${s}`);
    },
    // Office files open in WorkSuite's editor tab: the full Office session, or on a server with only the
    // EuroOffice editor, that editor (OfficePage decides) — never the browser. "Open in" still offers Word & co.
    office: (f, mode) => void openOfficeTab(f, mode ?? null),
    openIn: (f, appId) => void openInApp({ id: f.id, name: f.name, folderId: f.folder_id, version: f.version ?? 0 }, appId),
    officeRouting,
    editText: (f) => setEditor({ kind: 'code', file: f }),
    editImage: (f, version, list) => (setPreview(null), setEditor({ kind: 'image', file: f, version: version ?? null, list })),
    batchEdit: (files) => setDialog({ kind: 'batch', files }),
    play: (files, index) => setEditor({ kind: 'media', files, index }),
    inBrowser: (f) => void call('app:openInBrowser', { path: `/files?file=${f.id}` }),
    syncFolder: (f) => go(`/files?view=devices&sync=${f.id}`),
    newFolder: (parent) => {
      const into = parent === undefined ? folderId : parent;
      const where = into === null ? null : nameIn(tree, into);
      setDialog({
        kind: 'name',
        title: where ? `New folder in “${where}”` : 'New folder',
        initial: 'Untitled folder',
        action: 'Create',
        save: async (name) => {
          const r = await apiPost<{ id: number | string }>('/api/folders', { name, parent_id: into });
          toast('success', `Folder “${name}” created`);
          refresh();
          if (into === folderId) askDetails(`d:${Number(r.id)}`);
        },
      });
    },
    upload: (folder) => void upload(undefined, folder === undefined ? folderId : folder),
    uploadFolder: (folder) => void uploadFolder(folder === undefined ? folderId : folder),
    newDocument: (type, folder) => void newOffice({ type }, folder),
    drop: (e: DragEvent, folder) => {
      const internal = e.dataTransfer.getData('application/x-ws-drive');
      if (internal) {
        try {
          const keys = (JSON.parse(internal) as Key[]).filter((k) => k !== `d:${folder}`);
          const { files, folders } = splitKeys(keys);
          // Names and where each came from, when the list or the rail said (for the toast and Undo).
          const about = dragAbout(e.dataTransfer.getData('application/x-ws-drive-about'));
          const label = (k: Key, fallback: string) => about.get(k)?.name ?? (k.startsWith('d:') ? nameIn(tree, Number(k.slice(2))) : null) ?? fallback;
          const items: Item[] = [
            ...files.map((id) => ({ type: 'file' as const, f: { id, name: label(`f:${id}`, `file ${id}`), folder_id: about.get(`f:${id}`)?.parent ?? undefined } as DriveFile })),
            ...folders.map((id) => ({ type: 'folder' as const, f: { id, name: label(`d:${id}`, `folder ${id}`), parent_id: about.get(`d:${id}`)?.parent ?? undefined } as DriveFolder })),
          ];
          const from = new Map<Key, number | null>();
          for (const [k, v] of about) if (v.parent !== undefined) from.set(k, v.parent);
          // ⌥ (Alt) copies; a plain drop moves (worksuite-desktop#328).
          if (items.length) moveTo(items, folder, folder === null ? 'My Drive' : (nameIn(tree, folder) ?? 'the folder'), e.altKey ? 'copy' : 'move', from);
        } catch {
          /* not ours */
        }
        return;
      }
      const dropped = Array.from(e.dataTransfer.files);
      if (dropped.length) void upload(dropped, folder);
    },
    refresh,

    openPlaceIn: (p, where) => {
      const route = p.view === 'folder' && p.folder ? `/files?folder=${p.folder}` : `/files?view=${p.view}`;
      const title = `Files · ${p.view === 'folder' && p.folder ? (nameIn(tree, p.folder) ?? 'Folder') : TITLES[p.view]}`;
      if (where === 'tab') openInNewTab(route, title);
      else openInWindow(route, title);
    },
    setColour: (f, color) => void run(() => apiPut(`/api/drive/folders/${f.id}`, { color: color ?? '' }), color ? `“${f.name}” recoloured` : `“${f.name}” back to the usual colour`),
    pin: (f, on) => void run(() => apiPost(`/api/drive/folders/${f.id}/pin`, { on }), on ? `“${f.name}” pinned to the top` : `“${f.name}” unpinned`),
    leave: (f) =>
      setDialog({
        kind: 'confirm',
        title: f.access?.via === 'direct' ? `Leave “${f.name}”?` : `Remove “${f.name}” from your Drive?`,
        body:
          f.access?.via === 'direct'
            ? `It stops being shared with you${f.owner_name ? ` — ${f.owner_name} can share it again` : ''}. Nothing in it is deleted.`
            : 'It reaches you through a team or role, so it only leaves your lists; the owner’s sharing stays as it is. Nothing in it is deleted.',
        action: f.access?.via === 'direct' ? 'Leave folder' : 'Remove',
        run: () =>
          void run(async () => {
            const r = await apiPost<{ left: boolean; removed: boolean }>(`/api/drive/folders/${f.id}/leave`, {});
            toast('success', r.left && !r.removed ? `You left “${f.name}”` : `“${f.name}” removed from your Drive`);
            if (place.folder === f.id) onPlace({ view: 'shared', folder: null });
          }),
      }),
    keepOffline: (f, on) => {
      if (on) return go(`/files?view=devices&sync=${f.id}`);
      const synced = app.get().sync?.folders.find((x) => x.folderId === f.id);
      if (!synced) return void toast('info', `“${f.name}” is kept on this computer with a folder above it. Stop syncing that one in Sync devices.`);
      setDialog({
        kind: 'confirm',
        title: `Stop keeping “${f.name}” on this computer?`,
        body: 'The copy here is removed once sync stops. Everything stays in your Drive.',
        action: 'Stop syncing',
        run: () => void run(() => call('sync:remove', { id: synced.id }), `“${f.name}” is online only now`),
      });
    },
    reveal: (f) => void call('sync:reveal', { folderId: f.id }).catch((e: unknown) => toast('error', errorMessage(e))),
    copyLink: (item) => {
      const origin = app.get().auth?.server?.origin ?? '';
      const url = `${origin}/files?${item.type === 'file' ? 'file' : 'folder'}=${item.f.id}`;
      void navigator.clipboard.writeText(url).then(
        () => toast('success', 'Link copied — people need access to open it'),
        () => toast('error', 'The link could not be copied'),
      );
    },
    reorder: (ids, into) =>
      void run(async () => {
        if (into) await apiPost(`/api/drive/folders/${into.folder.id}/move`, { parent_id: into.parent });
        await apiPut('/api/drive/folders/order', { ids });
      }, into ? `Moved “${into.folder.name}” to ${into.parent === null ? 'My Drive' : (nameIn(tree, into.parent) ?? 'the folder')}` : undefined),
    clearRecent: () => void run(() => apiPost('/api/drive/recent/clear', {}), 'Recent list cleared'),
    unstarAll: () =>
      setDialog({
        kind: 'confirm',
        title: 'Unstar everything?',
        body: `${treeQ.data?.counts.starred ? `${treeQ.data.counts.starred.toLocaleString()} starred ${treeQ.data.counts.starred === 1 ? 'item loses its' : 'items lose their'} star. ` : ''}Nothing is deleted.`,
        action: 'Unstar all',
        run: () => void run(() => apiPost('/api/drive/starred/clear', {}), 'Stars removed'),
      }),
  };

  /** + New → Document, Spreadsheet, Presentation, or from a template: made by the server and opened for editing (OO-DRV-050). */
  const newOffice = async (input: { type?: 'document' | 'spreadsheet' | 'presentation'; template_id?: string }, folder: number | null = folderId) => {
    try {
      const r = await createDocument({ ...input, folder_id: folder });
      toast('success', `“${r.file.name}” created`);
      refresh();
      void openOfficeTab(r.file, 'EDIT');
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const OFFICE_KINDS: Record<string, 'document' | 'spreadsheet' | 'presentation'> = { docx: 'document', xlsx: 'spreadsheet', pptx: 'presentation' };
  const serverOffice = !officeRouting.legacy;

  const newItems: MenuItem[] = [
    { label: 'New folder', hint: '⇧⌘N', tag: { text: 'DIR', tone: TONE.folder! }, run: () => d.newFolder() },
    { sep: true },
    { label: 'Upload files…', tag: { text: 'UP', tone: TONE.code! }, run: () => d.upload() },
    { label: 'Upload folder…', tag: { text: 'UP', tone: TONE.code! }, run: () => void uploadFolder() },
    ...(perms.includes('urls.manage') ? [{ label: 'Download from URL or magnet…', tag: { text: 'URL', tone: TONE.image! }, run: () => setUrlTray(true) }] : []),
    { sep: true },
    ...DOCS.map(([ext, tag, label, base]) => ({
      label,
      hint: ['docx', 'xlsx', 'pptx'].includes(ext) ? 'Office' : '',
      tag: { text: tag, tone: DOC_TONE[ext]! },
      run: () =>
        serverOffice && OFFICE_KINDS[ext] ? void newOffice({ type: OFFICE_KINDS[ext] }) : setDialog({
          kind: 'name',
          title: `New ${label.toLowerCase()}`,
          initial: `${base}.${ext}`,
          action: 'Create',
          save: async (name) => {
            const f = await apiPost<DriveFile>('/api/files/create', { type: ext, name, folder_id: folderId });
            toast('success', `“${f.name}” created`);
            refresh();
            if (['docx', 'xlsx', 'pptx'].includes(ext)) d.office(f);
            else askDetails(`f:${f.id}`);
          },
        }),
    })),
    ...(serverOffice ? [{ label: 'From a template…', hint: 'Office', tag: { text: 'TPL', tone: TONE.document! }, run: () => setDialog({ kind: 'templates' }) }] : []),
    { sep: true },
    // New › Create image (NEW-01): a blank canvas in the editor, made in this folder on its first save.
    ...IMAGE_SIZES.map((x, i) => ({ label: x.label, hint: x.width ? `${x.width} × ${x.height}` : '', tag: { text: 'IMG', tone: TONE.image! }, run: () => setDialog({ kind: 'new-image', preset: i }) })),
  ];

  // Quick actions and links: /files?upload=1, ?new=folder.
  const ask = query.get('upload') === '1' ? 'upload' : query.get('new') === 'folder' ? 'folder' : null;
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!ask || handled.current === ask) return;
    handled.current = ask;
    // Deferred: the upload may go on to ask about names already here, which sets state.
    if (ask === 'upload') void Promise.resolve().then(() => upload());
    else d.newFolder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask]);

  // /files?file=<id>: a file named from elsewhere — a meeting recording, a notification — shown in its folder, and
  // with &play=1 opened as well, in the player for a video (worksuite-desktop#89).
  const fileParam = query.get('file');
  const playParam = query.get('play') === '1';
  // &share=1: Share… from a meeting recording's ⋯ menu (worksuite-desktop#240) opens the file's sharing dialog.
  const shareParam = query.get('share') === '1';
  const openedFile = useRef<string | null>(null);
  useEffect(() => {
    if (!fileParam || !/^\d+$/.test(fileParam) || openedFile.current === fileParam) return;
    openedFile.current = fileParam;
    // Shared with me, with the item picked out (#170): it stays in that list rather than going to its folder — and
    // with &play=1, from a share card's Open (#164), it is opened there too.
    if (place.view === 'shared') {
      if (playParam) void apiGet<DriveFile>(`/api/files/${fileParam}`).then((f) => d.open({ type: 'file', f }), (e: unknown) => toast('error', errorMessage(e)));
      return;
    }
    void apiGet<DriveFile>(`/api/files/${fileParam}`)
      .then((f) => {
        onPlace(f.folder_id ? { view: 'folder', folder: f.folder_id } : { view: 'home', folder: null });
        if (playParam) d.open({ type: 'file', f });
        else if (shareParam) d.share({ type: 'file', f });
      })
      .catch((e) => toast('error', errorMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileParam]);

  const view = place.view;
  // Opening Shared with me sees what was new there: its badge clears (worksuite-desktop#164).
  const newShares = treeQ.data?.counts.shared_new ?? 0;
  useEffect(() => {
    if (view !== 'shared' || !active || !newShares) return;
    void apiPost('/api/drive/shared/seen', {}).then(
      () => void qc.invalidateQueries({ queryKey: ['files', 'tree'] }),
      () => undefined,
    );
  }, [view, active, newShares, qc]);
  // Something shared with me just now: the badge counts it without waiting for the next refresh.
  useEffect(
    () =>
      on<{ type?: string; event?: string }>('realtime:event', (e) => {
        if (e.type === 'notification' && (e.event === 'files.shared' || e.event === 'files.access_revoked')) void qc.invalidateQueries({ queryKey: ['files', 'tree'] });
      }),
    [qc],
  );
  const listView = !PAGES.includes(view);
  // /files?view=devices&sync=<folder id>: "Sync to this computer" from a folder's menu or details.
  const syncParam = query.get('sync');
  const syncAsk = syncParam === 'all' ? 'all' : syncParam && /^\d+$/.test(syncParam) ? Number(syncParam) : null;

  return (
    <DriveCtx.Provider value={d}>
      <div className="relative h-full">
      <div className="flex h-full bg-ground text-[13px]">
        <SidePanel id="files" label="the Drive menu">
          <Rail
            place={place}
            counts={treeQ.data?.counts}
            tree={tree}
            used={storage.data?.used ?? treeQ.data?.counts.used ?? 0}
            quota={storage.data && !storage.data.unlimited ? storage.data.quota : null}
            ancestors={ancestors}
            onPlace={(p) => onPlace(p)}
            newItems={newItems}
            onUpload={() => d.upload()}
            onDrop={(e, folder) => d.drop(e, folder)}
            canPartners={perms.includes('files.permissions.manage')}
          />
        </SidePanel>
        {view === 'home' ? <Home onPlace={onPlace} now={now} newItems={newItems} /> : null}
        {listView ? <Explorer key={`${view}:${place.folder}:${query.get('q') ?? ''}`} place={place} active={active && !dialog && !preview && !editor} onPlace={(p) => onPlace(p)} ask={detailsAsk} initialQ={query.get('q') ?? ''} /> : null}
        {view === 'shared' ? <Shared onPlace={(p) => onPlace(p)} /> : null}
        {view === 'trash' ? <Trash /> : null}
        {view === 'storage' ? <Storage onPlace={(p) => onPlace(p)} /> : null}
        {view === 'duplicates' ? <Duplicates /> : null}
        {view === 'links' ? <Links /> : null}
        {view === 'notifications' ? <Notifications /> : null}
        {view === 'companies' ? <Companies /> : null}
        {view === 'settings' ? <DriveSettings /> : null}
        {view === 'devices' ? <SyncDevices tree={tree} ask={syncAsk} conflicts={query.get('conflicts') === '1'} onAsked={() => go('/files?view=devices')} /> : null}
      </div>
      {preview ? <Preview files={preview.files} start={preview.index} onClose={() => setPreview(null)} /> : null}
      {editor?.kind === 'code' ? <CodeEditor key={editor.file.id} file={editor.file} onClose={() => (setEditor(null), refresh())} /> : null}
      {editor?.kind === 'viewer' ? <ImageViewer files={editor.files} start={editor.index} onClose={() => (setEditor(null), refresh())} onEdit={(f, version) => setEditor({ kind: 'image', file: f, version: version ?? null, list: editor.files })} /> : null}
      {editor?.kind === 'image' ? (
        <Suspense fallback={<div className="absolute inset-0 z-30 flex items-center justify-center bg-[#0B1120]"><Spinner label="Opening the photo editor…" /></div>}>
          <PhotoEditor
            key={`${editor.file?.id ?? 'new'}:${editor.version ?? ''}`}
            file={editor.file}
            blank={editor.blank ?? null}
            folderFiles={editor.list}
            reopenVersion={editor.version ?? null}
            onClose={() => (setEditor(null), refresh())}
            onSwitch={(x) => {
              const f = editor.list?.find((y) => y.id === x.id);
              if (f) setEditor({ ...editor, file: f, version: null });
              else void apiGet<DriveFile>(`/api/files/${x.id}`).then((g) => setEditor({ kind: 'image', file: g, version: null, list: editor.list }), (e: unknown) => toast('error', errorMessage(e)));
            }}
            onCreated={(id) => void apiGet<DriveFile>(`/api/files/${id}`).then((g) => (refresh(), setEditor({ kind: 'image', file: g, version: null })), () => refresh())}
            onReopenVersion={(v) => editor.file && setEditor({ ...editor, version: v })}
            onOpenConflicts={() => (setEditor(null), go('/files?view=devices&conflicts=1'))}
          />
        </Suspense>
      ) : null}
      {editor?.kind === 'media' ? <MediaViewer files={editor.files} start={editor.index} onClose={() => (setEditor(null), refresh())} /> : null}
      <div className="pointer-events-none fixed right-5 bottom-10 z-40 flex flex-col items-end gap-2.5 [&>*]:pointer-events-auto">
        {clash ? (
          <UploadConflicts
            conflicts={clash.conflicts}
            folderName={clash.folder ? (nameIn(tree, clash.folder) ?? 'this folder') : 'My Drive'}
            onCancel={() => setClash(null)}
            onDone={(choices) => {
              const c = clash;
              setClash(null);
              void sendUploads(c.picked, c.conflicts, choices, c.folder).catch((e) => toast('error', errorMessage(e)));
            }}
          />
        ) : null}
        {urlTray ? <UrlDownloads folderId={folderId} folderName={folderId ? (nameIn(tree, folderId) ?? 'this folder') : 'My Drive'} onClose={() => setUrlTray(false)} onOpenFolder={(id) => onPlace({ view: 'folder', folder: id })} /> : null}
        {batchJobs.map((j) => (
          <BatchTray key={String(j.id)} job={j} onClose={() => (setBatchJobs((all) => all.filter((x) => x.id !== j.id)), refresh())} />
        ))}
        {!editor && !preview ? <UploadTray /> : null}
        {/* Office files edited in another app here, waiting for a decision (OO-OFF-030). */}
        {!editor && !preview ? <LocalCopiesTray onReview={(c) => void openOfficeTab({ id: c.fileId, name: c.name }, 'VIEW')} /> : null}
      </div>
      {dialog?.kind === 'name' ? <NameDialog title={dialog.title} initial={dialog.initial} action={dialog.action} onClose={() => setDialog(null)} onSave={dialog.save} /> : null}
      {dialog?.kind === 'confirm' ? <ConfirmDialog title={dialog.title} body={dialog.body} action={dialog.action} danger onClose={() => setDialog(null)} onYes={dialog.run} /> : null}
      {dialog?.kind === 'pick' ? <FolderPicker items={dialog.items} mode={dialog.mode} onClose={() => setDialog(null)} onPick={(folder, name) => moveTo(dialog.items, folder, name, dialog.mode)} /> : null}
      {dialog?.kind === 'lock' ? <LockDialog folder={dialog.folder} on={dialog.on} onClose={() => setDialog(null)} onDone={refresh} /> : null}
      {dialog?.kind === 'archive' ? <ArchiveDialog file={dialog.file} onClose={() => setDialog(null)} onExtracted={(id) => onPlace({ view: 'folder', folder: id })} onDownload={() => d.download([dialog.file])} /> : null}
      {dialog?.kind === 'share' ? (
        <ShareDialog
          item={dialog.item}
          onClose={() => setDialog(null)}
          onSecureLink={() => dialog.item.type === 'file' && setDialog({ kind: 'secure', file: dialog.item.f })}
          onPublicLink={() => setDialog({ kind: 'link', item: dialog.item })}
          onSendToChat={() => setDialog({ kind: 'chat', item: dialog.item })}
        />
      ) : null}
      {dialog?.kind === 'secure' ? <SecureLinkDialog file={dialog.file} onClose={() => setDialog(null)} onAll={() => onPlace({ view: 'links', folder: null })} /> : null}
      {dialog?.kind === 'link' ? <LinkDialog item={dialog.item} onClose={() => (setDialog(null), refresh())} /> : null}
      {dialog?.kind === 'templates' ? (
        <TemplateDialog folderName={folderId ? (nameIn(tree, folderId) ?? 'this folder') : 'My Drive'} onClose={() => setDialog(null)} onPick={(t) => newOffice({ template_id: t.id })} />
      ) : null}
      {dialog?.kind === 'batch' ? <BatchDialog files={dialog.files} folderName={folderId ? (nameIn(tree, folderId) ?? 'this folder') : TITLES[place.view]} onClose={() => setDialog(null)} onStarted={(j) => setBatchJobs((all) => [...all, j])} /> : null}
      {dialog?.kind === 'new-image' ? (
        <CreateImageDialog
          preset={dialog.preset}
          folderName={folderId ? (nameIn(tree, folderId) ?? 'this folder') : 'My Drive'}
          onClose={() => setDialog(null)}
          onCreate={(spec) => (setDialog(null), setEditor({ kind: 'image', file: null, blank: { ...spec, folderId, folderName: folderId ? (nameIn(tree, folderId) ?? 'this folder') : 'My Drive' } }))}
        />
      ) : null}
      {dialog?.kind === 'chat' ? <SendToChatDialog item={dialog.item} discuss={dialog.discuss} onClose={() => setDialog(null)} onOpenChat={(room) => navigate(`/chat?room=${room}`)} /> : null}
      </div>
    </DriveCtx.Provider>
  );
}
