import { useState, type ReactNode } from 'react';
import { ApiError } from '../../core/api';
import { Icon } from '../../components/Icon';
import { Button, Chip, cx, Empty, ErrorNote, Spinner } from '../../components/ui';
import { isNotOffered, NOT_OFFERED, type Optional } from './api';
import { callerInitials, directionIcon, isMissed } from './lib/format';

/**
 * The Phone's small shared pieces (design "WorkSuite Phone (VoIP) — Modern UI"): numbers and timers in the mono face,
 * the dark call stage, honest states (no PBX, not offered by this server, not measured), KPI tiles.
 */

/** Numbers and timers (DM Mono in the design; the app's mono face here). */
export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('font-mono tabular-nums', className)}>{children}</span>;
}

export function PageHeader({ title, sub, actions, back }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <header className="flex min-h-[56px] shrink-0 flex-wrap items-center gap-3 border-b border-line bg-surface px-6 py-2.5">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {back}
        <h1 className="truncate text-[17px] font-bold text-ink">{title}</h1>
        {sub ? <span className="truncate text-[12.5px] text-ink-3">{sub}</span> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** Scroll area under a page header. */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('min-h-0 flex-1 overflow-y-auto bg-ground p-5 scroll-thin', className)}>{children}</div>;
}

export function Panel({ title, sub, action, children, className, bodyClassName }: { title?: ReactNode; sub?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cx('flex min-h-0 flex-col rounded-[12px] border border-line bg-surface', className)}>
      {title !== undefined ? (
        <header className="flex items-start justify-between gap-2 px-4 pt-3.5 pb-2">
          <div className="min-w-0">
            <h2 className="text-[14px] font-bold text-ink">{title}</h2>
            {sub ? <p className="mt-0.5 text-[12px] text-ink-3">{sub}</p> : null}
          </div>
          {action}
        </header>
      ) : null}
      <div className={cx('min-h-0 flex-1 px-4 pb-4', bodyClassName)}>{children}</div>
    </section>
  );
}

/** A KPI tile (A01, A10, W01 "My day"). `value` null is "not measured", never a zero. */
export function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode | null; sub?: ReactNode; tone?: 'danger' | 'warning' | 'success' | 'primary' }) {
  const colour = tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : tone === 'success' ? 'text-success' : tone === 'primary' ? 'text-primary' : 'text-ink';
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[12px] border border-line bg-surface px-4 py-3">
      <span className="text-[11.5px] font-semibold text-ink-3">{label}</span>
      {value === null ? <span className="text-[13px] font-semibold text-ink-3">Not measured</span> : <span className={cx('font-mono text-[22px] font-bold tabular-nums', colour)}>{value}</span>}
      {sub ? <span className="truncate text-[11.5px] text-ink-3">{sub}</span> : null}
    </div>
  );
}

/** Honest state: this WorkSuite server has no such endpoint yet (NFR-10). */
export function NotOffered({ what, detail }: { what: string; detail?: ReactNode }) {
  return (
    <Empty
      icon="server"
      title={`${what} isn’t offered by this WorkSuite server yet`}
      hint={
        <>
          {NOT_OFFERED}
          {detail ? <span className="mt-1 block">{detail}</span> : null}
        </>
      }
    />
  );
}

/** Loading, refused, missing, or the content: the one switch every optional screen goes through. */
export function OptionalView<T>({ q, what, children, empty }: { q: { data?: Optional<T>; isLoading: boolean; error: unknown; refetch: () => unknown }; what: string; children: (data: T) => ReactNode; empty?: ReactNode }) {
  if (q.isLoading) return <Spinner />;
  if (q.error) return <Refused error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return empty ?? null;
  if (!q.data.offered) return <NotOffered what={what} />;
  return <>{children(q.data.data)}</>;
}

