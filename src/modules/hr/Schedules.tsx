import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import type { EmployeeRow } from './api';
import { dayLong, ymd } from './dates';
import { btn, btnPrimary, Empty, Field, input, PageHead, Panel, Seg, Sheet, SidePanel, StatusChip } from './parts';

/**
 * Work schedules (HrSchedules; the web's WorkSchedules): the company's
 * working patterns — days, hours, breaks and the grace rules attendance is
 * judged by — who each applies to, and its history. Changing a pattern's
 * timing makes a new version from a start day, so past attendance keeps the
 * rules it was judged by; a start day already passed has to be confirmed.
 * Writing needs `hr.schedule.manage` itself (hr.manage does not imply it).
 */
interface Day {
  weekday: number;
  name: string;
  is_working: boolean;
  starts_at: string | null;
  ends_at: string | null;
  crosses_midnight?: boolean;
  grace_minutes?: number | null;
  required_minutes: number | null;
}
interface Brk {
  name: string;
  weekday: number | null;
  starts_at: string | null;
  ends_at: string | null;
  minutes: number | null;
  is_paid: boolean;
}
interface Summary {
  id: number;
  name: string;
  code: string | null;
  description: string | null;
  status: 'active' | 'inactive' | 'archived';
  is_default: boolean;
  employees: number;
  departments: number;
  current: { version_id: number; effective_from: string; effective_to: string | null; flexible: boolean; grace_minutes: number; overtime_after: number | null; days: Day[]; breaks: Brk[] } | null;
}
interface Version {
  id: number;
  effective_from: string;
  effective_to: string | null;
  flexible: boolean;
  grace_minutes: number;
  early_grace_minutes: number | null;
  half_day_minutes: number | null;
  overtime_after: number | null;
  days: Day[];
  breaks: Brk[];
}
interface ListResponse {
  schedules: Summary[];
  weekdays: Record<string, string>;
  can_manage: boolean;
  unassigned: number;
  departments: Array<{ id: string | number; name: string }>;
}

const hm = (v: string | null | undefined) => (v ? v.slice(0, 5) : '');
const SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "Mon–Fri · 8:30–17:30 · lunch 45m" from the current version. */
export function patternLine(s: Summary): string {
  const c = s.current;
  if (!c) return 'No hours set yet';
  const on = c.days.filter((d) => d.is_working);
  if (!on.length) return 'No working days';
  const runs: string[] = [];
  let start = on[0]!.weekday;
  let prev = start;
  for (const d of on.slice(1).concat([{ weekday: 99 } as Day])) {
    if (d.weekday !== prev + 1) {
      runs.push(start === prev ? SHORT[start]! : `${SHORT[start]}–${SHORT[prev]}`);
      start = d.weekday;
    }
    prev = d.weekday;
  }
  const first = on[0]!;
  const same = on.every((d) => d.starts_at === first.starts_at && d.ends_at === first.ends_at);
  const hours = same ? `${hm(first.starts_at)}–${hm(first.ends_at)}` : 'hours vary by day';
  const brk = c.breaks.length === 1 ? `${c.breaks[0]!.name.toLowerCase()} ${c.breaks[0]!.minutes ?? ''}m` : c.breaks.length ? `${c.breaks.length} breaks` : null;
  return [runs.join(', '), hours, c.flexible ? 'flexible' : null, brk, on.some((d) => d.crosses_midnight) ? 'runs past midnight' : null].filter(Boolean).join(' · ');
}

