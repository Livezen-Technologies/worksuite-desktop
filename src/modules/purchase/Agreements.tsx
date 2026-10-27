import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, Field, input, Sheet, SidePanel } from '../../components/PageKit';
import { qty, whole } from '../inventory/api';
import { Pill } from '../../components/ListKit';
import { pick, ProductPick } from '../inventory/pickers';
import { fetchAgreement, fetchAgreements, KP, OFFLINE_WRITE, refreshPurchase, releaseAgreement, saveAgreement, usePurchaseCan, usePurchaseOffline, type Agreement } from './api';
import { refusalText } from './chain';
import { Frame, Head, rowCls } from './parts';
import { VendorPick } from './Purchasing';

/**
 * Agreements (G-18): blanket and contract orders with a vendor — what may be bought, at what price, up to what cap, and
 * how long for — with what has been released against them and what is left. A release raises a purchase order from the
 * agreement's lines; an agreement with a schedule raises its own (the server's purchase sweep — set on the web).
 */
const KIND: Record<string, string> = { blanket: 'Blanket order', contract: 'Contract' };

export default function Agreements({ org, openId, onOpen, onOrder }: { org: string; openId: number | null; onOpen: (id: number | null) => void; onOrder: (id: number) => void }) {
  const c = usePurchaseCan();
  const offline = usePurchaseOffline();
  const [status, setStatus] = useState('active');
  const [making, setMaking] = useState(false);
  const q = useQuery({ queryKey: KP.agreements(org, status), queryFn: ({ signal }) => fetchAgreements(org, status, signal), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 });
  const rows = q.data ?? [];
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-6 py-5">
      <Head title="Agreements" sub="Blanket and contract orders: prices, caps, what is released and what is left">
        {c.order ? (
          <button type="button" className={btnPrimary} disabled={offline} title={offline ? OFFLINE_WRITE : undefined} onClick={() => setMaking(true)}>
            <Icon name="plus" size={15} /> New agreement
          </button>
        ) : null}
      </Head>
      <Select
        aria-label="Agreement status"
        value={status}
        onValueChange={setStatus}
        options={[
          { value: 'active', label: 'Active' },
          { value: 'draft', label: 'Draft' },
          { value: 'expired', label: 'Expired' },
          { value: '', label: 'Every state' },
        ]}
        className={pick + ' !w-[160px]'}
      />
      <Frame
        min={840}
        head={
          <>
            <span className="min-w-0 flex-1">Agreement</span>
            <span className="w-[170px]">Vendor</span>
            <span className="w-[120px]">Kind</span>
            <span className="w-[150px]">Valid</span>
            <span className="w-[110px] text-right">Released</span>
            <span className="w-[110px] text-right">Left</span>
          </>
        }
      >
        {q.isLoading ? (
          <Spinner />
        ) : q.error instanceof ApiError && q.error.status === 404 ? (
          <Empty text="This WorkSuite server has no purchase agreements yet." />
        ) : q.error ? (
          <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
        ) : rows.length ? (
          rows.map((a) => (
            <button key={a.id} type="button" data-agreement={a.id} className={rowCls} onClick={() => onOpen(a.id)}>
              <b className="min-w-0 flex-1 truncate text-ink">{a.reference}</b>
              <span className="w-[170px] truncate text-ink">{a.vendor ?? '—'}</span>
              <span className="w-[120px] text-ink-2">{KIND[a.kind] ?? a.kind}</span>
              <span className="w-[150px] text-ink-2">{[a.valid_from ? dateLabel(a.valid_from) : null, a.valid_to ? dateLabel(a.valid_to) : null].filter(Boolean).join(' – ') || '—'}</span>
              <span className="w-[110px] text-right text-ink-2 tabular-nums">{whole(a.released, a.currency)}</span>
              <b className="w-[110px] text-right text-ink tabular-nums">{a.remaining !== null ? whole(a.remaining, a.currency) : 'no cap'}</b>
            </button>
          ))
        ) : (
          <Empty text="No agreements here." />
        )}
      </Frame>
      {openId ? <AgreementPanel key={openId} id={openId} onClose={() => onOpen(null)} onOrder={onOrder} /> : null}
      {making ? <AgreementSheet org={org} onClose={() => setMaking(false)} onSaved={(id) => (setMaking(false), onOpen(id))} /> : null}
    </div>
  );
}

