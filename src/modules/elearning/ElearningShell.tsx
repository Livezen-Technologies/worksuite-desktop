import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { Icon } from '../../components/Icon';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { useTab, useTabTitle } from '../../core/tab-context';
import type { ModuleProps } from '../registry';
import { eGet, K, useOnline, type Options } from './api';
import { ElContext, type El, type ElView } from './parts';
import { SidePanel } from '../../components/SidePanel';
import { OrgSwitcher } from '../../components/OrgSwitcher';
import { recallOrgChoice, rememberOrgChoice } from '../../core/org-prefs';

/**
 * eLearning, native in WorkSuite Desktop, over the server's `/api/elearning/v1`.
 *
 * Addressed as `/elearning?view=my|catalog|downloads|dashboard|courses|reviews|categories|learners|enrollments|approvals|grading|setup|settings`,
 * and a record as `?course=<id>[&lesson=<id>]` (taking a course), `?about=<id>` (a catalogue page),
 * `?quiz=<id>[&attempt=<id>]`, `?task=<id>` (an assignment), `?manage=<id>[&ct=<tab>]` (a course for its staff),
 * `?enrollment=`, `?learner=`, `?gattempt=` and `?submission=` (grading). The server's notification links —
 * `/elearning/my`, `/elearning/my/courses/<id>`, `/elearning/catalog/<id>`, `/elearning/courses/<id>`,
 * `/elearning/learners/<id>`, `/elearning/grading`, `/elearning/approvals` — open the same screens here.
 */
const MyLearning = lazy(() => import('./MyLearning'));
const Catalogue = lazy(() => import('./Catalogue'));
const CourseAbout = lazy(() => import('./CourseAbout'));
const CoursePlayer = lazy(() => import('./CoursePlayer'));
const Quiz = lazy(() => import('./Quiz'));
const Assignment = lazy(() => import('./Assignment'));
const Downloads = lazy(() => import('./Downloads'));
const Dashboard = lazy(() => import('./admin/Dashboard'));
const Courses = lazy(() => import('./admin/Courses'));
const CourseAdmin = lazy(() => import('./admin/CourseAdmin'));
const Reviews = lazy(() => import('./admin/Reviews'));
const Categories = lazy(() => import('./admin/Categories'));
const Learners = lazy(() => import('./admin/Learners'));
const LearnerDetail = lazy(() => import('./admin/LearnerDetail'));
const Enrollments = lazy(() => import('./admin/Enrollments'));
const EnrollmentDetail = lazy(() => import('./admin/EnrollmentDetail'));
const Approvals = lazy(() => import('./admin/Approvals'));
const Grading = lazy(() => import('./admin/Grading'));
const GradeAttempt = lazy(() => import('./admin/GradeAttempt'));
const GradeSubmission = lazy(() => import('./admin/GradeSubmission'));
const Setup = lazy(() => import('./admin/Setup'));
const Settings = lazy(() => import('./admin/Settings'));

type Group = 'learning' | 'overview' | 'manage' | 'people' | 'settings';

const VIEWS: Record<ElView, { label: string; icon: string; group: Group; show: (can: (k: string) => boolean) => boolean }> = {
  my: { label: 'My Learning', icon: 'home', group: 'learning', show: () => true },
  catalog: { label: 'Course catalogue', icon: 'book-open', group: 'learning', show: () => true },
  downloads: { label: 'Kept offline', icon: 'download', group: 'learning', show: () => true },
  dashboard: { label: 'Training dashboard', icon: 'chart', group: 'overview', show: (c) => c('dashboard_view') },
  courses: { label: 'Courses', icon: 'graduation-cap', group: 'manage', show: (c) => c('course_view') || c('course_create') || c('staff') },
  reviews: { label: 'Reviews', icon: 'check-check', group: 'manage', show: (c) => c('course_publish') },
  categories: { label: 'Categories', icon: 'tag', group: 'manage', show: (c) => c('settings_manage') },
  learners: { label: 'Learners', icon: 'users', group: 'people', show: (c) => c('learner_progress_view') || c('manager') || c('staff') },
  enrollments: { label: 'Enrolments', icon: 'list', group: 'people', show: (c) => c('enrollment_view') || c('manager') || c('staff') },
  approvals: { label: 'Requests to join', icon: 'user-plus', group: 'people', show: (c) => c('enrollment_manage') || c('manager') },
  grading: { label: 'Grading', icon: 'compose', group: 'people', show: (c) => c('assessment_grade') || c('assignment_grade') || c('staff') },
  setup: { label: 'Set-up wizard', icon: 'list-todo', group: 'settings', show: (c) => c('settings_manage') },
  settings: { label: 'Settings', icon: 'settings', group: 'settings', show: (c) => c('settings_manage') },
};

