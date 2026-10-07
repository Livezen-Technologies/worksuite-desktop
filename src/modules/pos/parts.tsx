import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { PosTillSettings, PosTillStatus } from '@shared/pos';
import { Icon } from '../../components/Icon';
import { Button, cx } from '../../components/ui';
import type { PosCapabilities, PosCompany, PosOptions, PosRegister, PosSession } from './api';
import { formatMoney } from './pricing';

/**
 * What every POS screen reads: this computer's till, the company it sells for and what the signed-in person may do
 * there, the drawer they have open, whether WorkSuite answers, and how to move between the till's screens.
 */
export type PosView = 'register' | 'shift' | 'sales' | 'printers' | 'till';

export interface Till {
  status: PosTillStatus;
  options: PosOptions | null;
  company: PosCompany | null;
  caps: PosCapabilities;
  currency: string;
  /** The drawer this person has open, if any (WorkSuite's, or as last seen when it does not answer). */
  session: PosSession | null;
  registers: PosRegister[];
  /** WorkSuite does not answer: selling goes on from the catalogue copy; the drawer's own screens wait. */
  offline: boolean;
  /** Whether the cashier may take money off a sale, and at most how much. */
  discount: { allowed: boolean; ceiling: number | null };
  params: URLSearchParams;
  go: (view: PosView, params?: Record<string, string | number | null | undefined>) => void;
  /** The till's own settings on this computer (worksuite-desktop#296): card offline, the catalogue's interval. */
  settings?: PosTillSettings;
  /** Open the sync status (the till bar's drawer). */
  openSync?: () => void;
}

export const TillContext = createContext<Till | null>(null);

export function useTillContext(): Till {
  const t = useContext(TillContext);
  if (!t) throw new Error('useTillContext outside the POS till');
  return t;
}

/** A till screen's address, as a tab keeps it (plain path characters only). */
export function posRoute(view: PosView, params: Record<string, string | number | null | undefined> = {}): string {
  const enc = (v: string) => encodeURIComponent(v).replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const parts = [`view=${view}`];
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') parts.push(`${enc(k)}=${enc(String(v))}`);
  return `/pos?${parts.join('&')}`;
}

export function Note({ tone = 'muted', children, action }: { tone?: 'muted' | 'warning' | 'danger' | 'indigo' | 'success'; children: ReactNode; action?: ReactNode }) {
  const tones = {
    muted: 'border-line bg-subtle text-ink-2',
    warning: 'border-warning/30 bg-warning-bg text-warning',
    danger: 'border-danger/30 bg-danger-bg text-danger',
    indigo: 'border-primary/20 bg-selection text-primary',
    success: 'border-success/30 bg-success/10 text-success',
  };
  return (
    <div className={cx('flex items-center gap-3 rounded-[10px] border px-3.5 py-2.5 text-[13px] font-medium', tones[tone])}>
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

export function Failed({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <Note tone="danger" action={onRetry ? <Button size="sm" onClick={onRetry}>Retry</Button> : undefined}>
      {text}
    </Note>
  );
}

export function Choice<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string; disabled?: boolean }> }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cx('h-8 rounded-full px-3.5 text-[12.5px] font-semibold disabled:opacity-40', value === o.value ? 'bg-primary text-white' : 'border border-line bg-surface text-ink hover:bg-subtle')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function MoneyLine({ label, value, currency, strong = false }: { label: ReactNode; value: number | null | undefined; currency?: string; strong?: boolean }) {
  return (
    <div className={cx('flex items-baseline justify-between gap-3', strong ? 'text-[17px] font-extrabold text-ink' : 'text-[13px] text-ink-2')}>
      <span>{label}</span>
      <span className="tabular-nums">{formatMoney(value, strong ? currency : null)}</span>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-semibold text-ink-2">{label}</span>
      {children}
      {hint ? <span className="text-[12px] text-ink-3">{hint}</span> : null}
    </div>
  );
}

