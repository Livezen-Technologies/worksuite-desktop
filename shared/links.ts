import { APP_CATALOGUE, type AppDefinition } from './apps';
import { CHANNEL_APPS } from './channels';

/**
 * Maps a WorkSuite web link (from a notification, search hit or activity
 * item) to where the desktop opens it: a native tab route, or the browser
 * for apps without a desktop module yet. Links are only ever same-server
 * paths; anything absolute is refused.
 */
export type LinkTarget = { kind: 'tab'; route: string; app: string } | { kind: 'browser'; path: string; app: string | null } | { kind: 'none' };

const PATH = /^\/[A-Za-z0-9/_\-.?=&%:,]*$/;
const ACCOUNT_TABS = ['general', 'preferences', 'notifications', 'security', 'pictures'];
/** Pages of a native app that are the web's own: Finance's printable report and its public shared link, Projects' screens not built here. */
const BROWSER_PAGES = [
  /^\/finance\/(print|shared)\//,
  // Projects' screens the desktop does not draw (PRJ-DSK-01 builds the board, My work, time and change decisions;
  // DELIVERY the timeline, milestones, sprints and workload): the portfolio lists, budget, risks, reports, activity
  // and settings, and a project's own tabs other than its board, tasks, timeline, milestones and sprints, open on the web.
  /^\/projects\/(all|templates|clients|board|budget|risks|reports|activity|settings)(?:[/?#]|$)/,
  /^\/projects\/\d+\/(?!tasks\/|(?:board|timeline|milestones|sprints)(?:[/?#]|$))[a-z]/,
];

/**
 * Paths under another app's that are everyone's own, and where the desktop
 * shows them: a person's own pay (`/payroll/me…`) is HR's My pay, Payroll or
 * not.
 */
const OWN: Array<{ prefix: string; app: string; route: string }> = [{ prefix: '/payroll/me', app: 'hr', route: '/hr?tab=mypay' }];

function ownPath(path: string) {
  const clean = path.split(/[?#]/)[0]!;
  return OWN.find((o) => clean === o.prefix || clean.startsWith(`${o.prefix}/`));
}

/** The catalogue app a WorkSuite web path belongs to (the longest `webPath` it sits under); none for Home's `/` and for paths of no app. */
export function appForWebPath(path: string, catalogue: AppDefinition[] = APP_CATALOGUE): AppDefinition | undefined {
  const own = ownPath(path);
  if (own) return catalogue.find((a) => a.id === own.app);
  const clean = path.split(/[?#]/)[0]!;
  let best: AppDefinition | undefined;
  for (const a of catalogue) {
    if (a.webPath === '/') continue;
    if (clean === a.webPath || clean.startsWith(`${a.webPath}/`)) {
      if (!best || a.webPath.length > best.webPath.length) best = a;
    }
  }
  return best;
}

export function resolveWebLink(link: string | null | undefined, catalogue: AppDefinition[] = APP_CATALOGUE): LinkTarget {
  if (!link || typeof link !== 'string') return { kind: 'none' };
  const path = link.trim();
  if (!PATH.test(path) || path.startsWith('//') || path.includes('..')) return { kind: 'none' };
  if (path === '/' || path.startsWith('/?')) return { kind: 'tab', route: '/home', app: 'home' };
  // My account is drawn by the desktop: the web's /account/settings?tab=…, /account/security and /account/access.
  const acct = /^\/account(?:\/(settings|security|access))?\/?(?:\?(.*))?$/.exec(path);
  if (acct) {
    const tab = new URLSearchParams(acct[2] ?? '').get('tab') ?? '';
    const section = acct[1] === 'security' || acct[1] === 'access' ? acct[1] : ACCOUNT_TABS.includes(tab) ? tab : acct[1] === 'settings' ? 'general' : 'profile';
    return { kind: 'tab', route: `/account/${section}`, app: 'account' };
  }
  // Announcements are everyone's, read on Home (worksuite-desktop#98): `/announcements?open=12` opens that one there.
  const notice = /^\/announcements\/?(?:\?(.*))?$/.exec(path);
  if (notice) {
    const open = new URLSearchParams(notice[1] ?? '').get('open');
    return { kind: 'tab', route: open && /^\d+$/.test(open) ? `/home?announcement=${open}` : '/home?announcements=all', app: 'home' };
  }
  const own = ownPath(path);
  if (own) return { kind: 'tab', route: own.route, app: own.app };
  const app = appForWebPath(path, catalogue);
  if (!app) return { kind: 'browser', path, app: null };
  if (BROWSER_PAGES.some((re) => re.test(path))) return { kind: 'browser', path, app: app.id };
  // A channel of another app (WhatsApp, of Chat: worksuite-desktop#35) opens in its host, on the same conversation;
  // whether it may is still the channel's own access.
  const channel = app.channelOf ? CHANNEL_APPS[app.id] : undefined;
  if (channel) {
    const [p = '', qs = ''] = path.split('#')[0]!.split('?');
    return { kind: 'tab', route: channel.route(new URLSearchParams(qs), p.slice(app.webPath.length).split('/').filter(Boolean)), app: app.id };
  }
  if (app.surface === 'native') {
    const rest = path.slice(app.webPath.length);
    return { kind: 'tab', route: `/${app.id}${rest}`, app: app.id };
  }
  return { kind: 'browser', path, app: app.id };
}