export default function Schedules() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [assigning, setAssigning] = useState<Summary | null>(null);
  const [history, setHistory] = useState<Summary | null>(null);
  const q = useQuery({ queryKey: ['hr', 'schedules'], queryFn: ({ signal }) => apiGet<ListResponse>('/api/hr/schedules', undefined, signal) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['hr', 'schedules'] });
  const act = async (path: string, done: string, body: unknown = {}, method: 'POST' | 'DELETE' = 'POST') => {
    try {
      if (method === 'DELETE') await apiDelete(path);
      else await apiPost(path, body);
      toast('success', done);
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data!;
  const manage = d.can_manage;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5">
      <PageHead title="Work schedules" sub={d.unassigned ? `${d.unassigned} ${d.unassigned === 1 ? 'person follows' : 'people follow'} the company default` : 'The working patterns attendance is judged by.'}>
        {manage ? (
          <button type="button" className={btnPrimary} onClick={() => setEditing('new')}>
            Create schedule
          </button>
        ) : null}
      </PageHead>
      <div className={cx('grid min-h-0 flex-1 gap-3.5', editing ? 'grid-cols-[1fr_1.15fr]' : 'grid-cols-1')}>
        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto scroll-thin">
          {d.schedules.map((s) => (
            <div key={s.id} className={cx('flex flex-col gap-[5px] rounded-[12px] bg-surface px-3.5 py-3', editing === s.id ? 'border-2 border-primary' : 'border border-line', s.status !== 'active' && 'opacity-70')}>
              <div className="flex flex-wrap items-center gap-1.5">
                <b className="mr-1 text-ink">{s.name}</b>
                {s.is_default ? <StatusChip>Default</StatusChip> : null}
                {s.current?.flexible ? <StatusChip className="!bg-[#F1EAFB] !text-[#5B2FA0] dark:!bg-[#2A1F45] dark:!text-[#C4A8F0]">Flexible</StatusChip> : null}
                {s.status !== 'active' ? <StatusChip>{s.status === 'archived' ? 'Archived' : 'Inactive'}</StatusChip> : null}
                <span className="rounded-[9px] bg-subtle px-[7px] py-px text-[11px] font-bold text-ink-2">
                  {s.employees} {s.employees === 1 ? 'employee' : 'employees'}
                  {s.departments ? ` · ${s.departments} dept` : ''}
                </span>
              </div>
              <span className="text-[12.5px] text-ink-2">{patternLine(s)}</span>
              <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] font-semibold text-primary">
                <button type="button" className="hover:underline" onClick={() => setHistory(s)}>
                  History
                </button>
                {manage ? (
                  <>
                    <button type="button" className="hover:underline" onClick={() => setEditing(s.id)}>
                      Edit
                    </button>
                    {s.status === 'active' ? (
                      <button type="button" className="hover:underline" onClick={() => setAssigning(s)}>
                        Assign
                      </button>
                    ) : null}
                    <button type="button" className="hover:underline" onClick={() => void act(`/api/hr/schedules/${s.id}/duplicate`, 'Duplicated.')}>
                      Duplicate
                    </button>
                    {!s.is_default && s.status === 'active' ? (
                      <button type="button" className="hover:underline" onClick={() => void act(`/api/hr/schedules/${s.id}/default`, `${s.name} is now the default.`)}>
                        Set default
                      </button>
                    ) : null}
                    {s.status === 'active' && !s.is_default ? (
                      <button type="button" className="hover:underline" onClick={() => void act(`/api/hr/schedules/${s.id}/archive`, 'Deactivated. Open assignments end yesterday.')}>
                        Deactivate
                      </button>
                    ) : s.status !== 'active' ? (
                      <button type="button" className="hover:underline" onClick={() => void act(`/api/hr/schedules/${s.id}/activate`, 'Active again.')}>
                        Activate
                      </button>
                    ) : null}
                    {!s.employees && !s.departments && !s.is_default ? (
                      <button type="button" className="text-danger hover:underline" onClick={() => void act(`/api/hr/schedules/${s.id}`, 'Deleted.', undefined, 'DELETE')}>
                        Delete
                      </button>
                    ) : null}
                  </>
                ) : null}
              </span>
            </div>
          ))}
          {!d.schedules.length ? <Empty text="No schedules yet. Everyone follows the company's default hours." /> : null}
        </div>
        {editing ? <Editor key={String(editing)} id={editing === 'new' ? null : editing} weekdays={d.weekdays} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), refresh())} /> : null}
      </div>
      {assigning ? <Assign s={assigning} departments={d.departments} onClose={() => setAssigning(null)} onDone={refresh} /> : null}
      {history ? <History s={history} onClose={() => setHistory(null)} /> : null}
    </div>
  );
}

