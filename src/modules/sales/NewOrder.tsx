import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { app } from '../../core/app-state';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { useTab } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { apiPost } from '../../core/api';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { cx } from '../../components/ui';
import { btn, btnPrimary, Field, input, Sheet } from '../../components/PageKit';
import { bulk, createOrder, customers, K, lookupProducts, orderDefaults, previewApproval, PRIORITIES, scanUnit, submit, useOrgs, warehouses, ymd, type PreviewStep, type ProductHit } from './api';
import { OFFLINE_WRITE, useSalesOffline } from './offline';
import { moneyFull } from './parts';

/**
 * A new order (OmsNewOrder), made where orders are made — Inventory — as a
 * draft entered by hand: a customer, the warehouse it ships from, the lines.
 * A line is a product found by name, code or barcode, or one unit scanned
 * by its serial, barcode, QR or tag (then its quantity is 1 and the unit is
 * held on the line). A price left empty is the price list's. Totals are
 * worked out by the server when it is saved, so they cannot disagree with
 * the lines; nothing is reserved until the order is confirmed.
 *
 * D-04 (v1.1): a coupon is checked against the server as it is typed, and who
 * would have to approve an order like this is previewed before it is submitted
 * (CRT-10) — from the lines at their list prices, as a preview only. Submit
 * (⌘↵ / Ctrl+Enter) creates it and sends it for approval straight away. It
 * opens as a sheet over the list, or in its own window.
 */
interface Line {
  key: string;
  productId: number | null;
  name: string;
  code: string | null;
  quantity: number;
  price: string;
  listPrice: number | null;
  serial: string | null;
}

const has = (perms: readonly string[] | undefined, p: string) => !!perms && (perms.includes('*') || perms.includes(p));
type CouponCheck = { ok: boolean; why: string | null; amount: number; coupon: { code: string; name: string; kind: string; value: number } | null };
let seq = 0;
const key = () => `l${++seq}`;

