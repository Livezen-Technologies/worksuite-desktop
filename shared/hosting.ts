/**
 * Hosting & Domains on the desktop's tray and notifications (WorkSuite Hosting & Domains SRS v1.0, HDM-DSK-04/05):
 * which screen each `hosting.*` notice opens, what this computer counts on the tray badge (monitors down and items
 * expiring within 7 days), the alerts it raises itself so they arrive with the Hosting tab closed, and which
 * `/api/hosting` answers the encrypted offline cache keeps (HDM-DSK-05). Pure: electron/services/hosting-alerts.ts
 * fetches and shows them.
 */

const id = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : typeof v === 'string' && /^\d{1,12}$/.test(v) ? Number(v) : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

export const hostingDomainRoute = (domain: number, tab?: string) => `/hosting?domain=${domain}${tab ? `&view=${tab}` : ''}`;
export const hostingServerRoute = (server: number) => `/hosting?server=${server}`;

/** The desktop link for a hosting notification, or null when the key is not one of ours. */
export function hostingNoticeLink(event: string | null | undefined, data?: unknown): string | null {
  if (!event || !event.startsWith('hosting.')) return null;
  const d = obj(data);
  if (event === 'hosting.domain_expiring') return id(d.domain_id) ? hostingDomainRoute(id(d.domain_id)!) : '/hosting?tab=expiring';
  if (event === 'hosting.certificate_expiring' || event === 'hosting.certificate_changed') return id(d.certificate_id) ? `/hosting?tab=certificates&certificate=${id(d.certificate_id)}` : '/hosting?tab=certificates';
  if (event === 'hosting.server_expiring') return id(d.server_id) ? hostingServerRoute(id(d.server_id)!) : '/hosting?tab=servers';
  if (event === 'hosting.monitor_down' || event === 'hosting.monitor_up') return '/hosting?tab=monitors';
  if (event === 'hosting.sync_failed' || event === 'hosting.credential_failed') return '/hosting?tab=accounts';
  return '/hosting';
}

/** Days from `today` (YYYY-MM-DD) to an ISO date; null without one. */
export function daysUntil(iso: string | null | undefined, today: string): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const a = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const b = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** What the alerts read: the overview where the server has it, or the lists an older server answers. */
export interface HostingAlertInput {
  overview?: {
    monitors_down?: number;
    expiring_7?: number;
    renewals?: Array<{ kind?: string; id?: number; name?: string; expires_on?: string | null; days_left?: number | null }>;
  } | null;
  domains?: Array<{ id: number; name: string; expires_on?: string | null; auto_renew?: boolean | null }> | null;
  certificates?: Array<{ id: number; host: string; port?: number | null; expires_on?: string | null }> | null;
  servers?: Array<{ id: number; name: string; expires_on?: string | null }> | null;
  monitors?: Array<{ id: number; name?: string | null; target?: string | null; last_state?: string | null; incident_id?: number | null; last_error?: string | null }> | null;
}

export interface HostingAlert {
  /** Stable per subject (and per incident or rung), so each is shown once. */
  id: string;
  title: string;
  body: string;
  link: string;
}

export interface TrayHosting {
  /** Monitors down now. */
  down: number;
  /** Domains, certificates and servers expiring within 7 days. */
  expiring: number;
}

/** The tray badge's share: monitors down plus what expires within 7 days. */
export const hostingBadge = (t: TrayHosting | null | undefined): number => (t ? Math.max(0, t.down) + Math.max(0, t.expiring) : 0);

/** The alerts due and the tray's counts. A rung (7, 1 or 0 days) is alerted once per subject. */
export function hostingAlerts(input: HostingAlertInput, today: string): { alerts: HostingAlert[]; tray: TrayHosting } {
  const alerts: HostingAlert[] = [];
  const rung = (d: number) => (d <= 0 ? 0 : d <= 1 ? 1 : 7);
  let expiring = 0;
  const soon = (kind: 'domain' | 'certificate' | 'server', subject: number, name: string, iso: string | null | undefined, link: string, extra = '') => {
    const d = daysUntil(iso, today);
    if (d === null || d > 7) return;
    expiring++;
    const when = d < 0 ? `expired ${-d} day${d === -1 ? '' : 's'} ago` : d === 0 ? 'expires today' : `expires in ${d} day${d === 1 ? '' : 's'}`;
    const what = kind === 'domain' ? 'Domain' : kind === 'certificate' ? 'Certificate' : 'Server';
    alerts.push({ id: `hosting:${kind}:${subject}:r${rung(d)}`, title: `${name} ${when}`, body: `${what}${extra}`, link });
  };
  for (const x of input.domains ?? []) soon('domain', x.id, x.name, x.expires_on, hostingDomainRoute(x.id), x.auto_renew === false ? ' · auto-renew off' : '');
  for (const x of input.certificates ?? []) soon('certificate', x.id, x.port && x.port !== 443 ? `${x.host}:${x.port}` : x.host, x.expires_on, `/hosting?tab=certificates&certificate=${x.id}`);
  for (const x of input.servers ?? []) soon('server', x.id, x.name, x.expires_on, hostingServerRoute(x.id));
  let down = 0;
  for (const m of input.monitors ?? []) {
    if (m.last_state !== 'down') continue;
    down++;
    const name = m.name || m.target || `Monitor ${m.id}`;
    alerts.push({ id: `hosting:monitor:${m.id}:${m.incident_id ?? 'down'}`, title: `${name} is down`, body: m.last_error || 'The last checks failed.', link: '/hosting?tab=monitors' });
  }
  // The server's own counts win where it sent them: it sees every company, this computer only the pages it read.
  if (typeof input.overview?.monitors_down === 'number') down = input.overview.monitors_down;
  if (typeof input.overview?.expiring_7 === 'number') expiring = input.overview.expiring_7;
  return { alerts, tray: { down, expiring } };
}

/**
 * Which Hosting GET answers are kept in the encrypted offline cache (READ_CACHE): the register, each domain and server
 * opened, its DNS copy, certificates, monitors, costs, accounts and sync history — so the module opens read-only from
 * this computer's copy with its "as of" time. Never an EPP transfer code, a live lookup, metrics or an export.
 */
const CACHED = /^\/api\/hosting(?:\/(?:overview|organizations|providers|accounts|sync-runs|domains|domains\/\d{1,12}|domains\/\d{1,12}\/(?:dns|activity)|servers|servers\/\d{1,12}|certificates|certificates\/\d{1,12}|monitors|incidents|costs))?$/;
export function hostingCached(path: string): boolean {
  return CACHED.test(path.split('?')[0]!);
}
