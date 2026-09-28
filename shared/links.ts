import { APP_CATALOGUE, type AppDefinition } from './apps';

/**
 * Maps a WorkSuite web link (from a notification, search hit or activity
 * item) to where the desktop opens it: a native tab route, or the browser
 * for apps without a desktop module yet. Links are only ever same-server
 * paths; anything absolute is refused.
 */
export type LinkTarget = { kind: 'tab'; route: string; app: string } | { kind: 'browser'; path: string; app: string | null } | { kind: 'none' };

const PATH = /^\/[A-Za-z0-9/_\-.?=&%:,]*$/;
const ACCOUNT_TABS = ['general', 'preferences', 'notifications', 'security', 'pictures'];

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
  const own = ownPath(path);
  if (own) return { kind: 'tab', route: own.route, app: own.app };
  const app = appForWebPath(path, catalogue);
  if (!app) return { kind: 'browser', path, app: null };
  if (app.surface === 'native') {
    const rest = path.slice(app.webPath.length);
    return { kind: 'tab', route: `/${app.id}${rest}`, app: app.id };
  }
  return { kind: 'browser', path, app: app.id };
}
