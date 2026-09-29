// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), request: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

// The shell reads where it is from the tab's address; the tests say what that address is.
const tab = vi.hoisted(() => ({ query: new URLSearchParams(), path: ['elearning'], go: (_r: string) => undefined as void, win: (_r: string, _t?: string) => undefined as void }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ tabId: 't1', route: `/elearning?${tab.query}`, active: true, path: tab.path, query: tab.query, go: (r: string) => tab.go(r), navigate: () => undefined, openInNewTab: () => undefined, openInWindow: (r: string, t?: string) => tab.win(r, t), setTitle: () => undefined, openLink: () => undefined }),
  useTabTitle: () => undefined,
}));

window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
globalThis.IntersectionObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
  root = null;
  rootMargin = '';
  thresholds = [];
} as unknown as typeof IntersectionObserver;

const { ApiError, apiGet, apiGetMeta, request } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { toast } = await import('../../../src/core/toasts');
const { default: ElearningShell, screenOf } = await import('../../../src/modules/elearning/ElearningShell');
const { PlayedRanges, sendBeat } = await import('../../../src/modules/elearning/api');
const { rightAnswer } = await import('../../../src/modules/elearning/Quiz');

const learner = { access: true };
const admin = Object.fromEntries(
  ['access', 'dashboard_view', 'course_view', 'course_create', 'course_edit', 'course_publish', 'course_archive', 'enrollment_view', 'enrollment_manage', 'enrollment_assign', 'assessment_view', 'assessment_manage', 'assessment_grade', 'assignment_view', 'assignment_manage', 'assignment_grade', 'learner_progress_view', 'settings_manage'].map((k) => [k, true]),
);

const options = (can: Record<string, boolean>, complete = true) => ({
  org: 3,
  companies: [{ id: 3, name: 'Livezen Academy' }],
  can,
  scope: 'all',
  setup: { steps: [], next: null, ready_to_publish: complete, ready: complete, complete, done: complete ? 12 : 3, total: 12 },
  course_types: [{ value: 'SELF_PACED', label: 'Self-paced', available: true }, { value: 'COMPLIANCE', label: 'Compliance', available: true }],
  statuses: [{ value: 'DRAFT', label: 'Draft' }, { value: 'PUBLISHED', label: 'Published' }],
  levels: ['Beginner', 'Expert'],
  default_language: 'en',
  enrollment_types: [{ value: 'OPEN', label: 'Open', available: true }, { value: 'KEY', label: 'Enrolment key', available: false, why: 'Arrives in P2.' }],
  visibility: [{ value: 'ORGANIZATION', label: 'Organization', available: true }],
  lesson_types: [{ value: 'VIDEO', label: 'Video', rules: ['OPEN', 'WATCH_80'], default_rule: 'WATCH_80', available: true }],
  completion_rules: [{ value: 'WATCH_80', label: 'Watch 80%' }],
  course_conditions: [{ value: 'ALL_MANDATORY_LESSONS', label: 'All mandatory lessons', available: true }],
  staff_roles: [{ value: 'INSTRUCTOR', label: 'Instructor' }],
  review_required: true,
});

const card = (id: number, over: Record<string, unknown> = {}) => ({
  id, org_id: 3, code: `CYB-10${id}`, title: `Course ${id}`, summary: 'Stay safe online.', status: 'PUBLISHED', version: 1, course_type: 'SELF_PACED', level: 'Beginner', language: 'en',
  estimated_minutes: 45, visibility: 'ORGANIZATION', enrollment_type: 'OPEN', category: { id: 2, name: 'Cybersecurity' }, instructor: { id: 9, name: 'Nuwan' }, lessons: 3, enrolled: 12,
  thumbnail_file_id: null, start_at: null, end_at: null, published_at: '2026-09-01 10:00:00', updated_at: '2026-09-02 10:00:00', ...over,
});

