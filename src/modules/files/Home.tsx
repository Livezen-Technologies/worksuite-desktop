import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGetMeta } from '../../core/api';
import { bytes, relative } from '../../core/time';
import { Icon } from '../../components/Icon';
import { ErrorNote, OfflineNote, Spinner } from '../../components/ui';
import type { DriveFile, DriveHome } from './api';
import { fileMenu, useDrive } from './ctx';
import { PopMenu, type MenuItem } from './Menu';
import type { Place } from './Rail';
import { Tile } from './Thumb';

const ACTION: Record<string, string> = { opened: 'Opened', edited: 'Edited', uploaded: 'Uploaded', downloaded: 'Downloaded' };

/**
 * Home (DriveHome): search the whole Drive, carry on with what you last
 * changed, reopen what you last opened, your starred folders, and what is
 * out on a public link.
 */
export function Home({ onPlace, now }: { onPlace: (p: Place, q?: string) => void; now: number }) {
  const d = useDrive();
  const q = useQuery({ queryKey: ['files', 'home'], queryFn: ({ signal }) => apiGetMeta<DriveHome>('/api/drive/home', undefined, signal), refetchInterval: 60_000 });
  const [term, setTerm] = useState('');
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItem[]; label: string } | null>(null);
  const h = q.data?.data;

  const row = (title: string, hint: string, files: DriveFile[], see: Place) =>
    files.length ? (
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-[11.5px] font-bold tracking-[0.6px] text-ink-2">{title}</h2>
          <span className="flex-1 text-[12px] text-ink-3">{hint}</span>
          <button type="button" onClick={() => onPlace(see)} className="text-[12px] font-semibold text-primary hover:underline">See all</button>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {files.slice(0, 6).map((f) => (
            <button
              key={f.id}
              type="button"
              title={f.name}
              onClick={() => d.open({ type: 'file', f }, files)}
              onContextMenu={(e) => (e.preventDefault(), setMenu({ at: { x: e.clientX, y: e.clientY }, items: fileMenu(f, d, files), label: `Actions — ${f.name}` }))}
              className="flex flex-col overflow-hidden rounded-[11px] border border-line bg-surface text-left hover:border-ink-3"
            >
              <Tile f={f} height={78} />
              <span className="flex flex-col gap-0.5 px-2.5 py-2">
                <span className="truncate text-[12.5px] font-semibold text-ink">{f.name}</span>
                <span className="text-[11px] text-ink-3">{f.last_action && f.last_at ? `${ACTION[f.last_action] ?? 'Changed'} ${relative(f.last_at, now)}` : `Changed ${relative(f.updated_at, now)}`}</span>
              </span>
            </button>
          ))}
        </div>
      </section>
    ) : null;

  return (
    <main aria-label="Home" className="flex min-w-0 flex-1 flex-col gap-[18px] overflow-y-auto px-7 py-5 scroll-thin">
      <div className="flex items-center gap-3">
        <h1 className="flex-1 text-[22px] font-bold text-ink">Home</h1>
        <label className="flex h-[38px] w-[380px] min-w-[180px] shrink items-center gap-2 rounded-[9px] border border-line bg-surface px-3 text-ink-3 focus-within:border-primary">
          <Icon name="search" size={15} />
          <input value={term} onChange={(e) => setTerm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && term.trim() && onPlace({ view: 'folder', folder: null }, term.trim())} aria-label="Search Drive" placeholder="Search files and folders" className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none bare-focus" />
        </label>
        <button type="button" onClick={() => onPlace({ view: 'folder', folder: null })} className="h-[38px] rounded-[9px] border border-line bg-surface px-3.5 font-semibold text-ink hover:bg-subtle">Open My Drive</button>
      </div>
      <div className="flex items-center gap-3.5 rounded-[12px] border border-line bg-surface px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-selection text-primary"><Icon name="cloud" size={18} /></span>
        <div className="flex flex-1 flex-col gap-0.5">
          <b className="text-[13.5px] text-ink">Your Drive, in WorkSuite</b>
          <span className="text-[12.5px] text-ink-2">
            {h ? `${h.counts.files.toLocaleString()} files in ${h.counts.folders.toLocaleString()} folders · ${bytes(h.counts.used)} used` : ' '} · drag files from Finder into any folder to upload them
          </span>
        </div>
        <button type="button" onClick={d.upload} className="h-[34px] rounded-[8px] border border-line bg-surface px-3 text-[12.5px] font-semibold text-ink hover:bg-subtle">Upload</button>
        <button type="button" onClick={d.newFolder} className="h-[34px] rounded-[8px] border border-line bg-surface px-3 text-[12.5px] font-semibold text-ink hover:bg-subtle">New folder</button>
      </div>
      {q.data?.offline ? <OfflineNote cachedAt={q.data.cachedAt} /> : null}
      {q.isLoading ? <Spinner /> : null}
      {q.error && !q.data ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {h ? (
        <>
          {row('CONTINUE WORKING', 'What you last changed', h.continue, { view: 'recent', folder: null })}
          {row('RECENTLY OPENED', '', h.recent, { view: 'recent', folder: null })}
          {!h.continue.length && !h.recent.length ? (
            <div className="rounded-[12px] border border-dashed border-line px-6 py-10 text-center text-[13px] text-ink-3">Files you open, change or upload show up here.</div>
          ) : null}
          <div className="grid grid-cols-2 gap-4">
            <section className="flex flex-col gap-2">
              <h2 className="text-[11.5px] font-bold tracking-[0.6px] text-ink-2">STARRED FOLDERS</h2>
              {h.starred_folders.length ? (
                <div className="grid grid-cols-2 gap-2.5">
                  {h.starred_folders.map((f) => (
                    <button key={f.id} type="button" onClick={() => onPlace({ view: 'folder', folder: f.id })} className="flex items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3 py-2.5 text-left hover:bg-ground">
                      <span style={{ color: f.color ?? '#0E7C86' }}><Icon name="folder" size={22} /></span>
                      <span className="flex min-w-0 flex-col">
                        <b className="truncate text-[13px] text-ink">{f.name}</b>
                        <span className="text-[11px] text-ink-3">{f.file_count.toLocaleString()} files · {bytes(f.total_size)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <span className="text-[12.5px] text-ink-3">Star a folder to keep it here.</span>
              )}
            </section>
            <section className="flex flex-col gap-2">
              <div className="flex items-baseline gap-2.5">
                <h2 className="text-[11.5px] font-bold tracking-[0.6px] text-ink-2">SHARED BY LINK</h2>
                <span className="text-[12px] text-ink-3">Anybody with the link can open these</span>
              </div>
              {h.shared.length ? (
                <div className="rounded-[10px] border border-line bg-surface text-[12.5px]">
                  {h.shared.map((s, n) => (
                    <div key={s.id} className={`flex gap-2.5 px-3 py-2 ${n ? 'border-t border-line' : ''}`}>
                      <span className="min-w-0 flex-1 truncate font-semibold text-ink">{s.name}</span>
                      <span className="text-ink-3">{bytes(s.size)}</span>
                      <span className="text-ink-3">{s.downloads_used.toLocaleString()} {s.downloads_used === 1 ? 'download' : 'downloads'}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-[12.5px] text-ink-3">Nothing is out on a public link.</span>
              )}
            </section>
          </div>
        </>
      ) : null}
      {menu ? <PopMenu at={menu.at} items={menu.items} label={menu.label} onClose={() => setMenu(null)} /> : null}
    </main>
  );
}
