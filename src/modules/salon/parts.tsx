import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { Avatar, Button, DATA_TEXT, IconButton, Modal, cx, initials } from '../../components/ui';
import type { SalonCopy, SalonDeskInfo, SalonSyncStatus } from '@shared/types';
import { amount, clockAt, greeting, minutesOf, type Options, type Reliability, type SalonLocation, type Severity, type Visit } from './api';
import { MK, printSettings, type CheckoutResult } from './money';
import { StatCard, type StatTone } from '../../components/StatCard';

/**
 * What every SalonMate screen reads: this computer's desk, its location and
 * that location's clock, the company, what the signed-in person may do, and
 * how to move between the desk's screens.
 */
export type DeskView = 'today' | 'calendar' | 'walkin' | 'book' | 'clients' | 'record' | 'pay' | 'paid' | 'register' | 'close' | 'printers' | 'outbox';

/** What a walk-in is started with: ids only, so it fits in a tab's address whatever the client's name. */
export interface WalkInSeed {
  client_id?: number;
  /** A client added here while WorkSuite is out of reach, carried from a walk-in to its booking. */
  local?: { id: string; name: string; mobile?: string };
  service_ids?: number[];
  provider_id?: number;
  date?: string;
  /** "14:30" on the salon's clock: a time tapped on the calendar, chosen when it is free. */
  time?: string;
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
  /** The signed-in person's name, for the greeting and "opened by". */
  me: string | null;
  may: (permission: string) => boolean;
  go: (view: DeskView, params?: Record<string, string | number | null | undefined>) => void;
  /** Start a check-in; the allergy panel opens first when the client needs it. */
  checkIn: (visit: Visit) => void;
  /** Take the deposit (an advance) a visit still owes, into the desk's register. */
  deposit: (visit: Visit) => void;
  /** A walk-in, or a booking (`later`), started with what is already known. */
  walkIn: (seed: WalkInSeed, later?: boolean) => void;
  /** What a payment answered, for the Paid screen that follows it. */
  paid: {
    remember: (visitId: number, result: CheckoutResult) => void;
    /** What the desk did after: the receipt printed, the drawer opened — merged into what was remembered. */
    note: (visitId: number, outcome: Pick<CheckoutResult, 'printed' | 'drawer'>) => void;
    get: (visitId: number) => CheckoutResult | undefined;
  };
  /** WorkSuite is out of reach: screens read the day's copy, and what the counter does is kept to send (offline.ts). */
  offline: boolean;
  /** The day's copy on this computer, when there is one. */
  copy: SalonCopy | null;
  /** The copy and the outbox, as the main process last saw them. */
  sync: SalonSyncStatus | null;
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

/** "Good morning, Hiruni" on the salon's clock. */
export function greetingFor(desk: Pick<Desk, 'me' | 'location'>, now: number): string {
  const hour = Math.floor(minutesOf(clockAt(new Date(now).toISOString(), desk.location.timezone)) / 60);
  return desk.me ? `${greeting(hour)}, ${firstName(desk.me)}` : greeting(hour);
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

// ── the desk's page and panels (D02…D17) ────────────────────────────────

/** A desk screen: its title, the line under it, what sits at its right, then its panels. */
export function Page({ title, sub, actions, children, className }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col gap-3.5 px-5 py-4', className)}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[24px] leading-tight font-extrabold tracking-[-.01em] text-ink">{title}</h1>
          {sub ? <p className="mt-0.5 text-[13px] text-ink-2">{sub}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2.5">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

/** A white panel with its title in large type, as the desk's screens are built of. */
export function Panel({ title, action, children, className, as: Tag = 'section' }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; as?: 'section' | 'div' }) {
  return (
    <Tag className={cx('min-w-0 rounded-[16px] border border-line bg-surface px-[18px] py-4 shadow-[0_1px_2px_rgb(var(--ws-shadow-rgb)/.05)]', className)}>
      {title !== undefined || action ? (
        <div className="mb-1 flex items-center gap-3">
          {title !== undefined ? <h2 className="min-w-0 flex-1 text-[18px] font-extrabold text-ink">{title}</h2> : <div className="flex-1" />}
          {action}
        </div>
      ) : null}
      {children}
    </Tag>
  );
}

/** The small capitals over a group: SERVICES, WHO CAN DO IT, RECENT VISITS. */
export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('text-[12px] font-bold tracking-[.05em] text-ink-2 uppercase', className)}>{children}</div>;
}

type TouchVariant = 'primary' | 'secondary' | 'danger' | 'quiet';

/** A button sized for a finger at the counter: 48 px, the label in large type. */
export function TouchButton({ variant = 'secondary', icon, loading, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: TouchVariant; icon?: string; loading?: boolean }) {
  const tones: Record<TouchVariant, string> = {
    primary: 'border border-transparent bg-primary text-white enabled:hover:bg-primary-hover',
    secondary: 'border border-slate-line bg-surface text-ink enabled:hover:bg-subtle dark:border-line',
    danger: 'border border-transparent bg-danger text-white enabled:hover:opacity-90',
    quiet: 'border border-transparent bg-transparent text-ink-2 enabled:hover:bg-subtle',
  };
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || loading}
      className={cx('ws-localized-control inline-flex min-h-12 items-center justify-center gap-2 rounded-[12px] px-[18px] text-[15px] font-bold whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50', tones[variant], className)}
    >
      {loading ? <Icon name="spinner" size={18} className="animate-spin-slow" /> : icon ? <Icon name={icon} size={20} /> : null}
      {children}
    </button>
  );
}

