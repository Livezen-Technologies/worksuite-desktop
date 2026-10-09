import {
  EMPTY_TIMER,
  IDLE_PROMPT_SECONDS,
  PROJECTS_API,
  dayIn,
  entryUntil,
  hhmm,
  stampMs,
  targetLabel,
  type ProjectTimerState,
  type RecentTarget,
  type RunningTimerView,
  type TimerTarget,
} from '@shared/projects';
import { DesktopError, isDesktopError } from '../../main/errors';
import { logger } from '../../main/log';
import type { HttpClient } from '../http';
import type { Incoming } from '../notifications';
import { outcomeOf, type ProjectsOutbox } from './outbox';

const log = logger('projects-timer');

/**
 * The Projects timer in the tray (PRJ-DSK-02, PRJ-TIM-05, D02).
 *
 * The server keeps one running timer per person (PRJ-TIM-01): it is a time entry with no end yet. This reads it
 * (`GET time/running`) and this week's entries (`GET time?week=`) every minute while the person has Projects, and
 * after every change made here, for the tray, the title bar, the mini timer window and the screens.
 *
 * Start, stop and switch go to the server. "Switch to" stops what runs (that entry ends now) and starts the other,
 * so one click is two requests and two entries — one each, as if done by hand. Starting needs WorkSuite; a stop
 * made while it is out of reach is kept in the outbox with the moment it was made, and replayed as one entry.
 *
 * Idle (PRJ-TIM-05): every half minute the system's idle time is read (Electron's powerMonitor). Fifteen minutes
 * without keyboard or mouse while a timer runs raises one banner — "Still working on TSK-0412?" — with Keep 15 min
 * (nothing changes) and Drop idle time: the timer ends at the moment the idle time began. The API has no "stop at",
 * so that is the running entry removed and the time up to then logged in its place: exactly one entry, never two
 * (acceptance #11). The entry is removed first, so a failure part-way leaves at most nothing to log, which then goes
 * through the outbox and is retried until it is logged once.
 */

export const POLL_MS = 60_000;
export const IDLE_CHECK_MS = 30_000;
/** Back at the keyboard: the prompt may come again after the next fifteen idle minutes. */
const ACTIVE_SECONDS = 60;

export interface ProjectsTimerDeps {
  http: Pick<HttpClient, 'request'>;
  /** Signed in, with Projects. */
  enabled: () => boolean;
  outbox: Pick<ProjectsOutbox, 'add' | 'replay' | 'stoppedEntries'>;
  /** Shows a banner (the notification service's `notify`): its switches, quiet hours and privacy apply. */
  notify: (n: Incoming) => void;
  /** Seconds since the last keyboard or mouse input (powerMonitor.getSystemIdleTime). */
  idleSeconds: () => number;
  /** The state changed: the tray, the title bar, the mini timer and the screens. */
  changed: (s: ProjectTimerState) => void;
  now?: () => number;
  /** The person's time zone, for the day an entry is logged on (PRJ-TIM-04). The system's when not given. */
  zone?: () => string | undefined;
}

interface RunningRaw {
  id: number;
  started_at: string;
  elapsed_seconds?: number | null;
  task_id: number | null;
  task_number?: string | null;
  task?: string | null;
  project_id: number | null;
  project_code?: string | null;
  project?: string | null;
  is_billable?: boolean | number | null;
  note?: string | null;
}

interface EntryRaw {
  id: number;
  project: string | null;
  project_code: string | null;
  project_id: number | null;
  task: string | null;
  task_number: string | null;
  task_id: number | null;
  on_date: string;
  started_at: string | null;
  minutes: number;
  running?: boolean;
}

/** The server's running timer as the desktop shows it. A stamp without a zone and the elapsed seconds beside it: the elapsed wins. */
export function runningOf(r: RunningRaw | null | undefined, now: number, names: EntryRaw[] = []): RunningTimerView | null {
  if (!r || !Number.isSafeInteger(Number(r.id))) return null;
  const elapsed = Number(r.elapsed_seconds);
  const started = Number.isFinite(elapsed) && elapsed >= 0 ? now - elapsed * 1000 : (stampMs(r.started_at) ?? now);
  const same = names.find((e) => (r.task_id ? e.task_id === r.task_id : e.project_id === r.project_id && !e.task_id));
  return {
    id: Number(r.id),
    startedAt: new Date(started).toISOString(),
    taskId: r.task_id ? Number(r.task_id) : null,
    taskNumber: r.task_number ?? same?.task_number ?? null,
    task: r.task ?? same?.task ?? null,
    projectId: r.project_id ? Number(r.project_id) : null,
    projectCode: r.project_code ?? same?.project_code ?? null,
    project: r.project ?? same?.project ?? null,
    billable: r.is_billable === undefined || r.is_billable === null ? true : !!r.is_billable,
    note: r.note ?? null,
  };
}

