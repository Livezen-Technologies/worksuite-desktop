import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, Modal, Spinner, TextField, cx } from '../../components/ui';
import { call } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { get, K, money, newKey, refusal, write, type Bill, type Quote } from './api';
import { useT, type RKey } from './i18n';
import { Failed, Heading, Note, ReasonField, useLive, useTill } from './parts';

/**
 * The bill (§8.1, §8.4): what the order costs now as the server prices it
 * (`bills/preview` — a client never computes a total), the bill made single
 * or split — by seat, by item, equally or by amount — presented, printed and
 * paid. A payment is several tenders against one bill (cash handed over,
 * card, …); the change is the server's answer, and the drawer opens when it
 * says so. Every payment carries one idempotency key per attempt: a retry
 * after a dropped answer is never charged twice.
 *
 * A bill no print route takes comes back with its document, printed here on
 * the receipt printer (the main process's print agent, `restaurant:printText`).
 */
type Mode = 'single' | 'equal' | 'seat' | 'item' | 'amount';
const MODES: Array<{ id: Mode; label: RKey }> = [
  { id: 'single', label: 'bill.single' },
  { id: 'seat', label: 'bill.bySeat' },
  { id: 'item', label: 'bill.byItem' },
  { id: 'equal', label: 'bill.equal' },
  { id: 'amount', label: 'bill.byAmount' },
];