export type TagTone = 'muted' | 'indigo' | 'success' | 'warning' | 'danger' | 'violet' | 'blue' | 'slate';

const TAG_TONES: Record<TagTone, string> = {
  muted: 'bg-subtle text-ink-2',
  indigo: 'bg-selection text-primary',
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
  violet: 'bg-info-soft text-violet dark:bg-violet-bg dark:text-violet-ink',
  blue: 'bg-info-soft text-brand-soft dark:bg-blue-bg dark:text-blue-ink',
  slate: 'bg-slate-bg text-ink-2 dark:text-slate-ink',
};

/** A round label beside a name: Deposit owed, Allergy, Advance, Gold. */
export function Tag({ tone = 'muted', icon, children, title, className }: { tone?: TagTone; icon?: string; children: ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={cx('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-px text-[12px] font-semibold whitespace-nowrap', TAG_TONES[tone], className)}>
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}

/** A loyalty tier, in its own colour. */
export function TierTag({ tier }: { tier: string | null | undefined }) {
  if (!tier) return null;
  const t = tier.toLowerCase();
  const tone: TagTone = t.includes('gold') ? 'warning' : t.includes('silver') ? 'slate' : t.includes('platinum') || t.includes('vip') ? 'violet' : 'blue';
  return (
    <Tag tone={tone} className="text-[11px]">
      {tier}
    </Tag>
  );
}

export const RELIABILITY: Record<Reliability, { tone: TagTone; label: string }> = {
  reliable: { tone: 'success', label: 'Reliable' },
  watch: { tone: 'warning', label: 'Watch list' },
  unreliable: { tone: 'danger', label: 'Unreliable' },
};

export function ReliabilityTag({ reliability }: { reliability: Reliability | string | null | undefined }) {
  const r = RELIABILITY[(reliability ?? 'reliable') as Reliability] ?? RELIABILITY.reliable;
  return (
    <Tag tone={r.tone} className="text-[11px]">
      {r.label}
    </Tag>
  );
}

/** A stylist's colour as the server gives it, when it is one a style may carry. */
export function safeColor(c: string | null | undefined): string | null {
  return c && /^#[0-9a-f]{3,8}$/i.test(c.trim()) ? c.trim() : null;
}

/** A tint of a stylist's colour behind their initials: who a booking is with, at a glance. */
export function tint(color: string | null | undefined, pct = 14): CSSProperties | undefined {
  const c = safeColor(color);
  return c ? ({ '--c': c, background: `color-mix(in srgb, ${c} ${pct}%, var(--color-surface))` } as CSSProperties) : undefined;
}

/** Somebody's initials in their colour — a stylist's own, or the one their name always gets. */
export function Who({ name, color, size = 40, className }: { name: string; color?: string | null; size?: number; className?: string }) {
  const c = safeColor(color);
  if (!c) return <Avatar name={name} size={size} className={className} />;
  return (
    <span aria-hidden className={cx('inline-flex shrink-0 items-center justify-center rounded-full font-bold', DATA_TEXT, className)} style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.32)), ...tint(c) }}>
      {initials(name)}
    </span>
  );
}