/** Counting the drawer note by note: how many of each, and what they come to. */
export function CountSheet({ values, counts, onChange, label }: { values: number[]; counts: Record<string, string>; onChange: (c: Record<string, string>) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-2 gap-x-4 gap-y-1.5 lg:grid-cols-3">
      {values.map((v) => {
        const k = String(v);
        const n = Math.floor(Number(counts[k] ?? '') || 0);
        return (
          <label key={k} className="flex items-center gap-2 text-[13px] text-ink">
            <span className="w-16 shrink-0 text-right font-bold tabular-nums">{v.toLocaleString()}</span>
            <span className="text-ink-3">×</span>
            <input
              aria-label={`How many ${v.toLocaleString()}`}
              inputMode="numeric"
              value={counts[k] ?? ''}
              onChange={(e) => onChange({ ...counts, [k]: e.target.value.replace(/\D+/g, '').slice(0, 6) })}
              className="h-8 w-16 rounded-[8px] border border-line bg-surface px-2 text-right text-[13px] text-ink tabular-nums outline-none focus:border-primary"
            />
            <span className="ml-auto text-ink-3 tabular-nums">{n > 0 ? formatMoney(n * v) : ''}</span>
          </label>
        );
      })}
    </div>
  );
}

/** A sale's place on its way to WorkSuite. */
export function SyncChip({ state, label }: { state: 'waiting' | 'sent' | 'refused'; label: string }) {
  const tone = state === 'sent' ? 'bg-success/10 text-success' : state === 'refused' ? 'bg-danger-bg text-danger' : 'bg-warning-bg text-warning';
  const icon = state === 'sent' ? 'check' : state === 'refused' ? 'warning' : 'clock';
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-bold', tone)}>
      <Icon name={icon} size={12} /> {label}
    </span>
  );
}

export function timeOf(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso.includes('T') || iso.endsWith('Z') ? iso : `${iso.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
}

/**
 * A dialog over the counter, as the till draws them: the navy scrim under the till bar, a rounded white sheet, no
 * header of its own. Esc closes it (when it may be closed); focus goes into it and back where it was.
 */
export function PosDialog({ label, onClose, width, children, className, place = 'center' }: { label: string; onClose?: () => void; width?: number; children: ReactNode; className?: string; place?: 'center' | 'right' }) {
  const ref = useRef<HTMLDivElement>(null);
  const [prev] = useState(() => (typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null));
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && close.current) {
        e.stopPropagation();
        close.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (prev?.isConnected) prev.focus?.();
    };
  }, [prev]);
  return (
    <div
      className={cx('no-drag absolute inset-x-0 top-16 bottom-0 z-40 flex bg-[rgba(15,27,61,.55)]', place === 'center' ? 'items-center justify-center p-6' : 'justify-end')}
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cx(
          'animate-in bare-focus flex max-h-full w-full flex-col overflow-hidden bg-pos-panel text-ink shadow-[0_24px_60px_rgba(15,27,61,.35)] outline-none',
          place === 'center' ? 'rounded-pos-xl' : 'h-full',
          className,
        )}
        style={{ maxWidth: width }}
      >
        {children}
      </div>
    </div>
  );
}

/** A big touch button in a POS dialog: the main action, or a quiet grey one. */
export function PosButton({ tone = 'quiet', className, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'primary' | 'quiet' | 'danger' }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'flex items-center justify-center gap-2 rounded-pos px-4 font-bold disabled:cursor-not-allowed disabled:opacity-45',
        tone === 'primary' ? 'bg-primary text-white hover:bg-primary-hover' : tone === 'danger' ? 'bg-pos-key text-danger hover:brightness-95' : 'bg-pos-key text-ink hover:brightness-95',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** The WorkSuite mark, as the till bar, pairing and the customer display draw it. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 63 63" width={size} height={size} aria-hidden="true">
      <rect x="0" y="21" width="42" height="42" fill="#00DAF2" />
      <rect x="21" y="0" width="42" height="42" fill="#0A6CFF" />
      <rect x="21" y="21" width="21" height="21" fill="#001842" />
    </svg>
  );
}
