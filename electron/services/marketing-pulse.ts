import { logger } from '../main/log';

const log = logger('marketing-pulse');

/**
 * Marketing's counts in the tray (WS-MKT-SRS-001 MKT-DSK-01, the D01 design): "Call queue waiting 38", "Callbacks
 * today 9", "Sending now 1 · 62%" — read with the main window closed, from the server's cheap `GET
 * /api/marketing/pulse` (the rail's badges ask the same), once a minute while somebody with Marketing is signed in, and
 * again when the computer wakes or the person's apps change.
 *
 * A server a part behind has no pulse (404), and somebody whose role lost Marketing is refused (403): then the tray
 * simply has no Marketing lines, and nothing is said about it. Offline, the last counts stay until the server answers.
 * The tray is told only when what it shows changes.
 */

/** What the server answers (`app/Modules/Marketing`, the go-live part). */
export interface MarketingPulseAnswer {
  /** Null for somebody with no call queue (no call campaign of theirs). */
  queue: { waiting: number; callbacks_today: number; held: number | null } | null;
  sending: Array<{ id: number; name: string; sent: number; recipients: number }>;
  contacts: number;
  drafts: number;
}

/** The tray's Marketing lines. A queue figure is null for somebody with no call queue; `sending` null when nothing is. */
export interface TrayMarketing {
  queueWaiting: number | null;
  callbacksToday: number | null;
  sending: { count: number; pct: number } | null;
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** The tray's lines from the server's answer: null when there is nothing to show. */
export function trayMarketing(p: MarketingPulseAnswer | null | undefined): TrayMarketing | null {
  if (!p || typeof p !== 'object') return null;
  const queue = p.queue && typeof p.queue === 'object' ? p.queue : null;
  const sending = Array.isArray(p.sending) ? p.sending : [];
  const recipients = sending.reduce((s, c) => s + count(c?.recipients), 0);
  const sent = sending.reduce((s, c) => s + Math.min(count(c?.sent), count(c?.recipients)), 0);
  if (!queue && sending.length === 0) return null;
  return {
    queueWaiting: queue ? count(queue.waiting) : null,
    callbacksToday: queue ? count(queue.callbacks_today) : null,
    // How far through, across every campaign sending now: what was sent of who it is for.
    sending: sending.length ? { count: sending.length, pct: recipients > 0 ? Math.round((sent / recipients) * 100) : 0 } : null,
  };
}

export interface MarketingPulseDeps {
  get: <T>(path: string, query?: Record<string, string>) => Promise<T>;
  /** Signed in, and Marketing among the apps this person may open. */
  allowed: () => boolean;
  /** What the tray shows changed (null: no Marketing lines). `answer` is the server's, for who needs more (the key). */
  onChange: (tray: TrayMarketing | null, answer: MarketingPulseAnswer | null) => void;
  every?: number;
}

const statusOf = (e: unknown): number | null => {
  const s = (e as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : null;
};

export class MarketingPulse {
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy: Promise<void> | null = null;
  private answer: MarketingPulseAnswer | null = null;
  /** What the tray was last told, compared as text: the tray is rebuilt only when it changes. */
  private shown = 'null';

  constructor(private readonly deps: MarketingPulseDeps) {}

  start(): void {
    this.stop();
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.deps.every ?? 60_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.set(null);
  }

  /** Ask now: the computer woke, the person's apps or organisation changed. Nothing while stopped. */
  poke(): void {
    if (this.timer) void this.refresh();
  }

  /** The server's last answer, or null (none yet, none at all, or not allowed). */
  get(): MarketingPulseAnswer | null {
    return this.answer;
  }

  refresh(): Promise<void> {
    this.busy ??= this.load().finally(() => {
      this.busy = null;
    });
    return this.busy;
  }

  private async load(): Promise<void> {
    if (!this.deps.allowed()) {
      this.set(null);
      return;
    }
    try {
      const answer = await this.deps.get<MarketingPulseAnswer>('/api/marketing/pulse');
      // Signed out or the app taken away while it was asked: nothing of it is shown.
      this.set(this.deps.allowed() && answer && typeof answer === 'object' ? answer : null);
    } catch (e) {
      const status = statusOf(e);
      // No pulse on this server, or no Marketing for this person: no lines, silently.
      if (status === 403 || status === 404 || status === 401) this.set(null);
      // Offline or the server busy: the last counts stay until it answers again.
      else log.debug('marketing pulse unavailable', { status });
    }
  }

  private set(answer: MarketingPulseAnswer | null): void {
    this.answer = answer;
    const tray = trayMarketing(answer);
    const key = JSON.stringify(tray);
    // The key's holder also reads whether there is a queue at all: told when that changes too.
    const shown = `${key}|${answer ? (answer.queue ? 'agent' : 'none') : '?'}`;
    if (shown === this.shown) return;
    this.shown = shown;
    try {
      this.deps.onChange(tray, answer);
    } catch (e) {
      log.debug('marketing pulse listener failed', { error: String(e) });
    }
  }
}
