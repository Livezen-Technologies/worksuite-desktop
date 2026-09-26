import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { useTab } from '../../core/tab-context';
import { relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { Button, ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import type { Link, Notebook, NoteDetail, Section } from './api';
import { LinkPicker, MoveNote, ShareDialog, VersionHistory } from './Dialogs';
import { NoteBody, NoteView } from './NoteBody';

type Draft = { title: string; body: string; tags: string };
const LINK_TONE: Record<string, string> = { contact: 'bg-[#E3F4F5] text-[#0B6770] dark:bg-subtle dark:text-[#5CC6CF]', event: 'bg-selection text-primary', task: 'bg-warning-bg text-[#9A4A06] dark:text-warning' };

/**
 * A note, open (NotesMain, right): where it lives and whether it is saved,
 * what it is linked to, and its title, tags and body. It saves itself a
 * moment after you stop typing, and at once when you move to another note.
 */
export function NoteEditor({ id, notebooks, sections, ownerName, onGone, onOpen }: { id: number; notebooks: Notebook[]; sections: Section[]; ownerName?: string; onGone: () => void; onOpen: (id: number) => void }) {
  const qc = useQueryClient();
  const { navigate } = useTab();
  const detail = useQuery({ queryKey: ['notes', 'detail', id], queryFn: ({ signal }) => apiGet<NoteDetail>(`/api/notes/${id}`, undefined, signal), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 });
  const n = detail.data;
  const owner = n?.my_role === 'owner';
  const canEdit = owner || n?.my_role === 'editor';
  const links = useQuery({ queryKey: ['notes', 'links', id], queryFn: ({ signal }) => apiGet<Link[]>(`/api/notes/${id}/links`, undefined, signal), enabled: owner });
  const [round, setRound] = useState(0);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState<'share' | 'history' | 'move' | 'delete' | 'contact' | 'event' | null>(null);
  const [converted, setConverted] = useState<number | null>(null);
  // What was last saved, as state for drawing and as refs for the timers and the goodbye save.
  const [base, setBase] = useState('');
  const last = useRef('');
  const latest = useRef<Draft | null>(null);
  useEffect(() => {
    latest.current = draft;
    if (!last.current) last.current = base;
  });
  const key = `${id}:${round}`;

  // The note fills the editor once, and again after a version is restored.
  if (n && loaded !== key) {
    const d = { title: n.title, body: n.body, tags: n.tags.join(', ') };
    setLoaded(key);
    setDraft(d);
    setBase(JSON.stringify(d));
  }
  useEffect(() => {
    last.current = base;
  }, [base]);

  const lists = () => {
    for (const k of ['list', 'stats', 'notebooks', 'sections', 'shared']) void qc.invalidateQueries({ queryKey: ['notes', k] });
  };
  const save = async (d: Draft) => {
    const json = JSON.stringify(d);
    if (json === last.current) return;
    setStatus('saving');
    try {
      await apiPut(`/api/notes/${id}`, { title: d.title.trim() || 'Untitled', body: d.body, tags: d.tags.split(',').map((t) => t.trim()).filter(Boolean) });
      last.current = json;
      setBase(json);
      setStatus('saved');
      lists();
    } catch {
      setStatus('error');
    }
  };

  // A moment after typing stops.
  useEffect(() => {
    if (!draft || !canEdit || JSON.stringify(draft) === base) return;
    const t = setTimeout(() => void save(draft), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, canEdit, base]);

  // Leaving the note (another note, another tab) saves what is not saved yet.
  useEffect(
    () => () => {
      const d = latest.current;
      if (d && JSON.stringify(d) !== last.current) void apiPut(`/api/notes/${id}`, { title: d.title.trim() || 'Untitled', body: d.body, tags: d.tags.split(',').map((t) => t.trim()).filter(Boolean) }).then(lists, () => toast('error', 'A change to a note could not be saved. Open it again to check.'));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id],
  );

  // A save that failed is tried again when the connection is back.
  useEffect(() => {
    if (status !== 'error') return;
    const again = () => latest.current && void save(latest.current);
    window.addEventListener('online', again);
    const t = setInterval(again, 15_000);
    return () => {
      window.removeEventListener('online', again);
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setMenu(false);
    try {
      await fn();
      if (done) toast('success', done);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      void qc.invalidateQueries({ queryKey: ['notes', 'detail', id] });
      lists();
    }
  };
  const toggle = (what: 'pin' | 'favorite' | 'archive') =>
    act(async () => {
      const r = await apiPost<Record<string, boolean>>(`/api/notes/${id}/${what}`);
      if (what === 'archive') {
        toast('success', r.is_archived ? 'Archived.' : 'Back from the archive.');
        if (r.is_archived) onGone();
      }
    });
  const convert = () =>
    act(async () => {
      const r = await apiPost<{ task_id: number }>(`/api/notes/${id}/convert-task`, {});
      setConverted(r.task_id);
      void links.refetch();
      setTimeout(() => setConverted(null), 10_000);
    });
  const openLink = (l: Link) => {
    if (l.entity_type === 'event') navigate(`/calendar?event=${l.entity_id}`);
    else if (l.entity_type === 'task') navigate(`/tasks?task=${l.entity_id}`);
    else navigate(`/contacts?open=${l.entity_id}`);
  };

  if (detail.isLoading) return <div className="flex flex-1 items-center justify-center"><Spinner /></div>;
  if (detail.error || !n || !draft) {
    return (
      <div className="flex-1 p-8">
        {detail.error instanceof ApiError && detail.error.status === 404 ? <p className="text-ink-2">This note is not there, or it is not yours to open.</p> : <ErrorNote error={detail.error} onRetry={() => void detail.refetch()} />}
      </div>
    );
  }

  const nb = notebooks.find((x) => x.id === n.notebook_id);
  const sec = sections.find((x) => x.id === n.section_id);
  const editors = (n.shares ?? []).filter((s) => s.role === 'editor').map((s) => s.name);
  const viewers = (n.shares ?? []).filter((s) => s.role === 'viewer').map((s) => s.name);
  const meta = owner
    ? [editors.length ? `Editors: you, ${editors.join(', ')}` : null, viewers.length ? `Viewer${viewers.length === 1 ? '' : 's'}: ${viewers.join(', ')}` : null].filter(Boolean).join(' · ') || 'Only you'
    : `Shared${ownerName ? ` by ${ownerName}` : ''} · you can ${n.my_role === 'editor' ? 'edit' : 'read'} it`;
  const item = 'flex h-8 w-full items-center rounded-[6px] px-2.5 text-left hover:bg-subtle';

  const header = (
    <div className="flex shrink-0 items-center gap-2 border-b border-line px-[18px] py-2.5 text-[13px]">
      <span className="min-w-0 truncate text-ink-3">{owner ? [nb?.name ?? 'No notebook', sec?.name].filter(Boolean).join(' › ') : 'Shared with you'}</span>
      <span className="flex-1" />
      {canEdit ? (
        <span className={cx('text-[12px] font-semibold', status === 'error' ? 'text-danger' : status === 'saving' ? 'text-ink-3' : 'text-success')}>
          {status === 'saving' ? 'Saving…' : status === 'error' ? (
            <>
              Not saved ·{' '}
              <button type="button" onClick={() => draft && void save(draft)} className="underline">Retry</button>
            </>
          ) : status === 'saved' ? 'Saved' : `Edited ${relative(n.updated_at)}`}
        </span>
      ) : (
        <span className="rounded-[6px] bg-subtle px-2 py-0.5 text-[11.5px] font-bold text-ink-2">Read only</span>
      )}
      {owner ? (
        <>
          <Button size="sm" aria-pressed={n.is_favorite} onClick={() => void toggle('favorite')} className={n.is_favorite ? '!border-[#E9B949] !bg-warning-bg !text-[#9A4A06]' : ''}>{n.is_favorite ? '★ Favorite' : '☆ Favorite'}</Button>
          <Button size="sm" onClick={() => setDialog('history')}>Version history</Button>
          <Button size="sm" variant="primary" onClick={() => setDialog('share')}>Share{n.shares?.length ? ` · ${n.shares.length}` : ''}</Button>
          <span className="relative">
            <Button size="sm" aria-label="More actions" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>⋯</Button>
            {menu ? (
              <div role="menu" aria-label="Note actions" className="absolute top-9 right-0 z-30 flex w-[230px] flex-col rounded-[10px] border border-line bg-surface p-1.5 text-ink shadow-xl" onMouseLeave={() => setMenu(false)}>
                <button type="button" role="menuitem" className={item} onClick={() => void toggle('pin')}>{n.is_pinned ? 'Unpin' : 'Pin'}</button>
                <button type="button" role="menuitem" className={item} onClick={() => void toggle('favorite')}>{n.is_favorite ? 'Unfavorite' : 'Favorite'}</button>
                <button type="button" role="menuitem" className={item} onClick={() => void act(async () => onOpen((await apiPost<{ id: number }>(`/api/notes/${id}/duplicate`)).id), 'Duplicated.')}>Duplicate</button>
                <button type="button" role="menuitem" className={item} onClick={() => (setMenu(false), setDialog('share'))}>Share</button>
                <button type="button" role="menuitem" className={item} onClick={() => (setMenu(false), setDialog('history'))}>Version history</button>
                <button type="button" role="menuitem" className={item} onClick={() => (setMenu(false), setDialog('move'))}>Move to…</button>
                <button type="button" role="menuitem" className={item} onClick={() => void convert()}>Convert to task</button>
                <button type="button" role="menuitem" className={item} onClick={() => void toggle('archive')}>{n.is_archived ? 'Unarchive' : 'Archive'}</button>
                <button type="button" role="menuitem" className={cx(item, 'font-semibold text-danger')} onClick={() => (setMenu(false), setDialog('delete'))}>Delete</button>
              </div>
            ) : null}
          </span>
        </>
      ) : null}
    </div>
  );

  const linked = owner ? (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-ground px-[18px] py-2 text-[12px]">
      <span className="text-ink-3">Linked:</span>
      {(links.data ?? []).map((l) => (
        <span key={l.id} className={cx('flex items-center gap-1 rounded-full px-2.5 py-[3px] font-semibold', LINK_TONE[l.entity_type])}>
          <button type="button" onClick={() => openLink(l)} className="hover:underline">{l.entity_type === 'event' ? `Event · ${l.label}` : l.entity_type === 'task' ? `Task · ${l.label}` : l.label}</button>
          <button type="button" aria-label={`Unlink ${l.label}`} onClick={() => void act(() => apiDelete(`/api/note-links/${l.id}`)).then(() => links.refetch())} className="opacity-70 hover:opacity-100">×</button>
        </span>
      ))}
      <button type="button" onClick={() => setDialog('contact')} className="font-semibold text-primary hover:underline">Link to a contact…</button>
      <button type="button" onClick={() => setDialog('event')} className="font-semibold text-primary hover:underline">Link to an event…</button>
      <span className="flex-1" />
      <button type="button" onClick={() => void convert()} className="font-bold text-primary hover:underline">Convert to task</button>
    </div>
  ) : null;

  const top = (
    <div className="mb-2 flex flex-col gap-1.5">
      <input
        aria-label="Title"
        value={draft.title}
        readOnly={!canEdit}
        maxLength={255}
        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), document.querySelector<HTMLDivElement>('[role="textbox"][aria-label="Note"]')?.focus())}
        placeholder="Untitled"
        className="bare-focus w-full bg-transparent p-0 text-[24px] font-bold text-ink outline-none"
      />
      <span className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
        {n.is_pinned ? <span className="rounded-[6px] bg-warning-bg px-2 py-px font-bold text-[#9A4A06] dark:text-warning">Pinned</span> : null}
        {n.is_archived ? <span className="rounded-[6px] bg-subtle px-2 py-px font-semibold">Archived</span> : null}
        <span>{meta}</span>
      </span>
      <input aria-label="Tags" value={draft.tags} readOnly={!canEdit} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} placeholder={canEdit ? 'Add tags, comma-separated…' : ''} className="bare-focus w-full bg-transparent p-0 text-[12.5px] text-ink-2 outline-none placeholder:text-ink-3" />
    </div>
  );

  return (
    <article className="relative flex min-w-0 flex-1 flex-col bg-surface" onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 's' && (e.preventDefault(), draft && void save(draft))}>
      {header}
      {canEdit ? (
        <NoteBody key={key} html={n.body} noteId={id} onChange={(body) => setDraft((d) => (d ? { ...d, body } : d))} bar={linked} top={top} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-10 pt-5 pb-10 scroll-thin">
          {top}
          <NoteView html={n.body} noteId={id} className="text-[14px]" />
        </div>
      )}
      {converted ? (
        <div role="status" className="absolute bottom-5 left-1/2 z-20 flex w-[300px] -translate-x-1/2 items-center gap-2 rounded-[10px] bg-[#0F1B3D] px-3.5 py-2.5 text-[13px] text-white shadow-xl">
          <span className="flex-1">Converted to task</span>
          <button type="button" onClick={() => navigate(`/tasks?task=${converted}`)} className="font-bold text-[#AFC6FF] hover:underline">Open</button>
        </div>
      ) : null}
      {dialog === 'share' ? <ShareDialog note={n} onClose={() => setDialog(null)} onChanged={lists} /> : null}
      {dialog === 'history' ? (
        <VersionHistory
          note={n}
          current={{ title: draft.title, body: draft.body }}
          onClose={() => setDialog(null)}
          onRestored={() => {
            setDialog(null);
            void detail.refetch().then(() => setRound((r) => r + 1));
            lists();
          }}
        />
      ) : null}
      {dialog === 'move' ? <MoveNote note={n} notebooks={notebooks} sections={sections} onClose={() => setDialog(null)} onMoved={() => (setDialog(null), void detail.refetch(), lists())} /> : null}
      {dialog === 'contact' || dialog === 'event' ? <LinkPicker kind={dialog} noteId={id} onClose={() => setDialog(null)} onLinked={() => (setDialog(null), void links.refetch())} /> : null}
      {dialog === 'delete' ? (
        <Modal
          title={`Delete “${n.title}”?`}
          onClose={() => setDialog(null)}
          width={420}
          footer={
            <>
              <Button onClick={() => setDialog(null)}>Keep it</Button>
              <Button variant="danger" onClick={() => void act(() => apiDelete(`/api/notes/${id}`), 'Note deleted.').then(() => (setDialog(null), onGone()))}>Delete</Button>
            </>
          }
        >
          <p className="text-[13px] text-ink-2">It goes for everybody it was shared with. Archive keeps it out of the way instead.</p>
        </Modal>
      ) : null}
    </article>
  );
}
