import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiDelete, apiGet, apiGetMeta, apiPost, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { bytes, dateLabel, listStamp } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, ErrorNote, Modal, OfflineNote, Spinner, cx } from '../../components/ui';
import type { DriveFile, DriveList, DriveStorage, DuplicateGroup } from './api';
import { fileMenu, useDrive } from './ctx';
import { ConfirmDialog } from './Dialogs';
import { PopMenu, below, type MenuItem } from './Menu';
import type { Place } from './Rail';
import { FileIcon } from './Thumb';
import { Select } from '../../components/Select';
import { Checkbox } from '../../components/Checkbox';

const page = 'flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto bg-surface px-7 py-5 scroll-thin';
const th = 'text-[11px] font-bold tracking-[0.4px] text-ink-2';

/** Recycle bin (DriveTrash): restore, delete forever, restore all, empty. */
export function Trash() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['files', 'trash'], queryFn: ({ signal }) => apiGetMeta<DriveList>('/api/drive/list', { view: 'trash', per_page: 200, counts: 0, sort: 'modified', dir: 'desc' }, signal), refetchInterval: 60_000 });
  const [confirm, setConfirm] = useState<{ title: string; body: string; action: string; run: () => void } | null>(null);
  const [busy, setBusy] = useState(false);
  const files = q.data?.data.files ?? [];
  const refresh = () => void qc.invalidateQueries({ queryKey: ['files'] });
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast('success', done);
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const restoreAll = () => run(async () => {
    for (const f of files) await apiPost(`/api/files/${f.id}/restore`);
  }, `${files.length} ${files.length === 1 ? 'file' : 'files'} restored`);
  return (
    <main aria-label="Recycle bin" className={page}>
      <div className="flex items-center gap-2.5">
        <div className="flex flex-1 flex-col gap-0.5">
          <h1 className="text-[20px] font-bold text-ink">Recycle bin</h1>
          <span className="text-[12.5px] text-ink-3">Files are deleted forever after 30 days. Deleted folders don’t come here; the server can’t bring them back.</span>
        </div>
        <Button disabled={!files.length || busy} onClick={() => void restoreAll()}>Restore all</Button>
        <Button variant="danger" disabled={!files.length || busy} onClick={() => setConfirm({ title: 'Empty the recycle bin?', body: `${files.length} ${files.length === 1 ? 'file' : 'files'} will be deleted forever. This can’t be undone.`, action: 'Empty recycle bin', run: () => void run(() => apiPost('/api/files/trash/empty'), 'Recycle bin emptied') })}>Empty recycle bin</Button>
      </div>
      {q.data?.offline ? <OfflineNote cachedAt={q.data.cachedAt} /> : null}
      {q.isLoading ? <Spinner /> : null}
      {q.error && !q.data ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.isSuccess && !files.length ? <div className="py-16 text-center text-[13px] text-ink-3">The recycle bin is empty.</div> : null}
      {files.length ? (
        <div role="table" aria-label="Deleted files" className="text-[13px]">
          <div role="row" className={cx('grid grid-cols-[minmax(0,2.4fr)_minmax(0,1.8fr)_minmax(0,1fr)_minmax(0,0.8fr)_220px] gap-2 border-y border-line bg-ground px-3 py-[7px]', th)}>
            <span>NAME</span><span>ORIGINAL LOCATION</span><span>DELETED</span><span>SIZE</span><span />
          </div>
          {files.map((f) => (
            <div key={f.id} role="row" className="grid grid-cols-[minmax(0,2.4fr)_minmax(0,1.8fr)_minmax(0,1fr)_minmax(0,0.8fr)_220px] items-center gap-2 border-b border-line/70 px-3 py-1.5">
              <span role="cell" className="flex min-w-0 items-center gap-2.5"><FileIcon f={f} size={28} /><b className="truncate text-ink">{f.name}</b></span>
              <span role="cell" className="truncate text-ink-2">{f.folder_path ? f.folder_path.replace(/\//g, ' › ') : f.folder_name || 'My Drive'}</span>
              <span role="cell" className="text-ink-2">{listStamp(f.deleted_at)}</span>
              <span role="cell" className="font-mono text-[12px] text-ink-2">{bytes(f.size)}</span>
              <span role="cell" className="flex justify-end gap-1.5">
                <Button size="sm" disabled={busy} onClick={() => void run(() => apiPost(`/api/files/${f.id}/restore`), `“${f.name}” restored`)}>Restore</Button>
                <Button size="sm" variant="danger" disabled={busy} onClick={() => setConfirm({ title: `Delete “${f.name}” forever?`, body: 'It can’t be brought back.', action: 'Delete forever', run: () => void run(() => apiDelete(`/api/files/${f.id}/purge`), `“${f.name}” deleted forever`) })}>Delete forever</Button>
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {confirm ? <ConfirmDialog title={confirm.title} body={confirm.body} action={confirm.action} danger onClose={() => setConfirm(null)} onYes={confirm.run} /> : null}
    </main>
  );
}

const KIND_LABEL: Record<string, string> = { video: 'Video', image: 'Images', archive: 'Archives', document: 'Documents', pdf: 'PDFs', audio: 'Audio', spreadsheet: 'Spreadsheets', presentation: 'Presentations', code: 'Code', design: 'Design', other: 'Other' };

/** Storage (DriveStorage): how much is used, where it went, what could be freed, and the largest files. */
export function Storage({ onPlace }: { onPlace: (p: Place) => void }) {
  const d = useDrive();
  const q = useQuery({ queryKey: ['files', 'storage'], queryFn: ({ signal }) => apiGet<DriveStorage>('/api/drive/storage', undefined, signal) });
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItem[] } | null>(null);
  const s = q.data;
  const top = Math.max(1, ...(s?.by_kind ?? []).map((k) => k.bytes));
  const pct = s?.quota ? Math.min(100, Math.round((s.used / s.quota) * 100)) : 0;
  return (
    <main aria-label="Storage" className={page}>
      <h1 className="text-[20px] font-bold text-ink">Storage</h1>
      {q.isLoading ? <Spinner /> : null}
      {q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {s ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2 rounded-[12px] border border-line p-4">
              <span className="text-[12px] text-ink-3">In WorkSuite Drive</span>
              <span className="text-[22px] font-bold text-ink">{bytes(s.used)} <span className="text-[13px] font-medium text-ink-3">{s.quota ? `of ${bytes(s.quota)}` : 'used'}</span></span>
              {s.quota ? <div className="h-2 overflow-hidden rounded-full bg-subtle"><div className={cx('h-2 rounded-full', pct > 90 ? 'bg-danger' : 'bg-primary')} style={{ width: `${pct}%` }} /></div> : null}
            </div>
            <div className="flex flex-col gap-2 rounded-[12px] border border-line p-4">
              <span className="text-[12px] text-ink-3">Could be freed</span>
              <span className="text-[22px] font-bold text-ink">{bytes(s.duplicates.wasted + s.trash.bytes)}</span>
              <span className="text-[12px] text-ink-3">
                <button type="button" onClick={() => onPlace({ view: 'duplicates', folder: null })} className="font-semibold text-primary hover:underline">{s.duplicates.groups.toLocaleString()} {s.duplicates.groups === 1 ? 'set' : 'sets'} of duplicates</button> · {bytes(s.trash.bytes)} in the <button type="button" onClick={() => onPlace({ view: 'trash', folder: null })} className="font-semibold text-primary hover:underline">recycle bin</button>
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-5">
            <section className="flex flex-col gap-2.5">
              <h2 className="text-[13px] font-bold text-ink">Where the space went</h2>
              {s.by_kind.map((k) => (
                <div key={k.kind} className="grid grid-cols-[110px_1fr_80px] items-center gap-3 text-[12.5px]">
                  <span className="text-ink">{KIND_LABEL[k.kind] ?? k.kind}</span>
                  <span className="h-3 overflow-hidden rounded-full bg-subtle"><span className="block h-3 rounded-full bg-primary" style={{ width: `${Math.max(2, Math.round((k.bytes / top) * 100))}%` }} /></span>
                  <span className="text-right text-ink-2">{bytes(k.bytes)}</span>
                </div>
              ))}
              {!s.by_kind.length ? <span className="text-[12.5px] text-ink-3">Nothing stored yet.</span> : null}
            </section>
            <section className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <h2 className="text-[13px] font-bold text-ink">Largest files</h2>
                <button type="button" onClick={() => onPlace({ view: 'large', folder: null })} className="text-[12px] font-semibold text-primary hover:underline">See all large files</button>
              </div>
              {s.largest.slice(0, 9).map((f) => (
                <div key={f.id} className="flex items-center gap-2.5 border-b border-line/70 py-1.5 text-[12.5px]">
                  <FileIcon f={f} size={26} />
                  <button type="button" onClick={() => d.open({ type: 'file', f }, s.largest)} className="flex min-w-0 flex-1 flex-col text-left">
                    <b className="truncate text-ink">{f.name}</b>
                    <span className="truncate text-[11.5px] text-ink-3">{f.folder_path?.replace(/\//g, ' › ') || f.folder_name || 'My Drive'}</span>
                  </button>
                  <span className="font-mono text-[12px] text-ink-2">{bytes(f.size)}</span>
                  <button type="button" aria-label={`More actions for ${f.name}`} onClick={(e) => setMenu({ at: below(e.currentTarget, 'right'), items: fileMenu(f, d, s.largest) })} className="h-7 w-7 rounded-[7px] font-bold text-ink-2 hover:bg-subtle">⋯</button>
                </div>
              ))}
            </section>
          </div>
        </>
      ) : null}
      {menu ? <PopMenu at={menu.at} items={menu.items} label="File actions" onClose={() => setMenu(null)} /> : null}
    </main>
  );
}

/** Duplicates: the same content stored more than once; keep the newest, trash the rest. */
export function Duplicates() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['files', 'duplicates'], queryFn: ({ signal }) => apiGet<DriveList & { duplicates: DuplicateGroup[]; wasted: number }>('/api/drive/list', { view: 'duplicates', per_page: 200, counts: 0 }, signal) });
  const [busy, setBusy] = useState<string | null>(null);
  const tidy = async (g: DuplicateGroup) => {
    setBusy(g.sha256);
    const keep = [...g.files].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0]!;
    try {
      for (const f of g.files) if (f.id !== keep.id) await apiDelete(`/api/files/${f.id}`);
      toast('success', `Kept “${keep.name}”; ${g.files.length - 1} moved to the recycle bin`);
      void qc.invalidateQueries({ queryKey: ['files'] });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const groups = q.data?.duplicates ?? [];
  return (
    <main aria-label="Duplicates" className={page}>
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[20px] font-bold text-ink">Duplicates</h1>
        <span className="text-[12.5px] text-ink-3">{q.data ? `${groups.length.toLocaleString()} ${groups.length === 1 ? 'file is' : 'files are'} stored more than once · ${bytes(q.data.wasted ?? 0)} could be freed` : ' '}</span>
      </div>
      {q.isLoading ? <Spinner /> : null}
      {q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.isSuccess && !groups.length ? <div className="py-16 text-center text-[13px] text-ink-3">No file is stored twice.</div> : null}
      {groups.map((g) => (
        <div key={g.sha256} className="flex flex-col gap-1.5 rounded-[12px] border border-line p-3">
          <div className="flex items-center gap-2.5">
            <span className="flex min-w-0 flex-1 flex-col">
              <b className="truncate text-[13px] text-ink">{g.files[0]?.name}</b>
              <span className="text-[12px] text-ink-3">{g.copies} copies · {bytes(g.size)} each · {bytes(g.wasted)} to free</span>
            </span>
            <Button size="sm" disabled={busy !== null} loading={busy === g.sha256} onClick={() => void tidy(g)}>Keep newest, trash others</Button>
          </div>
          {g.files.map((f) => (
            <div key={f.id} className="flex gap-2.5 pl-2 text-[12px] text-ink-2">
              <span className="min-w-0 flex-1 truncate">{f.folder_path?.replace(/\//g, ' › ') || f.folder_name || 'My Drive'} › {f.name}</span>
              <span>{dateLabel(f.created_at)}</span>
            </div>
          ))}
        </div>
      ))}
    </main>
  );
}

interface GrantRow {
  id: number;
  token: string;
  label: string | null;
  file_id: number;
  file_name: string;
  max_downloads: number | null;
  downloads_used: number;
  one_time: number | boolean;
  allowed_ips: string | null;
  expires_at: string | null;
  status: string;
  has_password: number | boolean;
  url: string;
  expired: boolean;
}
interface ShareRow {
  id: number;
  file_id: number | null;
  folder_id: number | null;
  visibility: string;
  expires_at: string | null;
  status: string;
  url: string;
  created_at: string;
}
interface LogRow {
  ip: string;
  country: string | null;
  created_at: string;
  user_name: string | null;
}

/** Secure links and public links you have made (DriveSettings): copy, the downloads log, revoke. */
export function Links() {
  const qc = useQueryClient();
  const grants = useQuery({ queryKey: ['files', 'grants'], queryFn: ({ signal }) => apiGet<{ items: GrantRow[] }>('/api/downloads/grants', { per_page: 100 }, signal) });
  const shares = useQuery({ queryKey: ['files', 'shares'], queryFn: ({ signal }) => apiGet<{ items: ShareRow[] }>('/api/shares', { per_page: 100 }, signal) });
  const [log, setLog] = useState<GrantRow | null>(null);
  const logs = useQuery({ queryKey: ['files', 'grant-log', log?.id], queryFn: ({ signal }) => apiGet<LogRow[] | { items: LogRow[] }>(`/api/downloads/grants/${log!.id}/logs`, undefined, signal), enabled: !!log });
  const revoke = async (path: string) => {
    try {
      await apiPost(path);
      toast('success', 'Link revoked');
      void qc.invalidateQueries({ queryKey: ['files'] });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const copy = (url: string) => void navigator.clipboard.writeText(url).then(() => toast('success', 'Copied'));
  const g = grants.data?.items ?? [];
  const active = g.filter((x) => x.status === 'active' && !x.expired).length;
  const statusOf = (x: GrantRow): [string, string] => (x.status === 'revoked' ? ['Revoked', 'text-ink-3'] : x.expired ? ['Expired', 'text-ink-3'] : x.max_downloads && x.downloads_used >= x.max_downloads ? ['Used up', 'text-warning'] : ['Active', 'text-success']);
  const logRows = Array.isArray(logs.data) ? logs.data : (logs.data?.items ?? []);
  return (
    <main aria-label="Secure links" className={page}>
      <div className="flex items-baseline gap-2.5">
        <h1 className="text-[20px] font-bold text-ink">Secure links</h1>
        <span className="text-[12.5px] text-ink-3">{grants.data ? `${active} active · ${g.length - active} not` : ''}</span>
      </div>
      {grants.isLoading ? <Spinner /> : null}
      {grants.error ? <ErrorNote error={grants.error} onRetry={() => void grants.refetch()} /> : null}
      {grants.isSuccess && !g.length ? <span className="text-[13px] text-ink-3">You have not made a secure link. Make one from a file’s menu.</span> : null}
      {g.length ? (
        <div role="table" aria-label="Secure links" className="text-[12.5px]">
          <div role="row" className={cx('grid grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_70px_110px_80px_190px] gap-2 border-y border-line bg-ground px-3 py-[7px]', th)}>
            <span>LINK</span><span>RULES</span><span>USED</span><span>EXPIRES</span><span>STATUS</span><span>ACTIONS</span>
          </div>
          {g.map((x) => {
            const [st, tone] = statusOf(x);
            const rules = [x.has_password ? 'Password' : null, x.allowed_ips ? 'IP-locked' : null, x.one_time ? 'One time' : x.max_downloads ? `${x.max_downloads} downloads` : null].filter(Boolean) as string[];
            return (
              <div key={x.id} role="row" className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_70px_110px_80px_190px] items-center gap-2 border-b border-line/70 px-3 py-2">
                <span role="cell" className="flex min-w-0 flex-col"><b className="truncate text-ink">{x.label || x.file_name}</b><span className="truncate font-mono text-[11px] text-ink-3">{x.label ? `${x.file_name} · ` : ''}/d/{x.token.slice(0, 10)}…</span></span>
                <span role="cell" className="flex flex-wrap gap-1">{rules.length ? rules.map((r) => <span key={r} className="rounded-lg bg-subtle px-1.5 py-0.5 text-[11px] font-semibold text-ink-2">{r}</span>) : <span className="text-ink-3">None</span>}</span>
                <span role="cell" className="text-ink-2">{x.downloads_used}{x.max_downloads ? ` / ${x.max_downloads}` : ''}</span>
                <span role="cell" className="text-ink-2">{x.expires_at ? dateLabel(x.expires_at) : 'Never'}</span>
                <span role="cell" className={cx('font-semibold', tone)}>{st}</span>
                <span role="cell" className="flex gap-2.5 font-semibold">
                  <button type="button" onClick={() => copy(x.url)} className="text-primary hover:underline">Copy</button>
                  <button type="button" onClick={() => setLog(x)} className="text-primary hover:underline">Downloads log</button>
                  {st === 'Active' ? <button type="button" onClick={() => void revoke(`/api/downloads/grants/${x.id}/revoke`)} className="text-danger hover:underline">Revoke</button> : null}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
      <h2 className="mt-3 text-[15px] font-bold text-ink">Public links</h2>
      {(shares.data?.items ?? []).length ? (
        <div role="table" aria-label="Public links" className="text-[12.5px]">
          {(shares.data?.items ?? []).map((x) => (
            <div key={x.id} role="row" className="flex items-center gap-3 border-b border-line/70 px-3 py-2">
              <Icon name={x.folder_id ? 'folder' : 'file'} size={15} className="text-ink-3" />
              <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{x.url}</span>
              <span className="text-ink-2">{x.visibility === 'password' ? 'Password' : x.visibility === 'private' ? 'Named people' : 'Anybody'}</span>
              <span className="text-ink-2">{x.expires_at ? `Until ${dateLabel(x.expires_at)}` : 'No expiry'}</span>
              <span className={cx('w-16 font-semibold', x.status === 'active' ? 'text-success' : 'text-ink-3')}>{x.status === 'active' ? 'Active' : 'Revoked'}</span>
              <button type="button" onClick={() => copy(x.url)} className="font-semibold text-primary hover:underline">Copy</button>
              {x.status === 'active' ? <button type="button" onClick={() => void revoke(`/api/shares/${x.id}/revoke`)} className="font-semibold text-danger hover:underline">Revoke</button> : <span className="w-[46px]" />}
            </div>
          ))}
        </div>
      ) : shares.isSuccess ? (
        <span className="text-[13px] text-ink-3">No public links.</span>
      ) : null}
      {log ? (
        <Modal title={`Downloads — ${log.label || log.file_name}`} onClose={() => setLog(null)} width={520}>
          {logs.isLoading ? <Spinner /> : null}
          {logs.isSuccess && !logRows.length ? <p className="text-[13px] text-ink-3">Nobody has used this link yet.</p> : null}
          <div className="flex flex-col text-[12.5px]">
            {logRows.map((r, i) => (
              <div key={i} className="flex gap-3 border-b border-line/70 py-1.5">
                <span className="w-36 text-ink-2">{listStamp(r.created_at)}</span>
                <span className="flex-1 font-mono text-ink">{r.ip}{r.country ? ` · ${r.country}` : ''}</span>
                <span className="text-ink-2">{r.user_name ?? 'Not signed in'}</span>
              </div>
            ))}
          </div>
        </Modal>
      ) : null}
    </main>
  );
}

type Topic = 'changes' | 'comments' | 'mentions' | 'versions';
const TOPICS: Array<[Topic, string]> = [
  ['versions', 'New versions'],
  ['comments', 'New comments'],
  ['mentions', 'Mentions and replies to me'],
  ['changes', 'Other changes to files I own or follow'],
];

/** Drive notifications: what you hear about by default. */
export function Notifications() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['files', 'notify-defaults'], queryFn: ({ signal }) => apiGet<{ topics: Record<Topic, boolean | null> }>('/api/drive/notify/defaults', undefined, signal) });
  const set = async (t: Topic, on: boolean) => {
    try {
      await apiPut('/api/drive/notify/defaults', { topics: { [t]: on } });
      void qc.invalidateQueries({ queryKey: ['files', 'notify-defaults'] });
      toast('success', 'Saved');
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <main aria-label="Drive notifications" className={page}>
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[20px] font-bold text-ink">Drive notifications</h1>
        <span className="text-[12.5px] text-ink-3">What you hear about for files you own or follow. A file’s own settings (in its details) win over these.</span>
      </div>
      {q.isLoading ? <Spinner /> : null}
      {q.error ? <ErrorNote error={q.error} /> : null}
      {q.data ? (
        <div className="flex max-w-[520px] flex-col gap-2.5 rounded-[12px] border border-line p-4 text-[13px]">
          {TOPICS.map(([t, l]) => (
            <label key={t} className="flex items-center gap-2.5 text-ink">
              <Checkbox checked={q.data.topics[t] !== false} onChange={(e) => void set(t, e.target.checked)} />
              {l}
            </label>
          ))}
          <span className="text-[12px] text-ink-3">How you hear about files shared with you — in Chat, in the app, by email — is in Notification settings › Files.</span>
        </div>
      ) : null}
    </main>
  );
}

interface Partners {
  companies: Array<{ id: number; name: string; partners: Array<{ id: number; company: { id: number; name: string }; created_at: string }> }>;
  choices: Array<{ id: number; name: string }>;
}

/** Sharing between companies: which partner companies each of yours may share files with. */
export function Companies() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['files', 'partners'], queryFn: ({ signal }) => apiGet<Partners>('/api/drive/sharing/partners', undefined, signal) });
  const [adding, setAdding] = useState<Record<number, string>>({});
  const refresh = () => void qc.invalidateQueries({ queryKey: ['files', 'partners'] });
  const add = async (orgId: number) => {
    const partner = Number(adding[orgId]);
    if (!partner) return;
    try {
      await apiPost('/api/drive/sharing/partners', { org_id: orgId, partner_org_id: partner });
      setAdding({ ...adding, [orgId]: '' });
      toast('success', 'Partner added');
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const remove = async (id: number) => {
    try {
      await apiDelete(`/api/drive/sharing/partners/${id}`);
      toast('success', 'Partner removed');
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <main aria-label="Sharing between companies" className={page}>
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[20px] font-bold text-ink">Sharing between companies</h1>
        <span className="text-[12.5px] text-ink-3">Files can be shared only with partner companies listed here. The server still checks every share.</span>
      </div>
      {q.isLoading ? <Spinner /> : null}
      {q.error ? <ErrorNote error={q.error} /> : null}
      {(q.data?.companies ?? []).map((c) => (
        <section key={c.id} className="flex max-w-[620px] flex-col gap-2 rounded-[12px] border border-line p-4 text-[13px]">
          <b className="text-ink">{c.name}</b>
          {c.partners.map((p) => (
            <div key={p.id} className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-selection text-[10.5px] font-bold text-primary">{p.company.name.slice(0, 2).toUpperCase()}</span>
              <span className="flex flex-1 flex-col"><b className="text-ink">{p.company.name}</b><span className="text-[11.5px] text-ink-3">Partner since {dateLabel(p.created_at)}</span></span>
              <button type="button" onClick={() => void remove(p.id)} className="font-semibold text-danger hover:underline">Remove partner</button>
            </div>
          ))}
          {!c.partners.length ? <span className="text-ink-3">No partners yet.</span> : null}
          <div className="flex gap-2">
            <Select aria-label={`Choose a partner for ${c.name}`} value={adding[c.id] ?? ''} onChange={(e) => setAdding({ ...adding, [c.id]: e.target.value })} className="h-9 flex-1 rounded-[8px] border border-line bg-surface px-2 text-ink">
              <option value="">Choose a company…</option>
              {(q.data?.choices ?? []).filter((x) => x.id !== c.id && !c.partners.some((p) => p.company.id === x.id)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
            <Button variant="primary" disabled={!adding[c.id]} onClick={() => void add(c.id)}>Add partner</Button>
          </div>
        </section>
      ))}
    </main>
  );
}

export type { DriveFile };
