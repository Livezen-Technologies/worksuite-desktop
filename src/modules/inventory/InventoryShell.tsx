import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { Spinner } from '../../components/ui';
import type { ModuleProps } from '../registry';
import { can, currencyOf, fetchDashboard, fetchWarehouses, K, useCompanies } from './api';
import { InvRail, NATIVE, type DocHit, type InvView } from './Rail';
import type { TrackTab } from './Tracked';
import type { BuyTab } from './Purchasing';

/**
 * Inventory (the "Inv*" designs): the rail, and the screen it points at.
 * Addressed as `/inventory?tab=dash|prod|stock|mov|adj|trf|cnt|trk`:
 * - a product as `?product=<id>` or `/inventory/products/<id>` (what the
 *   server's notifications and the web's links carry), opened as a drawer
 *   over whichever screen is showing, `&ptab=sales|purchase|history` for a
 *   tab of it;
 * - `&new=1` starts a product, `&edit=<id>` edits one, `&cats=1` manages
 *   the categories;
 * - an adjustment as `?tab=adj&adj=<id>`, a transfer `?tab=trf&trf=<id>`, a
 *   count `?tab=cnt&cnt=<id>`, a serial unit `?tab=trk&tt=serials&serial=<id>`
 *   (`tt=batches|serials|expiring`); `&st=` opens a list on one status;
 * - `&make=adj|trf|cnt|ops` starts an adjustment, a transfer, a count or
 *   opening stock.
 */
const Dashboard = lazy(() => import('./Dashboard'));
const Products = lazy(() => import('./Products'));
const Stock = lazy(() => import('./Stock'));
const Movements = lazy(() => import('./Movements'));
const ProductDrawer = lazy(() => import('./ProductDrawer'));
const ProductSheet = lazy(() => import('./ProductSheet'));
const Categories = lazy(() => import('./Categories'));
const Adjustments = lazy(() => import('./Adjustments'));
const Transfers = lazy(() => import('./Transfers'));
const Counts = lazy(() => import('./Counts'));
const Tracked = lazy(() => import('./Tracked'));
const Opening = lazy(() => import('./Opening'));
const AdjustmentSheet = lazy(() => import('./Adjustments').then((m) => ({ default: m.AdjustmentSheet })));
const TransferSheet = lazy(() => import('./Transfers').then((m) => ({ default: m.TransferSheet })));
const CountSheet = lazy(() => import('./Counts').then((m) => ({ default: m.CountSheet })));
const Purchasing = lazy(() => import('./Purchasing'));
const Vendors = lazy(() => import('./Vendors'));
const OrderSheet = lazy(() => import('./Purchasing').then((m) => ({ default: m.OrderSheet })));
const VendorSheet = lazy(() => import('./Vendors').then((m) => ({ default: m.VendorSheet })));

const TITLES: Record<InvView, string> = {
  dash: 'Dashboard',
  prod: 'Products',
  stock: 'Stock',
  mov: 'Movements',
  adj: 'Adjustments',
  trf: 'Transfers',
  cnt: 'Stock counts',
  trk: 'Batches & serials',
  pur: 'Purchasing',
  ven: 'Vendors',
};
const BUY_TABS = ['orders', 'receipts', 'requests'] as const;
const TRACK_TABS = ['batches', 'serials', 'expiring'] as const;
const ORG_KEY = 'inventory.org';
const num = (v: string | null | undefined) => (v && /^\d+$/.test(v) ? Number(v) : null);

function savedOrg(): string {
  try {
    return localStorage.getItem(ORG_KEY) ?? '';
  } catch {
    return '';
  }
}

