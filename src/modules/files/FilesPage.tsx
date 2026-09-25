import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { app } from '../../core/app-state';
import { ApiError, apiGetMeta } from '../../core/api';
import { call, errorMessage, registerDropped } from '../../core/bridge';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { bytes, dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { openOverlay } from '../../core/ui';
import { Icon } from '../../components/Icon';
import { Button, Chip, Empty, ErrorNote, FileBadge, IconButton, OfflineNote, Spinner, cx } from '../../components/ui';
import { VirtualList } from '../../components/VirtualList';
import type { ModuleProps } from '../registry';

/**
 * Files, online (Phase 1, §18; UI-11): browse WorkSuite Drive, upload by
 * button or by dropping files anywhere on the view (WF-31), download and
 * open locally. Keeping files on this computer and folder sync arrive with
 * the Drive sync engine (Phase 2), so every item shows as online.
 */
interface Access {
  can_download: boolean;
  capabilities: string[];
}
interface DriveFile {
  id: number;
  name: string;
  extension: string | null;
  size: number;
  version: number;
  created_at: string;
  is_favorite: boolean;
  access: Access | null;
}
interface DriveFolder {
  id: number | string;
  name: string;
  file_count: number | string | null;
  total_size: number | string | null;
  updated_at: string | null;
  is_locked?: boolean;
}
interface Browse {
  folder_id: number | null;
  breadcrumb: Array<{ id: number; name: string }>;
  locked: boolean;
  folders: DriveFolder[];
  files: DriveFile[];
}

type Row = { kind: 'folder'; f: DriveFolder } | { kind: 'file'; f: DriveFile };

export default function FilesPage(_props: ModuleProps) {
  useTabTitle('Files');
  const { query, go } = useTab();
  const folder = query.get('folder');
  const transfers = useStore(app, (s) => s.transfers.filter((t) => t.state === 'running' || t.state === 'queued').length);
  const [selected, setSelected] = useState<number | null>(query.get('file') ? Number(query.get('file')) : null);
  const [drag, setDrag] = useState(false);
  const q = useQuery({ queryKey: ['files', 'browse', folder], queryFn: ({ signal }) => apiGetMeta<Browse>('/api/files/browse', { folder_id: folder }, signal) });
  const data = q.data?.data;
  const rows: Row[] = [...(data?.folders ?? []).map((f) => ({ kind: 'folder' as const, f })), ...(data?.files ?? []).map((f) => ({ kind: 'file' as const, f }))];
  const file = data?.files.find((f) => f.id === selected) ?? null;

  useEffect(() => {
    if (query.get('upload') === '1') void upload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function upload(files?: File[]) {
    try {
      const picked = files ? await registerDropped(files) : await call('files:pickFiles', { multiple: true, title: 'Upload to WorkSuite Files' });
      if (picked.length === 0) return;
      await call('transfers:upload', { handles: picked.map((p) => p.handle), target: { kind: 'files', folderId: folder } });
      toast('info', `Uploading ${picked.length} file${picked.length === 1 ? '' : 's'} — see Transfers.`);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  }
  const download = async (f: DriveFile, open: boolean) => {
    try {
      await call('transfers:download', { fileId: String(f.id), name: f.name, open });
      toast('info', open ? `Opening ${f.name}…` : `Downloading ${f.name}…`);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  return (
    <div
      className="relative flex h-full"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDrag(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        void upload(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="flex w-[230px] shrink-0 flex-col gap-0.5 border-r border-line bg-surface p-3">
        <RailItem icon="folder" label="My Drive" active={!folder} onClick={() => go('/files')} />
        <RailItem icon="users" label="Shared with me" onClick={() => void call('app:openInBrowser', { path: '/files?view=shared' })} external />
        <RailItem icon="star" label="Favourites" onClick={() => void call('app:openInBrowser', { path: '/files?view=favorites' })} external />
        <div className="mt-auto rounded-[10px] bg-subtle p-3 text-[12px] leading-snug text-ink-2">
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-ink">
            <Icon name="cloud" size={14} /> Online files
          </div>
          A synced WorkSuite folder on this computer, offline files and conflict handling arrive with Drive sync.
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-line bg-surface px-5 py-3">
          <nav aria-label="Folder path" className="flex min-w-0 flex-1 items-center gap-1 text-[15px]">
            <button type="button" className="font-bold text-ink hover:underline" onClick={() => go('/files')}>
              My Drive
            </button>
            {(data?.breadcrumb ?? []).map((b) => (
              <span key={b.id} className="flex min-w-0 items-center gap-1">
                <Icon name="chevron-right" size={14} className="text-ink-3" />
                <button type="button" className="truncate font-semibold text-ink hover:underline" onClick={() => go(`/files?folder=${b.id}`)}>
                  {b.name}
                </button>
              </span>
            ))}
          </nav>
          {q.data?.offline ? <OfflineNote cachedAt={q.data.cachedAt} /> : null}
          <Button icon="upload" variant="primary" onClick={() => void upload()}>
            Upload
          </Button>
          <Button icon="transfers" onClick={() => openOverlay('transfers')}>
            Transfers{transfers ? ` (${transfers})` : ''}
          </Button>
        </div>
        <div className="grid grid-cols-[1fr_120px_140px_100px] gap-3 border-b border-line bg-subtle px-5 py-2 text-[12px] font-bold uppercase tracking-wide text-ink-3">
          <span>Name</span>
          <span>Status</span>
          <span>Added</span>
          <span className="text-right">Size</span>
        </div>
        <div className="min-h-0 flex-1">
          {q.isLoading ? <Spinner /> : q.error ? (
            <div className="p-5">
              <ErrorNote error={q.error instanceof ApiError && q.error.status === 403 ? 'This folder is locked or not shared with you. Open it in WorkSuite on the web.' : q.error} onRetry={() => void q.refetch()} />
            </div>
          ) : data?.locked ? (
            <Empty icon="lock" title="This folder is password-protected" hint="Open it in WorkSuite on the web to enter the password." action={<Button icon="external" onClick={() => void call('app:openInBrowser', { path: `/files?folder=${folder}` })}>Open in browser</Button>} />
          ) : rows.length === 0 ? (
            <Empty icon="folder-open" title="This folder is empty" hint="Drop files here to upload them." />
          ) : null}
          {rows.length > 0 && !data?.locked ? (
            <VirtualList
              items={rows}
              estimate={48}
              getKey={(r) => `${r.kind}:${r.f.id}`}
              render={(r) =>
                r.kind === 'folder' ? (
                  <button type="button" onDoubleClick={() => go(`/files?folder=${r.f.id}`)} onClick={() => go(`/files?folder=${r.f.id}`)} className="grid w-full grid-cols-[1fr_120px_140px_100px] items-center gap-3 border-b border-line bg-surface px-5 py-2.5 text-left hover:bg-subtle">
                    <span className="flex min-w-0 items-center gap-3">
                      <Icon name="folder" size={20} className="text-warning" />
                      <span className="truncate text-[13.5px] font-semibold text-ink">{r.f.name}</span>
                      {r.f.is_locked ? <Icon name="lock" size={13} className="text-ink-3" /> : null}
                    </span>
                    <span />
                    <span className="text-[12.5px] text-ink-3">{dateLabel(r.f.updated_at)}</span>
                    <span className="text-right text-[12.5px] text-ink-3">{r.f.file_count ? `${r.f.file_count} items` : ''}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSelected(r.f.id)}
                    onDoubleClick={() => void download(r.f, true)}
                    className={cx('grid w-full grid-cols-[1fr_120px_140px_100px] items-center gap-3 border-b border-line px-5 py-2.5 text-left', selected === r.f.id ? 'bg-selection' : 'bg-surface hover:bg-subtle')}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <FileBadge name={r.f.name} size={30} />
                      <span className="truncate text-[13.5px] font-semibold text-ink">{r.f.name}</span>
                    </span>
                    <span>
                      <Chip tone="muted">
                        <Icon name="cloud" size={12} /> Online
                      </Chip>
                    </span>
                    <span className="text-[12.5px] text-ink-3">{dateLabel(r.f.created_at)}</span>
                    <span className="text-right font-mono text-[12px] text-ink-3">{bytes(r.f.size)}</span>
                  </button>
                )
              }
            />
          ) : null}
        </div>
      </div>
      {file ? (
        <aside className="flex w-[300px] shrink-0 flex-col border-l border-line bg-surface p-5">
          <div className="flex justify-end">
            <IconButton icon="x" label="Close details" onClick={() => setSelected(null)} />
          </div>
          <div className="flex flex-col items-center gap-3 text-center">
            <FileBadge name={file.name} size={64} />
            <div className="break-all text-[15px] font-bold text-ink selectable">{file.name}</div>
            <div className="text-[12.5px] text-ink-3">
              {bytes(file.size)} · version {file.version} · added {dateLabel(file.created_at)}
            </div>
          </div>
          <div className="mt-6 flex flex-col gap-2">
            <Button variant="primary" icon="external" disabled={file.access?.can_download === false} onClick={() => void download(file, true)}>
              Open locally
            </Button>
            <Button icon="download" disabled={file.access?.can_download === false} onClick={() => void download(file, false)}>
              Download
            </Button>
            <Button icon="link" onClick={() => void call('app:openInBrowser', { path: `/files?file=${file.id}` })}>
              Share or preview on the web
            </Button>
            {file.access?.can_download === false ? <p className="text-[12px] text-ink-3">You can view this file but not download it.</p> : null}
          </div>
        </aside>
      ) : null}
      {drag ? (
        <div className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-[14px] border-2 border-dashed border-primary bg-selection/80 text-[16px] font-semibold text-primary">
          Drop to upload to {data?.breadcrumb.length ? data.breadcrumb[data.breadcrumb.length - 1]!.name : 'My Drive'}
        </div>
      ) : null}
    </div>
  );
}

function RailItem({ icon, label, active, onClick, external }: { icon: string; label: string; active?: boolean; onClick: () => void; external?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cx('flex h-9 items-center gap-2.5 rounded-[8px] px-3 text-[13.5px]', active ? 'bg-selection font-bold text-primary' : 'text-ink hover:bg-subtle')}>
      <Icon name={icon} size={16} />
      <span className="flex-1 text-left">{label}</span>
      {external ? <Icon name="external" size={12} className="text-ink-3" /> : null}
    </button>
  );
}
