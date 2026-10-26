import { createContext, useContext, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { cx } from '../../components/ui';
import { money } from '../finance/api';
import { statusLabel } from './api';
import { StatCard, type StatTone } from '../../components/StatCard';

/**
 * Assets' shared bits: whether a screen may act (offline the module reads its last copy and every act is off — the
 * server must see each change), the status pills of the D-boards, cards, tables and the "needs a newer server" note.
 */

export function useOnline(): boolean {
  return useStore(app, (s) => s.status?.network !== 'OFFLINE');
}

export const OFFLINE = 'Read-only while offline — changes need WorkSuite.';

export const ReadOnly = createContext(false);
export const useReadOnly = () => useContext(ReadOnly);

/** An amount the server sent, grouped; a dash when it sent none. */
export const amt = (v: string | null | undefined, cur = '') => (v === null || v === undefined || v === '' ? '—' : money(v, cur));

const TONE: Record<string, string> = {
  available: 'ok', assigned: 'in', reserved: 'ne', maintenance: 'wa', repair: 'wa', missing: 'vi', lost: 'er', stolen: 'er', retired: 'ne', disposed: 'ne',
  pending: 'wa', approved: 'ok', rejected: 'er', fulfilled: 'ok', cancelled: 'ne', completed: 'ok', scheduled: 'in', in_progress: 'wa', open: 'wa',
  manager_approved: 'in', it_approved: 'ok', active: 'ok', expired: 'er', overdue: 'er', blocked: 'er', low: 'wa', waiting: 'vi', confirmed: 'ok',
  issued: 'in', returned: 'ok', refused: 'er', looked: 'ne', good: 'ok', fair: 'wa', poor: 'er', new: 'ok', damaged: 'er', checked_out: 'in',
};
const PILL: Record<string, string> = {
  ok: 'bg-[#E7F6EE] text-[#13734A] dark:bg-success/15 dark:text-success',
  wa: 'bg-[#FFF4DB] text-[#8A5200] dark:bg-warning/15 dark:text-warning',
  er: 'bg-[#FDECEA] text-[#B42318] dark:bg-danger/15 dark:text-danger',
  in: 'bg-[#EAEDFB] text-[#23349E] dark:bg-primary/15 dark:text-primary',
  vi: 'bg-[#F2EEFD] text-[#5B3FB5] dark:bg-[#5B3FB5]/20 dark:text-[#B9A7F0]',
  ne: 'bg-[#EEF0F6] text-[#4A5068] dark:bg-subtle dark:text-ink-2',
};

export function Badge({ status, children }: { status: string; children?: ReactNode }) {
  return <span className={cx('inline-flex h-[19px] items-center rounded-[10px] px-[7px] text-[11px] font-semibold whitespace-nowrap', PILL[TONE[status] ?? 'ne'])}>{children ?? statusLabel(status)}</span>;
}

export function Pills<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: Array<{ id: T; label: string; n?: number }>; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={o.id === value} onClick={() => onChange(o.id)} className={cx('h-[28px] rounded-[14px] border px-2.5 text-[12px] font-semibold', o.id === value ? 'border-primary bg-[#EAEDFB] text-[#23349E] dark:bg-selection dark:text-primary' : 'border-line bg-surface text-ink-2 hover:bg-subtle')}>
          {o.label}
          {o.n ? <span className="ml-1 tabular-nums opacity-70">{o.n}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Card({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('overflow-hidden rounded-[10px] border border-line bg-surface', className)}>
      {title ? (
        <div className="flex items-center gap-2 px-3.5 py-2.5">
          <h2 className="m-0 min-w-0 flex-1 truncate text-[13.5px] font-bold text-ink">{title}</h2>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Table({ head, children, label }: { head: Array<string | [string, 'r']>; children: ReactNode; label?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px] text-ink" aria-label={label}>
        <thead>
          <tr>
            {head.map((h, i) => {
              const [l, r] = Array.isArray(h) ? h : [h, null];
              return (
                <th key={i} className={cx('border-b border-line bg-ground px-2.5 py-[7px] text-[11px] font-semibold whitespace-nowrap text-ink-2', r ? 'text-right' : 'text-left')}>
                  {l}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export const td = 'border-b border-line/70 px-2.5 py-2 whitespace-nowrap';
export const tdr = 'border-b border-line/70 px-2.5 py-2 whitespace-nowrap text-right tabular-nums';

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="rounded-[4px] border border-b-2 border-line bg-surface px-1 font-mono text-[10px] text-ink-2">{children}</span>;
}

export function Btn({ primary, danger, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex h-8 items-center gap-1.5 rounded-[7px] px-3 text-[12.5px] font-bold whitespace-nowrap disabled:opacity-50',
        primary ? 'bg-primary text-white hover:bg-primary-hover' : danger ? 'border border-danger/40 bg-surface text-danger hover:bg-danger/10' : 'border border-line bg-surface text-ink hover:bg-subtle',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function PageHead({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-0 flex-1">
        <h1 className="m-0 text-[21px] font-extrabold tracking-[-.3px] text-ink">{title}</h1>
        {sub ? <div className="mt-0.5 text-[12px] text-ink-2">{sub}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function Note({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'ok' | 'error'; children: ReactNode }) {
  const c = { info: 'border-[#C9D3F5] bg-[#F5F7FF] text-[#23349E] dark:bg-primary/10 dark:text-primary', warn: 'border-[#F5D48A] bg-[#FFF8E6] text-[#7A3B05] dark:bg-warning-bg dark:text-warning', ok: 'border-[#BDE5CF] bg-[#EFFAF4] text-[#13734A] dark:bg-success/10 dark:text-success', error: 'border-[#F4C7C3] bg-[#FDF2F1] text-[#B42318] dark:bg-danger/10 dark:text-danger' }[tone];
  return <div className={cx('flex flex-wrap items-center gap-2 rounded-[9px] border px-3.5 py-2.5 text-[12.5px]', c)}>{children}</div>;
}

/** An Assets 1.1 endpoint the connected server does not have. */
export function NotYet({ what }: { what: string }) {
  return <p className="m-0 px-3.5 py-3 text-[12.5px] text-ink-3">{`${what} needs a newer WorkSuite server (Assets 1.1).`}</p>;
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('flex flex-col gap-1 text-[12px] font-semibold text-ink-2', className)}>
      {label}
      {children}
    </label>
  );
}

export const input = 'h-8 w-full rounded-[7px] border border-line bg-surface px-2.5 text-[12.5px] font-normal text-ink outline-none focus:border-primary';

/** A figure tile, drawn as the shared StatCard. */
export function Kpi({ label, value, sub, tone, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'warn' | StatTone; icon?: string }) {
  return <StatCard label={label} value={value} sub={sub} tone={tone === 'warn' ? 'amber' : tone} icon={icon} />;
}

/** "LKR 9.11M": a compact figure for a tile; the full one is a title away. */
export function compact(v: string | null | undefined): string {
  const n = Number(v ?? '');
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  return a >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : a >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : money(String(v));
}
