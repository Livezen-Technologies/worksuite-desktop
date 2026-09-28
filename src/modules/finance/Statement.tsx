import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { ApiError } from '../../core/api';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, PageHead, Seg } from '../hr/parts';
import { Pill } from '../inventory/parts';
import { can, isNegative, K, money, refusal, shortDate, type Company } from './api';
import {
  batchLine,
  BK,
  fetchStatements,
  fetchTxns,
  importRefusal,
  importStatement,
  importSummary,
  parkLine,
  PER_PAGE,
  tooBig,
  TXN_LABEL,
  TXN_TONE,
  type Txn,
} from './banking';
import { LoadFailed, Notice, ReasonSheet } from './parts';
import type { FinanceView } from './Rail';

/**
 * One bank account's statement: what the bank says happened, beside the
 * ledger rather than in it. Nothing here posts. A line stays "not matched"
 * until reconciliation says otherwise, and saying so is more honest than
 * implying the ledger has absorbed it.
 *
 * The counts after an import are the whole feedback loop — loaded, already on
 * file, could not be read — and they stay on screen rather than in a toast.
 * "Already on file" is the one people need: re-downloading an overlapping
 * month is the normal way to use a bank's export, and a zero there would mean
 * the duplicate guard was not working. The same goes for problems on a
 * SUCCESSFUL import: a file can load every line and still have had its
 * balances discarded, and that is the case that most needs explaining.
 *
 * Parking takes a reason, singly or for a selection: a line parked without
 * one is indistinguishable, later, from one nobody looked at.
 */
type Filter = '' | 'unmatched' | 'matched' | 'ignored' | 'explained';

interface Said {
  tone: 'green' | 'amber' | 'red';
  what: string;
  title: string;
  lines: string[];
}

