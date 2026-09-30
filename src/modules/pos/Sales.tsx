import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { PosSale } from '@shared/pos';
import { Button, Card, Empty, Modal, TextField, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { PK, printReceipt, resolveSale, reverseSale, useSales } from './api';
import { useT, type PosKey } from './i18n';
import { Choice, Note, SyncChip, timeOf, useTillContext } from './parts';
import { formatMoney } from './pricing';
import { salesSummary } from './shift';

/**
 * The till's sales — this shift's, or today's — from its own record (sealed on this computer): where each stands on
 * its way to WorkSuite, its receipt, a reprint. A sale WorkSuite refused is sent again or dropped here. Refunds and
 * voids are WorkSuite's to do, and are offered only where it announces them (`options.capabilities`).
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
  const list = sales.data ?? [];
  const sum = salesSummary(list);
  const current = list.find((s) => s.ref === open) ?? null;

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
        {list.length === 0 ? (
          <Empty icon="receipt" title="No sales yet." />
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

/** One sale: the receipt as the till recorded it, and what may be done with it. */
function SaleDetail({ sale, onClose }: { sale: PosSale; onClose: () => void }) {
  const t = useT();
  const till = useTillContext();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [reverse, setReverse] = useState<'refund' | 'void' | null>(null);
  const c = sale.currency;

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

  const reversible = sale.state === 'sent' && !till.offline;
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
      {sale.state === 'refused' ? <Note tone="danger">{sale.message}</Note> : null}
      {sale.state === 'waiting' ? <Note tone="warning">{t('pos.waiting', { n: 1 })}</Note> : null}
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
        <hr className="my-2 border-line" />
        {sale.tenders.map((x, i) => (
          <Row key={i} label={`${t(`pos.${x.method}` as PosKey)}${x.reference ? ` (${x.reference})` : ''}`} value={formatMoney(x.amount)} />
        ))}
        {sale.change_given ? <Row label={t('pos.change')} value={formatMoney(sale.change_given)} /> : null}
        {sale.customer ? <p className="mt-2 text-[12px] text-ink-3">{[sale.customer.name, sale.customer.phone, sale.customer.email].filter(Boolean).join(' · ')}</p> : null}
      </Card>
      <div className="flex flex-wrap gap-2">
        <Button icon="printer" loading={busy === 'print'} onClick={() => void run('print', () => printReceipt(sale.ref, true))}>
          {t('pos.reprint')}
        </Button>
        {sale.state === 'refused' ? (
          <>
            <Button icon="upload" loading={busy === 'retry'} onClick={() => void run('retry', () => resolveSale(sale.ref, 'retry'))}>
              {t('pos.retry')}
            </Button>
            <Button variant="danger" loading={busy === 'drop'} onClick={() => void run('drop', () => resolveSale(sale.ref, 'drop'))}>
              {t('pos.drop')}
            </Button>
          </>
        ) : null}
        {till.caps.refund && reversible ? (
          <Button onClick={() => setReverse('refund')}>{t('pos.refund')}</Button>
        ) : null}
        {till.caps.void && reversible ? (
          <Button variant="danger" onClick={() => setReverse('void')}>
            {t('pos.void')}
          </Button>
        ) : null}
      </div>
      {!till.caps.refund && !till.caps.void && sale.state === 'sent' ? <p className="text-[12px] text-ink-3">Refunds and voids are not available from this WorkSuite server yet.</p> : null}
      {reverse ? <Reverse sale={sale} action={reverse} onClose={() => setReverse(null)} /> : null}
    </aside>
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

/** A refund or void, asked of WorkSuite with the reason; it decides, and moves the stock and the money. */
function Reverse({ sale, action, onClose }: { sale: PosSale; action: 'refund' | 'void'; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const m = await reverseSale(sale.ref, action, { reason: reason.trim() });
      toast('success', m ?? (action === 'refund' ? 'Refunded.' : 'Voided.'));
      void qc.invalidateQueries({ queryKey: PK.all });
      onClose();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'WorkSuite did not do that.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`${t(action === 'refund' ? 'pos.refund' : 'pos.void')} ${sale.ref}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={busy} disabled={reason.trim().length < 3} onClick={() => void go()}>
            {t(action === 'refund' ? 'pos.refund' : 'pos.void')}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[13px] text-ink-2">
        {action === 'refund' ? `The whole sale, ${formatMoney(sale.totals.total, sale.currency)}, is given back as it was paid.` : 'The sale is cancelled as if it had not been made.'} WorkSuite records it against your drawer.
      </p>
      <TextField label={t('pos.reason')} value={reason} onChange={(e) => setReason(e.target.value.slice(0, 200))} autoFocus />
    </Modal>
  );
}
