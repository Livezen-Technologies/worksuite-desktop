import { assetAlerts, type AlertInput, type TrayAssets } from '@shared/assets';
import type { HttpClient } from './http';

/**
 * Assets' alerts and tray (D03): every 15 minutes while signed in, my assets and — for whoever may decide them — the
 * dashboard's waiting counts; the alerts due (shared/assets.ts) are raised once each as local notifications, even
 * with the Assets tab closed, and the tray's "Assets waiting for you" line follows the count. Somebody without
 * Assets gets a 403 and nothing is shown.
 */
export interface AssetAlertSink {
  addLocal(item: { id: string; title: string; body: string; link: string | null; module?: string }): boolean;
  notify(n: { id: string; module: string; title: string; body: string; sender: null; link: string; critical: false }): void;
}

export class AssetAlerts {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly http: Pick<HttpClient, 'get'>,
    private readonly sink: AssetAlertSink,
    private readonly onTray: (t: TrayAssets | null) => void = () => undefined,
    private readonly today: () => string = () => new Date().toISOString().slice(0, 10),
    private readonly everyMs = 900_000,
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
    let mine: AlertInput['mine'] = null;
    try {
      mine = await this.http.get<NonNullable<AlertInput['mine']>>('/api/assets/mine');
    } catch {
      this.onTray(null);
      return 0;
    }
    // What waits on me (1.2's `approvals`); an older server's dashboard counts for whoever may approve.
    const approvals = await this.http.get<NonNullable<AlertInput['approvals']>>('/api/assets/approvals').catch(() => null);
    const dashboard = approvals ? null : await this.http.get<NonNullable<AlertInput['dashboard']>>('/api/assets/dashboard').catch(() => null);
    const { alerts, tray } = assetAlerts({ mine, approvals, dashboard: dashboard?.kpi && (dashboard as { can?: { approve?: boolean } }).can?.approve === true ? dashboard : null }, this.today());
    this.onTray(tray);
    let shown = 0;
    for (const a of alerts) {
      if (!this.sink.addLocal({ id: a.id, title: a.title, body: a.body, link: a.link, module: 'assets' })) continue;
      this.sink.notify({ id: `local:${a.id}`, module: 'assets', title: a.title, body: a.body, sender: null, link: a.link, critical: false });
      shown++;
    }
    return shown;
  }
}
