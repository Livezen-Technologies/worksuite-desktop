import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { Button, Modal } from '../../components/ui';
import { createTask } from './actions';
import { PRIORITIES, STATUSES, type Priority, type Status, type TaskList } from './api';
import { RichEditor } from './RichText';

export interface Directory {
  users: Array<{ id: number; name: string; email?: string | null }>;
}

const field = 'h-[34px] w-full rounded-[8px] border border-line bg-surface px-2 text-[13px] font-normal text-ink outline-none focus:border-primary';
const label = 'flex min-w-0 flex-col gap-1 text-[12.5px] font-semibold text-ink';

/** A day, or a day and a time: the server reads a time without a zone on your WorkSuite clock. */
export function when(day: string, time: string): string | null {
  if (!day) return null;
  return time ? `${day}T${time}` : day;
}

/** New task (TaskNew). It starts in the list and state the page was showing. */
export function NewTask({ lists, defaults, onClose, onCreated }: { lists: TaskList[]; defaults: { list_id?: number | null; status?: Status; due?: string }; onClose: () => void; onCreated: (id: number | null) => void }) {
  const directory = useQuery({ queryKey: ['chat', 'directory'], queryFn: ({ signal }) => apiGet<Directory>('/api/chat/directory', undefined, signal), staleTime: 5 * 60_000 });
  const orgs = useQuery({ queryKey: ['tasks', 'organizations'], queryFn: ({ signal }) => apiGet<{ organizations: Array<{ id: number; name: string }> }>('/api/tasks/organizations', undefined, signal), staleTime: 5 * 60_000 });
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [list, setList] = useState(defaults.list_id ? String(defaults.list_id) : '');
  const [status, setStatus] = useState<Status>(defaults.status ?? 'todo');
  const [priority, setPriority] = useState<Priority>('medium');
  const [assignee, setAssignee] = useState('');
  const [start, setStart] = useState('');
  const [startTime, setStartTime] = useState('');
  const [due, setDue] = useState(defaults.due ?? '');
  const [dueTime, setDueTime] = useState('');
  const [hours, setHours] = useState('');
  const [org, setOrg] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backwards = !!start && !!due && (when(due, dueTime) ?? '') < (when(start, startTime) ?? '');

  const save = async () => {
    if (!title.trim() || backwards) return;
    setBusy(true);
    setError(null);
    try {
      const r = await createTask({
        title: title.trim(),
        description,
        status,
        priority,
        ...(list ? { list_id: Number(list) } : {}),
        ...(assignee ? { assignee_id: Number(assignee) } : {}),
        ...(start ? { start_date: when(start, startTime) } : {}),
        ...(due ? { due_date: when(due, dueTime) } : {}),
        ...(hours ? { estimated_hours: Number(hours) } : {}),
        ...(org ? { org_id: Number(org) } : {}),
        ...(tags.trim() ? { tags: tags.split(',').map((t) => t.trim()).filter(Boolean) } : {}),
      });
      onCreated(r.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New task"
      onClose={onClose}
      width={640}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!title.trim() || backwards} onClick={() => void save()}>Create task</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px]">
        <label className={label}>
          Title
          <input autoFocus value={title} maxLength={255} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && void save()} placeholder="Give the task a title" className={`${field} h-9 font-medium`} />
        </label>
        <div className={label}>
          Description
          <RichEditor initial="" taskId={0} label="Task description" placeholder="What needs doing?" onChange={setDescription} minHeight={64} />
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          <label className={label}>
            List
            <select value={list} onChange={(e) => setList(e.target.value)} className={field}>
              <option value="">No list</option>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <label className={label}>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value as Status)} className={field}>
              {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label className={label}>
            Priority
            <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className={field}>
              {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <label className={label}>
            Assignee
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={field}>
              <option value="">Me</option>
              {(directory.data?.users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          <label className={label}>
            Start date
            <span className="flex gap-1">
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={field} aria-label="Start date" />
              {start ? <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={`${field} w-[92px] shrink-0`} aria-label="Start time" /> : null}
            </span>
          </label>
          <label className={label}>
            Due date
            <span className="flex gap-1">
              <input type="date" value={due} min={start || undefined} onChange={(e) => setDue(e.target.value)} className={field} aria-label="Due date" />
              {due ? <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className={`${field} w-[92px] shrink-0`} aria-label="Due time" /> : null}
            </span>
          </label>
          <label className={label}>
            Estimated hours
            <input type="number" min={0} step={0.25} value={hours} onChange={(e) => setHours(e.target.value)} placeholder="—" className={field} />
          </label>
          <label className={`${label} col-span-2`}>
            Company
            <select value={org} onChange={(e) => setOrg(e.target.value)} className={field}>
              <option value="">None</option>
              {(orgs.data?.organizations ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
        </div>
        <label className={label}>
          Tags
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="design, urgent" className={field} />
        </label>
        {backwards ? <span className="text-[12px] font-semibold text-danger">The due date is before the start.</span> : null}
        {error ? <span role="alert" className="rounded-[8px] bg-danger-bg px-3 py-2 text-danger">{error}</span> : null}
      </div>
    </Modal>
  );
}
