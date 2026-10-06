/**
 * WorkSuite item links (worksuite-desktop#170): one link per item, the same
 * in an email, a notification, a chat message or the browser.
 *
 *   web  https://app.worksuite.lk/o/{org}/{type}/{id}?action=…
 *   app  worksuite://{org}/{type}/{id}?action=…
 *
 * The web form is what every notification email carries: with the desktop
 * app installed it opens there (Universal Links on macOS, the server's
 * fallback page elsewhere), and without it the page opens in the browser.
 *
 * Like the older worksuite:// grammar (deeplink.ts), a link is accepted only
 * if every part of it is on an allow-list — the organisation id, the item
 * type, the id's shape, the action, and each query parameter. Anything else is
 * refused before anything is looked up. Parsing never performs an action: an
 * action that changes data runs only after the person confirms it, and the
 * server checks permission again when it does.
 *
 * The server keeps the same rules (Modules/Desktop/Libraries/ItemLinks.php).
 */

export const MAX_ITEM_LINK_LENGTH = 1024;

/** WorkSuite's own web address. A self-hosted server's own address is added by the caller. */
export const WORKSUITE_WEB_HOSTS = ['app.worksuite.lk'] as const;

/** The sender WorkSuite's notification email comes from (verified SPF/DKIM/DMARC before it is trusted). */
export const WORKSUITE_SENDERS = ['no-reply@worksuite.lk'] as const;

export type ItemAction =
  | 'open'
  | 'download'
  | 'show'
  | 'request-access'
  | 'join'
  | 'details'
  | 'accept'
  | 'decline'
  | 'maybe'
  | 'done'
  | 'snooze'
  | 'review'
  | 'approve'
  | 'reject';

export type ItemSource = 'email' | 'chat' | 'notification' | 'external';

const ID_NUM = /^[1-9]\d{0,17}$/;
const ID_MEETING = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[1-9]\d{0,17})$/i;
const ORG = /^[1-9]\d{0,11}$/;
/** The alerts a link may point at, and where each one is dealt with. */
export const ALERT_ROUTES: Record<string, { app: string; route: string }> = {
  security: { app: 'settings', route: '/settings/security' },
  sync: { app: 'files', route: '/files?view=devices' },
  storage: { app: 'files', route: '/files?view=storage' },
  overdue: { app: 'tasks', route: '/tasks?scope=overdue' },
};

interface TypeRule {
  /** The desktop app the item opens in. */
  app: string;
  /** What one is called, in a sentence. */
  label: string;
  id: RegExp;
  actions: readonly ItemAction[];
  route: (l: ItemLink) => string;
}

const RECORD_ACTIONS = ['open', 'review', 'approve', 'reject'] as const;
const withQuery = (base: string, extra: Record<string, string | number | null | undefined>): string => {
  const q = Object.entries(extra).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!q.length) return base;
  return `${base}${base.includes('?') ? '&' : '?'}${q.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')}`;
};
/** A comment named by the link opens with the item's comment thread. */
const commented = (base: string, l: ItemLink) => withQuery(base, { comment: l.comment });
const reviewing = (base: string, l: ItemLink) => commented(l.action === 'review' || l.action === 'approve' || l.action === 'reject' ? withQuery(base, { review: 1 }) : base, l);

/**
 * Pages of a desktop app (worksuite-desktop#266): `/o/{org}/hr/announcements` is HR's Announcements, the same link
 * whoever shares it. The type is the app's own id and the id the page's name, which each app reads from its own
 * query parameter (`/hr?tab=announcements`, `/files?view=shared`). Only these apps, and only plain names, are
 * accepted; a page only ever opens.
 */
export const PAGE_APPS: Readonly<Record<string, 'tab' | 'view'>> = {
  hr: 'tab',
  crm: 'tab',
  tenders: 'tab',
  sales: 'tab',
  finance: 'tab',
  meetings: 'tab',
  billing: 'tab',
  inventory: 'tab',
  expenses: 'tab',
  files: 'view',
  tasks: 'view',
  notes: 'view',
  calendar: 'view',
  contacts: 'view',
  garage: 'view',
  pms: 'view',
  events: 'view',
  salon: 'view',
  restaurant: 'view',
  pos: 'view',
  elearning: 'view',
};
const ID_PAGE = /^[a-z][a-z0-9-]{0,39}$/;
const pageRule = (app: string, key: 'tab' | 'view'): TypeRule => ({ app, label: 'page', id: ID_PAGE, actions: ['open'], route: (l) => `/${app}?${key}=${l.id}` });