function AgreementPanel({ id, onClose, onOrder }: { id: number; onClose: () => void; onOrder: (id: number) => void }) {
  const qc = useQueryClient();
  const c = usePurchaseCan();
  const offline = usePurchaseOffline();
  const q = useQuery({ queryKey: KP.agreement(id), queryFn: ({ signal }) => fetchAgreement(id, signal) });
  const a = q.data;
  const [release, setRelease] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const go = async (ag: Agreement) => {
    const lines = (ag.lines ?? []).map((l) => ({ agreement_line_id: l.id, qty: Number((release[l.id] ?? '').replace(/,/g, '')) })).filter((l) => Number.isFinite(l.qty) && l.qty > 0);
    if (!lines.length) return toast('error', 'Say how much of at least one line to release.');
    setBusy(true);
    try {
      const r = await releaseAgreement(id, lines);
      toast('success', `Release order ${r.order?.number ?? r.order?.po_number ?? ''} raised`);
      setRelease({});
      if (r.order?.id) onOrder(r.order.id);
    } catch (e) {
      toast('error', refusalText(e));
    } finally {
      setBusy(false);
      refreshPurchase(qc);
    }
  };
  return (
    <SidePanel label={a ? `Agreement ${a.reference}` : 'Agreement'} width={620} onClose={onClose} head={<b className="text-[15px] text-ink">{a?.reference ?? 'Agreement'}</b>}>
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      ) : a ? (
        <>
          <span className="text-[12.5px] text-ink-2">
            {[a.vendor, KIND[a.kind] ?? a.kind, a.valid_to ? `until ${dateLabel(a.valid_to)}` : null, a.cap !== null ? `cap ${whole(a.cap, a.currency)}` : 'no cap', a.schedule ? `repeats ${a.schedule}${a.next_run ? `, next ${dateLabel(a.next_run)}` : ''}` : null].filter(Boolean).join(' · ')}
          </span>
          <div className="flex gap-2">
            <Pill tone={a.status === 'active' ? 'green' : 'grey'}>{a.status}</Pill>
            <span className="text-[12.5px] text-ink-2">
              Released {whole(a.released, a.currency)} · left {a.remaining !== null ? whole(a.remaining, a.currency) : '—'}
            </span>
          </div>
          <div className="overflow-hidden rounded-[10px] border border-line">
            <div className="flex gap-2 border-b border-line bg-ground px-3 py-1.5 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
              <span className="min-w-0 flex-1">Item</span>
              <span className="w-[80px] text-right">Price</span>
              <span className="w-[90px] text-right">Released</span>
              {c.order && a.status === 'active' ? <span className="w-[80px] text-right">Release</span> : null}
            </div>
            {(a.lines ?? []).map((l) => (
              <div key={l.id} className="flex items-center gap-2 border-b border-line/60 px-3 py-1.5 text-[12.5px] last:border-b-0">
                <span className="min-w-0 flex-1 truncate text-ink">
                  {l.product ?? '—'} <span className="text-ink-3">{l.code}</span>
                </span>
                <span className="w-[80px] text-right text-ink-2 tabular-nums">{whole(l.unit_price)}</span>
                <span className="w-[90px] text-right text-ink-2 tabular-nums">
                  {qty(l.released_qty ?? 0)}
                  {l.max_qty !== null ? ` / ${qty(l.max_qty)}` : ''}
                </span>
                {c.order && a.status === 'active' ? <input className={input + ' !h-[28px] !w-[80px] text-right tabular-nums'} value={release[l.id] ?? ''} onChange={(e) => setRelease((r) => ({ ...r, [l.id]: e.target.value }))} aria-label={`Release ${l.product ?? l.id}`} /> : null}
              </div>
            ))}
          </div>
          {c.order && a.status === 'active' ? (
            <button type="button" className={btnPrimary + ' self-start'} disabled={busy || offline} title={offline ? OFFLINE_WRITE : undefined} onClick={() => void go(a)}>
              Raise a release order
            </button>
          ) : null}
        </>
      ) : null}
    </SidePanel>
  );
}

interface LineDraft {
  key: number;
  product: { id: number; code: string | null; name: string } | null;
  price: string;
  max: string;
}