/** Switch to (D02): what was logged this week, most recent first, each once, without what runs now. */
export function recentTargets(entries: EntryRaw[], running: TimerTarget | null, max = 4): RecentTarget[] {
  const key = (t: { task_id: number | null; project_id: number | null }) => (t.task_id ? `t${t.task_id}` : `p${t.project_id ?? 0}`);
  const runningKey = running ? (running.taskId ? `t${running.taskId}` : `p${running.projectId ?? 0}`) : null;
  const sorted = [...entries].sort((a, b) => (a.on_date === b.on_date ? (stampMs(b.started_at) ?? b.id) - (stampMs(a.started_at) ?? a.id) : a.on_date < b.on_date ? 1 : -1));
  const out = new Map<string, RecentTarget>();
  for (const e of sorted) {
    const k = key(e);
    const minutes = e.running ? 0 : Number(e.minutes) || 0;
    const had = out.get(k);
    if (had) {
      had.minutes += minutes;
      continue;
    }
    out.set(k, {
      taskId: e.task_id,
      projectId: e.project_id,
      number: e.task_number ?? e.project_code ?? null,
      title: e.task ?? (e.project ? `${e.project} — no task` : 'Internal · not on a project'),
      minutes,
    });
  }
  return [...out.entries()].filter(([k]) => k !== runningKey).slice(0, max).map(([, v]) => v);
}

export class ProjectsTimer {
  private state: ProjectTimerState = { ...EMPTY_TIMER };
  private poll: NodeJS.Timeout | null = null;
  private idle: NodeJS.Timeout | null = null;
  /** The idle prompt was raised for this stretch of idle time. */
  private prompted = false;
  private readonly now: () => number;

  constructor(private readonly d: ProjectsTimerDeps) {
    this.now = d.now ?? Date.now;
  }

  get(): ProjectTimerState {
    return this.state;
  }

  start(): void {
    this.stop();
    void this.refresh();
    this.poll = setInterval(() => void this.refresh(), POLL_MS);
    this.poll.unref?.();
    this.idle = setInterval(() => void this.checkIdle(), IDLE_CHECK_MS);
    this.idle.unref?.();
  }

  stop(): void {
    if (this.poll) clearInterval(this.poll);
    if (this.idle) clearInterval(this.idle);
    this.poll = null;
    this.idle = null;
    this.prompted = false;
    this.set({ ...EMPTY_TIMER });
  }

  private set(next: ProjectTimerState): ProjectTimerState {
    this.state = next;
    this.d.changed(next);
    return next;
  }

  private today(): string {
    return dayIn(this.now(), this.d.zone?.());
  }

