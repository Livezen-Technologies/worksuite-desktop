import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { app } from '../../core/app-state';
import { apiDelete, apiGet, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { bytes } from '../../core/time';
import { toast } from '../../core/toasts';
import { openOverlay } from '../../core/ui';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';

const tray = 'no-drag flex w-[360px] flex-col gap-2 rounded-[14px] border border-line bg-surface p-3 text-[12.5px] shadow-[0_18px_44px_rgba(15,27,61,.22)]';
const bar = (pct: number, tone: string) => (
  <div className="h-[5px] overflow-hidden rounded-[3px] bg-subtle">
    <div className={cx('h-[5px] rounded-[3px]', tone)} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
  </div>
);

/**
 * Uploads (DriveTrash, bottom right): what is going up to the Drive, with its
 * progress; a folder's files keep their places inside it. Everything else
 * about a transfer is in Transfers.
 */
export function UploadTray() {
  const transfers = useStore(app, (s) => s.transfers);
  const all = transfers.filter((t) => t.direction === 'upload' && t.destination === 'WorkSuite Files');
  const [hidden, setHidden] = useState<string | null>(null);
  const running = all.filter((t) => t.state === 'running' || t.state === 'queued');
  const key = all.map((t) => t.id).join(',');
  if (!all.length || hidden === key || (!running.length && all.every((t) => t.state === 'done' && hidden !== null))) return null;
  const done = all.filter((t) => t.state === 'done').length;
  const failed = all.filter((t) => t.state === 'failed').length;
  const folders = new Set(all.filter((t) => t.name.includes('/')).map((t) => t.name.split('/')[0]));
  const shown = [...running, ...all.filter((t) => t.state !== 'running' && t.state !== 'queued')].slice(0, 5);
  return (
    <section aria-label="Uploads" className={tray}>
      <div className="flex items-center gap-2">
        <b className="flex-1 text-ink">
          {running.length ? `Uploading ${done + 1} of ${all.length}` : failed ? `${failed} ${failed === 1 ? 'upload' : 'uploads'} failed` : 'Uploads done'}
          {folders.size ? ` · ${folders.size} ${folders.size === 1 ? 'folder' : 'folders'}` : ''}
        </b>
        <button type="button" onClick={() => openOverlay('transfers')} className="font-semibold text-primary hover:underline">Transfers</button>
        <button type="button" aria-label="Hide the uploads" onClick={() => setHidden(key)} className="flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle">
          <Icon name="chevron-down" size={14} />
        </button>
      </div>
      {shown.map((t) => {
        const pct = t.total ? (t.bytes / t.total) * 100 : t.state === 'done' ? 100 : 0;
        return (
          <div key={t.id} className="flex flex-col gap-1">
            <div className="flex gap-2">
              <b className="min-w-0 flex-1 truncate font-semibold text-ink" title={t.name}>{t.name}</b>
              <span className={cx('shrink-0', t.state === 'done' ? 'text-success' : t.state === 'failed' ? 'text-danger' : 'text-ink-2')}>
                {t.state === 'done' ? 'Done' : t.state === 'failed' ? 'Failed' : t.state === 'queued' ? 'Starting…' : t.state === 'paused' ? 'Paused' : `${Math.round(pct)}%`}
              </span>
            </div>
            {bar(pct, t.state === 'done' ? 'bg-success' : t.state === 'failed' ? 'bg-danger' : 'bg-primary')}
          </div>
        );
      })}
      {folders.size ? <div className="text-[11.5px] text-ink-3">A folder keeps its structure in the Drive.</div> : null}
    </section>
  );
}

interface UrlJob {
  id: number;
  url: string;
  filename: string | null;
  status: 'queued' | 'downloading' | 'paused' | 'completed' | 'failed' | 'canceled';
  total_size: number | string;
  downloaded: number | string;
  speed?: number | string | null;
  kind?: string | null;
  file_id: number | null;
  folder_id: number | null;
  error: string | null;
}

const ACTIVE = ['queued', 'downloading'];

/**
 * Downloads into Drive (DriveTrash): a web address, or a magnet link, fetched
 * by the server straight into the Drive — nothing passes through this Mac.
 */
export function UrlDownloads({ folderId, folderName, onClose, onOpenFolder }: { folderId: number | null; folderName: string; onClose: () => void; onOpenFolder: (id: number | null) => void }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ['files', 'url-downloads'],
    queryFn: ({ signal }) => apiGet<{ items: UrlJob[] }>('/api/url-downloads', { per_page: 25 }, signal),
    refetchInterval: (query) => ((query.state.data?.items ?? []).some((j) => ACTIVE.includes(j.status)) ? 2000 : 15_000),
  });
  const jobs = q.data?.items ?? [];
  const add = async () => {
    const u = url.trim();
    if (!/^(https?|ftp):\/\/\S+$|^magnet:\?\S+$/i.test(u)) return toast('error', 'Paste a web address (http, https or ftp) or a magnet link.');
    setBusy(true);
    try {
      await apiPost('/api/url-downloads', { url: u, folder_id: folderId });
      setUrl('');
      void q.refetch();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const act = async (j: UrlJob, what: 'pause' | 'resume' | 'retry' | 'cancel' | 'remove') => {
    try {
      if (what === 'remove') await apiDelete(`/api/url-downloads/${j.id}`);
      else await apiPost(`/api/url-downloads/${j.id}/${what}`);
      void q.refetch();
      if (what === 'remove') void qc.invalidateQueries({ queryKey: ['files', 'list'] });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const waiting = jobs.filter((j) => j.status === 'queued').length;
  const done = jobs.some((j) => j.status === 'completed');
  return (
    <section aria-label="Downloads into Drive" className={tray}>
      <div className="flex items-center gap-2">
        <b className="flex-1 text-ink">Downloads into Drive</b>
        <button type="button" aria-label="Hide downloads" onClick={onClose} className="flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle">
          <Icon name="chevron-down" size={14} />
        </button>
      </div>
      <div className="flex gap-1.5">
        <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} aria-label="URL or magnet link" placeholder="Paste a URL or magnet link" className="h-8 min-w-0 flex-1 rounded-[8px] border border-line bg-surface px-2.5 text-ink outline-none focus:border-primary" />
        <button type="button" disabled={busy || !url.trim()} onClick={() => void add()} className="h-8 rounded-[8px] bg-primary px-3 font-bold text-white disabled:opacity-50">Add</button>
      </div>
      {q.error ? <span className="text-danger">{errorMessage(q.error)}</span> : null}
      <div className="flex max-h-[260px] flex-col gap-2 overflow-y-auto scroll-thin">
        {jobs.slice(0, 8).map((j) => {
          const total = Number(j.total_size) || 0;
          const got = Number(j.downloaded) || 0;
          const pct = total ? (got / total) * 100 : j.status === 'completed' ? 100 : 0;
          const magnet = j.url.startsWith('magnet:') || j.kind === 'torrent' || j.kind === 'magnet';
          const status =
            j.status === 'completed' ? 'Done' : j.status === 'failed' ? 'Failed' : j.status === 'canceled' ? 'Cancelled' : j.status === 'paused' ? 'Paused' : j.status === 'queued' ? 'Waiting to start…' : total ? `${Math.round(pct)}%` : magnet ? 'Finding peers…' : 'Starting…';
          return (
            <div key={j.id} className="flex flex-col gap-1">
              <div className="flex gap-2">
                <b className="min-w-0 flex-1 truncate font-semibold text-ink" title={j.url}>{j.filename || j.url.replace(/^magnet:\?.*dn=([^&]+).*$/, (_m, n: string) => decodeURIComponent(n))}</b>
                <span className={cx('shrink-0', j.status === 'completed' ? 'text-success' : j.status === 'failed' ? 'text-danger' : 'text-ink-2')}>{status}</span>
              </div>
              {bar(pct, j.status === 'completed' ? 'bg-success' : j.status === 'failed' ? 'bg-danger' : 'bg-[#0E7C86]')}
              <div className="flex items-center gap-2 text-[11.5px] text-ink-3">
                <span className="min-w-0 flex-1 truncate">{j.error ?? (magnet ? `Magnet link${Number(j.speed) ? ` · ${bytes(Number(j.speed))}/s` : ''}` : `${total ? `${bytes(got)} of ${bytes(total)} · ` : ''}${Number(j.speed) ? `${bytes(Number(j.speed))}/s · ` : ''}${j.url}`)}</span>
                {j.status === 'downloading' || j.status === 'queued' ? <button type="button" onClick={() => void act(j, 'pause')} className="font-semibold text-primary hover:underline">Pause</button> : null}
                {j.status === 'paused' ? <button type="button" onClick={() => void act(j, 'resume')} className="font-semibold text-primary hover:underline">Resume</button> : null}
                {j.status === 'failed' || j.status === 'canceled' ? <button type="button" onClick={() => void act(j, 'retry')} className="font-semibold text-primary hover:underline">Retry</button> : null}
                {ACTIVE.includes(j.status) || j.status === 'paused' ? <button type="button" onClick={() => void act(j, 'cancel')} className="font-semibold text-danger hover:underline">Cancel</button> : null}
                {!ACTIVE.includes(j.status) && j.status !== 'paused' ? <button type="button" aria-label={`Remove ${j.filename ?? 'download'} from the list`} onClick={() => void act(j, 'remove')} className="text-ink-3 hover:text-danger">×</button> : null}
              </div>
            </div>
          );
        })}
        {q.isSuccess && !jobs.length ? <span className="text-ink-3">Nothing yet. Files arrive in {folderName}.</span> : null}
      </div>
      <div className="flex items-center justify-between border-t border-line pt-2 text-[11.5px] text-ink-3">
        <span>{waiting ? `Next up: ${waiting} · ` : ''}Saved to {folderName}</span>
        {done ? <button type="button" onClick={() => onOpenFolder(folderId)} className="font-semibold text-primary hover:underline">Open folder</button> : null}
      </div>
    </section>
  );
}
