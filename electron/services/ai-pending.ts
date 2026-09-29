import type { Incoming } from './notifications';

/**
 * Changes the assistant proposed that are waiting for this person (WS-AI-SRS-001
 * DSK-5, FR-DSK-AI-03): a native notification when a new one arrives — from
 * this computer, another, or the web — and a count in the tray.
 *
 * A notification only OPENS the main window's Changes view (`AI_CHANGES_LINK`):
 * it has no buttons, so nothing — least of all a change that reaches outside
 * the company — is ever confirmed from one. What is waiting when the watcher
 * starts is counted, not announced: a sign-in is not news.
 */

/** The link a notification or the tray opens: the main window's Changes view, never a route. */
export const AI_CHANGES_LINK = 'ai:changes';

interface Waiting {
  id: number;
  risk: 'R1' | 'R2';
  status: string;
  preview: { title: string };
}

export interface AiPendingDeps {
  get: <T>(path: string, query?: Record<string, string>) => Promise<T>;
  notify: (n: Incoming) => void;
  /** Whether the assistant is on for this person here (the company's rules and the device's). */
  enabled: () => boolean;
  onCount: (n: number) => void;
  every?: number;
}

export class AiPendingWatcher {
  private seen = new Set<number>();
  private primed = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy: Promise<void> | null = null;

  constructor(private readonly deps: AiPendingDeps) {}

  start(): void {
    this.stop();
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.deps.every ?? 60_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.seen.clear();
    this.primed = false;
    this.deps.onCount(0);
  }

  /** A realtime event from the server: a card was just made (ids only; the list says what). */
  handle(e: { type?: string }): void {
    if (e?.type === 'ai.pending.created' && this.timer) void this.refresh();
  }

  refresh(): Promise<void> {
    this.busy ??= this.load().finally(() => {
      this.busy = null;
    });
    return this.busy;
  }

  private async load(): Promise<void> {
    if (!this.deps.enabled()) {
      this.deps.onCount(0);
      return;
    }
    let list: Waiting[];
    try {
      list = (await this.deps.get<{ actions: Waiting[] }>('/api/ai/pending', { which: 'open' })).actions ?? [];
    } catch {
      return; // Offline or refused: the next round tries again; nothing is announced from a guess.
    }
    const waiting = list.filter((a) => a.status === 'awaiting_confirmation');
    for (const a of waiting) {
      if (this.seen.has(a.id)) continue;
      this.seen.add(a.id);
      if (!this.primed) continue;
      this.deps.notify({
        id: `ai-pending:${a.id}`,
        module: 'ai',
        category: 'ai',
        title: a.risk === 'R2' ? 'The assistant has something to send — check it first' : 'A change is waiting for you',
        body: a.preview?.title ?? 'The assistant proposed a change.',
        sender: 'AI assistant',
        link: AI_CHANGES_LINK,
        critical: false,
      });
    }
    this.primed = true;
    this.deps.onCount(waiting.length);
  }
}
