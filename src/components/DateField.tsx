import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { placeMenu } from './menuPlacement';
import { dayWords, todayInZone } from '../core/time';

/**
 * The date control (the web's DateField, natively): a text field that shows the date in words on the reader's
 * locale — "11 Oct 2026" — with a calendar beside it, instead of the browser's `<input type="date">`, whose
 * "yyyy-mm-dd" or "mm/dd/yyyy" segments come from the operating system's locale, not the app's, and whose picker
 * ignores the app's theme.
 *
 * Typed OR picked. What was typed is read on Enter or when focus leaves, DAY FIRST ("7/12/2026" is 7 December, the
 * convention where the app is used), and echoed back in words, so a misreading announces itself. Also understood:
 * "2026-12-07", "7 Dec", "7 December 2026", "Dec 7, 2026", "today", "tomorrow", "yesterday". Something it cannot read
 * is kept as typed and marked invalid; the value does not change.
 *
 * The value never changes shape: `YYYY-MM-DD`, or '' for none — a drop-in for the native input's `value`.
 */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const pad = (n: number) => String(n).padStart(2, '0');

function ymdOf(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return null;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d > days ? null : `${y}-${pad(m)}-${pad(d)}`;
}

function shift(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthIndex(word: string): number {
  const i = MONTHS.indexOf(word.slice(0, 3).toLowerCase());
  return i < 0 ? 0 : i + 1;
}

/** A typed date as YYYY-MM-DD, day first; '' for an empty field; null when it cannot be read. */
export function parseDateInput(raw: string, today: string = todayInZone()): string | null {
  const s = raw.trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  if (s === '') return '';
  if (s === 'today') return today;
  if (s === 'tomorrow') return shift(today, 1);
  if (s === 'yesterday') return shift(today, -1);
  const year = Number(today.slice(0, 4));
  const full = (y: string | undefined) => (y === undefined ? year : y.length === 2 ? 2000 + Number(y) : Number(y));
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return ymdOf(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(s);
  if (m) return ymdOf(full(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]{3,})\.?(?: (\d{2}|\d{4}))?$/.exec(s);
  if (m && monthIndex(m[2]!)) return ymdOf(full(m[3]), monthIndex(m[2]!), Number(m[1]));
  m = /^([a-z]{3,})\.? (\d{1,2})(?:st|nd|rd|th)?(?: (\d{2}|\d{4}))?$/.exec(s);
  if (m && monthIndex(m[1]!)) return ymdOf(full(m[3]), monthIndex(m[1]!), Number(m[2]));
  return null;
}

/** "11 Oct 2026" on the reader's locale; '' for none. */
export function dateWords(ymd: string | null | undefined): string {
  return ymd ? dayWords(ymd, { year: true }) : '';
}

/** A month drawn Monday to Sunday, six rows: each day with whether it is in the month. */
export function monthCells(ym: string): Array<{ day: string; inMonth: boolean }> {
  const first = `${ym.slice(0, 7)}-01`;
  const dow = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const start = shift(first, -dow);
  return Array.from({ length: 42 }, (_, i) => {
    const day = shift(start, i);
    return { day, inMonth: day.slice(0, 7) === ym.slice(0, 7) };
  });
}

function addMonths(ym: string, n: number): string {
  const d = new Date(`${ym.slice(0, 7)}-15T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
}

export interface DateFieldProps {
  value: string | null | undefined;
  onChange: (value: string) => void;
  'aria-label': string;
  id?: string;
  min?: string;
  max?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Offers "Clear" in the calendar (an optional date). */
  clearable?: boolean;
  className?: string;
}

export function DateField({ value, onChange, id, min, max, placeholder = 'Choose a date', disabled, clearable, className, ...rest }: DateFieldProps) {
  const label = rest['aria-label'];
  const v = value ?? '';
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState((v || todayInZone()).slice(0, 7));
  const [focusDay, setFocusDay] = useState(v || todayInZone());
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const gridId = useId();

  const outOfRange = useCallback((d: string) => (min ? d < min : false) || (max ? d > max : false), [min, max]);

  const commit = (text: string) => {
    const parsed = parseDateInput(text);
    if (parsed === null || (parsed && outOfRange(parsed))) {
      setBad(true);
      return;
    }
    setBad(false);
    setDraft(null);
    if (parsed !== v) onChange(parsed);
  };

  const place = useCallback(() => {
    const r = wrap.current?.getBoundingClientRect();
    if (!r) return;
    const p = placeMenu({ trigger: { left: r.left, top: r.top, width: r.width, height: r.height }, menu: { width: 272, height: 318 }, viewport: { width: window.innerWidth, height: window.innerHeight }, prefer: 'bottom', align: 'start' });
    setPos({ left: p.left, top: p.top });
  }, []);

  const show = () => {
    if (disabled) return;
    const at = v || todayInZone();
    setMonth(at.slice(0, 7));
    setFocusDay(at);
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open) return;
    place();
    const again = () => place();
    window.addEventListener('resize', again);
    window.addEventListener('scroll', again, true);
    return () => {
      window.removeEventListener('resize', again);
      window.removeEventListener('scroll', again, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!wrap.current?.contains(t) && !panel.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`)?.focus();
  }, [open, focusDay]);

  const pick = (d: string) => {
    if (outOfRange(d)) return;
    setOpen(false);
    setBad(false);
    setDraft(null);
    if (d !== v) onChange(d);
  };

  const onGridKey = (e: KeyboardEvent) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in step) {
      e.preventDefault();
      const next = shift(focusDay, step[e.key]!);
      setFocusDay(next);
      setMonth(next.slice(0, 7));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      wrap.current?.querySelector('input')?.focus();
    }
  };

  const cells = useMemo(() => monthCells(month), [month]);
  const today = todayInZone();
  const shown = draft ?? dateWords(v);

  return (
    <div ref={wrap} className={'relative flex min-w-0 items-center ' + (className ?? '')}>
      <input
        id={id}
        type="text"
        aria-label={label}
        aria-invalid={bad || undefined}
        aria-haspopup="dialog"
        title={bad ? 'Type a date such as 11 Oct 2026 or 11/10/2026' : undefined}
        disabled={disabled}
        placeholder={placeholder}
        value={shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== null && commit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft !== null) {
            e.preventDefault();
            commit(draft);
          } else if (e.key === 'ArrowDown' && e.altKey) {
            e.preventDefault();
            show();
          }
        }}
        className={'h-[32px] w-full min-w-0 rounded-[8px] border bg-surface ps-2.5 pe-8 text-[13px] text-ink outline-none disabled:bg-subtle disabled:text-ink-3 ' + (bad ? 'border-danger' : 'border-line focus:border-primary')}
      />
      <button type="button" aria-label={`${label}: open the calendar`} disabled={disabled} onClick={() => (open ? setOpen(false) : show())} className="absolute end-1 flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-ink disabled:opacity-50">
        <Icon name="calendar" size={14} />
      </button>
      {open && pos
        ? createPortal(
            <div ref={panel} role="dialog" aria-label={`${label}: calendar`} className="no-drag animate-in fixed z-[80] w-[272px] rounded-[10px] border border-line bg-surface p-2.5 shadow-[0_12px_32px_rgb(var(--ws-shadow-rgb)/.22)]" style={{ left: pos.left, top: pos.top }}>
              <div className="mb-1.5 flex items-center justify-between">
                <button type="button" aria-label="Previous month" onClick={() => setMonth((m) => addMonths(m, -1))} className="flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-2 hover:bg-subtle">
                  <Icon name="chevron-left" size={15} />
                </button>
                <span className="text-[13px] font-semibold text-ink" aria-live="polite">
                  {new Date(`${month}-15T12:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}
                </span>
                <button type="button" aria-label="Next month" onClick={() => setMonth((m) => addMonths(m, 1))} className="flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-2 hover:bg-subtle">
                  <Icon name="chevron-right" size={15} />
                </button>
              </div>
              <div role="grid" id={gridId} aria-label={label} onKeyDown={onGridKey} className="grid grid-cols-7 gap-0.5 text-center">
                {WEEKDAYS.map((w) => (
                  <span key={w} role="columnheader" className="py-1 text-[10.5px] font-bold text-ink-3">
                    {w}
                  </span>
                ))}
                {cells.map((c) => {
                  const chosen = c.day === v;
                  const off = outOfRange(c.day);
                  return (
                    <button
                      key={c.day}
                      type="button"
                      role="gridcell"
                      data-day={c.day}
                      tabIndex={c.day === focusDay ? 0 : -1}
                      aria-selected={chosen}
                      aria-label={dayWords(c.day, { weekday: true, long: true, year: true })}
                      disabled={off}
                      onClick={() => pick(c.day)}
                      className={
                        'h-8 rounded-[6px] text-[12.5px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-default disabled:opacity-35 ' +
                        (chosen ? 'bg-primary font-semibold text-white ' : c.inMonth ? 'text-ink hover:bg-subtle ' : 'text-ink-3 hover:bg-subtle ') +
                        (c.day === today && !chosen ? 'font-bold text-primary' : '')
                      }
                    >
                      {Number(c.day.slice(8))}
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-line pt-2 text-[12px]">
                <button type="button" disabled={outOfRange(today)} onClick={() => pick(today)} className="font-semibold text-primary hover:underline disabled:opacity-40">
                  Today
                </button>
                {clearable && v ? (
                  <button type="button" onClick={() => (setOpen(false), onChange(''))} className="text-ink-3 hover:text-ink hover:underline">
                    Clear
                  </button>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
