import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { call } from '../../core/bridge';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { cx } from '../../components/ui';
import { HIT_LABEL, HIT_VIEW, hitProduct, K, searchInventory, WEB_VIEW, type Company, type SearchHit, type Warehouse } from './api';

/**
 * The Inventory rail (InvRail): the company and warehouse pickers, a box that
 * takes a scan or a search, then the screens by what they are for — control,
 * trade, insight, setup and administration. Dashboard, Products, Stock,
 * Movements and the control screens (adjustments, transfers, counts, batches
 * and serials) are here; the rest open in the browser for now. The warehouse is
 * a filter, not a mode: it narrows the dashboard, stock and movements, and a
 * document that names its own warehouse ignores it.
 */
export type InvView = 'dash' | 'prod' | 'stock' | 'mov' | 'adj' | 'trf' | 'cnt' | 'trk' | 'pur' | 'ven';
export type WebView = keyof typeof WEB_VIEW;

export const NATIVE = new Set<string>(['dash', 'prod', 'stock', 'mov', 'adj', 'trf', 'cnt', 'trk', 'pur', 'ven']);

/** A search hit this app opens itself, other than a product. */
export type DocHit = { kind: 'adj' | 'trf' | 'serial' | 'po' | 'grn' | 'vendor'; id: number } | { kind: 'batch' };

/** The screens that need more than `inventory.view`; the rail leaves out what you cannot open. */
export const NEEDS: Partial<Record<WebView, string>> = {
  set: 'inventory.settings',
};

export interface RailCounts {
  stock: number;
  adj: number;
  trf: number;
  cnt: number;
  pur: number;
  so: number;
  mfg: number;
}

export function openWeb(view: string, extra = '') {
  void call('app:openInBrowser', { path: `/inventory?view=${view}${extra}` });
}

