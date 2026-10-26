import { createContext, useContext, useEffect, useRef, useState, type DragEvent, type PointerEvent, type ReactNode } from 'react';
import type { GarageDoc } from '@shared/garage-docs';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Button, Modal, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { Pill } from '../inventory/parts';
import { download, errorText, lateBy, mediaSrc, type JobCard, type Options } from './api';
import { StatCard, type StatTone } from '../../components/StatCard';

/** What every Garage screen shares: the company, its options, and the way round the module. */
export type GarageView = 'overview' | 'board' | 'jobs' | 'walkin' | 'mywork' | 'parts' | 'vehicles' | 'customers' | 'reports' | 'workshop' | 'setup' | 'settings';

export interface Garage {
  org: string;
  options: Options;
  may: (perm: string) => boolean;
  go: (view: GarageView, params?: Record<string, string | number | null | undefined>) => void;
  openJob: (id: number | null, tab?: string) => void;
  /** A job's check-in screen (photos, condition, the customer's signature). */
  openCheckin: (id: number) => void;
  /** A vehicle's 360° view. */
  openVehicle: (id: number) => void;
  /** Whether WorkSuite can be reached: writes wait for it. */
  online: boolean;
}

export const GarageContext = createContext<Garage | null>(null);

export function useGarage(): Garage {
  const g = useContext(GarageContext);
  if (!g) throw new Error('useGarage outside GarageShell');
  return g;
}

type Tone = 'blue' | 'amber' | 'red' | 'green' | 'grey';

const STATUS_TONE: Record<string, Tone> = {
  DRAFT: 'grey', CHECKED_IN: 'blue', INSPECTION: 'blue', DIAGNOSIS: 'blue', ESTIMATE_PREPARATION: 'blue',
  AWAITING_CUSTOMER_APPROVAL: 'amber', ADDITIONAL_APPROVAL_REQUIRED: 'amber', APPROVED: 'green', WAITING_PARTS: 'amber',
  READY_TO_START: 'blue', IN_PROGRESS: 'blue', PAUSED: 'grey', QUALITY_CHECK: 'blue', ROAD_TEST: 'blue',
  READY_FOR_DELIVERY: 'green', INVOICE_PENDING: 'green', COMPLETED: 'green', CANCELLED: 'red',
};

const WO_TONE: Record<string, Tone> = {
  PENDING: 'amber', READY: 'grey', ASSIGNED: 'blue', IN_PROGRESS: 'blue', PAUSED: 'grey', WAITING_PARTS: 'amber',
  COMPLETED: 'green', QC_FAILED: 'red', REWORK: 'red', CANCELLED: 'grey',
};

const PART_TONE: Record<string, Tone> = {
  REQUESTED: 'amber', PURCHASE_REQUESTED: 'amber', RESERVED: 'blue', ISSUED: 'blue', PARTIALLY_RETURNED: 'green', CONSUMED: 'green', CANCELLED: 'grey',
};

export function StatusPill({ status, label }: { status: string; label: string }) {
  return <Pill tone={STATUS_TONE[status] ?? 'grey'}>{label}</Pill>;
}

