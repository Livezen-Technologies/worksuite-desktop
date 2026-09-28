import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { Avatar, Button, Chip, cx } from '../../components/ui';
import type { SalonDeskInfo } from '@shared/types';
import { amount, type Options, type SalonLocation, type Severity, type Visit } from './api';
import { MK, printSettings, type CheckoutResult } from './money';

/**
 * What every SalonMate screen reads: this computer's desk, its location and
 * that location's clock, the company, what the signed-in person may do, and
 * how to move between the desk's screens.
 */
export type DeskView = 'today' | 'calendar' | 'walkin' | 'book' | 'clients' | 'pay' | 'paid' | 'register' | 'close' | 'printers';

/** What a walk-in is started with: ids only, so it fits in a tab's address whatever the client's name. */
export interface WalkInSeed {
  client_id?: number;
  service_ids?: number[];
  provider_id?: number;
  date?: string;
}

export interface Desk {
  desk: SalonDeskInfo;
  location: SalonLocation;
  org: number;
  /** The company's name and currency, as receipts and the day's pages give them. */
  company: string;
  currency: string;
  options: Options;
  params: URLSearchParams;
  may: (permission: string) => boolean;
  go: (view: DeskView, params?: Record<string, string | number | null | undefined>) => void;
  /** Start a check-in; the allergy panel opens first when the client needs it. */
  checkIn: (visit: Visit) => void;
  /** A walk-in, or a booking (`later`), started with what is already known. */
  walkIn: (seed: WalkInSeed, later?: boolean) => void;
  /** What a payment answered, for the Paid screen that follows it. */
  paid: { remember: (visitId: number, result: CheckoutResult) => void; get: (visitId: number) => CheckoutResult | undefined };
}

export const DeskContext = createContext<Desk | null>(null);

export function useDesk(): Desk {
  const d = useContext(DeskContext);
  if (!d) throw new Error('useDesk outside the SalonMate desk');
  return d;
}

/**
 * A desk screen's address, as a tab keeps it. Tab routes are plain paths —
 * letters, digits and `/_-.:?=&%` — so every value is percent-encoded all the
 * way (URLSearchParams would write a space as `+`, and the tab not be kept).
 */
export function salonRoute(view: DeskView, params: Record<string, string | number | null | undefined> = {}): string {
  const enc = (v: string) => encodeURIComponent(v).replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const parts = [`view=${view}`];
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') parts.push(`${enc(k)}=${enc(String(v))}`);
  return `/salon?${parts.join('&')}`;
}

export function seedParam(seed: WalkInSeed): string {
  return JSON.stringify({ ...seed, ...(seed.service_ids ? { service_ids: seed.service_ids.slice(0, 12) } : {}) });
}

