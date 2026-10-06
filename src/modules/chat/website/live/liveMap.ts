import { parseTs } from '../../../../core/time';
import { findCountry } from './countries';
import { COUNTRY_BOXES } from './countryBoxes';

/**
 * What the Live dashboard's map and "On the site now" are drawn from (worksuite-desktop C-00, ported from the web's
 * liveMapData.ts, WS-WCHAT MAP-UI-01…03): each visitor's state, the places they are in, and where on the map a place
 * sits.
 *
 * A PLACE IS AS PRECISE AS ITS SOURCE. A visitor a CDN (or the server's GeoIP database) located has a position, rounded
 * by the server to about 10 km, and becomes a city marker. A visitor placed only by their browser's timezone has a
 * country and nothing finer: they are a dashed ring on the country, marked ≈, and never a marker on a city.
 */

/** A visitor's chat as GET /visitors reads it (WidgetAdminController::visitors, `chat`). */
export interface LiveChat {
  awaiting: boolean;
  waiting_since: string | null;
  at_risk: boolean;
  agent: string | null;
  /** A colleague typing in it now. */
  agent_typing?: boolean;
  /** A voice call on in it (ENH-WCHAT-05). */
  call?: { status: 'ringing' | 'active' | 'on_hold'; since: string | null } | null;
  /** Assigned to me: "· You" on the dashboard, and the tray's and the Live map window's "Yours" (MAP-22); absent on an older server. */
  mine?: boolean;
  /** Since when a visitor message has reached no staff device (WS-WCHAT DLV-09); null or absent when it has. */
  not_reaching_staff?: string | null;
}

/** Somebody on the sites now, as GET /visitors sends them. */
export interface OnlineVisitor {
  id: number;
  label: string;
  name: string | null;
  email: string | null;
  widget_id: number;
  website_name: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
  country: string | null;
  city: string | null;
  /** The region within the country, where the CDN said. */
  region?: string | null;
  /** How the location was worked out: `header` (a CDN), `geoip`, or `timezone` (a guess from the browser's clock). */
  geo_source?: string | null;
  /** A CDN's position, rounded to about 10 km; none when only the timezone placed them. */
  lat?: number | null;
  lng?: number | null;
  current_url: string | null;
  current_title: string | null;
  landing_page?: string | null;
  referrer: string | null;
  /** The referrer's host, for "from google.com". */
  referrer_host?: string | null;
  utm_campaign: string | null;
  pages: number;
  visits: number;
  on_site_seconds: number;
  idle_seconds: number;
  conversation_id: number | null;
  conversation_status: string | null;
  /** The visitor's chat as the dashboard reads it: waiting on us, and who has it. */
  chat?: LiveChat | null;
  /** Reading now (C-07, UX-VIS-02): seconds on this page, how far down it (0–100), the section in view when reported. */
  page_seconds?: number | null;
  scroll?: number | null;
  section?: string | null;
  /** When their previous visit ended ("Last: 2 Oct"); none on a first visit. */
  previous_visit_at?: string | null;
  /** The address, for those who manage widgets. */
  ip?: string | null;
}

