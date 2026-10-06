import { apiGet, apiPut } from '../../../../core/api';
import { toE164 } from '../../../../core/phone';
import { WEBSITE } from '../api';

/**
 * The visitor widget's design (worksuite-desktop#199): what Website chats → Widget edits and previews.
 *
 * The server owns the rules (`WidgetDesign` in the Communication module) and refuses anything they forbid; the checks
 * here mirror them so a mistake is shown beside the field before Save, not after it. The preview's colours are worked
 * out exactly as the widget works them out, so what is previewed is what a visitor sees.
 *
 * #207 adds the theme the header and body share (`theme`, which the server keeps in `dark_mode`), the launcher's
 * offsets from the page's corner, and a company name that is never a web address: the header falls back to the
 * organisation's name (`fallback_name`), and an address typed into the name is refused, here and by the server.
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
  /**
   * S-02 (UX-SET-03, WGT-03, WGT-05): the widget's own name, the header's title, the welcome, the accent colour (the
   * send button), the panel's corner radius (0–32px) and auto-open (0–300 seconds, 0 is Never). A server from before
   * S-02 sends none of them; `withDefaults` fills them in, and the server ignores them when they are saved.
   */
  name: string;
  header_title: string | null;
  welcome_message: string | null;
  accent_color: string;
  border_radius: number;
  auto_open_delay: number;
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
  theme: Theme;
  /** The same setting under its name from before #207: read, never saved. */
  dark_mode?: Theme;
  /** Where the launcher sits, in pixels from the bottom and from the side it is on, 0–200 (#207). */
  launcher_offset_bottom: number;
  launcher_offset_right: number;
  launcher_offset_left: number;
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
  /** `domain`: the site, for "Widgets & embed › techubiz.com" (S-02). */
  widget: { id: number; name: string; widget_key: string; status: string; domain?: string | null };
  /** The widget's conversation starters, which the preview shows under the welcome (S-02). */
  starters?: string[];
  design: WidgetDesign;
  agents: DesignAgent[];
  preview_agents: PublicAgent[];
  away: 'maintenance' | 'hours' | 'no_agents' | null;
  hours: HoursSummary | null;
  reply_time: string | null;
  installed: boolean;
  can_manage: boolean;
  /** What the header says without a company name of its own: the organisation's name, or null (#207). */
  fallback_name?: string | null;
}

/**
 * A widget as the widgets list has it (S-01, UX-SET-01). Everything past `status` is optional: a server from before
 * S-01 does not send the card's counts, and the card then leaves them out.
 */
