import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { app } from '../../core/app-state';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, Facts, Field, input, PageHead, Sheet, SidePanel } from '../hr/parts';
import { can, cost, short, stampWords } from '../inventory/api';
import { archiveVendor, checkDuplicates, fetchVendor, fetchVendorRecords, fetchVendors, KB, saveVendor, VENDOR_STATUSES, VENDOR_TYPES, vendorChanges, vendorForm, vendorTone, vendorType, type VendorDetail, type VendorForm } from './buying';
import { minWidth, Pill } from '../inventory/parts';
import { pick } from '../inventory/pickers';
import { PoChip } from './Purchasing';
import { Checkbox } from '../../components/Checkbox';
import { refreshPurchase } from './api';
import { Scorecard } from './Scorecard';
import { StatCard, StatGrid, type StatTone } from '../../components/StatCard';

/**
 * Vendors (InvVendors, InvVendorRecord, InvVendorForm): who the business
 * buys from — shared across the companies — with how they deliver, what
 * they are owed on terms, and the documents with them in the companies
 * being looked at. Money (spend, credit limit, bank details) is shown only
 * to people who may see cost.
 */
export default function Vendors({
  org,
  currency,
  openId,
  onOpen,
  onNew,
  onEdit,
  onOpenOrder,
  onOpenReceipt,
}: {
  org: string;
  currency: string | null;
  openId: number | null;
  onOpen: (id: number | null) => void;
  onNew: (() => void) | null;
  onEdit: (id: number) => void;
  onOpenOrder: (id: number) => void;
  onOpenReceipt: (id: number) => void;
}) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [favourites, setFavourites] = useState(false);
  const f = { q, status, type, favourites };
  const list = useInfiniteQuery({
    queryKey: KB.vendors(f),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => fetchVendors({ ...f, page: pageParam }, signal),
    getNextPageParam: (last, pages) => (pages.length * 50 < last.total ? pages.length + 1 : undefined),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.rows), [list.data]);
  const total = list.data?.pages[0]?.total ?? 0;
  const seesCost = rows.some((r) => r.spend !== null);
  const W = { type: 120, contact: 180, terms: 70, lead: 56, orders: 56, spend: 90, st: 90 };
  const min = minWidth(200, [W.type, W.contact, W.terms, W.lead, W.orders, ...(seesCost ? [W.spend] : []), W.st]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-6 py-5">
      <PageHead title="Vendors" sub={<span data-doc-count>{list.isLoading ? ' ' : `${total.toLocaleString()} ${total === 1 ? 'vendor' : 'vendors'} · shared across companies`}</span>}>
        {onNew ? (
          <button type="button" className={btnPrimary} onClick={onNew}>
            <Icon name="plus" size={15} /> New vendor
          </button>
        ) : null}
      </PageHead>
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, code, tax number…" aria-label="Search vendors" className={input + ' !w-[240px]'} />
        <Select aria-label="Vendor status" value={status} onValueChange={setStatus} options={[{ value: '', label: 'Any status' }, ...VENDOR_STATUSES]} className={pick + ' !w-[150px]'} />
        <Select aria-label="Vendor type" value={type} onValueChange={setType} options={[{ value: '', label: 'Any type' }, ...VENDOR_TYPES]} className={pick + ' !w-[170px]'} />
        <label className="flex items-center gap-1.5 font-semibold text-ink">
          <Checkbox checked={favourites} onChange={(e) => setFavourites(e.target.checked)} />
          Favourites
        </label>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
        <div className="min-h-0 flex-1 overflow-auto scroll-thin">
          <div style={{ minWidth: min }}>
            <div className="sticky top-0 z-10 flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
              <span className="min-w-0 flex-1">Vendor</span>
              <span style={{ width: W.type }}>Type</span>
              <span style={{ width: W.contact }}>Contact</span>
              <span className="text-right" style={{ width: W.terms }}>
                Terms
              </span>
              <span className="text-right" style={{ width: W.lead }}>
                Lead
              </span>
              <span className="text-right" style={{ width: W.orders }}>
                Orders
              </span>
              {seesCost ? (
                <span className="text-right" style={{ width: W.spend }}>
                  Spend
                </span>
              ) : null}
              <span style={{ width: W.st }}>Status</span>
            </div>
            {list.isLoading ? (
              <Spinner />
            ) : list.error ? (
              <ErrorNote error={list.error} onRetry={() => void list.refetch()} />
            ) : rows.length ? (
              rows.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  data-vendor={v.id}
                  onClick={() => onOpen(v.id)}
                  className={cx('flex w-full items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-left text-[12.5px] last:border-b-0 hover:bg-subtle/60', openId === v.id && 'bg-[#F4F6FE] dark:bg-selection/40')}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <b className="truncate text-ink">
                      {v.is_favourite ? <span className="mr-1 text-[#E9A23B]">★</span> : null}
                      {v.name}
                      {v.lapsed_documents ? <span className="ml-1.5 text-[11px] font-semibold text-danger">{v.lapsed_documents} lapsed</span> : null}
                    </b>
                    <span className="truncate text-[11px] text-ink-3">{[v.code, v.city].filter(Boolean).join(' · ') || '—'}</span>
                  </span>
                  <span className="shrink-0 truncate text-ink-2" style={{ width: W.type }}>
                    {vendorType(v.vendor_type)}
                  </span>
                  <span className="shrink-0 truncate text-ink-2" style={{ width: W.contact }}>
                    {[v.contact_person, v.phone ?? v.email].filter(Boolean).join(' · ') || '—'}
                  </span>
                  <span className="shrink-0 text-right text-ink-2 tabular-nums" style={{ width: W.terms }}>
                    {v.payment_terms_days !== null ? `${v.payment_terms_days} days` : '—'}
                  </span>
                  <span className="shrink-0 text-right text-ink-2 tabular-nums" style={{ width: W.lead }}>
                    {v.lead_time_days !== null ? `${v.lead_time_days}d` : '—'}
                  </span>
                  <span className="shrink-0 text-right text-ink tabular-nums" style={{ width: W.orders }}>
                    {v.order_count}
                  </span>
                  {seesCost ? (
                    <span className="shrink-0 text-right text-ink tabular-nums" style={{ width: W.spend }}>
                      {v.spend ? short(v.spend, v.currency && v.currency !== currency ? v.currency : null) : '—'}
                    </span>
                  ) : null}
                  <span className="shrink-0" style={{ width: W.st }}>
                    <Pill tone={vendorTone(v.status)}>{v.status}</Pill>
                  </span>
                </button>
              ))
            ) : (
              <Empty text={q || status || type || favourites ? 'No vendors match those filters.' : 'No vendors yet.'} />
            )}
          </div>
        </div>
        {list.hasNextPage ? (
          <div className="flex shrink-0 justify-center border-t border-line px-3.5 py-2 text-[12px]">
            <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
              {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          </div>
        ) : null}
      </div>
      {openId ? <VendorPanel key={openId} id={openId} org={org} currency={currency} onClose={() => onOpen(null)} onEdit={() => onEdit(openId)} onOpenOrder={onOpenOrder} onOpenReceipt={onOpenReceipt} /> : null}
    </div>
  );
}

