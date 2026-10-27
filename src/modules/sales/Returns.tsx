import { useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { app } from '../../core/app-state';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, Empty, PageHead, Panel, Seg, Sheet } from '../../components/PageKit';
import { OFFLINE_WRITE, useSalesOffline } from './offline';
import { approveReturn, creditReturn, K, receiveReturn, type ReturnRow, type Returns as Board } from './api';
import { moneyFull } from './parts';

/**
 * Returns (OmsReturns): the goods and the money are two events. A return
 * the customer asked for is agreed; receiving it puts the stock back (and
 * records its condition); crediting the customer is a separate step — a
 * numbered credit note, posted — and often a later one.
 */
const has = (perms: readonly string[] | undefined, p: string) => !!perms && (perms.includes('*') || perms.includes(p));
const REASON: Record<string, string> = { damaged: 'Damaged', expired: 'Expired', wrong_item: 'Wrong item', over_supply: 'Too many sent', quality: 'Quality', not_required: 'Not needed', other: 'Other' };

type Asking = { kind: 'approve' | 'receive' | 'credit'; r: ReturnRow };
type Lane = 'open' | 'ask' | 'goods' | 'credit' | 'settled';

export default function Returns({ board }: { org: string; board: UseQueryResult<Board> }) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [busy, setBusy] = useState(false);
  const [lane, setLane] = useState<Lane>('open');
  const offline = useSalesOffline();
  if (board.isLoading) return <Spinner />;
  if (board.error) return <ErrorNote error={board.error} onRetry={() => void board.refetch()} />;
  const b = board.data!.board;
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast('success', done);
      setAsking(null);
      void qc.invalidateQueries({ queryKey: K.all });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const canApprove = has(perms, 'inventory.approve');
  const canSell = has(perms, 'inventory.sell');
  const row = (r: ReturnRow, action?: ReactNode) => (
    <div key={r.id} className="flex items-center gap-3 border-b border-line/70 px-3.5 py-2.5 text-[12.5px] last:border-b-0" data-return={r.reference}>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <b className="text-ink">{r.reference}</b>
          <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-bold', r.credit_note_number ? 'bg-success-bg text-success' : 'bg-warning-bg text-warning')}>{r.credit_note_number ? 'credited' : 'not credited'}</span>
          <span className="truncate font-semibold text-ink">{r.client ?? 'No customer'}</span>
        </span>
        <span className="truncate text-[11.5px] text-ink-3">
          {[REASON[r.reason ?? ''] ?? r.reason, r.order_number, r.invoice_number, `${r.line_count} ${r.line_count === 1 ? 'line' : 'lines'}`, r.received_at ? `back ${dateLabel(r.received_at)}` : null, r.credit_note_number ? `credited ${r.credit_note_number}` : null].filter(Boolean).join(' · ')}
        </span>
      </span>
      <b className="text-ink tabular-nums">{moneyFull(r.total_value)}</b>
      {action}
    </div>
  );
  const act = (label: string, a: Asking, allowed: boolean) => (allowed ? <button type="button" className={btnPrimary + ' !h-[30px]'} disabled={offline} title={offline ? OFFLINE_WRITE : undefined} onClick={() => setAsking(a)}>{label}</button> : null);
  const open = b.to_approve.length + b.to_receive.length + b.to_credit.length;
  const owed = b.to_credit.reduce((t, r) => t + (Number(r.total_value) || 0), 0);
  const show = (l: Lane) => lane === l || (lane === 'open' && l !== 'settled');

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Returns" sub={`${open} open${owed ? ` · ${moneyFull(owed)} to credit` : ''}. The goods and the money are two events: stock comes back when a return is received; crediting the customer is a separate step, and often a later one.`} />
      <Seg<Lane>
        label="Returns"
        value={lane}
        onChange={setLane}
        options={[
          { id: 'open', label: `All open · ${open}` },
          { id: 'ask', label: `Asked for · ${b.to_approve.length}` },
          { id: 'goods', label: `Waiting for goods · ${b.to_receive.length}` },
          { id: 'credit', label: `Owed a credit · ${b.to_credit.length}` },
          { id: 'settled', label: 'Settled' },
        ]}
      />
      {b.no_document.length ? (
        <div className="rounded-[10px] border border-warning-line bg-warning-bg px-3.5 py-2.5 text-[12.5px] text-warning-strong dark:border-warning/40 dark:bg-warning-bg dark:text-warning">
          <b>
            {b.no_document.length} {b.no_document.length === 1 ? 'order is' : 'orders are'} marked returned with no return document.
          </b>{' '}
          Nothing has come back into stock for {b.no_document.length === 1 ? 'it' : 'them'}. Raise a return against each in Inventory → Sales returns: {b.no_document.slice(0, 5).map((d) => `${d.number} · ${d.client ?? '—'} · ${moneyFull(d.total, d.currency)}`).join('; ')}
        </div>
      ) : null}
      {show('ask') ? <Group title="Asked for" n={b.to_approve.length} sub="Requested by the customer and not yet agreed.">{b.to_approve.map((r) => row(r, act('Approve', { kind: 'approve', r }, canApprove)))}</Group> : null}
      {show('goods') ? <Group title="Waiting for the goods" n={b.to_receive.length} sub="Agreed. Receiving puts the stock back and records its condition.">{b.to_receive.map((r) => row(r, act('Receive back', { kind: 'receive', r }, canSell)))}</Group> : null}
      {show('credit') ? <Group title="Owed a credit" n={b.to_credit.length} sub="The goods are back and the customer has not been credited.">{b.to_credit.map((r) => row(r, act('Raise credit note', { kind: 'credit', r }, canSell)))}</Group> : null}
      {lane === 'settled' ? <Group title="Settled" n={b.settled.length} sub="Goods back, customer credited.">{b.settled.map((r) => row(r))}</Group> : null}

      {asking ? (
        <Sheet
          title={asking.kind === 'approve' ? `Approve ${asking.r.reference}?` : asking.kind === 'receive' ? `Receive ${asking.r.reference}?` : `Credit ${asking.r.reference}?`}
          onClose={() => setAsking(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setAsking(null)}>Cancel</button>
              <button
                type="button"
                className={btnPrimary}
                disabled={busy}
                onClick={() =>
                  void run(
                    () => (asking.kind === 'approve' ? approveReturn(asking.r.id) : asking.kind === 'receive' ? receiveReturn(asking.r.id) : creditReturn(asking.r.id)),
                    asking.kind === 'approve' ? `${asking.r.reference} agreed.` : asking.kind === 'receive' ? `${asking.r.reference} received — the stock is back.` : `Credit note raised for ${asking.r.reference}.`,
                  )
                }
              >
                {asking.kind === 'approve' ? 'Approve' : asking.kind === 'receive' ? 'Receive' : 'Raise credit note'}
              </button>
            </>
          }
        >
          <p className="m-0 text-[13px] text-ink-2">
            {asking.kind === 'approve'
              ? 'The customer may send the goods back. Nothing moves in stock yet.'
              : asking.kind === 'receive'
                ? 'The goods go back into stock. The customer is not credited by this step.'
                : 'This raises a numbered credit note and posts it to the ledger.'}
          </p>
        </Sheet>
      ) : null}
    </div>
  );
}

function Group({ title, n, sub, children }: { title: string; n: number; sub: string; children: ReactNode[] }) {
  return (
    <Panel title={`${title} · ${n}`} sub={sub} bodyClassName="flex flex-col">
      {children.length ? children : <Empty text="Nothing here." />}
    </Panel>
  );
}
