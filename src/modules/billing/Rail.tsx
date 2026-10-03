import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useCanOpen } from '../../core/access';
import { call } from '../../core/bridge';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { cx } from '../../components/ui';
import { searchBilling } from './api';
import { PrimaryActionButton } from '../../components/PrimaryAction';

/**
 * The Billing rail (BillRail): the company picker, New invoice, a search over
 * invoices, payments and customers, then the screens by what they are for —
 * money in, adjustments, insight — what needs attention, the sales flow that
 * leads to an invoice (Quotes in CRM; Deliveries and Sales returns in Orders),
 * and Settings.
 */
export type BillView = 'dash' | 'inv' | 'pay' | 'cn' | 'rec' | 'cus' | 'rep' | 'set';

export const NATIVE = new Set<BillView>(['dash', 'inv', 'pay', 'cn', 'rec', 'cus', 'rep', 'set']);

export interface RailCounts {
  overdue: number;
  unallocated: number;
  drafts: number;
}

export function BillRail({ view, draftsOnly, onPick, onDrafts, onOnAccount, onNew, onOpenInvoice, onNavigate, counts, org, orgs, onOrg, canCreate, has }: {
  view: BillView;
  /** The invoice list is narrowed to drafts (the "needs attention" line). */
  draftsOnly: boolean;
  onPick: (v: BillView) => void;
  onDrafts: () => void;
  /** Payments narrowed to money on account (the "needs attention" line). */
  onOnAccount: () => void;
  onNew: () => void;
  onOpenInvoice: (id: number) => void;
  /** To another module (Quotes, Deliveries, Sales returns). */
  onNavigate: (route: string) => void;
  counts: RailCounts;
  org: string;
  orgs: Array<{ id: number; name: string }>;
  onOrg: (org: string) => void;
  canCreate: boolean;
  has: (perm: string) => boolean;
}) {
  const [q, setQ] = useState('');
  // Quotes live in CRM and deliveries and returns in Sales & Orders: listed only for whoever has those apps.
  const crm = useCanOpen('crm') && has('crm.view');
  const sales = useCanOpen('sales') && has('oms.view');
  const term = q.trim();
  const hits = useQuery({ queryKey: ['billing', 'search', org, term], queryFn: ({ signal }) => searchBilling(term, org, signal), enabled: term.length >= 2, staleTime: 30_000 });
  const browser = (path = '/billing') => void call('app:openInBrowser', { path });

  const item = (id: BillView, label: string, icon: string, badge?: number, tone?: 'red' | 'amber') => {
    const on = view === id && !(id === 'inv' && draftsOnly);
    const web = !NATIVE.has(id);
    return (
      <button
        key={id}
        type="button"
        title={web ? `${label} — opens in your browser` : label}
        aria-current={on ? 'page' : undefined}
        onClick={() => (web ? browser() : onPick(id))}
        className={cx('relative flex h-[30px] shrink-0 items-center gap-[9px] rounded-[8px] pr-2 pl-2.5 text-left', on ? 'bg-[#EAEDFB] font-bold text-[#1B2A85] dark:bg-selection dark:text-primary' : 'font-medium text-ink hover:bg-subtle')}
      >
        <span className={cx('absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r-[3px]', on ? 'bg-primary' : 'bg-transparent')} />
        <Icon name={icon} size={16} className={cx('shrink-0', on ? 'text-primary' : 'text-ink-3')} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {badge ? (
          <span className={cx('flex h-[18px] min-w-5 shrink-0 items-center justify-center rounded-[9px] px-1.5 text-[11px] font-bold tabular-nums', tone === 'red' ? 'bg-[#E0522F] text-white' : 'bg-[#FFF4E0] text-[#9A4A06] dark:bg-warning-bg dark:text-warning')}>{badge}</span>
        ) : web ? (
          <Icon name="external" size={12} className="shrink-0 text-ink-3" />
        ) : null}
      </button>
    );
  };
  const link = (key: string, label: string, icon: string, go: () => void, title?: string) => (
    <button key={key} type="button" title={title ?? label} onClick={go} className="flex h-[30px] shrink-0 items-center gap-[9px] rounded-[8px] pr-2 pl-2.5 text-left font-medium text-ink hover:bg-subtle">
      <Icon name={icon} size={16} className="shrink-0 text-ink-3" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
  const head = (label: string, warn?: boolean) => <div className={cx('mt-3 mb-0.5 px-2 text-[10.5px] font-bold tracking-[.6px] uppercase', warn ? 'text-[#9A4A06] dark:text-warning' : 'text-ink-3')}>{label}</div>;
  const attention = counts.drafts > 0 || counts.unallocated > 0;

  return (
    <nav aria-label="Billing" className="flex w-[220px] shrink-0 flex-col overflow-hidden border-r border-line bg-[#FBFBFD] text-[13px] text-ink dark:bg-surface">
      <div className="flex flex-col gap-2 px-2.5 pt-3.5 pb-1">
        {orgs.length > 1 ? (
          <Select aria-label="Companies" searchable value={org} onChange={(e) => onOrg(e.target.value)} className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[12px] font-semibold text-ink">
            <option value="">Every company</option>
            {orgs.map((o) => (
              <option key={o.id} value={String(o.id)}>
                {o.name}
              </option>
            ))}
          </Select>
        ) : null}
        {canCreate ? (
          <PrimaryActionButton data-guide="billing.new-invoice" label="New invoice" onClick={onNew} />
        ) : null}
        <div className="relative">
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQ('')} placeholder="Search billing" aria-label="Search billing" className="h-8 w-full rounded-[8px] border border-line bg-surface px-2.5 text-[12.5px] text-ink outline-none focus:border-primary" />
          {term.length >= 2 ? (
            <div role="listbox" aria-label="Billing search results" className="absolute top-9 right-0 left-0 z-30 flex max-h-[360px] flex-col overflow-y-auto rounded-[10px] border border-line bg-surface py-1 shadow-[0_12px_30px_rgb(var(--ws-shadow-rgb)/.18)] scroll-thin">
              {hits.isLoading ? <span className="px-3 py-2 text-[12px] text-ink-3">Searching…</span> : null}
              {!hits.isLoading && !(hits.data ?? []).length ? <span className="px-3 py-2 text-[12px] text-ink-3">Nothing matches.</span> : null}
              {(hits.data ?? []).map((h) => (
                <button
                  key={`${h.type}-${h.id}`}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => {
                    setQ('');
                    if (h.type === 'invoice') onOpenInvoice(h.id);
                    else if (h.type === 'note') onNavigate(`/billing?tab=cn&note=${h.id}`);
                    else if (h.type === 'payment') onNavigate(`/billing?tab=pay&payment=${h.id}`);
                    else onNavigate(`/billing?tab=cus&customer=${h.id}`);
                  }}
                  className="flex flex-col px-3 py-1.5 text-left hover:bg-subtle"
                >
                  <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
                    <span className="truncate">{h.title}</span>
                  </span>
                  <span className="truncate text-[11.5px] text-ink-3">{[h.type === 'note' ? 'Credit or debit note' : h.type.charAt(0).toUpperCase() + h.type.slice(1), h.subtitle, h.meta].filter(Boolean).join(' · ')}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pb-2.5 scroll-thin">
        {item('dash', 'Dashboard', 'grid')}
        {item('inv', 'Invoices', 'receipt', counts.overdue, 'red')}
        {item('pay', 'Payments', 'wallet', counts.unallocated, 'amber')}
        {head('Adjustments')}
        {item('cn', 'Credit notes', 'undo')}
        {item('rec', 'Recurring', 'repeat')}
        {head('Insight')}
        {item('cus', 'Customers', 'users')}
        {item('rep', 'Reports', 'chart')}
        {attention ? head('Needs attention', true) : null}
        {counts.drafts > 0 ? (
          <button type="button" onClick={onDrafts} aria-current={view === 'inv' && draftsOnly ? 'page' : undefined} className={cx('flex h-[29px] shrink-0 items-center rounded-[7px] px-2.5 text-left text-[12.5px] text-[#9A4A06] hover:bg-subtle dark:text-warning', view === 'inv' && draftsOnly && 'bg-[#FFF4E0] font-bold dark:bg-warning-bg')}>
            {counts.drafts} {counts.drafts === 1 ? 'draft' : 'drafts'} not yet issued
          </button>
        ) : null}
        {counts.unallocated > 0 ? (
          <button type="button" onClick={onOnAccount} className="flex h-[29px] shrink-0 items-center rounded-[7px] px-2.5 text-left text-[12.5px] text-[#9A4A06] hover:bg-subtle dark:text-warning">
            {counts.unallocated} {counts.unallocated === 1 ? 'payment' : 'payments'} on account
          </button>
        ) : null}
        {crm || sales ? head('Sales flow') : null}
        {crm ? link('q', 'Quotes', 'file-text', () => onNavigate('/crm?tab=quotes'), 'Quotes — in CRM') : null}
        {sales ? link('d', 'Deliveries', 'truck', () => onNavigate('/sales?tab=ful'), 'Deliveries — in Sales & Orders') : null}
        {sales ? link('sr', 'Sales returns', 'undo', () => onNavigate('/sales?tab=ret'), 'Sales returns — in Sales & Orders') : null}
        {has('billing.settings') ? head('Administration') : null}
        {has('billing.settings') ? item('set', 'Settings', 'settings') : null}
      </div>
    </nav>
  );
}
