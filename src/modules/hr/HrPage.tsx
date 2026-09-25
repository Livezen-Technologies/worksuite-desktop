import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ApiError, apiGet, apiGetMeta, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { useTab, useTabTitle } from '../../core/tab-context';
import { dateLabel, duration } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Card, Chip, Empty, ErrorNote, OfflineNote, Spinner, cx } from '../../components/ui';
import type { ModuleProps } from '../registry';
import { attendanceTime, clockAttendance, clockError, useAttendance, useNow, workedSeconds, type AttendanceMe } from './attendance';

/**
 * HR self-service (READ_CACHE, §14): clock in and out (also from the tray),
 * my attendance this month, my leave and balances, and the approvals waiting
 * for me. Screens that need HR permissions answer for themselves; the rest
 * answer for the signed-in person only.
 */
interface LeaveRequest {
  id: number | string;
  type_name: string;
  starts_on: string;
  ends_on: string;
  days: number | string;
  status: string;
  reason: string | null;
  employee_name?: string;
}
interface Approval {
  kind: string;
  id: number;
  who: string;
  what: string;
  when: string;
  as: string;
  link: string;
}

const TABS = [
  { id: 'attendance', label: 'My attendance' },
  { id: 'leave', label: 'My leave' },
  { id: 'approvals', label: 'Approvals' },
] as const;

export default function HrPage(_props: ModuleProps) {
  useTabTitle('HR');
  const { query, go, openLink } = useTab();
  const tab = (query.get('tab') as (typeof TABS)[number]['id']) ?? 'attendance';
  useEffect(() => {
    if (query.get('new') === '1' && tab === 'leave') {
      openLink('/hr?tab=leave&new=1');
      go('/hr?tab=leave');
    }
  }, [query, tab, openLink, go]);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-line bg-surface px-6 py-3">
        <h1 className="text-[20px] font-bold text-ink">HR</h1>
        <div className="ml-3 flex gap-1" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => go(`/hr?tab=${t.id}`)} className={cx('rounded-full px-3 py-1.5 text-[12.5px] font-semibold', tab === t.id ? 'bg-ink text-surface' : 'text-ink-2 hover:bg-subtle')}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <Button icon="external" onClick={() => openLink('/hr')}>
          HR on the web
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-6 scroll-thin">
        {tab === 'attendance' ? <Attendance /> : tab === 'leave' ? <Leave /> : <Approvals />}
      </div>
    </div>
  );
}