  /** The running timer and this week's totals, from the server. */
  async refresh(): Promise<ProjectTimerState> {
    if (!this.d.enabled()) return this.set({ ...EMPTY_TIMER });
    const today = this.today();
    const [running, week] = await Promise.allSettled([
      this.d.http.request<{ timer?: RunningRaw | null }>('GET', `${PROJECTS_API}/time/running`),
      this.d.http.request<{ entries?: EntryRaw[] }>('GET', `${PROJECTS_API}/time`, { query: { week: today, scope: 'mine' } }),
    ]);
    if (running.status === 'rejected') {
      const { outcome, message } = outcomeOf(running.reason);
      const offline = outcome === 'offline';
      // Out of reach: what was known stays (the timer keeps running on the server). Without the API: nothing to show.
      const missing = isDesktopError(running.reason) && (running.reason.code === 'NOT_FOUND' || running.reason.code === 'APP_ACCESS_DENIED' || running.reason.code === 'PERMISSION_DENIED');
      return this.set({ ...this.state, available: missing ? false : this.state.available, running: missing ? null : this.state.running, offline, error: offline || missing ? null : message });
    }
    const entries = week.status === 'fulfilled' ? (week.value?.entries ?? []) : [];
    let timer = runningOf(running.value?.timer ?? null, this.now(), entries);
    // Stopped here while WorkSuite was out of reach, and not replayed yet: it is not running any more.
    if (timer && this.d.outbox.stoppedEntries().has(timer.id)) timer = null;
    // A note typed in the mini timer stays with the timer it was typed for.
    if (timer && this.state.running?.id === timer.id && this.state.running.note && !timer.note) timer.note = this.state.running.note;
    const done = entries.filter((e) => !e.running);
    const totals =
      week.status === 'fulfilled'
        ? { todayMinutes: done.filter((e) => e.on_date === today).reduce((n, e) => n + (Number(e.minutes) || 0), 0), weekMinutes: done.reduce((n, e) => n + (Number(e.minutes) || 0), 0), recent: recentTargets(entries, timer) }
        : { todayMinutes: this.state.todayMinutes, weekMinutes: this.state.weekMinutes, recent: this.state.recent };
    return this.set({
      ...this.state,
      ...totals,
      available: true,
      running: timer,
      paused: timer ? null : this.state.paused,
      idleSince: timer ? this.state.idleSince : null,
      offline: false,
      error: null,
      checkedAt: new Date(this.now()).toISOString(),
    });
  }

  private refused(e: unknown, fallback: string): never {
    const { outcome, message } = outcomeOf(e);
    if (outcome === 'offline') {
      this.set({ ...this.state, offline: true });
      throw new DesktopError('NETWORK_UNREACHABLE', fallback);
    }
    throw new DesktopError(isDesktopError(e) ? e.code : 'SERVER_ERROR', message);
  }

  /** Starts a timer on a task, a project, or neither. One runs at a time: the server stops any other first. */
  async begin(t: TimerTarget & { billable?: boolean }): Promise<ProjectTimerState> {
    try {
      await this.d.http.request('POST', `${PROJECTS_API}/time/start`, { body: { task_id: t.taskId ?? null, project_id: t.projectId ?? null, ...(t.billable === undefined ? {} : { is_billable: t.billable }) } });
    } catch (e) {
      this.refused(e, 'Starting a timer needs a connection to WorkSuite. Log the time instead when you are done.');
    }
    this.prompted = false;
    this.state = { ...this.state, paused: null, idleSince: null };
    return this.refresh();
  }

  /** Stops the timer now: the server ends its entry. Out of reach, the stop is kept with its moment. */
  async end(note?: string | null): Promise<ProjectTimerState> {
    const r = this.state.running;
    if (note !== undefined && note !== null && r) r.note = note;
    try {
      await this.d.http.request('POST', `${PROJECTS_API}/time/stop`, { body: r?.note ? { note: r.note } : {} });
    } catch (e) {
      const { outcome } = outcomeOf(e);
      if (outcome === 'offline' && r) return this.keepStop(r, this.now());
      // Nothing was running on the server (stopped elsewhere): what this shows is out of date.
      if (isDesktopError(e) && e.code === 'CONFLICT') return this.refresh();
      this.refused(e, 'The timer could not be stopped.');
    }
    this.state = { ...this.state, idleSince: null };
    return this.refresh();
  }

  /** Switch to (D02): what runs stops, the other starts — one click. */
  async switchTo(t: TimerTarget): Promise<ProjectTimerState> {
    if (this.state.offline && this.state.running) throw new DesktopError('NETWORK_UNREACHABLE', 'Switching needs a connection to WorkSuite.');
    if (this.state.running) await this.end();
    return this.begin(t);
  }

  /** Pause (the mini timer): stopped now, kept ready to start again on the same task. */
  async pause(): Promise<ProjectTimerState> {
    const r = this.state.running;
    if (!r) return this.state;
    const s = await this.end();
    return this.set({ ...s, paused: { taskId: r.taskId, projectId: r.projectId, label: targetLabel(r) } });
  }

  async resume(): Promise<ProjectTimerState> {
    const p = this.state.paused;
    if (!p) return this.state;
    return this.begin({ taskId: p.taskId, projectId: p.projectId });
  }

  /** The note typed in the mini timer: sent with the stop. */
  note(text: string): ProjectTimerState {
    const r = this.state.running;
    if (!r) return this.state;
    return this.set({ ...this.state, running: { ...r, note: text.trim() || null } });
  }

