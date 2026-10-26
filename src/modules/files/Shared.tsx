import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGetMeta } from '../../core/api';
import { addDays, bytes, listStamp, todayInZone } from '../../core/time';
import { Icon } from '../../components/Icon';
import { ErrorNote, OfflineNote, Spinner, cx } from '../../components/ui';
import type { DriveFile, DriveList } from './api';
import { fileMenu, folderMenu, useDrive, type Item } from './ctx';
import { Details } from './Details';
import { PopMenu, type MenuItem } from './Menu';
import type { Place } from './Rail';
import { FileIcon } from './Thumb';
import { Select } from '../../components/Select';
import { OrgSwitcher } from '../../components/OrgSwitcher';
import { clickOnKey } from '../../components/press';

const LEVEL: Record<string, [string, string]> = { view: ['Can view', 'text-ink-2'], comment: ['Can comment', 'text-ink-2'], edit: ['Can edit', 'text-primary'], full: ['Full access', 'text-success'] };
const KINDS: Array<[string, string]> = [['', 'Any type'], ['document', 'Documents'], ['spreadsheet', 'Spreadsheets'], ['presentation', 'Presentations'], ['pdf', 'PDFs'], ['image', 'Images'], ['video', 'Video'], ['audio', 'Audio'], ['archive', 'Archives']];
const WHEN: Array<[string, string]> = [['', 'Shared any time'], ['7', 'In the last 7 days'], ['30', 'In the last 30 days'], ['90', 'In the last 90 days']];

