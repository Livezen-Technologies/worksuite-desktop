import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiGet, apiGetMeta } from '../../core/api';
import { useTab, useTabTitle } from '../../core/tab-context';
import { listStamp } from '../../core/time';
import { ErrorNote, OfflineNote, Spinner, cx } from '../../components/ui';
import type { ModuleProps } from '../registry';
import { VIEWS, type Notebook, type NoteCard, type Section, type Stats, type View } from './api';
import { NewNote } from './Dialogs';
import { NoteEditor } from './Editor';
import { Rail, type Place } from './Rail';
import { SidePanel } from '../../components/SidePanel';

function placeFrom(q: URLSearchParams): Place {
  const s = q.get('section');
  if (s && /^\d+$/.test(s)) return { section: Number(s) };
  const n = q.get('notebook');
  if (n && /^\d+$/.test(n)) return { notebook: Number(n) };
  const v = q.get('view') as View | null;
  return { view: v && VIEWS.some((x) => x.id === v) ? v : 'all' };
}

/**
 * Notes (NotesMain): the views and notebooks, the notes in the one chosen,
 * and the note open beside them. Notes opens on one; a new note starts from
 * a template, in the notebook shown.
 */
export default function NotesPage(_props: ModuleProps) {
  useTabTitle('Notes');
  const qc = useQueryClient();
  const { query, go, active } = useTab();
  const place = placeFrom(query);
  const opened = Number(query.get('note') ?? 0) || null;
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(query.get('new') === '1');
  const view = 'view' in place ? place.view : null;
  const params = {
    q: q.trim() || undefined,
    ...(view === 'fav' ? { favorites: 1 } : view === 'pin' ? { pinned: 1 } : view === 'archived' ? { archived: 1 } : {}),
    ...('notebook' in place ? { notebook: place.notebook } : 'section' in place ? { section: place.section } : {}),
  };
  const list = useQuery({
    queryKey: ['notes', 'list', place, q.trim()],
    queryFn: ({ signal }) => apiGetMeta<NoteCard[]>(view === 'shared' ? '/api/notes/shared' : '/api/notes', view === 'shared' ? { q: params.q } : params, signal),
    refetchInterval: 60_000,
  });
  const stats = useQuery({ queryKey: ['notes', 'stats'], queryFn: ({ signal }) => apiGet<Stats>('/api/notes/stats', undefined, signal) });
  const shared = useQuery({ queryKey: ['notes', 'shared'], queryFn: ({ signal }) => apiGet<NoteCard[]>('/api/notes/shared', undefined, signal) });
  const notebooks = useQuery({ queryKey: ['notes', 'notebooks'], queryFn: ({ signal }) => apiGet<Notebook[]>('/api/notebooks', undefined, signal) });
  const sections = useQuery({ queryKey: ['notes', 'sections'], queryFn: ({ signal }) => apiGet<Section[]>('/api/note-sections', undefined, signal) });
  const nbs = notebooks.data ?? [];
  const secs = sections.data ?? [];
  const notes = list.data?.data ?? [];
  const counts: Record<string, number> = { all: stats.data?.total ?? 0, fav: stats.data?.favorites ?? 0, pin: stats.data?.pinned ?? 0, archived: stats.data?.archived ?? 0, shared: shared.data?.length ?? 0 };

  const set = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(query);
    p.delete('new');
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    go(`/notes${p.toString() ? `?${p}` : ''}`);
  };
  const setPlace = (p: Place) => set({ view: 'view' in p && p.view !== 'all' ? p.view : null, notebook: 'notebook' in p ? String(p.notebook) : null, section: 'section' in p ? String(p.section) : null, note: null });
  const open = (id: number | null) => set({ note: id ? String(id) : null });

  // Notes opens on a note: the first in the list when none is named.
  const first = !opened && list.isSuccess && notes.length ? notes[0]!.id : null;
  useEffect(() => {
    if (first) set({ note: String(first) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || creating || document.querySelector('[role="dialog"]')) return;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (e.key === 'n') setCreating(true);
      else if (e.key === '/') document.querySelector<HTMLInputElement>('input[aria-label="Search notes"]')?.focus();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const nb = 'notebook' in place ? nbs.find((x) => x.id === place.notebook) : undefined;
  const sec = 'section' in place ? secs.find((x) => x.id === place.section) : undefined;
  const title = view ? VIEWS.find((v) => v.id === view)!.label : sec ? `${nbs.find((x) => x.id === sec.notebook_id)?.name ?? 'Notebook'} · ${sec.name}` : (nb?.name ?? 'Notebook');
  const placeValue = 'section' in place ? `s${place.section}` : 'notebook' in place ? `n${place.notebook}` : '';
  const openCard = notes.find((x) => x.id === opened);

  return (
    <div className="flex h-full bg-surface text-[13px]">
      <SidePanel id="notes" label="the notebooks">
        <Rail place={place} counts={counts} notebooks={nbs} sections={secs} onPlace={setPlace} onNew={() => setCreating(true)} />
      </SidePanel>
      <section aria-label="Notes" className="flex w-[300px] shrink-0 flex-col border-r border-line">
        <div className="flex shrink-0 flex-col gap-2 border-b border-line p-3">
          <div className="flex items-center gap-2">
            <b className="min-w-0 flex-1 truncate text-[15px] text-ink" title={title}>{title}</b>
            <span className="text-ink-3">{notes.length}</span>
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search notes" placeholder="Search notes…" className="h-8 rounded-[8px] border border-line bg-surface px-2.5 text-ink outline-none focus:border-primary" />
          {list.data?.offline ? <OfflineNote cachedAt={list.data.cachedAt} /> : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin" role="list">
          {list.isLoading ? <Spinner /> : null}
          {list.error && !list.data ? <div className="p-3"><ErrorNote error={list.error} onRetry={() => void list.refetch()} /></div> : null}
          {list.isSuccess && !notes.length ? (
            <p className="px-4 py-8 text-center text-ink-3">{q.trim() ? 'No notes match.' : view === 'shared' ? 'Nothing is shared with you yet.' : view === 'archived' ? 'Nothing archived.' : 'No notes here yet. Press N for a new one.'}</p>
          ) : null}
          {notes.map((c) => (
            <button key={c.id} type="button" role="listitem" aria-current={c.id === opened ? 'true' : undefined} onClick={() => open(c.id)} className={cx('flex w-full flex-col gap-[3px] border-b border-line/60 px-3.5 py-2.5 text-left', c.id === opened ? 'bg-selection' : 'hover:bg-subtle')}>
              <span className="flex items-center gap-1.5">
                <b className="min-w-0 flex-1 truncate text-ink">{c.title}</b>
                {c.is_favorite ? <span className="text-[#B45309]" aria-label="Favorite">★</span> : null}
                {c.is_pinned ? <span className="text-[10.5px] font-bold text-[#9A4A06] dark:text-warning">Pinned</span> : null}
              </span>
              <span className="line-clamp-2 text-[12px] leading-[1.4] text-ink-3">{c.excerpt || 'No additional text'}</span>
              <span className="flex gap-1.5 text-[11px] text-ink-3">
                <span>{listStamp(c.updated_at)}</span>
                {c.owner_name ? <span>· {c.owner_name} · {c.role === 'editor' ? 'can edit' : 'can read'}</span> : null}
                {c.tags.slice(0, 2).map((t) => <span key={t} className="rounded bg-subtle px-1">{t}</span>)}
              </span>
            </button>
          ))}
        </div>
      </section>
      {opened ? (
        <NoteEditor
          key={opened}
          id={opened}
          notebooks={nbs}
          sections={secs}
          ownerName={openCard?.owner_name}
          onGone={() => {
            // Out of this list at once, so the next note opens rather than this one again.
            qc.setQueryData<{ data: NoteCard[] }>(['notes', 'list', place, q.trim()], (old) => (old ? { ...old, data: old.data.filter((x) => x.id !== opened) } : old));
            open(null);
          }}
          onOpen={(id) => open(id)}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-ink-3">{list.isLoading ? <Spinner /> : 'Choose a note, or press N for a new one.'}</div>
      )}
      {creating ? (
        <NewNote
          notebooks={nbs}
          sections={secs}
          place={placeValue}
          onClose={() => (setCreating(false), query.get('new') ? set({}) : undefined)}
          onCreated={(id) => {
            setCreating(false);
            void qc.invalidateQueries({ queryKey: ['notes'] });
            // It opens where it was filed; from a view like Favorites, in All notes.
            const p = new URLSearchParams();
            if ('notebook' in place) p.set('notebook', String(place.notebook));
            if ('section' in place) p.set('section', String(place.section));
            p.set('note', String(id));
            go(`/notes?${p}`);
          }}
        />
      ) : null}
    </div>
  );
}
