import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { Icon } from '../../components/Icon';
import { Spinner, cx } from '../../components/ui';
import type { ModuleProps } from '../registry';
import { can, closeTab, fetchDashboard, fetchInvoice, invoiceName, K, openTab, useBillingOrgs } from './api';
import { BillRail, NATIVE, type BillView } from './Rail';
import { SidePanel } from '../../components/SidePanel';

/**
 * Billing (the "Bill*" designs): the rail, and the screen it points at.
 * Addressed as `/billing?tab=dash|inv|pay|cn|rec|cus|rep|set`:
 * - an invoice as `?invoice=<id>` or `/billing/invoices/<id>` (what the
 *   server's notifications and shares link to), opened as a tab above the
 *   list; `&status=` narrows the list;
 * - a payment as `?tab=pay&payment=<id>` (`&unallocated=1` for money on
 *   account); a note as `?tab=cn&note=<id>` (`&kind=debit`); a customer as
 *   `?tab=cus&customer=<id>`; a recurring profile as `?tab=rec&profile=<id>`;
 * - `&new=1` starts whatever the screen makes (an invoice, a note — with
 *   `&against=<invoice>` — or a profile) and `&pay=1` records a payment.
 */
const Dashboard = lazy(() => import('./Dashboard'));
const Invoices = lazy(() => import('./Invoices'));
const InvoiceView = lazy(() => import('./InvoiceView'));
const NewInvoice = lazy(() => import('./NewInvoice'));
const RecordPayment = lazy(() => import('./RecordPayment'));
const Payments = lazy(() => import('./Payments'));
const Notes = lazy(() => import('./Notes'));
const Customers = lazy(() => import('./Customers'));
const Recurring = lazy(() => import('./Recurring'));
const BillReports = lazy(() => import('./BillReports'));
const BillSettings = lazy(() => import('./BillSettings'));

const TITLES: Record<BillView, string> = { dash: 'Dashboard', inv: 'Invoices', pay: 'Payments', cn: 'Credit notes', rec: 'Recurring', cus: 'Customers', rep: 'Reports', set: 'Settings' };
const ORG_KEY = 'billing.org';
const num = (v: string | null | undefined) => (v && /^\d+$/.test(v) ? Number(v) : null);

function savedOrg(): string {
  try {
    return localStorage.getItem(ORG_KEY) ?? '';
  } catch {
    return '';
  }
}

