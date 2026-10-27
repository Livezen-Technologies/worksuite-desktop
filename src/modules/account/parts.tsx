import type { ReactNode } from 'react';
import { cx } from '../../components/ui';

/**
 * My account's building blocks, in the designs' form: white cards with a
 * 14.5 px heading, round pills, and label-and-value grids. Buttons, fields
 * and sheets are People's (hr/parts), so the two areas look the same.
 */

export function Card({ title, action, children, className, icon }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <section className={cx('rounded-[16px] border border-line bg-surface px-5 py-[18px] shadow-[0_1px_2px_rgb(var(--ws-shadow-rgb)/.04)]', className)}>
      {title ? (
        <div className="mb-3.5 flex items-center gap-3">
          {icon}
          <h2 className="m-0 min-w-0 flex-1 text-[14.5px] font-bold text-ink">{title}</h2>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

const PILL = {
  green: 'bg-success-bg text-success dark:bg-success-bg dark:text-success',
  indigo: 'bg-selection text-primary dark:bg-selection dark:text-primary',
  grey: 'bg-slate-bg text-slate-ink dark:bg-subtle dark:text-ink-2',
  amber: 'bg-warning-bg text-warning-ink dark:bg-warning-bg dark:text-warning',
  red: 'bg-danger-bg text-danger dark:bg-danger-bg dark:text-danger',
} as const;

export function Pill({ children, tone = 'grey', dot, className }: { children: ReactNode; tone?: keyof typeof PILL; dot?: string; className?: string }) {
  return (
    <span className={cx('inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold whitespace-nowrap', PILL[tone], className)}>
      {dot ? <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: dot }} /> : null}
      {children}
    </span>
  );
}

/** Label-and-value rows in two columns, the profile's Contact and Organisation cards. */
export function KeyValues({ rows, labelWidth = 130 }: { rows: Array<[string, ReactNode]>; labelWidth?: number }) {
  return (
    <div className="grid gap-x-3 gap-y-3 text-[13.5px]" style={{ gridTemplateColumns: `${labelWidth}px minmax(0, 1fr)` }}>
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <span className="text-ink-3">{k}</span>
          <span className={cx('min-w-0 break-words', v === null || v === undefined || v === '' ? 'text-ink-3' : 'text-ink')}>{v === null || v === undefined || v === '' ? '—' : v}</span>
        </div>
      ))}
    </div>
  );
}

export function Head({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-2.5">
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="m-0 text-[22px] font-bold tracking-[-0.2px] text-ink">{title}</h1>
        {sub ? <p className="m-0 mt-0.5 text-[13px] text-ink-3">{sub}</p> : null}
      </div>
      {children}
    </header>
  );
}

/** A setting with its switch, select or button on the right. */
export function SettingRow({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-center gap-5 border-b border-line/70 py-3 last:border-b-0', className)}>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-semibold text-ink">{label}</div>
        {hint ? <div className="mt-0.5 text-[12px] leading-[1.45] text-ink-3">{hint}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function Note({ children, tone = 'indigo', className }: { children: ReactNode; tone?: 'indigo' | 'amber' | 'red' | 'green'; className?: string }) {
  const t = {
    indigo: 'bg-selection text-primary dark:bg-selection dark:text-primary',
    amber: 'bg-warning-bg text-yellow-ink dark:bg-warning-bg dark:text-warning',
    red: 'bg-danger-bg text-danger dark:bg-danger-bg dark:text-danger',
    green: 'bg-success-bg text-success dark:bg-success-bg dark:text-success',
  }[tone];
  return <div className={cx('rounded-[10px] px-3 py-2.5 text-[12.5px] leading-[1.5]', t, className)}>{children}</div>;
}

/** "Mon–Fri", "Mon, Wed, Fri" — ISO weekdays, 1 = Monday. */
export function weekdays(days: number[]): string {
  const names = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const d = [...new Set(days)].filter((n) => n >= 1 && n <= 7).sort((a, b) => a - b);
  if (d.length === 0) return '';
  const run = d.every((n, i) => i === 0 || n === d[i - 1]! + 1);
  return run && d.length > 2 ? `${names[d[0]!]}–${names[d[d.length - 1]!]}` : d.map((n) => names[n]).join(', ');
}

/** "42 days ago", "today" — how long since a UTC stamp, in days. */
export function daysAgo(stamp: string | null | undefined, now = Date.now()): string | null {
  if (!stamp) return null;
  const t = Date.parse(`${stamp.replace(' ', 'T')}${/[zZ]|[+-]\d{2}:?\d{2}$/.test(stamp) ? '' : 'Z'}`);
  if (Number.isNaN(t)) return null;
  const d = Math.floor((now - t) / 86_400_000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}
