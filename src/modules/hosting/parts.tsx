import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { Menu, type MenuItem } from '../../components/Menu';
import { cx } from '../../components/ui';
import type { Query } from '../../core/api';
import { text } from '../../core/i18n';
import { urgency, type ExportKind } from './api';
import { saveExport } from './files';

/**
 * Hosting's shared bits. The cards, tables, buttons and fields are the desktop modules' own (Assets' parts, the
 * WorkSuite Desktop tokens), so Hosting looks like its neighbours; here are what is Hosting's: whether a screen may
 * act (offline every change is off, HDM-DSK-05), the days-left chips of D-01/D-02, the status pills and the "needs
 * a server update" state for routes an older server does not have.
 */
export { Btn, Card, Field, Kbd, Kpi, Note, PageHead, Pills, Table, input, td, tdr, useOnline } from '../assets/parts';

export const ReadOnly = createContext(false);
export const useReadOnly = () => useContext(ReadOnly);
export const OFFLINE_TITLE = 'Needs a connection';

/** The module's accent (HDM-DSK-01: cyan), as the rail draws it. */
export const ACCENT = '#0891B2';

const CHIP: Record<string, string> = {
  red: 'bg-[#FDECEA] text-[#B42318] dark:bg-danger/15 dark:text-danger',
  amber: 'bg-[#FDF1E3] text-[#9A4A06] dark:bg-warning/15 dark:text-warning',
  grey: 'bg-[#EEF0F6] text-[#4A5168] dark:bg-subtle dark:text-ink-2',
  green: 'bg-[#E7F4ED] text-[#1F7A4D] dark:bg-success/15 dark:text-success',
};

export function Chip({ tone, children, className }: { tone: keyof typeof CHIP | string; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex h-[19px] items-center rounded-full px-[7px] text-[11px] font-semibold whitespace-nowrap tabular-nums', CHIP[tone] ?? CHIP.grey, className)}>{children}</span>;
}

/** "4 d" / "12 days" chip coloured by how soon. */
export function Days({ days, long }: { days: number | null; long?: boolean }) {
  if (days === null) return <Chip tone="grey">—</Chip>;
  const label = days < 0 ? text('expired') : long ? text('{n} days', { n: days }) : text('{n} d', { n: days });
  return <Chip tone={urgency(days)}>{label}</Chip>;
}

const STATUS: Record<string, string> = {
  active: 'green', ok: 'green', valid: 'green', up: 'green', running: 'green', on: 'green', done: 'green',
  expiring: 'amber', expiring_soon: 'amber', pending: 'amber', unreachable: 'amber', paused: 'amber', not_yet_valid: 'amber', stopped: 'grey', off: 'grey', unknown: 'grey', cancelled: 'grey',
  expired: 'red', down: 'red', failed: 'red', refused: 'red', mismatch: 'red', untrusted: 'red', error: 'red', suspended: 'red',
};
export const statusTone = (s: string | null | undefined) => STATUS[(s ?? '').toLowerCase()] ?? 'grey';
export const statusLabel = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '—');

/** A status pill. `label` is the server's own words for it (`status_label`, `status_words`) where it sent them. */
export function Status({ value, label }: { value: string | null | undefined; label?: string | null }) {
  return <Chip tone={statusTone(value)}>{label || statusLabel(value)}</Chip>;
}

/** A button that opens a menu below it (Export, More). */
export function MenuButton({ label, items, primary, disabled, title }: { label: ReactNode; items: MenuItem[]; primary?: boolean; disabled?: boolean; title?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        title={title}
        onClick={() => setOpen(!open)}
        className={cx('inline-flex h-8 items-center gap-1.5 rounded-[7px] px-3 text-[12.5px] font-bold whitespace-nowrap disabled:opacity-50', primary ? 'bg-primary text-white hover:bg-primary-hover' : 'border border-line bg-surface text-ink hover:bg-subtle')}
      >
        {label} <span aria-hidden>▾</span>
      </button>
      {open ? <Menu sections={[{ id: 'm', items }]} label={typeof label === 'string' ? label : text('Menu')} anchor={ref} prefer="bottom" align="end" width={230} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** Export ▾: the list as the server's CSV or Excel file, with the list's own filters (HDM-IMP-01). */
export function ExportButton({ kind, query, disabled }: { kind: ExportKind; query: Query; disabled?: boolean }) {
  return (
    <MenuButton
      label={text('Export')}
      disabled={disabled}
      title={disabled ? OFFLINE_TITLE : undefined}
      items={[
        { id: 'csv', label: text('CSV file'), description: text('As the list is filtered now'), onSelect: () => void saveExport(kind, 'csv', query) },
        { id: 'xlsx', label: text('Excel workbook'), description: text('As the list is filtered now'), onSelect: () => void saveExport(kind, 'xlsx', query) },
      ]}
    />
  );
}

/** A route the SRS adds that this server does not have yet. */
export function NeedsUpdate({ what }: { what: string }) {
  return (
    <div role="status" className="flex flex-col items-center gap-1.5 rounded-[10px] border border-dashed border-line bg-surface px-6 py-10 text-center">
      <span className="text-[13.5px] font-bold text-ink">{text('{what} needs a server update', { what })}</span>
      <span className="max-w-[440px] text-[12.5px] text-ink-3">Your WorkSuite server does not have this part of Hosting & Domains yet. Ask your administrator to update the Hosting module; everything else here works as it is.</span>
    </div>
  );
}

/** A date and time the server sent, short and local. */
export function when(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-line/60 py-1.5 text-[12.5px] last:border-0">
      <span className="w-[110px] shrink-0 text-ink-3">{label}</span>
      <span className="min-w-0 flex-1 break-words text-ink">{children}</span>
    </div>
  );
}
