import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Field, input, PageHead, Sheet } from '../hr/parts';
import { Pill } from '../inventory/parts';
import { can, isZero, K, money, problemsOf, shortDate, type Company } from './api';
import { BK, fetchBankAccounts, fetchRecs, fetchStatements, lastMonth, openRec, periodProblems, provedStatement, type BankAccount, type Batch } from './banking';
import { LoadFailed, Notice } from './parts';
import type { ScreenProps } from './Rail';
import ReconcileWorkspace from './ReconcileWorkspace';

/**
 * Reconciliation: the bank accounts, one account's periods, and — in place —
 * the workspace for one period.
 *
 * "LOCKED THROUGH" IS THE FACT THIS SCREEN EXISTS TO SHOW. A locked period
 * stops anything being dated into the account on or before its closing date —
 * in Billing, Purchase, Payroll, everywhere, not only in Finance. So the date
 * is the first thing on each account's row, and on the account it is stated
 * as a consequence: somebody reading it is about to be refused in another
 * module, and should know why before that happens rather than read the
 * refusal as a bug.
 */
export default function Reconcile({ company, onGo }: ScreenProps) {
  const q = useQuery({ queryKey: BK.accounts(company.id), queryFn: ({ signal }) => fetchBankAccounts(company.id, signal), retry: false });
  const [accountId, setAccountId] = useState<string | null>(null);
  const [recId, setRecId] = useState<string | null>(null);

  if (q.isLoading) return <Spinner />;
  if (q.error) return <LoadFailed what="The bank accounts" onRetry={() => void q.refetch()} />;
  const list = q.data?.accounts ?? [];
  const account = accountId === null ? null : (list.find((a) => String(a.id) === accountId) ?? null);

  if (accountId !== null && recId !== null) {
    return <ReconcileWorkspace key={recId} company={company} account={account} accountId={accountId} recId={recId} onBack={() => setRecId(null)} onGo={onGo} />;
  }
  if (accountId !== null) {
    return <AccountPeriods key={accountId} company={company} account={account} accountId={accountId} onBack={() => setAccountId(null)} onOpen={(id) => setRecId(id)} />;
  }

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Reconciliation" sub="Agreeing what the ledger says with what the bank says." />
      <p className="m-0 max-w-[76ch] text-[13px] leading-relaxed text-ink-2">
        Matching a statement line to a ledger line writes no journal — the journal already exists, which is the whole point of the comparison. When a period agrees it is locked, and the account is frozen through its closing date everywhere in the product.
      </p>
      {list.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-[12px] border border-dashed border-line px-4 py-6 text-center text-[12.5px] text-ink-3">
          No account is marked as a bank account yet. Mark one in Bank accounts first.
          <button type="button" className={btnSmall} onClick={() => onGo('banks')}>
            Bank accounts
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
          {list.map((a) => (
            <AccountRow key={a.id} company={company} account={a} onOpen={() => setAccountId(String(a.id))} />
          ))}
        </div>
      )}
    </div>
  );
}

/** One account, with the date it is frozen through, read from the server. */
function AccountRow({ company, account, onOpen }: { company: Company; account: BankAccount; onOpen: () => void }) {
  const q = useQuery({ queryKey: BK.recs(company.id, account.id), queryFn: ({ signal }) => fetchRecs(company.id, account.id, signal), retry: false });
  const through = q.data?.locked_through ?? null;
  const open = (q.data?.reconciliations ?? []).filter((r) => r.status === 'open').length;
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 border-b border-line/60 px-4 py-3 text-left last:border-b-0 hover:bg-subtle">
      <Icon name="landmark" size={17} className="shrink-0 text-ink-3" />
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="truncate text-[13px] text-ink">
          <span className="font-mono text-[12px]">{account.code}</span> {account.name}
        </b>
        <span className="text-[11.5px] text-ink-3">
          {q.isLoading ? ' ' : q.error ? 'Its reconciliations could not be loaded.' : through ? (
            <>
              Agreed with the bank and frozen through <b className="text-ink-2 tabular-nums">{shortDate(through)}</b>
            </>
          ) : (
            'Never reconciled'
          )}
          {open > 0 ? ` · ${open} period${open === 1 ? '' : 's'} in progress` : ''}
        </span>
      </span>
      {through ? (
        <Pill tone="green">
          <Icon name="lock" size={11} className="mr-1" /> {shortDate(through)}
        </Pill>
      ) : null}
      <Icon name="chevron-right" size={15} className="shrink-0 text-ink-3" />
    </button>
  );
}