function Attendance() {
  const { q, a, today, clockedIn, needNote, countedAt } = useAttendance();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const now = useNow();

  const clock = async () => {
    setBusy(true);
    try {
      await clockAttendance(clockedIn ? 'out' : 'in', note);
      toast('success', clockedIn ? 'Clocked out.' : 'Clocked in. Have a good day.');
      setNote('');
    } catch (e) {
      toast('error', clockError(e));
    } finally {
      setBusy(false);
    }
  };

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  if (!a?.linked) return <Empty icon="id-card" title="You're not set up as an employee" hint="Attendance is available once HR links your account to an employee record." />;
  const elapsed = workedSeconds(today, clockedIn, now, countedAt);
  return (
    <div className="grid max-w-[1100px] grid-cols-1 gap-5 lg:grid-cols-2">
      <Card title="Today">
        {q.data?.offline ? <div className="mb-3"><OfflineNote cachedAt={q.data.cachedAt} /></div> : null}
        <div className="flex items-center gap-4">
          <span className={cx('flex h-14 w-14 items-center justify-center rounded-full', clockedIn ? 'bg-success-bg text-success' : 'bg-subtle text-ink-3')}>
            <Icon name={clockedIn ? 'timer' : 'clock'} size={26} />
          </span>
          <div>
            <div className="text-[15px] font-semibold text-ink">{clockedIn ? 'Clocked in' : today?.check_out ? 'Clocked out' : 'Not clocked in yet'}</div>
            <div className="text-[13px] text-ink-3">
              {today?.check_in ? `In at ${attendanceTime(today.check_in)}` : 'Your day has not started'}
              {today?.check_out ? ` · out at ${attendanceTime(today.check_out)}` : ''}
            </div>
          </div>
          <div className="flex-1" />
          <div className="font-mono text-[26px] font-semibold text-ink tabular">{duration(elapsed)}</div>
        </div>
        {today?.late_minutes ? <div className="mt-3"><Chip tone="warning">{today.late_minutes} min late</Chip></div> : null}
        <div className="mt-5 flex gap-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={needNote ? 'A note is required' : 'Note (optional)'} aria-label="Attendance note" className="h-10 flex-1 rounded-[8px] border border-line bg-surface px-3 text-[13px] outline-none focus:border-primary" />
          <Button size="lg" variant={clockedIn ? 'danger' : 'success'} loading={busy} disabled={needNote && !note.trim()} onClick={() => void clock()}>
            {clockedIn ? 'Clock out' : today?.check_out ? 'Clock in again' : 'Clock in'}
          </Button>
        </div>
      </Card>
      {a.month ? (
        <Card title="This month">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Days present" value={`${a.month.days_present}/${a.month.work_days}`} />
            <Stat label="Attendance" value={`${Math.round(a.month.attendance_rate)}%`} />
            <Stat label="Hours worked" value={duration(a.month.net_seconds)} />
            <Stat label="Late days" value={String(a.month.late_days)} tone={a.month.late_days ? 'warning' : undefined} />
            <Stat label="Overtime" value={duration(a.month.overtime_minutes * 60)} />
            <Stat label="Missing check-outs" value={String(a.month.missing_check_outs)} tone={a.month.missing_check_outs ? 'danger' : undefined} />
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warning' | 'danger' }) {
  return (
    <div className="rounded-[10px] bg-subtle p-3">
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className={cx('font-mono text-[17px] font-semibold', tone === 'warning' ? 'text-warning' : tone === 'danger' ? 'text-danger' : 'text-ink')}>{value}</div>
    </div>
  );
}

function Leave() {
  const { openLink } = useTab();
  // "My" leave is the signed-in person's employee record, not everyone the
  // endpoint would let a manager see.
  const me = useQuery({ queryKey: ['hr', 'attendance'], queryFn: ({ signal }) => apiGetMeta<AttendanceMe>('/api/hr/attendance/me', undefined, signal) });
  const employeeId = me.data?.data.employee?.id;
  const requests = useQuery({
    queryKey: ['hr', 'leave', 'mine', employeeId],
    queryFn: () => apiGet<LeaveRequest[] | { items?: LeaveRequest[] }>('/api/hr/leave/requests', { employee_id: employeeId }),
    enabled: employeeId !== undefined,
  });
  const balance = useQuery({
    queryKey: ['hr', 'leave', 'balance', employeeId],
    queryFn: () => apiGet<{ year: number; balances: Array<{ type: string; type_id: number; entitled: number; taken: number; available: number }> }>('/api/hr/leave/balance', { employee_id: employeeId }),
    enabled: employeeId !== undefined,
    retry: false,
  });
  if (me.data && !me.data.data.linked) return <Empty icon="id-card" title="You're not set up as an employee" hint="Leave is available once HR links your account to an employee record." />;
  const list = Array.isArray(requests.data) ? requests.data : (requests.data?.items ?? []);
  return (
    <div className="grid max-w-[1100px] grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
      <Card title="Requests" action={<Button size="sm" variant="primary" icon="plus" onClick={() => openLink('/hr?tab=leave&new=1')}>Request leave</Button>}>
        {requests.isLoading || me.isLoading ? <Spinner /> : requests.error ? <ErrorNote error={requests.error} /> : list.length === 0 ? <Empty icon="calendar-clock" title="No leave requests" /> : null}
        <ul className="flex flex-col divide-y divide-line">
          {list.slice(0, 50).map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold text-ink">{r.type_name}</div>
                <div className="text-[12.5px] text-ink-3">
                  {dateLabel(r.starts_on)}
                  {r.ends_on !== r.starts_on ? ` – ${dateLabel(r.ends_on)}` : ''} · {Number(r.days)} day{Number(r.days) === 1 ? '' : 's'}
                </div>
              </div>
              <Chip tone={r.status === 'approved' ? 'success' : r.status === 'rejected' || r.status === 'cancelled' ? 'danger' : 'warning'}>{r.status}</Chip>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={`Balance ${balance.data?.year ?? ''}`}>
        {balance.isLoading ? <Spinner /> : balance.error ? <p className="text-[12.5px] text-ink-3">Leave balances are not available for your account.</p> : null}
        <ul className="flex flex-col gap-2">
          {(balance.data?.balances ?? []).map((b) => (
            <li key={b.type_id} className="rounded-[10px] bg-subtle p-3">
              <div className="flex justify-between text-[13px]">
                <span className="font-semibold text-ink">{b.type}</span>
                <span className="font-mono font-semibold text-ink">{b.available}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-primary" style={{ width: `${b.entitled ? Math.min(100, (b.taken / b.entitled) * 100) : 0}%` }} />
              </div>
              <div className="mt-1 text-[11.5px] text-ink-3">
                {b.taken} taken of {b.entitled}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Approvals() {
  const qc = useQueryClient();
  const { openLink } = useTab();
  const q = useQuery({ queryKey: ['hr', 'approvals'], queryFn: () => apiGet<{ count: number; items: Approval[] }>('/api/hr/approvals/pending'), retry: false });
  const [busy, setBusy] = useState<number | null>(null);
  const decide = async (a: Approval, decision: 'approved' | 'rejected') => {
    setBusy(a.id);
    try {
      await apiPost(`/api/hr/leave/requests/${a.id}/decide`, { decision });
      toast('success', decision === 'approved' ? 'Approved.' : 'Declined.');
      void qc.invalidateQueries({ queryKey: ['hr'] });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  if (q.isLoading) return <Spinner />;
  if (q.error) return <Empty icon="shield-check" title="No approvals for you" hint={q.error instanceof ApiError && q.error.forbidden ? 'You do not approve requests in HR.' : errorMessage(q.error)} />;
  const items = q.data?.items ?? [];
  return (
    <Card title={`Waiting for you (${q.data?.count ?? 0})`} className="max-w-[900px]">
      {items.length === 0 ? <Empty icon="check-circle" title="Nothing waiting for you" /> : null}
      <ul className="flex flex-col divide-y divide-line">
        {items.map((a) => (
          <li key={`${a.kind}:${a.id}`} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-ink">
                {a.what} · {a.who}
              </div>
              <div className="text-[12.5px] text-ink-3">
                {a.when} · as {a.as}
              </div>
            </div>
            {a.kind === 'leave' && a.as !== 'responsible' ? (
              <>
                <Button size="sm" disabled={busy === a.id} onClick={() => void decide(a, 'rejected')}>
                  Decline
                </Button>
                <Button size="sm" variant="success" disabled={busy === a.id} onClick={() => void decide(a, 'approved')}>
                  Approve
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => openLink(a.link)}>
                Review
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
