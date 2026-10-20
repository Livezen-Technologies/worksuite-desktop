import { APP_CATALOGUE, GUEST_APPS, GUEST_LOCKED_APPS, visibleApps, type AccessGrant } from './apps';
import { channelAppOfRoute, redirectRoute } from './channels';
import { appForWebPath, resolveWebLink } from './links';

/**
 * What the person may open, asked the same way everywhere — the main window,
 * other windows, the tray, the menu, notifications and links (the renderer
 * and the main process alike).
 *
 * The one decision is `visibleApps` (shared/apps.ts) over the bootstrap: the
 * server's AppGate answer plus the app's own permission. Everything here only
 * maps a thing to the catalogue app it belongs to and asks that set. An app
 * the person was not given is not shown, opened, notified or handed to the
 * browser; something that belongs to no app (a person's profile, the
 * directory, a document editor) is not app-gated.
 */

/** Screens of the shell itself: open to everyone signed in. */
export const SHELL_SCREENS: ReadonlySet<string> = new Set(['home', 'notifications', 'settings', 'account', 'diagnostics']);

/** Desktop screens that are part of another app: open to whoever may open that app. An Office document's tab is Files'. */
export const APP_PARTS: Readonly<Record<string, string>> = { calls: 'chat', office: 'files' };

/** A set of visible catalogue app ids (a `Set`, or anything with `has`). `guest`: guest mode's set (#149). */
export interface VisibleApps {
  has(id: string): boolean;
  readonly guest?: boolean;
}

/** Shell screens a guest may open (#149): Settings (with its Local Profile pages) and Help. Home, Notifications and My account need an account. */
export const GUEST_SCREENS: ReadonlySet<string> = new Set(['settings', 'diagnostics']);

/** What guest mode may open (#149): its local apps and screens, nothing else — not a part of another app, not an unknown route. */
export const GUEST_VISIBLE: VisibleApps = Object.freeze({ guest: true, has: (id: string) => GUEST_APPS.some((a) => a.id === id) });

/** The locked app a guest asked for, for the sign-in panel: a catalogue id or a route's. Null for one guest mode lists nowhere. */
export function guestLockedApp(idOrRoute: string): string | null {
  const id = idOrRoute.startsWith('/') ? routeOwner(idOrRoute) : idOrRoute;
  const owner = APP_PARTS[id] ?? id;
  return GUEST_LOCKED_APPS.some((a) => a.id === owner) ? owner : null;
}

const CATALOGUE_IDS = new Set(APP_CATALOGUE.map((a) => a.id));

/** What of a bootstrap decides access. */
export type Grantable = { apps: AccessGrant['apps']; permissions: string[]; serverApps?: string[] | null; selfService?: string[] | null; lockedApps?: string[] | null };

/** The grant a bootstrap carries, self-service apps included (absent on older servers and cached copies). */
export function grantOf(b: Grantable): AccessGrant {
  return { apps: b.apps, permissions: b.permissions, serverApps: b.serverApps ?? null, selfService: b.selfService ?? [], locked: b.lockedApps ?? [] };
}

/** The catalogue ids of the apps a bootstrap allows (self-service ones included); none without one. */
export function visibleAppIds(b: Grantable | null | undefined): Set<string> {
  return new Set(b ? visibleApps(grantOf(b)).map((a) => a.id) : []);
}

/** Whether an id names something app-gated or always open: a shell screen, a part of an app, or a catalogue app. */
export function isKnownApp(id: string): boolean {
  return SHELL_SCREENS.has(id) || id in APP_PARTS || CATALOGUE_IDS.has(id);
}

/** Whether the person may open this app (a catalogue id, a shell screen or a part of an app). */
export function canOpenApp(id: string, visible: VisibleApps): boolean {
  if (visible.guest) return GUEST_SCREENS.has(id) || (!(id in APP_PARTS) && visible.has(id));
  if (SHELL_SCREENS.has(id)) return true;
  const owner = APP_PARTS[id];
  return visible.has(owner ?? id);
}

