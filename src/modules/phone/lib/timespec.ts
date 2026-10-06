/**
 * Forwarding time rules in Asterisk's GotoIfTime notation — `times,days-of-week,days-of-month,months`, e.g.
 * `09:00-17:00,mon-fri,*,*` — checked here exactly as the server's `Forwarding::checkTimeSpec` checks them, so the
 * form says what is wrong before it is sent, and described in words for the rule list (design W07).
 */

export interface SpecCheck {
  ok: boolean;
  message?: string;
}

export function checkTimeSpec(raw: string): SpecCheck {
  const spec = raw.trim();
  if (spec === '') return { ok: false, message: 'A time condition needs a time specification.' };
  if (!/^[0-9a-zA-Z:,|*-]{3,120}$/.test(spec)) {
    return { ok: false, message: 'A time specification may only contain digits, letters, colons, commas, asterisks, dashes and pipes.' };
  }
  const parts = spec.split(',');
  if (parts.length !== 4) {
    return {
      ok: false,
      message: `A time specification has four parts — times,days-of-week,days-of-month,months — and this has ${parts.length}. For example 09:00-17:00,mon-fri,*,*`,
    };
  }
  if (parts[0] !== '*' && !/^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(parts[0]!)) {
    return { ok: false, message: `"${parts[0]}" is not a time range. Use something like 09:00-17:00, or * for any time.` };
  }
  return { ok: true };
}

const DAY: Record<string, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const MONTH: Record<string, string> = {
  jan: 'Jan', feb: 'Feb', mar: 'Mar', apr: 'Apr', may: 'May', jun: 'Jun',
  jul: 'Jul', aug: 'Aug', sep: 'Sep', oct: 'Oct', nov: 'Nov', dec: 'Dec',
};

function words(part: string, names: Record<string, string>): string {
  return part
    .split('&')
    .map((p) => p.split('-').map((x) => names[x.toLowerCase()] ?? x).join('–'))
    .join(', ');
}

/** `Mon–Fri 18:00–08:30`, `Any time`, `24–26 Dec`. A spec that does not check out is shown as written. */
export function describeTimeSpec(raw: string | null | undefined): string {
  const spec = (raw ?? '').trim();
  if (!spec || !checkTimeSpec(spec).ok) return spec;
  const [times, dow, dom, months] = spec.split(',') as [string, string, string, string];
  const out: string[] = [];
  if (dow !== '*') out.push(words(dow, DAY));
  if (dom !== '*' || months !== '*') out.push([dom !== '*' ? dom.replace('-', '–') : '', months !== '*' ? words(months, MONTH) : ''].filter(Boolean).join(' '));
  out.push(times === '*' ? (out.length ? 'all day' : 'Any time') : times.replace('-', '–'));
  return out.join(' ');
}

/** The spec the "out of hours" preset writes for a working-hours window. */
export function outOfHours(start: string, end: string, days = 'mon-fri'): string[] {
  // GotoIfTime matches a window, so "outside 08:30–18:00" is two windows plus the weekend.
  return [`${end}-23:59,${days},*,*`, `00:00-${start},${days},*,*`];
}