function AccountPeriods({ company, account, accountId, onBack, onOpen }: { company: Company; account: BankAccount | null; accountId: string; onBack: () => void; onOpen: (id: string) => void }) {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const mayImport = can(perms, 'finance.bank.import');
  const q = useQuery({ queryKey: BK.recs(company.id, accountId), queryFn: ({ signal }) => fetchRecs(company.id, accountId, signal), retry: false });
  // Read for their closing balances: re-typing one off a PDF is how a period gets measured against a typo.
  const stmts = useQuery({ queryKey: BK.statements(company.id, accountId), queryFn: ({ signal }) => fetchStatements(company.id, accountId, signal), retry: false });
  const [starting, setStarting] = useState(false);
  const cur = account?.currency ?? company.base_currency ?? '';

  const back = (
    <div>
      <button type="button" className={btnSmall} onClick={onBack}>
        <Icon name="chevron-left" size={13} /> Reconciliation
      </button>
    </div>
  );
  if (q.isLoading) return <Spinner />;
  if (q.error) {
    return (
      <div className="flex flex-col gap-3 px-6 py-5">
        {back}
        <LoadFailed what="This account's reconciliations" onRetry={() => void q.refetch()} />
      </div>
    );
  }
  const rows = q.data?.reconciliations ?? [];
  const through = q.data?.locked_through ?? null;

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      {back}
      <PageHead
        title={
          account ? (
            <>
              <span className="font-mono">{account.code}</span> {account.name}
            </>
          ) : (
            'Bank account'
          )
        }
        sub={through ? undefined : 'This account has never been reconciled.'}
      >
        {mayImport ? (
          <button type="button" className={btnPrimary} disabled={stmts.isLoading} onClick={() => setStarting(true)}>
            <Icon name="plus" size={14} /> Reconcile a period
          </button>
        ) : null}
      </PageHead>
      {through ? (
        <Notice tone="amber">
          Agreed with the bank through <b className="tabular-nums">{shortDate(through)}</b>. Nothing anywhere in the product can now be dated into this account on or before that — not an invoice, not a bill, not a payroll run. Reopen the period below if something genuinely belongs there.
        </Notice>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-[12px] border border-dashed border-line px-4 py-6 text-center text-[12.5px] text-ink-3">No period has been reconciled on this account.</div>
      ) : (
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <div className="flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
            <span className="min-w-0 flex-1">Period</span>
            <span className="w-[140px] shrink-0 text-right">Bank says</span>
            <span className="w-[140px] shrink-0 text-right">Ledger says</span>
            <span className="w-[130px] shrink-0 text-right">Difference</span>
            <span className="w-[150px] shrink-0">State</span>
            <span className="w-[20px] shrink-0" />
          </div>
          {rows.map((r) => {
            const locked = r.status === 'locked';
            // An open period's figures are worked out live when it is opened, so the list has none to show.
            const live = locked ? undefined : 'Worked out when the period is opened';
            return (
              <button key={r.id} type="button" onClick={() => onOpen(String(r.id))} className="flex w-full items-center gap-2.5 border-b border-line/60 px-3.5 py-[9px] text-left text-[13px] last:border-b-0 hover:bg-subtle">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-ink tabular-nums">
                    {shortDate(r.period_start)} – {shortDate(r.period_end)}
                  </span>
                  {r.note ? (
                    <span className="truncate text-[11.5px] text-ink-3" title={r.note}>
                      {locked ? r.note : `Reopened: ${r.note}`}
                    </span>
                  ) : null}
                </span>
                <span className="w-[140px] shrink-0 text-right text-ink-2 tabular-nums">{money(r.statement_closing, cur)}</span>
                <span className="w-[140px] shrink-0 text-right text-ink-2 tabular-nums" title={live}>
                  {r.ledger_balance === null ? <span className="text-ink-3">—</span> : money(r.ledger_balance, cur)}
                </span>
                <span className={cx('w-[130px] shrink-0 text-right tabular-nums', r.difference !== null && !isZero(r.difference) ? 'font-semibold text-danger' : 'text-ink-3')} title={live}>
                  {r.difference === null ? '—' : money(r.difference, cur)}
                </span>
                <span className="flex w-[150px] shrink-0 flex-col">
                  {locked ? <Pill tone="green">Locked</Pill> : <Pill tone="amber">In progress</Pill>}
                  {locked && (r.locked_by_name || r.locked_at) ? (
                    <span className="mt-0.5 truncate text-[11px] text-ink-3">
                      {[r.locked_by_name, r.locked_at ? shortDate(r.locked_at) : ''].filter(Boolean).join(', ')}
                    </span>
                  ) : null}
                </span>
                <Icon name="chevron-right" size={15} className="w-[20px] shrink-0 text-ink-3" />
              </button>
            );
          })}
        </div>
      )}
      <p className="m-0 flex max-w-[76ch] items-start gap-1.5 text-[12px] text-ink-3">
        <Icon name="weight" size={14} className="mt-px shrink-0" />
        <span>A period only locks when the difference is nil and every statement line up to its end is either matched or parked with a reason. Locking against an unexplained figure would freeze the account against a number nobody understands.</span>
      </p>
      {starting ? <OpenPeriod company={company} accountId={accountId} statements={stmts.data ?? []} onClose={() => setStarting(false)} onOpened={onOpen} /> : null}
    </div>
  );
}

