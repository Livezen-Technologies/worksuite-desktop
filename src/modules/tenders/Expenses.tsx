import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useState } from 'react';
import { app } from '../../core/app-state';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { dayWords } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, input, Kpi, Sheet } from '../hr/parts';
import { Pill } from '../inventory/parts';
import { fetchOrgs, K as EK } from '../expenses/api';
import { K } from './api';
import { amount, fetchLinkable, fetchTenderExpenses, KE, linkExpense, markRefunded, overBy, presetFor, statusOf, unlinkExpense, varianceLine, type TenderExpense, type TenderExpenses } from './bidcost';
import { StatGrid } from '../../components/StatCard';

const NewClaim = lazy(() => import('../expenses/NewClaim'));
const ClaimPanel = lazy(() => import('../expenses/ClaimPanel'));

/**
 * What pursuing this bid has cost (worksuite-desktop#159): bid documents, the
 * bond, printing, courier, travel to the pre-bid meeting, stamp duty.
 *
 * THESE ARE EXPENSES, NOT A TENDER LEDGER. Every row is an expense claim whose
 * "Linked to" is this tender. Adding one opens the Expense module's own form —
 * the policy panel, the receipt, the approval chain and all — with the tender
 * filled in and locked; linking attaches a claim already filed. Approving,
 * paying and posting are the Expenses module's, unchanged, and a claim removed
 * or unlinked there simply stops appearing here.
 *
 * THE CARDS ARE THE SERVER'S. Spent, pending, reimbursable and the budget line
 * come back added up from the same filter as the rows, so for somebody who may
 * see only their own claims both say so together (`why`).
 */
