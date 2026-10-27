import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../core/api';
import { attendanceTime } from './attendance';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { STATE_LABEL, type Profile } from './api';
import { dayLong, dayShort, minutesLabel } from './dates';
import { btn, btnPrimary, Cell, Empty, Facts, Grid, humanise, Kpi, Panel, row, StatusChip, THead } from '../../components/PageKit';
import type { HrView } from './Rail';
import { NewRequestSheet } from './Requests';
import { StatGrid } from '../../components/StatCard';

/**
 * My HR (HrProfile, HrProfilePersonal; `ProfileWorkspace self` on the web):
 * my employment record — the month so far, my employment details, recent
 * attendance and leave balances, and my personal details. A detail is
 * changed by asking HR (a "Change a profile detail" request), because it is
 * HR's record; the other tabs are the screens for them.
 */
const TABS: Array<{ id: 'overview' | 'personal' | HrView; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'personal', label: 'Personal' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'timesheet', label: 'Timesheet' },
  { id: 'leave', label: 'Leave' },
  { id: 'mydocs', label: 'Documents' },
  { id: 'requests', label: 'Requests' },
];

export default function MyHr({ onPick }: { onPick: (v: HrView) => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'overview' | 'personal'>('overview');
  const [asking, setAsking] = useState(false);
  const q = useQuery({ queryKey: ['hr', 'me'], queryFn: ({ signal }) => apiGet<Profile>('/api/hr/me/profile', undefined, signal) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const p = q.data!;
  if (p.linked === false || !p.employee) {
    return <Empty text={p.message ?? 'Your login is not linked to an employee record yet. HR can link it.'} />;
  }
  const e = p.employee;
  const emp = p.employment;
  const att = p.attendance;
  const per = p.personal ?? {};
  const balances = p.leave?.balances ?? [];
  const available = balances.reduce((n, b) => n + (Number(b.available) || 0), 0);
  const open = p.requests.filter((r) => r.status === 'pending');

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5">
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-teal text-[16px] font-bold text-white">
          {e.name
            .split(/\s+/)
            .slice(0, 2)
            .map((w) => w[0]?.toUpperCase())
            .join('')}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[11.5px] font-bold text-ink-3">EMPLOYEE</span>
          <b className="truncate text-[19px] text-ink">{e.name}</b>
          <span className="truncate text-[12.5px] text-ink-3">
            {[e.employee_no, e.designation, e.department].filter(Boolean).join(' · ')}
            {' · '}
            <b className={e.status === 'active' ? 'text-success' : 'text-warning-ink dark:text-warning'}>{humanise(e.status)}</b>
          </span>
        </div>
        <button type="button" className={btn} onClick={() => onPick('leave')}>
          Request leave
        </button>
        <button type="button" className={btnPrimary} onClick={() => setAsking(true)}>
          New request
        </button>
      </div>
      <div role="tablist" aria-label="My HR" className="-mx-[22px] flex gap-4 border-b border-line px-[22px]">
        {TABS.map((t) => {
          const on = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => (t.id === 'overview' || t.id === 'personal' ? setTab(t.id) : onPick(t.id as HrView))}
              className={cx('border-b-2 py-[9px] font-semibold whitespace-nowrap', on ? 'border-primary text-primary' : 'border-transparent text-ink-3 hover:text-ink')}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'overview' ? (
        <>
          <StatGrid min={180}>
            <Kpi icon="calendar" tone="blue" label="This month" value={att ? `${att.days_present} / ${att.work_days}` : '—'} sub="days present" />
            <Kpi icon="clock" tone="violet" label="Hours worked" value={att ? `${Math.round(att.net_seconds / 3600)} h` : '—'} sub={att ? `${Math.round(att.overtime_minutes / 60)} h overtime` : undefined} />
            <Kpi icon="plane" tone="cyan" label="Leave available" value={Math.round(available * 10) / 10} sub="days, all types" onClick={() => onPick('leave')} />
            <Kpi icon="inbox" tone="amber" label="Open requests" value={open.length} sub={open[0]?.kind_label ?? 'Nothing waiting'} onClick={() => onPick('requests')} />
          </StatGrid>
          <div className="grid min-h-0 flex-1 grid-cols-[1fr_1.3fr_1fr] gap-3">
            <Panel title="Employment" bodyClassName="px-3.5 py-2">
              <Facts
                rows={[
                  ['Employee number', emp?.employee_no ?? e.employee_no],
                  ['Department', e.department],
                  ['Position', e.designation],
                  ['Employment type', humanise(emp?.type ?? e.type)],
                  ['Reports to', emp?.manager?.name],
                  ['Joined', dayLong(emp?.joined_at ?? e.joined_at)],
                  ['Confirmed', emp?.confirmed_at ? dayLong(emp.confirmed_at) : null],
                  ['Work location', emp?.work_location],
                  ['Shift', emp?.shift],
                ]}
              />
            </Panel>
            <Panel title="Recent attendance" action={<button type="button" className="font-semibold text-primary hover:underline" onClick={() => onPick('attendance')}>All</button>}>
              <THead cols={[['Date', 70], ['In', 55], ['Out', 55], ['Net', 60], ['Status', null]]} />
              {att?.recent.length ? (
                att.recent.map((d) => (
                  <div key={d.on_date} className={row}>
                    <Cell w={70}>{dayShort(d.on_date).replace(/ [A-Za-z]+$/, '')}</Cell>
                    <Cell w={55}>{d.check_in ? attendanceTime(d.check_in) : '—'}</Cell>
                    <Cell w={55}>{d.check_out ? attendanceTime(d.check_out) : '—'}</Cell>
                    <Cell w={60}>{d.net_seconds != null ? minutesLabel(d.net_seconds / 60) : '—'}</Cell>
                    <Cell w={null} className="!overflow-visible">
                      <StatusChip>{d.late_minutes > 0 && d.check_in ? `Late · ${d.late_minutes}m late` : (STATE_LABEL[d.state] ?? humanise(d.state))}</StatusChip>
                    </Cell>
                  </div>
                ))
              ) : (
                <Empty text="Nothing recorded yet." />
              )}
            </Panel>
            <Panel title="Leave balance" action={<button type="button" className="font-semibold text-primary hover:underline" onClick={() => onPick('leave')}>Leave</button>}>
              <THead cols={[['Type', null], ['Available', 90]]} />
              {balances.length ? (
                balances.map((b) => (
                  <div key={b.type_id} className={row}>
                    <Cell w={null}>{b.type}</Cell>
                    <Cell w={90} className="font-semibold">{Number(b.entitled) > 0 ? `${b.available} of ${b.entitled}` : Number(b.available) > 0 ? b.available : 'Unpaid'}</Cell>
                  </div>
                ))
              ) : (
                <Empty text="No leave types yet." />
              )}
            </Panel>
          </div>
        </>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-3">
            <Panel title="Personal" bodyClassName="px-3.5 py-2">
              <Grid
                rows={[
                  ['First name', per.first_name],
                  ['Middle name', per.middle_name],
                  ['Last name', per.last_name],
                  ['Known as', per.preferred_name],
                  ['Date of birth', per.date_of_birth ? dayLong(String(per.date_of_birth)) : null],
                  ['Gender', per.gender],
                  ['Nationality', per.nationality],
                  ['Marital status', per.marital_status],
                ]}
              />
            </Panel>
            <section className="flex flex-col gap-1 rounded-[12px] border border-line bg-surface px-3.5 py-[11px]">
              <b className="text-ink">Identification</b>
              <span className="flex gap-2.5">
                <span className="w-[100px] text-ink-3">National ID</span>
                <span className="font-semibold text-ink">{per.has_national_id ? 'On file — hidden' : 'Not on file'}</span>
              </span>
              <span className="flex gap-2.5">
                <span className="w-[100px] text-ink-3">Passport</span>
                <span className="font-semibold text-ink">{per.has_passport ? 'On file — hidden' : 'Not on file'}</span>
              </span>
              <span className="text-[11.5px] text-ink-3">Identity numbers are shown to HR only.</span>
            </section>
            <Panel title="Contact" bodyClassName="px-3.5 py-2">
              <Grid rows={[['Personal email', per.personal_email], ['Mobile', per.mobile], ['Telephone', per.telephone]]} />
            </Panel>
          </div>
          <div className="flex flex-col gap-3">
            <Panel title="Emergency contact" bodyClassName="px-3.5 py-2">
              <Grid rows={[['Name', per.emergency_name], ['Relationship', per.emergency_relation], ['Phone', per.emergency_phone]]} />
            </Panel>
            <Panel title="Address" bodyClassName="px-3.5 py-2">
              <Grid rows={[['Address line 1', per.address_1], ['Address line 2', per.address_2], ['City', per.city], ['Province / State', per.province], ['Postal code', per.postal_code], ['Country', per.country]]} />
            </Panel>
            <Panel title="Employment · Dates" bodyClassName="px-3.5 py-2">
              <Grid
                rows={[
                  ['Confirmed', emp?.confirmed_at ? dayLong(emp.confirmed_at) : null],
                  ['Probation ends', emp?.probation_ends_at ? dayLong(emp.probation_ends_at) : null],
                  ['Contract starts', emp?.contract_starts_at ? dayLong(emp.contract_starts_at) : null],
                  ['Contract ends', emp?.contract_ends_at ? dayLong(emp.contract_ends_at) : null],
                  ['Left', emp?.exit_at ? dayLong(emp.exit_at) : null],
                ]}
              />
            </Panel>
          </div>
          <div className="flex flex-col gap-3">
            <Panel title="Employment" bodyClassName="px-3.5 py-2">
              <Grid
                rows={[
                  ['Employee number', emp?.employee_no ?? e.employee_no],
                  ['Department', e.department],
                  ['Position', e.designation],
                  ['Employment type', humanise(emp?.type ?? e.type)],
                  ['Status', <b key="s" className={e.status === 'active' ? 'text-success' : ''}>{humanise(e.status)}</b>],
                  ['Joined', dayLong(emp?.joined_at ?? e.joined_at)],
                  ['Reports to', emp?.manager?.name],
                  ['Shift', emp?.shift],
                  ['Job level', emp?.job_level],
                  ['Work location', emp?.work_location],
                ]}
              />
            </Panel>
            <section className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface px-3.5 py-3 text-[12.5px] text-ink-2">
              <b className="text-ink">Something wrong?</b>
              Your details are HR's record. Ask for a change and HR updates it.
              <button type="button" className={btn + ' self-start'} onClick={() => setAsking(true)}>
                Ask to change a detail
              </button>
            </section>
          </div>
        </div>
      )}
      {asking ? <NewRequestSheet employeeId={e.id} initial={{ kind: tab === 'personal' ? 'profile' : undefined }} onClose={() => setAsking(false)} onDone={() => (setAsking(false), void qc.invalidateQueries({ queryKey: ['hr'] }))} /> : null}
    </div>
  );
}
