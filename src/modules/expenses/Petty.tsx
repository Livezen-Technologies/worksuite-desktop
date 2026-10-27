import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Spinner, cx } from '../../components/ui';
import { refusal, shortDate } from '../finance/api';
import { Caps, ConfirmSheet, LoadFailed, Notice } from '../finance/parts';
import { btn, btnPrimary, btnSmall, Field, input, PageHead, Seg, Sheet, SidePanel } from '../hr/parts';
import { Pill } from '../inventory/parts';
import { can, money } from './api';
import {
  atLeast,
  centsMoney,
  closeFund,
  countDifference,
  createFund,
  fetchFund,
  fetchFunds,
  hasCeiling,
  MK,
  postFundTxn,
  reconcileFund,
  refillFund,
  refillProblem,
  refusedSentence,
  signedCents,
  spendProblem,
  suggestedRefill,
  varianceWords,
  type Fund,
  type FundDetail,
} from './money';
import { Note } from './parts';
import type { ScreenProps } from './Rail';

/**
 * Petty cash: floats of real cash, one company's.
 *
 * THE BALANCE IS COMPUTED, NEVER STORED. It is the sum of the fund's
 * transactions every time it is read, so there is exactly one definition of
 * "how much is in the tin" and it cannot drift from the tin.
 *
 * THE TIN CANNOT GO NEGATIVE. Spending more than the fund holds is refused —
 * a book that lets physical cash go below zero has already lost track of
 * reality — and a refill that would take it past its ceiling is refused, since
 * an imprest fund is restored to its float, not beyond. Both are said while
 * the amount is typed, in the server's words; the server checks again.
 *
 * A COUNT IS RECORDED, NOT CORRECTED. Reconciling writes the physical count
 * beside the book balance and the difference between them; it changes neither.
 * The difference is shown as it is typed, which way and by how much, before
 * anybody commits to it.
 *
 * Handling the tin is finance territory: the screen needs `expense.manage`;
 * posting to a fund needs membership of the company, and opening, counting,
 * refilling and closing one its finance role. Closing is confirmed first — there
 * is no reopening a closed fund.
 */
export default function Petty(props: ScreenProps) {
  if (props.orgId === null) return <Note>Petty cash shows one company at a time. Choose one in the switcher.</Note>;
  return <PettyScreen {...props} orgId={props.orgId} />;
}