function AgreementSheet({ org, onClose, onSaved }: { org: string; onClose: () => void; onSaved: (id: number) => void }) {
  const qc = useQueryClient();
  const [vendor, setVendor] = useState<{ id: number; name: string } | null>(null);
  const [kind, setKind] = useState('blanket');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cap, setCap] = useState('');
  const [currency, setCurrency] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([{ key: 0, product: null, price: '', max: '' }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (key: number, p: Partial<LineDraft>) => setLines((x) => x.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const save = async () => {
    setError(null);
    if (!vendor) return setError('Choose the vendor.');
    if (!to) return setError('Say until when it is valid.');
    const out: Array<Record<string, unknown>> = [];
    for (const l of lines) {
      if (!l.product) continue;
      const price = Number(l.price.replace(/,/g, ''));
      if (!Number.isFinite(price) || price < 0) return setError(`Give “${l.product.name}” its agreed price.`);
      const max = l.max.trim() ? Number(l.max.replace(/,/g, '')) : null;
      out.push({ product_id: l.product.id, unit_price: price, max_qty: max });
    }
    if (!out.length) return setError('Add at least one product.');
    const capN = cap.trim() ? Number(cap.replace(/,/g, '')) : null;
    if (capN !== null && (!Number.isFinite(capN) || capN <= 0)) return setError('The cap must be a number above zero, or blank for none.');
    setSaving(true);
    try {
      const r = await saveAgreement(org, null, { vendor_id: vendor.id, type: kind, valid_from: from || null, valid_to: to, cap: capN, currency: currency.trim().toUpperCase() || null, lines: out });
      refreshPurchase(qc);
      toast('success', 'Agreement saved');
      onSaved(r.agreement.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet
      title="New agreement"
      width={740}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div role="form" aria-label="New agreement" className="flex flex-col gap-2.5">
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Vendor">
            <VendorPick value={vendor} onChange={setVendor} />
          </Field>
          <Field label="Kind">
            <Select aria-label="Kind" value={kind} onValueChange={setKind} options={Object.entries(KIND).map(([value, label]) => ({ value, label }))} className={pick} />
          </Field>
        </div>
        <div className="grid grid-cols-4 gap-2.5">
          <Field label="Valid from">
            <input type="date" className={input} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Valid from" />
          </Field>
          <Field label="Valid to">
            <input type="date" className={input} value={to} onChange={(e) => setTo(e.target.value)} aria-label="Valid to" />
          </Field>
          <Field label="Cap" hint="Blank: none">
            <input className={input + ' text-right tabular-nums'} value={cap} onChange={(e) => setCap(e.target.value)} aria-label="Cap" inputMode="decimal" />
          </Field>
          <Field label="Currency">
            <input className={input + ' uppercase'} value={currency} onChange={(e) => setCurrency(e.target.value.slice(0, 3))} aria-label="Currency" maxLength={3} />
          </Field>
        </div>
        <b className="mt-1 text-[13px] text-ink">Products and agreed prices</b>
        {lines.map((l, i) => (
          <div key={l.key} className="flex items-center gap-2">
            <span className="min-w-0 flex-1">
              <ProductPick org={org} warehouse={null} value={l.product ? { id: l.product.id, code: l.product.code, barcode: null, name: l.product.name, variant_label: null, unit: null, tracking: 'none', is_stocked: 1, on_hand: 0, reserved: 0 } : null} onChange={(p) => set(l.key, { product: p ? { id: p.id, code: p.code, name: p.name } : null })} label={`Line ${i + 1} product`} />
            </span>
            <input className={input + ' !w-[110px] text-right tabular-nums'} value={l.price} onChange={(e) => set(l.key, { price: e.target.value })} placeholder="Price" aria-label={`Line ${i + 1} price`} />
            <input className={input + ' !w-[90px] text-right tabular-nums'} value={l.max} onChange={(e) => set(l.key, { max: e.target.value })} placeholder="Max qty" aria-label={`Line ${i + 1} maximum quantity`} />
          </div>
        ))}
        <button type="button" className={btnSmall + ' self-start'} onClick={() => setLines((x) => [...x, { key: Math.max(...x.map((y) => y.key)) + 1, product: null, price: '', max: '' }])}>
          + Add a line
        </button>
        {error ? (
          <span role="alert" className="rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] font-semibold text-danger">
            {error}
          </span>
        ) : null}
      </div>
    </Sheet>
  );
}
