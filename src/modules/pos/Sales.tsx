import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { POS_DRAWER_REFUSALS, saleFlags, type PosReturn, type PosSale, type PosSaleFlag } from '@shared/pos';
import { Button, Card, Empty, Modal, TextField, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { emailReceipt, giveBack, mayGiveBack, openDrawer, PK, printReceipt, resolveSale, useSales } from './api';
import { useT, type PosKey } from './i18n';
import { Choice, Note, SyncChip, timeOf, useTillContext } from './parts';
import { formatMoney, parseAmount } from './pricing';
import { canStillRefund, refundable, refundLines, returned } from './returns';
import { filterSales, salesSummary, type ReviewFilter } from './shift';
import { Checkbox } from '../../components/Checkbox';

/**
 * The till's sales — this shift's, or today's — from its own record (sealed on this computer): where each stands on
 * its way to WorkSuite, WorkSuite's own total and its flags (`price_differs`, `payment_missing`, `late` — filtered like
 * the web's "to review"), its receipt
 * (WorkSuite's, where it has one), a reprint and e-mailing it. A sale WorkSuite refused is sent again or dropped here —
 * one refused for its drawer (`drawer_closed`, `session_not_here`) is sent again into the register open now.
 * Refunds (of everything left, or some lines) and voids (in the sale's own shift, while it is open) are WorkSuite's to
 * do through the till's door, the cashier named; they are offered where WorkSuite announces them
 * (`options.capabilities`) and the person may (`can.refund`, `can.void`), and only while it answers.
 */
type Scope = 'shift' | 'today';

function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default function Sales() {
  const t = useT();
  const till = useTillContext();
  const [scope, setScope] = useState<Scope>(till.session ? 'shift' : 'today');
  const [since] = useState(startOfToday);
  const filter = scope === 'shift' && till.session ? { session_id: till.session.id } : { since };
  const sales = useSales(filter);
  const [open, setOpen] = useState<string | null>(till.params.get('sale'));
  const [review, setReview] = useState<ReviewFilter>('all');
  const all = sales.data ?? [];
  const sum = salesSummary(all);
  const list = filterSales(all, review);
  const current = all.find((s) => s.ref === open) ?? null;

  return (
    <div className="flex h-full min-h-0">
      <section className="flex min-w-0 flex-1 flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-[22px] font-extrabold text-ink">{t('pos.sales')}</h1>
          <Choice
            label="Which sales"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'shift', label: t('pos.thisShift'), disabled: !till.session },
              { value: 'today', label: t('pos.today') },
            ]}
          />
        </div>
        <p className="text-[13px] text-ink-2">
          {sum.count} · {formatMoney(sum.total, till.currency)}
          {Object.entries(sum.byTender).map(([m, v]) => ` · ${t(`pos.${m}` as PosKey)} ${formatMoney(v)}`)}
        </p>
        <Choice
          label={t('pos.show')}
          value={review}
          onChange={setReview}
          options={[
            { value: 'all', label: t('pos.showAll') },
            { value: 'review', label: t('pos.showReview') },
            ...FLAGS.map((f) => ({ value: f, label: t(`pos.flag.${f}`) })),
          ]}
        />
        {list.length === 0 ? (
          <Empty icon="receipt" title={review === 'all' ? 'No sales yet.' : t('pos.noneToReview')} />
        ) : (
          <ul className="flex min-h-0 flex-col divide-y divide-line overflow-y-auto rounded-[12px] border border-line bg-surface scroll-thin">
            {list.map((s) => (
              <li key={s.ref}>
                <button type="button" onClick={() => setOpen(s.ref)} className={cx('flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-subtle', open === s.ref && 'bg-selection')}>
                  <span className="w-28 shrink-0 text-[12.5px] text-ink-3">{timeOf(s.created_at)}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
                    {s.ref}
                    {s.customer?.name ? <span className="font-normal text-ink-3"> · {s.customer.name}</span> : null}
                  </span>
                  <span className="text-[12px] text-ink-3">{[...new Set(s.tenders.map((x) => t(`pos.${x.method}` as PosKey)))].join(' + ')}</span>
                  {saleFlags(s).map((f) => (
                    <Flag key={f} tone={f === 'payment_missing' ? 'danger' : 'warning'}>
                      {t(`pos.flag.${f}`)}
                    </Flag>
                  ))}
                  {s.voided ? <Flag tone="danger">{t('pos.voided')}</Flag> : s.returns?.length ? <Flag tone="muted">{t(canStillRefund(s) ? 'pos.partRefunded' : 'pos.refunded')}</Flag> : null}
                  <span className="w-28 text-right text-[13px] font-bold tabular-nums">{formatMoney(s.totals.total)}</span>
                  <SyncChip state={s.state} label={t(s.state === 'sent' ? 'pos.sent' : s.state === 'refused' ? 'pos.refusedOne' : 'pos.waitingOne')} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {current ? <SaleDetail sale={current} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

const FLAGS: PosSaleFlag[] = ['price_differs', 'payment_missing', 'late'];

function Flag({ tone, children }: { tone: 'warning' | 'danger' | 'muted'; children: React.ReactNode }) {
  const tones = { warning: 'bg-warning-bg text-warning', danger: 'bg-danger-bg text-danger', muted: 'bg-subtle text-ink-2' };
  return <span className={cx('rounded-full px-2 py-0.5 text-[11.5px] font-bold', tones[tone])}>{children}</span>;
}

/** One sale: the receipt as the till recorded it, what WorkSuite made of it, and what may be done with it. */
function SaleDetail({ sale, onClose }: { sale: PosSale; onClose: () => void }) {
  const t = useT();
  const till = useTillContext();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'refund' | 'void' | 'email' | null>(null);
  const c = sale.currency;
  const can = till.company?.can;

  async function run(what: string, fn: () => Promise<{ ok?: boolean; message?: string } | unknown>) {
    setBusy(what);
    try {
      const r = (await fn()) as { ok?: boolean; message?: string } | undefined;
      if (r && typeof r === 'object' && 'message' in r && r.message) toast(r.ok === false ? 'warning' : 'success', r.message);
      void qc.invalidateQueries({ queryKey: PK.all });
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  // Online only, on a sale WorkSuite has; the server checks the rest again (the cashier's rights, the drawer).
  const online = sale.state === 'sent' && !till.offline && !sale.voided;
  const mayRefund = online && mayGiveBack(till.caps, can, 'refund') && canStillRefund(sale);
  const inShift = !!till.session && till.session.id === sale.session_id;
  const mayVoid = online && mayGiveBack(till.caps, can, 'void') && inShift && !(sale.returns ?? []).length;
  const mayEmail = sale.state === 'sent' && !till.offline && !!(till.caps.email_receipt || till.caps.email);
  const back = returned(sale);
  const differs = sale.server_total != null && Math.abs(sale.server_total - sale.totals.total) >= 0.005;
  const flags = saleFlags(sale);
  // Refused for its drawer: sent again, it goes into the register open at this till now — there must be one.
  const drawerRefusal = sale.state === 'refused' && !!sale.code && POS_DRAWER_REFUSALS.has(sale.code);
  const retryInto = drawerRefusal ? (till.session?.id ?? null) : undefined;
  return (
    <aside className="flex w-[380px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-line bg-surface p-4 scroll-thin" aria-label={`${t('pos.receipt')} ${sale.ref}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-[16px] font-bold text-ink">{sale.ref}</h2>
          <p className="text-[12px] text-ink-3">
            {timeOf(sale.created_at)} · {sale.cashier_name}
            {sale.number ? ` · ${sale.number}` : ''}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          ✕
        </Button>
      </div>
      {sale.state === 'refused' ? (
        <Note tone="danger">
          {drawerRefusal ? <strong className="block">{t(sale.code === 'session_not_here' ? 'pos.refusal.session_not_here' : 'pos.refusal.drawer_closed')}</strong> : null}
          {sale.message}
        </Note>
      ) : null}
      {drawerRefusal && !retryInto ? (
        <Note tone="warning" action={<Button size="sm" onClick={() => till.go('shift')}>{t('pos.openShift')}</Button>}>
          {t('pos.retryNeedsDrawer')}
        </Note>
      ) : drawerRefusal && till.session ? (
        <p className="text-[12px] text-ink-3">{t('pos.retryInto', { register: till.session.register ?? `#${till.session.id}` })}</p>
      ) : null}
      {sale.state === 'waiting' ? <Note tone="warning">{t('pos.waiting', { n: 1 })}</Note> : null}
      {flags.length || differs ? (
        <Note tone={flags.includes('payment_missing') ? 'danger' : 'warning'}>
          <strong>{t('pos.review')}.</strong>
          {flags.includes('price_differs') || differs ? <span className="block">{t('pos.reviewNote', { total: formatMoney(sale.server_total ?? null, c), charged: formatMoney(sale.totals.total, c) })}</span> : null}
          {flags.includes('payment_missing') ? <span className="block">{t('pos.flagNote.payment_missing')}</span> : null}
          {flags.includes('late') ? <span className="block">{t('pos.flagNote.late')}</span> : null}
          {sale.review ? <span className="block text-[12px] font-normal">{sale.review}</span> : null}
        </Note>
      ) : null}
      {sale.voided ? <Note tone="danger">{t('pos.voided')}</Note> : null}
      {sale.priced_by === 'estimate' && sale.state !== 'sent' ? <p className="text-[12px] text-ink-3">{t('pos.provisional')}</p> : null}
      <Card bodyClassName="pt-3">
        <ul className="flex flex-col gap-1.5 text-[13px]">
          {sale.lines.map((l) => (
            <li key={l.product_id}>
              <div className="font-semibold text-ink">{l.name}</div>
              <div className="flex justify-between text-ink-2 tabular-nums">
                <span>
                  {l.quantity} × {formatMoney(l.unit_price)}
                  {l.discount_pct ? ` −${l.discount_pct}%` : ''}
                </span>
                <span>{formatMoney(l.net)}</span>
              </div>
            </li>
          ))}
        </ul>
        <hr className="my-2 border-line" />
        <Row label={t('pos.subtotal')} value={formatMoney(sale.totals.subtotal)} />
        {sale.totals.discount ? <Row label={t('pos.discount')} value={`−${formatMoney(sale.totals.discount)}`} /> : null}
        <Row label={t('pos.tax')} value={formatMoney(sale.totals.tax)} />
        <Row label={t('pos.total')} value={formatMoney(sale.totals.total, c)} strong />
        {sale.server_total != null ? <Row label={t('pos.serverTotal')} value={formatMoney(sale.server_total, c)} /> : null}
        <hr className="my-2 border-line" />
        {sale.tenders.map((x, i) => (
          <Row key={i} label={`${t(`pos.${x.method}` as PosKey)}${x.reference ? ` (${x.reference})` : ''}`} value={formatMoney(x.amount)} />
        ))}
        {sale.change_given ? <Row label={t('pos.change')} value={formatMoney(sale.change_given)} /> : null}
        {sale.customer ? <p className="mt-2 text-[12px] text-ink-3">{[sale.customer.name, sale.customer.phone, sale.customer.email].filter(Boolean).join(' · ')}</p> : null}
      </Card>
      {sale.returns?.length ? (
        <Card title={t('pos.refunded')} bodyClassName="pt-1">
          <ul className="flex flex-col divide-y divide-line">
            {sale.returns.map((r) => (
              <ReturnRow key={r.ref} r={r} currency={c} />
            ))}
          </ul>
          <Row label={t('pos.refunded')} value={formatMoney(-back.amount, c)} strong />
        </Card>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button icon="printer" loading={busy === 'print'} onClick={() => void run('print', () => printReceipt(sale.ref, true, !!till.caps.receipt && !till.offline))}>
          {t('pos.reprint')}
        </Button>
        {mayEmail ? <Button onClick={() => setDialog('email')}>{t('pos.email')}</Button> : null}
        {sale.state === 'refused' ? (
          <>
            <Button icon="upload" loading={busy === 'retry'} disabled={retryInto === null} onClick={() => void run('retry', () => resolveSale(sale.ref, 'retry', retryInto ?? undefined))}>
              {t('pos.retry')}
            </Button>
            <Button variant="danger" loading={busy === 'drop'} onClick={() => void run('drop', () => resolveSale(sale.ref, 'drop'))}>
              {t('pos.drop')}
            </Button>
          </>
        ) : null}
        {mayRefund ? <Button onClick={() => setDialog('refund')}>{t('pos.refund')}</Button> : null}
        {mayVoid ? (
          <Button variant="danger" onClick={() => setDialog('void')}>
            {t('pos.void')}
          </Button>
        ) : null}
      </div>
      {sale.state === 'sent' && !sale.voided && mayGiveBack(till.caps, can, 'void') && !inShift && !till.offline ? <p className="text-[12px] text-ink-3">{t('pos.voidOnlyThisShift')}</p> : null}
      {sale.state === 'sent' && !mayGiveBack(till.caps, can, 'refund') && !mayGiveBack(till.caps, can, 'void') ? <p className="text-[12px] text-ink-3">{t('pos.noReturns')}</p> : null}
      {dialog === 'refund' || dialog === 'void' ? <Reverse sale={sale} action={dialog} onClose={() => setDialog(null)} /> : null}
      {dialog === 'email' ? <Email sale={sale} onClose={() => setDialog(null)} /> : null}
    </aside>
  );
}

function ReturnRow({ r, currency }: { r: PosReturn; currency: string }) {
  const t = useT();
  return (
    <li className="py-1.5 text-[12.5px]">
      <div className="flex justify-between gap-2">
        <span className="font-semibold text-ink">
          {t(r.kind === 'void' ? 'pos.void' : 'pos.refund')} · {r.ref}
        </span>
        <span className="font-semibold tabular-nums">{formatMoney(-r.amount, currency)}</span>
      </div>
      <div className="text-ink-3">
        {r.tenders.map((x) => `${t(`pos.${x.method}` as PosKey)} ${formatMoney(x.amount)}`).join(' · ')}
        {r.cash_out ? ` · ${t('pos.cashFromDrawer', { n: formatMoney(r.cash_out) })}` : ''}
        {r.credit_note ? ` · ${r.credit_note}` : ''}
      </div>
      {r.reason ? <div className="text-ink-3">{r.reason}</div> : null}
    </li>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cx('flex justify-between gap-2 tabular-nums', strong ? 'text-[15px] font-extrabold text-ink' : 'text-[13px] text-ink-2')}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

/**
 * A refund (everything left, or some lines) or a void, asked of WorkSuite through the till's door with the reason and
 * the cashier. It decides, moves the stock and the money, and answers with what went back and how; the drawer opens
 * when cash is handed back.
 */
export function Reverse({ sale, action, onClose }: { sale: PosSale; action: 'refund' | 'void'; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'all' | 'lines'>('all');
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [restock, setRestock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<PosReturn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const left = refundable(sale);
  const lines = action === 'void' || mode === 'all' ? undefined : refundLines(sale, Object.fromEntries(Object.entries(picks).map(([k, v]) => [Number(k), parseAmount(v)])));

  async function go() {
    if (lines === null) return;
    setBusy(true);
    setError(null);
    try {
      const r = await giveBack({ ref: sale.ref, kind: action, reason: reason.trim(), ...(lines ? { lines } : {}), ...(action === 'refund' && !restock ? { restock: false } : {}) });
      setDone(r.refund);
      toast('success', r.message);
      if (r.refund.cash_out > 0) void openDrawer().catch(() => undefined);
      void qc.invalidateQueries({ queryKey: PK.all });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'WorkSuite did not do that.');
    } finally {
      setBusy(false);
    }
  }

  const title = `${t(action === 'refund' ? 'pos.refund' : 'pos.void')} ${sale.ref}`;
  if (done) {
    return (
      <Modal title={title} onClose={onClose} footer={<Button variant="primary" onClick={onClose}>OK</Button>}>
        <div className="flex flex-col gap-2 text-[13px]">
          <p className="font-semibold text-ink">{t('pos.refundDone', { amount: formatMoney(done.amount, sale.currency) })}</p>
          {done.tenders.map((x, i) => (
            <Row key={i} label={t(`pos.${x.method}` as PosKey)} value={formatMoney(x.amount)} />
          ))}
          {done.cash_out ? <Note tone="warning">{t('pos.cashFromDrawer', { n: formatMoney(done.cash_out, sale.currency) })}</Note> : null}
          {done.credit_note ? <p className="text-ink-3">{done.credit_note}</p> : null}
        </div>
      </Modal>
    );
  }
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={busy} disabled={reason.trim().length < 3 || lines === null} onClick={() => void go()}>
            {t(action === 'refund' ? 'pos.refund' : 'pos.void')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-ink-2">
          {action === 'refund'
            ? 'WorkSuite gives the money back as it was paid, and takes the cash out of the drawer open at this till.'
            : 'The sale is cancelled in its own shift, as if it had not been made; its cash comes out of that drawer.'}
        </p>
        {action === 'refund' ? (
          <>
            <Choice
              label="What goes back"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'all', label: t('pos.refundAll') },
                { value: 'lines', label: t('pos.refundLines') },
              ]}
            />
            {mode === 'lines' ? (
              <ul className="flex flex-col gap-1.5">
                {left.map((l) => (
                  <li key={l.product_id} className="flex items-center gap-2 text-[13px]">
                    <span className="min-w-0 flex-1 truncate text-ink">{l.name}</span>
                    <span className="text-ink-3 tabular-nums">/ {l.left}</span>
                    <input
                      aria-label={`${t('pos.qty')} ${l.name}`}
                      inputMode="decimal"
                      disabled={l.left <= 0}
                      value={picks[l.product_id] ?? ''}
                      onChange={(e) => setPicks((p) => ({ ...p, [l.product_id]: e.target.value.replace(/[^\d.]/g, '').slice(0, 8) }))}
                      className="h-7 w-16 rounded-[6px] border border-line bg-surface text-center tabular-nums outline-none focus:border-primary disabled:opacity-40"
                    />
                  </li>
                ))}
              </ul>
            ) : null}
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              <Checkbox checked={restock} onChange={(e) => setRestock(e.target.checked)} /> {t('pos.restock')}
            </label>
          </>
        ) : null}
        <TextField label={t('pos.reason')} value={reason} onChange={(e) => setReason(e.target.value.slice(0, 200))} autoFocus />
        {error ? <Note tone="danger">{error}</Note> : null}
      </div>
    </Modal>
  );
}

/** E-mail WorkSuite's receipt: to the customer on the sale, or the address typed. */
function Email({ sale, onClose }: { sale: PosSale; onClose: () => void }) {
  const t = useT();
  const [to, setTo] = useState(sale.customer?.email ?? '');
  const [busy, setBusy] = useState(false);
  const bad = !!to.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim());
  async function send() {
    setBusy(true);
    try {
      const r = await emailReceipt(sale.ref, to.trim() || undefined);
      toast('success', r.message);
      onClose();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'The receipt could not be e-mailed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`${t('pos.email')} ${sale.ref}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={bad || !to.trim()} onClick={() => void send()}>
            {t('pos.send')}
          </Button>
        </>
      }
    >
      <TextField label={t('pos.emailTo')} value={to} onChange={(e) => setTo(e.target.value.slice(0, 150))} inputMode="email" autoFocus error={bad ? 'That is not an e-mail address.' : null} />
    </Modal>
  );
}
