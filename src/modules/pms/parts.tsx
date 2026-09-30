import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { Pill } from '../inventory/parts';
import { money, type Badge, type Options, type Property } from './api';
import type { PmsView, Screen } from './routes';

/** What every Hotel PMS screen shares: the property, the person's permissions there, and the way round the module. */
export interface Pms {
  property: Property;
  options: Options;
  /** The property's business date — "today" for the desk (§4.2). */
  businessDate: string;
  may: (perm: string) => boolean;
  mayAny: (...perms: string[]) => boolean;
  /** Whether WorkSuite can be reached: every write waits for it (PMS-DSK-003). */
  online: boolean;
  go: (view: PmsView, params?: { date?: string | null; room?: number | null; q?: string | null }) => void;
  open: (s: Exclude<Screen, { kind: 'view' }>) => void;
  /** The same place in a window of its own (PMS-DSK-004): the rack on one screen, a reservation or folio on another. */
  openWindow: (s: Exclude<Screen, { kind: 'view' }> | { kind: 'view'; view: PmsView }, title: string) => void;
  /** A record of another property was opened: the property selector follows it. */
  adopt: (propertyId: number) => void;
  back: () => void;
}

export const PmsContext = createContext<Pms | null>(null);

export function usePms(): Pms {
  const p = useContext(PmsContext);
  if (!p) throw new Error('usePms outside PmsShell');
  return p;
}

/** The server's icon names (lucide's) as the desktop's icon set has them. */
const ICON: Record<string, string> = {
  'check-circle': 'check-circle',
  bookmark: 'bookmark',
  user: 'user',
  'log-in': 'log-in',
  'log-out': 'logout',
  trash: 'trash',
  sparkles: 'sparkles',
  'badge-check': 'badge-check',
  wrench: 'wrench',
  'alert-triangle': 'warning',
  lock: 'lock',
  'help-circle': 'help',
  clock: 'clock',
  check: 'check',
  'shield-check': 'shield-check',
  'x-circle': 'x-circle',
  'user-x': 'user-x',
  list: 'list',
};

export const iconOf = (server: string | null | undefined): string => ICON[server ?? ''] ?? 'info';

/**
 * A status as the server draws it (PMS-FD-002): its colour, its icon and its
 * words — never colour alone. The colour comes with the data, so it is mixed
 * towards white on the dark theme to stay readable.
 */
export function StatusBadge({ badge, size = 'md' }: { badge: Pick<Badge, 'label' | 'colour' | 'icon'>; size?: 'sm' | 'md' }) {
  const style = { '--c': badge.colour } as CSSProperties;
  return (
    <span
      style={style}
      className={cx(
        'inline-flex shrink-0 items-center gap-1 rounded-[6px] font-semibold whitespace-nowrap',
        'bg-[color:color-mix(in_srgb,var(--c)_13%,transparent)] text-[color:var(--c)] dark:text-[color:color-mix(in_srgb,var(--c)_45%,white)]',
        size === 'sm' ? 'h-[18px] px-1.5 text-[10.5px]' : 'h-[20px] px-1.5 text-[11.5px]',
      )}
    >
      <Icon name={iconOf(badge.icon)} size={size === 'sm' ? 11 : 12} />
      {badge.label}
    </span>
  );
}

/** A reservation's status, with the server's colour and icon (`badge: [colour, icon]`). */
export function ReservationPill({ label, badge }: { label: string; badge: [string, string] | null | undefined }) {
  return <StatusBadge badge={{ label, colour: badge?.[0] ?? '#64748b', icon: badge?.[1] ?? 'help-circle' }} />;
}

export function VipPill({ level }: { level: string | null | undefined }) {
  if (!level || level === 'none') return null;
  return <Pill tone="amber">{level.toUpperCase()}</Pill>;
}

/** An amount from the server, as written. */
export function Money({ amount, currency, className }: { amount: string | null | undefined; currency?: string | null; className?: string }) {
  return <span className={cx('tabular-nums', className)}>{money(amount, currency)}</span>;
}

/** A refusal in the server's own sentence, with what the screen may offer beside it. */
export function Refusal({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-[10px] border border-danger/30 bg-danger-bg px-3 py-2.5 text-[12.5px] text-danger">
      <span className="flex items-start gap-2">
        <Icon name="alert" size={15} className="mt-px shrink-0" />
        <span className="min-w-0 flex-1 font-medium">{text}</span>
      </span>
      {children}
    </div>
  );
}

/** A small facts table: label, value. */
export function Facts({ rows, className }: { rows: Array<[string, ReactNode]>; className?: string }) {
  return (
    <dl className={cx('m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-[13px]', className)}>
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-3">{k}</dt>
          <dd className="m-0 min-w-0 text-ink">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A place the person cannot reach with what they hold. */
export function NoAccess({ what }: { what: string }) {
  return (
    <div className="p-6">
      <div className="flex items-start gap-3 rounded-[12px] border border-line bg-surface p-5">
        <Icon name="lock" size={18} className="mt-0.5 text-ink-3" />
        <p className="m-0 text-[13px] text-ink-2">{what}</p>
      </div>
    </div>
  );
}

/** "2 adults, 1 child". */
export function occupants(adults: number, children: number): string {
  const a = `${adults} ${adults === 1 ? 'adult' : 'adults'}`;
  return children > 0 ? `${a}, ${children} ${children === 1 ? 'child' : 'children'}` : a;
}

/** The shortcuts of the desk (PMS-WEB-003 on the desktop), shown in the rail's help. */
export const SHORTCUTS: Array<[string, string]> = [
  ['Alt+N', 'New reservation (also Ctrl/⌘+N)'],
  ['Alt+W', 'Walk-in'],
  ['Alt+F', 'Search reservations: guest, confirmation, room, phone'],
  ['Alt+I', 'Check in (the reservation open, or the first arrival ready)'],
  ['Alt+P', 'Post a charge (the stay or folio open)'],
  ['Alt+R', 'Room rack'],
  ['Alt+A', 'Arrivals'],
  ['Alt+D', 'Departures'],
  ['Alt+H', 'In house'],
];
