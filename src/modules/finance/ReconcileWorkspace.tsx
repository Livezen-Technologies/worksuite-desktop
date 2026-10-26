import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError } from '../../core/api';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { StatCard } from '../../components/StatCard';
import { Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, input, Seg, SidePanel } from '../hr/parts';
import { Pill } from '../inventory/parts';
import { can, isNegative, K, money, refusal, shortDate, type Company } from './api';
import {
  arithmetic,
  autoMatch,
  autoMatchSummary,
  BK,
  fetchChoices,
  fetchRec,
  fetchSuggestions,
  fetchTxns,
  KINDS,
  lockBlockers,
  lockRec,
  matchLine,
  parkLine,
  PER_PAGE,
  reasons,
  strength,
  TXN_LABEL,
  TXN_TONE,
  unlockRec,
  unmatch,
  type BankAccount,
  type Kind,
  type Txn,
} from './banking';
import { Caps, ConfirmSheet, LoadFailed, Notice, ReasonSheet } from './parts';
import type { FinanceView } from './Rail';

/**
 * Reconciling one period: the bank's lines, and the ledger lines that could
 * be them.
 *
 * THE DIFFERENCE IS THE HEADLINE, BECAUSE IT IS THE ONLY QUESTION. Everything
 * here exists to move one number to nil, so it is stated once, large, with
 * the arithmetic beside it — what the bank says, what only the ledger has,
 * what only the bank has, and what the ledger says — so whoever is staring at
 * a non-zero figure can see which input they can do something about.
 *
 * "Agree and lock" stays off while that number is not nil, or while any line
 * up to the closing date is unmatched, and says which. The unmatched lines
 * are counted by the server over exactly the range its lock checks — never
 * from the page in hand, which would enable the button on a partial view. A
 * reconciliation locked against an unexplained figure freezes the account
 * against a number nobody understands.
 *
 * Matching is the work (`finance.bank.import`); locking is the control
 * (`finance.bank.reconcile`), and a control signed off by the hands that did
 * the work is not one. Reopening takes a reason: it is the only record of why
 * an agreed period stopped being agreed.
 */
