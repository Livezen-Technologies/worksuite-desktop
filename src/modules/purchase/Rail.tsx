import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { OrgSwitcher } from '../../components/OrgSwitcher';
import { PrimaryActionButton } from '../../components/PrimaryAction';
import { cx } from '../../components/ui';
import { HIT_LABEL, K, searchInventory, type Company, type SearchHit } from '../inventory/api';

/**
 * The Purchasing rail (the "Desktop Purchasing" design): the company picker, New order, a box that takes a scan or a
 * search, then the screens in the order the work runs — before the order, buying, paying, who we buy from — as the
 * web's module rail does (SRS-PUR-001 §10). Counts come from the dashboard and the approvals queue.
 */
export type PurView = 'dash' | 'appr' | 'req' | 'rfq' | 'po' | 'rcv' | 'grn' | 'qc' | 'lcv' | 'rpl' | 'agr' | 'bill' | 'pay' | 'run' | 'ret' | 'ven' | 'rep';

export const NATIVE = new Set<PurView>(['dash', 'appr', 'req', 'rfq', 'po', 'rcv', 'grn', 'qc', 'lcv', 'rpl', 'agr', 'bill', 'pay', 'run', 'ret', 'ven', 'rep']);

export const TITLES: Record<PurView, string> = {
  dash: 'Dashboard',
  appr: 'Waiting on me',
  req: 'Requests',
  rfq: 'RFQs',
  po: 'Purchase orders',
  rcv: 'Receiving',
  grn: 'Goods received',
  qc: 'Quality hold',
  lcv: 'Landed costs',
  rpl: 'Replenishment',
  agr: 'Agreements',
  bill: 'Vendor bills',
  pay: 'Payments',
  run: 'Payment runs',
  ret: 'Returns',
  ven: 'Vendors',
  rep: 'Reports',
};

export interface RailCounts {
  approvals: number;
  requests: number;
  orders: number;
  receiving: number;
  bills: number;
}

/** A search hit this app opens itself. */
export type PurHit = { kind: 'po' | 'grn' | 'vendor'; id: number };

