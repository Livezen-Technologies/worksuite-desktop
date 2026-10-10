import { z } from 'zod';

/**
 * WorkSuite Projects on this computer (WS-PROJECT-SRS-001 PRJ-DSK-02..04, PRJ-TIM-05, NFR-09): what the renderer
 * and the main process say to each other about the tray timer and the offline outbox, and the rules both sides
 * share. The screens are `src/modules/projects`; the main process's half is `electron/services/projects`.
 *
 * The server's Projects API (`/api/projects/...`) is the web's contract (web/src/pages/project/types.ts); the shapes
 * the desktop reads are mirrored in `src/modules/projects/api.ts`.
 */

export const PROJECTS_API = '/api/projects';

/** A task's status on the server (the Projects board's columns and the two that are not columns). */
export const TASK_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'testing', 'blocked', 'completed', 'cancelled'] as const;
export type ProjectTaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABEL: Record<ProjectTaskStatus, string> = {
  backlog: 'Backlog',
  todo: 'To do',
  in_progress: 'In progress',
  in_review: 'In review',
  testing: 'Testing',
  blocked: 'Blocked',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** Fifteen minutes without the keyboard or the mouse while a timer runs: the idle prompt (PRJ-TIM-05). */
export const IDLE_PROMPT_SECONDS = 15 * 60;

// ── time ───────────────────────────────────────────────────────────────────

/** Minutes as the Projects API writes a duration: "1:30", "0:05", "12:00". */
export function hhmm(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** Seconds as a running timer reads: "1:12:48". */
export function clockOf(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * A server stamp as an instant. The Projects API writes UTC, with or without the zone ("2026-10-09 08:30:00"):
 * a stamp without one is read as UTC, as the app reads every true-UTC stamp (docs/ARCHITECTURE.md › Time).
 */
export function stampMs(stamp: string | null | undefined): number | null {
  if (!stamp) return null;
  const s = stamp.trim();
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s.replace(' ', 'T') : `${s.replace(' ', 'T')}Z`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** The calendar day an instant falls on in a time zone (the logger's day, PRJ-TIM-04), YYYY-MM-DD. */
export function dayIn(ms: number, tz?: string): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
  const g = (k: string) => p.find((x) => x.type === k)?.value ?? '00';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

/** The Monday of the week a day is in. */
export function mondayOf(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

// ── the timer ──────────────────────────────────────────────────────────────

/** What a timer runs against: a task (and so its project), a project with no task, or neither ("Internal"). */
export interface TimerTarget {
  taskId: number | null;
  projectId: number | null;
}

export interface RunningTimerView {
  /** The time entry the server keeps for it. */
  id: number;
  /** When it started, ISO with a Z. */
  startedAt: string;
  taskId: number | null;
  taskNumber: string | null;
  task: string | null;
  projectId: number | null;
  projectCode: string | null;
  project: string | null;
  billable: boolean;
  /** The note for this entry: the server's, or what was typed in the mini timer since. */
  note: string | null;
}

export interface RecentTarget extends TimerTarget {
  number: string | null;
  title: string;
  /** Logged on it this week. */
  minutes: number;
}

export interface ProjectTimerState {
  /** Whether the person has Projects and the server answered for its timer. */
  available: boolean;
  running: RunningTimerView | null;
  /** Paused from the mini timer: stopped on the server, ready to start again on the same target. */
  paused: (TimerTarget & { label: string }) | null;
  /** Switch to (D02): what I logged time on this week, most recent first, not what runs now. */
  recent: RecentTarget[];
  /** Logged today and this week, the running timer not included (the screens add it as it ticks). */
  todayMinutes: number;
  weekMinutes: number;
  /** An idle prompt is showing: since when there was no keyboard or mouse, ISO. */
  idleSince: string | null;
  /** Starting or switching needs the server: true while it cannot be reached. */
  offline: boolean;
  error: string | null;
  checkedAt: string | null;
}

export const EMPTY_TIMER: ProjectTimerState = {
  available: false,
  running: null,
  paused: null,
  recent: [],
  todayMinutes: 0,
  weekMinutes: 0,
  idleSince: null,
  offline: false,
  error: null,
  checkedAt: null,
};

/** The label a target is shown with: "TSK-0412 · Bidder KYC document upload", "PRJ-0021 · SFCL website", "Internal". */
export function targetLabel(t: { taskNumber?: string | null; task?: string | null; projectCode?: string | null; project?: string | null }): string {
  if (t.task) return [t.taskNumber, t.task].filter(Boolean).join(' · ');
  if (t.project) return [t.projectCode, t.project].filter(Boolean).join(' · ');
  return 'Internal · not on a project';
}

/**
 * The one time entry a timer stopped at an earlier moment leaves (the idle prompt's "Drop idle time", and a stop
 * made while WorkSuite was out of reach): from its start to that moment, on the day it started, with its note and
 * billing. Null when nothing is left to log (it stopped within a minute of starting).
 */
export function entryUntil(r: RunningTimerView, stopAtMs: number, tz?: string): { minutes: number; body: { duration: string; on_date: string; project_id: number | null; task_id: number | null; note: string | null; is_billable: boolean } } | null {
  const start = stampMs(r.startedAt);
  if (start === null) return null;
  const minutes = Math.floor(Math.max(0, stopAtMs - start) / 60_000);
  if (minutes < 1) return null;
  return {
    minutes,
    body: { duration: hhmm(minutes), on_date: dayIn(start, tz), project_id: r.projectId, task_id: r.taskId, note: r.note ?? null, is_billable: r.billable },
  };
}

// ── the outbox ─────────────────────────────────────────────────────────────

/**
 * What the desktop keeps while WorkSuite is out of reach (PRJ-DSK-04): moves, notes (comments) and time. Approvals,
 * budget changes and change-request decisions are never kept: they wait for a connection.
 */
export type ProjectsOutboxKind = 'move' | 'comment' | 'log' | 'stop';

/**
 * - waiting: in line, sent in order when the connection is back.
 * - sending: on its way now.
 * - conflict: the task changed on the server since this was queued; it waits for the person's choice (Will ask).
 * - refused: the server said no; kept, with its reason, until the person dismisses it.
 */
export type ProjectsOutboxState = 'waiting' | 'sending' | 'conflict' | 'refused';

export interface ProjectsOutboxItem {
  id: string;
  seq: number;
  kind: ProjectsOutboxKind;
  taskId: number | null;
  /** "Move TSK-0402 to In review", "Comment on TSK-0412", "Log 1:30 on TSK-0412 · billable". */
  label: string;
  state: ProjectsOutboxState;
  message: string | null;
  createdAt: string;
  /** For a move: where I moved it. */
  status: ProjectTaskStatus | null;
  /** For a move in conflict: the task as the server has it now. */
  theirs: { status: string; updatedAt: string | null; updatedBy: string | null; number: string | null; title: string | null } | null;
}

/** The task as the server has it, compared with the copy a queued move was made from. */
export interface TaskVersion {
  status: string;
  updated_at: string | null;
}

/**
 * Whether a queued move would overwrite somebody else's change (NFR-09): the task changed on the server after the
 * copy I moved it from (its `updated_at` is not the one I saw), and not to where I moved it myself. Without a copy
 * to compare (an older screen) it is not a conflict: the board's moves are last-write-wins (NFR-07).
 */
export function isConflict(base: string | null | undefined, theirs: TaskVersion, mine: string): boolean {
  if (!base || !theirs.updated_at) return false;
  if (theirs.status === mine) return false;
  return stampMs(theirs.updated_at) !== stampMs(base) && theirs.updated_at !== base;
}

/**
 * The next queued item to send (NFR-09: in order). Waiting items go by their place in line; a move waits behind an
 * earlier move of the same task that needs the person's choice, so a later move never overtakes the decision.
 */
export function nextToSend<T extends Pick<ProjectsOutboxItem, 'seq' | 'state' | 'kind' | 'taskId'>>(items: readonly T[]): T | null {
  const sorted = [...items].sort((a, b) => a.seq - b.seq);
  const asking = new Set<number>();
  for (const i of sorted) {
    if (i.state === 'conflict' && i.taskId !== null) asking.add(i.taskId);
    if (i.state !== 'waiting') continue;
    if (i.kind === 'move' && i.taskId !== null && asking.has(i.taskId)) continue;
    return i;
  }
  return null;
}

const id = z.number().int().positive();
const label = z.string().min(1).max(240);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const stamp = z.string().max(40);

export const projectsSubmitInput = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('move'), taskId: id, status: z.enum(TASK_STATUSES), blockedReason: z.string().max(500).nullish(), baseUpdatedAt: stamp.nullish(), label }),
  z.strictObject({ kind: z.literal('comment'), taskId: id, body: z.string().min(1).max(10_000), label }),
  z.strictObject({
    kind: z.literal('log'),
    duration: z.string().regex(/^\d{1,2}:\d{2}$|^\d+(\.\d+)?h?$|^\d+m$|^\d+h\d{1,2}$/),
    onDate: ymd,
    projectId: id.nullish(),
    taskId: id.nullish(),
    note: z.string().max(1000).nullish(),
    billable: z.boolean(),
    label,
  }),
]);
export type ProjectsSubmit = z.infer<typeof projectsSubmitInput>;

export interface ProjectsSubmitResult {
  /** The server took it now. */
  delivered: boolean;
  /** Kept in the outbox, to go when the connection is back. */
  queued: boolean;
  id: string | null;
  data: unknown;
  error: string | null;
}

const target = z.strictObject({ taskId: id.nullish(), projectId: id.nullish(), billable: z.boolean().optional() });
const none = z.undefined().or(z.null()).optional();

export const projectsContract = {
  'projects:timer': { input: none, session: true },
  'projects:timerRefresh': { input: none, session: true, rate: 2 },
  'projects:timerStart': { input: target, session: true, rate: 4 },
  'projects:timerStop': { input: z.strictObject({ note: z.string().max(1000).nullish() }).nullish(), session: true, rate: 4 },
  'projects:timerSwitch': { input: target, session: true, rate: 4 },
  'projects:timerPause': { input: none, session: true, rate: 4 },
  'projects:timerResume': { input: none, session: true, rate: 4 },
  'projects:timerNote': { input: z.strictObject({ note: z.string().max(1000) }), session: true, rate: 10 },
  'projects:timerWindow': { input: none, session: true, rate: 2 },
  'projects:outbox': { input: none, session: true },
  'projects:submit': { input: projectsSubmitInput, session: true, rate: 20 },
  'projects:resolve': { input: z.strictObject({ id: z.string().max(64), choice: z.enum(['mine', 'theirs']) }), session: true, rate: 10 },
  'projects:discard': { input: z.strictObject({ id: z.string().max(64) }), session: true, rate: 10 },
  'projects:replay': { input: none, session: true, rate: 2 },
};

export interface ProjectsOutputs {
  'projects:timer': ProjectTimerState;
  'projects:timerRefresh': ProjectTimerState;
  'projects:timerStart': ProjectTimerState;
  'projects:timerStop': ProjectTimerState;
  'projects:timerSwitch': ProjectTimerState;
  'projects:timerPause': ProjectTimerState;
  'projects:timerResume': ProjectTimerState;
  'projects:timerNote': ProjectTimerState;
  'projects:timerWindow': void;
  'projects:outbox': ProjectsOutboxItem[];
  'projects:submit': ProjectsSubmitResult;
  'projects:resolve': ProjectsOutboxItem[];
  'projects:discard': ProjectsOutboxItem[];
  /** Try now: whether the server answered, and what is still waiting. */
  'projects:replay': { online: boolean; items: ProjectsOutboxItem[] };
}

/** What `projects:changed` carries: the part that changed. */
export interface ProjectsChanged {
  timer?: ProjectTimerState;
  outbox?: ProjectsOutboxItem[];
}

// ── report exports (W15, PRJ-RPT) ──────────────────────────────────────────

/** The Projects reports the server draws (`GET /api/projects/reports?kind=`), in the web's order. */
export const PROJECT_REPORT_KINDS = ['summary', 'budget', 'tasks', 'time_by_person', 'time_by_project', 'workload', 'risks', 'velocity', 'milestone_billing', 'by_client'] as const;
export type ProjectReportKind = (typeof PROJECT_REPORT_KINDS)[number];
export const PROJECT_REPORT_FORMATS = ['csv', 'xlsx', 'pdf'] as const;
export type ProjectReportFormat = (typeof PROJECT_REPORT_FORMATS)[number];

const digits = z.string().regex(/^\d{1,10}$/);

/**
 * A Projects report exported as the server renders it, as the download manager takes it (`transfers:download` with
 * `projectsReport`): by what it is, never by a path. The main process builds the address (`projectsReportPath`), so
 * a page can only ask for one of these reports with the screen's own filters.
 */
export const projectsReportSchema = z.strictObject({
  kind: z.enum(PROJECT_REPORT_KINDS),
  format: z.enum(PROJECT_REPORT_FORMATS),
  query: z
    .strictObject({
      from: ymd.optional(),
      to: ymd.optional(),
      client_id: digits.optional(),
      project_id: digits.optional(),
      org: digits.optional(),
    })
    .optional(),
});
export type ProjectsReportFile = z.infer<typeof projectsReportSchema>;

/** The server's address for a report export: `/api/projects/reports?kind=…&format=…` with the filters given. */
export function projectsReportPath(r: ProjectsReportFile): string {
  const q = new URLSearchParams({ kind: r.kind });
  for (const [k, v] of Object.entries(r.query ?? {})) if (v) q.set(k, v);
  q.set('format', r.format);
  return `${PROJECTS_API}/reports?${q.toString()}`;
}
