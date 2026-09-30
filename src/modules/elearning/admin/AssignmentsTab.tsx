import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { Button, ErrorNote, Modal, Spinner, Switch } from '../../../components/ui';
import { toast } from '../../../core/toasts';
import { eGet, ePost, errorText, K, toLocalInput, toUtc, when, type AssignmentCard, type Course, type Submission } from '../api';
import { Field, input, Refusal, RichField, Section, WorkPill, useEl } from '../parts';

/**
 * A course's assignments (§5.13): the brief, due date, marks, files taken,
 * attempts and late work; and the submissions of learners the person may
 * grade, each opening for grading.
 */
export default function AssignmentsTab({ course }: { course: Course }) {
  const el = useEl();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: K.assignments(course.id), queryFn: ({ signal }) => eGet<{ items: AssignmentCard[] }>(`/courses/${course.id}/assignments`, undefined, signal) });
  const [editing, setEditing] = useState<AssignmentCard | 'new' | null>(null);
  const [open, setOpen] = useState<AssignmentCard | null>(null);
  const may = course.can.assignments && el.online;
  const refresh = () => void qc.invalidateQueries({ queryKey: K.assignments(course.id) });
  const remove = async (a: AssignmentCard) => {
    try {
      const r = await ePost(`/assignments/${a.id}/delete`, {});
      toast('success', r.message);
      setOpen(null);
      refresh();
    } catch (e) {
      toast('error', errorText(e));
    }
  };
  return (
    <div className="flex max-w-[960px] flex-col gap-3">
      <div className="flex items-center gap-2">
        <p className="m-0 flex-1 text-[12.5px] text-ink-3">Work learners hand in, graded by the course's instructors and evaluators.</p>
        {may ? (
          <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
            New assignment
          </Button>
        ) : null}
      </div>
      {list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.data?.items.length === 0 ? <p className="m-0 text-[13px] text-ink-3">No assignments yet.</p> : null}
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {(list.data?.items ?? []).map((a) => (
          <li key={a.id} className="flex items-center gap-2 rounded-[10px] border border-line bg-surface px-3 py-2 text-[13px]">
            <Icon name="upload" size={15} className="text-ink-3" />
            <button type="button" className="min-w-0 flex-1 truncate text-left font-semibold text-ink hover:text-primary" onClick={() => setOpen(a)}>
              {a.title}
            </button>
            <span className="text-[12px] text-ink-3">
              {a.due_at ? `due ${when(a.due_at)}` : 'no due date'} · out of {a.max_score}
              {a.pass_score !== null ? ` · pass ${a.pass_score}` : ''} · {a.attempts_allowed || 'unlimited'} attempts
            </span>
            {may ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void remove(a)}>
                  Delete
                </Button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      {open ? <Submissions a={open} /> : null}
      {editing ? <AssignmentForm course={course} a={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), refresh())} /> : null}
    </div>
  );
}