export function InvRail({
  view,
  onPick,
  onOpenProduct,
  onOpenDoc,
  onOpening,
  counts,
  org,
  companies,
  onOrg,
  warehouse,
  warehouses,
  onWarehouse,
  allowed,
}: {
  view: InvView;
  onPick: (v: InvView) => void;
  onOpenProduct: (id: number) => void;
  onOpenDoc: (hit: DocHit) => void;
  /** Record opening stock, for those who may adjust stock. */
  onOpening: (() => void) | null;
  counts: RailCounts;
  org: string;
  companies: Company[];
  onOrg: (org: string) => void;
  warehouse: number | null;
  warehouses: Warehouse[];
  onWarehouse: (id: number | null) => void;
  allowed: (perm: string) => boolean;
}) {
  const [q, setQ] = useState('');
  const term = q.trim();
  const hits = useQuery({
    queryKey: K.search(org, term),
    queryFn: ({ signal }) => searchInventory(term, org, signal),
    enabled: term.length >= 2,
    staleTime: 30_000,
  });

  const choose = (h: SearchHit) => {
    setQ('');
    // Documents and units this app shows open here; the rest in the browser.
    if (h.type === 'adjustment') return onOpenDoc({ kind: 'adj', id: h.id });
    if (h.type === 'transfer') return onOpenDoc({ kind: 'trf', id: h.id });
    if (h.type === 'serial') return onOpenDoc({ kind: 'serial', id: h.id });
    if (h.type === 'batch') return onOpenDoc({ kind: 'batch' });
    if (h.type === 'purchase_order') return onOpenDoc({ kind: 'po', id: h.id });
    if (h.type === 'receipt') return onOpenDoc({ kind: 'grn', id: h.id });
    if (h.type === 'vendor') return onOpenDoc({ kind: 'vendor', id: h.id });
    const pid = hitProduct(h);
    if (pid) onOpenProduct(pid);
    else openWeb(HIT_VIEW[h.type] ?? 'overview');
  };

  const item = (id: InvView | WebView, label: string, icon: string, badge?: number, tone?: 'amber') => {
    const web = !NATIVE.has(id);
    if (web && NEEDS[id as WebView] && !allowed(NEEDS[id as WebView]!)) return null;
    const on = view === id;
    return (
      <button
        key={id}
        type="button"
        title={web ? `${label} — opens in your browser` : label}
        aria-current={on ? 'page' : undefined}
        onClick={() => (web ? openWeb(WEB_VIEW[id as WebView]) : onPick(id as InvView))}
        className={cx('relative flex h-[30px] shrink-0 items-center gap-[9px] rounded-[8px] pr-2 pl-2.5 text-left', on ? 'bg-[#EAEDFB] font-bold text-[#1B2A85] dark:bg-selection dark:text-primary' : 'font-medium text-ink hover:bg-subtle')}
      >
        <span className={cx('absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r-[3px]', on ? 'bg-primary' : 'bg-transparent')} />
        <Icon name={icon} size={16} className={cx('shrink-0', on ? 'text-primary' : 'text-ink-3')} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {badge ? (
          <span
            className={cx(
              'flex h-[18px] min-w-5 shrink-0 items-center justify-center rounded-[9px] px-1.5 text-[11px] font-bold tabular-nums',
              tone === 'amber' ? 'bg-[#FFF4E0] text-[#9A4A06] dark:bg-warning-bg dark:text-warning' : 'bg-subtle text-ink-2',
            )}
          >
            {badge}
          </span>
        ) : web ? (
          <Icon name="external" size={12} className="shrink-0 text-ink-3" />
        ) : null}
      </button>
    );
  };
  const head = (label: string) => <div className="mt-3 mb-0.5 px-2 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">{label}</div>;
  const results = hits.data?.results ?? [];
  const exact = hits.data?.exact ?? null;

  return (
    <nav aria-label="Inventory" className="flex w-[220px] shrink-0 flex-col overflow-hidden border-r border-line bg-[#FBFBFD] text-[13px] text-ink dark:bg-surface">
      <div className="flex flex-col gap-2 px-2.5 pt-3.5 pb-1">
        {companies.length > 1 ? (
          <Select aria-label="Companies" searchable value={org} onChange={(e) => onOrg(e.target.value)} className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[12px] font-semibold text-ink">
            <option value="">Every company</option>
            {companies.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </Select>
        ) : null}
        <Select
          aria-label="Warehouses"
          value={warehouse ? String(warehouse) : ''}
          onValueChange={(v) => onWarehouse(v ? Number(v) : null)}
          options={[
            { value: '', label: 'All warehouses' },
            ...warehouses.map((w) => ({
              value: String(w.id),
              label: w.name,
              hint: w.code,
            })),
          ]}
          className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[12px] font-semibold text-ink"
        />
        <div className="relative">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQ('');
              // A scanner types the code and presses Enter: an exact code,
              // barcode or serial opens straight away.
              if (e.key === 'Enter' && exact) choose(exact);
              else if (e.key === 'Enter' && results.length === 1) choose(results[0]!);
            }}
            placeholder="Scan or search…"
            aria-label="Scan or search"
            className="h-8 w-full rounded-[8px] border border-line bg-surface px-2.5 text-[12.5px] text-ink outline-none focus:border-primary"
          />
          {term.length >= 2 ? (
            <div
              role="listbox"
              aria-label="Inventory search results"
              className="absolute top-9 right-0 left-0 z-30 flex max-h-[380px] flex-col overflow-y-auto rounded-[10px] border border-line bg-surface py-1 shadow-[0_12px_30px_rgb(var(--ws-shadow-rgb)/.18)] scroll-thin"
            >
              {hits.isLoading ? <span className="px-3 py-2 text-[12px] text-ink-3">Searching…</span> : null}
              {!hits.isLoading && !results.length && !exact ? <span className="px-3 py-2 text-[12px] text-ink-3">Nothing matches.</span> : null}
              {[...(exact && !results.some((r) => r.type === exact.type && r.id === exact.id) ? [exact] : []), ...results].map((h) => {
                const web = !hitProduct(h) && !['adjustment', 'transfer', 'serial', 'batch', 'purchase_order', 'receipt', 'vendor'].includes(h.type);
                return (
                  <button key={`${h.type}-${h.id}`} type="button" role="option" aria-selected={exact?.type === h.type && exact.id === h.id} onClick={() => choose(h)} className="flex items-start gap-1.5 px-3 py-1.5 text-left hover:bg-subtle">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[12.5px] font-semibold text-ink">{h.type === 'product' || h.type === 'serial' || h.type === 'batch' ? h.label : (h.code ?? h.label)}</span>
                      <span className="truncate text-[11.5px] text-ink-3">{[HIT_LABEL[h.type] ?? h.type, h.type === 'product' || h.type === 'serial' || h.type === 'batch' ? h.code : h.label].filter(Boolean).join(' · ')}</span>
                    </span>
                    {web ? <Icon name="external" size={12} className="mt-1 shrink-0 text-ink-3" /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pb-2.5 scroll-thin">
        {item('dash', 'Dashboard', 'grid')}
        {item('prod', 'Products', 'package')}
        {item('stock', 'Stock', 'box', counts.stock, 'amber')}
        {item('mov', 'Movements', 'transfers')}
        {head('Control')}
        {item('adj', 'Adjustments', 'sliders', counts.adj)}
        {item('trf', 'Transfers', 'truck', counts.trf)}
        {item('cnt', 'Stock counts', 'list-todo', counts.cnt)}
        {item('trk', 'Batches & serials', 'tag')}
        {head('Trade')}
        {item('pur', 'Purchasing', 'cart', counts.pur)}
        {item('so', 'Sales orders', 'receipt', counts.so)}
        {item('ven', 'Vendors', 'building')}
        {item('mfg', 'Manufacturing', 'wrench', counts.mfg)}
        {head('Insight')}
        {item('rep', 'Reports', 'chart')}
        {item('rpl', 'Replenishment', 'refresh')}
        {head('Setup')}
        {item('lk', 'Brands & units', 'hash')}
        {onOpening ? (
          <button type="button" onClick={onOpening} className="flex h-[29px] shrink-0 items-center rounded-[7px] px-2.5 text-left text-[12.5px] font-semibold text-primary hover:bg-subtle">
            Record opening stock
          </button>
        ) : null}
        {head('Administration')}
        {item('set', 'Settings', 'settings')}
        {item('acc', 'My access', 'shield-check')}
      </div>
    </nav>
  );
}
