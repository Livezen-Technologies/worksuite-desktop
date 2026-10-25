import type { MouseEvent, ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { STATE_TEXT } from './api';

/**
 * Label Studio's rail (DeskRail, 232px) and its small shared pieces. The desktop screens are D01–D07; everything
 * else in Label Studio (W02–W32: the template library, batches, sequences, the queue, history, policies) opens on
 * the web from the rail's bottom group.
 */
export type LabelView = 'home' | 'designer' | 'station' | 'printers' | 'batch' | 'gateway';
export const VIEWS = new Set<string>(['home', 'designer', 'station', 'printers', 'batch', 'gateway']);

const WEB: Array<{ path: string; label: string; icon: string }> = [
  { path: '/label/templates', label: 'Templates', icon: 'file-text' },
  { path: '/label/batches', label: 'Batch print', icon: 'layers' },
  { path: '/label/sequences', label: 'Sequences', icon: 'hash' },
  { path: '/label/queue', label: 'Print queue', icon: 'list' },
  { path: '/label/history', label: 'History', icon: 'history' },
];

export function LabelRail({ view, counts, onPick, onWeb }: { view: LabelView; counts: Partial<Record<LabelView, number>>; onPick: (v: LabelView, newTab: boolean) => void; onWeb: (path: string) => void }) {
  const item = (id: LabelView, label: string, icon: string) => {
    const on = view === id;
    const n = counts[id];
    return (
      <button
        key={id}
        type="button"
        aria-current={on ? 'page' : undefined}
        onClick={(e: MouseEvent) => onPick(id, e.metaKey || e.ctrlKey)}
        className={cx('flex h-[32px] shrink-0 items-center gap-[9px] rounded-[7px] pr-2 pl-2.5 text-left', on ? 'bg-[#EEF1FD] font-bold text-[#3B5BDB] dark:bg-selection dark:text-primary' : 'font-medium text-ink-2 hover:bg-subtle')}
      >
        <Icon name={icon} size={16} className={cx('shrink-0', on ? 'text-primary' : 'text-ink-3')} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {n ? <span className="shrink-0 rounded-[9px] bg-[#FDECEA] px-1.5 text-[11px] font-bold text-[#B42318] tabular-nums dark:bg-danger/15 dark:text-danger">{n}</span> : null}
      </button>
    );
  };
  const head = (label: string) => <div className="mt-3 mb-0.5 px-2 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">{label}</div>;
  return (
    <nav aria-label="Label Studio" className="flex w-[232px] shrink-0 flex-col overflow-hidden border-r border-line bg-[#FBFBFD] text-[13px] text-ink dark:bg-surface">
      <div className="px-4 pt-3.5 pb-1">
        <div className="text-[15px] font-extrabold">Label Studio</div>
        <div className="truncate text-[11.5px] text-ink-3">On this computer</div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pt-2 pb-2.5 scroll-thin">
        {item('home', 'Home', 'home')}
        {item('station', 'Print station', 'scan')}
        {item('designer', 'Designer', 'pen')}
        {head('This computer')}
        {item('printers', 'Printers', 'printer')}
        {item('batch', 'Running batches', 'layers')}
        {item('gateway', 'Print Gateway', 'server')}
        {head('On the web')}
        {WEB.map((w) => (
          <button key={w.path} type="button" onClick={() => onWeb(w.path)} className="flex h-[32px] shrink-0 items-center gap-[9px] rounded-[7px] pr-2 pl-2.5 text-left font-medium text-ink-2 hover:bg-subtle">
            <Icon name={w.icon} size={16} className="shrink-0 text-ink-3" />
            <span className="min-w-0 flex-1 truncate">{w.label}</span>
            <Icon name="external" size={13} className="shrink-0 text-ink-3" />
          </button>
        ))}
      </div>
      <div className="border-t border-line px-4 py-2 text-[11px] text-ink-3">Open in new tab · ⌘-click</div>
    </nav>
  );
}

const TONE: Record<string, string> = {
  ready: 'ok', done: 'ok', online: 'ok', printing: 'in', queued: 'in', connecting: 'in',
  paused: 'wa', waiting_printer: 'wa', offline: 'wa', QUEUED: 'in', SENDING: 'in', PRINTING: 'in', COMPLETED: 'ok', PAUSED: 'wa', PENDING_APPROVAL: 'wa', PARTIAL: 'er', FAILED: 'er', CANCELLED: 'ne', interrupted: 'er', paper_out: 'er', ribbon_out: 'er', head_open: 'er', error: 'er', failed: 'er', revoked: 'er',
};
const PILL: Record<string, string> = {
  ok: 'bg-[#E7F6EE] text-[#13734A] dark:bg-success/15 dark:text-success',
  wa: 'bg-[#FFF4DB] text-[#8A5200] dark:bg-warning/15 dark:text-warning',
  er: 'bg-[#FDECEA] text-[#B42318] dark:bg-danger/15 dark:text-danger',
  in: 'bg-[#EAEDFB] text-[#23349E] dark:bg-primary/15 dark:text-primary',
  ne: 'bg-[#EEF0F6] text-[#4A5068] dark:bg-subtle dark:text-ink-2',
};

export function StatePill({ state, children }: { state: string; children?: ReactNode }) {
  return <span className={cx('inline-flex h-[19px] items-center rounded-[10px] px-[7px] text-[11px] font-semibold whitespace-nowrap', PILL[TONE[state] ?? 'ne'])}>{children ?? STATE_TEXT[state] ?? state}</span>;
}

export function Section({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('overflow-hidden rounded-[10px] border border-line bg-surface', className)}>
      {title ? (
        <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
          <h2 className="m-0 min-w-0 flex-1 truncate text-[13.5px] font-bold text-ink">{title}</h2>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export const btn = 'h-8 rounded-[7px] border border-line bg-surface px-3 text-[12.5px] font-semibold text-ink hover:bg-subtle disabled:opacity-50';
export const btnPrimary = 'h-8 rounded-[7px] bg-primary px-3 text-[12.5px] font-bold text-white disabled:opacity-50';
export const field = 'h-[34px] w-full rounded-[8px] border border-line bg-surface px-2.5 text-[13px] font-medium text-ink outline-none focus:border-primary';
export const td = 'border-b border-line/70 px-2.5 py-2 whitespace-nowrap';
export const th = 'border-b border-line bg-ground px-2.5 py-[7px] text-left text-[11px] font-semibold whitespace-nowrap text-ink-2';

/** "237 / 500" with a bar. */
export function Progress({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="flex min-w-[140px] items-center gap-2">
      <div className="h-[6px] flex-1 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11.5px] text-ink-2 tabular-nums">{`${done} / ${total}`}</span>
    </div>
  );
}