export default function BillingShell(_props: ModuleProps) {
  const { query, path, go, navigate } = useTab();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const has = (p: string) => (p.startsWith('billing.') ? can(perms, p) : !!perms && (perms.includes('*') || perms.includes(p)));
  const requestedOrg = query.get('org');
  const [org, setOrg] = useState(() => requestedOrg ?? savedOrg());
  const [seenOrg, setSeenOrg] = useState(requestedOrg);
  if (seenOrg !== requestedOrg) {
    setSeenOrg(requestedOrg);
    if (requestedOrg !== null) setOrg(requestedOrg);
  }
  const fromPath = path[path.length - 2] === 'invoices' ? num(path[path.length - 1]) : null;
  const invoice = num(query.get('invoice')) ?? fromPath;
  const creating = query.get('new') === '1';
  const paying = query.get('pay') === '1';
  const narrow = query.get('status');
  const asked = (query.get('tab') ?? '') as BillView;
  const view: BillView = asked && NATIVE.has(asked) && (asked !== 'set' || has('billing.settings')) ? asked : invoice || narrow ? 'inv' : 'dash';
  const [open, setOpen] = useState<number[]>(invoice ? [invoice] : []);
  // An invoice asked for by address joins the open tabs.
  if (invoice && !open.includes(invoice)) setOpen(openTab(open, invoice));
  useTabTitle(`Billing · ${view === 'inv' && invoice ? 'Invoice' : TITLES[view]}`);

  const orgs = useBillingOrgs();
  const dash = useQuery({ queryKey: K.dashboard(org), queryFn: ({ signal }) => fetchDashboard(org, signal), refetchInterval: 60_000 });
  const k = dash.data?.kpi;
  const counts = { overdue: k?.overdue_count ?? 0, unallocated: k?.unallocated_count ?? 0, drafts: k?.draft_count ?? 0 };
  const chooseOrg = (v: string) => {
    setOrg(v);
    if (requestedOrg !== null) {
      const next = new URLSearchParams(query); next.set('org', v); go(`/billing?${next.toString()}`);
    }
    try {
      localStorage.setItem(ORG_KEY, v);
    } catch {
      /* a convenience */
    }
  };
  const list = (status?: string | null) => go(`/billing?tab=inv${status ? `&status=${status}` : ''}`);
  const openInvoice = (id: number) => go(`/billing?tab=inv&invoice=${id}`);
  const openPayment = (id: number | null) => go(`/billing?tab=pay${id ? `&payment=${id}` : ''}${query.get('unallocated') === '1' ? '&unallocated=1' : ''}`);
  const openNote = (id: number | null) => go(`/billing?tab=cn${query.get('kind') === 'debit' ? '&kind=debit' : ''}${id ? `&note=${id}` : ''}`);
  const openProfile = (id: number | null) => go(`/billing?tab=rec${id ? `&profile=${id}` : ''}`);
  const close = (id: number) => {
    const rest = closeTab(open, id);
    setOpen(rest);
    if (invoice === id) go(rest.length ? `/billing?tab=inv&invoice=${rest[rest.length - 1]}` : `/billing?tab=inv${narrow ? `&status=${narrow}` : ''}`);
  };
  // Where this screen is, without the one-off asks (new, pay), to come back to.
  const here = (() => {
    const q = new URLSearchParams(query);
    q.delete('new');
    q.delete('pay');
    q.delete('against');
    q.set('tab', view);
    return `/billing?${q.toString()}`;
  })();
  const canCreate = has('billing.invoice');
  const kind = query.get('kind') === 'debit' ? 'debit' : 'credit';

  return (
    <div className="flex h-full min-h-0">
      <SidePanel id="billing" label="the Billing menu">
        <BillRail
          view={view}
          draftsOnly={view === 'inv' && !invoice && narrow === 'draft'}
          onPick={(v) => go(`/billing?tab=${v}`)}
          onDrafts={() => list('draft')}
          onOnAccount={() => go('/billing?tab=pay&unallocated=1')}
          onNew={() => go('/billing?tab=inv&new=1')}
          onOpenInvoice={openInvoice}
          onNavigate={navigate}
          counts={counts}
          org={org}
          orgs={orgs.data ?? []}
          onOrg={chooseOrg}
          canCreate={canCreate}
          has={has}
        />
      </SidePanel>
      <main className="min-w-0 flex-1 overflow-y-auto bg-ground scroll-thin" aria-label={`Billing · ${TITLES[view]}`}>
        <Suspense fallback={<Spinner />}>
          {view === 'dash' ? <Dashboard data={dash} onOpen={openInvoice} onNew={() => go('/billing?tab=inv&new=1')} onPay={() => go(`${here}&pay=1`)} onList={(s) => list(s)} canCreate={canCreate} canPay={has('billing.payment')} /> : null}
          {view === 'inv' ? (
            <div className="flex flex-col">
              {open.length ? (
                <div role="tablist" aria-label="Open invoices" className="flex gap-0.5 border-b border-line bg-[#E9ECF3] px-6 pt-1.5 dark:bg-subtle">
                  <DocTab label="List" on={!invoice} onClick={() => list(narrow)} />
                  {open.map((id) => (
                    <InvoiceTab key={id} id={id} on={invoice === id} onClick={() => openInvoice(id)} onClose={() => close(id)} />
                  ))}
                </div>
              ) : null}
              <div className="px-6 py-5">
                {invoice ? (
                  <InvoiceView
                    key={invoice}
                    id={invoice}
                    org={org}
                    onClose={() => close(invoice)}
                    onOpen={openInvoice}
                    onOpenPayment={(id) => openPayment(id)}
                    onOpenNote={(id) => go(`/billing?tab=cn&note=${id}`)}
                    onCredit={has('billing.credit') ? () => go(`/billing?tab=cn&new=1&against=${invoice}`) : undefined}
                  />
                ) : (
                  <Invoices org={org} narrow={narrow} salesDate={query.get('sales_date')} outstanding={k?.outstanding ?? null} currency={dash.data?.base_currency ?? null} canCreate={canCreate} canIssue={has('billing.issue')} onOpen={openInvoice} onNew={() => go(`${here}&new=1`)} />
                )}
              </div>
            </div>
          ) : null}
          {view === 'pay' ? <Payments org={org} openId={num(query.get('payment'))} onlyUnallocated={query.get('unallocated') === '1'} onOpen={openPayment} onOpenInvoice={openInvoice} onRecord={() => go(`${here}&pay=1`)} /> : null}
          {view === 'cn' ? (
            <Notes
              org={org}
              openId={num(query.get('note'))}
              kind={kind}
              creating={creating}
              against={num(query.get('against'))}
              onOpen={openNote}
              onKind={(x) => go(`/billing?tab=cn${x === 'debit' ? '&kind=debit' : ''}`)}
              onNew={() => go(`${here}&new=1`)}
              onCloseNew={(id) => (id ? go(`/billing?tab=cn${kind === 'debit' ? '&kind=debit' : ''}&note=${id}`) : go(here))}
              onOpenInvoice={openInvoice}
            />
          ) : null}
          {view === 'cus' ? <Customers org={org} openId={num(query.get('customer'))} onOpen={(id) => go(`/billing?tab=cus${id ? `&customer=${id}` : ''}`)} onOpenInvoice={openInvoice} onOpenPayment={(id) => openPayment(id)} onOpenProfile={(id) => openProfile(id)} /> : null}
          {view === 'rec' ? <Recurring org={org} openId={num(query.get('profile'))} creating={creating} onOpen={openProfile} onNew={() => go(`${here}&new=1`)} onCloseNew={(id) => (id ? openProfile(id) : go(here))} onOpenInvoice={openInvoice} /> : null}
          {view === 'rep' ? <BillReports org={org} onOpenPayment={(id) => openPayment(id)} /> : null}
          {view === 'set' ? <BillSettings org={org} /> : null}
          {creating && (view === 'inv' || view === 'dash') ? <NewInvoice org={org} onClose={(id) => (id ? openInvoice(id) : go(here))} /> : null}
          {paying ? <RecordPayment org={org} onClose={() => go(here)} /> : null}
        </Suspense>
      </main>
    </div>
  );
}

