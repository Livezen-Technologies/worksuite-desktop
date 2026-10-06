/**
 * The till's keypad, as a rule with no screen in it: what an amount (or a count) becomes when a key is pressed.
 * Digits are appended, `00` appends two, `.` starts the cents (once, when cents are allowed), `back` takes the last
 * character off and `clear` empties it. An amount keeps at most `decimals` places and `digits` whole digits.
 */
export type PadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '00' | '.' | 'back' | 'clear';

export interface PadRules {
  /** Places after the point; 0 for a count of notes. */
  decimals?: number;
  /** Whole digits at most. */
  digits?: number;
}

export function press(value: string, key: PadKey | string, o: PadRules = {}): string {
  const decimals = o.decimals ?? 2;
  const digits = o.digits ?? 9;
  const v = clean(value, o);
  if (key === 'clear') return '';
  if (key === 'back') return v.slice(0, -1);
  if (key === '.') {
    if (decimals <= 0 || v.includes('.')) return v;
    return v === '' ? '0.' : `${v}.`;
  }
  if (!/^\d+$/.test(key)) return v;
  let next = v;
  for (const d of key) {
    if (next === '0') next = d === '0' ? '0' : d;
    else if (next === '' && d === '0' && key === '00') next = '0';
    else next += d;
    const [whole = '', cents] = next.split('.');
    if (whole.replace(/^0+(?=\d)/, '').length > digits || (cents !== undefined && cents.length > decimals)) return v;
  }
  return next;
}

/** An amount as typed on a keyboard: digits and one point (no point for a count), commas dropped. */
export function clean(typed: string, o: PadRules = {}): string {
  const decimals = o.decimals ?? 2;
  let s = typed.replace(/,/g, '').replace(decimals > 0 ? /[^\d.]/g : /\D/g, '');
  const dot = s.indexOf('.');
  if (dot >= 0) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '').slice(0, decimals);
  return s.slice(0, (o.digits ?? 9) + (dot >= 0 ? decimals + 1 : 0));
}

/** An amount as it is typed, its whole part grouped in thousands ("7,000.5"): what the big amount shows. */
export function grouped(value: string): string {
  if (!value) return '';
  const [whole = '', cents] = value.split('.');
  const g = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return cents === undefined ? g : `${g || '0'}.${cents}`;
}

/** An amount for the pad: a figure the till already knows (the total), as the cashier would have typed it. */
export function typedOf(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}
