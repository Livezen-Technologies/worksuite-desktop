/**
 * AMC & Service on the desktop (WS-AMC-SRS-001 T-15, NOT-02; WorkSuite docs/amc/API.md §10).
 *
 * The server's AMC links read `/amc?view=<area>&<record>=<id>` (contracts, requests, estimates, warranties); the
 * desktop's own screen takes the same addresses. A new request (`amc.request.logged`) gets a banner with two buttons:
 * Open (the request) and Give to (the dispatch timeline with that request picked). Neither button acts on the request
 * by itself: the person decides with the request in front of them.
 */
export const AMC_NATIVE_VIEWS = ['home', 'dispatch', 'requests', 'contracts', 'renewals', 'estimates', 'units', 'warranties'] as const;
export type AmcView = (typeof AMC_NATIVE_VIEWS)[number];

/** Areas the desktop does not draw: they open on the web (`/amc?view=<id>`). */
export const AMC_WEB_VIEWS = ['schedule', 'sites', 'claims', 'technicians', 'plans', 'reports', 'settings'] as const;

export interface AmcButtonNotice {
  buttons: Array<{ label: string; link: string }>;
}

const id = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : typeof v === 'string' && /^\d{1,12}$/.test(v) ? Number(v) : null);

/** The request a notification is about: its `data.request_id`, else the server link's `request=`. */
export function amcRequestOf(data: unknown, link?: string | null): number | null {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const fromData = id(d.request_id);
  if (fromData) return fromData;
  const m = /^\/amc\b.*[?&]request=(\d{1,12})(?:&|$)/.exec(link ?? '');
  return m ? Number(m[1]) : null;
}

export const amcRequestRoute = (request: number) => `/amc?view=requests&request=${request}`;
export const amcGiveRoute = (request: number) => `/amc?view=dispatch&give=${request}`;

/** The desktop link for an AMC notification, or null when the key is not one of ours. */
export function amcNoticeLink(event: string | null | undefined, data?: unknown, link?: string | null): string | null {
  if (!event || !event.startsWith('amc.')) return null;
  const request = amcRequestOf(data, link);
  if (event === 'amc.request.logged' && request) return amcRequestRoute(request);
  return null;
}

/** The banner's buttons for an AMC notification (NOT-02): Open / Give to for a new request. */
export function amcNoticeActions(event: string | null | undefined, link: string | null | undefined, data?: unknown): AmcButtonNotice | null {
  if (event !== 'amc.request.logged') return null;
  const request = amcRequestOf(data, link);
  if (!request) return null;
  return { buttons: [{ label: 'Open', link: amcRequestRoute(request) }, { label: 'Give to', link: amcGiveRoute(request) }] };
}
