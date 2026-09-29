import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Select } from '../../../components/Select';
import { Button, ErrorNote, Modal, Spinner, Switch } from '../../../components/ui';
import { toast } from '../../../core/toasts';
import { eGet, ePost, errorText, K, newKey, pct, toUtc, when, type Course, type Enrollment, type Paged, type Person, type Preview } from '../api';
import { area, Bar, EnrolPill, Field, input, Refusal, useEl } from '../parts';
import { useDepartments, usePeople } from './people';

const STATUSES = [
  { value: '', label: 'Every status' },
  { value: 'PENDING_APPROVAL', label: 'Waiting for approval' },
  { value: 'ENROLLED', label: 'Not started' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'FAILED', label: 'Not passed' },
  { value: 'WITHDRAWN', label: 'Withdrawn' },
];

/** Enrolments as a table, filtered like the web's; each opens its page. */
export function EnrollmentTable({ path, fixed, showCourse }: { path: string; fixed?: Record<string, string | number>; showCourse?: boolean }) {
  const el = useEl();
  const [status, setStatus] = useState('');
  const [overdue, setOverdue] = useState(Boolean(fixed?.overdue));
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const f = { ...fixed, status, overdue: overdue ? 1 : '', q, page, per_page: 50 };
  const list = useQuery({ queryKey: K.enrollments({ path, ...f }), queryFn: ({ signal }) => eGet<Paged<Enrollment>>(path, f, signal), placeholderData: keepPreviousData });
  const data = list.data;
  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(typed.trim());
          setPage(1);
        }}
      >
        <input aria-label="Search learners" placeholder="Learner or course" value={typed} onChange={(e) => setTyped(e.target.value)} className={`${input} max-w-[240px]`} />
        <Select aria-label="Status" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} options={STATUSES} className="h-9 min-w-[160px] rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
        <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
          <input type="checkbox" checked={overdue} onChange={(e) => (setOverdue(e.target.checked), setPage(1))} /> Overdue only
        </label>
        <Button type="submit" icon="search">
          Search
        </Button>
      </form>
      {list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
      {data && data.items.length === 0 ? <p className="m-0 text-[13px] text-ink-3">No enrolments match.</p> : null}
      {data && data.items.length ? (
        <div className="overflow-x-auto rounded-[12px] border border-line bg-surface">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11.5px] text-ink-3">
                <th className="px-3 py-2 font-semibold">Learner</th>
                {showCourse ? <th className="px-3 py-2 font-semibold">Course</th> : null}
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Progress</th>
                <th className="px-3 py-2 font-semibold">Due</th>
                <th className="px-3 py-2 font-semibold">How</th>
                <th className="px-3 py-2 font-semibold">Last active</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((e) => (
                <tr key={e.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-subtle" onClick={() => el.open.enrollment(e.id)}>
                  <td className="px-3 py-2">
                    <button type="button" className="text-left font-semibold text-ink hover:text-primary" onClick={() => el.open.enrollment(e.id)}>
                      {e.learner.name}
                    </button>
                    {e.is_mandatory ? <span className="ml-1.5 text-[11px] text-warning">mandatory</span> : null}
                  </td>
                  {showCourse ? <td className="px-3 py-2 text-ink-2">{e.course.title}</td> : null}
                  <td className="px-3 py-2">
                    <EnrolPill status={e.status} overdue={e.overdue} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Bar value={e.progress_percent} label={`${e.learner.name} progress`} className="w-20" />
                      <span className="text-[12px] text-ink-3 tabular-nums">{pct(e.progress_percent)}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-ink-2">{e.due_at ? when(e.due_at) : '—'}</td>
                  <td className="px-3 py-2 text-ink-3">{e.enrollment_type.charAt(0) + e.enrollment_type.slice(1).toLowerCase()}</td>
                  <td className="px-3 py-2 text-ink-3">{when(e.last_activity_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {data && data.meta.pages > 1 ? (
        <div className="flex items-center justify-center gap-2 text-[12.5px] text-ink-3">
          <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="tabular-nums">
            Page {data.meta.page} of {data.meta.pages} · {data.meta.total}
          </span>
          <Button size="sm" disabled={page >= data.meta.pages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** A course's learners, and assigning more (WF-03). */
export default function CourseEnrollments({ course }: { course: Course }) {
  const el = useEl();
  const [assigning, setAssigning] = useState(false);
  return (
    <div className="flex max-w-[1100px] flex-col gap-3">
      <div className="flex items-center gap-2">
        <p className="m-0 flex-1 text-[12.5px] text-ink-3">{course.enrolled} enrolled. Learners outside your reach are not shown.</p>
        {course.can.enroll ? (
          <Button variant="primary" icon="user-plus" disabled={!el.online || course.status !== 'PUBLISHED'} title={course.status !== 'PUBLISHED' ? 'Learners are assigned to a published course.' : undefined} onClick={() => setAssigning(true)}>
            Assign learners
          </Button>
        ) : null}
      </div>
      {course.can.enrollments ? <EnrollmentTable path={`/courses/${course.id}/enrollments`} /> : <p className="m-0 text-[13px] text-ink-3">You can assign this course, but not follow its enrolments.</p>}
      {assigning ? <AssignDialog course={course} onClose={() => setAssigning(false)} /> : null}
    </div>
  );
}

type Chosen = { user_ids: number[]; department_ids: number[]; csv: string };

function PersonList({ title, people, tone }: { title: string; people: Person[]; tone: string }) {
  if (!people.length) return null;
  return (
    <div>
      <b className={`text-[12.5px] ${tone}`}>
        {title} ({people.length})
      </b>
      <ul className="m-0 mt-0.5 flex list-none flex-col gap-0.5 p-0 text-[12.5px] text-ink-2">
        {people.slice(0, 50).map((p, i) => (
          <li key={`${p.user_id}-${i}`}>
            {p.name}
            {p.reason ? <span className="text-ink-3"> — {p.reason}</span> : p.status ? <span className="text-ink-3"> — {p.status.toLowerCase().replace(/_/g, ' ')}</span> : null}
          </li>
        ))}
        {people.length > 50 ? <li className="text-ink-3">and {people.length - 50} more</li> : null}
      </ul>
    </div>
  );
}

/**
 * Assigning learners: people, whole departments or branches, or a CSV of
 * e-mails or employee numbers. The server previews first — new, already
 * there, blocked, outside your reach, not found — and nothing is written
 * until the same selection is sent to assign.
 */
function AssignDialog({ course, onClose }: { course: Course; onClose: () => void }) {
  const qc = useQueryClient();
  const people = usePeople();
  const departments = useDepartments();
  const [who, setWho] = useState('');
  const [chosen, setChosen] = useState<Chosen>({ user_ids: [], department_ids: [], csv: '' });
  const [branches, setBranches] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [dueDays, setDueDays] = useState('');
  const [mandatory, setMandatory] = useState(course.course_type === 'COMPLIANCE' || course.course_type === 'ONBOARDING');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const key = useRef<string | null>(null);
  const selection = () => ({
    user_ids: chosen.user_ids,
    department_ids: chosen.department_ids,
    branch_ids: branches.split(/[\s,]+/).map(Number).filter((n) => n > 0),
    csv: chosen.csv.trim() || undefined,
  });
  const look = async () => {
    setBusy(true);
    setWhy(null);
    try {
      const r = await ePost<Preview>(`/courses/${course.id}/enrollments/preview`, selection());
      setPreview(r.data);
    } catch (e) {
      setWhy(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const assign = async () => {
    setBusy(true);
    setWhy(null);
    key.current ??= newKey('assign');
    try {
      const r = await ePost<{ created: Array<{ user_id: number; enrollment_id: number }> }>(
        `/courses/${course.id}/enrollments`,
        { ...selection(), ...(dueAt ? { due_at: toUtc(dueAt) } : dueDays ? { due_days: Number(dueDays) } : {}), mandatory, ...(message.trim() ? { message: message.trim() } : {}) },
        key.current,
      );
      key.current = null;
      toast('success', `${r.message} ${r.data.created.length} assigned.`);
      void qc.invalidateQueries({ queryKey: ['elearning', 'enrollments'] });
      void qc.invalidateQueries({ queryKey: K.course(course.id) });
      onClose();
    } catch (e) {
      key.current = null;
      setWhy(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const changed = (fn: () => void) => {
    fn();
    setPreview(null);
  };
  const names = new Map((people.data?.users ?? []).map((u) => [u.id, u.name]));
  const empty = !chosen.user_ids.length && !chosen.department_ids.length && !chosen.csv.trim() && !branches.trim();
  return (
    <Modal
      title={`Assign ${course.title}`}
      onClose={onClose}
      width={760}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button loading={busy && !preview} disabled={empty || busy} onClick={() => void look()}>
            Preview
          </Button>
          <Button variant="primary" loading={busy && !!preview} disabled={!preview || preview.new.length === 0 || busy} onClick={() => void assign()}>
            Assign {preview ? preview.new.length : ''}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Field label="People">
            <div className="flex gap-2">
              <Select aria-label="Person" value={who} onChange={(e) => setWho(e.target.value)} options={[{ value: '', label: people.isLoading ? 'Loading…' : 'Choose…' }, ...(people.data?.users ?? []).filter((u) => !chosen.user_ids.includes(u.id)).map((u) => ({ value: String(u.id), label: u.name }))]} className="h-9 min-w-0 flex-1 rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
              <Button disabled={!who} onClick={() => changed(() => (setChosen((c) => ({ ...c, user_ids: [...c.user_ids, Number(who)] })), setWho('')))}>
                Add
              </Button>
            </div>
          </Field>
          {chosen.user_ids.length ? (
            <ul className="m-0 flex list-none flex-wrap gap-1 p-0">
              {chosen.user_ids.map((id) => (
                <li key={id}>
                  <button type="button" className="rounded-[6px] bg-subtle px-2 py-0.5 text-[12px] text-ink-2 hover:bg-danger-bg hover:text-danger" onClick={() => changed(() => setChosen((c) => ({ ...c, user_ids: c.user_ids.filter((x) => x !== id) })))}>
                    {names.get(id) ?? `#${id}`} ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {departments.data ? (
            <Field label="Whole departments">
              <div className="flex max-h-[140px] flex-col gap-0.5 overflow-y-auto rounded-[8px] border border-line p-2 text-[12.5px] scroll-thin">
                {departments.data.map((d) => (
                  <label key={d.id} className="flex items-center gap-2">
                    <input type="checkbox" checked={chosen.department_ids.includes(d.id)} onChange={(e) => changed(() => setChosen((c) => ({ ...c, department_ids: e.target.checked ? [...c.department_ids, d.id] : c.department_ids.filter((x) => x !== d.id) })))} /> {d.name}
                  </label>
                ))}
              </div>
            </Field>
          ) : null}
          <Field label="Branches (ids, optional)" hint="HR's branch numbers, separated by commas.">
            <input className={input} value={branches} onChange={(e) => changed(() => setBranches(e.target.value))} />
          </Field>
          <Field label="Or a list" hint="One e-mail or employee number per line.">
            <textarea className={area} value={chosen.csv} onChange={(e) => changed(() => setChosen((c) => ({ ...c, csv: e.target.value })))} />
          </Field>
        </div>
        <div className="flex flex-col gap-2">
          <Field label="Due on (optional)">
            <input type="datetime-local" className={input} value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </Field>
          <Field label="Or due after (days)" hint={course.due_days ? `The course's own: ${course.due_days} days.` : undefined}>
            <input type="number" min={1} className={`${input} max-w-[140px]`} disabled={!!dueAt} value={dueDays} onChange={(e) => setDueDays(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            <Switch checked={mandatory} onChange={setMandatory} label="Mandatory" /> Mandatory
          </label>
          <Field label="A note for the learners (optional)">
            <textarea className={area} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} />
          </Field>
          {preview ? (
            <div className="flex flex-col gap-2 rounded-[10px] border border-line p-3">
              <PersonList title="Will be assigned" people={preview.new} tone="text-success" />
              <PersonList title="Already enrolled or completed" people={preview.skipped} tone="text-ink-2" />
              <PersonList title="Cannot be assigned" people={preview.blocked} tone="text-warning" />
              <PersonList title="Outside your reach" people={preview.not_permitted} tone="text-danger" />
              {preview.unknown.length ? <p className="m-0 text-[12.5px] text-danger">Not found: {preview.unknown.join(', ')}</p> : null}
              {preview.new.length === 0 ? <p className="m-0 text-[12.5px] text-ink-3">Nobody new to assign.</p> : null}
            </div>
          ) : null}
        </div>
        {why ? (
          <div className="md:col-span-2">
            <Refusal text={why} />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