/** GET /dashboard (WidgetAdminController::dashboard); the newer fields are optional for an older server. */
export interface Dashboard {
  now: {
    visitors_online: number;
    open: number;
    pending: number;
    waiting_on_us: number;
    at_risk: number;
    window_seconds: number;
    /** Arrived in the last ten minutes and still here: "+3 in 10 min". */
    arrived_10m?: number;
    /** When the visitor waiting longest last spoke: "longest 3:12". */
    longest_wait_since?: string | null;
    /** When a waiting chat becomes at risk, in seconds: "past 3:00"; null without escalation. */
    at_risk_after?: number | null;
    /** Staff with a chat open now: "3 staff". */
    staff_in_chats?: number;
    on_call?: { count: number; since: string | null };
  };
  today: { visitors: number; returning: number; conversations: number; missed: number; missed_last_hour?: number; page_views: number; first_response_median: number | null };
  activity?: Array<{
    id: number; kind: string; visitor_id: number | null; who: string; site: string | null; title: string | null; url: string | null; country: string | null; city: string | null; at: string;
    /** A page view that opened a visit: "Arrived from google.com · Mumbai" on the wall (MAP-16). */
    arrived?: boolean;
    /** Where an arrival came from, the host only. */
    referrer_host?: string | null;
    /** Placed by timezone only: "Arrived · Sri Lanka ≈". */
    approx?: boolean;
  }>;
  summary: {
    pages: Array<{ url?: string; title?: string; name?: string; count: number }>;
    countries: Array<{ name: string | null; count: number }>;
    devices: Array<{ name: string | null; count: number }>;
    referrers: Array<{ name: string; count: number }>;
    /** Today on the map: visitors by country and city, with a position where one was known. */
    places?: TodayPlace[];
  };
  widgets: Array<{ id: number; name: string; online: number; status?: string; open_now?: boolean }>;
  /** The organisation's own country, from the server's timezone: the map's home preset (MAP-08). */
  home_country?: string | null;
  /** The server's clock when it answered, so waits are counted on its clock rather than this machine's. */
  server_time?: string;
}

export type VisitorState = 'at_risk' | 'waiting' | 'on_call' | 'chatting' | 'browsing';

/** Worst first: a place's ring starts with whoever there needs us most, and an at-risk place is drawn on top. */
export const STATES: VisitorState[] = ['at_risk', 'waiting', 'on_call', 'chatting', 'browsing'];

/** The design's colours (C-00), not the web's: the legend, the rings and the rows' status rings. */
export const STATE: Record<VisitorState, { label: string; colour: string }> = {
  browsing: { label: 'Browsing', colour: '#7c8fe8' },
  chatting: { label: 'Chatting', colour: '#273498' },
  waiting: { label: 'Waiting on us', colour: '#d9922e' },
  at_risk: { label: 'At risk', colour: '#c2392d' },
  on_call: { label: 'On a call', colour: '#2f9e67' },
};

/** The legend's order, as the design lists it. */
export const LEGEND: VisitorState[] = ['browsing', 'chatting', 'waiting', 'at_risk', 'on_call'];

export const onCall = (c: LiveChat | null | undefined): boolean => !!c?.call && (c.call.status === 'active' || c.call.status === 'on_hold');

export function stateOf(v: Pick<OnlineVisitor, 'chat'>): VisitorState {
  const c = v.chat;
  if (!c) return 'browsing';
  if (c.at_risk) return 'at_risk';
  if (c.awaiting) return 'waiting';
  if (onCall(c)) return 'on_call';
  return 'chatting';
}

/** The three groups of "On the site now", in the order they are acted on. */
export type Group = 'needs' | 'chat' | 'browsing';

export function groupOf(s: VisitorState): Group {
  return s === 'at_risk' || s === 'waiting' ? 'needs' : s === 'browsing' ? 'browsing' : 'chat';
}

/* ---------------------------------------------------------------- the projection */

/** The same equirectangular 1000×500 projection the world map was generated in. */
export const px = (lng: number) => ((lng + 180) / 360) * 1000;
export const py = (lat: number) => ((90 - lat) / 180) * 500;

export interface Box { x: number; y: number; w: number; h: number }

/** The inhabited world: Antarctica and the far north cut, as the design frames it. */
export const WORLD_BOX: Box = { x: 0, y: 15, w: 1000, h: 400 };

let countryBoxes: Map<string, Box> | null = null;

/**
 * The bounding box of each country's largest piece, so Alaska does not drag the United States' centre into the sea;
 * a city-state too small to have an outline at this scale is a point, which at this scale is what it is. The rule
 * countryBoxes.ts was generated by, from the outlines — kept here so a test can check the table still agrees.
 */
export function shapeBoxes(shapes: ReadonlyArray<{ code: string; d: string }>, points: ReadonlyArray<{ code: string; lat: number; lon: number }>): Map<string, Box> {
  const out = new Map<string, Box>();
  for (const s of shapes) {
    let best: Box | null = null;
    for (const piece of s.d.split('M').filter(Boolean)) {
      const nums = piece.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i + 1 < nums.length; i += 2) {
        const x = nums[i]!, y = nums[i + 1]!;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      if (!Number.isFinite(x0)) continue;
      const b = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      if (!best || b.w * b.h > best.w * best.h) best = b;
    }
    if (best) out.set(s.code, best);
  }
  for (const p of points) {
    if (!out.has(p.code)) out.set(p.code, { x: px(p.lon) - 1, y: py(p.lat) - 1, w: 2, h: 2 });
  }
  return out;
}

