import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { addDays, dateLabel, relative, todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Avatar, Button, Modal, Spinner, cx } from '../../components/ui';
import { diffWords, readableText, TEMPLATES, type Notebook, type NoteDetail, type Section, type Share, type Version } from './api';
import { NoteView } from './NoteBody';
import { Select } from '../../components/Select';

type Directory = { users: Array<{ id: number; name: string; email?: string | null }> };

/** Where a note can be filed: a notebook, or a section of one. */
export function placeOptions(notebooks: Notebook[], sections: Section[]): Array<{ value: string; label: string }> {
  const out = [{ value: '', label: 'No notebook' }];
  for (const nb of notebooks) {
    out.push({ value: `n${nb.id}`, label: nb.name });
    for (const s of sections.filter((x) => x.notebook_id === nb.id)) out.push({ value: `s${s.id}`, label: `${nb.name} › ${s.name}` });
  }
  return out;
}

export function placeOf(value: string, sections: Section[]): { notebook_id: number | null; section_id: number | null } {
  if (value.startsWith('s')) {
    const s = sections.find((x) => x.id === Number(value.slice(1)));
    return { notebook_id: s?.notebook_id ?? null, section_id: s?.id ?? null };
  }
  if (value.startsWith('n')) return { notebook_id: Number(value.slice(1)), section_id: null };
  return { notebook_id: null, section_id: null };
}

