import { useId, type CSSProperties, type ReactNode } from 'react';
import { Icon } from './Icon';
import { cx } from './ui';

/**
 * The one stat card (KPI / figure / summary tile) every module draws its headline numbers with.
 *
 *   ┌───────────────────────────────┐
 *   │ [■] Open deals              › │   a tinted icon chip in the tone, the label in medium muted text
 *   │ 86  ▲ 12%            ╱╲╱‾    │   the figure (tabular, the text colour), a trend pill, a sparkline
 *   │ LKR 155M                      │   a muted line under it
 *   └───────────────────────────────┘
 *
 * The tone colours the chip, never the figure, so a figure is not shouting in neon in dark mode; what a figure means
 * is said by its label, its icon and the trend's arrow and sign, never by colour alone. A zero or empty figure is
 * drawn muted. A card that leads somewhere is a button (or a link with `href`) with the app's focus ring and a soft
 * lift on hover. The label names the card: a group is labelled by it, a button by the label and the figure.
 *
 * Colours are tokens (`--ws-tone-*` in styles.css) with a light and a dark value.
 */
export type StatTone = 'blue' | 'violet' | 'green' | 'amber' | 'red' | 'cyan' | 'neutral';

export const STAT_TONES: readonly StatTone[] = ['blue', 'violet', 'green', 'amber', 'red', 'cyan', 'neutral'];

export type StatTrend = {
  /** Which way the number moved. */
  direction: 'up' | 'down' | 'flat';
  /** What the pill says beside the arrow: "12%", "+3", "LKR 2M". */
  text: ReactNode;
  /** Whether that move is good news; by default up is and down is not. A cost going up passes `false`. */
  good?: boolean;
  /** Read after the change, and shown as its tooltip: "vs last month". */
  label?: string;
};

type DataAttributes = { [key: `data-${string}`]: string | number | boolean | undefined };

export type StatCardProps = DataAttributes & {
  label: ReactNode;
  value: ReactNode;
  /** The muted line under the figure. */
  sub?: ReactNode;
  /** An icon name from components/Icon; drawn in the tone's chip. */
  icon?: string;
  tone?: StatTone;
  trend?: StatTrend | null;
  /** A small chart beside the figure (about 80 × 28). */
  sparkline?: ReactNode;
  /** Draws the card's skeleton in place of the figure and the line under it. */
  loading?: boolean;
  /** Draws the figure muted. Left out, a figure of 0 (or "LKR 0.00", "—", "") is empty. */
  empty?: boolean;
  /** `md` for a page's headline figures; `sm` for a denser second row; `lg` for a wallboard. */
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
  href?: string;
  /** Names a button or link in place of "label value". */
  ariaLabel?: string;
  title?: string;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  /** A role in place of the card's own (a group, or the button's), for a card that is an item of a list. */
  role?: string;
};

/** Whether a figure says "nothing": 0, "0", "LKR 0.00", "0%", "—", "–", "-" or nothing at all. */
export function isEmptyStat(value: ReactNode): boolean {
  if (value === null || value === undefined || value === false) return true;
  if (typeof value === 'number') return value === 0 || Number.isNaN(value);
  if (typeof value !== 'string') return false;
  const s = value.trim();
  if (s === '' || /^[-–—]$/.test(s)) return true;
  return /^[^\d]*0(?:[.,]0+)?[^\d]*$/.test(s);
}

const VALUE_SIZE = { sm: 'text-[20px]', md: 'text-[26px]', lg: 'text-[40px]' } as const;
const ARROW = { up: 'arrow-up', down: 'arrow-down', flat: 'minus' } as const;

function TrendPill({ trend }: { trend: StatTrend }) {
  const good = trend.direction === 'flat' ? null : (trend.good ?? trend.direction === 'up');
  const word = trend.direction === 'up' ? 'Up' : trend.direction === 'down' ? 'Down' : 'No change';
  return (
    <span
      data-stat-trend={trend.direction}
      data-good={good === null ? undefined : String(good)}
      title={trend.label}
      className={cx('ws-stat-trend inline-flex h-[22px] shrink-0 items-center gap-0.5 rounded-full px-1.5 text-[11.5px] font-semibold tabular-nums', good === null ? 'is-flat' : good ? 'is-good' : 'is-bad')}
    >
      <Icon name={ARROW[trend.direction]} size={12} strokeWidth={2.4} />
      <span className="sr-only">{word} </span>
      <span>{trend.text}</span>
      {trend.label ? <span className="sr-only"> {trend.label}</span> : null}
    </span>
  );
}

