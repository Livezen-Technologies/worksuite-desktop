import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { cx } from '../../components/ui';
import { K, setStatus, type Appointment, type Options, type Status } from './api';

/**
 * Appointments' shared bits: whether WorkSuite can be reached, the status pills and card edges of the D-boards, and
 * the context every screen reads (options, the desk's location, offline, how to open a record).
 */

export function useOnline(): boolean {
  return useStore(app, (s) => s.status?.network !== 'OFFLINE');
}

export const NEEDS_LINE = 'Needs a connection to WorkSuite.';

export interface Desk {
  online: boolean;
  options: Options | null;
  /** The location this desk works at (D20), or the first one the person may book at. */
  location: number | null;
  setLocation: (id: number) => void;
  /** Open an appointment in the side panel (D08). */
  open: (id: number) => void;
  /** Open a client's history (D15). */
  client: (id: number) => void;
  checkout: (id: number) => void;
  book: (prefill?: Partial<{ date: string; start: string; provider: number; service: number; customer: { id: number; name: string } }>) => void;
  walkIn: () => void;
  me: string;
}

export const DeskCtx = createContext<Desk | null>(null);
export function useDesk(): Desk {
  const d = useContext(DeskCtx);
  if (!d) throw new Error('useDesk outside Appointments');
  return d;
}

const TONE: Record<string, string> = {
  pending: 'bg-warning-bg text-warning-ink dark:bg-warning/15 dark:text-warning',
  confirmed: 'bg-info-bg text-primary dark:bg-primary/15 dark:text-primary',
  checked_in: 'bg-selection text-violet-ink dark:bg-violet/20',
  in_service: 'bg-violet-bg text-blue-ink dark:bg-violet/25 dark:text-info-ink',
  completed: 'bg-success-bg text-success dark:bg-success/15 dark:text-success',
  cancelled: 'bg-subtle text-ink-2 dark:bg-subtle dark:text-ink-2',
  no_show: 'bg-danger-bg text-danger dark:bg-danger/15 dark:text-danger',
  late: 'bg-danger-bg text-danger dark:bg-danger/15 dark:text-danger',
  ok: 'bg-success-bg text-success dark:bg-success/15 dark:text-success',
  warn: 'bg-warning-bg text-warning-ink dark:bg-warning/15 dark:text-warning',
  info: 'bg-selection text-primary dark:bg-primary/15 dark:text-primary',
  muted: 'bg-subtle text-ink-2 dark:bg-subtle dark:text-ink-2',
};

/** The card's left edge on the board and the calendar, by status. */
export const EDGE: Record<string, string> = {
  pending: '#F59E0B', confirmed: '#3B5BDB', checked_in: '#7C3AED', in_service: '#4338CA', completed: '#1F7A4D', cancelled: '#9AA1B5', no_show: '#B42318', late: '#B42318',
};

export function Pill({ tone, children, className }: { tone: string; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex h-[20px] items-center rounded-full px-2 text-[11px] font-semibold whitespace-nowrap', TONE[tone] ?? TONE.muted, className)}>{children}</span>;
}

export const StatusPill = ({ a }: { a: Pick<Appointment, 'status' | 'status_label'> }) => <Pill tone={a.status}>{a.status_label}</Pill>;

export function Section({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('overflow-hidden rounded-[12px] border border-line bg-surface', className)}>
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

export function Head({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-3.5 flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="m-0 text-[20px] font-extrabold text-ink">{title}</h1>
        {sub ? <div className="mt-0.5 text-[12.5px] text-ink-3">{sub}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="ml-1 rounded-[4px] border border-b-2 border-current/30 px-1 font-mono text-[10px] opacity-80">{children}</span>;
}

export const input = 'h-9 w-full rounded-[8px] border border-line bg-surface px-3 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-primary disabled:opacity-60';
export const label = 'mb-1 block text-[12px] font-semibold text-ink-2';
export const th = 'border-b border-line bg-ground px-2.5 py-[7px] text-left text-[11px] font-semibold whitespace-nowrap text-ink-2';
export const td = 'border-b border-line/70 px-2.5 py-2 whitespace-nowrap';
export const tdr = 'border-b border-line/70 px-2.5 py-2 whitespace-nowrap text-right tabular-nums';

export function Chips<T extends string>({ value, onChange, options, label: name }: { value: T; onChange: (v: T) => void; options: Array<{ id: T; label: string; n?: number | null }>; label: string }) {
  return (
    <div role="group" aria-label={name} className="flex flex-wrap items-center gap-1.5">
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={o.id === value} onClick={() => onChange(o.id)} className={cx('h-[28px] rounded-[14px] border px-2.5 text-[12px] font-semibold', o.id === value ? 'border-primary bg-info-bg text-primary dark:bg-selection dark:text-primary' : 'border-line bg-surface text-ink-2 hover:bg-subtle')}>
          {o.label}
          {o.n ? <span className="ml-1.5 tabular-nums opacity-70">{o.n}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** What a refused write says, shown where it was asked. */
export function Refused({ children }: { children: ReactNode }) {
  return children ? <p role="alert" className="m-0 rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger dark:bg-danger/15 dark:text-danger">{children}</p> : null;
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * A status move from any screen: sent now or kept in the outbox (api.setStatus), then the day is asked for again.
 * The answer is the server's sentence; a refusal is shown as it came.
 */
export function useMove(): (a: Appointment, status: Status, reason?: string) => Promise<boolean> {
  const qc = useQueryClient();
  return async (a, status, reason) => {
    try {
      const r = await setStatus(a, status, reason);
      toast(r.queued ? 'info' : 'success', r.message);
      void qc.invalidateQueries({ queryKey: K.all });
      return true;
    } catch (e) {
      toast('error', errText(e));
      return false;
    }
  };
}

/** The clock for a screen, ticking every `ms` (render stays pure: the time is state). */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}
