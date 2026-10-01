import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DriveFilePicker } from '../../components/DriveFilePicker';
import { Icon } from '../../components/Icon';
import { Button, ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { clock, eGet, ePost, ePut, errorText, K, newKey, OFFLINE, pct, refusalCode, when, type Answer, type Attempt, type AttemptQuestion, type MyAssessment } from './api';
import { area, Back, input, Pill, Refusal, Rich, Section, useEl } from './parts';
import { Checkbox } from '../../components/Checkbox';

/**
 * A quiz (§5.12, WF-11). Before an attempt: the rules, the attempts so far and
 * whether another can start (and why not). During one: the questions as the
 * attempt drew them — never a key — each answer saved as it is given, and the
 * time left as the server keeps it. After: the score and the answers, as far
 * as the quiz shows them.
 */
export default function Quiz({ id, attempt }: { id: number; attempt: number | null }) {
  return attempt ? <Run assessmentId={id} id={attempt} /> : <About id={id} />;
}

function About({ id }: { id: number }) {
  const el = useEl();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.myAssessment(id), queryFn: ({ signal }) => eGet<MyAssessment>(`/me/assessments/${id}`, undefined, signal) });
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const key = useRef<string | null>(null);
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <div className="p-6"><ErrorNote error={q.error ?? new Error('This quiz could not be loaded.')} onRetry={() => void q.refetch()} /></div>;
  const a = q.data;
  const running = a.attempts.find((x) => x.status === 'IN_PROGRESS');

  const start = async () => {
    if (!el.online) return toast('error', OFFLINE);
    setBusy(true);
    setWhy(null);
    key.current ??= newKey('attempt');
    try {
      const r = await ePost<Attempt>(`/me/assessments/${id}/attempts`, {}, key.current);
      key.current = null;
      qc.setQueryData(K.attempt(r.data.id), r.data);
      void qc.invalidateQueries({ queryKey: K.myAssessment(id) });
      el.open.quiz(id, r.data.id);
    } catch (e) {
      key.current = null;
      setWhy(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const rules = [
    `${a.questions} questions`,
    `pass mark ${a.pass_mark}%`,
    a.time_limit_min ? `${a.time_limit_min} minutes, kept by the server` : 'no time limit',
    a.attempts_allowed === 0 ? 'unlimited attempts' : `${a.attempts_allowed} attempts`,
    a.cooldown_min ? `${a.cooldown_min} minutes between attempts` : null,
    a.negative_marking_pct ? `a wrong answer takes ${a.negative_marking_pct}% of its points` : null,
    a.scoring_policy === 'HIGHEST' ? 'your best attempt counts' : a.scoring_policy === 'LATEST' ? 'your latest attempt counts' : 'your attempts are averaged',
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <Back onClick={() => el.open.course(a.course_id)} label="The course" />
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-[20px] font-bold text-ink">{a.title}</h1>
          <p className="mt-1 mb-0 text-[12.5px] text-ink-3">{rules.join(' · ')}</p>
          {a.due_at ? <p className="mt-1 mb-0 text-[12.5px] text-ink-2">Due {when(a.due_at, true)}</p> : null}
        </div>
        {a.passed ? <Pill tone="green">Passed</Pill> : null}
      </div>
      {a.instructions ? (
        <Section title="Instructions">
          <Rich html={a.instructions} />
        </Section>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <Button variant="primary" icon="play" onClick={() => el.open.quiz(id, running.id)}>
            Carry on with attempt {running.attempt_no}
          </Button>
        ) : a.can_start ? (
          <Button variant="primary" icon="play" loading={busy} disabled={!el.online} onClick={() => void start()}>
            {a.attempts.length ? 'Start another attempt' : 'Start the quiz'}
          </Button>
        ) : null}
        {a.attempts_left !== null ? <span className="text-[12.5px] text-ink-3">{a.attempts_left} attempts left</span> : null}
        {a.best !== undefined && a.best !== null ? <span className="text-[12.5px] text-ink-3">· best {pct(a.best)}</span> : null}
      </div>
      {!a.can_start && !running && a.why_not ? <Refusal text={a.why_not} /> : null}
      {why ? <Refusal text={why} /> : null}
      {a.attempts.length ? (
        <Section title="Your attempts">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11.5px] text-ink-3">
                <th className="py-1 font-semibold">Attempt</th>
                <th className="py-1 font-semibold">Status</th>
                <th className="py-1 font-semibold">Submitted</th>
                <th className="py-1 font-semibold">Score</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {a.attempts.map((t) => (
                <tr key={t.id} className="border-t border-line">
                  <td className="py-1.5 tabular-nums">{t.attempt_no}</td>
                  <td className="py-1.5">{t.status === 'NEEDS_GRADING' ? <Pill tone="amber">Being graded</Pill> : t.status === 'IN_PROGRESS' ? <Pill tone="blue">Under way</Pill> : t.passed ? <Pill tone="green">Passed</Pill> : t.passed === false ? <Pill tone="red">Not passed</Pill> : <Pill tone="grey">Submitted</Pill>}</td>
                  <td className="py-1.5 text-ink-2">{when(t.submitted_at, true)}</td>
                  <td className="py-1.5 tabular-nums">{t.percent !== undefined && t.percent !== null ? pct(t.percent) : '—'}</td>
                  <td className="py-1.5 text-right">
                    <button type="button" className="text-[12px] font-semibold text-primary" onClick={() => el.open.quiz(id, t.id)}>
                      {t.status === 'IN_PROGRESS' ? 'Carry on' : 'See it'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}
    </div>
  );
}

type Saving = 'saving' | 'saved' | 'failed';

/** An attempt: answered and saved question by question, or its result. */
function Run({ assessmentId, id }: { assessmentId: number; id: number }) {
  const el = useEl();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.attempt(id), queryFn: ({ signal }) => eGet<Attempt>(`/me/attempts/${id}`, undefined, signal), refetchOnWindowFocus: false });
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const [saving, setSaving] = useState<Record<number, Saving>>({});
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState<string | null>(null);
  const seq = useRef<Record<number, number>>({});
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const at = q.data;
  const running = at?.status === 'IN_PROGRESS';

  // The server's clock: seconds left when the attempt was read, counted down here, asked again at zero.
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!at || !running || at.seconds_left === null || at.seconds_left === undefined) return;
    const end = Date.now() + at.seconds_left * 1000;
    const t = setInterval(() => {
      const s = Math.max(0, Math.round((end - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) {
        clearInterval(t);
        void qc.invalidateQueries({ queryKey: K.attempt(id) });
      }
    }, 1000);
    return () => clearInterval(t);
  }, [at, running, qc, id]);

  const valueOf = (qq: AttemptQuestion): Answer => (qq.id in answers ? answers[qq.id]! : (qq.response ?? null));

  const save = useCallback(
    async (qid: number, response: Answer) => {
      const n = (seq.current[qid] ?? 0) + 1;
      seq.current[qid] = n;
      setSaving((s) => ({ ...s, [qid]: 'saving' }));
      try {
        await ePut(`/me/attempts/${id}/answers/${qid}`, { response });
        if (seq.current[qid] === n) setSaving((s) => ({ ...s, [qid]: 'saved' }));
      } catch (e) {
        if (refusalCode(e) === 'closed') {
          setClosed(errorText(e));
          void qc.invalidateQueries({ queryKey: K.attempt(id) });
          return;
        }
        if (seq.current[qid] === n) setSaving((s) => ({ ...s, [qid]: 'failed' }));
      }
    },
    [id, qc],
  );

  useEffect(() => {
    const t = timers.current;
    return () => Object.values(t).forEach(clearTimeout);
  }, []);

  const answer = (qid: number, response: Answer, typing = false) => {
    setAnswers((a) => ({ ...a, [qid]: response }));
    if (timers.current[qid]) clearTimeout(timers.current[qid]);
    if (typing) timers.current[qid] = setTimeout(() => void save(qid, response), 800);
    else void save(qid, response);
  };

  const submit = async () => {
    if (!at) return;
    if (!el.online) return toast('error', OFFLINE);
    setBusy(true);
    try {
      const all: Record<string, Answer> = {};
      for (const qq of at.questions) {
        const v = valueOf(qq);
        if (v !== null && v !== undefined) all[String(qq.id)] = v;
      }
      const r = await ePost<Attempt>(`/me/attempts/${id}/submit`, { answers: all });
      qc.setQueryData(K.attempt(id), r.data);
      void qc.invalidateQueries({ queryKey: K.myAssessment(assessmentId) });
      void qc.invalidateQueries({ queryKey: K.my });
      toast('success', r.message);
      setConfirm(false);
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (q.isLoading) return <Spinner />;
  if (q.error || !at) return <div className="p-6"><ErrorNote error={q.error ?? new Error('This attempt could not be loaded.')} onRetry={() => void q.refetch()} /></div>;
  const unanswered = at.questions.filter((qq) => empty(valueOf(qq))).length;
  const secs = left ?? at.seconds_left ?? null;
  const low = secs !== null && secs <= 60;

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <Back onClick={() => el.open.quiz(assessmentId)} label="The quiz" />
      <div className="sticky top-0 z-10 -mx-6 flex flex-wrap items-center gap-3 border-b border-line bg-ground/95 px-6 py-2 backdrop-blur">
        <h1 className="m-0 min-w-0 flex-1 text-[17px] font-bold text-ink">Attempt {at.attempt_no}</h1>
        {running && secs !== null ? (
          <span role="timer" aria-live={low ? 'assertive' : 'off'} className={cx('rounded-[8px] px-2.5 py-1 font-mono text-[14px] font-bold tabular-nums', low ? 'bg-danger-bg text-danger' : 'bg-subtle text-ink')}>
            <Icon name="timer" size={14} className="mr-1 inline" />
            {clock(secs)}
          </span>
        ) : null}
        {running ? (
          <>
            <span className="text-[12.5px] text-ink-3">{unanswered ? `${unanswered} not answered` : 'All answered'}</span>
            <Button variant="primary" icon="send" disabled={!el.online} onClick={() => setConfirm(true)}>
              Submit
            </Button>
          </>
        ) : (
          <Result at={at} />
        )}
      </div>
      {closed ? <Refusal text={closed} /> : null}
      {at.auto_submitted ? <Refusal text="Time ran out: the attempt was submitted as it stood." /> : null}
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {at.questions.map((qq, i) => (
          <li key={qq.id} id={`q-${qq.id}`} className="rounded-[12px] border border-line bg-surface p-4">
            <div className="mb-2 flex items-start gap-2">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-subtle text-[11.5px] font-bold text-ink-2">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <Rich html={qq.prompt} />
              </div>
              <span className="shrink-0 text-[11.5px] text-ink-3 tabular-nums">{qq.points} pt</span>
            </div>
            <Question q={qq} value={valueOf(qq)} disabled={!running || !!closed} onAnswer={(v, typing) => answer(qq.id, v, typing)} />
            {running ? (
              <div className="mt-1.5 h-4 text-[11.5px] text-ink-3" aria-live="polite">
                {saving[qq.id] === 'saving' ? 'Saving…' : saving[qq.id] === 'saved' ? 'Saved' : saving[qq.id] === 'failed' ? <span className="text-danger">Not saved — it is sent again when you submit.</span> : null}
              </div>
            ) : (
              <Reviewed q={qq} />
            )}
          </li>
        ))}
      </ol>
      {confirm ? (
        <Modal
          title="Submit this attempt?"
          onClose={() => setConfirm(false)}
          footer={
            <>
              <Button onClick={() => setConfirm(false)}>Keep answering</Button>
              <Button variant="primary" loading={busy} onClick={() => void submit()}>
                Submit
              </Button>
            </>
          }
        >
          <p className="m-0 text-[13px] text-ink-2">{unanswered ? `${unanswered} questions are not answered. ` : ''}Once submitted, the answers cannot be changed.</p>
        </Modal>
      ) : null}
    </div>
  );
}

function empty(v: Answer | undefined): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
}

function Result({ at }: { at: Attempt }) {
  if (at.status === 'NEEDS_GRADING' || at.status === 'SUBMITTED') return <Pill tone="amber">Submitted — some answers are being graded by a person</Pill>;
  return (
    <span className="flex items-center gap-2">
      {at.percent !== undefined && at.percent !== null ? <b className="text-[15px] text-ink tabular-nums">{pct(at.percent)}</b> : null}
      {at.passed === true ? <Pill tone="green">Passed</Pill> : at.passed === false ? <Pill tone="red">Not passed</Pill> : null}
    </span>
  );
}

/** How a question came out, as far as the quiz shows it. */
function Reviewed({ q }: { q: AttemptQuestion }) {
  const right = rightAnswer(q);
  if (q.correct === undefined && q.score === undefined && !q.feedback && !right && !q.explanation) return null;
  return (
    <div className="mt-2 flex flex-col gap-1 rounded-[8px] bg-subtle px-3 py-2 text-[12.5px]">
      <div className="flex items-center gap-2">
        {q.correct === true ? <Pill tone="green">Right</Pill> : q.correct === false ? <Pill tone="red">Not right</Pill> : null}
        {q.score !== undefined && q.score !== null ? <span className="text-ink-2 tabular-nums">{q.score} of {q.points}</span> : null}
      </div>
      {right ? <div className="text-ink-2">The answer: {right}</div> : null}
      {q.explanation ? <div className="text-ink-2">{q.explanation}</div> : null}
      {q.feedback ? <div className="text-ink">Feedback: {q.feedback}</div> : null}
    </div>
  );
}

/** The key, where the quiz shows it after submitting — ids read back as their labels. */
export function rightAnswer(q: AttemptQuestion): string | null {
  const a = q.answer;
  if (a === undefined || a === null) return null;
  const label = (id: unknown) => q.options?.find((o) => o.id === Number(id))?.label ?? q.choices?.find((o) => o.id === Number(id))?.label ?? String(id);
  switch (q.qtype) {
    case 'SINGLE':
    case 'MULTIPLE':
    case 'TRUE_FALSE':
      return Array.isArray(a) ? a.map(label).join(', ') : label(a);
    case 'ORDERING':
      return Array.isArray(a) ? a.map(label).join(' → ') : null;
    case 'MATCHING':
      return typeof a === 'object' ? Object.entries(a as Record<string, unknown>).map(([l, c]) => `${label(l)} — ${label(c)}`).join('; ') : null;
    case 'SHORT_ANSWER':
      return Array.isArray(a) ? a.join(' / ') : String(a);
    case 'FILL_BLANK':
      return Array.isArray(a) ? a.map((b, i) => `${i + 1}: ${Array.isArray(b) ? b.join(' / ') : String(b)}`).join('; ') : null;
    case 'NUMERIC': {
      const n = a as { answer?: number; tolerance?: number };
      return n.answer !== undefined ? `${n.answer}${n.tolerance ? ` ± ${n.tolerance}` : ''}` : null;
    }
    default:
      return null;
  }
}

/** One question's answer control, by type (the responses the server reads). */
export function Question({ q, value, disabled, onAnswer }: { q: AttemptQuestion; value: Answer; disabled: boolean; onAnswer: (v: Answer, typing?: boolean) => void }) {
  const [picking, setPicking] = useState(false);
  const name = `q${q.id}`;
  switch (q.qtype) {
    case 'SINGLE':
    case 'TRUE_FALSE':
      return (
        <div role="radiogroup" aria-label="Choose one" className="flex flex-col gap-1">
          {(q.options ?? []).map((o) => (
            <label key={o.id} className={cx('flex items-center gap-2 rounded-[8px] border px-3 py-2 text-[13px]', Number(value) === o.id ? 'border-primary bg-selection' : 'border-line', disabled ? 'opacity-80' : 'cursor-pointer hover:bg-subtle')}>
              <input type="radio" name={name} disabled={disabled} checked={Number(value) === o.id} onChange={() => onAnswer(o.id)} />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      );
    case 'MULTIPLE': {
      const set = new Set(Array.isArray(value) ? (value as number[]).map(Number) : []);
      return (
        <div className="flex flex-col gap-1" aria-label="Choose all that apply">
          {(q.options ?? []).map((o) => (
            <label key={o.id} className={cx('flex items-center gap-2 rounded-[8px] border px-3 py-2 text-[13px]', set.has(o.id) ? 'border-primary bg-selection' : 'border-line', disabled ? 'opacity-80' : 'cursor-pointer hover:bg-subtle')}>
              <Checkbox
                disabled={disabled}
                checked={set.has(o.id)}
                onChange={() => {
                  const n = new Set(set);
                  if (n.has(o.id)) n.delete(o.id);
                  else n.add(o.id);
                  onAnswer((q.options ?? []).filter((x) => n.has(x.id)).map((x) => x.id));
                }}
              />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      );
    }
    case 'SHORT_ANSWER':
      return <input aria-label="Your answer" className={input} disabled={disabled} value={typeof value === 'string' ? value : ''} onChange={(e) => onAnswer(e.target.value, true)} maxLength={1000} />;
    case 'LONG_ANSWER':
      return <textarea aria-label="Your answer" className={`${area} min-h-[140px]`} disabled={disabled} value={typeof value === 'string' ? value : ''} onChange={(e) => onAnswer(e.target.value, true)} />;
    case 'NUMERIC':
      return (
        <input
          aria-label="Your answer"
          type="number"
          step="any"
          className={`${input} max-w-[220px]`}
          disabled={disabled}
          value={typeof value === 'number' ? String(value) : typeof value === 'string' ? value : ''}
          onChange={(e) => onAnswer(e.target.value === '' ? null : Number(e.target.value), true)}
        />
      );
    case 'FILL_BLANK': {
      const n = Math.max(1, q.blanks ?? 1);
      const vals = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: n }, (_, i) => (
            <input
              key={i}
              aria-label={`Blank ${i + 1}`}
              placeholder={`Blank ${i + 1}`}
              className={`${input} max-w-[220px]`}
              disabled={disabled}
              value={vals[i] ?? ''}
              onChange={(e) => {
                const next = Array.from({ length: n }, (_, j) => (j === i ? e.target.value : (vals[j] ?? '')));
                onAnswer(next, true);
              }}
            />
          ))}
        </div>
      );
    }
    case 'MATCHING': {
      const map = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, number>) : {};
      return (
        <div className="flex flex-col gap-1.5">
          {(q.options ?? []).map((o) => (
            <div key={o.id} className="flex items-center gap-2 text-[13px]">
              <span className="min-w-0 flex-1">{o.label}</span>
              <select
                aria-label={`Match for ${o.label}`}
                disabled={disabled}
                className="h-8 min-w-[200px] rounded-[8px] border border-line bg-surface px-2 text-[13px]"
                value={map[String(o.id)] ? String(map[String(o.id)]) : ''}
                onChange={(e) => {
                  const next = { ...map };
                  if (e.target.value) next[String(o.id)] = Number(e.target.value);
                  else delete next[String(o.id)];
                  onAnswer(next);
                }}
              >
                <option value="">Choose…</option>
                {(q.choices ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      );
    }
    case 'ORDERING': {
      const ids = Array.isArray(value) && value.length === (q.options ?? []).length ? (value as number[]).map(Number) : (q.options ?? []).map((o) => o.id);
      const move = (i: number, d: -1 | 1) => {
        const next = [...ids];
        const j = i + d;
        if (j < 0 || j >= next.length) return;
        [next[i], next[j]] = [next[j]!, next[i]!];
        onAnswer(next);
      };
      return (
        <ol className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Put these in order">
          {ids.map((oid, i) => (
            <li key={oid} className="flex items-center gap-2 rounded-[8px] border border-line px-3 py-1.5 text-[13px]">
              <span className="w-5 text-ink-3 tabular-nums">{i + 1}.</span>
              <span className="min-w-0 flex-1">{q.options?.find((o) => o.id === oid)?.label}</span>
              <button type="button" aria-label="Move up" disabled={disabled || i === 0} onClick={() => move(i, -1)} className="rounded-[6px] p-1 text-ink-2 hover:bg-subtle disabled:opacity-30">
                <Icon name="arrow-up" size={14} />
              </button>
              <button type="button" aria-label="Move down" disabled={disabled || i === ids.length - 1} onClick={() => move(i, 1)} className="rounded-[6px] p-1 text-ink-2 hover:bg-subtle disabled:opacity-30">
                <Icon name="arrow-down" size={14} />
              </button>
            </li>
          ))}
        </ol>
      );
    }
    case 'FILE_UPLOAD': {
      const files = Array.isArray(value) ? (value as number[]) : [];
      return (
        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] text-ink-2">{files.length ? `${files.length} Drive file(s) chosen` : 'No file chosen yet.'}</span>
          {!disabled ? (
            <Button size="sm" icon="folder" className="self-start" onClick={() => setPicking(true)}>
              Choose from Drive
            </Button>
          ) : null}
          {picking ? (
            <DriveFilePicker
              title={`Choose up to ${q.max_files ?? 1} file(s)`}
              confirmLabel="Use these"
              onClose={() => setPicking(false)}
              onChoose={(chosen) => {
                setPicking(false);
                onAnswer(chosen.slice(0, q.max_files ?? 1).map((f) => Number(f.id)));
              }}
            />
          ) : null}
        </div>
      );
    }
    default:
      return <p className="m-0 text-[12.5px] text-ink-3">This kind of question is answered on the web.</p>;
  }
}
