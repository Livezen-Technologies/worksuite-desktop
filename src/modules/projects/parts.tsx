import type { ReactNode } from 'react';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { cx } from '../../components/ui';
import { HEALTH, STATUS_TONE, statusLabel, type Health } from './api';

/** A page of the Projects web app, in the browser: the screens this app does not draw (timeline, budget…). */
export function openWeb(path: string): void {
  void call('app:openInBrowser', { path }).catch((e) => toast('error', errorMessage(e)));
}

export function StatusChip({ status, className }: { status: string; className?: string }) {
  return <span className={cx('inline-flex items-center rounded-full px-2 py-px text-[11px] font-semibold whitespace-nowrap', STATUS_TONE[status] ?? 'bg-subtle text-ink-2', className)}>{statusLabel(status)}</span>;
}

/** A project's health as a dot with its word beside it for screen readers (colour is never the only signal, NFR-08). */
export function HealthDot({ health, className }: { health: Health | null | undefined; className?: string }) {
  const h = health ? HEALTH[health] : null;
  return <span role="img" aria-label={h?.label ?? 'No health yet'} title={h?.label} className={cx('h-2 w-2 shrink-0 rounded-full', h?.dot ?? 'bg-line', className)} />;
}

export function SectionTitle({ children, count, tone }: { children: ReactNode; count?: number; tone?: 'danger' }) {
  return (
    <h2 className={cx('flex items-center gap-1.5 text-[13.5px] font-bold', tone === 'danger' ? 'text-danger' : 'text-ink')}>
      {children}
      {count !== undefined ? <span className="text-[12px] font-semibold text-ink-3">{count}</span> : null}
    </h2>
  );
}

/** "TSK-0412" in the mono face the cards use. */
export function Ref({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[11px] text-ink-3">{children}</span>;
}

export const fieldClass = 'h-[32px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-primary';