const enrolment = (over: Record<string, unknown> = {}) => ({
  id: 70, course_id: 5, course_version: 1, course: { id: 5, code: 'CYB-105', title: 'Course 5' }, learner: { id: 4, name: 'Amaya' }, enrollment_type: 'SELF', source_ref: null, assigned_by: null,
  status: 'IN_PROGRESS', overdue: false, due_at: null, is_mandatory: false, enrolled_at: '2026-09-01 10:00:00', started_at: '2026-09-02 10:00:00', completed_at: null,
  last_activity_at: '2026-09-28 10:00:00', progress_percent: 40, final_score: null, completion_source: null, withdrawn_at: null, withdraw_reason: null, created_at: '2026-09-01 10:00:00', ...over,
});

/** The server, as the tests need it: GETs by path, writes by method and path. */
function serve(gets: Record<string, unknown>, writes: Record<string, unknown | Error> = {}) {
  const get = async (path: string) => {
    const hit = gets[path.replace('/api/elearning/v1', '')];
    if (hit === undefined) return new Promise(() => undefined);
    if (hit instanceof Error) throw hit;
    return hit;
  };
  vi.mocked(apiGet).mockImplementation(get as never);
  vi.mocked(apiGetMeta).mockImplementation((async (path: string) => ({ data: await get(path), offline: false, cachedAt: null })) as never);
  vi.mocked(request).mockImplementation((async (method: string, path: string) => {
    const hit = writes[`${method} ${path.replace('/api/elearning/v1', '')}`];
    if (hit instanceof Error) throw hit;
    if (hit === undefined) throw new ApiError(500, `unexpected ${method} ${path}`, null);
    return { data: hit, offline: false, cachedAt: null, message: 'Done.' };
  }) as never);
}

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ElearningShell tabId="t1" route="/elearning" active />
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.mocked(apiGet).mockReset();
  vi.mocked(apiGetMeta).mockReset();
  vi.mocked(request).mockReset();
  vi.mocked(call).mockReset();
  vi.mocked(call).mockResolvedValue([] as never);
  vi.mocked(toast).mockReset();
  tab.query = new URLSearchParams();
  tab.path = ['elearning'];
  tab.go = vi.fn();
  tab.win = vi.fn();
});
afterEach(cleanup);

const myLearning = {
  counters: { assigned: 1, in_progress: 1, completed: 2, certificates: 0, overdue: 1, pending: 0 },
  continue: [{ ...card(5), enrollment: enrolment(), resume_lesson_id: 40 }],
  assigned: [{ ...card(6), enrollment: enrolment({ id: 71, course_id: 6, status: 'ENROLLED', is_mandatory: true, due_at: '2026-10-01 00:00:00', overdue: true, progress_percent: 0 }), resume_lesson_id: null }],
  in_progress: [{ ...card(5), enrollment: enrolment(), resume_lesson_id: 40 }],
  pending: [],
  deadlines: [{ kind: 'course', course_id: 6, title: 'Course 6', due_at: '2026-10-01 00:00:00', overdue: true, is_mandatory: true }],
  history: [],
  recommended: [{ ...card(8), enrollment: null, can_enroll: true, reason: 'New in the catalogue' }],
  assignments: [{ id: 30, title: 'Phishing report', course_id: 5, course_title: 'Course 5', due_at: null, status: null }],
  assessments: [{ id: 20, title: 'Final quiz', course_id: 5, course_title: 'Course 5', due_at: null, attempts_left: 2, pending: false }],
  upcoming_classes: [],
  certificates: [],
};

