import { apiGet, apiPut } from '../../../../core/api';
import { WEBSITE } from '../api';

/**
 * The visitor widget's design (worksuite-desktop#199): what Website chats → Widget edits and previews.
 *
 * The server owns the rules (`WidgetDesign` in the Communication module) and refuses anything they forbid; the checks
 * here mirror them so a mistake is shown beside the field before Save, not after it. The preview's colours are worked
 * out exactly as the widget works them out, so what is previewed is what a visitor sees.
 */

export interface QuickLink {
  label: string;
  url: string;
}

export type StaffDisplay = 'name_role' | 'first_name';
export type LauncherStyle = 'pill' | 'bubble';
export type Position = 'bottom_right' | 'bottom_left';
export type Theme = 'auto' | 'light' | 'dark';

export interface WidgetDesign {
  website_name: string | null;
  brand_color: string;
  logo_url: string | null;
  greeting: string | null;
  header_subtitle: string | null;
  quick_links: QuickLink[];
  staff_display: StaffDisplay;
  show_agents: boolean;
  offline_message: string | null;
  whatsapp_number: string | null;
  launcher_style: LauncherStyle;
  position: Position;
  greeting_delay: number;
  greeting_text: string | null;
  dark_mode: Theme;
}

/** Somebody staffed on the widget, whether visitors see their photo, and whether they are here now. */
export interface DesignAgent {
  user_id: number;
  name: string;
  role: string | null;
  avatar: string | null;
  shown: boolean;
  active: boolean;
  presence: 'online' | 'away' | 'busy' | 'dnd' | 'offline';
}

/** What the widget's public endpoints send for a face: nothing more than this. */
export interface PublicAgent {
  name: string;
  role: string | null;
  status: string;
  presence: string;
  online: boolean;
  avatar: string | null;
}

export interface HoursSummary {
  timezone: string;
  zone: string;
  text: string;
  open_now: boolean;
  back_at: string | null;
}

export interface DesignPayload {
  widget: { id: number; name: string; widget_key: string; status: string };
  design: WidgetDesign;
  agents: DesignAgent[];
  preview_agents: PublicAgent[];
  away: 'maintenance' | 'hours' | 'no_agents' | null;
  hours: HoursSummary | null;
  reply_time: string | null;
  installed: boolean;
  can_manage: boolean;
}

export interface WidgetRow {
  id: number;
  name: string;
  website_name: string | null;
  status: string;
}

export interface HoursDay {
  weekday: number;
  is_open: boolean;
  opens_at: string;
  closes_at: string;
}

export interface HoursPayload {
  hours: Array<{ weekday: number; is_open: boolean; opens_at: string | null; closes_at: string | null; timezone: string }>;
  default_timezone?: string;
  summary?: HoursSummary | null;
}

export const MAX_LINKS = 5;
export const DEFAULT_TIMEZONE = 'Asia/Colombo';
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const widgetsList = (signal?: AbortSignal) => apiGet<{ widgets: WidgetRow[]; can?: Record<string, boolean> }>(`${WEBSITE}/widgets`, undefined, signal);
export const designOf = (id: number, signal?: AbortSignal) => apiGet<DesignPayload>(`${WEBSITE}/widgets/${id}/design`, undefined, signal);
export const hoursOf = (id: number, signal?: AbortSignal) => apiGet<HoursPayload>(`${WEBSITE}/widgets/${id}/hours`, undefined, signal);

/** Save the design: only the design's own fields and the photos shown, never the widget's domains or its name. */
export function saveDesign(id: number, design: WidgetDesign, shown: Record<number, boolean>): Promise<DesignPayload> {
  return apiPut<DesignPayload>(`${WEBSITE}/widgets/${id}/design`, {
    ...design,
    quick_links: design.quick_links.filter((l) => l.label.trim() || l.url.trim()),
    agents: Object.entries(shown).map(([user_id, on]) => ({ user_id: Number(user_id), shown: on })),
  });
}

