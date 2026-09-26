import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../core/api';
import { openOverlay } from '../../core/ui';
import { ErrorNote, Spinner } from '../../components/ui';
import { attendanceTime, dayPhase, useAttendance } from './attendance';
import { dayStatus, type AttDay, type AttTotals, type Profile } from './api';
import { dayShort, minutesLabel, monthLabel, shiftMonth, ymd } from './dates';
import { btn, btnPrimary, Cell, Empty, Kpi, PageHead, row, StatusChip, THead } from './parts';
import type { HrView } from './Rail';
import { NewRequestSheet } from './Requests';

/**
 * My attendance (HrMyAttendance): today — clocked in when and where, still
 * working or done — the month's totals, and the day-by-day history, each day
 * with a way to ask for a correction. Clocking in, out and breaks happen in
 * the title bar's attendance popover, which these buttons open, so there is
 * one flow for them everywhere.
 */
export default function MyAttendance({ onPick }: { onPick: (v: HrView) => void }) {
  const qc = useQueryClient();
  const { a, today } = useAttendance();
  const phase = dayPhase(today);
  const [month, setMonth] = useState(() => ymd(new Date()).slice(0, 7));
  const [correcting, setCorrecting] = useState<AttDay | null>(null);
  const from = `${month}-01`;
  const last = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const to = `${month}-${String(last).padStart(2, '0')}`;
  const history = useQuery({ queryKey: ['hr', 'attendance-history', from, to], queryFn: ({ signal }) => apiGet<{ records: AttDay[]; totals: AttTotals }>('/api/hr/attendance/history', { from, to }, signal) });
  const me = useQuery({ queryKey: ['hr', 'me'], queryFn: ({ signal }) => apiGet<Profile>('/api/hr/me/profile', undefined, signal) });
  const t = history.data?.totals;
  const records = [...(history.data?.records ?? [])].sort((x, y) => y.on_date.localeCompare(x.on_date));
  const hhmm = (s: string | null) => (s ? (/[T ](\d{2}:\d{2})/.exec(s)?.[1] ?? '') : '');

  if (a && !a.linked) return <Empty text="Your login is not linked to an employee record, so there is no attendance to show." />;

  return (
    <div className="flex flex-col gap-3.5">
      <PageHead title="My attendance" sub={new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}>
        {phase === 'working' || phase === 'break' ? (
          <button type="button" className={btn} onClick={() => openOverlay('clock')}>
            {phase === 'break' ? 'Resume' : 'Break'}
          </button>
        ) : null}
        <button type="button" className={btnPrimary} onClick={() => openOverlay('clock')}>
          {phase === 'none' ? 'Check in' : phase === 'done' ? 'Today’s attendance' : 'Check out'}
        </button>
      </PageHead>
      <div className="grid grid-cols-6 gap-2.5">
        <div className="col-span-2 flex gap-[18px] rounded-[12px] border border-line bg-surface px-3.5 py-3">
          <div className="flex flex-col">
            <span className="text-[12px] font-semibold text-ink-3">Check in</span>
            <b className="text-[21px] text-ink">{today?.check_in ? attendanceTime(today.check_in) : '—'}</b>
            <span className="text-[11.5px] text-ink-3">{today?.work_location ?? (today?.check_in ? '' : 'Not yet')}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[12px] font-semibold text-ink-3">Check out</span>
            <b className="text-[21px] text-ink-3">{today?.check_out ? <span className="text-ink">{attendanceTime(today.check_out)}</span> : '—'}</b>
            {phase !== 'none' ? <StatusChip className="self-start">{phase === 'working' ? 'Working' : phase === 'break' ? 'On break' : 'Complete'}</StatusChip> : null}
          </div>
        </div>
        <Kpi label="This month" value={t ? `${t.days_present} days` : '—'} sub={t ? `${t.days_present} days of ${t.work_days} working days` : undefined} />
        <Kpi label="Hours worked" value={t ? `${Math.round(t.net_seconds / 3600)} h` : '—'} />
        <Kpi label="Overtime" value={t ? `${Math.round(t.overtime_minutes / 60)} h` : '—'} />
        <Kpi label="Attendance" value={t?.attendance_rate != null ? `${Math.round(t.attendance_rate)}%` : '—'} tone={t?.attendance_rate != null && t.attendance_rate >= 90 ? 'green' : undefined} sub={t && t.late_days ? `${t.late_days} late · ${t.missing_check_outs} missing check-out` : undefined} />
      </div>
      <div className="flex items-center gap-2">
        <b className="flex-1 text-[15px] text-ink">History</b>
        <button type="button" className={btn + ' !h-[30px] !px-2'} aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
          ←
        </button>
        <select aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-[34px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink">
          {Array.from({ length: 12 }, (_, i) => shiftMonth(ymd(new Date()).slice(0, 7), -i)).map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
        <button type="button" className={btn + ' !h-[30px] !px-2'} aria-label="Next month" disabled={month >= ymd(new Date()).slice(0, 7)} onClick={() => setMonth(shiftMonth(month, 1))}>
          →
        </button>
        <button type="button" className={btn} onClick={() => onPick('timesheet')}>
          Timesheet
        </button>
      </div>
      <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
        <THead cols={[['Date', 110], ['In', 70], ['Out', 70], ['Break', 60], ['Net', 70], ['Location', null], ['Status', 170], ['', 120]]} />
        {history.isLoading ? <Spinner /> : history.error ? <div className="p-3"><ErrorNote error={history.error} onRetry={() => void history.refetch()} /></div> : null}
        {history.data && !records.length ? <Empty text="Nothing recorded this month." /> : null}
        {records.map((d) => (
          <div key={d.on_date} className={row}>
            <Cell w={110} className="font-semibold">{dayShort(d.on_date)}</Cell>
            <Cell w={70}>{d.check_in ? attendanceTime(d.check_in) : '—'}</Cell>
            <Cell w={70}>{d.check_out ? attendanceTime(d.check_out) : '—'}</Cell>
            <Cell w={60}>{d.check_in && d.break_seconds ? minutesLabel(d.break_seconds / 60) : '—'}</Cell>
            <Cell w={70}>{d.check_out && d.net_seconds != null ? minutesLabel(d.net_seconds / 60) : '—'}</Cell>
            <Cell w={null} className="text-[12px] text-ink-2">{d.work_location ?? (d.holiday && !d.check_in ? d.holiday : '')}</Cell>
            <Cell w={170}>
              <StatusChip>{dayStatus(d)}</StatusChip>
            </Cell>
            <span className="w-[120px] shrink-0 text-right">
              {me.data?.employee?.id && (d.check_in || d.is_work_day) ? (
                <button type="button" className="text-[12px] font-semibold text-primary hover:underline" onClick={() => setCorrecting(d)}>
                  Ask to correct
                </button>
              ) : null}
            </span>
          </div>
        ))}
      </div>
      {correcting && me.data?.employee ? (
        <NewRequestSheet
          employeeId={me.data.employee.id}
          initial={{ kind: 'attendance', on_date: correcting.on_date, check_in: hhmm(correcting.check_in), check_out: hhmm(correcting.check_out) }}
          onClose={() => setCorrecting(null)}
          onDone={() => (setCorrecting(null), void qc.invalidateQueries({ queryKey: ['hr'] }))}
        />
      ) : null}
    </div>
  );
}