/** Whether an item type is a page of an app rather than a record. */
export function isPageType(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(PAGE_APPS, type);
}

/**
 * The page a desktop route shows (`/hr?tab=announcements` → HR's announcements), or null. Only the page itself: a
 * route that also names something on it (`/hr?tab=people&employee=12`) is more than the page, and is not one.
 */
export function pageOfRoute(route: string): { app: string; page: string } | null {
  const [path = '', qs = ''] = route.split('#')[0]!.split('?');
  const seg = path.replace(/^\/+|\/+$/g, '').split('/');
  const app = seg[0] ?? '';
  if (seg.length !== 1 || !isPageType(app)) return null;
  const key = PAGE_APPS[app]!;
  const q = new URLSearchParams(qs);
  const page = q.get(key);
  if (!page || !ID_PAGE.test(page) || [...q.keys()].some((k) => k !== key)) return null;
  return { app, page };
}

export const ITEM_TYPES: Record<string, TypeRule> = {
  ...Object.fromEntries(Object.entries(PAGE_APPS).map(([app, key]) => [app, pageRule(app, key)])),
  file: { app: 'files', label: 'file', id: ID_NUM, actions: ['open', 'download', 'show', 'request-access'], route: (l) => commented(withQuery('/files', { file: l.id, play: l.action === 'show' || l.action === 'download' ? null : 1 }), l) },
  folder: { app: 'files', label: 'folder', id: ID_NUM, actions: ['open', 'request-access'], route: (l) => commented(`/files?folder=${l.id}`, l) },
  // Something shared with the person: Files › Shared with me, with it picked out.
  shared: { app: 'files', label: 'shared item', id: ID_NUM, actions: ['open'], route: (l) => `/files?view=shared&file=${l.id}` },
  // A Meet room by its uuid opens at its join screen; a scheduled meeting with no room (by its number) in Meetings.
  meeting: { app: 'meet', label: 'meeting', id: ID_MEETING, actions: ['join', 'details'], route: (l) => (/^\d+$/.test(l.id) ? `/meetings?meeting=${l.id}` : l.action === 'details' ? `/meet/${l.id}?details=1` : `/meet/${l.id}`) },
  event: { app: 'calendar', label: 'event', id: ID_NUM, actions: ['open', 'accept', 'decline', 'maybe'], route: (l) => commented(`/calendar?event=${l.id}`, l) },
  note: { app: 'notes', label: 'note', id: ID_NUM, actions: ['open'], route: (l) => commented(`/notes?note=${l.id}`, l) },
  task: { app: 'tasks', label: 'task', id: ID_NUM, actions: ['open', 'done'], route: (l) => commented(`/tasks?task=${l.id}`, l) },
  // A task reminder: the task, with the reminder's own run for Snooze.
  reminder: { app: 'tasks', label: 'reminder', id: ID_NUM, actions: ['open', 'snooze', 'done'], route: (l) => withQuery(`/tasks?task=${l.id}`, { reminder: l.run }) },
  alert: { app: 'settings', label: 'alert', id: /^(?:security|sync|storage|overdue)$/, actions: ['open'], route: (l) => ALERT_ROUTES[l.id]!.route },
  chat: { app: 'chat', label: 'conversation', id: ID_NUM, actions: ['open'], route: (l) => withQuery(`/chat/${l.id}`, { message: l.message }) },
  message: { app: 'chat', label: 'message', id: ID_NUM, actions: ['open'], route: (l) => withQuery(`/chat/${l.id}`, { message: l.message }) },
  mention: { app: 'chat', label: 'mention', id: ID_NUM, actions: ['open'], route: (l) => withQuery(`/chat/${l.id}`, { message: l.message }) },
  tender: { app: 'tenders', label: 'tender', id: ID_NUM, actions: RECORD_ACTIONS, route: (l) => reviewing(`/tenders/${l.id}`, l) },
  invoice: { app: 'billing', label: 'invoice', id: ID_NUM, actions: RECORD_ACTIONS, route: (l) => reviewing(`/billing?invoice=${l.id}`, l) },
  expense: { app: 'expenses', label: 'expense claim', id: ID_NUM, actions: RECORD_ACTIONS, route: (l) => reviewing(`/expenses?claim=${l.id}`, l) },
  lead: { app: 'crm', label: 'lead', id: ID_NUM, actions: RECORD_ACTIONS, route: (l) => reviewing(`/crm/leads/${l.id}`, l) },
  deal: { app: 'crm', label: 'deal', id: ID_NUM, actions: RECORD_ACTIONS, route: (l) => reviewing(`/crm?deal=${l.id}`, l) },
};

