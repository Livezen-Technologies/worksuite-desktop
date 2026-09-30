import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { Button, ErrorNote, Modal, Spinner, Switch } from '../../../components/ui';
import { toast } from '../../../core/toasts';
import { eGet, ePost, errorText, K, pct, toLocalInput, toUtc, when, type AssessmentCard, type Course, type QType, type StaffAssessment, type StaffQuestion } from '../api';
import { area, Field, input, Pill, Refusal, RichField, Section, useEl } from '../parts';

export const QTYPES: Array<{ value: QType; label: string }> = [
  { value: 'SINGLE', label: 'Single choice' },
  { value: 'MULTIPLE', label: 'Multiple choice' },
  { value: 'TRUE_FALSE', label: 'True or false' },
  { value: 'SHORT_ANSWER', label: 'Short answer' },
  { value: 'FILL_BLANK', label: 'Fill in the blanks' },
  { value: 'NUMERIC', label: 'Number' },
  { value: 'MATCHING', label: 'Matching' },
  { value: 'ORDERING', label: 'Ordering' },
  { value: 'LONG_ANSWER', label: 'Long answer (graded by a person)' },
  { value: 'FILE_UPLOAD', label: 'File upload (graded by a person)' },
];

/**
 * A course's assessments (§5.12): their rules, their questions of every type
 * with the key the learner never sees, the order, and the attempts made. A
 * question someone has answered is never changed under them: saving it makes
 * the next version.
 */
export default function AssessmentsTab({ course }: { course: Course }) {
  const el = useEl();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: K.assessments(course.id), queryFn: ({ signal }) => eGet<{ items: AssessmentCard[] }>(`/courses/${course.id}/assessments`, undefined, signal) });
  const [open, setOpen] = useState<number | null>(null);
  const [making, setMaking] = useState(false);
  const may = course.can.assessments && el.online;
  if (open) return <Editor id={open} course={course} onBack={() => setOpen(null)} />;
  return (
    <div className="flex max-w-[960px] flex-col gap-3">
      <div className="flex items-center gap-2">
        <p className="m-0 flex-1 text-[12.5px] text-ink-3">Quizzes and tests of this course. A quiz lesson shows one; the completion rule can ask for a pass.</p>
        {may ? (
          <Button variant="primary" icon="plus" onClick={() => setMaking(true)}>
            New assessment
          </Button>
        ) : null}
      </div>
      {list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.data?.items.length === 0 ? <p className="m-0 text-[13px] text-ink-3">No assessments yet.</p> : null}
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {(list.data?.items ?? []).map((a) => (
          <li key={a.id}>
            <button type="button" onClick={() => setOpen(a.id)} className="flex w-full items-center gap-2 rounded-[10px] border border-line bg-surface px-3 py-2 text-left text-[13px] hover:border-primary/50">
              <Icon name="list-todo" size={15} className="text-ink-3" />
              <b className="min-w-0 flex-1 truncate text-ink">{a.title}</b>
              {a.is_final ? <Pill tone="blue">Final</Pill> : null}
              <span className="text-[12px] text-ink-3">
                {a.questions} questions · pass {a.pass_mark}% · {a.time_limit_min ? `${a.time_limit_min} min` : 'untimed'} · {a.attempts_allowed || 'unlimited'} attempts
              </span>
            </button>
          </li>
        ))}
      </ul>
      {making ? (
        <SettingsForm
          course={course}
          a={null}
          onClose={() => setMaking(false)}
          onSaved={(id) => {
            setMaking(false);
            void qc.invalidateQueries({ queryKey: K.assessments(course.id) });
            if (id) setOpen(id);
          }}
        />
      ) : null}
    </div>
  );
}