export default function ReconcileWorkspace({
  company,
  account,
  accountId,
  recId,
  onBack,
  onGo,
}: {
  company: Company;
  account: BankAccount | null;
  accountId: string;
  recId: string;
  onBack: () => void;
  onGo: (view: FinanceView, extra?: string) => void;
}) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const mayImport = can(perms, 'finance.bank.import');
  const mayReconcile = can(perms, 'finance.bank.reconcile');
  const rec = useQuery({ queryKey: BK.rec(company.id, recId), queryFn: ({ signal }) => fetchRec(company.id, recId, signal), retry: false });
  const r = rec.data?.reconciliation;
  const locked = r?.status === 'locked';
  const period = { from: r?.period_start ?? '', to: r?.period_end ?? '' };
  // Narrowed by the server to the period, and paged: an account with 791 lines is not fetched whole.
  const txns = useInfiniteQuery({
    queryKey: BK.txns(company.id, accountId, period),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => fetchTxns(company.id, accountId, { from: period.from, to: period.to, page: pageParam }, signal),
    getNextPageParam: (last, pages) => (last.transactions.length < PER_PAGE || pages.length * PER_PAGE >= Number(last.total) ? undefined : pages.length + 1),
    enabled: !!r,
    retry: false,
  });
  // What the lock counts: every unmatched line on the account up to the closing date.
  const unmatchedQ = useQuery({
    queryKey: BK.unmatched(company.id, accountId, period.to),
    queryFn: ({ signal }) => fetchTxns(company.id, accountId, { status: 'unmatched', to: period.to, per_page: 1 }, signal).then((p) => Number(p.total) || 0),
    enabled: !!r && !locked,
    retry: false,
  });
  const rows = useMemo(() => (txns.data?.pages ?? []).flatMap((p) => p.transactions ?? []), [txns.data]);
  const [openTxn, setOpenTxn] = useState<string | null>(null);
  const [asking, setAsking] = useState<'lock' | 'unlock' | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => void qc.invalidateQueries({ queryKey: K.company(company.id) });
  const act = async (fn: () => Promise<unknown>, done: string | ((res: unknown) => string)) => {
    setBusy(true);
    try {
      const res = await fn();
      toast('success', typeof done === 'string' ? done : done(res));
      setAsking(null);
      refresh();
    } catch (e) {
      // As said: "the ledger says X, the bank says Y, and Z of outstanding items leaves W unexplained" is the whole answer.
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  const back = (
    <button type="button" className={btnSmall} onClick={onBack}>
      <Icon name="chevron-left" size={13} /> Periods
    </button>
  );
  if (rec.isLoading) return <Spinner />;
  if (rec.error || !r) {
    const said = rec.error instanceof ApiError && rec.error.status === 404;
    return (
      <div className="flex flex-col items-start gap-3 px-6 py-5">
        {back}
        {said ? <Notice tone="red">{refusal(rec.error)}</Notice> : <LoadFailed what="That reconciliation" onRetry={() => void rec.refetch()} />}
      </div>
    );
  }

  const cur = account?.currency ?? company.base_currency ?? '';
  const live = rec.data?.live !== false;
  const { expected, agreed } = arithmetic(r);
  const good = locked || agreed;
  const blockers = locked ? [] : lockBlockers(r, unmatchedQ.isSuccess ? unmatchedQ.data : null, cur);
  const m = (v: string | null | undefined) => (v === null || v === undefined ? '—' : money(v, cur));
  const total = Number(txns.data?.pages[0]?.total ?? 0);
  const shown = openTxn === null ? null : (rows.find((t) => String(t.id) === openTxn) ?? null);
  const toneText = good ? 'text-[#145C39] dark:text-success' : 'text-[#7A3B05] dark:text-warning';

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <div className="flex flex-wrap items-center gap-2">
        {back}
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink-2">{account ? `${account.code} ${account.name}` : null}</span>
        {!locked && mayImport ? (
          <button type="button" className={btn} disabled={busy} onClick={() => void act(() => autoMatch(company.id, accountId), (res) => autoMatchSummary(res as { matched: number; considered: number }))}>
            <Icon name="refresh" size={14} /> Match what is obvious
          </button>
        ) : null}
        {locked && mayReconcile ? (
          <button type="button" className={btn} disabled={busy} onClick={() => setAsking('unlock')}>
            <Icon name="unlock" size={14} /> Reopen…
          </button>
        ) : null}
        {!locked && mayReconcile ? (
          <button type="button" className={btnPrimary} disabled={busy || blockers.length > 0} title={blockers.join(' ') || undefined} onClick={() => setAsking('lock')}>
            <Icon name="lock" size={14} /> Agree and lock
          </button>
        ) : null}
      </div>

      {/* ── the one number ── */}
      <section aria-label="Difference" className={cx('rounded-[14px] border p-4', good ? 'border-[#B9E2C8] bg-[#EFF8F2] dark:border-success/40 dark:bg-success-bg' : 'border-[#F5D48A] bg-[#FFF8E6] dark:border-warning/40 dark:bg-warning-bg')}>
        <div className="flex flex-wrap items-end justify-between gap-5">
          <StatCard
            className="min-w-[220px]"
            size="lg"
            label={`Difference · ${shortDate(r.period_start)} – ${shortDate(r.period_end)}${locked ? ' · locked' : ''}`}
            value={<span data-testid="difference">{m(r.difference)}</span>}
            empty={agreed}
            sub={agreed ? 'agreed — the two sides meet' : 'unexplained'}
            icon={good ? 'check-circle' : 'scale'}
            tone={good ? 'green' : 'amber'}
          />
          {/* Four figures, not three: money reaches each side before the other in both directions. */}
          <dl className="m-0 grid grid-cols-4 gap-x-6 gap-y-0.5 text-right">
            <Fig label="The bank says" value={m(r.statement_closing)} sub="its closing balance" />
            <Fig label="Ledger only" value={m(r.unpresented)} sub="not yet on the statement" />
            <Fig label="Bank only" value={m(r.unrecorded)} sub="not yet in the ledger" />
            <Fig label="The ledger says" value={m(r.ledger_balance)} sub={`posted to ${shortDate(r.period_end)}`} />
          </dl>
        </div>
        {expected !== null ? (
          <p className="mt-3 mb-0 text-[12px] text-ink-2 tabular-nums">
            {m(r.statement_closing)} + {m(r.unpresented)} − {m(r.unrecorded)} = <b>{m(expected)}</b>, which the ledger should say. It says {m(r.ledger_balance)}.
          </p>
        ) : null}
        {!locked && !agreed ? (
          <p className="mt-2 mb-0 max-w-[80ch] text-[12px] text-ink-2">
            The bank&rsquo;s closing balance, plus what the ledger has recorded that the bank has not seen, minus what the bank has recorded that the ledger has not, should equal the ledger. Anything left over is unexplained — match it, or park it with a reason.
          </p>
        ) : null}
        {locked ? (
          <p className={cx('mt-2 mb-0 text-[12px]', toneText)}>
            Nothing can be dated into this account on or before {shortDate(r.period_end)}, anywhere in the product.
            {r.locked_at ? ` Locked${r.locked_by_name ? ` by ${r.locked_by_name}` : ''} on ${shortDate(r.locked_at)}.` : ''}
            {r.note ? ` Reason recorded: ${r.note}` : ''}
          </p>
        ) : r.note ? (
          <p className="mt-2 mb-0 text-[12px] text-ink-2">Reopened before, because: {r.note}</p>
        ) : null}
        {!live ? <p className="mt-2 mb-0 text-[11.5px] text-ink-3">These are the figures as they stood when it was locked, not recomputed — a locked reconciliation that recalculated itself would stop being a statement about a moment.</p> : null}
      </section>

      {!locked ? (
        blockers.length ? (
          <div className="flex flex-col gap-1 text-[12.5px] text-ink-2">
            <b className="text-ink">Not ready to lock{mayReconcile ? '' : ' (and locking needs finance.bank.reconcile, which is a separate grant)'}:</b>
            <ul className="m-0 pl-4">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        ) : (
          <Notice tone="green">{mayReconcile ? 'The two sides agree and every line up to the closing date is matched or parked. It can be agreed and locked.' : 'Ready to lock — by somebody who holds finance.bank.reconcile.'}</Notice>
        )
      ) : null}

      {/* ── the statement lines ── */}
      <div className="flex items-baseline gap-2">
        <b className="text-[14px] text-ink">Statement lines in this period</b>
        <span className="text-[12px] text-ink-3">{txns.isLoading ? '' : `${total.toLocaleString()} ${total === 1 ? 'line' : 'lines'}`}</span>
      </div>
      {txns.error && !rows.length ? (
        <LoadFailed what="The statement lines" onRetry={() => void txns.refetch()} />
      ) : (
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <div className="flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
            <span className="w-[96px] shrink-0">Date</span>
            <span className="min-w-0 flex-1">Description</span>
            <span className="w-[130px] shrink-0 text-right">Amount</span>
            <span className="w-[100px] shrink-0">State</span>
            <span className="w-[110px] shrink-0" />
          </div>
          {txns.isLoading ? <Spinner /> : null}
          {rows.map((t) => (
            <button key={t.id} type="button" onClick={() => setOpenTxn(String(t.id))} className={cx('flex w-full items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-left text-[13px] last:border-b-0 hover:bg-subtle', openTxn === String(t.id) && 'bg-selection')}>
              <span className="w-[96px] shrink-0 text-ink-2 tabular-nums">{shortDate(t.txn_date)}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-ink">{t.description ?? <span className="text-ink-3">No description</span>}</span>
                {t.note ? <span className="truncate text-[11.5px] text-ink-3">{t.status === 'ignored' ? `Parked: ${t.note}` : t.note}</span> : null}
              </span>
              <span className={cx('w-[130px] shrink-0 text-right font-semibold whitespace-nowrap tabular-nums', isNegative(t.amount) ? 'text-danger' : 'text-[#166534] dark:text-success')}>{money(t.amount)}</span>
              <span className="w-[100px] shrink-0">
                <Pill tone={TXN_TONE[t.status] ?? 'grey'}>{TXN_LABEL[t.status] ?? t.status}</Pill>
              </span>
              <span className="w-[110px] shrink-0 text-right text-[12px] font-semibold text-primary">{t.status === 'matched' ? 'See the match' : locked ? 'See the line' : 'Find a match'}</span>
            </button>
          ))}
          {!txns.isLoading && !rows.length ? <div className="px-3.5 py-8 text-center text-[12.5px] text-ink-3">No statement line falls in this period. Load a statement first.</div> : null}
          {txns.hasNextPage ? (
            <div className="flex items-center gap-2 border-t border-line bg-ground px-3.5 py-2 text-[12px] text-ink-3">
              <span className="flex-1">
                {rows.length.toLocaleString()} of {total.toLocaleString()} lines
              </span>
              <button type="button" className="font-semibold text-primary hover:underline disabled:opacity-50" disabled={txns.isFetchingNextPage} onClick={() => void txns.fetchNextPage()}>
                {txns.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </button>
            </div>
          ) : null}
        </div>
      )}

      {shown ? <TxnPanel key={openTxn} company={company} txn={shown} locked={locked} mayImport={mayImport} difference={m(r.difference)} agreed={agreed} onClose={() => setOpenTxn(null)} onGo={onGo} onChanged={refresh} /> : null}

      {asking === 'lock' ? (
        <ConfirmSheet
          title={`Lock ${shortDate(r.period_start)} – ${shortDate(r.period_end)}?`}
          body={`Nothing anywhere in the product will be able to record money into this account on or before ${shortDate(r.period_end)} — not an invoice, not a bill, not a payroll run. It can be reopened, with a reason.`}
          action="Agree and lock"
          busy={busy}
          onYes={() => void act(() => lockRec(company.id, recId), 'Reconciled and locked. Nothing can now be dated into this account up to that date.')}
          onClose={() => setAsking(null)}
        />
      ) : null}
      {asking === 'unlock' ? (
        <ReasonSheet
          title="Reopen this reconciliation?"
          body="The account will take entries into this period again, and the agreed figure stops being agreed. A later locked period holds this one shut — reopen that first. The reason is the only record of why."
          label="Why is this being reopened?"
          action="Reopen"
          danger
          busy={busy}
          onOk={(why) => void act(() => unlockRec(company.id, recId, why), 'Reopened. The account will take entries into that period again.')}
          onClose={() => setAsking(null)}
        />
      ) : null}
    </div>
  );
}

function Fig({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] text-ink-3">{label}</dt>
      <dd className="m-0 text-[14px] font-bold text-ink tabular-nums">{value}</dd>
      <dd className="m-0 text-[10.5px] text-ink-3">{sub}</dd>
    </div>
  );
}

