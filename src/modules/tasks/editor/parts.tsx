import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { PickedFile } from '@shared/ipc/contract';
import { useCanOpen } from '../../../core/access';
import { app } from '../../../core/app-state';
import { apiDelete, apiGet, apiPost, apiPut } from '../../../core/api';
import { useStore } from '../../../core/store';
import { call, errorMessage, registerDropped } from '../../../core/bridge';
import { bytes, currentZone, relative } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { openDocument } from '../../../core/open-document';
import { DriveFilePicker, type DriveFileRow } from '../../../components/DriveFilePicker';
import { Icon } from '../../../components/Icon';
import { Avatar, Button, FileBadge, Modal, cx } from '../../../components/ui';
import { mediaUrl } from '../../chat/types';
import { EmojiPicker } from '../../chat/parts';
import { progressOf, type Activity, type Attachment, type TaskDetail as Detail } from '../api';
import { when, type Directory } from '../NewTask';
import type { usePeople } from '../People';
import { RichEditor, RichView } from '../RichText';
import { Select } from '../../../components/Select';
import { Checkbox } from '../../../components/Checkbox';

/**
 * The Tasks app's editor, in parts (Projects SRS v1.2 §14.2): the title, description, checklist, attachments and
 * conversation of the main column, and the side panel's fields. The Tasks app composes them in `TaskDetail`, the
 * Projects app in its task modal with the project's own fields beside them — one editor, two compositions.
 *
 * A part offers a change only when `editable`; when it is not, it still shows the value (read-only, never hidden,
 * PRJ-TED-08), and the reason the composition gives (`LockReason`, e.g. "Needs a connection") is its tooltip.
 */
export const LockReason = createContext<string | null>(null);

/** Why a control is read-only, for its tooltip: the composition's reason, else none. */
export function useLockReason(editable: boolean): string | undefined {
  const reason = useContext(LockReason);
  return editable ? undefined : (reason ?? undefined);
}

export const aside = 'h-8 w-full min-w-0 rounded-[7px] border border-line bg-surface px-1.5 text-[13px] text-ink outline-none focus:border-primary disabled:bg-transparent disabled:text-ink-2';