export function saveHours(id: number, days: HoursDay[], timezone: string): Promise<unknown> {
  return apiPut(`${WEBSITE}/widgets/${id}/hours`, { timezone, days });
}

/** The week as the editor holds it: every day, with the stored times or 9 to 5. */
export function weekOf(p: HoursPayload | undefined): { days: HoursDay[]; timezone: string; configured: boolean } {
  const rows = p?.hours ?? [];
  const by = new Map(rows.map((r) => [r.weekday, r]));
  // Every day open from midnight to midnight is how hours are switched off (see the Widget screen's save).
  const roundTheClock = rows.length === 7 && rows.every((r) => r.is_open && (r.opens_at ?? '').startsWith('00:00') && (r.closes_at ?? '').startsWith('23:59'));
  return {
    configured: rows.length > 0 && !roundTheClock,
    timezone: rows[0]?.timezone || p?.default_timezone || DEFAULT_TIMEZONE,
    days: [0, 1, 2, 3, 4, 5, 6].map((d) => {
      const r = roundTheClock ? undefined : by.get(d);
      return { weekday: d, is_open: r ? r.is_open : d >= 1 && d <= 5, opens_at: (r?.opens_at ?? '09:00').slice(0, 5), closes_at: (r?.closes_at ?? '17:00').slice(0, 5) };
    }),
  };
}

const hm = (t: string): string => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return t;
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
};

/** "Mon–Fri, 9:00 AM–5:00 PM · Sat, 9:00 AM–1:00 PM" — the server's own wording (WidgetHours::text), for the preview. */
export function hoursText(days: HoursDay[]): string {
  const by = new Map(days.filter((d) => d.is_open).map((d) => [d.weekday, `${hm(d.opens_at)}–${hm(d.closes_at)}`]));
  const runs: Array<{ from: number; to: number; hours: string } | null> = [];
  for (const d of [1, 2, 3, 4, 5, 6, 0]) {
    const h = by.get(d);
    if (!h) {
      runs.push(null);
      continue;
    }
    const last = runs.length ? runs[runs.length - 1] : null;
    if (last && last.hours === h) last.to = d;
    else runs.push({ from: d, to: d, hours: h });
  }
  const parts = runs.filter((r): r is { from: number; to: number; hours: string } => r !== null).map((r) => `${r.from === r.to ? SHORT[r.from] : `${SHORT[r.from]}–${SHORT[r.to]}`}, ${r.hours}`);
  return parts.length ? parts.join(' · ') : 'Closed all week';
}

