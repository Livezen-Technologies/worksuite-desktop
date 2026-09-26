import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../core/api';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { attendanceTime } from './attendance';
import type { OpenResponse, RosterDay } from './api';
import { CorrectAttendance } from './Correct';
import { dayShort } from './dates';
import { Cell, Empty, input, PageHead, row, StatusChip, THead } from './parts';

/**
 * Missing check-outs (HrAdminSheet; the web's OpenAttendanceReview): days
 * somebody checked in and never checked out, oldest first, with how long
 * each has waited since it was flagged and where its review stands. "Record
 * the time" is the attendance correction. Days that would be paid as a full
 * day without a finish time are called out, because payroll stops on them.
 */
const MODE_NOTE: Record<OpenResponse['mode'], string> = {
  incomplete: 'Days are flagged and left as they are. Nothing is written until somebody records the time.',
  shift_end: 'Days left unresolved are closed automatically at the scheduled end of the shift.',
  max_hours: 'Days left unresolved are closed automatically a fixed number of hours after the check-in.',
};

const STATE_ORDER = ['missing_check_out', 'pending', 'approved', 'rejected', 'auto_closed', 'corrected'];

export default function MissingCheckouts() {
  const qc = useQueryClient();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [dept, setDept] = useState('');
  const [state, setState] = useState('');
  const [q, setQ] = useState('');
  const [fixing, setFixing] = useState<RosterDay | null>(null);
  const queue = useQuery({
    queryKey: ['hr', 'open-attendance', from, to, dept, state, q.trim()],
    queryFn: ({ signal }) => apiGet<OpenResponse>('/api/hr/attendance/open', { from: from || undefined, to: to || undefined, department_id: dept || undefined, state: state || undefined, q: q.trim() || undefined }, signal),
    placeholderData: (prev) => prev,
  });
  const d = queue.data;
  const states = d?.states ?? {};

  return (
    <div className="flex flex-col gap-3.5">
      <PageHead title="Missing check-outs" sub="Days somebody checked in and never checked out, oldest first." />
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" aria-label="From" value={from || d?.from || ''} onChange={(e) => setFrom(e.target.value)} className={input + ' !w-[150px]'} />
        <span className="text-ink-3">to</span>
        <input type="date" aria-label="To" value={to || d?.to || ''} onChange={(e) => setTo(e.target.value)} className={input + ' !w-[150px]'} />
        <select aria-label="Department" value={dept} onChange={(e) => setDept(e.target.value)} className={input + ' !w-auto'}>
          <option value="">All departments</option>
          {(d?.departments ?? []).map((x) => (
            <option key={String(x.id)} value={String(x.id)}>
              {x.name}
            </option>
          ))}
        </select>
        <select aria-label="Review state" value={state} onChange={(e) => setState(e.target.value)} className={input + ' !w-auto'}>
          <option value="">Every state</option>
          {Object.entries(states).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or number" aria-label="Search name or number" className={input + ' !w-[220px]'} />
      </div>
      {d && d.holding_pay > 0 ? (
        <div className="rounded-[12px] border border-[#F5D9A8] bg-warning-bg px-4 py-3 text-[12.5px] text-[#7A3E06] dark:border-warning/40 dark:text-warning">
          <b>
            {d.holding_pay} {d.holding_pay === 1 ? 'day' : 'days'} would be paid without a recorded finish time.
          </b>{' '}
          A day with a check-in and no check-out counts as a full day worked; a payroll run covering any of these stops and asks somebody to accept it in writing.
        </div>
      ) : null}
      {d ? (
        <div className="grid grid-cols-6 gap-2">
          {STATE_ORDER.filter((k) => states[k] !== undefined || d.counts[k] !== undefined).map((k) => {
            const on = state === k;
            return (
              <button key={k} type="button" aria-pressed={on} onClick={() => setState(on ? '' : k)} className={cx('flex flex-col items-start gap-0.5 rounded-[10px] px-3 py-2 text-left', on ? 'border-2 border-primary bg-selection' : 'border border-line bg-surface hover:border-primary/40')}>
                <span className="text-[11.5px] text-ink-3">{states[k] ?? k}</span>
                <b className="text-[19px] text-ink tabular-nums">{d.counts[k] ?? 0}</b>
              </button>
            );
          })}
        </div>
      ) : null}
      {queue.isLoading ? <Spinner /> : queue.error ? <ErrorNote error={queue.error} onRetry={() => void queue.refetch()} /> : null}
      {d ? (
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <THead cols={[['Date', 110], ['Employee', null], ['Department', 130], ['In', 55], ['Out', 55], ['Waiting', 70], ['Review', 210], ['', 120]]} />
          {d.records.map((r) => {
            const s = r.open_state ?? 'missing_check_out';
            return (
              <div key={`${r.id}-${r.employee_id}-${r.on_date}`} className={row}>
                <Cell w={110}>{dayShort(r.on_date)}</Cell>
                <Cell w={null} className="font-semibold">
                  {r.name ?? `#${r.employee_id}`}
                  {r.employee_no ? <span className="ml-1.5 text-[11.5px] font-medium text-ink-3">{r.employee_no}</span> : null}
                </Cell>
                <Cell w={130} className="text-ink-2">{r.department ?? '—'}</Cell>
                <Cell w={55}>{r.check_in ? attendanceTime(r.check_in) : '—'}</Cell>
                <Cell w={55}>{r.check_out ? attendanceTime(r.check_out) : '—'}</Cell>
                <Cell w={70} className="tabular-nums">{r.waiting_days == null ? '—' : `${r.waiting_days} ${r.waiting_days === 1 ? 'day' : 'days'}`}</Cell>
                <Cell w={210} className="!overflow-visible">
                  <span className="flex items-center gap-1.5">
                    <StatusChip>{`${states[s] ?? s}${r.holds_pay ? ' · holds pay' : ''}`}</StatusChip>
                    {r.resolved_by_name ? <span className="truncate text-[11px] text-ink-3">by {r.resolved_by_name}</span> : null}
                  </span>
                </Cell>
                <span className="w-[120px] shrink-0 text-right">
                  <button type="button" className="text-[12.5px] font-bold text-primary hover:underline" onClick={() => setFixing(r)}>
                    Record the time
                  </button>
                </span>
              </div>
            );
          })}
          {!d.records.length ? <Empty text="Nothing is waiting for review in that range." /> : null}
        </div>
      ) : null}
      {d ? (
        <div className="text-[12.5px] text-ink-2">
          <b className="text-ink">How unresolved days are handled</b> — {MODE_NOTE[d.mode]}
        </div>
      ) : null}
      {fixing ? <CorrectAttendance day={fixing} onClose={() => setFixing(null)} onDone={() => (setFixing(null), void qc.invalidateQueries({ queryKey: ['hr'] }))} /> : null}
    </div>
  );
}
