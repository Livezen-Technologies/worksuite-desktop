import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { PickedFile } from '@shared/ipc/contract';
import { app } from '../../core/app-state';
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { call, errorMessage, registerDropped } from '../../core/bridge';
import { useStore } from '../../core/store';
import { bytes, currentZone, relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { DriveFilePicker, type DriveFileRow } from '../../components/DriveFilePicker';
import { Icon } from '../../components/Icon';
import { Avatar, Button, ErrorNote, FileBadge, Modal, Spinner, cx } from '../../components/ui';
import { mediaUrl } from '../chat/types';
import { EmojiPicker } from '../chat/parts';
import { createTask, patchTask } from './actions';
import { PRIORITIES, progressOf, STATUSES, type Activity, type Attachment, type TaskDetail as Detail, type TaskList } from './api';
import { when, type Directory } from './NewTask';
import { PeoplePanel, ReviewPanel, usePeople } from './People';
import { RichEditor, RichView } from './RichText';
import { Select } from '../../components/Select';

const aside = 'h-8 w-full min-w-0 rounded-[7px] border border-line bg-surface px-1.5 text-[13px] text-ink outline-none focus:border-primary disabled:bg-transparent disabled:text-ink-2';

/** An instant, or a day, as the date and time inputs show it on your WorkSuite clock. */
function inputsOf(day: string | null, at: string | null): { date: string; time: string } {
  if (at) {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: currentZone(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at));
    const g = (k: string) => p.find((x) => x.type === k)?.value ?? '00';
    return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` };
  }
  return { date: day ?? '', time: '' };
}

/**
 * A task (TaskDetail): everything about it on the left, its settings and
 * people on the right. Each change saves as it is made, and only what this
 * person may change is offered (the server's `can_edit`).
 */
export function TaskDetail({ id, lists, onClose, onOpen }: { id: number; lists: TaskList[]; onClose: () => void; onOpen: (id: number) => void }) {
  const qc = useQueryClient();
  const me = Number(useStore(app, (s) => s.auth?.user?.id) ?? 0);
  const origin = useStore(app, (s) => s.auth?.server?.origin ?? '');
  const detail = useQuery({ queryKey: ['tasks', 'detail', id], queryFn: ({ signal }) => apiGet<Detail>(`/api/tasks/${id}`, undefined, signal), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 });
  const people = usePeople(id);
  const [saving, setSaving] = useState(0);
  const [saved, setSaved] = useState(false);
  const [menu, setMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [emoji, setEmoji] = useState(false);
  const t = detail.data;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['tasks'] });
  };
  const save = async (field: string, value: unknown, label: string) => {
    if (!t) return;
    setSaving((n) => n + 1);
    try {
      await patchTask(t, field, value, label);
      setSaved(true);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setSaving((n) => n - 1);
      refresh();
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const canEdit = (f: keyof Detail['can_edit']) => !!t?.can_edit?.[f];
  const worker = !!t && (t.owner_id === me || t.assignee_id === me);
  const list = t?.list_id ? lists.find((l) => l.id === t.list_id) : undefined;

  return (
    <div className="no-drag fixed inset-0 z-40 flex items-center justify-center bg-[#0B1020]/45 p-5" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Task details" className="flex h-full max-h-[860px] w-full max-w-[1100px] flex-col overflow-hidden rounded-[14px] border border-line bg-surface text-[13px] shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-3">
          <span className="truncate text-ink-3">{list ? `${list.name} ›` : 'Tasks ›'}</span>
          <span className="shrink-0 font-mono text-[12px] text-ink-3">{t?.task_key ?? `TASK-${id}`}</span>
          <span className="flex-1" />
          {t ? <span className={cx('text-[12px] font-semibold', saving ? 'text-ink-3' : 'text-success')}>{saving ? 'Saving…' : saved ? 'Saved' : 'Changes save as you make them'}</span> : null}
          <Button size="sm" onClick={() => void navigator.clipboard.writeText(`${origin}/tasks?task=${id}`).then(() => toast('success', 'Link copied.'))}>Copy link</Button>
          {t && worker ? (
            <span className="relative">
              <Button size="sm" aria-label="More actions" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>⋯</Button>
              {menu ? (
                <div role="menu" className="absolute top-9 right-0 z-30 w-44 rounded-[10px] border border-line bg-surface py-1 shadow-xl" onMouseLeave={() => setMenu(false)}>
                  <button type="button" role="menuitem" className="block w-full px-3 py-1.5 text-left hover:bg-subtle" onClick={() => {
                    setMenu(false);
                    void createTask({ title: `${t.title} (copy)`, description: t.description ?? '', status: t.status === 'done' ? 'todo' : t.status, priority: t.priority, assignee_id: t.assignee_id, list_id: t.list_id, org_id: t.org_id, tags: t.tags, ...(t.due_at ? { due_date: t.due_at } : t.due_date ? { due_date: t.due_date } : {}) }).then((r) => {
                      toast('success', 'Duplicated.');
                      refresh();
                      if (r.id) onOpen(r.id);
                    }, (e) => toast('error', errorMessage(e)));
                  }}>Duplicate</button>
                  <button type="button" role="menuitem" className="block w-full px-3 py-1.5 text-left hover:bg-subtle" onClick={() => {
                    setMenu(false);
                    void apiPut(`/api/tasks/${id}`, { archived: true }).then(() => (toast('success', 'Archived.'), refresh(), onClose()), (e) => toast('error', errorMessage(e)));
                  }}>Archive</button>
                  <button type="button" role="menuitem" className="block w-full px-3 py-1.5 text-left text-danger hover:bg-subtle" onClick={() => (setMenu(false), setDeleting(true))}>Delete…</button>
                </div>
              ) : null}
            </span>
          ) : null}
          {t && canEdit('status') ? (
            t.status === 'done' ? (
              <Button size="sm" onClick={() => void save('status', 'todo', `Reopen “${t.title}”`).then(() => (!t.checklist.length && t.progress === 100 ? save('progress', 0, `Progress of “${t.title}”`) : undefined))}>Reopen</Button>
            ) : (
              <button type="button" onClick={() => void save('status', 'done', `Complete “${t.title}”`)} className="h-8 rounded-[7px] bg-success px-3 font-bold text-white hover:opacity-90">Complete</button>
            )
          ) : null}
          <button type="button" aria-label="Close" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[16px] text-ink-2 hover:bg-subtle">×</button>
        </div>
        {detail.isLoading ? <Spinner /> : null}
        {detail.error ? (
          <div className="p-6">
            {detail.error instanceof ApiError && detail.error.status === 404 ? <p className="text-ink-2">This task is not there, or it is not yours to open.</p> : <ErrorNote error={detail.error} onRetry={() => void detail.refetch()} />}
          </div>
        ) : null}
        {t ? (
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_330px]">
            <div className="flex min-h-0 flex-col gap-3.5 overflow-y-auto px-[22px] py-[18px] scroll-thin">
              <Title key={`t${t.id}`} value={t.title} editable={canEdit('title')} onSave={(v) => void save('title', v, `Rename to “${v}”`)} />
              <Description key={`d${t.id}${t.updated_at}`} task={t} editable={canEdit('description')} onSave={(html) => void save('description', html, `Describe “${t.title}”`)} />
              <Checklist task={t} editable={canEdit('checklist')} onChanged={refresh} />
              <Attachments task={t} editable={worker || canEdit('description')} />
              <Conversation task={t} me={me} people={people.data} emoji={emoji} setEmoji={setEmoji} onChanged={refresh} />
            </div>
            <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-l border-line bg-ground px-[18px] py-[18px] scroll-thin" aria-label="Task settings">
              <Row label="Status">
                <Select aria-label="Status" disabled={!canEdit('status')} value={t.status} onChange={(e) => void save('status', e.target.value, `Status of “${t.title}”`)} className={aside}>
                  {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </Select>
              </Row>
              <Row label="Priority">
                <Select aria-label="Priority" disabled={!canEdit('priority')} value={t.priority} onChange={(e) => void save('priority', e.target.value, `Priority of “${t.title}”`)} className={aside}>
                  {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </Select>
              </Row>
              <Row label="Assignee">
                <Assignee value={t.assignee_id} name={t.assignee_name} me={me} disabled={!canEdit('assignee_id')} onChange={(v) => void save('assignee_id', v, `Assign “${t.title}”`)} />
              </Row>
              <Row label="Start date">
                <When key={`s${t.start_at}${t.start_date}`} value={inputsOf(t.start_date, t.start_at)} disabled={!canEdit('start_date')} label="Start" onChange={(v) => void save('start_date', v, `Start of “${t.title}”`)} />
              </Row>
              <Row label="Due date">
                <When key={`u${t.due_at}${t.due_date}`} value={inputsOf(t.due_date, t.due_at)} disabled={!canEdit('due_date')} label="Due" onChange={(v) => void save('due_date', v, `Due date of “${t.title}”`)} />
              </Row>
              <Row label="List">
                <Select aria-label="List" disabled={!canEdit('list_id')} value={t.list_id ?? ''} onChange={(e) => void save('list_id', e.target.value ? Number(e.target.value) : '', `List of “${t.title}”`)} className={aside}>
                  <option value="">No list</option>
                  {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  {t.list_id && !list ? <option value={t.list_id}>Someone else's list</option> : null}
                </Select>
              </Row>
              <Row label="Organisation">
                <Organisation value={t.org_id} name={t.org_name} disabled={!canEdit('org_id')} onChange={(v) => void save('org_id', v, `Company of “${t.title}”`)} />
              </Row>
              <Row label="Tags">
                <Tags key={`g${t.tags.join()}`} value={t.tags} disabled={!canEdit('tags')} onChange={(v) => void save('tags', v, `Tags of “${t.title}”`)} />
              </Row>
              <Progress task={t} editable={canEdit('progress')} onSave={(v) => void save('progress', v, `Progress of “${t.title}”`)} />
              <PeoplePanel task={t} me={me} people={people.data} refresh={() => (void people.refetch(), refresh())} />
              <ReviewPanel task={t} me={me} people={people.data} refresh={() => (void people.refetch(), refresh())} />
            </aside>
          </div>
        ) : null}
      </div>
      {deleting && t ? (
        <Modal
          title={`Delete “${t.title}”?`}
          onClose={() => setDeleting(false)}
          width={420}
          footer={
            <>
              <Button onClick={() => setDeleting(false)}>Keep it</Button>
              <Button variant="danger" onClick={() => void apiDelete(`/api/tasks/${id}`).then(() => (toast('success', 'Task deleted.'), refresh(), onClose()), (e) => toast('error', errorMessage(e)))}>Delete</Button>
            </>
          }
        >
          <p className="text-[13px] text-ink-2">It goes for everybody on it, with its checklist and comments.</p>
        </Modal>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] items-center gap-2">
      <span className="font-semibold text-ink-3">{label}</span>
      {children}
    </div>
  );
}

function Title({ value, editable, onSave }: { value: string; editable: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  const commit = () => {
    const x = v.trim();
    if (!x) return setV(value);
    if (x !== value) onSave(x);
  };
  return (
    <input
      aria-label="Task name"
      value={v}
      readOnly={!editable}
      maxLength={255}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      className="bare-focus w-full rounded-[6px] bg-transparent px-0 text-[21px] font-bold text-ink outline-none focus:bg-subtle/60"
    />
  );
}

function Description({ task, editable, onSave }: { task: Detail; editable: boolean; onSave: (html: string) => void }) {
  const [editing, setEditing] = useState(false);
  const html = useRef(task.description ?? '');
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center">
        <b className="flex-1 text-ink">Description</b>
        {editable && !editing ? <button type="button" onClick={() => setEditing(true)} className="font-semibold text-primary hover:underline">Edit</button> : null}
      </div>
      {editing ? (
        <>
          <RichEditor initial={task.description ?? ''} taskId={task.id} label="Description" placeholder="What needs doing?" autoFocus onChange={(h) => (html.current = h)} minHeight={90} />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" onClick={() => setEditing(false)}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={() => (setEditing(false), html.current !== (task.description ?? '') ? onSave(html.current) : undefined)}>Save</Button>
          </div>
        </>
      ) : task.description ? (
        <div className="rounded-[9px] border border-line px-3 py-2.5" onDoubleClick={() => editable && setEditing(true)}>
          <RichView html={task.description} taskId={task.id} />
        </div>
      ) : (
        <button type="button" disabled={!editable} onClick={() => setEditing(true)} className="rounded-[9px] border border-dashed border-line px-3 py-2.5 text-left text-ink-3 enabled:hover:bg-subtle">
          {editable ? 'Add a description…' : 'No description.'}
        </button>
      )}
    </div>
  );
}

function Checklist({ task, editable, onChanged }: { task: Detail; editable: boolean; onChanged: () => void }) {
  const [title, setTitle] = useState('');
  const [renaming, setRenaming] = useState<{ id: number; title: string } | null>(null);
  const items = task.checklist;
  const done = items.filter((i) => i.done).length;
  const act = (fn: () => Promise<unknown>) => void fn().then(onChanged, (e) => toast('error', errorMessage(e)));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center">
        <b className="flex-1 text-ink">Checklist{items.length ? ` · ${done} of ${items.length}` : ''}</b>
        {items.length ? (
          <span className="h-1.5 w-40 overflow-hidden rounded-full bg-subtle" aria-label={`${done} of ${items.length} done`}>
            <span className="block h-full rounded-full bg-success" style={{ width: `${Math.round((done / items.length) * 100)}%` }} />
          </span>
        ) : null}
      </div>
      {items.map((i) => (
        <div key={i.id} className="group flex items-center gap-2.5 py-0.5">
          <input type="checkbox" checked={i.done} disabled={!editable} onChange={() => act(() => apiPut(`/api/tasks/${task.id}/checklist/${i.id}`, { done: !i.done }))} aria-label={i.title} className="h-4 w-4 accent-[#1F7A4D]" />
          {renaming?.id === i.id ? (
            <input
              autoFocus
              value={renaming.title}
              onChange={(e) => setRenaming({ id: i.id, title: e.target.value })}
              onBlur={() => {
                const x = renaming.title.trim();
                setRenaming(null);
                if (x && x !== i.title) act(() => apiPut(`/api/tasks/${task.id}/checklist/${i.id}`, { title: x }));
              }}
              onKeyDown={(e) => (e.key === 'Enter' ? e.currentTarget.blur() : e.key === 'Escape' ? setRenaming(null) : undefined)}
              aria-label="Checklist item"
              className="h-7 flex-1 rounded-[6px] border border-primary bg-surface px-1.5 text-ink outline-none"
            />
          ) : (
            <span onDoubleClick={() => editable && setRenaming({ id: i.id, title: i.title })} className={cx('flex-1', i.done ? 'text-ink-3 line-through' : 'text-ink')}>{i.title}</span>
          )}
          {editable ? <button type="button" aria-label={`Remove ${i.title}`} onClick={() => act(() => apiDelete(`/api/tasks/${task.id}/checklist/${i.id}`))} className="invisible px-1 text-ink-3 group-hover:visible hover:text-danger">×</button> : null}
        </div>
      ))}
      {editable ? (
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || !title.trim()) return;
            const x = title.trim();
            setTitle('');
            act(() => apiPost(`/api/tasks/${task.id}/checklist`, { title: x }));
          }}
          aria-label="Add checklist item"
          placeholder="Add checklist item…"
          className="h-8 rounded-[8px] border border-dashed border-[#B8C1DA] bg-transparent px-2.5 text-ink outline-none focus:border-solid focus:border-primary dark:border-line"
        />
      ) : null}
    </div>
  );
}

function useAttachments(taskId: number) {
  return useQuery({ queryKey: ['tasks', 'attachments', taskId], queryFn: ({ signal }) => apiGet<{ attachments: Attachment[] }>(`/api/tasks/${taskId}/attachments`, undefined, signal) });
}

/** Uploads made from here, watched until they are in, then the list is read again. */
function useUploads(taskId: number) {
  const qc = useQueryClient();
  const transfers = useStore(app, (s) => s.transfers);
  const [ids, setIds] = useState<string[]>([]);
  const live = transfers.filter((t) => ids.includes(t.id) && t.state !== 'done' && t.state !== 'cancelled');
  const settled = ids.length > 0 && live.length === 0;
  useEffect(() => {
    if (!settled) return;
    void qc.invalidateQueries({ queryKey: ['tasks', 'attachments', taskId] });
  }, [settled, qc, taskId]);
  const send = async (files: PickedFile[], commentId?: number) => {
    if (!files.length) return;
    try {
      const out = await call('transfers:upload', { handles: files.map((f) => f.handle), target: { kind: 'task', taskId, ...(commentId ? { commentId } : {}) } });
      setIds((x) => [...x.filter((i) => live.some((l) => l.id === i)), ...out.map((o) => o.id)]);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return { live, send };
}

function Attachments({ task, editable }: { task: Detail; editable: boolean }) {
  const qc = useQueryClient();
  const q = useAttachments(task.id);
  const uploads = useUploads(task.id);
  const [drive, setDrive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [preview, setPreview] = useState<{ name: string; src: string } | null>(null);
  const own = (q.data?.attachments ?? []).filter((a) => !a.comment_id);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['tasks', 'attachments', task.id] });
  const pick = async () => {
    try {
      await uploads.send(await call('files:pickFiles', { multiple: true, title: `Attach to ${task.title.slice(0, 60)}` }));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const link = async (files: DriveFileRow[]) => {
    setBusy(true);
    try {
      const r = await apiPost<{ linked: number; skipped: number }>(`/api/tasks/${task.id}/attachments/drive`, { file_ids: files.map((f) => Number(f.id)) });
      if (r.skipped) toast('info', `${r.skipped} file${r.skipped === 1 ? '' : 's'} not yours to attach were left out.`);
      setDrive(false);
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className={cx('flex flex-col gap-1.5 rounded-[10px]', drag && 'ring-2 ring-primary/40')}
      onDragOver={(e) => {
        if (!editable || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        if (!editable) return;
        e.preventDefault();
        setDrag(false);
        void registerDropped(Array.from(e.dataTransfer.files)).then((f) => uploads.send(f), (err) => toast('error', errorMessage(err)));
      }}
    >
      <div className="flex items-center gap-2">
        <b className="flex-1 text-ink">Attachments{editable ? <span className="font-normal text-ink-3"> · drop to attach</span> : null}</b>
        {editable ? (
          <>
            <button type="button" onClick={() => void pick()} className="font-semibold text-primary hover:underline">Attach files</button>
            <button type="button" onClick={() => setDrive(true)} className="font-semibold text-primary hover:underline">From Drive</button>
          </>
        ) : null}
      </div>
      {q.isLoading ? <span className="text-ink-3">Loading…</span> : null}
      {!q.isLoading && !own.length && !uploads.live.length ? <span className="text-[12px] text-ink-3">No files yet.</span> : null}
      <div className="flex flex-wrap gap-2">
        {own.map((a) => (
          <AttachmentCard key={a.id} a={a} taskId={task.id} removable={editable} onPreview={setPreview} onRemoved={refresh} />
        ))}
        {uploads.live.map((u) => (
          <span key={u.id} className="flex items-center gap-2 rounded-[8px] border border-line px-2.5 py-[7px] text-[12px]">
            <FileBadge name={u.name} size={26} />
            <span className="flex flex-col">
              <b className="max-w-[180px] truncate text-ink">{u.name}</b>
              <span className={u.state === 'failed' ? 'text-danger' : 'text-ink-3'}>{u.state === 'failed' ? `Failed · ${u.error ?? ''}` : `Uploading… ${u.total ? Math.round((u.bytes / u.total) * 100) : 0}%`}</span>
            </span>
          </span>
        ))}
      </div>
      {drive ? <DriveFilePicker title="Attach from Drive" confirmLabel="Attach" busy={busy} onChoose={(f) => void link(f)} onClose={() => setDrive(false)} /> : null}
      {preview ? (
        <Modal title={preview.name} onClose={() => setPreview(null)} width={820}>
          <img src={preview.src} alt={preview.name} className="mx-auto max-h-[70vh] rounded-[8px]" />
        </Modal>
      ) : null}
    </div>
  );
}

function AttachmentCard({ a, taskId, removable, onPreview, onRemoved }: { a: Attachment; taskId: number; removable: boolean; onPreview: (p: { name: string; src: string }) => void; onRemoved: () => void }) {
  const open = async () => {
    try {
      const r = await apiPost<{ url: string }>(`/api/tasks/${taskId}/attachments/${a.id}/link`);
      await call('app:openExternal', { url: r.url });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const preview = async () => {
    try {
      const p = await apiGet<{ is_image: boolean; url: string | null; thumb_url: string | null }>(`/api/tasks/${taskId}/attachments/${a.id}/preview`);
      const src = p.is_image ? mediaUrl(p.url ?? p.thumb_url) : null;
      if (src) onPreview({ name: a.name, src });
      else await open();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <span className="group flex items-center gap-2 rounded-[8px] border border-line px-2.5 py-[7px] text-[12px]">
      <FileBadge name={a.name} size={26} />
      <span className="flex min-w-0 flex-col">
        <b className="max-w-[200px] truncate text-ink" title={a.name}>{a.name}</b>
        <span className="text-ink-3">
          {a.missing ? (
            'No longer in Drive'
          ) : (
            <>
              {bytes(a.size)} ·{' '}
              <button type="button" onClick={() => void preview()} className="text-primary hover:underline">Preview</button> ·{' '}
              <button type="button" onClick={() => void open()} className="text-primary hover:underline">Download</button>
            </>
          )}
        </span>
      </span>
      {removable ? (
        <button type="button" aria-label={`Remove ${a.name}`} title="Remove from the task (it stays in Drive)" onClick={() => void apiDelete(`/api/tasks/${taskId}/attachments/${a.id}`).then(onRemoved, (e) => toast('error', errorMessage(e)))} className="invisible px-1 text-ink-3 group-hover:visible hover:text-danger">×</button>
      ) : null}
    </span>
  );
}

/** Comments and the activity, as tabs, and the box to write a comment. */
function Conversation({ task, me, people, emoji, setEmoji, onChanged }: { task: Detail; me: number; people: ReturnType<typeof usePeople>['data']; emoji: boolean; setEmoji: (v: boolean) => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'comments' | 'activity'>('comments');
  const [draft, setDraft] = useState('');
  const [round, setRound] = useState(0);
  const [sending, setSending] = useState(false);
  const [disk, setDisk] = useState<PickedFile[]>([]);
  const [fromDrive, setFromDrive] = useState<DriveFileRow[]>([]);
  const [drive, setDrive] = useState(false);
  const uploads = useUploads(task.id);
  const attachments = useAttachments(task.id);
  const directory = useQuery({ queryKey: ['chat', 'directory'], queryFn: ({ signal }) => apiGet<Directory>('/api/chat/directory', undefined, signal), staleTime: 5 * 60_000 });
  const activity = useQuery({ queryKey: ['tasks', 'activity', task.id], queryFn: ({ signal }) => apiGet<Activity[]>(`/api/tasks/${task.id}/activity`, undefined, signal), enabled: tab === 'activity' });
  const mine = people?.people.find((p) => p.user_id === me);
  const mayComment = task.owner_id === me || task.assignee_id === me || (!!mine && ['comment', 'edit', 'manage'].includes(mine.permission));
  const roleOf = (uid: number) => (uid === task.owner_id ? 'owner' : people?.people.find((p) => p.user_id === uid)?.role);
  const byComment = new Map<number, Attachment[]>();
  for (const a of attachments.data?.attachments ?? []) if (a.comment_id) byComment.set(a.comment_id, [...(byComment.get(a.comment_id) ?? []), a]);

  const send = async () => {
    if (sending || (!draft.replace(/<[^>]+>/g, '').trim() && !disk.length && !fromDrive.length)) return;
    setSending(true);
    try {
      const r = await apiPost<{ comment_id: number }>(`/api/tasks/${task.id}/comments`, { body: draft || '<p>📎</p>' });
      if (disk.length) await uploads.send(disk, r.comment_id);
      if (fromDrive.length) await apiPost(`/api/tasks/${task.id}/attachments/drive`, { file_ids: fromDrive.map((f) => Number(f.id)), comment_id: r.comment_id });
      setDraft('');
      setDisk([]);
      setFromDrive([]);
      setRound((n) => n + 1);
      onChanged();
      void qc.invalidateQueries({ queryKey: ['tasks', 'attachments', task.id] });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const insertEmoji = (e: string) => {
    setEmoji(false);
    const box = document.querySelector<HTMLDivElement>('[role="textbox"][aria-label="Comment"]');
    box?.focus();
    document.execCommand('insertText', false, e);
  };

  return (
    <div className="flex flex-col gap-2">
      <div role="tablist" className="flex gap-1">
        <button type="button" role="tab" aria-selected={tab === 'comments'} onClick={() => setTab('comments')} className={cx('rounded-full px-2.5 py-1 text-[12px] font-semibold', tab === 'comments' ? 'bg-ink text-surface' : 'border border-line text-ink hover:bg-subtle')}>
          Comments · {task.comments.length}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'activity'} onClick={() => setTab('activity')} className={cx('rounded-full px-2.5 py-1 text-[12px] font-semibold', tab === 'activity' ? 'bg-ink text-surface' : 'border border-line text-ink hover:bg-subtle')}>
          Activity
        </button>
      </div>
      {tab === 'comments' ? (
        <>
          {task.comments.length === 0 ? <span className="text-[12px] text-ink-3">No comments yet.</span> : null}
          {task.comments.map((c) => (
            <div key={c.id} className="flex gap-2.5">
              <Avatar name={c.user_name} size={28} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span>
                  <b className="text-ink">{c.user_id === me ? 'You' : c.user_name}</b>{' '}
                  <span className="text-ink-3">· {roleOf(c.user_id) ? `${roleOf(c.user_id)} · ` : ''}{relative(c.created_at)}</span>
                </span>
                <RichView html={c.body} taskId={task.id} />
                {byComment.get(c.id)?.length ? (
                  <div className="mt-1 flex flex-wrap gap-2">
                    {byComment.get(c.id)!.map((a) => <AttachmentCard key={a.id} a={a} taskId={task.id} removable={false} onPreview={() => undefined} onRemoved={() => undefined} />)}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
          {mayComment ? (
            <div className="relative flex flex-col gap-1.5">
              <RichEditor
                key={round}
                initial=""
                taskId={task.id}
                label="Comment"
                placeholder="Write a comment… @ to mention"
                onChange={setDraft}
                onSubmit={() => void send()}
                people={(directory.data?.users ?? []).map((u) => ({ id: u.id, name: u.name }))}
                minHeight={44}
                extraTools={
                  <>
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void call('files:pickFiles', { multiple: true, title: 'Attach to the comment' }).then((f) => setDisk((d) => [...d, ...f]), (e) => toast('error', errorMessage(e)))} className="rounded-[5px] px-[7px] py-[3px] hover:bg-subtle hover:text-ink">Attach a file</button>
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setDrive(true)} className="rounded-[5px] px-[7px] py-[3px] hover:bg-subtle hover:text-ink">Choose from Drive</button>
                    <button type="button" aria-label="Emoji" onMouseDown={(e) => e.preventDefault()} onClick={() => setEmoji(!emoji)} className="rounded-[5px] px-[7px] py-[3px] hover:bg-subtle hover:text-ink"><Icon name="smile" size={14} /></button>
                  </>
                }
              />
              {emoji ? <EmojiPicker className="absolute bottom-full left-40 mb-1" onPick={insertEmoji} onClose={() => setEmoji(false)} /> : null}
              {disk.length || fromDrive.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {disk.map((f) => <Chip key={f.handle} name={f.name} note={bytes(f.size)} onRemove={() => setDisk(disk.filter((x) => x.handle !== f.handle))} />)}
                  {fromDrive.map((f) => <Chip key={`d${f.id}`} name={f.name} note="from Drive" onRemove={() => setFromDrive(fromDrive.filter((x) => x.id !== f.id))} />)}
                </div>
              ) : null}
              <div className="flex items-center justify-end gap-2">
                <span className="text-[11px] text-ink-3">Enter to send · Shift + Enter for a new line</span>
                <Button size="sm" variant="primary" loading={sending} onClick={() => void send()}>Send comment</Button>
              </div>
              {drive ? <DriveFilePicker title="Attach from Drive" confirmLabel="Add" onChoose={(f) => (setFromDrive((d) => [...d, ...f]), setDrive(false))} onClose={() => setDrive(false)} /> : null}
            </div>
          ) : (
            <span className="rounded-[8px] bg-subtle px-3 py-2 text-[12px] text-ink-3">This task was shared with you to view, so you can read the comments but not add one.</span>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-1.5">
          {activity.isLoading ? <span className="text-ink-3">Loading…</span> : null}
          {activity.data && !activity.data.length ? <span className="text-[12px] text-ink-3">Nothing recorded yet. People joining and leaving, and reviews, show here.</span> : null}
          {(activity.data ?? []).map((a) => (
            <div key={a.id} className="flex gap-2 text-[12.5px]">
              <span className="w-24 shrink-0 text-ink-3">{relative(a.created_at)}</span>
              <span className="text-ink"><b>{a.actor ?? 'Someone'}</b> {a.summary ?? a.action.replace(/_/g, ' ')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({ name, note, onRemove }: { name: string; note: string; onRemove: () => void }) {
  return (
    <span className="flex items-center gap-1.5 rounded-[8px] border border-line px-2 py-1 text-[12px]">
      <b className="max-w-[160px] truncate text-ink">{name}</b>
      <span className="text-ink-3">{note}</span>
      <button type="button" aria-label={`Remove ${name}`} onClick={onRemove} className="text-ink-3 hover:text-danger">×</button>
    </span>
  );
}

function Assignee({ value, name, me, disabled, onChange }: { value: number | null; name: string | null; me: number; disabled: boolean; onChange: (v: number | '') => void }) {
  const directory = useQuery({ queryKey: ['chat', 'directory'], queryFn: ({ signal }) => apiGet<Directory>('/api/chat/directory', undefined, signal), staleTime: 5 * 60_000, enabled: !disabled });
  const users = directory.data?.users ?? [];
  return (
    <Select aria-label="Assignee" disabled={disabled} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')} className={aside}>
      <option value="">Nobody</option>
      <option value={me}>Me</option>
      {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      {value && value !== me && !users.some((u) => u.id === value) ? <option value={value}>{name ?? 'Someone'}</option> : null}
    </Select>
  );
}

function Organisation({ value, name, disabled, onChange }: { value: number | null; name: string | null; disabled: boolean; onChange: (v: number | '') => void }) {
  const orgs = useQuery({ queryKey: ['tasks', 'organizations'], queryFn: ({ signal }) => apiGet<{ organizations: Array<{ id: number; name: string }> }>('/api/tasks/organizations', undefined, signal), staleTime: 5 * 60_000, enabled: !disabled });
  const list = orgs.data?.organizations ?? [];
  return (
    <Select aria-label="Organisation" disabled={disabled} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')} className={aside}>
      <option value="">None</option>
      {list.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      {value && !list.some((o) => o.id === value) ? <option value={value}>{name ?? 'A company'}</option> : null}
    </Select>
  );
}

/** A day with an optional time; a change is saved when either is left. */
function When({ value, disabled, label, onChange }: { value: { date: string; time: string }; disabled: boolean; label: string; onChange: (v: string) => void }) {
  const [date, setDate] = useState(value.date);
  const [time, setTime] = useState(value.time);
  const commit = (d: string, tm: string) => {
    const next = when(d, tm) ?? '';
    if (next !== (when(value.date, value.time) ?? '')) onChange(next);
  };
  return (
    // Stacked: the side panel's value column is too narrow for a whole date beside a time.
    <span className="flex min-w-0 flex-col gap-1">
      <input type="date" aria-label={`${label} date`} disabled={disabled} value={date} onChange={(e) => (setDate(e.target.value), e.target.value === '' ? (setTime(''), commit('', '')) : undefined)} onBlur={() => commit(date, time)} className={aside} />
      {date ? <input type="time" aria-label={`${label} time`} disabled={disabled} value={time} onChange={(e) => setTime(e.target.value)} onBlur={() => commit(date, time)} className={aside} /> : null}
    </span>
  );
}

function Tags({ value, disabled, onChange }: { value: string[]; disabled: boolean; onChange: (v: string[]) => void }) {
  const [v, setV] = useState(value.join(', '));
  const commit = () => {
    const next = v.split(',').map((x) => x.trim()).filter(Boolean);
    if (next.join() !== value.join()) onChange(next);
  };
  return <input aria-label="Tags" disabled={disabled} value={v} placeholder={disabled ? '—' : 'design, urgent'} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} className={aside} />;
}

/** Progress: set by hand, unless there is a checklist, which then says how far along it is. */
function Progress({ task, editable, onSave }: { task: Detail; editable: boolean; onSave: (v: number) => void }) {
  const derived = task.checklist.length > 0;
  const shown = progressOf({ ...task, checklist_done: task.checklist.filter((i) => i.done).length, checklist_total: task.checklist.length });
  const [v, setV] = useState(shown);
  const [held, setHeld] = useState(false);
  const value = held ? v : shown;
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)_40px] items-center gap-2">
      <span className="font-semibold text-ink-3">Progress</span>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        disabled={!editable || derived || task.status === 'done'}
        title={derived ? 'Follows the checklist' : undefined}
        onChange={(e) => (setHeld(true), setV(Number(e.target.value)))}
        onPointerUp={() => {
          setHeld(false);
          if (v !== shown) onSave(v);
        }}
        onKeyUp={() => {
          setHeld(false);
          if (v !== shown) onSave(v);
        }}
        aria-label="Progress"
        className="accent-[var(--color-primary)]"
      />
      <b className="text-right text-ink">{value}%</b>
    </div>
  );
}
