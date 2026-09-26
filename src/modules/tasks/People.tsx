import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiDelete, apiGet, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Avatar, Button, Modal, cx } from '../../components/ui';
import type { People, Person, Role, TaskDetail } from './api';
import type { Directory } from './NewTask';
import { Select } from '../../components/Select';

const ROLES: Array<{ id: Role; label: string; many: string }> = [
  { id: 'assignee', label: 'Assignee', many: 'Assignees' },
  { id: 'reviewer', label: 'Reviewer', many: 'Reviewers' },
  { id: 'follower', label: 'Follower', many: 'Followers' },
  { id: 'shared', label: 'Shared with', many: 'Shared with' },
];
const PERMISSION: Record<string, string> = { view: 'View — read the task, comments and files', comment: 'Comment — and add comments', edit: 'Edit — and change the task', manage: 'Manage — and change who is on it' };

export function usePeople(taskId: number) {
  return useQuery({ queryKey: ['tasks', 'people', taskId], queryFn: ({ signal }) => apiGet<People>(`/api/tasks/${taskId}/people`, undefined, signal) });
}

/** Who is on the task, by role, with Manage for whoever may change it and Follow for everybody. */
export function PeoplePanel({ task, me, people, refresh }: { task: TaskDetail; me: number; people: People | undefined; refresh: () => void }) {
  const [managing, setManaging] = useState(false);
  const list = people?.people ?? [];
  const follow = async (on: boolean) => {
    try {
      if (on) await apiPost(`/api/tasks/${task.id}/people`, { role: 'follower' });
      else await apiDelete(`/api/tasks/${task.id}/people/${me}?role=follower`);
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const shared = list.filter((p) => p.role === 'shared');
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-2.5">
      <div className="flex items-center">
        <b className="flex-1 text-ink">People</b>
        {people?.can_manage ? <button type="button" onClick={() => setManaging(true)} className="font-semibold text-primary hover:underline">Manage</button> : null}
      </div>
      {ROLES.filter((r) => r.id !== 'shared').map((r) => {
        const who = list.filter((p) => p.role === r.id);
        const names = r.id === 'assignee' && !who.length && task.assignee_name ? [{ key: 'primary', name: task.assignee_id === me ? 'You' : task.assignee_name }] : who.map((p) => ({ key: String(p.id), name: p.user_id === me ? 'You' : p.name }));
        return (
          <div key={r.id} className="flex items-start gap-2">
            <span className="w-[86px] shrink-0 pt-[3px] text-[12px] text-ink-3">{r.many}</span>
            <span className="flex flex-wrap gap-1">
              {names.length ? names.map((n) => <span key={n.key} className="rounded-full bg-selection px-2 py-[2px] text-[11.5px] font-semibold text-primary">{n.name}</span>) : <span className="pt-[3px] text-[12px] text-ink-3">—</span>}
            </span>
          </div>
        );
      })}
      {shared.length ? <span className="text-[11.5px] text-ink-3">Shared with: {shared.map((p) => `${p.name} (${PERMISSION[p.permission]?.split(' —')[0] ?? p.permission})`).join(', ')}</span> : null}
      {people ? (
        <button type="button" onClick={() => void follow(!people.following)} className="h-8 rounded-[8px] border border-line bg-surface font-semibold text-ink hover:bg-subtle">
          {people.following ? 'Following · unfollow' : 'Follow'}
        </button>
      ) : null}
      {managing && people ? <ManagePeople taskId={task.id} me={me} people={people.people} onClose={() => setManaging(false)} onChanged={refresh} /> : null}
    </div>
  );
}

function ManagePeople({ taskId, me, people, onClose, onChanged }: { taskId: number; me: number; people: Person[]; onClose: () => void; onChanged: () => void }) {
  const directory = useQuery({ queryKey: ['chat', 'directory'], queryFn: ({ signal }) => apiGet<Directory>('/api/chat/directory', undefined, signal), staleTime: 5 * 60_000 });
  const [who, setWho] = useState('');
  const [role, setRole] = useState<Role>('reviewer');
  const [permission, setPermission] = useState('view');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!who) return;
    setBusy(true);
    try {
      await apiPost(`/api/tasks/${taskId}/people`, { user_id: Number(who), role, ...(role === 'shared' ? { permission } : {}) });
      setWho('');
      onChanged();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (p: Person) => {
    try {
      await apiDelete(`/api/tasks/${taskId}/people/${p.user_id}?role=${p.role}`);
      onChanged();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const choices = [{ id: me, name: 'Me' }, ...(directory.data?.users ?? [])];
  return (
    <Modal title="People on this task" onClose={onClose} width={520} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <div className="flex flex-col gap-3 text-[13px]">
        {ROLES.map((r) => {
          const on = people.filter((p) => p.role === r.id);
          return on.length ? (
            <div key={r.id} className="flex flex-col gap-1">
              <b className="text-[11px] tracking-[0.5px] text-ink-3">{r.many.toUpperCase()}</b>
              {on.map((p) => (
                <div key={p.id} className="flex items-center gap-2">
                  <Avatar name={p.name} size={24} />
                  <span className="min-w-0 flex-1 truncate text-ink">
                    {p.user_id === me ? 'You' : p.name}
                    {p.is_primary ? <span className="text-ink-3"> · primary</span> : null}
                    {r.id === 'shared' ? <span className="text-ink-3"> · {PERMISSION[p.permission]?.split(' —')[0] ?? p.permission}</span> : null}
                  </span>
                  <button type="button" aria-label={`Remove ${p.name} as ${r.label.toLowerCase()}`} onClick={() => void remove(p)} className="px-1 text-ink-3 hover:text-danger">×</button>
                </div>
              ))}
            </div>
          ) : null;
        })}
        <div className="flex flex-col gap-2 rounded-[10px] bg-subtle p-2.5">
          <b className="text-ink">Add somebody</b>
          <div className="flex gap-2">
            <Select aria-label="Person" value={who} onChange={(e) => setWho(e.target.value)} className="h-8 min-w-0 flex-1 rounded-[7px] border border-line bg-surface px-1.5 text-ink">
              <option value="">Choose a person…</option>
              {choices.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
            <Select aria-label="As" value={role} onChange={(e) => setRole(e.target.value as Role)} className="h-8 rounded-[7px] border border-line bg-surface px-1.5 text-ink">
              {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </Select>
          </div>
          {role === 'shared' ? (
            <Select aria-label="They may" value={permission} onChange={(e) => setPermission(e.target.value)} className="h-8 rounded-[7px] border border-line bg-surface px-1.5 text-ink">
              {['view', 'comment', 'edit'].map((p) => <option key={p} value={p}>{PERMISSION[p]}</option>)}
            </Select>
          ) : null}
          <Button variant="primary" size="sm" className="self-end" loading={busy} disabled={!who} onClick={() => void add()}>Add</Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * The review: whoever does the work sends it for review; a reviewer approves
 * it (it is done) or sends it back with what needs changing.
 */
export function ReviewPanel({ task, me, people, refresh }: { task: TaskDetail; me: number; people: People | undefined; refresh: () => void }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<'submit' | 'approve' | 'changes' | null>(null);
  const [busy, setBusy] = useState(false);
  const list = people?.people ?? [];
  const reviewers = list.filter((p) => p.role === 'reviewer');
  const mine = list.find((p) => p.user_id === me);
  const iReview = reviewers.some((p) => p.user_id === me) || !!people?.can_manage;
  const iWork = task.owner_id === me || task.assignee_id === me || (mine ? ['edit', 'manage'].includes(mine.permission) : false);
  const act = async (path: string, body: Record<string, unknown>, done: string) => {
    setBusy(true);
    try {
      await apiPost(`/api/tasks/${task.id}/${path}`, body);
      toast('success', done);
      setMode(null);
      setNote('');
      refresh();
      void qc.invalidateQueries({ queryKey: ['tasks'] });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (task.status === 'done' || task.status === 'cancelled') return null;
  const inReview = task.status === 'review';
  if (!inReview && !iWork) return null;
  return (
    <div className={cx('flex flex-col gap-2 rounded-[10px] border px-3 py-2.5', inReview ? 'border-[#C9B8EE] bg-[#F4EFFC] dark:border-line dark:bg-subtle' : 'border-line bg-surface')}>
      <b className="text-ink">{inReview ? (iReview ? 'Waiting for your review' : 'Sent for review') : task.status === 'changes_requested' ? 'Changes were requested' : 'Review'}</b>
      <span className="text-[12px] text-ink-2">
        {reviewers.length ? `Reviewer${reviewers.length === 1 ? '' : 's'}: ${reviewers.map((r) => (r.user_id === me ? 'you' : r.name)).join(', ')}` : 'No reviewer yet — add one under People.'}
      </span>
      {mode ? (
        <>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} aria-label={mode === 'changes' ? 'What needs changing' : 'A note'} placeholder={mode === 'changes' ? 'What needs changing? (needed)' : mode === 'approve' ? 'A comment for them (optional)' : 'A note for the reviewer (optional)'} className="rounded-[8px] border border-line bg-surface p-2 text-[12.5px] text-ink outline-none focus:border-primary" />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" onClick={() => setMode(null)}>Cancel</Button>
            {mode === 'submit' ? <Button size="sm" variant="primary" loading={busy} onClick={() => void act('submit-review', note.trim() ? { note: note.trim() } : {}, 'Sent for review.')}>Send for review</Button> : null}
            {mode === 'approve' ? <Button size="sm" variant="primary" loading={busy} onClick={() => void act('approve', note.trim() ? { comment: note.trim() } : {}, 'Approved — the task is done.')}>Approve</Button> : null}
            {mode === 'changes' ? <Button size="sm" variant="danger" loading={busy} disabled={!note.trim()} onClick={() => void act('request-changes', { feedback: note.trim() }, 'Sent back with your changes.')}>Request changes</Button> : null}
          </div>
        </>
      ) : inReview ? (
        iReview ? (
          <div className="flex gap-1.5">
            <button type="button" onClick={() => setMode('approve')} className="h-8 flex-1 rounded-[8px] bg-success font-bold text-white hover:opacity-90">Approve</button>
            <button type="button" onClick={() => setMode('changes')} className="h-8 flex-1 rounded-[8px] border border-line bg-surface font-semibold text-ink hover:bg-subtle">Request changes</button>
          </div>
        ) : null
      ) : (
        <Button size="sm" disabled={!reviewers.length} onClick={() => setMode('submit')}>{task.status === 'changes_requested' ? 'Send for review again' : 'Submit for review'}</Button>
      )}
    </div>
  );
}
