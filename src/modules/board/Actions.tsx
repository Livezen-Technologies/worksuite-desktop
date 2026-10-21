import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { CheckboxMark } from '../../components/Checkbox';
import { Button, Spinner, cx } from '../../components/ui';
import { fetchActions, fmtDate, groupActions, K, updateAction, type BoardAction } from './api';
import { Muted, Panel, Status } from './parts';

const GROUPS: Array<['overdue' | 'week' | 'later' | 'verify', string]> = [['overdue', 'Overdue'], ['week', 'This week'], ['later', 'Later'], ['verify', 'Done — awaiting verification']];

/** D-09 My actions (FR-ACT-02..04): from board decisions, done in WorkSuite Tasks; the secretary verifies. */
export default function Actions({ onWeb }: { onWeb: (path: string) => void }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: K.actions, queryFn: ({ signal }) => fetchActions(signal) });
  const [selId, setSelId] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const g = groupActions(list.data ?? []);
  const all = [...g.overdue, ...g.week, ...g.later, ...g.verify];
  const sel: BoardAction | null = all.find((a) => a.id === selId) ?? all[0] ?? null;
  const step = useMutation({
    mutationFn: (s: 'in_progress' | 'blocked' | 'done') => {
      if (s === 'blocked' && !note.trim()) throw new Error('Say what is blocking it in the progress note.');
      return updateAction(sel!.id, s, note);
    },
    onSuccess: () => { setNote(''); void qc.invalidateQueries({ queryKey: K.actions }); },
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <div className="flex h-full flex-col p-5">
      <div className="mb-3 flex items-start justify-between">
        <div><h1 className="text-[18px] font-bold">My actions</h1><Muted>From board decisions · done in WorkSuite Tasks</Muted></div>
        <Button size="sm" onClick={() => onWeb('/tasks')}>Open in Tasks</Button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_340px] gap-3">
        <Panel title="Actions">
          {list.isPending ? <Spinner /> : null}
          {GROUPS.map(([k, label]) => g[k].length ? (
            <section key={k} aria-label={label}>
              <h3 className="mt-2 mb-1 text-[11px] font-bold tracking-[.5px] text-ink-3 uppercase">{label}</h3>
              <ul>
                {g[k].map((a) => (
                  <li key={a.id}>
                    <button type="button" onClick={() => setSelId(a.id)} className={cx('flex w-full items-center gap-2.5 rounded-[8px] border border-line p-2.5 text-left mb-1.5', sel?.id === a.id ? 'bg-[#EEF1FD] dark:bg-selection' : 'bg-surface')}>
                      <CheckboxMark checked={a.status === 'done'} />
                      <div className="min-w-0 flex-1"><div className="text-[13px] font-bold">{a.title}</div><div className="text-[11.5px] text-ink-3">{[a.source, a.task_ref].filter(Boolean).join(' · ')}</div></div>
                      {k === 'verify' ? <Status tone="indigo">Secretary to verify</Status> : <Status tone={k === 'overdue' ? 'danger' : k === 'week' ? 'warning' : 'muted'}>{fmtDate(a.due)}</Status>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null)}
          {!all.length && !list.isPending ? <Muted>No open actions.</Muted> : null}
        </Panel>
        <Panel title={sel ? sel.title : 'Choose an action'}>
          {sel ? (
            <div className="space-y-2 text-[12.5px]">
              {g.overdue.includes(sel) ? <Status tone="danger">Overdue</Status> : null}
              <div><div className="text-[11px] text-ink-3">From decision</div>{sel.source ?? '—'}</div>
              <div><div className="text-[11px] text-ink-3">Due</div>{fmtDate(sel.due)}{sel.assigned_by ? ` · assigned by ${sel.assigned_by}` : ''}</div>
              {sel.status !== 'done' ? (
                <>
                  <textarea aria-label="Progress note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a progress note" className="h-[70px] w-full rounded-[8px] border border-line bg-surface p-2" />
                  <div className="flex gap-1.5">
                    <Button size="sm" onClick={() => step.mutate('in_progress')}>In progress</Button>
                    <Button size="sm" onClick={() => step.mutate('blocked')}>Blocked…</Button>
                    <Button size="sm" variant="primary" onClick={() => step.mutate('done')}>Mark complete</Button>
                  </div>
                </>
              ) : null}
              <Muted>The secretary verifies completed actions before they close.</Muted>
            </div>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}
