import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FileViewer } from '../../components/FileViewer';
import { Icon } from '../../components/Icon';
import { Modal, cx } from '../../components/ui';
import { call } from '../../core/bridge';
import { sanitizeHtml } from '../../core/rich';
import { Pill } from '../../components/ListKit';
import { minutes, pct, when, type CatalogCard, type CourseCard, type Options } from './api';
import { StatCard, type StatTone } from '../../components/StatCard';

/** Where the eLearning tab can go. */
export type ElView =
  | 'my' | 'catalog' | 'downloads'
  | 'dashboard' | 'courses' | 'reviews' | 'categories'
  | 'learners' | 'enrollments' | 'approvals' | 'grading'
  | 'setup' | 'settings';

/** Records a route can name, each opened in the tab (or a window of its own). */
export interface ElRecords {
  course: (id: number, lesson?: number | null) => void;
  about: (id: number) => void;
  quiz: (id: number, attempt?: number | null) => void;
  task: (id: number) => void;
  manage: (id: number, tab?: string) => void;
  enrollment: (id: number) => void;
  learner: (id: number) => void;
  attempt: (id: number) => void;
  submission: (id: number) => void;
}

export interface El {
  /** The company chosen for single-company work (set-up, creating, the dashboard); lists cover every company. */
  org: string;
  options: Options;
  /** A grant in `options.can` (`course_edit`, `assessment_grade`…). */
  can: (key: string) => boolean;
  online: boolean;
  go: (view: ElView, params?: Record<string, string | number | null | undefined>) => void;
  open: ElRecords;
  /** The same record in a window of its own (a course being taken beside the work it is about, a submission to grade). */
  openWindow: (route: string, title: string) => void;
  route: (params: Record<string, string | number | null | undefined>) => string;
}

export const ElContext = createContext<El | null>(null);

export function useEl(): El {
  const e = useContext(ElContext);
  if (!e) throw new Error('useEl outside ElearningShell');
  return e;
}

type Tone = 'blue' | 'amber' | 'red' | 'green' | 'grey';

const COURSE_TONE: Record<string, Tone> = { DRAFT: 'grey', REVIEW: 'amber', APPROVED: 'blue', PUBLISHED: 'green', SUSPENDED: 'red', ARCHIVED: 'grey' };
const ENROL_TONE: Record<string, Tone> = { PENDING_APPROVAL: 'amber', ENROLLED: 'blue', IN_PROGRESS: 'blue', COMPLETED: 'green', FAILED: 'red', WITHDRAWN: 'grey' };
const WORK_TONE: Record<string, Tone> = {
  IN_PROGRESS: 'grey', SUBMITTED: 'blue', LATE: 'amber', UNDER_REVIEW: 'blue', COMPLETED: 'green', RESUBMISSION_REQUIRED: 'amber', GRADED: 'green', NEEDS_GRADING: 'amber',
};

const ENROL_WORDS: Record<string, string> = {
  PENDING_APPROVAL: 'Waiting for approval', ENROLLED: 'Not started', IN_PROGRESS: 'In progress', COMPLETED: 'Completed', FAILED: 'Not passed', WITHDRAWN: 'Withdrawn',
};

export function CourseStatusPill({ status, options }: { status: string; options?: Options }) {
  const label = options?.statuses.find((s) => s.value === status)?.label ?? status.charAt(0) + status.slice(1).toLowerCase();
  return <Pill tone={COURSE_TONE[status] ?? 'grey'}>{label}</Pill>;
}

export function EnrolPill({ status, overdue }: { status: string; overdue?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Pill tone={ENROL_TONE[status] ?? 'grey'}>{ENROL_WORDS[status] ?? status}</Pill>
      {overdue ? <Pill tone="red">Overdue</Pill> : null}
    </span>
  );
}

export function WorkPill({ status }: { status: string }) {
  return <Pill tone={WORK_TONE[status] ?? 'grey'}>{status === 'RESUBMISSION_REQUIRED' ? 'Resubmit' : status === 'NEEDS_GRADING' ? 'Needs grading' : status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ')}</Pill>;
}

export function Bar({ value, label, className }: { value: number; label: string; className?: string }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className={cx('h-1.5 overflow-hidden rounded-full bg-subtle', className)} role="progressbar" aria-label={label} aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx('h-full rounded-full', v >= 100 ? 'bg-success' : 'bg-primary')} style={{ width: `${v}%` }} />
    </div>
  );
}

