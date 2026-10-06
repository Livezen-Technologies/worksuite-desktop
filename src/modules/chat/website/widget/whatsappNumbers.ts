import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { apiGet, apiPost, apiPut } from '../../../../core/api';
import { currentLocale, text } from '../../../../core/i18n';
import { DEFAULT_REGION, formatPhone, toE164, waDigits } from '../../../../core/phone';
import { confirmedWaPhone, isConnected, type WaAccount } from '../../channels/whatsapp';
import { WEBSITE } from '../api';
import { fieldErrorsOf } from './fieldErrors';

/**
 * Widget settings › Contact options › WhatsApp (worksuite-desktop#260): the numbers the widget offers as "Message us on
 * WhatsApp" — Sales, Support — each either a WorkSuite WhatsApp number (replies come into WorkSuite and are linked to
 * the visitor by their reference) or any number typed in, with its label, the message the visitor's WhatsApp opens
 * with, and when it shows. Saved as one list, in the order shown (`PUT widgets/{id}/whatsapp`). A server without the
 * list answers 404 and the tab says the server needs updating, rather than the numbers being dropped without a word.
 *
 * Numbers are kept in E.164 (`+94769136424`) and read as core/phone reads every number: "0769 136 424" in the country
 * picked (Sri Lanka unless another is), so a local number, or one with spaces, is converted rather than refused. Two
 * WorkSuite connections on the same number (the "hasa" / "Support" duplicate) are one choice in the picker, with both
 * names, connected when either is.
 */

/** When a number shows on the widget, as the server names it. */
export type WaShow = 'always' | 'connected' | 'outside_hours' | 'no_agents';
/** A WorkSuite WhatsApp number, or one typed in. */
export type WaSource = 'worksuite' | 'manual';

/** A number as the server keeps it. */
export interface WidgetWaNumber {
  id?: number | null;
  source: WaSource;
  /** The WorkSuite WhatsApp number it is (`/api/whatsapp/accounts`); null for one typed in. */
  account_id: number | null;
  /** E.164. */
  phone: string;
  label: string;
  /** What the visitor's WhatsApp opens with; `{visitor_ref}` becomes their reference. */
  message: string;
  show: WaShow;
  /** The server's word on a WorkSuite number's connection; the WhatsApp list's own wins where it can be read. */
  connected?: boolean | null;
}

/** A WorkSuite WhatsApp number, as the WhatsApp module lists it (#35, #155) or as the server sends it with the widget's. */
export type WaPickAccount = Pick<WaAccount, 'id' | 'name' | 'phone' | 'status'> & Partial<Pick<WaAccount, 'provider' | 'connected_at' | 'is_default'>>;

export interface WidgetWaPayload {
  numbers: WidgetWaNumber[];
  can_manage: boolean;
  /** How long the widget script may keep its settings before asking again: what "live within" says. */
  cache_seconds?: number | null;
  /** `POST widgets/{id}/refresh` is there: the widget asks for its settings afresh on its next page load. */
  can_refresh?: boolean;
  /** The company's WorkSuite numbers, for an admin they are not shared with; else the WhatsApp module's list is read. */
  accounts?: WaPickAccount[];
}

/** A number in the list being edited: `key` follows it through reordering. */
export type WaRow = WidgetWaNumber & { key: string };

export interface RowIssues {
  phone?: string;
  label?: string;
  message?: string;
  show?: string;
}

export const MAX_NUMBERS = 5;
export const LABEL_MAX = 40;
export const MESSAGE_MAX = 500;
/** What `{visitor_ref}` is when the admin tests a number: no visitor, so nothing is linked. */
export const TEST_REF = 'TEST';

export const SHOWS: Array<{ value: WaShow; label: string }> = [
  { value: 'always', label: 'Always' },
  { value: 'connected', label: 'Only when connected' },
  { value: 'outside_hours', label: 'Only outside business hours' },
  { value: 'no_agents', label: 'Only when no agents are available' },
];

export const showLabel = (s: WaShow) => text(SHOWS.find((x) => x.value === s)?.label ?? 'Always');

/** The message a new number opens WhatsApp with: the site, and the reference that links the visitor's chat. */
export const defaultMessage = (site: string) => `Hi, I'm on ${site} (ref {visitor_ref})`;

export const whatsappOf = (id: number, signal?: AbortSignal) => apiGet<WidgetWaPayload>(`${WEBSITE}/widgets/${id}/whatsapp`, undefined, signal);
export const saveWhatsapp = (id: number, rows: WidgetWaNumber[]) => apiPut<WidgetWaPayload>(`${WEBSITE}/widgets/${id}/whatsapp`, { numbers: wireNumbers(rows) });
/** Ends the widget's settings cache: its next page load asks again. */
export const refreshWidget = (id: number) => apiPost<{ refreshed_at?: string | null }>(`${WEBSITE}/widgets/${id}/refresh`);

