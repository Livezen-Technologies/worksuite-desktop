import { useEffect, useState, type ReactNode, type TextareaHTMLAttributes, type InputHTMLAttributes } from 'react';
import { ApiError } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, cx, Empty, ErrorNote, Spinner } from '../../components/ui';
import { isNotOffered, NOT_OFFERED, type Optional } from './api';
import type { Tone } from './lib/consent';
import { count } from './lib/format';

/**
 * Marketing's small shared pieces (design "WorkSuite Marketing — Modern UI"): the page head with its breadcrumb,
 * cards, KPI tiles, status chips in the design's colours (green sent/subscribed, amber paused/warning, red
 * blocked/suppressed, violet scheduled/planned), honest states (not offered by this server, planned) and tables.
 */

/**
 * A part's own classes with the caller's on top. Tailwind orders utilities of the same property by value, not by where
 * they are written, so `px-0` cannot beat a part's `px-4` by coming later: a caller's width, height, padding, gap,
 * background or border colour replaces the part's own instead.
 */
const REPLACES: ReadonlyArray<readonly [RegExp, RegExp]> = [
  [/^w-/, /^w-/],
  [/^min-w-/, /^min-w-/],
  [/^max-w-/, /^max-w-/],
  [/^h-/, /^h-/],
  [/^min-h-/, /^min-h-/],
  [/^p-/, /^p-/],
  [/^px-/, /^(p|px)-/],
  [/^py-/, /^(p|py)-/],
  [/^pt-/, /^(p|py|pt)-/],
  [/^pb-/, /^(p|py|pb)-/],
  [/^gap-/, /^gap-/],
  [/^bg-/, /^bg-/],
  [/^border-(line|transparent|primary|danger|warning|success)\b/, /^border-(line|transparent|primary|danger|warning|success)\b/],
];

export function over(base: string, extra?: string | false | null): string {
  if (!extra) return base;
  const mine = extra.split(/\s+/).filter(Boolean);
  const kept = base.split(/\s+/).filter((b) => !REPLACES.some(([own, theirs]) => own.test(b) && mine.some((m) => theirs.test(m))));
  return [...kept, ...mine].join(' ');
}

/** Keys, IDs, numbers and merge tags (system mono in the design). */
export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('font-mono tabular-nums', className)}>{children}</span>;
}

/** "Marketing / Audience" above the title, the subtitle under it, actions on the right (every W/DK screen). */
export function PageHeader({ crumb, title, sub, actions, back }: { crumb?: ReactNode; title: ReactNode; sub?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <header className="flex shrink-0 flex-wrap items-end gap-3 border-b border-line bg-surface px-6 pt-3 pb-3">
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {back}
        <div className="min-w-0">
          <div className="truncate text-[11.5px] font-medium text-ink-3">{crumb ?? 'Marketing'}</div>
          <h1 className="truncate text-[19px] leading-tight font-bold text-ink">{title}</h1>
          {sub ? <div className="mt-0.5 truncate text-[12px] text-ink-3">{sub}</div> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** The scroll area under a page head. */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={over('min-h-0 flex-1 overflow-y-auto bg-ground p-5 scroll-thin', className)}>{children}</div>;
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
      <div className={over('min-h-0 flex-1 px-4 pb-4', bodyClassName)}>{children}</div>
    </section>
  );
}

/** A KPI tile ("Contacts 4,812 · +212 this month"). `value` null is "not measured", never a zero. */
export function Kpi({ label, value, sub, tone, subTone }: { label: string; value: ReactNode | null; sub?: ReactNode; tone?: 'danger' | 'warning' | 'success' | 'primary'; subTone?: 'danger' | 'warning' | 'success' }) {
  const colour = tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : tone === 'success' ? 'text-success' : tone === 'primary' ? 'text-primary' : 'text-ink';
  const subColour = subTone === 'danger' ? 'text-danger' : subTone === 'warning' ? 'text-warning' : subTone === 'success' ? 'text-success' : 'text-ink-3';
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[12px] border border-line bg-surface px-4 py-3">
      <span className="text-[11.5px] font-semibold text-ink-3">{label}</span>
      {value === null ? <span className="text-[13px] font-semibold text-ink-3">Not measured</span> : <span className={cx('font-mono text-[22px] font-bold tabular-nums', colour)}>{value}</span>}
      {sub ? <span className={cx('truncate text-[11.5px]', subColour)}>{sub}</span> : null}
    </div>
  );
}