export function Section({ title, action, children, className }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-[12px] border border-line bg-surface p-4', className)}>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="m-0 min-w-0 flex-1 text-[13.5px] font-bold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('flex flex-col gap-1', className)}>
      <span className="text-[12.5px] font-semibold text-ink-2">{label}</span>
      {children}
      {hint ? <span className="text-[12px] text-ink-3">{hint}</span> : null}
    </label>
  );
}

export function Tile({ label, value, hint, onClick, icon, tone }: { label: string; value: string; hint?: string; onClick?: () => void; icon?: string; tone?: StatTone }) {
  return <StatCard label={label} value={value} sub={hint} onClick={onClick} icon={icon} tone={tone} />;
}

export const input = 'h-9 w-full rounded-[8px] border border-line bg-surface px-3 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-primary';
export const area = 'min-h-[84px] w-full rounded-[8px] border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-primary';

const RICH =
  'rich selectable break-words text-[13.5px] leading-[1.65] text-ink [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-[3px] [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-ink-2 [&_code]:rounded [&_code]:bg-subtle [&_code]:px-1 [&_h1]:mt-3 [&_h1]:text-[20px] [&_h1]:font-bold [&_h2]:mt-2 [&_h2]:text-[16px] [&_h2]:font-bold [&_h3]:font-bold [&_hr]:my-3 [&_hr]:border-line [&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-[8px] [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-1.5 [&_pre]:overflow-x-auto [&_pre]:rounded-[8px] [&_pre]:bg-subtle [&_pre]:p-2.5 [&_table]:my-2 [&_table]:border-collapse [&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-line [&_th]:bg-subtle [&_th]:px-2 [&_th]:py-1 [&_ul]:list-disc [&_ul]:pl-6';

/** A link inside lesson text opens in the browser: a click never navigates the app itself. */
function openLinks(ev: React.MouseEvent) {
  const a = (ev.target as HTMLElement).closest('a');
  if (!a) return;
  ev.preventDefault();
  const href = a.getAttribute('href');
  if (href && /^(https?:|mailto:)/i.test(href)) void call('app:openExternal', { url: href }).catch(() => undefined);
}

/** Rich text the server already cleaned, cleaned again here before it is shown. */
export function Rich({ html, className }: { html: string | null | undefined; className?: string }) {
  const clean = useMemo(() => sanitizeHtml(html ?? '', { profile: 'rich' }), [html]);
  if (!clean.trim()) return null;
  // Links are <a> elements: Tab reaches them and Enter's click bubbles here.
  return <div className={cx(RICH, className)} role="presentation" onClick={openLinks} dangerouslySetInnerHTML={{ __html: clean }} />;
}

