import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { hhmm, mondayOf } from '@shared/projects';
import { call, errorMessage } from '../../../core/bridge';
import { addDays } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Checkbox } from '../../../components/Checkbox';
import { Select } from '../../../components/Select';
import { Button, ErrorNote, Modal, Spinner, cx } from '../../../components/ui';
import { qk, read, type Can } from '../api';
import { useProjectCompany } from '../company';
import { TIME_STATE, dqk, dread, dwrite, fmtWeekday, num, weekLabel, type QueueEntry, type TimeSummaryRow } from '../delivery';
import { setTimerState, useProjectTimer } from '../desk';
import { openWeb } from '../parts';
import { TimeView } from '../Views';
import { Chip, Field, Mono, NEEDS_CONNECTION, NoteDialog, PageHead, ProjectPick, Tabs, inputClass, useLiveProjects, useReportOffline } from './kit';

/**
 * W11 · Time & approvals (PRJ-TIM), in the desktop. Three views, as on the web: My week (the desktop's own week, with
 * Log time and Start timer), the Approval queue — only for those who approve time: entries on projects they manage
 * or lead, never their own, grouped by person, with Approve, Approve all, Send back with a note and the billable
 * marks — and a Summary by project and by person for a range. `?tab=queue` opens the queue (the rail's count and
 * "waiting for you" point there).
 *
 * Approvals, sending back and billable marks are approvals: online only, never kept (PRJ-DSK-04). Logging time goes
 * through the outbox like everywhere else in the app.
 */

type View = 'mine' | 'queue' | 'summary';

export function TimeScreen({ today, waiting, offline, tab, onTab, onLogTime, onOpenTask, onOffline }: { today: string; waiting: number; offline: boolean; tab: string | null; onTab: (tab: View) => void; onLogTime: () => void; onOpenTask?: (taskId: number) => void; onOffline: (o: boolean) => void }) {
  useProjectCompany();
  const [starting, setStarting] = useState(false);
  // The week's answer carries what the reader may do with time (the same read My week makes).
  const week = useQuery({ queryKey: qk.week(mondayOf(today)), queryFn: ({ signal }) => read.week(mondayOf(today), { signal }) });
  const can = ((week.data?.data as { can?: Can } | undefined)?.can ?? {}) as Can;
  const canApprove = !!(can.time_approve ?? can.time) || waiting > 0;
  const view: View = tab === 'summary' ? 'summary' : tab === 'queue' && canApprove ? 'queue' : 'mine';
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        title="Time & approvals"
        actions={
          <>
            <Button size="sm" icon="play" disabled={offline} title={offline ? NEEDS_CONNECTION : 'Start a timer on a project or a task'} onClick={() => setStarting(true)}>
              Start timer
            </Button>
            <Button size="sm" icon="external" onClick={() => openWeb(view === 'mine' ? '/projects/time' : `/projects/time?tab=${view}`)}>
              Open on the web
            </Button>
          </>
        }
      >
        <div className="pb-2.5">
          <Tabs<View>
            label="View"
            value={view}
            onChange={onTab}
            tabs={[{ key: 'mine', label: 'My week' }, ...(canApprove ? [{ key: 'queue' as View, label: 'Approval queue', count: waiting }] : []), { key: 'summary', label: 'Summary' }]}
          />
        </div>
      </PageHead>
      {view === 'queue' ? (
        <Queue today={today} offline={offline} onOffline={onOffline} />
      ) : view === 'summary' ? (
        <Summary today={today} onOffline={onOffline} />
      ) : (
        <TimeView today={today} waiting={canApprove ? waiting : 0} offline={offline} onLogTime={onLogTime} onOpenTask={onOpenTask} onOffline={onOffline} onReview={() => onTab('queue')} />
      )}
      {starting ? <StartTimer onClose={() => setStarting(false)} /> : null}
    </div>
  );
}

// ── the approval queue ─────────────────────────────────────────────────────

