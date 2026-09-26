import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../core/api';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { attendanceTime } from './attendance';
import { dayStatus, type RosterDay, type RosterResponse } from './api';
import { CorrectAttendance } from './Correct';
import { minutesLabel, parseYmd } from './dates';
import { Cell, Empty, input, PageHead, row, StatusChip, THead } from './parts';
import { Select } from '../../components/Select';

/**
 * Team attendance (HrTeamAttendance; the web's roster): one day for everyone
 * I may see — who is in, on a break, out, late, away or unaccounted for —
 * with the day's counts, filters that match the web's, and Correct on every
 * row. It refreshes every minute, like the web's.
 */
export const ROSTER_FILTERS: Array<[string, string]> = [
  ['', 'Everyone'],
  ['working', 'Working'],
  ['on_break', 'On break'],
  ['complete', 'Checked out'],
  ['late', 'Late'],
  ['absent', 'Absent'],
  ['holiday', 'Public holiday'],
  ['leave', 'On leave'],
  ['missing_check_out', 'Missing check-out'],
  ['pending', 'Pending approval'],
  ['rejected', 'Request rejected'],
  ['auto_closed', 'Auto closed'],
  ['corrected', 'Manually corrected'],
  ['open_unresolved', 'Any unresolved day'],
  ['location_skipped', 'No location given'],
];

const TILES: Array<{ key: string; label: string; filter: string; tone?: string; always?: boolean }> = [
  { key: 'present', label: 'Present', filter: 'present', tone: 'text-[#145C39] dark:text-success', always: true },
  { key: 'late', label: 'Late', filter: 'late', tone: 'text-[#9A4A06] dark:text-warning', always: true },
  { key: 'absent', label: 'Absent', filter: 'absent', tone: 'text-danger', always: true },
  { key: 'holiday', label: 'Public holiday', filter: 'holiday', always: true },
  { key: 'leave', label: 'On leave', filter: 'leave', tone: 'text-[#5B2FA0] dark:text-[#C4A8F0]', always: true },
  { key: 'remote', label: 'Remote', filter: '', always: true },
  { key: 'missing_check_out', label: 'No check-out', filter: 'missing_check_out', tone: 'text-danger', always: true },
  { key: 'location_skipped', label: 'No location', filter: 'location_skipped', tone: 'text-[#9A4A06] dark:text-warning' },
  { key: 'pending', label: 'Pending review', filter: 'pending', tone: 'text-[#9A4A06] dark:text-warning' },
];

/** Where the day was worked: the named place, the coordinates, or why there are none. */
export function whereLabel(d: RosterDay): { text: string; warn: boolean } {
  const at = d.location?.check_in;
  if (at && at.lat != null && at.lng != null) return { text: `${Number(at.lat).toFixed(5)}, ${Number(at.lng).toFixed(5)}${at.accuracy != null ? ` · ±${Math.round(at.accuracy)} m` : ''}`, warn: false };
  if (at?.note) return { text: `No location — “${at.note}”`, warn: true };
  return { text: d.work_location ?? '', warn: false };
}

/** The design's status words for a roster row ("Working · 31m late"). */
export function rosterStatus(d: RosterDay): string {
  if ((d.state === 'working' || d.state === 'on_break') && d.late_minutes > 0) return `${d.state === 'working' ? 'Working' : 'On break'} · ${d.late_minutes}m late`;
  if (d.state === 'complete' && d.verdict === 'present') return 'Complete';
  if (d.state === 'leave' && d.leave_type) return `On leave · ${d.leave_type}`;
  return dayStatus(d);
}

