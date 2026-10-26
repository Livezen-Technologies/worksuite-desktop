import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { Avatar, Empty, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { amount, answered, attemptKey, clockAt, dayMonth, fetchToday, fetchVisit, K, owing, readyToPay, refusal, shortDay, stillToPay, type ReceiptChannel } from './api';
import {
  checkout,
  fetchCheckout,
  fetchReceipt,
  fetchRegister,
  fetchRetail,
  handedOver,
  METHOD_LABEL,
  MK,
  moneyTyped,
  openDrawer,
  payRest,
  pressKey,
  printReceipt,
  quoteCheckout,
  suggestions,
  type CheckoutQuote,
  type PriceInputs,
  type ReceiptData,
  type RegisterState,
  type RetailItem,
  type RetailLine,
  type Tender,
  type TenderMethod,
} from './money';
import { Failed, Figure, firstName, Keypad, MoneyLine, Note, Page, Panel, servicesOf, shortName, stylistsOf, TierTag, TouchButton, useDesk, usePrintSettings } from './parts';
import { SendReceipt } from './SendReceipt';
import { StatGrid } from '../../components/StatCard';

/**
 * Taking payment at the counter (D06, D07, D14, CHK-01…06, PAY-01…09).
 *
 * The bill is WorkSuite's — lines at booked prices, the tier discount, points,
 * the advance applied once, store credit, what is left to pay — and is asked
 * for again whenever points, credit or retail change. The money is the
 * cashier's: cash on a keypad, a card, LankaQR, a transfer, or a mix.
 *
 * One press is one invoice. The request carries a key made for this attempt:
 * a second press, or a retry after a dropped line, is the same payment, and
 * the server answers it with the first answer. A refusal ends the attempt.
 *
 * With the money taken, the drawer opens if cash was handed over, the receipt
 * prints — straight to the desk's printer — and the Paid screen says what to
 * give back, beside the receipt as it printed.
 */
type Mode = 'cash' | 'card' | 'wallet' | 'bank_transfer' | 'split';

const MODES: Array<{ value: Mode; label: string; icon: string }> = [
  { value: 'cash', label: 'Cash', icon: 'banknote' },
  { value: 'card', label: 'Card', icon: 'credit-card' },
  { value: 'wallet', label: 'LankaQR', icon: 'qr-code' },
  { value: 'bank_transfer', label: 'Bank transfer', icon: 'landmark' },
];

const REFERENCE_HINT: Record<string, string> = {
  card: 'The approval code, or the last four digits.',
  wallet: 'The LankaQR or wallet transaction id.',
  bank_transfer: 'The transfer reference.',
};

export default function Pay() {
  const desk = useDesk();
  const id = Number(desk.params.get('visit') ?? 0);
  return id > 0 ? <TakePayment key={id} visitId={id} /> : <WhoIsPaying />;
}

/** Who is waiting to pay: in the chair or done and not checked out, or checked out and still owing. */
function WhoIsPaying() {
  const desk = useDesk();
  const q = useQuery({ queryKey: K.today(desk.location.id), queryFn: ({ signal }) => fetchToday(desk.location.id, signal), refetchInterval: 60_000 });
  const ready = q.data ? readyToPay(q.data) : [];

  return (
    <Page title="Take payment" sub="Visits in the chair or done, not yet paid. Totals come from WorkSuite.">
      {q.isError ? (
        <Failed text="Today’s visits could not be loaded." onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <Spinner label="Loading visits to pay…" />
      ) : ready.length === 0 ? (
        <Panel>
          <Empty icon="banknote" title="Nobody is waiting to pay." hint="A visit appears here once its client is checked in." />
        </Panel>
      ) : (
        <Panel>
          <ul>
            {ready.map((v) => (
              <li key={v.id} className="flex items-center gap-3.5 border-t border-line py-3 first:border-t-0">
                <Avatar name={v.client.name} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[16px] font-bold text-ink">{v.client.name}</span>
                    <TierTag tier={v.client.tier} />
                  </div>
                  <div className="truncate text-[13px] text-ink-2">
                    {v.number} · {servicesOf(v)} · {stylistsOf(v)} · {v.status_label}
                    {owing(v) ? ' · checked out, still owing' : ''}
                  </div>
                </div>
                <span className="text-[16px] font-extrabold text-ink tabular-nums">{amount(stillToPay(v), v.money.currency)}</span>
                <TouchButton variant="primary" icon="banknote" disabled={!desk.may('salon.checkout')} onClick={() => desk.go('pay', { visit: v.id })}>
                  {owing(v) ? 'Take the rest' : 'Take payment'}
                </TouchButton>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </Page>
  );
}

function TakePayment({ visitId }: { visitId: number }) {
  const desk = useDesk();
  const qc = useQueryClient();
  const print = usePrintSettings();
  const [inputs, setInputs] = useState<PriceInputs>({ redeem_points: 0, use_credit: false, retail: [] });
  const [priced, setPriced] = useState<CheckoutQuote | null>(null);
  const [pricing, setPricing] = useState(false);
  const [pointsTyped, setPointsTyped] = useState('');
  const [mode, setMode] = useState<Mode>('cash');
  const [cash, setCash] = useState('');
  const [other, setOther] = useState({ amount: '', reference: '' });
  const [split, setSplit] = useState<Array<{ method: TenderMethod; amount: string; reference: string }>>([
    { method: 'cash', amount: '', reference: '' },
    { method: 'card', amount: '', reference: '' },
  ]);
  const [keep, setKeep] = useState<boolean | null>(null);
  const [retailOpen, setRetailOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(attemptKey);

  const quote = useQuery({ queryKey: MK.checkout(visitId), queryFn: ({ signal }) => fetchCheckout(visitId, signal) });
  const q = priced ?? quote.data;
  const invoiced = !!q?.invoiced;
  const detail = useQuery({ queryKey: K.visit(visitId), queryFn: ({ signal }) => fetchVisit(visitId, signal) });
  const register = useQuery({ queryKey: MK.register(desk.desk.id), queryFn: ({ signal }) => fetchRegister(desk.desk.id, signal) });
  const visit = detail.data?.visit;
  const due = invoiced ? (visit?.invoice?.owed ?? null) : (q?.to_pay ?? null);
  const keepAsCredit = keep ?? q?.overpay_default === 'credit';

  /* The keyboard's digits work on the cash keypad too. */
  useEffect(() => {
    if (mode !== 'cash') return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (document.querySelector('[role="dialog"]')) return;
      const k = /^\d$/.test(e.key) ? e.key : e.key === 'Backspace' ? 'back' : null;
      if (!k) return;
      e.preventDefault();
      setCash((c) => pressKey(c, k));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);

  const tenders: Tender[] =
    mode === 'cash'
      ? [{ method: 'cash', amount: Number(cash || 0), reference: null }]
      : mode === 'split'
        ? split.map((r) => ({ method: r.method, amount: Number(r.amount || 0), reference: r.reference.trim() || null }))
        : [{ method: mode, amount: other.amount === '' ? (due ?? 0) : Number(other.amount), reference: other.reference.trim() || null }];
  const h = handedOver(tenders, due);
  const nothingToTake = due !== null && Math.round(due * 100) <= 0;
  const reg = register.data;

  /* Points, credit or retail changed: priced again by the server, and kept only once it has priced them. */
  async function reprice(next: PriceInputs) {
    if (next.redeem_points === 0 && !next.use_credit && next.retail.length === 0) {
      setPriced(null);
      setInputs(next);
      setKey(attemptKey());
      return;
    }
    setPricing(true);
    try {
      setPriced(await quoteCheckout(visitId, next));
      setInputs(next);
      setKey(attemptKey());
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'That could not be priced.');
    } finally {
      setPricing(false);
    }
  }

  async function take() {
    if (!q || due === null) return;
    setBusy(true);
    const pay = { tenders: h.tenders, keep_as_credit: keepAsCredit, desk_id: desk.desk.id };
    try {
      const r = invoiced ? await payRest(visitId, { ...pay, use_credit: inputs.use_credit }, key) : await checkout(visitId, inputs, pay, key);
      const result = r.data;
      desk.paid.remember(visitId, result);
      toast('success', r.message || 'Paid.');
      for (const p of result.paid?.problems ?? []) toast('warning', p);
      void qc.invalidateQueries({ queryKey: K.all });

      const s = print.data;
      const tookMoney = !!result.paid?.ok;
      /* The drawer and the receipt come out together, as the Paid screen opens; Paid says how each went. */
      if (tookMoney && h.cash > 0 && s?.drawer === 'printer') {
        void openDrawer()
          .then((o) => {
            desk.paid.note(visitId, { drawer: o });
            if (!o.ok) toast('warning', o.message);
          })
          .catch(() => toast('warning', 'The drawer did not open. Open it from the Paid screen.'));
      }
      if (result.paid && s?.auto_print) {
        void printReceipt(visitId)
          .then((o) => {
            desk.paid.note(visitId, { printed: o });
            if (!o.ok) toast('warning', `${o.message} Print it again from the Paid screen.`);
          })
          .catch((e: unknown) => toast('warning', `${e instanceof Error ? e.message : 'The receipt could not be printed.'} Print it again from the Paid screen.`));
      }
      desk.go('paid', { visit: visitId });
    } catch (e) {
      if (!answered(e)) {
        /* No answer: the next press sends the same payment under the same key, so it can never be taken twice. */
        toast('error', 'WorkSuite did not answer. Press again — the same payment is sent, never a second one.');
      } else {
        toast('error', e instanceof Error ? e.message : 'The payment was not taken.');
        setKey(attemptKey());
        void qc.invalidateQueries({ queryKey: MK.register(desk.desk.id) });
        /* Checked out meanwhile — by another desk, or by a press that got no answer: take the rest against its invoice. */
        if (refusal(e).code === 'invoiced') {
          setPriced(null);
          void qc.invalidateQueries({ queryKey: MK.checkout(visitId) });
          void qc.invalidateQueries({ queryKey: K.visit(visitId) });
        }
      }
    } finally {
      setBusy(false);
    }
  }

  if (quote.isError && !q) {
    return (
      <Page title="Take payment">
        <Failed text={quote.error instanceof Error ? quote.error.message : 'The bill could not be priced.'} onRetry={() => void quote.refetch()} />
        <div>
          <TouchButton icon="back" onClick={() => desk.go('pay')}>
            Back
          </TouchButton>
        </div>
      </Page>
    );
  }
  if (!q) return <Spinner label="Pricing the bill…" />;

  const client = visit?.client;
  const services = q.lines.filter((l) => l.kind === 'service');
  const retail = q.lines.filter((l) => l.kind === 'product');
  const over = h.over;
  const advanceDay = detail.data?.advances?.[0]?.date ?? null;
  const takeLabel = nothingToTake
    ? 'Complete checkout'
    : `Take ${amount(h.handed / 100, q.currency).replace(/\.00$/, '')}${over < 0 && h.handed > 0 ? ' · part payment' : ''}${reg?.register && reg.session ? ' · complete POS sale' : ''}${print.data?.auto_print ? ' & print' : ''}`;
  const canTake = desk.may('salon.checkout') && due !== null && !pricing && (nothingToTake || h.handed > 0) && !h.missingReference;
  const pick = (m: Mode) => {
    setMode(m);
    setKey(attemptKey());
  };

  return (
    <Page title="Take payment" sub={`Totals come from WorkSuite.${reg?.register && reg.session ? ' The money goes into your open POS register.' : ''}`}>
      <div className="flex flex-col gap-3.5 xl:flex-row xl:items-start">
        <Panel className="flex w-full flex-col gap-1 xl:w-[430px] xl:shrink-0">
          <div className="flex items-center gap-2.5 pb-1">
            <Avatar name={client?.name ?? q.number} size={42} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-[17px] font-extrabold text-ink">{client?.name ?? `Visit ${q.number}`}</span>
                {q.tier ? <TierTag tier={q.tier.name} /> : null}
                {invoiced ? <span className="rounded-full bg-selection px-2 text-[11px] font-semibold text-primary">Invoiced</span> : null}
              </div>
              <div className="truncate text-[12px] text-ink-2">
                {q.number}
                {q.loyalty ? ` · ${q.points_balance.toLocaleString()} points` : ''} · store credit {amount(q.credit_available)}
              </div>
            </div>
          </div>

          <ul>
            {[...services, ...retail].map((l, i) => (
              <li key={`${l.kind}-${l.appointment_id}-${l.product_id ?? i}`} className="flex items-center gap-3 border-t border-line py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-bold text-ink">
                    {l.description}
                    {l.quantity !== 1 ? ` × ${l.quantity}` : ''}
                  </div>
                  <div className="truncate text-[12px] text-ink-2">
                    {l.kind === 'product'
                      ? `Retail${l.provider ? ` · sold by ${l.provider}` : ''}`
                      : [l.provider, l.tier ? `${l.tier}${l.multiplier ? ` ×${l.multiplier.toFixed(2)}` : ''}` : null].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <span className="text-[15px] font-bold text-ink tabular-nums">{amount(l.unit_price * l.quantity)}</span>
                {l.kind === 'product' && !invoiced ? (
                  <button
                    type="button"
                    aria-label={`Remove ${l.description}`}
                    disabled={pricing}
                    onClick={() => void reprice({ ...inputs, retail: inputs.retail.filter((r) => r.product_id !== l.product_id) })}
                    className="grid h-9 w-9 place-items-center rounded-[10px] text-danger hover:bg-danger-bg"
                  >
                    <Icon name="trash" size={16} />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>

          {!invoiced ? (
            <button type="button" onClick={() => setRetailOpen(true)} className="mt-1 mb-2 flex min-h-10 w-full items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-[#C9CEDD] bg-surface text-[13px] font-bold text-primary hover:bg-subtle dark:border-line">
              <Icon name="plus" size={15} /> Add retail from POS catalogue
            </button>
          ) : null}

          <dl className="border-t border-line pt-2">
            <MoneyLine label={retail.length ? 'Services and retail' : 'Services'} value={q.gross} />
            {q.tier_discount > 0 ? <MoneyLine label={q.tier ? `${q.tier.name} member ${q.tier.discount}%` : 'Member discount'} value={-q.tier_discount} tone="saving" /> : null}
            {q.points_value > 0 ? <MoneyLine label={`${q.points.toLocaleString()} points`} value={-q.points_value} tone="saving" /> : null}
            {q.discount > 0 ? <MoneyLine label="Discount" value={-q.discount} tone="saving" /> : null}
            {q.tax > 0 ? <MoneyLine label="Tax" value={q.tax} /> : null}
            <MoneyLine label="Invoice total" value={q.total} currency={q.currency} strong />
            {q.advance > 0 ? <MoneyLine label={advanceDay ? `Advance from ${dayMonth(advanceDay, false)}` : 'Advance held'} value={-q.advance} tone="advance" /> : null}
            {q.credit > 0 ? <MoneyLine label="Store credit" value={-q.credit} tone="advance" /> : null}
            {invoiced && visit?.invoice ? <MoneyLine label={`Paid on ${visit.invoice.number ?? 'the invoice'}`} value={-visit.invoice.paid} /> : null}
          </dl>
          <div className="mt-2 flex items-center justify-between rounded-[14px] bg-navy px-4 py-3.5 text-white">
            <span className="text-[14px] text-[#C7D2FE]">To pay</span>
            <span className="text-[28px] font-extrabold tabular-nums">{due === null ? '…' : amount(due)}</span>
          </div>

          {!invoiced && q.loyalty && q.points_balance > 0 ? (
            <div className="mt-2 flex items-center gap-2">
              <span className="min-w-0 flex-1 text-[12.5px] text-ink-2">Use points · each worth {amount(q.point_value)}</span>
              <input
                aria-label="Points to use"
                inputMode="numeric"
                placeholder="0"
                value={pointsTyped}
                onChange={(e) => setPointsTyped(e.target.value.replace(/\D+/g, ''))}
                className="h-10 w-24 rounded-[10px] border border-line bg-surface px-2.5 text-right text-[14px] text-ink outline-none tabular-nums focus:border-primary"
              />
              <TouchButton className="min-h-10 px-3.5 text-[13px]" loading={pricing} onClick={() => void reprice({ ...inputs, redeem_points: Math.max(0, Math.floor(Number(pointsTyped) || 0)) })}>
                Use
              </TouchButton>
            </div>
          ) : null}
          {pricing ? (
            <p className="text-[12px] text-ink-3" role="status">
              Pricing…
            </p>
          ) : null}
        </Panel>

        <Panel className="flex min-w-0 flex-1 flex-col gap-3">
          <RegisterBanner state={reg} loading={register.isLoading} failed={register.isError} />

          <div role="radiogroup" aria-label="How they pay" className="grid grid-cols-3 gap-2 md:grid-cols-6">
            {MODES.map((m) => (
              <Method key={m.value} icon={m.icon} label={m.label} on={mode === m.value} onClick={() => pick(m.value)} />
            ))}
            <Method
              icon="wallet"
              label="Store credit"
              on={inputs.use_credit}
              role="switch"
              disabled={pricing || (!inputs.use_credit && q.credit_available <= 0)}
              title={q.credit_available > 0 ? `${amount(q.credit_available, q.currency)} to use` : 'No store credit to use'}
              onClick={() => void reprice({ ...inputs, use_credit: !inputs.use_credit })}
            />
            <Method icon="columns" label="Split" on={mode === 'split'} onClick={() => pick('split')} />
          </div>

          {nothingToTake ? (
            <Note tone="indigo">Nothing is left to pay — the advance and credit cover it.</Note>
          ) : mode === 'cash' ? (
            <div className="flex flex-col gap-3.5 lg:flex-row">
              <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                <div>
                  <div className="text-[12px] font-bold tracking-[.03em] text-ink-2 uppercase">Cash received</div>
                  <output aria-label="Cash received" className="mt-1 block rounded-[14px] border-2 border-primary bg-surface px-3.5 py-2 text-right font-mono text-[30px] font-bold text-ink tabular-nums">
                    {amount(Number(cash || 0))}
                  </output>
                </div>
                {due !== null ? (
                  <div className="grid grid-cols-4 gap-2">
                    <Quick onClick={() => setCash(String(due))}>Exact</Quick>
                    {suggestions(due)
                      .slice(0, 3)
                      .map((s) => (
                        <Quick key={s} onClick={() => setCash(String(s))}>
                          {s.toLocaleString('en-US')}
                        </Quick>
                      ))}
                  </div>
                ) : null}
                {over > 0 && h.cash > 0 ? <OverChoice over={over} currency={q.currency} keep={keepAsCredit} onKeep={setKeep} /> : null}
                {over < 0 && h.handed > 0 ? <p className="text-[13px] font-semibold text-warning">Short by {amount(-over / 100, q.currency)} — this takes part of it; the rest stays owed on the invoice.</p> : null}
              </div>
              <Keypad label="Cash keypad" onKey={(k) => setCash((c) => pressKey(c, k))} className="w-full lg:w-[270px] lg:shrink-0" />
            </div>
          ) : mode === 'split' ? (
            <div className="flex flex-col gap-2">
              {split.map((r, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 rounded-[12px] border border-line p-2">
                  <select
                    aria-label={`Tender ${i + 1}`}
                    value={r.method}
                    onChange={(e) => setSplit((s) => s.map((x, j) => (j === i ? { ...x, method: e.target.value as TenderMethod } : x)))}
                    className="h-11 w-40 rounded-[10px] border border-line bg-surface px-2 text-[14px] text-ink"
                  >
                    {(['cash', 'card', 'wallet', 'bank_transfer'] as TenderMethod[]).map((m) => (
                      <option key={m} value={m}>
                        {METHOD_LABEL[m]}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label={`Amount ${i + 1}`}
                    inputMode="decimal"
                    placeholder="0.00"
                    value={r.amount}
                    onChange={(e) => setSplit((s) => s.map((x, j) => (j === i ? { ...x, amount: moneyTyped(e.target.value) } : x)))}
                    className="h-11 w-32 rounded-[10px] border border-line bg-surface px-2.5 text-right text-[15px] text-ink tabular-nums"
                  />
                  {r.method !== 'cash' ? (
                    <input
                      aria-label={`Reference ${i + 1}`}
                      placeholder="Reference"
                      maxLength={120}
                      value={r.reference}
                      onChange={(e) => setSplit((s) => s.map((x, j) => (j === i ? { ...x, reference: e.target.value } : x)))}
                      className="h-11 min-w-24 flex-1 rounded-[10px] border border-line bg-surface px-2.5 text-[14px] text-ink"
                    />
                  ) : null}
                  {split.length > 1 ? (
                    <button type="button" aria-label={`Remove tender ${i + 1}`} onClick={() => setSplit((s) => s.filter((_, j) => j !== i))} className="grid h-11 w-11 place-items-center rounded-[10px] text-danger hover:bg-danger-bg">
                      <Icon name="trash" size={16} />
                    </button>
                  ) : null}
                </div>
              ))}
              <div>
                <TouchButton className="min-h-10 text-[13px]" icon="plus" onClick={() => setSplit((s) => [...s, { method: 'card', amount: '', reference: '' }])}>
                  Add a tender
                </TouchButton>
              </div>
              {due !== null ? (
                <p className="text-[14px] text-ink">
                  {over < 0 ? (
                    <>
                      Still to cover: <b className="tabular-nums">{amount(-over / 100, q.currency)}</b>
                    </>
                  ) : over > 0 ? (
                    <>
                      Over by <b className="tabular-nums">{amount(over / 100, q.currency)}</b>
                    </>
                  ) : (
                    'Covered exactly.'
                  )}
                </p>
              ) : null}
              {over > 0 && h.cash > 0 ? <OverChoice over={over} currency={q.currency} keep={keepAsCredit} onKeep={setKeep} /> : null}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-bold tracking-[.03em] text-ink-2 uppercase">{MODES.find((m) => m.value === mode)?.label} amount</span>
                <input
                  aria-label="Amount"
                  inputMode="decimal"
                  placeholder={due !== null ? amount(due) : ''}
                  value={other.amount}
                  onChange={(e) => setOther((o) => ({ ...o, amount: moneyTyped(e.target.value) }))}
                  className="rounded-[14px] border-2 border-primary bg-surface px-3.5 py-2 text-right font-mono text-[28px] font-bold text-ink outline-none tabular-nums placeholder:text-ink-3"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12.5px] font-semibold text-ink-2">Reference</span>
                <input maxLength={120} value={other.reference} placeholder={REFERENCE_HINT[mode]} onChange={(e) => setOther((o) => ({ ...o, reference: e.target.value }))} className="h-12 rounded-[12px] border border-line bg-surface px-3.5 text-[15px] text-ink outline-none focus:border-primary" />
              </label>
              {over > 0 ? <p className="text-[13px] text-ink-2">Over by {amount(over / 100, q.currency)}: only cash is given back, so this is kept as store credit.</p> : null}
            </div>
          )}

          <div className="flex gap-2.5">
            <TouchButton icon="back" onClick={() => desk.go('pay')}>
              Back
            </TouchButton>
            <TouchButton variant="primary" icon={print.data?.auto_print ? 'printer' : 'banknote'} className="flex-1" loading={busy} disabled={!canTake} onClick={() => void take()}>
              {takeLabel}
            </TouchButton>
          </div>
          {h.missingReference ? <p className="text-[12.5px] text-warning">Give the reference for each card, LankaQR or transfer payment.</p> : null}
          {canTake && !nothingToTake ? (
            <p className="text-[12px] text-ink-2">
              One transaction: Billing invoice + receipt{reg?.register && reg.session ? ` + POS sale in register ${reg.register.code}, session #${reg.session.id}` : ''}
              {h.cash > 0 ? ` (cash in ${amount(h.cash / 100).replace(/\.00$/, '')}${over > 0 ? `, ${keepAsCredit ? `${amount(over / 100)} to credit` : `change ${amount(over / 100)}`}` : ''})` : ''}.
              {h.cash > 0 && print.data?.drawer === 'printer' ? ' The drawer opens.' : ''}
            </p>
          ) : null}
        </Panel>
      </div>

      {retailOpen ? (
        <RetailSheet
          lines={inputs.retail}
          sellers={[...new Map(services.filter((l) => l.provider_id).map((l) => [l.provider_id!, l.provider ?? ''])).entries()].map(([id, name]) => ({ id, name }))}
          clientName={client?.name ?? null}
          onClose={() => setRetailOpen(false)}
          onAdd={(lines) => {
            setRetailOpen(false);
            void reprice({ ...inputs, retail: lines });
          }}
        />
      ) : null}
    </Page>
  );
}

/** A way to pay, as a tile (D06). */
function Method({ icon, label, on, onClick, disabled, title, role = 'radio' }: { icon: string; label: string; on: boolean; onClick: () => void; disabled?: boolean; title?: string; role?: 'radio' | 'switch' }) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={on}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cx(
        'flex min-h-[70px] flex-col items-center justify-center gap-[5px] rounded-[14px] text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-40',
        on ? 'border-2 border-primary bg-selection text-primary' : 'border border-line bg-surface text-ink enabled:hover:bg-subtle',
      )}
    >
      <Icon name={icon} size={20} />
      {label}
    </button>
  );
}

function Quick({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="min-h-11 rounded-[12px] border border-line bg-surface text-[14px] font-bold text-ink tabular-nums hover:bg-subtle">
      {children}
    </button>
  );
}

/** Over what is due, with cash in it: give change, or keep the rest as store credit. */
function OverChoice({ over, currency, keep, onKeep }: { over: number; currency: string; keep: boolean; onKeep: (keep: boolean) => void }) {
  return (
    <div className="rounded-[14px] border border-[#DDD6FE] bg-[#F5F3FF] px-3.5 py-3 text-[#4C1D95] dark:border-[#4C1D95] dark:bg-[#2E1D4A] dark:text-[#DDD6FE]">
      <div className="flex items-baseline justify-between text-[17px] font-extrabold">
        <span>Over by</span>
        <span className="tabular-nums">{amount(over / 100, currency)}</span>
      </div>
      <div role="radiogroup" aria-label="What to do with the rest" className="mt-2 grid grid-cols-2 gap-2">
        {[
          { v: true, label: 'Keep as store credit' },
          { v: false, label: `Give ${amount(over / 100)} change` },
        ].map((o) => (
          <button
            key={String(o.v)}
            type="button"
            role="radio"
            aria-checked={keep === o.v}
            onClick={() => onKeep(o.v)}
            className={cx(
              'min-h-[46px] rounded-[12px] px-2 text-[13px]',
              keep === o.v ? 'border-2 border-[#6D28D9] bg-surface font-extrabold text-[#6D28D9] dark:border-[#C4B5FD] dark:text-[#DDD6FE]' : 'border border-[#DDD6FE] bg-transparent font-bold dark:border-[#4C1D95]',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Which register the money goes into, and whether it is open (POS-02). */
function RegisterBanner({ state, loading, failed }: { state?: RegisterState; loading: boolean; failed: boolean }) {
  const desk = useDesk();
  if (loading) return <Spinner label="Checking the register…" />;
  if (failed || !state) return <Note tone="warning">Could not check the register. WorkSuite still refuses a payment the register cannot take.</Note>;
  if (!state.register) return <Note>{state.message ?? 'No POS register is paired: payments are recorded as Billing receipts.'}</Note>;
  if (!state.session) {
    return (
      <Note
        tone="warning"
        icon="store"
        action={
          desk.may('pos.register.open') ? (
            <TouchButton variant="primary" className="min-h-10 text-[13px]" onClick={() => desk.go('register')}>
              Open register
            </TouchButton>
          ) : null
        }
      >
        <b>Register {state.register.code} is closed.</b> Open it to take payment; bookings and check-ins carry on meanwhile.
      </Note>
    );
  }
  const s = state.session;
  return (
    <div className="flex items-center gap-3 rounded-[14px] border border-teal-light bg-[#E6F7F8] px-3.5 py-2.5 text-[#134E4A] dark:bg-teal/15 dark:text-teal-light">
      <Icon name="store" size={20} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-extrabold">
          Paying into register {state.register.code} · {state.register.name}
        </div>
        <div className="truncate text-[12px]">
          Session #{s.id} opened {s.opened_at ? clockAt(s.opened_at, desk.location.timezone) : ''}
          {s.mine && desk.me ? ` by ${shortName(desk.me)}` : ''} · float {amount(s.opening_float).replace(/\.00$/, '')} · {s.sales.count} sale{s.sales.count === 1 ? '' : 's'} today
        </div>
      </div>
      <button type="button" onClick={() => desk.go('register')} className="shrink-0 text-[12px] font-bold text-[#0F766E] underline dark:text-teal-light">
        Open register
      </button>
    </div>
  );
}

/**
 * Retail from the desk's shelf — Point of Sale's catalogue and stock — onto
 * this visit's bill (D14, POS-04). A scanner types the barcode and Enter: an
 * exact code is added at once.
 */
function RetailSheet({ lines, sellers, clientName, onClose, onAdd }: { lines: RetailLine[]; sellers: Array<{ id: number; name: string }>; clientName: string | null; onClose: () => void; onAdd: (lines: RetailLine[]) => void }) {
  const desk = useDesk();
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState('all');
  const [seller, setSeller] = useState<number | null>(lines[0]?.seller_id ?? sellers[0]?.id ?? null);
  const [chosen, setChosen] = useState<Array<RetailLine & { name: string; price: number }>>(() => lines.map((l) => ({ ...l, name: `Product ${l.product_id}`, price: 0 })));
  const q = useQuery({ queryKey: MK.retail(desk.desk.id, term.trim()), queryFn: ({ signal }) => fetchRetail(desk.desk.id, term.trim(), signal) });
  const items = (q.data?.items ?? []).filter((i) => category === 'all' || i.category === category);
  const known = new Map((q.data?.items ?? []).map((i) => [i.id, i]));
  const count = chosen.reduce((n, l) => n + l.quantity, 0);
  const sum = chosen.reduce((n, l) => n + (known.get(l.product_id)?.price ?? l.price) * l.quantity, 0);
  const sellerName = sellers.find((s) => s.id === seller)?.name;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const add = (i: RetailItem) => setChosen((c) => (c.some((l) => l.product_id === i.id) ? c.map((l) => (l.product_id === i.id ? { ...l, quantity: l.quantity + 1 } : l)) : [...c, { product_id: i.id, quantity: 1, seller_id: seller, name: i.name, price: i.price }]));
  const less = (id: number) => setChosen((c) => c.flatMap((l) => (l.product_id !== id ? [l] : l.quantity > 1 ? [{ ...l, quantity: l.quantity - 1 }] : [])));

  return (
    <div className="no-drag fixed inset-0 z-50 flex flex-col justify-end bg-[#0F1B3D]/45" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="salon-retail" className="animate-in flex h-[min(640px,80vh)] flex-col gap-3 rounded-t-[24px] bg-surface px-[22px] pt-[18px] pb-4 shadow-[0_-20px_60px_rgba(0,0,0,.3)]">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="salon-retail" className="text-[20px] font-extrabold text-ink">
              Add retail · POS catalogue
            </h2>
            <p className="text-[12px] text-ink-2">Products, prices, promotions and stock from Point of Sale / Inventory · {desk.location.name} store</p>
          </div>
          <label className="flex min-h-[46px] w-full items-center gap-2 rounded-[12px] border border-[#C9CEDD] bg-surface px-3 focus-within:border-primary sm:w-[300px] dark:border-line">
            <Icon name="scan" size={17} className="text-ink-3" />
            <input
              aria-label="Search or scan a barcode"
              placeholder="Search or scan a barcode"
              value={term}
              autoFocus
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                const exact = (q.data?.items ?? []).find((i) => i.code && i.code === term.trim() && i.badge !== 'out');
                if (exact) {
                  add(exact);
                  setTerm('');
                }
              }}
              className="bare-focus min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3"
            />
          </label>
          <button type="button" aria-label="Close" onClick={onClose} className="grid h-[46px] w-[46px] place-items-center rounded-[12px] bg-ground text-ink hover:bg-subtle">
            <Icon name="x" size={20} />
          </button>
        </div>

        {q.data?.categories?.length ? (
          <div role="radiogroup" aria-label="Category" className="flex flex-wrap gap-2">
            {['all', ...q.data.categories].map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={category === c}
                onClick={() => setCategory(c)}
                className={cx('min-h-[42px] rounded-full px-4 text-[13px] font-bold', category === c ? 'bg-navy text-white dark:bg-primary' : 'border border-line bg-surface text-ink hover:bg-subtle')}
              >
                {c === 'all' ? 'All' : c}
              </button>
            ))}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
          {q.isError ? (
            <Failed text={q.error instanceof Error ? q.error.message : 'The products could not be loaded.'} onRetry={() => void q.refetch()} />
          ) : !q.data ? (
            <Spinner label="Loading products…" />
          ) : items.length === 0 ? (
            <p className="text-[14px] text-ink-2">No product matches.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              {items.map((i) => {
                const n = chosen.find((l) => l.product_id === i.id)?.quantity ?? 0;
                const out = i.badge === 'out';
                return (
                  <li key={i.id} className="relative">
                    <button
                      type="button"
                      disabled={out}
                      onClick={() => add(i)}
                      className={cx('flex min-h-[116px] w-full flex-col items-start gap-1.5 rounded-[16px] p-3 text-left disabled:cursor-not-allowed disabled:opacity-50', n > 0 ? 'border-2 border-primary bg-selection' : 'border border-line bg-surface hover:bg-subtle')}
                    >
                      <span className="grid h-10 w-10 place-items-center rounded-[10px] bg-ground text-ink-2">
                        <Icon name="package" size={18} />
                      </span>
                      <span className="text-[14px] font-bold text-ink">{i.name}</span>
                      <span className="flex w-full items-baseline justify-between gap-2 text-[12px]">
                        <span className={cx('font-bold', out ? 'text-danger' : i.badge === 'low' ? 'text-warning' : i.badge === 'untracked' ? 'text-ink-3' : 'text-success')}>
                          {out ? 'Out of stock' : i.badge === 'low' ? `${i.stock ?? 0} left` : i.badge === 'untracked' || i.stock === null ? (i.code ?? '') : `${i.stock} in stock`}
                        </span>
                        <b className="text-[14px] text-ink tabular-nums">{i.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}</b>
                      </span>
                    </button>
                    {n > 0 ? (
                      <>
                        <span className="pointer-events-none absolute top-2.5 right-2.5 grid h-[22px] min-w-[22px] place-items-center rounded-full bg-primary px-1.5 text-[12px] font-extrabold text-white">{n}</span>
                        <button type="button" aria-label={`One fewer ${i.name}`} onClick={() => less(i.id)} className="absolute top-2 right-9 grid h-7 w-7 place-items-center rounded-full border border-line bg-surface text-ink hover:bg-subtle">
                          <Icon name="minus" size={14} />
                        </button>
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <div className="min-w-0 flex-1 text-[14px] text-ink-2">
            {count} item{count === 1 ? '' : 's'} · <b className="text-ink tabular-nums">{amount(sum, desk.currency)}</b>
            {sellers.length > 0 ? (
              <>
                {' '}
                · sold by{' '}
                {sellers.length === 1 ? (
                  <b className="text-ink">{shortName(sellers[0]!.name)}</b>
                ) : (
                  <select aria-label="Sold by" value={seller ?? ''} onChange={(e) => setSeller(Number(e.target.value) || null)} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px] font-bold text-ink">
                    {sellers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {shortName(s.name)}
                      </option>
                    ))}
                  </select>
                )}
              </>
            ) : null}
          </div>
          <TouchButton onClick={onClose}>Cancel</TouchButton>
          <TouchButton variant="primary" icon="plus" onClick={() => onAdd(chosen.map(({ product_id, quantity }) => ({ product_id, quantity, seller_id: seller })))}>
            {clientName ? `Add to ${firstName(clientName)}’s bill` : 'Add to the bill'}
          </TouchButton>
        </div>
        {sellerName && count > 0 ? <span className="sr-only">Sold by {sellerName}</span> : null}
      </div>
    </div>
  );
}

/** Paid (D07): what was taken and where it went, what to give back, the receipt as it printed. */
export function Paid() {
  const desk = useDesk();
  const id = Number(desk.params.get('visit') ?? 0);
  const print = usePrintSettings();
  const result = desk.paid.get(id);
  const detail = useQuery({ queryKey: K.visit(id), queryFn: ({ signal }) => fetchVisit(id, signal), enabled: id > 0 && !result });
  const visit = result?.visit ?? detail.data?.visit;
  const receipt = useQuery({ queryKey: MK.receipt(id), queryFn: ({ signal }) => fetchReceipt(id, desk.desk.id, signal), enabled: id > 0 && !!visit && (visit.checked_out || !!result?.invoice), retry: false });
  const [printing, setPrinting] = useState(false);
  const [opening, setOpening] = useState(false);
  const [sending, setSending] = useState<ReceiptChannel | null>(null);
  const [sent, setSent] = useState<string[]>([]);

  async function again() {
    setPrinting(true);
    try {
      const o = await printReceipt(id);
      toast(o.ok ? 'success' : 'warning', o.message);
      desk.paid.note(id, { printed: o });
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'The receipt could not be printed.');
    } finally {
      setPrinting(false);
    }
  }

  async function drawer() {
    setOpening(true);
    try {
      const o = await openDrawer();
      toast(o.ok ? 'success' : 'warning', o.message);
    } finally {
      setOpening(false);
    }
  }

  if (!visit)
    return detail.isError ? (
      <div className="px-5 py-4">
        <Failed text="The visit could not be loaded." onRetry={() => void detail.refetch()} />
      </div>
    ) : (
      <Spinner label="Loading the visit…" />
    );

  const paid = result?.paid ?? null;
  const change = paid?.change ?? 0;
  const currency = visit.money.currency;
  const next = result?.next_visit ?? receipt.data?.next_visit ?? null;
  const r = receipt.data;
  const invoiceNo = result?.invoice?.number ?? visit.invoice?.number ?? r?.invoice.number ?? null;
  const cashIn = paid?.cash_in ?? (paid?.tenders ?? []).filter((t) => t.method === 'cash').reduce((n, t) => n + t.amount, 0);
  const tenderWords = (paid?.tenders ?? []).map((t) => `${amount(t.amount, currency)} ${(METHOD_LABEL[t.method] ?? t.method).toLowerCase()}`).join(' + ');
  const title = paid ? (paid.ok ? (paid.settled === false ? 'Part paid' : 'Paid') : 'Checked out — money not taken') : visit.checked_out || result ? 'Checked out' : visit.client.name;
  const printed = result?.printed ?? null;
  const drawn = result?.drawer ?? null;

  return (
    <div className="flex flex-col gap-5 px-6 py-5 xl:flex-row xl:items-start">
      <Panel className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex items-center gap-4">
          <span className={cx('grid h-[60px] w-[60px] shrink-0 place-items-center rounded-[20px]', paid?.ok ? 'bg-[#DCFCE7] text-[#15803D] dark:bg-success-bg dark:text-success' : 'bg-warning-bg text-warning')}>
            <Icon name={paid?.ok ? 'check' : 'warning'} size={30} strokeWidth={2.4} />
          </span>
          <div className="min-w-0">
            <h1 className="text-[24px] font-extrabold text-ink">
              {title}
              {invoiceNo ? ` · ${invoiceNo}` : ''}
            </h1>
            <p className="text-[14px] text-ink-2">
              {[visit.client.name, tenderWords || null, r?.visit.at ? r.visit.at.slice(11, 16) : null, paid?.pos_sale ? `POS sale ${paid.pos_sale.number}${desk.desk.register ? ` in ${desk.desk.register.code}` : ''}` : null].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>

        {result?.message || paid?.message ? <Note tone={paid && !paid.ok ? 'warning' : 'indigo'}>{paid?.message ?? result?.message}</Note> : null}
        {result && !paid ? <Note tone="warning">The invoice stayed a draft{result.invoice?.why ? `: ${result.invoice.why}` : ''}. No money was taken — issuing it needs Billing’s permission.</Note> : null}

        {change > 0 ? (
          <div className="rounded-[14px] border-2 border-success bg-success-bg px-5 py-3.5">
            <div className="text-[12px] font-bold tracking-[.06em] text-success uppercase">Give back</div>
            <output aria-label="Give back" className="block text-[40px] leading-tight font-extrabold text-success tabular-nums">
              {amount(change, currency)}
            </output>
          </div>
        ) : null}

        {paid ? (
          <StatGrid min={160}>
            <Figure icon="banknote" tone="blue" label="Drawer" value={cashIn > 0 ? `+ ${amount(cashIn)}` : '—'} sub={cashIn > 0 ? `cash in · change ${amount(change).replace(/\.00$/, '')}` : 'no cash taken'} />
            <Figure icon="wallet" tone="violet" label="Store credit" value={paid.store_credit !== undefined ? amount(paid.store_credit, currency) : '—'} sub={paid.credit_kept ? `${amount(paid.credit_kept)} kept, as asked` : 'unchanged'} />
            <Figure icon="star" tone="amber" label="Points" value={paid.points ? paid.points.balance.toLocaleString() : '—'} sub={paid.points ? `+${paid.points.earned} earned${r?.points ? ` · −${r.points} used` : ''}` : 'no loyalty'} />
            <Figure icon="hand-coins" tone="cyan" label="Advance" value={visit.money.advance > 0 ? 'Applied' : 'None'} sub={visit.money.advance > 0 ? `${amount(visit.money.advance, currency).replace(/\.00$/, '')} · once only` : 'nothing held'} />
          </StatGrid>
        ) : null}

        <ul className="flex flex-col gap-2.5">
          {paid?.pos_sale ? (
            <Done ok text={`POS sale ${paid.pos_sale.number} recorded in session #${paid.pos_sale.session_id}${drawn?.ok ? '; cash drawer opened' : ''}`} side={desk.desk.register?.code ?? ''} icon="store" />
          ) : paid?.ok ? (
            <Done ok text="Recorded as a Billing receipt" side="" icon="receipt" />
          ) : null}
          {printed ? <Done ok={printed.ok} text={printed.ok ? `Receipt printed on ${printed.printer ?? 'the receipt printer'} (${print.data?.paper === '58mm' ? '58' : '80'} mm)` : printed.message} side={printed.ok ? `${print.data?.copies ?? 1} cop${(print.data?.copies ?? 1) === 1 ? 'y' : 'ies'}` : 'not printed'} icon="printer" /> : null}
          {drawn && !drawn.ok ? <Done ok={false} text={drawn.message} side="drawer" icon="banknote" /> : null}
          {(paid?.problems ?? []).map((p) => (
            <Done key={p} ok={false} text={p} side="" icon="warning" />
          ))}
          {sent.map((t) => (
            <Done key={t} ok text={t} side="" icon="send" />
          ))}
          {next ? <Done ok text={`Next visit suggested ${shortDay(next.date)} — in ${next.weeks} week${next.weeks === 1 ? '' : 's'}`} side="" icon="calendar" muted /> : null}
        </ul>

        <div className="flex flex-wrap gap-2.5">
          <TouchButton icon="printer" loading={printing} disabled={!visit.checked_out && !result?.invoice} onClick={() => void again()}>
            Print {result?.printed ? 'again' : 'receipt'}
          </TouchButton>
          {print.data?.drawer === 'printer' ? (
            <TouchButton icon="banknote" loading={opening} onClick={() => void drawer()}>
              Open the drawer
            </TouchButton>
          ) : null}
          {(visit.checked_out || result?.invoice) && !desk.offline && desk.may('salon.checkout') ? (
            <>
              <TouchButton icon="message-circle" onClick={() => setSending('whatsapp')}>
                WhatsApp receipt
              </TouchButton>
              <TouchButton icon="mail" onClick={() => setSending('email')}>
                Email receipt
              </TouchButton>
            </>
          ) : null}
          {desk.may('salon.visit.book') ? (
            <TouchButton icon="calendar" onClick={() => desk.walkIn({ client_id: visit.client.id, service_ids: [...new Set(visit.items.map((i) => i.service_id))], provider_id: visit.items[0]?.provider_id, date: next?.date }, true)}>
              Book next visit
            </TouchButton>
          ) : null}
          {!paid && visit.checked_out && visit.invoice && visit.invoice.owed > 0 ? (
            <TouchButton variant="primary" icon="banknote" onClick={() => desk.go('pay', { visit: visit.id })}>
              Take the rest
            </TouchButton>
          ) : null}
          <TouchButton variant="primary" icon="check" className="min-w-[240px] flex-1" onClick={() => desk.go('today')}>
            Done — next client
          </TouchButton>
        </div>
      </Panel>

      {r ? <ReceiptPreview r={r} /> : null}
      {sending ? <SendReceipt visit={visit} channel={sending} onClose={() => setSending(null)} onSent={(t) => setSent((s) => [...s, t])} /> : null}
    </div>
  );
}

function Done({ ok, text, side, icon, muted = false }: { ok: boolean; text: string; side: string; icon: string; muted?: boolean }) {
  return (
    <li className="flex items-center gap-3 text-[14px]">
      <Icon name={icon} size={18} className={cx('shrink-0', muted ? 'text-ink-3' : ok ? 'text-success' : 'text-warning')} />
      <span className="min-w-0 flex-1 text-ink">{text}</span>
      {side ? <span className="shrink-0 text-[12px] text-ink-2">{side}</span> : null}
    </li>
  );
}

function ReceiptRow({ l, v, b = false }: { l: string; v: string; b?: boolean }) {
  return (
    <div className={cx('flex justify-between gap-3', b && 'font-bold')}>
      <span className="min-w-0 truncate">{l}</span>
      <span className="shrink-0 tabular-nums">{v}</span>
    </div>
  );
}

function ReceiptRule() {
  return <div className="my-2 border-t border-dashed border-[#151A2D]" />;
}

/** The receipt as WorkSuite printed it (D12): its figures, in the receipt's own monospace. */
export function ReceiptPreview({ r }: { r: ReceiptData }) {
  const m = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const Row = ReceiptRow;
  const Rule = ReceiptRule;
  const short = r.template === 'salon_short';
  return (
    <aside aria-label="Receipt" className="w-full shrink-0 bg-white px-[18px] py-5 font-mono text-[11.5px] leading-[1.55] text-[#151A2D] shadow-[0_10px_30px_rgba(15,27,61,.18)] xl:w-[320px]">
      <div className="text-center text-[14px] font-bold tracking-[.04em] uppercase">{r.company.name}</div>
      {r.company.address ? <div className="text-center">{r.company.address}</div> : null}
      {r.company.phone || r.company.registration ? <div className="text-center">{[r.company.phone ? `Tel ${r.company.phone}` : null, r.company.registration].filter(Boolean).join(' · ')}</div> : null}
      <Rule />
      <Row l="Invoice" v={r.invoice.number} />
      <Row l="Visit" v={r.visit.number} />
      <Row l="Date" v={r.visit.at} />
      {r.offline ? <Row l="Till receipt" v={r.offline.receipt} /> : null}
      {r.offline ? <Row l="Taken offline" v={r.offline.at} /> : null}
      {r.pos?.sale && !short ? <Row l="POS sale" v={r.pos.sale} /> : null}
      {r.pos?.register && !short ? <Row l="Register" v={[r.pos.register, r.pos.till].filter(Boolean).join(' · ')} /> : null}
      {r.client ? <Row l="Client" v={r.client} /> : null}
      <Rule />
      {r.lines.map((l, i) => (
        <Row key={i} l={`${l.description}${l.quantity !== 1 ? ` ×${l.quantity}` : ''}`} v={m(l.amount)} />
      ))}
      <Rule />
      <Row l="Subtotal" v={m(r.subtotal)} />
      {r.tier_discount > 0 ? <Row l={`${r.loyalty?.tier ?? 'Member'} discount`} v={`- ${m(r.tier_discount)}`} /> : null}
      {r.points_value > 0 ? <Row l={`Points (${r.points})`} v={`- ${m(r.points_value)}`} /> : null}
      {r.tax > 0 ? <Row l="Tax" v={m(r.tax)} /> : null}
      <Row l="TOTAL" v={`${r.currency} ${m(r.total)}`} b />
      {r.tenders.map((t, i) => (
        <Row key={i} l={t.method} v={m(t.amount)} />
      ))}
      {r.credit_kept > 0 ? <Row l="To store credit" v={m(r.credit_kept)} /> : null}
      <Row l="Change" v={m(r.change)} />
      {r.owed > 0 ? <Row l="Still owed" v={m(r.owed)} b /> : null}
      {!short && (r.loyalty || r.store_credit > 0) ? <Rule /> : null}
      {!short && r.loyalty ? <Row l="Points earned" v={`+${r.loyalty.earned}`} /> : null}
      {!short && r.loyalty ? <Row l="Points balance" v={`${r.loyalty.balance.toLocaleString()}${r.loyalty.tier ? ` (${r.loyalty.tier})` : ''}`} /> : null}
      {!short && r.store_credit > 0 ? <Row l="Store credit" v={`${r.currency} ${m(r.store_credit)}`} /> : null}
      <Rule />
      {!short && r.next_visit ? <div className="text-center">Next: {shortDay(r.next_visit.date)}</div> : null}
      <div className="text-center">ස්තූතියි · நன்றி · Thank you</div>
      {r.footer ? <div className="text-center text-[10.5px]">{r.footer}</div> : null}
    </aside>
  );
}