// ---- reading and checking numbers -----------------------------------------------------------------

let countries: { locale: string; list: Array<{ value: CountryCode; label: string }> } | null = null;

/** Every country with its calling code, "Sri Lanka (+94)", by name in the app's language. */
export function countryChoices(): Array<{ value: CountryCode; label: string }> {
  const locale = currentLocale();
  if (countries?.locale === locale) return countries.list;
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([locale, 'en'], { type: 'region' });
  } catch {
    names = null;
  }
  const list = getCountries()
    .map((c) => ({ value: c, label: `${names?.of(c) ?? c} (+${getCountryCallingCode(c)})` }))
    .sort((a, b) => a.label.localeCompare(b.label));
  countries = { locale, list };
  return list;
}

/** The country a stored number belongs to, for editing it; Sri Lanka when it cannot be told. */
export function regionOf(phone: string | null | undefined): CountryCode {
  return (phone ? parsePhoneNumberFromString(phone)?.country : undefined) ?? DEFAULT_REGION;
}

/** A typed number in E.164, read in the country picked: "0769 136 424" in Sri Lanka is +94769136424. */
export const numberOf = (typed: string, region: CountryCode = DEFAULT_REGION) => toE164(typed, region);

/** Why a typed number cannot be used, or null. */
export function typedProblem(typed: string, region: CountryCode = DEFAULT_REGION): string | null {
  return numberOf(typed, region) ? null : text('Enter a valid number');
}

/** One choice in "Choose from WorkSuite WhatsApp": a number, every connection on it, and whether any is connected. */
export interface WaChoice {
  phone: string;
  names: string[];
  /** The connection the widget's number stands for: a connected one where there is one, as replies come in on it. */
  account_id: number;
  account_ids: number[];
  connected: boolean;
}

const e164Of = (a: WaPickAccount) => toE164(confirmedWaPhone(a as WaAccount));

/**
 * The WorkSuite numbers to choose from, once each (#260): two connections on the same number — "hasa" connected,
 * "Support" not — are one choice named "hasa, Support", connected. A connection with no number yet (a QR code never
 * scanned) cannot be offered; `unlistedNames` names them.
 */
export function pickerChoices(accounts: WaPickAccount[]): WaChoice[] {
  const by = new Map<string, WaChoice>();
  for (const a of accounts) {
    const phone = e164Of(a);
    if (!phone) continue;
    const on = isConnected(a);
    const c = by.get(phone);
    if (!c) {
      by.set(phone, { phone, names: [a.name], account_id: a.id, account_ids: [a.id], connected: on });
      continue;
    }
    if (!c.names.includes(a.name)) c.names.push(a.name);
    c.account_ids.push(a.id);
    if (on && !c.connected) c.account_id = a.id;
    c.connected = c.connected || on;
  }
  return [...by.values()];
}

/** The WorkSuite connections with no number yet, which the picker cannot offer. */
export const unlistedNames = (accounts: WaPickAccount[]) => accounts.filter((a) => !e164Of(a)).map((a) => a.name);

/** The WorkSuite connections a number in the list stands for: its own, and any other on the same number. */
export function accountsOf(n: Pick<WidgetWaNumber, 'source' | 'account_id' | 'phone'>, accounts: WaPickAccount[] | null): WaPickAccount[] {
  if (n.source !== 'worksuite' || !accounts) return [];
  const phone = toE164(n.phone);
  return accounts.filter((a) => a.id === n.account_id || (phone !== null && e164Of(a) === phone));
}

/**
 * Whether a WorkSuite number is connected now: the WhatsApp list's word where the number is in it, else the server's;
 * null for a number typed in, or when nobody can say.
 */
export function connectionOf(n: WidgetWaNumber, accounts: WaPickAccount[] | null): boolean | null {
  if (n.source !== 'worksuite') return null;
  const same = accountsOf(n, accounts);
  if (same.length) return same.some(isConnected);
  return typeof n.connected === 'boolean' ? n.connected : null;
}

/** What a disconnected WorkSuite number means for visitors, under its row; null when there is nothing to say. */
export function connectionNote(n: Pick<WidgetWaNumber, 'source' | 'show'>, connected: boolean | null): string | null {
  if (n.source !== 'worksuite' || connected !== false) return null;
  return n.show === 'connected'
    ? text("This number isn't connected; the widget will hide it until it's linked")
    : text("This number isn't connected, so replies won't come into WorkSuite until it's linked");
}

