// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), request: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

const tab = vi.hoisted(() => ({ query: new URLSearchParams(), path: ['elearning'], go: (_r: string) => undefined as void }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ tabId: 't1', route: `/elearning?${tab.query}`, active: true, path: tab.path, query: tab.query, go: (r: string) => tab.go(r), navigate: () => undefined, openInNewTab: () => undefined, openInWindow: () => undefined, setTitle: () => undefined, openLink: () => undefined }),
  useTabTitle: () => undefined,
}));

window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;

const { ApiError, apiGet, apiGetMeta, request } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { default: ElearningShell } = await import('../../../src/modules/elearning/ElearningShell');
const { arrangement, moveLesson } = await import('../../../src/modules/elearning/admin/Builder');
const { questionBody } = await import('../../../src/modules/elearning/admin/AssessmentsTab');
const { responseText } = await import('../../../src/modules/elearning/admin/GradeAttempt');
const { MODULES, allowedModules } = await import('../../../src/modules/registry');
const { parseDeepLink } = await import('../../../shared/deeplink');
const { resolveWebLink } = await import('../../../shared/links');
const { visibleApps } = await import('../../../shared/apps');

const can = Object.fromEntries(['access', 'dashboard_view', 'course_view', 'course_create', 'course_edit', 'course_publish', 'enrollment_view', 'enrollment_manage', 'enrollment_assign', 'assessment_view', 'assessment_manage', 'assessment_grade', 'assignment_view', 'assignment_manage', 'assignment_grade', 'learner_progress_view', 'settings_manage'].map((k) => [k, true]));
const options = {
  org: 3, companies: [{ id: 3, name: 'Livezen Academy' }], can, scope: 'all',
  setup: { steps: [], next: null, ready_to_publish: true, ready: true, complete: true, done: 12, total: 12 },
  course_types: [{ value: 'SELF_PACED', label: 'Self-paced', available: true }], statuses: [{ value: 'DRAFT', label: 'Draft' }, { value: 'PUBLISHED', label: 'Published' }], levels: ['Beginner'],
  default_language: 'en', enrollment_types: [{ value: 'OPEN', label: 'Open', available: true }], visibility: [{ value: 'ORGANIZATION', label: 'Organization', available: true }],
  lesson_types: [{ value: 'VIDEO', label: 'Video', rules: ['WATCH_80'], default_rule: 'WATCH_80', available: true }], completion_rules: [{ value: 'WATCH_80', label: 'Watch 80%' }],
  course_conditions: [], staff_roles: [{ value: 'INSTRUCTOR', label: 'Instructor' }, { value: 'CO_INSTRUCTOR', label: 'Co-instructor' }], review_required: true,
};
const nocan = { edit: false, submit: false, recall: false, review: false, publish: false, suspend: false, resume: false, archive: false, reopen: false, delete: false, duplicate: false, enroll: false, enrollments: false, assessments: false, assignments: false };
const course = (over: Record<string, unknown> = {}) => ({
  id: 5, org_id: 3, code: 'CYB-105', title: 'Phishing basics', summary: null, status: 'DRAFT', version: 1, course_type: 'SELF_PACED', level: null, language: 'en', estimated_minutes: 30, visibility: 'ORGANIZATION',
  enrollment_type: 'OPEN', category: { id: 2, name: 'Cybersecurity' }, instructor: { id: 9, name: 'Nuwan' }, lessons: 2, enrolled: 0, thumbnail_file_id: null, start_at: null, end_at: null, published_at: null,
  updated_at: null, description: null, objectives: [], due_days: null, capacity: null, passing_score: null, completion_rule: null, completion_rule_effective: null, progress_weighting: null, certificate_enabled: false,
  validity_months: null, revision: 7, publish_at: null, suspended_at: null, suspend_reason: null, archived_at: null, submitted_at: null, approved_at: null, review_note: null, category_path: 'Cybersecurity',
  staff: [{ id: 1, user_id: 9, name: 'Nuwan', role: 'INSTRUCTOR', label: 'Instructor' }], my_roles: ['INSTRUCTOR'], can: nocan, review: null, created_by: { id: 9, name: 'Nuwan' }, created_at: null, ...over,
});

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
  tab.query = new URLSearchParams();
  tab.path = ['elearning'];
  tab.go = vi.fn();
});
afterEach(cleanup);