export function WorkPill({ status }: { status: string }) {
  return <Pill tone={WO_TONE[status] ?? 'grey'}>{status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ')}</Pill>;
}

export function PartPill({ status }: { status: string }) {
  return <Pill tone={PART_TONE[status] ?? 'grey'}>{status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ')}</Pill>;
}

export function PriorityPill({ priority }: { priority: string }) {
  if (priority === 'NORMAL') return null;
  return <Pill tone={priority === 'URGENT' ? 'red' : priority === 'HIGH' ? 'amber' : 'grey'}>{priority.charAt(0) + priority.slice(1).toLowerCase()}</Pill>;
}

/** A job as a card, on the board and in lists (FR-BRD-02). */
export function JobCardView({ job, onOpen, draggable, onDragStart }: { job: JobCard; onOpen: () => void; draggable?: boolean; onDragStart?: (e: DragEvent) => void }) {
  const car = [job.vehicle?.make, job.vehicle?.model].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={onOpen}
      aria-label={`Job ${job.number}, ${job.vehicle?.number ?? ''}, ${job.status_label}`}
      className={cx('flex w-full flex-col gap-1 rounded-[10px] border bg-surface px-2.5 py-2 text-left hover:border-primary/50', job.overdue ? 'border-danger/60' : 'border-line')}
    >
      <span className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] font-semibold text-ink-3">{job.number}</span>
        {job.fleet ? <Pill tone="blue">Fleet</Pill> : null}
        <PriorityPill priority={job.priority} />
      </span>
      <b className="text-[14px] tracking-wide text-ink">{job.vehicle?.number ?? '—'}</b>
      <span className="truncate text-[11.5px] text-ink-3">{[car || null, job.customer?.name ?? null].filter(Boolean).join(' · ') || '—'}</span>
      <span className="flex items-center gap-1.5">
        <StatusPill status={job.status} label={job.status_label} />
        <span className="min-w-0 flex-1" />
        {job.advisor_initials ? (
          <span title={job.advisor} className="grid size-6 place-items-center rounded-full bg-subtle text-[10px] font-bold text-ink-2">
            {job.advisor_initials}
          </span>
        ) : null}
      </span>
      {job.overdue ? (
        <span className="flex items-center gap-1 text-[11.5px] font-semibold text-danger">
          <Icon name="warning" size={13} /> {lateBy(job.late_minutes)}
        </span>
      ) : null}
    </button>
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

/** A figure on the overview, a way into its list. */
export function Tile({ label, value, icon, tone, onClick }: { label: string; value: string; icon?: string; tone?: StatTone; onClick?: () => void }) {
  return <StatCard label={label} value={value} icon={icon} tone={tone} onClick={onClick} />;
}

export const input = 'h-9 w-full rounded-[8px] border border-line bg-surface px-3 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-primary';

/** A clock that moves once a second, for the running timer. */
export function useTick(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** A photo or file on a job, read through the API proxy; anything but a picture as its kind. */
export function Thumb({ id, mime = 'image/jpeg', alt, className = 'size-20' }: { id: number; mime?: string; alt: string; className?: string }) {
  if (!mime.startsWith('image/')) {
    return <span className={cx('grid place-items-center rounded-[8px] bg-subtle text-[10.5px] font-semibold text-ink-3', className)}>{mime.startsWith('video/') ? 'Video' : mime === 'application/pdf' ? 'PDF' : 'File'}</span>;
  }
  return <img src={mediaSrc(id)} alt={alt} loading="lazy" className={cx('rounded-[8px] bg-subtle object-cover', className)} />;
}

/**
 * A document WorkSuite prints, through the download manager: View opens it
 * (in the browser, to read or print), Save keeps a copy in the downloads
 * folder. Both show in Transfers.
 */
export function DocActions({ doc, name, label, what, size = 'sm' }: { doc: GarageDoc; name: string; label: string; what: string; size?: 'sm' | 'md' }) {
  const [busy, setBusy] = useState<'view' | 'save' | null>(null);
  const get = async (open: boolean) => {
    setBusy(open ? 'view' : 'save');
    try {
      await download(doc, name, open);
      toast('success', open ? `Opening the ${what} — see Transfers.` : `Saving the ${what} to your downloads — see Transfers.`);
    } catch (e) {
      toast('error', errorText(e, `The ${what} could not be downloaded.`));
    } finally {
      setBusy(null);
    }
  };
  return (
    <span className="inline-flex items-center gap-1">
      <Button size={size} icon="printer" loading={busy === 'view'} disabled={busy !== null} title={`Open the ${what} to read or print`} aria-label={`Open the ${what}`} onClick={() => void get(true)}>
        {label}
      </Button>
      <Button size={size} variant="ghost" icon="download" loading={busy === 'save'} disabled={busy !== null} title={`Save the ${what} to your downloads`} aria-label={`Save the ${what}`} onClick={() => void get(false)}>
        Save
      </Button>
    </span>
  );
}

/** The tracker over a job (§13): its steps, the one it has reached marked. */
export function Tracker({ steps, at, cancelled }: { steps: string[]; at: number; cancelled: boolean }) {
  if (steps.length === 0) return null;
  return (
    <ol className="m-0 flex list-none items-center gap-1 overflow-x-auto p-0" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s} className="flex min-w-0 flex-1 flex-col gap-1" aria-current={i === at && !cancelled ? 'step' : undefined}>
          <span className={cx('h-1.5 rounded-full', !cancelled && i <= at ? 'bg-primary' : 'bg-subtle')} />
          <span className={cx('truncate text-[10.5px] font-semibold', i === at && !cancelled ? 'text-primary' : 'text-ink-3')}>{s}</span>
        </li>
      ))}
    </ol>
  );
}

