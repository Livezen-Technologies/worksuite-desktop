import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Select } from '../../../components/Select';
import { Button, Modal, cx } from '../../../components/ui';
import { qk, read } from '../api';
import { useProjectCompany } from '../company';
import { openWeb } from '../parts';
import { gk, gov } from './gov-api';

// The pieces every Projects screen shares come from the one kit (and the company selector from company.tsx).
export { ChartTable, Field, Mono, NEEDS_CONNECTION as WAITS } from './kit';

/**
 * The governance screens' shared parts (W12–W15 in the desktop's language): number and day words as the web writes
 * them, the status and level tones in the app's theme tokens (light and dark; the word is always there, NFR-08), the
 * project picker, a KPI tile and a confirm dialog. The company selector is company.tsx's `CompanySelect`.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseDay(d: string | null | undefined): Date | null {
  if (!d) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** "9 Oct", or "9 Oct 2025" for another year. */
export function fmtDay(d: string | null | undefined, opts: { year?: boolean } = {}): string {
  const x = parseDay(d);
  if (!x) return '—';
  const y = opts.year || x.getFullYear() !== new Date().getFullYear();
  return `${x.getDate()} ${MONTHS[x.getMonth()]}${y ? ` ${x.getFullYear()}` : ''}`;
}

/** "9 Oct 08:00" from a server stamp (local time). */
export function fmtStamp(s: string | null | undefined): string {
  if (!s) return '—';
  const t = Date.parse(s.includes('T') || s.includes(' ') ? s.replace(' ', 'T') : s);
  if (!Number.isFinite(t)) return s;
  const d = new Date(t);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function num(v: string | number | null | undefined, dp = 0): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** "12.4M", "420K", "42,000" — short money for tables and tiles. */
export function shortMoney(v: string | number | null | undefined, currency?: string | null): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  const body = a >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : a >= 100_000 ? `${(n / 1_000).toFixed(0)}K` : num(n);
  return currency ? `${currency} ${body}` : body;
}

/** "+1,200,000" / "−496,500" with a real minus sign. */
export function signed(v: string | number | null | undefined, dp = 0): string {
  const n = Number(v ?? 0);
  if (!n) return '0';
  return `${n > 0 ? '+' : '−'}${num(Math.abs(n), dp)}`;
}

export function usedTone(pct: number | null | undefined, warn = 80): string {
  if (pct === null || pct === undefined) return 'text-ink-3';
  if (pct > 100) return 'font-bold text-danger';
  if (pct >= warn) return 'text-warning-ink';
  return 'text-ink-2';
}

const ORANGE = 'bg-[#FFEDD5] text-[#9A3412] dark:bg-[#9A3412]/30 dark:text-[#FDBA74]';

export const RISK_LEVEL: Record<string, { label: string; cell: string }> = {
  critical: { label: 'Critical', cell: 'bg-[#FECACA] text-[#7F1D1D] dark:bg-[#B91C1C]/45 dark:text-[#FECACA]' },
  high: { label: 'High', cell: ORANGE },
  medium: { label: 'Medium', cell: 'bg-warning-bg text-warning-ink' },
  low: { label: 'Low', cell: 'bg-subtle text-ink-2' },
};

export const RISK_STATUS: Record<string, { label: string; tone: string }> = {
  open: { label: 'Open', tone: 'bg-danger-bg text-danger' },
  mitigating: { label: 'Mitigating', tone: 'bg-selection text-primary' },
  realised: { label: 'Realised', tone: ORANGE },
  closed: { label: 'Closed', tone: 'bg-subtle text-ink-3' },
};

export const CHANGE_STATUS: Record<string, { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: 'bg-subtle text-ink-2' },
  submitted: { label: 'Submitted', tone: 'bg-warning-bg text-warning-ink' },
  approved: { label: 'Approved', tone: 'bg-success-bg text-success' },
  rejected: { label: 'Rejected', tone: 'bg-danger-bg text-danger' },
  withdrawn: { label: 'Withdrawn', tone: 'bg-subtle text-ink-3' },
};