export type ItemType = keyof typeof ITEM_TYPES;

/** Actions that change something: never run without the person confirming, whatever the settings say. */
export const DATA_CHANGING_ACTIONS: ReadonlySet<ItemAction> = new Set<ItemAction>(['request-access', 'accept', 'decline', 'maybe', 'done', 'snooze', 'approve', 'reject']);

/** Types a stored copy may exist for on this computer: offline, they still open. */
export const OFFLINE_TYPES: ReadonlySet<string> = new Set(['file', 'note', 'task', 'reminder']);

export interface ItemLink {
  org: string;
  type: ItemType;
  id: string;
  /** The action the link asks for; the type's first action when it names none. */
  action: ItemAction;
  /** Whether the link named the action (a plain link only opens). */
  explicitAction: boolean;
  comment: string | null;
  message: string | null;
  run: string | null;
  /** Where the link says it was found, if it says; the app's own knowledge wins. */
  source: ItemSource | null;
  format: 'web' | 'app';
}

export type ItemLinkError = 'too_long' | 'malformed' | 'bad_scheme' | 'insecure' | 'unknown_host' | 'forbidden_characters' | 'unknown_org' | 'unknown_type' | 'bad_id' | 'unknown_action' | 'unknown_parameter';

export type ItemLinkResult = { ok: true; link: ItemLink } | { ok: false; reason: ItemLinkError };

const NUM_PARAMS = ['comment', 'message', 'run'] as const;
const SOURCES: readonly ItemSource[] = ['email', 'chat', 'notification', 'external'];

export interface ParseOptions {
  /** Web hosts accepted besides WorkSuite's own (the signed-in server's host). */
  hosts?: readonly (string | null | undefined)[];
}

/** The hosts a web link may come from: WorkSuite's own and the server this app is signed in to. */
export function allowedHosts(extra: readonly (string | null | undefined)[] = []): Set<string> {
  const out = new Set<string>(WORKSUITE_WEB_HOSTS);
  for (const h of extra) if (typeof h === 'string' && /^[a-z0-9.-]{1,253}$/i.test(h)) out.add(h.toLowerCase());
  return out;
}

