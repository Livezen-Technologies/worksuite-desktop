import { useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { errorMessage } from '../../core/bridge';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner } from '../../components/ui';
import { btn, btnPrimary, Empty, Field, input, PageHead, Panel, Sheet } from '../hr/parts';
import { cancelNote, deliveredNote, dispatchNote, K, raiseDelivery, ymd, type BoardNote, type BoardOrder, type Fulfilment as Board } from './api';
import { moneyFull, PriorityPill } from './parts';

/**
 * Fulfilment (OmsFulfilment): the queue — picking, dispatch and delivery
 * all happen in Inventory. An order waiting to be picked gets a delivery
 * note for everything still to go; a note is sent (which issues the stock
 * and cannot be undone — a note can only be cancelled before it goes); a
 * note out with the customer is confirmed as received.
 */
type Asking = { kind: 'raise'; o: BoardOrder } | { kind: 'dispatch'; n: BoardNote } | { kind: 'cancel'; n: BoardNote } | { kind: 'received'; n: BoardNote };

export default function Fulfilment({ board, onOpen }: { org: string; board: UseQueryResult<Board>; onOpen: (orderId: number) => void }) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState<Asking | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  if (board.isLoading) return <Spinner />;
  if (board.error) return <ErrorNote error={board.error} onRetry={() => void board.refetch()} />;
  const b = board.data!.board;
  const v = (k: string, d = '') => f[k] ?? d;
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const ask = (a: Asking) => (setF({}), setAsking(a));
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
  const shipping = () => Object.fromEntries(['carrier', 'tracking_no', 'vehicle', 'driver'].map((k) => [k, v(k).trim()]).filter(([, x]) => x));

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Fulfilment" sub="Picking, dispatch and delivery all happen in Inventory — this is the queue for them." />
      <Group title="Waiting to be picked" n={b.to_pick.length} sub="Confirmed, with stocked lines still undelivered and no open delivery note.">
        {b.to_pick.map((o) => (
          <Row
            key={`o${o.id}`}
            number={o.number}
            priority={o.priority}
            onNumber={() => onOpen(o.id)}
            who={o.client ?? 'No customer'}
            meta={[o.warehouse, `${o.outstanding_lines} ${o.outstanding_lines === 1 ? 'line' : 'lines'} to send`, o.expected_date ? `due ${dateLabel(o.expected_date)}` : null, o.assigned_name ?? 'unassigned'].filter(Boolean).join(' · ')}
            right={moneyFull(o.total, o.currency)}
            actions={<button type="button" className={btnPrimary + ' !h-[30px]'} onClick={() => ask({ kind: 'raise', o })}>Raise delivery note</button>}
          />
        ))}
      </Group>
      <Group title="Ready to send" n={b.to_dispatch.length} sub="A delivery note exists. Sending it issues the stock and cannot be undone.">
        {b.to_dispatch.map((n) => (
          <Row
            key={`n${n.id}`}
            number={n.number}
            priority={n.priority}
            tag={n.status}
            onNumber={() => onOpen(n.order_id)}
            who={`${n.client ?? 'No customer'} · ${n.order_number}`}
            meta={[`${n.line_count} ${n.line_count === 1 ? 'line' : 'lines'}`, n.ship_to].filter(Boolean).join(' · ')}
            actions={
              <>
                <button type="button" className={btn + ' !h-[30px]'} onClick={() => ask({ kind: 'cancel', n })}>Cancel</button>
                <button type="button" className={btnPrimary + ' !h-[30px]'} onClick={() => ask({ kind: 'dispatch', n })}>Dispatch</button>
              </>
            }
          />
        ))}
      </Group>
      <Group title="Out with the customer" n={b.in_transit.length} sub="Sent and not yet confirmed as received.">
        {b.in_transit.map((n) => (
          <Row
            key={`t${n.id}`}
            number={n.number}
            priority={n.priority}
            onNumber={() => onOpen(n.order_id)}
            who={`${n.client ?? 'No customer'} · ${n.order_number}`}
            meta={[n.carrier ? `${n.carrier}${n.tracking_no ? ` · ${n.tracking_no}` : ''}` : 'no carrier recorded', n.dispatched_at ? `sent ${dateLabel(n.dispatched_at)}` : null].filter(Boolean).join(' · ')}
            actions={<button type="button" className={btn + ' !h-[30px]'} onClick={() => ask({ kind: 'received', n })}>Confirm delivered</button>}
          />
        ))}
      </Group>

      {asking?.kind === 'raise' ? (
        <Sheet
          title={`Delivery note for ${asking.o.number}`}
          onClose={() => setAsking(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setAsking(null)}>Cancel</button>
              <button type="button" className={btnPrimary} disabled={busy} onClick={() => void run(() => raiseDelivery(asking.o.id, { delivery_date: v('date', ymd()), ...shipping(), ...(v('notes').trim() ? { notes: v('notes').trim() } : {}) }), `Delivery note raised for ${asking.o.number}.`)}>
                Raise delivery note
              </button>
            </>
          }
        >
          <p className="m-0 text-[12.5px] text-ink-2">Everything still to be sent goes on the note. A serial-numbered item needs its serials on the note before it can be dispatched.</p>
          <Field label="Delivery date"><input type="date" className={input} value={v('date', ymd())} onChange={set('date')} /></Field>
          <Shipping v={v} set={set} />
          <Field label="Notes"><input className={input} value={v('notes')} onChange={set('notes')} /></Field>
        </Sheet>
      ) : null}
      {asking?.kind === 'dispatch' ? (
        <Sheet
          title={`Send ${asking.n.number}?`}
          onClose={() => setAsking(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setAsking(null)}>Not yet</button>
              <button type="button" className={btnPrimary} disabled={busy} onClick={() => void run(() => dispatchNote(asking.n.id, shipping()), `${asking.n.number} sent — the stock is issued.`)}>
                Dispatch
              </button>
            </>
          }
        >
          <p className="m-0 text-[12.5px] text-ink-2">Dispatching issues the stock and records the cost of goods. It cannot be undone — a delivery can only be cancelled before it is sent.</p>
          <Shipping v={v} set={set} defaults={asking.n} />
        </Sheet>
      ) : null}
      {asking?.kind === 'cancel' ? (
        <Sheet
          title={`Cancel ${asking.n.number}?`}
          onClose={() => setAsking(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setAsking(null)}>Keep it</button>
              <button type="button" className={btnPrimary + ' !bg-danger'} disabled={busy} onClick={() => void run(() => cancelNote(asking.n.id), `${asking.n.number} cancelled.`)}>
                Cancel the note
              </button>
            </>
          }
        >
          <p className="m-0 text-[12.5px] text-ink-2">Nothing has left yet. The order goes back to waiting to be picked.</p>
        </Sheet>
      ) : null}
      {asking?.kind === 'received' ? (
        <Sheet
          title={`${asking.n.number} received?`}
          onClose={() => setAsking(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setAsking(null)}>Cancel</button>
              <button type="button" className={btnPrimary} disabled={busy} onClick={() => void run(() => deliveredNote(asking.n.id, v('by').trim() || undefined), `${asking.n.number} marked delivered.`)}>
                Confirm delivered
              </button>
            </>
          }
        >
          <Field label="Received by" hint="Optional."><input className={input} value={v('by')} onChange={set('by')} /></Field>
        </Sheet>
      ) : null}
    </div>
  );
}