export default function InventoryShell(_props: ModuleProps) {
  const { query, path, go } = useTab();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const has = (p: string) => can(perms, p);
  const [org, setOrg] = useState(savedOrg);
  const [warehouse, setWarehouse] = useState<number | null>(null);
  const fromPath = path[path.length - 2] === 'products' ? num(path[path.length - 1]) : null;
  const product = num(query.get('product')) ?? fromPath;
  const editing = num(query.get('edit'));
  const creating = query.get('new') === '1';
  const managing = query.get('cats') === '1';
  const adjId = num(query.get('adj'));
  const trfId = num(query.get('trf'));
  const cntId = num(query.get('cnt'));
  const serialId = num(query.get('serial'));
  const tt: TrackTab = (TRACK_TABS as readonly string[]).includes(query.get('tt') ?? '') ? (query.get('tt') as TrackTab) : serialId ? 'serials' : 'batches';
  const make = query.get('make');
  const bt: BuyTab = (BUY_TABS as readonly string[]).includes(query.get('bt') ?? '') ? (query.get('bt') as BuyTab) : num(query.get('grn')) ? 'receipts' : 'orders';
  const poId = num(query.get('po'));
  const grnId = num(query.get('grn'));
  const vendorId = num(query.get('vendor'));
  const st = query.get('st');
  const asked = (query.get('tab') ?? '') as InvView;
  const view: InvView = asked && NATIVE.has(asked) ? asked : product ? 'prod' : 'dash';
  useTabTitle(`Inventory · ${TITLES[view]}`);

  const companies = useCompanies();
  const list = companies.data ?? [];
  // A company that is no longer held (or never was) reads as every company.
  const scope = org && list.length && !list.some((c) => String(c.id) === org) ? '' : org;
  const currency = currencyOf(list, scope);
  const warehouses = useQuery({
    queryKey: K.warehouses(scope),
    queryFn: ({ signal }) => fetchWarehouses(scope, signal),
    staleTime: 120_000,
  });
  const whs = warehouses.data ?? [];
  const wh = warehouse && whs.some((w) => w.id === warehouse) ? warehouse : null;
  const dash = useQuery({
    queryKey: K.dashboard(scope, wh),
    queryFn: ({ signal }) => fetchDashboard(scope, wh, signal),
    refetchInterval: 60_000,
  });
  const d = dash.data;
  const counts = {
    stock: (d?.totals.low_stock ?? 0) + (d?.totals.out_of_stock ?? 0),
    adj: d?.pending.adjustments ?? 0,
    trf: d?.pending.transfers ?? 0,
    cnt: d?.pending.counts ?? 0,
    pur: d?.pending.purchase_orders ?? 0,
    so: d?.pending.sales_orders ?? 0,
    mfg: d?.pending.assemblies ?? 0,
  };
  // The server's own answer where it has one; the permission list before it arrives.
  const canCost = d?.can.cost ?? has('inventory.cost');
  const canCatalogue = d?.can.catalogue ?? has('inventory.catalogue');
  const canAdjust = d?.can.adjust ?? has('inventory.adjust');
  const canTransfer = d?.can.transfer ?? has('inventory.transfer');
  const canPurchase = d?.can.purchase ?? has('inventory.purchase');

  const chooseOrg = (v: string) => {
    setOrg(v);
    setWarehouse(null);
    try {
      localStorage.setItem(ORG_KEY, v);
    } catch {
      /* a convenience */
    }
  };
  // Where this screen is, without the one-off asks, to come back to.
  const base = (() => {
    const q = new URLSearchParams(query);
    for (const k of ['product', 'ptab', 'new', 'edit', 'cats', 'make']) q.delete(k);
    q.set('tab', view);
    return `/inventory?${q.toString()}`;
  })();
  const openProduct = (id: number | null, ptab?: string) => go(id ? `${base}&product=${id}${ptab && ptab !== 'overview' ? `&ptab=${ptab}` : ''}` : base);
  const withProduct = (extra: string) => go(`${base}${product ? `&product=${product}` : ''}${extra}`);
  // One thing on the address changed, the rest as it was.
  const nav = (patch: Record<string, string | null>, tab: InvView = view) => {
    const q = new URLSearchParams(query);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    q.set('tab', tab);
    go(`/inventory?${q.toString()}`);
  };
  const start = (what: 'adj' | 'trf' | 'cnt' | 'ops' | 'po' | 'vendor') => nav({ make: what });
  const DOC_ROUTES: Record<string, (id: number) => string> = {
    adj: (id) => `/inventory?tab=adj&adj=${id}`,
    trf: (id) => `/inventory?tab=trf&trf=${id}`,
    serial: (id) => `/inventory?tab=trk&tt=serials&serial=${id}`,
    po: (id) => `/inventory?tab=pur&bt=orders&po=${id}`,
    grn: (id) => `/inventory?tab=pur&bt=receipts&grn=${id}`,
    vendor: (id) => `/inventory?tab=ven&vendor=${id}`,
  };
  const openDoc = (hit: DocHit) => go(hit.kind === 'batch' ? '/inventory?tab=trk&tt=batches' : DOC_ROUTES[hit.kind]!(hit.id));
  // The categories open over whatever is showing — the product form
  // included — and closing them leaves it as it was.
  const cats = (on: boolean) => {
    const q = new URLSearchParams(query);
    if (on) q.set('cats', '1');
    else q.delete('cats');
    q.set('tab', view);
    go(`/inventory?${q.toString()}`);
  };

  return (
    <div className="flex h-full min-h-0">
      <InvRail
        view={view}
        onPick={(v) => go(`/inventory?tab=${v}`)}
        onOpenProduct={(id) => openProduct(id)}
        onOpenDoc={openDoc}
        onOpening={canAdjust ? () => start('ops') : null}
        counts={counts}
        org={scope}
        companies={list}
        onOrg={chooseOrg}
        warehouse={wh}
        warehouses={whs}
        onWarehouse={setWarehouse}
        allowed={has}
      />
      <main className="min-w-0 flex-1 overflow-y-auto bg-ground scroll-thin" aria-label={`Inventory · ${TITLES[view]}`}>
        <Suspense fallback={<Spinner />}>
          {view === 'dash' ? (
            <Dashboard
              data={dash}
              org={scope}
              warehouse={wh}
              currency={currency}
              onGo={(v, extra = '') => go(`/inventory?tab=${v}${extra}`)}
              onStock={(filter) => go(`/inventory?tab=stock&filter=${filter}`)}
              onOpenProduct={(id) => openProduct(id)}
              onNewAdjustment={canAdjust ? () => start('adj') : null}
            />
          ) : null}
          {view === 'prod' ? (
            <Products
              org={scope}
              companies={list}
              currency={currency}
              canCost={canCost}
              canCatalogue={canCatalogue}
              openId={product}
              onOpen={(id) => openProduct(id)}
              onNew={() => go(`${base}&new=1`)}
              onEdit={(id) => go(`${base}&edit=${id}`)}
              onManage={() => cats(true)}
            />
          ) : null}
          {view === 'stock' ? <Stock org={scope} warehouse={wh} warehouses={whs} onWarehouse={setWarehouse} currency={currency} initialFilter={query.get('filter')} onOpenProduct={(id) => openProduct(id)} /> : null}
          {view === 'mov' ? <Movements org={scope} warehouse={wh} warehouses={whs} onWarehouse={setWarehouse} onOpenProduct={(id) => openProduct(id, 'history')} /> : null}
          {view === 'adj' ? (
            <Adjustments key={st ?? ''} org={scope} warehouse={wh} warehouses={whs} currency={currency} initialStatus={st} openId={adjId} onOpen={(id) => nav({ adj: id ? String(id) : null })} onNew={canAdjust ? () => start('adj') : null} />
          ) : null}
          {view === 'trf' ? <Transfers key={st ?? ''} org={scope} warehouse={wh} initialStatus={st} openId={trfId} onOpen={(id) => nav({ trf: id ? String(id) : null })} onNew={canTransfer ? () => start('trf') : null} /> : null}
          {view === 'cnt' ? (
            <Counts
              key={st ?? ''}
              org={scope}
              warehouse={wh}
              currency={currency}
              initialStatus={st}
              openId={cntId}
              onOpen={(id) => nav({ cnt: id ? String(id) : null })}
              onNew={canAdjust ? () => start('cnt') : null}
              onOpenAdjustment={(id) => go(`/inventory?tab=adj&adj=${id}`)}
            />
          ) : null}
          {view === 'trk' ? (
            <Tracked
              org={scope}
              warehouse={wh}
              currency={currency}
              tab={tt}
              onTab={(t) => go(`/inventory?tab=trk&tt=${t}`)}
              unitId={serialId}
              onUnit={(id) => nav({ serial: id ? String(id) : null, tt: 'serials' })}
              onOpenProduct={(id) => openProduct(id)}
              onWriteOff={canAdjust ? () => start('adj') : null}
            />
          ) : null}
          {view === 'pur' ? (
            <Purchasing
              org={scope}
              warehouse={wh}
              currency={currency}
              canCost={canCost}
              tab={bt}
              onTab={(t) => go(`/inventory?tab=pur&bt=${t}`)}
              orderId={poId}
              onOrder={(id) => nav({ po: id ? String(id) : null, grn: null })}
              receiptId={grnId}
              onReceipt={(id) => nav(id ? { grn: String(id), po: null, bt: 'receipts' } : { grn: null })}
              onNewOrder={canPurchase ? () => start('po') : null}
              onEditOrder={(id) => nav({ make: 'po', poedit: String(id) })}
              initialStatus={st}
            />
          ) : null}
          {view === 'ven' ? (
            <Vendors
              org={scope}
              currency={currency}
              openId={vendorId}
              onOpen={(id) => nav({ vendor: id ? String(id) : null })}
              onNew={canPurchase ? () => start('vendor') : null}
              onEdit={(id) => nav({ make: 'vendor', vedit: String(id) })}
              onOpenOrder={(id) => go(DOC_ROUTES.po!(id))}
              onOpenReceipt={(id) => go(DOC_ROUTES.grn!(id))}
            />
          ) : null}
        </Suspense>
        <Suspense fallback={null}>
          {product && !creating && !editing ? (
            <ProductDrawer
              key={product}
              id={product}
              org={scope}
              tab={query.get('ptab') ?? 'overview'}
              onTab={(t) => openProduct(product, t)}
              onClose={() => openProduct(null)}
              onEdit={canCatalogue ? () => withProduct(`&edit=${product}`) : undefined}
              onOpenProduct={(id) => openProduct(id)}
            />
          ) : null}
          {creating || editing ? (
            <ProductSheet key={editing ?? 'new'} id={editing} org={scope} companies={list} canCost={canCost} onClose={() => (editing ? openProduct(editing) : go(base))} onSaved={(id) => openProduct(id)} onManageCategories={() => cats(true)} />
          ) : null}
          {managing ? <Categories org={scope} companies={list} onClose={() => cats(false)} /> : null}
          {make === 'adj' ? <AdjustmentSheet org={scope} warehouses={whs} defaultWarehouse={wh} onClose={() => nav({ make: null })} onSaved={(id) => go(`/inventory?tab=adj&adj=${id}`)} /> : null}
          {make === 'trf' ? <TransferSheet org={scope} warehouses={whs} defaultFrom={wh} onClose={() => nav({ make: null })} onSaved={(id) => go(`/inventory?tab=trf&trf=${id}`)} /> : null}
          {make === 'cnt' ? <CountSheet org={scope} warehouses={whs} defaultWarehouse={wh} onClose={() => nav({ make: null })} onSaved={(id) => go(`/inventory?tab=cnt&cnt=${id}`)} /> : null}
          {make === 'po' ? (
            <OrderSheet
              key={query.get('poedit') ?? 'new'}
              org={scope}
              warehouses={whs}
              id={num(query.get('poedit'))}
              defaultWarehouse={wh}
              // Buyers set an order's prices, so its form shows them whether or not they see stock cost.
              canCost={canCost || canPurchase}
              onClose={() => nav({ make: null, poedit: null })}
              onSaved={(id) => go(DOC_ROUTES.po!(id))}
            />
          ) : null}
          {make === 'vendor' ? <VendorSheet key={query.get('vedit') ?? 'new'} id={num(query.get('vedit'))} onClose={() => nav({ make: null, vedit: null })} onSaved={(id) => go(DOC_ROUTES.vendor!(id))} /> : null}
          {make === 'ops' ? <Opening org={scope} warehouses={whs} defaultWarehouse={wh} canCost={canCost} onClose={() => nav({ make: null })} /> : null}
        </Suspense>
      </main>
    </div>
  );
}