/** How far through their service a stylist is. */
export function Bar({ value, color }: { value: number; color?: string | null }) {
  const v = Math.max(0, Math.min(100, value));
  const c = safeColor(color);
  return (
    <div className="h-1.5 rounded-full bg-subtle" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx('h-1.5 rounded-full', c ? '' : 'bg-primary')} style={{ width: `${v}%`, ...(c ? { background: c } : {}) }} />
    </div>
  );
}

/** One of a few, side by side in a tray: the paper, the day. */
export function Segmented<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string; disabled?: boolean }> }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-1 rounded-[12px] bg-subtle p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cx('min-h-11 rounded-[10px] px-3 text-[15px] font-semibold disabled:opacity-40', value === o.value ? 'bg-surface text-primary shadow-[0_1px_3px_rgb(var(--ws-shadow-rgb)/.12)]' : 'text-ink-2 enabled:hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** − n + : copies, quantities. */
export function Stepper({ label, value, min = 1, max = 9, onChange }: { label: string; value: number; min?: number; max?: number; onChange: (v: number) => void }) {
  return (
    <div role="group" aria-label={label} className="inline-flex h-12 items-center rounded-[12px] border border-line bg-surface">
      <button type="button" aria-label={`Fewer ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(value - 1)} className="grid h-full w-12 place-items-center text-ink disabled:opacity-40">
        <Icon name="minus" size={18} />
      </button>
      <output className="w-12 text-center text-[17px] font-bold text-ink tabular-nums">{value}</output>
      <button type="button" aria-label={`More ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(value + 1)} className="grid h-full w-12 place-items-center text-ink disabled:opacity-40">
        <Icon name="plus" size={18} />
      </button>
    </div>
  );
}

const DIALOG_TONES = {
  danger: { band: 'bg-danger-bg dark:bg-danger-bg', tile: 'bg-rose', title: 'text-rose-ink dark:text-danger', sub: 'text-rose-ink dark:text-danger' },
  warning: { band: 'bg-rail dark:bg-warning-bg', tile: 'bg-warning', title: 'text-warning-ink', sub: 'text-warning-ink' },
  indigo: { band: 'bg-selection', tile: 'bg-primary', title: 'text-primary', sub: 'text-ink-2' },
  teal: { band: 'bg-teal-bg dark:bg-teal/15', tile: 'bg-teal', title: 'text-slate-ink dark:text-teal-light', sub: 'text-slate-ink dark:text-teal-light' },
} as const;

/**
 * A dialog at the counter (D05): a coloured band that says what it is about,
 * the body, and big buttons at its foot. Escape and a press outside close it.
 */
export function DeskDialog({
  tone = 'indigo',
  icon,
  title,
  sub,
  children,
  footer,
  onClose,
  width = 660,
  labelledBy,
}: {
  tone?: keyof typeof DIALOG_TONES;
  icon: string;
  title: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  width?: number;
  labelledBy: string;
}) {
  const t = DIALOG_TONES[tone];
  return (
    <Modal width={width} onClose={onClose} labelledBy={labelledBy}>
      <div className={cx('-mx-5 -mt-4 flex items-center gap-3.5 rounded-t-[14px] px-[26px] py-[22px]', t.band)}>
        <span className={cx('grid h-12 w-12 shrink-0 place-items-center rounded-[14px] text-white', t.tile)}>
          <Icon name={icon} size={26} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={labelledBy} className={cx('text-[20px] leading-tight font-extrabold', t.title)}>
            {title}
          </h2>
          {sub ? <p className={cx('mt-0.5 text-[13px]', t.sub)}>{sub}</p> : null}
        </div>
        <IconButton icon="x" label="Close" onClick={onClose} className="h-10 w-10 shrink-0" />
      </div>
      <div className="flex flex-col gap-3 px-1.5 pt-5">{children}</div>
      {footer ? <div className="flex flex-wrap justify-end gap-2.5 px-1.5 pt-4 pb-1.5">{footer}</div> : null}
    </Modal>
  );
}

// ── pieces ──────────────────────────────────────────────────────────────

export const SEVERITY_TONE: Record<Severity, 'warning' | 'danger'> = { mild: 'warning', moderate: 'warning', severe: 'danger' };

export function severityLabel(s: Severity): string {
  return s[0]!.toUpperCase() + s.slice(1);
}

export function AllergyChip({ allergy }: { allergy: { severity: Severity; substance: string } }) {
  return (
    <Tag tone="danger" icon="warning" title={`${allergy.substance} — ${allergy.severity}`}>
      Allergy
    </Tag>
  );
}

/** A figure with its label above it: points, store credit, what is owed. */
export function Figure({ label, value, sub, icon, tone }: { label: string; value: ReactNode; sub?: ReactNode; icon?: string; tone?: StatTone }) {
  return <StatCard size="sm" label={label} value={value} sub={sub} icon={icon} tone={tone} />;
}

/** A line across a screen that says something about the whole of it. */
export function Note({ tone = 'muted', children, action, icon }: { tone?: 'muted' | 'warning' | 'danger' | 'indigo' | 'teal'; children: ReactNode; action?: ReactNode; icon?: string }) {
  const tones = {
    muted: 'border-line bg-subtle text-ink-2',
    warning: 'border-[var(--ws-note-line)] bg-warning-bg text-warning-ink',
    danger: 'border-danger/30 bg-danger-bg text-danger',
    indigo: 'border-primary/20 bg-selection text-primary',
    teal: 'border-teal-light bg-teal-bg text-slate-ink dark:bg-teal/15 dark:text-teal-light',
  };
  return (
    <div className={cx('flex items-center gap-3 rounded-[12px] border px-3.5 py-2.5 text-[13px] font-medium', tones[tone])}>
      {icon ? <Icon name={icon} size={18} className="shrink-0" /> : null}
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

const QUICK_TONES = {
  indigo: 'bg-selection text-primary',
  teal: 'bg-teal-bg text-teal dark:bg-teal/15 dark:text-teal-light',
  amber: 'bg-yellow-bg text-warning dark:bg-warning-bg dark:text-warning',
  pink: 'bg-rose-bg text-rose dark:text-rose-ink',
} as const;

/** A big button for the counter's most common jobs (D02). */
export function QuickAction({ icon, label, onClick, disabled, tone = 'indigo' }: { icon: string; label: string; onClick: () => void; disabled?: boolean; tone?: keyof typeof QUICK_TONES }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-24 flex-col items-start gap-2.5 rounded-[16px] border border-line bg-surface p-3.5 text-left transition-colors enabled:hover:border-primary/40 enabled:hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className={cx('flex h-10 w-10 items-center justify-center rounded-[12px]', QUICK_TONES[tone])}>
        <Icon name={icon} size={22} />
      </span>
      <span className="text-[15px] font-bold text-ink">{label}</span>
    </button>
  );
}

export function Person({ name, sub, trailing, size = 32 }: { name: string; sub?: ReactNode; trailing?: ReactNode; size?: number }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={name} size={size} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-bold text-ink">{name}</div>
        {sub ? <div className="truncate text-[13px] text-ink-2">{sub}</div> : null}
      </div>
      {trailing}
    </div>
  );
}

/** Choose one of a few: payment method, category, severity. */
export function Choice<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }> }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx('min-h-11 rounded-full px-[18px] text-[14px] font-semibold', value === o.value ? 'bg-navy text-white dark:bg-primary' : 'border border-line bg-surface text-ink hover:bg-subtle')}
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
    <Note
      tone="danger"
      action={
        onRetry ? (
          <Button size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : undefined
      }
    >
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

/** "Ruwan J." — a stylist on a receipt line. */
export const shortName = (name: string) => {
  const p = name.trim().split(/\s+/);
  return p.length > 1 ? `${p[0]} ${p[p.length - 1]![0]}.` : name;
};

/* ── Money ──────────────────────────────────────────────────────────── */

/** This computer's printers and drawer for SalonMate (the main process keeps them). */
export function usePrintSettings() {
  return useQuery({ queryKey: MK.print, queryFn: printSettings, staleTime: Infinity });
}

/** A line of the bill: a label and a money figure, a credit shown as "− 500.00". */
export function MoneyLine({ label, value, currency = '', strong = false, tone }: { label: ReactNode; value: number; currency?: string; strong?: boolean; tone?: 'saving' | 'advance' }) {
  return (
    <div className={cx('flex items-baseline justify-between gap-3 py-[3px]', strong ? 'text-[16px]' : 'text-[14px]')}>
      <dt className="min-w-0 truncate text-ink-2">{label}</dt>
      <dd className={cx('m-0 tabular-nums', strong ? 'font-extrabold text-ink' : 'font-semibold', !strong && (tone === 'saving' ? 'text-success' : tone === 'advance' ? 'text-violet dark:text-violet-ink' : 'text-ink'))}>
        {value < 0 ? `− ${amount(-value, currency)}` : amount(value, currency)}
      </dd>
    </div>
  );
}

/** A figure in a box, for the register's tiles. */
export function Tile({ label, value, sub, icon, tone }: { label: string; value: string; sub?: string; icon?: string; tone?: StatTone }) {
  return <Figure label={label} value={value} sub={sub} icon={icon} tone={tone} />;
}

/** The keys as on a calculator: 7 8 9 on top. */
const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0', 'back'];

/** The cash keypad: big keys for a counter, and the keyboard's digits work too. */
export function Keypad({ label, onKey, className }: { label: string; onKey: (key: string) => void; className?: string }) {
  return (
    <div role="group" aria-label={label} className={cx('grid grid-cols-3 gap-2', className)}>
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          aria-label={k === 'back' ? 'Delete the last digit' : k}
          onClick={() => onKey(k)}
          className="min-h-[52px] rounded-[12px] border border-line bg-surface text-[20px] font-bold text-ink tabular-nums hover:bg-subtle active:bg-selection"
        >
          {k === 'back' ? <Icon name="backspace" size={22} className="mx-auto" /> : k}
        </button>
      ))}
    </div>
  );
}

/**
 * Counting the drawer note by note (D11, D13): each note's count in a big
 * box, and what it comes to beside it.
 */
export function CountSheet({ values, counts, onChange, label }: { values: number[]; counts: Record<string, string>; onChange: (c: Record<string, string>) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col">
      {values.map((v) => {
        const n = Math.floor(Number(counts[String(v)] ?? '') || 0);
        return (
          <label key={v} className="flex items-center gap-4 border-t border-line py-1.5 first:border-t-0">
            <span className="w-20 shrink-0 text-[16px] font-bold text-ink tabular-nums">{v.toLocaleString('en-US')}</span>
            <input
              aria-label={`How many ${v.toLocaleString('en-US')}`}
              inputMode="numeric"
              value={counts[String(v)] ?? ''}
              onChange={(e) => onChange({ ...counts, [String(v)]: e.target.value.replace(/\D+/g, '').slice(0, 6) })}
              className="h-10 w-[90px] rounded-[10px] border border-line bg-surface px-3 text-right text-[16px] text-ink outline-none tabular-nums focus:border-primary"
            />
            <span className="ml-auto text-[15px] text-ink tabular-nums">{amount(n * v)}</span>
          </label>
        );
      })}
    </div>
  );
}