describe('a course for its staff', () => {
  it('offers only the steps the course’s own `can` allows, and keeps a refusal’s list of problems on the page', async () => {
    tab.query = new URLSearchParams('manage=5');
    serve(
      { '/options': options, '/courses/5': course({ can: { ...nocan, edit: true, submit: true, duplicate: true } }), '/categories': { items: [] }, '/courses/5/assessments': { items: [] }, '/courses/5/assignments': { items: [] } },
      { 'POST /courses/5/submit-review': new ApiError(422, 'The course is not ready for review.', null, { code: 'not_ready', problems: ['Add at least one visible lesson.', 'Quiz "Final" has no questions.'] }) },
    );
    show();
    expect(await screen.findByRole('button', { name: 'Submit for review' })).toBeTruthy();
    for (const hidden of ['Publish', 'Suspend', 'Archive', 'Approve', 'Delete']) expect(screen.queryByRole('button', { name: hidden })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Ready for a look' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('The course is not ready for review.')).toBeTruthy();
    expect(screen.getByText('Add at least one visible lesson.')).toBeTruthy();
    expect(screen.getByText('Quiz "Final" has no questions.')).toBeTruthy();
    expect(vi.mocked(request)).toHaveBeenCalledWith('POST', '/api/elearning/v1/courses/5/submit-review', { body: { note: 'Ready for a look' }, headers: undefined });
  });

  it('saves details with the revision they were read at, and offers the other editor’s changes on a conflict', async () => {
    tab.query = new URLSearchParams('manage=5');
    serve(
      { '/options': options, '/courses/5': course({ can: { ...nocan, edit: true } }), '/categories': { items: [] }, '/courses/5/assessments': { items: [] }, '/courses/5/assignments': { items: [] } },
      { 'POST /courses/5': new ApiError(409, 'Someone else changed this course. Load their changes and try again.', null, { code: 'revision_conflict', revision: 8 }) },
    );
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Someone else changed this course. Load their changes and try again.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Load their changes' })).toBeTruthy();
    const body = vi.mocked(request).mock.calls.find(([m, p]) => m === 'POST' && p === '/api/elearning/v1/courses/5')![2]!.body as Record<string, unknown>;
    expect(body).toMatchObject({ title: 'Phishing basics', revision: 7, completion_rule: null });
  });

  it('arranges the outline with the revision, and says so when someone else got there first', async () => {
    tab.query = new URLSearchParams('manage=5&ct=builder');
    const lesson = (id: number, section: number, title: string) => ({ id, section_id: section, title, lesson_type: 'VIDEO', completion_rule: 'WATCH_80', rule_label: 'Watch 80%', rule_settings: null, is_mandatory: true, duration_min: 5, release_at: null, prerequisite_lesson_id: null, allow_download: false, page_count: null, assessment_id: null, assignment_id: null, sort: 1, is_published: true, is_hidden: false, file_id: 3, url: null, media: { status: 'processing', duration_sec: null, jobs: 1 }, media_seconds: null });
    const structure = { course_id: 5, revision: 7, sections: [{ id: 1, title: 'Basics', description: null, sort: 1, is_published: true, is_hidden: false, lessons: [lesson(40, 1, 'Welcome'), lesson(41, 1, 'Links')] }] };
    serve({ '/options': options, '/courses/5': course({ can: { ...nocan, edit: true } }), '/courses/5/structure': structure }, { 'POST /courses/5/structure': new ApiError(409, 'The outline changed since you opened it.', null, { code: 'revision_conflict' }) });
    show();
    expect((await screen.findAllByText('Preparing')).length).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'Move Links up' }));
    expect(await screen.findByText('The outline changed since you opened it.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Load the latest' })).toBeTruthy();
    expect(vi.mocked(request)).toHaveBeenCalledWith('POST', '/api/elearning/v1/courses/5/structure', { body: { sections: [{ id: 1, lessons: [41, 40] }], revision: 7 }, headers: undefined });
  });

  it('moves lessons within and between sections, naming every one once', () => {
    const l = (id: number, s: number) => ({ id, section_id: s }) as never;
    const sections = [
      { id: 1, lessons: [l(40, 1), l(41, 1)] },
      { id: 2, lessons: [l(50, 2)] },
    ] as never;
    expect(arrangement(moveLesson(sections, 41, 2, 50))).toEqual([{ id: 1, lessons: [40] }, { id: 2, lessons: [41, 50] }]);
    expect(arrangement(moveLesson(sections, 40, 1, null))).toEqual([{ id: 1, lessons: [41, 40] }, { id: 2, lessons: [50] }]);
    expect(arrangement(moveLesson(sections, 99, 1, null))).toEqual([{ id: 1, lessons: [40, 41] }, { id: 2, lessons: [50] }]);
  });
});

