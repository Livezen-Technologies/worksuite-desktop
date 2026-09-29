import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useRef, useState } from 'react';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { Button, ErrorNote, Modal, Spinner, Switch, cx } from '../../../components/ui';
import { toast } from '../../../core/toasts';
import { eGet, ePost, errorText, K, labelOf, newKey, refusal, toLocalInput, toUtc, when, type Activity, type AssessmentCard, type AssignmentCard, type Category, type Condition, type Course, type RuleGroup } from '../api';
import { area, Ask, Back, CourseStatusPill, Field, input, Pill, Refusal, Rich, RichField, Section, useEl } from '../parts';
import { usePeople } from './people';

const Builder = lazy(() => import('./Builder'));
const AssessmentsTab = lazy(() => import('./AssessmentsTab'));
const AssignmentsTab = lazy(() => import('./AssignmentsTab'));
const CourseEnrollments = lazy(() => import('./CourseEnrollments'));
const Preview = lazy(() => import('./Preview'));

type Tab = 'details' | 'builder' | 'assessments' | 'assignments' | 'enrollments' | 'staff' | 'activity' | 'preview';

/**
 * A course for its staff (§5.1–§5.3, WF-01): the lifecycle as far as the
 * person may take it (the course's own `can`), its details, the builder,
 * assessments and assignments, who is enrolled, its staff, and its audit.
 */