export default function Expenses({ id, tender }: { id: number; tender: { title: string; reference: string | null; currency: string } }) {
  const qc = useQueryClient();
  const uid = useStore(app, (s) => s.auth?.user?.id ?? '');
  const q = useQuery({ queryKey: KE.tab(id), queryFn: ({ signal }) => fetchTenderExpenses(id, signal), refetchOnMount: 'always' });
  const [adding, setAdding] = useState<{ categoryId: number | null } | null>(null);
  const [linking, setLinking] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const needOrgs = adding !== null || open !== null;
  const orgs = useQuery({ queryKey: EK.orgs(uid), queryFn: ({ signal }) => fetchOrgs(signal), enabled: needOrgs, retry: false, staleTime: 60_000 });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: KE.tab(id) });
    void qc.invalidateQueries({ queryKey: K.tender(id) });
  };

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  if (!d.visible) return <Empty text={d.why ?? 'You cannot see the expenses against this tender.'} />;

  const ccy = d.totals?.currency ?? d.currency ?? tender.currency;
  const t = d.totals;
  const v = d.variance;
  const over = overBy(v, ccy);
  const row = open !== null ? d.items.find((x) => x.id === open) : undefined;

  return (
    <div className="flex flex-col gap-3.5" aria-label="Expenses">
      <StatGrid label="Bid cost">
        <Kpi icon="wallet" tone="blue" label="Total spent" value={amount(t?.spent ?? '0', ccy)} sub={`${t?.count ?? 0} ${t?.count === 1 ? 'expense' : 'expenses'}, rejected ones left out`} />
        <Kpi icon="hourglass" label="Pending approval" value={amount(t?.pending ?? '0', ccy)} tone={Number(t?.pending ?? 0) > 0 ? 'amber' : undefined} sub={`${t?.by_status.submitted?.count ?? 0} waiting`} />
        <Kpi icon="hand-coins" tone="cyan" label="Reimbursable" value={amount(t?.reimbursable ?? '0', ccy)} sub="Approved, not yet paid back" />
        <Kpi
          icon="scale"
          label="Budget vs actual"
          value={v ? `${v.percent}%` : '—'}
          tone={v?.over ? 'red' : undefined}
          sub={v ? `of ${amount(v.planned, ccy)} planned` : 'No bid budget set on the Budget tab'}
        />
      </StatGrid>

      {v ? (
        <p className={cx('m-0 text-[12.5px]', v.over ? 'text-danger' : 'text-ink-2')} aria-label="Budget variance">
          {varianceLine(v, ccy)}
          {over ? ` · ${over}` : ''}
        </p>
      ) : null}
      {d.written_off ? (
        <p className="m-0 rounded-[9px] bg-subtle px-3 py-2 text-[12.5px] text-ink-2">
          Bid cost written off: <b className="text-ink">{amount(d.written_off, ccy)}</b>
        </p>
      ) : null}
      {t && Number(t.refundable) > 0 ? <p className="m-0 text-[12px] text-ink-3">{amount(t.refundable, ccy)} is refundable and has not come back yet.</p> : null}
      {d.why ? <p className="m-0 text-[12px] text-ink-3">{d.why}</p> : null}

      {d.can.create || d.can.link ? (
        <div className="flex flex-wrap items-center gap-2">
          {d.can.create ? (
            <button type="button" className={btnPrimary} onClick={() => setAdding({ categoryId: null })}>
              <Icon name="plus" size={14} /> Add expense
            </button>
          ) : null}
          {d.can.link ? (
            <button type="button" className={btn} onClick={() => setLinking(true)}>
              <Icon name="link" size={14} /> Link existing expense
            </button>
          ) : null}
          {d.can.create ? (
            <span className="ml-1 flex flex-wrap items-center gap-1.5" aria-label="Quick categories">
              {d.categories.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  className={btnSmall + ' !h-7'}
                  disabled={c.id === null}
                  title={c.id === null ? 'This category is not active in this company' : `Add a ${c.name.toLowerCase()} expense`}
                  onClick={() => setAdding({ categoryId: c.id })}
                >
                  {c.name}
                </button>
              ))}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
        {d.items.length ? (
          <table className="w-full border-collapse text-[12.5px]" aria-label="Expenses against this tender">
            <thead>
              <tr className="border-b border-line text-left text-[11.5px] font-semibold text-ink-3">
                <th className="px-3.5 py-2 font-semibold">Date</th>
                <th className="px-2 py-2 font-semibold">Category</th>
                <th className="px-2 py-2 font-semibold">Description</th>
                <th className="px-2 py-2 font-semibold">Paid by</th>
                <th className="px-2 py-2 text-right font-semibold">Amount</th>
                <th className="px-2 py-2 font-semibold">Status</th>
                <th className="w-8 px-2 py-2">
                  <span className="sr-only">Receipt</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {d.items.map((x) => (
                <Row key={x.id} x={x} ccy={ccy} onOpen={() => setOpen(x.id)} />
              ))}
            </tbody>
          </table>
        ) : (
          <Empty text={d.can.create ? 'Nothing spent on this bid yet. Add the bid document fee, the bond or the courier as they happen.' : 'No expenses are linked to this tender.'} />
        )}
      </div>

      <Suspense fallback={null}>
        {adding && d.org_id !== null && orgs.data ? (
          <NewClaim
            orgId={d.org_id}
            orgs={orgs.data.items}
            preset={presetFor(d.prefill, adding.categoryId)}
            fixed={['tender_id']}
            relatedLabel={`the tender ${tender.reference ? `${tender.reference} · ` : ''}${tender.title}`}
            onClose={() => setAdding(null)}
            onDone={() => {
              setAdding(null);
              void qc.invalidateQueries({ queryKey: EK.all });
              refresh();
            }}
          />
        ) : null}
        {open !== null && orgs.data ? (
          <ClaimPanel
            id={open}
            org={d.org_id !== null ? String(d.org_id) : ''}
            orgs={orgs.data.items}
            onClose={() => setOpen(null)}
            onGo={(view, extra = '') => navigate(`/expenses?tab=${view}${extra}`)}
            extra={<TenderActions id={id} claim={row} d={d} me={uid} onDone={() => (setOpen(null), refresh())} />}
          />
        ) : null}
      </Suspense>
      {adding && orgs.isError ? <p className="m-0 text-[12.5px] text-danger">{errorMessage(orgs.error)}</p> : null}
      {linking ? <LinkSheet id={id} onClose={() => setLinking(false)} onLinked={refresh} /> : null}
    </div>
  );
}

function Row({ x, ccy, onOpen }: { x: TenderExpense; ccy: string | null; onOpen: () => void }) {
  const s = statusOf(x.status);
  const own = x.base_amount !== null ? amount(x.base_amount, x.base_currency || ccy) : amount(x.amount, x.currency);
  return (
    <tr data-expense={x.id} onClick={onOpen} className={cx('cursor-pointer border-b border-line/60 last:border-b-0 hover:bg-subtle', x.status === 'rejected' && 'text-ink-3')}>
      <td className="px-3.5 py-2 whitespace-nowrap text-ink-2">{x.spent_on ? dayWords(x.spent_on, { year: true }) : '—'}</td>
      <td className="px-2 py-2 text-ink-2">{x.category ?? '—'}</td>
      <td className="max-w-[280px] px-2 py-2">
        <button type="button" className="block w-full truncate text-left font-semibold text-ink hover:underline" onClick={(e) => (e.stopPropagation(), onOpen())}>
          {x.description || x.claim_no || 'An expense'}
        </button>
        {x.refundable ? <span className="text-[11px] text-ink-3">{x.refunded ? 'Refunded' : 'Refundable'}</span> : null}
      </td>
      <td className="px-2 py-2 text-ink-2">{x.claimant ?? '—'}</td>
      <td className="px-2 py-2 text-right font-semibold whitespace-nowrap text-ink tabular-nums">{own}</td>
      <td className="px-2 py-2">
        <Pill tone={s.tone}>{s.label}</Pill>
      </td>
      <td className="px-2 py-2 text-ink-3">{x.has_receipt ? <Icon name="paperclip" size={13} label="Has a receipt" /> : null}</td>
    </tr>
  );
}

/** What the tender adds above the Expense module's own drawer: the way to the full record, a refund, taking it off. */
function TenderActions({ id, claim, d, me, onDone }: { id: number; claim: TenderExpense | undefined; d: TenderExpenses; me: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  if (!claim) return null;
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast('success', done);
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const mayUnlink = d.can.unlink || (d.can.link && String(claim.user_id ?? '') === me);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[10px] bg-ground px-3 py-2.5" aria-label="On this tender">
      <button type="button" className={btnSmall} onClick={() => navigate(`/expenses?claim=${claim.id}${d.org_id ? `&org=${d.org_id}` : ''}`)}>
        <Icon name="external" size={13} /> Open in Expenses
      </button>
      {claim.refundable && !claim.refunded && d.can.refund && claim.status !== 'rejected' ? (
        <button type="button" className={btnSmall} disabled={busy} onClick={() => void run(() => markRefunded(id, claim.id), 'Recorded as refunded.')}>
          <Icon name="check-circle" size={13} /> Mark refunded
        </button>
      ) : null}
      {mayUnlink ? (
        <button type="button" className={btnSmall + ' !text-ink-2'} disabled={busy} onClick={() => void run(() => unlinkExpense(id, claim.id), 'Unlinked. The expense itself is unchanged.')}>
          Unlink from this tender
        </button>
      ) : null}
    </div>
  );
}

/** Expenses already filed, linked to no tender, that this person may attach here. */
export function LinkSheet({ id, onClose, onLinked }: { id: number; onClose: () => void; onLinked: () => void }) {
  const [q, setQ] = useState('');
  const [needle, setNeedle] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setNeedle(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const found = useQuery({ queryKey: KE.linkable(id, needle), queryFn: ({ signal }) => fetchLinkable(id, needle, signal), retry: false });
  const link = async (claimId: number) => {
    setBusy(claimId);
    try {
      await linkExpense(id, claimId);
      toast('success', 'Linked to this tender.');
      onLinked();
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Sheet
      title="Link an existing expense"
      width={560}
      onClose={onClose}
      footer={
        <button type="button" className={btn} onClick={onClose}>
          Close
        </button>
      }
    >
      <p className="m-0 text-[12.5px] text-ink-2">Expenses in this tender's company that are not linked to any tender yet. Linking changes nothing about how they are approved or paid.</p>
      <input aria-label="Find an expense" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Description, claim number or person" className={input} />
      <div className="flex max-h-[340px] flex-col overflow-y-auto rounded-[10px] border border-line" aria-label="Unlinked expenses">
        {found.isLoading ? (
          <Spinner />
        ) : found.error ? (
          <p className="m-0 px-3 py-2.5 text-[12.5px] text-danger">{errorMessage(found.error)}</p>
        ) : found.data?.length ? (
          found.data.map((x) => (
            <div key={x.id} className="flex items-center gap-2 border-b border-line/60 px-3 py-2 text-[12.5px] last:border-b-0">
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="truncate text-ink">{x.description || x.claim_no}</b>
                <span className="truncate text-[11.5px] text-ink-3">{[x.claim_no, x.spent_on ? dayWords(x.spent_on, { year: true }) : null, x.category, x.claimant, statusOf(x.status).label].filter(Boolean).join(' · ')}</span>
              </span>
              <b className="shrink-0 text-ink tabular-nums">{amount(x.base_amount ?? x.amount, x.base_amount ? x.base_currency : x.currency)}</b>
              <button type="button" className={btnSmall + ' !h-7'} disabled={busy !== null} onClick={() => void link(x.id)}>
                {busy === x.id ? 'Linking…' : 'Link'}
              </button>
            </div>
          ))
        ) : (
          <Empty text={needle ? 'Nothing unlinked matches that.' : 'There are no unlinked expenses you can attach.'} />
        )}
      </div>
    </Sheet>
  );
}
