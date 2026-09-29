import type { ReactNode } from 'react';
import { dateLabel, timeLabel, todayInZone, dayKey, parseTs } from '../../core/time';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { priorityTone, statusTone, vehicleLine, type Job, type Options, type Tone } from './api';

/**
 * Garage's shared pieces: the status and priority pills (one colour rule,
 * always with the server's words), a job's one-line summary, the offline
 * note, and how a Garage route is read.
 */

const TONES: Record<Tone, string> = {
  blue: 'bg-[#EEF1FC] text-[#23349E] dark:bg-selection dark:text-primary',
  amber: 'bg-[#FFF4E0] text-[#9A4A06] dark:bg-warning-bg dark:text-warning',
  red: 'bg-[#FCE9E4] text-[#8C2A14] dark:bg-danger-bg dark:text-danger',
  green: 'bg-[#E4F4EA] text-[#145C39] dark:bg-success-bg dark:text-success',
  grey: 'bg-[#F1F2F6] text-[#4A5168] dark:bg-subtle dark:text-ink-2',
  violet: 'bg-[#F1EAFB] text-[#5B2FA0] dark:bg-[#2A1F45] dark:text-[#C4A8F0]',
};

export function Pill({ tone = 'grey', children, title, className }: { tone?: Tone; children: ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={cx('inline-flex h-[20px] shrink-0 items-center gap-1 rounded-[10px] px-2 text-[11px] font-bold whitespace-nowrap', TONES[tone], className)}>
      {children}
    </span>
  );
}

/** The job's status in the server's words, coloured by what it means. */
export function StatusPill({ status, label }: { status: string; label: string }) {
  return <Pill tone={statusTone(status)}>{label}</Pill>;
}

/** Normal priority says nothing; the others say so in words and colour. */
export function PriorityPill({ priority, options }: { priority: string; options?: Options }) {
  const tone = priorityTone(priority);
  if (!tone) return null;
  return <Pill tone={tone}>{options?.priorities[priority] ?? priority}</Pill>;
}

export function OverduePill() {
  return (
    <Pill tone="red" title="Past the promised time">
      <Icon name="clock" size={11} /> Overdue
    </Pill>
  );
}

/** "Today 17:30", "3 Oct 09:00" — a promised time on the reader's clock. */
export function when(stamp: string | null | undefined): string {
  if (!stamp) return '';
  const d = parseTs(stamp);
  if (Number.isNaN(d.getTime())) return '';
  return dayKey(d) === todayInZone() ? `Today ${timeLabel(stamp)}` : `${dateLabel(stamp)} ${timeLabel(stamp)}`;
}

