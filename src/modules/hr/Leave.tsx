import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { app } from '../../core/app-state';
import { apiGet, apiPost, request } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { useTab } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { openDocument } from '../../core/open-document';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { pickable, type Balance, type LeaveReq, type LeaveReview, type LeaveTypes, type Profile } from './api';
import { addDays, dayShort, monthGrid, monthLabel, parseYmd, rangeLabel, shiftMonth, ymd } from './dates';
import { btn, btnBad, btnGood, btnPrimary, btnSmall, Empty, Field, humanise, Initials, input, PageHead, Seg, Sheet, StatusChip } from './parts';
import { can } from './Rail';
import { Select } from '../../components/Select';

/**
 * Leave · Requests & calendar (HrLeave, HrLeaveCalendar): my balances, the
 * requests I can see — mine, the ones I was asked to cover, and (for whoever
 * decides them) the ones waiting — as a list or a month calendar, with the
 * request form and the review drawer. Solid is approved, dashed is waiting.
 */
type Filter = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'all';
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'all', label: 'All' },
];

export function normaliseLeave(r: LeaveReq): LeaveReq {
  const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
  return { ...r, id: Number(r.id), employee_id: Number(r.employee_id), responsible_person_id: n(r.responsible_person_id), minutes: n(r.minutes), days: String(Number(r.days)) };
}

export function describeLeave(r: Pick<LeaveReq, 'type_name' | 'starts_on' | 'ends_on' | 'days' | 'portion' | 'minutes' | 'starts_at' | 'reason'>): string {
  const when = r.starts_on === r.ends_on ? dayShort(r.starts_on) : `${r.starts_on} → ${r.ends_on}`;
  const n = Number(r.days);
  const how =
    r.portion === 'short'
      ? `${Math.round(((r.minutes ?? 0) / 60) * 10) / 10}h${r.starts_at ? ` from ${String(r.starts_at).slice(0, 5)}` : ''}`
      : r.portion === 'half_morning'
        ? 'morning · 0.5 day'
        : r.portion === 'half_afternoon'
          ? 'afternoon · 0.5 day'
          : `${n} ${n === 1 ? 'day' : 'days'}`;
  return [r.type_name ?? 'Leave', when, how, r.reason].filter(Boolean).join(' · ');
}

