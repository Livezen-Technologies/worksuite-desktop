import type { ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { topBarPaddingRight } from '../../core/window-chrome';
import { StatCard, type StatTone } from '../../components/StatCard';

/**
 * The HR designs' shared pieces: the status chip (one colour per meaning,
 * matched on the words the server uses), KPI cards, panels, the segmented
 * control, page headings, table headings and the form controls.
 */
const TONES: Array<[RegExp, string]> = [
  // Neutral first: "Non-working day" must not read as "working".
  [/^(non-working|off\b|n\/a|not yet|not scored|nothing to measure)/, 'bg-subtle text-ink-2'],
  [/^(active|approved|present|complete|completed|accepted|done|verified|live|in force|good|outstanding|strong|saved|sent|returned ok|signed off|cover accepted|on time|paid|submitted ok)/, 'bg-[#E4F4EA] text-[#145C39] dark:bg-success-bg dark:text-success'],
  [/(pending|probation|notice|late|waiting|awaiting|draft|review|early|half|needs|missing|no check|on break|fair|attention|cover pending|changes|being corrected|resubmission|submitted)/, 'bg-[#FFF4E0] text-[#9A4A06] dark:bg-warning-bg dark:text-warning'],
  [/(reject|declin|terminated|absent|suspended|expired|critical|poor|damaged|overdue|cover declined|holds pay|insecure|no key|refused|failed)/, 'bg-[#FCE9E4] text-[#8C2A14] dark:bg-danger-bg dark:text-danger'],
  [/(working|in progress|approve$|meets|open)/, 'bg-selection text-primary'],
  [/(on leave|leave|remote|work from home|contract|intern|holiday|off)/, 'bg-[#F1EAFB] text-[#5B2FA0] dark:bg-[#2A1F45] dark:text-[#C4A8F0]'],
  [/(permanent|onsite)/, 'bg-[#E3F4F5] text-[#0B6770] dark:bg-[#10343A] dark:text-[#7FD8DF]'],
];

export function toneOf(text: string): string {
  const k = text.toLowerCase();
  for (const [re, tone] of TONES) if (re.test(k)) return tone;
  return 'bg-subtle text-ink-2';
}

export function StatusChip({ children, className }: { children: ReactNode; className?: string }) {
  const text = typeof children === 'string' ? children : '';
  return <span className={cx('inline-flex h-5 shrink-0 items-center rounded-[10px] px-2 text-[11.5px] font-bold whitespace-nowrap', toneOf(text), className)}>{children}</span>;
}

/** "pending" → "Pending", "needs_resubmission" → "Needs resubmission". */
export function humanise(v: string | null | undefined): string {
  if (!v) return '';
  const s = v.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A figure tile, drawn as the shared StatCard. `tone` colours its icon chip. */
export function Kpi({ label, value, sub, tone, icon, onClick, className }: { label: string; value: ReactNode; sub?: ReactNode; tone?: StatTone; icon?: string; onClick?: () => void; className?: string }) {
  return <StatCard label={label} value={value} sub={sub} tone={tone} icon={icon} onClick={onClick} className={className} />;
}

export function Panel({ title, sub, action, children, className, bodyClassName }: { title: ReactNode; sub?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cx('flex min-h-0 flex-col overflow-hidden rounded-[12px] border border-line bg-surface', className)}>
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3.5 py-[11px]">
        <b className="min-w-0 flex-1 text-ink">
          {title}
          {sub ? <span className="block text-[12px] font-medium text-ink-3">{sub}</span> : null}
        </b>
        {action}
      </div>
      <div className={cx('min-h-0 flex-1 overflow-y-auto scroll-thin', bodyClassName)}>{children}</div>
    </section>
  );
}

export function Seg<T extends string | number>({ options, value, onChange, label }: { options: Array<{ id: T; label: ReactNode }>; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex shrink-0 gap-1 rounded-[9px] bg-[#E9ECF3] p-[3px] dark:bg-subtle">
      {options.map((o) => (
        <button
          key={String(o.id)}
          type="button"
          role="tab"
          aria-selected={o.id === value}
          onClick={() => onChange(o.id)}
          className={cx('h-7 rounded-[7px] px-[11px] text-[12.5px] font-semibold whitespace-nowrap', o.id === value ? 'bg-surface text-primary shadow-[0_1px_2px_rgb(var(--ws-shadow-rgb)/.12)]' : 'text-ink-2 hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PageHead({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* A basis, so the actions wrap below the title on a narrow (or scaled-up) window instead of squeezing it. */}
      <div className="flex min-w-0 flex-1 basis-[240px] flex-col">
        <h1 className="m-0 text-[20px] font-bold text-ink">{title}</h1>
        {sub ? <span className="text-[12.5px] text-ink-3">{sub}</span> : null}
      </div>
      {children}
    </div>
  );
}

export const btn = 'inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-3 text-[13px] font-semibold whitespace-nowrap text-ink hover:bg-subtle disabled:opacity-50';
export const btnPrimary = 'inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-[8px] bg-primary px-3.5 text-[13px] font-bold whitespace-nowrap text-white hover:bg-primary-hover disabled:opacity-50';
export const btnGood = 'inline-flex h-[30px] shrink-0 items-center rounded-[7px] bg-[#1F7A4D] px-2.5 text-[12.5px] font-semibold whitespace-nowrap text-white hover:bg-[#1A6841] disabled:opacity-50';
export const btnBad = 'inline-flex h-[30px] shrink-0 items-center rounded-[7px] border border-[#F1B8A8] bg-surface px-2.5 dark:border-danger/40 text-[12.5px] font-semibold whitespace-nowrap text-danger hover:bg-danger-bg disabled:opacity-50';
export const btnSmall = 'inline-flex h-[30px] shrink-0 items-center rounded-[7px] border border-line bg-surface px-2.5 text-[12.5px] font-semibold whitespace-nowrap text-ink hover:bg-subtle disabled:opacity-50';
/** Borderless: the panel's Close beside the actions that matter. */
export const btnGhost = 'inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-[8px] px-3 text-[13px] font-semibold whitespace-nowrap text-ink-2 hover:bg-subtle hover:text-ink disabled:opacity-50';
export const input = 'h-[34px] w-full rounded-[8px] border border-line bg-surface px-2.5 text-[13px] font-medium text-ink outline-none focus:border-primary';

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('flex flex-col gap-1 text-[12.5px] font-semibold text-ink', className)}>
      {label}
      {children}
      {hint ? <span className="text-[11.5px] font-medium text-ink-3">{hint}</span> : null}
    </label>
  );
}

/** A table heading row: uppercase column names at fixed widths (null = the flexible column). */
export function THead({ cols }: { cols: Array<[string, number | null]> }) {
  return (
    <div className="flex shrink-0 gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
      {cols.map(([l, w], i) => (
        <span key={i} className={w == null ? 'min-w-0 flex-1' : 'shrink-0'} style={w == null ? undefined : { width: w }}>
          {l}
        </span>
      ))}
    </div>
  );
}

export function Cell({ w, children, className }: { w: number | null; children?: ReactNode; className?: string }) {
  return (
    <span className={cx(w == null ? 'min-w-0 flex-1 truncate' : 'shrink-0 truncate', className)} style={w == null ? undefined : { width: w }}>
      {children}
    </span>
  );
}

export const row = 'flex items-center gap-2.5 border-b border-line/70 px-3.5 py-[9px] text-[13px] text-ink last:border-b-0';

/** Initials on the designs' pale disc. */
export function Initials({ name, size = 30 }: { name: string | null | undefined; size?: number }) {
  const t = (name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-selection font-bold text-primary" style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}>
      {t || '?'}
    </span>
  );
}

/** A dialog in the designs' form: title, body, and a footer of buttons. */
export function Sheet({ title, children, footer, onClose, width = 460, side }: { title: ReactNode; children: ReactNode; footer: ReactNode; onClose: () => void; width?: number; side?: boolean }) {
  return (
    <div className={cx('no-drag fixed inset-0 z-50 flex items-center bg-[rgba(15,27,61,.32)]', side ? 'justify-end pr-10' : 'justify-center')} onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div role="dialog" aria-label={typeof title === 'string' ? title : undefined} className="animate-in flex max-h-[calc(100vh-60px)] flex-col rounded-[14px] border border-line bg-surface shadow-[0_24px_60px_rgb(var(--ws-shadow-rgb)/.28)]" style={{ width, maxWidth: 'calc(100vw - 32px)' }}>
        <div className="flex items-center px-5 pt-4 pb-1.5">
          <h2 className="m-0 flex-1 text-[17px] font-bold text-ink">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-full text-ink-3 hover:bg-subtle hover:text-ink">
            <Icon name="x" size={15} />
          </button>
        </div>
        <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto px-5 pt-2 pb-3.5 scroll-thin">{children}</div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>
      </div>
    </div>
  );
}

export function Empty({ text }: { text: ReactNode }) {
  return <div className="px-3.5 py-6 text-center text-[12.5px] text-ink-3">{text}</div>;
}

/** Label-and-value rows (an employment card). */
export function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <>
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-2.5 py-[5px]">
          <span className="w-[128px] shrink-0 text-ink-3">{k}</span>
          <span className="min-w-0 font-semibold text-ink">{v ?? '—'}</span>
        </div>
      ))}
    </>
  );
}

