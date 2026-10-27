import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useCanOpen } from '../../core/access';
import { app } from '../../core/app-state';
import { apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { useTab } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { attendanceTime } from './attendance';
import { dayStatus, STATE_LABEL, type AttDay, type AttTotals, type EmployeeLeave, type Membership, type Profile, type RequestsResponse, type Sheet as TimeSheet } from './api';
import { BankCard } from './Bank';
import { CorrectAttendance, type CorrectableDay } from './Correct';
import { dayLong, dayShort, minutesLabel, monthLabel, shiftMonth, ymd } from './dates';
import { EditEmployee } from './EditEmployee';
import MyDocuments from './MyDocuments';
import { btn, btnBad, btnGood, btnPrimary, btnSmall, Cell, Empty, Facts, Field, Grid, humanise, input, Kpi, Panel, row, Seg, Sheet, StatusChip, THead } from './parts';
import { can } from './Rail';
import { NewRequestSheet } from './Requests';
import { SheetDetail } from './TimesheetApprovals';
import { Select } from '../../components/Select';
import { StatGrid } from '../../components/StatCard';

/**
 * An employee's profile (HrProfile, HrProfilePersonal, HrProfileSheet; the
 * web's EmployeeProfile): the header with Email, Chat, User account, New
 * request and Edit, and one tab per section the server says I may see
 * (`can.*`) — the design's thirteen; the web's greyed tabs for modules this
 * installation lacks (performance, benefits, training) are left out. Every action is offered only where the server's own flag
 * allows it, so the line-manager case needs no guessing here.
 */
type Tab = 'overview' | 'personal' | 'employment' | 'organizations' | 'attendance' | 'timesheet' | 'leave' | 'documents' | 'bank' | 'requests' | 'notes' | 'security' | 'activity';

const TABS: Array<{ id: Tab; label: string; gate?: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'personal', label: 'Personal', gate: 'personal' },
  { id: 'employment', label: 'Employment', gate: 'employment' },
  { id: 'organizations', label: 'Organizations' },
  { id: 'attendance', label: 'Attendance', gate: 'attendance' },
  { id: 'timesheet', label: 'Timesheet', gate: 'timesheet' },
  { id: 'leave', label: 'Leave', gate: 'leave' },
  { id: 'documents', label: 'Documents', gate: 'documents' },
  { id: 'bank', label: 'Bank', gate: 'bank' },
  { id: 'requests', label: 'Requests' },
  { id: 'notes', label: 'Notes', gate: 'notes' },
  { id: 'security', label: 'Security', gate: 'security' },
  { id: 'activity', label: 'Activity', gate: 'activity' },
];

const utc = (s: string | null | undefined) => (s ? new Date(`${s.replace(' ', 'T')}Z`) : null);
const when = (s: string | null | undefined) => utc(s)?.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) ?? '—';

