import { Component, useEffect, useRef, type ButtonHTMLAttributes, type ErrorInfo, type InputHTMLAttributes, type ReactNode } from 'react';
import { Icon } from './Icon';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'teal';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-hover border border-transparent',
  secondary: 'bg-surface text-ink border border-line hover:bg-subtle',
  ghost: 'bg-transparent text-ink-2 hover:bg-subtle border border-transparent',
  danger: 'bg-danger text-white hover:opacity-90 border border-transparent',
  success: 'bg-success text-white hover:opacity-90 border border-transparent',
  teal: 'bg-teal text-white hover:opacity-90 border border-transparent',
};

export function Button({ variant = 'secondary', size = 'md', icon, loading, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: string; loading?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-[8px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
        size === 'sm' ? 'h-7 px-2.5 text-[12px]' : size === 'lg' ? 'h-11 px-5 text-[14px]' : 'h-8 px-3 text-[13px]',
        VARIANTS[variant],
        className,
      )}
    >
      {loading ? <Icon name="spinner" size={15} className="animate-spin-slow" /> : icon ? <Icon name={icon} size={15} /> : null}
      {children}
    </button>
  );
}

export function IconButton({ icon, label, className, active, badge, size = 18, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string; active?: boolean; badge?: number; size?: number }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cx('relative inline-flex h-8 w-8 items-center justify-center rounded-[8px] transition-colors disabled:opacity-40', active ? 'bg-selection text-primary' : 'text-ink-2 hover:bg-subtle hover:text-ink', className)}
    >
      <Icon name={icon} size={size} />
      {badge ? <CountBadge n={badge} className="absolute -top-1 -right-1" /> : null}
    </button>
  );
}

export function CountBadge({ n, tone = 'badge', className }: { n: number; tone?: 'badge' | 'indigo' | 'amber' | 'muted'; className?: string }) {
  if (!n) return null;
  const tones = {
    badge: 'bg-badge text-white',
    indigo: 'bg-primary text-white',
    amber: 'bg-warning-bg text-warning',
    muted: 'bg-subtle text-ink-2',
  };
  return <span className={cx('inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular', tones[tone], className)}>{n > 99 ? '99+' : n}</span>;
}

export function Chip({ children, tone = 'muted', className }: { children: ReactNode; tone?: 'muted' | 'indigo' | 'success' | 'warning' | 'danger' | 'teal'; className?: string }) {
  const tones = {
    muted: 'bg-subtle text-ink-2',
    indigo: 'bg-selection text-primary',
    success: 'bg-success-bg text-success',
    warning: 'bg-warning-bg text-warning',
    danger: 'bg-danger-bg text-danger',
    teal: 'bg-teal/10 text-teal',
  };
  return <span className={cx('inline-flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[11.5px] font-semibold', tones[tone], className)}>{children}</span>;
}

const AVATAR_TONES = ['bg-[#E6F4F1] text-[#0E7C86]', 'bg-[#EEF1FD] text-[#23349E]', 'bg-[#FDF1E3] text-[#B45309]', 'bg-[#F3E8FF] text-[#6B21A8]', 'bg-[#FDECEA] text-[#B42318]', 'bg-[#E7F4ED] text-[#1F7A4D]'];

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase();
}

export function Avatar({ name, size = 32, className, presence }: { name: string | null | undefined; size?: number; className?: string; presence?: 'online' | 'away' | 'offline' | null }) {
  const n = name ?? '?';
  let h = 0;
  for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span className={cx('relative inline-flex shrink-0 items-center justify-center rounded-full font-bold', AVATAR_TONES[h % AVATAR_TONES.length], className)} style={{ width: size, height: size, fontSize: Math.max(10, size * 0.36) }} aria-hidden>
      {initials(n)}
      {presence ? (
        <span className={cx('absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface', presence === 'online' ? 'bg-success' : presence === 'away' ? 'bg-warning' : 'bg-ink-3')} />
      ) : null}
    </span>
  );
}

export function Spinner({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div className={cx('flex items-center justify-center gap-2 p-6 text-ink-3', className)} role="status">
      <Icon name="spinner" size={18} className="animate-spin-slow" />
      <span className="text-[12.5px]">{label}</span>
    </div>
  );
}

export function Empty({ icon = 'inbox', title, hint, action }: { icon?: string; title: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-2 p-8 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-subtle text-ink-3">
        <Icon name={icon} size={20} />
      </span>
      <div className="text-[14px] font-semibold text-ink">{title}</div>
      {hint ? <div className="max-w-sm text-[12.5px] text-ink-3">{hint}</div> : null}
      {action}
    </div>
  );
}

export function Card({ title, action, children, className, bodyClassName }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cx('flex min-h-0 flex-col rounded-[12px] border border-line bg-surface', className)}>
      {title !== undefined ? (
        <header className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-2">
          <h2 className="text-[15px] font-bold text-ink">{title}</h2>
          {action}
        </header>
      ) : null}
      <div className={cx('min-h-0 flex-1 px-4 pb-4', bodyClassName)}>{children}</div>
    </section>
  );
}