export default function CourseAdmin({ id, tab }: { id: number; tab: string | null }) {
  const el = useEl();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.course(id), queryFn: ({ signal }) => eGet<Course>(`/courses/${id}`, undefined, signal) });
  const [asking, setAsking] = useState<null | 'submit' | 'recall' | 'approve' | 'return' | 'suspend' | 'archive' | 'reopen' | 'delete' | 'publish' | 'duplicate'>(null);
  const [problem, setProblem] = useState<{ text: string; list: string[]; setup: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <Back onClick={() => el.go('courses')} label="Courses" />
        <ErrorNote error={q.error ?? new Error('This course could not be loaded.')} onRetry={() => void q.refetch()} />
      </div>
    );
  }
  const c = q.data;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: K.course(id) });
    void qc.invalidateQueries({ queryKey: ['elearning', 'courses'] });
    void qc.invalidateQueries({ queryKey: K.reviews });
    void qc.invalidateQueries({ queryKey: ['elearning', 'setup'] });
  };
  /** A lifecycle step; the server's refusal kept on the page with its list of problems. */
  const step = async (path: string, body: object = {}) => {
    setProblem(null);
    try {
      const r = await ePost<Course>(`/courses/${id}/${path}`, body);
      qc.setQueryData(K.course(id), r.data);
      toast('success', r.message);
      refresh();
      setAsking(null);
    } catch (e) {
      const r = refusal(e);
      const list = Array.isArray(r?.problems) ? (r.problems as string[]) : [];
      if (list.length || r?.code === 'setup_required') {
        setProblem({ text: errorText(e), list, setup: r?.code === 'setup_required' });
        setAsking(null);
        return;
      }
      throw e;
    }
  };
  const resume = async () => {
    setBusy(true);
    try {
      await step('resume');
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const tabs: Array<[Tab, string, boolean]> = [
    ['details', 'Details', true],
    ['builder', 'Builder', true],
    ['assessments', 'Assessments', c.can.assessments || el.can('assessment_view')],
    ['assignments', 'Assignments', c.can.assignments || el.can('assignment_view')],
    ['enrollments', 'Enrolments', c.can.enrollments || c.can.enroll],
    ['staff', 'Staff', true],
    ['activity', 'Activity', true],
    ['preview', 'Preview as a learner', true],
  ];
  const shown = tabs.filter((t) => t[2]);
  const current: Tab = shown.some((t) => t[0] === tab) ? (tab as Tab) : 'details';
  const cn = c.can;
  const online = el.online;

  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      <Back onClick={() => el.go('courses')} label="Courses" />
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[12px] font-semibold text-ink-3">
              {c.code} · version {c.version} · revision {c.revision}
            </span>
            <CourseStatusPill status={c.status} options={el.options} />
            {c.publish_at && c.status === 'APPROVED' ? <Pill tone="blue">Publishes {when(c.publish_at, true)}</Pill> : null}
          </div>
          <h1 className="m-0 text-[20px] font-bold text-ink">{c.title}</h1>
          <p className="m-0 text-[12.5px] text-ink-3">
            {[labelOf(el.options.course_types, c.course_type), c.category_path, c.instructor?.name, `${c.enrolled} enrolled`].filter(Boolean).join(' · ')}
          </p>
          {c.status === 'SUSPENDED' && c.suspend_reason ? <p className="m-0 text-[12.5px] text-danger">Suspended: {c.suspend_reason}</p> : null}
          {c.review_note && c.status === 'DRAFT' ? <p className="m-0 text-[12.5px] text-warning">Returned: {c.review_note}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {cn.submit ? (
            <Button variant="primary" icon="send" disabled={!online} onClick={() => setAsking('submit')}>
              Submit for review
            </Button>
          ) : null}
          {cn.review && c.review?.may_decide ? (
            <>
              <Button variant="success" icon="check" disabled={!online} onClick={() => setAsking('approve')}>
                Approve
              </Button>
              <Button disabled={!online} onClick={() => setAsking('return')}>
                Return
              </Button>
            </>
          ) : null}
          {cn.publish ? (
            <Button variant="primary" icon="send" disabled={!online} onClick={() => setAsking('publish')}>
              Publish
            </Button>
          ) : null}
          {cn.recall ? (
            <Button disabled={!online} onClick={() => setAsking('recall')}>
              Recall
            </Button>
          ) : null}
          {cn.resume ? (
            <Button icon="play" loading={busy} disabled={!online} onClick={() => void resume()}>
              Resume
            </Button>
          ) : null}
          {cn.suspend ? (
            <Button disabled={!online} onClick={() => setAsking('suspend')}>
              Suspend
            </Button>
          ) : null}
          {cn.archive ? (
            <Button disabled={!online} onClick={() => setAsking('archive')}>
              Archive
            </Button>
          ) : null}
          {cn.reopen ? (
            <Button disabled={!online} onClick={() => setAsking('reopen')}>
              Reopen as a new version
            </Button>
          ) : null}
          {cn.duplicate ? (
            <Button icon="copy" disabled={!online} onClick={() => setAsking('duplicate')}>
              Duplicate
            </Button>
          ) : null}
          {cn.delete ? (
            <Button variant="ghost" icon="trash" disabled={!online} onClick={() => setAsking('delete')}>
              Delete
            </Button>
          ) : null}
        </div>
      </div>
      {problem ? (
        <div className="flex flex-col gap-1 rounded-[10px] border border-warning/40 bg-warning-bg px-3 py-2 text-[12.5px] text-warning">
          <b>{problem.text}</b>
          {problem.list.length ? (
            <ul className="m-0 list-disc pl-5">
              {problem.list.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          ) : null}
          {problem.setup ? (
            <button type="button" className="self-start font-semibold underline" onClick={() => el.go('setup')}>
              Open the set-up
            </button>
          ) : null}
        </div>
      ) : null}
      <nav className="flex flex-wrap gap-1 border-b border-line" aria-label="Course sections">
        {shown.map(([t, label]) => (
          <button key={t} type="button" aria-current={current === t ? 'page' : undefined} onClick={() => el.open.manage(id, t)} className={cx('-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold', current === t ? 'border-primary text-primary' : 'border-transparent text-ink-2 hover:text-ink')}>
            {label}
          </button>
        ))}
      </nav>
      <Suspense fallback={<Spinner />}>
        {current === 'details' ? (
          <Details key={`${c.id}-${c.revision}`} c={c} onSaved={refresh} />
        ) : current === 'builder' ? (
          <Builder course={c} />
        ) : current === 'assessments' ? (
          <AssessmentsTab course={c} />
        ) : current === 'assignments' ? (
          <AssignmentsTab course={c} />
        ) : current === 'enrollments' ? (
          <CourseEnrollments course={c} />
        ) : current === 'staff' ? (
          <StaffTab c={c} onChanged={refresh} />
        ) : current === 'activity' ? (
          <ActivityTab id={id} />
        ) : (
          <Preview course={c} />
        )}
      </Suspense>

      {asking === 'submit' ? <Ask title="Submit for review" text={el.options.review_required ? 'The course goes to its reviewers; nobody reviews their own course.' : undefined} label="A note for the reviewers" confirm="Submit" onClose={() => setAsking(null)} onConfirm={(w) => step('submit-review', w ? { note: w } : {})} /> : null}
      {asking === 'recall' ? <Ask title="Recall from review" text="The course goes back to draft and the review is cancelled." label="Why" confirm="Recall" onClose={() => setAsking(null)} onConfirm={(w) => step('recall', w ? { reason: w } : {})} /> : null}
      {asking === 'approve' ? <Ask title="Approve the course" label="Comment" confirm="Approve" onClose={() => setAsking(null)} onConfirm={(w) => step('review', { decision: 'approve', comment: w })} /> : null}
      {asking === 'return' ? <Ask title="Return the course" text="The course goes back to draft with your comment." label="What needs changing" required confirm="Return" onClose={() => setAsking(null)} onConfirm={(w) => step('review', { decision: 'return', comment: w })} /> : null}
      {asking === 'suspend' ? <Ask title="Suspend the course" text="Nobody can join or open lessons while it is suspended; progress is kept." label="Why" required danger confirm="Suspend" onClose={() => setAsking(null)} onConfirm={(w) => step('suspend', { reason: w })} /> : null}
      {asking === 'archive' ? <Ask title="Archive the course" text="It leaves the catalogue; enrolments, progress and grades stay." label="Why" danger confirm="Archive" onClose={() => setAsking(null)} onConfirm={(w) => step('archive', w ? { reason: w } : {})} /> : null}
      {asking === 'reopen' ? <Ask title="Reopen as a new version" text={`It becomes a draft of version ${c.version + 1}.`} label="Why" confirm="Reopen" onClose={() => setAsking(null)} onConfirm={(w) => step('reopen', w ? { reason: w } : {})} /> : null}
      {asking === 'publish' ? <Publish onClose={() => setAsking(null)} onPublish={(at) => step('publish', at ? { publish_at: at } : {})} /> : null}
      {asking === 'delete' ? (
        <Ask
          title="Delete this draft?"
          text="A draft that was never published, with nobody enrolled, can be deleted."
          label="Why"
          danger
          confirm="Delete"
          onClose={() => setAsking(null)}
          onConfirm={async () => {
            const r = await ePost(`/courses/${id}/delete`, {});
            toast('success', r.message);
            void qc.invalidateQueries({ queryKey: ['elearning', 'courses'] });
            el.go('courses');
          }}
        />
      ) : null}
      {asking === 'duplicate' ? <Duplicate c={c} onClose={() => setAsking(null)} /> : null}
    </div>
  );
}

function Publish({ onClose, onPublish }: { onClose: () => void; onPublish: (at: string | null) => Promise<void> }) {
  const [later, setLater] = useState('');
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setWhy(null);
    try {
      await onPublish(later ? toUtc(later) : null);
    } catch (e) {
      setWhy(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Publish the course"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void go()}>
            {later ? 'Schedule' : 'Publish now'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[13px] text-ink-2">Published, it is in the catalogue (as its visibility says) and can be assigned. Each publish keeps a copy of this version.</p>
        <Field label="Publish later (optional)">
          <input type="datetime-local" className={`${input} max-w-[260px]`} value={later} onChange={(e) => setLater(e.target.value)} />
        </Field>
        {why ? <Refusal text={why} /> : null}
      </div>
    </Modal>
  );
}

function Duplicate({ c, onClose }: { c: Course; onClose: () => void }) {
  const el = useEl();
  const [title, setTitle] = useState(`${c.title} (copy)`);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const key = useRef<string | null>(null);
  const go = async () => {
    setBusy(true);
    key.current ??= newKey('duplicate');
    try {
      const r = await ePost<Course>(`/courses/${c.id}/duplicate`, { title: title.trim() || undefined, code: code.trim() || undefined }, key.current);
      key.current = null;
      toast('success', r.message);
      onClose();
      el.open.manage(r.data.id);
    } catch (e) {
      key.current = null;
      setWhy(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Duplicate the course"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void go()}>
            Duplicate
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[13px] text-ink-2">A new draft with the same details, staff, sections, lessons (the same Drive files), assessments and assignments.</p>
        <Field label="Title">
          <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </Field>
        <Field label="Code (optional)" hint="Left blank, the server offers one.">
          <input className={`${input} max-w-[220px] font-mono uppercase`} value={code} onChange={(e) => setCode(e.target.value)} maxLength={40} />
        </Field>
        {why ? <Refusal text={why} /> : null}
      </div>
    </Modal>
  );
}

// ── details ─────────────────────────────────────────────────────────────

function Details({ c, onSaved }: { c: Course; onSaved: () => void }) {
  const el = useEl();
  const qc = useQueryClient();
  const o = el.options;
  const cats = useQuery({ queryKey: K.categories(String(c.org_id), false), queryFn: ({ signal }) => eGet<{ items: Category[] }>('/categories', { org: c.org_id }, signal) });
  const assessments = useQuery({ queryKey: K.assessments(c.id), queryFn: ({ signal }) => eGet<{ items: AssessmentCard[] }>(`/courses/${c.id}/assessments`, undefined, signal), enabled: c.can.assessments || el.can('assessment_view') });
  const assignments = useQuery({ queryKey: K.assignments(c.id), queryFn: ({ signal }) => eGet<{ items: AssignmentCard[] }>(`/courses/${c.id}/assignments`, undefined, signal), enabled: c.can.assignments || el.can('assignment_view') });
  const [f, setF] = useState({
    title: c.title,
    code: c.code,
    summary: c.summary ?? '',
    description: c.description ?? '',
    objectives: (c.objectives ?? []).join('\n'),
    category_id: c.category ? String(c.category.id) : '',
    course_type: c.course_type,
    level: c.level ?? '',
    language: c.language ?? '',
    estimated_minutes: c.estimated_minutes ? String(c.estimated_minutes) : '',
    enrollment_type: c.enrollment_type,
    visibility: c.visibility,
    start_at: toLocalInput(c.start_at),
    end_at: toLocalInput(c.end_at),
    due_days: c.due_days ? String(c.due_days) : '',
    capacity: c.capacity ? String(c.capacity) : '',
    passing_score: c.passing_score !== null && c.passing_score !== undefined ? String(c.passing_score) : '',
    progress_weighting: c.progress_weighting ?? '',
    certificate_enabled: c.certificate_enabled,
    validity_months: c.validity_months ? String(c.validity_months) : '',
  });
  const [rule, setRule] = useState<RuleGroup | null>(c.completion_rule);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const set = (k: keyof typeof f) => (v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const may = c.can.edit && el.online;
  const n = (v: string) => (v.trim() === '' ? null : Number(v));

  const save = async () => {
    setBusy(true);
    setWhy(null);
    try {
      const r = await ePost<Course>(`/courses/${c.id}`, {
        title: f.title.trim(),
        code: f.code.trim(),
        summary: f.summary.trim() || null,
        description: f.description,
        objectives: f.objectives.split('\n').map((x) => x.trim()).filter(Boolean),
        category_id: n(f.category_id),
        course_type: f.course_type,
        level: f.level || null,
        language: f.language.trim() || null,
        estimated_minutes: n(f.estimated_minutes),
        enrollment_type: f.enrollment_type,
        visibility: f.visibility,
        start_at: f.start_at ? toUtc(f.start_at) : null,
        end_at: f.end_at ? toUtc(f.end_at) : null,
        due_days: n(f.due_days),
        capacity: n(f.capacity),
        passing_score: n(f.passing_score),
        progress_weighting: f.progress_weighting || null,
        certificate_enabled: f.certificate_enabled,
        validity_months: n(f.validity_months),
        completion_rule: rule,
        revision: c.revision,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      qc.setQueryData(K.course(c.id), r.data);
      toast('success', r.message);
      onSaved();
    } catch (e) {
      if (refusal(e)?.code === 'revision_conflict') setStale(true);
      setWhy(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const choice = (list: Array<{ value: string; label: string; available?: boolean }>) => list.filter((x) => x.available !== false).map((x) => ({ value: x.value, label: x.label }));

  return (
    <div className="flex max-w-[960px] flex-col gap-4">
      {c.status === 'PUBLISHED' ? <Refusal text="The course is published: changes here reach learners at once." /> : null}
      {c.status === 'ARCHIVED' ? <Refusal text="An archived course is not edited. Reopen it as a new version first." /> : null}
      <Section title="The course">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Title" className="md:col-span-2">
            <input className={input} disabled={!may} value={f.title} onChange={(e) => set('title')(e.target.value)} maxLength={200} />
          </Field>
          <Field label="Code">
            <input className={`${input} font-mono uppercase`} disabled={!may} value={f.code} onChange={(e) => set('code')(e.target.value)} maxLength={40} />
          </Field>
          <Field label="Category">
            <Select aria-label="Category" disabled={!may} value={f.category_id} onChange={(e) => set('category_id')(e.target.value)} options={[{ value: '', label: 'None' }, ...(cats.data?.items ?? []).filter((x) => !x.archived || String(x.id) === f.category_id).map((x) => ({ value: String(x.id), label: x.path || x.name }))]} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
          </Field>
          <Field label="Summary" className="md:col-span-2">
            <input className={input} disabled={!may} value={f.summary} onChange={(e) => set('summary')(e.target.value)} maxLength={500} />
          </Field>
          <div className="md:col-span-2">
            <span className="mb-1 block text-[12.5px] font-semibold text-ink-2">Description</span>
            {may ? <RichField initial={c.description} label="Description" onChange={(h) => set('description')(h)} /> : <div className="rounded-[8px] border border-line p-3">{c.description ? <Rich html={c.description} /> : <span className="text-[13px] text-ink-3">No description.</span>}</div>}
          </div>
          <Field label="What learners will learn" hint="One per line." className="md:col-span-2">
            <textarea className={area} disabled={!may} value={f.objectives} onChange={(e) => set('objectives')(e.target.value)} />
          </Field>
          <Field label="Type">
            <Select aria-label="Course type" disabled={!may} value={f.course_type} onChange={(e) => set('course_type')(e.target.value)} options={o.course_types.map((t) => ({ value: t.value, label: t.label }))} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
          </Field>
          <Field label="Level">
            <Select aria-label="Level" disabled={!may} value={f.level} onChange={(e) => set('level')(e.target.value)} options={[{ value: '', label: 'None' }, ...o.levels.map((l) => ({ value: l, label: l }))]} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
          </Field>
          <Field label="Language" hint={`ISO code; the company's default is ${o.default_language}.`}>
            <input className={`${input} max-w-[120px]`} disabled={!may} value={f.language} onChange={(e) => set('language')(e.target.value)} maxLength={10} />
          </Field>
          <Field label="Estimated minutes">
            <input type="number" min={0} className={`${input} max-w-[160px]`} disabled={!may} value={f.estimated_minutes} onChange={(e) => set('estimated_minutes')(e.target.value)} />
          </Field>
        </div>
      </Section>
      <Section title="Who can take it">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Enrolment" hint={o.enrollment_types.filter((x) => x.available === false).map((x) => `${x.label}: ${x.why ?? 'later'}`).join(' ')}>
            <Select aria-label="Enrolment type" disabled={!may} value={f.enrollment_type} onChange={(e) => set('enrollment_type')(e.target.value)} options={choice(o.enrollment_types)} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
          </Field>
          <Field label="Visibility" hint={o.visibility.filter((x) => x.available === false).map((x) => `${x.label}: ${x.why ?? 'later'}`).join(' ')}>
            <Select aria-label="Visibility" disabled={!may} value={f.visibility} onChange={(e) => set('visibility')(e.target.value)} options={choice(o.visibility)} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
          </Field>
          <Field label="Starts">
            <input type="datetime-local" className={input} disabled={!may} value={f.start_at} onChange={(e) => set('start_at')(e.target.value)} />
          </Field>
          <Field label="Ends" hint="Offline copies of the course end then too.">
            <input type="datetime-local" className={input} disabled={!may} value={f.end_at} onChange={(e) => set('end_at')(e.target.value)} />
          </Field>
          <Field label="Due, days after enrolling">
            <input type="number" min={0} className={`${input} max-w-[160px]`} disabled={!may} value={f.due_days} onChange={(e) => set('due_days')(e.target.value)} />
          </Field>
          <Field label="Places">
            <input type="number" min={0} className={`${input} max-w-[160px]`} disabled={!may} value={f.capacity} onChange={(e) => set('capacity')(e.target.value)} />
          </Field>
        </div>
      </Section>
      <Section title="Completing it">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Passing score (%)">
            <input type="number" min={0} max={100} className={`${input} max-w-[160px]`} disabled={!may} value={f.passing_score} onChange={(e) => set('passing_score')(e.target.value)} />
          </Field>
          <Field label="Progress weighting">
            <Select aria-label="Progress weighting" disabled={!may} value={f.progress_weighting} onChange={(e) => set('progress_weighting')(e.target.value)} options={[{ value: '', label: "The company's setting" }, { value: 'equal', label: 'Every lesson the same' }, { value: 'duration', label: 'By lesson length' }]} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
          </Field>
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            <Switch checked={f.certificate_enabled} disabled={!may} onChange={(v) => set('certificate_enabled')(v)} label="Certificate" /> Certificate on completion (issued once certificates arrive)
          </label>
          <Field label="Valid for (months)">
            <input type="number" min={0} className={`${input} max-w-[160px]`} disabled={!may} value={f.validity_months} onChange={(e) => set('validity_months')(e.target.value)} />
          </Field>
        </div>
        <div className="mt-3">
          <RuleEditor rule={rule} effective={c.completion_rule_effective} disabled={!may} assessments={assessments.data?.items ?? []} assignments={assignments.data?.items ?? []} conditions={el.options.course_conditions} onChange={setRule} />
        </div>
      </Section>
      {may ? (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Why (optional, kept in the audit)" className="min-w-[280px] flex-1">
            <input className={input} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
          </Field>
          <Button variant="primary" icon="check" loading={busy} onClick={() => void save()}>
            Save changes
          </Button>
        </div>
      ) : null}
      {why ? (
        <Refusal text={why}>
          {stale ? (
            <button type="button" className="font-semibold underline" onClick={() => void qc.invalidateQueries({ queryKey: K.course(c.id) })}>
              Load their changes
            </button>
          ) : null}
        </Refusal>
      ) : null}
    </div>
  );
}

const COND_LABEL: Record<string, string> = {
  ALL_MANDATORY_LESSONS: 'Complete every mandatory lesson',
  MIN_PROGRESS: 'Reach a progress of',
  PASS_ASSESSMENT: 'Pass the assessment',
  COMPLETE_ASSIGNMENT: 'Complete the assignment',
};

/**
 * The course's completion rule (§5.14): every condition, or any of them.
 * Groups the server accepts deeper than one level are shown and kept, not
 * edited here.
 */
function RuleEditor({ rule, effective, disabled, assessments, assignments, conditions, onChange }: {
  rule: RuleGroup | null;
  effective: RuleGroup | null;
  disabled: boolean;
  assessments: AssessmentCard[];
  assignments: AssignmentCard[];
  conditions: Array<{ value: string; label: string; available?: boolean; why?: string }>;
  onChange: (r: RuleGroup | null) => void;
}) {
  const r = rule ?? { op: 'AND' as const, conditions: [] };
  const flat = r.conditions.every((x) => 'type' in x);
  const upd = (conds: Array<Condition | RuleGroup>) => onChange(conds.length ? { op: r.op, conditions: conds } : null);
  const later = conditions.filter((x) => x.available === false);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold text-ink-2">
        The course is complete when learners meet
        <Select aria-label="Every or any" disabled={disabled || !flat} value={r.op} onChange={(e) => onChange({ ...r, op: e.target.value as 'AND' | 'OR' })} options={[{ value: 'AND', label: 'every condition' }, { value: 'OR', label: 'any condition' }]} className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[12.5px]" />
      </div>
      {r.conditions.length === 0 ? <p className="m-0 text-[12.5px] text-ink-3">No rule of its own: {effective ? 'the server applies every mandatory lesson' : 'every mandatory lesson'}.</p> : null}
      {!flat ? <Refusal text="This rule has nested groups; it is kept as it is. Change it on the web, or clear it to start again." /> : null}
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {r.conditions.map((x, i) =>
          'type' in x ? (
            <li key={i} className="flex flex-wrap items-center gap-2 rounded-[8px] border border-line px-2.5 py-1.5 text-[12.5px]">
              <span className="font-semibold text-ink">{COND_LABEL[x.type] ?? x.type}</span>
              {x.type === 'MIN_PROGRESS' ? (
                <>
                  <input type="number" min={1} max={100} aria-label="Percent" disabled={disabled} className="h-7 w-20 rounded-[6px] border border-line bg-surface px-2" value={x.percent} onChange={(e) => upd(r.conditions.map((y, j) => (j === i ? { type: 'MIN_PROGRESS', percent: Number(e.target.value) } : y)))} />%
                </>
              ) : null}
              {x.type === 'PASS_ASSESSMENT' ? (
                <>
                  <Select aria-label="Assessment" disabled={disabled} value={String(x.assessment_id || '')} onChange={(e) => upd(r.conditions.map((y, j) => (j === i ? { ...x, assessment_id: Number(e.target.value) } : y)))} options={[{ value: '', label: 'Choose…' }, ...assessments.map((a) => ({ value: String(a.id), label: a.title }))]} className="h-7 min-w-[180px] rounded-[6px] border border-line bg-surface px-2" />
                  <span className="text-ink-3">at least</span>
                  <input type="number" min={0} max={100} aria-label="Minimum score" placeholder="its pass mark" disabled={disabled} className="h-7 w-28 rounded-[6px] border border-line bg-surface px-2" value={x.min_score ?? ''} onChange={(e) => upd(r.conditions.map((y, j) => (j === i ? { ...x, min_score: e.target.value === '' ? null : Number(e.target.value) } : y)))} />
                </>
              ) : null}
              {x.type === 'COMPLETE_ASSIGNMENT' ? (
                <Select aria-label="Assignment" disabled={disabled} value={String(x.assignment_id || '')} onChange={(e) => upd(r.conditions.map((y, j) => (j === i ? { type: 'COMPLETE_ASSIGNMENT', assignment_id: Number(e.target.value) } : y)))} options={[{ value: '', label: 'Choose…' }, ...assignments.map((a) => ({ value: String(a.id), label: a.title }))]} className="h-7 min-w-[180px] rounded-[6px] border border-line bg-surface px-2" />
              ) : null}
              <span className="flex-1" />
              {!disabled ? (
                <button type="button" aria-label="Remove the condition" className="text-ink-3 hover:text-danger" onClick={() => upd(r.conditions.filter((_, j) => j !== i))}>
                  <Icon name="x" size={14} />
                </button>
              ) : null}
            </li>
          ) : (
            <li key={i} className="rounded-[8px] border border-dashed border-line px-2.5 py-1.5 text-[12.5px] text-ink-3">
              A group of {x.conditions.length} ({x.op === 'AND' ? 'every one' : 'any one'})
            </li>
          ),
        )}
      </ul>
      {!disabled && flat ? (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" icon="plus" onClick={() => upd([...r.conditions, { type: 'ALL_MANDATORY_LESSONS' }])}>
            Every mandatory lesson
          </Button>
          <Button size="sm" icon="plus" onClick={() => upd([...r.conditions, { type: 'MIN_PROGRESS', percent: 80 }])}>
            Progress
          </Button>
          <Button size="sm" icon="plus" disabled={!assessments.length} onClick={() => upd([...r.conditions, { type: 'PASS_ASSESSMENT', assessment_id: assessments[0]?.id ?? 0 }])}>
            Pass an assessment
          </Button>
          <Button size="sm" icon="plus" disabled={!assignments.length} onClick={() => upd([...r.conditions, { type: 'COMPLETE_ASSIGNMENT', assignment_id: assignments[0]?.id ?? 0 }])}>
            Complete an assignment
          </Button>
          {r.conditions.length ? (
            <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
              Clear the rule
            </Button>
          ) : null}
        </div>
      ) : null}
      {later.length ? <p className="m-0 text-[11.5px] text-ink-3">{later.map((x) => `${x.label}: ${x.why ?? 'later'}`).join(' ')}</p> : null}
    </div>
  );
}

// ── staff ───────────────────────────────────────────────────────────────

function StaffTab({ c, onChanged }: { c: Course; onChanged: () => void }) {
  const el = useEl();
  const qc = useQueryClient();
  const people = usePeople(c.can.edit);
  const [who, setWho] = useState('');
  const [role, setRole] = useState('CO_INSTRUCTOR');
  const [busy, setBusy] = useState(false);
  const may = c.can.edit && el.online;
  const act = async (path: string, body: object, done: string) => {
    setBusy(true);
    try {
      const r = await ePost(`/courses/${c.id}/${path}`, body);
      toast('success', r.message || done);
      void qc.invalidateQueries({ queryKey: K.course(c.id) });
      onChanged();
      setWho('');
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex max-w-[760px] flex-col gap-3">
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {c.staff.map((s) => (
          <li key={s.id} className="flex items-center gap-2 rounded-[10px] border border-line bg-surface px-3 py-2 text-[13px]">
            <Icon name="user" size={15} className="text-ink-3" />
            <b className="min-w-0 flex-1 truncate text-ink">{s.name}</b>
            <Pill tone={s.role === 'INSTRUCTOR' ? 'blue' : 'grey'}>{s.label}</Pill>
            {may ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(`staff/${s.id}/remove`, {}, 'Removed.')}>
                Remove
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {may ? (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Person" className="min-w-[240px] flex-1">
            <Select aria-label="Person" value={who} onChange={(e) => setWho(e.target.value)} options={[{ value: '', label: 'Choose…' }, ...(people.data?.users ?? []).map((u) => ({ value: String(u.id), label: u.name }))]} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
          </Field>
          <Field label="Role">
            <Select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)} options={el.options.staff_roles.map((r) => ({ value: r.value, label: r.label }))} className="h-9 min-w-[160px] rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
          </Field>
          <Button variant="primary" icon="user-plus" disabled={!who || busy} onClick={() => void act('staff', { user_id: Number(who), role }, 'Added.')}>
            Add
          </Button>
        </div>
      ) : null}
      <p className="m-0 text-[12px] text-ink-3">Instructors and co-instructors edit, enrol and grade; authors edit; evaluators follow and grade. Naming a new instructor makes the current one a co-instructor.</p>
    </div>
  );
}

function ActivityTab({ id }: { id: number }) {
  const q = useQuery({ queryKey: K.activity(id), queryFn: ({ signal }) => eGet<{ items: Activity[] }>(`/courses/${id}/activity`, undefined, signal) });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error ?? new Error('The activity could not be loaded.')} onRetry={() => void q.refetch()} />;
  if (q.data.items.length === 0) return <p className="m-0 text-[13px] text-ink-3">Nothing recorded yet.</p>;
  return (
    <ol className="m-0 flex max-w-[860px] list-none flex-col gap-1 p-0">
      {q.data.items.map((a) => (
        <li key={a.id} className="flex flex-wrap items-baseline gap-2 border-b border-line py-1.5 text-[12.5px]">
          <span className="w-[150px] shrink-0 text-ink-3">{when(a.at, true)}</span>
          <b className="text-ink">{a.action}</b>
          <span className="text-ink-2">{a.by ?? 'WorkSuite'}</span>
          {a.reason ? <span className="text-ink-3">— {a.reason}</span> : null}
        </li>
      ))}
    </ol>
  );
}
