import { Component, useEffect, useRef, useState, type ButtonHTMLAttributes, type ErrorInfo, type InputHTMLAttributes, type ReactNode } from 'react';
import { Icon } from './Icon';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'teal' | 'accent' | 'glass';
type Size = 'sm' | 'md' | 'lg' | 'action' | 'action-lg' | 'action-icon';

/** A focus ring drawn outside the glow and the glass edge, in either theme. */
const RING = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ws-focus)]';
/** Hover lifts by a pixel and a press settles back; neither moves when reduced motion is asked for. */
const LIFT = 'motion-safe:transition-[transform,filter,box-shadow,background-color,border-color,color] motion-safe:duration-150 motion-safe:enabled:hover:-translate-y-px motion-safe:enabled:active:translate-y-0 motion-safe:enabled:active:scale-[.98]';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-hover border border-transparent',
  secondary: 'bg-surface text-ink border border-line hover:bg-subtle',
  ghost: 'bg-transparent text-ink-2 hover:bg-subtle border border-transparent',
  danger: 'bg-danger text-white hover:opacity-90 border border-transparent',
  success: 'bg-success text-white hover:opacity-90 border border-transparent',
  teal: 'bg-teal text-white hover:opacity-90 border border-transparent',
  /**
   * The one main action of a panel: a soft top-to-bottom brand gradient with white text, a thin top
   * highlight and a coloured glow. Brand keeps white text at AA in light and every dark profile.
   */
  accent: cx(
    'border border-transparent text-white bg-[linear-gradient(to_bottom,var(--color-brand),color-mix(in_srgb,var(--color-brand)_84%,black))]',
    'shadow-[inset_0_1px_0_rgb(255_255_255/.2),0_6px_16px_-6px_color-mix(in_srgb,var(--color-brand)_70%,transparent)]',
    'enabled:hover:brightness-[1.05] enabled:hover:shadow-[inset_0_1px_0_rgb(255_255_255/.26),0_10px_22px_-8px_color-mix(in_srgb,var(--color-brand)_80%,transparent)] enabled:active:brightness-100',
    RING,
    LIFT,
  ),
  /** A quieter action beside an accent one: translucent glass with a soft edge; the icon takes the accent on hover. */
  glass: cx(
    'group border border-glass-line bg-glass text-ink-2 enabled:hover:border-primary/45 enabled:hover:bg-glass-hover enabled:hover:text-ink enabled:hover:[&>svg]:text-primary',
    RING,
    LIFT,
  ),
};

const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[12px] rounded-[8px]',
  md: 'h-8 px-3 text-[13px] rounded-[8px]',
  lg: 'h-11 px-5 text-[14px] rounded-[8px]',
  /** 40px, 12px round: a secondary action in a panel footer. */
  action: 'h-10 px-2.5 text-[12px] rounded-[12px]',
  /** 44px, 12px round: the main action in a panel footer. */
  'action-lg': 'h-11 px-4 text-[13.5px] rounded-[12px]',
  /** A 44px square beside an `action-lg` button. */
  'action-icon': 'h-11 w-11 shrink-0 px-0 rounded-[12px]',
};

