import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { Avatar, Button, Chip, cx } from '../../components/ui';
import type { SalonDeskInfo } from '@shared/types';
import type { Options, SalonLocation, Severity, Visit } from './api';

/**
 * What every SalonMate screen reads: this computer's desk, its location and
 * that location's clock, the company, what the signed-in person may do, and
 * how to move between the desk's screens.
 */
export type DeskView = 'today' | 'calendar' | 'walkin' | 'book' | 'clients';

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
  options: Options;
  params: URLSearchParams;
  may: (permission: string) => boolean;
  go: (view: DeskView, params?: Record<string, string | number | null | undefined>) => void;
  /** Start a check-in; the allergy panel opens first when the client needs it. */
  checkIn: (visit: Visit) => void;
  /** A walk-in, or a booking (`later`), started with what is already known. */
  walkIn: (seed: WalkInSeed, later?: boolean) => void;
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