function Submissions({ a }: { a: AssignmentCard }) {
  const el = useEl();
  const q = useQuery({ queryKey: K.submissions(a.id), queryFn: ({ signal }) => eGet<{ items: Submission[] }>(`/assignments/${a.id}/submissions`, undefined, signal) });
  return (
    <Section title={`Submissions · ${a.title}`}>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data?.items.length === 0 ? <p className="m-0 text-[13px] text-ink-3">Nothing handed in by learners you may grade.</p> : null}
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
        {(q.data?.items ?? []).map((s) => (
          <li key={s.id} className="flex items-center gap-2">
            <button type="button" className="min-w-0 flex-1 truncate text-left font-semibold text-ink hover:text-primary" onClick={() => el.open.submission(s.id)}>
              {s.learner?.name ?? 'Learner'} · attempt {s.attempt_no}
            </button>
            <WorkPill status={s.status} />
            {s.is_late ? <span className="text-[12px] text-warning">Late</span> : null}
            <span className="text-ink-3 tabular-nums">{s.score !== null ? `${s.score} / ${a.max_score}` : '—'}</span>
            <span className="text-ink-3">{when(s.submitted_at, true)}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function AssignmentForm({ course, a, onClose, onSaved }: { course: Course; a: AssignmentCard | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    title: a?.title ?? '',
    instructions: a?.instructions ?? '',
    due_at: toLocalInput(a?.due_at),
    max_score: a ? String(a.max_score) : '100',
    pass_score: a?.pass_score !== null && a?.pass_score !== undefined ? String(a.pass_score) : '',
    allowed_types: a?.allowed_types?.join(', ') ?? '',
    max_file_mb: a ? String(a.max_file_mb) : '',
    max_files: a ? String(a.max_files) : '5',
    allow_text: a?.allow_text ?? true,
    require_file: a?.require_file ?? false,
    attempts_allowed: a ? String(a.attempts_allowed) : '2',
    late_policy: a?.late_policy ?? '',
    late_penalty_pct: a?.late_penalty_pct ? String(a.late_penalty_pct) : '',
  });
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const n = (v: string) => (v.trim() === '' ? null : Number(v));
  const save = async () => {
    setBusy(true);
    setWhy(null);
    const body = {
      title: f.title.trim(),
      instructions: f.instructions,
      due_at: f.due_at ? toUtc(f.due_at) : null,
      max_score: n(f.max_score) ?? 100,
      pass_score: n(f.pass_score),
      allowed_types: f.allowed_types.trim() ? f.allowed_types.split(/[\s,]+/).map((x) => x.replace(/^\./, '').toLowerCase()).filter(Boolean) : null,
      max_file_mb: n(f.max_file_mb),
      max_files: n(f.max_files) ?? 5,
      allow_text: f.allow_text,
      require_file: f.require_file,
      attempts_allowed: n(f.attempts_allowed) ?? 2,
      late_policy: f.late_policy || null,
      late_penalty_pct: n(f.late_penalty_pct),
    };
    try {
      const r = a ? await ePost(`/assignments/${a.id}`, body) : await ePost(`/courses/${course.id}/assignments`, body);
      toast('success', r.message);
      onSaved();
    } catch (e) {
      setWhy(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={a ? `Edit ${a.title}` : 'New assignment'}
      onClose={onClose}
      width={720}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!f.title.trim()} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Title" className="md:col-span-2">
          <input className={input} value={f.title} onChange={(e) => set('title')(e.target.value)} maxLength={200} autoFocus />
        </Field>
        <div className="md:col-span-2">
          <span className="mb-1 block text-[12.5px] font-semibold text-ink-2">The brief</span>
          <RichField initial={a?.instructions ?? ''} label="The brief" minHeight={110} onChange={(h) => set('instructions')(h)} />
        </div>
        <Field label="Due">
          <input type="datetime-local" className={input} value={f.due_at} onChange={(e) => set('due_at')(e.target.value)} />
        </Field>
        <Field label="Attempts" hint="0: unlimited.">
          <input type="number" min={0} className={input} value={f.attempts_allowed} onChange={(e) => set('attempts_allowed')(e.target.value)} />
        </Field>
        <Field label="Marked out of">
          <input type="number" min={1} className={input} value={f.max_score} onChange={(e) => set('max_score')(e.target.value)} />
        </Field>
        <Field label="Pass at (points)" hint="Blank: graded is completed.">
          <input type="number" min={0} className={input} value={f.pass_score} onChange={(e) => set('pass_score')(e.target.value)} />
        </Field>
        <Field label="File types" hint="e.g. pdf, docx — blank: the company's list.">
          <input className={input} value={f.allowed_types} onChange={(e) => set('allowed_types')(e.target.value)} />
        </Field>
        <Field label="Largest file (MB)" hint="Blank: the company's limit.">
          <input type="number" min={1} className={input} value={f.max_file_mb} onChange={(e) => set('max_file_mb')(e.target.value)} />
        </Field>
        <Field label="Files at most (1–20)">
          <input type="number" min={1} max={20} className={input} value={f.max_files} onChange={(e) => set('max_files')(e.target.value)} />
        </Field>
        <Field label="Late work">
          <Select aria-label="Late work" value={f.late_policy} onChange={(e) => set('late_policy')(e.target.value)} options={[{ value: '', label: "The company's setting" }, { value: 'ACCEPT', label: 'Take it, marked late' }, { value: 'BLOCK', label: 'Refuse it' }]} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
        </Field>
        <Field label="Late penalty (% of the score)">
          <input type="number" min={0} max={100} className={input} value={f.late_penalty_pct} onChange={(e) => set('late_penalty_pct')(e.target.value)} />
        </Field>
        <div className="flex flex-col gap-2 text-[13px] text-ink-2 md:col-span-2">
          <label className="flex items-center gap-2">
            <Switch checked={f.allow_text} onChange={(v) => set('allow_text')(v)} label="Written answer" /> Learners may write their answer
          </label>
          <label className="flex items-center gap-2">
            <Switch checked={f.require_file} onChange={(v) => set('require_file')(v)} label="A file is required" /> A file is required
          </label>
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
