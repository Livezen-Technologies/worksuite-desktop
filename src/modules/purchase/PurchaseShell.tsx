import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { ApiError } from '../../core/api';
import { useTab, useTabTitle } from '../../core/tab-context';
import { Spinner } from '../../components/ui';
import { SidePanel } from '../../components/SidePanel';
import { recallOrgChoice, rememberOrgChoice } from '../../core/org-prefs';
import type { ModuleProps } from '../registry';
import { currencyOf, fetchWarehouses, K, useCompanies } from '../inventory/api';
import { fetchApprovals, fetchDashboard, KP, usePurchaseCan } from './api';
import { NATIVE, PurRail, TITLES, type PurHit, type PurView } from './Rail';

/**
 * Purchasing (SRS-PUR-001 G-21; the "Desktop Purchasing" and "Desktop receiving" designs): its own app over Inventory,
 * the rail and the screen it points at. Addressed as `/purchase?tab=dash|appr|req|rfq|po|rcv|grn|qc|rpl|agr|bill|pay|run|ret|ven|rep`:
 * - a document as `?po=<id>`, `?grn=<id>`, `?request=<id>`, `?rfq=<id>`, `?bill=<id>`, `?run=<id>`, `?return=<id>`,
 *   `?vendor=<id>`, `?agreement=<id>` — or the web's own paths, `/purchase/orders/<id>`, `/purchase/bills/<id>`… (what
 *   the server's notifications and shares carry), each opening its screen with the document;
 * - `?tab=rcv&po=<id>` receives against an order by scan; `&st=` opens a list on one status;
 * - `&make=po|vendor|request|return` starts an order (`&poedit=<id>` edits one), a vendor (`&vedit=`), a request, or a
 *   return from a posted receipt (`&grn=<id>`).
 * Inventory's purchasing entries (its rail, dashboard and replenishment) open here.
 */
const Dashboard = lazy(() => import('./Dashboard'));
const Approvals = lazy(() => import('./Approvals'));
const Requests = lazy(() => import('./Requests'));
const RequestSheet = lazy(() => import('./Requests').then((m) => ({ default: m.RequestSheet })));
const Rfqs = lazy(() => import('./Rfqs'));
const Orders = lazy(() => import('./Orders'));
const OrderSheet = lazy(() => import('./Purchasing').then((m) => ({ default: m.OrderSheet })));
const Receive = lazy(() => import('./Receive'));
const Receipts = lazy(() => import('./Purchasing').then((m) => ({ default: m.Receipts })));
const ReceiptPanel = lazy(() => import('./Purchasing').then((m) => ({ default: m.ReceiptPanel })));
const Qc = lazy(() => import('./Qc'));
const Replenishment = lazy(() => import('./Replenishment'));
const Agreements = lazy(() => import('./Agreements'));
const Bills = lazy(() => import('./Bills'));
const Payments = lazy(() => import('./Payments'));
const PaymentRuns = lazy(() => import('./PaymentRuns'));
const Returns = lazy(() => import('./Returns'));
const ReturnSheet = lazy(() => import('./Returns').then((m) => ({ default: m.ReturnSheet })));
const Vendors = lazy(() => import('./Vendors'));
const VendorSheet = lazy(() => import('./Vendors').then((m) => ({ default: m.VendorSheet })));
const Reports = lazy(() => import('./Reports'));
const LandedCosts = lazy(() => import('./LandedCosts'));

const ORG_KEY = 'purchase.org';
const num = (v: string | null | undefined) => (v && /^\d+$/.test(v) ? Number(v) : null);

/** The web's record paths: `/purchase/<kind>/<id>` → the screen and the address key it opens with. */
const BY_PATH: Record<string, [PurView, string]> = {
  orders: ['po', 'po'],
  'purchase-orders': ['po', 'po'],
  requests: ['req', 'request'],
  rfqs: ['rfq', 'rfq'],
  quotations: ['rfq', 'rfq'],
  receipts: ['grn', 'grn'],
  bills: ['bill', 'bill'],
  'payment-runs': ['run', 'run'],
  returns: ['ret', 'return'],
  vendors: ['ven', 'vendor'],
  agreements: ['agr', 'agreement'],
};
/** Which screen an address key belongs to, when no tab is named. */
const KEY_VIEW: Array<[string, PurView]> = [['po', 'po'], ['order', 'po'], ['grn', 'grn'], ['request', 'req'], ['rfq', 'rfq'], ['bill', 'bill'], ['run', 'run'], ['return', 'ret'], ['vendor', 'ven'], ['agreement', 'agr']];

function savedOrg(): string {
  try {
    return recallOrgChoice('purchase') ?? localStorage.getItem(ORG_KEY) ?? '';
  } catch {
    return '';
  }
}

