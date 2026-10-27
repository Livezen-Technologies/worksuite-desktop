import type { ReactNode } from 'react';
import { cx } from '../../components/ui';
import { StatCard, type StatTone } from '../../components/StatCard';

/**
 * CRM's small shared pieces: money as the designs write it ("LKR 12.4M",
 * "LKR 950k", "LKR 1,840,000"), the lead rating and status chips, and the
 * bar rows the dashboard is made of. Panels, buttons and sheets are the page
 * kit's (src/components/PageKit), so CRM and HR look alike. Money and the bar
 * rows live in src/components/ReportKit, shared with Sales and Billing.
 */

export { money, moneyFull, BarRow } from '../../components/ReportKit';

const RATING: Record<string, string> = {
  hot: 'bg-danger-bg text-danger-ink dark:bg-danger-bg dark:text-danger',
  warm: 'bg-warning-bg text-warning-ink dark:bg-warning-bg dark:text-warning',
  cold: 'bg-selection text-sky-ink dark:bg-slate-bg dark:text-blue-ink',
};

export function Rating({ rating }: { rating: string | null | undefined }) {
  if (!rating) return null;
  return <span className={cx('rounded-[8px] px-1.5 py-px text-[10.5px] font-bold capitalize', RATING[rating] ?? RATING.cold)}>{rating}</span>;
}

const STATUS: Record<string, string> = {
  new: 'bg-selection text-primary',
  contacted: 'bg-warning-bg text-warning-ink dark:bg-warning-bg dark:text-warning',
  qualified: 'bg-success-bg text-success-ink dark:bg-success-bg dark:text-success',
  unqualified: 'bg-danger-bg text-danger-ink dark:bg-danger-bg dark:text-danger',
  converted: 'bg-teal-bg text-teal-ink dark:bg-teal/15 dark:text-teal',
};

export function LeadStatus({ status }: { status: string }) {
  return <span className={cx('inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-bold whitespace-nowrap', STATUS[status] ?? 'bg-subtle text-ink-2')}>{status}</span>;
}

/** A line in a dashboard list: a title, a line under it, and something on the right. */
export function ListLine({ title, sub, right, onClick }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; onClick?: () => void }) {
  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="truncate text-[12.5px] text-ink">{title}</b>
        {sub ? <span className="truncate text-[11.5px] text-ink-3">{sub}</span> : null}
      </span>
      {right}
    </>
  );
  const cls = 'flex w-full items-center gap-2 border-b border-line/60 px-3.5 py-2 text-left last:border-b-0';
  return onClick ? (
    <button type="button" onClick={onClick} className={cx(cls, 'hover:bg-subtle')}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Stage colours arrive as names ("sky", "violet"); the board and the bars need the colour itself. */
const STAGE_COLOURS: Record<string, string> = {
  slate: '#94A3B8', gray: '#94A3B8', grey: '#94A3B8', sky: '#0EA5E9', blue: '#3B82F6', indigo: '#6366F1', violet: '#7C3AED', purple: '#9333EA',
  amber: '#B45309', orange: '#EA580C', yellow: '#CA8A04', emerald: '#1F7A4D', green: '#16A34A', teal: '#0D9488', rose: '#E11D48', red: '#DC2626', pink: '#DB2777',
};

export function stageColour(c: string | null | undefined): string {
  if (!c) return '#94A3B8';
  if (c.startsWith('#')) return c;
  return STAGE_COLOURS[c] ?? '#94A3B8';
}

/** What CRM lets somebody do: the slug, or `*`, or `crm.manage` for anything but `crm.view` (CrmPermissions::can). */
export function crmCan(perms: readonly string[] | undefined, slug: string): boolean {
  if (!perms) return false;
  return perms.includes(slug) || perms.includes('*') || (slug !== 'crm.view' && perms.includes('crm.manage'));
}

const KPI_TONE: Record<string, StatTone> = { blue: 'blue', violet: 'violet', green: 'green', red: 'red', amber: 'amber', cyan: 'cyan', plain: 'neutral', neutral: 'neutral' };

/** A figure tile (the shared StatCard): the icon chip and label, the figure and a line under it. */
export function Kpi({ label, value, sub, tone = 'plain', onClick, size = 'lg', icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: StatTone | 'plain'; onClick?: () => void; size?: 'lg' | 'sm'; icon?: string }) {
  return <StatCard data-kpi={label} label={label} value={value} sub={sub} icon={icon} tone={KPI_TONE[tone] ?? 'neutral'} onClick={onClick} size={size === 'lg' ? 'md' : 'sm'} />;
}

/** The count line under a list or board ("300 leads · 60 new · 12 unassigned"). */
export function StatusBar({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div role="status" className="flex min-h-[34px] shrink-0 items-center gap-3 border-t border-line bg-well/60 px-3.5 py-1.5 text-[12px] text-ink-3">
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {right}
    </div>
  );
}

/** The views and tabs inside a screen, as chips: the chosen one filled, a count after each, late ones in red. */
export function Chips<T extends string>({ label, options, value, onChange }: { label: string; options: Array<{ id: T; label: string; count?: number | null; red?: boolean }>; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button key={o.id} type="button" role="tab" aria-selected={on} onClick={() => onChange(o.id)} className={cx('h-[30px] rounded-full px-3 text-[12.5px] font-semibold', on ? 'bg-primary text-white' : 'border border-line bg-surface text-ink hover:bg-subtle')}>
            {o.label}
            {o.count ? <span className={cx('ml-1.5 font-bold tabular-nums', o.red ? (on ? 'text-white' : 'text-danger') : on ? 'text-white/75' : 'text-ink-3')}>{o.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Two letters for a record's tile ("Highland Traders Holdings" → "HT"). */
export function initialsOf(name: string | null | undefined): string {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '?';
}