export default function Leave() {
  const qc = useQueryClient();
  const { query, go } = useTab();
  const userId = useStore(app, (s) => s.auth?.user?.id);
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const [filter, setFilter] = useState<Filter>('pending');
  const [mode, setMode] = useState<'list' | 'calendar'>('list');
  const [month, setMonth] = useState(() => ymd(new Date()).slice(0, 7));
  const [asking, setAsking] = useState(query.get('new') === '1');
  const [reviewing, setReviewing] = useState<number | null>(Number(query.get('leave')) || null);
  const [sendBack, setSendBack] = useState<LeaveReq | null>(null);
  // The server sends these rows as they are stored: numbers arrive as strings.
  const list = useQuery({ queryKey: ['hr', 'leave-requests'], queryFn: ({ signal }) => apiGet<LeaveReq[]>('/api/hr/leave/requests', undefined, signal).then((rows) => rows.map(normaliseLeave)) });
  const balances = useQuery({ queryKey: ['hr', 'leave-balance'], queryFn: ({ signal }) => apiGet<{ year: number; balances: Balance[] }>('/api/hr/leave/balance', undefined, signal) });
  const me = useQuery({ queryKey: ['hr', 'me'], queryFn: ({ signal }) => apiGet<Profile>('/api/hr/me/profile', undefined, signal) });
  const holidays = useQuery({ queryKey: ['hr', 'holidays', month.slice(0, 4)], queryFn: ({ signal }) => apiGet<{ holidays: Array<{ on_date: string; name: string }> }>('/api/hr/holidays', { year: month.slice(0, 4) }, signal), enabled: can(perms, 'hr.view') && mode === 'calendar', retry: false });
  const myEmp = me.data?.employee?.id;
  const all = list.data ?? [];
  const shown = all.filter((r) => filter === 'all' || (filter === 'pending' ? r.status === 'pending' || r.status === 'needs_resubmission' : r.status === filter));
  const refresh = () => void qc.invalidateQueries({ queryKey: ['hr'] });

  const act = async (path: string, done: string, body: Record<string, unknown> = {}) => {
    try {
      await apiPost(path, body);
      toast('success', done);
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const closeAsk = () => {
    setAsking(false);
    if (query.get('new')) go('/hr?tab=leave');
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5">
      <PageHead title="Requests & calendar" sub="Leave" />
      <div className="flex flex-wrap items-center gap-2">
        <Seg label="Status" value={filter} onChange={setFilter} options={FILTERS} />
        <span className="flex-1" />
        <Seg label="View" value={mode} onChange={setMode} options={[{ id: 'list', label: 'List' }, { id: 'calendar', label: 'Calendar' }]} />
        <button type="button" className={btnPrimary} onClick={() => setAsking(true)}>
          Request leave
        </button>
      </div>
      <div className="-mt-1 flex flex-wrap gap-2">
        {(balances.data?.balances ?? []).map((b) => (
          <span key={b.type_id} className="rounded-[8px] border border-line bg-surface px-2.5 py-1 text-[12px] text-ink-2">
            <b className="text-ink">{b.type}</b> {Number(b.entitled) > 0 ? `${b.available} left of ${b.entitled}/yr` : Number(b.available) > 0 ? `${b.available} left` : 'unpaid'}
          </span>
        ))}
      </div>
      {list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.data && mode === 'list' ? (
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
          {!shown.length ? <Empty text={filter === 'pending' ? 'Nothing is waiting.' : 'Nothing here.'} /> : null}
          {shown.map((r) => {
            const mine = r.employee_id === myEmp;
            const coverMe = String(r.responsible_person_id ?? '') === String(userId) && r.responsible_status === 'pending' && r.status === 'pending';
            const note = [r.status === 'needs_resubmission' && r.resubmit_note ? `Needs changes: ${r.resubmit_note}` : null, r.responsible_status === 'declined' && r.responsible_note ? `Cover declined: ${r.responsible_note}` : null, coverMe ? 'You were asked to cover this.' : null].filter(Boolean).join(' · ');
            return (
              <div key={r.id} className="flex items-center gap-3 border-b border-line/70 px-3.5 py-[11px] last:border-b-0">
                <Initials name={r.employee_name} size={34} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <b className="text-ink">{mine ? 'You' : (r.employee_name ?? '—')}</b>
                    <StatusChip>{humanise(r.status)}</StatusChip>
                    {r.responsible_status ? <StatusChip>{`cover ${r.responsible_status}`}</StatusChip> : null}
                  </span>
                  <span className="truncate text-[12.5px] text-ink-2">{describeLeave(r)}</span>
                  {note ? <span className="text-[12px] font-semibold text-[#9A4A06] dark:text-warning">{note}</span> : null}
                </span>
                <span className="flex shrink-0 flex-wrap justify-end gap-1.5">
                  {r.can_decide && r.status === 'pending' ? (
                    <>
                      <button type="button" className={btnSmall} onClick={() => setReviewing(r.id)}>
                        Review
                      </button>
                      <button type="button" className={btnGood} onClick={() => void act(`/api/hr/leave/requests/${r.id}/decide`, 'Approved.', { decision: 'approved' })}>
                        Approve
                      </button>
                      <button type="button" className={btnBad} onClick={() => void act(`/api/hr/leave/requests/${r.id}/decide`, 'Rejected.', { decision: 'rejected' })}>
                        Reject
                      </button>
                      <button type="button" className={btnSmall} onClick={() => setSendBack(r)}>
                        Send back
                      </button>
                    </>
                  ) : null}
                  {coverMe ? (
                    <>
                      <button type="button" className={btnGood} onClick={() => void act(`/api/hr/leave/requests/${r.id}/cover`, 'You are covering it.', { answer: 'accepted' })}>
                        Accept cover
                      </button>
                      <button type="button" className={btnBad} onClick={() => void act(`/api/hr/leave/requests/${r.id}/cover`, 'Declined.', { answer: 'declined' })}>
                        Decline
                      </button>
                    </>
                  ) : null}
                  {mine && (r.status === 'pending' || r.status === 'needs_resubmission' || (r.status === 'approved' && r.starts_on > ymd(new Date()))) ? (
                    <button type="button" className={btnSmall} onClick={() => void act(`/api/hr/leave/requests/${r.id}/cancel`, 'Withdrawn.')}>
                      Withdraw
                    </button>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
      {list.data && mode === 'calendar' ? <LeaveCalendar month={month} setMonth={setMonth} requests={all.filter((r) => r.status === 'approved' || r.status === 'pending')} holidays={holidays.data?.holidays ?? []} onOpen={(r) => (r.can_decide ? setReviewing(r.id) : undefined)} /> : null}
      {asking ? <RequestLeave onClose={closeAsk} onDone={() => (closeAsk(), refresh())} /> : null}
      {reviewing ? <ReviewLeave id={reviewing} onClose={() => (setReviewing(null), query.get('leave') ? go('/hr?tab=leave') : undefined)} onDone={() => (setReviewing(null), refresh())} /> : null}
      {sendBack ? <SendBack r={sendBack} onClose={() => setSendBack(null)} onDone={() => (setSendBack(null), refresh())} /> : null}
    </div>
  );
}

function LeaveCalendar({ month, setMonth, requests, holidays, onOpen }: { month: string; setMonth: (m: string) => void; requests: LeaveReq[]; holidays: Array<{ on_date: string; name: string }>; onOpen: (r: LeaveReq) => void }) {
  const cells = monthGrid(month);
  const today = ymd(new Date());
  return (
    <div className="flex min-h-[520px] flex-1 flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
        <button type="button" className={btn + ' !h-7 !px-2.5'} aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
          ←
        </button>
        <b className="text-[15px] text-ink">{monthLabel(month)}</b>
        <button type="button" className={btn + ' !h-7 !px-2.5'} aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>
          →
        </button>
        <span className="flex-1" />
        <span className="text-[12px] text-ink-3">Solid = approved · dashed = awaiting approval</span>
      </div>
      <div className="grid grid-cols-7 border-b border-line py-1.5 text-center text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="grid flex-1 auto-rows-fr grid-cols-7" role="grid" aria-label={`Leave in ${monthLabel(month)}`}>
        {cells.map((c) => {
          const hol = holidays.find((h) => h.on_date === c.day);
          const on = requests.filter((r) => r.starts_on <= c.day && r.ends_on >= c.day);
          return (
            <div key={c.day} role="gridcell" className={cx('flex min-h-[74px] flex-col gap-0.5 overflow-hidden border-r border-b border-line/70 px-1.5 py-1', c.weekend ? 'bg-ground/60' : 'bg-surface', !c.inMonth && 'opacity-45')}>
              <span className={cx('text-[11.5px] font-bold', c.day === today ? 'text-primary' : hol ? 'text-[#6B3FB5]' : 'text-ink-2')}>{parseYmd(c.day).getDate()}</span>
              {hol ? <span className="truncate rounded-[4px] bg-[#F1EAFB] px-1.5 py-px text-[10.5px] font-bold text-[#5B2FA0] dark:bg-[#2A1F45] dark:text-[#C4A8F0]">{hol.name}</span> : null}
              {on.slice(0, 3).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  title={`${r.employee_name ?? ''} · ${describeLeave(r)}`}
                  onClick={() => onOpen(r)}
                  className={cx('truncate rounded-[4px] px-1.5 py-px text-left text-[10.5px] font-bold', r.status === 'approved' ? 'bg-primary text-white' : 'border-[1.5px] border-dashed border-primary text-primary')}
                >
                  {(r.employee_name ?? '').split(' ')[0]} · {r.type_name}
                  {r.portion === 'half_morning' ? ' (am)' : r.portion === 'half_afternoon' ? ' (pm)' : r.portion === 'short' ? ' (short)' : ''}
                </button>
              ))}
              {on.length > 3 ? <span className="text-[10.5px] font-semibold text-ink-3">+{on.length - 3} more</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Weekdays from one day to another, both counted: the estimate for a full-day request. */
export function weekdaysBetween(from: string, to: string): number {
  if (!from || !to || to < from) return 0;
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const w = parseYmd(d).getDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}

function RequestLeave({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const canPick = can(perms, 'hr.manage') || can(perms, 'hr.leave.manage');
  const types = useQuery({ queryKey: ['hr', 'leave-types'], queryFn: ({ signal }) => apiGet<LeaveTypes>('/api/hr/leave/types', undefined, signal) });
  const colleagues = useQuery({ queryKey: ['hr', 'colleagues'], queryFn: ({ signal }) => apiGet<{ people: Array<{ id: number; name: string }> }>('/api/hr/leave/colleagues', undefined, signal) });
  const employees = useQuery({ queryKey: ['hr', 'employees'], queryFn: ({ signal }) => apiGet<Array<{ id: number; name: string; employee_no: string; status: string; exit_at: string | null }>>('/api/hr/employees', undefined, signal), enabled: canPick && can(perms, 'hr.view'), retry: false });
  const active = (types.data?.types ?? []).filter((t) => t.status === 'active');
  const [employee, setEmployee] = useState('');
  const [typeId, setTypeId] = useState('');
  const [portion, setPortion] = useState('full');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [minutes, setMinutes] = useState('60');
  const [startsAt, setStartsAt] = useState('');
  const [reason, setReason] = useState('');
  const [responsible, setResponsible] = useState('');
  const [evidence, setEvidence] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const meta = types.data;
  const type = active.find((t) => String(t.id) === typeId) ?? active[0];
  const partDay = portion !== 'full';
  const portions = Object.entries(meta?.portions ?? { full: 'Full day(s)' }).filter(([k]) => k === 'full' || !type || (k === 'short' ? type.allows_short_leave !== false : type.allows_half_day !== false));
  const cost = !partDay ? weekdaysBetween(start, end || start) : portion === 'short' ? Math.round((Number(minutes) / (meta?.day_minutes || 480)) * 10000) / 10000 : (meta?.half_day_days ?? 0.5);
  const overCap = portion === 'short' && Number(minutes) > (meta?.short_max_minutes || 120);

  const submit = async () => {
    if (!type) return toast('error', 'Choose a leave type.');
    if (!start) return toast('error', 'Choose the first day.');
    if (!partDay && end && end < start) return toast('error', 'The last day cannot be before the first.');
    if (overCap) return toast('error', `A short leave is at most ${meta?.short_max_minutes} minutes.`);
    setBusy(true);
    try {
      const d = await apiPost<{ id: number; days: number | string; status: string }>('/api/hr/leave/requests', {
        ...(canPick && employee ? { employee_id: Number(employee) } : {}),
        type_id: type.id,
        starts_on: start,
        ends_on: partDay ? start : end || start,
        reason: reason.trim() || null,
        portion,
        minutes: portion === 'short' ? Number(minutes) : null,
        starts_at: portion === 'short' && startsAt ? startsAt : null,
        responsible_person_id: responsible ? Number(responsible) : null,
      });
      if (evidence && d.id) {
        const form = new FormData();
        form.append('file', evidence, evidence.name);
        try {
          await request('POST', `/api/hr/leave/requests/${d.id}/evidence`, { body: form });
        } catch (e) {
          toast('error', `The request was saved, but the attachment did not upload: ${errorMessage(e)}`);
        }
      }
      toast('success', d.status === 'approved' ? `Recorded — ${d.days} day(s).` : `Requested — ${d.days} day(s), awaiting approval.`);
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Request leave"
      side
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={busy || !type} className={btnPrimary} onClick={() => void submit()}>
            Submit request
          </button>
        </>
      }
    >
      {canPick && employees.data ? (
        <Field label="Employee">
          <Select aria-label="Employee" value={employee} onChange={(e) => setEmployee(e.target.value)} className={input}>
            <option value="">Me</option>
            {employees.data.filter((x) => pickable(x, ymd(new Date()))).map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} · {x.employee_no}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label="Leave type">
        <Select aria-label="Leave type" value={type ? String(type.id) : ''} onChange={(e) => (setTypeId(e.target.value), setPortion('full'))} className={input} disabled={!active.length}>
          {active.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} — {Number(t.days_per_year)}d/yr{!t.requires_approval ? ' (no approval needed)' : ''}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="How much">
        <div className="flex flex-wrap gap-1.5">
          {portions.map(([k, l]) => (
            <button key={k} type="button" aria-pressed={portion === k} onClick={() => (setPortion(k), k !== 'full' ? setEnd('') : undefined)} className={cx('h-[30px] rounded-[7px] px-2.5 text-[12.5px] font-semibold', portion === k ? 'bg-primary text-white' : 'border border-line bg-surface text-ink hover:bg-subtle')}>
              {l}
            </button>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label={partDay ? 'Day' : 'First day'}>
          <input type="date" aria-label={partDay ? 'Day' : 'First day'} value={start} onChange={(e) => setStart(e.target.value)} className={input} />
        </Field>
        {partDay ? (
          portion === 'short' ? (
            <div className="grid grid-cols-2 gap-2">
              <Field label="From">
                <input type="time" aria-label="From" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={input} />
              </Field>
              <Field label="Minutes">
                <input aria-label="Minutes" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ''))} className={input} />
              </Field>
            </div>
          ) : (
            <span />
          )
        ) : (
          <Field label="Last day">
            <input type="date" aria-label="Last day" min={start || undefined} value={end} onChange={(e) => setEnd(e.target.value)} className={input} />
          </Field>
        )}
      </div>
      <Field label="Reason — optional">
        <input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. family trip" className={input} />
      </Field>
      <Field label="Responsible person" hint="They are asked to cover the work and must accept before this can be approved.">
        <Select aria-label="Responsible person" value={responsible} onChange={(e) => setResponsible(e.target.value)} className={input}>
          <option value="">Choose someone…</option>
          {(colleagues.data?.people ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Evidence — optional" hint="A medical certificate or similar. Filed against your record and visible to HR only.">
        <input type="file" aria-label="Evidence" onChange={(e) => setEvidence(e.target.files?.[0] ?? null)} className="text-[12.5px] font-medium text-ink-2 file:mr-2 file:h-[30px] file:rounded-[7px] file:border file:border-line file:bg-surface file:px-2.5 file:font-semibold file:text-ink" />
      </Field>
      {start && cost > 0 ? (
        <div className="rounded-[8px] bg-selection px-2.5 py-2 text-[12.5px] font-bold text-primary">
          This comes off the balance as {partDay ? cost : `about ${cost}`} {cost === 1 ? 'day' : 'days'}
          {!partDay ? <span className="block text-[11.5px] font-medium text-ink-3">Holidays and days you don’t work are not counted; the server works out the exact figure.</span> : null}
        </div>
      ) : null}
      {overCap ? <span className="text-[12px] font-semibold text-danger">A short leave is at most {meta?.short_max_minutes} minutes.</span> : null}
    </Sheet>
  );
}

function SendBack({ r, onClose, onDone }: { r: LeaveReq; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!note.trim()) return toast('error', 'Say what needs changing.');
    setBusy(true);
    try {
      await apiPost(`/api/hr/leave/requests/${r.id}/resubmit`, { note: note.trim() });
      toast('success', 'Sent back for changes.');
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="Send back for changes"
      width={440}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={busy} className={btnPrimary} onClick={() => void send()}>
            Send back
          </button>
        </>
      }
    >
      <span className="text-[12.5px] text-ink-2">
        {r.employee_name} · {describeLeave(r)}
      </span>
      <Field label="What needs changing">
        <textarea aria-label="What needs changing" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. attach the medical certificate" className={input + ' !h-[60px] resize-none py-2'} />
      </Field>
    </Sheet>
  );
}

export function ReviewLeave({ id, onClose, onDone }: { id: number; onClose: () => void; onDone: () => void }) {
  const me = useStore(app, (s) => s.auth?.user?.id);
  const q = useQuery({ queryKey: ['hr', 'leave-review', id], queryFn: ({ signal }) => apiGet<LeaveReview>(`/api/hr/leave/requests/${id}/review`, undefined, signal) });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const decide = async (decision: 'approved' | 'rejected') => {
    setBusy(true);
    try {
      await apiPost(`/api/hr/leave/requests/${id}/decide`, { decision, ...(note.trim() ? { note: note.trim() } : {}) });
      toast('success', decision === 'approved' ? 'Approved.' : 'Rejected.');
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };
  const cover = async (answer: 'accepted' | 'declined') => {
    setBusy(true);
    try {
      await apiPost(`/api/hr/leave/requests/${id}/cover`, { answer, ...(note.trim() ? { note: note.trim() } : {}) });
      toast('success', answer === 'accepted' ? 'You are covering it.' : 'You declined to cover it.');
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };
  const v = q.data;
  const askedMe = !!v?.responsible && String(v.responsible.user_id) === String(me) && v.responsible.status === 'pending' && v.request.status === 'pending';
  return (
    <div className="no-drag fixed inset-0 z-50 bg-[rgba(15,27,61,.32)]" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <aside aria-label="Review leave" className="animate-in absolute top-0 right-0 bottom-0 flex w-[460px] flex-col bg-surface shadow-[-10px_0_30px_rgb(var(--ws-shadow-rgb)/.18)]">
        <div className="flex items-center border-b border-line px-4 py-3.5">
          <b className="flex-1 truncate text-[15px] text-ink">Review leave{v?.employee.name ? ` · ${v.employee.name}` : ''}</b>
          <button type="button" aria-label="Close" onClick={onClose} className="h-7 w-7 rounded-full text-[16px] text-ink-3 hover:bg-subtle">
            ×
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-[11px] overflow-y-auto px-4 py-3 scroll-thin">
          {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
          {v ? (
            <>
              <span className="text-ink-2">
                {v.request.type_name} · {rangeLabel(v.request.starts_on, v.request.ends_on)} · {v.request.days} {Number(v.request.days) === 1 ? 'day' : 'days'}
                {v.request.reason ? ` · “${v.request.reason}”` : ''}
              </span>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Pending requests" value={String(v.pending.count)} sub={`${v.pending.days} day(s) total`} />
                <Stat label="Notice" value={v.request.notice_days != null ? `${v.request.notice_days} days` : '—'} sub={v.request.requested_on ? `asked on ${dayShort(v.request.requested_on)}` : undefined} />
                <Stat label={`Taken in ${v.history.year}`} value={String(v.history.approved_days)} sub={`${v.history.approved_count} approved · ${v.history.rejected_count} refused`} />
              </div>
              <div>
                <b className="text-ink">Who else is off then</b>
                <div className="mt-0.5 text-[12.5px] text-ink-2">
                  {v.overlap.items.length ? v.overlap.items.map((o, i) => <div key={i}>{`${o.employee_name ?? 'Someone'} · ${o.type_name ?? 'Leave'} · ${rangeLabel(o.starts_on, o.ends_on)}`}</div>) : v.overlap.department_known ? 'Nobody else in the department.' : 'Nobody else that you can see.'}
                </div>
              </div>
              {v.responsible ? (
                <div className={cx('rounded-[9px] px-3 py-2.5', v.responsible.status === 'accepted' ? 'bg-success-bg' : v.responsible.status === 'declined' ? 'bg-danger-bg' : 'bg-warning-bg')}>
                  <b className={v.responsible.status === 'accepted' ? 'text-success' : v.responsible.status === 'declined' ? 'text-danger' : 'text-warning'}>Cover</b>
                  <div className="text-[12.5px] text-ink-2">
                    {v.responsible.name} — {v.responsible.status === 'accepted' ? 'Accepted the cover' : v.responsible.status === 'declined' ? `Declined the cover${v.responsible.note ? `: ${v.responsible.note}` : ''}` : 'Waiting for their answer'}
                  </div>
                </div>
              ) : null}
              <div>
                <b className="text-ink">Attachment</b>
                <div className="mt-0.5 text-[12.5px] text-ink-3">
                  {v.evidence.length
                    ? v.evidence.map((x) => (
                        <button key={x.id} type="button" className="block font-semibold text-primary hover:underline" onClick={() => openEvidence(x)}>
                          {x.title || x.filename}
                        </button>
                      ))
                    : 'Nothing was attached to this request.'}
                </div>
              </div>
              <div>
                <b className="text-ink">Leave balances</b>
                <div className="mt-0.5 text-[12.5px] text-ink-2">{v.balances.map((b) => `${b.type_name} ${b.remaining} of ${b.entitled}`).join(' · ') || '—'}</div>
              </div>
              {v.attendance ? (
                <div className="grid grid-cols-3 gap-2">
                  <Stat label="Days present" value={String(v.attendance.days_present)} />
                  <Stat label="Days late" value={String(v.attendance.days_late)} tone={v.attendance.days_late ? 'text-[#9A4A06] dark:text-warning' : undefined} />
                  <Stat label="Missing check-outs" value={String(v.attendance.missing_check_outs)} tone={v.attendance.missing_check_outs ? 'text-danger' : undefined} />
                </div>
              ) : null}
              <Field label="Note (optional)">
                <input aria-label="Decision note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Recorded with the decision" className={input} />
              </Field>
            </>
          ) : null}
        </div>
        <div className="flex gap-2 border-t border-line px-4 py-3">
          <button type="button" className={btn} onClick={onClose}>
            Close
          </button>
          <span className="flex-1" />
          {askedMe ? (
            <>
              <button type="button" disabled={busy} className={btn + ' !text-danger'} onClick={() => void cover('declined')}>
                Decline cover
              </button>
              <button type="button" disabled={busy} className={btn + ' !border-[#1F7A4D] !text-[#1F7A4D] dark:!border-success/50 dark:!text-success'} onClick={() => void cover('accepted')}>
                Accept cover
              </button>
            </>
          ) : null}
          {v?.request.status === 'pending' ? (
            <>
              <button type="button" disabled={busy} className={btn + ' !border-[#F1B8A8] !text-danger dark:!border-danger/40'} onClick={() => void decide('rejected')}>
                Reject
              </button>
              <button type="button" disabled={busy} className={btnPrimary + ' !bg-[#1F7A4D] hover:!bg-[#1A6841]'} onClick={() => void decide('approved')}>
                Approve
              </button>
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-[9px] bg-ground px-2.5 py-2">
      <div className="text-[11px] font-semibold text-ink-3">{label}</div>
      <b className={cx('text-[16px] text-ink', tone)}>{value}</b>
      {sub ? <div className="text-[11px] text-ink-3">{sub}</div> : null}
    </div>
  );
}

/**
 * A leave request's evidence is an employee document (`/hr/employees/{e}/documents/{id}`):
 * opened on this computer — PDF Studio for a PDF, the installed app for the rest.
 */
function openEvidence(x: { url: string; title?: string | null; filename: string }): void {
  const m = /\/hr\/employees\/(\d+)\/documents\/(\d+)/.exec(x.url);
  if (m) void openDocument({ hrEmployee: Number(m[1]), hrDocument: Number(m[2]) }, x.filename);
  else void call('app:openInBrowser', { path: `/${x.url.replace(/^\/+/, '').replace(/^https?:\/\/[^/]+\//, '')}` });
}