/** What is wrong with each number, by its key, before the server is asked. */
export function rowProblems(rows: WaRow[]): Record<string, RowIssues> {
  const out: Record<string, RowIssues> = {};
  const seen = new Set<string>();
  for (const r of rows) {
    const i: RowIssues = {};
    const phone = toE164(r.phone);
    if (!phone) i.phone = text('Enter a valid number');
    else if (seen.has(phone)) i.phone = text('This number is already on the list');
    else if (r.source === 'worksuite' && !r.account_id) i.phone = text('Choose a WorkSuite WhatsApp number');
    if (phone) seen.add(phone);
    if (!r.label.trim()) i.label = text('Give it a label, like Sales or Support');
    else if (r.label.trim().length > LABEL_MAX) i.label = text('Up to {n} characters', { n: LABEL_MAX });
    if (r.message.trim().length > MESSAGE_MAX) i.message = text('Up to {n} characters', { n: MESSAGE_MAX });
    if (r.show === 'connected' && r.source !== 'worksuite') i.show = text('Only a WorkSuite WhatsApp number can follow its connection');
    if (Object.keys(i).length) out[r.key] = i;
  }
  return out;
}

/** The list as the server takes it: in the order shown, numbers in E.164, a typed-in number with no account. */
export function wireNumbers(rows: WidgetWaNumber[]) {
  return rows.map((r) => ({
    ...(r.id ? { id: r.id } : {}),
    source: r.source,
    account_id: r.source === 'worksuite' ? r.account_id : null,
    phone: toE164(r.phone) ?? r.phone.trim(),
    label: r.label.trim(),
    message: r.message.trim(),
    show: r.show,
  }));
}

export const sameNumbers = (a: WidgetWaNumber[], b: WidgetWaNumber[]) => JSON.stringify(wireNumbers(a)) === JSON.stringify(wireNumbers(b));

let nextKey = 0;
export const newKey = () => `n${++nextKey}`;

/** The saved list, each with its key. */
export const rowsOf = (numbers: WidgetWaNumber[] | null | undefined): WaRow[] => (numbers ?? []).map((n) => ({ ...n, key: n.id ? `id${n.id}` : newKey() }));

/** The list with one number taken from where it is and put at `to` (another number's place, or an index). */
export function moveRow(rows: WaRow[], key: string, to: number | string): WaRow[] {
  const from = rows.findIndex((r) => r.key === key);
  const at = typeof to === 'number' ? to : rows.findIndex((r) => r.key === to);
  if (from < 0 || at < 0 || at >= rows.length || from === at) return rows;
  const out = [...rows];
  const [row] = out.splice(from, 1);
  out.splice(at, 0, row!);
  return out;
}

/** The `wa.me` link the widget opens, with the message; Test fills the reference with TEST. */
export function waLink(phone: string, message: string, ref = TEST_REF): string | null {
  const e164 = toE164(phone);
  if (!e164) return null;
  const body = message.trim().replaceAll('{visitor_ref}', ref);
  return `https://wa.me/${waDigits(e164)}${body ? `?text=${encodeURIComponent(body)}` : ''}`;
}

/** "Sales · +94 76 913 6424". */
export const rowName = (r: Pick<WidgetWaNumber, 'label' | 'phone'>) => [r.label.trim(), formatPhone(toE164(r.phone) ?? r.phone)].filter(Boolean).join(' · ');

/** When a saved change reaches the site: the widget's own cache, as the server says it, or its next page. */
export function savedText(site: string, cacheSeconds: number | null | undefined): string {
  if (typeof cacheSeconds !== 'number' || !Number.isFinite(cacheSeconds) || cacheSeconds < 0) return text("Saved · live on {site} on visitors' next page", { site });
  const minutes = Math.max(1, Math.ceil(cacheSeconds / 60));
  return minutes === 1 ? text('Saved · live on {site} within 1 minute', { site }) : text('Saved · live on {site} within {n} minutes', { site, n: minutes });
}

/**
 * The server's refusal, under the fields it is about: `numbers.1.phone` under the second number's, by key. Anything
 * else it says about the list as a whole.
 */
export function serverIssues(e: unknown, rows: WaRow[]): { rows: Record<string, RowIssues>; general: string | null } {
  const out: Record<string, RowIssues> = {};
  let general: string | null = null;
  for (const [k, v] of Object.entries(fieldErrorsOf(e))) {
    const m = /^numbers\.(\d+)\.(\w+)$/.exec(k);
    const row = m ? rows[Number(m[1])] : undefined;
    if (row) {
      const field = m![2] === 'label' || m![2] === 'message' || m![2] === 'show' ? m![2] : 'phone';
      out[row.key] = { ...out[row.key], [field]: v };
    } else if (k === 'numbers' || k.startsWith('numbers')) general = v;
  }
  return { rows: out, general };
}

/**
 * The labels the away screen's WhatsApp card shows in the preview: every number but one set to follow its connection
 * while it is down.
 */
export function awayLabels(rows: WaRow[], accounts: WaPickAccount[] | null): string[] {
  return rows.filter((r) => !(r.show === 'connected' && connectionOf(r, accounts) === false)).map((r) => r.label.trim() || formatPhone(toE164(r.phone) ?? r.phone));
}