/** A tab row inside a screen. */
export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: Array<{ id: T; label: ReactNode }>; value: T; onChange: (t: T) => void; label: string }) {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-line" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-current={value === t.id ? 'page' : undefined}
          onClick={() => onChange(t.id)}
          className={cx('-mb-px shrink-0 border-b-2 px-3 py-2 text-[13px] font-semibold whitespace-nowrap', value === t.id ? 'border-primary text-primary' : 'border-transparent text-ink-3 hover:text-ink')}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}

export interface AskField {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'select' | 'textarea' | 'date';
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  placeholder?: string;
  initial?: string;
  hint?: string;
}

/**
 * A small form in a dialog — a reason, a note, a few fields — returned as
 * text values on confirm. The server checks what comes; the dialog only
 * insists on the required fields being filled.
 */
export function Ask({ title, text, fields, confirm = 'Save', danger, busy, onClose, onSubmit }: { title: string; text?: ReactNode; fields: AskField[]; confirm?: string; danger?: boolean; busy?: boolean; onClose: () => void; onSubmit: (values: Record<string, string>) => void }) {
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.name, f.initial ?? (f.type === 'select' ? (f.options?.[0]?.value ?? '') : '')])));
  const ready = fields.every((f) => !f.required || (v[f.name] ?? '').trim() !== '');
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} disabled={!ready} onClick={() => onSubmit(v)}>
            {confirm}
          </Button>
        </div>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !busy) onSubmit(v);
        }}
      >
        {text ? <p className="m-0 text-[13px] text-ink-2">{text}</p> : null}
        {fields.map((f, i) => (
          <Field key={f.name} label={f.required ? `${f.label} *` : f.label} hint={f.hint}>
            {f.type === 'select' ? (
              <Select aria-label={f.label} value={v[f.name] ?? ''} onChange={(e) => setV({ ...v, [f.name]: e.target.value })} options={f.options ?? []} className={input} />
            ) : f.type === 'textarea' ? (
              <textarea aria-label={f.label} autoFocus={i === 0} className={cx(input, 'h-auto py-2')} rows={3} placeholder={f.placeholder} value={v[f.name] ?? ''} onChange={(e) => setV({ ...v, [f.name]: e.target.value })} />
            ) : (
              <input
                aria-label={f.label}
                autoFocus={i === 0}
                className={input}
                type={f.type === 'date' ? 'date' : 'text'}
                inputMode={f.type === 'number' ? 'decimal' : undefined}
                placeholder={f.placeholder}
                value={v[f.name] ?? ''}
                onChange={(e) => setV({ ...v, [f.name]: e.target.value })}
              />
            )}
          </Field>
        ))}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/** Files dropped on a place that takes them: highlighted while files are over it, quiet when it may not take them. */
export function DropZone({ enabled, onFiles, children, className, label }: { enabled: boolean; onFiles: (files: File[]) => void; children: ReactNode; className?: string; label: string }) {
  const [over, setOver] = useState(false);
  const props = enabled
    ? {
        onDragOver: (e: DragEvent) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          e.stopPropagation();
          setOver(true);
        },
        onDragLeave: () => setOver(false),
        onDrop: (e: DragEvent) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          onFiles(Array.from(e.dataTransfer.files));
        },
      }
    : {};
  return (
    <div aria-label={label} {...props} className={cx(className, over && 'ring-2 ring-primary ring-offset-1')}>
      {children}
    </div>
  );
}