const HEADINGS: Record<Group, string | null> = { learning: null, overview: 'Overview', manage: 'Manage', people: 'People', settings: 'Settings' };

const ORG_KEY = 'elearning.org';
const num = (v: string | null | undefined) => (v && /^\d{1,10}$/.test(v) ? Number(v) : null);

function savedOrg(): string {
  try {
    // The organisation filter's memory (#214), shared with the other apps when the person chose so; this app's own before it.
    return recallOrgChoice('elearning') ?? localStorage.getItem(ORG_KEY) ?? '';
  } catch {
    return '';
  }
}

export type Screen =
  | { kind: 'view'; view: ElView }
  | { kind: 'course'; id: number; lesson: number | null }
  | { kind: 'about'; id: number }
  | { kind: 'quiz'; id: number; attempt: number | null }
  | { kind: 'task'; id: number }
  | { kind: 'manage'; id: number; tab: string | null }
  | { kind: 'enrollment'; id: number }
  | { kind: 'learner'; id: number }
  | { kind: 'attempt'; id: number }
  | { kind: 'submission'; id: number };

/** What a route names: a record first (query, then the web's paths the server's links carry), else a view. */
export function screenOf(path: string[], query: URLSearchParams): Screen {
  const q = (k: string) => num(query.get(k));
  if (q('course')) return { kind: 'course', id: q('course')!, lesson: q('lesson') };
  if (q('about')) return { kind: 'about', id: q('about')! };
  if (q('quiz')) return { kind: 'quiz', id: q('quiz')!, attempt: q('attempt') };
  if (q('task')) return { kind: 'task', id: q('task')! };
  if (q('manage')) return { kind: 'manage', id: q('manage')!, tab: query.get('ct') };
  if (q('enrollment')) return { kind: 'enrollment', id: q('enrollment')! };
  if (q('learner')) return { kind: 'learner', id: q('learner')! };
  if (q('gattempt')) return { kind: 'attempt', id: q('gattempt')! };
  if (q('submission')) return { kind: 'submission', id: q('submission')! };
  const rest = path[0] === 'elearning' ? path.slice(1) : path;
  const [a, b, c] = rest;
  if (a === 'my' && b === 'courses' && num(c)) return { kind: 'course', id: num(c)!, lesson: q('lesson') };
  if (a === 'catalog' && num(b)) return { kind: 'about', id: num(b)! };
  if (a === 'courses' && num(b)) return { kind: 'manage', id: num(b)!, tab: query.get('ct') };
  if (a === 'learners' && num(b)) return { kind: 'learner', id: num(b)! };
  const asked = query.get('view') ?? (a === 'my' ? 'my' : a === 'catalog' ? 'catalog' : a === 'grading' ? 'grading' : a === 'approvals' ? 'approvals' : a === 'learners' ? 'learners' : a === 'courses' ? 'courses' : '');
  return { kind: 'view', view: asked in VIEWS ? (asked as ElView) : 'my' };
}

