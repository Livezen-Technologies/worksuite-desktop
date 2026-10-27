import { useRef, useState, type DragEvent, type PointerEvent, type ReactNode } from 'react';
import { Icon } from './Icon';
import { Select } from './Select';
import { Button, Modal, cx } from './ui';

/**
 * Form pieces first drawn for Garage and used by the hotel desk (PMS) too: a titled section, a field, a tab row, a
 * small form in a dialog, a drop zone, a file chooser and a signature pad. They moved here from `garage/parts` so a
 * module never borrows another module's parts (audit D-G08).
 */

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

export const input = 'h-9 w-full rounded-[8px] border border-line bg-surface px-3 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-primary';

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

export function ToneNote({ tone = 'amber', children }: { tone?: 'amber' | 'green' | 'blue' | 'red'; children: ReactNode }) {
  const c = tone === 'green' ? 'bg-success-bg text-success' : tone === 'blue' ? 'bg-selection text-primary' : tone === 'red' ? 'bg-danger-bg text-danger' : 'bg-warning-bg text-warning';
  return <div className={cx('rounded-[8px] px-3 py-2 text-[12.5px] font-medium', c)}>{children}</div>;
}