/** The first segment of a desktop route (`/crm/leads/4?x=1` → `crm`); Home for an empty one. */
export function routeApp(route: string): string {
  return route.replace(/^\/+/, '').split(/[/?#]/)[0] || 'home';
}

/**
 * The app whose access opens a desktop route: its first segment's, but a channel's for a channel in its host
 * (`/chat?channel=whatsapp…` is WhatsApp's), and a channel's own old route is where it now opens (shared/channels.ts).
 */
export function routeOwner(route: string): string {
  const to = redirectRoute(route);
  return channelAppOfRoute(to) ?? routeApp(to);
}

/** A desktop route (`/chat?room=4`, `/calls/ring?…`): refused only when it belongs to an app the person may not open. */
export function canOpenRoute(route: string, visible: VisibleApps): boolean {
  const id = routeOwner(route);
  // A guest opens only what guest mode lists: a person's profile or a record of no app needs an account too.
  if (visible.guest) return canOpenApp(id, visible);
  return !isKnownApp(id) || canOpenApp(id, visible);
}

/** A WorkSuite web path (`/tickets?ticket=4`): refused only when it belongs to an app the person may not open. */
export function canOpenWebPath(path: string, visible: VisibleApps): boolean {
  const app = appForWebPath(path);
  if (visible.guest) return !!app && canOpenApp(app.id, visible);
  return !app || canOpenApp(app.id, visible);
}

/** The app a web link opens in, whichever way it opens (a tab, or the browser); null for none. */
export function linkApp(link: string | null | undefined): string | null {
  const t = resolveWebLink(link);
  return t.kind === 'none' ? null : t.app;
}

/** A web link (a notification's, a search hit's): refused only when it opens an app the person may not open. */
export function canOpenLink(link: string | null | undefined, visible: VisibleApps): boolean {
  const app = linkApp(link);
  if (visible.guest) return !!app && canOpenApp(app, visible);
  return !app || canOpenApp(app, visible);
}

/**
 * The server's notification categories (and the desktop's own module names
 * for them) → the apps they are about. A category of several apps is shown
 * while any of them is; a category of none (system, security, the
 * organization) is not app-gated.
 */
export const NOTIFICATION_CATEGORY_APPS: Readonly<Record<string, readonly string[]>> = {
  projects: ['tasks', 'projects'],
  tasks: ['tasks'],
  task: ['tasks'],
  chat: ['chat'],
  message: ['chat'],
  // The Phone's own (missed PBX calls, voicemail, PBX offline) and Chat's calls (`voip.missed_call` for a chat call).
  voip: ['phone', 'chat'],
  mail: ['mail'],
  calendar: ['calendar', 'meet'],
  event: ['calendar'],
  meet: ['meet'],
  meetings: ['meetings'],
  meeting: ['meetings'],
  files: ['files'],
  file: ['files'],
  drive: ['files'],
  crm: ['crm'],
  lead: ['crm'],
  oms: ['sales'],
  sales: ['sales'],
  billing: ['billing'],
  invoice: ['billing'],
  inventory: ['inventory', 'purchase'],
  // Purchasing's own notices (`purchase.approval`, `purchase.order.sent`, `purchase.bill.due`…).
  purchasing: ['purchase'],
  purchase: ['purchase'],
  payables: ['purchase'],
  tenders: ['tenders'],
  tender: ['tenders'],
  hr: ['hr'],
  recruitment: ['recruitment'],
  hrm: ['hr'],
  leave: ['hr'],
  attendance: ['hr'],
  // "Pay and payslips": a person's own payslips are everyone's (HR's My pay), Payroll or not.
  payroll: ['payroll', 'hr'],
  expenses: ['expenses'],
  finance: ['finance'],
  marketing: ['marketing'],
  social: ['social'],
  // Social Media Manager's own (post needs approval, published, failed, held, reminder due, account expiring…).
  social_media: ['social-media'],
  'social-media': ['social-media'],
  whatsapp: ['whatsapp'],
  meta: ['messenger', 'instagram'],
  customer_subscriptions: ['subscriptions'],
  subscriptions: ['subscriptions'],
  support: ['support'],
  tickets: ['support'],
  appointments: ['appointments'],
  amc: ['amc'],
  assets: ['assets'],
  pos: ['pos'],
  notes: ['notes'],
  contacts: ['contacts'],
  activity: ['activity'],
  ai: ['ai'],
  // Hotel PMS's notices (`pms.reservation.created`, `pms.guest.arriving`, `pms.night_audit.failed`…).
  pms: ['pms'],
  // WorkSuite Events' notices (`events.checkin.duplicate`, `events.device.offline`, `events.event.live`…).
  events: ['events'],
};

/** Whether a notification category is one of an app the person may open (or of no app). */
export function categoryVisible(category: string | null | undefined, visible: VisibleApps): boolean {
  const apps = category ? NOTIFICATION_CATEGORY_APPS[category.toLowerCase()] : undefined;
  return !apps || apps.some((a) => canOpenApp(a, visible));
}

/**
 * Whether a notification may be shown: its link must open in an app the
 * person may open, and so must its category (or module) when it names one.
 * One with neither is shown.
 */
export function notificationAllowed(n: { module?: string | null; category?: string | null; link?: string | null }, visible: VisibleApps): boolean {
  if (!canOpenLink(n.link, visible)) return false;
  // An announcement is HR's, but it is for everyone it was sent to, HR app or not (worksuite-desktop#98).
  if (n.link && /^\/announcements\/?(\?|$)/.test(n.link)) return true;
  return categoryVisible(n.category, visible) && categoryVisible(n.module, visible);
}
