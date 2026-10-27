import { useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { btn, btnPrimary, Sheet } from '../hr/parts';
import { Pill } from '../inventory/parts';

/**
 * A read that failed. Never "no accounts" or "open the books first": a failed
 * request is not a statement about the company, and an instruction built on
 * one is an instruction somebody might act on.
 */
export function LoadFailed({ what, onRetry }: { what: string; onRetry?: () => void }) {
  return (
    <div className="m-6 flex flex-col items-start gap-2 rounded-[12px] border border-line bg-surface px-4 py-3.5 text-[13px] text-ink-2">
      <span>
        {what} could not be loaded. This is a failed request, not a statement about the company.
      </span>
      {onRetry ? (
        <button type="button" className={btn} onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

/** Why figures are dashes: the grant, named. */
export function Withheld({ className }: { className?: string }) {
  return (
    <p className={cx('m-0 text-[12px] text-ink-3', className)}>
      Amounts are withheld because you do not hold <code className="font-mono text-[11.5px]">finance.reports.view</code>. What was done is shown; the figures are a separate grant.
    </p>
  );
}

const JOURNAL_TONE: Record<string, 'blue' | 'amber' | 'red' | 'green' | 'grey'> = {
  draft: 'grey',
  pending: 'amber',
  approved: 'blue',
  posted: 'green',
  reversed: 'red',
  cancelled: 'grey',
};

const JOURNAL_WORD: Record<string, string> = {
  draft: 'Draft',
  pending: 'Awaiting approval',
  approved: 'Approved',
  posted: 'Posted',
  reversed: 'Reversed',
  cancelled: 'Cancelled',
};

export function JournalPill({ status }: { status: string }) {
  return <Pill tone={JOURNAL_TONE[status] ?? 'grey'}>{JOURNAL_WORD[status] ?? status}</Pill>;
}

const PERIOD_TONE: Record<string, 'green' | 'amber' | 'grey'> = { open: 'green', locked: 'amber', closed: 'grey' };

export function PeriodPill({ status }: { status: string }) {
  return <Pill tone={PERIOD_TONE[status] ?? 'grey'}>{status.charAt(0).toUpperCase() + status.slice(1)}</Pill>;
}

/** A tinted sentence: amber asks for attention, red says something is wrong, green that it agrees. */
export function Notice({ tone, children, className }: { tone: 'amber' | 'red' | 'green' | 'grey'; children: ReactNode; className?: string }) {
  const c =
    tone === 'amber'
      ? 'border-warning-line bg-warning-bg text-warning-strong dark:border-warning/40 dark:bg-warning-bg dark:text-warning'
      : tone === 'red'
        ? 'border-danger-line bg-danger-bg text-danger-ink dark:border-danger/40 dark:bg-danger-bg dark:text-danger'
        : tone === 'green'
          ? 'border-success-line bg-slate-bg text-success-ink dark:border-success/40 dark:bg-success-bg dark:text-success'
          : 'border-line bg-subtle text-ink-2';
  return <div className={cx('rounded-[10px] border px-3.5 py-2.5 text-[12.5px] leading-relaxed', c, className)}>{children}</div>;
}

/**
 * Are you sure — for the acts the books cannot take back quietly. The
 * sentence says what happens, not "are you sure".
 */
export function ConfirmSheet({ title, body, action, danger, busy, onYes, onClose }: { title: string; body: ReactNode; action: string; danger?: boolean; busy?: boolean; onYes: () => void; onClose: () => void }) {
  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={cx(btnPrimary, danger && '!bg-danger')} disabled={busy} onClick={onYes}>
            {busy ? 'Working…' : action}
          </button>
        </>
      }
    >
      <div className="m-0 text-[13px] leading-[1.55] text-ink-2">{body}</div>
    </Sheet>
  );
}

/**
 * An act that needs a reason — a reversal, a reopened period. The reason is
 * the only record of why, so it is required, and the button stays off until
 * there is one.
 */
export function ReasonSheet({
  title,
  body,
  label,
  action,
  danger,
  busy,
  extra,
  onOk,
  onClose,
}: {
  title: string;
  body: ReactNode;
  label: string;
  action: string;
  danger?: boolean;
  busy?: boolean;
  /** More fields, above the reason (a reversal's date). */
  extra?: ReactNode;
  onOk: (reason: string) => void;
  onClose: () => void;
}) {
  const [r, setR] = useState('');
  return (
    <Sheet
      title={title}
      onClose={onClose}
      width={480}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={cx(btnPrimary, danger && '!bg-danger')} disabled={busy || r.trim() === ''} onClick={() => onOk(r.trim())}>
            {busy ? 'Working…' : action}
          </button>
        </>
      }
    >
      <div className="m-0 text-[13px] leading-[1.55] text-ink-2">{body}</div>
      {extra}
      <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink">
        {label}
        <textarea autoFocus value={r} onChange={(e) => setR(e.target.value)} rows={3} className="resize-none rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] font-medium text-ink outline-none focus:border-primary" />
      </label>
    </Sheet>
  );
}

/** A figure, right-aligned in tabular digits, or a dash where it is withheld. */
export function Amount({ value, className }: { value: string | null | undefined; className?: string }) {
  return <span className={cx('text-right tabular-nums whitespace-nowrap', value === null || value === undefined ? 'text-ink-3' : '', className)}>{value ?? '—'}</span>;
}

/** The small caps heading the reports use. */
export function Caps({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('text-[11px] font-bold tracking-[.12em] text-ink-3 uppercase', className)}>{children}</div>;
}

/** A row that goes somewhere: title over detail, a chevron. */
export function GoRow({ title, sub, onClick }: { title: ReactNode; sub?: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 border-b border-line/60 px-4 py-3 text-left last:border-b-0 hover:bg-subtle">
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="text-[13px] text-ink">{title}</b>
        {sub ? <span className="text-[11.5px] text-ink-3">{sub}</span> : null}
      </span>
      <Icon name="chevron-right" size={15} className="shrink-0 text-ink-3" />
    </button>
  );
}
