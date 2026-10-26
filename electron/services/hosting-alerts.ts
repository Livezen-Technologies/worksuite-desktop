import { hostingAlerts, type HostingAlertInput, type TrayHosting } from '@shared/hosting';
import type { HttpClient } from './http';

/**
 * Hosting & Domains' alerts and tray (HDM-DSK-04): every 10 minutes while signed in, what expires within 7 days and the
 * monitors that are down; each alert (shared/hosting.ts) is raised once as a native notification, even with the
 * Hosting tab closed, and the tray's line and the badge (the tray, the taskbar and the Dock) follow the counts. The lists
 * answer `{domains|certificates|servers|monitors: [...], summary, meta}`; the overview's `monitors.down` covers every
 * company. A server without monitors simply has none down. Somebody without Hosting gets a 403 and nothing is shown.
 */
export interface HostingAlertSink {
  addLocal(item: { id: string; title: string; body: string; link: string | null; module?: string }): boolean;
  notify(n: { id: string; module: string; title: string; body: string; sender: null; link: string; critical: false }): void;
}

type Rows<T> = T[] | { data?: T[]; items?: T[]; [k: string]: unknown };
function rows<T>(r: Rows<T> | null, key: string): T[] {
  if (!r) return [];
  if (Array.isArray(r)) return r;
  const v = (r as Record<string, unknown>)[key] ?? r.data ?? r.items;
  return Array.isArray(v) ? (v as T[]) : [];
}

export class HostingAlerts {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly http: Pick<HttpClient, 'get'>,
    private readonly sink: HostingAlertSink,
    private readonly onTray: (t: TrayHosting | null) => void = () => undefined,
    private readonly today: () => string = () => new Date().toISOString().slice(0, 10),
    private readonly everyMs = 600_000,
  ) {}

  start(): void {
    this.stop();
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.everyMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.onTray(null);
  }

  async tick(): Promise<number> {
    const q = 'expires_within=7&per_page=200';
    let domains: HostingAlertInput['domains'];
    try {
      domains = rows(await this.http.get<Rows<NonNullable<HostingAlertInput['domains']>[number]>>(`/api/hosting/domains?${q}`), 'domains');
    } catch {
      this.onTray(null);
      return 0;
    }
    const soft = <T>(p: Promise<T>) => p.catch(() => null);
    const [overview, certificates, servers, monitors] = await Promise.all([
      soft(this.http.get<NonNullable<HostingAlertInput['overview']>>('/api/hosting/overview')),
      soft(this.http.get<Rows<NonNullable<HostingAlertInput['certificates']>[number]>>(`/api/hosting/certificates?${q}`)),
      soft(this.http.get<Rows<NonNullable<HostingAlertInput['servers']>[number]>>(`/api/hosting/servers?${q}`)),
      soft(this.http.get<Rows<NonNullable<HostingAlertInput['monitors']>[number]>>('/api/hosting/monitors?state=down&per_page=200')),
    ]);
    const { alerts, tray } = hostingAlerts(
      { overview, domains, certificates: rows(certificates, 'certificates'), servers: rows(servers, 'servers'), monitors: rows(monitors, 'monitors') },
      this.today(),
    );
    this.onTray(tray);
    let shown = 0;
    for (const a of alerts) {
      if (!this.sink.addLocal({ id: a.id, title: a.title, body: a.body, link: a.link, module: 'hosting' })) continue;
      this.sink.notify({ id: `local:${a.id}`, module: 'hosting', title: a.title, body: a.body, sender: null, link: a.link, critical: false });
      shown++;
    }
    return shown;
  }
}
