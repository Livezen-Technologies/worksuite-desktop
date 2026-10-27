import { useRef, useState } from 'react';
import { request } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { cx } from '../../components/ui';
import { StatusChip } from '../../components/PageKit';

/**
 * Onboarding's shared pieces (HrOnboarding, HrSelfService "My onboarding"):
 * the state the server keeps per new hire, the step list with its glyphs and
 * chips, the progress bar and the required-documents checklist. Eight fixed
 * steps; six the server measures ("derived") and two HR records by hand.
 * A derived step can be marked blocked or not applicable, never done.
 */
export interface ObStep {
  step: string;
  label: string;
  status: 'done' | 'blocked' | 'in_progress' | 'pending' | 'skipped';
  required: boolean;
  derived: boolean;
  recorded: boolean;
  why: string | null;
  note: string | null;
  completed_at: string | null;
  sort_order: number;
}

export interface ReqDoc {
  name: string;
  required: boolean;
  status: 'pending' | 'approved' | 'rejected';
  on_file: boolean;
  document_id: number | null;
  filename: string | null;
  size: number | null;
  uploaded_at: string | null;
  comment: string | null;
}

export interface ObState {
  /** The raw onboarding row: its ids come back as text. */
  onboarding: { id: string | number; status: 'in_progress' | 'completed' | 'cancelled'; started_at: string | null; completed_at: string | null; cancelled_at: string | null; cancel_reason: string | null; target_start_date: string | null; notes: string | null } | null;
  employee: { id: number; employee_no: string; status: string; joined_at: string | null; name: string; type: string; work_location: string | null; user_id: number | null; org_id: number | null };
  steps: ObStep[];
  percent: number;
  next: string | null;
  blocking: string[];
  can_activate: boolean;
  required_documents?: ReqDoc[];
  can_manage?: boolean;
  linked?: boolean;
  profile?: Record<string, string | null>;
  self_fields?: string[];
}

export interface ObRow {
  id: number;
  employee_id: number;
  employee_no: string;
  name: string;
  email: string | null;
  status: string;
  employment_status: string;
  joined_at: string | null;
  target_start_date: string | null;
  started_at: string | null;
  completed_at: string | null;
  percent: number;
  next: string | null;
  next_label: string | null;
  blocking: string[];
}

/** The two steps HR ticks by hand; the rest the server works out. */
export const HAND_TICKED = new Set(['employment_documents', 'device_assignment']);

export function ProgressBar({ percent, className }: { percent: number; className?: string }) {
  return (
    <span className={cx('block h-1.5 overflow-hidden rounded-full bg-subtle', className)}>
      <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
    </span>
  );
}

/** Done, next, or still to do — the round glyph beside each step. */
function Glyph({ state }: { state: 'done' | 'next' | 'todo' }) {
  return (
    <span
      className={cx(
        'flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[12px] font-bold',
        state === 'done' ? 'bg-success text-white' : state === 'next' ? 'border-2 border-primary' : 'border-[1.5px] border-slate-line dark:border-line',
      )}
    >
      {state === 'done' ? '✓' : ''}
    </span>
  );
}

export function stepChip(s: ObStep, next: string | null): string | null {
  if (s.status === 'blocked') return 'Blocked';
  if (s.status === 'skipped') return 'Not applicable';
  if (s.status === 'done') return s.recorded && !s.derived ? 'Recorded by HR' : null;
  if (s.step === next) return 'Next';
  if (!s.required) return 'Optional';
  return null;
}

/**
 * The steps, each with what can be done about it. `actions` returns the
 * links for a step (HR: open, mark, mark as done; the employee: open).
 */