export default function NewOrder({ org, onClose }: { org: string; onClose: (createdId?: number) => void }) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const orgs = useOrgs();
  const houses = useQuery({ queryKey: ['sales', 'warehouses'], queryFn: ({ signal }) => warehouses(signal), staleTime: 300_000 });
  const [company, setCompany] = useState(org && !org.includes(',') ? org : '');
  const [client, setClient] = useState<{ id: number; name: string } | null>(null);
  const [house, setHouse] = useState<number | null>(null);
  const [date, setDate] = useState(ymd());
  const [expected, setExpected] = useState('');
  // Orders' own defaults (Settings → General) until somebody chooses otherwise.
  const defaults = useQuery({ queryKey: ['sales', 'order-defaults', org], queryFn: ({ signal }) => orderDefaults(org, signal), staleTime: 300_000 });
  const [currencyTyped, setCurrency] = useState<string | null>(null);
  const [priorityChosen, setPriority] = useState<string | null>(null);
  const currency = currencyTyped ?? defaults.data?.oms_default_currency ?? '';
  const priority = priorityChosen ?? defaults.data?.oms_default_priority ?? 'normal';
  const defaultHouse = Number(defaults.data?.oms_default_warehouse) || null;
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [coupon, setCoupon] = useState('');
  const offline = useSalesOffline();
  const { openInWindow } = useTab();
  const several = (orgs.data?.length ?? 0) > 1;
  const houseList = (houses.data ?? []).filter((h) => !company || h.org_id == null || String(h.org_id) === company);
  const chosenHouse = house ?? (houseList.find((h) => h.id === defaultHouse) ?? houseList.find((h) => h.is_default) ?? houseList[0])?.id ?? null;

  const addProduct = (p: ProductHit, serial: string | null = null) =>
    setLines((ls) => {
      if (!serial) {
        const same = ls.find((l) => l.productId === p.id && !l.serial);
        if (same) return ls.map((l) => (l === same ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...ls, { key: key(), productId: p.id, name: p.variant_label ? `${p.name} — ${p.variant_label}` : p.name, code: p.code, quantity: 1, price: '', listPrice: p.unit_price ?? null, serial }];
    });

  const ready = !offline && !!client && !!chosenHouse && lines.length > 0 && lines.every((l) => l.quantity > 0 && (l.productId || l.name.trim())) && (!several || !!company);
  // A preview from the list prices: the server prices the order when it is saved.
  const estimate = lines.reduce((t, l) => t + l.quantity * (l.price.trim() !== '' ? Number(l.price) || 0 : (l.listPrice ?? 0)), 0);
  const productIds = lines.map((l) => l.productId).filter((x): x is number => !!x);
  // What the coupon check and the approval preview are asked with: settled a moment after the form stops changing.
  const productKey = productIds.join(',');
  const [ask, setAsk] = useState<{ total: number; client: number | null; company: string; code: string; products: number[] } | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setAsk({ total: estimate, client: client?.id ?? null, company, code: coupon.trim(), products: productKey ? productKey.split(',').map(Number) : [] }), 450);
    return () => clearTimeout(t);
  }, [estimate, client?.id, company, coupon, productKey]);
  // The coupon, checked as it is typed (a preview; it is applied once the order exists).
  const couponQ = useQuery({
    queryKey: ['sales', 'coupon-check', ask?.code, ask?.client, ask?.company, ask?.total, ask?.products.join(',')],
    queryFn: () => apiPost<CouponCheck>('/api/oms/coupons/validate', { code: ask!.code, client_id: ask!.client, subtotal: ask!.total, source: 'manual', product_ids: ask!.products }, ask!.company ? { org: ask!.company } : undefined),
    enabled: !!ask?.code && !!coupon.trim() && !offline,
    retry: false,
    staleTime: 30_000,
  });
  const couponCheck: CouponCheck | null = !coupon.trim() ? null : couponQ.data ?? (couponQ.error ? { ok: false, why: errorMessage(couponQ.error), amount: 0, coupon: null } : null);
  const off = couponCheck?.ok ? couponCheck.amount : 0;
  // Who would approve an order like this (CRT-10).
  const previewQ = useQuery({
    queryKey: ['sales', 'approval-preview', ask ? ask.total - off : 0, ask?.client, ask?.company],
    queryFn: ({ signal }) => previewApproval({ total: ask!.total - off, customer_id: ask!.client, channel: 'manual', org_id: ask!.company ? Number(ask!.company) : null }, signal),
    enabled: !!ask && ask.total > 0 && lines.length > 0 && !offline,
    retry: false,
    staleTime: 30_000,
  });
  const preview: PreviewStep[] | null = previewQ.data ?? null;
  const create = async (andSubmit = false) => {
    if (!ready || !client || !chosenHouse) return;
    setBusy(true);
    try {
      const r = await createOrder({
        client_id: client.id,
        warehouse_id: chosenHouse,
        ...(company ? { org_id: Number(company) } : {}),
        order_date: date,
        ...(expected ? { expected_date: expected } : {}),
        ...(currency.trim() ? { currency: currency.trim().toUpperCase() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        lines: lines.map((l) => ({
          ...(l.productId ? { product_id: l.productId } : {}),
          description: l.name,
          quantity: l.quantity,
          ...(l.price.trim() !== '' ? { unit_price: Number(l.price) } : {}),
          ...(l.serial ? { serial_no: l.serial } : {}),
        })),
      });
      const id = Number(r.order.id);
      // Priority is the workspace's, set once the order exists.
      if (priority !== 'normal' && has(perms, 'oms.orders.edit')) await bulk([id], 'priority', priority).catch(() => undefined);
      if (coupon.trim() && couponCheck?.ok) await apiPost(`/api/oms/orders/${id}/coupon`, { code: coupon.trim() }).catch((e) => toast('warning', `The coupon was not applied: ${errorMessage(e)}`));
      if (andSubmit) {
        const sent = await submit(id).catch((e) => (toast('warning', `Created, but not sent for approval: ${errorMessage(e)}`), null));
        if (sent) toast('success', sent.status === 'approved' ? `Order ${r.order.so_number ?? ''} created and approved — no approval rule applies to it.` : `Order ${r.order.so_number ?? ''} created and sent for approval.`);
      } else toast('success', `Draft order ${r.order.so_number ?? ''} created. Nothing is reserved until it is confirmed.`.replace('  ', ' '));
      void qc.invalidateQueries({ queryKey: K.all });
      onClose(id);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={
        <span className="flex items-center gap-2">
          <span className="flex-1">New order</span>
          <button type="button" className="inline-flex h-7 items-center gap-1 rounded-[7px] px-2 text-[12px] font-semibold text-ink-2 hover:bg-subtle" title="Open the new order in its own window" onClick={() => (openInWindow('/sales?tab=orders&new=1', 'New order'), onClose())}>
            <Icon name="app-window" size={13} /> Own window
          </button>
        </span>
      }
      width={760}
      onClose={() => onClose()}
      footer={
        <>
          <span className="mr-auto max-w-[360px] text-[11.5px] text-ink-3">{offline ? OFFLINE_WRITE : 'This creates a draft order marked as entered by hand, and its timeline says so. Nothing is reserved until it is confirmed.'}</span>
          <button type="button" className={btn} onClick={() => onClose()}>
            Cancel
          </button>
          <button type="button" className={btn} disabled={!ready || busy} onClick={() => void create()}>
            {busy ? 'Creating…' : 'Save draft'}
          </button>
          {has(perms, 'oms.orders.edit') ? (
            <button type="button" className={btnPrimary} disabled={!ready || busy} onClick={() => void create(true)} title="⌘↵ / Ctrl+Enter">
              Submit ⌘↵
            </button>
          ) : null}
        </>
      }
    >
      <span
        className="contents"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && ready && !busy) {
            e.preventDefault();
            void create(has(perms, 'oms.orders.edit'));
          }
        }}
      >
      <div className="grid grid-cols-2 gap-3" data-new-order>
        {several ? (
          <Field label="Company">
            <Select<string>
              label="Company"
              value={company}
              placeholder="Choose a company"
              searchable
              options={(orgs.data ?? []).map((o) => ({ value: String(o.id), label: o.name }))}
              onValueChange={(v) => (setCompany(v), setHouse(null))}
            />
          </Field>
        ) : null}
        <Field label="Customer">
          <CustomerPicker value={client} onChange={setClient} />
        </Field>
        <Field label="Warehouse" hint={houses.error ? errorMessage(houses.error) : undefined}>
          <Select<string>
            label="Warehouse"
            value={chosenHouse ? String(chosenHouse) : ''}
            placeholder={houses.isLoading ? 'Loading…' : houseList.length ? 'Choose a warehouse' : 'No warehouse you may sell from'}
            searchable
            empty="No warehouse you may sell from"
            options={houseList.map((h) => ({ value: String(h.id), label: h.name, hint: h.code ?? undefined }))}
            onValueChange={(v) => setHouse(Number(v) || null)}
          />
        </Field>
        <Field label="Order date">
          <input type="date" className={input} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Expected">
          <input type="date" className={input} value={expected} onChange={(e) => setExpected(e.target.value)} />
        </Field>
        <Field label="Currency" hint="Empty: the company’s own.">
          <input className={input} value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="LKR" maxLength={3} />
        </Field>
        <Field label="Priority">
          <Select<string>
            label="Priority"
            value={priority}
            options={PRIORITIES.map((p) => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }))}
            onValueChange={setPriority}
          />
        </Field>
      </div>

      <div className="flex flex-col gap-2 pt-1">
        <div className="flex items-center gap-2">
          <b className="flex-1 text-[13px] text-ink">Items</b>
          <button type="button" aria-pressed={scanning} onClick={() => setScanning(!scanning)} className={cx('inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-[8px] px-3 text-[12.5px] font-semibold whitespace-nowrap', scanning ? 'bg-primary text-white' : 'border border-line bg-surface text-ink hover:bg-subtle')}>
            <Icon name="scan" size={13} /> {scanning ? 'Typing' : 'Scan units'}
          </button>
        </div>
        {scanning ? <ScanBox warehouseId={chosenHouse} onUnit={(p, serial) => addProduct(p, serial)} taken={new Set(lines.map((l) => l.serial).filter((s): s is string => !!s))} /> : <ProductSearch warehouseId={chosenHouse} onPick={(p) => addProduct(p)} />}
        {lines.length ? (
          <div className="overflow-hidden rounded-[10px] border border-line">
            {lines.map((l) => (
              <div key={l.key} className="flex items-center gap-2 border-b border-line/70 px-3 py-2 text-[12.5px] last:border-b-0" data-line>
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="truncate text-ink">{l.name}</b>
                  <span className="truncate text-[11.5px] text-ink-3">{[l.code, l.serial ? `unit ${l.serial}` : null, l.listPrice != null ? `list ${moneyFull(l.listPrice)}` : null].filter(Boolean).join(' · ')}</span>
                </span>
                <input type="number" min={1} aria-label={`Quantity of ${l.name}`} disabled={!!l.serial} value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, quantity: Math.max(0, Number(e.target.value)) } : x)))} className={input + ' !w-[70px] text-right'} />
                <input inputMode="decimal" aria-label={`Unit price of ${l.name}`} placeholder="price list" value={l.price} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, price: e.target.value.replace(/[^\d.]/g, '') } : x)))} className={input + ' !w-[120px] text-right'} />
                <button type="button" aria-label={`Remove ${l.name}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="flex h-7 w-7 items-center justify-center rounded-full text-ink-3 hover:bg-subtle hover:text-danger">
                  <Icon name="x" size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="m-0 rounded-[10px] border border-dashed border-line px-3 py-5 text-center text-[12.5px] text-ink-3">{scanning ? 'Scan each unit — its serial, barcode, QR code or tag.' : 'Find a product by its name, code or barcode.'}</p>
        )}
        <p className="m-0 text-[11.5px] text-ink-3">Totals are worked out when the order is saved, so they cannot disagree with the lines.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Coupon" hint={couponCheck ? <span className={couponCheck.ok ? 'text-success' : 'text-danger'}>{couponCheck.ok ? `${couponCheck.coupon?.code ?? coupon.trim().toUpperCase()} applies${couponCheck.amount ? `: about ${moneyFull(couponCheck.amount)} off` : ''}.` : (couponCheck.why ?? 'That coupon does not apply.')}</span> : undefined}>
          <input className={input} value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="SAVE20" maxLength={40} />
        </Field>
        <div className="flex flex-col gap-1 text-[12.5px]">
          <b className="text-ink">Approval</b>
          {lines.length ? (
            preview === null ? (
              <span className="text-ink-3">{previewQ.error ? 'Who would approve it is worked out when it is submitted.' : 'Working out who would approve it…'}</span>
            ) : preview.length ? (
              <span className="text-warning-ink dark:text-warning" data-approval-preview>
                Needs {preview.length === 1 ? 'one approval' : `${preview.length} approvals`}: {preview.map((p) => `${p.step}. ${p.label}${p.approver ? ` (${p.approver})` : ''}`).join(' · ')}
              </span>
            ) : (
              <span className="text-success" data-approval-preview>No approval needed — no rule matches this order. It goes straight to Approved when submitted.</span>
            )
          ) : (
            <span className="text-ink-3">Add the lines to see who would approve it.</span>
          )}
          {lines.length ? <span className="text-[11.5px] text-ink-3">About {moneyFull(estimate)} at list prices, before tax — the server prices it when saved.</span> : null}
        </div>
      </div>
      <Field label="Notes">
        <textarea rows={2} className={input + ' !h-auto py-2'} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      </span>
    </Sheet>
  );
}

/** The customer: the app's dropdown, searched on the server as it is typed (CRM accounts). */
function CustomerPicker({ value, onChange }: { value: { id: number; name: string } | null; onChange: (v: { id: number; name: string } | null) => void }) {
  const [q, setQ] = useState('');
  const [needle, setNeedle] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setNeedle(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const res = useQuery({ queryKey: ['sales', 'customers', needle], queryFn: ({ signal }) => customers(needle, signal), staleTime: 30_000 });
  const found = res.data ?? [];
  const options = [
    ...(value && !found.some((c) => c.id === value.id) ? [{ value: String(value.id), label: value.name }] : []),
    ...found.map((c) => ({ value: String(c.id), label: c.name, hint: [c.email, c.phone].filter(Boolean).join(' · ') || undefined })),
  ];
  return (
    <Select<string>
      label="Customer"
      value={value ? String(value.id) : ''}
      placeholder="Choose a customer"
      options={options}
      onSearch={setQ}
      loading={res.isFetching && !found.length}
      empty={res.error ? errorMessage(res.error) : needle ? 'No customer matches.' : 'No customers yet.'}
      onValueChange={(v) => {
        const c = options.find((o) => o.value === v);
        onChange(c ? { id: Number(c.value), name: c.label } : null);
      }}
    />
  );
}

function ProductSearch({ warehouseId, onPick }: { warehouseId: number | null; onPick: (p: ProductHit) => void }) {
  const [q, setQ] = useState('');
  const needle = q.trim();
  const res = useQuery({ queryKey: ['sales', 'products', needle, warehouseId], queryFn: ({ signal }) => lookupProducts(needle, warehouseId, signal), enabled: needle.length >= 1, staleTime: 15_000 });
  const pick = (p: ProductHit) => {
    if (p.kind === 'variable') return toast('warning', `${p.name} has variants — choose one of them.`);
    onPick(p);
    setQ('');
  };
  return (
    <span className="relative">
      <input
        className={input}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          // A barcode reader types the code and presses Enter: an exact match goes straight in.
          if (e.key === 'Enter' && res.data?.exact && res.data.products[0]) {
            e.preventDefault();
            pick(res.data.products[0]);
          }
        }}
        placeholder="Add a line — product name, code or barcode"
        aria-label="Add a product"
      />
      {needle ? (
        <span role="listbox" aria-label="Products" className="absolute top-full right-0 left-0 z-30 mt-1 flex max-h-64 flex-col overflow-y-auto rounded-[10px] border border-line bg-surface py-1 shadow-[0_12px_32px_rgb(var(--ws-shadow-rgb)/.18)] scroll-thin">
          {res.error ? <span className="px-3 py-2 text-[12px] text-ink-3">{errorMessage(res.error)}</span> : null}
          {(res.data?.products ?? []).map((p) => (
            <button key={p.id} type="button" role="option" aria-selected={false} onClick={() => pick(p)} className="flex items-center gap-2 px-3 py-1.5 text-left hover:bg-subtle">
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="truncate text-[12.5px] text-ink">
                  {p.name}
                  {p.variant_label ? ` — ${p.variant_label}` : ''}
                </b>
                <span className="text-[11.5px] text-ink-3">{[p.code, p.is_stocked && p.on_hand != null ? `${p.on_hand - (p.reserved ?? 0)} free` : !p.is_stocked ? 'service' : null].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="text-[12px] text-ink-2 tabular-nums">{moneyFull(p.unit_price)}</span>
            </button>
          ))}
          {res.data && !res.data.products.length ? <span className="px-3 py-2 text-[12px] text-ink-3">No product matches.</span> : null}
        </span>
      ) : null}
    </span>
  );
}

/** One unit at a time: its serial, barcode, QR or tag. A unit that may not be sold says why. */
function ScanBox({ warehouseId, onUnit, taken }: { warehouseId: number | null; onUnit: (p: ProductHit, serial: string) => void; taken: Set<string> }) {
  const [code, setCode] = useState('');
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const scan = async () => {
    const c = code.trim();
    if (!c) return;
    setBusy(true);
    try {
      const r = await scanUnit(c, warehouseId);
      const u = r.unit;
      if (!r.found || !u) return setNote({ ok: false, text: r.why ?? (r.ambiguous ? 'More than one unit has that code — scan its serial.' : 'Nothing has that code.') });
      if (!r.sellable) return setNote({ ok: false, text: `${u.product ?? 'That unit'} · ${u.serial_no}: ${r.why ?? 'it may not be sold'}.` });
      if (taken.has(u.serial_no)) return setNote({ ok: false, text: `${u.serial_no} is already on this order.` });
      onUnit({ id: u.product_id, code: u.product_code, barcode: null, name: u.product ?? 'Unit', variant_label: null, unit: null, unit_price: 0, tax_rate: null, tracking: 'serial', is_stocked: true, kind: null, on_hand: null, reserved: null }, u.serial_no);
      setNote({ ok: true, text: `Added ${u.product ?? 'the unit'} · ${u.serial_no}` });
    } catch (e) {
      setNote({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
      setCode('');
      ref.current?.focus();
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <input
        ref={ref}
        className={input + ' border-2 border-dashed !border-primary/60'}
        value={code}
        disabled={busy}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void scan())}
        placeholder="Scan each unit — barcode, QR or tag"
        aria-label="Scan a unit"
      />
      {note ? <span className={cx('text-[12px]', note.ok ? 'text-success' : 'text-danger')}>{note.text}</span> : null}
    </div>
  );
}
