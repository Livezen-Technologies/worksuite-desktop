import type { ReactNode } from 'react';

/**
 * Money as the dashboards write it ("LKR 12.4M", "LKR 950k", "LKR 1,840,000.00") and the bar rows they are made of.
 * First drawn for CRM (they were in `crm/parts`) and shared by Sales and Billing (audit D-G08).
 */

/** "LKR 12.4M", "LKR 950k", "LKR 800" — for tiles and boards. */
export function money(n: number | null | undefined, currency?: string | null): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  const a = Math.abs(v);
  const s = a >= 1_000_000 ? `${(v / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M` : a >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v));
  return currency ? `${currency} ${s}` : s;
}

/** "LKR 1,840,000.00" — for a record, where the exact figure matters. */
export function moneyFull(n: number | null | undefined, currency?: string | null): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  const s = Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${s}` : s;
}

/** A label, a value, and a bar under them as wide as `pct`. */
export function BarRow({ label, value, pct, colour = 'var(--color-primary)' }: { label: ReactNode; value: ReactNode; pct: number; colour?: string }) {
  return (
    <div className="flex flex-col gap-[3px]">
      <span className="flex text-[12.5px]">
        <span className="min-w-0 flex-1 truncate text-ink-2">{label}</span>
        <b className="text-ink tabular-nums">{value}</b>
      </span>
      <span className="h-2 overflow-hidden rounded-full bg-subtle">
        <span className="block h-2 rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: colour }} />
      </span>
    </div>
  );
}
