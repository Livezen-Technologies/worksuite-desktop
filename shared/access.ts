import { APP_CATALOGUE, visibleApps, type AccessGrant } from './apps';
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

/** Desktop screens that are part of another app: open to whoever may open that app. */
export const APP_PARTS: Readonly<Record<string, string>> = { calls: 'chat' };

/** A set of visible catalogue app ids (a `Set`, or anything with `has`). */
export interface VisibleApps {
  has(id: string): boolean;
}

const CATALOGUE_IDS = new Set(APP_CATALOGUE.map((a) => a.id));

/** What of a bootstrap decides access. */
export type Grantable = { apps: AccessGrant['apps']; permissions: string[]; serverApps?: string[] | null; selfService?: string[] | null };

/** The grant a bootstrap carries, self-service apps included (absent on older servers and cached copies). */
export function grantOf(b: Grantable): AccessGrant {
  return { apps: b.apps, permissions: b.permissions, serverApps: b.serverApps ?? null, selfService: b.selfService ?? [] };
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
  if (SHELL_SCREENS.has(id)) return true;
  const owner = APP_PARTS[id];
  return visible.has(owner ?? id);
}

/** The first segment of a desktop route (`/crm/leads/4?x=1` → `crm`); Home for an empty one. */
export function routeApp(route: string): string {
  return route.replace(/^\/+/, '').split(/[/?#]/)[0] || 'home';
}

/** A desktop route (`/chat?room=4`, `/calls/ring?…`): refused only when it belongs to an app the person may not open. */
export function canOpenRoute(route: string, visible: VisibleApps): boolean {
  const id = routeApp(route);
  return !isKnownApp(id) || canOpenApp(id, visible);
}

/** A WorkSuite web path (`/tickets?ticket=4`): refused only when it belongs to an app the person may not open. */
export function canOpenWebPath(path: string, visible: VisibleApps): boolean {
  const app = appForWebPath(path);
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
  voip: ['chat'],
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
  inventory: ['inventory', 'purchasing'],
  purchasing: ['purchasing'],
  tenders: ['tenders'],
  tender: ['tenders'],
  hr: ['hr'],
  hrm: ['hr'],
  leave: ['hr'],
  attendance: ['hr'],
  // "Pay and payslips": a person's own payslips are everyone's (HR's My pay), Payroll or not.
  payroll: ['payroll', 'hr'],
  expenses: ['expenses'],
  finance: ['finance'],
  marketing: ['marketing'],
  social: ['social'],
  whatsapp: ['whatsapp'],
  customer_subscriptions: ['subscriptions'],
  subscriptions: ['subscriptions'],
  support: ['support'],
  tickets: ['support'],
  appointments: ['appointments'],
  amc: ['amc'],
  garage: ['garage'],
  assets: ['assets'],
  pos: ['pos'],
  notes: ['notes'],
  contacts: ['contacts'],
  activity: ['activity'],
  ai: ['ai'],
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
  return categoryVisible(n.category, visible) && categoryVisible(n.module, visible);
}
