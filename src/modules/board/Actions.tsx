import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { CheckboxMark } from '../../components/Checkbox';
import { Button, Spinner, cx } from '../../components/ui';
import { fetchActions, fmtDate, groupActions, K, titleCase, updateAction, type Action } from './api';
import { Muted, Panel, Status } from './parts';

const GROUPS: Array<['overdue' | 'week' | 'later' | 'verify', string]> = [['overdue', 'Overdue'], ['week', 'This week'], ['later', 'Later'], ['verify', 'Done — awaiting verification']];

/** D-09 My actions (FR-ACT-02..04): from board decisions, done in WorkSuite Tasks; the secretary verifies. */
export default function Actions({ onWeb }: { onWeb: (path: string) => void }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: K.actions, queryFn: ({ signal }) => fetchActions(signal) });
  const [selId, setSelId] = useState<number | null>(null);
  const g = groupActions(list.data ?? []);
  const all = [...g.overdue, ...g.week, ...g.later, ...g.verify];
  const sel: Action | null = all.find((a) => a.id === selId) ?? all[0] ?? null;
  const step = useMutation({
    mutationFn: (s: 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED') => updateAction(sel!.id, s),
    onSuccess: () => void qc.invalidateQueries({ queryKey: K.actions }),
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
                      <CheckboxMark checked={a.status === 'COMPLETED'} />
                      <div className="min-w-0 flex-1"><div className="text-[13px] font-bold">{a.title}</div><div className="text-[11.5px] text-ink-3">{[a.meeting_number, a.decision_extract?.resolution_number, titleCase(a.status)].filter(Boolean).join(' · ')}</div></div>
                      {k === 'verify' ? <Status tone="indigo">Secretary to verify</Status> : <Status tone={k === 'overdue' ? 'danger' : k === 'week' ? 'warning' : 'muted'}>{a.due_on ? fmtDate(a.due_on) : 'No date'}</Status>}
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
              <div><div className="text-[11px] text-ink-3">From decision</div>{sel.decision_extract ? [sel.decision_extract.resolution_number, sel.decision_extract.title].filter(Boolean).join(' ') : (sel.meeting_number ?? '—')}</div>
              {sel.decision_extract?.text ? <p className="rounded-[8px] bg-subtle p-2 font-serif">{sel.decision_extract.text}</p> : null}
              {sel.description ? <p>{sel.description}</p> : null}
              <div><div className="text-[11px] text-ink-3">Due</div>{sel.due_on ? fmtDate(sel.due_on) : '—'} · {titleCase(sel.status)}</div>
              {sel.status !== 'COMPLETED' ? (
                <div className="flex gap-1.5">
                  <Button size="sm" disabled={sel.status === 'IN_PROGRESS'} onClick={() => step.mutate('IN_PROGRESS')}>In progress</Button>
                  <Button size="sm" disabled={sel.status === 'BLOCKED'} onClick={() => step.mutate('BLOCKED')}>Blocked</Button>
                  <Button size="sm" variant="primary" onClick={() => step.mutate('COMPLETED')}>Mark complete</Button>
                </div>
              ) : null}
              <Muted>The secretary verifies completed actions before they close.</Muted>
            </div>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}