export function TextField({ label, hint, error, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string; error?: string | null }) {
  return (
    <label className={cx('flex flex-col gap-1', className)}>
      {label ? <span className="text-[12.5px] font-semibold text-ink-2">{label}</span> : null}
      <input
        {...rest}
        className={cx(
          'h-9 rounded-[8px] border bg-surface px-3 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-primary',
          error ? 'border-danger' : 'border-line',
        )}
      />
      {error ? <span className="text-[12px] text-danger">{error}</span> : hint ? <span className="text-[12px] text-ink-3">{hint}</span> : null}
    </label>
  );
}

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50', checked ? 'bg-primary' : 'bg-line')}
    >
      <span className={cx('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
    </button>
  );
}

export function Select<T extends string | number>({ value, onChange, options, disabled, label }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }>; disabled?: boolean; label: string }) {
  return (
    <select
      aria-label={label}
      disabled={disabled}
      value={String(value)}
      onChange={(e) => {
        const o = options.find((x) => String(x.value) === e.target.value);
        if (o) onChange(o.value);
      }}
      className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[13px] text-ink outline-none focus:border-primary disabled:opacity-50"
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-[5px] border border-white/15 bg-white/5 px-1.5 py-0.5 font-mono text-[11px] font-medium">{children}</kbd>;
}

export function Modal({ title, children, onClose, width = 520, footer, labelledBy }: { title?: ReactNode; children: ReactNode; onClose?: () => void; width?: number; footer?: ReactNode; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1020]/50 p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={labelledBy} className="animate-in bare-focus flex max-h-full w-full flex-col rounded-[14px] border border-line bg-surface shadow-2xl outline-none" style={{ maxWidth: width }}>
        {title ? (
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 id={labelledBy} className="text-[16px] font-bold text-ink">
              {title}
            </h2>
            {onClose ? <IconButton icon="x" label="Close" onClick={onClose} /> : null}
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4 scroll-thin">{children}</div>
        {footer ? <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

/** Contains a module failure to its tab (FR-REG-03): Retry and Diagnostics, shell unaffected. */
export class ModuleBoundary extends Component<{ children: ReactNode; name: string; onDiagnostics: () => void; resetKey?: unknown }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[module:${this.props.name}]`, error, info.componentStack);
  }
  override componentDidUpdate(prev: { resetKey?: unknown }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <Empty
        icon="alert"
        title={`${this.props.name} failed to load`}
        hint="The rest of WorkSuite is still running. Try again, or open Diagnostics to see what happened."
        action={
          <div className="mt-2 flex gap-2">
            <Button variant="primary" icon="refresh" onClick={() => this.setState({ error: null })}>
              Retry
            </Button>
            <Button icon="stethoscope" onClick={this.props.onDiagnostics}>
              Open Diagnostics
            </Button>
          </div>
        }
      />
    );
  }
}

export function OfflineNote({ cachedAt }: { cachedAt: string | null }) {
  if (!cachedAt) return null;
  const when = new Date(cachedAt).toLocaleString([], { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' });
  return (
    <div className="flex items-center gap-1.5 rounded-[8px] bg-warning-bg px-2.5 py-1 text-[12px] font-semibold text-warning">
      <Icon name="cloud-off" size={14} /> Offline results — saved {when}
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex items-center gap-2 rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger">
      <Icon name="alert" size={15} />
      <span className="flex-1">{msg}</span>
      {onRetry ? (
        <button type="button" className="font-semibold underline" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function FileBadge({ name, size = 36 }: { name: string; size?: number }) {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  const map: Record<string, [string, string]> = {
    pdf: ['PDF', 'bg-danger-bg text-danger'],
    doc: ['DOC', 'bg-selection text-primary'],
    docx: ['DOC', 'bg-selection text-primary'],
    xls: ['XLS', 'bg-success-bg text-success'],
    xlsx: ['XLS', 'bg-success-bg text-success'],
    csv: ['CSV', 'bg-success-bg text-success'],
    ppt: ['PPT', 'bg-warning-bg text-warning'],
    pptx: ['PPT', 'bg-warning-bg text-warning'],
    png: ['IMG', 'bg-[#F3E8FF] text-[#6B21A8]'],
    jpg: ['IMG', 'bg-[#F3E8FF] text-[#6B21A8]'],
    jpeg: ['IMG', 'bg-[#F3E8FF] text-[#6B21A8]'],
    zip: ['ZIP', 'bg-subtle text-ink-2'],
  };
  const [label, tone] = map[ext] ?? [ext.slice(0, 3).toUpperCase() || 'FILE', 'bg-subtle text-ink-2'];
  return (
    <span className={cx('inline-flex shrink-0 items-center justify-center rounded-[8px] font-mono text-[10.5px] font-semibold', tone)} style={{ width: size, height: size }}>
      {label}
    </span>
  );
}