export default function TeamAttendance() {
  const qc = useQueryClient();
  const [date, setDate] = useState('');
  const [dept, setDept] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [fixing, setFixing] = useState<RosterDay | null>(null);
  const roster = useQuery({
    queryKey: ['hr', 'roster', date, dept, status, q.trim()],
    queryFn: ({ signal }) => apiGet<RosterResponse>('/api/hr/attendance', { date: date || undefined, department_id: dept || undefined, status: status || undefined, q: q.trim() || undefined }, signal),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
  const r = roster.data;
  const shown = r?.date ?? date;
  const label = ROSTER_FILTERS.find(([v]) => v === status)?.[1] ?? 'Everyone';

  return (
    <div className="flex flex-col gap-3.5">
      <PageHead title="Team attendance" sub={shown ? parseYmd(shown).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : undefined} />
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" aria-label="Day" value={shown} onChange={(e) => setDate(e.target.value)} className={input + ' !w-[150px]'} />
        <Select aria-label="Department" value={dept} onChange={(e) => setDept(e.target.value)} className={input + ' !w-auto'}>
          <option value="">All departments</option>
          {(r?.departments ?? []).map((d) => (
            <option key={String(d.id)} value={String(d.id)}>
              {d.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={input + ' !w-auto'}>
          {ROSTER_FILTERS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or number" aria-label="Search name or number" className={input + ' !w-[240px]'} />
      </div>
      {r ? (
        <div className="grid grid-cols-9 gap-2">
          {TILES.filter((t) => t.always || (r.counts[t.key] ?? 0) > 0).map((t) => {
            const on = !!t.filter && status === t.filter;
            return (
              <button
                key={t.key}
                type="button"
                disabled={!t.filter}
                aria-pressed={on}
                onClick={() => setStatus(on ? '' : t.filter)}
                className={cx('flex flex-col items-start gap-0.5 rounded-[10px] px-3 py-2 text-left', on ? 'border-2 border-primary bg-selection' : 'border border-line bg-surface enabled:hover:border-primary/40')}
              >
                <span className="text-[11.5px] leading-tight text-ink-3">{t.label}</span>
                <b className={cx('text-[19px] text-ink tabular-nums', (r.counts[t.key] ?? 0) > 0 && t.tone)}>{r.counts[t.key] ?? 0}</b>
              </button>
            );
          })}
        </div>
      ) : null}
      {roster.isLoading ? <Spinner /> : roster.error ? <ErrorNote error={roster.error} onRetry={() => void roster.refetch()} /> : null}
      {r ? (
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <div className="border-b border-line px-3.5 py-2.5 font-bold text-ink">
            {label} — {r.records.length}
          </div>
          <THead cols={[['Employee', 190], ['Department', 120], ['In', 55], ['Out', 55], ['Break', 55], ['Net', 70], ['Location', null], ['Status', 170], ['', 60]]} />
          {r.records.map((d) => {
            const where = whereLabel(d);
            return (
              <div key={`${d.employee_id}-${d.on_date}`} className={row}>
                <Cell w={190} className="font-semibold">
                  <span title={d.employee_no ?? undefined}>{d.name ?? d.employee_no ?? `#${d.employee_id}`}</span>
                </Cell>
                <Cell w={120} className="text-ink-2">{d.department ?? '—'}</Cell>
                <Cell w={55}>{d.check_in ? attendanceTime(d.check_in) : '—'}</Cell>
                <Cell w={55}>{d.check_out ? attendanceTime(d.check_out) : '—'}</Cell>
                <Cell w={55}>{d.break_seconds > 0 ? minutesLabel(d.break_seconds / 60) : '—'}</Cell>
                <Cell w={70}>{d.check_out && d.net_seconds != null ? minutesLabel(d.net_seconds / 60) : '—'}</Cell>
                <Cell w={null} className={cx('text-[12px]', where.warn ? 'text-[#9A4A06] dark:text-warning' : 'text-ink-2')}>
                  <span title={where.text}>{where.text}</span>
                </Cell>
                <Cell w={170} className="!overflow-visible">
                  <StatusChip>{rosterStatus(d)}</StatusChip>
                </Cell>
                <span className="w-[60px] shrink-0 text-right">
                  <button type="button" className="text-[12.5px] font-bold text-primary hover:underline" onClick={() => setFixing(d)}>
                    Correct
                  </button>
                </span>
              </div>
            );
          })}
          {!r.records.length ? <Empty text={q || status || dept ? 'Nobody matches.' : 'Nobody to show for this day.'} /> : null}
        </div>
      ) : null}
      {fixing ? <CorrectAttendance day={fixing} onClose={() => setFixing(null)} onDone={() => (setFixing(null), void qc.invalidateQueries({ queryKey: ['hr'] }))} /> : null}
    </div>
  );
}