describe('eLearning, the shell', () => {
  it('gives a learner their own screens only, all in the app', async () => {
    serve({ '/options': options(learner), '/me/learning': myLearning });
    show();
    const rail = await screen.findByRole('navigation', { name: 'eLearning' });
    for (const t of ['My Learning', 'Course catalogue', 'Kept offline']) expect(rail.textContent).toContain(t);
    for (const t of ['Training dashboard', 'Courses', 'Grading', 'Enrolments', 'Categories', 'Settings']) expect(rail.textContent).not.toContain(t);
    fireEvent.click(within(rail).getByRole('button', { name: /Course catalogue/ }));
    expect(tab.go).toHaveBeenCalledWith('/elearning?view=catalog');
    expect(call).not.toHaveBeenCalledWith('app:openInBrowser', expect.anything());
  });

  it('gives the training team the management screens, and points a manager at an unfinished set-up', async () => {
    serve({ '/options': options({ ...admin, manager: true }, false), '/me/learning': myLearning });
    show();
    const rail = await screen.findByRole('navigation', { name: 'eLearning' });
    for (const t of ['Training dashboard', 'Courses', 'Reviews', 'Categories', 'Learners', 'Enrolments', 'Requests to join', 'Grading', 'Finish set-up', 'Settings']) expect(rail.textContent).toContain(t);
  });

  it('opens what the server’s notification links name', () => {
    const at = (p: string) => {
      const [path, q] = p.split('?');
      return screenOf(path!.split('/').filter(Boolean), new URLSearchParams(q ?? ''));
    };
    expect(at('/elearning/my/courses/12')).toEqual({ kind: 'course', id: 12, lesson: null });
    expect(at('/elearning/my')).toEqual({ kind: 'view', view: 'my' });
    expect(at('/elearning/catalog/7')).toEqual({ kind: 'about', id: 7 });
    expect(at('/elearning/courses/9')).toEqual({ kind: 'manage', id: 9, tab: null });
    expect(at('/elearning/learners/4')).toEqual({ kind: 'learner', id: 4 });
    expect(at('/elearning/grading')).toEqual({ kind: 'view', view: 'grading' });
    expect(at('/elearning/approvals')).toEqual({ kind: 'view', view: 'approvals' });
    expect(at('/elearning?course=5&lesson=40')).toEqual({ kind: 'course', id: 5, lesson: 40 });
    expect(at('/elearning?quiz=20&attempt=9')).toEqual({ kind: 'quiz', id: 20, attempt: 9 });
    expect(at('/elearning?view=nonsense')).toEqual({ kind: 'view', view: 'my' });
    expect(at('/elearning?course=5x')).toEqual({ kind: 'view', view: 'my' });
  });
});

