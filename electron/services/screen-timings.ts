/**
 * Request, server and render times the screens report (worksuite-desktop#252), newest last, for Help › Diagnostics.
 *
 * Website chats time each list, thread and reply: from the request leaving to its answer, what the server says it
 * spent (its time, its database time, its queries and rows) and how long the rows took to draw. The last few hundred
 * are kept in memory only — they hold no names, no messages and no addresses, just what was asked and how long it
 * took — and the diagnostic report writes them as `timings.json` with a summary per kind of request.
 */
export interface ScreenTiming {
  what: string;
  at: string;
  ms: number;
  rows: number | null;
  server: { ms: number; db_ms: number; queries: number; rows: number } | null;
  render_ms?: number | null;
  ok: boolean;
}

const KEEP = 300;

class ScreenTimings {
  private entries: ScreenTiming[] = [];

  add(list: ScreenTiming[]): void {
    this.entries.push(...list.slice(-KEEP));
    if (this.entries.length > KEEP) this.entries.splice(0, this.entries.length - KEEP);
  }

  /** Every entry kept, and per kind of request: how many, and the median and slowest times. */
  report(): { summary: Record<string, { count: number; failed: number; median_ms: number; max_ms: number; median_server_ms: number | null; median_render_ms: number | null }>; entries: ScreenTiming[] } {
    const median = (xs: number[]): number | null => {
      if (!xs.length) return null;
      const s = [...xs].sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)]!;
    };
    const summary: ReturnType<ScreenTimings['report']>['summary'] = {};
    const kinds = [...new Set(this.entries.map((e) => e.what))];
    for (const what of kinds) {
      const all = this.entries.filter((e) => e.what === what);
      const ok = all.filter((e) => e.ok);
      summary[what] = {
        count: all.length,
        failed: all.length - ok.length,
        median_ms: median(ok.map((e) => e.ms)) ?? 0,
        max_ms: Math.max(0, ...ok.map((e) => e.ms)),
        median_server_ms: median(ok.flatMap((e) => (e.server ? [e.server.ms] : []))),
        median_render_ms: median(ok.flatMap((e) => (typeof e.render_ms === 'number' ? [e.render_ms] : []))),
      };
    }
    return { summary, entries: [...this.entries] };
  }

  clear(): void {
    this.entries = [];
  }
}

export const screenTimings = new ScreenTimings();