/**
 * Opening a period: its dates and the bank's closing balance — the external
 * authority the whole comparison is measured against. Prefilled from the
 * latest statement whose closing balance the importer could prove; otherwise
 * last month, and the figure is copied off the statement by hand.
 */
function OpenPeriod({ company, accountId, statements, onClose, onOpened }: { company: Company; accountId: string; statements: Batch[]; onClose: () => void; onOpened: (id: string) => void }) {
  const qc = useQueryClient();
  const [today] = useState(() => todayInZone());
  const [from] = useState(() => provedStatement(statements));
  const [f, setF] = useState(() => {
    const lm = lastMonth(today);
    return { start: from?.period_start ?? lm.start, end: from?.period_end ?? lm.end, closing: from?.closing_balance ?? '' };
  });
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string[]>([]);
  const problems = periodProblems(f, today);

  const save = async () => {
    setBusy(true);
    setSaid([]);
    try {
      const r = await openRec(company.id, accountId, { period_start: f.start, period_end: f.end, statement_closing: f.closing.trim().replace(/,/g, '') });
      toast('success', 'Reconciliation opened');
      void qc.invalidateQueries({ queryKey: K.company(company.id) });
      onClose();
      if (r?.id) onOpened(String(r.id));
    } catch (e) {
      setSaid(problemsOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Reconcile a period"
      onClose={onClose}
      width={520}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || problems.length > 0} onClick={() => void save()}>
            {busy ? 'Opening…' : 'Open the period'}
          </button>
        </>
      }
    >
      <p className="m-0 text-[13px] leading-[1.55] text-ink-2">
        {from
          ? `Taken from ${from.filename}, which covers ${shortDate(from.period_start)} to ${shortDate(from.period_end)}. Check it against the statement before you go on — this figure is the external authority the whole comparison is measured against.`
          : 'The closing balance is what the bank says the account held on the last day — copy it off the statement. It is the external authority this whole comparison is measured against, so there is nowhere else it can come from.'}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From">
          <input type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} className={input} />
        </Field>
        <Field label="To" hint="Not in the future: there is no statement for it yet.">
          <input type="date" value={f.end} max={today} onChange={(e) => setF({ ...f, end: e.target.value })} className={input} />
        </Field>
      </div>
      <Field label="Closing balance on the bank's statement" hint="A minus sign if the account was overdrawn. Enter 0.00 only if it really held nothing.">
        <input aria-label="Closing balance on the bank's statement" inputMode="decimal" value={f.closing} onChange={(e) => setF({ ...f, closing: e.target.value })} placeholder="0.00" className={cx(input, 'text-right tabular-nums')} />
      </Field>
      {said.length || problems.length ? (
        <Notice tone={said.length ? 'red' : 'amber'}>
          {said.length ? (
            <>
              <b>The server refused it:</b> {said.join(' ')}
            </>
          ) : (
            problems[0]
          )}
        </Notice>
      ) : null}
    </Sheet>
  );
}
