import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Select } from '../../components/Select';
import { Button, ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { Ask, Field, input, Section } from '../garage/parts';
import { PageHead } from '../hr/parts';
import { codeOf, day, errorText, isZero, K, money, newKey, pGet, pPost, type FolioItem, type FolioShape, type FolioView, type Payment, type Service } from './api';
import { device } from './devices';
import { PaymentDialog } from './money';
import { Money, NoAccess, Refusal, usePms } from './parts';
import { folioDocumentHtml, printPage, type FolioDocument } from './print';
import { useShortcut } from './shortcuts';

/**
 * Posting a charge at the desk (PMS-CHG-001, PMS-FOL-001): a charge code of
 * the property (its price the default), a quantity, a description. To a
 * stay, it lands on the folio the stay's routing names (AC-07); to a folio,
 * there. The server prices and taxes it; one press is one line.
 */
export function ChargeDialog({ target, currency, onClose, onDone }: { target: { stay: number } | { folio: number }; currency: string; onClose: () => void; onDone: () => void }) {
  const pms = usePms();
  const services = useQuery({ queryKey: K.services(pms.property.id), queryFn: ({ signal }) => pGet<{ items: Service[] }>(`/properties/${pms.property.id}/services`, undefined, signal), retry: false });
  const list = (services.data?.items ?? []).filter((s) => s.active);
  const [code, setCode] = useState('');
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(() => newKey('charge'));
  const chosen = list.find((s) => s.code === code) ?? null;
  const valid = code.trim() !== '' && /^\d+(\.\d{1,3})?$/.test(qty) && Number(qty) > 0 && (!price || /^\d+(\.\d{1,2})?$/.test(price));

  const post = async () => {
    setBusy(true);
    setError(null);
    try {
      const path = 'stay' in target ? `/stays/${target.stay}/charges` : `/folios/${target.folio}/charges`;
      const r = await pPost<{ folio_id: number; balance: string; replayed: boolean }>(path, { service_code: code.trim().toUpperCase(), quantity: qty, ...(price ? { unit_price: price } : {}), ...(desc.trim() ? { description: desc.trim() } : {}) }, key);
      toast('success', `${r.message} Balance ${money(r.data.balance, currency)}.`);
      onDone();
    } catch (e) {
      setError(errorText(e, 'The charge was not posted.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Post a charge"
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!valid || !pms.online} onClick={() => void post()}>
            Post charge
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) void post();
        }}
      >
        {list.length ? (
          <Field label="Charge *">
            <Select
              aria-label="Charge"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setPrice('');
              }}
              options={[{ value: '', label: 'Choose…' }, ...list.map((s) => ({ value: s.code, label: `${s.name} · ${money(s.default_price, s.currency)}` }))]}
              className={input}
            />
          </Field>
        ) : (
          <Field label="Charge code *" hint={services.error ? 'The charge codes could not be listed for you; type the code (FNB, LAUNDRY…).' : undefined}>
            <input aria-label="Charge code" className={input} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoFocus />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity">
            <input aria-label="Quantity" className={input} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
          <Field label="Unit price" hint={chosen ? `Blank: ${money(chosen.default_price, chosen.currency)}` : 'Blank: the code’s price'}>
            <input aria-label="Unit price" className={input} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
        </div>
        <Field label="Description">
          <input aria-label="Description" className={input} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={chosen?.name ?? ''} />
        </Field>
        <p className="m-0 text-[12px] text-ink-3">{'stay' in target ? 'It lands on the folio the stay’s routing names for this charge.' : 'It lands on this folio.'} Taxes are the property’s, worked out by WorkSuite.</p>
        {error ? <Refusal text={error} /> : null}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

type LineAsk = { kind: 'void' | 'adjust' | 'transfer'; item: FolioItem } | { kind: 'refund' | 'void-payment'; payment: Payment } | { kind: 'reopen' } | null;

/**
 * A folio (§10.1–10.5): its lines with their taxes, the payments, the totals
 * and the tax summary, as the server keeps them; and what the desk does with
 * it — post, void (a line of today), adjust or transfer with a reason, take a
 * payment, refund, settle at nought, reopen, move a company's balance to its
 * account, raise the invoice, print. A closed day's lines are locked; limits
 * above which a manager must act are the server's (403 `over_limit`).
 */
export function FolioPanel({ id, others, onChanged }: { id: number; others?: FolioShape[]; onChanged?: () => void }) {
  const pms = usePms();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.folio(id), queryFn: ({ signal }) => pGet<{ folio: FolioView }>(`/folios/${id}`, undefined, signal) });
  const [charging, setCharging] = useState(false);
  const [paying, setPaying] = useState(false);
  const [ask, setAsk] = useState<LineAsk>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payKey, setPayKey] = useState(() => newKey('payment'));
  const f = q.data?.folio;

  useShortcut('charge', () => {
    if (!f || f.status !== 'open' || !pms.may('pms.folio.post') || !pms.online) return false;
    setCharging(true);
    return true;
  });

  const reload = () => {
    void qc.invalidateQueries({ queryKey: K.folio(id) });
    void qc.invalidateQueries({ queryKey: ['pms', 'stay'] });
    void qc.invalidateQueries({ queryKey: K.live });
    onChanged?.();
  };
  const run = async (fn: () => Promise<{ message: string }>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      toast('success', r.message);
      setAsk(null);
      reload();
      return true;
    } catch (e) {
      const code = codeOf(e);
      setError(code === 'over_limit' ? `${errorText(e)} Someone who manages Hotel PMS settings can do it.` : errorText(e, fallback));
      setAsk(null);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const print = async () => {
    try {
      const d = await pGet<FolioDocument>(`/folios/${id}/document`);
      await printPage({ title: `${d.kind === 'invoice' ? 'Invoice' : d.kind === 'receipt' ? 'Receipt' : 'Statement'} ${d.number ?? d.folio.folio_no}`, html: folioDocumentHtml(d), kind: d.kind });
    } catch (e) {
      toast('error', errorText(e, 'The folio could not be printed.'));
    }
  };

  if (q.isLoading) return <Spinner />;
  if (q.error || !f) return <ErrorNote error={q.error ?? new Error('The folio could not be loaded.')} onRetry={() => void q.refetch()} />;
  const open = f.status === 'open';
  const on = pms.online;
  const cur = f.currency;
  const options = new Set(f.options.map((o) => o.to));
  const drawer = device('cash_drawer');

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <b className="font-mono text-[13px]">{f.folio_no}</b>
        <span className="text-[13px] text-ink-2">
          {f.label} · {f.payee_name ?? f.payee_type}
        </span>
        <span className={cx('rounded-[6px] px-1.5 py-0.5 text-[11.5px] font-semibold', open ? 'bg-selection text-primary' : 'bg-subtle text-ink-2')}>{f.status_label}</span>
        {f.receipt_no ? <span className="text-[12px] text-ink-3">Receipt {f.receipt_no}</span> : null}
        {f.ar_reference ? <span className="text-[12px] text-ink-3">AR {f.ar_reference}</span> : null}
        <span className="flex-1" />
        <span className="text-[13px]">
          Balance <Money amount={f.balance} currency={cur} className={cx('text-[16px] font-extrabold', !isZero(f.balance) && 'text-danger')} />
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {open && pms.may('pms.folio.post') ? (
          <Button size="sm" icon="plus" disabled={!on} title="Alt+P" onClick={() => setCharging(true)}>
            Post charge
          </Button>
        ) : null}
        {open && pms.may('pms.payment.process') ? (
          <Button size="sm" variant="primary" icon="wallet" disabled={!on} onClick={() => setPaying(true)}>
            Take payment
          </Button>
        ) : null}
        {open && isZero(f.balance) && pms.mayAny('pms.payment.process', 'pms.checkout') ? (
          <Button size="sm" disabled={!on || busy} onClick={() => void run(() => pPost(`/folios/${id}/settle`), 'The folio was not settled.')}>
            Settle
          </Button>
        ) : null}
        {options.has('transferred_ar') && pms.may('pms.folio.adjust') ? (
          <Button size="sm" disabled={!on || busy} onClick={() => void run(() => pPost(`/folios/${id}/transfer-ar`), 'The balance was not moved to the account.')}>
            To the company’s account
          </Button>
        ) : null}
        {options.has('open') && pms.may('pms.folio.adjust') ? (
          <Button size="sm" disabled={!on} onClick={() => setAsk({ kind: 'reopen' })}>
            Reopen
          </Button>
        ) : null}
        {(f.status === 'settled' || f.status === 'transferred_ar') && !f.invoice_id && !f.receipt_no && pms.mayAny('pms.payment.process', 'pms.checkout') ? (
          <Button size="sm" disabled={!on || busy} onClick={() => void run(() => pPost(`/folios/${id}/invoice`), 'The invoice was not raised.')}>
            Invoice now
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" icon="printer" disabled={!on} onClick={() => void print()}>
          Print
        </Button>
        <Button size="sm" variant="ghost" icon="app-window" onClick={() => pms.openWindow({ kind: 'folio', id }, `Folio ${f.folio_no}`)}>
          Window
        </Button>
      </div>
      {error ? <Refusal text={error} /> : null}
      <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
        <table className="w-full text-left text-[12.5px]">
          <thead className="bg-subtle text-[10.5px] font-bold tracking-[.4px] text-ink-3 uppercase">
            <tr>
              <th className="px-2.5 py-1.5">Date</th>
              <th className="px-2.5 py-1.5">Line</th>
              <th className="px-2.5 py-1.5 text-right">Qty</th>
              <th className="px-2.5 py-1.5 text-right">Net</th>
              <th className="px-2.5 py-1.5 text-right">Tax</th>
              <th className="px-2.5 py-1.5 text-right">Total</th>
              <th className="px-2.5 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {f.items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-2.5 py-3 text-ink-3">
                  No charges yet.
                </td>
              </tr>
            ) : (
              f.items.map((i) => (
                <tr key={i.id} className={cx('border-t border-line', i.is_void && 'text-ink-3 line-through')}>
                  <td className="px-2.5 py-1.5 whitespace-nowrap">{day(i.business_date)}</td>
                  <td className="px-2.5 py-1.5">
                    {i.description}
                    <span className="ml-1.5 text-[11px] text-ink-3 no-underline">
                      {i.item_type_label}
                      {i.source !== 'front_desk' ? ` · ${i.source.replace(/_/g, ' ')}` : ''}
                      {i.locked ? ' · locked' : ''}
                      {i.void_reason ? ` · void: ${i.void_reason}` : ''}
                    </span>
                  </td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">{i.quantity}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">{money(i.amount)}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums" title={i.taxes.map((t) => `${t.name}: ${money(t.amount)}`).join('\n')}>
                    {money(i.tax_amount)}
                  </td>
                  <td className="px-2.5 py-1.5 text-right font-semibold tabular-nums">{money(i.total)}</td>
                  <td className="px-2.5 py-1.5 text-right whitespace-nowrap">
                    {open && !i.is_void && i.item_type !== 'tax' ? (
                      <span className="inline-flex gap-1">
                        {pms.may('pms.folio.void') && !i.locked ? (
                          <button type="button" className="text-[11.5px] font-semibold text-danger disabled:opacity-40" disabled={!on} onClick={() => setAsk({ kind: 'void', item: i })}>
                            Void
                          </button>
                        ) : null}
                        {pms.may('pms.folio.adjust') ? (
                          <>
                            <button type="button" className="text-[11.5px] font-semibold text-primary disabled:opacity-40" disabled={!on} onClick={() => setAsk({ kind: 'adjust', item: i })}>
                              Adjust
                            </button>
                            {(others ?? []).some((o) => o.id !== id && o.status === 'open') ? (
                              <button type="button" className="text-[11.5px] font-semibold text-primary disabled:opacity-40" disabled={!on} onClick={() => setAsk({ kind: 'transfer', item: i })}>
                                Move
                              </button>
                            ) : null}
                          </>
                        ) : null}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Section title="Payments">
          {f.payments === null ? (
            <p className="m-0 text-[12.5px] text-ink-3">Payments are shown to people who may see them.</p>
          ) : f.payments.length === 0 ? (
            <p className="m-0 text-[12.5px] text-ink-3">None yet.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px]">
              {f.payments.map((p) => (
                <li key={p.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">
                    {day(p.business_date)} · {p.kind_label} · {p.method_label}
                    {p.card_last4 ? ` ••• ${p.card_last4}` : ''} · <span className={cx(p.status === 'failed' || p.status === 'voided' ? 'text-danger' : p.status === 'pending' ? 'text-warning' : 'text-ink-3')}>{p.status_label}</span>
                  </span>
                  <Money amount={p.amount} currency={p.currency} className="font-semibold" />
                  {p.refundable && !isZero(p.refundable) && pms.may('pms.refund') ? (
                    <button type="button" className="text-[11.5px] font-semibold text-primary disabled:opacity-40" disabled={!on} onClick={() => setAsk({ kind: 'refund', payment: p })}>
                      Refund
                    </button>
                  ) : null}
                  {p.status === 'pending' && pms.may('pms.payment.process') ? (
                    <button type="button" className="text-[11.5px] font-semibold text-danger disabled:opacity-40" disabled={!on} onClick={() => setAsk({ kind: 'void-payment', payment: p })}>
                      Void
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Totals">
          <dl className="m-0 grid grid-cols-[1fr_max-content] gap-x-4 gap-y-1 text-[12.5px]">
            <dt className="text-ink-3">Charges</dt>
            <dd className="m-0 text-right tabular-nums">{money(f.totals.charges, cur)}</dd>
            <dt className="text-ink-3">Taxes</dt>
            <dd className="m-0 text-right tabular-nums">{money(f.totals.taxes, cur)}</dd>
            {f.tax_summary.map((t) => (
              <div key={t.name} className="contents">
                <dt className="pl-3 text-ink-3">{t.name}</dt>
                <dd className="m-0 text-right tabular-nums text-ink-3">{money(t.amount, cur)}</dd>
              </div>
            ))}
            {f.totals.payments !== null ? (
              <>
                <dt className="text-ink-3">Paid</dt>
                <dd className="m-0 text-right tabular-nums">{money(f.totals.payments, cur)}</dd>
              </>
            ) : null}
            {f.totals.refunds && !isZero(f.totals.refunds) ? (
              <>
                <dt className="text-ink-3">Refunded</dt>
                <dd className="m-0 text-right tabular-nums">{money(f.totals.refunds, cur)}</dd>
              </>
            ) : null}
            <dt className="font-bold">Balance</dt>
            <dd className="m-0 text-right font-bold tabular-nums">{money(f.totals.balance, cur)}</dd>
          </dl>
        </Section>
      </div>

      {charging ? <ChargeDialog target={{ folio: id }} currency={cur} onClose={() => setCharging(false)} onDone={() => (setCharging(false), reload())} /> : null}
      {paying ? (
        <PaymentDialog
          title={`Payment on ${f.folio_no}`}
          currency={cur}
          owed={f.balance}
          busy={busy}
          error={error}
          onClose={() => {
            setPaying(false);
            setError(null);
          }}
          onPay={(body) =>
            void run(() => pPost(`/folios/${id}/payments`, body, payKey), 'The payment was not taken.').then((ok) => {
              if (!ok) return;
              setPaying(false);
              setPayKey(newKey('payment'));
              if (body.method === 'cash' && drawer.available()) void drawer.open('payment');
            })
          }
        />
      ) : null}
      {ask?.kind === 'void' ? (
        <Ask title={`Void “${ask.item.description}”`} text="A line of today only; its taxes go with it." fields={[{ name: 'reason', label: 'Reason', required: true }]} confirm="Void" danger busy={busy} onClose={() => setAsk(null)} onSubmit={(v) => void run(() => pPost(`/folio-items/${ask.item.id}/void`, v), 'The line was not voided.')} />
      ) : null}
      {ask?.kind === 'adjust' ? (
        <Ask
          title={`Adjust “${ask.item.description}”`}
          text="A new line pointing at this one, taxed as it was. A negative amount reduces the price."
          fields={[
            { name: 'amount', label: 'Change to the price', required: true, placeholder: '-500.00' },
            { name: 'reason', label: 'Reason', required: true },
          ]}
          busy={busy}
          onClose={() => setAsk(null)}
          onSubmit={(v) => void run(() => pPost(`/folio-items/${ask.item.id}/adjust`, v), 'The line was not adjusted.')}
        />
      ) : null}
      {ask?.kind === 'transfer' ? (
        <Ask
          title={`Move “${ask.item.description}”`}
          fields={[
            { name: 'folio_id', label: 'To folio', type: 'select', options: (others ?? []).filter((o) => o.id !== id && o.status === 'open').map((o) => ({ value: String(o.id), label: `${o.folio_no} · ${o.label}` })) },
            { name: 'reason', label: 'Reason', required: true },
          ]}
          confirm="Move"
          busy={busy}
          onClose={() => setAsk(null)}
          onSubmit={(v) => void run(() => pPost(`/folio-items/${ask.item.id}/transfer`, { folio_id: Number(v.folio_id), reason: v.reason }), 'The line was not moved.')}
        />
      ) : null}
      {ask?.kind === 'refund' ? (
        <Ask
          title={`Refund ${ask.payment.method_label.toLowerCase()} ${money(ask.payment.amount, ask.payment.currency)}`}
          fields={[
            { name: 'amount', label: 'Amount', hint: `Blank: all that is left (${money(ask.payment.refundable, ask.payment.currency)}).` },
            { name: 'reason', label: 'Reason', required: true },
          ]}
          confirm="Refund"
          danger
          busy={busy}
          onClose={() => setAsk(null)}
          onSubmit={(v) =>
            void run(() => pPost(`/payments/${ask.payment.id}/refund`, { reason: v.reason, ...(v.amount ? { amount: v.amount } : {}) }), 'The refund was not made.').then((ok) => {
              if (ok && ask.payment.method === 'cash' && drawer.available()) void drawer.open('refund');
            })
          }
        />
      ) : null}
      {ask?.kind === 'void-payment' ? (
        <Ask title="Void the waiting payment" fields={[{ name: 'reason', label: 'Reason', required: true }]} confirm="Void" danger busy={busy} onClose={() => setAsk(null)} onSubmit={(v) => void run(() => pPost(`/payments/${ask.payment.id}/void`, v), 'The payment was not voided.')} />
      ) : null}
      {ask?.kind === 'reopen' ? (
        <Ask title={`Reopen ${f.folio_no}`} fields={[{ name: 'reason', label: 'Reason', required: true }]} confirm="Reopen" busy={busy} onClose={() => setAsk(null)} onSubmit={(v) => void run(() => pPost(`/folios/${id}/reopen`, v), 'The folio was not reopened.')} />
      ) : null}
    </div>
  );
}

/** One folio on its own screen (`/pms/folios/<id>`, a notification's or a night-audit blocker's link). */
export default function FolioScreen({ id }: { id: number }) {
  const pms = usePms();
  const q = useQuery({ queryKey: K.folio(id), queryFn: ({ signal }) => pGet<{ folio: FolioView }>(`/folios/${id}`, undefined, signal), enabled: pms.may('pms.folio.view') });
  const f = q.data?.folio;
  useEffect(() => {
    if (f) pms.adopt(f.property_id);
  }, [f, pms]);
  if (!pms.may('pms.folio.view')) return <NoAccess what="Folios are shown to people who may see them (“See folios”)." />;
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title={f ? `Folio ${f.folio_no}` : 'Folio'} sub={f ? `${f.label}${f.payee_name ? ` · ${f.payee_name}` : ''}` : undefined}>
        <Button variant="ghost" icon="back" onClick={pms.back}>
          Back
        </Button>
        {f?.stay_id ? (
          <Button onClick={() => pms.open({ kind: 'stay', id: f.stay_id!, folio: id })}>The stay</Button>
        ) : f?.reservation_id ? (
          <Button onClick={() => pms.open({ kind: 'reservation', id: f.reservation_id! })}>The reservation</Button>
        ) : null}
      </PageHead>
      <FolioPanel id={id} />
    </div>
  );
}
