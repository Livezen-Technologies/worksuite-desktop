import { createContext, useContext, useEffect, useState, type DragEvent } from 'react';
import type { GarageDoc } from '@shared/garage-docs';
import { Icon } from '../../components/Icon';
import { Button, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { Pill } from '../../components/ListKit';
import { download, errorText, lateBy, mediaSrc, type JobCard, type Options } from './api';
import { StatCard, type StatTone } from '../../components/StatCard';

// The form pieces are shared with other modules from `src/components/FormKit`; Garage's screens still import them here.
export { Section, Field, input, Tabs, Ask, DropZone, ChooseFiles, SignaturePad, ToneNote, type AskField } from '../../components/FormKit';

/** What every Garage screen shares: the company, its options, and the way round the module. */
export type GarageView = 'overview' | 'board' | 'jobs' | 'walkin' | 'mywork' | 'parts' | 'vehicles' | 'customers' | 'reports' | 'workshop' | 'setup' | 'settings';

export interface Garage {
  org: string;
  options: Options;
  may: (perm: string) => boolean;
  go: (view: GarageView, params?: Record<string, string | number | null | undefined>) => void;
  openJob: (id: number | null, tab?: string) => void;
  /** A job's check-in screen (photos, condition, the customer's signature). */
  openCheckin: (id: number) => void;
  /** A vehicle's 360° view. */
  openVehicle: (id: number) => void;
  /** Whether WorkSuite can be reached: writes wait for it. */
  online: boolean;
}

export const GarageContext = createContext<Garage | null>(null);

export function useGarage(): Garage {
  const g = useContext(GarageContext);
  if (!g) throw new Error('useGarage outside GarageShell');
  return g;
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

/** A figure on the overview, a way into its list. */
export function Tile({ label, value, icon, tone, onClick }: { label: string; value: string; icon?: string; tone?: StatTone; onClick?: () => void }) {
  return <StatCard label={label} value={value} icon={icon} tone={tone} onClick={onClick} />;
}

/** A clock that moves once a second, for the running timer. */
export function useTick(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** A photo or file on a job, read through the API proxy; anything but a picture as its kind. */
export function Thumb({ id, mime = 'image/jpeg', alt, className = 'size-20' }: { id: number; mime?: string; alt: string; className?: string }) {
  if (!mime.startsWith('image/')) {
    return <span className={cx('grid place-items-center rounded-[8px] bg-subtle text-[10.5px] font-semibold text-ink-3', className)}>{mime.startsWith('video/') ? 'Video' : mime === 'application/pdf' ? 'PDF' : 'File'}</span>;
  }
  return <img src={mediaSrc(id)} alt={alt} loading="lazy" className={cx('rounded-[8px] bg-subtle object-cover', className)} />;
}

/**
 * A document WorkSuite prints, through the download manager: View opens it
 * (in the browser, to read or print), Save keeps a copy in the downloads
 * folder. Both show in Transfers.
 */
export function DocActions({ doc, name, label, what, size = 'sm' }: { doc: GarageDoc; name: string; label: string; what: string; size?: 'sm' | 'md' }) {
  const [busy, setBusy] = useState<'view' | 'save' | null>(null);
  const get = async (open: boolean) => {
    setBusy(open ? 'view' : 'save');
    try {
      await download(doc, name, open);
      toast('success', open ? `Opening the ${what} — see Transfers.` : `Saving the ${what} to your downloads — see Transfers.`);
    } catch (e) {
      toast('error', errorText(e, `The ${what} could not be downloaded.`));
    } finally {
      setBusy(null);
    }
  };
  return (
    <span className="inline-flex items-center gap-1">
      <Button size={size} icon="printer" loading={busy === 'view'} disabled={busy !== null} title={`Open the ${what} to read or print`} aria-label={`Open the ${what}`} onClick={() => void get(true)}>
        {label}
      </Button>
      <Button size={size} variant="ghost" icon="download" loading={busy === 'save'} disabled={busy !== null} title={`Save the ${what} to your downloads`} aria-label={`Save the ${what}`} onClick={() => void get(false)}>
        Save
      </Button>
    </span>
  );
}

/** The tracker over a job (§13): its steps, the one it has reached marked. */
export function Tracker({ steps, at, cancelled }: { steps: string[]; at: number; cancelled: boolean }) {
  if (steps.length === 0) return null;
  return (
    <ol className="m-0 flex list-none items-center gap-1 overflow-x-auto p-0" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s} className="flex min-w-0 flex-1 flex-col gap-1" aria-current={i === at && !cancelled ? 'step' : undefined}>
          <span className={cx('h-1.5 rounded-full', !cancelled && i <= at ? 'bg-primary' : 'bg-subtle')} />
          <span className={cx('truncate text-[10.5px] font-semibold', i === at && !cancelled ? 'text-primary' : 'text-ink-3')}>{s}</span>
        </li>
      ))}
    </ol>
  );
}

const LIGHT_TONE: Record<string, 'green' | 'amber' | 'red' | 'grey'> = { GREEN: 'green', PASS: 'green', AMBER: 'amber', RED: 'red', FAIL: 'red' };
const PRIORITY_WORD: Record<string, string> = { RED: 'Urgent', AMBER: 'Soon', GREEN: 'Advisory' };

/** A health-check light or an urgency (RED / AMBER / GREEN), in words. */
export function LightPill({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  return <Pill tone={LIGHT_TONE[value] ?? 'grey'}>{PRIORITY_WORD[value] ?? value.charAt(0) + value.slice(1).toLowerCase()}</Pill>;
}