function Editor({ id, course, onBack }: { id: number; course: Course; onBack: () => void }) {
  const el = useEl();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.assessment(id), queryFn: ({ signal }) => eGet<StaffAssessment>(`/assessments/${id}`, undefined, signal) });
  const attempts = useQuery({ queryKey: K.assessmentAttempts(id), queryFn: ({ signal }) => eGet<{ items: Array<{ id: number; learner: { id: number; name: string } | string; attempt_no: number; status: string; started_at: string | null; submitted_at: string | null; percent: number | null; passed: boolean | null; auto_submitted: boolean }> }>(`/assessments/${id}/attempts`, undefined, signal) });
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState<StaffQuestion | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const may = course.can.assessments && el.online;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: K.assessment(id) });
    void qc.invalidateQueries({ queryKey: K.assessments(course.id) });
  };
  const act = async (path: string, body: object = {}) => {
    setBusy(true);
    try {
      const r = await ePost(path, body);
      toast('success', r.message);
      refresh();
      return true;
    } catch (e) {
      toast('error', errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error ?? new Error('The assessment could not be loaded.')} onRetry={() => void q.refetch()} />;
  const a = q.data;
  const move = (i: number, d: -1 | 1) => {
    const ids = a.question_list.map((x) => x.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    void act(`/assessments/${id}/questions/order`, { ids });
  };
  return (
    <div className="flex max-w-[960px] flex-col gap-3">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 self-start text-[12.5px] font-semibold text-primary hover:underline">
        <Icon name="back" size={14} /> Assessments
      </button>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 min-w-0 flex-1 text-[17px] font-bold text-ink">{a.title}</h2>
        {may ? (
          <>
            <Button onClick={() => setEditing(true)}>Settings</Button>
            <Button
              variant="ghost"
              icon="trash"
              disabled={busy}
              onClick={() =>
                void act(`/assessments/${id}/delete`).then((ok) => {
                  if (ok) onBack();
                })
              }
            >
              Delete
            </Button>
          </>
        ) : null}
      </div>
      <p className="m-0 text-[12.5px] text-ink-3">
        {a.questions} questions, {a.max_score} points · pass {a.pass_mark}% · {a.time_limit_min ? `${a.time_limit_min} minutes` : 'untimed'} · {a.attempts_allowed || 'unlimited'} attempts · {a.scoring_policy.toLowerCase()} counts · answers shown {a.show_answers.toLowerCase().replace(/_/g, ' ')}
        {a.due_at ? ` · due ${when(a.due_at, true)}` : ''}
      </p>
      <Section
        title="Questions"
        action={
          may ? (
            <Button size="sm" icon="plus" onClick={() => setQuestion('new')}>
              Question
            </Button>
          ) : null
        }
      >
        {a.question_list.length === 0 ? <p className="m-0 text-[13px] text-ink-3">No questions yet — a quiz needs some before the course can go for review.</p> : null}
        <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
          {a.question_list.map((x, i) => (
            <li key={x.id} className="flex items-start gap-2 rounded-[8px] border border-line px-3 py-2 text-[13px]">
              <span className="w-5 text-ink-3 tabular-nums">{i + 1}.</span>
              <div className="min-w-0 flex-1">
                <span className="line-clamp-2 text-ink">{x.prompt.replace(/<[^>]+>/g, ' ').trim()}</span>
                <span className="block text-[11.5px] text-ink-3">
                  {QTYPES.find((t) => t.value === x.qtype)?.label} · {x.points} pt · version {x.version}
                </span>
              </div>
              {may ? (
                <span className="flex items-center gap-0.5">
                  <button type="button" aria-label="Move up" disabled={busy || i === 0} onClick={() => move(i, -1)} className="rounded-[6px] p-1 text-ink-3 hover:bg-subtle disabled:opacity-30">
                    <Icon name="arrow-up" size={14} />
                  </button>
                  <button type="button" aria-label="Move down" disabled={busy || i === a.question_list.length - 1} onClick={() => move(i, 1)} className="rounded-[6px] p-1 text-ink-3 hover:bg-subtle disabled:opacity-30">
                    <Icon name="arrow-down" size={14} />
                  </button>
                  <Button size="sm" variant="ghost" onClick={() => setQuestion(x)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(`/questions/${x.id}/delete`)}>
                    Delete
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </Section>
      <Section title="Attempts">
        {attempts.isLoading ? <Spinner /> : null}
        {(attempts.data?.items ?? []).length === 0 && !attempts.isLoading ? <p className="m-0 text-[13px] text-ink-3">No attempts by learners you may grade.</p> : null}
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
          {(attempts.data?.items ?? []).map((t) => (
            <li key={t.id} className="flex items-center gap-2">
              <button type="button" className="min-w-0 flex-1 truncate text-left font-semibold text-ink hover:text-primary" onClick={() => el.open.attempt(t.id)}>
                {typeof t.learner === 'string' ? t.learner : t.learner.name} · attempt {t.attempt_no}
              </button>
              {t.status === 'NEEDS_GRADING' ? <Pill tone="amber">Needs grading</Pill> : t.passed ? <Pill tone="green">Passed</Pill> : t.passed === false ? <Pill tone="red">Not passed</Pill> : <Pill tone="grey">{t.status.toLowerCase().replace(/_/g, ' ')}</Pill>}
              <span className="text-ink-3 tabular-nums">{t.percent !== null ? pct(t.percent) : '—'}</span>
              <span className="text-ink-3">{when(t.submitted_at, true)}</span>
            </li>
          ))}
        </ul>
      </Section>
      {editing ? <SettingsForm course={course} a={a} onClose={() => setEditing(false)} onSaved={() => (setEditing(false), refresh())} /> : null}
      {question ? <QuestionForm assessmentId={id} q={question === 'new' ? null : question} onClose={() => setQuestion(null)} onSaved={() => (setQuestion(null), refresh())} /> : null}
    </div>
  );
}

function SettingsForm({ course, a, onClose, onSaved }: { course: Course; a: AssessmentCard | null; onClose: () => void; onSaved: (id: number | null) => void }) {
  const [f, setF] = useState({
    title: a?.title ?? '',
    instructions: a?.instructions ?? '',
    pass_mark: a ? String(a.pass_mark) : '',
    time_limit_min: a?.time_limit_min ? String(a.time_limit_min) : '',
    attempts_allowed: a ? String(a.attempts_allowed) : '',
    cooldown_min: a?.cooldown_min ? String(a.cooldown_min) : '',
    scoring_policy: a?.scoring_policy ?? 'HIGHEST',
    show_score: a?.show_score ?? true,
    show_answers: a?.show_answers ?? '',
    allow_review: a?.allow_review ?? true,
    shuffle_questions: a?.shuffle_questions ?? false,
    shuffle_options: a?.shuffle_options ?? false,
    negative_marking_pct: a?.negative_marking_pct ? String(a.negative_marking_pct) : '',
    available_from: toLocalInput(a?.available_from),
    available_until: toLocalInput(a?.available_until),
    due_at: toLocalInput(a?.due_at),
    is_final: a?.is_final ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const n = (v: string) => (v.trim() === '' ? undefined : Number(v));
  const save = async () => {
    setBusy(true);
    setWhy(null);
    const body = {
      title: f.title.trim(),
      instructions: f.instructions,
      pass_mark: n(f.pass_mark),
      time_limit_min: f.time_limit_min.trim() === '' ? null : Number(f.time_limit_min),
      attempts_allowed: n(f.attempts_allowed),
      cooldown_min: f.cooldown_min.trim() === '' ? null : Number(f.cooldown_min),
      scoring_policy: f.scoring_policy,
      show_score: f.show_score,
      show_answers: f.show_answers || undefined,
      allow_review: f.allow_review,
      shuffle_questions: f.shuffle_questions,
      shuffle_options: f.shuffle_options,
      negative_marking_pct: f.negative_marking_pct.trim() === '' ? null : Number(f.negative_marking_pct),
      available_from: f.available_from ? toUtc(f.available_from) : null,
      available_until: f.available_until ? toUtc(f.available_until) : null,
      due_at: f.due_at ? toUtc(f.due_at) : null,
      is_final: f.is_final,
    };
    try {
      const r = a ? await ePost<StaffAssessment>(`/assessments/${a.id}`, body) : await ePost<StaffAssessment>(`/courses/${course.id}/assessments`, body);
      toast('success', r.message);
      onSaved(a ? null : r.data.id);
    } catch (e) {
      setWhy(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={a ? `Settings · ${a.title}` : 'New assessment'}
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
          <span className="mb-1 block text-[12.5px] font-semibold text-ink-2">Instructions</span>
          <RichField initial={a?.instructions ?? ''} label="Instructions" minHeight={90} onChange={(h) => set('instructions')(h)} />
        </div>
        <Field label="Pass mark (%)" hint="Blank: the company's default.">
          <input type="number" min={0} max={100} className={input} value={f.pass_mark} onChange={(e) => set('pass_mark')(e.target.value)} />
        </Field>
        <Field label="Time limit (minutes)" hint="Blank: untimed. A timed quiz is kept by the server.">
          <input type="number" min={1} max={1440} className={input} value={f.time_limit_min} onChange={(e) => set('time_limit_min')(e.target.value)} />
        </Field>
        <Field label="Attempts" hint="0: unlimited; blank: the company's default.">
          <input type="number" min={0} className={input} value={f.attempts_allowed} onChange={(e) => set('attempts_allowed')(e.target.value)} />
        </Field>
        <Field label="Minutes between attempts">
          <input type="number" min={0} className={input} value={f.cooldown_min} onChange={(e) => set('cooldown_min')(e.target.value)} />
        </Field>
        <Field label="What counts">
          <Select aria-label="Scoring" value={f.scoring_policy} onChange={(e) => set('scoring_policy')(e.target.value)} options={[{ value: 'HIGHEST', label: 'The best attempt' }, { value: 'LATEST', label: 'The latest attempt' }, { value: 'AVERAGE', label: 'The average' }]} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
        </Field>
        <Field label="Show the right answers">
          <Select aria-label="Show answers" value={f.show_answers} onChange={(e) => set('show_answers')(e.target.value)} options={[{ value: '', label: "The company's default" }, { value: 'NEVER', label: 'Never' }, { value: 'AFTER_SUBMIT', label: 'After submitting' }, { value: 'AFTER_DUE', label: 'After the due date' }, { value: 'AFTER_PASS', label: 'Once passed' }]} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
        </Field>
        <Field label="Negative marking (% of a question's points per wrong answer)">
          <input type="number" min={0} max={100} className={input} value={f.negative_marking_pct} onChange={(e) => set('negative_marking_pct')(e.target.value)} />
        </Field>
        <Field label="Due">
          <input type="datetime-local" className={input} value={f.due_at} onChange={(e) => set('due_at')(e.target.value)} />
        </Field>
        <Field label="Open from">
          <input type="datetime-local" className={input} value={f.available_from} onChange={(e) => set('available_from')(e.target.value)} />
        </Field>
        <Field label="Open until">
          <input type="datetime-local" className={input} value={f.available_until} onChange={(e) => set('available_until')(e.target.value)} />
        </Field>
        <div className="flex flex-col gap-2 text-[13px] text-ink-2 md:col-span-2">
          {(
            [
              ['show_score', 'Show learners their score'],
              ['allow_review', 'Let learners review their attempt'],
              ['shuffle_questions', 'Shuffle the questions'],
              ['shuffle_options', 'Shuffle the options'],
              ['is_final', 'The final assessment of the course'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2">
              <Switch checked={f[k] as boolean} onChange={(v) => set(k)(v)} label={label} /> {label}
            </label>
          ))}
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

interface Opt {
  label: string;
  is_correct: boolean;
  match_label: string;
}

/** What the server takes for a question of each type (the key included; learners never receive it). */
export function questionBody(type: QType, f: { prompt: string; points: string; explanation: string; options: Opt[]; answerTrue: boolean; accepted: string; caseSensitive: boolean; manual: boolean; blanks: string; numAnswer: string; tolerance: string; partial: boolean; maxFiles: string }): Record<string, unknown> {
  const body: Record<string, unknown> = { qtype: type, prompt: f.prompt, points: f.points.trim() === '' ? 1 : Number(f.points), explanation: f.explanation.trim() || null };
  const opts = f.options.filter((o) => o.label.trim());
  switch (type) {
    case 'SINGLE':
    case 'MULTIPLE':
      body.options = opts.map((o) => ({ label: o.label.trim(), is_correct: o.is_correct }));
      break;
    case 'TRUE_FALSE':
      body.answer = f.answerTrue;
      break;
    case 'SHORT_ANSWER':
      body.accepted = f.accepted.split('\n').map((x) => x.trim()).filter(Boolean);
      body.case_sensitive = f.caseSensitive;
      body.manual = f.manual;
      break;
    case 'FILL_BLANK':
      body.blanks = f.blanks
        .split('\n')
        .map((line) => line.split('|').map((x) => x.trim()).filter(Boolean))
        .filter((b) => b.length);
      body.case_sensitive = f.caseSensitive;
      break;
    case 'NUMERIC':
      body.answer = Number(f.numAnswer);
      body.tolerance = f.tolerance.trim() === '' ? 0 : Number(f.tolerance);
      break;
    case 'MATCHING':
      body.options = opts.filter((o) => o.match_label.trim()).map((o) => ({ label: o.label.trim(), match_label: o.match_label.trim() }));
      break;
    case 'ORDERING':
      body.options = opts.map((o) => ({ label: o.label.trim() }));
      break;
    case 'FILE_UPLOAD':
      body.max_files = f.maxFiles.trim() === '' ? 1 : Number(f.maxFiles);
      break;
    default:
      break;
  }
  if (['MULTIPLE', 'MATCHING', 'ORDERING', 'FILL_BLANK'].includes(type)) body.partial_credit = f.partial;
  return body;
}

function QuestionForm({ assessmentId, q, onClose, onSaved }: { assessmentId: number; q: StaffQuestion | null; onClose: () => void; onSaved: () => void }) {
  const s = (q?.settings ?? {}) as { accepted?: string[]; case_sensitive?: boolean; manual?: boolean; blanks?: string[][]; answer?: number | boolean; tolerance?: number; partial_credit?: boolean; max_files?: number };
  const [type, setType] = useState<QType>(q?.qtype ?? 'SINGLE');
  const [f, setF] = useState({
    prompt: q?.prompt ?? '',
    points: q ? String(q.points) : '1',
    explanation: q?.explanation ?? '',
    options: (q?.options.length ? [...q.options].sort((x, y) => (x.position || 0) - (y.position || 0)).map((o) => ({ label: o.label, is_correct: o.is_correct, match_label: o.match_label ?? '' })) : [{ label: '', is_correct: true, match_label: '' }, { label: '', is_correct: false, match_label: '' }]) as Opt[],
    answerTrue: s.answer === undefined ? true : s.answer === true,
    accepted: (s.accepted ?? []).join('\n'),
    caseSensitive: s.case_sensitive ?? false,
    manual: s.manual ?? false,
    blanks: (s.blanks ?? []).map((b) => b.join(' | ')).join('\n'),
    numAnswer: typeof s.answer === 'number' ? String(s.answer) : '',
    tolerance: s.tolerance !== undefined ? String(s.tolerance) : '0',
    partial: s.partial_credit ?? false,
    maxFiles: s.max_files ? String(s.max_files) : '1',
  });
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const opt = (i: number, patch: Partial<Opt>) => set('options', f.options.map((o, j) => (j === i ? { ...o, ...patch } : type === 'SINGLE' && patch.is_correct ? { ...o, is_correct: false } : o)));
  const save = async () => {
    setBusy(true);
    setWhy(null);
    try {
      const body = questionBody(type, f);
      const r = q ? await ePost<{ saved_id?: number }>(`/questions/${q.id}`, body) : await ePost(`/assessments/${assessmentId}/questions`, body);
      toast('success', r.message);
      onSaved();
    } catch (e) {
      setWhy(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const choice = type === 'SINGLE' || type === 'MULTIPLE';
  return (
    <Modal
      title={q ? 'Edit the question' : 'New question'}
      onClose={onClose}
      width={720}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!f.prompt.trim()} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {q ? <p className="m-0 text-[12px] text-ink-3">If a learner has answered it, saving keeps that version as it was and makes the next one.</p> : null}
        <div className="grid gap-3 md:grid-cols-[1fr_140px]">
          <Field label="Type">
            <Select aria-label="Question type" value={type} disabled={!!q} onChange={(e) => setType(e.target.value as QType)} options={QTYPES} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
          </Field>
          <Field label="Points">
            <input type="number" min={0.01} max={1000} step="any" className={input} value={f.points} onChange={(e) => set('points', e.target.value)} />
          </Field>
        </div>
        <Field label="Question">
          <textarea className={area} value={f.prompt} onChange={(e) => set('prompt', e.target.value)} maxLength={5000} autoFocus />
        </Field>
        {choice || type === 'MATCHING' || type === 'ORDERING' ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-semibold text-ink-2">{type === 'MATCHING' ? 'Pairs' : type === 'ORDERING' ? 'Items, in the right order' : 'Options — mark the right one' + (type === 'MULTIPLE' ? 's' : '')}</span>
            {f.options.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                {choice ? <input type={type === 'SINGLE' ? 'radio' : 'checkbox'} name="right" aria-label={`Option ${i + 1} is right`} checked={o.is_correct} onChange={(e) => opt(i, { is_correct: e.target.checked })} /> : <span className="w-5 text-[12px] text-ink-3 tabular-nums">{i + 1}.</span>}
                <input aria-label={`Option ${i + 1}`} className={input} value={o.label} onChange={(e) => opt(i, { label: e.target.value })} maxLength={1000} />
                {type === 'MATCHING' ? <input aria-label={`Matches ${i + 1}`} placeholder="matches…" className={input} value={o.match_label} onChange={(e) => opt(i, { match_label: e.target.value })} maxLength={1000} /> : null}
                <button type="button" aria-label="Remove" className="text-ink-3 hover:text-danger" onClick={() => set('options', f.options.filter((_, j) => j !== i))}>
                  <Icon name="x" size={14} />
                </button>
              </div>
            ))}
            <Button size="sm" icon="plus" className="self-start" onClick={() => set('options', [...f.options, { label: '', is_correct: false, match_label: '' }])}>
              {type === 'MATCHING' ? 'Pair' : 'Option'}
            </Button>
          </div>
        ) : null}
        {type === 'TRUE_FALSE' ? (
          <div className="flex gap-4 text-[13px]">
            <label className="flex items-center gap-2">
              <input type="radio" name="tf" checked={f.answerTrue} onChange={() => set('answerTrue', true)} /> True
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="tf" checked={!f.answerTrue} onChange={() => set('answerTrue', false)} /> False
            </label>
          </div>
        ) : null}
        {type === 'SHORT_ANSWER' ? (
          <>
            <Field label="Accepted answers" hint="One per line.">
              <textarea className={area} value={f.accepted} onChange={(e) => set('accepted', e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              <Switch checked={f.manual} onChange={(v) => set('manual', v)} label="Graded by a person" /> Graded by a person instead
            </label>
          </>
        ) : null}
        {type === 'FILL_BLANK' ? (
          <Field label="Blanks" hint="One line per blank, in order; accepted answers separated by |.">
            <textarea className={area} value={f.blanks} onChange={(e) => set('blanks', e.target.value)} />
          </Field>
        ) : null}
        {type === 'SHORT_ANSWER' || type === 'FILL_BLANK' ? (
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            <Switch checked={f.caseSensitive} onChange={(v) => set('caseSensitive', v)} label="Case sensitive" /> Capital letters matter
          </label>
        ) : null}
        {type === 'NUMERIC' ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Answer">
              <input type="number" step="any" className={input} value={f.numAnswer} onChange={(e) => set('numAnswer', e.target.value)} />
            </Field>
            <Field label="Give or take">
              <input type="number" min={0} step="any" className={input} value={f.tolerance} onChange={(e) => set('tolerance', e.target.value)} />
            </Field>
          </div>
        ) : null}
        {type === 'FILE_UPLOAD' ? (
          <Field label="Files a learner may give (1–10)">
            <input type="number" min={1} max={10} className={`${input} max-w-[120px]`} value={f.maxFiles} onChange={(e) => set('maxFiles', e.target.value)} />
          </Field>
        ) : null}
        {['MULTIPLE', 'MATCHING', 'ORDERING', 'FILL_BLANK'].includes(type) ? (
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            <Switch checked={f.partial} onChange={(v) => set('partial', v)} label="Partial credit" /> Partial credit
          </label>
        ) : null}
        <Field label="Explanation (shown with the answers, optional)">
          <textarea className={area} value={f.explanation} onChange={(e) => set('explanation', e.target.value)} maxLength={5000} />
        </Field>
        {why ? <Refusal text={why} /> : null}
      </div>
    </Modal>
  );
}