export function PurRail({
  view,
  onPick,
  onNew,
  onOpen,
  counts,
  org,
  companies,
  onOrg,
  canOrder,
}: {
  view: PurView;
  onPick: (v: PurView) => void;
  onNew: (() => void) | null;
  onOpen: (hit: PurHit) => void;
  counts: RailCounts;
  org: string;
  companies: Company[];
  onOrg: (org: string) => void;
  canOrder: boolean;
}) {
  const [q, setQ] = useState('');
  const term = q.trim();
  const hits = useQuery({ queryKey: [...K.search(org, term), 'purchase'], queryFn: ({ signal }) => searchInventory(term, org, signal), enabled: term.length >= 2, staleTime: 30_000 });
  const ours = (h: SearchHit) => h.type === 'purchase_order' || h.type === 'receipt' || h.type === 'vendor';
  const results = (hits.data?.results ?? []).filter(ours);
  const exact = hits.data?.exact && ours(hits.data.exact) ? hits.data.exact : null;
  const choose = (h: SearchHit) => {
    setQ('');
    onOpen({ kind: h.type === 'purchase_order' ? 'po' : h.type === 'receipt' ? 'grn' : 'vendor', id: h.id });
  };

  const item = (id: PurView, label: string, icon: string, badge?: number, tone?: 'amber' | 'red') => {
    const on = view === id;
    return (
      <button
        key={id}
        type="button"
        title={label}
        aria-current={on ? 'page' : undefined}
        onClick={() => onPick(id)}
        className={cx('relative flex h-[30px] shrink-0 items-center gap-[9px] rounded-[8px] pr-2 pl-2.5 text-left', on ? 'bg-info-bg font-bold text-info-ink dark:bg-selection dark:text-primary' : 'font-medium text-ink hover:bg-subtle')}
      >
        <span className={cx('absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r-[3px]', on ? 'bg-primary' : 'bg-transparent')} />
        <Icon name={icon} size={16} className={cx('shrink-0', on ? 'text-primary' : 'text-ink-3')} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {badge ? (
          <span className={cx('flex h-[18px] min-w-5 shrink-0 items-center justify-center rounded-[9px] px-1.5 text-[11px] font-bold tabular-nums', tone === 'red' ? 'bg-red text-white' : tone === 'amber' ? 'bg-warning-bg text-warning-ink dark:bg-warning-bg dark:text-warning' : 'bg-subtle text-ink-2')}>
            {badge}
          </span>
        ) : null}
      </button>
    );
  };
  const head = (label: string) => <div className="mt-3 mb-0.5 px-2 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">{label}</div>;

  return (
    <nav aria-label="Purchasing" className="flex w-[220px] shrink-0 flex-col overflow-hidden border-r border-line bg-rail text-[13px] text-ink dark:bg-surface">
      <div className="flex flex-col gap-2 px-2.5 pt-3.5 pb-1">
        {companies.length > 1 ? <OrgSwitcher variant="field" orgs={companies.map((c) => ({ id: String(c.id), name: c.name }))} value={org ? [org] : []} onChange={(ids) => onOrg(ids[0] ?? '')} /> : null}
        {canOrder && onNew ? <PrimaryActionButton data-guide="purchase.new-order" label="New order" onClick={onNew} /> : null}
        <div className="relative">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQ('');
              // A scanner types the order's number and presses Enter: an exact one opens straight away.
              if (e.key === 'Enter' && exact) choose(exact);
              else if (e.key === 'Enter' && results.length === 1) choose(results[0]!);
            }}
            placeholder="Scan or search…"
            aria-label="Search purchasing"
            className="h-8 w-full rounded-[8px] border border-line bg-surface px-2.5 text-[12.5px] text-ink outline-none focus:border-primary"
          />
          {term.length >= 2 ? (
            <div role="listbox" aria-label="Purchasing search results" className="absolute top-9 right-0 left-0 z-30 flex max-h-[360px] flex-col overflow-y-auto rounded-[10px] border border-line bg-surface py-1 shadow-[0_12px_30px_rgb(var(--ws-shadow-rgb)/.18)] scroll-thin">
              {hits.isLoading ? <span className="px-3 py-2 text-[12px] text-ink-3">Searching…</span> : null}
              {!hits.isLoading && !results.length && !exact ? <span className="px-3 py-2 text-[12px] text-ink-3">Nothing matches.</span> : null}
              {[...(exact && !results.some((r) => r.type === exact.type && r.id === exact.id) ? [exact] : []), ...results].map((h) => (
                <button key={`${h.type}-${h.id}`} type="button" role="option" aria-selected={exact?.type === h.type && exact.id === h.id} onClick={() => choose(h)} className="flex flex-col px-3 py-1.5 text-left hover:bg-subtle">
                  <span className="truncate text-[12.5px] font-semibold text-ink">{h.code ?? h.label}</span>
                  <span className="truncate text-[11.5px] text-ink-3">{[HIT_LABEL[h.type] ?? h.type, h.code ? h.label : null].filter(Boolean).join(' · ')}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pb-2.5 scroll-thin">
        {item('dash', 'Dashboard', 'grid')}
        {item('appr', 'Waiting on me', 'check-check', counts.approvals, 'red')}
        {head('Before the order')}
        {item('req', 'Requests', 'list-todo', counts.requests, 'amber')}
        {item('rfq', 'RFQs', 'handshake')}
        {item('agr', 'Agreements', 'file-text')}
        {head('Buying')}
        {item('po', 'Purchase orders', 'cart', counts.orders, 'amber')}
        {item('rcv', 'Receiving', 'scan', counts.receiving)}
        {item('grn', 'Goods received', 'package')}
        {item('qc', 'Quality hold', 'shield-alert')}
        {item('lcv', 'Landed costs', 'truck')}
        {item('rpl', 'Replenishment', 'refresh')}
        {head('Paying')}
        {item('bill', 'Vendor bills', 'receipt', counts.bills, 'red')}
        {item('pay', 'Payments', 'wallet')}
        {item('run', 'Payment runs', 'banknote')}
        {item('ret', 'Returns', 'undo')}
        {head('Who we buy from')}
        {item('ven', 'Vendors', 'building')}
        {item('rep', 'Reports', 'chart')}
      </div>
    </nav>
  );
}