/** A course as a tile: its catalogue facts, and where the learner stands in it. */
export function CourseTile({ course, onOpen, children, reason }: { course: CourseCard | CatalogCard; onOpen: () => void; children?: ReactNode; reason?: string }) {
  const e = 'enrollment' in course ? course.enrollment : null;
  const facts = [course.category?.name, course.level, minutes(course.estimated_minutes)].filter(Boolean).join(' · ');
  return (
    <div className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-3.5">
      <button type="button" onClick={onOpen} className="flex flex-col gap-1 text-left" aria-label={`${course.title} (${course.code})`}>
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-semibold text-ink-3">{course.code}</span>
          {e && 'is_mandatory' in e && e.is_mandatory ? <Pill tone="amber">Mandatory</Pill> : null}
        </span>
        <b className="line-clamp-2 text-[14px] text-ink hover:text-primary">{course.title}</b>
        {course.summary ? <span className="line-clamp-2 text-[12.5px] text-ink-2">{course.summary}</span> : null}
        {facts ? <span className="text-[11.5px] text-ink-3">{facts}</span> : null}
        {reason ? <span className="text-[11.5px] text-ink-3 italic">{reason}</span> : null}
      </button>
      {e ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <EnrolPill status={e.status} overdue={e.overdue} />
            <span className="flex-1" />
            <span className="text-[11.5px] text-ink-3 tabular-nums">{pct(e.progress_percent)}</span>
          </div>
          <Bar value={e.progress_percent} label={`${course.title} progress`} />
          {e.due_at ? <span className={cx('text-[11.5px]', e.overdue ? 'font-semibold text-danger' : 'text-ink-3')}>Due {when(e.due_at)}</span> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** A refusal, said as the server said it, with the next step when there is one. */
export function Refusal({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-[10px] border border-warning/40 bg-warning-bg px-3 py-2 text-[12.5px] text-warning">
      <Icon name="info" size={15} className="mt-0.5 shrink-0" />
      <span className="flex-1">{text}</span>
      {children}
    </div>
  );
}

export function Back({ onClick, label = 'Back' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary hover:underline">
      <Icon name="back" size={14} /> {label}
    </button>
  );
}

/**
 * A submitted file (a learner's work, an answer's upload), opened in a viewer
 * inside the app — its address is the server's signed one, read through the
 * API proxy.
 */
export function FileLink({ name, url }: { name: string; url: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-primary hover:underline">
        {name}
      </button>
      {open ? (
        <Modal title={name} onClose={() => setOpen(false)} width={900}>
          <div className="h-[70vh]">
            <FileViewer path={url} name={name} />
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/**
 * Asks for the words an action needs — a reason (withdraw, reset, suspend,
 * a grade changed), a comment (returning a course, declining a request) —
 * and says the server's refusal where it came, without closing.
 */
export function Ask({ title, text, label, required, confirm, danger, onClose, onConfirm, children }: {
  title: string;
  text?: string;
  label: string;
  required?: boolean;
  confirm: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: (words: string) => Promise<void>;
  children?: ReactNode;
}) {
  const [words, setWords] = useState('');
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setWhy(null);
    try {
      await onConfirm(words.trim());
    } catch (e) {
      setWhy(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="h-8 rounded-[8px] border border-line bg-surface px-3 text-[13px] font-semibold text-ink hover:bg-subtle">
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || (required && !words.trim())}
            onClick={() => void go()}
            className={cx('h-8 rounded-[8px] px-3 text-[13px] font-semibold text-white disabled:opacity-50', danger ? 'bg-danger' : 'bg-primary hover:bg-primary-hover')}
          >
            {busy ? 'Working…' : confirm}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {text ? <p className="m-0 text-[13px] text-ink-2">{text}</p> : null}
        {children}
        <Field label={required ? label : `${label} (optional)`}>
          <textarea autoFocus className={area} value={words} onChange={(e) => setWords(e.target.value)} maxLength={2000} />
        </Field>
        {why ? <Refusal text={why} /> : null}
      </div>
    </Modal>
  );
}

const TOOLS: Array<{ cmd: string; arg?: string; icon: string; label: string }> = [
  { cmd: 'bold', icon: 'type', label: 'Bold' },
  { cmd: 'formatBlock', arg: 'h2', icon: 'hash', label: 'Heading' },
  { cmd: 'insertUnorderedList', icon: 'list', label: 'Bulleted list' },
  { cmd: 'insertOrderedList', icon: 'list-todo', label: 'Numbered list' },
  { cmd: 'formatBlock', arg: 'p', icon: 'file-text', label: 'Paragraph' },
];

/**
 * Rich text for a description, an article or instructions: headings, bold,
 * lists and links, cleaned here and again on the server. A new `initial`
 * means a new editor (give it a key).
 */
export function RichField({ initial, onChange, label, minHeight = 140 }: { initial: string | null | undefined; onChange: (html: string) => void; label: string; minHeight?: number }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (box.current) box.current.innerHTML = sanitizeHtml(initial ?? '', { profile: 'rich' });
    // The box keeps its own text once it has it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const changed = () => onChange(box.current?.innerHTML ?? '');
  const run = (cmd: string, arg?: string) => {
    box.current?.focus();
    document.execCommand(cmd, false, arg);
    changed();
  };
  return (
    <div className="flex flex-col rounded-[8px] border border-line bg-surface focus-within:border-primary">
      <div className="flex items-center gap-0.5 border-b border-line px-1 py-0.5" role="toolbar" aria-label={`${label} formatting`}>
        {TOOLS.map((t) => (
          <button key={t.label} type="button" title={t.label} aria-label={t.label} onMouseDown={(e) => e.preventDefault()} onClick={() => run(t.cmd, t.arg)} className="rounded-[6px] p-1.5 text-ink-2 hover:bg-subtle">
            <Icon name={t.icon} size={14} />
          </button>
        ))}
        <button
          type="button"
          title="Link"
          aria-label="Link"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const url = window.prompt('Link address (https://…)');
            if (url && /^https?:\/\//i.test(url)) run('createLink', url);
          }}
          className="rounded-[6px] p-1.5 text-ink-2 hover:bg-subtle"
        >
          <Icon name="link" size={14} />
        </button>
      </div>
      <div ref={box} role="textbox" aria-multiline="true" aria-label={label} contentEditable suppressContentEditableWarning onInput={changed} onBlur={changed} className={cx(RICH, 'overflow-auto px-3 py-2 outline-none')} style={{ minHeight }} />
    </div>
  );
}

export { Pill };