describe('My Learning and the catalogue', () => {
  it('shows the counters, what is overdue, and picks up at the resume point', async () => {
    serve({ '/options': options(learner), '/me/learning': myLearning });
    show();
    expect(await screen.findByText('Continue learning')).toBeTruthy();
    expect(screen.getByText(/^Overdue since /)).toBeTruthy();
    expect(screen.getByText('New in the catalogue')).toBeTruthy();
    expect(screen.getByText(/Certificates, live classes and learning paths arrive in a later phase/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(tab.go).toHaveBeenCalledWith('/elearning?course=5&lesson=40');
    fireEvent.click(screen.getByRole('button', { name: /Final quiz/ }));
    expect(tab.go).toHaveBeenCalledWith('/elearning?quiz=20');
  });

  it('joins an open course once per press, with an idempotency key, and says the server’s refusal', async () => {
    tab.query = new URLSearchParams('about=8');
    const about = { ...card(8), enrollment: null, can_enroll: true, description: '<p>Learn <b>safely</b>.</p>', objectives: ['Spot phishing'], outline: [{ id: 1, title: 'Basics', lessons: [{ id: 40, title: 'Welcome', lesson_type: 'VIDEO', duration_min: 5, is_mandatory: true }] }], capacity: 20, places_left: 0, requires_approval: false, why_not: null, completion: [{ type: 'ALL_MANDATORY_LESSONS', label: 'Complete all mandatory lessons (0/1)' }] };
    serve({ '/options': options(learner), '/catalog/8': about }, { 'POST /catalog/8/enroll': new ApiError(409, 'The course is full.', null, { code: 'full' }) });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Join the course' }));
    expect(await screen.findByText('The course is full.')).toBeTruthy();
    const [method, path, opts] = vi.mocked(request).mock.calls[0]!;
    expect([method, path]).toEqual(['POST', '/api/elearning/v1/catalog/8/enroll']);
    expect((opts?.headers as Record<string, string>)['Idempotency-Key']).toMatch(/^join-/);
    expect(screen.getByText('Spot phishing')).toBeTruthy();
    expect(screen.getByText('Complete all mandatory lessons (0/1)')).toBeTruthy();
  });
});

describe('taking a course', () => {
  const taking = {
    course: { ...card(5), description: null, objectives: [] },
    enrollment: enrolment(),
    progress_percent: 40,
    lessons_done: 1,
    lessons_total: 3,
    completion: [{ type: 'ALL_MANDATORY_LESSONS', label: 'Complete all mandatory lessons (1/3)', met: false }],
    sections: [
      {
        id: 1,
        title: 'Basics',
        description: null,
        lessons: [
          { id: 40, section_id: 1, title: 'Welcome', lesson_type: 'VIDEO', completion_rule: 'WATCH_80', rule_label: 'Watch 80%', rule_settings: null, is_mandatory: true, duration_min: 5, release_at: null, prerequisite_lesson_id: null, allow_download: false, page_count: null, assessment_id: null, assignment_id: null, sort: 1, progress: { status: 'COMPLETED', percent: 100, position: null, watched_seconds: 300, duration_sec: 300, pages_viewed: [], scrolled_to_end: false, time_spent: 400, started_at: null, completed_at: '2026-09-02 10:00:00' }, locked: false, locked_because: null },
          { id: 41, section_id: 1, title: 'Policy', lesson_type: 'PDF', completion_rule: 'MANUAL', rule_label: 'Mark complete', rule_settings: null, is_mandatory: true, duration_min: 10, release_at: null, prerequisite_lesson_id: null, allow_download: true, page_count: 4, assessment_id: null, assignment_id: null, sort: 2, progress: { status: 'NOT_STARTED', percent: 0, position: null, watched_seconds: 0, duration_sec: null, pages_viewed: [], scrolled_to_end: false, time_spent: 0, started_at: null, completed_at: null }, locked: false, locked_because: null },
          { id: 42, section_id: 1, title: 'Wrap-up', lesson_type: 'ARTICLE', completion_rule: 'SCROLL', rule_label: 'Read to the end', rule_settings: null, is_mandatory: true, duration_min: 3, release_at: '2026-12-01 00:00:00', prerequisite_lesson_id: 41, allow_download: false, page_count: null, assessment_id: null, assignment_id: null, sort: 3, progress: { status: 'NOT_STARTED', percent: 0, position: null, watched_seconds: 0, duration_sec: null, pages_viewed: [], scrolled_to_end: false, time_spent: 0, started_at: null, completed_at: null }, locked: true, locked_because: 'Finish "Policy" first.' },
        ],
      },
    ],
    resume: { lesson_id: 41, title: 'Policy', position: null },
    offline: true,
  };

  it('shows the outline with locks and the checklist, keeps the course offline through the main process, and opens a window', async () => {
    tab.query = new URLSearchParams('course=5');
    serve({ '/options': options(learner), '/me/courses/5': taking });
    vi.mocked(call).mockImplementation((async (channel: string) => (channel === 'elearning:offlineDownload' ? { courseId: 5, files: [{}, {}] } : [])) as never);
    show();
    const outline = await screen.findByRole('complementary', { name: 'Course outline' });
    expect(within(outline).getByText('Finish "Policy" first.')).toBeTruthy();
    expect(screen.getByText('Complete all mandatory lessons (1/3)')).toBeTruthy();
    expect(screen.getByText('Pick up where you left off')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep offline' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('elearning:offlineDownload', { courseId: 5, title: 'Course 5' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open in a window' }));
    expect(tab.win).toHaveBeenCalledWith('/elearning?course=5&lesson=41', 'Course 5');
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(tab.go).toHaveBeenCalledWith('/elearning?course=5&lesson=41');
  });

  it('says why a lesson is locked, in the server’s words', async () => {
    tab.query = new URLSearchParams('course=5&lesson=42');
    serve({ '/options': options(learner), '/me/courses/5': taking, '/me/lessons/42': new ApiError(423, 'Finish "Policy" first.', null, { code: 'locked' }) });
    show();
    expect(await screen.findByText('Wrap-up is not open yet')).toBeTruthy();
    expect(screen.getAllByText('Finish "Policy" first.').length).toBeGreaterThan(0);
  });

  it('marks a "mark complete" lesson done, and offers to save a file the lesson lets go', async () => {
    tab.query = new URLSearchParams('course=5&lesson=41');
    const open = { lesson: { ...taking.sections[0]!.lessons[1], file: { status: 'ready', name: 'Policy.pdf', mime: 'application/pdf', size: 1000, extension: 'pdf', duration_sec: null, downloadable: true, urls: { view: '/media/tokView1234', download: '/media/tokDown1234?download=1' }, tracks: [] } }, progress: taking.sections[0]!.lessons[1]!.progress, previous_lesson_id: 40, next_lesson_id: null };
    serve({ '/options': options(learner), '/me/courses/5': taking, '/me/lessons/41': open }, { 'POST /me/lessons/41/complete': { progress: { ...open.progress, status: 'COMPLETED', percent: 100 } } });
    global.fetch = vi.fn(async () => new Response(new Blob(['%PDF'], { type: 'application/pdf' }), { status: 200, headers: { 'content-type': 'application/pdf' } })) as never;
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark complete' }));
    await waitFor(() => expect(vi.mocked(request).mock.calls.some(([m, p]) => m === 'POST' && p === '/api/elearning/v1/me/lessons/41/complete')).toBe(true));
    expect(await screen.findByText('Complete')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true });
    expect(tab.go).toHaveBeenCalledWith('/elearning?course=5&lesson=40');
  });
});