/** A refusal said plainly: no permission, not offered, or the server's own words. */
export function Refused({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (error instanceof ApiError && error.forbidden) {
    return <Empty icon="lock" title="You don’t have permission for this" hint={error.message} />;
  }
  if (isNotOffered(error)) return <NotOffered what="This" />;
  return (
    <div className="p-4">
      <ErrorNote error={error} onRetry={onRetry} />
    </div>
  );
}

/** "No PBX is reachable" (VOIP-SP-05, AC-10): the directory still works, nothing can be dialled. */
export function PbxBanner({ message, className }: { message?: string | null; className?: string }) {
  return (
    <div role="status" className={cx('flex items-start gap-2.5 rounded-[10px] border border-warning/30 bg-warning-bg px-3.5 py-2.5 text-[12.5px] text-warning-ink dark:text-warning', className)}>
      <Icon name="warning" size={16} className="mt-px shrink-0" />
      <span>{message || 'No PBX is reachable. Extensions and history still work, but calls can’t be placed until the switch is back.'}</span>
    </div>
  );
}

/** A note band for "pending apply" and similar (W07, A09). */
export function Notice({ tone = 'primary', icon = 'info', children, action }: { tone?: 'primary' | 'warning' | 'success' | 'danger'; icon?: string; children: ReactNode; action?: ReactNode }) {
  const tones = {
    primary: 'border-primary/25 bg-selection text-ink',
    warning: 'border-warning/30 bg-warning-bg text-warning-ink dark:text-warning',
    success: 'border-success/30 bg-success-bg text-ink',
    danger: 'border-danger/30 bg-danger-bg text-danger',
  } as const;
  return (
    <div className={cx('flex items-center gap-2.5 rounded-[10px] border px-3.5 py-2.5 text-[12.5px]', tones[tone])}>
      <Icon name={icon} size={16} className="shrink-0" />
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}

/** The call direction arrow; missed calls in red (W01, W04). */
export function DirectionGlyph({ direction, disposition, size = 16 }: { direction: string | null; disposition?: string | null; size?: number }) {
  const missed = direction === 'inbound' && isMissed(disposition);
  const tone = missed ? 'bg-danger-bg text-danger' : direction === 'outbound' ? 'bg-selection text-primary' : direction === 'inbound' ? 'bg-success-bg text-success' : 'bg-subtle text-ink-2';
  return (
    <span className={cx('inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full', tone)} aria-label={missed ? 'Missed' : direction ?? 'Call'} role="img">
      <Icon name={missed ? 'phone-missed' : directionIcon(direction)} size={size - 2} />
    </span>
  );
}

/** The caller's initials on the stage's deep blue (W02, W03, D01). */
export function CallerBadge({ name, size = 56, className }: { name: string | null | undefined; size?: number; className?: string }) {
  return (
    <span className={cx('inline-flex shrink-0 items-center justify-center rounded-full bg-[#1E3A8A] font-bold text-white', className)} style={{ width: size, height: size, fontSize: Math.max(11, size * 0.34) }} aria-hidden>
      {callerInitials(name)}
    </span>
  );
}

/** A row of filter pills (W01 "All · Missed · Voicemail", A02 filters). */
export function Pills<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: Array<{ id: T; label: ReactNode }>; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cx('h-7 rounded-full border px-3 text-[12px] font-semibold transition-colors', value === o.id ? 'border-transparent bg-ink text-surface' : 'border-line bg-surface text-ink-2 hover:bg-subtle')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Tabs along a settings page (A12). */
export function Tabs<T extends string>({ value, onChange, tabs, label }: { value: T; onChange: (v: T) => void; tabs: Array<{ id: T; label: string }>; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1.5">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx('h-8 rounded-full px-3.5 text-[12.5px] font-semibold', value === t.id ? 'bg-ink text-surface' : 'border border-line bg-surface text-ink-2 hover:bg-subtle')}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** A server's/trunk's status chip. */
export function StatusChip({ status }: { status: string | null | undefined }) {
  const s = (status ?? 'unknown').toLowerCase();
  const tone = s === 'online' || s === 'registered' || s === 'ok' || s === 'ready' || s === 'live' ? 'success' : s === 'degraded' || s === 'partial' || s === 'maintenance' || s === 'pending' || s === 'pin_required' || s === 'running' ? 'warning' : s === 'offline' || s === 'unreachable' || s === 'failed' || s === 'error' || s === 'no_signal' || s === 'broken' ? 'danger' : 'muted';
  const label = s.replace(/_/g, ' ');
  return <Chip tone={tone}>{label.charAt(0).toUpperCase() + label.slice(1)}</Chip>;
}

/** Labelled field row for editors (A02 drawer, A05). */
export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-[12px] font-semibold text-ink-2">{label}</span>
      {children}
      {hint ? <span className="text-[11.5px] text-ink-3">{hint}</span> : null}
    </label>
  );
}

export const INPUT = 'h-9 w-full min-w-0 rounded-[8px] border border-line bg-surface px-3 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-primary disabled:opacity-60';
export const TEXTAREA = 'w-full min-w-0 rounded-[8px] border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-primary';

/** A native select styled like the inputs; small lists in editors. */
export function NativeSelect({ value, onChange, children, label, className, disabled }: { value: string; onChange: (v: string) => void; children: ReactNode; label: string; className?: string; disabled?: boolean }) {
  return (
    <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={cx(INPUT, 'pr-8', className)}>
      {children}
    </select>
  );
}

/** A table that scrolls sideways on a narrow window. */
export function Table({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={cx('min-w-0 overflow-x-auto scroll-thin', className)}>
      <table className="w-full border-collapse text-left text-[12.5px]">
        <thead>
          <tr className="border-b border-line text-[11px] font-bold tracking-[.3px] text-ink-3 uppercase">
            {head.map((h, i) => (
              <th key={i} scope="col" className="px-3 py-2 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export const TD = 'px-3 py-2 align-middle';
export const TR = 'border-b border-line/70 last:border-b-0 hover:bg-subtle/60';

/** A destructive action that asks once: the button turns into "Confirm". */
export function ConfirmButton({ label, confirm, onConfirm, variant = 'danger', icon, loading, size = 'md' }: { label: string; confirm: string; onConfirm: () => void; variant?: 'danger' | 'secondary'; icon?: string; loading?: boolean; size?: 'sm' | 'md' }) {
  const [armed, setArmed] = useState(false);
  return armed ? (
    <span className="inline-flex items-center gap-1.5">
      <Button
        size={size}
        variant="danger"
        icon={icon}
        loading={loading}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {confirm}
      </Button>
      <Button size={size} variant="ghost" onClick={() => setArmed(false)}>
        Cancel
      </Button>
    </span>
  ) : (
    <Button size={size} variant={variant} icon={icon} loading={loading} onClick={() => setArmed(true)}>
      {label}
    </Button>
  );
}

/** Copy a value with feedback (A03). */
export function CopyField({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  return (
    <Field label={label}>
      <span className="flex items-center gap-2">
        <input readOnly value={value} aria-label={label} className={cx(INPUT, 'font-mono', secret && 'tracking-wide')} onFocus={(e) => e.currentTarget.select()} />
        <Button
          size="md"
          icon="copy"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(
              () => undefined,
              () => undefined,
            );
          }}
        >
          Copy
        </Button>
      </span>
    </Field>
  );
}