export default function EmployeeProfile({ id, onBack }: { id: number; onBack: () => void }) {
  const qc = useQueryClient();
  const { navigate } = useTab();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  // Email and Chat open those apps: only for whoever has them. (User account is the web's Users, of no app.)
  const canMail = useCanOpen('mail');
  const canChat = useCanOpen('chat');
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const q = useQuery({ queryKey: ['hr', 'profile', id], queryFn: ({ signal }) => apiGet<Profile>(`/api/hr/employees/${id}/profile`, undefined, signal) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['hr'] });
  if (q.isLoading) return <Spinner />;
  if (q.error) {
    return (
      <div className="flex flex-col gap-3">
        <button type="button" className="self-start font-semibold text-primary hover:underline" onClick={onBack}>
          ← Back
        </button>
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  }
  const p = q.data!;
  const e = p.employee;
  const tabs = TABS.filter((t) => !t.gate || p.can[t.gate]);
  const current = tabs.some((t) => t.id === tab) ? tab : 'overview';

  const chat = async () => {
    if (!e.user_id) return;
    try {
      const r = await apiPost<{ room_id: number }>('/api/chat/rooms/direct', { user_id: e.user_id });
      navigate(`/chat?room=${r.room_id}`);
    } catch (err) {
      toast('error', `Could not open the chat. ${errorMessage(err)}`);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5">
      <div className="flex items-center gap-3">
        <button type="button" className="shrink-0 font-semibold text-primary hover:underline" onClick={onBack}>
          ← Back
        </button>
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
        {e.email && canMail ? (
          <button type="button" className={btn} onClick={() => navigate(`/mail?compose=1&to=${encodeURIComponent(e.email!)}`)}>
            Email
          </button>
        ) : null}
        {e.user_id && !p.is_self && canChat ? (
          <button type="button" className={btn} onClick={() => void chat()}>
            Chat
          </button>
        ) : null}
        {e.user_id && can(perms, 'users.view') ? (
          <button type="button" className={btn} title="Opens in your browser" onClick={() => void call('app:openInBrowser', { path: `/users/${e.user_id}` })}>
            User account
          </button>
        ) : null}
        <button type="button" className={btn} onClick={() => setAsking(true)}>
          New request
        </button>
        {p.editable ? (
          <button type="button" className={btnPrimary} onClick={() => setEditing(true)}>
            Edit
          </button>
        ) : null}
      </div>
      {p.leaving ? (
        <div className="flex items-center gap-2 rounded-[10px] border border-warning-line bg-warning-bg px-3.5 py-2 text-[12.5px] text-warning-strong dark:border-warning/40 dark:text-warning">
          <b>{p.leaving.former ? 'Left' : 'Leaving'}{p.leaving.exit_at ? ` ${dayLong(p.leaving.exit_at)}` : ''}</b>
          {p.leaving.reason ? <span>· {p.leaving.reason}</span> : null}
          {p.leaving.offboarding ? <span>· offboarding {p.leaving.offboarding.status_label.toLowerCase()}, {p.leaving.offboarding.percent}%</span> : null}
          {p.leaving.login?.off_at ? <span>· login switched off {when(p.leaving.login.off_at)}</span> : p.leaving.login?.due_at ? <span>· login switches off {when(p.leaving.login.due_at)}{p.leaving.login.held ? ' (held on)' : ''}</span> : null}
        </div>
      ) : null}
      <div role="tablist" aria-label="Profile" className="-mx-[22px] flex gap-4 overflow-x-auto border-b border-line px-[22px] scroll-thin">
        {tabs.map((t) => {
          const on = t.id === current;
          return (
            <button key={t.id} type="button" role="tab" aria-selected={on} onClick={() => setTab(t.id)} className={cx('shrink-0 border-b-2 py-[9px] font-semibold whitespace-nowrap', on ? 'border-primary text-primary' : 'border-transparent text-ink-3 hover:text-ink')}>
              {t.label}
            </button>
          );
        })}
      </div>

      {current === 'overview' ? <Overview p={p} onTab={setTab} /> : null}
      {current === 'personal' ? <Personal p={p} /> : null}
      {current === 'employment' ? <EmploymentTab p={p} /> : null}
      {current === 'organizations' ? <Organizations id={id} /> : null}
      {current === 'attendance' ? <AttendanceTab id={id} name={e.name} self={p.is_self} /> : null}
      {current === 'timesheet' ? <TimesheetTab p={p} /> : null}
      {current === 'leave' ? <LeaveTab p={p} /> : null}
      {current === 'documents' ? <MyDocuments employeeId={id} /> : null}
      {current === 'bank' ? (
        <div className="max-w-[560px]">
          <BankCard employeeId={id} />
        </div>
      ) : null}
      {current === 'requests' ? <RequestsTab p={p} onNew={() => setAsking(true)} /> : null}
      {current === 'notes' ? <NotesTab p={p} onDone={refresh} /> : null}
      {current === 'security' ? <SecurityTab p={p} canUsers={can(perms, 'users.view')} /> : null}
      {current === 'activity' ? <ActivityTab p={p} /> : null}

      {editing ? <EditEmployee profile={p} onClose={() => setEditing(false)} onDone={() => (setEditing(false), refresh())} /> : null}
      {asking ? <NewRequestSheet employeeId={e.id} onClose={() => setAsking(false)} onDone={() => (setAsking(false), refresh())} /> : null}
    </div>
  );
}

function Overview({ p, onTab }: { p: Profile; onTab: (t: Tab) => void }) {
  const e = p.employee;
  const emp = p.employment;
  const att = p.attendance;
  const balances = p.leave?.balances ?? [];
  const available = balances.reduce((n, b) => n + (Number(b.available) || 0), 0);
  const open = p.requests.filter((r) => r.status === 'pending');
  return (
    <>
      <StatGrid min={180}>
        <Kpi icon="calendar" tone="blue" label="This month" value={att ? `${att.days_present} / ${att.work_days}` : '—'} sub="days present" onClick={p.can.attendance ? () => onTab('attendance') : undefined} />
        <Kpi icon="clock" tone="violet" label="Hours worked" value={att ? `${Math.round(att.net_seconds / 3600)} h` : '—'} sub={att ? `${Math.round(att.overtime_minutes / 60)} h overtime` : undefined} />
        <Kpi icon="plane" tone="cyan" label="Leave available" value={p.leave ? Math.round(available * 10) / 10 : '—'} sub="days, all types" onClick={p.can.leave ? () => onTab('leave') : undefined} />
        <Kpi icon="inbox" tone="amber" label="Open requests" value={open.length} sub={open[0]?.kind_label ?? open[0]?.kind ?? 'Nothing waiting'} onClick={() => onTab('requests')} />
      </StatGrid>
      <div className="grid min-h-0 grid-cols-[1fr_1.3fr_1fr] gap-3">
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
              ['Shift', emp?.shift ?? p.attendance?.schedule?.name],
            ]}
          />
        </Panel>
        <Panel title="Recent attendance">
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
            <Empty text={p.can.attendance ? 'Nothing recorded this month.' : 'Not yours to see.'} />
          )}
        </Panel>
        <Panel title="Leave balance">
          <THead cols={[['Type', null], ['Available', 90]]} />
          {balances.length ? (
            balances.map((b) => (
              <div key={b.type_id} className={row}>
                <Cell w={null}>{b.type}</Cell>
                <Cell w={90} className="font-semibold">{Number(b.entitled) > 0 ? `${b.available} of ${b.entitled}` : Number(b.available) > 0 ? b.available : 'Unpaid'}</Cell>
              </div>
            ))
          ) : (
            <Empty text={p.can.leave ? 'No leave types yet.' : 'Not yours to see.'} />
          )}
        </Panel>
      </div>
    </>
  );
}

