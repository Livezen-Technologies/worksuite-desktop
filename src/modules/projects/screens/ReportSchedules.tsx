import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { ProjectReportFormat } from '@shared/projects';
import { app } from '../../../core/app-state';
import { errorMessage } from '../../../core/bridge';
import { useStore } from '../../../core/store';
import { toast } from '../../../core/toasts';
import { Select } from '../../../components/Select';
import { Button, Modal, cx } from '../../../components/ui';
import { qk } from '../api';
import { useProjectCompany } from '../company';
import { gk, gov, govWrite, type ReportFrequency, type ReportRange, type ReportSchedule, type ReportScheduleInput } from './gov-api';
import { ConfirmDialog, Field, Mono, Tone, WAITS, fmtStamp, inputClass } from './gov-kit';

/**
 * W15 · Reports — "Schedule email" (PRJ-RPT-02, G-16). The button beside Export schedules the report on screen (its
 * client filter carried over) as CSV, Excel or PDF — daily, weekly on a weekday or monthly on a day, at an hour on the
 * scheduler's own clock — to people from the Projects people list. "Scheduled emails" lists the schedules the reader
 * may see (their own; everybody's with project.manage or project.settings) with the next run, the last send, the last
 * problem in words, and Send now, Pause/Resume, Edit and Delete. Each copy is made AS its recipient on the server, so
 * nobody receives a project they cannot open. Every one of these needs WorkSuite.
 */

/** The kinds that read a range; the rest show how things stand when sent (the server's `DATED`). */
export const DATED_KINDS = ['summary', 'tasks', 'time_by_person', 'time_by_project', 'milestone_billing'];

export const RANGES: Array<{ key: ReportRange; label: string }> = [
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last_week', label: 'Last week' },
  { key: 'week_to_date', label: 'This week so far' },
  { key: 'last_month', label: 'Last month' },
  { key: 'month_to_date', label: 'This month so far' },
  { key: 'last_30_days', label: 'Last 30 days' },
];

const FORMAT_LABEL: Record<ProjectReportFormat, string> = { csv: 'CSV', xlsx: 'Excel', pdf: 'PDF' };
const FREQUENCIES: Array<{ key: ReportFrequency; label: string }> = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]!);
}

/** "Mondays at 08:00", "Daily at 07:00", "Monthly on the 31st (or the last day) at 09:00". */
export function cadence(s: Pick<ReportSchedule, 'frequency' | 'weekday' | 'month_day' | 'time'>): string {
  if (s.frequency === 'weekly') return `${WEEKDAYS[(s.weekday ?? 1) - 1]}s at ${s.time}`;
  if (s.frequency === 'monthly') {
    const d = s.month_day ?? 1;
    return `Monthly on the ${ordinal(d)}${d > 28 ? ' (or the last day)' : ''} at ${s.time}`;
  }
  return `Daily at ${s.time}`;
}

type Kind = { kind: string; label: string };