export default function BillScreen() {
  const t = useT();
  const till = useTill();
  const qc = useQueryClient();
  const orderId = till.screen.order;
  const [mode, setMode] = useState<Mode | null>(null);
  const [paying, setPaying] = useState<Bill | null>(null);
  const [voiding, setVoiding] = useState<Bill | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const q = useQuery({
    queryKey: K.bills(orderId ?? 0),
    queryFn: ({ signal }) => get<{ order_id: number; quote: Quote; bills: Bill[]; stale: boolean }>('/bills/preview', { order_id: orderId! }, signal),
    enabled: !!orderId,
  });
  useLive(till.branch, till.status?.last_seq ?? 0, !!orderId, 5_000, [K.bills(orderId ?? 0)]);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: K.bills(orderId ?? 0) });
    void qc.invalidateQueries({ queryKey: K.order(orderId ?? 0) });
    void qc.invalidateQueries({ queryKey: K.floor(till.branch) });
  };

  async function act(what: string, path: string, body: Record<string, unknown> = {}) {
    setBusy(what);
    try {
      const r = await write<Record<string, unknown>>(path, body);
      if (r.message) toast('success', r.message);
      refresh();
      return r.data;
    } catch (e) {
      toast('error', refusal(e).message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function print(b: Bill) {
    const d = await act(`print-${b.id}`, `/bills/${b.id}/print`, { terminal_id: till.pairing.terminal_id });
    const doc = d?.document as { text?: unknown } | undefined;
    if (d && d.queued === false && typeof doc?.text === 'string') {
      const o = await call('restaurant:printText', { text: doc.text });
      toast(o.ok ? 'success' : 'warning', o.message);
    }
  }

  if (!orderId) return <div className="p-6"><Note tone="muted">{t('bill.noOrder')}</Note></div>;
  if (q.isError) return <div className="p-6"><Failed text={q.error instanceof Error ? q.error.message : t('bill.failed')} onRetry={() => void q.refetch()} /></div>;
  if (!q.data) return <Spinner label={t('bill.loading')} />;

  const { quote, bills, stale } = q.data;
  const cur = quote.currency || till.currency;
  const open = bills.filter((b) => b.status !== 'voided');

  return (
    <div className="flex max-w-[980px] flex-col gap-4 p-6">
      <Heading
        title={t('bill.title')}
        action={
          <div className="flex gap-2">
            <Button onClick={() => till.go('order', { order: orderId })}>{t('bill.backToOrder')}</Button>
          </div>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card title={t('bill.preview')}>
          <ul className="flex flex-col gap-1 text-[13px]">
            {quote.lines.map((l) => (
              <li key={l.order_item_id} className="flex gap-2">
                <span className="min-w-0 flex-1 text-ink">
                  {Number(l.qty)} × {l.name}
                  {l.seat ? <span className="text-ink-3"> · {t('order.seatN', { n: l.seat })}</span> : null}
                  {l.comp ? <span className="text-success"> · {t('bill.comp')}</span> : null}
                </span>
                <span className="tabular-nums text-ink">{money(l.gross)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-col gap-0.5 border-t border-line pt-2 text-[13px]">
            <Line label={t('bill.subtotal')} value={money(quote.subtotal)} />
            {Number(quote.discount_total) ? <Line label={t('bill.discount')} value={`− ${money(quote.discount_total)}`} /> : null}
            {quote.charges.map((c, i) => (
              <Line key={i} label={c.name ?? t('bill.charges')} value={money(c.amount ?? '0')} />
            ))}
            {Number(quote.tax_total) ? <Line label={quote.prices_include_tax ? t('bill.taxIncluded') : t('bill.tax')} value={money(quote.tax_total)} /> : null}
            {Number(quote.rounding) ? <Line label={t('bill.rounding')} value={money(quote.rounding)} /> : null}
            <Line label={t('bill.total')} value={money(quote.total, cur)} strong />
          </div>
        </Card>

        <div className="flex flex-col gap-3">
          {stale ? <Note tone="warning">{t('bill.stale')}</Note> : null}
          <Card title={t('bill.bills')}>
            {open.length === 0 ? <p className="text-[13px] text-ink-3">{t('bill.none')}</p> : null}
            <ul className="flex flex-col divide-y divide-line">
              {open.map((b) => (
                <li key={b.id} className="flex flex-col gap-2 py-2.5">
                  <div className="flex items-baseline gap-2">
                    <span className="font-bold text-ink">{b.number}</span>
                    {b.split_count > 1 ? <span className="text-[12px] text-ink-3">{t('bill.part', { i: b.split_index, n: b.split_count })}</span> : null}
                    <span className="ms-auto text-[12px] font-semibold text-ink-2">{b.status_label}</span>
                  </div>
                  <div className="flex gap-4 text-[13px]">
                    <span>
                      {t('bill.total')}: <b className="tabular-nums">{money(b.total, cur)}</b>
                    </span>
                    <span>
                      {t('bill.balance')}: <b className={cx('tabular-nums', Number(b.balance) > 0 ? 'text-danger' : 'text-success')}>{money(b.balance, cur)}</b>
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {b.status === 'open' ? (
                      <Button size="sm" loading={busy === `present-${b.id}`} onClick={() => void act(`present-${b.id}`, `/bills/${b.id}/present`, { version: b.version })}>
                        {t('bill.present')}
                      </Button>
                    ) : null}
                    <Button size="sm" icon="printer" loading={busy === `print-${b.id}`} onClick={() => void print(b)}>
                      {b.printed_count > 0 ? t('bill.reprint') : t('bill.print')}
                    </Button>
                    {Number(b.balance) > 0 ? (
                      <Button size="sm" variant="primary" icon="banknote" disabled={!till.can('payment_process')} onClick={() => setPaying(b)}>
                        {t('bill.takePayment')}
                      </Button>
                    ) : null}
                    {Number(b.paid_total) === 0 && till.can('order_edit') ? (
                      <Button size="sm" variant="ghost" onClick={() => setVoiding(b)}>
                        {t('bill.void')}
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <Card title={open.length ? t('bill.again') : t('bill.make')}>
            <div className="flex flex-wrap gap-1.5">
              {MODES.map((m) => (
                <Button key={m.id} size="sm" disabled={!till.can('payment_process') && !till.can('order_create')} onClick={() => setMode(m.id)}>
                  {t(m.label)}
                </Button>
              ))}
            </div>
          </Card>
        </div>
      </div>
      {mode ? <MakeBills mode={mode} quote={quote} orderId={orderId} onClose={() => setMode(null)} onDone={refresh} /> : null}
      {paying ? <TakePayment bill={paying} currency={cur} onClose={() => setPaying(null)} onDone={refresh} /> : null}
      {voiding ? <VoidBill bill={voiding} onClose={() => setVoiding(null)} onDone={refresh} /> : null}
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cx('flex gap-2', strong && 'text-[15px] font-extrabold')}>
      <span className="flex-1 text-ink-2">{label}</span>
      <span className="tabular-nums text-ink">{value}</span>
    </div>
  );
}

/** Bill the order, or split it: the server divides every line, tax and charge so the parts add up to the order to the cent. */
function MakeBills({ mode, quote, orderId, onClose, onDone }: { mode: Mode; quote: Quote; orderId: number; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [count, setCount] = useState('2');
  const [amounts, setAmounts] = useState<string[]>(['', '']);
  const [parts, setParts] = useState<Record<number, number>>(() => Object.fromEntries(quote.lines.map((l) => [l.order_item_id, 1])));
  const [nParts, setNParts] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function make() {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { order_id: orderId, mode };
    if (mode === 'equal') body.count = Math.max(2, Number(count) || 2);
    if (mode === 'amount') body.amounts = amounts.filter((a) => Number(a) > 0).map((a) => Number(a).toFixed(2));
    if (mode === 'item') body.parts = Array.from({ length: nParts }, (_, p) => quote.lines.filter((l) => parts[l.order_item_id] === p + 1).map((l) => ({ order_item_id: l.order_item_id })));
    try {
      const r = await write('/bills', body);
      toast('success', r.message ?? t('bill.made'));
      onDone();
      onClose();
    } catch (e) {
      setError(refusal(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t(MODES.find((m) => m.id === mode)!.label)}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={busy} onClick={() => void make()}>
            {t('bill.make')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {mode === 'single' ? <p className="text-[13px] text-ink-2">{t('bill.singleHint')}</p> : null}
        {mode === 'seat' ? <p className="text-[13px] text-ink-2">{t('bill.seatHint')}</p> : null}
        {mode === 'equal' ? <TextField label={t('bill.ways')} type="number" min={2} max={20} value={count} onChange={(e) => setCount(e.target.value)} /> : null}
        {mode === 'amount' ? (
          <div className="flex flex-col gap-2">
            {amounts.map((a, i) => (
              <TextField key={i} label={t('bill.partN', { n: i + 1 })} inputMode="decimal" value={a} onChange={(e) => setAmounts(amounts.map((x, j) => (j === i ? e.target.value.replace(/[^\d.]/g, '') : x)))} />
            ))}
            <p className="text-[12px] text-ink-3">{t('bill.amountHint', { total: money(quote.total) })}</p>
            <Button size="sm" icon="plus" onClick={() => setAmounts([...amounts, ''])}>
              {t('bill.addPart')}
            </Button>
          </div>
        ) : null}
        {mode === 'item' ? (
          <div className="flex flex-col gap-2">
            <TextField label={t('bill.parts')} type="number" min={2} max={20} value={String(nParts)} onChange={(e) => setNParts(Math.max(2, Math.min(20, Number(e.target.value) || 2)))} />
            {quote.lines.map((l) => (
              <label key={l.order_item_id} className="flex items-center gap-2 text-[13px]">
                <span className="min-w-0 flex-1 text-ink">
                  {Number(l.qty)} × {l.name}
                </span>
                <select aria-label={t('bill.partFor', { name: l.name })} value={parts[l.order_item_id] ?? 1} onChange={(e) => setParts({ ...parts, [l.order_item_id]: Number(e.target.value) })} className="rounded-[6px] border border-line bg-surface px-1 py-0.5">
                  {Array.from({ length: nParts }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {t('bill.partN', { n })}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        ) : null}
        {error ? <Note tone="danger">{error}</Note> : null}
      </div>
    </Modal>
  );
}

interface Tender {
  method: string;
  amount: string;
  reference: string;
}

/**
 * Take payment on a bill: one or more tenders. Cash is what was handed over;
 * the change shown before sending is a preview, the change given is the
 * server's. The idempotency key is made when the dialog opens and kept for
 * every retry of the same payment until the server answers.
 */
export function TakePayment({ bill, currency, onClose, onDone }: { bill: Bill; currency: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const till = useTill();
  const methods = till.pos?.policy?.tenders?.length ? till.pos.policy.tenders : ['cash', 'card'];
  const [tenders, setTenders] = useState<Tender[]>([{ method: methods[0]!, amount: bill.balance, reference: '' }]);
  const [key, setKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ change: string; message: string } | null>(null);

  const given = tenders.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const change = given - Number(bill.balance);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const r = await write<{ change_given?: string; open_drawer?: boolean }>(
        `/bills/${bill.id}/payments`,
        { tenders: tenders.filter((x) => Number(x.amount) > 0).map((x) => ({ method: x.method, amount: Number(x.amount).toFixed(2), ...(x.reference ? { provider_ref: x.reference } : {}) })), terminal_id: till.pairing.terminal_id, version: bill.version },
        key,
      );
      setDone({ change: r.data?.change_given ?? '0.00', message: r.message ?? t('pay.taken') });
      if (r.data?.open_drawer) {
        const o = await call('restaurant:openDrawer');
        if (!o.ok) toast('warning', o.message);
      }
      onDone();
    } catch (e) {
      const f = refusal(e);
      setError(f.message);
      /* Answered: the next press is a new attempt. Not answered (out of reach, busy): the same key again. */
      if (f.status > 0 && f.status < 500 && f.code !== 'in_progress') setKey(newKey());
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Modal title={t('pay.done')} onClose={onClose} footer={<Button variant="primary" onClick={onClose}>{t('common.done')}</Button>}>
        <div className="flex flex-col items-center gap-2 py-3">
          <p className="text-[13.5px] text-ink-2">{done.message}</p>
          {Number(done.change) > 0 ? <p className="text-[28px] font-extrabold text-ink">{t('pay.changeDue', { amount: money(done.change, currency) })}</p> : null}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={t('pay.title', { number: bill.number })}
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" icon="banknote" loading={busy} disabled={given <= 0} onClick={() => void pay()}>
            {t('pay.take', { amount: money(given.toFixed(2), currency) })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[14px] text-ink">
          {t('bill.balance')}: <b className="tabular-nums">{money(bill.balance, currency)}</b>
        </p>
        {tenders.map((x, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[12.5px] font-semibold text-ink-2">{t('pay.method')}</span>
              <select value={x.method} onChange={(e) => setTenders(tenders.map((y, j) => (j === i ? { ...y, method: e.target.value } : y)))} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px] text-ink">
                {methods.map((m) => (
                  <option key={m} value={m}>
                    {t(`tender.${m}` as RKey)}
                  </option>
                ))}
              </select>
            </label>
            <TextField label={x.method === 'cash' ? t('pay.handed') : t('pay.amount')} inputMode="decimal" value={x.amount} onChange={(e) => setTenders(tenders.map((y, j) => (j === i ? { ...y, amount: e.target.value.replace(/[^\d.]/g, '') } : y)))} />
            {x.method !== 'cash' ? <TextField label={t('pay.reference')} value={x.reference} maxLength={120} onChange={(e) => setTenders(tenders.map((y, j) => (j === i ? { ...y, reference: e.target.value } : y)))} /> : null}
            {tenders.length > 1 ? <Button size="sm" variant="ghost" icon="x" aria-label={t('pay.removeTender')} onClick={() => setTenders(tenders.filter((_, j) => j !== i))} /> : null}
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon="plus" onClick={() => setTenders([...tenders, { method: methods.find((m) => m !== 'cash') ?? methods[0]!, amount: Math.max(0, -change).toFixed(2), reference: '' }])}>
            {t('pay.split')}
          </Button>
          {[5, 10, 20, 50, 100].map((n) => (
            <Button key={n} size="sm" variant="ghost" onClick={() => setTenders(tenders.map((y, j) => (j === 0 ? { ...y, method: 'cash', amount: String(Math.ceil(Number(bill.balance) / n) * n) } : y)))}>
              {money(String(Math.ceil(Number(bill.balance) / n) * n))}
            </Button>
          ))}
        </div>
        {change > 0 && tenders.some((x) => x.method === 'cash') ? <p className="text-[15px] font-bold text-ink">{t('pay.changePreview', { amount: money(change.toFixed(2), currency) })}</p> : null}
        {change < 0 ? <p className="text-[13px] text-ink-2">{t('pay.partPreview', { amount: money((-change).toFixed(2), currency) })}</p> : null}
        {error ? (
          <Note tone="danger" action={/cashier/i.test(error) ? <Button size="sm" onClick={() => till.go('cashier')}>{t('nav.cashier')}</Button> : undefined}>
            {error}
          </Note>
        ) : null}
      </div>
    </Modal>
  );
}

function VoidBill({ bill, onClose, onDone }: { bill: Bill; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    try {
      const r = await write(`/bills/${bill.id}/void`, { reason: reason.trim(), version: bill.version });
      toast('success', r.message ?? t('bill.voided'));
      onDone();
      onClose();
    } catch (e) {
      setError(refusal(e).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t('bill.voidTitle', { number: bill.number })}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={() => void run()}>
            {t('bill.void')}
          </Button>
        </>
      }
    >
      <ReasonField label={t('order.voidWhy')} value={reason} onChange={setReason} />
      {error ? <div className="mt-2"><Note tone="danger">{error}</Note></div> : null}
    </Modal>
  );
}
