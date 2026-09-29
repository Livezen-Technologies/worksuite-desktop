import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { DriveFilePicker, type DriveFileRow } from '../../components/DriveFilePicker';
import { Icon } from '../../components/Icon';
import { Button, ErrorNote, Spinner } from '../../components/ui';
import { bytes } from '../../core/time';
import { toast } from '../../core/toasts';
import { eGet, ePost, ePostForm, errorText, K, MAX_UPLOAD, newKey, OFFLINE, pct, when, type MyAssignment, type Submission } from './api';
import { area, Back, Field, FileLink, Refusal, Rich, Section, WorkPill, useEl } from './parts';

/**
 * An assignment (§5.13, WF-12): the brief, the due date that holds for this
 * learner, the attempts left, and each submission with its grade and
 * feedback. Work goes in as text and files — Drive files, or files from this
 * computer, which the server puts in the learner's Drive — as a draft or for
 * grading. Late work is taken or refused as the assignment says.
 */
export default function Assignment({ id }: { id: number }) {
  const el = useEl();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.myAssignment(id), queryFn: ({ signal }) => eGet<MyAssignment>(`/me/assignments/${id}`, undefined, signal) });
  // When the page was opened: whether the due date has passed is a hint here; the server marks late work itself.
  const [openedAt] = useState(() => Date.now());
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <div className="p-6"><ErrorNote error={q.error ?? new Error('This assignment could not be loaded.')} onRetry={() => void q.refetch()} /></div>;
  const a = q.data;
  const draft = a.submissions.find((s) => s.status === 'IN_PROGRESS') ?? null;
  const waiting = a.submissions.some((s) => ['SUBMITTED', 'LATE', 'UNDER_REVIEW'].includes(s.status));
  const may = !a.completed && !waiting && (a.attempts_left === null || a.attempts_left > 0);
  const past = a.due_at ? new Date(`${a.due_at.replace(' ', 'T')}Z`).getTime() < openedAt : false;

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <Back onClick={() => el.open.course(a.course_id)} label="The course" />
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-[20px] font-bold text-ink">{a.title}</h1>
          <p className="mt-1 mb-0 text-[12.5px] text-ink-3">
            {[
              a.due_at ? `Due ${when(a.due_at, true)}` : 'No due date',
              `out of ${a.max_score}`,
              a.pass_score !== null ? `pass at ${a.pass_score}` : null,
              a.attempts_allowed === 0 ? 'unlimited attempts' : `${a.attempts_left ?? a.attempts_allowed} of ${a.attempts_allowed} attempts left`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {a.status ? <WorkPill status={a.status} /> : null}
      </div>
      {a.instructions ? (
        <Section title="The brief">
          <Rich html={a.instructions} />
        </Section>
      ) : null}
      {a.completed ? <Refusal text="This assignment is complete." /> : waiting ? <Refusal text="Your submission is waiting to be graded." /> : null}
      {may ? (
        <Compose
          a={a}
          draft={draft}
          late={past}
          onDone={() => {
            void qc.invalidateQueries({ queryKey: K.myAssignment(id) });
            void qc.invalidateQueries({ queryKey: K.my });
          }}
        />
      ) : null}
      {a.submissions.filter((s) => s.status !== 'IN_PROGRESS').length ? (
        <Section title="Your submissions">
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {a.submissions
              .filter((s) => s.status !== 'IN_PROGRESS')
              .map((s) => (
                <li key={s.id}>
                  <SubmissionView s={s} max={a.max_score} />
                </li>
              ))}
          </ol>
        </Section>
      ) : null}
      {!el.online ? <p className="m-0 text-[12px] text-ink-3">{OFFLINE}</p> : null}
    </div>
  );
}