function Shipping({ v, set, defaults }: { v: (k: string, d?: string) => string; set: (k: string) => (e: { target: { value: string } }) => void; defaults?: Partial<BoardNote> }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Carrier"><input className={input} value={v('carrier', defaults?.carrier ?? '')} onChange={set('carrier')} /></Field>
      <Field label="Tracking number"><input className={input} value={v('tracking_no', defaults?.tracking_no ?? '')} onChange={set('tracking_no')} /></Field>
      <Field label="Vehicle"><input className={input} value={v('vehicle', defaults?.vehicle ?? '')} onChange={set('vehicle')} /></Field>
      <Field label="Driver"><input className={input} value={v('driver', defaults?.driver ?? '')} onChange={set('driver')} /></Field>
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

function Row({ number, priority, tag, onNumber, who, meta, right, actions }: { number: string; priority: string; tag?: string; onNumber: () => void; who: string; meta: string; right?: string; actions: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-line/70 px-3.5 py-2.5 text-[12.5px] last:border-b-0" data-board-row={number}>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <button type="button" onClick={onNumber} className="font-bold text-primary hover:underline">{number}</button>
          <PriorityPill priority={priority} />
          {tag ? <span className="rounded-full bg-subtle px-2 py-0.5 text-[11px] font-bold text-ink-2">{tag}</span> : null}
          <span className="truncate font-semibold text-ink">{who}</span>
        </span>
        <span className="truncate text-[11.5px] text-ink-3">{meta}</span>
      </span>
      {right ? <b className="text-ink tabular-nums">{right}</b> : null}
      <span className="flex shrink-0 gap-1.5">{actions}</span>
    </div>
  );
}