/** Label-over-value pairs, two to a row (the personal cards). */
export function Grid({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <div className="grid grid-cols-2 gap-x-4">
      {rows.map(([k, v]) => (
        <div key={k} className="flex min-w-0 flex-col border-b border-line/70 py-1.5">
          <span className="text-[11.5px] text-ink-3">{k}</span>
          <span className="truncate font-semibold text-ink">{v === null || v === undefined || v === '' ? '—' : v}</span>
        </div>
      ))}
    </div>
  );
}

/** A panel sliding in from the right over a dimmed page (the designs' record drawers). */
export function SidePanel({ label, width = 440, onClose, head, children }: { label: string; width?: number; onClose: () => void; head: ReactNode; children: ReactNode }) {
  return (
    <div className="no-drag fixed inset-0 z-40 bg-[rgba(15,27,61,.32)]" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <aside aria-label={label} className="absolute top-0 right-0 bottom-0 flex flex-col overflow-hidden bg-surface shadow-[-10px_0_30px_rgb(var(--ws-shadow-rgb)/.18)]" style={{ width, maxWidth: 'calc(100vw - 24px)' }}>
        {/* Full height, so the head clears the Windows caption buttons on the top right. */}
        <div className="flex shrink-0 items-center gap-2.5 border-b border-line py-3.5 pl-4" style={{ paddingRight: topBarPaddingRight(16) }}>
          <div className="flex min-w-0 flex-1 items-center gap-2.5">{head}</div>
          <button type="button" aria-label="Close" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-full text-ink-3 hover:bg-subtle hover:text-ink">
            <Icon name="x" size={15} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-4 py-3 scroll-thin">{children}</div>
      </aside>
    </div>
  );
}

/** The small uppercase heading the drawers use between blocks. */
export function Caps({ children }: { children: ReactNode }) {
  return <div className="mb-1 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">{children}</div>;
}