describe('heartbeats: only what is played counts', () => {
  it('reports continuous play as a range, and a seek as a new one', () => {
    const p = new PlayedRanges();
    p.tick(0, 0);
    p.tick(4, 4000);
    p.tick(8, 8000);
    // A seek ahead: no credit for the gap.
    p.tick(200, 8500);
    p.tick(203, 11_500);
    expect(p.take()).toEqual([[0, 8], [200, 203]]);
    p.tick(206, 14_500);
    expect(p.take()).toEqual([[203, 206]]);
    expect(p.pending).toBe(false);
  });

  it('allows the faster speed, but never more than the time that passed', () => {
    const p = new PlayedRanges();
    p.tick(10, 0, 2);
    p.tick(18, 4000, 2);
    p.tick(60, 5000, 2);
    p.close();
    expect(p.take()).toEqual([[10, 18]]);
  });

  it('sends a beat to the server, or keeps it in the offline queue when WorkSuite is out of reach', async () => {
    vi.mocked(request).mockResolvedValueOnce({ data: { credited_seconds: 8, trimmed: false, progress: { status: 'IN_PROGRESS', percent: 3 } }, offline: false, cachedAt: null, message: 'OK' } as never);
    const online = await sendBeat(40, { ranges: [[0, 8]], position: 8 }, 'Progress in Welcome');
    expect(online).toMatchObject({ queued: false, answer: { credited_seconds: 8 } });
    expect(vi.mocked(request).mock.calls[0]!.slice(0, 2)).toEqual(['POST', '/api/elearning/v1/me/lessons/40/progress']);

    vi.mocked(request).mockRejectedValueOnce(new ApiError(0, 'WorkSuite Desktop could not complete the request.', 'INTERNAL'));
    vi.mocked(call).mockResolvedValueOnce({ delivered: false, queued: true, id: 'm1', status: null, data: null, error: null, code: null } as never);
    const offline = await sendBeat(40, { ranges: [[8, 16]], position: 16 }, 'Progress in Welcome');
    expect(offline).toEqual({ answer: null, queued: true });
    expect(call).toHaveBeenCalledWith('offline:submit', { module: 'elearning', entity: 'progress', entityId: '40', label: 'Progress in Welcome', method: 'POST', path: '/api/elearning/v1/me/lessons/40/progress', body: { ranges: [[8, 16]], position: 16 }, queueIfOffline: true });
  });
});