export interface WidgetRow {
  id: number;
  name: string;
  website_name: string | null;
  status: string;
  allowed_domains?: string | null;
  brand_color?: string;
  embed_code?: string;
  /** The chatbot's name: what an automated message posted as the assistant is signed with (S-07). */
  bot_name?: string | null;
  ai_enabled?: boolean;
  voice_enabled?: boolean;
  open_conversations?: number;
  open_now?: boolean;
  /** When a closed widget opens next: "08:30", "08:30 tomorrow", "08:30 Monday". */
  opens_at?: string | null;
  /** Visitors on the site now. */
  online?: number;
  staff?: number;
  starters?: number;
  /** Its active automated messages. */
  rules?: number;
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
export const OFFSET_MAX = 200;
export const RADIUS_MAX = 32;
export const AUTO_OPEN_MAX = 300;
/** The ready colours beside the hex field (S-02). */
export const BRAND_SWATCHES = ['#273498', '#1F7A6E', '#B4322B', '#111B3B'];
export const ACCENT_SWATCHES = ['#2F9E67', '#E8A33D'];
const HEX = /^#[0-9a-f]{6}$/i;

/** A launcher offset as the server keeps it: whole pixels, 0–200, 20 when there is nothing to go on. */
export const clampOffset = (v: number) => Math.max(0, Math.min(OFFSET_MAX, Math.round(Number.isFinite(v) ? v : 20)));

/**
 * The design as this screen edits it, from what the server sent: a server from before #207 sends the theme as
 * `dark_mode` only, and no offsets.
 */
export function withDefaults(d: WidgetDesign, widgetName = ''): WidgetDesign {
  return {
    ...d,
    // A server from before S-02 does not send the name: the widget's own, from the payload, stands in.
    name: d.name ?? widgetName,
    header_title: d.header_title ?? null,
    welcome_message: d.welcome_message ?? null,
    accent_color: d.accent_color ?? d.brand_color,
    border_radius: d.border_radius ?? 16,
    auto_open_delay: d.auto_open_delay ?? 0,
    theme: d.theme ?? d.dark_mode ?? 'auto',
    launcher_offset_bottom: d.launcher_offset_bottom ?? 20,
    launcher_offset_right: d.launcher_offset_right ?? 20,
    launcher_offset_left: d.launcher_offset_left ?? 20,
  };
}

/**
 * Is this a web address rather than a company's name? "https://tenderhub.lk/", "www.tenderhub.lk", "tenderhub.lk/x".
 * The widget's header shows the name; an address there was the "https://tenderhub.lk/" beside an "H" tile (#207).
 */
export const looksLikeAddress = (s: string | null | undefined) => {
  const v = (s ?? '').trim().toLowerCase();
  return /^[a-z][a-z0-9+.-]*:\/\//.test(v) || v.startsWith('www.') || /^[^\s/]+\.[a-z]{2,}(:\d+)?\//.test(v);
};

/** What the widget's header will call the company: the name set here unless it is an address, else the organisation's. */
export function siteNameOf(design: Pick<WidgetDesign, 'website_name'>, fallback: string | null | undefined): string | null {
  const own = (design.website_name ?? '').trim();
  return (own && !looksLikeAddress(own) ? own : (fallback ?? '').trim()) || null;
}
export const DEFAULT_TIMEZONE = 'Asia/Colombo';
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const widgetsList = (signal?: AbortSignal) => apiGet<{ widgets: WidgetRow[]; can?: Record<string, boolean> }>(`${WEBSITE}/widgets`, undefined, signal);
export const designOf = (id: number, signal?: AbortSignal) => apiGet<DesignPayload>(`${WEBSITE}/widgets/${id}/design`, undefined, signal);
export const hoursOf = (id: number, signal?: AbortSignal) => apiGet<HoursPayload>(`${WEBSITE}/widgets/${id}/hours`, undefined, signal);

/** Save the design: only the design's own fields (the widget's name among them since S-02) and the photos shown, never the widget's domains or status. */
export function saveDesign(id: number, design: WidgetDesign, shown: Record<number, boolean>): Promise<DesignPayload> {
  // `theme` is the setting; `dark_mode` is only its older name and is not sent back.
  const { dark_mode: _older, ...fields } = design;
  void _older;
  return apiPut<DesignPayload>(`${WEBSITE}/widgets/${id}/design`, {
    ...fields,
    // "0769 136 424" is kept as +94769136424 (#260): the widget's wa.me link needs the country code.
    whatsapp_number: design.whatsapp_number ? (toE164(design.whatsapp_number) ?? design.whatsapp_number.trim()) : null,
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
  if (!d.name.trim()) out.name = 'Name this widget';
  if (!HEX.test(d.accent_color)) out.accent_color = 'Use a six-digit hex colour, like #2F9E67';
  if (!Number.isInteger(d.border_radius) || d.border_radius < 0 || d.border_radius > RADIUS_MAX) out.border_radius = `A number of pixels, 0 to ${RADIUS_MAX}`;
  if (!Number.isInteger(d.auto_open_delay) || d.auto_open_delay < 0 || d.auto_open_delay > AUTO_OPEN_MAX) out.auto_open_delay = `0 to ${AUTO_OPEN_MAX} seconds`;
  if (looksLikeAddress(d.website_name)) out.website_name = 'Enter the company\'s name, not its web address: the widget shows it in its header';
  if (!HEX.test(d.brand_color)) out.brand_color = 'Use a six-digit hex colour, like #2F3FB5';
  for (const k of ['launcher_offset_bottom', 'launcher_offset_right', 'launcher_offset_left'] as const) {
    if (!Number.isInteger(d[k]) || d[k] < 0 || d[k] > OFFSET_MAX) out[k] = `A number of pixels, 0 to ${OFFSET_MAX}`;
  }
  if (d.logo_url && !/^https?:\/\/[^\s<>"']+$/i.test(d.logo_url)) out.logo_url = 'The logo must be a web address starting with https://';
  const links = d.quick_links.filter((l) => l.label.trim() || l.url.trim());
  if (links.length > MAX_LINKS) out.quick_links = `Up to ${MAX_LINKS} quick links`;
  else if (links.some((l) => !l.label.trim() || !l.url.trim())) out.quick_links = 'Give every quick link a label and an address';
  else if (links.some((l) => !/^(https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+|tel:\+?[\d\s().-]+)$/i.test(l.url.trim()))) out.quick_links = 'Quick links must start with https://, mailto: or tel:';
  // Read as every number is (core/phone): a local "0769 136 424" is Sri Lanka's and is converted, not refused (#260).
  if (d.whatsapp_number?.trim() && !toE164(d.whatsapp_number)) out.whatsapp_number = 'Enter a valid number, like 077 123 4567 or +94 77 123 4567';
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
  /** The dark theme's header: the brand, darker, with white on it at 5.5:1 or better (#207). */
  darkHeader: string;
}

export function palette(brand: string): Palette {
  const a = rgb(brand) ?? rgb('#2F3FB5')!;
  const white: Rgb = [255, 255, 255];
  const lightBrand = contrast(white, a) < 4.5;
  const night: Rgb = [14, 16, 38];
  let hd = mix(a, night, 0.35);
  for (let i = 0; i < 20 && contrast(white, hd) < 5.5; i++) hd = mix(hd, night, 0.1);
  return { accent: hex(a), onAccent: lightBrand ? '#121633' : '#ffffff', accentText: hex(readable(a, white, [0, 0, 0])), accentSoft: hex(mix(a, white, 0.9)), lightBrand, darkHeader: hex(hd) };
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
