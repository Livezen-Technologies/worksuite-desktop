import { logger } from '../main/log';

const log = logger('meet-next');

/**
 * The next meeting, for the tray and the Join next key (WS-MEET-ENH-01 D04).
 *
 * The tray's Meet section reads "Join next: Weekly design review", which means
 * the main process has to know what that meeting is with no window open. It
 * asks the same `GET /api/meet/upcoming` the Meet home asks, once a minute
 * while somebody who has Meet is signed in, and again when the computer wakes
 * or their apps change.
 *
 * Deliberately quiet about failure: a server a part behind has no endpoint
 * (404) and somebody whose role lost Meet is refused (403) — then the tray
 * simply has no Meet lines. Offline, the last answer stays until the server
 * answers again, because a meeting that was in ten minutes still is.
 */

/** One row of `GET /api/meet/upcoming`, as much of it as this needs. */
export interface UpcomingMeeting {
  uuid: string;
  title: string | null;
  scheduled_at: string | null;
  ends_at: string | null;
}

/** What the tray shows for Meet. */
export interface TrayMeet {
  /** The meeting Join next would open, or null when there is nothing to join. */
  next: { uuid: string; title: string } | null;
  /** This computer is in a meeting: mute and the camera are worth offering. */
  inCall: boolean;
}

/** Fifteen minutes before it starts, as the Meet home has it (`src/modules/meet/home.ts`). */
const EARLY_MS = 15 * 60_000;
const DEFAULT_LENGTH_MS = 60 * 60_000;

const time = (value: string | null | undefined): number | null => {
  if (typeof value !== 'string' || value === '') return null;

  // The server sends `2026-10-10 10:00:00` as well as ISO; both parse once the
  // space is a T. A date that does not parse is treated as no date at all
  // rather than as 1970, which would make it the most urgent meeting there is.
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2} /.test(value) ? `${value.replace(' ', 'T')}Z` : value);

  return Number.isFinite(ms) ? ms : null;
};

/**
 * The meeting to join now: the one that has started, else the soonest within
 * a quarter of an hour. Null when there is nothing — and null is a real
 * answer, which is why the tray line is absent rather than disabled.
 *
 * Joinable means the same thing here as on the Meet home, so the tray and the
 * page never disagree about what "next" is.
 */
export function nextMeeting(rows: UpcomingMeeting[] | null | undefined, now: number): UpcomingMeeting | null {
  if (!Array.isArray(rows)) return null;

  const joinable = rows
    .filter((r) => r && typeof r.uuid === 'string' && r.uuid !== '')
    .map((r) => ({ row: r, start: time(r.scheduled_at) }))
    .filter((x): x is { row: UpcomingMeeting; start: number } => x.start !== null)
    .filter(({ row, start }) => {
      const end = time(row.ends_at) ?? start + DEFAULT_LENGTH_MS;

      return now >= start - EARLY_MS && now <= end;
    })
    .sort((a, b) => a.start - b.start);

  return joinable[0]?.row ?? null;
}

/** The title to show, for a meeting whose own is empty. */
export const meetingLabel = (m: UpcomingMeeting | null): string => (m?.title ?? '').trim() || 'A meeting';

export interface MeetNextDeps {
  get: <T>(path: string, query?: Record<string, string>) => Promise<T>;
  /** Signed in, unlocked, and Meet among the apps this person may open. */
  allowed: () => boolean;
  /** This computer is in a meeting. */
  inCall: () => boolean;
  /** What the tray shows changed. */
  onChange: (tray: TrayMeet | null) => void;
  now?: () => number;
  every?: number;
}

const statusOf = (e: unknown): number | null => {
  const s = (e as { status?: unknown } | null)?.status;

  return typeof s === 'number' ? s : null;
};

export class MeetNext {
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy: Promise<void> | null = null;
  private rows: UpcomingMeeting[] | null = null;
  /** What the tray was last told, compared as text so it is rebuilt only on a change. */
  private shown = 'null';

  constructor(private readonly deps: MeetNextDeps) {}

  start(): void {
    this.stop();
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.deps.every ?? 60_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.rows = null;
    this.publish();
  }

  /** Ask now: the computer woke, the person's apps changed, a meeting ended. */
  poke(): void {
    if (this.timer) void this.refresh();
  }

  /**
   * What the tray should show as things are. Also called without a fresh
   * answer — a meeting becomes joinable by the clock, not by a request.
   */
  publish(): void {
    const tray = this.tray();
    const key = JSON.stringify(tray);

    if (key === this.shown) return;

    this.shown = key;

    try {
      this.deps.onChange(tray);
    } catch (e) {
      log.debug('meet next listener failed', { error: String(e) });
    }
  }

  private tray(): TrayMeet | null {
    if (!this.deps.allowed()) return null;

    const inCall = this.deps.inCall();
    const next = nextMeeting(this.rows, (this.deps.now ?? Date.now)());

    // Nothing to join and not in a call: no Meet lines at all, rather than a
    // section of disabled ones.
    if (!next && !inCall) return null;

    return { next: next ? { uuid: next.uuid, title: meetingLabel(next) } : null, inCall };
  }

  refresh(): Promise<void> {
    this.busy ??= this.load().finally(() => {
      this.busy = null;
    });

    return this.busy;
  }

  private async load(): Promise<void> {
    if (!this.deps.allowed()) {
      this.rows = null;
      this.publish();

      return;
    }

    try {
      const answer = await this.deps.get<{ meetings?: UpcomingMeeting[] }>('/api/meet/upcoming');

      this.rows = Array.isArray(answer?.meetings) ? answer.meetings : [];
    } catch (e) {
      const status = statusOf(e);

      // No endpoint on this server, or no Meet for this person: no lines, silently.
      if (status === 401 || status === 403 || status === 404) this.rows = null;
      // Offline or the server busy: the last answer stays. A meeting that was
      // in ten minutes still is.
      else log.debug('upcoming meetings unavailable', { status });
    }
    this.publish();
  }
}