const TONES: Record<Tone, string> = {
  muted: 'bg-subtle text-ink-2',
  indigo: 'bg-selection text-primary',
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
  violet: 'bg-[#F3E8FF] text-[#6D28D9] dark:bg-[#2E1D4A] dark:text-[#D2B4FE]',
};

/** "• Subscribed", "• Sending · 62%" — a status with its dot. */
export function Status({ tone, children, dot = true, className }: { tone: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cx('inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap', TONES[tone], className)}>
      {dot ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** The violet "Planned" mark on a Target capability (Automation, snapshots, double opt-in). */
export function Planned({ children = 'Planned' }: { children?: ReactNode }) {
  return <Status tone="violet">{children}</Status>;
}

/** Honest state: this WorkSuite server has no such endpoint yet. */
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

/** A refusal said plainly: no permission, not offered, or the server's own words. */
export function Refused({ error, onRetry, what = 'This' }: { error: unknown; onRetry?: () => void; what?: string }) {
  if (error instanceof ApiError && error.forbidden) return <Empty icon="lock" title="You don’t have permission for this" hint={error.message} />;
  if (isNotOffered(error)) return <NotOffered what={what} />;
  return (
    <div className="p-4">
      <ErrorNote error={error} onRetry={onRetry} />
    </div>
  );
}

/**
 * Loading, refused, or the content: the one switch a screen's main read goes through. Once there is content, a later
 * refresh that fails (the server away for a moment) keeps it on screen — with whatever is being edited in it.
 */
export function Loaded<T>({ q, what, children }: { q: { data?: T; isLoading: boolean; error: unknown; refetch: () => unknown }; what?: string; children: (data: T) => ReactNode }) {
  if (q.isLoading) return <Spinner />;
  if (q.data !== undefined) return <>{children(q.data)}</>;
  if (q.error) return <Refused error={q.error} what={what} onRetry={() => void q.refetch()} />;
  return null;
}

/** The same for a Target endpoint, which may not be offered. */
export function OptionalView<T>({ q, what, children, notOffered }: { q: { data?: Optional<T>; isLoading: boolean; error: unknown; refetch: () => unknown }; what: string; children: (data: T) => ReactNode; notOffered?: ReactNode }) {
  if (q.isLoading) return <Spinner />;
  if (!q.data) return q.error ? <Refused error={q.error} what={what} onRetry={() => void q.refetch()} /> : null;
  if (!q.data.offered) return <>{notOffered ?? <NotOffered what={what} />}</>;
  return <>{children(q.data.data)}</>;
}

/** A note band ("This file has no consent column…", "792 of 1,006 imported vendors have no phone consent"). */
export function Notice({ tone = 'primary', icon, children, action, className }: { tone?: 'primary' | 'warning' | 'success' | 'danger' | 'violet'; icon?: string; children: ReactNode; action?: ReactNode; className?: string }) {
  const tones = {
    primary: 'border-primary/25 bg-selection text-ink',
    warning: 'border-warning/30 bg-warning-bg text-warning-ink dark:text-warning',
    success: 'border-success/30 bg-success-bg text-ink',
    danger: 'border-danger/30 bg-danger-bg text-danger',
    violet: 'border-[#6D28D9]/25 bg-[#F5F3FF] text-[#4C1D95] dark:bg-[#2E1D4A] dark:text-[#D2B4FE]',
  } as const;
  const glyph = icon ?? (tone === 'warning' || tone === 'danger' ? 'warning' : 'info');
  return (
    <div role={tone === 'danger' || tone === 'warning' ? 'status' : undefined} className={cx('flex items-start gap-2.5 rounded-[10px] border px-3.5 py-2.5 text-[12.5px]', tones[tone], className)}>
      <Icon name={glyph} size={16} className="mt-px shrink-0" />
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}

/** Underlined tabs ("Timeline · Consent ledger · Campaigns · Calls", "Suppression list (203) · Consent ledger"). */
export function Tabs<T extends string>({ value, onChange, tabs, label, className }: { value: T; onChange: (v: T) => void; tabs: Array<{ id: T; label: ReactNode }>; label: string; className?: string }) {
  return (
    <div role="tablist" aria-label={label} className={cx('flex shrink-0 flex-wrap items-end gap-5 border-b border-line', className)}>
      {tabs.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={cx('-mb-px border-b-2 pb-2 text-[13px] font-semibold whitespace-nowrap', on ? 'border-primary text-primary' : 'border-transparent text-ink-2 hover:text-ink')}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** A horizontal bar (funnel, consent coverage). `value` is 0..100. */
export function Bar({ value, tone = 'primary', className }: { value: number; tone?: 'primary' | 'ink' | 'violet' | 'danger' | 'success' | 'warning'; className?: string }) {
  const fill = { primary: 'bg-primary', ink: 'bg-ink', violet: 'bg-[#7C3AED]', danger: 'bg-danger', success: 'bg-success', warning: 'bg-warning' }[tone];
  return (
    <div className={cx('h-2 w-full overflow-hidden rounded-full bg-subtle', className)} role="presentation">
      <div className={cx('h-full rounded-full', fill)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

/** "Label ……… value" rows (Rules, Audience, Deliverability). */
export function Row({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-center justify-between gap-3 border-b border-line py-1.5 text-[12.5px] last:border-b-0', className)}>
      <span className="min-w-0 text-ink-2">{label}</span>
      <span className="min-w-0 truncate text-right font-medium text-ink">{children}</span>
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * Tables
 * ------------------------------------------------------------------------ */

export const TH = 'px-3 py-2 text-left text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase whitespace-nowrap';
export const TD = 'px-3 py-2.5 align-middle text-[12.5px] text-ink';

export function Table({ head, children, className, label }: { head: ReactNode; children: ReactNode; className?: string; label?: string }) {
  return (
    <div className={over('overflow-x-auto rounded-[12px] border border-line bg-surface scroll-thin', className)}>
      <table className="w-full border-collapse" aria-label={label}>
        <thead className="border-b border-line bg-subtle/50">{head}</thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

/** "Showing 1–7 of 4,812 · Previous · Next". */
export function Pager({ page, pages, total, perPage, onPage }: { page: number; pages: number; total: number; perPage: number; onPage: (p: number) => void }) {
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(total, page * perPage);
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 text-[12px] text-ink-3">
      <span>
        Showing {count(from)}–{count(to)} of {count(total)}
      </span>
      <div className="flex gap-1.5">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * Form pieces
 * ------------------------------------------------------------------------ */

/** A field: red while `aria-invalid` (a variant, so it wins over the border colour whatever else is set). */
export const INPUT = 'h-9 w-full rounded-[8px] border border-line bg-surface px-3 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-primary disabled:opacity-60 aria-[invalid=true]:border-danger';

/** INPUT with a caller's own width, height or padding (a raw `<input>` or `<select>`). */
export function inputClass(extra?: string | false | null): string {
  return over(INPUT, extra);
}

export function Field({ label, hint, error, children, className }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={over('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-[12px] font-semibold text-ink-2">{label}</span>
      {children}
      {error ? <span className="text-[11.5px] text-danger">{error}</span> : hint ? <span className="text-[11.5px] text-ink-3">{hint}</span> : null}
    </label>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={over(INPUT, className)} />;
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={over('min-h-[80px] w-full rounded-[8px] border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-primary disabled:opacity-60 aria-[invalid=true]:border-danger', className)} />;
}

/* ------------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------------ */

/** A CSV the server built, saved where the person chooses. */
export async function saveCsv(name: string, csv: string): Promise<void> {
  const safe = `${name.replace(/[^A-Za-z0-9 ._-]+/g, '-').replace(/-+/g, '-').slice(0, 70) || 'export'}.csv`;
  if (csv.length > 8_000_000) {
    toast('error', 'This export is too large to save from here. Export it from WorkSuite on the web.');
    return;
  }
  const where = await call('files:saveText', { name: safe, text: csv });
  if (where) toast('success', `Saved ${safe}.`);
}

/** Runs an action with a busy flag, says what happened, and reports a failure in the server's words. */
export function useAction(): [string | null, (key: string, fn: () => Promise<unknown>, done?: string) => Promise<boolean>] {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try {
      await fn();
      if (done) toast('success', done);
      return true;
    } catch (e) {
      toast('error', isNotOffered(e) ? NOT_OFFERED : errorMessage(e));
      return false;
    } finally {
      setBusy(null);
    }
  };
  return [busy, run];
}

/** A value that settles `ms` after its last change: a search box asks the server once typing stops. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