export default function Statement({ company, accountId, onBack, onGo }: { company: Company; accountId: string; onBack: () => void; onGo: (view: FinanceView, extra?: string) => void }) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const mayImport = can(perms, 'finance.bank.import');
  const [status, setStatus] = useState<Filter>('');
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Said | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [parking, setParking] = useState<Txn[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // The heading is its own read: a failed first page blanks the screen, a failed fifth page does not.
  const head = useQuery({ queryKey: BK.head(company.id, accountId), queryFn: ({ signal }) => fetchTxns(company.id, accountId, { per_page: 1 }, signal), retry: false });
  const list = useInfiniteQuery({
    queryKey: BK.txns(company.id, accountId, { status }),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => fetchTxns(company.id, accountId, { status: status || undefined, page: pageParam }, signal),
    // A short page ends the list, so a total that drifted never leaves a button that fetches nothing.
    getNextPageParam: (last, pages) => (last.transactions.length < PER_PAGE || pages.length * PER_PAGE >= Number(last.total) ? undefined : pages.length + 1),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const batches = useQuery({ queryKey: BK.statements(company.id, accountId), queryFn: ({ signal }) => fetchStatements(company.id, accountId, signal), retry: false });
  const rows = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.transactions ?? []), [list.data]);

  const refresh = () => void qc.invalidateQueries({ queryKey: K.company(company.id) });

  const load = async (what: { file: File } | { text: string }, label: string) => {
    setBusy(true);
    setSaid(null);
    try {
      const r = await importStatement(company.id, accountId, what);
      const problems = r?.problems ?? [];
      const summary = importSummary(r);
      setSaid({ tone: problems.length ? 'amber' : 'green', what: label, title: summary, lines: problems });
      toast(problems.length ? 'warning' : 'success', summary);
      if ('text' in what) {
        setPasted('');
        setPasting(false);
      }
      refresh();
    } catch (e) {
      // "This exact file was already loaded on 14 May" says what to do; "upload failed" would not.
      const { message, problems } = importRefusal(e);
      setSaid({ tone: 'red', what: label, title: message, lines: problems });
      toast('error', message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const chosen = (f: File) => {
    if (tooBig(f)) {
      setSaid({ tone: 'red', what: f.name, title: 'That file is larger than 8 MB, so it was not sent.', lines: ['A statement a bank exports is far smaller. Check it is the right file, or split it by month.'] });
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    void load({ file: f }, f.name);
  };

  const park = async (lines: Txn[], why: string) => {
    setBusy(true);
    let done = 0;
    const refused: string[] = [];
    // Counted rather than stopping at the first refusal: halfway leaves somebody guessing which of forty went through.
    for (const t of lines) {
      try {
        await parkLine(company.id, t.id, why);
        done++;
      } catch (e) {
        refused.push(refusal(e));
      }
    }
    setBusy(false);
    setParking(null);
    setPicked(new Set());
    if (refused.length === 0) toast('success', lines.length === 1 ? 'Parked, with the reason recorded' : `${done} lines parked, with the reason recorded.`);
    else toast('error', lines.length === 1 ? refused[0]! : `${done} parked. ${refused.length} refused — ${refused[0]}`);
    refresh();
  };

  if (head.isLoading) return <Spinner />;
  if (head.error) {
    const said404 = head.error instanceof ApiError && head.error.status === 404;
    return (
      <div className="flex flex-col items-start gap-3 px-6 py-5">
        <button type="button" className={btnSmall} onClick={onBack}>
          <Icon name="chevron-left" size={13} /> Bank accounts
        </button>
        {said404 ? <Notice tone="red">{refusal(head.error)}</Notice> : <LoadFailed what="That account" onRetry={() => void head.refetch()} />}
      </div>
    );
  }

  const acc = head.data!.account;
  const held = acc.currency ?? company.base_currency ?? '';
  const total = Number(list.data?.pages[0]?.total ?? 0);
  const open = rows.filter((t) => t.status === 'unmatched');
  const selected = rows.filter((t) => picked.has(String(t.id)));
  const allPicked = open.length > 0 && open.every((t) => picked.has(String(t.id)));
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <div>
        <button type="button" className={btnSmall} onClick={onBack}>
          <Icon name="chevron-left" size={13} /> Bank accounts
        </button>
      </div>
      <PageHead
        title={
          <>
            <span className="font-mono">{acc.code}</span> {acc.name}
          </>
        }
        sub={`What the bank says happened${held ? `, in ${held}` : ''}. Nothing here is posted — these rows sit beside the ledger so the two can be compared.`}
      >
        <button type="button" className={btn} onClick={() => onGo('reconcile')}>
          <Icon name="check-check" size={14} /> Reconcile
        </button>
        {mayImport ? (
          <>
            <button type="button" className={btn} disabled={busy} onClick={() => setPasting((v) => !v)}>
              {pasting ? 'Cancel paste' : 'Paste rows'}
            </button>
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => fileRef.current?.click()}>
              <Icon name="upload" size={14} /> {busy ? 'Loading…' : 'Load a statement'}
            </button>
          </>
        ) : null}
      </PageHead>
      {/* In the DOM so it can be clicked; never shown. */}
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.txt,.html,.htm"
        aria-label="Statement file"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) chosen(f);
        }}
      />
      {mayImport ? <p className="m-0 -mt-1.5 text-[12px] text-ink-3">A CSV or text export, or the bank&rsquo;s page saved as HTML — up to 8 MB and 5,000 rows. Columns are found by their names, so the order does not matter.</p> : null}

      {said ? (
        <Notice tone={said.tone}>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <b>{said.what}:</b> {said.title}
              {said.lines.length ? (
                <ul className="mt-1 mb-0 pl-4">
                  {said.lines.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            <button type="button" aria-label="Dismiss" onClick={() => setSaid(null)} className="shrink-0 opacity-70 hover:opacity-100">
              <Icon name="x" size={14} />
            </button>
          </div>
        </Notice>
      ) : null}

      {pasting && mayImport ? (
        <section className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface px-4 py-3">
          <label htmlFor="statement-rows" className="text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
            Statement rows
          </label>
          <p className="m-0 text-[12px] text-ink-3">Copy them out of the bank&rsquo;s page, header row included. Commas, semicolons and tabs all work. Nothing is posted — these are the bank&rsquo;s records, held beside the ledger so the two can be compared.</p>
          <textarea
            id="statement-rows"
            autoFocus
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={9}
            spellCheck={false}
            placeholder={'Date;Particulars;Withdrawal;Deposit;Balance\n01/05/2026;SALARY;;150,000.00;150,000.00'}
            className="resize-y rounded-[8px] border border-line bg-surface px-2.5 py-2 font-mono text-[12px] text-ink outline-none focus:border-primary"
          />
          <div className="flex justify-end">
            <button type="button" className={btnPrimary} disabled={busy || !pasted.trim()} onClick={() => void load({ text: pasted }, 'Pasted rows')}>
              {busy ? 'Loading…' : 'Load these rows'}
            </button>
          </div>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Seg
          label="Show"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPicked(new Set());
          }}
          options={[
            { id: '', label: 'Every line' },
            { id: 'unmatched', label: 'Not matched' },
            { id: 'matched', label: 'Matched' },
            { id: 'ignored', label: 'Parked' },
            { id: 'explained', label: 'Explained' },
          ]}
        />
        <span className="flex-1" />
        {mayImport && selected.length ? (
          <button type="button" className={btnSmall} disabled={busy} onClick={() => setParking(selected)}>
            Park {selected.length} with a reason…
          </button>
        ) : null}
      </div>

      {list.error && !rows.length ? (
        <LoadFailed what="The statement lines" onRetry={() => void list.refetch()} />
      ) : (
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <div className="flex items-center gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
            {mayImport ? (
              <span className="flex w-[18px] shrink-0">
                <input
                  type="checkbox"
                  aria-label="Choose every unmatched line shown"
                  disabled={!open.length}
                  checked={allPicked}
                  onChange={() => setPicked(allPicked ? new Set() : new Set(open.map((t) => String(t.id))))}
                  className="h-3.5 w-3.5 accent-[var(--color-primary)]"
                />
              </span>
            ) : null}
            <span className="w-[96px] shrink-0">Date</span>
            <span className="min-w-0 flex-1">Description</span>
            <span className="w-[130px] shrink-0 text-right">Amount</span>
            <span className="w-[130px] shrink-0 text-right">Balance</span>
            <span className="w-[100px] shrink-0">State</span>
            {mayImport ? <span className="w-[56px] shrink-0" /> : null}
          </div>
          {list.isLoading ? <Spinner /> : null}
          {rows.map((t) => {
            const id = String(t.id);
            const unmatched = t.status === 'unmatched';
            return (
              <div key={id} className={cx('flex items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-[13px] last:border-b-0', picked.has(id) && 'bg-selection')}>
                {mayImport ? (
                  <span className="flex w-[18px] shrink-0">
                    {unmatched ? <input type="checkbox" aria-label={`Choose the line of ${shortDate(t.txn_date)}`} checked={picked.has(id)} onChange={() => toggle(id)} className="h-3.5 w-3.5 accent-[var(--color-primary)]" /> : null}
                  </span>
                ) : null}
                <span className="w-[96px] shrink-0 text-ink-2 tabular-nums">{shortDate(t.txn_date)}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-ink">{t.description ?? <span className="text-ink-3">No description</span>}</span>
                  {t.reference || t.counterparty ? <span className="truncate text-[11.5px] text-ink-3">{[t.counterparty, t.reference ? `Ref ${t.reference}` : ''].filter(Boolean).join(' · ')}</span> : null}
                  {t.note ? <span className="truncate text-[11.5px] text-ink-3" title={t.note}>{t.status === 'ignored' ? `Parked: ${t.note}` : t.note}</span> : null}
                </span>
                <span className={cx('w-[130px] shrink-0 text-right font-semibold whitespace-nowrap tabular-nums', isNegative(t.amount) ? 'text-danger' : 'text-[#166534] dark:text-success')}>{money(t.amount)}</span>
                <span className="w-[130px] shrink-0 text-right whitespace-nowrap text-ink-3 tabular-nums">{t.running_balance === null ? '—' : money(t.running_balance)}</span>
                <span className="w-[100px] shrink-0">
                  <Pill tone={TXN_TONE[t.status] ?? 'grey'}>{TXN_LABEL[t.status] ?? t.status}</Pill>
                </span>
                {mayImport ? (
                  <span className="flex w-[56px] shrink-0 justify-end">
                    {unmatched ? (
                      <button type="button" disabled={busy} onClick={() => setParking([t])} className="rounded-[6px] px-2 py-1 text-[12px] font-semibold text-primary hover:bg-selection disabled:opacity-50">
                        Park
                      </button>
                    ) : null}
                  </span>
                ) : null}
              </div>
            );
          })}
          {!list.isLoading && !rows.length ? <div className="px-3.5 py-8 text-center text-[12.5px] text-ink-3">{status ? 'No line on this account is in that state.' : 'No statement has been loaded for this account yet.'}</div> : null}
          {rows.length ? (
            <div className="flex items-center gap-2 border-t border-line bg-ground px-3.5 py-2 text-[12px] text-ink-3">
              <span className="flex-1">
                {rows.length < total ? `${rows.length.toLocaleString()} of ${total.toLocaleString()} lines` : `${total.toLocaleString()} ${total === 1 ? 'line' : 'lines'}`}
              </span>
              {list.hasNextPage ? (
                <button type="button" className="font-semibold text-primary hover:underline disabled:opacity-50" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                  {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      <section className="mt-2 flex flex-col gap-2">
        <b className="text-[14px] text-ink">Statements loaded</b>
        {batches.error ? (
          <p className="m-0 text-[12.5px] text-ink-3">The import history could not be loaded.</p>
        ) : !(batches.data ?? []).length ? (
          <p className="m-0 text-[12.5px] text-ink-3">{batches.isLoading ? ' ' : 'Nothing has been loaded for this account.'}</p>
        ) : (
          <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
            {batches.data!.map((b) => (
              <div key={b.id} className="flex flex-col gap-1 border-b border-line/60 px-3.5 py-2.5 text-[13px] last:border-b-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Icon name="file-text" size={14} className="shrink-0 text-ink-3" />
                  <b className="min-w-0 flex-1 truncate text-ink">{b.filename}</b>
                  <span className="text-[12px] text-ink-3 tabular-nums">
                    {b.period_start ? `${shortDate(b.period_start)} – ${shortDate(b.period_end)} · ` : ''}
                    {batchLine(b)}
                  </span>
                </div>
                <span className="pl-[22px] text-[11.5px] text-ink-3">
                  {b.closing_balance !== null && b.closing_balance !== '' ? `Closing balance ${money(b.closing_balance, held)}, proved from the balance column.` : 'No closing balance recorded — enter it from the statement when you reconcile.'}
                  {b.imported_by_name ? ` Loaded by ${b.imported_by_name}` : ' Loaded'}
                  {b.created_at ? ` on ${shortDate(b.created_at)}.` : '.'}
                </span>
                {/* Rejections are kept and shown: a statement comes up short by exactly the lines nobody saw. */}
                {b.notes ? (
                  <Notice tone="amber" className="ml-[22px] whitespace-pre-wrap">
                    {b.notes}
                  </Notice>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      {parking ? (
        <ReasonSheet
          title={parking.length === 1 ? 'Park this line' : `Park ${parking.length} lines`}
          body={
            parking.length === 1
              ? 'A reason is required. A line parked without one is indistinguishable, later, from one nobody looked at — and that difference is the whole value of parking it.'
              : 'One reason, recorded against every line chosen. A line parked without one is indistinguishable, later, from one nobody looked at.'
          }
          label={parking.length === 1 ? 'Why does this line need no match?' : 'Why do these need no match?'}
          action={parking.length === 1 ? 'Park it' : `Park ${parking.length}`}
          busy={busy}
          onOk={(why) => void park(parking, why)}
          onClose={() => setParking(null)}
        />
      ) : null}
    </div>
  );
}