/** "Choose…" beside a drop zone: the system's file picker. */
export function ChooseFiles({ disabled, accept, multiple = true, onFiles, label = 'Choose files…', small }: { disabled?: boolean; accept?: string; multiple?: boolean; onFiles: (files: File[]) => void; label?: string; small?: boolean }) {
  return (
    <label className={cx('inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-[8px] border border-line bg-surface font-semibold whitespace-nowrap text-ink hover:bg-subtle', small ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[13px]', disabled && 'pointer-events-none opacity-50')}>
      <Icon name="upload" size={14} /> {label}
      <input
        type="file"
        hidden
        multiple={multiple}
        disabled={disabled}
        accept={accept}
        aria-label={label}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </label>
  );
}

const PAD = { width: 480, height: 150 };

/**
 * The customer signs with the mouse, a pen or a touch screen. What is handed
 * over is a PNG data URL of the strokes, which the server keeps sealed and
 * binds to what was shown when it was signed.
 */
export function SignaturePad({ onChange, disabled, label = 'Signature: sign here with the mouse, a pen or a finger' }: { onChange: (png: string | null) => void; disabled?: boolean; label?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [signed, setSigned] = useState(false);
  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / (r.width || PAD.width)) * PAD.width, y: ((e.clientY - r.top) / (r.height || PAD.height)) * PAD.height };
  };
  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvas.current?.getContext('2d');
    if (disabled || !ctx) return;
    drawing.current = true;
    canvas.current!.setPointerCapture?.(e.pointerId);
    const p = point(e);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0F1B3D';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvas.current?.getContext('2d');
    if (!drawing.current || !ctx) return;
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    setSigned(true);
    onChange(canvas.current?.toDataURL('image/png') ?? null);
  };
  const clear = () => {
    canvas.current?.getContext('2d')?.clearRect(0, 0, PAD.width, PAD.height);
    setSigned(false);
    onChange(null);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <canvas
        ref={canvas}
        width={PAD.width}
        height={PAD.height}
        aria-label={label}
        role="img"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
        className="h-[150px] w-full max-w-[480px] touch-none rounded-[10px] border border-dashed border-line bg-white"
      />
      <span className="flex items-center gap-2 text-[11.5px] text-ink-3">
        <span className="flex-1">{signed ? 'Signed.' : 'Sign inside the box.'}</span>
        <Button size="sm" variant="ghost" disabled={disabled || !signed} onClick={clear}>
          Clear
        </Button>
      </span>
    </div>
  );
}

const LIGHT_TONE: Record<string, 'green' | 'amber' | 'red' | 'grey'> = { GREEN: 'green', PASS: 'green', AMBER: 'amber', RED: 'red', FAIL: 'red' };
const PRIORITY_WORD: Record<string, string> = { RED: 'Urgent', AMBER: 'Soon', GREEN: 'Advisory' };

/** A health-check light or an urgency (RED / AMBER / GREEN), in words. */
export function LightPill({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  return <Pill tone={LIGHT_TONE[value] ?? 'grey'}>{PRIORITY_WORD[value] ?? value.charAt(0) + value.slice(1).toLowerCase()}</Pill>;
}

export function ToneNote({ tone = 'amber', children }: { tone?: 'amber' | 'green' | 'blue' | 'red'; children: ReactNode }) {
  const c = tone === 'green' ? 'bg-success-bg text-success' : tone === 'blue' ? 'bg-selection text-primary' : tone === 'red' ? 'bg-danger-bg text-danger' : 'bg-warning-bg text-warning';
  return <div className={cx('rounded-[8px] px-3 py-2 text-[12.5px] font-medium', c)}>{children}</div>;
}
