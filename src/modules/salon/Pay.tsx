import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Avatar, Button, Card, Chip, Empty, Modal, Spinner, TextField, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { amount, answered, attemptKey, clockAt, fetchToday, fetchVisit, K, owing, readyToPay, refusal, shortDay, stillToPay } from './api';
import {
  checkout,
  fetchCheckout,
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
  type RegisterState,
  type RetailLine,
  type Tender,
  type TenderMethod,
} from './money';
import { Failed, Keypad, MoneyLine, Note, servicesOf, stylistsOf, useDesk, usePrintSettings } from './parts';

/**
 * Taking payment at the counter (D05–D07, CHK-01…06, PAY-01…09).
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
 * give back.
 */
type Mode = 'cash' | 'card' | 'wallet' | 'bank_transfer' | 'split';

const MODES: Array<{ value: Mode; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'wallet', label: 'LankaQR' },
  { value: 'bank_transfer', label: 'Transfer' },
  { value: 'split', label: 'Split' },
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
    <div className="flex flex-col gap-4 p-6">
      <div>
        <h1 className="text-[22px] font-extrabold text-ink">Take payment</h1>
        <p className="mt-0.5 text-[13px] text-ink-2">Visits in the chair or done, not yet paid.</p>
      </div>
      {q.isError ? (
        <Failed text="Today’s visits could not be loaded." onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <Spinner label="Loading visits to pay…" />
      ) : ready.length === 0 ? (
        <Empty icon="banknote" title="Nobody is waiting to pay." hint="A visit appears here once its client is checked in." />
      ) : (
        <Card>
          <ul>
            {ready.map((v) => (
              <li key={v.id} className="flex items-center gap-3 border-t border-line py-3 first:border-t-0">
                <Avatar name={v.client.name} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-bold text-ink">{v.client.name}</div>
                  <div className="truncate text-[12.5px] text-ink-2">
                    {v.number} · {servicesOf(v)} · {v.status_label}
                    {owing(v) ? ' · checked out, still owing' : ''}
                  </div>
                </div>
                <span className="text-[14px] font-bold text-ink tabular-nums">{amount(stillToPay(v), v.money.currency)}</span>
                <Button variant="primary" size="lg" icon="banknote" disabled={!desk.may('salon.checkout')} onClick={() => desk.go('pay', { visit: v.id })}>
                  {owing(v) ? 'Take the rest' : 'Take payment'}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
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
      /* The drawer and the receipt come out together, as the Paid screen opens. */
      if (tookMoney && h.cash > 0 && s?.drawer === 'printer') {
        void openDrawer()
          .then((o) => !o.ok && toast('warning', o.message))
          .catch(() => toast('warning', 'The drawer did not open. Open it from the Paid screen.'));
      }
      if (result.paid && s?.auto_print) {
        void printReceipt(visitId)
          .then((o) => !o.ok && toast('warning', `${o.message} Print it again from the Paid screen.`))
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
      <div className="flex flex-col gap-4 p-6">
        <h1 className="text-[22px] font-extrabold text-ink">Take payment</h1>
        <Failed text={quote.error instanceof Error ? quote.error.message : 'The bill could not be priced.'} onRetry={() => void quote.refetch()} />
        <div>
          <Button icon="back" onClick={() => desk.go('pay')}>
            Back
          </Button>
        </div>
      </div>
    );
  }
  if (!q) return <Spinner label="Pricing the bill…" />;

  const client = visit?.client;
  const services = q.lines.filter((l) => l.kind === 'service');
  const retail = q.lines.filter((l) => l.kind === 'product');
  const over = h.over;
  const takeLabel = nothingToTake
    ? 'Complete checkout'
    : `Take ${amount(h.handed / 100, q.currency)}${over < 0 && h.handed > 0 ? ' · part payment' : ''}${print.data?.auto_print ? ' & print' : ''}`;
  const canTake = desk.may('salon.checkout') && due !== null && !pricing && (nothingToTake || h.handed > 0) && !h.missingReference;

  return (
    <div className="flex flex-col gap-4 p-6 2xl:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div>
          <h1 className="text-[22px] font-extrabold text-ink">Take payment</h1>
          <p className="mt-0.5 text-[13px] text-ink-2">Every figure is WorkSuite’s.{reg?.register && reg.session ? ` The money goes into register ${reg.register.code}.` : ''}</p>
        </div>

        <Card>
          <div className="flex flex-col gap-3 pt-4">
            <div className="flex items-center gap-3">
              <Avatar name={client?.name ?? q.number} size={44} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[18px] font-extrabold text-ink">{client?.name ?? `Visit ${q.number}`}</span>
                  {q.tier ? <Chip tone="warning">{q.tier.name}</Chip> : null}
                  {invoiced ? <Chip tone="indigo">Invoiced</Chip> : null}
                </div>
                <div className="text-[12.5px] text-ink-2">
                  {q.number}
                  {q.loyalty ? ` · ${q.points_balance.toLocaleString()} points` : ''} · store credit {amount(q.credit_available, q.currency)}
                </div>
              </div>
            </div>

            <ul>
              {[...services, ...retail].map((l, i) => (
                <li key={`${l.kind}-${l.appointment_id}-${l.product_id ?? i}`} className="flex items-center gap-3 border-t border-line py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14.5px] font-bold text-ink">
                      {l.description}
                      {l.quantity !== 1 ? ` × ${l.quantity}` : ''}
                    </div>
                    <div className="truncate text-[12.5px] text-ink-2">
                      {l.kind === 'product'
                        ? `Retail${l.provider ? ` · sold by ${l.provider}` : ''}`
                        : [l.provider, l.tier ? `${l.tier}${l.multiplier ? ` ×${l.multiplier.toFixed(2)}` : ''}` : null].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <span className="text-[14.5px] font-bold text-ink tabular-nums">{amount(l.unit_price * l.quantity)}</span>
                  {l.kind === 'product' && !invoiced ? (
                    <button
                      type="button"
                      aria-label={`Remove ${l.description}`}
                      disabled={pricing}
                      onClick={() => void reprice({ ...inputs, retail: inputs.retail.filter((r) => r.product_id !== l.product_id) })}
                      className="grid h-9 w-9 place-items-center rounded-[8px] text-danger hover:bg-danger-bg"
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>

            {!invoiced ? (
              <Button icon="plus" onClick={() => setRetailOpen(true)}>
                Add retail
              </Button>
            ) : null}

            <dl className="flex flex-col gap-1 border-t border-line pt-3">
              <MoneyLine label="Services and retail" value={q.gross} />
              {q.tier_discount > 0 ? <MoneyLine label={q.tier ? `${q.tier.name} member ${q.tier.discount}%` : 'Member discount'} value={-q.tier_discount} /> : null}
              {q.points_value > 0 ? <MoneyLine label={`${q.points.toLocaleString()} points`} value={-q.points_value} /> : null}
              {q.discount > 0 ? <MoneyLine label="Discount" value={-q.discount} /> : null}
              {q.tax > 0 ? <MoneyLine label="Tax" value={q.tax} /> : null}
              <MoneyLine label="Invoice total" value={q.total} currency={q.currency} strong />
              {q.advance > 0 ? <MoneyLine label="Advance held" value={-q.advance} /> : null}
              {q.credit > 0 ? <MoneyLine label="Store credit" value={-q.credit} /> : null}
              {invoiced && visit?.invoice ? <MoneyLine label={`Paid on ${visit.invoice.number ?? 'the invoice'}`} value={-visit.invoice.paid} /> : null}
            </dl>
            <div className="flex items-baseline justify-between rounded-[10px] bg-selection px-4 py-3">
              <span className="text-[14px] font-bold text-primary">To pay</span>
              <span className="text-[24px] font-extrabold text-primary tabular-nums">{due === null ? '…' : amount(due, q.currency)}</span>
            </div>

            {!invoiced && ((q.loyalty && q.points_balance > 0) || q.credit_available > 0) ? (
              <div className="flex flex-wrap items-end gap-2">
                {q.loyalty && q.points_balance > 0 ? (
                  <>
                    <TextField
                      label={`Points to use (worth ${amount(q.point_value, q.currency)} each)`}
                      inputMode="numeric"
                      placeholder="0"
                      value={pointsTyped}
                      onChange={(e) => setPointsTyped(e.target.value.replace(/\D+/g, ''))}
                      className="w-60"
                    />
                    <Button loading={pricing} onClick={() => void reprice({ ...inputs, redeem_points: Math.max(0, Math.floor(Number(pointsTyped) || 0)) })}>
                      Use points
                    </Button>
                  </>
                ) : null}
                {q.credit_available > 0 ? (
                  <Button variant={inputs.use_credit ? 'primary' : 'secondary'} disabled={pricing} onClick={() => void reprice({ ...inputs, use_credit: !inputs.use_credit })}>
                    {inputs.use_credit ? 'Using store credit' : `Use store credit (${amount(q.credit_available)})`}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {pricing ? (
              <p className="text-[12px] text-ink-3" role="status">
                Pricing…
              </p>
            ) : null}
          </div>
        </Card>
      </div>

      <div className="flex w-full flex-col gap-4 2xl:w-[440px]">
        <RegisterBanner state={reg} loading={register.isLoading} failed={register.isError} />

        <Card>
          <div className="flex flex-col gap-3 pt-4">
            <div role="radiogroup" aria-label="How they pay" className="grid grid-cols-5 gap-1.5">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.value}
                  onClick={() => setMode(m.value)}
                  className={cx('h-11 rounded-[10px] border text-[13px] font-bold', mode === m.value ? 'border-primary bg-selection text-primary' : 'border-line bg-surface text-ink hover:bg-subtle')}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {nothingToTake ? (
              <p className="text-[14px] text-ink">Nothing is left to pay — the advance and credit cover it.</p>
            ) : mode === 'cash' ? (
              <>
                <div className="rounded-[10px] border border-line px-4 py-2.5">
                  <div className="text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">Cash handed over</div>
                  <output aria-label="Cash handed over" className="block text-[28px] font-extrabold text-ink tabular-nums">
                    {amount(Number(cash || 0))}
                  </output>
                </div>
                <div className="flex flex-wrap gap-2">
                  {due !== null ? (
                    <Button size="sm" onClick={() => setCash(String(due))}>
                      Exact
                    </Button>
                  ) : null}
                  {due !== null
                    ? suggestions(due).map((s) => (
                        <Button key={s} size="sm" onClick={() => setCash(String(s))}>
                          {s.toLocaleString('en-US')}
                        </Button>
                      ))
                    : null}
                  {cash ? (
                    <Button size="sm" variant="ghost" onClick={() => setCash('')}>
                      Clear
                    </Button>
                  ) : null}
                </div>
                {over > 0 && h.cash > 0 ? <OverChoice over={over} currency={q.currency} keep={keepAsCredit} onKeep={setKeep} /> : null}
                {over < 0 && h.handed > 0 ? <p className="text-[13px] font-semibold text-warning">Short by {amount(-over / 100, q.currency)} — this takes part of it; the rest stays owed on the invoice.</p> : null}
                <Keypad label="Cash keypad" onKey={(k) => setCash((c) => pressKey(c, k))} />
              </>
            ) : mode === 'split' ? (
              <>
                {split.map((r, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 rounded-[10px] border border-line p-2">
                    <select
                      aria-label={`Tender ${i + 1}`}
                      value={r.method}
                      onChange={(e) => setSplit((s) => s.map((x, j) => (j === i ? { ...x, method: e.target.value as TenderMethod } : x)))}
                      className="h-9 w-36 rounded-[8px] border border-line bg-surface px-2 text-[13px] text-ink"
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
                      className="h-9 w-28 rounded-[8px] border border-line bg-surface px-2 text-right text-[13px] text-ink tabular-nums"
                    />
                    {r.method !== 'cash' ? (
                      <input
                        aria-label={`Reference ${i + 1}`}
                        placeholder="Reference"
                        maxLength={120}
                        value={r.reference}
                        onChange={(e) => setSplit((s) => s.map((x, j) => (j === i ? { ...x, reference: e.target.value } : x)))}
                        className="h-9 min-w-24 flex-1 rounded-[8px] border border-line bg-surface px-2 text-[13px] text-ink"
                      />
                    ) : null}
                    {split.length > 1 ? (
                      <button type="button" aria-label={`Remove tender ${i + 1}`} onClick={() => setSplit((s) => s.filter((_, j) => j !== i))} className="grid h-9 w-9 place-items-center rounded-[8px] text-danger hover:bg-danger-bg">
                        <Icon name="trash" size={16} />
                      </button>
                    ) : null}
                  </div>
                ))}
                <div>
                  <Button size="sm" icon="plus" onClick={() => setSplit((s) => [...s, { method: 'card', amount: '', reference: '' }])}>
                    Add a tender
                  </Button>
                </div>
                {due !== null ? (
                  <p className="text-[13px] text-ink">
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
              </>
            ) : (
              <>
                <TextField label="Amount" inputMode="decimal" placeholder={due !== null ? String(due) : ''} value={other.amount} onChange={(e) => setOther((o) => ({ ...o, amount: moneyTyped(e.target.value) }))} />
                <TextField label="Reference" hint={REFERENCE_HINT[mode]} maxLength={120} value={other.reference} onChange={(e) => setOther((o) => ({ ...o, reference: e.target.value }))} />
                {over > 0 ? <p className="text-[13px] text-ink-2">Over by {amount(over / 100, q.currency)}: only cash is given back, so this is kept as store credit.</p> : null}
              </>
            )}
          </div>
        </Card>

        <div className="flex gap-2.5">
          <Button size="lg" icon="back" onClick={() => desk.go('pay')}>
            Back
          </Button>
          <Button variant="primary" size="lg" icon="banknote" className="flex-1" loading={busy} disabled={!canTake} onClick={() => void take()}>
            {takeLabel}
          </Button>
        </div>
        {h.missingReference ? <p className="text-[12.5px] text-warning">Give the reference for each card, LankaQR or transfer payment.</p> : null}
      </div>

      {retailOpen ? (
        <RetailPicker
          lines={inputs.retail}
          sellerDefault={services[0]?.provider_id ?? null}
          onClose={() => setRetailOpen(false)}
          onAdd={(lines) => {
            setRetailOpen(false);
            void reprice({ ...inputs, retail: lines });
          }}
        />
      ) : null}
    </div>
  );
}

/** Over what is due, with cash in it: give change, or keep the rest as store credit. */
function OverChoice({ over, currency, keep, onKeep }: { over: number; currency: string; keep: boolean; onKeep: (keep: boolean) => void }) {
  return (
    <div className="rounded-[10px] border border-line p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] text-ink-2">Over by</span>
        <span className="text-[18px] font-extrabold text-ink tabular-nums">{amount(over / 100, currency)}</span>
      </div>
      <div role="radiogroup" aria-label="What to do with the rest" className="mt-2 grid grid-cols-2 gap-2">
        {[
          { v: false, label: `Give ${amount(over / 100)} change` },
          { v: true, label: 'Keep as store credit' },
        ].map((o) => (
          <button
            key={String(o.v)}
            type="button"
            role="radio"
            aria-checked={keep === o.v}
            onClick={() => onKeep(o.v)}
            className={cx('min-h-11 rounded-[10px] border px-2 text-[13px] font-bold', keep === o.v ? 'border-primary bg-selection text-primary' : 'border-line bg-surface text-ink')}
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
        action={
          desk.may('pos.register.open') ? (
            <Button size="sm" variant="primary" onClick={() => desk.go('register')}>
              Open register
            </Button>
          ) : null
        }
      >
        <b>Register {state.register.code} is closed.</b> Open it to take payment; bookings and check-ins carry on meanwhile.
      </Note>
    );
  }
  const s = state.session;
  return (
    <Note tone="indigo">
      <b>Paying into register {state.register.code}</b>
      <div className="text-[12.5px] font-normal">
        Session #{s.id} opened {s.opened_at ? clockAt(s.opened_at, desk.location.timezone) : ''}
        {s.mine ? ' by you' : ''} · {s.sales.count} sale{s.sales.count === 1 ? '' : 's'} so far
      </div>
    </Note>
  );
}

/** Retail from the desk's shelf, onto this visit's bill (POS-04). */
function RetailPicker({ lines, sellerDefault, onClose, onAdd }: { lines: RetailLine[]; sellerDefault: number | null; onClose: () => void; onAdd: (lines: RetailLine[]) => void }) {
  const desk = useDesk();
  const [term, setTerm] = useState('');
  const [chosen, setChosen] = useState<Array<RetailLine & { name: string; price: number }>>(() => lines.map((l) => ({ ...l, name: `Product ${l.product_id}`, price: 0 })));
  const q = useQuery({ queryKey: MK.retail(desk.desk.id, term.trim()), queryFn: ({ signal }) => fetchRetail(desk.desk.id, term.trim(), signal) });
  const names = new Map((q.data?.items ?? []).map((i) => [i.id, i]));

  const add = (id: number, name: string, price: number) =>
    setChosen((c) => (c.some((l) => l.product_id === id) ? c.map((l) => (l.product_id === id ? { ...l, quantity: l.quantity + 1 } : l)) : [...c, { product_id: id, quantity: 1, seller_id: sellerDefault, name, price }]));
  const setQty = (id: number, qty: number) => setChosen((c) => (qty <= 0 ? c.filter((l) => l.product_id !== id) : c.map((l) => (l.product_id === id ? { ...l, quantity: qty } : l))));

  return (
    <Modal
      title="Add retail"
      width={640}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onAdd(chosen.map(({ product_id, quantity, seller_id }) => ({ product_id, quantity, seller_id })))}>
            {chosen.length ? `Put ${chosen.reduce((n, l) => n + l.quantity, 0)} on the bill` : 'Put nothing on the bill'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <TextField aria-label="Search products" placeholder="Name, code or barcode" value={term} onChange={(e) => setTerm(e.target.value)} autoFocus />
        {q.isError ? (
          <Failed text={q.error instanceof Error ? q.error.message : 'The products could not be loaded.'} onRetry={() => void q.refetch()} />
        ) : !q.data ? (
          <Spinner label="Loading products…" />
        ) : q.data.items.length === 0 ? (
          <p className="text-[13px] text-ink-2">No product matches.</p>
        ) : (
          <ul className="grid max-h-[300px] grid-cols-2 gap-2 overflow-y-auto scroll-thin">
            {q.data.items.map((i) => (
              <li key={i.id}>
                <button type="button" disabled={i.badge === 'out'} onClick={() => add(i.id, i.name, i.price)} className="w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-left hover:bg-subtle disabled:opacity-50">
                  <div className="truncate text-[13.5px] font-bold text-ink">{i.name}</div>
                  <div className="flex justify-between text-[12px] text-ink-2">
                    <span>{i.badge === 'out' ? 'Out of stock' : i.badge === 'low' ? `Only ${i.stock} left` : (i.code ?? '')}</span>
                    <span className="tabular-nums">{amount(i.price)}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {chosen.length ? (
          <div className="border-t border-line pt-2">
            {chosen.map((l) => (
              <div key={l.product_id} className="flex items-center gap-2 py-1 text-[13.5px] text-ink">
                <span className="min-w-0 flex-1 truncate">{names.get(l.product_id)?.name ?? l.name}</span>
                <Button size="sm" aria-label={`One fewer ${l.name}`} onClick={() => setQty(l.product_id, l.quantity - 1)}>
                  −
                </Button>
                <span className="w-6 text-center tabular-nums">{l.quantity}</span>
                <Button size="sm" aria-label={`One more ${l.name}`} onClick={() => setQty(l.product_id, l.quantity + 1)}>
                  +
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/** Paid (D07): what to give back, what was taken, and the receipt again. */
export function Paid() {
  const desk = useDesk();
  const id = Number(desk.params.get('visit') ?? 0);
  const print = usePrintSettings();
  const result = desk.paid.get(id);
  const detail = useQuery({ queryKey: K.visit(id), queryFn: ({ signal }) => fetchVisit(id, signal), enabled: id > 0 && !result });
  const [printing, setPrinting] = useState(false);
  const [opening, setOpening] = useState(false);
  const visit = result?.visit ?? detail.data?.visit;

  async function again() {
    setPrinting(true);
    try {
      const o = await printReceipt(id);
      toast(o.ok ? 'success' : 'warning', o.message);
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

  if (!visit) return detail.isError ? <div className="p-6"><Failed text="The visit could not be loaded." onRetry={() => void detail.refetch()} /></div> : <Spinner label="Loading the visit…" />;

  const paid = result?.paid ?? null;
  const change = paid?.change ?? 0;
  const currency = visit.money.currency;
  const next = result?.next_visit ?? null;

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className={cx('grid h-12 w-12 place-items-center rounded-full', paid?.ok ? 'bg-success-bg text-success' : 'bg-warning-bg text-warning')}>
          <Icon name={paid?.ok ? 'check-circle' : 'warning'} size={26} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-extrabold text-ink">{paid ? (paid.ok ? (paid.settled === false ? 'Part paid' : 'Paid') : 'Checked out — money not taken') : result ? 'Checked out' : visit.checked_out ? 'Checked out' : visit.client.name}</h1>
          <p className="text-[13px] text-ink-2">
            {visit.client.name} · {visit.number}
            {result?.invoice?.number ? ` · ${result.invoice.number}` : visit.invoice?.number ? ` · ${visit.invoice.number}` : ''}
          </p>
        </div>
      </div>

      {result?.message || paid?.message ? <Note tone={paid && !paid.ok ? 'warning' : 'indigo'}>{paid?.message ?? result?.message}</Note> : null}
      {result && !paid ? <Note tone="warning">The invoice stayed a draft{result.invoice?.why ? `: ${result.invoice.why}` : ''}. No money was taken — issuing it needs Billing’s permission.</Note> : null}

      {change > 0 ? (
        <div className="rounded-[14px] border-2 border-success bg-success-bg px-5 py-4">
          <div className="text-[12px] font-bold tracking-[.6px] text-success uppercase">Give back</div>
          <output aria-label="Give back" className="block text-[40px] leading-tight font-extrabold text-success tabular-nums">
            {amount(change, currency)}
          </output>
        </div>
      ) : null}

      <div className="flex flex-col gap-4 xl:flex-row">
        <Card title="Taken" className="min-w-0 flex-1">
          {paid?.tenders?.length ? (
            <dl className="flex flex-col gap-1">
              {paid.tenders.map((t, i) => (
                <MoneyLine key={i} label={`${METHOD_LABEL[t.method] ?? t.method}${t.reference ? ` · ${t.reference}` : ''}`} value={t.amount} />
              ))}
              {paid.credit_kept ? <MoneyLine label="Kept as store credit" value={paid.credit_kept} /> : null}
              {paid.owed ? <MoneyLine label="Still owed" value={paid.owed} currency={currency} strong /> : null}
            </dl>
          ) : (
            <p className="text-[13px] text-ink-2">{visit.invoice ? `${amount(visit.invoice.paid, currency)} paid on ${visit.invoice.number ?? 'the invoice'}.` : 'Nothing recorded here.'}</p>
          )}
        </Card>
        <Card title="For the client" className="w-full xl:w-[380px]">
          <dl className="flex flex-col gap-1 text-[13.5px]">
            {paid?.points ? (
              <div className="flex justify-between">
                <dt className="text-ink-2">Points</dt>
                <dd className="m-0 font-bold text-ink tabular-nums">
                  +{paid.points.earned} · {paid.points.balance.toLocaleString()} in all
                </dd>
              </div>
            ) : null}
            {paid?.store_credit !== undefined ? <MoneyLine label="Store credit now" value={paid.store_credit} currency={currency} /> : null}
            {paid?.pos_sale ? (
              <div className="flex justify-between">
                <dt className="text-ink-2">POS sale</dt>
                <dd className="m-0 font-bold text-ink">{paid.pos_sale.number}</dd>
              </div>
            ) : null}
            {next ? (
              <div className="flex justify-between">
                <dt className="text-ink-2">Next visit</dt>
                <dd className="m-0 font-bold text-ink">
                  {shortDay(next.date)} · in {next.weeks} week{next.weeks === 1 ? '' : 's'}
                </dd>
              </div>
            ) : null}
          </dl>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2.5">
        <Button icon="printer" loading={printing} disabled={!visit.checked_out && !result?.invoice} onClick={() => void again()}>
          Print receipt{result ? ' again' : ''}
        </Button>
        {print.data?.drawer === 'printer' ? (
          <Button icon="banknote" loading={opening} onClick={() => void drawer()}>
            Open the drawer
          </Button>
        ) : null}
        {next && desk.may('salon.visit.book') ? (
          <Button icon="calendar-check" onClick={() => desk.walkIn({ client_id: visit.client.id, service_ids: [...new Set(visit.items.map((i) => i.service_id))], provider_id: visit.items[0]?.provider_id, date: next.date }, true)}>
            Book the next visit
          </Button>
        ) : null}
        <Button variant="primary" className="ml-auto" onClick={() => desk.go('today')}>
          Done
        </Button>
      </div>
      <p className="text-[12px] text-ink-3">
        {stylistsOf(visit)} · {servicesOf(visit)}
      </p>
      {!paid && visit.checked_out && visit.invoice && visit.invoice.owed > 0 ? (
        <div>
          <Button variant="primary" icon="banknote" onClick={() => desk.go('pay', { visit: visit.id })}>
            Take the rest
          </Button>
        </div>
      ) : null}
    </div>
  );
}