const PAY_METHODS = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'online', label: 'Online' },
  { value: 'other', label: 'Other' },
];

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'people', label: 'People' },
  { id: 'terms', label: 'Trade terms' },
  { id: 'history', label: 'Orders & history' },
] as const;

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <b className="text-[13px] text-ink">{title}</b>
      {children}
    </section>
  );
}

function Stat({ label, value, sub, icon, tone }: { label: string; value: ReactNode; sub?: string; icon?: string; tone?: StatTone }) {
  return <StatCard size="sm" label={label} value={value} sub={sub} icon={icon} tone={tone} />;
}

function VendorPanel({
  id,
  org,
  currency,
  onClose,
  onEdit,
  onOpenOrder,
  onOpenReceipt,
}: {
  id: number;
  org: string;
  currency: string | null;
  onClose: () => void;
  onEdit: () => void;
  onOpenOrder: (id: number) => void;
  onOpenReceipt: (id: number) => void;
}) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KB.vendor(id), queryFn: ({ signal }) => fetchVendor(id, signal) });
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('overview');
  const [busy, setBusy] = useState(false);
  const d = q.data;
  const v = d?.vendor;
  const toggleFavourite = async () => {
    if (!v) return;
    setBusy(true);
    try {
      await saveVendor(v.id, { is_favourite: !v.is_favourite });
      refreshPurchase(qc);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const archive = async () => {
    if (!v) return;
    setBusy(true);
    try {
      await archiveVendor(v.id);
      toast('success', 'Vendor archived');
      refreshPurchase(qc);
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel
      label={v ? `Vendor ${v.name}` : 'Vendor'}
      width={640}
      onClose={onClose}
      head={
        <>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-2">
              <b className="truncate text-[15px] text-ink">{v?.name ?? 'Vendor'}</b>
              {v ? <Pill tone={vendorTone(v.status)}>{v.status}</Pill> : null}
            </span>
            <span className="truncate text-[12px] text-ink-3">{v ? [v.code, vendorType(v.vendor_type), v.rating ? `${'★'.repeat(Math.round(v.rating))}${'☆'.repeat(5 - Math.round(v.rating))}` : null].filter(Boolean).join(' · ') : ''}</span>
          </span>
          {v && d?.can.edit ? (
            <>
              <button type="button" className={btnSmall} aria-pressed={v.is_favourite} disabled={busy} onClick={() => void toggleFavourite()} title={v.is_favourite ? 'Take it off the favourites' : 'Make it a favourite'}>
                {v.is_favourite ? '★ Favourite' : '☆ Favourite'}
              </button>
              <button type="button" className={btnSmall} onClick={onEdit}>
                Edit
              </button>
            </>
          ) : null}
        </>
      }
    >
      <div role="tablist" aria-label="Vendor" className="-mx-4 -mt-3 flex shrink-0 gap-1 border-b border-line px-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cx('-mb-px border-b-2 px-2.5 py-2 text-[13px] font-semibold', tab === t.id ? 'border-primary text-primary' : 'border-transparent text-ink-2 hover:text-ink')}
          >
            {t.label}
          </button>
        ))}
      </div>
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      ) : v && d ? (
        tab === 'overview' ? (
          <Overview d={d} currency={currency} />
        ) : tab === 'people' ? (
          <>
            <Block title={`Contacts (${d.contacts.length})`}>
              {d.contacts.length ? (
                d.contacts.map((c) => (
                  <span key={c.id} className="flex flex-col border-b border-line/60 py-1.5 text-[12.5px] last:border-b-0">
                    <b className="text-ink">
                      {c.name}
                      {c.is_primary ? <span className="ml-1.5 text-[11px] font-semibold text-primary">primary</span> : null}
                    </b>
                    <span className="text-ink-3">{[c.job_title, c.department, c.email, c.phone ?? c.mobile].filter(Boolean).join(' · ') || '—'}</span>
                  </span>
                ))
              ) : (
                <span className="text-[12.5px] text-ink-3">No contacts yet.</span>
              )}
            </Block>
            <Block title={`Addresses (${d.addresses.length})`}>
              {d.addresses.length ? (
                d.addresses.map((a) => (
                  <span key={a.id} className="flex flex-col border-b border-line/60 py-1.5 text-[12.5px] last:border-b-0">
                    <b className="text-ink">
                      {a.label ?? a.kind}
                      {a.is_default ? <span className="ml-1.5 text-[11px] font-semibold text-primary">default {a.kind}</span> : null}
                    </b>
                    <span className="text-ink-3">{[a.street, a.city, a.country].filter(Boolean).join(', ') || '—'}</span>
                  </span>
                ))
              ) : (
                <span className="text-[12.5px] text-ink-3">No addresses yet.</span>
              )}
            </Block>
            {d.can.edit ? <span className="text-[11.5px] text-ink-3">Contacts and addresses are edited in the browser for now.</span> : null}
          </>
        ) : tab === 'terms' ? (
          <div className="text-[12.5px]">
            <Facts
              rows={[
                ['Legal name', v.legal_name ?? '—'],
                ['Registration', v.registration_no ?? '—'],
                ['Tax number', v.tax_number ?? '—'],
                ['VAT number', v.vat_number ?? '—'],
                ['Email', v.email ?? '—'],
                ['Phone', v.phone ?? v.mobile ?? '—'],
                ['Currency', v.currency ?? '—'],
                ['Payment terms', v.payment_terms_days !== null ? `${v.payment_terms_days} days` : '—'],
                ['Credit days', v.credit_days !== null ? `${v.credit_days} days` : '—'],
                ...(d.can.cost ? ([['Credit limit', v.credit_limit !== null ? cost(v.credit_limit, v.currency) : '—']] as Array<[string, string]>) : []),
                ['Payment method', PAY_METHODS.find((m) => m.value === v.payment_method)?.label ?? v.payment_method ?? '—'],
                ...(d.can.cost ? ([['Bank', [v.bank_name, v.bank_branch, v.account_no, v.bank_swift].filter(Boolean).join(' · ') || '—']] as Array<[string, string]>) : []),
                ['Lead time', v.lead_time_days !== null ? `${v.lead_time_days} days` : '—'],
                ['Minimum order', v.min_order_value !== null && d.can.cost ? cost(v.min_order_value, v.currency) : v.min_order_value !== null ? 'set' : '—'],
                ['Incoterms', v.incoterms ?? '—'],
                ['Shipping', v.shipping_method ?? '—'],
              ]}
            />
            {!d.can.cost ? <span className="mt-2 block text-[11.5px] text-ink-3">Credit limit and bank details are visible only to people who can see cost.</span> : null}
          </div>
        ) : (
          <History id={id} org={org} currency={currency} onOpenOrder={onOpenOrder} onOpenReceipt={onOpenReceipt} />
        )
      ) : null}
      {v && d?.can.edit && v.status !== 'archived' ? (
        <button type="button" className={btnSmall + ' self-start text-danger'} disabled={busy} onClick={() => void archive()}>
          Archive vendor
        </button>
      ) : null}
    </SidePanel>
  );
}