describe('a quiz', () => {
  const attempt = {
    id: 9, assessment_id: 20, attempt_no: 1, status: 'IN_PROGRESS', started_at: '2026-09-29 10:00:00', deadline_at: '2026-09-29 10:10:00', seconds_left: 540, submitted_at: null, auto_submitted: false,
    questions: [
      { id: 3, qtype: 'SINGLE', prompt: 'Which link is safe?', points: 1, options: [{ id: 11, label: 'bank.example.com' }, { id: 12, label: 'bank-example.co' }] },
      { id: 4, qtype: 'ORDERING', prompt: 'Order the steps', points: 2, options: [{ id: 21, label: 'Report' }, { id: 22, label: 'Stop' }] },
    ],
  };

  it('answers from what the attempt drew — never a key — saves each answer, keeps the server’s clock, and submits', async () => {
    tab.query = new URLSearchParams('quiz=20&attempt=9');
    const graded = { ...attempt, status: 'GRADED', seconds_left: null, submitted_at: '2026-09-29 10:04:00', score: 3, max_score: 3, percent: 100, passed: true, questions: attempt.questions.map((q) => ({ ...q, correct: true })) };
    serve({ '/options': options(learner), '/me/attempts/9': attempt }, { 'PUT /me/attempts/9/answers/3': { saved_at: 'now' }, 'PUT /me/attempts/9/answers/4': { saved_at: 'now' }, 'POST /me/attempts/9/submit': graded });
    show();
    expect(await screen.findByRole('timer')).toBeTruthy();
    expect(screen.getByRole('timer').textContent).toContain('9:00');
    fireEvent.click(screen.getByRole('radio', { name: 'bank.example.com' }));
    await waitFor(() => expect(vi.mocked(request)).toHaveBeenCalledWith('PUT', '/api/elearning/v1/me/attempts/9/answers/3', { body: { response: 11 } }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Move down' })[0]!);
    await waitFor(() => expect(vi.mocked(request)).toHaveBeenCalledWith('PUT', '/api/elearning/v1/me/attempts/9/answers/4', { body: { response: [22, 21] } }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(vi.mocked(request)).toHaveBeenCalledWith('POST', '/api/elearning/v1/me/attempts/9/submit', { body: { answers: { '3': 11, '4': [22, 21] } } }));
    expect(await screen.findByText('Passed')).toBeTruthy();
    expect(screen.getByText('100%')).toBeTruthy();
  });

  it('reads the key back as labels only where the quiz shows it after submitting', () => {
    expect(rightAnswer({ id: 1, qtype: 'SINGLE', prompt: '', points: 1, options: [{ id: 11, label: 'Yes' }], answer: [11] })).toBe('Yes');
    expect(rightAnswer({ id: 1, qtype: 'MATCHING', prompt: '', points: 1, options: [{ id: 1, label: 'Cat' }], choices: [{ id: 7, label: 'Meow' }], answer: { 1: 7 } })).toBe('Cat — Meow');
    expect(rightAnswer({ id: 1, qtype: 'NUMERIC', prompt: '', points: 1, answer: { answer: 42, tolerance: 0.5 } })).toBe('42 ± 0.5');
    expect(rightAnswer({ id: 1, qtype: 'FILL_BLANK', prompt: '', points: 1, answer: [['cat', 'kitten'], ['dog']] })).toBe('1: cat / kitten; 2: dog');
    expect(rightAnswer({ id: 1, qtype: 'LONG_ANSWER', prompt: '', points: 1 })).toBeNull();
  });
});