/**
 * Every country's box, from the generated table rather than by parsing the world's 128 KB of outlines on the first
 * render — which the dashboard did before anything else could show (worksuite-desktop#248).
 */
function boxes(): Map<string, Box> {
  if (countryBoxes) return countryBoxes;
  countryBoxes = new Map(Object.entries(COUNTRY_BOXES).map(([code, [x, y, w, h]]) => [code, { x, y, w, h }]));
  return countryBoxes;
}

/** A country's box on the map, by name or code; null when it is not drawn. */
export function countryBox(country: string | null | undefined): Box | null {
  const code = country ? findCountry(country)?.code : null;
  return code ? (boxes().get(code) ?? null) : null;
}

/** Where a country-only ring goes: the middle of its largest piece. */
export function countryCentre(country: string | null | undefined): { x: number; y: number } | null {
  const b = countryBox(country);
  return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : null;
}

/* ---------------------------------------------------------------- regions and zoom */

/**
 * The map's middle zoom, named for where most visitors are. Boxes in degrees, checked in order, so the Gulf reads as
 * Asia rather than Africa and Turkey as Europe.
 */
const REGIONS: Array<{ name: string; lng: [number, number]; lat: [number, number]; within: (lng: number, lat: number) => boolean }> = [
  { name: 'Europe', lng: [-25, 45], lat: [34, 71], within: (lo, la) => lo >= -25 && lo <= 45 && la >= 36 && la <= 72 },
  { name: 'Africa', lng: [-20, 55], lat: [-36, 38], within: (lo, la) => lo >= -20 && lo <= 52 && la >= -36 && la <= 37 && !(lo >= 34 && la >= 12) },
  { name: 'Asia', lng: [25, 150], lat: [-11, 55], within: (lo, la) => lo >= 25 && lo <= 150 && la >= -11 && la <= 56 },
  { name: 'Oceania', lng: [110, 180], lat: [-48, 0], within: (lo, la) => lo >= 110 && la <= 0 },
  { name: 'South America', lng: [-85, -33], lat: [-56, 13], within: (lo, la) => lo >= -92 && lo <= -30 && la <= 13 },
  { name: 'North America', lng: [-170, -50], lat: [7, 72], within: (lo, la) => lo <= -50 && la > 7 },
];

const degBox = (lng: [number, number], lat: [number, number]): Box => ({ x: px(lng[0]), y: py(lat[1]), w: px(lng[1]) - px(lng[0]), h: py(lat[0]) - py(lat[1]) });

/** The region a country sits in, by the middle of its largest piece. */
export function regionOf(country: string | null | undefined): { name: string; box: Box } | null {
  const c = countryCentre(country);
  if (!c) return null;
  const lng = (c.x / 1000) * 360 - 180;
  const lat = 90 - (c.y / 500) * 180;
  const r = REGIONS.find((x) => x.within(lng, lat));
  return r ? { name: r.name, box: degBox(r.lng, r.lat) } : null;
}

