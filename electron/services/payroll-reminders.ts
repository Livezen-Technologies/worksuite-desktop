import { payrollReminders, type ReminderDashboard } from '@shared/payroll';
import type { HttpClient } from './http';

/**
 * Payroll's tray reminders (D24): once an hour while signed in, the server's payroll dashboard, and the reminders
 * due today (shared/payroll.ts) as local notifications — shown once each, even when the Payroll tab is closed.
 * Somebody without payroll access gets a 403 and nothing is shown.
 */
export interface ReminderSink {
  addLocal(item: { id: string; title: string; body: string; link: string | null; module?: string }): boolean;
  notify(n: { id: string; module: string; title: string; body: string; sender: null; link: string; critical: false }): void;
}

export class PayrollReminders {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly http: Pick<HttpClient, 'get'>,
    private readonly sink: ReminderSink,
    private readonly today: () => string = () => new Date().toISOString().slice(0, 10),
    private readonly everyMs = 3_600_000,
  ) {}

  start(): void {
    this.stop();
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.everyMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<number> {
    let d: ReminderDashboard | null = null;
    try {
      d = await this.http.get<ReminderDashboard>('/api/payroll/dashboard');
    } catch {
      return 0;
    }
    let shown = 0;
    for (const r of payrollReminders(d, this.today())) {
      if (!this.sink.addLocal({ id: r.id, title: r.title, body: r.body, link: r.link, module: 'payroll' })) continue;
      this.sink.notify({ id: `local:${r.id}`, module: 'payroll', title: r.title, body: r.body, sender: null, link: r.link, critical: false });
      shown++;
    }
    return shown;
  }
}