function KindPill({ kind, children }: { kind: string; children: ReactNode }) {
  if (kind === 'payable') return <span className="inline-flex h-[20px] shrink-0 items-center rounded-[10px] bg-[#F1EAFB] px-2 text-[11px] font-bold whitespace-nowrap text-[#5B2FA0] dark:bg-[#2A1F45] dark:text-[#C4A8F0]">{children}</span>;
  return <Pill tone={kind === 'receivable' ? 'blue' : 'grey'}>{children}</Pill>;
}

/**
 * One statement line: what it is matched to, the scored suggestions with
 * their reasons in words, a full list to choose from, and parking. The reason
 * is shown with every suggestion because a reconciliation is an audit record:
 * a match nobody can reproduce the reasoning for fails at the moment it
 * matters. A choice whose amount differs says by how much — matching to a
 * different amount is a decision, not a detail.
 */
function TxnPanel({
  company,
  txn,
  locked,
  mayImport,
  difference,
  agreed,
  onClose,
  onGo,
  onChanged,
}: {
  company: Company;
  txn: Txn;
  locked: boolean;
  mayImport: boolean;
  difference: string;
  agreed: boolean;
  onClose: () => void;
  onGo: (view: FinanceView, extra?: string) => void;
  onChanged: () => void;
}) {
  const q = useQuery({ queryKey: BK.suggestions(company.id, txn.id), queryFn: ({ signal }) => fetchSuggestions(company.id, txn.id, signal), retry: false });
  const [browsing, setBrowsing] = useState(false);
  const [kind, setKind] = useState<'any' | Kind>('any');
  const [term, setTerm] = useState('');
  const [asked, setAsked] = useState('');
  const [parking, setParking] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setAsked(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);
  const choices = useQuery({
    queryKey: BK.choices(company.id, txn.id, kind, asked),
    queryFn: ({ signal }) => fetchChoices(company.id, txn.id, kind, asked, signal),
    enabled: browsing,
    retry: false,
    placeholderData: keepPreviousData,
  });
  const may = mayImport && !locked;
  const matches = q.data?.matches ?? [];
  const suggestions = q.data?.suggestions ?? [];

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast('success', done);
      setParking(false);
      onChanged();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  const journal = (id: number | undefined, no: string) =>
    id ? (
      <button type="button" className="font-mono text-[12px] font-semibold text-primary hover:underline" title="Open the journal" onClick={() => onGo('journals', `&open=${id}`)}>
        {no}
      </button>
    ) : (
      <span className="font-mono text-[12px] text-ink-2">{no}</span>
    );

  return (
    <SidePanel
      label="Statement line"
      width={620}
      onClose={onClose}
      head={
        <span className="flex min-w-0 flex-1 flex-col">
          <b className="truncate text-[14px] text-ink">{txn.description ?? 'Statement line'}</b>
          <span className="text-[12px] text-ink-3">
            {shortDate(txn.txn_date)}
            {txn.reference ? ` · Ref ${txn.reference}` : ''}
          </span>
        </span>
      }
    >
      <div className="flex items-center gap-3 rounded-[10px] bg-ground px-3.5 py-2.5">
        <span className={cx('text-[20px] font-bold tabular-nums', isNegative(txn.amount) ? 'text-danger' : 'text-[#166534] dark:text-success')}>{money(txn.amount)}</span>
        <Pill tone={TXN_TONE[txn.status] ?? 'grey'}>{TXN_LABEL[txn.status] ?? txn.status}</Pill>
        <span className="flex-1" />
        <span className="text-right text-[11.5px] text-ink-3">
          Difference now
          <b className={cx('block text-[13px] tabular-nums', agreed ? 'text-success' : 'text-[#9A4A06] dark:text-warning')}>{difference}</b>
        </span>
      </div>
      {txn.note ? <p className="m-0 text-[12.5px] text-ink-2">{txn.status === 'ignored' ? `Parked: ${txn.note}` : txn.note}</p> : null}
      {locked ? <Notice tone="grey">This period is locked. Reopen it to change what it covers.</Notice> : null}
      {q.isLoading ? <Spinner /> : null}
      {q.error ? <LoadFailed what="The ledger lines for this statement line" onRetry={() => void q.refetch()} /> : null}

      {matches.length ? (
        <div>
          <Caps>Matched to</Caps>
          <div className="mt-1 overflow-hidden rounded-[10px] border border-line">
            {matches.map((mt) => (
              <div key={mt.id} className="flex items-center gap-2 border-b border-line/60 px-3 py-2 text-[12.5px] last:border-b-0">
                <Icon name="link" size={13} className="shrink-0 text-success" />
                <span className="min-w-0 flex-1 truncate text-ink-2">
                  <span className="font-mono text-[12px]">{mt.journal_no}</span> · {shortDate(mt.entry_date)} · {mt.description ?? '—'}
                </span>
                <span className="text-ink-2 tabular-nums">{money(mt.amount)}</span>
                {mt.kind === 'auto' ? <Pill tone="grey">auto</Pill> : null}
                {may ? (
                  <button type="button" aria-label="Unmatch" title="Unmatch" disabled={busy} onClick={() => void run(() => unmatch(company.id, mt.id), 'Unmatched')} className="flex h-6 w-6 items-center justify-center rounded-full text-ink-3 hover:bg-subtle hover:text-danger disabled:opacity-50">
                    <Icon name="x" size={14} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!locked && q.data ? (
        <div>
          <Caps>Ledger lines that could be this</Caps>
          {suggestions.length === 0 ? (
            <p className="m-0 mt-1 text-[12.5px] text-ink-3">Nothing on this account is close enough in amount and date to suggest. Either the entry has not been recorded in the ledger yet, or this line needs parking with a reason.</p>
          ) : (
            <div className="mt-1 overflow-hidden rounded-[10px] border border-line">
              {suggestions.map((s) => {
                const st = strength(s.score);
                return (
                  <div key={s.journal_line_id} className="flex items-start gap-2 border-b border-line/60 px-3 py-2 text-[12.5px] last:border-b-0">
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <KindPill kind={s.kind}>{s.document}</KindPill>
                        {journal(s.journal_id, s.journal_no)}
                        <span className="truncate text-ink-2">
                          · {shortDate(s.entry_date)} · {s.description ?? '—'}
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center gap-1 text-[11.5px] text-ink-3">
                        <Pill tone={st.tone}>
                          {st.label} · {s.score}
                        </Pill>
                        {reasons(s.why).join(' · ')}
                      </span>
                    </span>
                    <span className="shrink-0 pt-0.5 text-ink-2 tabular-nums">{money(s.amount)}</span>
                    {may ? (
                      <button type="button" className={btnSmall} disabled={busy} onClick={() => void run(() => matchLine(company.id, txn.id, s.journal_line_id), 'Matched')}>
                        Match
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-2">
            <button type="button" className={btnSmall} onClick={() => setBrowsing((v) => !v)}>
              {browsing ? 'Hide the full list' : 'Choose one myself'}
            </button>
          </div>
          {browsing ? (
            <div className="mt-2 flex flex-col gap-2 rounded-[10px] border border-line p-2.5">
              <Seg label="Which side" value={kind} onChange={setKind} options={KINDS.map((k) => ({ id: k.id, label: k.label }))} />
              <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search the description, reference or journal number…" aria-label="Search the ledger lines" className={input} />
              {choices.isLoading ? (
                <Spinner />
              ) : choices.error ? (
                <p className="m-0 text-[12.5px] text-ink-3">The list could not be loaded.</p>
              ) : !(choices.data ?? []).length ? (
                <p className="m-0 text-[12.5px] text-ink-3">No unreconciled ledger line on this account moves money the same way within three months. If it was never recorded in the ledger, this line needs parking with a reason until it is.</p>
              ) : (
                <div className="max-h-[300px] overflow-y-auto rounded-[8px] border border-line scroll-thin">
                  {choices.data!.map((c) => (
                    <div key={c.journal_line_id} className="flex items-center gap-2 border-b border-line/60 px-2.5 py-1.5 text-[12.5px] last:border-b-0">
                      <KindPill kind={c.kind}>{c.document}</KindPill>
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        {journal(c.journal_id, c.journal_no)}
                        <span className="truncate text-ink-2">
                          · {shortDate(c.entry_date)} · {c.description ?? '—'}
                        </span>
                      </span>
                      <span className={cx('shrink-0 tabular-nums', c.exact ? 'font-semibold text-success' : 'text-ink-2')}>{money(c.amount)}</span>
                      {!c.exact ? <span className="shrink-0 text-[11px] text-[#9A4A06] dark:text-warning">off by {money(c.gap)}</span> : null}
                      {may ? (
                        <button type="button" className={btnSmall} disabled={busy} onClick={() => void run(() => matchLine(company.id, txn.id, c.journal_line_id), 'Matched')}>
                          Match
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {may && txn.status === 'unmatched' ? (
        <div>
          <button type="button" className={btn} disabled={busy} onClick={() => setParking(true)}>
            Park it instead…
          </button>
        </div>
      ) : null}
      {parking ? (
        <ReasonSheet
          title="Park this line"
          body="A reason is required. A line parked without one is indistinguishable, later, from one nobody looked at."
          label="Why does this line need no match?"
          action="Park it"
          busy={busy}
          onOk={(why) => void run(() => parkLine(company.id, txn.id, why), 'Parked, with the reason recorded')}
          onClose={() => setParking(false)}
        />
      ) : null}
    </SidePanel>
  );
}