function Personal({ p }: { p: Profile }) {
  const per = p.personal ?? {};
  const emp = p.employment;
  const e = p.employee;
  const idLine = (has: unknown, value: unknown) => (value ? String(value) : has ? 'On file — hidden' : 'Not on file');
  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="flex flex-col gap-3">
        <Panel title="Personal" bodyClassName="px-3.5 py-2">
          <Grid
            rows={[
              ['First name', per.first_name as string],
              ['Middle name', per.middle_name as string],
              ['Last name', per.last_name as string],
              ['Known as', per.preferred_name as string],
              ['Date of birth', per.date_of_birth ? dayLong(String(per.date_of_birth)) : null],
              ['Gender', per.gender as string],
              ['Nationality', per.nationality as string],
              ['Marital status', per.marital_status as string],
            ]}
          />
        </Panel>
        <section className="flex flex-col gap-1 rounded-[12px] border border-line bg-surface px-3.5 py-[11px]">
          <b className="text-ink">Identification</b>
          <span className="flex gap-2.5">
            <span className="w-[100px] text-ink-3">National ID</span>
            <span className="font-semibold text-ink">{idLine(per.has_national_id, per.national_id)}</span>
          </span>
          <span className="flex gap-2.5">
            <span className="w-[100px] text-ink-3">Passport</span>
            <span className="font-semibold text-ink">{idLine(per.has_passport, per.passport_no)}</span>
          </span>
          {!p.can.identifiers ? <span className="text-[11.5px] text-ink-3">Identity numbers are shown to HR only.</span> : null}
        </section>
        <Panel title="Contact" bodyClassName="px-3.5 py-2">
          <Grid rows={[['Personal email', per.personal_email as string], ['Mobile', per.mobile as string], ['Telephone', per.telephone as string]]} />
        </Panel>
      </div>
      <div className="flex flex-col gap-3">
        <Panel title="Emergency contact" bodyClassName="px-3.5 py-2">
          <Grid rows={[['Name', per.emergency_name as string], ['Relationship', per.emergency_relation as string], ['Phone', per.emergency_phone as string]]} />
        </Panel>
        <Panel title="Address" bodyClassName="px-3.5 py-2">
          <Grid rows={[['Address line 1', per.address_1 as string], ['Address line 2', per.address_2 as string], ['City', per.city as string], ['Province / State', per.province as string], ['Postal code', per.postal_code as string], ['Country', per.country as string]]} />
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
      </div>
    </div>
  );
}

function EmploymentTab({ p }: { p: Profile }) {
  const emp = p.employment;
  const s = p.attendance?.schedule;
  const days = s?.work_days?.map((d) => ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d]).join(', ');
  return (
    <div className="grid grid-cols-3 gap-3">
      <Panel title="Employment" bodyClassName="px-3.5 py-2">
        <Facts
          rows={[
            ['Employee number', emp?.employee_no],
            ['Employment type', humanise(emp?.type)],
            ['Status', emp ? <StatusChip key="s">{humanise(emp.status)}</StatusChip> : null],
            ['Job level', emp?.job_level],
            ['Work location', emp?.work_location],
            ['Reports to', emp?.manager?.name],
            ['Joined', emp?.joined_at ? dayLong(emp.joined_at) : null],
            ['Confirmed', emp?.confirmed_at ? dayLong(emp.confirmed_at) : null],
            ['Probation ends', emp?.probation_ends_at ? dayLong(emp.probation_ends_at) : null],
            ['Contract', emp?.contract_starts_at || emp?.contract_ends_at ? `${dayLong(emp?.contract_starts_at)} – ${dayLong(emp?.contract_ends_at)}` : null],
            ['Left', emp?.exit_at ? dayLong(emp.exit_at) : null],
          ]}
        />
      </Panel>
      <Panel title="Working hours" sub={s ? (s.source === 'default' ? 'The company’s default' : `From the ${s.source}’s schedule`) : undefined} bodyClassName="px-3.5 py-2">
        {s ? (
          <Facts
            rows={[
              ['Schedule', s.name ?? 'Default hours'],
              ['Hours', `${s.day_start}–${s.day_end}${s.flexible ? ' · flexible' : ''}`],
              ['Days', days],
              ['Late after', `${s.grace_minutes} min grace`],
              ['Breaks', s.breaks?.length ? `${s.breaks.length}` : 'None set'],
              ['Time zone', s.timezone],
            ]}
          />
        ) : (
          <Empty text="Not yours to see." />
        )}
      </Panel>
      <Panel title={`Reports to them — ${emp?.reports.length ?? 0}`}>
        {emp?.reports.length ? (
          emp.reports.map((r) => (
            <div key={r.id} className={row}>
              <Cell w={null} className="font-semibold">{r.name}</Cell>
              <Cell w={120} className="text-ink-3">{r.designation ?? '—'}</Cell>
              <StatusChip>{humanise(r.status)}</StatusChip>
            </div>
          ))
        ) : (
          <Empty text="Nobody reports to them." />
        )}
      </Panel>
    </div>
  );
}