interface DayForm {
  weekday: number;
  on: boolean;
  a: string;
  b: string;
}
interface BreakForm {
  name: string;
  a: string;
  b: string;
  paid: boolean;
}

function minutesBetween(a: string, b: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(a) || !/^\d{2}:\d{2}$/.test(b)) return null;
  const m = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  let d = m(b) - m(a);
  if (d <= 0) d += 1440;
  return d;
}

function Editor({ id, weekdays, onClose, onSaved }: { id: number | null; weekdays: Record<string, string>; onClose: () => void; onSaved: () => void }) {
  const q = useQuery({ queryKey: ['hr', 'schedule', id], queryFn: ({ signal }) => apiGet<Summary & { versions: Version[] }>(`/api/hr/schedules/${id}`, undefined, signal), enabled: id !== null });
  if (id !== null && q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  return <EditorForm s={q.data ?? null} weekdays={weekdays} onClose={onClose} onSaved={onSaved} />;
}

function EditorForm({ s, weekdays, onClose, onSaved }: { s: (Summary & { versions: Version[] }) | null; weekdays: Record<string, string>; onClose: () => void; onSaved: () => void }) {
  const v = s?.versions?.find((x) => x.effective_to === null) ?? s?.versions?.[0];
  const base = v ?? s?.current ?? null;
  const today = ymd(new Date());
  const [name, setName] = useState(s?.name ?? '');
  const [description, setDescription] = useState(s?.description ?? '');
  const [days, setDays] = useState<DayForm[]>(() =>
    [1, 2, 3, 4, 5, 6, 7].map((w) => {
      const d = base?.days.find((x) => x.weekday === w);
      return d ? { weekday: w, on: d.is_working, a: hm(d.starts_at) || '08:30', b: hm(d.ends_at) || '17:30' } : { weekday: w, on: w <= 5, a: '08:30', b: '17:30' };
    }),
  );
  const [breaks, setBreaks] = useState<BreakForm[]>(() => (base?.breaks ?? []).filter((b, i, all) => all.findIndex((x) => x.name === b.name && x.starts_at === b.starts_at) === i).map((b) => ({ name: b.name, a: hm(b.starts_at), b: hm(b.ends_at), paid: b.is_paid })));
  const [grace, setGrace] = useState(String(base?.grace_minutes ?? 15));
  const [early, setEarly] = useState(String(v?.early_grace_minutes ?? 10));
  const [overtime, setOvertime] = useState(base?.overtime_after == null ? '' : String(base.overtime_after / 60));
  const [half, setHalf] = useState(v?.half_day_minutes == null ? '' : String(v.half_day_minutes / 60));
  const [from, setFrom] = useState(today);
  const [flexible, setFlexible] = useState(!!base?.flexible);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const breakMinutes = (d: DayForm) => breaks.filter((b) => !b.paid).reduce((n, b) => n + (minutesBetween(b.a, b.b) ?? 0), 0) * (d.on ? 1 : 0);
  const required = (d: DayForm) => {
    const m = minutesBetween(d.a, d.b);
    return m == null ? null : Math.max(0, m - breakMinutes(d));
  };
  const body = (confirm: boolean) => ({
    name: name.trim(),
    description: description.trim() || null,
    flexible,
    grace_minutes: Number(grace) || 0,
    early_grace_minutes: Number(early) || 0,
    half_day_minutes: half.trim() === '' ? null : Math.round(Number(half) * 60),
    overtime_after: overtime.trim() === '' ? null : Math.round(Number(overtime) * 60),
    effective_from: from,
    days: days.map((d) => ({ weekday: d.weekday, is_working: d.on, starts_at: d.on ? d.a : null, ends_at: d.on ? d.b : null, required_minutes: d.on ? required(d) : null })),
    breaks: breaks.filter((b) => b.name.trim() && b.a && b.b).map((b) => ({ name: b.name.trim(), starts_at: b.a, ends_at: b.b, is_paid: b.paid, minutes: minutesBetween(b.a, b.b) })),
    ...(confirm ? { confirm: true } : {}),
  });
  const save = async (confirm = false) => {
    if (!name.trim()) return toast('error', 'A schedule needs a name.');
    setBusy(true);
    try {
      if (s) await apiPut(`/api/hr/schedules/${s.id}`, body(confirm));
      else await apiPost('/api/hr/schedules', body(confirm));
      toast('success', s ? 'Saved. Attendance from the start day is judged by these hours.' : 'Schedule created.');
      onSaved();
    } catch (e) {
      // A start day in the past re-judges days already worked: the server asks first.
      if (e instanceof ApiError && e.status === 409) setConfirming(e.message);
      else toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const setDay = (w: number, patch: Partial<DayForm>) => setDays((all) => all.map((d) => (d.weekday === w ? { ...d, ...patch } : d)));

  return (
    <Panel
      title={s ? `Edit · ${s.name}` : 'New schedule'}
      action={
        <span className="flex gap-2">
          <button type="button" className={btn + ' !h-[30px]'} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={busy} className={btnPrimary + ' !h-[30px]'} onClick={() => void save()}>
            Save
          </button>
        </span>
      }
      bodyClassName="flex flex-col gap-3 px-3.5 py-3"
    >
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Schedule name">
          <input aria-label="Schedule name" value={name} onChange={(e) => setName(e.target.value)} className={input} />
        </Field>
        <Field label="Description">
          <input aria-label="Description" value={description} onChange={(e) => setDescription(e.target.value)} className={input} />
        </Field>
      </div>
      <b className="text-ink">Working days and hours</b>
      <div className="flex flex-col gap-1.5">
        {days.map((d) => {
          const req = required(d);
          return (
            <div key={d.weekday} className="flex items-center gap-2">
              <label className="flex w-[70px] items-center gap-1.5 font-semibold text-ink">
                <input type="checkbox" aria-label={`${weekdays[String(d.weekday)] ?? SHORT[d.weekday]} is a working day`} checked={d.on} onChange={(e) => setDay(d.weekday, { on: e.target.checked })} className="accent-primary" />
                {SHORT[d.weekday]}
              </label>
              <input type="time" aria-label={`${SHORT[d.weekday]} starts`} value={d.a} disabled={!d.on} onChange={(e) => setDay(d.weekday, { a: e.target.value })} className={input + ' !w-[110px]'} />
              <span className="text-ink-3">–</span>
              <input type="time" aria-label={`${SHORT[d.weekday]} ends`} value={d.b} disabled={!d.on} onChange={(e) => setDay(d.weekday, { b: e.target.value })} className={input + ' !w-[110px]'} />
              <span className="text-[12px] text-ink-3">{d.on ? (req == null ? '—' : `${req} mins req.${d.b <= d.a ? ' · past midnight' : ''}`) : 'Off'}</span>
            </div>
          );
        })}
        <button
          type="button"
          className="self-start text-[12.5px] font-semibold text-primary hover:underline"
          onClick={() => {
            const first = days.find((d) => d.on);
            if (first) setDays((all) => all.map((d) => (d.on ? { ...d, a: first.a, b: first.b } : d)));
          }}
        >
          Apply the first day's hours to every working day
        </button>
      </div>
      <b className="text-ink">Breaks</b>
      <div className="flex flex-col gap-1.5">
        {breaks.map((b, i) => (
          <div key={i} className="flex items-center gap-2">
            <input aria-label="Break name" value={b.name} onChange={(e) => setBreaks((all) => all.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className={input + ' !w-[130px]'} />
            <input type="time" aria-label="Break starts" value={b.a} onChange={(e) => setBreaks((all) => all.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))} className={input + ' !w-[110px]'} />
            <input type="time" aria-label="Break ends" value={b.b} onChange={(e) => setBreaks((all) => all.map((x, j) => (j === i ? { ...x, b: e.target.value } : x)))} className={input + ' !w-[110px]'} />
            <label className="flex items-center gap-1 text-[12.5px] text-ink">
              <input type="checkbox" checked={b.paid} onChange={(e) => setBreaks((all) => all.map((x, j) => (j === i ? { ...x, paid: e.target.checked } : x)))} className="accent-primary" /> paid
            </label>
            <button type="button" aria-label="Remove break" className="text-[12px] font-semibold text-danger hover:underline" onClick={() => setBreaks((all) => all.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        ))}
        <button type="button" className="self-start text-[12.5px] font-semibold text-primary hover:underline" onClick={() => setBreaks((all) => [...all, { name: all.length ? 'Break' : 'Lunch', a: '12:30', b: '13:15', paid: false }])}>
          Add a break
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        <Field label="Late grace (min)">
          <input aria-label="Late grace" type="number" min={0} value={grace} onChange={(e) => setGrace(e.target.value)} className={input} />
        </Field>
        <Field label="Early-leave grace (min)">
          <input aria-label="Early-leave grace" type="number" min={0} value={early} onChange={(e) => setEarly(e.target.value)} className={input} />
        </Field>
        <Field label="Overtime after (h)" hint="Blank: the company's rule.">
          <input aria-label="Overtime after" type="number" min={0} step={0.25} value={overtime} onChange={(e) => setOvertime(e.target.value)} className={input} />
        </Field>
        <Field label="Half day below (h)">
          <input aria-label="Half day below" type="number" min={0} step={0.25} value={half} onChange={(e) => setHalf(e.target.value)} className={input} />
        </Field>
        <Field label="These hours start on" hint={s ? 'Earlier days keep the hours they had.' : undefined}>
          <input aria-label="These hours start on" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} />
        </Field>
        <Field label="Flexible hours">
          <label className="flex h-[34px] items-center gap-2 font-medium text-ink">
            <input type="checkbox" aria-label="Flexible" checked={flexible} onChange={(e) => setFlexible(e.target.checked)} className="accent-primary" /> Flexible
          </label>
        </Field>
      </div>
      {confirming ? (
        <Sheet
          title="Change days already worked?"
          width={460}
          onClose={() => setConfirming(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setConfirming(null)}>
                Cancel
              </button>
              <button type="button" className={btnPrimary} onClick={() => (setConfirming(null), void save(true))}>
                Yes, from {dayLong(from)}
              </button>
            </>
          }
        >
          <div className="text-[12.5px] whitespace-pre-line text-ink-2">{confirming}</div>
        </Sheet>
      ) : null}
    </Panel>
  );
}

function Assign({ s, departments, onClose, onDone }: { s: Summary; departments: Array<{ id: string | number; name: string }>; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [scope, setScope] = useState<'employee' | 'department'>('employee');
  const [from, setFrom] = useState(ymd(new Date()));
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState<string | null>(null);
  const people = useQuery({ queryKey: ['hr', 'employees'], queryFn: ({ signal }) => apiGet<EmployeeRow[]>('/api/hr/employees', undefined, signal) });
  const current = useQuery({
    queryKey: ['hr', 'schedule-assignments', s.id],
    queryFn: ({ signal }) => apiGet<{ assignments: Array<{ id: number; scope: string; scope_id: number; target: string; effective_from: string; effective_to: string | null }> }>('/api/hr/schedules/assignments', { schedule_id: s.id }, signal),
  });
  const live = (current.data?.assignments ?? []).filter((a) => !a.effective_to || a.effective_to >= ymd(new Date()));
  const t = q.trim().toLowerCase();
  const options = scope === 'employee' ? (people.data ?? []).filter((p) => !p.exit_at || p.exit_at >= ymd(new Date())).map((p) => ({ id: p.id, name: p.name ?? p.employee_no })) : departments.map((d) => ({ id: Number(d.id), name: d.name }));
  const shown = options.filter((o) => !t || o.name.toLowerCase().includes(t));
  const assign = async (confirm = false) => {
    try {
      const r = await apiPost<{ assigned: number }>('/api/hr/schedules/assign', { schedule_id: s.id, scope, ids: [...picked], effective_from: from, ...(confirm ? { confirm: true } : {}) });
      toast('success', `${r.assigned} assigned from ${dayLong(from)}.`);
      setPicked(new Set());
      void qc.invalidateQueries({ queryKey: ['hr', 'schedule-assignments', s.id] });
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConfirming(e.message);
      else toast('error', errorMessage(e));
    }
  };
  const end = async (id: number) => {
    try {
      await apiDelete(`/api/hr/schedules/assignments/${id}`);
      toast('success', 'Assignment ended.');
      void qc.invalidateQueries({ queryKey: ['hr', 'schedule-assignments', s.id] });
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <SidePanel label="Assign" width={520} onClose={onClose} head={<b className="text-ink">Assign · {s.name}</b>}>
      <Seg label="Assign to" value={scope} onChange={(v) => (setScope(v), setPicked(new Set()))} options={[{ id: 'employee', label: 'Employees' }, { id: 'department', label: 'Departments' }]} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="From">
          <input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} className={input} />
        </Field>
        <Field label="Search">
          <input aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} className={input} />
        </Field>
      </div>
      {live.length ? (
        <div className="flex flex-col gap-1 rounded-[9px] bg-ground px-3 py-2 text-[12.5px]">
          <b className="text-ink">Already assigned</b>
          {live.map((a) => (
            <span key={a.id} className="flex items-center gap-2 text-ink-2">
              <span className="min-w-0 flex-1 truncate">
                {a.target} · from {dayLong(a.effective_from)}
                {a.effective_to ? ` to ${dayLong(a.effective_to)}` : ''}
              </span>
              <button type="button" className="font-semibold text-danger hover:underline" onClick={() => void end(a.id)}>
                End
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex max-h-[360px] flex-col overflow-y-auto rounded-[9px] border border-line scroll-thin">
        {shown.map((o) => (
          <label key={o.id} className="flex items-center gap-2 border-b border-line/70 px-3 py-[7px] text-[12.5px] text-ink last:border-b-0">
            <input type="checkbox" checked={picked.has(o.id)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(o.id); else n.delete(o.id); return n; })} className="accent-primary" />
            {o.name}
          </label>
        ))}
        {!shown.length ? <Empty text="Nobody matches." /> : null}
      </div>
      <button type="button" disabled={!picked.size} className={btnPrimary + ' self-end'} onClick={() => void assign()}>
        Assign {picked.size || ''}
      </button>
      {confirming ? (
        <Sheet title="Assign from a day already passed?" width={440} onClose={() => setConfirming(null)} footer={<><button type="button" className={btn} onClick={() => setConfirming(null)}>Cancel</button><button type="button" className={btnPrimary} onClick={() => (setConfirming(null), void assign(true))}>Yes, assign</button></>}>
          <div className="text-[12.5px] whitespace-pre-line text-ink-2">{confirming}</div>
        </Sheet>
      ) : null}
    </SidePanel>
  );
}

function History({ s, onClose }: { s: Summary; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['hr', 'schedule-audit', s.id],
    queryFn: ({ signal }) => apiGet<{ entries: Array<{ id: number; action: string; field: string | null; old_value: string | null; new_value: string | null; note: string | null; affected: number; at: string; by: string | null }> }>(`/api/hr/schedules/${s.id}/audit`, { limit: 100 }, signal),
  });
  return (
    <SidePanel label="History" width={520} onClose={onClose} head={<b className="text-ink">History · {s.name}</b>}>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {(q.data?.entries ?? []).map((e) => (
        <div key={e.id} className="flex flex-col border-b border-line/70 pb-2 text-[12.5px] last:border-b-0">
          <span className="text-ink">
            <b>{e.action.replace(/_/g, ' ')}</b>
            {e.field ? ` · ${e.field.replace(/_/g, ' ')}` : ''}
            {e.old_value || e.new_value ? `: ${e.old_value ?? '—'} → ${e.new_value ?? '—'}` : ''}
          </span>
          <span className="text-[11.5px] text-ink-3">
            {e.by ?? 'Someone'} · {new Date(`${e.at.replace(' ', 'T')}Z`).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
            {e.affected ? ` · ${e.affected} affected` : ''}
            {e.note ? ` · “${e.note}”` : ''}
          </span>
        </div>
      ))}
      {q.data && !q.data.entries.length ? <Empty text="No changes recorded." /> : null}
    </SidePanel>
  );
}
