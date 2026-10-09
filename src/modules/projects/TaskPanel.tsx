import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { TASK_STATUS_LABEL, clockOf, hhmm, type ProjectsOutboxItem } from '@shared/projects';
import { call, errorMessage } from '../../core/bridge';
import { sanitizeHtml } from '../../core/rich';
import { relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { useNow } from '../../core/use-now';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Button, ErrorNote, IconButton, Spinner, cx, initials } from '../../components/ui';
import { qk, read, type Task, type TaskStatus } from './api';
import { elapsedOf, setTimerState, submit, useProjectTimer } from './desk';
import { BOARD_COLUMNS, dueOf, isBlocked } from './logic';
import { Ref, StatusChip, openWeb } from './parts';

/**
 * A task, open over its board or My work (D01's Enter): what it is, where it stands, its notes and time; move it,
 * add a note, start the timer or log time — the first three kept in the outbox while WorkSuite is out of reach.
 */
export function TaskPanel({ id, today, offline, outbox, onClose, onLogTime, onMoved }: {
  id: number;
  today: string;
  offline: boolean;
  outbox: ProjectsOutboxItem[];
  onClose: () => void;
  onLogTime: (t: Task) => void;
  onMoved: () => void;
}) {
  const q = useQuery({ queryKey: qk.task(id), queryFn: ({ signal }) => read.task(id, { signal }) });
  const timer = useProjectTimer();
  const now = useNow(1000).getTime();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const d = q.data?.data;
  const t = d?.task;
  const waiting = outbox.filter((i) => i.taskId === id && i.state !== 'refused');
  const mine = timer.running?.taskId === id;

  const move = async (status: TaskStatus) => {
    if (!t || status === t.status) return;
    try {
      const r = await submit({ kind: 'move', taskId: t.id, status, baseUpdatedAt: t.updated_at, label: `Move ${t.task_number ?? t.title} to ${TASK_STATUS_LABEL[status]}` });
      if (r.error && !r.queued) throw new Error(r.error);
      if (r.queued) toast('info', 'Offline — the move is kept and sent when you reconnect.');
      onMoved();
      void q.refetch();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const comment = async () => {
    if (!t || !note.trim()) return;
    setBusy(true);
    try {
      const r = await submit({ kind: 'comment', taskId: t.id, body: note.trim(), label: `Comment on ${t.task_number ?? t.title}` });
      if (r.error && !r.queued) throw new Error(r.error);
      setNote('');
      if (r.queued) toast('info', 'Offline — the note is kept and sent when you reconnect.');
      void q.refetch();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const timerToggle = async () => {
    if (!t) return;
    try {
      setTimerState(mine ? await call('projects:timerStop', {}) : await call('projects:timerStart', { taskId: t.id, projectId: t.project_id ?? null }));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  return (
    <aside aria-label="Task" className="flex w-[400px] shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <Ref>{t?.task_number ?? `#${id}`}</Ref>
        {t ? <StatusChip status={t.status} /> : null}
        <span className="flex-1" />
        {t?.project_id ? <IconButton icon="external" label="Open on the web" onClick={() => openWeb(`/projects/${t.project_id}/tasks/${t.id}`)} /> : null}
        <IconButton icon="x" label="Close (Esc)" onClick={onClose} />
      </div>
      {q.isLoading ? <Spinner /> : null}
      {q.error && !d ? (
        <div className="p-4">
          <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
        </div>
      ) : null}
      {t ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-4 py-3.5 text-[13px] scroll-thin">
          <h2 className="text-[17px] leading-snug font-bold text-ink">{t.title}</h2>
          {isBlocked(t) ? (
            <div className="rounded-[8px] bg-danger-bg px-2.5 py-1.5 text-[12.5px] text-danger">
              <b>Blocked</b>
              {t.blocked_reason ? ` — ${t.blocked_reason}` : ''}
            </div>
          ) : null}
          {waiting.length ? (
            <div className="rounded-[8px] border border-dashed border-warning bg-warning-bg px-2.5 py-1.5 text-[12px] text-warning-ink">
              {waiting.map((w) => (
                <div key={w.id}>{w.state === 'conflict' ? `Needs your choice: ${w.label}` : `Waiting to send: ${w.label}`}</div>
              ))}
            </div>
          ) : null}
          <div className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5">
            <span className="text-ink-3">Status</span>
            <Select aria-label="Status" value={BOARD_COLUMNS.includes(t.status) || t.status === 'backlog' ? t.status : 'in_progress'} onChange={(e) => void move(e.target.value as TaskStatus)} className="h-7 rounded-[7px] border border-line bg-surface px-2 text-[12.5px] text-ink">
              {(['backlog', ...BOARD_COLUMNS] as TaskStatus[]).map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
            <span className="text-ink-3">Project</span>
            <span className="truncate text-ink">{[t.project_code, t.project].filter(Boolean).join(' · ') || '—'}</span>
            <span className="text-ink-3">Assignee</span>
            <span className="flex items-center gap-1.5 text-ink">
              {t.assignee ? <span className="flex h-5 w-5 items-center justify-center rounded-full bg-selection text-[9px] font-bold text-primary">{initials(t.assignee)}</span> : null}
              {t.assignee ?? 'Nobody yet'}
            </span>
            {t.reviewer ? (
              <>
                <span className="text-ink-3">Reviewer</span>
                <span className="text-ink">{t.reviewer}</span>
              </>
            ) : null}
            <span className="text-ink-3">Due</span>
            <span className={cx(dueOf(t, today).late ? 'font-bold text-danger' : 'text-ink')}>{t.due_date ? `${t.due_date}${dueOf(t, today).late ? ` · ${dueOf(t, today).label}` : ''}` : '—'}</span>
            <span className="text-ink-3">Time</span>
            <span className="text-ink">
              {hhmm(t.logged_minutes ?? 0)} logged{t.estimated_hours ? ` of ${t.estimated_hours} h` : ''}
            </span>
            {t.sprint ? (
              <>
                <span className="text-ink-3">Sprint</span>
                <span className="text-ink">{t.sprint}</span>
              </>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant={mine ? 'danger' : 'primary'} size="sm" icon={mine ? 'stop' : 'play'} disabled={!mine && offline} title={!mine && offline ? 'Starting a timer needs a connection' : 'T'} onClick={() => void timerToggle()}>
              {mine && timer.running ? `Stop ${clockOf(elapsedOf(timer.running.startedAt, now))}` : 'Start timer'}
            </Button>
            <Button size="sm" icon="clock" title="L" onClick={() => onLogTime(t)}>
              Log time
            </Button>
          </div>
          {t.description ? (
            <section>
              <h3 className="mb-1 text-[11px] font-bold tracking-[0.5px] text-ink-3">DESCRIPTION</h3>
              <div className="selectable leading-[1.6] break-words text-ink [&_a]:text-primary [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5" dangerouslySetInnerHTML={{ __html: sanitizeHtml(t.description, { profile: 'strict' }) }} />
            </section>
          ) : null}
          {d?.checklist?.length ? (
            <section>
              <h3 className="mb-1 text-[11px] font-bold tracking-[0.5px] text-ink-3">CHECKLIST · {d.checklist.filter((c) => c.done).length}/{d.checklist.length}</h3>
              {d.checklist.map((c) => (
                <div key={c.id} className="flex items-center gap-2 py-0.5">
                  <Icon name={c.done ? 'check-circle' : 'circle-dot'} size={13} className={c.done ? 'text-success' : 'text-ink-3'} />
                  <span className={cx(c.done ? 'text-ink-3 line-through' : 'text-ink')}>{c.title}</span>
                </div>
              ))}
            </section>
          ) : null}
          {d?.dependencies && (d.dependencies.waits_on.length || d.dependencies.blocks.length) ? (
            <section>
              <h3 className="mb-1 text-[11px] font-bold tracking-[0.5px] text-ink-3">DEPENDENCIES</h3>
              {d.dependencies.waits_on.map((x) => (
                <div key={`w${x.task_id}`} className="flex items-center gap-2 py-0.5">
                  <span className="text-ink-3">Waits on</span> <Ref>{x.task_number}</Ref> <span className="truncate">{x.title}</span> <StatusChip status={x.status} />
                </div>
              ))}
              {d.dependencies.blocks.map((x) => (
                <div key={`b${x.task_id}`} className="flex items-center gap-2 py-0.5">
                  <span className="text-ink-3">Blocks</span> <Ref>{x.task_number}</Ref> <span className="truncate">{x.title}</span> <StatusChip status={x.status} />
                </div>
              ))}
            </section>
          ) : null}
          <section>
            <h3 className="mb-1.5 text-[11px] font-bold tracking-[0.5px] text-ink-3">NOTES · {d?.comments?.length ?? 0}</h3>
            <div className="flex flex-col gap-2">
              {(d?.comments ?? []).map((c) => (
                <div key={c.id} className="rounded-[8px] bg-ground px-2.5 py-2">
                  <div className="mb-0.5 flex items-center gap-2 text-[11.5px] text-ink-3">
                    <b className="text-ink-2">{c.author ?? 'Someone'}</b>
                    <span>{relative(c.at)}</span>
                  </div>
                  <div className="selectable leading-[1.5] break-words whitespace-pre-wrap text-ink" dangerouslySetInnerHTML={{ __html: sanitizeHtml(c.body, { profile: 'strict' }) }} />
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void comment();
                }}
                rows={2}
                aria-label="Add a note"
                placeholder={offline ? 'Add a note — sent when you reconnect' : 'Add a note'}
                className="min-h-[52px] flex-1 resize-y rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-primary"
              />
              <Button variant="primary" size="sm" loading={busy} disabled={!note.trim()} onClick={() => void comment()} className="self-end">
                Add
              </Button>
            </div>
          </section>
          {d?.time?.entries?.length ? (
            <section>
              <h3 className="mb-1 text-[11px] font-bold tracking-[0.5px] text-ink-3">TIME · {hhmm(d.time.minutes)}</h3>
              {d.time.entries.slice(0, 12).map((e) => (
                <div key={e.id} className="flex items-center gap-2 py-0.5 text-[12.5px]">
                  <span className="w-[76px] text-ink-3">{e.on_date}</span>
                  <span className="min-w-0 flex-1 truncate text-ink">{e.user}</span>
                  <span className="font-semibold text-ink">{e.running ? 'running' : hhmm(e.minutes)}</span>
                </div>
              ))}
            </section>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