/** What is wrong with the design, field by field, before the server is asked. */
export function problems(d: WidgetDesign): Partial<Record<keyof WidgetDesign | 'quick_links', string>> {
  const out: Partial<Record<keyof WidgetDesign | 'quick_links', string>> = {};
  if (!/^#[0-9a-f]{6}$/i.test(d.brand_color)) out.brand_color = 'Use a six-digit hex colour, like #2F3FB5';
  if (d.logo_url && !/^https?:\/\/[^\s<>"']+$/i.test(d.logo_url)) out.logo_url = 'The logo must be a web address starting with https://';
  const links = d.quick_links.filter((l) => l.label.trim() || l.url.trim());
  if (links.length > MAX_LINKS) out.quick_links = `Up to ${MAX_LINKS} quick links`;
  else if (links.some((l) => !l.label.trim() || !l.url.trim())) out.quick_links = 'Give every quick link a label and an address';
  else if (links.some((l) => !/^(https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+|tel:\+?[\d\s().-]+)$/i.test(l.url.trim()))) out.quick_links = 'Quick links must start with https://, mailto: or tel:';
  if (d.whatsapp_number) {
    const digits = d.whatsapp_number.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15 || !/^\+?[\d\s().-]+$/.test(d.whatsapp_number.trim())) out.whatsapp_number = 'Enter the number with its country code, like +94 77 123 4567';
  }
  return out;
}

// ---- colour, exactly as the widget works it out -------------------------------------------------

type Rgb = [number, number, number];
const rgb = (h: string): Rgb | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h);
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const hex = (c: Rgb) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const lum = (c: Rgb) => {
  const a = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * a[0]! + 0.7152 * a[1]! + 0.0722 * a[2]!;
};
export const contrast = (x: Rgb, y: Rgb) => {
  const a = lum(x);
  const b = lum(y);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
const mix = (c: Rgb, to: Rgb, t: number): Rgb => [c[0] + (to[0] - c[0]) * t, c[1] + (to[1] - c[1]) * t, c[2] + (to[2] - c[2]) * t];
const readable = (c: Rgb, bg: Rgb, to: Rgb): Rgb => {
  for (let i = 0; i <= 20 && contrast(c, bg) < 4.5; i++) c = mix(c, to, 0.08);
  return c;
};

export interface Palette {
  /** The brand colour. */
  accent: string;
  /** Text on it: white where white reads at 4.5:1, ink where it does not. */
  onAccent: string;
  /** The brand colour as text on a white card, darkened until it reads. */
  accentText: string;
  /** A pale wash of it, for chips and icon tiles. */
  accentSoft: string;
  /** Whether white text would have failed WCAG AA on this brand colour. */
  lightBrand: boolean;
}

export function palette(brand: string): Palette {
  const a = rgb(brand) ?? rgb('#2F3FB5')!;
  const white: Rgb = [255, 255, 255];
  const lightBrand = contrast(white, a) < 4.5;
  return { accent: hex(a), onAccent: lightBrand ? '#121633' : '#ffffff', accentText: hex(readable(a, white, [0, 0, 0])), accentSoft: hex(mix(a, white, 0.9)), lightBrand };
}

// ---- who the preview shows -----------------------------------------------------------------------

export interface PreviewPerson {
  name: string;
  role: string | null;
  avatar: string | null;
  online: boolean;
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';
export const shownName = (name: string, display: StaffDisplay) => (display === 'first_name' ? firstName(name) : name.trim());

export function initialsOf(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? '?') + (p.length > 1 ? (p[p.length - 1]?.[0] ?? '') : '')).toUpperCase();
}

/** Stand-ins for a widget with nobody staffed yet, so the preview is never an empty header. */
const SAMPLE: PreviewPerson[] = [
  { name: 'Alex Morgan', role: 'Support', avatar: null, online: true },
  { name: 'Priya Shah', role: 'Sales', avatar: null, online: true },
  { name: 'Sam Lee', role: 'Customer success', avatar: null, online: true },
];

/**
 * The faces the preview draws: the staffed people whose photos are shown, as the display setting names them, the ones
 * here now first — or, with nobody staffed, the people on duty as visitors see them now, or stand-ins.
 */
export function previewPeople(p: Pick<DesignPayload, 'agents' | 'preview_agents'> | undefined, design: WidgetDesign, shown: Record<number, boolean>): { people: PreviewPerson[]; sample: boolean } {
  if (!design.show_agents) return { people: [], sample: false };
  const staffed = (p?.agents ?? []).filter((a) => a.active && (shown[a.user_id] ?? a.shown));
  const base: PreviewPerson[] = staffed.length
    ? staffed.map((a) => ({ name: a.name, role: a.role, avatar: a.avatar, online: a.presence === 'online' }))
    : (p?.preview_agents ?? []).map((a) => ({ name: a.name, role: a.role, avatar: a.avatar, online: a.online }));
  const sample = base.length === 0;
  const people = (sample ? SAMPLE : base).map((x) => ({ ...x, name: shownName(x.name, design.staff_display), role: design.staff_display === 'first_name' ? null : x.role }));
  // In the preview everybody counts as here, so the online screen can be seen even out of hours.
  return { people: [...people].sort((a, b) => Number(b.online) - Number(a.online)), sample };
}

/** "Samali", "Dimuthu and Samali", "Dimuthu, Samali and Hasarinda", "… and 2 more". */
export function namesLine(names: string[]): string {
  if (names.length <= 1) return names.join('');
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
}
