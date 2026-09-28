import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Field, input, PageHead, Sheet } from '../hr/parts';
import { Pill } from '../inventory/parts';
import { can, fetchCurrencies, K, refusal } from './api';
import { BK, fetchBankAccounts, setBankAccount, type BankAccount, type Candidate } from './banking';
import { ConfirmSheet, LoadFailed, Notice } from './parts';
import type { ScreenProps } from './Rail';
import Statement from './Statement';

/**
 * The company's bank accounts, and the accounts that could become one.
 *
 * A bank account is not a separate record: it is a chart account marked
 * reconcilable. Marking one is what lets a payment say which account the
 * money actually moved through — without it every payment lands on the one
 * account nominated for the bank role, and the ledger reconciles to no
 * statement anybody could print. So the candidates are listed beside the bank
 * accounts: an empty list with no way to fill it reads as a missing feature,
 * not as configuration nobody has done.
 *
 * A statement only means anything against one account, so it opens here, in
 * place of the list, rather than behind a rail item with its own picker.
 *
 * The nominated account has no Remove at all: every payment that names
 * nothing resolves to it, and unmarking it would leave the default pointing
 * at something the payment picker refuses.
 */
export default function Banks({ company, onGo }: ScreenProps) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const q = useQuery({ queryKey: BK.accounts(company.id), queryFn: ({ signal }) => fetchBankAccounts(company.id, signal), retry: false });
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ kind: 'add'; a: Candidate } | { kind: 'currency'; a: BankAccount } | null>(null);
  const [removing, setRemoving] = useState<BankAccount | null>(null);
  const [busy, setBusy] = useState(false);

  if (openId !== null) return <Statement key={openId} company={company} accountId={openId} onBack={() => setOpenId(null)} onGo={onGo} />;
  if (q.isLoading) return <Spinner />;
  if (q.error) return <LoadFailed what="The bank accounts" onRetry={() => void q.refetch()} />;

  const d = q.data!;
  const accounts = d.accounts ?? [];
  const candidates = d.candidates ?? [];
  const baseCode = d.base_currency ?? company.base_currency ?? '';
  const base = baseCode || 'the base currency';
  // The route filter decides; the envelope says what it will decide, so a button is not drawn only to be refused.
  const mayManage = can(perms, 'finance.accounts.manage') && d.can?.manage !== false;

  const save = async (id: BankAccount['id'], body: { is_reconcilable: 0 | 1; currency?: string }, done: string) => {
    setBusy(true);
    try {
      await setBankAccount(company.id, id, body);
      toast('success', done);
      setEditing(null);
      setRemoving(null);
      void qc.invalidateQueries({ queryKey: K.company(company.id) });
    } catch (e) {
      // As said: "already has 14 journal lines, so its currency cannot be changed" is the whole answer.
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Bank accounts" sub="Accounts in the chart that a bank statement exists for." />
      <p className="m-0 max-w-[76ch] text-[13px] leading-relaxed text-ink-2">
        Marking an account here is what lets a payment say which account the money actually moved through — without it every payment lands on the same account and the ledger reconciles to no statement. Open one to load the bank&rsquo;s own record of what happened.
      </p>

      {accounts.length === 0 ? (
        <Notice tone="amber">No account is marked as a bank account, so every payment will post to whichever account is nominated for the bank role. Pick one below.</Notice>
      ) : (
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <div className="flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
            <span className="min-w-0 flex-1">Account</span>
            <span className="w-[120px] shrink-0">Held in</span>
            <span className="w-[100px] shrink-0 text-right">Ledger lines</span>
            <span className="w-[280px] shrink-0" />
          </div>
          {accounts.map((a) => (
            <div key={a.id} className="flex items-center gap-2.5 border-b border-line/60 px-3.5 py-[9px] text-[13px] last:border-b-0">
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <Icon name="landmark" size={15} className="shrink-0 text-ink-3" />
                <span className="truncate text-ink">
                  <b className="font-mono text-[12px]">{a.code}</b> {a.name}
                </span>
                {a.is_default ? (
                  <span title="A payment that names no bank account uses this one" className="flex shrink-0">
                    <Pill tone="green">Default</Pill>
                  </span>
                ) : null}
              </span>
              <span className="w-[120px] shrink-0 text-ink-2">{a.currency ?? <span className="text-ink-3">{base}</span>}</span>
              <span className="w-[100px] shrink-0 text-right text-ink-2 tabular-nums">{Number(a.line_count) || 0}</span>
              <span className="flex w-[280px] shrink-0 justify-end gap-1.5">
                <button type="button" className={btnSmall} onClick={() => setOpenId(String(a.id))}>
                  Statement <Icon name="chevron-right" size={13} />
                </button>
                {mayManage ? (
                  <button type="button" className={btnSmall} disabled={busy} onClick={() => setEditing({ kind: 'currency', a })}>
                    Currency…
                  </button>
                ) : null}
                {mayManage && !a.is_default ? (
                  <button type="button" className={btnSmall} disabled={busy} onClick={() => setRemoving(a)}>
                    Remove…
                  </button>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      )}

      <section className="mt-2 flex flex-col gap-2">
        <div>
          <b className="text-[14px] text-ink">Other accounts you could use</b>
          <p className="m-0 text-[12px] text-ink-3">Active, postable asset accounts. A bank account is an asset even when it is overdrawn, so nothing else is offered here.</p>
        </div>
        {candidates.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-[12px] border border-dashed border-line px-4 py-5 text-center text-[12.5px] text-ink-3">
            Every asset account is already a bank account. Add one in the chart of accounts first.
            <button type="button" className={btnSmall} onClick={() => onGo('accounts')}>
              Chart of accounts
            </button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
            {candidates.map((c) => (
              <div key={c.id} className="flex items-center gap-2.5 border-b border-line/60 px-3.5 py-[7px] text-[13px] last:border-b-0">
                <span className="min-w-0 flex-1 truncate text-ink-2">
                  <b className="font-mono text-[12px] text-ink">{c.code}</b> {c.name}
                  {c.currency ? <span className="ml-1.5 text-[12px] text-ink-3">{c.currency}</span> : null}
                </span>
                {mayManage ? (
                  <button type="button" className={btnSmall} disabled={busy} onClick={() => setEditing({ kind: 'add', a: c })}>
                    Make it a bank account
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      {editing ? (
        <CurrencySheet
          key={`${editing.kind}-${editing.a.id}`}
          title={editing.kind === 'add' ? `Make ${editing.a.code} ${editing.a.name} a bank account` : `Currency for ${editing.a.code} ${editing.a.name}`}
          body={
            editing.kind === 'add' ? (
              <>Payments will be able to name this account, and it will appear on bank reconciliation. Leave the currency empty for {base}; set one only for an account actually held in another currency.</>
            ) : Number(editing.a.line_count) > 0 ? (
              <Notice tone="amber">
                This account already has {editing.a.line_count} journal line{Number(editing.a.line_count) === 1 ? '' : 's'}. Journal lines are stored in {base}, so the currency can no longer be changed — the server will refuse.
              </Notice>
            ) : (
              <>Empty means {base}. Set one only for an account actually held in another currency.</>
            )
          }
          action={editing.kind === 'add' ? 'Make it a bank account' : 'Save'}
          initial={editing.a.currency ?? ''}
          base={baseCode}
          busy={busy}
          onSave={(currency) =>
            void save(editing.a.id, { is_reconcilable: 1, currency }, editing.kind === 'add' ? `${editing.a.code} ${editing.a.name} is now a bank account and can be chosen on a payment.` : 'Currency updated.')
          }
          onClose={() => setEditing(null)}
        />
      ) : null}
      {removing ? (
        <ConfirmSheet
          title={`Stop treating ${removing.code} as a bank account?`}
          body={`Payments will no longer be able to name it, and it will drop off bank reconciliation. ${
            Number(removing.line_count) > 0 ? `It already carries ${removing.line_count} journal line${Number(removing.line_count) === 1 ? '' : 's'} — those stay exactly where they are.` : 'It carries no journal lines.'
          }`}
          action="Stop treating it as a bank account"
          busy={busy}
          onYes={() => void save(removing.id, { is_reconcilable: 0 }, `${removing.code} ${removing.name} is no longer a bank account.`)}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * The currency an account is held in, picked from the server's list. Empty
 * is the base currency, and it is offered as that rather than as its code so
 * nobody labels a base-currency account with the code and thinks it differs.
 */
const BASE = '*base';

function CurrencySheet({ title, body, action, initial, base, busy, onSave, onClose }: { title: string; body: ReactNode; action: string; initial: string; base: string; busy: boolean; onSave: (currency: string) => void; onClose: () => void }) {
  const cq = useQuery({ queryKey: K.currencies, queryFn: ({ signal }) => fetchCurrencies(signal), retry: false, staleTime: 3_600_000 });
  const [cur, setCur] = useState(initial === base ? '' : initial);
  const list = (cq.data ?? []).filter((c) => c.code !== base);
  if (cur && !list.some((c) => c.code === cur)) list.unshift({ code: cur, name: cur });
  const typed = !cq.isLoading && (cq.error || !cq.data?.length);
  const bad = cur.trim() !== '' && !/^[A-Za-z]{3}$/.test(cur.trim());
  return (
    <Sheet
      title={title}
      onClose={onClose}
      width={500}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || bad} onClick={() => onSave(cur.trim().toUpperCase())}>
            {busy ? 'Saving…' : action}
          </button>
        </>
      }
    >
      <div className="m-0 text-[13px] leading-[1.55] text-ink-2">{body}</div>
      <Field label="Currency" hint={bad ? <span className="text-danger">A currency is a three-letter code, such as LKR.</span> : `Empty means ${base || 'the base currency'}.`}>
        {typed ? (
          <input value={cur} onChange={(e) => setCur(e.target.value)} placeholder={base} maxLength={3} className={cx(input, 'font-mono uppercase', bad && '!border-danger')} />
        ) : (
          <Select
            aria-label="Currency"
            searchable
            value={cur || BASE}
            disabled={cq.isLoading}
            onChange={(e) => setCur(e.target.value === BASE ? '' : e.target.value)}
            className="h-[34px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px]"
          >
            <option value={BASE}>{base ? `${base} — the base currency` : 'The base currency'}</option>
            {list.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code === c.name ? c.code : `${c.code} — ${c.name}`}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </Sheet>
  );
}
