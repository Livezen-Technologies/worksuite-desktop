import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { PickedFile } from '@shared/ipc/contract';
import { app } from '../../core/app-state';
import { apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { call, errorMessage, registerDropped } from '../../core/bridge';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { useNow } from '../calls/parts';
import type { ModuleProps } from '../registry';
import { ALL_VIEWS, TITLES, TONE, can, openWay, pathTo, splitKeys, tree as loadTree, type DriveFile, type DriveFolder, type Key, type TreeNode, type View } from './api';
import { DriveCtx, type Drive, type Item } from './ctx';
import { ArchiveDialog, ConfirmDialog, FolderPicker, LinkDialog, LockDialog, NameDialog, SecureLinkDialog, SendToChatDialog } from './Dialogs';
import { Explorer } from './Explorer';
import { Home } from './Home';
import { lockPassword } from './locks';
import type { MenuItem } from './Menu';
import { Preview } from './Preview';
import { openPdf } from '../pdf/open';
import { Rail, type Place } from './Rail';
import { CodeEditor } from './CodeEditor';
import { ImageEditor } from './ImageEditor';
import { MediaViewer } from './MediaViewer';
import { ShareDialog } from './Share';
import { UploadTray, UrlDownloads } from './Trays';
import { Shared } from './Shared';
import { Companies, Duplicates, Links, Notifications, Storage, Trash } from './Views';
import { SyncDevices } from './SyncDevices';
import { UploadConflicts, autoChoices, type ConflictChoice, type UploadConflict } from './UploadConflicts';
import { DriveSettings } from './DriveSettings';
import { officeOpenWay, openOfficeTab, useOfficeRouting } from './office';
import { TemplateDialog } from './Templates';
import { createDocument } from '../office/api';
import { LocalCopiesTray, externalApps, openInApp } from '../office/local';
import { SidePanel } from '../../components/SidePanel';

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
  | { kind: 'templates' };

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
  const { query, go, navigate, active } = useTab();
  const place = placeFrom(query);
  useTabTitle(place.view === 'home' ? 'Files' : `Files · ${TITLES[place.view]}`);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [preview, setPreview] = useState<{ files: DriveFile[]; index: number } | null>(null);
  const [editor, setEditor] = useState<{ kind: 'code' | 'image'; file: DriveFile } | { kind: 'media'; files: DriveFile[]; index: number } | null>(null);
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

  const uploadFolder = async () => {
    try {
      const picked = await call('files:pickFolder', { title: 'Upload a folder to WorkSuite Files' });
      if (!picked.length) return;
      await call('transfers:upload', { handles: picked.map((p) => p.handle), target: { kind: 'files', folderId: folderId === null ? null : String(folderId) } });
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

  const moveTo = (items: Item[], folder: number | null, name: string, mode: 'move' | 'copy') =>
    void run(async () => {
      let done = 0;
      const failed: string[] = [];
      for (const i of items) {
        try {
          if (mode === 'copy' && i.type === 'file') await apiPost(`/api/files/${i.f.id}/copy`, { folder_id: folder });
          else if (i.type === 'file') await apiPut(`/api/files/${i.f.id}`, { folder_id: folder });
          else await apiPost(`/api/drive/folders/${i.f.id}/move`, { parent_id: folder });
          done++;
        } catch (e) {
          failed.push(`${i.f.name}: ${errorMessage(e)}`);
        }
      }
      if (done) toast('success', `${mode === 'move' ? 'Moved' : 'Copied'} ${done} ${done === 1 ? 'item' : 'items'} to ${name}`);
      if (failed.length) toast('error', failed.slice(0, 2).join(' · ') + (failed.length > 2 ? ` · and ${failed.length - 2} more` : ''));
    });

  const trashNow = (items: Item[]) =>
    void run(async () => {
      const files = items.filter((i) => i.type === 'file').map((i) => i.f.id);
      const folders = items.filter((i) => i.type === 'folder').map((i) => i.f.id);
      for (const id of files) await apiDelete(`/api/files/${id}`);
      for (const id of folders) await apiDelete(`/api/folders/${id}`);
      if (files.length && !folders.length) {
        toast('success', `${files.length === 1 ? `“${items[0]!.f.name}”` : `${files.length} files`} moved to the recycle bin`, {
          label: 'Undo',
          run: () =>
            void run(async () => {
              for (const id of files) await apiPost(`/api/files/${id}/restore`);
            }, 'Restored'),
        });
      } else toast('success', `${items.length} ${items.length === 1 ? 'item' : 'items'} deleted`);
    });

  const d: Drive = {
    folderId,
    openFolder: (id) => onPlace({ view: 'folder', folder: id }),
    open: (item, list) => {
      if (item.type === 'folder') return onPlace({ view: 'folder', folder: item.f.id });
      const f = item.f;
      const way = openWay(f);
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
      if (office === 'office') return d.office(f);
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
      const folders = items.filter((i) => i.type === 'folder');
      if (folders.length || items.length > 1) {
        setDialog({
          kind: 'confirm',
          title: items.length === 1 ? `Delete “${items[0]!.f.name}”?` : `Delete ${items.length} items?`,
          body: folders.length ? 'Files go to the recycle bin for 30 days. A deleted folder can’t be brought back from there.' : 'They go to the recycle bin for 30 days.',
          action: folders.length ? 'Delete' : 'Move to trash',
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
        save: async (name) => {
          if (name === item.f.name) return;
          if (item.type === 'file') await apiPut(`/api/files/${item.f.id}`, { name });
          else await apiPut(`/api/drive/folders/${item.f.id}`, { name });
          toast('success', 'Renamed');
          refresh();
        },
      }),
    move: (items, mode) => setDialog({ kind: 'pick', items, mode }),
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
    editImage: (f) => (setPreview(null), setEditor({ kind: 'image', file: f })),
    play: (files, index) => setEditor({ kind: 'media', files, index }),
    inBrowser: (f) => void call('app:openInBrowser', { path: `/files?file=${f.id}` }),
    syncFolder: (f) => go(`/files?view=devices&sync=${f.id}`),
    newFolder: () =>
      setDialog({
        kind: 'name',
        title: 'New folder',
        initial: 'Untitled folder',
        action: 'Create',
        save: async (name) => {
          const r = await apiPost<{ id: number | string }>('/api/folders', { name, parent_id: folderId });
          toast('success', `Folder “${name}” created`);
          refresh();
          askDetails(`d:${Number(r.id)}`);
        },
      }),
    upload: () => void upload(),
    drop: (e: DragEvent, folder) => {
      const internal = e.dataTransfer.getData('application/x-ws-drive');
      if (internal) {
        try {
          const keys = (JSON.parse(internal) as Key[]).filter((k) => k !== `d:${folder}`);
          const { files, folders } = splitKeys(keys);
          const items: Item[] = [...files.map((id) => ({ type: 'file' as const, f: { id, name: `file ${id}` } as DriveFile })), ...folders.map((id) => ({ type: 'folder' as const, f: { id, name: `folder ${id}` } as DriveFolder }))];
          if (items.length) moveTo(items, folder, folder === null ? 'My Drive' : (nameIn(tree, folder) ?? 'the folder'), 'move');
        } catch {
          /* not ours */
        }
        return;
      }
      const dropped = Array.from(e.dataTransfer.files);
      if (dropped.length) void upload(dropped, folder);
    },
    refresh,
  };

  /** + New → Document, Spreadsheet, Presentation, or from a template: made by the server and opened for editing (OO-DRV-050). */
  const newOffice = async (input: { type?: 'document' | 'spreadsheet' | 'presentation'; template_id?: string }) => {
    try {
      const r = await createDocument({ ...input, folder_id: folderId });
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
    { label: 'New folder', hint: '⇧⌘N', tag: { text: 'DIR', tone: TONE.folder! }, run: d.newFolder },
    { sep: true },
    { label: 'Upload files…', tag: { text: 'UP', tone: TONE.code! }, run: d.upload },
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
  const openedFile = useRef<string | null>(null);
  useEffect(() => {
    if (!fileParam || !/^\d+$/.test(fileParam) || openedFile.current === fileParam) return;
    openedFile.current = fileParam;
    // Shared with me, with the item picked out (#170): it stays in that list rather than going to its folder.
    if (place.view === 'shared') return;
    void apiGet<DriveFile>(`/api/files/${fileParam}`)
      .then((f) => {
        onPlace(f.folder_id ? { view: 'folder', folder: f.folder_id } : { view: 'home', folder: null });
        if (playParam) d.open({ type: 'file', f });
      })
      .catch((e) => toast('error', errorMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileParam]);

  const view = place.view;
  const listView = !PAGES.includes(view);
  // /files?view=devices&sync=<folder id>: "Sync to this computer" from a folder's menu or details.
  const syncParam = query.get('sync');
  const syncAsk = syncParam === 'all' ? 'all' : syncParam && /^\d+$/.test(syncParam) ? Number(syncParam) : null;

  return (
    <DriveCtx.Provider value={d}>
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
            onUpload={d.upload}
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
        {view === 'devices' ? <SyncDevices tree={tree} ask={syncAsk} onAsked={() => go('/files?view=devices')} /> : null}
      </div>
      {preview ? <Preview files={preview.files} start={preview.index} onClose={() => setPreview(null)} /> : null}
      {editor?.kind === 'code' ? <CodeEditor key={editor.file.id} file={editor.file} onClose={() => (setEditor(null), refresh())} /> : null}
      {editor?.kind === 'image' ? <ImageEditor key={editor.file.id} file={editor.file} onClose={() => (setEditor(null), refresh())} /> : null}
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
      {dialog?.kind === 'chat' ? <SendToChatDialog item={dialog.item} discuss={dialog.discuss} onClose={() => setDialog(null)} onOpenChat={(room) => navigate(`/chat?room=${room}`)} /> : null}
    </DriveCtx.Provider>
  );
}