export function Button({ variant = 'secondary', size = 'md', icon, loading, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; icon?: string; loading?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        'ws-localized-control inline-flex items-center justify-center gap-1.5 font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
        SIZES[size],
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

/**
 * Text in a colour that comes with the data (an app, a calendar, a person's
 * name colour), readable in both themes: set `--c` in the style; on dark it
 * is mixed towards white, since a deep indigo cannot be read on the dark ground.
 */
export const DATA_TEXT = 'text-[color:var(--c)] dark:text-[color:color-mix(in_srgb,var(--c)_45%,white)]';

const AVATAR_TONES = [
  'bg-[#E6F4F1] text-[#0E7C86] dark:bg-[#10343A] dark:text-[#7FD8DF]',
  'bg-[#EEF1FD] text-[#23349E] dark:bg-[#1C2A5E] dark:text-[#AFC0FF]',
  'bg-[#FDF1E3] text-[#B45309] dark:bg-[#3A2810] dark:text-[#F5C27A]',
  'bg-[#F3E8FF] text-[#6B21A8] dark:bg-[#2E1D4A] dark:text-[#D2B4FE]',
  'bg-[#FDECEA] text-[#B42318] dark:bg-[#3A1614] dark:text-[#F7A39B]',
  'bg-[#E7F4ED] text-[#1F7A4D] dark:bg-[#12301F] dark:text-[#86D8AE]',
];

/** The avatar colour that always goes with the same key (a name, a number): for an avatar drawn without initials. */
export function avatarTone(key: string | null | undefined): string {
  let h = 0;
  for (const ch of key ?? '?') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length]!;
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase();
}

/**
 * Somebody's avatar: their picture when there is one (`src`), else their initials on a colour that is always the same
 * for the same name. The initials sit under the picture, so they show while it loads and again if it fails.
 */
export function Avatar({ name, size = 32, className, presence, src }: { name: string | null | undefined; size?: number; className?: string; presence?: 'online' | 'away' | 'offline' | null; src?: string | null }) {
  const n = name ?? '?';
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span className={cx('relative inline-flex shrink-0 items-center justify-center rounded-full font-bold', avatarTone(n), className)} style={{ width: size, height: size, fontSize: Math.max(10, size * 0.36) }} aria-hidden>
      {initials(n)}
      {src && failed !== src ? <img src={src} alt="" draggable={false} decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(src)} className="absolute inset-0 h-full w-full rounded-[inherit] object-cover" /> : null}
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

/**
 * A labelled text input. `error`: the message under it, or `true` to mark it invalid while the message is shown
 * elsewhere (a narrow field in a settings row, whose message sits under the row's own words).
 */
export function TextField({ label, hint, error, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string; error?: string | boolean | null }) {
  return (
    <label className={cx('flex flex-col gap-1', className)}>
      {label ? <span className="text-[12.5px] font-semibold text-ink-2">{label}</span> : null}
      <input
        aria-invalid={error ? true : undefined}
        {...rest}
        className={cx(
          'h-9 rounded-[8px] border bg-surface px-3 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-primary',
          error ? 'border-danger' : 'border-line',
        )}
      />
      {typeof error === 'string' && error ? <span className="text-[12px] text-danger">{error}</span> : hint ? <span className="text-[12px] text-ink-3">{hint}</span> : null}
    </label>
  );
}

const NUMBER_SIZES = { md: 'h-10 text-[14px]', sm: 'h-9 text-[13px]' } as const;

/** Decimal places in a number as written, so stepping 0.1 + 0.2 shows 0.3. */
function places(n: number): number {
  const s = String(n);
  return s.includes('.') ? s.split('.')[1]!.length : 0;
}

/**
 * A number typed in a settings row, without a label above it (#232): the row's own words name it, `aria-label` reads
 * it out. Right-aligned tabular figures, an optional muted unit inside the field ("min"), and ↑/↓ that step the value
 * within `min`–`max`. The text is the caller's (a half-typed value is kept as typed); `invalid` draws the red outline,
 * and the caller says why next to the row's words. `md` is 40px tall, as a settings row's Save button; `sm` 36px.
 */
export function NumberField({
  value,
  onValueChange,
  min,
  max,
  step = 1,
  unit,
  invalid,
  size = 'md',
  width = 112,
  className,
  onKeyDown,
  inputMode,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'min' | 'max' | 'step' | 'size' | 'width'> & {
  value: string;
  onValueChange: (v: string) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  invalid?: boolean;
  size?: keyof typeof NUMBER_SIZES;
  width?: number;
}) {
  const n = value.trim() === '' ? NaN : Number(value);
  const nudge = (dir: 1 | -1) => {
    const base = Number.isFinite(n) ? n : (min ?? 0) - dir * step;
    let next = Number((base + dir * step).toFixed(Math.max(places(step), places(base))));
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    onValueChange(String(next));
  };
  return (
    <span className={cx('relative inline-flex shrink-0', NUMBER_SIZES[size], className)} style={{ width }}>
      <input
        type="text"
        role="spinbutton"
        inputMode={inputMode ?? (Number.isInteger(step) ? 'numeric' : 'decimal')}
        autoComplete="off"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number.isFinite(n) ? n : undefined}
        aria-invalid={invalid ? true : undefined}
        {...rest}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (e.defaultPrevented || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
          e.preventDefault();
          nudge(e.key === 'ArrowUp' ? 1 : -1);
        }}
        className={cx(
          'h-full w-full min-w-0 rounded-[8px] border bg-surface pl-2.5 text-right text-ink tabular-nums outline-none transition-colors placeholder:text-ink-3 disabled:opacity-60',
          unit ? 'pr-9' : 'pr-2.5',
          invalid ? 'border-danger focus:border-danger' : 'border-line focus:border-primary',
        )}
      />
      {unit ? (
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-ink-3">
          {unit}
        </span>
      ) : null}
    </span>
  );
}