/** Shared with me (DriveShared): what others shared, filtered by type, access, when, company, place and module. */
export function Shared({ onPlace }: { onPlace: (p: Place) => void }) {
  const d = useDrive();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [level, setLevel] = useState('');
  const [when, setWhen] = useState('');
  const [org, setOrg] = useState('');
  const [within, setWithin] = useState('');
  const [module, setModule] = useState('');
  const [chosen, setChosen] = useState<Item | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItem[]; label: string } | null>(null);
  const params = {
    view: 'shared',
    include_folders: 1,
    facets: 1,
    per_page: 200,
    counts: 0,
    q: q.trim() || undefined,
    kind: kind || undefined,
    level: level || undefined,
    shared_from: when ? addDays(todayInZone(), -Number(when)) : undefined,
    org: org || undefined,
    within: within || undefined,
    module: module || undefined,
  };
  const list = useQuery({ queryKey: ['files', 'shared', params], queryFn: ({ signal }) => apiGetMeta<DriveList>('/api/drive/list', params, signal), refetchInterval: 120_000 });
  const data = list.data?.data;
  const files = data?.files ?? [];
  const folders = data?.folders ?? [];
  const facets = data?.facets;
  const filtered = !!(q || kind || level || when || org || within || module);
  const select = (active: boolean) => cx('h-[34px] rounded-[8px] border px-2 text-[12.5px]', active ? 'border-primary bg-selection font-semibold text-primary' : 'border-line bg-surface text-ink');

  const fileItem = (f: DriveFile): Item => ({ type: 'file', f });

  return (
    <div className="flex min-w-0 flex-1">
      <main aria-label="Shared with me" className="flex min-w-0 flex-1 flex-col bg-surface">
        <div className="flex flex-col gap-3 px-6 pt-4 pb-3">
          <div className="flex items-center gap-4">
            <h1 className="text-[20px] font-bold text-ink">Shared with me</h1>
            <span role="tablist" className="flex rounded-[9px] bg-subtle p-[3px] text-[12.5px] font-semibold">
              <span role="tab" aria-selected="true" className="rounded-[7px] bg-surface px-3 py-1 text-ink shadow-sm">Shared with me</span>
              <button type="button" role="tab" aria-selected="false" onClick={() => onPlace({ view: 'my_shares', folder: null })} className="px-3 py-1 text-ink-2 hover:text-ink">Shared by me</button>
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex h-[34px] w-[260px] items-center gap-2 rounded-[8px] border border-line px-2.5 text-ink-3 focus-within:border-primary">
              <Icon name="search" size={15} />
              <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search shared files" placeholder="Search shared files" className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none bare-focus" />
            </label>
            <Select aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value)} className={select(!!kind)}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
            <Select aria-label="Access" value={level} onChange={(e) => setLevel(e.target.value)} className={select(!!level)}>
              <option value="">Any access</option>
              <option value="view">Can view</option>
              <option value="comment">Can comment</option>
              <option value="edit">Can edit</option>
              <option value="full">Full access</option>
            </Select>
            <Select aria-label="When shared" value={when} onChange={(e) => setWhen(e.target.value)} className={select(!!when)}>{WHEN.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
            {facets && (facets.organizations.length || facets.no_company) ? (
              <OrgSwitcher
                label="Company"
                allLabel="Any company"
                orgs={[...facets.organizations.map((o) => ({ id: String(o.id), name: o.name })), ...(facets.no_company ? [{ id: 'none', name: 'No company' }] : [])]}
                value={org ? [org] : []}
                onChange={(ids) => setOrg(ids[0] ?? '')}
                onSetDefault={null}
              />
            ) : null}
            {facets?.locations.length ? (
              <Select aria-label="Location" value={within} onChange={(e) => setWithin(e.target.value)} className={select(!!within)}>
                <option value="">Anywhere</option>
                {facets.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            ) : null}
            {facets?.modules.length ? (
              <Select aria-label="Module" value={module} onChange={(e) => setModule(e.target.value)} className={select(!!module)}>
                <option value="">Any module</option>
                {facets.modules.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </Select>
            ) : null}
            {filtered ? <button type="button" onClick={() => (setQ(''), setKind(''), setLevel(''), setWhen(''), setOrg(''), setWithin(''), setModule(''))} className="text-[12.5px] font-semibold text-primary hover:underline">Clear filters</button> : null}
            {list.data?.offline ? <OfflineNote cachedAt={list.data.cachedAt} /> : null}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
          {list.isLoading ? <Spinner /> : null}
          {list.error && !list.data ? <div className="px-6"><ErrorNote error={list.error} onRetry={() => void list.refetch()} /></div> : null}
          {folders.length ? (
            <div className="flex flex-col gap-2 px-6 pb-3">
              <h2 className="text-[11px] font-bold tracking-[0.6px] text-ink-2">FOLDERS</h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5">
                {folders.map((f) => (
                  <button key={f.id} type="button" onClick={() => onPlace({ view: 'folder', folder: f.id })} onContextMenu={(e) => (e.preventDefault(), setMenu({ at: { x: e.clientX, y: e.clientY }, items: folderMenu(f, d), label: `Actions — ${f.name}` }))} className="flex items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3 py-2.5 text-left hover:bg-ground">
                    <span style={{ color: f.color ?? '#6B3FB5' }}><Icon name="folder" size={22} /></span>
                    <span className="flex min-w-0 flex-col">
                      <b className="truncate text-[13px] text-ink">{f.name}</b>
                      <span className="truncate text-[11px] text-ink-3">{f.owner_name ?? 'Shared'} · {f.file_count.toLocaleString()} files</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {list.isSuccess && !files.length && !folders.length ? (
            <div className="px-6 py-16 text-center text-[13px] text-ink-3">{filtered ? 'Nothing shared with you matches these filters.' : 'Files other people share with you show up here.'}</div>
          ) : null}
          {files.length ? (
            <div role="table" aria-label="Shared files" className="text-[12.5px]">
              <div role="row" className="sticky top-0 grid grid-cols-[minmax(0,2.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_minmax(0,0.7fr)] gap-2 border-y border-line bg-ground px-6 py-[7px] text-[11px] font-bold tracking-[0.4px] text-ink-2">
                <span>NAME</span><span>OWNER</span><span>COMPANY</span><span>LOCATION</span><span>RELATED RECORD</span><span>MODULE</span><span>YOUR ACCESS</span><span>SHARED</span><span>SIZE</span>
              </div>
              {files.map((f) => {
                const rec = f.related?.[0];
                const lv = LEVEL[f.access?.level ?? ''];
                const on = chosen?.type === 'file' && chosen.f.id === f.id;
                return (
                  <div
                    key={f.id}
                    role="row"
                    tabIndex={0}
                    onKeyDown={clickOnKey}
                    aria-selected={on}
                    onClick={() => setChosen(fileItem(f))}
                    onDoubleClick={() => d.open(fileItem(f), files)}
                    onContextMenu={(e) => (e.preventDefault(), setChosen(fileItem(f)), setMenu({ at: { x: e.clientX, y: e.clientY }, items: fileMenu(f, d, files), label: `Actions — ${f.name}` }))}
                    className={cx('grid cursor-default grid-cols-[minmax(0,2.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_minmax(0,0.7fr)] items-center gap-2 border-b border-line/70 px-6 py-1.5 select-none', on ? 'bg-selection' : 'hover:bg-ground')}
                  >
                    <span role="cell" className="flex min-w-0 items-center gap-2.5"><FileIcon f={f} size={28} /><b className="truncate text-ink">{f.name}</b></span>
                    <span role="cell" className="truncate text-ink-2">{f.owner_name ?? '—'}</span>
                    <span role="cell" className="truncate text-ink-2">{f.org?.name ?? '—'}</span>
                    <span role="cell" className="truncate text-ink-2">{f.location?.name ?? 'Shared on its own'}</span>
                    <span role="cell" className="truncate">{rec ? <span className="font-semibold text-primary">{rec.kind} {rec.title}</span> : <span className="text-ink-3">—</span>}</span>
                    <span role="cell" className="truncate text-ink-2">{rec?.module?.label ?? '—'}</span>
                    <span role="cell" className={cx('font-semibold', lv?.[1])}>{lv?.[0] ?? '—'}</span>
                    <span role="cell" className="text-ink-2">{listStamp(f.shared_at)}</span>
                    <span role="cell" className="font-mono text-[12px] text-ink-2">{bytes(f.size)}</span>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </main>
      {chosen ? <Details key={`${chosen.type}${chosen.f.id}`} item={chosen} list={files} onClose={() => setChosen(null)} /> : null}
      {menu ? <PopMenu at={menu.at} items={menu.items} label={menu.label} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}
