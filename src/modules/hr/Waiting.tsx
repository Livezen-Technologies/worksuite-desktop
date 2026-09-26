import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiPost } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import type { ApprovalsResponse } from './api';
import { dayLong, rangeLabel } from './dates';
import { ReviewLeave } from './Leave';
import { Cell, Empty, humanise, PageHead, Panel, row, StatusChip, THead } from './parts';
import type { HrView } from './Rail';

/**
 * Waiting on me (HrApprovals): everything that needs my decision — leave,
 * HR requests, resignations and offboarding — behind tiles that also say
 * what I approved and declined today. Leave and requests are decided here;
 * resignations and offboarding open where they are handled (the web, until
 * the desktop draws them).
 */
type Focus = '' | 'pending_leave' | 'pending_requests' | 'pending_resignations' | 'pending_offboarding' | 'changes_requested' | 'overdue';

const TILES: Array<{ key: keyof ApprovalsResponse['cards']; label: string; focus: Focus | null; tone?: string }> = [
  { key: 'pending_leave', label: 'Pending leave', focus: 'pending_leave' },
  { key: 'pending_requests', label: 'Pending HR requests', focus: 'pending_requests' },
  { key: 'pending_resignations', label: 'Resignations', focus: 'pending_resignations' },
  { key: 'pending_offboarding', label: 'Offboarding', focus: 'pending_offboarding' },
  { key: 'changes_requested', label: 'Changes requested', focus: 'changes_requested' },
  { key: 'overdue', label: 'Needs deciding now', focus: 'overdue', tone: 'text-danger' },
  { key: 'approved_today', label: 'Approved today', focus: null, tone: 'text-success' },
  { key: 'declined_today', label: 'Declined today', focus: null, tone: 'text-[#8C2A14] dark:text-danger' },
];