function Organizations({ id }: { id: number }) {
  const qc = useQueryClient();
  const [numbering, setNumbering] = useState<Membership | null>(null);
  const q = useQuery({ queryKey: ['hr', 'orgs', id], queryFn: ({ signal }) => apiGet<{ items: Membership[]; can_edit: boolean; can_set_number: boolean }>(`/api/hr/employees/${id}/organizations`, undefined, signal) });
  const makeDefault = async (m: Membership) => {
    try {
      await apiPut(`/api/hr/employees/${id}/default-organization`, { org_id: m.org_id });
      toast('success', `${m.org_name} is now the default.`);
      void qc.invalidateQueries({ queryKey: ['hr', 'orgs', id] });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data!;
  return (
    <div className="max-w-[760px]">
      <Panel title="Organizations" sub="The companies this person works for, and how they are set up in each.">
        {d.items.map((m) => (
          <div key={m.id} className="flex items-center gap-3 border-b border-line/70 px-3.5 py-2.5 last:border-b-0">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-2">
                <b className="text-ink">{m.org_name}</b>
                {m.is_default ? <StatusChip>Default</StatusChip> : null}
              </span>
              <span className="truncate text-[12px] text-ink-3">
                {[m.department, m.designation, m.manager ? `reports to ${m.manager}` : null, `Staff no. ${m.employee_no ?? '—'}`, m.joined_at ? `joined ${dayLong(m.joined_at)}` : null].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span className="flex shrink-0 gap-3 text-[12.5px] font-semibold">
              {d.can_set_number ? (
                <button type="button" className="text-primary hover:underline" onClick={() => setNumbering(m)}>
                  Set staff number
                </button>
              ) : null}
              {d.can_edit && !m.is_default ? (
                <button type="button" className="text-primary hover:underline" onClick={() => void makeDefault(m)}>
                  Make default
                </button>
              ) : null}
            </span>
          </div>
        ))}
        {!d.items.length ? <Empty text="Not placed in any company yet." /> : null}
      </Panel>
      {numbering ? <StaffNumber id={id} m={numbering} onClose={() => setNumbering(null)} onDone={() => (setNumbering(null), void qc.invalidateQueries({ queryKey: ['hr', 'orgs', id] }))} /> : null}
    </div>
  );
}

function StaffNumber({ id, m, onClose, onDone }: { id: number; m: Membership; onClose: () => void; onDone: () => void }) {
  const [no, setNo] = useState(m.employee_no ?? '');
  const save = async () => {
    try {
      await apiPut(`/api/hr/employees/${id}/organizations/${m.org_id}/employee-no`, { employee_no: no.trim() });
      toast('success', 'Saved.');
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <Sheet title={`Staff number · ${m.org_name}`} width={400} onClose={onClose} footer={<><button type="button" className={btn} onClick={onClose}>Cancel</button><button type="button" className={btnPrimary} onClick={() => void save()}>Save</button></>}>
      <Field label="Staff number" hint="Leave blank to clear it.">
        <input aria-label="Staff number" value={no} onChange={(e) => setNo(e.target.value)} className={input} />
      </Field>
    </Sheet>
  );
}

function AttendanceTab({ id, name, self }: { id: number; name: string; self: boolean }) {
  const qc = useQueryClient();
  const [month, setMonth] = useState(ymd(new Date()).slice(0, 7));
  const [fixing, setFixing] = useState<CorrectableDay | null>(null);
  const from = `${month}-01`;
  const to = ymd(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));
  const q = useQuery({
    queryKey: ['hr', 'history', id, month],
    queryFn: ({ signal }) => apiGet<{ records: AttDay[]; totals: AttTotals }>('/api/hr/attendance/history', { from, to, employee_id: id }, signal),
    placeholderData: (prev) => prev,
  });
  const t = q.data?.totals;
  const today = ymd(new Date());
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Previous month" className={btnSmall} onClick={() => setMonth(shiftMonth(month, -1))}>
          ‹
        </button>
        <b className="w-[130px] text-center text-ink">{monthLabel(month)}</b>
        <button type="button" aria-label="Next month" className={btnSmall} onClick={() => setMonth(shiftMonth(month, 1))}>
          ›
        </button>
      </div>
      {t ? (
        <StatGrid min={160}>
          <Kpi icon="user-check" tone="green" label="Present" value={`${t.days_present} / ${t.work_days}`} sub={t.attendance_rate != null ? `${t.attendance_rate}% attendance` : undefined} />
          <Kpi icon="clock" tone="violet" label="Worked" value={minutesLabel(t.net_seconds / 60)} sub={`${minutesLabel(t.overtime_minutes)} overtime`} />
          <Kpi icon="snooze" label="Late days" value={t.late_days} tone={t.late_days ? 'amber' : undefined} />
          <Kpi icon="logout" label="Early departures" value={t.early_days} />
          <Kpi icon="door" label="No check-out" value={t.missing_check_outs} tone={t.missing_check_outs ? 'red' : undefined} />
        </StatGrid>
      ) : null}
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data ? (
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <THead cols={[['Date', 110], ['In', 60], ['Out', 60], ['Break', 60], ['Net', 70], ['Location', null], ['Status', 190], ['', 70]]} />
          {q.data.records
            .filter((d) => d.on_date <= today)
            .slice()
            .reverse()
            .map((d) => (
              <div key={d.on_date} className={row}>
                <Cell w={110}>{dayShort(d.on_date)}</Cell>
                <Cell w={60}>{d.check_in ? attendanceTime(d.check_in) : '—'}</Cell>
                <Cell w={60}>{d.check_out ? attendanceTime(d.check_out) : '—'}</Cell>
                <Cell w={60}>{d.break_seconds > 0 ? minutesLabel(d.break_seconds / 60) : '—'}</Cell>
                <Cell w={70}>{d.check_out && d.net_seconds != null ? minutesLabel(d.net_seconds / 60) : '—'}</Cell>
                <Cell w={null} className="text-ink-2">{d.work_location ?? ''}</Cell>
                <Cell w={190} className="!overflow-visible">
                  <StatusChip>{dayStatus(d)}</StatusChip>
                </Cell>
                <span className="w-[70px] shrink-0 text-right">
                  {!self && d.is_work_day ? (
                    <button type="button" className="text-[12.5px] font-bold text-primary hover:underline" onClick={() => setFixing({ ...d, employee_id: id, name })}>
                      Correct
                    </button>
                  ) : null}
                </span>
              </div>
            ))}
          {!q.data.records.length ? <Empty text="Nothing recorded this month." /> : null}
        </div>
      ) : null}
      {fixing ? <CorrectAttendance day={fixing} onClose={() => setFixing(null)} onDone={() => (setFixing(null), void qc.invalidateQueries({ queryKey: ['hr'] }))} /> : null}
    </div>
  );
}

function TimesheetTab({ p }: { p: Profile }) {
  const [viewing, setViewing] = useState<TimeSheet | null>(null);
  const t = p.timesheet;
  if (!t) return <Empty text="Not yours to see." />;
  if (!t.linked) return <Empty text="No login is linked, so no time can be logged against this person." />;
  return (
    <div className="flex max-w-[760px] flex-col gap-3">
      <StatGrid min={150}>
        <Kpi icon="timer" tone="blue" label="Logged this month" value={minutesLabel(t.minutes_this_month)} />
        <Kpi icon="chart" tone="cyan" label="Recent weeks" value={t.sheets.length} sub={t.sheets.filter((s) => s.status === 'submitted').length ? `${t.sheets.filter((s) => s.status === 'submitted').length} awaiting review` : 'none waiting'} />
      </StatGrid>
      <Panel title="Timesheets">
        <THead cols={[['Period', null], ['Submitted', 130], ['Status', 140], ['', 60]]} />
        {t.sheets.map((s) => (
          <div key={s.id} className={row}>
            <Cell w={null} className="font-semibold">{`${dayLong(s.starts_on)} – ${dayLong(s.ends_on)}`}</Cell>
            <Cell w={130} className="text-ink-3">{s.submitted_at ? dayShort(s.submitted_at.slice(0, 10)) : '—'}</Cell>
            <Cell w={140} className="!overflow-visible">
              <StatusChip>{({ draft: 'Draft', submitted: 'Awaiting review', approved: 'Approved', rejected: 'Sent back' } as Record<string, string>)[s.status] ?? humanise(s.status)}</StatusChip>
            </Cell>
            <span className="w-[60px] shrink-0 text-right">
              <button
                type="button"
                className="text-[12.5px] font-bold text-primary hover:underline"
                onClick={() => setViewing({ id: s.id, employee_id: p.employee.id, employee: p.employee.name, starts_on: s.starts_on, ends_on: s.ends_on, status: s.status, note: null, submitted_at: s.submitted_at, decided_at: null, decided_by: null, decision_note: null, minutes: 0, can_decide: false })}
              >
                View
              </button>
            </span>
          </div>
        ))}
        {!t.sheets.length ? <Empty text="No timesheets yet." /> : null}
      </Panel>
      {viewing ? <SheetDetail sheet={viewing} onClose={() => setViewing(null)} /> : null}
    </div>
  );
}

function LeaveTab({ p }: { p: Profile }) {
  const qc = useQueryClient();
  const id = p.employee.id;
  const [year, setYear] = useState(new Date().getFullYear());
  const [managing, setManaging] = useState<EmployeeLeave['balances'][number] | null>(null);
  const q = useQuery({ queryKey: ['hr', 'emp-leave', id, year], queryFn: ({ signal }) => apiGet<EmployeeLeave>(`/api/hr/employees/${id}/leave`, { year }, signal) });
  const d = q.data;
  const recent = p.leave?.recent ?? [];
  return (
    <div className="grid grid-cols-[1.4fr_1fr] gap-3">
      <Panel
        title={`Leave · ${year}`}
        action={
          <Select aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))} className={input + ' !h-[30px] !w-auto'}>
            {[0, 1, 2].map((n) => (
              <option key={n} value={new Date().getFullYear() - n}>
                {new Date().getFullYear() - n}
              </option>
            ))}
          </Select>
        }
      >
        <THead cols={[['Type', null], ['Entitled', 70], ['Carried in', 80], ['Used', 60], ['Available', 80], ['', 70]]} />
        {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
        {d?.balances.map((b) => (
          <div key={b.type_id} className={row}>
            <Cell w={null} className="font-semibold">
              {b.type}
              {b.taken_from_requests !== b.taken ? <span className="ml-1.5 text-[11px] font-medium text-warning-ink dark:text-warning" title="Approved requests add up to a different figure">requests say {b.taken_from_requests}</span> : null}
            </Cell>
            <Cell w={70} className="tabular-nums">{b.entitled}</Cell>
            <Cell w={80} className="tabular-nums">{b.carried_in}</Cell>
            <Cell w={60} className="tabular-nums">{b.taken}</Cell>
            <Cell w={80} className={cx('font-bold tabular-nums', b.available < 0 && 'text-danger')}>{!b.paid && b.entitled === 0 ? 'Unpaid' : b.available}</Cell>
            <span className="w-[70px] shrink-0 text-right">
              {d.editable ? (
                <button type="button" className="text-[12.5px] font-semibold text-primary hover:underline" onClick={() => setManaging(b)}>
                  Manage
                </button>
              ) : null}
            </span>
          </div>
        ))}
        <div className="px-3.5 py-2 text-[11.5px] text-ink-3">entitled + carried in − used · Balances are set by HR.</div>
      </Panel>
      <Panel title="Recent leave">
        <THead cols={[['Type', null], ['From', 90], ['To', 90], ['Days', 50]]} />
        {recent.map((l) => (
          <div key={String(l.id)} className={row}>
            <Cell w={null}>
              {l.type_name ?? 'Leave'} <span className="text-[11px] text-ink-3">· {humanise(l.status)}</span>
            </Cell>
            <Cell w={90}>{dayShort(l.starts_on)}</Cell>
            <Cell w={90}>{dayShort(l.ends_on)}</Cell>
            <Cell w={50} className="tabular-nums">{Number(l.days)}</Cell>
          </div>
        ))}
        {!recent.length ? <Empty text="No leave recorded." /> : null}
      </Panel>
      {managing ? <ManageBalance employeeId={id} year={year} b={managing} onClose={() => setManaging(null)} onDone={() => (setManaging(null), void qc.invalidateQueries({ queryKey: ['hr'] }))} /> : null}
    </div>
  );
}

