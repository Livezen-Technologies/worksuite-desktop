import { createContext, useContext, useEffect, useState, type DragEvent, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { call } from '../../core/bridge';
import { Pill } from '../inventory/parts';
import { lateBy, type JobCard, type Options } from './api';

/** What every Garage screen shares: the company, its options, and the way round the module. */
export type GarageView = 'overview' | 'board' | 'jobs' | 'walkin' | 'mywork' | 'parts';

export interface Garage {
  org: string;
  options: Options;
  may: (perm: string) => boolean;
  go: (view: GarageView, params?: Record<string, string | number | null | undefined>) => void;
  openJob: (id: number | null) => void;
}

export const GarageContext = createContext<Garage | null>(null);

export function useGarage(): Garage {
  const g = useContext(GarageContext);
  if (!g) throw new Error('useGarage outside GarageShell');
  return g;
}

/** The screens that stay on the web for now: check-in, estimates, QC and delivery, vehicles, customers, reports and set-up. */
export function openWeb(path = '/garage') {
  void call('app:openInBrowser', { path });
}

type Tone = 'blue' | 'amber' | 'red' | 'green' | 'grey';

const STATUS_TONE: Record<string, Tone> = {
  DRAFT: 'grey', CHECKED_IN: 'blue', INSPECTION: 'blue', DIAGNOSIS: 'blue', ESTIMATE_PREPARATION: 'blue',
  AWAITING_CUSTOMER_APPROVAL: 'amber', ADDITIONAL_APPROVAL_REQUIRED: 'amber', APPROVED: 'green', WAITING_PARTS: 'amber',
  READY_TO_START: 'blue', IN_PROGRESS: 'blue', PAUSED: 'grey', QUALITY_CHECK: 'blue', ROAD_TEST: 'blue',
  READY_FOR_DELIVERY: 'green', INVOICE_PENDING: 'green', COMPLETED: 'green', CANCELLED: 'red',
};

const WO_TONE: Record<string, Tone> = {
  PENDING: 'amber', READY: 'grey', ASSIGNED: 'blue', IN_PROGRESS: 'blue', PAUSED: 'grey', WAITING_PARTS: 'amber',
  COMPLETED: 'green', QC_FAILED: 'red', REWORK: 'red', CANCELLED: 'grey',
};

const PART_TONE: Record<string, Tone> = {
  REQUESTED: 'amber', PURCHASE_REQUESTED: 'amber', RESERVED: 'blue', ISSUED: 'blue', PARTIALLY_RETURNED: 'green', CONSUMED: 'green', CANCELLED: 'grey',
};

export function StatusPill({ status, label }: { status: string; label: string }) {
  return <Pill tone={STATUS_TONE[status] ?? 'grey'}>{label}</Pill>;
}

export function WorkPill({ status }: { status: string }) {
  return <Pill tone={WO_TONE[status] ?? 'grey'}>{status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ')}</Pill>;
}

export function PartPill({ status }: { status: string }) {
  return <Pill tone={PART_TONE[status] ?? 'grey'}>{status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ')}</Pill>;
}

export function PriorityPill({ priority }: { priority: string }) {
  if (priority === 'NORMAL') return null;
  return <Pill tone={priority === 'URGENT' ? 'red' : priority === 'HIGH' ? 'amber' : 'grey'}>{priority.charAt(0) + priority.slice(1).toLowerCase()}</Pill>;
}

/** A job as a card, on the board and in lists (FR-BRD-02). */
export function JobCardView({ job, onOpen, draggable, onDragStart }: { job: JobCard; onOpen: () => void; draggable?: boolean; onDragStart?: (e: DragEvent) => void }) {
  const car = [job.vehicle?.make, job.vehicle?.model].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={onOpen}
      aria-label={`Job ${job.number}, ${job.vehicle?.number ?? ''}, ${job.status_label}`}
      className={cx('flex w-full flex-col gap-1 rounded-[10px] border bg-surface px-2.5 py-2 text-left hover:border-primary/50', job.overdue ? 'border-danger/60' : 'border-line')}
    >
      <span className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] font-semibold text-ink-3">{job.number}</span>
        {job.fleet ? <Pill tone="blue">Fleet</Pill> : null}
        <PriorityPill priority={job.priority} />
      </span>
      <b className="text-[14px] tracking-wide text-ink">{job.vehicle?.number ?? '—'}</b>
      <span className="truncate text-[11.5px] text-ink-3">{[car || null, job.customer?.name ?? null].filter(Boolean).join(' · ') || '—'}</span>
      <span className="flex items-center gap-1.5">
        <StatusPill status={job.status} label={job.status_label} />
        <span className="min-w-0 flex-1" />
        {job.advisor_initials ? (
          <span title={job.advisor} className="grid size-6 place-items-center rounded-full bg-subtle text-[10px] font-bold text-ink-2">
            {job.advisor_initials}
          </span>
        ) : null}
      </span>
      {job.overdue ? (
        <span className="flex items-center gap-1 text-[11.5px] font-semibold text-danger">
          <Icon name="warning" size={13} /> {lateBy(job.late_minutes)}
        </span>
      ) : null}
    </button>
  );
}

export function Section({ title, action, children, className }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-[12px] border border-line bg-surface p-4', className)}>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="m-0 min-w-0 flex-1 text-[13.5px] font-bold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('flex flex-col gap-1', className)}>
      <span className="text-[12.5px] font-semibold text-ink-2">{label}</span>
      {children}
      {hint ? <span className="text-[12px] text-ink-3">{hint}</span> : null}
    </label>
  );
}

/** A figure on the overview, a way into its list. */
export function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] border border-line bg-surface p-3.5">
      <div className="text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">{label}</div>
      <div className="mt-1 text-[19px] leading-snug font-extrabold text-ink tabular-nums">{value}</div>
    </div>
  );
}

export const input = 'h-9 w-full rounded-[8px] border border-line bg-surface px-3 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-primary';

/** A clock that moves once a second, for the running timer. */
export function useTick(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