export function StepList({ state, actions }: { state: ObState; actions?: (s: ObStep) => Array<{ label: string; run: () => void }> }) {
  return (
    <div className="flex flex-col">
      {state.steps.map((s) => {
        const done = s.status === 'done' || s.status === 'skipped';
        const chip = stepChip(s, state.next);
        const acts = actions?.(s) ?? [];
        return (
          <div key={s.step} data-step={s.step} className={cx('flex items-start gap-2.5 border-b border-line/70 px-3.5 py-2.5 last:border-b-0', s.step === state.next && !done && 'bg-info-soft dark:bg-selection/40')}>
            <span className="pt-px">
              <Glyph state={done ? 'done' : s.step === state.next ? 'next' : 'todo'} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={cx('font-semibold', done ? 'text-ink-2' : 'text-ink')}>{s.label}</span>
                {chip ? <StatusChip>{chip}</StatusChip> : null}
              </span>
              {!done && (s.note || s.why) ? <span className="line-clamp-2 text-[12px] leading-[1.45] text-ink-3" title={s.note ?? s.why ?? undefined}>{s.note ?? s.why}</span> : null}
            </span>
            {acts.length ? (
              <span className="flex shrink-0 items-center gap-3 pt-0.5">
                {acts.map((a) => (
                  <button key={a.label} type="button" className="shrink-0 text-[12.5px] font-semibold whitespace-nowrap text-primary hover:underline" onClick={a.run}>
                    {a.label}
                  </button>
                ))}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

const DOC_STATUS = (d: ReqDoc) => (!d.on_file ? 'Not uploaded' : d.status === 'approved' ? 'Approved' : d.status === 'rejected' ? 'Rejected' : 'Under review');

/**
 * The documents the company needs from a new hire. A document answers one
 * when its title (or file name) is the requirement's name, so an upload here
 * is filed under that name. HR may approve or reject what is on file.
 */
export function RequiredDocs({ docs, uploadTo, onChanged, onVerify }: { docs: ReqDoc[]; uploadTo: string; onChanged: () => void; onVerify?: (d: ReqDoc, verdict: 'approved' | 'rejected') => void }) {
  const picker = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<ReqDoc | null>(null);
  const upload = async (file: File, d: ReqDoc) => {
    try {
      const form = new FormData();
      form.append('files[]', file, file.name);
      form.append('title', d.name);
      const r = await request<{ stored: unknown[]; rejected: Array<{ name: string; reason: string }> }>('POST', uploadTo, { body: form });
      if (r.data.rejected?.length) toast('error', r.data.rejected.map((x) => `${x.name}: ${x.reason}`).join('; '));
      else toast('success', `${d.name} uploaded.`);
      onChanged();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <div className="flex flex-col">
      <input
        ref={picker}
        type="file"
        hidden
        aria-label="Choose a required document"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f && target) void upload(f, target);
        }}
      />
      {docs.map((d) => (
        <div key={d.name} className="flex items-center gap-2 border-b border-line/70 px-3.5 py-2 last:border-b-0">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-semibold text-ink">{d.name}</span>
            {d.comment && d.status === 'rejected' ? <span className="truncate text-[11.5px] text-danger">{d.comment}</span> : d.filename ? <span className="truncate text-[11.5px] text-ink-3">{d.filename}</span> : null}
          </span>
          <StatusChip>{DOC_STATUS(d)}</StatusChip>
          {onVerify && d.on_file && d.status !== 'approved' ? (
            <button type="button" className="text-[12px] font-semibold text-success hover:underline" onClick={() => onVerify(d, 'approved')}>
              Approve
            </button>
          ) : null}
          {onVerify && d.on_file && d.status === 'pending' ? (
            <button type="button" className="text-[12px] font-semibold text-danger hover:underline" onClick={() => onVerify(d, 'rejected')}>
              Reject
            </button>
          ) : null}
          <button
            type="button"
            className="text-[12px] font-semibold text-primary hover:underline"
            onClick={() => {
              setTarget(d);
              picker.current?.click();
            }}
          >
            {d.on_file ? 'Replace' : 'Upload'}
          </button>
        </div>
      ))}
    </div>
  );
}
