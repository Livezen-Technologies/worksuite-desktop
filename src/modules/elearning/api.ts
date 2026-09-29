import { ApiError, apiGet, apiGetMeta, request } from '../../core/api';
import { app } from '../../core/app-state';
import { call } from '../../core/bridge';
import { useStore } from '../../core/store';

/**
 * eLearning (the server's `/api/elearning/v1`, phase P1 — Core LMS): courses,
 * lessons, enrolment, progress, quizzes, assignments and grading.
 *
 * THE SERVER DECIDES. Who may do what to which course (`options.can`, a
 * course's own `can`), when a lesson is open (423 with the reason), what a
 * video's seconds are worth (credited from the ranges played, never faster
 * than time allows), whether a course is complete, and every score. The
 * screens show what it answers and send what happened; they never work any
 * of it out.
 *
 * REFUSALS ARE SENTENCES. A failure's `message` is shown as it is;
 * `errors.code` (`revision_conflict`, `locked`, `timed`, `full`,
 * `setup_required`…) says what to offer next.
 *
 * WRITES THAT CAN BE PRESSED TWICE CARRY AN IDEMPOTENCY KEY (create a course
 * or category, duplicate, assign learners, join, start an attempt, submit an
 * assignment), made once per attempt.
 */

export const BASE = '/api/elearning/v1';

type Query = Record<string, string | number | boolean | null | undefined>;

export function eGet<T>(path: string, query?: Query, signal?: AbortSignal): Promise<T> {
  return apiGet<T>(`${BASE}${path}`, query, signal);
}

/** A read that may come from the last copy (READ_CACHE): says so. */
export async function eGetMeta<T>(path: string, query?: Query, signal?: AbortSignal): Promise<{ data: T; offline: boolean; cachedAt: string | null }> {
  const r = await apiGetMeta<T>(`${BASE}${path}`, query, signal);
  return { data: r.data, offline: r.offline, cachedAt: r.cachedAt };
}

/** A write; the server's own sentence comes back beside what it made. */
export async function ePost<T = unknown>(path: string, body: unknown = {}, key?: string): Promise<{ data: T; message: string }> {
  const r = await request<T>('POST', `${BASE}${path}`, { body, headers: key ? { 'Idempotency-Key': key } : undefined });
  return { data: r.data, message: r.message ?? 'Done.' };
}

export async function ePut<T = unknown>(path: string, body: unknown = {}): Promise<{ data: T; message: string }> {
  const r = await request<T>('PUT', `${BASE}${path}`, { body });
  return { data: r.data, message: r.message ?? 'Saved.' };
}

/** Multipart (an assignment's files from this computer); the proxy takes up to 25 MB a request. */
export async function ePostForm<T = unknown>(path: string, form: FormData, key?: string): Promise<{ data: T; message: string }> {
  const r = await request<T>('POST', `${BASE}${path}`, { body: form, headers: key ? { 'Idempotency-Key': key } : undefined });
  return { data: r.data, message: r.message ?? 'Done.' };
}

export const MAX_UPLOAD = 25 * 1024 * 1024;

