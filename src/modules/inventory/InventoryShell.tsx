import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { Spinner } from '../../components/ui';
import type { ModuleProps } from '../registry';
import { can, currencyOf, fetchDashboard, fetchWarehouses, K, useCompanies } from './api';
import { InvRail, NATIVE, type InvView } from './Rail';

/**
 * Inventory (the "Inv*" designs): the rail, and the screen it points at.
 * Addressed as `/inventory?tab=dash|prod|stock|mov`:
 * - a product as `?product=<id>` or `/inventory/products/<id>` (what the
 *   server's notifications and the web's links carry), opened as a drawer
 *   over whichever screen is showing, `&ptab=sales|purchase|history` for a
 *   tab of it;
 * - `&new=1` starts a product, `&edit=<id>` edits one, `&cats=1` manages
 *   the categories.
 */
const Dashboard = lazy(() => import('./Dashboard'));
const Products = lazy(() => import('./Products'));
const Stock = lazy(() => import('./Stock'));
const Movements = lazy(() => import('./Movements'));
const ProductDrawer = lazy(() => import('./ProductDrawer'));
const ProductSheet = lazy(() => import('./ProductSheet'));
const Categories = lazy(() => import('./Categories'));

const TITLES: Record<InvView, string> = {
  dash: 'Dashboard',
  prod: 'Products',
  stock: 'Stock',
  mov: 'Movements',
};
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
    for (const k of ['product', 'ptab', 'new', 'edit', 'cats']) q.delete(k);
    q.set('tab', view);
    return `/inventory?${q.toString()}`;
  })();
  const openProduct = (id: number | null, ptab?: string) => go(id ? `${base}&product=${id}${ptab && ptab !== 'overview' ? `&ptab=${ptab}` : ''}` : base);
  const withProduct = (extra: string) => go(`${base}${product ? `&product=${product}` : ''}${extra}`);
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
      <InvRail view={view} onPick={(v) => go(`/inventory?tab=${v}`)} onOpenProduct={(id) => openProduct(id)} counts={counts} org={scope} companies={list} onOrg={chooseOrg} warehouse={wh} warehouses={whs} onWarehouse={setWarehouse} allowed={has} />
      <main className="min-w-0 flex-1 overflow-y-auto bg-ground scroll-thin" aria-label={`Inventory · ${TITLES[view]}`}>
        <Suspense fallback={<Spinner />}>
          {view === 'dash' ? (
            <Dashboard data={dash} org={scope} warehouse={wh} currency={currency} onGo={(v) => go(`/inventory?tab=${v}`)} onStock={(filter) => go(`/inventory?tab=stock&filter=${filter}`)} onOpenProduct={(id) => openProduct(id)} />
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
        </Suspense>
      </main>
    </div>
  );
}