/** An instant, or a day, as the date and time inputs show it on your WorkSuite clock. */
export function inputsOf(day: string | null, at: string | null): { date: string; time: string } {
  if (at) {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: currentZone(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at));
    const g = (k: string) => p.find((x) => x.type === k)?.value ?? '00';
    return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` };
  }
  return { date: day ?? '', time: '' };
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] items-center gap-2">
      <span className="font-semibold text-ink-3">{label}</span>
      {children}
    </div>
  );
}

export function Title({ value, editable, onSave }: { value: string; editable: boolean; onSave: (v: string) => void }) {
  const reason = useLockReason(editable);
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
      title={reason}
      maxLength={255}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      className="bare-focus w-full rounded-[6px] bg-transparent px-0 text-[21px] font-bold text-ink outline-none focus:bg-subtle/60"
    />
  );
}

export function Description({ task, editable, onSave }: { task: Detail; editable: boolean; onSave: (html: string) => void }) {
  const reason = useLockReason(editable);
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
        <button type="button" disabled={!editable} title={reason} onClick={() => setEditing(true)} className="rounded-[9px] border border-dashed border-line px-3 py-2.5 text-left text-ink-3 enabled:hover:bg-subtle">
          {editable ? 'Add a description…' : 'No description.'}
        </button>
      )}
    </div>
  );
}

export function Checklist({ task, editable, onChanged }: { task: Detail; editable: boolean; onChanged: () => void }) {
  const reason = useLockReason(editable);
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
          <Checkbox checked={i.done} disabled={!editable} title={reason} onChange={() => act(() => apiPut(`/api/tasks/${task.id}/checklist/${i.id}`, { done: !i.done }))} aria-label={i.title} />
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
          className="h-8 rounded-[8px] border border-dashed border-primary-soft bg-transparent px-2.5 text-ink outline-none focus:border-solid focus:border-primary dark:border-line"
        />
      ) : reason ? (
        <span className="text-[12px] text-ink-3">{reason}</span>
      ) : null}
    </div>
  );
}

export function useAttachments(taskId: number) {
  return useQuery({ queryKey: ['tasks', 'attachments', taskId], queryFn: ({ signal }) => apiGet<{ attachments: Attachment[] }>(`/api/tasks/${taskId}/attachments`, undefined, signal) });
}

/** Uploads made from here, watched until they are in, then the list is read again. */
export function useUploads(taskId: number) {
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

export function Attachments({ task, editable }: { task: Detail; editable: boolean }) {
  const reason = useLockReason(editable);
  const qc = useQueryClient();
  const q = useAttachments(task.id);
  const uploads = useUploads(task.id);
  // "From Drive" browses Files: only for whoever has it.
  const files = useCanOpen('files');
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
        {reason ? <span className="text-[12px] text-ink-3">{reason}</span> : null}
        {editable ? (
          <>
            <button type="button" onClick={() => void pick()} className="font-semibold text-primary hover:underline">Attach files</button>
            {files ? <button type="button" onClick={() => setDrive(true)} className="font-semibold text-primary hover:underline">From Drive</button> : null}
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

export function AttachmentCard({ a, taskId, removable, onPreview, onRemoved }: { a: Attachment; taskId: number; removable: boolean; onPreview: (p: { name: string; src: string }) => void; onRemoved: () => void }) {
  // Downloaded and opened here: a PDF in PDF Studio, an Office file in Word, Excel or PowerPoint.
  const open = () => openDocument({ taskAttachment: { task: taskId, id: a.id } }, a.name);
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

/** How a comment is sent: the Tasks app posts it itself; a composition may send it another way (Projects' outbox). */
export type SendComment = (html: string) => Promise<{ commentId: number | null; queued: boolean }>;

/**
 * Comments and the activity, as tabs, and the box to write a comment. A composition may say who may comment
 * (`mayComment`), send the comment its own way (`send`, which may keep it for later: `queued`), and leave out files
 * (`attach: false`, e.g. while offline); without them it is the Tasks app's own.
 */
export function Conversation({ task, me, people, emoji, setEmoji, onChanged, send: sendVia, mayComment: may, attach = true }: { task: Detail; me: number; people: ReturnType<typeof usePeople>['data']; emoji: boolean; setEmoji: (v: boolean) => void; onChanged: () => void; send?: SendComment; mayComment?: boolean; attach?: boolean }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'comments' | 'activity'>('comments');
  const [draft, setDraft] = useState('');
  const [round, setRound] = useState(0);
  const [sending, setSending] = useState(false);
  const [disk, setDisk] = useState<PickedFile[]>([]);
  const [fromDrive, setFromDrive] = useState<DriveFileRow[]>([]);
  const [drive, setDrive] = useState(false);
  const files = useCanOpen('files');
  const uploads = useUploads(task.id);
  const attachments = useAttachments(task.id);
  const directory = useQuery({ queryKey: ['chat', 'directory'], queryFn: ({ signal }) => apiGet<Directory>('/api/chat/directory', undefined, signal), staleTime: 5 * 60_000 });
  const activity = useQuery({ queryKey: ['tasks', 'activity', task.id], queryFn: ({ signal }) => apiGet<Activity[]>(`/api/tasks/${task.id}/activity`, undefined, signal), enabled: tab === 'activity' });
  const mine = people?.people.find((p) => p.user_id === me);
  const mayComment = may ?? (task.owner_id === me || task.assignee_id === me || (!!mine && ['comment', 'edit', 'manage'].includes(mine.permission)));
  const roleOf = (uid: number) => (uid === task.owner_id ? 'owner' : people?.people.find((p) => p.user_id === uid)?.role);
  const byComment = new Map<number, Attachment[]>();
  for (const a of attachments.data?.attachments ?? []) if (a.comment_id) byComment.set(a.comment_id, [...(byComment.get(a.comment_id) ?? []), a]);

  const send = async () => {
    if (sending || (!draft.replace(/<[^>]+>/g, '').trim() && !disk.length && !fromDrive.length)) return;
    setSending(true);
    try {
      const body = draft || '<p>📎</p>';
      const r = sendVia ? await sendVia(body) : { commentId: (await apiPost<{ comment_id: number }>(`/api/tasks/${task.id}/comments`, { body })).comment_id, queued: false };
      if (r.commentId && disk.length) await uploads.send(disk, r.commentId);
      if (r.commentId && fromDrive.length) await apiPost(`/api/tasks/${task.id}/attachments/drive`, { file_ids: fromDrive.map((f) => Number(f.id)), comment_id: r.commentId });
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
                    {attach ? <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void call('files:pickFiles', { multiple: true, title: 'Attach to the comment' }).then((f) => setDisk((d) => [...d, ...f]), (e) => toast('error', errorMessage(e)))} className="rounded-[5px] px-[7px] py-[3px] hover:bg-subtle hover:text-ink">Attach a file</button> : null}
                    {files && attach ? <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setDrive(true)} className="rounded-[5px] px-[7px] py-[3px] hover:bg-subtle hover:text-ink">Choose from Drive</button> : null}
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

export function Chip({ name, note, onRemove }: { name: string; note: string; onRemove: () => void }) {
  return (
    <span className="flex items-center gap-1.5 rounded-[8px] border border-line px-2 py-1 text-[12px]">
      <b className="max-w-[160px] truncate text-ink">{name}</b>
      <span className="text-ink-3">{note}</span>
      <button type="button" aria-label={`Remove ${name}`} onClick={onRemove} className="text-ink-3 hover:text-danger">×</button>
    </span>
  );
}

export function Assignee({ value, name, me, disabled, onChange }: { value: number | null; name: string | null; me: number; disabled: boolean; onChange: (v: number | '') => void }) {
  const reason = useLockReason(!disabled);
  const directory = useQuery({ queryKey: ['chat', 'directory'], queryFn: ({ signal }) => apiGet<Directory>('/api/chat/directory', undefined, signal), staleTime: 5 * 60_000, enabled: !disabled });
  const users = directory.data?.users ?? [];
  return (
    <Select aria-label="Assignee" disabled={disabled} title={reason} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')} className={aside}>
      <option value="">Nobody</option>
      <option value={me}>Me</option>
      {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      {value && value !== me && !users.some((u) => u.id === value) ? <option value={value}>{name ?? 'Someone'}</option> : null}
    </Select>
  );
}

export function Organisation({ value, name, disabled, onChange }: { value: number | null; name: string | null; disabled: boolean; onChange: (v: number | '') => void }) {
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
export function When({ value, disabled, label, onChange }: { value: { date: string; time: string }; disabled: boolean; label: string; onChange: (v: string) => void }) {
  const reason = useLockReason(!disabled);
  const [date, setDate] = useState(value.date);
  const [time, setTime] = useState(value.time);
  const commit = (d: string, tm: string) => {
    const next = when(d, tm) ?? '';
    if (next !== (when(value.date, value.time) ?? '')) onChange(next);
  };
  return (
    // Stacked: the side panel's value column is too narrow for a whole date beside a time.
    <span className="flex min-w-0 flex-col gap-1">
      <input type="date" aria-label={`${label} date`} disabled={disabled} title={reason} value={date} onChange={(e) => (setDate(e.target.value), e.target.value === '' ? (setTime(''), commit('', '')) : undefined)} onBlur={() => commit(date, time)} className={aside} />
      {date ? <input type="time" aria-label={`${label} time`} disabled={disabled} title={reason} value={time} onChange={(e) => setTime(e.target.value)} onBlur={() => commit(date, time)} className={aside} /> : null}
    </span>
  );
}

export function Tags({ value, disabled, onChange }: { value: string[]; disabled: boolean; onChange: (v: string[]) => void }) {
  const reason = useLockReason(!disabled);
  const [v, setV] = useState(value.join(', '));
  const commit = () => {
    const next = v.split(',').map((x) => x.trim()).filter(Boolean);
    if (next.join() !== value.join()) onChange(next);
  };
  return <input aria-label="Tags" disabled={disabled} title={reason} value={v} placeholder={disabled ? '—' : 'design, urgent'} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} className={aside} />;
}

/** Progress: set by hand, unless there is a checklist, which then says how far along it is. */
export function Progress({ task, editable, onSave }: { task: Detail; editable: boolean; onSave: (v: number) => void }) {
  const reason = useLockReason(editable);
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
        title={derived ? 'Follows the checklist' : reason}
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
