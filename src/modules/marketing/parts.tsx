import type { ReactNode } from 'react';
import { cx } from '../../components/ui';
import type { CampaignStatus } from './types';

/**
 * Marketing's pieces beyond People's kit (`hr/parts`): the page heading with
 * its breadcrumb, the status pill in the design's five tones, a card, a
 * figure, a meter and the label–value line the side cards are made of.
 *
 * Every colour is a theme token, or a light value paired with its `dark:` one,
 * because the person's appearance profile changes primary and the ground: the
 * design's "slate and #2563eb" are the tokens here (`text-ink`, `bg-primary`).
 */
export { Kpi, Panel, Seg, Field, THead, Cell, row, Initials, Sheet, Empty, btn, btnPrimary, btnSmall, btnBad, input, humanise } from '../../components/PageKit';

/** Where the reader is, what this is, and what they can do from here (the 22px heading of every screen). */
export function PageHeader({ crumbs = [], title, sub, actions, onCrumb }: { crumbs?: string[]; title: ReactNode; sub?: ReactNode; actions?: ReactNode; onCrumb?: (i: number) => void }) {
  return (
    <header className="mb-4 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <nav aria-label="Breadcrumb" className="flex flex-wrap gap-1.5 text-[12.5px] text-ink-3">
          {['Marketing', ...crumbs].map((c, i, all) => (
            <span key={`${c}-${i}`} className="flex items-center gap-1.5">
              {onCrumb && i < all.length - 1 ? (
                <button type="button" onClick={() => onCrumb(i)} className="hover:text-ink hover:underline">
                  {c}
                </button>
              ) : (
                <span>{c}</span>
              )}
              {i < all.length - 1 ? <span aria-hidden="true">/</span> : null}
            </span>
          ))}
        </nav>
        <h1 className="m-0 mt-0.5 truncate text-[22px] leading-tight font-bold text-ink">{title}</h1>
        {sub ? <p className="m-0 mt-0.5 text-[12.5px] text-ink-3">{sub}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** A card with a title and, at its right, one action. A warning card is bordered so, not filled. */
export function Card({ title, action, children, className, tone, padded = true }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; tone?: 'warning' | 'danger' | 'info'; padded?: boolean }) {
  return (
    <section
      className={cx(
        'min-w-0 rounded-[12px] border bg-surface',
        tone === 'danger' ? 'border-danger-line dark:border-danger/40' : tone === 'warning' ? 'border-warning-line bg-rail dark:border-warning/40 dark:bg-warning-bg' : tone === 'info' ? 'border-primary/30 bg-selection' : 'border-line',
        padded && 'p-4',
        className,
      )}
    >
      {title || action ? (
        <div className={cx('flex items-center justify-between gap-3', padded ? 'mb-2.5' : 'px-4 pt-4 pb-2.5')}>
          {title ? <h2 className="m-0 text-[14.5px] font-bold text-ink">{title}</h2> : null}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export type PillTone = 'green' | 'amber' | 'red' | 'violet' | 'blue' | 'slate';

const PILL: Record<PillTone, string> = {
  green: 'bg-success-bg text-success-ink dark:bg-success-bg dark:text-success',
  amber: 'bg-warning-bg text-warning-ink dark:bg-warning-bg dark:text-warning',
  red: 'bg-danger-bg text-danger-ink dark:bg-danger-bg dark:text-danger',
  violet: 'bg-violet-bg text-violet-ink',
  blue: 'bg-selection text-primary',
  slate: 'bg-subtle text-ink-2',
};

/** A status, with the dot that lets it be read at a glance down a column. */
export function Pill({ tone = 'slate', children, dot = true, title }: { tone?: PillTone; children: ReactNode; dot?: boolean; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex h-5 shrink-0 items-center gap-1.5 rounded-[10px] px-2 text-[11.5px] font-bold whitespace-nowrap', PILL[tone])}>
      {dot ? <span aria-hidden="true" className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

/** Something the SRS plans and the code does not do yet — said so, never faked. */
export function Planned({ phase }: { phase?: string }) {
  return <Pill tone="violet">{phase ? `Planned · ${phase}` : 'Planned'}</Pill>;
}

export const CAMPAIGN_PILL: Record<CampaignStatus, PillTone> = { draft: 'slate', scheduled: 'violet', sending: 'blue', paused: 'amber', sent: 'green', cancelled: 'red', recurring: 'violet' };

/** A share as a bar: delivered of sent, consent recorded of contacts. */
export function Meter({ value, max, tone = 'blue', label }: { value: number; max: number; tone?: 'blue' | 'violet' | 'amber' | 'red' | 'green'; label?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const fill = { blue: 'bg-primary', violet: 'bg-violet dark:bg-violet', amber: 'bg-amber-strong', red: 'bg-danger', green: 'bg-success' }[tone];
  return (
    <span role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className="block h-1.5 w-full overflow-hidden rounded-full bg-subtle">
      <span className={cx('block h-full rounded-full', fill)} style={{ width: `${pct}%` }} />
    </span>
  );
}

/** Label and value, right-aligned, as the side cards list them. */
export function Line({ label, children, strong = false }: { label: ReactNode; children: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/70 py-1.5 text-[13px] last:border-b-0">
      <span className="text-ink-2">{label}</span>
      <span className={cx('text-right tabular-nums', strong ? 'font-bold text-ink' : 'text-ink')}>{children}</span>
    </div>
  );
}

/** A whole number with thousands separators, or a dash. */
export function n(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : v.toLocaleString();
}

/** A percentage the server worked out, to one decimal, or a dash. */
export function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${v.toFixed(1)}%`;
}

/** The text link a card's corner carries ("All campaigns", "Open queue"). */
export function CardLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-[12.5px] font-bold text-primary hover:underline">
      {children}
    </button>
  );
}
