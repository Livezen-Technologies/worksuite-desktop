import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { cx } from '../../components/ui';
import { money } from '../finance/api';
import { station } from './api';
import { StatCard, type StatTone } from '../../components/StatCard';

/** The station's shared pieces: panels, tiles, badges, notes and check lines as the D01–D06 boards draw them. */

export function useOnline(): boolean {
  return useStore(app, (s) => s.status?.network !== 'OFFLINE');
}

/** This computer: its device id, host name and printers (from the main process). */
export function useStation() {
  return useQuery({ queryKey: ['cheque', 'station-info'], queryFn: () => station(), staleTime: 30_000 });
}

export const amt = (v: string | null | undefined, cur = '') => (v === null || v === undefined || v === '' ? '—' : money(v, cur));

export function PageHead({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-2.5">
      <div className="min-w-0 flex-1">
        <h1 className="m-0 text-[21px] font-extrabold tracking-[-.3px] text-ink">{title}</h1>
        {sub ? <div className="mt-0.5 text-[12.5px] text-ink-2">{sub}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function Panel({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('overflow-hidden rounded-[10px] border border-line bg-surface', className)}>
      {title ? (
        <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5 text-[13px] font-bold text-ink">
          <span className="min-w-0 flex-1">{title}</span>
          {action}
        </div>
      ) : null}
      <div className="p-3.5">{children}</div>
    </section>
  );
}

const TILE: Record<string, StatTone> = { violet: 'violet', amber: 'amber', red: 'red', green: 'green', slate: 'neutral' };

export function Tile({ label, value, sub, tone = 'slate', onClick, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'violet' | 'amber' | 'red' | 'green' | 'slate'; onClick?: () => void; icon?: string }) {
  return <StatCard label={label} value={value} sub={sub} tone={TILE[tone] ?? 'neutral'} onClick={onClick} icon={icon} />;
}

const BADGE: Record<string, string> = {
  ok: 'bg-[#DCFCE7] text-[#166534] dark:bg-success/15 dark:text-success',
  bad: 'bg-[#FEE2E2] text-[#991B1B] dark:bg-danger/15 dark:text-danger',
  warn: 'bg-[#FEF3C7] text-[#92400E] dark:bg-warning/15 dark:text-warning',
  info: 'bg-[#EDE9FE] text-[#5B21B6] dark:bg-primary/15 dark:text-primary',
  muted: 'bg-subtle text-ink-2',
};

export function Badge({ tone = 'muted', children }: { tone?: keyof typeof BADGE; children: ReactNode }) {
  return <span className={cx('inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-bold', BADGE[tone])}>{children}</span>;
}

const NOTE: Record<string, string> = {
  info: 'border-[#BFDBFE] bg-[#EFF6FF] text-[#1E3A8A] dark:border-primary/30 dark:bg-primary/10 dark:text-ink',
  warn: 'border-[#F5D48A] bg-[#FFF8E6] text-[#7A3B05] dark:border-warning/40 dark:bg-warning-bg dark:text-warning',
  err: 'border-[#FECACA] bg-[#FEF2F2] text-[#991B1B] dark:border-danger/40 dark:bg-danger/10 dark:text-danger',
  plain: 'border-line bg-subtle text-ink-2',
};

export function Note({ tone = 'plain', children }: { tone?: keyof typeof NOTE; children: ReactNode }) {
  return <div role={tone === 'err' ? 'alert' : undefined} className={cx('rounded-[8px] border px-3 py-2 text-[12.5px]', NOTE[tone])}>{children}</div>;
}

export function Check({ tone, children }: { tone: 'ok' | 'bad' | 'warn'; children: ReactNode }) {
  const mark = tone === 'ok' ? '✓' : tone === 'bad' ? '✕' : '↻';
  const c = tone === 'ok' ? 'bg-[#DCFCE7] text-[#166534]' : tone === 'bad' ? 'bg-[#FEE2E2] text-[#991B1B]' : 'bg-[#FEF3C7] text-[#92400E]';
  return (
    <div className="flex items-start gap-2 py-0.5 text-[12.5px] text-ink">
      <span aria-hidden className={cx('mt-px inline-grid size-[18px] shrink-0 place-items-center rounded-full text-[11px] font-bold', c)}>{mark}</span>
      <span>{children}</span>
    </div>
  );
}

export const btn = 'inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-line bg-surface px-3 text-[12.5px] font-semibold text-ink hover:bg-subtle disabled:opacity-50';
export const btnPrimary = 'inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-primary px-3 text-[12.5px] font-bold text-white hover:bg-primary-hover disabled:opacity-50';
export const btnDanger = 'inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-[#DC2626] px-3 text-[12.5px] font-bold text-white hover:bg-[#B91C1C] disabled:opacity-50';
export const th = 'border-b border-line px-3 py-2 text-left text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase';
export const td = 'border-b border-line px-3 py-2 text-[12.5px] text-ink';
export const num = 'font-mono tabular-nums';