export function newKey(prefix = 'eln'): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${rand}`;
}

export function errorText(e: unknown, fallback = 'That could not be done. Try again.'): string {
  return e instanceof Error && e.message.trim() ? e.message : fallback;
}

/** What the server sent beside a refusal (`errors`): `{code, …}`. */
export function refusal(e: unknown): ({ code?: string } & Record<string, unknown>) | null {
  return e instanceof ApiError && e.data && typeof e.data === 'object' ? (e.data as { code?: string } & Record<string, unknown>) : null;
}

export function refusalCode(e: unknown): string | null {
  const r = refusal(e);
  return typeof r?.code === 'string' ? r.code : null;
}

export const unreachable = (e: unknown) => e instanceof ApiError && (e.status === 0 || e.status === 503);

/** Whether WorkSuite can be reached from this computer. Writes wait for it; reads may come from the last copy. */
export function useOnline(): boolean {
  return useStore(app, (s) => s.status?.network !== 'OFFLINE');
}

export const OFFLINE = 'You are offline. This needs WorkSuite; try again once you are back online.';

export const K = {
  all: ['elearning'] as const,
  options: (org: string) => ['elearning', 'options', org] as const,
  my: ['elearning', 'my'] as const,
  catalog: (f: object) => ['elearning', 'catalog', f] as const,
  about: (id: number) => ['elearning', 'about', id] as const,
  taking: (id: number) => ['elearning', 'taking', id] as const,
  lesson: (id: number) => ['elearning', 'lesson', id] as const,
  myAssessment: (id: number) => ['elearning', 'my-assessment', id] as const,
  attempt: (id: number) => ['elearning', 'attempt', id] as const,
  myAssignment: (id: number) => ['elearning', 'my-assignment', id] as const,
  offline: ['elearning', 'offline'] as const,
  categories: (org: string, archived: boolean) => ['elearning', 'categories', org, archived] as const,
  overview: (org: string) => ['elearning', 'overview', org] as const,
  setup: (org: string) => ['elearning', 'setup', org] as const,
  courses: (f: object) => ['elearning', 'courses', f] as const,
  course: (id: number) => ['elearning', 'course', id] as const,
  structure: (id: number) => ['elearning', 'structure', id] as const,
  staffLesson: (id: number) => ['elearning', 'staff-lesson', id] as const,
  activity: (id: number) => ['elearning', 'activity', id] as const,
  reviews: ['elearning', 'reviews'] as const,
  assessments: (course: number) => ['elearning', 'assessments', course] as const,
  assessment: (id: number) => ['elearning', 'assessment', id] as const,
  assessmentAttempts: (id: number) => ['elearning', 'assessment-attempts', id] as const,
  assignments: (course: number) => ['elearning', 'assignments', course] as const,
  assignment: (id: number) => ['elearning', 'assignment', id] as const,
  submissions: (id: number) => ['elearning', 'submissions', id] as const,
  enrollments: (f: object) => ['elearning', 'enrollments', f] as const,
  enrollment: (id: number) => ['elearning', 'enrollment', id] as const,
  approvals: ['elearning', 'approvals'] as const,
  learners: (f: object) => ['elearning', 'learners', f] as const,
  learner: (id: number) => ['elearning', 'learner', id] as const,
  grading: (f: object) => ['elearning', 'grading', f] as const,
  staffAttempt: (id: number) => ['elearning', 'staff-attempt', id] as const,
  submission: (id: number) => ['elearning', 'submission', id] as const,
  preview: (id: number) => ['elearning', 'preview', id] as const,
  previewLesson: (id: number) => ['elearning', 'preview-lesson', id] as const,
};

// ── heartbeats (§5.4, FR-VID-03) ─────────────────────────────────────────

/**
 * The seconds of a video actually played since the last heartbeat, as
 * ranges. A jump (a seek, or the playhead moving further than the time
 * that passed allows) closes a range and starts another at the new place;
 * the server merges them and credits only new coverage, no faster than time
 * allows — so the player reports what happened and nothing more.
 */
export class PlayedRanges {
  private ranges: Array<[number, number]> = [];
  private open: [number, number] | null = null;
  private lastWall: number | null = null;

  /** The playhead at `t` seconds, `wall` ms of real time; `rate` the playback speed. */
  tick(t: number, wall: number, rate = 1): void {
    if (!Number.isFinite(t) || t < 0) return;
    if (this.open && this.lastWall !== null) {
      const since = Math.max(0, (wall - this.lastWall) / 1000);
      const moved = t - this.open[1];
      // Continuous: forward, and no further than the time that passed at this speed (with a little give).
      if (moved >= 0 && moved <= since * Math.max(1, rate) + 1.5) {
        this.open[1] = t;
        this.lastWall = wall;
        return;
      }
      this.close();
    }
    this.open = [t, t];
    this.lastWall = wall;
  }

  /** Playback stopped (pause, seek, end): the open range ends where it is. */
  close(): void {
    if (this.open && this.open[1] > this.open[0]) this.ranges.push([round1(this.open[0]), round1(this.open[1])]);
    this.open = null;
    this.lastWall = null;
  }

  /** Ranges played since the last take; an open range is split, carrying on from its end. */
  take(): Array<[number, number]> {
    if (this.open && this.open[1] > this.open[0]) {
      this.ranges.push([round1(this.open[0]), round1(this.open[1])]);
      this.open = [this.open[1], this.open[1]];
    }
    const out = this.ranges;
    this.ranges = [];
    return out;
  }

  get pending(): boolean {
    return this.ranges.length > 0 || (!!this.open && this.open[1] > this.open[0]);
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export interface Beat {
  position?: number | string;
  ranges?: Array<[number, number]>;
  pages?: number[];
  scrolled_to_end?: boolean;
}

export interface BeatAnswer {
  credited_seconds: number;
  trimmed: boolean;
  duration_known?: boolean;
  progress: Progress;
}

/** A beat that records something (played ranges, pages, the end reached), not just time passing. */
export function beatCarries(beat: Beat): boolean {
  return !!beat.ranges?.length || !!beat.pages?.length || beat.scrolled_to_end === true;
}

/**
 * One heartbeat. With WorkSuite out of reach, one that records something
 * waits in the offline queue (a kept lesson played offline) and is sent in
 * order when the line is back; the server credits it against the time since
 * the course was downloaded. A beat that only marks time is dropped offline
 * rather than filling the queue.
 */
export async function sendBeat(lessonId: number, beat: Beat, label: string): Promise<{ answer: BeatAnswer | null; queued: boolean }> {
  try {
    const r = await ePost<BeatAnswer>(`/me/lessons/${lessonId}/progress`, beat);
    return { answer: r.data, queued: false };
  } catch (e) {
    if (!unreachable(e)) throw e;
    if (!beatCarries(beat)) return { answer: null, queued: false };
  }
  const r = await call('offline:submit', {
    module: 'elearning',
    entity: 'progress',
    entityId: String(lessonId),
    label,
    method: 'POST',
    path: `${BASE}/me/lessons/${lessonId}/progress`,
    body: beat,
    queueIfOffline: true,
  });
  if (r.delivered) return { answer: (r.data as BeatAnswer | null) ?? null, queued: false };
  if (!r.queued) throw new Error(r.error ?? 'Progress was not recorded.');
  return { answer: null, queued: true };
}

/** A lesson file the lesson allows downloading, saved to the downloads folder through the download manager. */
export async function saveLessonFile(downloadUrl: string, name: string): Promise<void> {
  const m = /^\/media\/([A-Za-z0-9_\-~.]{8,512})(\?download=1)?$/.exec(downloadUrl);
  if (!m) throw new Error('This file cannot be saved from here.');
  await call('transfers:download', { elearningMedia: m[1]!, name: name.replace(/[/\\]/g, '-').slice(0, 255) || 'lesson', open: false });
}

// ── shapes (as the server sends them) ───────────────────────────────────

export interface Paged<T> {
  items: T[];
  meta: { total: number; page: number; per_page: number; pages: number };
}

export interface Choice {
  value: string;
  label: string;
  available?: boolean;
  why?: string;
}

export interface LessonTypeChoice extends Choice {
  rules?: string[];
  default_rule?: string;
}

export interface SetupStep { key: string; title: string; what: string; kind: 'required' | 'default' | 'skip'; done: boolean; skipped: boolean; todo: string }
export interface SetupStatus { steps: SetupStep[]; next: string | null; ready_to_publish: boolean; ready: boolean; complete: boolean; done: number; total: number; manage?: boolean; added?: number }

export interface Options {
  org: number;
  companies: { id: number; name: string }[];
  /** Every permission, `elearning.` taken off and dots made `_` (`course_view`), plus `manager` and `staff`. */
  can: Record<string, boolean>;
  scope: string;
  setup: SetupStatus;
  course_types: Choice[];
  statuses: Choice[];
  levels: string[];
  default_language: string;
  enrollment_types: Choice[];
  visibility: Choice[];
  lesson_types: LessonTypeChoice[];
  completion_rules: Choice[];
  course_conditions: Choice[];
  staff_roles: Choice[];
  review_required: boolean;
}

export type CourseStatus = 'DRAFT' | 'REVIEW' | 'APPROVED' | 'PUBLISHED' | 'SUSPENDED' | 'ARCHIVED';

export interface CourseCard {
  id: number;
  org_id: number;
  code: string;
  title: string;
  summary: string | null;
  status: CourseStatus;
  version: number;
  course_type: string;
  level: string | null;
  language: string | null;
  estimated_minutes: number | null;
  visibility: string;
  enrollment_type: string;
  category: { id: number; name: string } | null;
  instructor: { id: number; name: string } | null;
  lessons: number;
  enrolled: number;
  thumbnail_file_id: number | null;
  start_at: string | null;
  end_at: string | null;
  published_at: string | null;
  updated_at: string | null;
}

export type Condition =
  | { type: 'ALL_MANDATORY_LESSONS' }
  | { type: 'MIN_PROGRESS'; percent: number }
  | { type: 'PASS_ASSESSMENT'; assessment_id: number; min_score?: number | null }
  | { type: 'COMPLETE_ASSIGNMENT'; assignment_id: number };
export interface RuleGroup { op: 'AND' | 'OR'; conditions: Array<Condition | RuleGroup> }

export interface CourseCan {
  edit: boolean; submit: boolean; recall: boolean; review: boolean; publish: boolean; suspend: boolean; resume: boolean; archive: boolean;
  reopen: boolean; delete: boolean; duplicate: boolean; enroll: boolean; enrollments: boolean; assessments: boolean; assignments: boolean;
}

export interface Staff { id: number; user_id: number; name: string; role: string; label: string }

export interface Course extends CourseCard {
  description: string | null;
  objectives: string[];
  due_days: number | null;
  capacity: number | null;
  passing_score: number | null;
  completion_rule: RuleGroup | null;
  completion_rule_effective: RuleGroup | null;
  progress_weighting: string | null;
  certificate_enabled: boolean;
  validity_months: number | null;
  revision: number;
  publish_at: string | null;
  suspended_at: string | null;
  suspend_reason: string | null;
  archived_at: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  review_note: string | null;
  category_path: string | null;
  staff: Staff[];
  my_roles: string[];
  can: CourseCan;
  review: null | { required: boolean; request_id: number | null; may_decide: boolean; trail: Array<Record<string, unknown>> };
  created_by: { id: number; name: string } | null;
  created_at: string | null;
}

export interface Media { status: 'ready' | 'processing' | 'failed' | 'quarantined' | 'missing'; duration_sec: number | null; jobs: number }

export interface LessonCard {
  id: number;
  section_id: number;
  title: string;
  lesson_type: string;
  completion_rule: string;
  rule_label: string;
  rule_settings: Record<string, unknown> | null;
  is_mandatory: boolean;
  duration_min: number | null;
  release_at: string | null;
  prerequisite_lesson_id: number | null;
  allow_download: boolean;
  page_count: number | null;
  assessment_id: number | null;
  assignment_id: number | null;
  sort: number;
}

export interface StaffLesson extends LessonCard {
  is_published: boolean;
  is_hidden: boolean;
  file_id: number | null;
  url: string | null;
  media: Media | null;
  media_seconds: number | null;
  body?: string | null;
  course_id?: number;
}

export interface Section<L = StaffLesson> { id: number; title: string; description: string | null; sort: number; is_published: boolean; is_hidden: boolean; lessons: L[] }
export interface Structure { course_id: number; revision: number; sections: Section[] }

export interface Progress {
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
  percent: number;
  position: string | number | null;
  watched_seconds: number;
  duration_sec: number | null;
  pages_viewed: number[];
  scrolled_to_end: boolean;
  time_spent: number;
  started_at: string | null;
  completed_at: string | null;
}

export interface FileContent {
  status: Media['status'];
  name: string;
  mime: string | null;
  size: number;
  extension: string;
  duration_sec: number | null;
  downloadable: boolean;
  urls: { source?: string; hls?: string; poster?: string; art?: string; view?: string; download?: string };
  tracks: Array<{ id: number; label: string | null; lang: string | null; kind: string; is_default: boolean; url: string }>;
  message?: string;
}

export interface LearnerLesson extends LessonCard {
  course_id?: number;
  body?: string | null;
  url?: string | null;
  file?: FileContent | null;
  assessment?: AssessmentCard;
  assignment?: AssignmentCard;
}

export interface OpenLesson {
  lesson: LearnerLesson;
  progress: Progress;
  previous_lesson_id: number | null;
  next_lesson_id: number | null;
}

export type EnrollmentStatus = 'PENDING_APPROVAL' | 'ENROLLED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'WITHDRAWN';

export interface Enrollment {
  id: number;
  course_id: number;
  course_version: number;
  course: { id: number; code: string; title: string };
  learner: { id: number; name: string };
  enrollment_type: string;
  source_ref: string | null;
  assigned_by: { id: number; name: string } | null;
  status: EnrollmentStatus;
  overdue: boolean;
  due_at: string | null;
  is_mandatory: boolean;
  enrolled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  last_activity_at: string | null;
  progress_percent: number;
  final_score: number | null;
  completion_source: string | null;
  withdrawn_at: string | null;
  withdraw_reason: string | null;
  created_at: string | null;
}

export interface CheckItem { type: string; label: string; met?: boolean; [k: string]: unknown }

export interface EnrollmentDetail extends Enrollment {
  lessons?: Array<LessonCard & { progress: Progress }>;
  completion?: CheckItem[];
  can: { manage: boolean; decide: boolean };
  history?: Array<{ id: number; action: string; by: string | null; at: string; reason: string | null }>;
}

export interface CatalogCard extends CourseCard {
  enrollment: null | { id: number; status: EnrollmentStatus; progress_percent: number; due_at: string | null; overdue: boolean; is_mandatory: boolean };
  can_enroll: boolean;
  reason?: string;
}

export interface CatalogAbout extends CatalogCard {
  description: string | null;
  objectives: string[];
  outline: Array<{ id: number; title: string; lessons: Array<{ id: number; title: string; lesson_type: string; duration_min: number | null; is_mandatory: boolean }> }>;
  capacity: number | null;
  places_left: number | null;
  requires_approval: boolean;
  why_not: string | null;
  completion: CheckItem[];
}

export interface LearningItem extends CourseCard {
  enrollment: Enrollment;
  resume_lesson_id: number | null;
}

export interface MyLearning {
  counters: { assigned: number; in_progress: number; completed: number; certificates: number; overdue: number; pending: number };
  continue: LearningItem[];
  assigned: LearningItem[];
  in_progress: LearningItem[];
  pending: LearningItem[];
  deadlines: Array<{ kind: 'course'; course_id: number; title: string; due_at: string; overdue: boolean; is_mandatory: boolean }>;
  history: LearningItem[];
  recommended: CatalogCard[];
  assignments: Array<{ id: number; title: string; course_id: number; course_title: string; due_at: string | null; status: string | null }>;
  assessments: Array<{ id: number; title: string; course_id: number; course_title: string; due_at: string | null; attempts_left: number | null; pending: boolean }>;
  upcoming_classes: unknown[];
  certificates: unknown[];
}

export interface TakingLesson extends LessonCard {
  progress: Progress;
  locked: boolean;
  locked_because: string | null;
}

export interface Taking {
  course: CourseCard & { description: string | null; objectives: string[] };
  enrollment: Enrollment;
  progress_percent: number;
  lessons_done: number;
  lessons_total: number;
  completion: CheckItem[];
  sections: Array<{ id: number; title: string; description: string | null; lessons: TakingLesson[] }>;
  resume: { lesson_id: number; title: string; position: string | number | null } | null;
  offline: boolean;
}

// Assessments

export type QType = 'SINGLE' | 'MULTIPLE' | 'TRUE_FALSE' | 'SHORT_ANSWER' | 'FILL_BLANK' | 'NUMERIC' | 'MATCHING' | 'ORDERING' | 'LONG_ANSWER' | 'FILE_UPLOAD';

export interface AssessmentCard {
  id: number;
  course_id: number;
  title: string;
  instructions: string | null;
  pass_mark: number;
  time_limit_min: number | null;
  attempts_allowed: number;
  cooldown_min: number | null;
  scoring_policy: 'HIGHEST' | 'LATEST' | 'AVERAGE';
  show_score: boolean;
  show_answers: 'NEVER' | 'AFTER_SUBMIT' | 'AFTER_DUE' | 'AFTER_PASS';
  allow_review: boolean;
  shuffle_questions: boolean;
  shuffle_options: boolean;
  negative_marking_pct: number | null;
  available_from: string | null;
  available_until: string | null;
  due_at: string | null;
  is_final: boolean;
  questions: number;
  max_score: number;
}

export interface StaffOption { id: number; label: string; is_correct: boolean; match_label: string | null; position: number }
export interface StaffQuestion { id: number; qtype: QType; prompt: string; points: number; explanation: string | null; version: number; sort: number; settings: Record<string, unknown> | null; options: StaffOption[] }
export interface StaffAssessment extends AssessmentCard { question_list: StaffQuestion[] }

export interface LearnerQuestion {
  id: number;
  qtype: QType;
  prompt: string;
  points: number;
  options?: Array<{ id: number; label: string }>;
  choices?: Array<{ id: number; label: string }>;
  blanks?: number;
  max_files?: number;
}

export type Answer = number | boolean | string | number[] | string[] | Record<string, number> | null;

export interface MyAssessment extends AssessmentCard {
  attempts_left: number | null;
  passed: boolean;
  best?: number | null;
  can_start: boolean;
  why_not: string | null;
  attempts: Array<{ id: number; attempt_no: number; status: string; submitted_at: string | null; percent?: number | null; passed: boolean | null }>;
  question_list?: LearnerQuestion[];
}

export interface AttemptQuestion extends LearnerQuestion {
  response?: Answer;
  score?: number | null;
  correct?: boolean | null;
  feedback?: string | null;
  answer?: unknown;
  explanation?: string | null;
}

export interface Attempt {
  id: number;
  assessment_id: number;
  attempt_no: number;
  status: 'IN_PROGRESS' | 'SUBMITTED' | 'NEEDS_GRADING' | 'GRADED';
  started_at: string | null;
  deadline_at: string | null;
  seconds_left?: number | null;
  submitted_at: string | null;
  auto_submitted: boolean;
  score?: number | null;
  max_score?: number | null;
  percent?: number | null;
  passed?: boolean | null;
  answers_shown?: boolean;
  questions: AttemptQuestion[];
}

export interface StaffAttempt {
  id: number;
  assessment_id: number;
  course_id: number;
  enrollment_id: number;
  learner: { id: number; name: string };
  attempt_no: number;
  status: Attempt['status'];
  started_at: string | null;
  deadline_at: string | null;
  submitted_at: string | null;
  graded_at: string | null;
  auto_submitted: boolean;
  score: number | null;
  max_score: number;
  percent: number | null;
  passed: boolean | null;
  answers: Array<{
    question_id: number;
    qtype: QType;
    prompt: string;
    points: number;
    response: unknown;
    files?: Array<{ id: number; name: string; size: number; url: string }>;
    answer: unknown;
    auto_score: number | null;
    manual_score: number | null;
    needs_grading: boolean;
    feedback: string | null;
  }>;
}

// Assignments

export interface AssignmentCard {
  id: number;
  course_id: number;
  title: string;
  instructions: string | null;
  due_at: string | null;
  max_score: number;
  pass_score: number | null;
  allowed_types: string[];
  max_file_mb: number;
  max_files: number;
  allow_text: boolean;
  require_file: boolean;
  attempts_allowed: number;
  late_policy: string | null;
  late_penalty_pct: number | null;
}

export interface Submission {
  id: number;
  assignment_id: number;
  attempt_no: number;
  status: 'IN_PROGRESS' | 'SUBMITTED' | 'LATE' | 'UNDER_REVIEW' | 'COMPLETED' | 'RESUBMISSION_REQUIRED' | 'GRADED';
  text: string | null;
  files: Array<{ id: number; name: string; size: number; mime: string | null; url: string }>;
  submitted_at: string | null;
  is_late: boolean;
  score: number | null;
  percent: number | null;
  late_penalty: number | null;
  passed: boolean | null;
  feedback: string | null;
  graded_at: string | null;
  learner?: { id: number; name: string };
  enrollment_id?: number;
  course_id?: number;
  raw_score?: number | null;
  reviewer_id?: number | null;
  graded_by?: { id: number; name: string } | number | null;
  assignment?: AssignmentCard;
  history?: Array<{ id: number; action: string; by: string | null; at: string; reason: string | null }>;
}

export interface MyAssignment extends AssignmentCard {
  attempts_left: number | null;
  status: string | null;
  completed: boolean;
  submissions: Submission[];
}

export interface GradingItem {
  kind: 'assignment' | 'assessment';
  id: number;
  title: string;
  course_id: number;
  learner: { id: number; name: string } | string;
  status: string;
  is_late: boolean;
  attempt_no: number;
  submitted_at: string | null;
}

// Categories, dashboard, people

export interface Category {
  id: number;
  parent_id: number | null;
  name: string;
  label: string;
  names: Record<string, string>;
  code: string | null;
  description: string | null;
  depth: number;
  sort: number;
  path: string;
  courses: number;
  archived: boolean;
}

export interface Overview {
  kpi: Record<string, number | null>;
  widgets: {
    learning_progress: Record<string, number>;
    completion_trend: Array<{ month: string; completed: number }>;
    popular_courses: Array<{ id: number; code: string; title: string; enrolled: number }>;
    pending_assessments: number;
    compliance_status: Record<string, number>;
    recently_completed: Array<{ learner: string | { id: number; name: string }; course: { id: number; code: string; title: string }; completed_at: string; final_score: number | null }>;
    learner_activity: Array<{ day: string; learners: number }>;
    instructor_activity: Array<{ user_id: number; name: string; graded: number }>;
    [k: string]: unknown;
  };
  later: Record<string, string>;
}

export interface LearnerRow { user_id: number; name: string; total: number; assigned: number; in_progress: number; completed: number; overdue: number }

export interface Person { user_id: number; name: string; via?: string; reason?: string; status?: string }
export interface Preview {
  new: Person[];
  skipped: Person[];
  blocked: Person[];
  not_permitted: Person[];
  unknown: string[];
  counts: Record<string, number>;
}

export interface Activity { id: number; action: string; by: string | null; by_id: number | null; at: string; reason: string | null; before: unknown; after: unknown }

// ── words for the server's values ───────────────────────────────────────

export const LESSON_ICON: Record<string, string> = {
  VIDEO: 'film', AUDIO: 'music', ARTICLE: 'file-text', PDF: 'file', OFFICE_DOC: 'file-sheet', PRESENTATION: 'board', IMAGE: 'image', LINK: 'link', QUIZ: 'list-todo', ASSIGNMENT: 'upload',
};

export function nice(v: string | null | undefined): string {
  if (!v) return '';
  const s = v.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function labelOf(list: Choice[] | undefined, value: string | null | undefined): string {
  if (!value) return '';
  return list?.find((c) => c.value === value)?.label ?? nice(value);
}

export function minutes(n: number | null | undefined): string {
  if (!n) return '';
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `${Math.round(Number(n) * 10) / 10}%`;
}

/** A UTC stamp the server sends (`YYYY-MM-DD HH:MM:SS`) as the reader's date and time. */
export function when(stamp: string | null | undefined, withTime = false): string {
  if (!stamp) return '—';
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(stamp) ? stamp : `${stamp.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return stamp;
  return d.toLocaleString([], withTime ? { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

/** A local `datetime-local` value as the UTC stamp the server reads without doubt. */
export function toUtc(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** A server stamp as a `datetime-local` value, in the reader's time. */
export function toLocalInput(stamp: string | null | undefined): string {
  if (!stamp) return '';
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(stamp) ? stamp : `${stamp.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