export function StatCard({ label, value, sub, icon, tone = 'neutral', trend, sparkline, loading, empty, size = 'md', onClick, href, ariaLabel, title, className, style, disabled, role, ...data }: StatCardProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const valueId = `${id}-value`;
  const subId = `${id}-sub`;
  const muted = !loading && (empty ?? isEmptyStat(value));
  const action = !!(onClick || href);

  const body = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        {icon ? (
          <span aria-hidden="true" data-stat-chip="" className={cx('ws-stat-chip flex shrink-0 items-center justify-center rounded-[8px]', size === 'lg' ? 'size-9' : 'size-7')}>
            <Icon name={icon} size={size === 'lg' ? 18 : 15} strokeWidth={2} />
          </span>
        ) : null}
        <span id={labelId} data-stat-label="" className={cx('min-w-0 flex-1 truncate font-medium text-ink-3', size === 'lg' ? 'text-[14px]' : 'text-[12.5px]')}>
          {label}
        </span>
        {action ? <Icon name="chevron-right" size={14} className="ws-stat-go shrink-0 text-ink-3 rtl:rotate-180" /> : null}
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {loading ? (
          <span aria-hidden="true" className={cx('ws-skeleton block rounded-[6px]', size === 'sm' ? 'h-6 w-16' : size === 'lg' ? 'h-11 w-28' : 'h-7 w-24')} />
        ) : (
          <span id={valueId} data-stat-value="" className={cx('stat-number max-w-full min-w-0 shrink-0 truncate leading-[1.15] font-semibold tracking-[-0.015em]', VALUE_SIZE[size], muted ? 'text-ink-3' : 'text-ink')}>
            {value}
          </span>
        )}
        {trend && !loading ? <TrendPill trend={trend} /> : null}
        {sparkline && !loading ? (
          <span aria-hidden="true" data-stat-sparkline="" className="ms-auto flex h-7 max-w-20 min-w-0 flex-1 items-center justify-end overflow-hidden">
            {sparkline}
          </span>
        ) : null}
      </span>
      {loading ? (
        sub !== undefined ? <span aria-hidden="true" className="ws-skeleton block h-3 w-28 rounded-[4px]" /> : null
      ) : sub !== undefined && sub !== null && sub !== false && sub !== '' ? (
        <span id={subId} data-stat-sub="" className={cx('min-w-0 truncate text-ink-3', size === 'lg' ? 'text-[13px]' : 'text-[12px]')}>
          {sub}
        </span>
      ) : null}
    </>
  );

  const hasSub = !loading && sub !== undefined && sub !== null && sub !== false && sub !== '';
  const cls = cx(
    'ws-stat relative flex min-w-0 flex-col justify-between gap-2 rounded-[12px] border border-line bg-surface text-start',
    size === 'sm' ? 'min-h-[84px] px-3.5 py-3' : size === 'lg' ? 'min-h-[132px] p-5' : 'min-h-[96px] p-4',
    action && 'ws-stat-action',
    className,
  );
  const common = { ...data, 'data-stat': '', 'data-tone': tone, 'data-empty': muted ? '' : undefined, 'aria-busy': loading || undefined, title, style, className: cls };
  const named = ariaLabel ? { 'aria-label': ariaLabel } : { 'aria-labelledby': loading ? labelId : `${labelId} ${valueId}` };
  const described = hasSub ? { 'aria-describedby': subId } : {};

  if (href) {
    return (
      <a {...common} {...named} {...described} role={role} href={href} onClick={onClick}>
        {body}
      </a>
    );
  }
  if (onClick) {
    return (
      <button type="button" {...common} {...named} {...described} role={role} onClick={onClick} disabled={disabled}>
        {body}
      </button>
    );
  }
  return (
    <div role={role ?? 'group'} {...common} {...(ariaLabel ? { 'aria-label': ariaLabel } : { 'aria-labelledby': labelId })} {...described}>
      {body}
    </div>
  );
}

/**
 * Stat cards side by side: as many 220px-or-wider columns as fit (auto-fill), 12px apart. `min` changes the narrowest
 * column, for a row of small figures or a narrow panel. With a `label` the row is a region of that name (a section);
 * `role="list"` makes it a list of cards that are its items.
 */
export function StatGrid({ children, min = 220, label, role, className, style, ...data }: DataAttributes & { children: ReactNode; min?: number; label?: string; role?: 'list' | 'group'; className?: string; style?: CSSProperties }) {
  const Tag = label && !role ? 'section' : 'div';
  return (
    <Tag
      {...data}
      data-stat-grid=""
      role={role}
      aria-label={label}
      className={cx('ws-stat-grid grid gap-3', className)}
      style={min === 220 ? style : ({ '--stat-min': `${min}px`, ...style } as CSSProperties)}
    >
      {children}
    </Tag>
  );
}
