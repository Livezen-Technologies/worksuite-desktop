/**
 * Dates as HR uses them: plain calendar days (Y-m-d) on the company's
 * calendar, never instants — so they are built and compared as strings and
 * local-noon Dates, which cannot slip across midnight in any zone.
 */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parseYmd(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? new Date(+m[1]!, +m[2]! - 1, +m[3]!, 12) : new Date(NaN);
}

export function addDays(s: string, n: number): string {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

/** Monday of the week holding `s`. */
export function weekStart(s: string): string {
  const d = parseYmd(s);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return ymd(d);
}

/** The days of the week holding `s`, Monday first. */
export function weekDays(s: string): string[] {
  const start = weekStart(s);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** A month drawn Monday to Sunday: whole weeks, with the days of the next and previous months marked. */
export function monthGrid(month: string): Array<{ day: string; inMonth: boolean; weekend: boolean }> {
  const first = parseYmd(`${month.slice(0, 7)}-01`);
  const start = weekStart(ymd(first));
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0, 12);
  const end = addDays(weekStart(ymd(last)), 6);
  const out: Array<{ day: string; inMonth: boolean; weekend: boolean }> = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const x = parseYmd(d);
    out.push({ day: d, inMonth: x.getMonth() === first.getMonth(), weekend: x.getDay() === 0 || x.getDay() === 6 });
  }
  return out;
}

export function shiftMonth(month: string, n: number): string {
  const d = parseYmd(`${month.slice(0, 7)}-01`);
  d.setMonth(d.getMonth() + n);
  return ymd(d).slice(0, 7);
}

export function monthLabel(month: string): string {
  return parseYmd(`${month.slice(0, 7)}-01`).toLocaleDateString([], { month: 'long', year: 'numeric' });
}

/** "Fri 25 Sep". */
export function dayShort(s: string): string {
  const d = parseYmd(s);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "25 Sep 2026". */
export function dayLong(s: string | null | undefined): string {
  if (!s) return '—';
  const d = parseYmd(s);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "28–30 Sep", "30 Sep – 2 Oct", or one day. */
export function rangeLabel(from: string, to: string | null | undefined): string {
  const a = parseYmd(from);
  if (!to || to === from) return a.toLocaleDateString([], { day: 'numeric', month: 'short' });
  const b = parseYmd(to);
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return `${a.getDate()}–${b.getDate()} ${b.toLocaleDateString([], { month: 'short' })}`;
  return `${a.toLocaleDateString([], { day: 'numeric', month: 'short' })} – ${b.toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
}

/** Hours as the timesheet shows them: "9h", "7.5h". */
export function hoursLabel(h: number): string {
  const r = Math.round(h * 100) / 100;
  return `${Number.isInteger(r) ? r : r.toFixed(r * 10 === Math.round(r * 10) ? 1 : 2)}h`;
}

/** Minutes → "8h 32m" (or "45m"). */
export function minutesLabel(min: number | null | undefined): string {
  if (min == null) return '—';
  const m = Math.max(0, Math.round(min));
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}