function DocTab({ label, on, onClick, onClose }: { label: string; on: boolean; onClick: () => void; onClose?: () => void }) {
  return (
    <span className={cx('flex h-8 items-center rounded-t-[8px] border border-b-0 text-[12.5px] font-semibold', on ? '-mb-px border-line bg-ground text-primary' : 'border-transparent text-ink-2 hover:text-ink')}>
      <button type="button" role="tab" aria-selected={on} onClick={onClick} className="h-full px-3.5">
        {label}
      </button>
      {onClose ? (
        <button type="button" aria-label={`Close ${label}`} title="Close" onClick={onClose} className="mr-1.5 flex h-5 w-5 items-center justify-center rounded-full text-ink-3 hover:bg-subtle hover:text-ink">
          <Icon name="x" size={12} />
        </button>
      ) : null}
    </span>
  );
}

/** An open invoice's tab, named by its number (or "Draft #id") once it has been read. */
function InvoiceTab({ id, on, onClick, onClose }: { id: number; on: boolean; onClick: () => void; onClose: () => void }) {
  const q = useQuery({ queryKey: K.invoice(id), queryFn: ({ signal }) => fetchInvoice(id, signal), staleTime: 30_000 });
  const inv = q.data?.invoice;
  return <DocTab label={inv ? invoiceName(inv) : `#${id}`} on={on} onClick={onClick} onClose={onClose} />;
}
