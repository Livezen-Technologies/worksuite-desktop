import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { app } from '../core/app-state';
import { useStore } from '../core/store';
import { cx } from './ui';
import { StatCard, type StatTone } from './StatCard';

/**
 * The console look first drawn for Assets and shared by Hosting: cards, tables, pill filters, buttons, fields, figure
 * tiles, notes and whether the app is online. They moved here from `assets/parts` so Hosting no longer borrows another
 * module's parts (audit D-G08).
 */

export function useOnline(): boolean {
  return useStore(app, (s) => s.status?.network !== 'OFFLINE');
}

export function Pills<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: Array<{ id: T; label: string; n?: number }>; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={o.id === value} onClick={() => onChange(o.id)} className={cx('h-[28px] rounded-[14px] border px-2.5 text-[12px] font-semibold', o.id === value ? 'border-primary bg-info-bg text-primary dark:bg-selection dark:text-primary' : 'border-line bg-surface text-ink-2 hover:bg-subtle')}>
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
  const c = { info: 'border-info-line bg-info-soft text-primary dark:bg-primary/10 dark:text-primary', warn: 'border-warning-line bg-warning-bg text-warning-strong dark:bg-warning-bg dark:text-warning', ok: 'border-success-line bg-slate-bg text-success dark:bg-success/10 dark:text-success', error: 'border-danger-line bg-ground text-danger dark:bg-danger/10 dark:text-danger' }[tone];
  return <div className={cx('flex flex-wrap items-center gap-2 rounded-[9px] border px-3.5 py-2.5 text-[12.5px]', c)}>{children}</div>;
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
