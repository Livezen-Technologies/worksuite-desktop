import { randomUUID } from 'node:crypto';
import type { HttpClient } from './http';
import { isDesktopError } from '../main/errors';

export class NotificationDevice {
  private readonly deviceId = randomUUID();
  private timer: NodeJS.Timeout | null = null;
  private ready: Promise<void> = Promise.resolve();
  private supported = false;
  private running = false;
  constructor(private readonly http: HttpClient, private readonly presence: () => { focused: boolean; lastInputAt: number; viewing: string }) {}
  private body() { return { deviceId: this.deviceId, client: 'desktop', ...this.presence() }; }
  start(): void {
    this.running = true;
    this.ready = this.heartbeat();
    this.timer = setInterval(() => { void this.heartbeat(); }, 20_000);
    this.timer.unref?.();
  }
  stop(): void { this.running = false; if (this.timer) clearInterval(this.timer); this.timer = null; }
  private async heartbeat(): Promise<void> {
    try { const answer = await this.http.post<{ deviceId?: string }>('/api/notifications/devices/heartbeat', this.body()); this.supported = !!answer?.deviceId; }
    catch (e) { this.supported = !(isDesktopError(e) && (e.status === 404 || e.status === 405)); }
  }
  async claim(key: string, contextKey: string): Promise<boolean> {
    return (await this.decision(key, contextKey)).notify;
  }
  async decision(key: string, contextKey: string): Promise<{ notify: boolean; sound?: boolean }> {
    await this.ready;
    if (!this.running) return { notify: false };
    if (!this.supported) return { notify: true }; // A pre-routing server: the established client policy.
    try { const answer = await this.http.post<{ notify: boolean; sound?: boolean }>('/api/notifications/devices/claim', { ...this.body(), key, contextKey }); return { notify: answer.notify === true && this.running, sound: answer.sound }; }
    catch { return { notify: false }; } // An outage cannot create competing popups.
  }
}