/** New note (NotesExtras): a title, where it goes, and a template to start from. */
export function NewNote({ notebooks, sections, place, onClose, onCreated }: { notebooks: Notebook[]; sections: Section[]; place: string; onClose: () => void; onCreated: (id: number) => void }) {
  const [title, setTitle] = useState('');
  const [where, setWhere] = useState(place);
  const [tpl, setTpl] = useState('blank');
  const [busy, setBusy] = useState(false);
  const t = TEMPLATES.find((x) => x.key === tpl)!;
  const create = async () => {
    setBusy(true);
    try {
      const r = await apiPost<{ id: number }>('/api/notes', { title: title.trim() || t.title, body: t.body, ...placeOf(where, sections) });
      onCreated(r.id);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="New note"
      onClose={onClose}
      width={580}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void create()}>Create note</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px]">
        <label className="flex flex-col gap-1 font-semibold text-ink">
          Title
          <input autoFocus value={title} maxLength={255} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void create()} placeholder={t.title} className="h-[34px] rounded-[8px] border border-line bg-surface px-2.5 font-medium text-ink outline-none focus:border-primary" />
        </label>
        <label className="flex flex-col gap-1 font-semibold text-ink">
          Notebook
          <Select value={where} onChange={(e) => setWhere(e.target.value)} className="h-[34px] rounded-[8px] border border-line bg-surface px-2 font-normal text-ink">
            {placeOptions(notebooks, sections).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </label>
        <b className="text-ink">Start from template</b>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Template">
          {TEMPLATES.map((x) => (
            <button key={x.key} type="button" role="radio" aria-checked={tpl === x.key} onClick={() => setTpl(x.key)} className={cx('flex h-[78px] flex-col items-start gap-1 rounded-[10px] p-2.5 text-left', tpl === x.key ? 'border-2 border-primary bg-selection' : 'border border-line bg-surface hover:bg-subtle')}>
              <b className="text-ink">{x.name}</b>
              <span className="text-[11.5px] leading-[1.35] text-ink-3">{x.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/** Share note (NotesExtras): who has it, as viewer or editor, and adding somebody. */
export function ShareDialog({ note, onClose, onChanged }: { note: NoteDetail; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const shares = useQuery({ queryKey: ['notes', 'shares', note.id], queryFn: ({ signal }) => apiGet<Share[]>(`/api/notes/${note.id}/shares`, undefined, signal) });
  const directory = useQuery({ queryKey: ['chat', 'directory'], queryFn: ({ signal }) => apiGet<Directory>('/api/chat/directory', undefined, signal), staleTime: 5 * 60_000 });
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<{ id: number; name: string } | null>(null);
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [busy, setBusy] = useState(false);
  const have = new Set((shares.data ?? []).map((s) => s.user_id));
  const needle = q.trim().toLowerCase();
  const matches = needle && !pick ? (directory.data?.users ?? []).filter((u) => !have.has(u.id) && `${u.name} ${u.email ?? ''}`.toLowerCase().includes(needle)).slice(0, 6) : [];
  const refresh = () => {
    void shares.refetch();
    void qc.invalidateQueries({ queryKey: ['notes', 'detail', note.id] });
    onChanged();
  };
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Share note" onClose={onClose} width={460} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <div className="flex flex-col gap-2.5 text-[13px]">
        <div className="relative flex gap-1.5">
          <input value={pick ? pick.name : q} onChange={(e) => (setPick(null), setQ(e.target.value))} aria-label="Search teammates" placeholder="Search teammates…" className="h-[34px] min-w-0 flex-1 rounded-[8px] border border-line bg-surface px-2.5 text-ink outline-none focus:border-primary" />
          <Select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')} className="h-[34px] rounded-[8px] border border-line bg-surface px-1.5 text-ink">
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </Select>
          <Button variant="primary" disabled={!pick || busy} onClick={() => void act(() => apiPost(`/api/notes/${note.id}/shares`, { user_id: pick!.id, role })).then(() => (setPick(null), setQ('')))}>Share</Button>
          {matches.length ? (
            <div className="absolute top-full right-0 left-0 z-10 mt-1 rounded-[10px] border border-line bg-surface py-1 shadow-xl">
              {matches.map((u) => (
                <button key={u.id} type="button" onClick={() => setPick({ id: u.id, name: u.name })} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-subtle">
                  <Avatar name={u.name} size={22} /> <span className="text-ink">{u.name}</span> <span className="truncate text-[12px] text-ink-3">{u.email}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <b className="mt-1 text-ink">People with access</b>
        <div className="flex items-center gap-2 py-1">
          <Avatar name="You" size={30} />
          <span className="flex flex-1 flex-col"><b className="text-ink">You</b><span className="text-[11.5px] text-ink-3">owner</span></span>
          <span className="rounded-[6px] bg-selection px-2 py-0.5 text-[11.5px] font-bold text-primary">Owner</span>
        </div>
        {shares.isLoading ? <Spinner /> : null}
        {(shares.data ?? []).map((s) => (
          <div key={s.id} className="flex items-center gap-2 py-1">
            <Avatar name={s.name} size={30} />
            <span className="flex min-w-0 flex-1 flex-col"><b className="truncate text-ink">{s.name}</b><span className="truncate text-[11.5px] text-ink-3">{s.email}</span></span>
            <Select aria-label={`Role of ${s.name}`} value={s.role} onChange={(e) => void act(() => apiPut(`/api/note-shares/${s.id}`, { role: e.target.value }))} className="h-7 rounded-[6px] border border-line bg-surface px-1 text-[12px] text-ink">
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </Select>
            <button type="button" onClick={() => void act(() => apiDelete(`/api/note-shares/${s.id}`))} className="text-[12px] font-semibold text-danger hover:underline">Remove</button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/** Version history (NotesExtras): the snapshots, each previewed or compared with the note now, and restored. */
export function VersionHistory({ note, current, onClose, onRestored }: { note: NoteDetail; current: { title: string; body: string }; onClose: () => void; onRestored: () => void }) {
  const versions = useQuery({ queryKey: ['notes', 'versions', note.id], queryFn: ({ signal }) => apiGet<Version[]>(`/api/notes/${note.id}/versions`, undefined, signal) });
  const [sel, setSel] = useState<number | null>(null);
  const [mode, setMode] = useState<'preview' | 'compare'>('compare');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = sel ?? versions.data?.[0]?.id ?? null;
  const one = useQuery({ queryKey: ['notes', 'version', id], queryFn: ({ signal }) => apiGet<{ id: number; title: string; body: string; created_at: string }>(`/api/note-versions/${id}`, undefined, signal), enabled: id !== null });
  const chosen = versions.data?.find((v) => v.id === id);
  const diff = one.data ? diffWords(`${one.data.title}\n${readableText(one.data.body)}`, `${current.title}\n${readableText(current.body)}`) : null;
  const restore = async () => {
    if (!id) return;
    setBusy(true);
    try {
      await apiPost(`/api/note-versions/${id}/restore`);
      toast('success', 'Version restored. What was there is kept as a version too.');
      onRestored();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
      setAsking(false);
    }
  };
  return (
    <aside aria-label="Version history" className="absolute top-0 right-0 bottom-0 z-30 flex w-[440px] max-w-full flex-col border-l border-line bg-surface text-[13px] shadow-[-12px_0_36px_rgb(var(--ws-shadow-rgb)/.16)]">
      <div className="flex shrink-0 items-center border-b border-line px-4 py-3.5">
        <b className="flex-1 text-[15px] text-ink">Version history</b>
        <button type="button" aria-label="Close" onClick={onClose} className="px-1 text-[16px] text-ink-2 hover:text-ink">×</button>
      </div>
      <div className="max-h-[40%] shrink-0 overflow-y-auto scroll-thin">
        <div className="flex flex-col gap-0.5 border-l-[3px] border-transparent px-4 py-2 text-ink-3">
          <b className="text-ink">Now · current</b>
          <span className="text-[12px]">as you have it</span>
        </div>
        {versions.isLoading ? <Spinner /> : null}
        {versions.data && !versions.data.length ? <p className="px-4 py-3 text-[12.5px] text-ink-3">No earlier versions yet. One is kept when a note changes, at most every two minutes.</p> : null}
        {(versions.data ?? []).map((v) => (
          <button key={v.id} type="button" onClick={() => setSel(v.id)} className={cx('flex w-full flex-col gap-0.5 border-l-[3px] px-4 py-2 text-left', v.id === id ? 'border-primary bg-selection' : 'border-transparent hover:bg-subtle')}>
            <b className="text-ink">{relative(v.created_at)} · {dateLabel(v.created_at)}</b>
            <span className="truncate text-[12px] text-ink-3">{v.title} · {Math.max(1, Math.round(v.size / 100) / 10)}k characters</span>
          </button>
        ))}
      </div>
      <div className="mx-4 my-3 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto rounded-[10px] bg-ground p-3 scroll-thin">
        {chosen ? <span className="text-[11.5px] font-bold text-ink-3">{mode === 'compare' ? `COMPARING ${relative(chosen.created_at).toUpperCase()} TO CURRENT` : `PREVIEW · ${relative(chosen.created_at).toUpperCase()}`}</span> : null}
        {one.isLoading ? <Spinner /> : null}
        {one.data && mode === 'preview' ? (
          <>
            <b className="text-[15px] text-ink">{one.data.title}</b>
            <NoteView html={one.data.body} noteId={note.id} />
          </>
        ) : null}
        {one.data && mode === 'compare' ? (
          diff ? (
            <p className="whitespace-pre-wrap leading-[1.6] text-ink selectable">
              {diff.map((d, i) => (
                <span key={i} className={d.kind === 'removed' ? 'bg-danger-bg text-danger line-through' : d.kind === 'added' ? 'bg-success-bg text-success' : ''}>{d.text}</span>
              ))}
            </p>
          ) : (
            <p className="text-ink-3">These versions are too long to compare here. Preview them instead.</p>
          )
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-3">
        <Button onClick={() => setMode('preview')} className={mode === 'preview' ? '!border-primary !bg-selection !text-primary' : ''}>Preview</Button>
        <Button onClick={() => setMode('compare')} className={mode === 'compare' ? '!border-primary !bg-selection !text-primary' : ''}>Compare to current</Button>
        <span className="flex-1" />
        <Button variant="primary" disabled={!id} onClick={() => setAsking(true)}>Restore version</Button>
      </div>
      {asking ? (
        <Modal
          title="Restore this version?"
          onClose={() => setAsking(false)}
          width={420}
          footer={
            <>
              <Button onClick={() => setAsking(false)}>Keep the current one</Button>
              <Button variant="primary" loading={busy} onClick={() => void restore()}>Restore</Button>
            </>
          }
        >
          <p className="text-[13px] text-ink-2">The note goes back to this version. What it says now is kept as a version first, so this can be undone.</p>
        </Modal>
      ) : null}
    </aside>
  );
}

/** Move to a notebook or section. */
export function MoveNote({ note, notebooks, sections, onClose, onMoved }: { note: NoteDetail; notebooks: Notebook[]; sections: Section[]; onClose: () => void; onMoved: () => void }) {
  const [where, setWhere] = useState(note.section_id ? `s${note.section_id}` : note.notebook_id ? `n${note.notebook_id}` : '');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Move note"
      onClose={onClose}
      width={420}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => {
            setBusy(true);
            void apiPut(`/api/notes/${note.id}`, placeOf(where, sections)).then(() => (toast('success', 'Moved.'), onMoved()), (e) => toast('error', errorMessage(e))).finally(() => setBusy(false));
          }}>Move</Button>
        </>
      }
    >
      <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
        To
        <Select autoFocus value={where} onChange={(e) => setWhere(e.target.value)} className="h-[34px] rounded-[8px] border border-line bg-surface px-2 font-normal text-ink">
          {placeOptions(notebooks, sections).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </label>
    </Modal>
  );
}

/** Link a note to a contact or to one of your events. */
export function LinkPicker({ kind, noteId, onClose, onLinked }: { kind: 'contact' | 'event'; noteId: number; onClose: () => void; onLinked: () => void }) {
  const [q, setQ] = useState('');
  const today = todayInZone();
  const contacts = useQuery({ queryKey: ['notes', 'link-contacts'], queryFn: ({ signal }) => apiGet<Array<{ id: number; display_name: string; company?: string | null; email?: string | null }>>('/api/contacts', undefined, signal), enabled: kind === 'contact' });
  const events = useQuery({
    queryKey: ['notes', 'link-events', today],
    queryFn: ({ signal }) => apiGet<{ events: Array<{ source: string; id: number; title: string; start_at: string }> }>('/api/calendar/events', { from: addDays(today, -60), to: addDays(today, 90) }, signal),
    enabled: kind === 'event',
  });
  const needle = q.trim().toLowerCase();
  const rows =
    kind === 'contact'
      ? (contacts.data ?? []).map((c) => ({ id: c.id, label: c.display_name, sub: c.company ?? c.email ?? '' }))
      : [...new Map((events.data?.events ?? []).filter((e) => e.source === 'event').map((e) => [e.id, { id: e.id, label: e.title, sub: dateLabel(e.start_at.slice(0, 10)) }])).values()];
  const shown = rows.filter((r) => !needle || `${r.label} ${r.sub}`.toLowerCase().includes(needle)).slice(0, 50);
  const link = (id: number) =>
    void apiPost(`/api/notes/${noteId}/link`, { entity_type: kind, entity_id: id }).then(
      () => (toast('success', 'Linked.'), onLinked()),
      (e) => toast('error', errorMessage(e)),
    );
  return (
    <Modal title={kind === 'contact' ? 'Link to a contact' : 'Link to an event'} onClose={onClose} width={460}>
      <div className="flex flex-col gap-2 text-[13px]">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" placeholder={kind === 'contact' ? 'Search contacts…' : 'Search your events…'} className="h-[34px] rounded-[8px] border border-line bg-surface px-2.5 text-ink outline-none focus:border-primary" />
        <div className="max-h-[320px] overflow-y-auto rounded-[10px] border border-line scroll-thin">
          {(kind === 'contact' ? contacts.isLoading : events.isLoading) ? <Spinner /> : null}
          {shown.map((r) => (
            <button key={r.id} type="button" onClick={() => link(r.id)} className="flex w-full items-center gap-2 border-b border-line/60 px-3 py-2 text-left hover:bg-subtle">
              <span className="min-w-0 flex-1 truncate font-semibold text-ink">{r.label}</span>
              <span className="truncate text-[12px] text-ink-3">{r.sub}</span>
            </button>
          ))}
          {!shown.length ? <p className="px-3 py-6 text-center text-ink-3">{kind === 'contact' ? 'No contacts match.' : 'No events of yours match (two months back, three ahead).'}</p> : null}
        </div>
      </div>
    </Modal>
  );
}