/** Whether a link looks like an item link at all (so another grammar can have it otherwise). */
export function looksLikeItemLink(raw: string): boolean {
  return /^worksuite:\/{2,3}\d/i.test(raw) || /^https?:\/\/[^/?#]+\/o\//i.test(raw);
}

export function parseItemLink(raw: string, opts: ParseOptions = {}): ItemLinkResult {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, reason: 'malformed' };
  if (raw.length > MAX_ITEM_LINK_LENGTH) return { ok: false, reason: 'too_long' };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \u007f\\%<>"'`{}|^]/.test(raw)) return { ok: false, reason: 'forbidden_characters' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (url.username || url.password || url.port) return { ok: false, reason: 'forbidden_characters' };
  if (url.hash) return { ok: false, reason: 'malformed' };

  let segments: string[];
  let format: 'web' | 'app';
  if (url.protocol === 'worksuite:') {
    format = 'app';
    segments = `${url.host}${url.pathname}`.replace(/^\/+/, '').split('/');
  } else if (url.protocol === 'https:' || url.protocol === 'http:') {
    if (!allowedHosts(opts.hosts).has(url.hostname.toLowerCase())) return { ok: false, reason: 'unknown_host' };
    // Never over plain http: the link would be readable, and changeable, on the way.
    if (url.protocol === 'http:') return { ok: false, reason: 'insecure' };
    format = 'web';
    const parts = url.pathname.replace(/^\/+/, '').split('/');
    if (parts[0] !== 'o') return { ok: false, reason: 'malformed' };
    segments = parts.slice(1);
  } else {
    return { ok: false, reason: 'bad_scheme' };
  }
  if (segments.length && segments[segments.length - 1] === '') segments.pop();
  if (segments.length !== 3 || segments.some((s) => s === '' || s === '.' || s === '..')) return { ok: false, reason: 'malformed' };
  const [org, rawType, id] = segments as [string, string, string];
  if (!ORG.test(org)) return { ok: false, reason: 'unknown_org' };
  const type = rawType.toLowerCase();
  const rule = Object.prototype.hasOwnProperty.call(ITEM_TYPES, type) ? ITEM_TYPES[type] : undefined;
  if (!rule) return { ok: false, reason: 'unknown_type' };
  if (!rule.id.test(id)) return { ok: false, reason: 'bad_id' };

  const seen = new Set<string>();
  for (const key of url.searchParams.keys()) {
    if (seen.has(key)) return { ok: false, reason: 'unknown_parameter' };
    seen.add(key);
    if (key !== 'action' && key !== 'src' && !(NUM_PARAMS as readonly string[]).includes(key)) return { ok: false, reason: 'unknown_parameter' };
  }
  const asked = url.searchParams.get('action');
  if (asked !== null && !(rule.actions as readonly string[]).includes(asked)) return { ok: false, reason: 'unknown_action' };
  const nums: Record<string, string | null> = {};
  for (const k of NUM_PARAMS) {
    const v = url.searchParams.get(k);
    if (v !== null && !ID_NUM.test(v)) return { ok: false, reason: 'unknown_parameter' };
    nums[k] = v;
  }
  const src = url.searchParams.get('src');
  if (src !== null && !(SOURCES as readonly string[]).includes(src)) return { ok: false, reason: 'unknown_parameter' };

  return {
    ok: true,
    link: {
      org,
      type: type as ItemType,
      id: type === 'meeting' ? id.toLowerCase() : id,
      action: (asked as ItemAction | null) ?? rule.actions[0]!,
      explicitAction: asked !== null,
      comment: nums.comment ?? null,
      message: nums.message ?? null,
      run: nums.run ?? null,
      source: src as ItemSource | null,
      format,
    },
  };
}

/** The desktop app an item opens in (an alert's depends on which alert). */
export function itemApp(link: Pick<ItemLink, 'type' | 'id'>): string {
  if (link.type === 'alert') return ALERT_ROUTES[link.id]?.app ?? 'settings';
  if (link.type === 'meeting' && /^\d+$/.test(link.id)) return 'meetings';
  return ITEM_TYPES[link.type]!.app;
}

/** The desktop route an item opens at. */
export function itemRoute(link: ItemLink): string {
  return ITEM_TYPES[link.type]!.route(link);
}

export function itemLabel(type: string): string {
  return ITEM_TYPES[type]?.label ?? 'item';
}

export function isDataChanging(action: ItemAction): boolean {
  return DATA_CHANGING_ACTIONS.has(action);
}

const ACTION_LABELS: Record<ItemAction, string> = {
  open: 'Open in WorkSuite',
  download: 'Download',
  show: 'Show in Files',
  'request-access': 'Request access',
  join: 'Join meeting',
  details: 'Meeting details',
  accept: 'Accept',
  decline: 'Decline',
  maybe: 'Maybe',
  done: 'Mark done',
  snooze: 'Snooze',
  review: 'Review',
  approve: 'Approve',
  reject: 'Reject',
};

export function actionLabel(action: ItemAction): string {
  return ACTION_LABELS[action];
}

/** The app form of a link, which the fallback page and "Copy link" hand to the app. */
export function itemAppLink(l: Pick<ItemLink, 'org' | 'type' | 'id'> & Partial<Pick<ItemLink, 'action' | 'explicitAction' | 'comment' | 'message' | 'run'>>): string {
  return withQuery(`worksuite://${l.org}/${l.type}/${l.id}`, itemQuery(l));
}