function PettyScreen({ orgId, orgs }: ScreenProps & { orgId: number }) {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const org = orgs.find((o) => o.id === orgId) ?? null;
  const manage = can(perms, 'expense.manage');
  const may = { post: manage && atLeast(org, 'member'), finance: manage && atLeast(org, 'finance') };
  const funds = useQuery({ queryKey: MK.funds(orgId), queryFn: ({ signal }) => fetchFunds(orgId, signal), retry: false });
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  if (funds.isLoading) return <Spinner />;
  if (funds.error) {
    const said = refusedSentence(funds.error);
    return said ? (
      <div className="px-6 py-5">
        <Notice tone="amber">{said}</Notice>
      </div>
    ) : (
      <LoadFailed what="The petty cash funds" onRetry={() => void funds.refetch()} />
    );
  }
  const rows = funds.data ?? [];

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Petty cash" sub="Balances are computed from transactions — never stored, so they cannot drift from the tin.">
        {may.finance ? (
          <button type="button" className={btnPrimary} onClick={() => setCreating(true)}>
            <Icon name="plus" size={14} /> New fund
          </button>
        ) : null}
      </PageHead>
      {!rows.length ? (
        <div className="rounded-[12px] border border-dashed border-line px-4 py-8 text-center text-[13px] text-ink-3">No petty cash funds yet.</div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
          {rows.map((f) => (
            <FundCard key={f.id} f={f} on={open === f.id} onOpen={() => setOpen(f.id)} />
          ))}
        </div>
      )}
      {open !== null ? <FundPanel key={open} orgId={orgId} id={open} may={may} onClose={() => setOpen(null)} /> : null}
      {creating ? <NewFund orgId={orgId} currency={org?.currency ?? ''} onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function FundState({ status }: { status: string }) {
  return <Pill tone={status === 'open' ? 'green' : 'grey'}>{status === 'open' ? 'Open' : status === 'closed' ? 'Closed' : status}</Pill>;
}

function FundCard({ f, on, onOpen }: { f: Fund; on: boolean; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className={cx('flex flex-col gap-1 rounded-[12px] border bg-surface px-4 py-3.5 text-left hover:border-primary/40', on ? 'border-primary' : 'border-line')}>
      <span className="flex items-center gap-1.5">
        <b className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{f.name}</b>
        {f.float.low ? <Pill tone="red">Low</Pill> : null}
        <FundState status={f.status} />
      </span>
      <b className="text-[22px] leading-tight text-ink tabular-nums">{money(f.balance, f.currency)}</b>
      <span className="truncate text-[12px] text-ink-3">
        {f.custodian ? `Custodian: ${f.custodian}` : 'No custodian'}
        {hasCeiling(f) ? ` · float ${money(f.float.max)}` : ''}
      </span>
    </button>
  );
}

type Kind = 'opening' | 'in' | 'out';
const KIND_WORD: Record<Kind, string> = { out: 'Spend', in: 'Top up', opening: 'Opening' };

/** One fund: its balance against its float, the transactions that make it, and the counts taken of it. */
function FundPanel({ orgId, id, may, onClose }: { orgId: number; id: number; may: { post: boolean; finance: boolean }; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: MK.fund(orgId, id), queryFn: ({ signal }) => fetchFund(orgId, id, signal), retry: false });
  const [asking, setAsking] = useState<'count' | 'refill' | 'close' | null>(null);
  const [busy, setBusy] = useState(false);
  // The whole family: the list's balances come from the same transactions.
  const refresh = () => void qc.invalidateQueries({ queryKey: MK.funds(orgId) });
  const f = q.data;

  const close = async () => {
    setBusy(true);
    try {
      const r = await closeFund(orgId, id);
      toast('success', r.message ?? 'Fund closed');
      setAsking(null);
      refresh();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel
      label="Petty cash fund"
      width={540}
      onClose={onClose}
      head={
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2">
            <b className="truncate text-[15px] text-ink">{f?.name ?? 'Fund'}</b>
            {f ? <FundState status={f.status} /> : null}
          </span>
          {f ? <span className="text-[12px] text-ink-3">{f.custodian ? `Custodian: ${f.custodian}` : 'No custodian'}</span> : null}
        </span>
      }
    >
      {q.isLoading ? <Spinner /> : null}
      {q.error ? refusedSentence(q.error) ? <Notice tone="amber">{refusedSentence(q.error)}</Notice> : <LoadFailed what="That fund" onRetry={() => void q.refetch()} /> : null}
      {f ? (
        <>
          <section aria-label="Balance" className={cx('rounded-[12px] border px-4 py-3.5', f.float.low ? 'border-danger-line bg-danger-bg dark:border-danger/40 dark:bg-danger-bg' : 'border-line bg-ground')}>
            <div className="flex items-center gap-2 text-[12px] text-ink-3">
              Current balance
              {f.float.low ? <Pill tone="red">below minimum</Pill> : null}
            </div>
            <div data-testid="fund-balance" className="text-[28px] leading-tight font-bold text-ink tabular-nums">
              {money(f.balance, f.currency)}
            </div>
            {hasCeiling(f) ? (
              <div className="text-[12px] text-ink-3">
                float {money(f.float.min, f.currency)} – {money(f.float.max, f.currency)}
              </div>
            ) : null}
            {may.finance ? (
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button type="button" className={btnSmall} onClick={() => setAsking('count')}>
                  Reconcile against a physical count
                </button>
                {f.status === 'open' ? (
                  <button type="button" className={btnSmall} onClick={() => setAsking('refill')}>
                    Refill{f.float.low ? ' (low balance)' : ''}
                  </button>
                ) : null}
                {f.status === 'open' ? (
                  <button type="button" className="text-[12px] font-semibold text-ink-3 hover:text-danger" onClick={() => setAsking('close')}>
                    Close the fund…
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>

          {f.status === 'open' && may.post ? <PostForm key={f.has_opening ? 'o' : 'n'} orgId={orgId} f={f} onPosted={refresh} /> : null}
          {f.status !== 'open' ? <Notice tone="grey">This fund is closed. Nothing more can be posted to it.</Notice> : null}

          <div>
            <Caps>Transactions</Caps>
            <div className="mt-1 overflow-hidden rounded-[10px] border border-line">
              {f.transactions.map((t) => {
                const out = t.txn_type === 'out';
                return (
                  <div key={t.id} className="flex items-center gap-3 border-b border-line/60 px-3 py-2 text-[12.5px] last:border-b-0">
                    <span className={cx('w-[110px] shrink-0 font-semibold tabular-nums', out ? 'text-danger' : 'text-success-ink dark:text-success')}>
                      {out ? '−' : '+'}
                      {money(t.amount)}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-ink">{t.description}</span>
                      {t.txn_type === 'opening' || t.category ? <span className="truncate text-[11px] text-ink-3">{[t.txn_type === 'opening' ? 'Opening balance' : null, t.category].filter(Boolean).join(' · ')}</span> : null}
                    </span>
                    <span className="shrink-0 text-[11.5px] text-ink-3">{shortDate(t.txn_date)}</span>
                  </div>
                );
              })}
              {!f.transactions.length ? <p className="m-0 px-3 py-3 text-[12px] text-ink-3">None yet.</p> : null}
            </div>
          </div>

          {f.reconciliations.length ? (
            <div>
              <Caps>Counts</Caps>
              <div className="mt-1 overflow-hidden rounded-[10px] border border-line">
                {f.reconciliations.map((r) => {
                  const v = signedCents(r.variance) ?? 0;
                  return (
                    <div key={r.id} className="flex items-start gap-2 border-b border-line/60 px-3 py-2 text-[12.5px] last:border-b-0">
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-ink-2">
                          Counted {money(r.counted, f.currency)} against a book balance of {money(r.computed, f.currency)}
                        </span>
                        {r.note ? <span className="text-[11.5px] text-ink-3">{r.note}</span> : null}
                      </span>
                      <Pill tone={v === 0 ? 'green' : 'red'}>{v === 0 ? 'No difference' : `${centsMoney(Math.abs(v), f.currency)} ${v > 0 ? 'over' : 'short'}`}</Pill>
                      <span className="shrink-0 text-[11.5px] text-ink-3">{r.at ? shortDate(r.at) : ''}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {asking === 'count' ? <CountSheet orgId={orgId} f={f} onClose={() => setAsking(null)} onDone={refresh} /> : null}
          {asking === 'refill' ? <RefillSheet orgId={orgId} f={f} onClose={() => setAsking(null)} onDone={refresh} /> : null}
          {asking === 'close' ? (
            <ConfirmSheet
              title={`Close ${f.name}?`}
              body={
                <>
                  Nothing more can be posted to it once it is closed, and there is no reopening it here. Its balance of <b className="text-ink">{money(f.balance, f.currency)}</b> stays on the record exactly as it is — count the cash and hand it in first, so the book and the tin agree when it stops.
                </>
              }
              action="Close the fund"
              danger
              busy={busy}
              onYes={() => void close()}
              onClose={() => setAsking(null)}
            />
          ) : null}
        </>
      ) : null}
    </SidePanel>
  );
}

/** Post one movement: the opening balance once, then spending and top-ups. */
function PostForm({ orgId, f, onPosted }: { orgId: number; f: FundDetail; onPosted: () => void }) {
  const kinds: Kind[] = f.has_opening ? ['out', 'in'] : ['opening', 'out', 'in'];
  // A fund with no opening balance holds nothing to spend: start where it has to.
  const [kind, setKind] = useState<Kind>(f.has_opening ? 'out' : 'opening');
  const [amt, setAmt] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const problem = spendProblem(kind, amt, f.balance);
  const post = async () => {
    setBusy(true);
    try {
      const r = await postFundTxn(orgId, f.id, { txn_type: kind, amount: amt, description: desc, txn_date: todayInZone() });
      toast('success', r.message ?? 'Transaction posted');
      setAmt('');
      setDesc('');
      onPosted();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="flex flex-col gap-2 rounded-[12px] border border-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && amt.trim() && desc.trim() && !problem) void post();
      }}
    >
      <Seg label="What happened" value={kind} onChange={setKind} options={kinds.map((k) => ({ id: k, label: KIND_WORD[k] }))} />
      <div className="flex gap-2">
        <input value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.,]/g, ''))} inputMode="decimal" placeholder="Amount" aria-label="Amount" className={cx(input, 'w-[130px] shrink-0 tabular-nums')} />
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description" aria-label="Description" className={input} />
        <button type="submit" className={btnPrimary} disabled={busy || !amt.trim() || !desc.trim() || !!problem}>
          {busy ? 'Posting…' : 'Post'}
        </button>
      </div>
      {problem ? <span className="text-[12px] text-danger">{problem}</span> : null}
    </form>
  );
}

/**
 * A physical count against the book. The difference is shown as it is typed —
 * which way the tin is out and by how much — and recorded, not corrected.
 */
function CountSheet({ orgId, f, onClose, onDone }: { orgId: number; f: FundDetail; onClose: () => void; onDone: () => void }) {
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const diff = countDifference(counted, f.balance);
  const bad = counted.trim() !== '' && diff === null;
  const save = async () => {
    setBusy(true);
    try {
      const r = await reconcileFund(orgId, f.id, counted, note);
      const v = signedCents(r.data?.variance ?? '0') ?? 0;
      toast(v === 0 ? 'success' : 'warning', v === 0 ? 'Reconciled — no variance' : `Reconciled — ${varianceWords(v, f.currency)}`);
      onDone();
      onClose();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="Reconcile against a physical count"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || diff === null} onClick={() => void save()}>
            {busy ? 'Recording…' : 'Record the count'}
          </button>
        </>
      }
    >
      <p className="m-0 text-[13px] text-ink-2">
        Count the cash physically and enter the amount. The book says <b className="text-ink tabular-nums">{money(f.balance, f.currency)}</b>.
      </p>
      <Field label="Counted">
        <input autoFocus value={counted} onChange={(e) => setCounted(e.target.value.replace(/[^0-9.,]/g, ''))} inputMode="decimal" placeholder="0.00" aria-label="Counted" className={cx(input, 'tabular-nums')} />
      </Field>
      {diff !== null ? (
        <Notice tone={diff === 0 ? 'green' : 'amber'}>
          <span data-testid="count-difference">{varianceWords(diff, f.currency)}</span>
          {diff !== 0 ? '. The difference is recorded beside the count; neither the book nor the tin is changed by it.' : '.'}
        </Notice>
      ) : bad ? (
        <span className="text-[12px] text-danger">Enter the counted amount</span>
      ) : null}
      <Field label="Note" hint="Optional — what the count found, or why it differs.">
        <input value={note} onChange={(e) => setNote(e.target.value)} className={input} />
      </Field>
    </Sheet>
  );
}

/** Top the fund up towards its float — never past it. */
function RefillSheet({ orgId, f, onClose, onDone }: { orgId: number; f: FundDetail; onClose: () => void; onDone: () => void }) {
  const suggested = suggestedRefill(f);
  const [amt, setAmt] = useState(suggested);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const problem = refillProblem(amt, f);
  const save = async () => {
    setBusy(true);
    try {
      const r = await refillFund(orgId, f.id, amt, note);
      toast('success', r.message ?? 'Fund replenished');
      onDone();
      onClose();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={`Refill ${f.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !amt.trim() || !!problem} onClick={() => void save()}>
            {busy ? 'Refilling…' : 'Refill'}
          </button>
        </>
      }
    >
      <p className="m-0 text-[13px] text-ink-2">
        It holds <b className="text-ink tabular-nums">{money(f.balance, f.currency)}</b>.
        {suggested ? ` ${money(suggested, f.currency)} brings it back to its float of ${money(f.float.max, f.currency)}.` : hasCeiling(f) ? ' It is already at its float.' : ' It has no maximum float set.'}
      </p>
      <Field label="Refill amount">
        <input autoFocus value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.,]/g, ''))} inputMode="decimal" aria-label="Refill amount" className={cx(input, 'tabular-nums')} />
      </Field>
      {problem ? <span className="text-[12px] text-danger">{problem}</span> : null}
      <Field label="Note" hint="Optional. Recorded as the top-up's description; “Refill” when left empty.">
        <input value={note} onChange={(e) => setNote(e.target.value)} className={input} />
      </Field>
    </Sheet>
  );
}

function NewFund({ orgId, currency, onClose }: { orgId: number; currency: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [max, setMax] = useState('');
  const [min, setMin] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await createFund(orgId, { name, max_float: max, min_float: min, currency });
      toast('success', r.message ?? 'Fund created');
      void qc.invalidateQueries({ queryKey: MK.funds(orgId) });
      onClose();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="New petty cash fund"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !name.trim()} onClick={() => void save()}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </>
      }
    >
      <Field label="Name">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Front desk" className={input} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Maximum float" hint="Refills top the fund up to this">
          <input value={max} onChange={(e) => setMax(e.target.value.replace(/[^0-9.,]/g, ''))} inputMode="decimal" placeholder="0 = no ceiling" className={input} />
        </Field>
        <Field label="Minimum float" hint="At or below it, the fund shows as low">
          <input value={min} onChange={(e) => setMin(e.target.value.replace(/[^0-9.,]/g, ''))} inputMode="decimal" placeholder="0 = no low-balance alert" className={input} />
        </Field>
      </div>
      {currency ? <p className="m-0 text-[12px] text-ink-3">Kept in {currency}, the company&rsquo;s currency. It starts empty: post its opening balance once it is created.</p> : null}
    </Sheet>
  );
}
