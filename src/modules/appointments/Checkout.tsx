import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from '../../core/toasts';
import { Button, cx } from '../../components/ui';
import { Checkbox } from '../../components/Checkbox';
import { applyDeposit, checkout, fetchCheckout, fetchDetail, fetchSaleProducts, K, money, paidOnline, quote, recordPayment, type CheckoutInput, type CheckoutResult, type Quote } from './api';
import { errText, Head, input, Kbd, label, Refused, Section, td, tdr, th, useDesk } from './parts';
import { printPage, readDesk, receiptHtml, type Receipt } from './print';

/**
 * D03 · Checkout and D13 · Payment and receipt. The lines, tax and total are the server's quote, asked again whenever
 * a line changes (Billing's own pricing); Check out issues the invoice, takes the stock used and accrues commission on
 * the server, and applies a held deposit where Billing lets this person. The payment is recorded in Billing against
 * the invoice, then the 80 mm receipt prints on this desk's receipt printer with the server's figures.
 */
type Line = { product_id: number; name: string; price: number; quantity: number };

export default function Checkout({ id, onDone }: { id: number; onDone: () => void }) {
  const desk = useDesk();
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: K.detail(id), queryFn: ({ signal }) => fetchDetail(id, signal) });
  const pre = useQuery({ queryKey: K.checkout(id), queryFn: ({ signal }) => fetchCheckout(id, signal), enabled: desk.online });
  const a = detail.data?.appointment;
  const [products, setProducts] = useState<Line[]>([]);
  const [usedEdit, setUsed] = useState<Record<number, number>>({});
  const [discount, setDiscount] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState<Quote | null>(null);
  const [qErr, setQErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<CheckoutResult | null>(null);
  const sale = useQuery({ queryKey: ['appointments', 'sale', a?.location.id, search], queryFn: ({ signal }) => fetchSaleProducts(a!.location.id, search, signal), enabled: !!a && desk.online });

  // What the recipe plans, with what the desk changed on top.
  const used: Record<number, number> = { ...Object.fromEntries((pre.data?.planned ?? []).map((p) => [p.product_id, p.planned])), ...usedEdit };

  const body = (): CheckoutInput => ({
    invoice: true,
    products: products.map((p) => ({ product_id: p.product_id, quantity: p.quantity })),
    used: Object.entries(used).map(([pid, quantity]) => ({ product_id: Number(pid), quantity })),
    discount: Number(discount) || 0,
  });
  const key = JSON.stringify(body());
  useEffect(() => {
    if (!pre.data || done) return;
    const t = window.setTimeout(() => {
      quote(id, JSON.parse(key) as CheckoutInput).then((r) => (setQ(r.data), setQErr(null)), (e: unknown) => setQErr(errText(e)));
    }, 250);
    return () => window.clearTimeout(t);
  }, [key, id, pre.data, done]);

  const add = (p: { id: number; name: string; price: number }) =>
    setProducts((xs) => (xs.some((x) => x.product_id === p.id) ? xs.map((x) => (x.product_id === p.id ? { ...x, quantity: x.quantity + 1 } : x)) : [...xs, { product_id: p.id, name: p.name, price: p.price, quantity: 1 }]));

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await checkout(id, body());
      let msg = r.message || 'Checked out.';
      const held = r.data.appointment.deposit?.held ?? 0;
      if (held > 0 && pre.data?.may.payment && r.data.invoice) {
        try {
          msg += ` ${(await applyDeposit(id)).message}`;
        } catch (e) {
          msg += ` The deposit was not applied: ${errText(e)}`;
        }
      }
      toast('success', msg);
      const fresh = await fetchDetail(id);
      setDone({ ...r.data, appointment: fresh.appointment });
      void qc.invalidateQueries({ queryKey: K.all });
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!desk.online) return <Refused>Checkout needs a connection to WorkSuite — the invoice, stock and commission are the server’s.</Refused>;
  if (detail.isPending || pre.isPending) return <p className="text-[13px] text-ink-3">Reading…</p>;
  if (pre.isError || !pre.data || !a) return <Refused>{errText(pre.error ?? detail.error ?? 'This appointment cannot be checked out.')}</Refused>;
  if (done) return <Payment a={done.appointment} result={done} quote={q} canPay={pre.data.may.payment} onDone={onDone} />;
  const cur = q?.currency ?? pre.data.currency;

  return (
    <div className="max-w-[1100px]">
      <Head title={a.customer.name} sub={`${a.service.name} · ${a.provider.name} · ${a.local.start}–${a.local.end}${a.status === 'in_service' ? ' · in service → completes on checkout' : ''}`} />
      <div className="grid grid-cols-[1fr_340px] gap-4">
        <div className="flex flex-col gap-4">
          <Section title="Lines">
            <table className="w-full border-collapse text-[12.5px]">
              <thead><tr><th className={th}>Line</th><th className={th}>Qty</th><th className={cx(th, 'text-right')}>Amount</th><th className={th} /></tr></thead>
              <tbody>
                {(q?.lines ?? []).map((l, i) => {
                  const mine = products.find((p) => p.name === l.description && l.kind !== 'service');
                  return (
                    <tr key={i}>
                      <td className={td}>{l.description}<div className="text-[11px] text-ink-3">{[l.kind, ...l.taxes].join(' · ')}</div></td>
                      <td className={td}>
                        {mine ? <input aria-label={`Quantity of ${l.description}`} type="number" min={1} className={cx(input, 'h-7 w-16')} value={mine.quantity} onChange={(e) => setProducts((xs) => xs.map((x) => (x === mine ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x)))} /> : l.quantity}
                      </td>
                      <td className={tdr}>{money(l.unit_price * l.quantity)}</td>
                      <td className={td}>{mine ? <button type="button" aria-label={`Remove ${l.description}`} className="text-ink-3 hover:text-danger" onClick={() => setProducts((xs) => xs.filter((x) => x !== mine))}>×</button> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!pre.data.service.priced ? <p className="m-0 px-3.5 py-2 text-[12px] text-ink-3">This service has no price in the Product Master.</p> : null}
          </Section>
          {pre.data.planned.length ? (
            <Section title={`Used from ${pre.data.warehouse?.name ?? 'stock'} · planned → used`}>
              <div className="px-3.5 pb-3">
                {pre.data.planned.map((p) => (
                  <div key={p.product_id} className="flex items-center gap-2 py-1 text-[12.5px]">
                    <span className="min-w-0 flex-1 truncate">{`${p.name}${p.unit ? ` (${p.unit})` : ''}${p.available !== null && p.available < (used[p.product_id] ?? 0) ? ` · only ${p.available} in stock` : ''}`}</span>
                    <span className="tabular-nums text-ink-3">{`${p.planned} →`}</span>
                    <input aria-label={`Used of ${p.name}`} type="number" min={0} className={cx(input, 'h-7 w-20')} value={used[p.product_id] ?? 0} onChange={(e) => setUsed((u) => ({ ...u, [p.product_id]: Math.max(0, Number(e.target.value) || 0) }))} />
                  </div>
                ))}
              </div>
            </Section>
          ) : null}
          <Section title="Add retail · tap or scan">
            <div className="px-3.5 pb-3">
              <input className={input} placeholder="Search or scan a product code" aria-label="Find a product" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && sale.data?.items[0]) { add(sale.data.items[0]); setSearch(''); } }} />
              <div className="mt-2 grid grid-cols-4 gap-2">
                {(sale.data?.items ?? []).slice(0, 12).map((p) => (
                  <button key={p.id} type="button" onClick={() => add(p)} disabled={p.stocked && p.available === 0} className="rounded-[10px] border border-line px-2 py-2 text-left text-[12px] hover:bg-subtle disabled:opacity-50">
                    <div className="truncate font-semibold text-ink">{p.name}</div>
                    <div className="text-ink-3 tabular-nums">{money(p.price)}{p.stocked && p.available !== null ? ` · ${p.available} left` : ''}</div>
                  </button>
                ))}
              </div>
            </div>
          </Section>
        </div>
        <Section title="Total">
          <div className="px-3.5 pb-3.5 text-[13px]">
            <Sum k="Subtotal" v={money(q?.subtotal)} />
            {pre.data.may.discount ? (
              <label className="flex items-center justify-between py-1"><span className="text-ink-2">Discount</span><input aria-label="Discount" inputMode="decimal" className={cx(input, 'h-7 w-28 text-right')} value={discount} onChange={(e) => setDiscount(e.target.value)} /></label>
            ) : <Sum k="Discount" v={`− ${money(q?.discount)}`} />}
            <Sum k="Tax (Billing rates)" v={money(q?.tax)} />
            <Sum k="Total" v={money(q?.total, cur)} strong />
            {a.deposit && a.deposit.held > 0 ? <Sum k="Deposit held" v={`− ${money(a.deposit.held)}`} /> : null}
            {paidOnline(pre.data.deposit_paid_online) > 0 ? <p className="m-0 py-1 text-[12px] text-ink-3">{`${money(paidOnline(pre.data.deposit_paid_online), cur)} paid online on the deposit invoice is already a line above (less deposit paid online).`}</p> : null}
            {qErr ? <div className="mt-2"><Refused>{qErr}</Refused></div> : null}
            {!pre.data.may.issue ? <p className="mt-2 mb-0 text-[12px] text-ink-3">The invoice stays a draft for Billing to issue: issuing needs Billing’s permission.</p> : null}
            <div className="mt-2"><Refused>{err}</Refused></div>
            <Button variant="primary" size="action-lg" className="mt-3 w-full" loading={busy} disabled={!q || !!qErr} onClick={() => void run()}>
              {`Check out · ${money(q?.total, cur)}`}<Kbd>⏎</Kbd>
            </Button>
          </div>
        </Section>
      </div>
    </div>
  );
}