/** `describedBy`: the id of the line that says what the switch does, read out with its name. */
export function Switch({ checked, onChange, disabled, label, id, describedBy }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; id?: string; describedBy?: string }) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50', checked ? 'bg-primary' : 'bg-line')}
    >
      <span className={cx('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
    </button>
  );
}


const KBD: Record<'chrome' | 'key' | 'accent', string> = {
  /** On the navy window chrome. */
  chrome: 'rounded-[5px] border border-white/15 bg-white/5 px-1.5 py-0.5 font-mono text-[11px] font-medium',
  /** A key cap on a surface or a glass button. */
  key: 'inline-flex h-5 min-w-[18px] items-center justify-center rounded-[5px] border border-b-2 border-line bg-surface px-[5px] font-sans text-[10.5px] font-semibold text-ink-3',
  /** Inside an accent button: translucent white glass that blends into the gradient. */
  accent: 'inline-flex h-5 min-w-[18px] items-center justify-center rounded-[5px] border border-white/25 bg-white/10 px-[5px] font-sans text-[10.5px] font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/.18)]',
};

/** A keyboard shortcut chip. Inside a button, pass `aria-hidden` and name the keys with `aria-keyshortcuts` on the button. */
export function Kbd({ children, tone = 'chrome', className, ...rest }: { children: ReactNode; tone?: keyof typeof KBD; className?: string; 'aria-hidden'?: boolean }) {
  return (
    <kbd {...rest} className={cx(KBD[tone], className)}>
      {children}
    </kbd>
  );
}

export function Modal({ title, children, onClose, width = 520, footer, labelledBy }: { title?: ReactNode; children: ReactNode; onClose?: () => void; width?: number; footer?: ReactNode; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // What had focus before the dialog, read while rendering — by the time an
  // effect runs, a field inside with autoFocus already has it.
  const [prev] = useState(() => document.activeElement as HTMLElement | null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  // Once, on opening. It used to run again whenever `onClose` was a new
  // function — every render of the screen behind — and each run pulled focus
  // off the field being typed in, so Enter reached the dialog, not the field.
  useEffect(() => {
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && close.current) {
        e.stopPropagation();
        close.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (prev?.isConnected) prev.focus?.();
    };
  }, [prev]);
  return (
    <div className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-[#0B1020]/50 p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
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
    png: ['IMG', 'bg-[#F3E8FF] text-[#6B21A8] dark:bg-[#2E1D4A] dark:text-[#D2B4FE]'],
    jpg: ['IMG', 'bg-[#F3E8FF] text-[#6B21A8] dark:bg-[#2E1D4A] dark:text-[#D2B4FE]'],
    jpeg: ['IMG', 'bg-[#F3E8FF] text-[#6B21A8] dark:bg-[#2E1D4A] dark:text-[#D2B4FE]'],
    zip: ['ZIP', 'bg-subtle text-ink-2'],
  };
  const [label, tone] = map[ext] ?? [ext.slice(0, 3).toUpperCase() || 'FILE', 'bg-subtle text-ink-2'];
  return (
    <span className={cx('inline-flex shrink-0 items-center justify-center rounded-[8px] font-mono text-[10.5px] font-semibold', tone)} style={{ width: size, height: size }}>
      {label}
    </span>
  );
}
