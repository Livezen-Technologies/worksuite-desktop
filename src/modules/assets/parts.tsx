import { createContext, useContext, type ReactNode } from 'react';
import { cx } from '../../components/ui';
import { money } from '../finance/api';
import { statusLabel } from './api';

/**
 * Assets' shared bits: whether a screen may act (offline the module reads its last copy and every act is off — the
 * server must see each change), the status pills of the D-boards, cards, tables and the "needs a newer server" note.
 */

// The cards, tables, buttons and fields are shared with Hosting from `src/components/ConsoleKit` (audit D-G08).
export { Btn, Card, Field, Kbd, Kpi, Note, PageHead, Pills, Table, input, td, tdr, useOnline } from '../../components/ConsoleKit';

export const OFFLINE = 'Read-only while offline — changes need WorkSuite.';

export const ReadOnly = createContext(false);
export const useReadOnly = () => useContext(ReadOnly);

/** An amount the server sent, grouped; a dash when it sent none. */
export const amt = (v: string | null | undefined, cur = '') => (v === null || v === undefined || v === '' ? '—' : money(v, cur));

const TONE: Record<string, string> = {
  available: 'ok', assigned: 'in', reserved: 'ne', maintenance: 'wa', repair: 'wa', missing: 'vi', lost: 'er', stolen: 'er', retired: 'ne', disposed: 'ne',
  pending: 'wa', approved: 'ok', rejected: 'er', fulfilled: 'ok', cancelled: 'ne', completed: 'ok', scheduled: 'in', in_progress: 'wa', open: 'wa',
  manager_approved: 'in', it_approved: 'ok', active: 'ok', expired: 'er', overdue: 'er', blocked: 'er', low: 'wa', waiting: 'vi', confirmed: 'ok',
  issued: 'in', returned: 'ok', refused: 'er', looked: 'ne', good: 'ok', fair: 'wa', poor: 'er', new: 'ok', damaged: 'er', checked_out: 'in',
};
const PILL: Record<string, string> = {
  ok: 'bg-success-bg text-success dark:bg-success/15 dark:text-success',
  wa: 'bg-warning-bg text-yellow-ink dark:bg-warning/15 dark:text-warning',
  er: 'bg-danger-bg text-danger dark:bg-danger/15 dark:text-danger',
  in: 'bg-info-bg text-primary dark:bg-primary/15 dark:text-primary',
  vi: 'bg-selection text-violet-ink dark:bg-violet/20',
  ne: 'bg-subtle text-ink-2 dark:bg-subtle dark:text-ink-2',
};

export function Badge({ status, children }: { status: string; children?: ReactNode }) {
  return <span className={cx('inline-flex h-[19px] items-center rounded-[10px] px-[7px] text-[11px] font-semibold whitespace-nowrap', PILL[TONE[status] ?? 'ne'])}>{children ?? statusLabel(status)}</span>;
}

/** An Assets 1.1 endpoint the connected server does not have. */
export function NotYet({ what }: { what: string }) {
  return <p className="m-0 px-3.5 py-3 text-[12.5px] text-ink-3">{`${what} needs a newer WorkSuite server (Assets 1.1).`}</p>;
}

/** "LKR 9.11M": a compact figure for a tile; the full one is a title away. */
export function compact(v: string | null | undefined): string {
  const n = Number(v ?? '');
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  return a >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : a >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : money(String(v));
}