  /** A stop made while WorkSuite is out of reach: kept, with the moment it was made, as one entry to come. */
  private keepStop(r: RunningTimerView, at: number): ProjectTimerState {
    const entry = entryUntil(r, at, this.d.zone?.());
    const when = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    this.d.outbox.add('stop', { entry_id: r.id, log: entry?.body ?? null }, { label: `Stop the timer on ${r.taskNumber ?? targetLabel(r)} at ${when}${entry ? ` · ${hhmm(entry.minutes)}` : ''}`, taskId: r.taskId });
    return this.set({ ...this.state, running: null, idleSince: null, offline: true, weekMinutes: this.state.weekMinutes + (entry?.minutes ?? 0), todayMinutes: this.state.todayMinutes + (entry?.minutes ?? 0) });
  }

  /**
   * Ends the running timer at an earlier moment (Drop idle time): its entry removed, the time up to `at` logged in
   * its place — one entry. Out of reach, both wait in the outbox as one item. A server that will not remove the
   * entry keeps the full time instead (a plain stop), so there is still one entry, never two.
   */
  async stopAt(at: number): Promise<ProjectTimerState> {
    const r = this.state.running;
    if (!r) return this.state;
    const entry = entryUntil(r, at, this.d.zone?.());
    try {
      await this.d.http.request('DELETE', `${PROJECTS_API}/time/${r.id}`);
    } catch (e) {
      const { outcome, message } = outcomeOf(e);
      if (outcome === 'offline' || outcome === 'later') return this.keepStop(r, at);
      if (isDesktopError(e) && e.code === 'NOT_FOUND') return this.refresh();
      log.info('idle time not dropped; the timer stops with it', { error: message });
      await this.end();
      return this.set({ ...this.state, error: `The idle time could not be dropped: ${message} The timer was stopped with it.` });
    }
    this.state = { ...this.state, running: null, idleSince: null };
    if (entry) {
      try {
        await this.d.http.request('POST', `${PROJECTS_API}/time/log`, { body: entry.body });
      } catch (e) {
        // The running entry is gone already: the time to log waits in the outbox, to be logged once.
        const { outcome, message } = outcomeOf(e);
        const item = this.d.outbox.add('log', entry.body, { label: `Log ${hhmm(entry.minutes)} on ${r.taskNumber ?? targetLabel(r)}${r.billable ? ' · billable' : ''}`, taskId: r.taskId });
        if (outcome !== 'offline' && outcome !== 'later') log.info('time after idle not logged; kept in the outbox', { error: message, kept: !!item });
        void this.d.outbox.replay();
      }
    }
    return this.refresh();
  }

  /** Every half minute: fifteen idle minutes with a timer running raise the prompt, once per stretch. */
  checkIdle(): void {
    const r = this.state.running;
    if (!r || !this.d.enabled()) {
      this.prompted = false;
      return;
    }
    let idle = 0;
    try {
      idle = this.d.idleSeconds();
    } catch {
      return;
    }
    if (idle < ACTIVE_SECONDS) {
      this.prompted = false;
      if (this.state.idleSince) this.set({ ...this.state, idleSince: null });
      return;
    }
    if (idle < IDLE_PROMPT_SECONDS || this.prompted) return;
    this.prompted = true;
    const since = this.now() - idle * 1000;
    // Not before the timer started: idle time from before it is not the timer's.
    const from = Math.max(since, stampMs(r.startedAt) ?? since);
    this.set({ ...this.state, idleSince: new Date(from).toISOString() });
    const who = r.taskNumber ?? (r.task ? `“${r.task}”` : (r.projectCode ?? 'this timer'));
    this.d.notify({
      id: `projects-idle:${r.id}:${from}`,
      module: 'projects',
      category: 'projects',
      title: `Still working on ${who}?`,
      body: `No keyboard or mouse for ${Math.round(idle / 60)} minutes. Keep the time or drop the idle part.`,
      sender: null,
      link: '/projects/time',
      critical: false,
      custom: {
        actions: ['Keep 15 min', 'Drop idle time'],
        persistent: true,
        onAction: async (index) => {
          // The same timer still running: anything else was decided elsewhere meanwhile.
          if (this.state.running?.id !== r.id) return;
          if (index === 1) await this.stopAt(from);
          else this.set({ ...this.state, idleSince: null });
        },
      },
    });
  }
}