/** The web form, for sharing outside the app. */
export function itemWebLink(l: Pick<ItemLink, 'org' | 'type' | 'id'> & Partial<Pick<ItemLink, 'action' | 'explicitAction' | 'comment' | 'message' | 'run'>>, host: string = WORKSUITE_WEB_HOSTS[0]): string {
  return withQuery(`https://${host}/o/${l.org}/${l.type}/${l.id}`, itemQuery(l));
}

function itemQuery(l: Partial<Pick<ItemLink, 'action' | 'explicitAction' | 'comment' | 'message' | 'run'>>) {
  return { action: l.action && l.explicitAction !== false ? l.action : null, comment: l.comment, message: l.message, run: l.run };
}

/**
 * The X-WorkSuite-Item header of a notification email: `type=file;id=12;org=3`
 * (and `action=` when the email is about one). Held to the same allow-list as
 * a link; anything else is no item at all.
 */
export function parseItemHeader(value: string | null | undefined): ItemLink | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 300) return null;
  const fields: Record<string, string> = {};
  for (const part of value.split(';')) {
    const at = part.indexOf('=');
    if (at <= 0) return null;
    const k = part.slice(0, at).trim().toLowerCase();
    const v = part.slice(at + 1).trim();
    if (!/^[a-z]{1,12}$/.test(k) || k in fields) return null;
    fields[k] = v;
  }
  const { type, id, org, action, ...rest } = fields;
  if (!type || !id || !org) return null;
  const extra = Object.entries(rest);
  if (extra.some(([k]) => !(NUM_PARAMS as readonly string[]).includes(k))) return null;
  const q = new URLSearchParams();
  if (action) q.set('action', action);
  for (const [k, v] of extra) q.set(k, v);
  const qs = q.toString();
  const r = parseItemLink(`worksuite://${org}/${type}/${id}${qs ? `?${qs}` : ''}`);
  return r.ok ? r.link : null;
}

/** The buttons a notification email's card offers for an item, in order. */
export function cardActions(type: string): ItemAction[] {
  if (isPageType(type)) return ['open'];
  switch (type) {
    case 'file':
      return ['open', 'download', 'show'];
    case 'folder':
    case 'shared':
    case 'note':
    case 'chat':
    case 'message':
    case 'mention':
    case 'alert':
      return ['open'];
    case 'meeting':
      return ['join', 'details'];
    case 'event':
      return ['open', 'accept', 'decline'];
    case 'task':
      return ['open', 'done'];
    case 'reminder':
      return ['open', 'snooze', 'done'];
    default:
      return ['open', 'review'];
  }
}

/** Whether an address is WorkSuite's notification sender. */
export function isWorkSuiteSender(address: string | null | undefined, extra: readonly string[] = []): boolean {
  const a = (address ?? '').trim().toLowerCase();
  return a !== '' && ([...WORKSUITE_SENDERS, ...extra.map((x) => x.toLowerCase())] as string[]).includes(a);
}

/**
 * Whether a notification email can be trusted to carry an item: from
 * WorkSuite's sender, with SPF, DKIM and DMARC all passing as the receiving
 * server recorded them, and the server's own check agreeing. Anything less —
 * a missing check included — is not verified.
 */
export function isVerifiedWorkSuiteMail(input: { from: string | null | undefined; security: { available?: boolean; spf?: string; dkim?: string; dmarc?: string } | null | undefined; serverVerified: boolean | null | undefined; senders?: readonly string[] }): boolean {
  const s = input.security;
  if (!s || s.available === false) return false;
  const pass = (v: string | undefined) => v === 'pass';
  return input.serverVerified === true && isWorkSuiteSender(input.from, input.senders) && (pass(s.spf) || s.spf === 'bestguesspass') && pass(s.dkim) && pass(s.dmarc);
}

/** A WorkSuite web address that is not an item link (a page of an app): its path, for the web-link resolver. */
export function workSuiteWebPath(raw: string, opts: ParseOptions = {}): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (!allowedHosts(opts.hosts).has(url.hostname.toLowerCase())) return null;
  return `${url.pathname}${url.search}`;
}
