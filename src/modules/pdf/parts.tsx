import { useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { Button, Chip, cx } from '../../components/ui';
import { Checkbox } from '../../components/Checkbox';
import { STATUS_LABEL, toolGate, type PdfTool } from './tools';

/**
 * Small pieces the PDF Studio tool panels and pages share: a titled section,
 * a radio list, a checkbox row, a labelled field, the Pro badge and the run
 * bar that says why a tool cannot run yet (PRO-FW-008).
 */

export function Section({ title, aside, children, className }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('flex flex-col gap-2 border-b border-line px-3.5 py-3', className)}>
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-[12px] font-bold tracking-[.3px] text-ink-3 uppercase">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Radios<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T; options: Array<{ id: T; label: string; hint?: string }>; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-1">
      {options.map((o) => (
        <label key={o.id} className={cx('flex cursor-pointer items-start gap-2 rounded-[8px] px-2 py-1.5 text-[12.5px]', value === o.id ? 'bg-selection text-ink' : 'text-ink-2 hover:bg-subtle', disabled && 'cursor-not-allowed opacity-60')}>
          <input type="radio" className="mt-0.5 accent-[var(--color-primary,#2563eb)]" checked={value === o.id} disabled={disabled} onChange={() => onChange(o.id)} />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{o.label}</span>
            {o.hint ? <span className="block text-[11.5px] text-ink-3">{o.hint}</span> : null}
          </span>
        </label>
      ))}
    </div>
  );
}

export function CheckRow({ label, checked, onChange, hint, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('flex items-start gap-2 text-[12.5px] text-ink', disabled && 'opacity-60')}>
      <Checkbox checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        {label}
        {hint ? <span className="block text-[11.5px] text-ink-3">{hint}</span> : null}
      </span>
    </label>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
      {label}
      {children}
      {hint ? <span className="text-[11.5px] font-normal text-ink-3">{hint}</span> : null}
    </label>
  );
}

export const inputCls = 'h-8 w-full rounded-[8px] border border-line bg-surface px-2.5 text-[12.5px] font-normal text-ink outline-none focus:border-primary disabled:opacity-60';

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}

export function Pick<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T; options: Array<{ id: T; label: string }>; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)} className={inputCls}>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function ProBadge({ note }: { note?: string }) {
  return (
    <span title={note ? `PDF Studio Pro · ${note}` : 'PDF Studio Pro'} className="inline-flex items-center rounded-[5px] bg-[#EEF2FF] px-1.5 py-[1px] text-[10px] font-bold tracking-[.3px] text-[#4338CA] uppercase dark:bg-selection dark:text-primary">
      Pro
    </span>
  );
}

export function StatusChip({ tool }: { tool: PdfTool }) {
  return <Chip tone={tool.status === 'ready' ? 'success' : tool.status === 'partial' ? 'indigo' : 'muted'}>{STATUS_LABEL[tool.status]}</Chip>;
}

/** The tool's main button, off with the reason until the work behind it exists. */
export function RunBar({ tool, label, onRun, ready, why, secondary }: { tool: PdfTool; label: string; onRun?: () => void; ready?: boolean; why?: string | null; secondary?: ReactNode }) {
  const gate = why ?? (ready ? null : toolGate(tool));
  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-line bg-surface px-3.5 py-3">
      {gate ? (
        <p className="flex items-start gap-1.5 text-[11.5px] leading-[1.45] text-ink-3">
          <Icon name="info" size={13} className="mt-[1px] shrink-0" />
          <span>{gate}</span>
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        {secondary}
        <Button variant="primary" disabled={!!gate} aria-disabled={!!gate || undefined} title={gate ?? label} onClick={gate ? undefined : onRun}>
          {label}
        </Button>
      </div>
    </div>
  );
}

/** What is still to build for a tool — the in-app half of docs/PDF_STUDIO_GAP_PLAN.md. */
export function GapList({ tool, open: startOpen = false }: { tool: PdfTool; open?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <div className="rounded-[10px] border border-dashed border-line bg-ground px-3 py-2 text-[12px]">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-1.5 text-left font-semibold text-ink-2">
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} />
        <span className="flex-1">
          {tool.t} · {tool.phase} · {tool.missing.length} item{tool.missing.length === 1 ? '' : 's'} to build
        </span>
        <StatusChip tool={tool} />
      </button>
      {open ? (
        <div className="mt-1.5 flex flex-col gap-1 text-ink-2">
          {tool.works ? (
            <p className="flex items-start gap-1.5 text-success">
              <Icon name="check" size={13} className="mt-[1px] shrink-0" /> {tool.works}
            </p>
          ) : null}
          <ul className="flex list-disc flex-col gap-0.5 ps-5">
            {tool.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <p className="text-[11px] text-ink-3">
            Needs {tool.permission} · lock: {tool.lock} · output: {tool.output} · runs on {tool.runs === 'both' ? 'this computer or the server' : tool.runs === 'desktop' ? 'this computer' : 'the server'} · screens {tool.screens.join(', ')}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** A page-wide notice that a whole screen waits on the server. */
export function Pending({ icon = 'server', title, children, action }: { icon?: string; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-[12px] border border-dashed border-line bg-surface px-4 py-4">
      <span className="flex items-center gap-2 text-[13.5px] font-bold text-ink">
        <Icon name={icon} size={16} className="text-ink-3" /> {title}
      </span>
      <div className="text-[12.5px] leading-[1.5] text-ink-2">{children}</div>
      {action}
    </div>
  );
}

/** Password strength for the Protect panel: length and character classes, no dictionary (never leaves the window). */
export function strength(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!pw) return { score: 0, label: '' };
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  const score = Math.min(4, s) as 0 | 1 | 2 | 3 | 4;
  return { score, label: ['Too short', 'Weak', 'Fair', 'Good', 'Strong'][score]! };
}

/** Bates numbers as they will be stamped (PRO-BAT-001): prefix, zero-padded number, suffix. */
export function batesNumber(prefix: string, start: number, digits: number, suffix: string, n: number): string {
  const num = String(Math.max(0, Math.floor(start)) + n).padStart(Math.min(12, Math.max(1, digits)), '0');
  return `${prefix}${num}${suffix}`;
}
