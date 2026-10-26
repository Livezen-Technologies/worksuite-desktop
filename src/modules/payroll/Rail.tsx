import type { MouseEvent } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';

/**
 * The Payroll rail (DeskRail, 232px): Home and Runs; people and inputs; outputs; configure; and My Payslips, which is
 * HR's. ⌘-click (Ctrl-click) opens a screen in a new tab.
 */
export type PayView =
  | 'home' | 'runs' | 'run' | 'approve'
  | 'employees' | 'profile' | 'inputs' | 'loans' | 'settlements' | 'settlement'
  | 'payslips' | 'template' | 'disbursements' | 'statutory' | 'reports'
  | 'setup' | 'settings';
export const NATIVE = new Set<string>(['home', 'runs', 'run', 'approve', 'employees', 'profile', 'inputs', 'loans', 'settlements', 'settlement', 'payslips', 'template', 'disbursements', 'statutory', 'reports', 'setup', 'settings']);

/** The rail entry a screen belongs under. */
const UNDER: Partial<Record<PayView, PayView>> = { run: 'runs', approve: 'runs', profile: 'employees', settlement: 'settlements', template: 'payslips' };

export function PayrollRail({ view, sub, counts, onPick, onMine }: {
  view: PayView;
  /** "CreativeFX · Sep 2026". */
  sub?: string | null;
  counts: Partial<Record<PayView, number>>;
  onPick: (v: PayView, newTab: boolean) => void;
  onMine: () => void;
}) {
  const at = UNDER[view] ?? view;
  const item = (id: PayView, label: string, icon: string) => {
    const on = at === id;
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
        {n ? <span className="shrink-0 rounded-[9px] bg-[#EAEDFB] px-1.5 text-[11px] font-bold text-[#23349E] tabular-nums dark:bg-primary/15 dark:text-primary">{n}</span> : null}
      </button>
    );
  };
  const head = (label: string) => <div className="mt-3 mb-0.5 px-2 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">{label}</div>;

  return (
    <nav aria-label="Payroll" className="flex w-[232px] shrink-0 flex-col overflow-hidden border-r border-line bg-[#FBFBFD] text-[13px] text-ink dark:bg-surface">
      <div className="px-4 pt-3.5 pb-1">
        <div className="text-[15px] font-extrabold">Payroll</div>
        {sub ? <div className="truncate text-[11.5px] text-ink-3">{sub}</div> : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pt-2 pb-2.5 scroll-thin">
        {item('home', 'Home', 'home')}
        {item('runs', 'Runs', 'list')}
        {head('People & inputs')}
        {item('employees', 'Employees', 'users')}
        {item('inputs', 'Inputs', 'file-text')}
        {item('loans', 'Loans & advances', 'wallet')}
        {item('settlements', 'Final settlements', 'door')}
        {head('Outputs')}
        {item('payslips', 'Payslips', 'receipt')}
        {item('disbursements', 'Disbursements', 'banknote')}
        {item('statutory', 'Statutory', 'landmark')}
        {item('reports', 'Reports', 'chart')}
        {head('Configure')}
        {item('setup', 'Setup', 'settings')}
        {item('settings', 'Settings', 'sliders')}
        <div className="mt-3 border-t border-line pt-2">
          <button type="button" onClick={onMine} className="flex h-[32px] w-full items-center gap-[9px] rounded-[7px] pr-2 pl-2.5 text-left font-medium text-ink-2 hover:bg-subtle">
            <Icon name="banknote" size={16} className="shrink-0 text-ink-3" />
            <span className="min-w-0 flex-1 truncate">My Payslips</span>
          </button>
        </div>
      </div>
      <div className="border-t border-line px-4 py-2 text-[11px] text-ink-3">Open in new tab · ⌘-click</div>
    </nav>
  );
}