/** One type's balance for a year: entitled, carried in and used — or "set available" and the entitlement follows. */
function ManageBalance({ employeeId, year, b, onClose, onDone }: { employeeId: number; year: number; b: EmployeeLeave['balances'][number]; onClose: () => void; onDone: () => void }) {
  const [entitled, setEntitled] = useState(String(b.entitled));
  const [carried, setCarried] = useState(String(b.carried_in));
  const [taken, setTaken] = useState(String(b.taken));
  const [available, setAvailable] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const direct = available.trim() !== '';
  const result = direct ? Number(available) : Number(entitled) + Number(carried) - Number(taken);
  const save = async () => {
    setBusy(true);
    try {
      await apiPut(`/api/hr/employees/${employeeId}/leave/${b.type_id}`, {
        year,
        ...(direct ? { available: Number(available) } : { entitled: Number(entitled) }),
        carried_in: Number(carried),
        taken: Number(taken),
        reason: reason.trim() || undefined,
      });
      toast('success', 'Balance saved.');
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };
  const recalc = async () => {
    setBusy(true);
    try {
      await apiPost(`/api/hr/employees/${employeeId}/leave/${b.type_id}/recalculate`, { year });
      toast('success', 'Used days counted again from the approved requests.');
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={`${b.type} leave — ${year}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn + ' mr-auto'} disabled={busy} onClick={() => void recalc()}>
            Count used days again
          </button>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={busy || Number.isNaN(result)} className={btnPrimary} onClick={() => void save()}>
            Save balance
          </button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-2.5">
        <Field label="Entitled">
          <input aria-label="Entitled" type="number" min={0} max={999} step={0.5} value={entitled} disabled={direct} onChange={(e) => setEntitled(e.target.value)} className={input} />
        </Field>
        <Field label="Carried in">
          <input aria-label="Carried in" type="number" min={0} max={999} step={0.5} value={carried} onChange={(e) => setCarried(e.target.value)} className={input} />
        </Field>
        <Field label="Used">
          <input aria-label="Used" type="number" min={0} max={999} step={0.5} value={taken} onChange={(e) => setTaken(e.target.value)} className={input} />
        </Field>
      </div>
      <Field label="Or set available directly" hint="Adjusts the entitlement so the arithmetic holds.">
        <input aria-label="Or set available directly" type="number" min={0} max={999} step={0.5} value={available} placeholder={String(b.available)} onChange={(e) => setAvailable(e.target.value)} className={input} />
      </Field>
      <Field label="Reason" hint="Recorded on the employee.">
        <input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Opening balance carried over from the old system" className={input} />
      </Field>
      <div className={cx('rounded-[8px] px-3 py-2 text-[12.5px]', result < 0 ? 'bg-warning-bg text-warning-ink dark:text-warning' : 'bg-ground text-ink-2')}>
        {result < 0 ? 'This leaves them owing days. Allowed, but rarely intended.' : `Available after saving: ${Math.round(result * 100) / 100}`}
      </div>
    </Sheet>
  );
}

function RequestsTab({ p, onNew }: { p: Profile; onNew: () => void }) {
  const qc = useQueryClient();
  // The profile's own list carries no decide/withdraw flags; the requests list does.
  const team = useQuery({ queryKey: ['hr', 'requests', 'team', 'all'], queryFn: ({ signal }) => apiGet<RequestsResponse>('/api/hr/requests', { scope: 'team' }, signal), retry: false });
  const flags = new Map((team.data?.requests ?? []).map((r) => [r.id, r]));
  const act = async (id: number, what: 'approve' | 'reject' | 'cancel') => {
    try {
      await apiPost(`/api/hr/requests/${id}/${what}`, {});
      toast('success', what === 'approve' ? 'Approved.' : what === 'reject' ? 'Declined.' : 'Withdrawn.');
      void qc.invalidateQueries({ queryKey: ['hr'] });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <div className="max-w-[860px]">
      <Panel
        title={`Requests — ${p.requests.length}`}
        action={
          <button type="button" className="font-semibold text-primary hover:underline" onClick={onNew}>
            New request
          </button>
        }
      >
        {p.requests.map((r) => {
          const f = flags.get(r.id);
          return (
            <div key={r.id} className="flex items-center gap-3 border-b border-line/70 px-3.5 py-2.5 last:border-b-0">
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="text-ink">{f?.kind_label ?? r.kind_label ?? humanise(r.kind)}</b>
                <span className="truncate text-[12px] text-ink-3">
                  {r.subject ?? '—'} · {dayLong(r.created_at.slice(0, 10))}
                  {r.decided_by ? ` · decided by ${r.decided_by}` : ''}
                  {r.decision_note ? ` · “${r.decision_note}”` : ''}
                </span>
              </span>
              <StatusChip>{humanise(r.status)}</StatusChip>
              {f?.can_decide && r.status === 'pending' ? (
                <>
                  <button type="button" className={btnGood} onClick={() => void act(r.id, 'approve')}>
                    Approve
                  </button>
                  <button type="button" className={btnBad} onClick={() => void act(r.id, 'reject')}>
                    Decline
                  </button>
                </>
              ) : null}
              {f?.can_cancel && r.status === 'pending' ? (
                <button type="button" className={btnSmall} onClick={() => void act(r.id, 'cancel')}>
                  Withdraw
                </button>
              ) : null}
            </div>
          );
        })}
        {!p.requests.length ? <Empty text="No requests yet." /> : null}
      </Panel>
    </div>
  );
}

const VISIBILITY: Array<[string, string, string]> = [
  ['hr_only', 'HR only', 'The employee never sees it'],
  ['manager', 'Manager and HR', ''],
  ['shared', 'Shared with the employee', ''],
];

function NotesTab({ p, onDone }: { p: Profile; onDone: () => void }) {
  const [adding, setAdding] = useState(false);
  const notes = p.notes ?? [];
  const remove = async (noteId: number) => {
    try {
      await apiDelete(`/api/hr/employees/${p.employee.id}/notes/${noteId}`);
      toast('success', 'Note deleted.');
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <div className="max-w-[760px]">
      <Panel
        title={`Notes — ${notes.length}`}
        action={
          <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setAdding(true)}>
            Add a note
          </button>
        }
      >
        {notes.map((n) => (
          <div key={n.id} className="flex gap-3 border-b border-line/70 px-3.5 py-2.5 last:border-b-0">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="whitespace-pre-wrap text-ink">{n.body}</span>
              <span className="text-[11.5px] text-ink-3">
                {n.author ?? 'Someone'} · {when(n.created_at)} · {VISIBILITY.find(([k]) => k === n.visibility)?.[1] ?? humanise(n.visibility)}
              </span>
            </span>
            <button type="button" className="shrink-0 self-start text-[12px] font-semibold text-danger hover:underline" onClick={() => void remove(n.id)}>
              Delete
            </button>
          </div>
        ))}
        {!notes.length ? <Empty text="No notes yet." /> : null}
      </Panel>
      {adding ? <AddNote id={p.employee.id} onClose={() => setAdding(false)} onDone={() => (setAdding(false), onDone())} /> : null}
    </div>
  );
}

function AddNote({ id, onClose, onDone }: { id: number; onClose: () => void; onDone: () => void }) {
  const [body, setBody] = useState('');
  const [vis, setVis] = useState('hr_only');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await apiPost(`/api/hr/employees/${id}/notes`, { body: body.trim(), visibility: vis });
      toast('success', 'Note added.');
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="Add a note"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={busy || !body.trim()} className={btnPrimary} onClick={() => void save()}>
            Add note
          </button>
        </>
      }
    >
      <textarea aria-label="Note" value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} placeholder="What happened, and when." className={input + ' !h-[96px] resize-none py-2'} />
      <div role="radiogroup" aria-label="Who can see it" className="flex flex-col gap-1.5">
        {VISIBILITY.map(([k, l, h]) => (
          <label key={k} className="flex cursor-pointer items-start gap-2">
            <input type="radio" name="note-visibility" checked={vis === k} onChange={() => setVis(k)} className="mt-[3px] accent-primary" />
            <span className="flex flex-col">
              <span className="font-semibold text-ink">{l}</span>
              {h ? <span className="text-[11.5px] text-ink-3">{h}</span> : null}
            </span>
          </label>
        ))}
      </div>
    </Sheet>
  );
}

function SecurityTab({ p, canUsers }: { p: Profile; canUsers: boolean }) {
  const s = p.security;
  return (
    <div className="max-w-[560px]">
      <Panel title="Account security" bodyClassName="px-3.5 py-2">
        {!s || !s.linked ? (
          <Empty text="No login is linked to this record." />
        ) : (
          <>
            <Facts
              rows={[
                ['Account status', humanise(s.status)],
                ['Last signed in', when(s.last_login_at)],
                ['Two-factor', s.two_factor ? 'On' : 'Off'],
                ['Failed attempts', String(s.failed_attempts)],
                ['Locked until', s.locked_until ? when(s.locked_until) : '—'],
                ['Password last set', s.password_set_at ? when(s.password_set_at) : '—'],
              ]}
            />
            <div className="flex items-center gap-2 py-2 text-[12px] text-ink-3">
              Password resets and sign-in controls are in Users.
              {canUsers ? (
                <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void call('app:openInBrowser', { path: `/users/${s.user_id}` })}>
                  Open in Users
                </button>
              ) : null}
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

function ActivityTab({ p }: { p: Profile }) {
  const [section, setSection] = useState('all');
  const items = p.activity ?? [];
  const sections = Array.from(new Set(items.map((a) => a.section)));
  const shown = items.filter((a) => section === 'all' || a.section === section);
  return (
    <div className="flex max-w-[900px] flex-col gap-3">
      {sections.length > 1 ? <Seg label="Section" value={section} onChange={setSection} options={[{ id: 'all', label: 'Everything' }, ...sections.map((s) => ({ id: s, label: humanise(s) }))]} /> : null}
      <Panel title="Activity" sub="Every change to this record, newest first.">
        {shown.map((a) => (
          <div key={a.id} className="flex gap-3 border-b border-line/70 px-3.5 py-2 text-[12.5px] last:border-b-0">
            <span className="w-[150px] shrink-0 text-ink-3">{when(a.created_at)}</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-ink">
                <b>{humanise(a.field)}</b> {a.old_value ? <span className="text-ink-3 line-through">{a.old_value}</span> : null} → <b>{a.new_value || '—'}</b>
              </span>
              <span className="text-[11.5px] text-ink-3">
                {a.actor ?? 'Someone'} · {humanise(a.section)}
                {a.reason ? ` · “${a.reason}”` : ''}
              </span>
            </span>
          </div>
        ))}
        {!shown.length ? <Empty text="Nothing has changed yet." /> : null}
      </Panel>
    </div>
  );
}

