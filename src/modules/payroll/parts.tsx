import { createContext, useContext, type ReactNode } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { cx } from '../../components/ui';
import { money } from '../finance/api';

/**
 * Payroll's shared bits: whether this screen may act (D25 — offline, every action is off and the data is the last
 * copy), the status pill colours of the design, and the pills row of D02.
 */

/** Whether WorkSuite can be reached. Offline, payroll is read-only (D25): the server must see every act. */
export function useOnline(): boolean {
  return useStore(app, (s) => s.status?.network !== 'OFFLINE');
}

export const OFFLINE = 'Read-only while offline. This needs WorkSuite.';

/** Read-only for the whole module while offline; screens read it rather than each asking. */
export const ReadOnly = createContext(false);
export const useReadOnly = () => useContext(ReadOnly);

/** An amount the server sent, grouped; a dash for one withheld (no figures permission) or not sent. */
export const amt = (v: string | null | undefined, cur = '') => (v === null || v === undefined || v === '' ? '—' : money(v, cur));

const TONE: Record<string, string> = {
  draft: 'ne', calculating: 'in', calculated: 'in', submitted: 'wa', approved: 'in', locked: 'in', paying: 'in', paid: 'ok', failed: 'er', cancelled: 'vi', rejected: 'er',
  open: 'wa', ready: 'ok', active: 'ok', settled: 'ne', blocked: 'er', waiting: 'wa', done: 'ok', waived: 'ne', sent: 'in', filed: 'ok',
};
const PILL: Record<string, string> = {
  ok: 'bg-success-bg text-success dark:bg-success/15 dark:text-success',
  wa: 'bg-warning-bg text-yellow-ink dark:bg-warning/15 dark:text-warning',
  er: 'bg-danger-bg text-danger dark:bg-danger/15 dark:text-danger',
  in: 'bg-info-bg text-primary dark:bg-primary/15 dark:text-primary',
  vi: 'bg-selection text-violet-ink dark:bg-violet/20',
  ne: 'bg-subtle text-ink-2 dark:bg-subtle dark:text-ink-2',
};

export function Badge({ status, children }: { status: string; children?: ReactNode }) {
  return <span className={cx('inline-flex h-[19px] items-center rounded-[10px] px-[7px] text-[11px] font-semibold whitespace-nowrap', PILL[TONE[status] ?? 'ne'])}>{children ?? status}</span>;
}

export function Pills<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: Array<{ id: T; label: string }>; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={o.id === value} onClick={() => onChange(o.id)} className={cx('h-[28px] rounded-[14px] border px-2.5 text-[12px] font-semibold', o.id === value ? 'border-primary bg-info-bg text-primary dark:bg-selection dark:text-primary' : 'border-line bg-surface text-ink-2 hover:bg-subtle')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A section card with a title row, as the D-boards draw them. */
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

/** A table in the D-boards' style; rows are passed in. */
export function Table({ head, children, label }: { head: Array<string | [string, 'r']>; children: ReactNode; label?: string }) {
  return (
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
  );
}

export const td = 'border-b border-line/70 px-2.5 py-2 whitespace-nowrap';
export const tdr = 'border-b border-line/70 px-2.5 py-2 whitespace-nowrap text-right tabular-nums';

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="rounded-[4px] border border-b-2 border-line bg-surface px-1 font-mono text-[10px] text-ink-2">{children}</span>;
}

/** "Not on this server yet": a v1.1 endpoint the connected server does not have. */
export function NotYet({ what }: { what: string }) {
  return <p className="m-0 px-3.5 py-3 text-[12.5px] text-ink-3">{`${what} needs a newer WorkSuite server (Payroll 1.2).`}</p>;
}