/** Initials of the service advisor, for a card. */
export function initialsOf(name: string | null | undefined): string {
  return (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

/** A job's number, vehicle and customer on one line each — the card on the board and a row in a list. */
export function JobSummary({ job, options, compact }: { job: Job; options?: Options; compact?: boolean }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="flex min-w-0 items-center gap-1.5">
        <b className="shrink-0 text-[12.5px] text-ink tabular-nums">{job.number}</b>
        {job.vehicle?.fleet ? <Pill tone="violet">Fleet</Pill> : null}
        <PriorityPill priority={job.priority} options={options} />
        {job.overdue ? <OverduePill /> : null}
      </span>
      <span className="truncate text-[12px] text-ink-2">{vehicleLine(job.vehicle)}</span>
      {!compact ? <span className="truncate text-[11.5px] text-ink-3">{job.customer?.name ?? 'No customer'}</span> : null}
    </span>
  );
}

/** Said above a screen read from this computer's copy: what it shows may be behind. */
export function OfflineBanner({ cachedAt }: { cachedAt: string | null | undefined }) {
  const at = cachedAt ? new Date(cachedAt) : null;
  return (
    <div role="status" className="flex items-center gap-2 rounded-[9px] bg-warning-bg px-3 py-2 text-[12.5px] font-semibold text-warning">
      <Icon name="cloud-off" size={15} />
      <span>
        Offline — this is the copy saved on this computer{at && !Number.isNaN(at.getTime()) ? ` at ${at.toLocaleString([], { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' })}` : ''}. Changes wait until
        WorkSuite can be reached.
      </span>
    </div>
  );
}

// ── routes ──────────────────────────────────────────────────────────────

/** The screens the rail points at (a stage-B screen is an `EXTRA_VIEWS` id). */
export type GarageViewId = 'overview' | 'board' | 'jobs' | 'walkin' | 'customers' | 'vehicles' | 'setup' | 'settings';
export const VIEWS: ReadonlySet<string> = new Set<GarageViewId>(['overview', 'board', 'jobs', 'walkin', 'customers', 'vehicles', 'setup', 'settings']);

export interface GarageRoute {
  /** The rail screen; null when nothing was asked (the shell picks the reader's first). */
  view: string | null;
  /** A job card over the screen (`?job=`, `/garage/jobs/<id>`: notifications and deep links). */
  job: number | null;
  /** The job card's tab (`&jt=`). */
  jobTab: string | null;
  /** A Vehicle 360° (`?vehicle=`, `/garage/vehicles/<id>`). */
  vehicle: number | null;
  /** A customer (`?customer=`). */
  customer: number | null;
  /** The jobs list's preset (`&list=`). */
  list: string | null;
}

const id = (v: string | null | undefined) => (v && /^\d{1,18}$/.test(v) ? Number(v) : null);

/**
 * Where a Garage route points. Addressed as
 * `/garage?view=overview|board|jobs|walkin|customers|vehicles|setup|settings|<stage-B view>`,
 * `&job=<id>` (a job card; what the server's notifications carry as `/garage?job=ID`),
 * `&jt=<tab>`, `&vehicle=<id>`, `&customer=<id>`, `&list=<preset>`; `?new=1` is a new walk-in;
 * `/garage/jobs/<id>` and `/garage/vehicles/<id>` are the deep links' form.
 */
export function readRoute(path: string[], query: URLSearchParams, extra: ReadonlySet<string> = new Set()): GarageRoute {
  const seg = path[0] === 'garage' ? path.slice(1) : path;
  const fromPath = (kind: string) => (seg[0] === kind ? id(seg[1]) : null);
  const asked = query.get('view');
  const view = query.get('new') === '1' ? 'walkin' : asked && (VIEWS.has(asked) || extra.has(asked)) ? asked : null;
  return {
    view,
    job: fromPath('jobs') ?? id(query.get('job')),
    jobTab: query.get('jt'),
    vehicle: fromPath('vehicles') ?? id(query.get('vehicle')),
    customer: id(query.get('customer')),
    list: query.get('list'),
  };
}

/** The jobs list's presets (SRS §8 Jobs), each a `GET jobs` filter. */
export const LISTS: Array<{ id: string; label: string; filter: Record<string, string>; icon: string; column?: string }> = [
  { id: 'open', label: 'Open jobs', filter: {}, icon: 'list' },
  { id: 'new', label: 'New jobs', filter: { column: 'check_in' }, icon: 'inbox', column: 'check_in' },
  { id: 'diagnosis', label: 'Awaiting diagnosis', filter: { column: 'diagnosis' }, icon: 'stethoscope', column: 'diagnosis' },
  { id: 'estimate', label: 'Estimate pending', filter: { column: 'estimate' }, icon: 'receipt', column: 'estimate' },
  { id: 'approval', label: 'Awaiting approval', filter: { column: 'approval' }, icon: 'hourglass', column: 'approval' },
  { id: 'parts', label: 'Waiting for parts', filter: { column: 'waiting_parts' }, icon: 'package', column: 'waiting_parts' },
  { id: 'progress', label: 'In progress', filter: { column: 'in_progress' }, icon: 'wrench', column: 'in_progress' },
  { id: 'qc', label: 'Quality check', filter: { column: 'quality_check' }, icon: 'shield-check', column: 'quality_check' },
  { id: 'ready', label: 'Ready for delivery', filter: { column: 'ready' }, icon: 'check-circle', column: 'ready' },
  { id: 'completed', label: 'Completed', filter: { status: 'completed' }, icon: 'check-check' },
  { id: 'cancelled', label: 'Cancelled', filter: { status: 'cancelled' }, icon: 'x' },
  { id: 'overdue', label: 'Overdue', filter: { overdue: '1' }, icon: 'clock' },
  { id: 'mine', label: 'My jobs', filter: { mine: '1' }, icon: 'user' },
  { id: 'all', label: 'All jobs', filter: { status: 'all' }, icon: 'history' },
];
