import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { app } from '../../core/app-state';
import { apiGet } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner } from '../../components/ui';
import { attendanceTime } from './attendance';
import { STATE_LABEL, type AttendanceReport, type RosterResponse } from './api';
import { dayShort, minutesLabel, ymd } from './dates';
import { btn, Cell, Empty, input, Kpi, PageHead, Panel, row, StatusChip, THead } from './parts';
import { can } from './Rail';
import { Select } from '../../components/Select';
import { StatGrid } from '../../components/StatCard';

/**
 * Reports (HrReports; the web's AttendanceReports): attendance over a period
 * — the totals, a line per employee, and the days the chosen kind keeps
 * (late arrivals, early departures, absence, missing check-outs, remote).
 * The server narrows it to whoever I may see; people who may see only
 * themselves get their own. Export CSV saves the same report to Downloads.
 */
type Kind = 'summary' | 'late' | 'early' | 'overtime' | 'absence' | 'missing' | 'remote';

const KINDS: Array<[Kind, string]> = [
  ['summary', 'Everything'],
  ['late', 'Late arrivals'],
  ['early', 'Early departures'],
  ['overtime', 'Overtime'],
  ['absence', 'Absence'],
  ['missing', 'Missing check-outs'],
  ['remote', 'Remote and off-site'],
];

function detailStatus(r: AttendanceReport['rows'][number]): string {
  if (r.holiday && !r.check_in) return 'Holiday';
  if (r.leave_type) return `On leave · ${r.leave_type}`;
  if (r.state === 'missing_check_out') return 'No check-out';
  if (r.late_minutes > 0) return 'Late';
  if (r.early_minutes > 0) return 'Early leave';
  if (r.state === 'complete') return 'Present';
  return STATE_LABEL[r.state] ?? r.state;
}

export default function Reports() {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const manage = can(perms, 'hr.manage');
  const today = ymd(new Date());
  const [kind, setKind] = useState<Kind>('summary');
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [dept, setDept] = useState('');
  const params = { type: kind, from, to, department_id: dept || undefined };
  const q = useQuery({
    queryKey: ['hr', 'report', kind, from, to, dept],
    queryFn: ({ signal }) => apiGet<AttendanceReport>('/api/hr/reports/attendance', params, signal),
    enabled: !!from && !!to && from <= to,
    placeholderData: (prev) => prev,
  });
  // The department list rides on today's roster, as on the web.
  const depts = useQuery({ queryKey: ['hr', 'roster', 'departments'], queryFn: ({ signal }) => apiGet<RosterResponse>('/api/hr/attendance', undefined, signal), enabled: manage, staleTime: 300_000 });
  const d = q.data;
  const t = d?.totals;

  const exportCsv = async () => {
    try {
      await call('transfers:download', { hrReport: { type: kind, from, to, ...(dept ? { department_id: Number(dept) } : {}) }, name: `attendance-${kind}-${from}-to-${to}.csv`, open: false });
      toast('success', 'Saving the report to Downloads.');
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  return (
    <div className="flex flex-col gap-3.5">
      <PageHead title="Reports" sub="Attendance">
        <button type="button" className={btn} disabled={!d} onClick={() => void exportCsv()}>
          Export CSV
        </button>
      </PageHead>
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Report" value={kind} onChange={(e) => setKind(e.target.value as Kind)} className={input + ' !w-auto'}>
          {KINDS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <input type="date" aria-label="From" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={input + ' !w-[150px]'} />
        <span className="text-ink-3">to</span>
        <input type="date" aria-label="To" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={input + ' !w-[150px]'} />
        {manage ? (
          <Select aria-label="Department" value={dept} onChange={(e) => setDept(e.target.value)} className={input + ' !w-auto'}>
            <option value="">All departments</option>
            {(depts.data?.departments ?? []).map((x) => (
              <option key={String(x.id)} value={String(x.id)}>
                {x.name}
              </option>
            ))}
          </Select>
        ) : null}
      </div>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {t ? (
        <StatGrid min={160}>
          <Kpi icon="calendar" tone="blue" label="Days" value={t.work_days} />
          <Kpi icon="user-check" label="Present" value={t.present} tone="green" />
          <Kpi icon="user-x" label="Absent" value={t.absent} tone={t.absent ? 'red' : undefined} />
          <Kpi icon="plane" tone="violet" label="Leave" value={t.leave} />
          <Kpi icon="snooze" label="Late" value={t.late} tone={t.late ? 'amber' : undefined} />
          <Kpi icon="logout" tone="cyan" label="Early" value={t.early} />
          <Kpi icon="door" label="No check-out" value={t.missing_check_outs} tone={t.missing_check_outs ? 'red' : undefined} />
        </StatGrid>
      ) : null}
      {d ? (
        <>
          <Panel title="By employee" sub={t?.attendance_rate != null ? `Attendance rate ${t.attendance_rate}% · ${minutesLabel(t.net_seconds / 60)} worked · ${minutesLabel(t.overtime_minutes)} overtime` : undefined}>
            <THead cols={[['Employee', null], ['Present', 70], ['Absent', 70], ['Leave', 60], ['Late', 55], ['Hours', 80], ['Overtime', 80], ['Rate', 60]]} />
            {d.by_employee.map((e) => (
              <div key={e.label} className={row}>
                <Cell w={null} className="font-semibold">{e.label}</Cell>
                <Cell w={70} className="tabular-nums">{e.present}</Cell>
                <Cell w={70} className="tabular-nums">{e.absent}</Cell>
                <Cell w={60} className="tabular-nums">{e.leave}</Cell>
                <Cell w={55} className="tabular-nums">{e.late}</Cell>
                <Cell w={80} className="tabular-nums">{Math.round(e.net_seconds / 3600)}h</Cell>
                <Cell w={80} className="tabular-nums">{Math.round(e.overtime_minutes / 60)}h</Cell>
                <Cell w={60} className="font-semibold tabular-nums">{e.attendance_rate == null ? '—' : `${e.attendance_rate}%`}</Cell>
              </div>
            ))}
            {!d.by_employee.length ? <Empty text="Nobody in this period." /> : null}
          </Panel>
          <Panel title="Detail" sub={`${d.rows.length} ${d.rows.length === 1 ? 'day' : 'days'}`}>
            <THead cols={[['Date', 100], ['Employee', null], ['In', 55], ['Out', 55], ['Net', 70], ['Late', 55], ['Overtime', 75], ['Status', 170]]} />
            {d.rows.map((r) => (
              <div key={`${r.employee_id}-${r.on_date}`} className={row}>
                <Cell w={100}>{dayShort(r.on_date)}</Cell>
                <Cell w={null} className="font-semibold">{r.employee}</Cell>
                <Cell w={55}>{r.check_in ? attendanceTime(r.check_in) : '—'}</Cell>
                <Cell w={55}>{r.check_out ? attendanceTime(r.check_out) : '—'}</Cell>
                <Cell w={70}>{r.check_out && r.net_seconds != null ? minutesLabel(r.net_seconds / 60) : '—'}</Cell>
                <Cell w={55}>{r.late_minutes > 0 ? `${r.late_minutes}m` : '—'}</Cell>
                <Cell w={75}>{r.overtime_minutes > 0 ? minutesLabel(r.overtime_minutes) : '—'}</Cell>
                <Cell w={170} className="!overflow-visible">
                  <StatusChip>{detailStatus(r)}</StatusChip>
                </Cell>
              </div>
            ))}
            {!d.rows.length ? <Empty text="No days of this kind in the period." /> : null}
          </Panel>
        </>
      ) : null}
    </div>
  );
}
