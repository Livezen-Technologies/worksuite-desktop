/**
 * worksuite:// deep-link grammar (FR-DL-01/02, WF-04).
 *
 * A link is accepted only if it matches one of the allow-listed patterns
 * below. Everything else — unknown modules, file paths, `..`, over-long input,
 * credentials, ports — is rejected, and the shell opens Home with a toast.
 * Parsing never performs an action: a link can only ever *open* something,
 * and the target is then permission-checked like any other navigation.
 */

export const MAX_LINK_LENGTH = 2048;

export interface DeepLink {
  /** Module id the route belongs to (e.g. "crm"). */
  module: string;
  /** Pattern that matched, e.g. "crm/leads/:id". */
  pattern: string;
  /** Desktop route the shell navigates to, e.g. "/crm/leads/128". */
  route: string;
  params: Record<string, string>;
  /** Open in its own window instead of a tab (`?window=1`). */
  newWindow: boolean;
  /** Organization hint carried by the link (`?org=`), validated as an id. */
  organizationId: string | null;
}

export type DeepLinkResult = { ok: true; link: DeepLink } | { ok: false; reason: DeepLinkError };

export type DeepLinkError =
  | 'too_long'
  | 'bad_scheme'
  | 'malformed'
  | 'forbidden_characters'
  | 'unknown_route';

interface RouteRule {
  pattern: string;
  module: string;
  /** Builds the desktop route from params. */
  route: (p: Record<string, string>) => string;
}

// Segment values: record ids, numbers, invoice-style references. No dots
// (so no "..", no file extensions), no slashes, no percent-escapes.
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export const DEEP_LINK_RULES: RouteRule[] = [
  { pattern: 'home', module: 'home', route: () => '/home' },
  { pattern: 'mail', module: 'mail', route: () => '/mail' },
  { pattern: 'mail/:id', module: 'mail', route: (p) => `/mail/${p.id}` },
  { pattern: 'chat', module: 'chat', route: () => '/chat' },
  { pattern: 'chat/:id', module: 'chat', route: (p) => `/chat/${p.id}` },
  { pattern: 'calendar', module: 'calendar', route: () => '/calendar' },
  { pattern: 'tasks', module: 'tasks', route: () => '/tasks' },
  { pattern: 'tasks/:id', module: 'tasks', route: (p) => `/tasks/${p.id}` },
  { pattern: 'files', module: 'files', route: () => '/files' },
  { pattern: 'files/folder/:id', module: 'files', route: (p) => `/files/folder/${p.id}` },
  { pattern: 'files/:id', module: 'files', route: (p) => `/files/file/${p.id}` },
  { pattern: 'crm', module: 'crm', route: () => '/crm' },
  { pattern: 'crm/leads/:id', module: 'crm', route: (p) => `/crm/leads/${p.id}` },
  { pattern: 'hr', module: 'hr', route: () => '/hr' },
  { pattern: 'hr/leave/:id', module: 'hr', route: (p) => `/hr/leave/${p.id}` },
  { pattern: 'notifications', module: 'notifications', route: () => '/notifications' },
  { pattern: 'settings', module: 'settings', route: () => '/settings' },
  { pattern: 'settings/:section', module: 'settings', route: (p) => `/settings/${p.section}` },
  // Records owned by modules without a native desktop screen yet resolve to
  // their module; the shell decides how to open them (§14).
  { pattern: 'invoice/:id', module: 'billing', route: (p) => `/billing/invoices/${p.id}` },
  { pattern: 'garage/jobs/:id', module: 'garage', route: (p) => `/garage/jobs/${p.id}` },
  { pattern: 'garage/vehicles/:id', module: 'garage', route: (p) => `/garage/vehicles/${p.id}` },
  { pattern: 'events', module: 'events', route: () => '/events' },
  { pattern: 'events/:id', module: 'events', route: (p) => `/events/${p.id}` },
  { pattern: 'events/:id/desk', module: 'events', route: (p) => `/events/${p.id}/desk` },
  { pattern: 'events/:id/counters', module: 'events', route: (p) => `/events/${p.id}/counters` },
  { pattern: 'pms', module: 'pms', route: () => '/pms' },
  { pattern: 'pms/reservations/:id', module: 'pms', route: (p) => `/pms/reservations/${p.id}` },
  { pattern: 'pms/rooms/:id', module: 'pms', route: (p) => `/pms/rooms/${p.id}` },
  { pattern: 'elearning', module: 'elearning', route: () => '/elearning' },
  { pattern: 'elearning/courses/:id', module: 'elearning', route: (p) => `/elearning/my/courses/${p.id}` },
  { pattern: 'elearning/catalog/:id', module: 'elearning', route: (p) => `/elearning/catalog/${p.id}` },
  { pattern: 'tenders/:id', module: 'tender', route: (p) => `/tenders/${p.id}` },
  { pattern: 'projects/:id', module: 'projects', route: (p) => `/projects/${p.id}` },
];

function matchRule(rule: RouteRule, segments: string[]): Record<string, string> | null {
  const parts = rule.pattern.split('/');
  if (parts.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const want = parts[i]!;
    const got = segments[i]!;
    if (want.startsWith(':')) {
      if (!SEGMENT.test(got)) return null;
      params[want.slice(1)] = got;
    } else if (want !== got.toLowerCase()) {
      return null;
    }
  }
  return params;
}

export function parseDeepLink(raw: string, extraRules: RouteRule[] = []): DeepLinkResult {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, reason: 'malformed' };
  if (raw.length > MAX_LINK_LENGTH) return { ok: false, reason: 'too_long' };
  // Control characters, backslashes and percent-escapes have no place in a
  // WorkSuite link; rejecting them up front closes off encoding tricks.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\%<>"'`{}|^]/.test(raw)) return { ok: false, reason: 'forbidden_characters' };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (url.protocol !== 'worksuite:') return { ok: false, reason: 'bad_scheme' };
  if (url.username || url.password || url.port) return { ok: false, reason: 'forbidden_characters' };

  // worksuite://crm/leads/128 parses with host "crm"; worksuite:///crm/... with
  // an empty host. Both are accepted and normalised to the same segments.
  const path = `${url.host}${url.pathname}`.replace(/^\/+|\/+$/g, '');
  const segments = path === '' ? ['home'] : path.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return { ok: false, reason: 'malformed' };

  const allowedParams = new Set(['window', 'org']);
  for (const key of url.searchParams.keys()) {
    if (!allowedParams.has(key)) return { ok: false, reason: 'malformed' };
  }
  const org = url.searchParams.get('org');
  if (org !== null && !SEGMENT.test(org)) return { ok: false, reason: 'malformed' };

  for (const rule of [...DEEP_LINK_RULES, ...extraRules]) {
    const params = matchRule(rule, segments);
    if (params) {
      return {
        ok: true,
        link: {
          module: rule.module,
          pattern: rule.pattern,
          route: rule.route(params),
          params,
          newWindow: url.searchParams.get('window') === '1',
          organizationId: org,
        },
      };
    }
  }
  return { ok: false, reason: 'unknown_route' };
}

/** Finds a worksuite:// URL in a process argv (Windows/Linux second launch). */
export function findDeepLinkInArgv(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (typeof arg === 'string' && arg.toLowerCase().startsWith('worksuite:')) return arg;
  }
  return null;
}
