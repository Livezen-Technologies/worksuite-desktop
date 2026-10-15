import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { app } from '../../core/app-state';
import { call, errorMessage, on } from '../../core/bridge';
import { useStore } from '../../core/store';
import { useTab } from '../../core/tab-context';
import { relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, Empty, Field, input, PageHead, Sheet } from '../hr/parts';
import { approve, fetchApprovals, has, K, KV, reject, type ApprovalRow } from './api';
import { moveFocus, useSalesKeys } from './keys';
import { OFFLINE_WRITE, useSalesOffline } from './offline';
import { moneyFull, PriorityPill } from './parts';

const OrderDrawer = lazy(() => import('./OrderDrawer'));

/**
 * Approvals (D-05, FR-APR-10, FR-DSK-03/05): the orders waiting on a decision I may make — the shared queue the tray
 * and the Dock count, the same number as the rail. Decided with the keyboard: ↑/↓ to an order, A approves it, R asks
 * why and rejects it, Enter opens it. A decision from a banner (Approve on the notification) takes it off this list
 * too: the list follows the server's approval events.
 */
export default function Approvals({ org, openId, onOpen }: { org: string; openId: number | null; onOpen: (id: number | null) => void }) {
  const qc = useQueryClient();
  const { active } = useTab();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const list = useQuery({ queryKey: KV.approvals(org), queryFn: ({ signal }) => fetchApprovals(org, signal), refetchInterval: 30_000 });
  const offline = useSalesOffline();
  const rows = list.data ?? [];
  const [focusAt, setAt] = useState(0);
  // A decision takes a row away: the focus stays on the list's last row rather than past it.
  const at = Math.min(focusAt, Math.max(0, rows.length - 1));
  const [busy, setBusy] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<ApprovalRow | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const canDecide = has(perms, 'oms.orders.approve') && !offline;

  // The list follows decisions made elsewhere (a banner, the web, a phone).
  useEffect(
    () =>
      on<{ type?: string }>('realtime:event', (e) => {
        const t = e.type ?? '';
        if (t.startsWith('oms.approval') || t === 'oms.badge') void qc.invalidateQueries({ queryKey: KV.approvals(org) });
      }),
    [qc, org],
  );

  const decided = () => {
    void qc.invalidateQueries({ queryKey: K.all });
    void call('notifications:refresh').catch(() => undefined);
  };
  const doApprove = async (r: ApprovalRow) => {
    if (!canDecide) return toast('warning', offline ? OFFLINE_WRITE : 'You may not approve orders.');
    setBusy(r.order_id);
    try {
      await approve(r.order_id);
      toast('success', `${r.number}: your step is approved.`);
      decided();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const focus = rows[at] ?? null;

  useSalesKeys(active && !openId && !rejecting, { queue: true, canDecide }, (a) => {
    if (a.kind === 'move') {
      const n = moveFocus(at, a.delta, rows.length);
      setAt(n);
      listRef.current?.querySelector(`[data-approval="${rows[n]?.order_id}"]`)?.scrollIntoView?.({ block: 'nearest' });
      return;
    }
    if (a.kind === 'open' && focus) return onOpen(focus.order_id);
    if (a.kind === 'approve' && focus) return void doApprove(focus);
    if (a.kind === 'reject' && focus) return setRejecting(focus);
    return false;
  });

  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      <PageHead
        title="Pending approval"
        sub={
          <>
            Decide with <Kbd>A</Kbd> approve · <Kbd>R</Kbd> reject · <Kbd>Enter</Kbd> open. The tray and dock badge count this list.
          </>
        }
      />
      {offline ? <p className="m-0 rounded-[9px] bg-warning-bg px-3 py-2 text-[12.5px] text-warning">{OFFLINE_WRITE}</p> : null}
      <div ref={listRef} role="listbox" aria-label="Orders waiting on your approval" aria-activedescendant={focus ? `appr-${focus.order_id}` : undefined} tabIndex={0} className="flex flex-col gap-2 outline-none">
        {list.isLoading ? <Spinner /> : null}
        {list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
        {!list.isLoading && !list.error && !rows.length ? (
          <div className="rounded-[12px] border border-line bg-surface">
            <Empty text="Nothing is waiting on you." />
          </div>
        ) : null}
        {rows.map((r, i) => (
          <div
            key={r.order_id}
            id={`appr-${r.order_id}`}
            role="option"
            aria-selected={i === at}
            data-approval={r.order_id}
            onClick={() => setAt(i)}
            onDoubleClick={() => onOpen(r.order_id)}
            className={cx('flex items-center gap-3 rounded-[12px] border bg-surface px-4 py-3', i === at ? 'border-primary ring-2 ring-primary/20' : 'border-line')}
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-2 text-[13px]">
                <button type="button" className="font-bold text-primary hover:underline" onClick={() => onOpen(r.order_id)}>
                  {r.number}
                </button>
                <span className="truncate text-ink">· {r.client ?? 'No customer'}</span>
                <PriorityPill priority={r.priority} />
              </span>
              <span className="truncate text-[12px] text-ink-3">
                {[r.step ? `Step ${r.step}${r.steps ? ` of ${r.steps}` : ''}` : null, r.rule, r.raised_by ? `raised by ${r.raised_by}` : null, r.submitted_at ? relative(r.submitted_at) : null].filter(Boolean).join(' · ')}
              </span>
            </span>
            <b className="text-[14px] text-ink tabular-nums">{moneyFull(r.total, r.currency)}</b>
            <button type="button" className={btn} disabled={!canDecide || busy === r.order_id} title={offline ? OFFLINE_WRITE : 'R'} onClick={() => setRejecting(r)}>
              Reject
            </button>
            <button type="button" className={btnPrimary} disabled={!canDecide || busy === r.order_id} title={offline ? OFFLINE_WRITE : 'A'} onClick={() => void doApprove(r)}>
              Approve
            </button>
          </div>
        ))}
      </div>
      {rejecting ? (
        <RejectSheet
          row={rejecting}
          onClose={() => setRejecting(null)}
          onDone={() => {
            setRejecting(null);
            decided();
          }}
        />
      ) : null}
      <Suspense fallback={null}>{openId ? <OrderDrawer id={openId} onClose={() => onOpen(null)} /> : null}</Suspense>
    </div>
  );
}

function Kbd({ children }: { children: string }) {
  return <kbd className="mx-0.5 rounded-[5px] border border-line bg-subtle px-1.5 py-px font-mono text-[11px] font-bold text-ink">{children}</kbd>;
}

function RejectSheet({ row, onClose, onDone }: { row: ApprovalRow; onClose: () => void; onDone: () => void }) {
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await reject(row.order_id, why.trim());
      toast('success', `${row.number} rejected.`);
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={`Reject ${row.number}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary + ' !bg-danger'} disabled={busy || !why.trim()} onClick={() => void go()}>
            Reject
          </button>
        </>
      }
    >
      <Field label="Why is it rejected? The person who raised it has to know what to change.">
        <textarea autoFocus rows={3} value={why} onChange={(e) => setWhy(e.target.value)} className={input + ' !h-auto py-2'} />
      </Field>
    </Sheet>
  );
}