function Overview({ d, currency }: { d: VendorDetail; currency: string | null }) {
  const p = d.performance;
  const t = d.trade;
  return (
    <>
      <StatGrid min={150}>
        {t ? <Stat icon="cart" tone="blue" label="Orders placed" value={t.orders} sub={`${t.open_orders} still open`} /> : null}
        {t ? <Stat icon="coins" tone="violet" label="Ordered value" value={short(t.ordered_value, currency)} sub={t.last_order ? `last ${dateLabel(t.last_order)}` : undefined} /> : null}
        {t ? <Stat icon="package-check" tone="green" label="Received value" value={short(t.received_value, currency)} /> : null}
        <Stat icon="clock" tone="cyan" label="On-time delivery" value={p.on_time_pct !== null ? `${p.on_time_pct}%` : '—'} sub={p.rated_receipts ? `over ${p.rated_receipts} receipts` : 'no dated orders yet'} />
        <Stat icon="timer" tone="neutral" label="Average lead time" value={p.avg_lead_days !== null ? `${p.avg_lead_days}d` : '—'} sub={d.vendor.lead_time_days !== null ? `${d.vendor.lead_time_days} agreed` : undefined} />
        <Stat icon="package-x" tone="red" label="Rejected on arrival" value={p.reject_pct !== null ? `${p.reject_pct}%` : '—'} sub={`${p.receipts} receipts`} />
      </StatGrid>
      {!t ? <span className="text-[12px] text-ink-3">You do not have permission to see this vendor's figures.</span> : null}
      <Scorecard vendorId={d.vendor.id} />
      {d.compliance.items.length ? (
        <Block title="Compliance">
          {d.compliance.items.map((c) => (
            <span key={c.key} className="flex items-center gap-2 border-b border-line/60 py-1 text-[12.5px] last:border-b-0">
              <span className="flex-1 text-ink">{c.label}</span>
              <span className="text-ink-3">{c.date ? dateLabel(c.date) : '—'}</span>
              <Pill tone={c.state === 'ok' ? 'green' : c.state === 'expiring' ? 'amber' : c.state === 'expired' ? 'red' : 'grey'}>{c.state}</Pill>
            </span>
          ))}
        </Block>
      ) : null}
      {d.contract && d.contract.state !== 'none' ? (
        <Block title="Contract">
          <span className="text-[12.5px] text-ink-2">
            {[d.contract.reference, d.contract.start && d.contract.end ? `${dateLabel(d.contract.start)} to ${dateLabel(d.contract.end)}` : null, d.contract.value !== null ? cost(d.contract.value, currency) : null, d.contract.state]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </Block>
      ) : null}
      {d.documents.length ? (
        <Block title={`Documents (${d.documents.length})`}>
          {d.documents.map((doc) => (
            <span key={doc.id} className="flex items-center gap-2 border-b border-line/60 py-1 text-[12.5px] last:border-b-0">
              <span className="flex-1 text-ink">{doc.title}</span>
              <span className={cx('text-[11.5px]', doc.expired ? 'font-bold text-danger' : 'text-ink-3')}>{doc.expires_on ? `${doc.expired ? 'expired' : 'expires'} ${dateLabel(doc.expires_on)}` : ''}</span>
            </span>
          ))}
        </Block>
      ) : null}
    </>
  );
}

function History({ id, org, currency, onOpenOrder, onOpenReceipt }: { id: number; org: string; currency: string | null; onOpenOrder: (id: number) => void; onOpenReceipt: (id: number) => void }) {
  const q = useQuery({ queryKey: KB.vendorRecords(id, org), queryFn: ({ signal }) => fetchVendorRecords(id, org, signal) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const r = q.data!;
  return (
    <>
      <Block title={`Purchase orders (${r.purchase_orders.length})`}>
        {r.purchase_orders.length ? (
          r.purchase_orders.map((o) => (
            <button key={o.id} type="button" onClick={() => onOpenOrder(Number(o.id))} className="flex items-center gap-2 border-b border-line/60 py-1.5 text-left text-[12.5px] last:border-b-0 hover:bg-subtle">
              <b className="text-primary">{o.po_number}</b>
              <PoChip status={o.status} />
              <span className="flex-1 text-ink-3">{[o.warehouse, o.order_date ? dateLabel(o.order_date) : null].filter(Boolean).join(' · ')}</span>
              <span className="text-ink tabular-nums">{o.total !== null ? short(o.total, o.currency && o.currency !== currency ? o.currency : null) : ''}</span>
            </button>
          ))
        ) : (
          <span className="text-[12.5px] text-ink-3">None in the companies you are looking at.</span>
        )}
      </Block>
      <Block title={`Goods received (${r.receipts.length})`}>
        {r.receipts.length ? (
          r.receipts.map((g) => (
            <button key={g.id} type="button" onClick={() => onOpenReceipt(Number(g.id))} className="flex items-center gap-2 border-b border-line/60 py-1.5 text-left text-[12.5px] last:border-b-0 hover:bg-subtle">
              <b className="text-primary">{g.grn_number}</b>
              <Pill tone={g.status === 'posted' ? 'green' : g.status === 'draft' ? 'amber' : 'grey'}>{g.status}</Pill>
              <span className="flex-1 text-ink-3">{[g.po_number, g.received_at ? stampWords(g.received_at) : null].filter(Boolean).join(' · ')}</span>
            </button>
          ))
        ) : (
          <span className="text-[12.5px] text-ink-3">None yet.</span>
        )}
      </Block>
      <Block title="Timeline">
        {r.activity.length ? (
          r.activity.slice(0, 20).map((a) => (
            <span key={a.id} className="flex flex-col border-b border-line/60 py-1 text-[12.5px] last:border-b-0">
              <span className="text-ink">{a.summary}</span>
              <span className="text-[11px] text-ink-3">{[stampWords(a.created_at), a.user].filter(Boolean).join(' · ')}</span>
            </span>
          ))
        ) : (
          <span className="text-[12.5px] text-ink-3">Nothing recorded yet.</span>
        )}
      </Block>
    </>
  );
}

/** A new vendor, or a change to one (InvVendorForm, its essentials). */
export function VendorSheet({ id, onClose, onSaved }: { id: number | null; onClose: () => void; onSaved: (id: number) => void }) {
  const existing = useQuery({ queryKey: KB.vendor(id ?? 0), queryFn: ({ signal }) => fetchVendor(id!, signal), enabled: !!id });
  if (id && existing.isLoading) {
    return (
      <Sheet title="Edit vendor" width={720} onClose={onClose} footer={null}>
        <Spinner />
      </Sheet>
    );
  }
  return <VendorFormSheet id={id} initial={vendorForm(existing.data?.vendor ?? null)} canCost={existing.data?.can.cost} onClose={onClose} onSaved={onSaved} />;
}

function VendorFormSheet({ id, initial, canCost: fromServer, onClose, onSaved }: { id: number | null; initial: VendorForm; canCost: boolean | undefined; onClose: () => void; onSaved: (id: number) => void }) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const canCost = fromServer ?? can(perms, 'inventory.cost');
  const [f, setF] = useState<VendorForm>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dupes, setDupes] = useState<Array<{ vendor_id: number; name: string; code: string | null; reasons: string[] }>>([]);
  const set = (k: keyof VendorForm, v: string) => setF((x) => ({ ...x, [k]: v }));
  const changed = JSON.stringify(f) !== JSON.stringify(initial);

  // "This may already be on file": asked as the name and tax numbers settle.
  useEffect(() => {
    const t = setTimeout(() => {
      if (f.name.trim().length < 3 && !f.tax_number.trim() && !f.registration_no.trim()) return setDupes([]);
      void checkDuplicates({ name: f.name, email: f.email, phone: f.phone, tax_number: f.tax_number, registration_no: f.registration_no, vat_number: f.vat_number, ignore_id: id ?? undefined })
        .then((r) => setDupes(r.matches ?? []))
        .catch(() => setDupes([]));
    }, 500);
    return () => clearTimeout(t);
  }, [f.name, f.email, f.phone, f.tax_number, f.registration_no, f.vat_number, id]);

  const save = async () => {
    setError(null);
    const { body, error: bad } = vendorChanges(id ? initial : vendorForm(null), f, canCost);
    if (bad) return setError(bad);
    if (!id) body.name = f.name.trim();
    if (id && !Object.keys(body).length) return onClose();
    setSaving(true);
    try {
      const r = await saveVendor(id, body);
      refreshPurchase(qc);
      toast('success', id ? 'Vendor saved' : 'Vendor added');
      onSaved(Number(r.vendor?.id ?? id));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  const text = (k: keyof VendorForm, label: string, extra?: { max?: number; hint?: string; num?: boolean }) => (
    <Field label={label} hint={extra?.hint}>
      <input className={input + (extra?.num ? ' text-right tabular-nums' : '')} value={f[k]} onChange={(e) => set(k, e.target.value)} aria-label={label} maxLength={extra?.max} inputMode={extra?.num ? 'decimal' : undefined} />
    </Field>
  );

  return (
    <Sheet
      title={id ? `Edit ${initial.name}` : 'New vendor'}
      width={760}
      onClose={onClose}
      footer={
        <div className="flex w-full items-center gap-2">
          <span className="flex-1 text-[12px] text-ink-3">{changed ? 'Unsaved changes' : 'A name is the only thing required'}</span>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : id ? 'Save' : 'Create vendor'}
          </button>
        </div>
      }
    >
      <div role="form" aria-label={id ? 'Edit vendor' : 'New vendor'} className="flex flex-col gap-2.5">
        <div className="grid grid-cols-[2fr_1fr_1fr] gap-2.5">
          {text('name', 'Name', { max: 190 })}
          {text('code', 'Code', { max: 40, hint: id ? undefined : 'Left blank, one is made' })}
          <Field label="Status">
            <Select aria-label="Status" value={f.status} onValueChange={(v) => set('status', v)} options={VENDOR_STATUSES} className={pick} />
          </Field>
        </div>
        {f.status !== initial.status && f.status !== 'active' ? text('status_reason', 'Why', { max: 400, hint: `Why is this vendor ${f.status}? This is recorded on the timeline.` }) : null}
        {dupes.length ? (
          <span className="rounded-[10px] bg-[#FFF4E0] px-3 py-2 text-[12.5px] text-[#9A4A06] dark:bg-warning-bg dark:text-warning">
            <b>This may already be on file</b> — {dupes.map((m) => `${m.name}${m.code ? ` · ${m.code}` : ''} (${m.reasons.join(', ')})`).join('; ')}. Two branches of one group are genuinely two vendors, so this does not stop you saving.
          </span>
        ) : null}
        <b className="mt-1 text-[13px] text-ink">General</b>
        <div className="grid grid-cols-3 gap-2.5">
          {text('legal_name', 'Legal name', { max: 190 })}
          <Field label="Type">
            <Select aria-label="Type" value={f.vendor_type} onValueChange={(v) => set('vendor_type', v)} options={VENDOR_TYPES} className={pick} />
          </Field>
          {text('category', 'Category', { max: 120 })}
          {text('registration_no', 'Business registration', { max: 60 })}
          {text('tax_number', 'Tax number', { max: 60 })}
          {text('vat_number', 'VAT number', { max: 60 })}
          {text('email', 'Company email', { max: 190 })}
          {text('phone', 'Primary phone', { max: 40 })}
          {text('website', 'Website', { max: 255 })}
        </div>
        <b className="mt-1 text-[13px] text-ink">Financial</b>
        <div className="grid grid-cols-3 gap-2.5">
          {text('payment_terms_days', 'Payment terms (days)', { num: true })}
          {text('credit_days', 'Credit days', { num: true })}
          {text('currency', 'Currency', { max: 3 })}
          {canCost ? text('credit_limit', 'Credit limit', { num: true }) : null}
          <Field label="Payment method">
            <Select aria-label="Payment method" value={f.payment_method || 'bank_transfer'} onValueChange={(v) => set('payment_method', v)} options={PAY_METHODS} className={pick} />
          </Field>
        </div>
        {canCost ? (
          <>
            <span className="text-[12px] text-ink-3">Where payments are sent. Visible only to people who can see cost.</span>
            <div className="grid grid-cols-4 gap-2.5">
              {text('bank_name', 'Bank', { max: 150 })}
              {text('bank_branch', 'Branch', { max: 150 })}
              {text('account_no', 'Account number', { max: 60 })}
              {text('bank_swift', 'SWIFT / BIC', { max: 20 })}
            </div>
          </>
        ) : null}
        <b className="mt-1 text-[13px] text-ink">Purchasing</b>
        <div className="grid grid-cols-4 gap-2.5">
          {text('lead_time_days', 'Lead time (days)', { num: true })}
          {text('min_order_value', 'Minimum order value', { num: true })}
          {text('incoterms', 'Incoterms', { max: 12 })}
          {text('shipping_method', 'Shipping method', { max: 80 })}
        </div>
        {text('internal_notes', 'Internal notes')}
        <span className="text-[11.5px] text-ink-3">Contacts, addresses, documents, contract and custom fields are edited in the browser for now.</span>
        {error ? (
          <span role="alert" className="rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] font-semibold text-danger">
            {error}
          </span>
        ) : null}
      </div>
    </Sheet>
  );
}