/** A box grown by a share of itself, never smaller than a minimum, kept to the map's 2.5:1 shape. */
export function padded(b: Box, share = 0.25, min = 24): Box {
  let w = Math.max(b.w * (1 + share * 2), min);
  let h = Math.max(b.h * (1 + share * 2), min / 2.5);
  if (w / h > 2.5) h = w / 2.5;
  else w = h * 2.5;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Zoom in (factor < 1) or out about the box's centre, never past the whole world. */
export function zoomed(b: Box, factor: number): Box {
  const w = Math.min(WORLD_BOX.w, Math.max(8, b.w * factor));
  const h = w / 2.5;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** The box widened or heightened about its centre to the frame's shape, so the map fills the frame without bands. */
export function fitBox(b: Box, aspect: number): Box {
  if (!Number.isFinite(aspect) || aspect <= 0) return b;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const w = b.w / b.h < aspect ? b.h * aspect : b.w;
  const h = w / aspect;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export const sameBox = (a: Box, b: Box) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.w - b.w) < 0.5;

/**
 * The part of a region a country is in (MAP-08's "South Asia" between Asia and Sri Lanka), in degrees, checked in
 * order. Only where a region is too large to read a country in; elsewhere the presets go from region to country.
 */
const SUBREGIONS: Array<{ name: string; lng: [number, number]; lat: [number, number] }> = [
  { name: 'South Asia', lng: [60, 98], lat: [4, 38] },
  { name: 'South-East Asia', lng: [92, 142], lat: [-11, 24] },
  { name: 'East Asia', lng: [98, 146], lat: [18, 54] },
  { name: 'Middle East', lng: [25, 63], lat: [12, 43] },
  { name: 'Central Asia', lng: [46, 88], lat: [35, 56] },
];

/** The subregion a country sits in, by the middle of its largest piece. */
export function subregionOf(country: string | null | undefined): { name: string; box: Box } | null {
  const region = regionOf(country);
  const c = countryCentre(country);
  if (!c || region?.name !== 'Asia') return null;
  const lng = (c.x / 1000) * 360 - 180;
  const lat = 90 - (c.y / 500) * 180;
  const r = SUBREGIONS.find((x) => lng >= x.lng[0] && lng <= x.lng[1] && lat >= x.lat[0] && lat <= x.lat[1]);
  return r ? { name: r.name, box: degBox(r.lng, r.lat) } : null;
}

/** A preset's key in the address: `world`, `asia`, `south-asia`, or a country's code, lower case (`lk`). */
export const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export interface Preset { key: string; label: string; box: Box }

/**
 * The map's ready zooms (MAP-08): the world, the region and — on the full map — the part of it the home country is in,
 * then the home country (the organisation's, else wherever most visitors are).
 */
export function presetsFor(home: string | null | undefined, sub = false): Preset[] {
  const out: Preset[] = [{ key: 'world', label: 'World', box: WORLD_BOX }];
  const country = home ? findCountry(home) : null;
  const region = home ? regionOf(home) : null;
  if (region) out.push({ key: slug(region.name), label: region.name, box: padded(region.box, 0.02) });
  const part = sub && home ? subregionOf(home) : null;
  if (part) out.push({ key: slug(part.name), label: part.name, box: padded(part.box, 0.02) });
  const box = home ? countryBox(home) : null;
  if (country && box) out.push({ key: country.code.toLowerCase(), label: country.name, box: padded(box, 0.3) });
  return out;
}

/**
 * The view as the address keeps it (MAP-15, `map=lk`): a preset's key when the view is one, else its centre and zoom
 * (`79.9,7.6,24` — longitude, latitude, and how many times closer than the world).
 */
export function mapParam(b: Box, presets: Preset[]): string {
  const p = presets.find((x) => sameBox(x.box, b));
  if (p) return p.key;
  const lng = ((b.x + b.w / 2) / 1000) * 360 - 180;
  const lat = 90 - ((b.y + b.h / 2) / 500) * 180;
  return `${lng.toFixed(2)},${lat.toFixed(2)},${(WORLD_BOX.w / b.w).toFixed(2)}`;
}

/** The view an address names: a preset, any country's code, or a centre and zoom; the world when it names none. */
export function boxOfParam(v: string | null | undefined, presets: Preset[]): Box {
  if (!v) return WORLD_BOX;
  const p = presets.find((x) => x.key === v.toLowerCase());
  if (p) return p.box;
  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/.exec(v);
  if (m) {
    const w = Math.min(WORLD_BOX.w, Math.max(8, WORLD_BOX.w / Number(m[3])));
    const h = w / 2.5;
    return { x: px(Number(m[1])) - w / 2, y: py(Number(m[2])) - h / 2, w, h };
  }
  const box = countryBox(v);
  return box ? padded(box, 0.3) : WORLD_BOX;
}

/**
 * Zoomed about a point (a scroll or a pinch under the pointer): that point stays where it is on screen. Never closer
 * than 8 units across nor wider than the world.
 */
export function zoomAt(b: Box, factor: number, at: { x: number; y: number }): Box {
  const w = Math.min(WORLD_BOX.w, Math.max(8, b.w * factor));
  const k = w / b.w;
  const h = b.h * k;
  return { x: at.x - (at.x - b.x) * k, y: at.y - (at.y - b.y) * k, w, h };
}

/** Moved by so many map units, its centre kept on the map. */
export function panned(b: Box, dx: number, dy: number): Box {
  const cx = Math.min(1000, Math.max(0, b.x + b.w / 2 + dx));
  const cy = Math.min(500, Math.max(0, b.y + b.h / 2 + dy));
  return { ...b, x: cx - b.w / 2, y: cy - b.h / 2 };
}

/**
 * Who is off the edge of the view, by country, busiest first, with an arrow from the view's centre towards them
 * (MAP-08's edge chip, "↖ India · 3 outside this view").
 */
export function outsideOf(places: Place[], b: Box): Array<{ country: string; count: number; arrow: string }> {
  const by = new Map<string, { n: number; x: number; y: number }>();
  for (const p of places) {
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) continue;
    const o = by.get(p.country) ?? { n: 0, x: 0, y: 0 };
    o.x = (o.x * o.n + p.x * p.count) / (o.n + p.count);
    o.y = (o.y * o.n + p.y * p.count) / (o.n + p.count);
    o.n += p.count;
    by.set(p.country, o);
  }
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const ARROWS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
  return [...by.entries()]
    .map(([country, o]) => {
      const a = Math.atan2(o.y - cy, o.x - cx);
      const i = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
      return { country, count: o.n, arrow: ARROWS[i]! };
    })
    .sort((a, c) => c.count - a.count);
}

/** Past this width (in map units, a region's zoom) the countries in view load their 1:10m outlines (MAP-09). */
export const DETAIL_BELOW = 160;

/** The countries whose largest piece is in a view: the ones worth a detailed outline. */
export function countriesIn(b: Box, limit = 16): string[] {
  const out: string[] = [];
  for (const [code, c] of boxes()) {
    if (c.x < b.x + b.w && c.x + c.w > b.x && c.y < b.y + b.h && c.y + c.h > b.y) out.push(code);
  }
  // A view of a small country takes its neighbours too; a wide one keeps to the largest few.
  return out.sort((a, z) => area(boxes().get(z)!) - area(boxes().get(a)!)).slice(0, limit);
}

const area = (b: Box) => b.w * b.h;

/* ---------------------------------------------------------------- places */

export interface Place {
  key: string;
  country: string;
  city: string | null;
  region: string | null;
  /** Placed by timezone only: the country, shown with ≈. */
  approx: boolean;
  x: number;
  y: number;
  count: number;
  /** Chats started there today, where the server says (the Today figures). */
  chats?: number;
  /** Whoever there needs us most. */
  state: VisitorState;
  /** How many there are in each state, for the marker's ring (C-00: one arc per state). */
  states: Partial<Record<VisitorState, number>>;
  visitors: OnlineVisitor[];
}

const exactOf = (lat: number | null | undefined, lng: number | null | undefined) => typeof lat === 'number' && typeof lng === 'number';

/** Everybody on the site now, gathered by place: a city where a CDN placed them, else their country (≈). */
export function placesNow(visitors: OnlineVisitor[]): Place[] {
  const by = new Map<string, Place>();
  for (const v of visitors) {
    if (!v.country) continue;
    const exact = exactOf(v.lat, v.lng);
    const at = exact ? { x: px(v.lng!), y: py(v.lat!) } : countryCentre(v.country);
    if (!at) continue;
    const key = exact ? `${v.country}|${v.city ?? ''}|${v.lat}|${v.lng}` : `${v.country}|≈`;
    const s = stateOf(v);
    const p = by.get(key);
    if (p) {
      p.count += 1;
      p.visitors.push(v);
      p.states[s] = (p.states[s] ?? 0) + 1;
      if (STATES.indexOf(s) < STATES.indexOf(p.state)) p.state = s;
    } else {
      by.set(key, { key, country: v.country, city: exact ? v.city : null, region: exact ? (v.region ?? null) : null, approx: !exact, x: at.x, y: at.y, count: 1, state: s, states: { [s]: 1 }, visitors: [v] });
    }
  }
  return [...by.values()].sort((a, b) => b.count - a.count);
}

export interface TodayPlace {
  country: string; city: string | null; lat: number | null; lng: number | null; count: number;
  /** Chats started there today: the selected place's "Today: 14 visitors · 3 chats" (MAP-UI-02). */
  chats?: number;
}

/** Today's visitors by place, from the dashboard: one browsing ring, sized by how many. */
export function placesToday(rows: TodayPlace[]): Place[] {
  const by = new Map<string, Place>();
  for (const r of rows) {
    const exact = exactOf(r.lat, r.lng);
    const at = exact ? { x: px(r.lng!), y: py(r.lat!) } : countryCentre(r.country);
    if (!at) continue;
    const key = exact ? `${r.country}|${r.city ?? ''}|${r.lat}|${r.lng}` : `${r.country}|≈`;
    const p = by.get(key);
    if (p) {
      p.count += r.count;
      p.states.browsing = p.count;
      if (r.chats !== undefined) p.chats = (p.chats ?? 0) + r.chats;
    } else {
      by.set(key, { key, country: r.country, city: exact ? r.city : null, region: null, approx: !exact, x: at.x, y: at.y, count: r.count, chats: r.chats, state: 'browsing', states: { browsing: r.count }, visitors: [] });
    }
  }
  return [...by.values()].sort((a, b) => b.count - a.count);
}

/** A cluster's key: its places' keys, so a selection can be found again when the next answer lands. */
export const CLUSTER = '||';

/**
 * Places drawn as one marker, because at this zoom their markers would sit on top of each other (C-00 shows Kandy,
 * Colombo and Galle as one "Sri Lanka 9" at world scale): the counts and states added up, the worst state kept, at the
 * busiest place's position, named for the busiest place's country.
 */
export function mergePlaces(ps: Place[]): Place {
  const [first] = ps;
  if (!first) throw new Error('mergePlaces needs a place');
  if (ps.length === 1) return first;
  const states: Partial<Record<VisitorState, number>> = {};
  for (const p of ps) for (const s of STATES) if (p.states[s]) states[s] = (states[s] ?? 0) + p.states[s]!;
  return {
    ...first,
    key: ps.map((p) => p.key).join(CLUSTER),
    city: null,
    region: null,
    count: ps.reduce((n, p) => n + p.count, 0),
    chats: ps.some((p) => p.chats !== undefined) ? ps.reduce((n, p) => n + (p.chats ?? 0), 0) : undefined,
    state: STATES.find((s) => states[s]) ?? first.state,
    states,
    visitors: ps.flatMap((p) => p.visitors),
  };
}

/** Gather city places whose markers would overlap at `reach(a, b)` map units apart; country-only rings stay apart. */
export function clusterPlaces(places: Place[], reach: (a: Place, b: Place) => number): Place[] {
  const groups: Place[][] = [];
  for (const p of [...places].sort((a, b) => b.count - a.count)) {
    const near = p.approx ? undefined : groups.find((g) => !g[0]!.approx && Math.hypot(g[0]!.x - p.x, g[0]!.y - p.y) < reach(g[0]!, p));
    if (near) near.push(p);
    else groups.push([p]);
  }
  return groups.map(mergePlaces);
}

/** Visitors per country, for shading the map and the rows under it. */
export function byCountry(places: Place[]): Array<{ name: string; count: number }> {
  const m = new Map<string, number>();
  for (const p of places) m.set(p.country, (m.get(p.country) ?? 0) + p.count);
  return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

/* ---------------------------------------------------------------- words and clocks */

/** "Visitor 4F2A" → "4F", "Kasun Perera" → "KP", "Anne" → "AN". */
export function initialsOf(v: Pick<OnlineVisitor, 'name' | 'label'>): string {
  const n = (v.name ?? '').trim();
  const words = n.split(/\s+/).filter(Boolean);
  // One word ("Anne") gives its first two letters, as the design's "AN".
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  if (words.length) return words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
  const tag = /([0-9A-F]{4})$/i.exec(v.label ?? '');
  return tag?.[1] ? tag[1].slice(0, 2).toUpperCase() : (v.label ?? '?').slice(0, 2).toUpperCase();
}

/** m:ss, or h:mm:ss past an hour. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** mm:ss, as a call's length reads in the design ("On a call 02:14"). */
export function callClock(seconds: number): string {
  const c = clock(seconds);
  return /^\d:/.test(c) ? `0${c}` : c;
}

/**
 * Seconds since a server stamp, on the server's clock: `skew` is how far the server's clock is ahead of this one (from
 * the dashboard's `server_time`), so a wrong clock here, or a server writing local time, never makes a wait read wrong.
 */
export function since(at: string | null | undefined, now: number, skew = 0): number | null {
  return at ? Math.max(0, (now + skew - parseTs(at).getTime()) / 1000) : null;
}

/** The path of a page, without the site. */
export function pathOf(url: string | null | undefined): string {
  if (!url) return '/';
  try {
    return new URL(url).pathname || '/';
  } catch {
    return url;
  }
}

/** "1st", "2nd", "3rd", "4th"… */
export function ordinal(n: number): string {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? 'th' : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th');
  return `${n}${suffix}`;
}

/** Where a visitor is, in words: the city, or the country marked ≈ when only the timezone placed them. */
export function whereOf(v: Pick<OnlineVisitor, 'city' | 'country' | 'lat' | 'lng'>): string {
  if (v.city) return v.city;
  if (v.country) return exactOf(v.lat, v.lng) ? v.country : `${v.country} ≈`;
  return 'Somewhere';
}

/**
 * What a country's people are called, for the full map's "8 of 9 Sri Lankan visitors have a city" (MAP-UI-02). Only the
 * countries a support desk most often sees: elsewhere the sentence says "visitors in Peru" instead of guessing.
 */
const DEMONYMS: Record<string, string> = {
  AE: 'Emirati', AF: 'Afghan', AR: 'Argentine', AT: 'Austrian', AU: 'Australian', BD: 'Bangladeshi', BE: 'Belgian', BH: 'Bahraini',
  BR: 'Brazilian', BT: 'Bhutanese', CA: 'Canadian', CH: 'Swiss', CL: 'Chilean', CN: 'Chinese', CO: 'Colombian', CZ: 'Czech',
  DE: 'German', DK: 'Danish', EG: 'Egyptian', ES: 'Spanish', FI: 'Finnish', FR: 'French', GB: 'British', GH: 'Ghanaian',
  GR: 'Greek', HK: 'Hong Kong', HU: 'Hungarian', ID: 'Indonesian', IE: 'Irish', IL: 'Israeli', IN: 'Indian', IQ: 'Iraqi',
  IR: 'Iranian', IT: 'Italian', JO: 'Jordanian', JP: 'Japanese', KE: 'Kenyan', KR: 'South Korean', KW: 'Kuwaiti', LB: 'Lebanese',
  LK: 'Sri Lankan', MM: 'Myanmar', MV: 'Maldivian', MX: 'Mexican', MY: 'Malaysian', NG: 'Nigerian', NL: 'Dutch', NO: 'Norwegian',
  NP: 'Nepali', NZ: 'New Zealand', OM: 'Omani', PH: 'Filipino', PK: 'Pakistani', PL: 'Polish', PT: 'Portuguese', QA: 'Qatari',
  RO: 'Romanian', RU: 'Russian', SA: 'Saudi', SE: 'Swedish', SG: 'Singaporean', TH: 'Thai', TR: 'Turkish', TW: 'Taiwanese',
  UA: 'Ukrainian', US: 'American', VN: 'Vietnamese', ZA: 'South African',
};

export const demonymOf = (country: string | null | undefined): string | null => {
  const code = country ? findCountry(country)?.code : null;
  return code ? (DEMONYMS[code] ?? null) : null;
};