describe('assigning learners', () => {
  it('previews the selection, then assigns the same selection once, with a key', async () => {
    tab.query = new URLSearchParams('manage=5&ct=enrollments');
    vi.mocked(apiGet).mockReset();
    serve(
      { '/options': options, '/courses/5': course({ status: 'PUBLISHED', can: { ...nocan, enroll: true, enrollments: true } }), '/courses/5/enrollments': { items: [], meta: { total: 0, page: 1, per_page: 50, pages: 1 } } },
      {
        'POST /courses/5/enrollments/preview': { new: [{ user_id: 4, name: 'Amaya', via: 'csv' }], skipped: [{ user_id: 6, name: 'Kasun', via: 'csv', reason: 'Already enrolled', status: 'IN_PROGRESS' }], blocked: [], not_permitted: [{ user_id: 7, name: 'Ruwan', via: 'csv' }], unknown: ['nobody@example.com'], counts: {} },
        'POST /courses/5/enrollments': { created: [{ user_id: 4, enrollment_id: 90 }], skipped: [], blocked: [], not_permitted: [], unknown: [] },
      },
    );
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Assign learners' }));
    const dialog = await screen.findByRole('dialog');
    const list = within(dialog).getAllByRole('textbox').find((t) => t.tagName === 'TEXTAREA')!;
    fireEvent.change(list, { target: { value: 'amaya@example.com\nkasun@example.com\nruwan@example.com\nnobody@example.com' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Preview' }));
    expect(await within(dialog).findByText('Will be assigned (1)')).toBeTruthy();
    expect(within(dialog).getByText('Outside your reach (1)')).toBeTruthy();
    expect(within(dialog).getByText('Not found: nobody@example.com')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Assign 1' }));
    await waitFor(() => expect(vi.mocked(request).mock.calls.some(([m, p]) => m === 'POST' && p === '/api/elearning/v1/courses/5/enrollments')).toBe(true));
    const [, , opts] = vi.mocked(request).mock.calls.find(([m, p]) => m === 'POST' && p === '/api/elearning/v1/courses/5/enrollments')!;
    expect(opts!.body).toMatchObject({ csv: 'amaya@example.com\nkasun@example.com\nruwan@example.com\nnobody@example.com', mandatory: false, user_ids: [], department_ids: [] });
    expect((opts!.headers as Record<string, string>)['Idempotency-Key']).toMatch(/^assign-/);
  });
});

describe('grading', () => {
  it('asks why before changing a grade already given, and sends the server what it needs', async () => {
    tab.query = new URLSearchParams('submission=33');
    const sub = { id: 33, assignment_id: 30, attempt_no: 1, status: 'GRADED', text: 'My report', files: [], submitted_at: '2026-09-28 10:00:00', is_late: false, score: 55, percent: 55, late_penalty: 0, passed: false, feedback: 'Too short', graded_at: '2026-09-28 12:00:00', learner: { id: 4, name: 'Amaya' }, raw_score: 55, assignment: { id: 30, course_id: 5, title: 'Phishing report', instructions: null, due_at: null, max_score: 100, pass_score: 60, allowed_types: [], max_file_mb: 25, max_files: 5, allow_text: true, require_file: false, attempts_allowed: 1, late_policy: null, late_penalty_pct: null }, history: [] };
    serve({ '/options': options, '/submissions/33': sub }, { 'POST /submissions/33/grade': { ...sub, score: 65 } });
    show();
    const save = await screen.findByRole('button', { name: 'Save the grade' });
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '65' } });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Why the grade changes (required)'), { target: { value: 'Missed the second page' } });
    fireEvent.click(save);
    await waitFor(() => expect(vi.mocked(request)).toHaveBeenCalledWith('POST', '/api/elearning/v1/submissions/33/grade', { body: { score: 65, feedback: 'Too short', decision: 'grade', reason: 'Missed the second page' }, headers: undefined }));
  });

  it('reads a response back as the options’ labels', () => {
    const labels = new Map([[11, 'Yes'], [12, 'No'], [7, 'Meow']]);
    expect(responseText([11, 12], labels)).toBe('Yes, No');
    expect(responseText({ 1: 7 }, labels)).toBe('1 — Meow');
    expect(responseText('free text', labels)).toBe('free text');
    expect(responseText(null, labels)).toBe('—');
  });
});

describe('questions as the server takes them', () => {
  const base = { prompt: 'Q', points: '2', explanation: '', options: [{ label: 'A', is_correct: true, match_label: 'a' }, { label: 'B', is_correct: false, match_label: 'b' }, { label: ' ', is_correct: false, match_label: '' }], answerTrue: false, accepted: 'cat\n kitten \n', caseSensitive: true, manual: false, blanks: 'cat | kitten\ndog', numAnswer: '42', tolerance: '', partial: true, maxFiles: '3' };
  it('sends each type its own fields, and the key only to the server', () => {
    expect(questionBody('SINGLE', base)).toEqual({ qtype: 'SINGLE', prompt: 'Q', points: 2, explanation: null, options: [{ label: 'A', is_correct: true }, { label: 'B', is_correct: false }] });
    expect(questionBody('MULTIPLE', base)).toMatchObject({ partial_credit: true });
    expect(questionBody('TRUE_FALSE', base)).toMatchObject({ answer: false });
    expect(questionBody('SHORT_ANSWER', base)).toMatchObject({ accepted: ['cat', 'kitten'], case_sensitive: true, manual: false });
    expect(questionBody('FILL_BLANK', base)).toMatchObject({ blanks: [['cat', 'kitten'], ['dog']], case_sensitive: true, partial_credit: true });
    expect(questionBody('NUMERIC', base)).toMatchObject({ answer: 42, tolerance: 0 });
    expect(questionBody('MATCHING', base)).toMatchObject({ options: [{ label: 'A', match_label: 'a' }, { label: 'B', match_label: 'b' }] });
    expect(questionBody('ORDERING', base)).toMatchObject({ options: [{ label: 'A' }, { label: 'B' }] });
    expect(questionBody('FILE_UPLOAD', base)).toMatchObject({ max_files: 3 });
    expect(questionBody('LONG_ANSWER', base)).toEqual({ qtype: 'LONG_ANSWER', prompt: 'Q', points: 2, explanation: null });
  });
});

describe('eLearning is native on the desktop', () => {
  it('registers a valid module, shown to whoever has the app and elearning.access', () => {
    const m = MODULES.find((x) => x.id === 'elearning');
    expect(m?.manifest.offline.mode).toBe('PARTIAL_WRITE');
    expect(m?.manifest.offline.cache).toContain('/api/elearning/v1/me/learning');
    const grant = { apps: ['elearning'], permissions: ['elearning.access'] };
    const apps = visibleApps(grant);
    expect(apps.find((a) => a.id === 'elearning')?.surface).toBe('native');
    expect(allowedModules(new Set(apps.map((a) => a.id))).has('elearning')).toBe(true);
    expect(visibleApps({ apps: ['elearning'], permissions: [] }).some((a) => a.id === 'elearning')).toBe(false);
    expect(visibleApps({ apps: [], permissions: ['elearning.access'] }).some((a) => a.id === 'elearning')).toBe(false);
  });

  it('opens the server’s links and worksuite:// links in the tab', () => {
    expect(resolveWebLink('/elearning/my/courses/12')).toEqual({ kind: 'tab', route: '/elearning/my/courses/12', app: 'elearning' });
    expect(resolveWebLink('/elearning/grading')).toEqual({ kind: 'tab', route: '/elearning/grading', app: 'elearning' });
    const l = parseDeepLink('worksuite://elearning/courses/12');
    expect(l.ok && l.link.route).toBe('/elearning/my/courses/12');
    const c = parseDeepLink('worksuite://elearning/catalog/7');
    expect(c.ok && c.link.route).toBe('/elearning/catalog/7');
    expect(parseDeepLink('worksuite://elearning/courses/12.3').ok).toBe(false);
    expect(parseDeepLink('worksuite://elearning/courses/12?next=/users').ok).toBe(false);
  });
});