export default function PurchaseShell(_props: ModuleProps) {
  const { query, path, go } = useTab();
  const c = usePurchaseCan();
  const [org, setOrg] = useState(savedOrg);
  const fromPath = BY_PATH[path[1] ?? ''];
  const pathId = num(path[2]);
  // The server's own links name an order `?order=<id>` (PurchaseApprovals::DOCS).
  const id = (key: string) => num(query.get(key)) ?? (key === 'po' ? num(query.get('order')) : null) ?? (fromPath && fromPath[1] === key ? pathId : null);
  const asked = (query.get('tab') ?? '') as PurView;
  const implied = (fromPath && pathId ? fromPath[0] : null) ?? KEY_VIEW.find(([k]) => num(query.get(k)))?.[1] ?? null;
  const view: PurView = asked && NATIVE.has(asked) ? asked : (implied ?? 'dash');
  const make = query.get('make');
  const st = query.get('st');
  useTabTitle(`Purchasing · ${TITLES[view]}`);

  const companies = useCompanies();
  const list = companies.data ?? [];
  const scope = org && list.length && !list.some((x) => String(x.id) === org) ? '' : org;
  const currency = currencyOf(list, scope);
  const warehouses = useQuery({ queryKey: K.warehouses(scope), queryFn: ({ signal }) => fetchWarehouses(scope, signal), staleTime: 120_000 });
  const whs = warehouses.data ?? [];
  const dash = useQuery({ queryKey: KP.dash(scope), queryFn: ({ signal }) => fetchDashboard(scope, signal), refetchInterval: 60_000 });
  const queue = useQuery({
    queryKey: KP.approvals(scope),
    queryFn: ({ signal }) => fetchApprovals(scope, signal),
    refetchInterval: 60_000,
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });
  const d = dash.data;
  const counts = {
    approvals: queue.data?.length ?? 0,
    requests: Number(d?.counts?.requests_pending ?? d?.counts?.pending_requests ?? 0) || 0,
    orders: d?.awaiting.approval ?? 0,
    receiving: d?.awaiting.receipt ?? 0,
    bills: d?.attention.overdue_bills.length ?? 0,
  };

  const chooseOrg = (v: string) => {
    setOrg(v);
    rememberOrgChoice('purchase', v);
    try {
      localStorage.setItem(ORG_KEY, v);
    } catch {
      /* a convenience */
    }
  };
  // One thing on the address changed, the rest as it was.
  const nav = (patch: Record<string, string | null>, tab: PurView = view) => {
    const q = new URLSearchParams(query);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    q.set('tab', tab);
    go(`/purchase?${q.toString()}`);
  };
  const to = {
    order: (oid: number) => go(`/purchase?tab=po&po=${oid}`),
    receipt: (gid: number) => go(`/purchase?tab=grn&grn=${gid}`),
    receive: (oid: number) => go(`/purchase?tab=rcv&po=${oid}`),
    vendor: (vid: number) => go(`/purchase?tab=ven&vendor=${vid}`),
    bill: (bid: number) => go(`/purchase?tab=bill&bill=${bid}`),
    request: (rid: number) => go(`/purchase?tab=req&request=${rid}`),
    ret: (rid: number) => go(`/purchase?tab=ret&return=${rid}`),
    rfq: (qid: number) => go(`/purchase?tab=rfq&rfq=${qid}`),
  };
  const openHit = (h: PurHit) => (h.kind === 'po' ? to.order(h.id) : h.kind === 'grn' ? to.receipt(h.id) : to.vendor(h.id));
  const newOrder = c.order ? () => nav({ make: 'po', poedit: null }) : null;

  return (
    <div className="flex h-full min-h-0">
      <SidePanel id="purchase" label="the Purchasing menu">
        <PurRail view={view} onPick={(v) => go(`/purchase?tab=${v}`)} onNew={newOrder} onOpen={openHit} counts={counts} org={scope} companies={list} onOrg={chooseOrg} canOrder={c.order} />
      </SidePanel>
      <main className="min-w-0 flex-1 overflow-y-auto bg-ground scroll-thin" aria-label={`Purchasing · ${TITLES[view]}`}>
        <Suspense fallback={<Spinner />}>
          {view === 'dash' ? <Dashboard data={dash} queue={queue.data ?? null} currency={currency} onGo={(v, extra = '') => go(`/purchase?tab=${v}${extra}`)} onOrder={to.order} onBill={to.bill} onNewOrder={newOrder} /> : null}
          {view === 'appr' ? <Approvals org={scope} q={queue} onOpen={(doc, oid) => (doc === 'order' ? to.order(oid) : doc === 'bill' ? to.bill(oid) : doc === 'request' ? to.request(oid) : to.ret(oid))} /> : null}
          {view === 'req' ? <Requests key={st ?? ''} org={scope} warehouse={null} openId={id('request')} initialStatus={st} onNew={c.request ? () => nav({ make: 'request' }) : null} onOrders={() => go('/purchase?tab=po&st=draft')} onRfq={to.rfq} /> : null}
          {view === 'rfq' ? <Rfqs org={scope} currency={currency} openId={id('rfq')} onOpen={(qid) => nav({ rfq: qid ? String(qid) : null })} onOrder={to.order} /> : null}
          {view === 'po' ? (
            <Orders
              key={st ?? ''}
              org={scope}
              currency={currency}
              openId={id('po')}
              initialStatus={st}
              onOpen={(oid) => nav({ po: oid ? String(oid) : null })}
              onNew={newOrder}
              onEdit={(oid) => nav({ make: 'po', poedit: String(oid) })}
              onReceive={to.receive}
              onReceipt={to.receipt}
              onBill={to.bill}
              onReturn={to.ret}
            />
          ) : null}
          {view === 'rcv' ? <Receive key={id('po') ?? 'scan'} org={scope} orderId={id('po')} onOrder={(oid) => (oid ? to.receive(oid) : go('/purchase?tab=rcv'))} onReceipt={to.receipt} onOpenOrder={to.order} /> : null}
          {view === 'grn' ? (
            <div className="flex h-full min-h-0 flex-col gap-3 px-6 py-5">
              <h1 className="m-0 text-[20px] font-bold text-ink">Goods received</h1>
              <Receipts org={scope} warehouse={null} openId={id('grn')} onOpen={(gid) => nav({ grn: String(gid) })} />
            </div>
          ) : null}
          {view === 'qc' ? <Qc org={scope} onReceipt={to.receipt} onReturn={to.ret} /> : null}
          {view === 'rpl' ? <Replenishment org={scope} warehouse={null} warehouses={whs} canPurchase={c.request} onRequests={() => go('/purchase?tab=req')} /> : null}
          {view === 'agr' ? <Agreements org={scope} openId={id('agreement')} onOpen={(aid) => nav({ agreement: aid ? String(aid) : null })} onOrder={to.order} /> : null}
          {view === 'bill' ? <Bills key={st ?? ''} org={scope} currency={currency} openId={id('bill')} initialStatus={st} onOpen={(bid) => nav({ bill: bid ? String(bid) : null })} onOrder={to.order} /> : null}
          {view === 'pay' ? <Payments org={scope} currency={currency} /> : null}
          {view === 'run' ? <PaymentRuns org={scope} currency={currency} openId={id('run')} onOpen={(rid) => nav({ run: rid ? String(rid) : null })} /> : null}
          {view === 'ret' ? <Returns key={st ?? ''} org={scope} openId={id('return')} initialStatus={st} onOpen={(rid) => nav({ return: rid ? String(rid) : null })} onOrder={to.order} onReceipt={to.receipt} /> : null}
          {view === 'ven' ? (
            <Vendors
              org={scope}
              currency={currency}
              openId={id('vendor')}
              onOpen={(vid) => nav({ vendor: vid ? String(vid) : null })}
              onNew={c.order ? () => nav({ make: 'vendor', vedit: null }) : null}
              onEdit={(vid) => nav({ make: 'vendor', vedit: String(vid) })}
              onOpenOrder={to.order}
              onOpenReceipt={to.receipt}
            />
          ) : null}
          {view === 'lcv' ? <LandedCosts org={scope} currency={currency} onOrder={to.order} onReceipt={to.receipt} /> : null}
          {view === 'rep' ? <Reports org={scope} currency={currency} report={query.get('r')} onReport={(r) => go(`/purchase?tab=rep&r=${r}`)} /> : null}
        </Suspense>
        <Suspense fallback={null}>
          {view === 'grn' && id('grn') ? <ReceiptPanel key={id('grn')} id={id('grn')!} currency={currency} onClose={() => nav({ grn: null })} onOrder={to.order} onReturn={c.order ? (gid) => nav({ make: 'return', grn: String(gid) }) : null} /> : null}
          {make === 'po' ? (
            <OrderSheet
              key={query.get('poedit') ?? 'new'}
              org={scope}
              warehouses={whs}
              id={num(query.get('poedit'))}
              // Buyers set an order's prices, so its form shows them whether or not they see stock cost.
              canCost={c.cost || c.order}
              onClose={() => nav({ make: null, poedit: null })}
              onSaved={to.order}
            />
          ) : null}
          {make === 'vendor' ? <VendorSheet key={query.get('vedit') ?? 'new'} id={num(query.get('vedit'))} onClose={() => nav({ make: null, vedit: null })} onSaved={to.vendor} /> : null}
          {make === 'request' ? <RequestSheet org={scope} warehouses={whs} onClose={() => nav({ make: null })} onSaved={to.request} /> : null}
          {make === 'return' && id('grn') ? <ReturnSheet org={scope} grnId={id('grn')!} onClose={() => nav({ make: null })} onSaved={to.ret} /> : null}
        </Suspense>
      </main>
    </div>
  );
}