function Sum({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={cx('flex items-center justify-between py-1', strong && 'mt-1 border-t border-line pt-2 text-[15px] font-extrabold')}>
      <span className={strong ? 'text-ink' : 'text-ink-2'}>{k}</span>
      <span className="tabular-nums text-ink">{v}</span>
    </div>
  );
}

/** D13 · Record the payment in Billing against the invoice, and print the receipt. */
function Payment({ a, result, quote: qt, canPay, onDone }: { a: CheckoutResult['appointment']; result: CheckoutResult; quote: Quote | null; canPay: boolean; onDone: () => void }) {
  const desk = useDesk();
  const qc = useQueryClient();
  const settings = readDesk();
  const inv = a.invoice;
  const cur = inv?.currency ?? qt?.currency ?? '';
  const owed = inv?.outstanding ?? 0;
  const [method, setMethod] = useState<'card' | 'cash'>('card');
  const [amount, setAmount] = useState(String(owed));
  const [ref, setRef] = useState('');
  const [last4, setLast4] = useState('');
  const [tendered, setTendered] = useState('');
  const [print, setPrint] = useState(settings.autoPrint);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const change = method === 'cash' && Number(tendered) > Number(amount) ? Number(tendered) - Number(amount) : 0;

  const receipt = (paid: number | null): Receipt => ({
    business: a.location.name,
    location: a.location.name,
    invoice: inv?.number ?? result.invoice?.number ?? null,
    at: new Date().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }),
    client: a.customer.name,
    servedBy: a.provider.name,
    lines: (qt?.lines ?? []).map((l) => ({ label: `${l.description}${l.quantity !== 1 ? ` × ${l.quantity}` : ''}`, amount: money(l.unit_price * l.quantity) })),
    totals: [
      ...(qt && Number(qt.discount) ? [{ label: 'Discount', amount: `-${money(qt.discount)}` }] : []),
      ...(qt ? [{ label: 'Tax', amount: money(qt.tax) }] : []),
      { label: 'TOTAL', amount: money(inv?.total ?? qt?.total, cur) },
      ...(a.deposit && a.deposit.held > 0 ? [{ label: 'Deposit', amount: `-${money(a.deposit.held)}` }] : []),
    ],
    payment: paid !== null ? { label: method === 'card' ? `Card${last4 ? ` ••${last4}` : ''}` : `Cash${change ? ` · change ${money(change)}` : ''}`, amount: money(paid) } : null,
  });
  const doPrint = (paid: number | null) => printPage(receiptHtml(receipt(paid), settings.paper), `Receipt ${inv?.number ?? a.number}`, settings.receiptPrinter).catch((e: unknown) => (toast('error', `The receipt did not print: ${errText(e)}`), false));

  const record = async () => {
    const n = Number(amount);
    if (!inv || !(n > 0)) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await recordPayment({ client_id: a.customer.id, org_id: a.org_id, amount: n, currency: cur, method, bank_reference: [ref.trim(), last4 ? `••${last4}` : ''].filter(Boolean).join(' ') || undefined, note: `${a.number} checkout`, allocate: [{ invoice_id: inv.id, amount: n }] });
      toast('success', r.message || 'Payment recorded.');
      if (print) await doPrint(n);
      void qc.invalidateQueries({ queryKey: K.all });
      onDone();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid max-w-[1000px] grid-cols-[1fr_320px] gap-4">
      <div>
        <Head title={`Checked out · ${money(owed, cur)} to pay`} sub={[inv?.number ? `${inv.number} ${inv.status ?? ''}` : 'Invoice', `${a.number} ${a.status_label.toLowerCase()}`, result.commission?.length ? 'commission accrued' : null].filter(Boolean).join(' · ')} />
        {!canPay || !inv ? (
          <Section>
            <p className="m-0 px-3.5 py-3 text-[13px] text-ink-2">{!inv ? 'There is no invoice to pay (nothing was priced, or it stays a draft for Billing).' : 'Recording the payment is Billing’s and needs its payment permission. The invoice is waiting there.'}</p>
            <div className="flex gap-2 px-3.5 pb-3"><Button variant="secondary" icon="printer" onClick={() => void doPrint(null)}>Print receipt</Button><Button variant="primary" onClick={onDone}>Done</Button></div>
          </Section>
        ) : owed <= 0 ? (
          <Section>
            <p className="m-0 px-3.5 py-3 text-[13px] text-ink-2">Nothing is owed — the deposit covered it.</p>
            <div className="flex gap-2 px-3.5 pb-3"><Button variant="secondary" icon="printer" onClick={() => void doPrint(0)}>Print receipt</Button><Button variant="primary" onClick={onDone}>Done</Button></div>
          </Section>
        ) : (
          <Section title="Payment">
            <div className="px-3.5 pb-3.5">
              <div role="group" aria-label="Pay with" className="mb-3 flex gap-2">
                {(['card', 'cash'] as const).map((m) => <Button key={m} variant={method === m ? 'primary' : 'secondary'} onClick={() => setMethod(m)}>{m === 'card' ? 'Card' : 'Cash'}</Button>)}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label><span className={label}>Amount</span><input className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
                {method === 'card' ? (
                  <>
                    <label><span className={label}>Card terminal ref.</span><input className={input} value={ref} maxLength={60} onChange={(e) => setRef(e.target.value)} /></label>
                    <label><span className={label}>Last 4</span><input className={input} value={last4} maxLength={4} inputMode="numeric" onChange={(e) => setLast4(e.target.value.replace(/\D/g, ''))} /></label>
                  </>
                ) : (
                  <label className="col-span-2"><span className={label}>Tendered</span><input className={input} inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value)} /></label>
                )}
              </div>
              <p className="mt-2 mb-0 text-[12px] text-ink-3">{method === 'card' ? 'The card is charged on the bank’s terminal; this records the payment in Billing against the invoice.' : change ? `Change ${money(change, cur)}.` : 'Cash is recorded in Billing against the invoice.'}</p>
              <label className="mt-2 flex items-center gap-2 text-[12.5px] text-ink"><Checkbox checked={print} onChange={(e) => setPrint(e.target.checked)} />Print the receipt</label>
              <div className="mt-2"><Refused>{err}</Refused></div>
              <div className="mt-3 flex gap-2">
                <Button variant="secondary" onClick={() => desk.book({ customer: { id: a.customer.id, name: a.customer.name }, service: a.service.id, provider: a.provider.id })}>Book next visit</Button>
                <span className="flex-1" />
                <Button variant="primary" loading={busy} disabled={!(Number(amount) > 0)} onClick={() => void record()}>Record{print ? ' and print' : ''}<Kbd>⏎</Kbd></Button>
              </div>
            </div>
          </Section>
        )}
      </div>
      <div>
        <div className={label}>{`Receipt · ${settings.paper}`}</div>
        <div className="rounded-[8px] border border-line bg-white p-3 font-mono text-[11px] leading-snug text-black shadow-sm">
          <div className="text-center font-bold">{a.location.name}</div>
          <div className="mt-1 border-t border-dashed border-black/50 pt-1">{`${inv?.number ?? ''} · ${a.customer.name}`}</div>
          {(qt?.lines ?? []).map((l, i) => <div key={i} className="flex justify-between"><span className="truncate">{l.description}</span><span>{money(l.unit_price * l.quantity)}</span></div>)}
          <div className="mt-1 flex justify-between border-t border-dashed border-black/50 pt-1 font-bold"><span>TOTAL</span><span>{money(inv?.total ?? qt?.total)}</span></div>
        </div>
        <p className="mt-1 text-[11px] text-ink-3">{settings.receiptPrinter ? `Prints on ${settings.receiptPrinter} when recorded` : 'Choose the receipt printer under This desk.'}</p>
      </div>
    </div>
  );
}
