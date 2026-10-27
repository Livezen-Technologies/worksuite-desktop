import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiPost } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { dayLong } from './dates';
import { btn, btnBad, btnGood, Cell, Empty, Field, input, PageHead, Panel, row, Seg, StatusChip, THead } from './parts';
import { Events, lastDay, Trail, type OffboardingBrief, type ResEvent, type ResignationShape, type Round } from './resignationParts';
import { ProgressBar } from './onboardingParts';

/**
 * Resignations (HrResignations; the web's Resignations): the requests, by
 * where they stand, and one request in full — what they asked for and why,
 * the approval chain with who is being waited on, the person's employment
 * and notice rule, and what happens next. Whoever is the front step of the
 * chain decides here (approve, perhaps on another day; return for changes;
 * decline); HR may move an approved last working day. The chain, not a
 * permission, says who may decide, so the server's `may_decide` is followed.
 */
type Filter = 'open' | 'approved' | 'returned' | 'rejected' | 'withdrawn' | '';

interface Item extends ResignationShape {
  employee: { id: number; name: string; no: string | null };
  company: string | null;
  waiting_on: string | null;
  may_decide: boolean;
}

interface Detail {
  resignation: ResignationShape & { trail: Round[]; withdrawal_trail: Round[]; events: ResEvent[] };
  person: { employee_id: number; name: string; employee_no: string | null; company: string | null; department: string | null; designation: string | null; employment_type: string | null; status: string; joined_at: string | null; exit_at: string | null; service: string | null } | null;
  documents: Array<{ document_id: number; filename: string; kind: string; attached_at: string | null; current: boolean }>;
  rule: { name?: string; notice_days?: number; employment_type?: string | null; min_service_months?: number | null; max_service_months?: number | null } | null;
  deciding: 'resignation' | 'withdrawal' | null;
  waiting_on: string | null;
  may_decide: boolean;
  may_change_date: boolean;
  offboarding: OffboardingBrief | null;
}

export default function Resignations({ openId, onOpen, onOffboarding }: { openId: number | null; onOpen: (id: number | null) => void; onOffboarding: (caseId: number) => void }) {
  const [filter, setFilter] = useState<Filter>('open');
  const list = useQuery({ queryKey: ['hr', 'resignations', filter], queryFn: ({ signal }) => apiGet<{ items: Item[]; counts: Record<string, number> }>('/api/hr/resignations', { status: filter }, signal), retry: false });
  const counts = list.data?.counts ?? {};
  const n = (k: string) => (counts[k] ? ` (${counts[k]})` : '');

  return (
    <div className="flex flex-col gap-3.5">
      <PageHead title="Resignations">
        <Seg
          label="Resignations"
          value={filter}
          onChange={setFilter}
          options={[
            { id: 'open', label: `Waiting for a decision${(counts.submitted ?? 0) + (counts.withdrawal_requested ?? 0) ? ` (${(counts.submitted ?? 0) + (counts.withdrawal_requested ?? 0)})` : ''}` },
            { id: 'approved', label: `Approved${n('approved')}` },
            { id: 'returned', label: `Returned${n('returned')}` },
            { id: 'rejected', label: `Declined${n('rejected')}` },
            { id: 'withdrawn', label: `Withdrawn${n('withdrawn')}` },
            { id: '', label: 'All' },
          ]}
        />
      </PageHead>
      {list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.data ? (
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <THead cols={[['Employee', null], ['Kind', 170], ['Last working day', 130], ['Notice', 90], ['Status', 170], ['', 60]]} />
          {list.data.items.map((r) => (
            <div key={r.id} className={cx(row, openId === r.id && 'bg-selection')}>
              <Cell w={null} className="font-semibold">
                {r.employee.name}
                {r.company ? <span className="ml-1.5 text-[11.5px] font-medium text-ink-3">{r.company}</span> : null}
              </Cell>
              <Cell w={170}>{r.type_label}</Cell>
              <Cell w={130}>{dayLong(lastDay(r))}</Cell>
              <Cell w={90}>{r.required_notice_days != null ? `${r.required_notice_days} days` : '—'}</Cell>
              <Cell w={170} className="!overflow-visible">
                <StatusChip>{r.may_decide ? 'Waiting for you' : r.waiting_on && (r.status === 'submitted' || r.status === 'withdrawal_requested') ? `Waiting · ${r.waiting_on}` : r.status_label}</StatusChip>
              </Cell>
              <span className="w-[60px] shrink-0 text-right">
                <button type="button" className="text-[12.5px] font-bold text-primary hover:underline" onClick={() => onOpen(r.id)}>
                  Open
                </button>
              </span>
            </div>
          ))}
          {!list.data.items.length ? <Empty text={filter === 'open' ? 'Nothing is waiting for a decision.' : 'Nothing here.'} /> : null}
        </div>
      ) : null}
      {openId ? <ResignationDetail key={openId} id={openId} onClose={() => onOpen(null)} onOffboarding={onOffboarding} /> : null}
    </div>
  );
}