const TITLES: Record<Exclude<Screen['kind'], 'view'>, string> = {
  course: 'Course', about: 'Course', quiz: 'Quiz', task: 'Assignment', manage: 'Course', enrollment: 'Enrolment', learner: 'Learner', attempt: 'Grading', submission: 'Grading',
};

export default function ElearningShell(_props: ModuleProps) {
  const { query, path, go: goRoute, openInWindow } = useTab();
  const online = useOnline();
  const [org, setOrg] = useState(savedOrg);
  const options = useQuery({ queryKey: K.options(org), queryFn: ({ signal }) => eGet<Options>('/options', org ? { org } : undefined, signal) });
  const opts = options.data;
  const screen = screenOf(path, query);
  const title = screen.kind === 'view' ? VIEWS[screen.view].label : TITLES[screen.kind];
  useTabTitle(`eLearning · ${title}`);

  if (options.isLoading) return <Spinner label="Opening eLearning…" />;
  if (options.error || !opts) {
    return (
      <div className="p-6">
        <ErrorNote error={options.error ?? new Error('eLearning could not be loaded.')} onRetry={() => void options.refetch()} />
      </div>
    );
  }

  const can = (k: string) => opts.can[k] === true;
  const scope = org || String(opts.org);
  const route = (params: Record<string, string | number | null | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') q.set(k, String(v));
    const s = q.toString();
    return s ? `/elearning?${s}` : '/elearning';
  };
  const current = screen.kind === 'view' ? screen.view : null;
  const el: El = {
    org: scope,
    options: opts,
    can,
    online,
    go: (v, params) => goRoute(route({ view: v, ...params })),
    open: {
      course: (id, lesson) => goRoute(route({ course: id, lesson })),
      about: (id) => goRoute(route({ about: id })),
      quiz: (id, attempt) => goRoute(route({ quiz: id, attempt })),
      task: (id) => goRoute(route({ task: id })),
      manage: (id, tab) => goRoute(route({ manage: id, ct: tab })),
      enrollment: (id) => goRoute(route({ enrollment: id })),
      learner: (id) => goRoute(route({ learner: id })),
      attempt: (id) => goRoute(route({ gattempt: id })),
      submission: (id) => goRoute(route({ submission: id })),
    },
    openWindow: (r, t) => openInWindow(r, t),
    route,
  };
  const chooseOrg = (v: string) => {
    setOrg(v);
    rememberOrgChoice('elearning', v);
    try {
      localStorage.setItem(ORG_KEY, v);
    } catch {
      /* a convenience */
    }
  };
  const groups: Group[] = ['learning', 'overview', 'manage', 'people', 'settings'];
  const back = () => goRoute(route({ view: current ?? 'my' }));
  const setupPending = !opts.setup.complete && can('settings_manage');

  const body = (() => {
    switch (screen.kind) {
      case 'course':
        return <CoursePlayer key={`c${screen.id}`} id={screen.id} lesson={screen.lesson} />;
      case 'about':
        return <CourseAbout key={`a${screen.id}`} id={screen.id} />;
      case 'quiz':
        return <Quiz key={`q${screen.id}-${screen.attempt ?? ''}`} id={screen.id} attempt={screen.attempt} />;
      case 'task':
        return <Assignment key={`t${screen.id}`} id={screen.id} />;
      case 'manage':
        return <CourseAdmin key={`m${screen.id}`} id={screen.id} tab={screen.tab} />;
      case 'enrollment':
        return <EnrollmentDetail key={`e${screen.id}`} id={screen.id} onBack={back} />;
      case 'learner':
        return <LearnerDetail key={`l${screen.id}`} id={screen.id} onBack={back} />;
      case 'attempt':
        return <GradeAttempt key={`g${screen.id}`} id={screen.id} onBack={() => el.go('grading')} />;
      case 'submission':
        return <GradeSubmission key={`s${screen.id}`} id={screen.id} onBack={() => el.go('grading')} />;
      default:
        break;
    }
    const v = screen.view;
    if (!VIEWS[v].show(can)) return <MyLearning />;
    switch (v) {
      case 'catalog':
        return <Catalogue />;
      case 'downloads':
        return <Downloads />;
      case 'dashboard':
        return <Dashboard />;
      case 'courses':
        return <Courses />;
      case 'reviews':
        return <Reviews />;
      case 'categories':
        return <Categories />;
      case 'learners':
        return <Learners />;
      case 'enrollments':
        return <Enrollments />;
      case 'approvals':
        return <Approvals />;
      case 'grading':
        return <Grading />;
      case 'setup':
        return <Setup />;
      case 'settings':
        return <Settings />;
      default:
        return <MyLearning />;
    }
  })();

  return (
    <ElContext.Provider value={el}>
      <div className="flex h-full min-h-0">
        <SidePanel id="elearning" label="the eLearning menu">
          <nav aria-label="eLearning" className="flex w-[220px] shrink-0 flex-col overflow-hidden border-r border-line bg-[#FBFBFD] text-[13px] text-ink dark:bg-surface">
            <div className="flex flex-col gap-2 px-2.5 pt-3.5 pb-1">
              <div className="flex items-center gap-2 px-1">
                <span className="grid size-8 place-items-center rounded-[10px] bg-selection text-primary">
                  <Icon name="graduation-cap" size={17} />
                </span>
                <div className="min-w-0">
                  <b className="block text-[13.5px]">eLearning</b>
                  <span className="block truncate text-[11px] text-ink-3">{opts.companies.find((c) => c.id === opts.org)?.name ?? ''}</span>
                </div>
              </div>
              {opts.companies.length > 1 ? (
                <OrgSwitcher variant="field" allowAll={false} orgs={opts.companies.map((c) => ({ id: String(c.id), name: c.name }))} value={scope ? [scope] : []} onChange={(ids) => ids[0] && chooseOrg(ids[0])} />
              ) : null}
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2.5 pb-3 scroll-thin">
              {groups.map((grp) => {
                const items = (Object.keys(VIEWS) as ElView[]).filter((v) => VIEWS[v].group === grp && VIEWS[v].show(can));
                if (items.length === 0) return null;
                return (
                  <div key={grp} className="flex flex-col gap-px">
                    {HEADINGS[grp] ? <div className="mt-3 mb-0.5 px-2 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">{HEADINGS[grp]}</div> : null}
                    {items.map((v) => {
                      const on = current === v;
                      const label = v === 'setup' && setupPending ? 'Finish set-up' : VIEWS[v].label;
                      return (
                        <button
                          key={v}
                          type="button"
                          aria-current={on ? 'page' : undefined}
                          onClick={() => el.go(v)}
                          className={cx('relative flex h-[30px] shrink-0 items-center gap-[9px] rounded-[8px] pr-2 pl-2.5 text-left', on ? 'bg-[#EAEDFB] font-bold text-[#1B2A85] dark:bg-selection dark:text-primary' : 'font-medium text-ink hover:bg-subtle')}
                        >
                          <span className={cx('absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r-[3px]', on ? 'bg-primary' : 'bg-transparent')} />
                          <Icon name={VIEWS[v].icon} size={16} className={cx('shrink-0', on ? 'text-primary' : 'text-ink-3')} />
                          <span className="min-w-0 flex-1 truncate">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </nav>
        </SidePanel>
        <main className="min-w-0 flex-1 overflow-y-auto bg-ground scroll-thin" aria-label={`eLearning · ${title}`}>
          {!online ? (
            <div className="border-b border-line bg-warning-bg px-6 py-1.5 text-[12.5px] font-medium text-warning">
              Offline — My Learning, the catalogue and your courses show their last copy, and courses kept offline play. Progress is kept and sent when WorkSuite is back; everything else waits for it.
            </div>
          ) : null}
          <Suspense fallback={<Spinner />}>{body}</Suspense>
        </main>
      </div>
    </ElContext.Provider>
  );
}
