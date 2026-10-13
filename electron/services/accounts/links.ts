import type { AccountRecord, LinkRoute } from '@shared/accounts';
import { linkServer } from '@shared/deeplink';
import { itemLabel, WORKSUITE_WEB_HOSTS } from '@shared/item-links';
import { hostOf } from './registry';

/**
 * Which account a link belongs to (Connection & Startup §4 step 5, `handleDeepLink`):
 *
 *  - a web link (https) by its host, against each account's `linkHosts` (and its server's own host);
 *  - a worksuite:// link by its optional `server=<host>`, else the open account;
 *  - the open account first; another known account → "Open in <account>?" (switch, then navigate);
 *  - no account → `accounts:unknownLink` (screen 16). Nothing is ever fetched from that host.
 *
 * Not routed here (null): mailto:, the sign-in callbacks, setup links, guest meeting links — each has its own path.
 */

/** The hosts an account's links come from. */
export function accountHosts(a: Pick<AccountRecord, 'linkHosts' | 'serverOrigin' | 'apiOrigin'>): string[] {
  const out = new Set<string>();
  for (const h of a.linkHosts) if (h) out.add(h.toLowerCase());
  for (const o of [a.serverOrigin, a.apiOrigin]) {
    const h = hostOf(o);
    if (h) out.add(h);
  }
  return [...out];
}

/** What a link points at, when it says ("Tender #123"), from `/o/<org>/<type>/<id>`. */
export function linkLabel(url: URL): string | null {
  const m = /^\/o\/[^/]+\/([a-z_-]+)\/([A-Za-z0-9_-]+)/i.exec(url.pathname);
  if (!m) return null;
  const label = itemLabel(m[1]!.toLowerCase());
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} #${m[2]}`;
}

/** Links handled elsewhere: never routed by host. */
export function isUnroutedLink(raw: string): boolean {
  return /^mailto:/i.test(raw) || /^worksuite:\/\/(auth|setup)\b/i.test(raw) || /^worksuite:\/\/meet\//i.test(raw) || /^https:\/\/[^/]+\/meet\//i.test(raw);
}

export function routeLink(raw: string, accounts: readonly AccountRecord[], activeId: string | null): LinkRoute | null {
  if (isUnroutedLink(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  let host: string | null;
  if (url.protocol === 'worksuite:') {
    host = linkServer(raw);
    // No server named: the open account's, as before accounts.
    if (!host) return { kind: 'active' };
  } else if (url.protocol === 'https:' || url.protocol === 'http:') {
    host = url.hostname.toLowerCase();
  } else {
    return null;
  }
  const active = activeId ? accounts.find((a) => a.id === activeId) : undefined;
  if (active && accountHosts(active).includes(host)) return { kind: 'active' };
  const other = accounts.find((a) => a.id !== activeId && accountHosts(a).includes(host!));
  if (other) return { kind: 'account', accountId: other.id };
  // WorkSuite's own web hosts (app.worksuite.lk) belong to whichever account is open.
  if (url.protocol !== 'worksuite:' && (WORKSUITE_WEB_HOSTS as readonly string[]).includes(host)) return { kind: 'active' };
  return { kind: 'unknown', host, label: linkLabel(url) };
}

/** The link without `server=` (the grammars that come after do not know it). */
export function withoutServerParam(raw: string): string {
  if (!/[?&]server=/i.test(raw)) return raw;
  try {
    const u = new URL(raw);
    u.searchParams.delete('server');
    const s = u.toString();
    return s.endsWith('?') ? s.slice(0, -1) : s;
  } catch {
    return raw;
  }
}
