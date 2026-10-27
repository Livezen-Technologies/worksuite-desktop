import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { listStamp } from '../../core/time';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner } from '../../components/ui';
import { PROFILE_FIELDS, type CoverAsk, type Profile, type RequestsResponse } from './api';
import { rangeLabel } from './dates';
import { btn, btnPrimary, btnSmall, Cell, Empty, Field, input, PageHead, row, Seg, Sheet, StatusChip, THead } from '../../components/PageKit';
import { Select } from '../../components/Select';

/**
 * Requests (HrRequests): what I have asked HR for and what waits on me —
 * attendance corrections, working from home, a changed detail, a letter —
 * with colleagues who named me as their cover first, since their leave
 * cannot be approved until I answer.
 */
const STATUS: Array<[string, string]> = [
  ['', 'Any status'],
  ['pending', 'Awaiting a decision'],
  ['approved', 'Approved'],
  ['rejected', 'Declined'],
  ['cancelled', 'Withdrawn'],
];
const STATUS_LABEL: Record<string, string> = { pending: 'Awaiting a decision', approved: 'Approved', rejected: 'Declined', cancelled: 'Withdrawn' };

export default function Requests() {
  const qc = useQueryClient();
  const [scope, setScope] = useState<'mine' | 'team'>('mine');
  const [status, setStatus] = useState('');
  const [asking, setAsking] = useState(false);
  const [covering, setCovering] = useState<CoverAsk | null>(null);
  const [later, setLater] = useState<number[]>([]);
  const q = useQuery({ queryKey: ['hr', 'requests', scope, status], queryFn: ({ signal }) => apiGet<RequestsResponse>('/api/hr/requests', { scope, status: status || undefined }, signal) });
  const me = useQuery({ queryKey: ['hr', 'me'], queryFn: ({ signal }) => apiGet<Profile>('/api/hr/me/profile', undefined, signal) });
  const cover = useQuery({ queryKey: ['hr', 'cover', 'mine'], queryFn: ({ signal }) => apiGet<{ requests: CoverAsk[] }>('/api/hr/leave/cover/mine', undefined, signal) });
  const asks = (cover.data?.requests ?? []).filter((c) => !later.includes(c.id));
  const myId = me.data?.employee?.id;
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

  return (
    <div className="flex flex-col gap-3.5">
      <PageHead title="Requests">
        {myId ? (
          <button type="button" className={btnPrimary} onClick={() => setAsking(true)}>
            New request
          </button>
        ) : null}
      </PageHead>
      {asks.length ? (
        <section className="flex flex-col gap-2 rounded-[12px] border border-warning-line bg-warning-bg px-3.5 py-3 dark:border-warning/30 dark:bg-warning-bg">
          <b className="text-ink">Waiting on you</b>
          <span className="text-[12.5px] text-warning-strong dark:text-warning">Colleagues who named you as their cover. They cannot be approved until you answer.</span>
          {asks.map((c) => (
            <div key={c.id} className="flex items-center gap-2.5 rounded-[9px] bg-surface px-2.5 py-2">
              <b className="min-w-0 flex-1 truncate text-ink">
                {c.employee_name} · {c.type_name} · {rangeLabel(c.starts_on, c.ends_on)} · {c.days} {Number(c.days) === 1 ? 'day' : 'days'}
              </b>
              <button type="button" className={btnPrimary + ' !h-[30px]'} onClick={() => setCovering(c)}>
                Review
              </button>
              <button type="button" className={btnSmall} onClick={() => setLater([...later, c.id])}>
                Not now
              </button>
            </div>
          ))}
        </section>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Seg label="Whose requests" value={scope} onChange={setScope} options={[{ id: 'mine', label: 'My requests' }, { id: 'team', label: 'To review' }]} />
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={input + ' !w-auto'}>
          {STATUS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        {scope === 'team' ? <span className="text-[12px] text-ink-3">You will only see requests from people who report to you.</span> : null}
      </div>
      <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
        <THead cols={[['Employee', 180], ['Kind', 170], ['About', null], ['Asked', 100], ['Status', 150], ['', 190]]} />
        {q.isLoading ? <Spinner /> : q.error ? <div className="p-3"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div> : null}
        {q.data && !q.data.requests.length ? <Empty text={scope === 'mine' ? 'You have not asked for anything yet.' : 'Nothing is waiting on you.'} /> : null}
        {(q.data?.requests ?? []).map((r) => (
          <div key={r.id} className={row}>
            <Cell w={180} className="font-semibold">{r.employee ?? '—'}</Cell>
            <Cell w={170}>{r.kind_label}</Cell>
            <Cell w={null} className="text-ink-2">{r.subject ?? '—'}</Cell>
            <Cell w={100} className="text-ink-3">{listStamp(r.created_at)}</Cell>
            <Cell w={150}>
              <StatusChip>{STATUS_LABEL[r.status] ?? r.status}</StatusChip>
            </Cell>
            <span className="flex w-[190px] shrink-0 justify-end gap-3 text-[12.5px] font-bold">
              {r.can_decide && r.status === 'pending' ? (
                <>
                  <button type="button" className="text-primary hover:underline" onClick={() => void act(`/api/hr/requests/${r.id}/approve`, 'Approved.')}>
                    Approve
                  </button>
                  <button type="button" className="text-danger hover:underline" onClick={() => void act(`/api/hr/requests/${r.id}/reject`, 'Declined.')}>
                    Decline
                  </button>
                </>
              ) : null}
              {r.can_cancel ? (
                <button type="button" className="text-primary hover:underline" onClick={() => void act(`/api/hr/requests/${r.id}/cancel`, 'Withdrawn.')}>
                  Withdraw
                </button>
              ) : null}
            </span>
          </div>
        ))}
      </div>
      {asking && myId ? <NewRequestSheet employeeId={myId} onClose={() => setAsking(false)} onDone={() => (setAsking(false), refresh())} /> : null}
      {covering ? <CoverDialog ask={covering} onClose={() => setCovering(null)} onDone={() => (setCovering(null), refresh())} /> : null}
    </div>
  );
}

/** "Can you cover this?" — yes or no to a colleague's leave, with a note back. */
export function CoverDialog({ ask, onClose, onDone }: { ask: CoverAsk; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const answer = async (verdict: 'accepted' | 'declined') => {
    setBusy(true);
    try {
      await apiPost(`/api/hr/leave/requests/${ask.id}/cover`, { answer: verdict, note: note.trim() || undefined });
      toast('success', verdict === 'accepted' ? 'You are covering it.' : 'Declined.');
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="Can you cover this?"
      width={420}
      onClose={onClose}
      footer={
        <>
          <button type="button" disabled={busy} className={btn + ' !text-danger'} onClick={() => void answer('declined')}>
            No, I cannot
          </button>
          <button type="button" disabled={busy} className={btnPrimary + ' !bg-success hover:!bg-success'} onClick={() => void answer('accepted')}>
            Yes, I will cover
          </button>
        </>
      }
    >
      <div className="grid grid-cols-[80px_1fr] gap-x-2.5 gap-y-1.5 text-[13px]">
        <span className="text-ink-3">Who</span>
        <b className="text-ink">{ask.employee_name}</b>
        <span className="text-ink-3">Type</span>
        <b className="text-ink">{ask.type_name}</b>
        <span className="text-ink-3">Dates</span>
        <b className="text-ink">{rangeLabel(ask.starts_on, ask.ends_on)}</b>
        <span className="text-ink-3">Length</span>
        <b className="text-ink">
          {ask.days} {Number(ask.days) === 1 ? 'day' : 'days'}
        </b>
        {ask.reason ? (
          <>
            <span className="text-ink-3">Reason</span>
            <b className="text-ink">{ask.reason}</b>
          </>
        ) : null}
      </div>
      <Field label="A note back (optional)">
        <input value={note} onChange={(e) => setNote(e.target.value)} className={input} />
      </Field>
    </Sheet>
  );
}

/**
 * "New HR request": what is being asked for decides the fields — a day and
 * corrected times for attendance, a day or two for working from home, a
 * field and its new value for a profile change. The reason is required: it is
 * what the decision is made on.
 */
export function NewRequestSheet({ employeeId, onClose, onDone, initial }: { employeeId: number; onClose: () => void; onDone: () => void; initial?: { kind?: string; on_date?: string; check_in?: string; check_out?: string } }) {
  const kinds = useQuery({ queryKey: ['hr', 'request-kinds'], queryFn: ({ signal }) => apiGet<{ kinds: Array<{ value: string; label: string }>; applies: string[] }>('/api/hr/requests/kinds', undefined, signal) });
  const [kind, setKind] = useState(initial?.kind ?? 'attendance');
  const [onDate, setOnDate] = useState(initial?.on_date ?? '');
  const [toDate, setToDate] = useState('');
  const [checkIn, setCheckIn] = useState(initial?.check_in ?? '');
  const [checkOut, setCheckOut] = useState(initial?.check_out ?? '');
  const [field, setField] = useState(PROFILE_FIELDS[0]![0]);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const corrective = kind === 'attendance' || kind === 'timesheet';

  const submit = async () => {
    if (!reason.trim()) return toast('error', 'Say why you are asking.');
    const payload: Record<string, unknown> = {};
    if (corrective) {
      if (!onDate) return toast('error', 'Choose the day to correct.');
      if (!checkIn && !checkOut) return toast('error', 'Give the corrected check-in or check-out time.');
      payload.on_date = onDate;
      if (checkIn) payload.check_in = checkIn;
      if (checkOut) payload.check_out = checkOut;
    }
    if (kind === 'work_from_home') {
      if (!onDate) return toast('error', 'Choose the day you want to work from home.');
      if (toDate && toDate < onDate) return toast('error', 'The last day cannot be before the first.');
      payload.on_date = onDate;
      if (toDate) payload.to_date = toDate;
    }
    if (kind === 'profile') {
      if (!value.trim()) return toast('error', 'Give the new value.');
      payload.field = field;
      payload.new_value = value.trim();
    }
    setBusy(true);
    try {
      await apiPost('/api/hr/requests', { employee_id: employeeId, kind, reason: reason.trim(), payload });
      toast('success', 'Request submitted.');
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="New HR request"
      width={470}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={busy} className={btnPrimary} onClick={() => void submit()}>
            Submit request
          </button>
        </>
      }
    >
      <Field label="What are you asking for?">
        <Select aria-label="What are you asking for?" value={kind} onChange={(e) => setKind(e.target.value)} className={input} disabled={!kinds.data}>
          {(kinds.data?.kinds ?? [{ value: kind, label: 'Loading…' }]).map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </Select>
      </Field>
      {corrective ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Which day">
              <input type="date" aria-label="Which day" value={onDate} onChange={(e) => setOnDate(e.target.value)} className={input} />
            </Field>
            <Field label="Corrected check-in">
              <input type="time" aria-label="Corrected check-in" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className={input} />
            </Field>
            <Field label="Corrected check-out">
              <input type="time" aria-label="Corrected check-out" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} className={input} />
            </Field>
          </div>
          <span className="-mt-1 text-[11.5px] text-ink-3">Leave one blank if only the other needs correcting.</span>
        </>
      ) : null}
      {kind === 'work_from_home' ? (
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="First day">
            <input type="date" aria-label="First day" value={onDate} onChange={(e) => setOnDate(e.target.value)} className={input} />
          </Field>
          <Field label="Last day (optional)">
            <input type="date" aria-label="Last day" value={toDate} onChange={(e) => setToDate(e.target.value)} className={input} />
          </Field>
        </div>
      ) : null}
      {kind === 'profile' ? (
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Which detail">
            <Select aria-label="Which detail" value={field} onChange={(e) => setField(e.target.value)} className={input}>
              {PROFILE_FIELDS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="New value">
            <input aria-label="New value" value={value} onChange={(e) => setValue(e.target.value)} className={input} />
          </Field>
        </div>
      ) : null}
      <Field label="Reason" hint="This is what the decision is made on.">
        <textarea aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} className={input + ' !h-[54px] resize-none py-2'} />
      </Field>
    </Sheet>
  );
}