export function SubmissionView({ s, max }: { s: Submission; max: number }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-[10px] border border-line p-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-ink">Attempt {s.attempt_no}</b>
        <WorkPill status={s.status} />
        {s.is_late ? <span className="text-[12px] font-semibold text-warning">Late</span> : null}
        <span className="flex-1" />
        <span className="text-[12px] text-ink-3">{when(s.submitted_at, true)}</span>
      </div>
      {s.text ? <p className="m-0 whitespace-pre-wrap text-ink-2 selectable">{s.text}</p> : null}
      {s.files.length ? (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {s.files.map((f) => (
            <li key={f.id} className="flex items-center gap-1.5 text-[12.5px]">
              <Icon name="paperclip" size={13} className="text-ink-3" />
              <FileLink name={f.name} url={f.url} />
              <span className="text-ink-3">{bytes(f.size)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {s.score !== null ? (
        <div className="text-ink">
          Score <b className="tabular-nums">{s.score}</b> of {max} ({pct(s.percent)}){s.late_penalty ? ` · late penalty ${s.late_penalty}` : ''}
          {s.passed === true ? ' · passed' : s.passed === false ? ' · not passed' : ''}
        </div>
      ) : null}
      {s.feedback ? <div className="rounded-[8px] bg-subtle px-3 py-2 text-ink-2">Feedback: {s.feedback}</div> : null}
    </div>
  );
}

function Compose({ a, draft, late, onDone }: { a: MyAssignment; draft: Submission | null; late: boolean; onDone: () => void }) {
  const el = useEl();
  const [text, setText] = useState(draft?.text ?? '');
  const [drive, setDrive] = useState<Array<{ id: number; name: string }>>(draft?.files.map((f) => ({ id: f.id, name: f.name })) ?? []);
  const [local, setLocal] = useState<File[]>([]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const key = useRef<string | null>(null);
  const localBytes = local.reduce((n, f) => n + f.size, 0);
  const count = drive.length + local.length;

  const send = async (draftOnly: boolean) => {
    if (!el.online) return toast('error', OFFLINE);
    if (localBytes > MAX_UPLOAD) return setWhy('Files from this computer can be up to 25 MB together here. Put larger ones in Drive first and choose them from there.');
    setBusy(draftOnly ? 'draft' : 'submit');
    setWhy(null);
    key.current ??= newKey(draftOnly ? 'draft' : 'submit');
    try {
      let r: { message: string };
      if (local.length) {
        const form = new FormData();
        if (text.trim()) form.append('text', text);
        for (const f of drive) form.append('file_ids[]', String(f.id));
        for (const f of local) form.append('files[]', f, f.name);
        if (draftOnly) form.append('draft', '1');
        r = await ePostForm(`/me/assignments/${a.id}/submissions`, form, key.current);
      } else {
        r = await ePost(`/me/assignments/${a.id}/submissions`, { text: text.trim() ? text : undefined, file_ids: drive.map((f) => f.id), ...(draftOnly ? { draft: true } : {}) }, key.current);
      }
      key.current = null;
      toast('success', r.message);
      setLocal([]);
      onDone();
    } catch (e) {
      key.current = null;
      setWhy(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const pickDrive = (rows: DriveFileRow[]) => {
    setPicking(false);
    setDrive((d) => [...d, ...rows.filter((r) => !d.some((x) => x.id === Number(r.id))).map((r) => ({ id: Number(r.id), name: r.name }))].slice(0, a.max_files));
  };

  return (
    <Section title={draft ? 'Your draft' : 'Hand in your work'}>
      <div className="flex flex-col gap-3">
        {late && a.late_policy !== 'BLOCK' ? <Refusal text={`The due date has passed: this will be marked late${a.late_penalty_pct ? `, and ${a.late_penalty_pct}% of the score is taken off` : ''}.`} /> : null}
        {a.allow_text ? (
          <Field label="Your answer">
            <textarea className={`${area} min-h-[140px]`} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-semibold text-ink-2">
            Files {a.require_file ? '(required)' : ''} — up to {a.max_files}, {a.max_file_mb} MB each{a.allowed_types.length ? `: ${a.allowed_types.join(', ')}` : ''}
          </span>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-[12.5px]">
            {drive.map((f) => (
              <li key={`d${f.id}`} className="flex items-center gap-1.5">
                <Icon name="folder" size={13} className="text-ink-3" />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <button type="button" aria-label={`Remove ${f.name}`} className="text-ink-3 hover:text-danger" onClick={() => setDrive((d) => d.filter((x) => x.id !== f.id))}>
                  <Icon name="x" size={13} />
                </button>
              </li>
            ))}
            {local.map((f, i) => (
              <li key={`l${i}`} className="flex items-center gap-1.5">
                <Icon name="upload" size={13} className="text-ink-3" />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="text-ink-3">{bytes(f.size)}</span>
                <button type="button" aria-label={`Remove ${f.name}`} className="text-ink-3 hover:text-danger" onClick={() => setLocal((l) => l.filter((_, j) => j !== i))}>
                  <Icon name="x" size={13} />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon="folder" disabled={count >= a.max_files} onClick={() => setPicking(true)}>
              Choose from Drive
            </Button>
            <label className={`inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2.5 text-[12px] font-semibold text-ink hover:bg-subtle ${count >= a.max_files ? 'pointer-events-none opacity-50' : ''}`}>
              <Icon name="upload" size={14} /> From this computer
              <input
                type="file"
                multiple
                className="sr-only"
                accept={a.allowed_types.length ? a.allowed_types.map((t) => `.${t}`).join(',') : undefined}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  setLocal((l) => [...l, ...files].slice(0, Math.max(0, a.max_files - drive.length)));
                }}
              />
            </label>
          </div>
        </div>
        {why ? <Refusal text={why} /> : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon="send" loading={busy === 'submit'} disabled={busy !== null || !el.online} onClick={() => void send(false)}>
            Submit for grading
          </Button>
          <Button loading={busy === 'draft'} disabled={busy !== null || !el.online} onClick={() => void send(true)}>
            Save as draft
          </Button>
        </div>
      </div>
      {picking ? <DriveFilePicker title="Choose files for your submission" confirmLabel="Add" onClose={() => setPicking(false)} onChoose={pickDrive} /> : null}
    </Section>
  );
}
