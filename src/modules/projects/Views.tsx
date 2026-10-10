import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { hhmm, mondayOf } from '@shared/projects';
import { errorMessage } from '../../core/bridge';
import { addDays, dayWords } from '../../core/time';
import { toast } from '../../core/toasts';
import { useNow } from '../../core/use-now';
import { Button, ErrorNote, Spinner, cx } from '../../components/ui';
import { HEALTH, qk, read, write, type ChangeRequest } from './api';
import { elapsedOf, useProjectTimer } from './desk';
import { HealthDot, SectionTitle, openWeb } from './parts';
// DELIVERY: my week's entries say why they are locked or sent back, and one of mine can be deleted (online).
import { dwrite, fmtDay, type QueueEntry } from './delivery';
import { Confirm, NEEDS_CONNECTION } from './screens/kit';

/**
 * The Projects app's lighter views: the Dashboard (the projects that need attention), my time this week with what
 * waits for my approval, and the change requests waiting for a decision. Approvals and decisions need WorkSuite:
 * they are disabled offline and never kept (PRJ-DSK-04).
 */

export function DashboardView({ onGo, onOffline }: { onGo: (route: string) => void; onOffline: (o: boolean) => void }) {
  const q = useQuery({ queryKey: qk.dashboard, queryFn: ({ signal }) => read.dashboard({ signal }) });
  const d = q.data?.data;
  const fromCache = !!q.data?.offline;
  useEffect(() => onOffline(fromCache), [fromCache, onOffline]);
  const k = d?.kpi ?? {};
  const tile = (label: string, value: number | undefined, tone?: 'danger' | 'warning') => (
    <div className="flex flex-col gap-0.5 rounded-[12px] border border-line bg-surface px-3.5 py-2.5">
      <span className="text-[11.5px] font-semibold text-ink-3">{label}</span>
      <b className={cx('text-[20px]', tone === 'danger' && value ? 'text-danger' : tone === 'warning' && value ? 'text-warning-ink' : 'text-ink')}>{value ?? '—'}</b>
    </div>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-4 scroll-thin">
      <div className="flex items-center gap-2">
        <h1 className="flex-1 text-[20px] font-bold text-ink">Dashboard</h1>
        <Button size="sm" icon="external" onClick={() => openWeb('/projects')}>
          Full dashboard on the web
        </Button>
      </div>
      {q.isLoading ? <Spinner /> : null}
      {q.error && !d ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {d ? (
        <>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
            {tile('Live projects', k.live)}
            {tile('At risk', k.at_risk, 'danger')}
            {tile('Watch', k.watch, 'warning')}
            {tile('Open tasks', k.tasks_open)}
            {tile('Overdue tasks', k.tasks_overdue, 'danger')}
            {tile('Milestones due', k.upcoming_milestones)}
          </div>
          <section className="rounded-[12px] border border-line bg-surface">
            <div className="border-b border-line px-3.5 py-2">
              <SectionTitle count={d.attention.length}>Needing attention</SectionTitle>
            </div>
            {d.attention.map((p) => (
              <button key={p.id} type="button" onClick={() => onGo(`/projects/${p.id}`)} className="grid w-full grid-cols-[14px_76px_minmax(0,1.4fr)_minmax(0,1fr)_70px_70px] items-center gap-2 border-b border-line/60 px-3.5 py-2 text-left text-[12.5px] last:border-b-0 hover:bg-subtle">
                <HealthDot health={p.health} />
                <span className="font-mono text-[11px] text-ink-3">{p.code}</span>
                <span className="min-w-0">
                  <b className="block truncate text-ink">{p.name}</b>
                  <span className="block truncate text-[11.5px] text-ink-3">{HEALTH[p.health]?.label}{p.reasons.length ? ` · ${p.reasons.join(' · ')}` : ''}</span>
                </span>
                <span className="truncate text-ink-2">{p.manager ?? '—'}</span>
                <span className="text-ink-2">{p.progress}% done</span>
                <span className={cx(p.budget_used_percent >= 100 ? 'font-bold text-danger' : 'text-ink-2')}>{p.budget_used_percent}% budget</span>
              </button>
            ))}
            {!d.attention.length ? <p className="px-3.5 py-3 text-ink-3">Every project is on track.</p> : null}
          </section>
          {d.upcoming_milestones?.length ? (
            <section className="rounded-[12px] border border-line bg-surface">
              <div className="border-b border-line px-3.5 py-2">
                <SectionTitle count={d.upcoming_milestones.length}>Milestones coming up</SectionTitle>
              </div>
              {d.upcoming_milestones.slice(0, 8).map((m) => (
                <button key={m.id} type="button" onClick={() => onGo(`/projects/${m.project_id}/milestones`)} className="flex w-full items-center gap-2 border-b border-line/60 px-3.5 py-1.5 text-left text-[12.5px] last:border-b-0 hover:bg-subtle">
                  <span className="font-mono text-[11px] text-ink-3">{m.code}</span>
                  <span className="min-w-0 flex-1 truncate text-ink">{m.name}</span>
                  <span className={cx(m.days_left < 0 ? 'font-bold text-danger' : 'text-ink-2')}>{m.days_left < 0 ? `${-m.days_left} d late` : m.days_left === 0 ? 'Today' : `in ${m.days_left} d`}</span>
                </button>
              ))}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** My time this week (PRJ-TIM), the running timer with it, and the approvals waiting for me (the queue, online). */
export function TimeView({ today, waiting, offline, onLogTime, onOffline, onReview }: { today: string; waiting: number; offline: boolean; onLogTime: () => void; onOffline: (o: boolean) => void; onReview?: () => void }) {
  const [day, setDay] = useState(today);
  const qc = useQueryClient();
  const [deleting, setDeleting] = useState<QueueEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const remove = async (e: QueueEntry) => {
    setBusy(true);
    try {
      await dwrite.deleteTime(e.id);
      toast('success', 'Time deleted.');
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: qk.all });
    } catch (err) {
      toast('error', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const q = useQuery({ queryKey: qk.week(mondayOf(day)), queryFn: ({ signal }) => read.week(mondayOf(day), { signal }) });
  const timer = useProjectTimer();
  const now = useNow(30_000).getTime();
  const fromCache = !!q.data?.offline;
  useEffect(() => onOffline(fromCache), [fromCache, onOffline]);
  const entries = (q.data?.data.entries ?? []).filter((e) => !e.running);
  const monday = mondayOf(day);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const running = timer.running && mondayOf(today) === monday ? Math.floor(elapsedOf(timer.running.startedAt, now) / 60) : 0;
  const total = entries.reduce((n, e) => n + e.minutes, 0) + running;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4 scroll-thin">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="text-[20px] font-bold text-ink">Time & approvals</h1>
          <span className="text-[12.5px] text-ink-3">
            Week of {dayWords(monday)} · {hhmm(total)} logged
          </span>
        </div>
        <Button size="sm" aria-label="Earlier week" onClick={() => setDay(addDays(monday, -7))}>
          ←
        </Button>
        {monday !== mondayOf(today) ? (
          <Button size="sm" onClick={() => setDay(today)}>
            This week
          </Button>
        ) : null}
        <Button size="sm" aria-label="Later week" disabled={monday >= mondayOf(today)} onClick={() => setDay(addDays(monday, 7))}>
          →
        </Button>
        <Button size="sm" variant="primary" icon="clock" onClick={onLogTime}>
          Log time
        </Button>
      </div>
      {waiting ? (
        <div className="flex items-center gap-3 rounded-[10px] border border-line bg-surface px-3.5 py-2.5 text-[12.5px]">
          <b className="flex-1 text-ink">
            {waiting} time {waiting === 1 ? 'entry waits' : 'entries wait'} for your approval
          </b>
          <Button size="sm" disabled={offline} title={offline ? 'Approvals wait for a connection' : onReview ? 'Opens the approval queue' : 'Opens the approval queue on the web'} onClick={() => (onReview ? onReview() : openWeb('/projects/time'))}>
            {offline ? 'Waits for a connection' : onReview ? 'Review' : 'Review on the web'}
          </Button>
        </div>
      ) : null}
      {q.isLoading ? <Spinner /> : null}
      {q.error && !q.data ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      <div className="flex flex-col gap-2">
        {days.map((d) => {
          const list = entries.filter((e) => e.on_date === d);
          const run = timer.running && d === today && running ? running : 0;
          if (!list.length && !run) return null;
          return (
            <section key={d} className="rounded-[12px] border border-line bg-surface">
              <div className="flex items-center border-b border-line px-3.5 py-1.5">
                <b className={cx('flex-1 text-[12.5px]', d === today ? 'text-primary' : 'text-ink')}>{dayWords(d, { weekday: true })}</b>
                <span className="font-mono text-[12px] font-bold text-ink">{hhmm(list.reduce((n, e) => n + e.minutes, 0) + run)}</span>
              </div>
              {(list as QueueEntry[]).map((e) => (
                <div key={e.id} className="flex flex-col border-b border-line/60 px-3.5 py-1.5 text-[12.5px] last:border-b-0">
                  <div className="flex items-center gap-2">
                    <span className="w-[70px] font-mono text-[11px] text-ink-3">{e.task_number ?? e.project_code ?? '—'}</span>
                    <span className="min-w-0 flex-1 truncate text-ink">{e.task ?? e.project ?? 'Internal · not on a project'}</span>
                    {e.note ? <span className="max-w-[30%] truncate text-ink-3">{e.note}</span> : null}
                    <span className="text-[11px] text-ink-3">{e.is_billable ? 'billable' : 'non-billable'}</span>
                    <span className="text-[11px] text-ink-3">{e.approved ? 'approved' : e.state === 'submitted' ? 'in HR timesheet' : (e.state ?? '').replace(/_/g, ' ')}</span>
                    <span className="w-[44px] text-right font-mono font-semibold text-ink">{hhmm(e.minutes)}</span>
                    {e.is_mine !== false && !e.locked && !e.running && !e.approved ? (
                      <button type="button" disabled={offline} title={offline ? NEEDS_CONNECTION : undefined} aria-label={`Delete ${hhmm(e.minutes)} on ${fmtDay(e.on_date)}`} onClick={() => setDeleting(e)} className="text-[11.5px] font-semibold text-danger hover:underline disabled:opacity-50">
                        Delete
                      </button>
                    ) : null}
                  </div>
                  {e.sent_back_note ? <span className="ps-[78px] text-[11.5px] text-danger">Sent back: {e.sent_back_note}</span> : null}
                  {e.locked ? <span className="ps-[78px] text-[11px] text-ink-3">Locked · {e.lock_reason ?? (e.state ?? 'approved').replace(/_/g, ' ')}</span> : null}
                </div>
              ))}
              {run && timer.running ? (
                <div className="flex items-center gap-2 px-3.5 py-1.5 text-[12.5px]">
                  <span className="w-[70px] font-mono text-[11px] text-ink-3">{timer.running.taskNumber ?? '—'}</span>
                  <span className="min-w-0 flex-1 truncate text-ink">{timer.running.task ?? timer.running.project ?? 'Internal'}</span>
                  <span className="text-[11px] font-semibold text-success">running</span>
                  <span className="w-[44px] text-right font-mono font-semibold text-ink">{hhmm(run)}</span>
                </div>
              ) : null}
            </section>
          );
        })}
        {q.data && !entries.length && !running ? <p className="py-4 text-center text-ink-3">Nothing logged this week.</p> : null}
      </div>
      {deleting ? <Confirm title="Delete time" message={`Delete ${hhmm(deleting.minutes)} on ${fmtDay(deleting.on_date)}?`} confirmLabel="Delete" danger busy={busy} onClose={() => setDeleting(null)} onConfirm={() => void remove(deleting)} /> : null}
    </div>
  );
}

/** Change requests waiting for a decision (Review on the D02 banner). A decision is an approval: online only. */
export function ChangesView({ id, offline, onGo }: { id: number | null; offline: boolean; onGo: (route: string) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.changes, queryFn: ({ signal }) => read.changes({ signal }) });
  const list = q.data?.data.changes ?? [];
  const open = list.find((c) => c.id === id) ?? null;
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 w-[340px] shrink-0 flex-col gap-2 overflow-y-auto border-r border-line px-4 py-4 scroll-thin">
        <h1 className="text-[18px] font-bold text-ink">Change requests</h1>
        {q.isLoading ? <Spinner /> : null}
        {q.error && !q.data ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
        {list.map((c) => (
          <button key={c.id} type="button" onClick={() => onGo(`/projects/changes/${c.id}`)} className={cx('flex flex-col gap-0.5 rounded-[9px] border px-2.5 py-2 text-left', c.id === id ? 'border-primary bg-selection' : 'border-line hover:border-primary/50')}>
            <span className="font-mono text-[11px] text-ink-3">
              {c.number ?? `#${c.id}`} · {c.project_code}
            </span>
            <b className="text-[12.5px] text-ink">{c.title}</b>
          </button>
        ))}
        {q.data && !list.length ? <p className="text-[12.5px] text-ink-3">No change request waits for a decision.</p> : null}
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4 scroll-thin">
        {open ? <ChangeReview change={open} offline={offline} onDone={() => (void qc.invalidateQueries({ queryKey: qk.all }), onGo('/projects/changes'))} /> : id && q.data ? <p className="text-ink-3">That change request is not waiting for a decision any more.</p> : <p className="text-ink-3">Choose a change request.</p>}
      </div>
    </div>
  );
}

function ChangeReview({ change: c, offline, onDone }: { change: ChangeRequest; offline: boolean; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const decide = async (decision: 'approve' | 'reject') => {
    if (decision === 'reject' && !note.trim()) return toast('error', 'Say why it is rejected.');
    setBusy(decision);
    try {
      await write.decideChange(c.id, { decision, note: note.trim() || undefined });
      toast('success', decision === 'approve' ? 'Approved.' : 'Rejected.');
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const delta = (v: string | number, unit: string) => (Number(v) === 0 ? '—' : `${Number(v) > 0 ? '+' : ''}${v}${unit}`);
  return (
    <div className="flex max-w-[640px] flex-col gap-3 text-[13px]">
      <span className="font-mono text-[11.5px] text-ink-3">
        {c.number ?? `#${c.id}`} · {c.project_code} · {c.project}
      </span>
      <h2 className="text-[19px] font-bold text-ink">{c.title}</h2>
      {c.description ? <p className="whitespace-pre-wrap text-ink-2">{c.description}</p> : null}
      <div className="grid grid-cols-3 gap-2.5">
        <div className="rounded-[10px] border border-line px-3 py-2">
          <span className="block text-[11.5px] text-ink-3">Budget</span>
          <b className="text-ink">{delta(c.budget_delta, ` ${c.currency}`)}</b>
        </div>
        <div className="rounded-[10px] border border-line px-3 py-2">
          <span className="block text-[11.5px] text-ink-3">Days</span>
          <b className="text-ink">{delta(c.days_delta, ' d')}</b>
        </div>
        <div className="rounded-[10px] border border-line px-3 py-2">
          <span className="block text-[11.5px] text-ink-3">Hours</span>
          <b className="text-ink">{delta(c.hours_delta, ' h')}</b>
        </div>
      </div>
      <span className="text-[12px] text-ink-3">Asked by {c.requested_by ?? 'someone'}</span>
      {c.can_decide ? (
        <>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} aria-label="Decision note" placeholder="A note (needed to reject)" className="rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-ink outline-none focus:border-primary" />
          <div className="flex gap-2">
            <Button variant="primary" loading={busy === 'approve'} disabled={offline || !!busy} title={offline ? 'Decisions wait for a connection' : undefined} onClick={() => void decide('approve')}>
              Approve
            </Button>
            <Button variant="danger" loading={busy === 'reject'} disabled={offline || !!busy} title={offline ? 'Decisions wait for a connection' : undefined} onClick={() => void decide('reject')}>
              Reject
            </Button>
            <Button icon="external" onClick={() => openWeb(`/projects/changes/${c.id}`)}>
              Open on the web
            </Button>
          </div>
          {offline ? <p className="text-[12px] text-warning-ink">Change-request decisions wait for a connection.</p> : null}
        </>
      ) : (
        <p className="text-ink-3">You cannot decide this one.</p>
      )}
    </div>
  );
}
