import { cx } from '../../components/ui';
import { StatusChip } from './parts';

/**
 * Resignations' shared shapes and the approval trail (HrResignations
 * "Approval"): each step of the chain in order, who was asked, what they
 * decided and when. Decision stamps are UTC; the working days are the
 * company's calendar days.
 */
export interface ResignationShape {
  id: number;
  org_id: number;
  employee_id: number;
  status: string;
  status_label: string;
  type: string;
  type_label: string;
  reason: string | null;
  comments: string | null;
  withdrawal_reason: string | null;
  request_date: string | null;
  requested_last_working_date: string | null;
  minimum_last_working_date: string | null;
  approved_last_working_date: string | null;
  actual_last_working_date: string | null;
  required_notice_days: number | null;
  provided_notice_days: number | null;
  notice_shortfall_days: number | null;
  early_release_requested: boolean;
  terms: { id: number; version: number | null; accepted_at: string | null } | null;
  letter: { document_id: number; filename: string; size: number | null; kind: string; attached_at: string | null } | null;
  submitted_at: string | null;
  decided_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface TrailStep {
  position: number;
  name: string;
  status: 'approved' | 'pending' | 'waiting' | 'skipped' | 'returned' | 'rejected' | 'cancelled';
  asks: string[];
  decided_by: { id: number; name: string } | null;
  decided_at: string | null;
  comment: string | null;
  note: string | null;
}

export interface Round {
  id: number;
  attempt: number;
  status: string;
  submitted_at: string | null;
  decided_at: string | null;
  steps: TrailStep[];
}

export interface ResEvent {
  event: string;
  before: string | null;
  after: string | null;
  note: string | null;
  by: { id: number; name: string } | null;
  at: string;
}

export interface OffboardingBrief {
  id: number;
  status: string;
  status_label: string;
  percent: number;
  cleared: number;
  departments: number;
  last_working_date: string | null;
  completed_at: string | null;
}

export const lastDay = (r: Pick<ResignationShape, 'approved_last_working_date' | 'requested_last_working_date'>) => r.approved_last_working_date ?? r.requested_last_working_date;

export const utcDay = (s: string | null | undefined) => (s ? new Date(`${s.replace(' ', 'T')}Z`).toLocaleDateString([], { day: 'numeric', month: 'short' }) : '');

const STEP_LABEL: Record<TrailStep['status'], string> = {
  approved: 'Approved',
  pending: 'Waiting now',
  waiting: 'Not yet',
  skipped: 'Skipped',
  returned: 'Returned',
  rejected: 'Declined',
  cancelled: 'Cancelled',
};

/** One round of the chain, newest round first in the data; this draws the steps in order. */
export function Trail({ round }: { round: Round | undefined }) {
  if (!round) return <div className="px-3.5 py-3 text-[12.5px] text-ink-3">Nothing has been sent for approval yet.</div>;
  return (
    <div className="flex flex-col">
      {round.steps.map((s) => (
        <div key={s.position} className="flex items-start gap-2.5 border-b border-line/70 px-3.5 py-2.5 last:border-b-0">
          <span
            className={cx(
              'flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11.5px] font-bold',
              s.status === 'approved' ? 'bg-[#1F7A4D] text-white' : s.status === 'pending' ? 'bg-primary text-white' : s.status === 'rejected' || s.status === 'returned' ? 'bg-danger text-white' : 'bg-subtle text-ink-3',
            )}
          >
            {s.position}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="text-ink">
              {s.name}
              {s.decided_by ? ` · ${s.decided_by.name}` : s.asks.length ? ` · ${s.asks.slice(0, 2).join(', ')}${s.asks.length > 2 ? ` +${s.asks.length - 2}` : ''}` : ''}
            </b>
            <span className="text-[12px] text-ink-3">
              {s.decided_at ? `${STEP_LABEL[s.status]} ${utcDay(s.decided_at)}` : s.status === 'pending' ? 'Waiting now' : s.note ?? STEP_LABEL[s.status]}
              {s.comment ? ` · “${s.comment}”` : ''}
            </span>
          </span>
          <StatusChip className={s.status === 'waiting' ? '!bg-subtle !text-ink-3' : undefined}>{STEP_LABEL[s.status]}</StatusChip>
        </div>
      ))}
    </div>
  );
}

export function Events({ events }: { events: ResEvent[] }) {
  if (!events.length) return <div className="text-[12.5px] text-ink-3">Nothing yet.</div>;
  return (
    <div className="flex flex-col gap-1 text-[12.5px] text-ink-2">
      {events.map((e, i) => (
        <span key={i}>
          <b className="text-ink">{utcDay(e.at)}</b> · {e.event.replace(/_/g, ' ')}
          {e.after ? ` — ${e.after.replace(/_/g, ' ')}` : ''}
          {e.by ? ` · ${e.by.name}` : ''}
          {e.note ? ` · “${e.note}”` : ''}
        </span>
      ))}
    </div>
  );
}
