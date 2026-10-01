import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { apiGet, apiGetMeta } from '../../core/api';
import { bytes, dateLabel, relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { ErrorNote, OfflineNote, cx } from '../../components/ui';
import { isJunkFile, type DriveFile, type DriveHome } from './api';
import { fileMenu, useDrive } from './ctx';
import { PopMenu, below, type MenuItem } from './Menu';
import type { Place } from './Rail';
import { FileIcon, Tile } from './Thumb';

const ACTION: Record<string, string> = { opened: 'Opened', edited: 'Edited', uploaded: 'Uploaded', downloaded: 'Downloaded' };
/** Cards per section: a look, not the list — See all has the rest. */
const PREVIEW = 6;
/** Up to this many, a section's files are compact rows rather than tiles, so a few files leave no wide empty band. */
const AS_ROWS = 3;

type Menu = { at: { x: number; y: number }; items: MenuItem[]; label: string };

/** A public link as `/api/shares` has it: its address, to copy. */
interface ShareLink {
  id: number;
  file_id: number | null;
  url: string;
  status: string;
}

/** How far a link reaches, in words. */
export function accessLabel(visibility: string): string {
  return visibility === 'password' ? 'Anybody with the password' : visibility === 'private' ? 'Named people' : 'Anybody with the link';
}

/** Public links grouped by the file they open — by its id, so two files with one name stay two. */
export function groupShares(shared: DriveHome['shared']): Array<{ fileId: number; name: string; extension: string | null; size: number; links: DriveHome['shared'] }> {
  const by = new Map<number, { fileId: number; name: string; extension: string | null; size: number; links: DriveHome['shared'] }>();
  for (const s of shared) {
    const g = by.get(s.file_id) ?? { fileId: s.file_id, name: s.name, extension: s.extension, size: s.size, links: [] };
    g.links.push(s);
    by.set(s.file_id, g);
  }
  return [...by.values()];
}

/**
 * Home (DriveHome, #41): find a file, carry on with what you last changed, reopen what you last opened, your
 * starred folders, and what is out on a public link. Each section shows a few and links to the whole list; files
 * still downloading (.part) and temporary files are left out.
 */
export function Home({ onPlace, now, newItems }: { onPlace: (p: Place, q?: string) => void; now: number; newItems: MenuItem[] }) {
  const d = useDrive();
  const q = useQuery({ queryKey: ['files', 'home'], queryFn: ({ signal }) => apiGetMeta<DriveHome>('/api/drive/home', undefined, signal), refetchInterval: 60_000 });
  // The links' addresses, for Copy link: their own list, which the Secure links page shares; Home does not wait for it.
  const shares = useQuery({ queryKey: ['files', 'shares'], queryFn: ({ signal }) => apiGet<{ items: ShareLink[] }>('/api/shares', { per_page: 100 }, signal) });
  const [term, setTerm] = useState('');
  const [menu, setMenu] = useState<Menu | null>(null);
  const h = q.data?.data;
  const loading = q.isLoading;

  const fileActions = (f: DriveFile, list: DriveFile[]): MenuItem[] => {
    const items = fileMenu(f, d, list);
    // From Home, the folder a file is in is a step away.
    const folder: MenuItem = { label: 'Open containing folder', icon: 'folder-open', run: () => onPlace({ view: 'folder', folder: f.folder_id }) };
    const at = items.findIndex((x) => 'sep' in x);
    return at < 0 ? [...items, folder] : [...items.slice(0, at), folder, ...items.slice(at)];
  };
  const openMenu = (f: DriveFile, list: DriveFile[], at: { x: number; y: number }) => setMenu({ at, items: fileActions(f, list), label: `Actions — ${f.name}` });

  const files = (title: string, hint: string, all: DriveFile[] | undefined, see: Place, stamp: (f: DriveFile) => string, empty: string) => {
    const list = (all ?? []).filter((f) => !isJunkFile(f.name)).slice(0, PREVIEW);
    return (
      <Section title={title} hint={hint} onSeeAll={list.length ? () => onPlace(see) : undefined}>
        {loading ? (
          <Skeleton rows={2} />
        ) : !list.length ? (
          <Empty text={empty} />
        ) : list.length <= AS_ROWS ? (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
            {list.map((f) => (
              <FileRow key={f.id} f={f} stamp={stamp(f)} onOpen={() => d.open({ type: 'file', f }, list)} onMenu={(at) => openMenu(f, list, at)} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
            {list.map((f) => (
              <FileCard key={f.id} f={f} stamp={stamp(f)} onOpen={() => d.open({ type: 'file', f }, list)} onMenu={(at) => openMenu(f, list, at)} />
            ))}
          </div>
        )}
      </Section>
    );
  };

  const changed = (f: DriveFile) => (f.last_action && f.last_at ? `${ACTION[f.last_action] ?? 'Changed'} ${relative(f.last_at, now)}` : `Changed ${relative(f.updated_at, now)}`);
  const opened = (f: DriveFile) => (f.opened_at ? `Opened ${relative(f.opened_at, now)}` : changed(f));
  const groups = h ? groupShares(h.shared) : [];
  const urlOf = (shareId: number) => shares.data?.items.find((s) => s.id === shareId && s.status === 'active')?.url ?? null;
  const copy = (url: string) =>
    void navigator.clipboard
      .writeText(url)
      .then(() => toast('success', 'Link copied'))
      .catch(() => toast('error', 'The link could not be copied.'));

  return (
    <main aria-label="Home" className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4 scroll-thin sm:px-7 sm:py-5">
      <header className="flex flex-wrap items-center gap-2.5">
        <div className="mr-auto flex min-w-0 flex-col">
          <h1 className="text-[20px] font-bold text-ink">Home</h1>
          <span className="truncate text-[12px] text-ink-3">{h ? `${h.counts.files.toLocaleString()} files · ${h.counts.folders.toLocaleString()} folders · ${bytes(h.counts.used)} used` : ' '}</span>
        </div>
        <label className="flex h-9 min-w-[180px] flex-1 items-center gap-2 rounded-[9px] border border-line bg-surface px-3 text-ink-3 focus-within:border-primary sm:max-w-[420px]">
          <Icon name="search" size={15} />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && term.trim() && onPlace({ view: 'folder', folder: null }, term.trim())}
            aria-label="Search Drive"
            placeholder="Search files and folders"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none bare-focus"
          />
        </label>
        <button
          type="button"
          aria-haspopup="menu"
          onClick={(e) => setMenu({ at: below(e.currentTarget, 'right', 300), items: newItems, label: 'New' })}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-[9px] bg-primary px-3 font-bold text-white hover:bg-primary-hover"
        >
          <Icon name="plus" size={15} /> New
        </button>
        <button type="button" onClick={d.upload} className="flex h-9 shrink-0 items-center gap-1.5 rounded-[9px] border border-line bg-surface px-3 font-semibold text-ink hover:bg-subtle">
          <Icon name="upload" size={15} /> Upload
        </button>
      </header>
      {q.data?.offline ? <OfflineNote cachedAt={q.data.cachedAt} /> : null}
      {q.error && !q.data ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.error && !q.data ? null : (
        <>
          {files('CONTINUE WORKING', 'What you last changed', h?.continue, { view: 'recent', folder: null }, changed, 'Files you change or upload show up here.')}
          {files('RECENTLY OPENED', 'What you last opened', h?.recent, { view: 'recent', folder: null }, opened, 'Files you open show up here.')}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Section title="STARRED FOLDERS" hint="" onSeeAll={h?.starred_folders.length ? () => onPlace({ view: 'starred', folder: null }) : undefined}>
              {loading ? (
                <Skeleton rows={2} />
              ) : h?.starred_folders.length ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
                  {h.starred_folders.slice(0, PREVIEW).map((f) => (
                    <button key={f.id} type="button" title={f.path ?? f.name} onClick={() => onPlace({ view: 'folder', folder: f.id })} className="flex min-w-0 items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3 py-2 text-left hover:border-ink-3">
                      <span style={{ color: f.color ?? '#0E7C86' }}>
                        <Icon name="folder" size={20} />
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <b className="truncate text-[13px] text-ink">{f.name}</b>
                        <span className="truncate text-[11px] text-ink-3">
                          {f.file_count.toLocaleString()} {f.file_count === 1 ? 'file' : 'files'} · {bytes(f.total_size)}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <Empty text="Star a folder to keep it here." />
              )}
            </Section>
            <Section title="SHARED BY LINK" hint="Who can open each file" onSeeAll={groups.length ? () => onPlace({ view: 'links', folder: null }) : undefined}>
              {loading ? (
                <Skeleton rows={2} />
              ) : groups.length ? (
                <ul aria-label="Files shared by link" className="rounded-[10px] border border-line bg-surface text-[12.5px]">
                  {groups.slice(0, PREVIEW).map((g, n) => {
                    const reach = [...new Set(g.links.map((l) => accessLabel(l.visibility)))].join(' · ');
                    const expires = g.links.map((l) => l.expires_at).filter((x): x is string => !!x).sort()[0];
                    const downloads = g.links.reduce((s, l) => s + l.downloads_used, 0);
                    const url = urlOf(g.links[0]!.id);
                    return (
                      <li key={g.fileId} className={cx('flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3 py-2', n > 0 && 'border-t border-line')}>
                        <FileIcon f={{ id: g.fileId, name: g.name, extension: g.extension, has_thumb: false }} size={26} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <b className="truncate text-ink" title={g.name}>
                            {g.name}
                          </b>
                          <span className="truncate text-[11.5px] text-ink-3">
                            {reach}
                            {g.links.length > 1 ? ` · ${g.links.length} links` : ''} · {bytes(g.size)} · {downloads.toLocaleString()} {downloads === 1 ? 'download' : 'downloads'}
                            {expires ? ` · until ${dateLabel(expires)}` : ''}
                          </span>
                        </span>
                        <span className="flex shrink-0 gap-2.5 font-semibold">
                          <button type="button" disabled={!url} onClick={() => url && copy(url)} aria-label={`Copy link to ${g.name}`} className="text-primary hover:underline disabled:text-ink-3 disabled:no-underline">
                            {g.links.length > 1 ? 'Copy first link' : 'Copy link'}
                          </button>
                          <button type="button" onClick={() => onPlace({ view: 'links', folder: null })} aria-label={`Manage links to ${g.name}`} className="text-primary hover:underline">
                            Manage
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <Empty text="Nothing is out on a public link." />
              )}
            </Section>
          </div>
        </>
      )}
      {menu ? <PopMenu at={menu.at} items={menu.items} label={menu.label} width={menu.label === 'New' ? 300 : 280} onClose={() => setMenu(null)} /> : null}
    </main>
  );
}

function Section({ title, hint, onSeeAll, children }: { title: string; hint: string; onSeeAll?: () => void; children: ReactNode }) {
  return (
    <section aria-label={title.charAt(0) + title.slice(1).toLowerCase()} className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline gap-2.5">
        <h2 className="text-[11.5px] font-bold tracking-[0.6px] text-ink-2">{title}</h2>
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">{hint}</span>
        {onSeeAll ? (
          <button type="button" onClick={onSeeAll} className="shrink-0 text-[12px] font-semibold text-primary hover:underline">
            See all
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-[10px] border border-dashed border-line px-4 py-3 text-[12.5px] text-ink-3">{text}</p>;
}

/** While a section loads: its shape, not a spinner in the middle of the page. */
function Skeleton({ rows }: { rows: number }) {
  return (
    <div aria-hidden data-testid="home-skeleton" className="grid grid-cols-1 gap-2 md:grid-cols-2">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="h-12 rounded-[10px] bg-subtle motion-safe:animate-pulse" />
      ))}
    </div>
  );
}

/** The ⋯ on a file: its actions, from the keyboard as well as by right-click. */
function MoreButton({ name, onMenu, className }: { name: string; onMenu: (at: { x: number; y: number }) => void; className?: string }) {
  return (
    <button
      type="button"
      aria-label={`More actions for ${name}`}
      aria-haspopup="menu"
      title="More actions"
      onClick={(e) => {
        e.stopPropagation();
        onMenu(below(e.currentTarget, 'right'));
      }}
      className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-ink-2 hover:bg-subtle hover:text-ink', className)}
    >
      <Icon name="more" size={15} />
    </button>
  );
}

function FileRow({ f, stamp, onOpen, onMenu }: { f: DriveFile; stamp: string; onOpen: () => void; onMenu: (at: { x: number; y: number }) => void }) {
  return (
    <div onContextMenu={(e) => (e.preventDefault(), onMenu({ x: e.clientX, y: e.clientY }))} className="group flex min-w-0 items-center gap-2.5 rounded-[10px] border border-line bg-surface py-2 pr-1.5 pl-2.5 hover:border-ink-3">
      <button type="button" onClick={onOpen} title={f.name} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <FileIcon f={f} size={34} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] font-semibold text-ink">{f.name}</span>
          <span className="truncate text-[11.5px] text-ink-3">
            {stamp}
            {f.folder_name ? ` · ${f.folder_name}` : ''}
          </span>
        </span>
      </button>
      <MoreButton name={f.name} onMenu={onMenu} />
    </div>
  );
}

function FileCard({ f, stamp, onOpen, onMenu }: { f: DriveFile; stamp: string; onOpen: () => void; onMenu: (at: { x: number; y: number }) => void }) {
  return (
    <div onContextMenu={(e) => (e.preventDefault(), onMenu({ x: e.clientX, y: e.clientY }))} className="group relative flex min-w-0 flex-col overflow-hidden rounded-[11px] border border-line bg-surface hover:border-ink-3">
      <button type="button" onClick={onOpen} title={f.name} className="flex min-w-0 flex-col text-left">
        <Tile f={f} height={84} />
        <span className="flex min-w-0 flex-col gap-0.5 px-2.5 py-2 pr-8">
          <span className="truncate text-[12.5px] font-semibold text-ink">{f.name}</span>
          <span className="truncate text-[11px] text-ink-3">{stamp}</span>
        </span>
      </button>
      <MoreButton name={f.name} onMenu={onMenu} className="absolute right-1 bottom-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" />
    </div>
  );
}