/** The seed a walk-in or booking screen was opened with. */
export function seedOf(params: URLSearchParams): WalkInSeed {
  try {
    const v = JSON.parse(params.get('seed') ?? '{}') as WalkInSeed;
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/** A clock that ticks: "free now", "due in 12 min" and the calendar's now-line move on without a reload. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(h);
  }, [intervalMs]);
  return now;
}

// ── pieces ──────────────────────────────────────────────────────────────

export const SEVERITY_TONE: Record<Severity, 'warning' | 'danger'> = { mild: 'warning', moderate: 'warning', severe: 'danger' };

export function severityLabel(s: Severity): string {
  return s[0]!.toUpperCase() + s.slice(1);
}

export function AllergyChip({ allergy }: { allergy: { severity: Severity; substance: string } }) {
  return (
    <Chip tone={SEVERITY_TONE[allergy.severity]}>
      <span title={`${allergy.substance} — ${allergy.severity}`} className="inline-flex items-center gap-1">
        <Icon name="warning" size={12} /> Allergy
      </span>
    </Chip>
  );
}

/** A figure with its label above it: points, store credit, what is owed. */
export function Figure({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-[10px] border border-line bg-ground px-3 py-2">
      <div className="text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">{label}</div>
      <div className="mt-0.5 text-[15px] leading-snug font-bold text-ink tabular-nums">{value}</div>
    </div>
  );
}

/** A line across a screen that says something about the whole of it. */
export function Note({ tone = 'muted', children, action }: { tone?: 'muted' | 'warning' | 'danger' | 'indigo'; children: ReactNode; action?: ReactNode }) {
  const tones = {
    muted: 'border-line bg-subtle text-ink-2',
    warning: 'border-warning/30 bg-warning-bg text-warning',
    danger: 'border-danger/30 bg-danger-bg text-danger',
    indigo: 'border-primary/20 bg-selection text-primary',
  };
  return (
    <div className={cx('flex items-center gap-3 rounded-[10px] border px-3.5 py-2.5 text-[13px] font-medium', tones[tone])}>
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

/** A big button for the counter's most common jobs (D02). */
export function QuickAction({ icon, label, onClick, disabled }: { icon: string; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-[88px] flex-col items-start gap-2.5 rounded-[12px] border border-line bg-surface p-3.5 text-left transition-colors hover:border-primary/40 hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-selection text-primary">
        <Icon name={icon} size={20} />
      </span>
      <span className="text-[14px] font-bold text-ink">{label}</span>
    </button>
  );
}

export function Person({ name, sub, trailing, size = 32 }: { name: string; sub?: ReactNode; trailing?: ReactNode; size?: number }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={name} size={size} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-bold text-ink">{name}</div>
        {sub ? <div className="truncate text-[12.5px] text-ink-2">{sub}</div> : null}
      </div>
      {trailing}
    </div>
  );
}

/** Choose one of a few: payment method, category, severity. */
export function Choice<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }> }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx('h-8 rounded-full px-3.5 text-[12.5px] font-semibold', value === o.value ? 'bg-primary text-white' : 'border border-line bg-surface text-ink hover:bg-subtle')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** "Could not …" with Retry — never an empty list standing in for a failure. */
export function Failed({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <Note tone="danger" action={onRetry ? <Button size="sm" onClick={onRetry}>Retry</Button> : undefined}>
      {text}
    </Note>
  );
}

export function stylistsOf(v: Visit): string {
  return [...new Set(v.items.map((i) => i.provider))].join(', ');
}

export function servicesOf(v: Visit): string {
  return v.items.map((i) => i.service).join(', ');
}

export const firstName = (name: string) => name.split(/\s+/)[0] || name;

/* ── Money ──────────────────────────────────────────────────────────── */

/** This computer's printers and drawer for SalonMate (the main process keeps them). */
export function usePrintSettings() {
  return useQuery({ queryKey: MK.print, queryFn: printSettings, staleTime: Infinity });
}

/** A line of the bill: a label and a money figure, a credit shown as "− 500.00". */
export function MoneyLine({ label, value, currency = '', strong = false }: { label: ReactNode; value: number; currency?: string; strong?: boolean }) {
  return (
    <div className={cx('flex items-baseline justify-between gap-3 text-[14px]', strong && 'font-extrabold')}>
      <dt className="min-w-0 truncate text-ink-2">{label}</dt>
      <dd className="m-0 font-bold text-ink tabular-nums">{value < 0 ? `− ${amount(-value, currency)}` : amount(value, currency)}</dd>
    </div>
  );
}

/** A figure in a box, for the register's tiles. */
export function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[12px] border border-line bg-surface p-3.5">
      <div className="text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">{label}</div>
      <div className="mt-1 text-[19px] leading-snug font-extrabold text-ink tabular-nums">{value}</div>
      {sub ? <div className="text-[12px] text-ink-3">{sub}</div> : null}
    </div>
  );
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'back'];

/** The cash keypad: big keys for a counter, and the keyboard's digits work too. */
export function Keypad({ label, onKey }: { label: string; onKey: (key: string) => void }) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-3 gap-2">
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          aria-label={k === 'back' ? 'Delete the last digit' : k}
          onClick={() => onKey(k)}
          className="h-12 rounded-[10px] border border-line bg-surface text-[18px] font-bold text-ink tabular-nums hover:bg-subtle active:bg-selection"
        >
          {k === 'back' ? <Icon name="back" size={18} className="mx-auto" /> : k}
        </button>
      ))}
    </div>
  );
}

/** Counting the drawer note by note: how many of each, and what they come to. */
export function CountSheet({ values, counts, onChange, label }: { values: number[]; counts: Record<string, string>; onChange: (c: Record<string, string>) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-2 gap-x-4 gap-y-1.5 md:grid-cols-3">
      {values.map((v) => {
        const n = Math.floor(Number(counts[String(v)] ?? '') || 0);
        return (
          <label key={v} className="flex items-center gap-2 text-[13px] text-ink">
            <span className="w-16 shrink-0 text-right font-bold tabular-nums">{v.toLocaleString('en-US')}</span>
            <span className="text-ink-3">×</span>
            <input
              aria-label={`How many ${v.toLocaleString('en-US')}`}
              inputMode="numeric"
              value={counts[String(v)] ?? ''}
              onChange={(e) => onChange({ ...counts, [String(v)]: e.target.value.replace(/\D+/g, '').slice(0, 6) })}
              className="h-8 w-16 rounded-[8px] border border-line bg-surface px-2 text-right text-[13px] text-ink outline-none tabular-nums focus:border-primary"
            />
            <span className="ml-auto text-ink-3 tabular-nums">{n > 0 ? amount(n * v) : ''}</span>
          </label>
        );
      })}
    </div>
  );
}