function ResignationDetail({ id, onClose, onOffboarding }: { id: number; onClose: () => void; onOffboarding: (caseId: number) => void }) {
  const qc = useQueryClient();
  const [agreed, setAgreed] = useState('');
  const [comment, setComment] = useState('');
  const [moveTo, setMoveTo] = useState('');
  const [moveWhy, setMoveWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ['hr', 'resignation', id], queryFn: ({ signal }) => apiGet<Detail>(`/api/hr/resignations/${id}`, undefined, signal) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data!;
  const r = d.resignation;
  const p = d.person;
  const withdrawal = d.deciding === 'withdrawal';
  const round = (withdrawal ? r.withdrawal_trail : r.trail)[0];

  const decide = async (decision: 'approve' | 'return' | 'reject') => {
    if (decision !== 'approve' && !comment.trim()) return toast('error', decision === 'return' ? 'Say what needs changing.' : 'Say why it is declined.');
    setBusy(true);
    try {
      await apiPost(`/api/hr/resignations/${id}/decide`, { decision, comment: comment.trim(), ...(decision === 'approve' && agreed && !withdrawal ? { approved_last_working_date: agreed } : {}) });
      toast('success', decision === 'approve' ? 'Approved.' : decision === 'return' ? 'Returned for changes.' : 'Declined.');
      setComment('');
      void qc.invalidateQueries({ queryKey: ['hr'] });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const move = async () => {
    setBusy(true);
    try {
      await apiPost(`/api/hr/resignations/${id}/date`, { approved_last_working_date: moveTo, reason: moveWhy.trim() });
      toast('success', 'Last working day moved. Their exit date and offboarding follow it.');
      setMoveTo('');
      setMoveWhy('');
      void qc.invalidateQueries({ queryKey: ['hr'] });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const letter = async () => {
    try {
      await call('transfers:download', { hrLetter: id, name: r.letter?.filename ?? `resignation-${id}.pdf`, open: true });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  return (
    <div className="grid grid-cols-[1.2fr_1fr_0.9fr] gap-3">
      <Panel title={`${withdrawal ? 'Withdrawal' : 'The request'} · ${p?.name ?? 'Employee'}`} action={<button type="button" aria-label="Close" className="font-semibold text-primary hover:underline" onClick={onClose}>Close</button>} bodyClassName="flex flex-col gap-2.5 px-3.5 py-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-2">
          <span><b className="text-ink">{r.type_label}</b></span>
          <span>Asked for {dayLong(r.requested_last_working_date)}</span>
          {r.minimum_last_working_date ? <span>Notice runs to {dayLong(r.minimum_last_working_date)}</span> : null}
          {r.notice_shortfall_days ? <span className="font-semibold text-warning-ink dark:text-warning">{r.notice_shortfall_days} days short</span> : null}
          {r.early_release_requested ? <span className="font-semibold text-ink">Asks for early release</span> : null}
        </div>
        {withdrawal && r.withdrawal_reason ? (
          <div>
            <span className="text-[11.5px] font-bold text-ink-3 uppercase">Why they want to withdraw</span>
            <div className="text-ink">{r.withdrawal_reason}</div>
          </div>
        ) : null}
        <div>
          <span className="text-[11.5px] font-bold text-ink-3 uppercase">Reason</span>
          <div className="whitespace-pre-wrap text-ink">{r.reason || '—'}</div>
        </div>
        {r.comments ? (
          <div>
            <span className="text-[11.5px] font-bold text-ink-3 uppercase">Comments</span>
            <div className="whitespace-pre-wrap text-ink">{r.comments}</div>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-3 text-[12.5px]">
          {r.letter ? (
            <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void letter()}>
              {r.letter.filename}
            </button>
          ) : (
            <span className="text-ink-3">No letter attached.</span>
          )}
          {r.terms ? <span className="text-ink-3">Accepted terms version {r.terms.version ?? '—'}</span> : null}
        </div>
        {d.may_decide ? (
          <div className="flex flex-col gap-2 border-t border-line pt-2.5">
            {!withdrawal ? (
              <Field label="Agree a different last working day" hint="Leave blank to approve the day they asked for.">
                <input type="date" aria-label="Agree a different last working day" value={agreed} min={r.request_date ?? undefined} onChange={(e) => setAgreed(e.target.value)} className={input} />
              </Field>
            ) : null}
            <Field label="Comment" hint="Needed to return or decline.">
              <input aria-label="Comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional to approve" className={input} />
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={busy} className={btnBad} onClick={() => void decide('reject')}>
                Decline
              </button>
              {!withdrawal ? (
                <button type="button" disabled={busy} className={btn + ' !h-[30px]'} onClick={() => void decide('return')}>
                  Return for changes
                </button>
              ) : null}
              <button type="button" disabled={busy} className={btnGood} onClick={() => void decide('approve')}>
                Approve
              </button>
            </div>
          </div>
        ) : d.waiting_on ? (
          <div className="rounded-[8px] bg-ground px-3 py-2 text-[12.5px] text-ink-2">Waiting on {d.waiting_on}.</div>
        ) : null}
      </Panel>
      <div className="flex flex-col gap-3">
        <Panel title={withdrawal ? 'Approval · withdrawal' : 'Approval'}>
          <Trail round={round} />
        </Panel>
        {d.may_change_date ? (
          <Panel title="Move the last working day" bodyClassName="flex flex-col gap-2 px-3.5 py-3">
            <span className="text-[12px] text-ink-3">Now {dayLong(lastDay(r))}. Their exit date and the offboarding case move with it.</span>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" aria-label="New last working day" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className={input} />
              <input aria-label="Reason for moving it" value={moveWhy} onChange={(e) => setMoveWhy(e.target.value)} placeholder="Reason" className={input} />
            </div>
            <button type="button" disabled={busy || !moveTo || !moveWhy.trim()} className={btn + ' self-start'} onClick={() => void move()}>
              Move the day
            </button>
          </Panel>
        ) : null}
      </div>
      <div className="flex flex-col gap-3">
        <Panel title="Employment" bodyClassName="px-3.5 py-2.5 text-[12.5px] leading-[1.6] text-ink-2">
          {p ? (
            <>
              {[p.employee_no, p.department, p.designation].filter(Boolean).join(' · ') || '—'}
              <br />
              Joined {dayLong(p.joined_at)}
              {p.service ? ` · ${p.service}` : ''}
              {d.rule ? (
                <>
                  <br />
                  Notice rule: {d.rule.name ?? 'Company rule'} → {d.rule.notice_days ?? r.required_notice_days ?? '—'} days
                </>
              ) : null}
            </>
          ) : (
            '—'
          )}
        </Panel>
        <Panel title="Offboarding progress" bodyClassName="flex flex-col gap-1.5 px-3.5 py-2.5 text-[12.5px]">
          {d.offboarding ? (
            <>
              <span className="flex items-center gap-2">
                <ProgressBar percent={d.offboarding.percent} className="flex-1" />
                <b className="text-ink">{d.offboarding.percent}%</b>
              </span>
              <span className="text-ink-2">
                {d.offboarding.status_label} · {d.offboarding.cleared} of {d.offboarding.departments} departments cleared
              </span>
              <button type="button" className="self-start font-semibold text-primary hover:underline" onClick={() => onOffboarding(d.offboarding!.id)}>
                Open the case
              </button>
            </>
          ) : (
            <span className="text-ink-3">Starts when the resignation is approved.</span>
          )}
        </Panel>
        <Panel title="Events" bodyClassName="px-3.5 py-2.5">
          <Events events={r.events.slice().reverse()} />
        </Panel>
      </div>
    </div>
  );
}