function Queue({ today, offline, onOffline }: { today: string; offline: boolean; onOffline: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [week, setWeek] = useState(mondayOf(today));
  const [project, setProject] = useState<number | null>(null);
  const [person, setPerson] = useState<number | ''>('');
  const [billable, setBillable] = useState<'' | 'yes' | 'no'>('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [sending, setSending] = useState<number[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const p = { week, project_id: project, user_id: person || null, billable: billable === 'yes' ? '1' : billable === 'no' ? '0' : null };
  const q = useQuery({ queryKey: dqk.timeQueue(p), queryFn: ({ signal }) => dread.timeQueue(p, { signal }) });
  useReportOffline(!!q.data?.offline, onOffline);
  const d = q.data?.data;
  const entries = useMemo(() => (d?.entries ?? []).filter((e) => (!project || e.project_id === project) && (!person || e.user_id === person) && (!billable || e.is_billable === (billable === 'yes'))), [d, project, person, billable]);
  const selectable = entries.filter((e) => !e.locked && !e.running);
  const chosen = selectable.filter((e) => picked.has(e.id));
  const total = chosen.reduce((n, e) => n + e.minutes, 0);
  const all = selectable.length > 0 && chosen.length === selectable.length;
  // The most common currency names the Value column; others carry their own code.
  const currency = useMemo(() => {
    const n = new Map<string, number>();
    for (const e of entries) if (e.currency) n.set(e.currency, (n.get(e.currency) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }, [entries]);
  const groups = useMemo(() => {
    const m = new Map<number, { id: number; name: string; entries: QueueEntry[] }>();
    for (const e of entries) {
      const g = m.get(e.user_id) ?? { id: e.user_id, name: e.user, entries: [] };
      g.entries.push(e);
      m.set(e.user_id, g);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [entries]);

  const toggle = (ids: number[], on: boolean) =>
    setPicked((s) => {
      const n = new Set(s);
      for (const id of ids) {
        if (on) n.add(id);
        else n.delete(id);
      }
      return n;
    });
  const after = () => {
    setPicked(new Set());
    void qc.invalidateQueries({ queryKey: ['projects', 'time'] });
    void qc.invalidateQueries({ queryKey: qk.counts });
  };
  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    try {
      toast('success', await fn());
      after();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const approve = (ids: number[], key = 'approve') =>
    run(key, async () => {
      const r = await dwrite.approve(ids);
      return r ? `${r.approved} approved${r.skipped ? ` · ${r.skipped} skipped` : ''}.` : 'Approved.';
    });
  const mark = (ids: number[], on: boolean) => run(on ? 'billable' : 'nonbillable', async () => (await dwrite.setBillable(ids, on), on ? 'Marked billable.' : 'Marked non-billable.'));
  const sendBack = (ids: number[], note: string) =>
    run('sendback', async () => {
      const r = await dwrite.sendBack(ids, note);
      setSending(null);
      return r ? `${r.sent_back} sent back.` : 'Sent back.';
    });

  const skipped = d?.skipped;
  const skippedText = [skipped?.running ? `${skipped.running} running timer${skipped.running === 1 ? '' : 's'}` : '', skipped?.own ? `${skipped.own} of your own` : ''].filter(Boolean).join(' · ');
  const off = offline ? 'Approvals wait for a connection' : undefined;
  const ids = chosen.map((e) => e.id);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4 scroll-thin">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" aria-label="Earlier week" onClick={() => setWeek(addDays(week, -7))}>
          ←
        </Button>
        <b aria-live="polite" className="text-[13px] text-ink">
          Week of {weekLabel(week)}
        </b>
        <Button size="sm" aria-label="Later week" onClick={() => setWeek(addDays(week, 7))}>
          →
        </Button>
        {week !== mondayOf(today) ? (
          <Button size="sm" variant="ghost" onClick={() => setWeek(mondayOf(today))}>
            This week
          </Button>
        ) : null}
        <ProjectPick value={project} onChange={setProject} anyLabel="All I manage" options={(d?.projects ?? []).map((x) => ({ value: x.id, label: `${x.code} · ${x.name}` }))} />
        <div className="w-[180px]">
          <Select<number | ''> aria-label="Person" value={person} onValueChange={setPerson} options={[{ value: '', label: 'Anyone' }, ...(d?.people ?? []).map((x) => ({ value: x.id, label: x.name }))]} className={inputClass} />
        </div>
        <div className="w-[150px]">
          <Select<'' | 'yes' | 'no'>
            aria-label="Billable"
            value={billable}
            onValueChange={setBillable}
            options={[
              { value: '', label: 'Billable: any' },
              { value: 'yes', label: 'Billable' },
              { value: 'no', label: 'Non-billable' },
            ]}
            className={inputClass}
          />
        </div>
        <span className="ml-auto text-[11.5px] text-ink-3">Only entries on projects you manage or lead · never your own</span>
      </div>

      <div role="region" aria-label="Selection" className={cx('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] px-3.5 py-2 text-[12.5px]', chosen.length ? 'bg-selection text-ink' : 'bg-subtle text-ink-2')}>
        <label className="flex items-center gap-2 font-semibold">
          <Checkbox aria-label="Select all" checked={all} indeterminate={chosen.length > 0 && !all} disabled={!selectable.length} onChange={() => setPicked(all ? new Set() : new Set(selectable.map((e) => e.id)))} />
          <span aria-live="polite">
            {chosen.length} selected · <Mono>{hhmm(total)}</Mono>
          </span>
        </label>
        {chosen.length ? (
          <>
            <Button size="sm" variant="success" icon="check" loading={busy === 'approve'} disabled={offline || !!busy} title={off} onClick={() => void approve(ids)}>
              Approve
            </Button>
            <Button size="sm" icon="undo" disabled={offline || !!busy} title={off} onClick={() => setSending(ids)}>
              Send back with a note
            </Button>
            <Button size="sm" variant="ghost" loading={busy === 'nonbillable'} disabled={offline || !!busy} title={off} onClick={() => void mark(ids, false)}>
              Mark non-billable
            </Button>
            <Button size="sm" variant="ghost" loading={busy === 'billable'} disabled={offline || !!busy} title={off} onClick={() => void mark(ids, true)}>
              Mark billable
            </Button>
          </>
        ) : null}
        {skippedText ? <span className="ml-auto text-[11.5px] text-ink-3">Skipped: {skippedText}</span> : null}
      </div>
      {offline ? <p className="text-[12px] text-warning-ink">Approvals wait for a connection: the queue is the copy kept on this computer.</p> : null}

      {q.isLoading ? <Spinner /> : null}
      {q.error && !d ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {d && !entries.length ? <p className="py-6 text-center text-ink-3">Nothing waiting for you this week.</p> : null}
      {groups.map((g) => {
        const open = g.entries.filter((e) => !e.locked && !e.running);
        const mins = g.entries.reduce((n, e) => n + e.minutes, 0);
        const groupOn = open.length > 0 && open.every((e) => picked.has(e.id));
        return (
          <section key={g.id} aria-label={g.name} className="overflow-hidden rounded-[12px] border border-line bg-surface">
            <div className="flex items-center gap-2.5 border-b border-line bg-subtle/60 px-3.5 py-1.5">
              <Checkbox aria-label={`Select every entry of ${g.name}`} checked={groupOn} indeterminate={!groupOn && open.some((e) => picked.has(e.id))} disabled={!open.length} onChange={() => toggle(open.map((e) => e.id), !groupOn)} />
              <b className="flex-1 text-[13px] text-ink">{g.name}</b>
              <span className="text-[12px] text-ink-2">
                {g.entries.length} entr{g.entries.length === 1 ? 'y' : 'ies'} · <Mono className="font-semibold text-ink">{hhmm(mins)}</Mono>
              </span>
              <Button size="sm" variant="success" disabled={offline || !open.length || !!busy} loading={busy === `all:${g.id}`} title={off} aria-label={`Approve all of ${g.name}’s entries`} onClick={() => void approve(open.map((e) => e.id), `all:${g.id}`)}>
                Approve all ({open.length})
              </Button>
            </div>
            <table className="w-full border-collapse text-[12.5px]">
              <thead className="sr-only">
                <tr>
                  <th>Select</th>
                  <th>Day</th>
                  <th>Project · task</th>
                  <th>Note</th>
                  <th>Time</th>
                  <th>Value{currency ? ` (${currency})` : ''}</th>
                  <th>Billable</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {g.entries.map((e) => {
                  const ok = !e.locked && !e.running;
                  const on = ok && picked.has(e.id);
                  const st = TIME_STATE[e.state ?? 'pending'] ?? { label: e.state ?? '', tone: 'bg-subtle text-ink-2' };
                  return (
                    <tr key={e.id} className={cx('border-t border-line/60 first:border-t-0', on && 'bg-selection/50')}>
                      <td className="w-9 px-3.5 py-1.5">
                        <Checkbox aria-label={`Select ${e.user}, ${fmtWeekday(e.on_date)}, ${hhmm(e.minutes)}`} checked={on} disabled={!ok} onChange={() => toggle([e.id], !on)} />
                      </td>
                      <td className="w-16 py-1.5 text-ink-2">{fmtWeekday(e.on_date)}</td>
                      <td className="py-1.5 text-ink">
                        <Mono className="text-[11px] text-ink-3">{e.project_code}</Mono> {e.task ?? e.project ?? 'No project'}
                      </td>
                      <td className="max-w-[260px] truncate py-1.5 text-ink-2">{e.note || '—'}</td>
                      <td className="w-14 py-1.5 text-right">
                        <Mono className="font-semibold text-ink">{hhmm(e.minutes)}</Mono>
                      </td>
                      <td className="w-24 py-1.5 text-right text-ink-2">
                        <Mono>{e.value && Number(e.value) ? `${e.currency && e.currency !== currency ? `${e.currency} ` : ''}${num(e.value)}` : '—'}</Mono>
                      </td>
                      <td className="w-24 px-2 py-1.5 text-ink-2">{e.is_billable ? 'Billable' : 'Non-billable'}</td>
                      <td className="w-28 py-1.5 pr-3.5">
                        <Chip tone={st.tone}>{st.label}</Chip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
      {sending ? (
        <NoteDialog
          title="Send back with a note"
          message={`Say what to fix — the person sees this note on ${sending.length === 1 ? 'the entry' : `all ${sending.length} entries`}.`}
          label="Note"
          placeholder="What needs fixing"
          confirmLabel="Send back"
          busy={busy === 'sendback'}
          onClose={() => setSending(null)}
          onConfirm={(note) => void sendBack(sending, note)}
        />
      ) : null}
    </div>
  );
}

// ── the summary ────────────────────────────────────────────────────────────

function Summary({ today, onOffline }: { today: string; onOffline: (o: boolean) => void }) {
  const { current } = useProjectCompany();
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const p = { from, to };
  const q = useQuery({ queryKey: dqk.timeSummary(p), queryFn: ({ signal }) => dread.timeSummary(p, { signal }) });
  useReportOffline(!!q.data?.offline, onOffline);
  const d = q.data?.data;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4 scroll-thin">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="From" className="w-40">
          <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className={inputClass} />
        </Field>
        <Field label="To" className="w-40">
          <input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className={inputClass} />
        </Field>
        {current ? <span className="pb-2 text-[12px] text-ink-3">{current.name}</span> : null}
      </div>
      {q.isLoading ? <Spinner /> : null}
      {q.error && !d ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {d ? (
        <div className="grid grid-cols-2 gap-3.5">
          <SummaryCard title="By project" rows={d.by_project} showCode />
          <SummaryCard title="By person" rows={d.by_user} />
        </div>
      ) : null}
    </div>
  );
}

function SummaryCard({ title, rows, showCode }: { title: string; rows: TimeSummaryRow[]; showCode?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.minutes));
  const total = rows.reduce((n, r) => n + r.minutes, 0);
  return (
    <section aria-label={title} className="self-start overflow-hidden rounded-[12px] border border-line bg-surface">
      <div className="flex items-baseline gap-2 border-b border-line px-3.5 py-2">
        <h2 className="flex-1 text-[13.5px] font-bold text-ink">{title}</h2>
        <span className="text-[12px] text-ink-3">
          Total <Mono className="font-semibold text-ink">{hhmm(total)}</Mono>
        </span>
      </div>
      {!rows.length ? (
        <p className="px-3.5 py-4 text-ink-3">No time logged in this range.</p>
      ) : (
        <table className="w-full border-collapse text-[12.5px]">
          <thead className="bg-subtle text-left text-[11.5px] font-semibold text-ink-2">
            <tr>
              <th className="px-3.5 py-1.5">{showCode ? 'Project' : 'Person'}</th>
              <th className="w-1/3 py-1.5">
                <span className="sr-only">Share</span>
              </th>
              <th className="px-2 py-1.5 text-right">Time</th>
              <th className="px-3.5 py-1.5 text-right">Billable h</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line/60">
                <td className="px-3.5 py-1.5 text-ink">
                  {showCode && r.code ? <Mono className="mr-1 text-[11px] text-ink-3">{r.code}</Mono> : null}
                  {r.name}
                </td>
                <td className="py-1.5">
                  <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-subtle">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${(r.minutes / max) * 100}%` }} />
                  </div>
                </td>
                <td className="px-2 py-1.5 text-right">
                  <Mono className="text-ink">{hhmm(r.minutes)}</Mono>
                </td>
                <td className="px-3.5 py-1.5 text-right text-ink-2">
                  <Mono>{r.billable_hours}</Mono>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ── start a timer on a project (or one of its tasks) ───────────────────────

/** Start timer (the web's "Start timer" beside Log time): a project, optionally a task, and billing. */
function StartTimer({ onClose }: { onClose: () => void }) {
  const timer = useProjectTimer();
  const projects = useLiveProjects();
  const [project, setProject] = useState<number | null>(null);
  const [task, setTask] = useState<number | ''>('');
  const [billable, setBillable] = useState(true);
  const [busy, setBusy] = useState(false);
  const tasks = useQuery({ queryKey: dqk.tasksOf(project ?? 0), queryFn: ({ signal }) => dread.openTasks(project as number, { signal }), enabled: !!project, staleTime: 60_000 });
  const start = async () => {
    if (!project) return;
    setBusy(true);
    try {
      const target = { projectId: project, taskId: task === '' ? null : task, billable };
      setTimerState(timer.running ? await call('projects:timerSwitch', target) : await call('projects:timerStart', target));
      toast('success', 'Timer started.');
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Start timer"
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="play" loading={busy} disabled={!project} onClick={() => void start()}>
            {timer.running ? 'Switch to this' : 'Start timer'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {timer.running ? <p className="text-[12.5px] text-ink-2">The running timer stops and this one starts — one click, one entry each.</p> : null}
        <Field label="Project">
          <Select<number | ''> aria-label="Project" value={project ?? ''} onValueChange={(v) => (setProject(v === '' ? null : v), setTask(''))} options={[{ value: '', label: 'Choose a project…' }, ...projects]} className={inputClass} />
        </Field>
        <Field label="Task">
          <Select<number | ''> aria-label="Task" disabled={!project} value={task} onValueChange={setTask} options={[{ value: '', label: project ? 'No task' : 'Pick a project first' }, ...(tasks.data?.data.tasks ?? []).map((t) => ({ value: t.id, label: `${t.task_number ? `${t.task_number} · ` : ''}${t.title}` }))]} className={inputClass} />
        </Field>
        <label className="flex items-center gap-2 text-[13px] font-semibold text-ink">
          <Checkbox checked={billable} onChange={(e) => setBillable(e.target.checked)} />
          Billable
        </label>
      </div>
    </Modal>
  );
}