export function Tone({ tone, children, className }: { tone: string; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center rounded-full px-2 py-px text-[11px] font-semibold whitespace-nowrap', tone, className)}>{children}</span>;
}

/** A figure tile: label, value, a line under it. */
export function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'danger' }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[12px] border border-line bg-surface px-3.5 py-2.5">
      <span className="truncate text-[11.5px] font-semibold text-ink-3">{label}</span>
      <b className={cx('truncate text-[20px]', tone === 'danger' ? 'text-danger' : 'text-ink')}>{value}</b>
      {sub ? <span className="truncate text-[11.5px] text-ink-3">{sub}</span> : null}
    </div>
  );
}

/** A page's head: title (and what is above it), what sits beside it, the actions on the right. */
export function PageHead({ crumb, title, sub, children }: { crumb?: ReactNode; title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-5 py-3">
      <div className="flex min-w-0 flex-1 basis-[240px] flex-col">
        {crumb ? <span className="truncate font-mono text-[11.5px] text-ink-3">{crumb}</span> : null}
        <h1 className="truncate text-[18px] font-bold text-ink">{title}</h1>
        {sub ? <span className="text-[12px] text-ink-3">{sub}</span> : null}
      </div>
      {children}
    </header>
  );
}

export const inputClass = 'h-[32px] w-full rounded-[8px] border border-line bg-surface px-2.5 text-[13px] font-normal text-ink outline-none focus:border-primary disabled:opacity-60';
export const areaClass = 'w-full rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-[13px] font-normal text-ink outline-none focus:border-primary disabled:opacity-60';

/** Status tabs as chips, each with its count. */
export function Tabs<K extends string>({ label, value, onChange, tabs }: { label: string; value: K; onChange: (k: K) => void; tabs: Array<{ key: K; label: string; count?: number }> }) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1.5">
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)} className={cx('rounded-full px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap', value === t.key ? 'bg-primary text-white' : 'bg-subtle text-ink-2 hover:text-ink')}>
          {t.label}
          {t.count !== undefined ? <span className="ms-1 font-mono">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Live projects in reach, as picker options "PRJ-0018 · e-Auction portal". */
export function useLiveProjects(enabled = true) {
  useProjectCompany();
  const q = useQuery({ queryKey: gk.live(), queryFn: ({ signal }) => gov.live({ signal }), enabled, staleTime: 60_000 });
  return (q.data?.data.projects ?? []).map((p) => ({ value: String(p.id), label: `${p.code} · ${p.name}` }));
}

/** A project's current members, for owner pickers. */
export function useMemberOptions(projectId: number | null) {
  const q = useQuery({ queryKey: qk.detail(projectId ?? 0), queryFn: ({ signal }) => read.detail(projectId!, { signal }), enabled: !!projectId, staleTime: 60_000 });
  return (q.data?.data.members ?? []).map((m) => ({ value: String(m.user_id), label: m.name }));
}

/** "Project: all" — the project filter on a module-level screen. */
export function ProjectFilter({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <div className="w-[240px]">
      <Select aria-label="Project" value={value} onValueChange={onChange} options={[{ value: '', label: 'Project: all' }, ...options]} className={inputClass} />
    </div>
  );
}

export function ConfirmDialog({ title, body, action, danger, onClose, onYes }: { title: string; body: string; action: string; danger?: boolean; onClose: () => void; onYes: () => void }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={420}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={() => (onClose(), onYes())}>
            {action}
          </Button>
        </>
      }
    >
      <p className="text-[13px] leading-[1.5] text-ink-2">{body}</p>
    </Modal>
  );
}

/** The message a refused action carries. */
export function errorText(e: unknown, fallback = 'That did not work.'): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** A small "Open on the web" kept as a secondary action. */
export function WebButton({ path }: { path: string }) {
  return (
    <Button size="sm" variant="ghost" icon="external" onClick={() => openWeb(path)}>
      Open on the web
    </Button>
  );
}