/** A row of buttons that pick one (the web's Segmented). */
function Segmented<K extends string>({ label, value, onChange, options }: { label: string; value: K; onChange: (k: K) => void; options: Array<{ key: K; label: string }> }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[8px] border border-line bg-subtle p-0.5">
      {options.map((o) => (
        <button key={o.key} type="button" role="radio" aria-checked={value === o.key} onClick={() => onChange(o.key)} className={cx('h-7 rounded-[6px] px-2.5 text-[12.5px] font-semibold', value === o.key ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The "Schedule email" button and its dialog, preset with the report on screen. */
export function ScheduleButton({ kinds, kind, clientId, offline }: { kinds: Kind[]; kind: string; clientId: string; offline: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" icon="mail" disabled={offline} title={offline ? WAITS : undefined} onClick={() => setOpen(true)}>
        Schedule email
      </Button>
      {open ? <ScheduleDialog kinds={kinds} preset={{ kind, client_id: clientId ? Number(clientId) : null }} offline={offline} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ScheduleDialog({ kinds, preset, editing, offline, onClose }: { kinds: Kind[]; preset?: { kind: string; client_id: number | null }; editing?: ReportSchedule; offline: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const me = Number(useStore(app, (s) => s.auth?.user?.id) ?? 0);
  const company = useProjectCompany();
  // The report is one company's; the people who may get it are that company's.
  const orgId = editing ? editing.org_id : (company.current?.id ?? null);
  const people = useQuery({ queryKey: gk.peopleIn(orgId), queryFn: ({ signal }) => gov.people(orgId, { signal }), staleTime: 300_000 });
  const clients = useQuery({ queryKey: gk.clients(), queryFn: ({ signal }) => gov.clients({ signal }), staleTime: 300_000 });
  const projects = useQuery({ queryKey: gk.live(), queryFn: ({ signal }) => gov.live({ signal }), staleTime: 300_000 });
  const [f, setF] = useState<ReportScheduleInput>(() =>
    editing
      ? { name: editing.name, kind: editing.kind, range: editing.range, format: editing.format, frequency: editing.frequency, weekday: editing.weekday ?? 1, month_day: editing.month_day ?? 1, time: editing.time, client_id: editing.client_id, project_id: editing.project_id, recipients: editing.recipients.map((r) => r.id) }
      : { org_id: company.current?.id ?? null, name: '', kind: preset?.kind ?? 'summary', range: 'last_month', format: 'pdf', frequency: 'weekly', weekday: 1, month_day: 1, time: '08:00', client_id: preset?.client_id ?? null, project_id: null, recipients: me ? [me] : [] },
  );
  const set = <K extends keyof ReportScheduleInput>(k: K, v: ReportScheduleInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const names = useMemo(() => {
    const m = new Map<number, string>();
    editing?.recipients.forEach((r) => m.set(r.id, r.name));
    (people.data?.data.people ?? []).forEach((p) => m.set(p.id, p.name));
    return m;
  }, [people.data, editing]);
  const addable = (people.data?.data.people ?? []).filter((p) => !f.recipients.includes(p.id)).map((p) => ({ value: String(p.id), label: p.name, hint: p.email }));
  const dated = DATED_KINDS.includes(f.kind);
  const hours = HOURS.includes(f.time) ? HOURS : [...HOURS, f.time].sort();

  const save = async () => {
    if (offline) return;
    if (!f.recipients.length) {
      setErr('Choose at least one person to send it to.');
      return;
    }
    setErr('');
    setBusy(true);
    try {
      const body: ReportScheduleInput = { ...f, name: f.name?.trim() || null, weekday: f.frequency === 'weekly' ? f.weekday : null, month_day: f.frequency === 'monthly' ? f.month_day : null };
      const res = editing ? await govWrite.updateReportSchedule(editing.id, body) : await govWrite.createReportSchedule(body);
      void qc.invalidateQueries({ queryKey: gk.reportSchedules });
      const next = res.data?.schedule?.next_run_at;
      toast('success', editing ? 'Schedule saved' : `Scheduled${next ? ` — first email ${fmtStamp(next)}` : ''}`);
      onClose();
    } catch (e) {
      setErr(e instanceof Error && e.message ? e.message : 'The schedule could not be saved.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? 'Edit scheduled email' : 'Schedule email'}
      onClose={onClose}
      width={640}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={offline} title={offline ? WAITS : undefined} onClick={() => void save()}>
            {editing ? 'Save' : 'Schedule'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <p className="col-span-2 text-[12px] text-ink-3">Each person gets the report as they would see it — only projects they can open.</p>
        <Field label="Report">
          <Select aria-label="Report" value={f.kind} onValueChange={(v) => set('kind', v)} options={kinds.map((k) => ({ value: k.kind, label: k.label }))} className={inputClass} />
        </Field>
        <Field label="Name" hint="Optional; the email's subject starts with it.">
          <input value={f.name ?? ''} maxLength={120} onChange={(e) => set('name', e.target.value)} placeholder={kinds.find((k) => k.kind === f.kind)?.label} className={inputClass} />
        </Field>
        <Field label="Period" hint={dated ? 'Worked out on the day it is sent.' : 'This report shows how things stand when it is sent.'}>
          <Select aria-label="Period" value={f.range} onValueChange={(v) => set('range', v as ReportRange)} options={RANGES.map((r) => ({ value: r.key, label: r.label }))} className={inputClass} disabled={!dated} />
        </Field>
        <div className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
          <span>File</span>
          <Segmented<ProjectReportFormat> label="File format" value={f.format} onChange={(v) => set('format', v)} options={(['pdf', 'xlsx', 'csv'] as ProjectReportFormat[]).map((k) => ({ key: k, label: FORMAT_LABEL[k] }))} />
        </div>
        <Field label="Client">
          <Select aria-label="Client" value={f.client_id ? String(f.client_id) : ''} onValueChange={(v) => set('client_id', v ? Number(v) : null)} options={[{ value: '', label: 'Any client' }, ...(clients.data?.data.clients ?? []).map((c) => ({ value: String(c.id), label: c.name }))]} className={inputClass} />
        </Field>
        <Field label="Project" hint={f.project_id ? 'Everybody on the list must be on this project.' : undefined}>
          <Select aria-label="Project" value={f.project_id ? String(f.project_id) : ''} onValueChange={(v) => set('project_id', v ? Number(v) : null)} options={[{ value: '', label: 'Any project' }, ...(projects.data?.data.projects ?? []).map((p) => ({ value: String(p.id), label: `${p.code} · ${p.name}` }))]} className={inputClass} />
        </Field>
        <fieldset className="col-span-2 flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-semibold text-ink">When</legend>
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
            <Segmented<ReportFrequency> label="How often" value={f.frequency} onChange={(v) => set('frequency', v)} options={FREQUENCIES} />
            {f.frequency === 'weekly' ? (
              <>
                on
                <div className="w-36">
                  <Select aria-label="Weekday" value={String(f.weekday ?? 1)} onValueChange={(v) => set('weekday', Number(v))} options={WEEKDAYS.map((d, i) => ({ value: String(i + 1), label: d }))} className={inputClass} />
                </div>
              </>
            ) : null}
            {f.frequency === 'monthly' ? (
              <>
                on the
                <div className="w-24">
                  <Select aria-label="Day of the month" value={String(f.month_day ?? 1)} onValueChange={(v) => set('month_day', Number(v))} options={Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: ordinal(i + 1) }))} className={inputClass} />
                </div>
              </>
            ) : null}
            at
            <div className="w-28">
              <Select aria-label="Time" value={f.time} onValueChange={(v) => set('time', v)} options={hours.map((h) => ({ value: h, label: h }))} className={cx(inputClass, 'font-mono')} />
            </div>
          </div>
          <p className="text-[11.5px] text-ink-3">
            {editing ? `On ${editing.owner.name}'s clock (${editing.timezone}).` : 'On your clock, as set in your profile.'}
            {f.frequency === 'monthly' && (f.month_day ?? 1) > 28 ? ' A shorter month sends it on its last day.' : ''}
          </p>
        </fieldset>
        <div className="col-span-2 flex flex-col gap-1.5">
          <span id="report-recipients" className="text-[13px] font-semibold text-ink">
            Send to
          </span>
          <ul aria-labelledby="report-recipients" className="flex flex-wrap gap-1.5">
            {f.recipients.map((id) => (
              <li key={id} className="inline-flex items-center gap-1 rounded-full bg-subtle py-0.5 ps-2.5 pe-1 text-[12.5px] text-ink">
                {names.get(id) ?? `#${id}`}
                <button type="button" aria-label={`Remove ${names.get(id) ?? `#${id}`}`} onClick={() => set('recipients', f.recipients.filter((r) => r !== id))} className="rounded-full px-1.5 text-ink-3 hover:bg-line hover:text-ink">
                  ×
                </button>
              </li>
            ))}
            {!f.recipients.length ? <li className="text-[12.5px] text-ink-3">Nobody yet.</li> : null}
          </ul>
          <div className="w-72">
            <Select aria-label="Add a person" value="" searchable onValueChange={(v) => v && set('recipients', [...f.recipients, Number(v)])} options={[{ value: '', label: 'Add a person…' }, ...addable]} className={inputClass} />
          </div>
          <p className="text-[11.5px] text-ink-3">WorkSuite users who can see Projects. Each copy holds only the projects that person can open.</p>
        </div>
        {err ? (
          <p role="alert" className="col-span-2 text-[13px] text-danger">
            {err}
          </p>
        ) : null}
        {offline ? <p className="col-span-2 text-[12px] text-warning-ink">Scheduling waits for a connection.</p> : null}
      </div>
    </Modal>
  );
}

/** "Scheduled emails": next run, last sent, last problem; Send now, Pause/Resume, Edit, Delete. */
export function ScheduledList({ kinds, offline }: { kinds: Kind[]; offline: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: gk.reportSchedules, queryFn: ({ signal }) => gov.reportSchedules({ signal }) });
  const [editing, setEditing] = useState<ReportSchedule | null>(null);
  const [deleting, setDeleting] = useState<ReportSchedule | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: gk.reportSchedules });
    void qc.invalidateQueries({ queryKey: qk.counts });
  };
  const act = async (s: ReportSchedule, run: () => Promise<{ message?: string | null } | unknown>, done: string) => {
    setBusy(s.id);
    try {
      const res = (await run()) as { message?: string | null } | undefined;
      toast('success', res?.message && res.message !== 'OK' ? res.message : done);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
      refresh();
    }
  };
  const rows = q.data?.data.schedules ?? [];
  if (!rows.length) return null;
  return (
    <section className="rounded-[12px] border border-line bg-surface">
      <div className="flex flex-col border-b border-line px-4 py-2.5">
        <h3 className="text-[14px] font-bold text-ink">Scheduled emails</h3>
        <span className="text-[12px] text-ink-3">{q.data?.data.can_see_all ? 'Everybody’s schedules — you manage Projects.' : 'Your schedules.'}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
          <thead className="bg-subtle text-[11.5px] text-ink-3">
            <tr>
              <th className="px-3 py-2 text-start font-semibold">Report</th>
              <th className="px-3 py-2 text-start font-semibold">When</th>
              <th className="px-3 py-2 text-start font-semibold">Next run</th>
              <th className="px-3 py-2 text-start font-semibold">Last sent</th>
              <th className="px-3 py-2 text-start font-semibold">Status</th>
              <th className="px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-t border-line/70 align-top">
                <td className="px-3 py-2">
                  <b className="text-ink">{s.title}</b>
                  <div className="text-[12px] text-ink-3">
                    {s.name ? `${s.kind_label} · ` : ''}
                    {s.dated ? s.range_label : 'As it stands'} · {FORMAT_LABEL[s.format] ?? s.format} · to {s.recipients.map((r) => r.name).join(', ')}
                    {s.company ? ` · ${s.company}` : ''}
                    {!s.mine ? ` · by ${s.owner.name}` : ''}
                  </div>
                  {s.last_error ? (
                    <p className="mt-1 text-[12px] text-danger">
                      <b>Problem:</b> {s.last_error}
                    </p>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-ink-2">
                  {cadence(s)}
                  <div className="text-[11.5px] text-ink-3">{s.timezone}</div>
                </td>
                <td className="px-3 py-2">
                  <Mono>{s.is_active ? fmtStamp(s.next_run_at) : '—'}</Mono>
                </td>
                <td className="px-3 py-2">
                  <Mono>{s.last_sent_at ? fmtStamp(s.last_sent_at) : 'Never'}</Mono>
                </td>
                <td className="px-3 py-2">
                  {!s.is_active ? <Tone tone="bg-subtle text-ink-2">Paused</Tone> : s.last_error ? <Tone tone="bg-warning-bg text-warning-ink">Needs attention</Tone> : <Tone tone="bg-success-bg text-success">Active</Tone>}
                </td>
                <td className="px-3 py-2 text-end whitespace-nowrap">
                  <div className="inline-flex gap-1">
                    <Button size="sm" disabled={offline || busy === s.id} title={offline ? WAITS : undefined} aria-label={`Send ${s.title} now`} onClick={() => void act(s, () => govWrite.sendReportScheduleNow(s.id), 'Sent')}>
                      Send now
                    </Button>
                    <Button size="sm" disabled={offline || busy === s.id} title={offline ? WAITS : undefined} aria-label={`${s.is_active ? 'Pause' : 'Resume'} ${s.title}`} onClick={() => void act(s, () => govWrite.updateReportSchedule(s.id, { is_active: !s.is_active }), s.is_active ? 'Paused' : 'Resumed')}>
                      {s.is_active ? 'Pause' : 'Resume'}
                    </Button>
                    <Button size="sm" disabled={offline} title={offline ? WAITS : undefined} aria-label={`Edit ${s.title}`} onClick={() => setEditing(s)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" disabled={offline || busy === s.id} title={offline ? WAITS : undefined} aria-label={`Delete ${s.title}`} onClick={() => setDeleting(s)}>
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing ? <ScheduleDialog kinds={kinds} editing={editing} offline={offline} onClose={() => setEditing(null)} /> : null}
      {deleting ? <ConfirmDialog title="Delete this scheduled email?" body={`${deleting.title} will no longer be sent.`} action="Delete" danger onClose={() => setDeleting(null)} onYes={() => void act(deleting, () => govWrite.deleteReportSchedule(deleting.id), 'Schedule deleted')} /> : null}
    </section>
  );
}