export default function Waiting({ onPick }: { onPick: (v: HrView) => void }) {
  const qc = useQueryClient();
  const [focus, setFocus] = useState<Focus>('');
  const [reviewing, setReviewing] = useState<number | null>(null);
  const q = useQuery({ queryKey: ['hr', 'leave-approvals'], queryFn: ({ signal }) => apiGet<ApprovalsResponse>('/api/hr/leave/approvals', undefined, signal) });
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
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const a = q.data!;
  const leave = a.leave.filter((l) => focus === '' || focus === 'pending_leave' || (focus === 'overdue' ? l.overdue : focus === 'changes_requested' ? l.status === 'needs_resubmission' : false));
  const show = (f: Focus) => focus === '' || focus === f || (f === 'pending_leave' && (focus === 'overdue' || focus === 'changes_requested'));
  const nothing = !a.leave.length && !a.requests.length && !(a.resignations ?? []).length && !(a.offboarding ?? []).length;

  return (
    <div className="flex flex-col gap-3.5">
      <PageHead title="Waiting on me" sub="Everything that needs your decision" />
      <div className="grid grid-cols-8 gap-2">
        {TILES.filter((t) => a.cards[t.key] !== undefined).map((t) => {
          const on = t.focus !== null && focus === t.focus;
          return (
            <button
              key={t.key}
              type="button"
              disabled={t.focus === null}
              aria-pressed={on}
              onClick={() => t.focus !== null && setFocus(on ? '' : t.focus)}
              className={cx('flex h-[66px] flex-col items-start justify-center gap-0.5 rounded-[10px] px-3 text-left', on ? 'border-2 border-primary bg-selection' : t.focus !== null ? 'border border-line bg-surface hover:border-primary/40' : 'border border-dashed border-line bg-ground')}
            >
              <b className={cx('text-[20px] text-ink tabular-nums', t.tone)}>{a.cards[t.key] ?? 0}</b>
              <span className="text-[11.5px] leading-tight text-ink-2">{t.label}</span>
            </button>
          );
        })}
      </div>
      {nothing ? <Empty text="Nothing is waiting on you." /> : null}
      {show('pending_leave') && a.leave.length ? (
        <Panel title={`Leave — ${leave.length}`}>
          <THead cols={[['Employee', 200], ['Type', 110], ['When', 190], ['Days', 50], ['State', 150], ['', null]]} />
          {leave.map((l) => (
            <div key={l.id} className={row}>
              <span className="flex w-[200px] shrink-0 items-center gap-1.5">
                <b className="truncate">{l.employee}</b>
                {/* Why I may decide it: named as the person responsible, or HR. */}
                <span className="shrink-0 rounded-full bg-subtle px-1.5 py-px text-[10px] text-ink-3">{l.as === 'responsible' ? 'you were asked' : 'HR approval'}</span>
              </span>
              <Cell w={110}>{l.type}</Cell>
              <Cell w={190}>{rangeLabel(l.starts_on, l.ends_on)}</Cell>
              <Cell w={50}>{l.days}</Cell>
              <Cell w={150} className="!overflow-visible">
                <StatusChip>{l.overdue ? 'Needs deciding now' : l.status === 'needs_resubmission' ? 'Changes requested' : humanise(l.status)}</StatusChip>
              </Cell>
              <span className="flex min-w-0 flex-1 justify-end gap-3 text-[12.5px] font-bold">
                <button type="button" className="text-primary hover:underline" onClick={() => setReviewing(l.id)}>
                  Review
                </button>
                {l.status === 'pending' ? (
                  <>
                    <button type="button" className="text-success hover:underline" onClick={() => void act(`/api/hr/leave/requests/${l.id}/decide`, 'Approved.', { decision: 'approved' })}>
                      Approve
                    </button>
                    <button type="button" className="text-danger hover:underline" onClick={() => void act(`/api/hr/leave/requests/${l.id}/decide`, 'Declined.', { decision: 'rejected' })}>
                      Decline
                    </button>
                  </>
                ) : null}
              </span>
            </div>
          ))}
          {!leave.length ? <Empty text="Nothing here." /> : null}
        </Panel>
      ) : null}
      {show('pending_requests') && a.requests.length ? (
        <Panel title={`HR requests — ${a.requests.length}`} action={<button type="button" className="font-semibold text-primary hover:underline" onClick={() => onPick('requests')}>All requests</button>}>
          <THead cols={[['Employee', 200], ['Kind', 180], ['About', null], ['', 220]]} />
          {a.requests.map((r) => (
            <div key={r.id} className={row}>
              <Cell w={200} className="font-semibold">{r.employee}</Cell>
              <Cell w={180}>{r.type}</Cell>
              <Cell w={null} className="text-ink-2">{r.subject ?? r.reason ?? '—'}</Cell>
              <span className="flex w-[220px] shrink-0 justify-end gap-3 text-[12.5px] font-bold">
                <button type="button" className="text-success hover:underline" onClick={() => void act(`/api/hr/requests/${r.id}/approve`, 'Approved.')}>
                  Approve
                </button>
                <button type="button" className="text-danger hover:underline" onClick={() => void act(`/api/hr/requests/${r.id}/reject`, 'Declined.')}>
                  Decline
                </button>
              </span>
            </div>
          ))}
        </Panel>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        {show('pending_resignations') && (a.resignations ?? []).length ? (
          <Panel title={`Resignations — ${a.resignations!.length}`}>
            <THead cols={[['Employee', null], ['Last working day', 130], ['', 110]]} />
            {a.resignations!.map((r) => (
              <div key={r.id} className={row}>
                <Cell w={null} className="font-semibold">{r.employee} · {humanise(r.type)}</Cell>
                <Cell w={130}>{dayLong(r.last_working_date)}</Cell>
                <span className="w-[110px] shrink-0 text-right">
                  <button type="button" className="text-[12.5px] font-bold text-primary hover:underline" onClick={() => void call('app:openInBrowser', { path: `/hr?resignation=${r.id}` })}>
                    Open
                  </button>
                </span>
              </div>
            ))}
          </Panel>
        ) : null}
        {show('pending_offboarding') && (a.offboarding ?? []).length ? (
          <Panel title={`Offboarding — ${a.offboarding!.length}`}>
            <THead cols={[['Employee', null], ['What', 170], ['', 80]]} />
            {a.offboarding!.map((o) => (
              <div key={`${o.what}-${o.id}`} className={row}>
                <Cell w={null} className="font-semibold">{o.employee}</Cell>
                <Cell w={170}>{o.title}</Cell>
                <span className="w-[80px] shrink-0 text-right">
                  <button type="button" className="text-[12.5px] font-bold text-primary hover:underline" onClick={() => void call('app:openInBrowser', { path: `/hr?offboarding=${o.case_id}` })}>
                    Open
                  </button>
                </span>
              </div>
            ))}
          </Panel>
        ) : null}
      </div>
      {reviewing ? <ReviewLeave id={reviewing} onClose={() => setReviewing(null)} onDone={() => (setReviewing(null), refresh())} /> : null}
    </div>
  );
}
