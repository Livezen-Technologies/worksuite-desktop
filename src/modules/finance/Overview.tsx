import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, Field, Sheet } from '../hr/parts';
import { fetchCurrencies, isNegative, isZero, K, longDate, money, MONTHS, openBooks, refusal, type Company, type Dashboard, type Owed } from './api';
import { Caps, GoRow, LoadFailed, Notice } from './parts';
import type { FinanceView } from './Rail';

/**
 * The Overview: the company's management accounts on one page.
 *
 * One figure has hero weight — the result for the year — and it is welded to
 * the sentence that says what it leaves out, each clause conditional on its
 * own data so none asserts something only accidentally true. "The ledger
 * balances" is the verdict line, not a green banner: the ledger refuses an
 * unbalanced journal, so balance is true by construction, and celebrating it
 * above real problems told nobody anything.
 *
 * Figures appear only with `finance.reports.view`; without it the page is the
 * counts, which is what the server sends.
 *
 * A company without books gets the form that opens them, which fixes the base
 * currency and the year's first month for good — so both are picked from what
 * the server will accept, never typed.
 */
export default function Overview({ company, data, onGo, onOpened }: { company: Company; data: UseQueryResult<Dashboard>; onGo: (v: FinanceView) => void; onOpened: () => void }) {
  if (!company.has_books) return <OpenBooks company={company} onOpened={onOpened} />;
  if (data.isLoading) return <Spinner />;
  if (data.error || !data.data) return <LoadFailed what="These figures" onRetry={() => void data.refetch()} />;

  const d = data.data;
  const figures = d.may_read_figures !== false;
  const cur = d.currency ?? company.base_currency ?? '';
  const m = (v?: string | null) => (v === null || v === undefined ? '—' : money(v, cur));

  // What is outstanding, from what the payload carries — a caller without figures gets a count from `unposted` alone.
  const outstanding: string[] = [];
  if (d.bank?.difference && !isZero(d.bank.difference)) outstanding.push('bank');
  if ((d.unposted_documents ?? 0) > 0) outstanding.push('documents');
  if ((d.unposted ?? 0) > 0) outstanding.push('journals');
  if (d.receivables?.tie_out && d.receivables.tie_out.agrees === false) outstanding.push('ar');
  if (d.payables?.tie_out && d.payables.tie_out.agrees === false) outstanding.push('ap');

  return (
    <div className="mx-auto flex max-w-[760px] flex-col px-6 py-7">
      <h1 className="m-0 text-[21px] font-bold text-ink">{company.name}</h1>
      <Caps className="mt-1">
        Management accounts · {cur}
        {d.as_of ? <> · as at {longDate(d.as_of)}</> : null}
      </Caps>

      <p className="mt-4 mb-0 border-t border-line pt-3 text-[13.5px] leading-relaxed text-ink-2">
        {d.balanced === false ? (
          <>
            <Icon name="warning" size={15} className="mr-1 inline text-danger" />
            <b className="text-danger">The ledger does not balance.</b> {figures && d.difference ? <>It is out by {m(d.difference)}. </> : null}
            Nothing below can be relied on until that is found.
          </>
        ) : outstanding.length > 0 ? (
          <>
            <Icon name="warning" size={15} className="mr-1 inline text-[#9A4A06] dark:text-warning" />
            <b className="text-[#9A4A06] dark:text-warning">The ledger balances, but not everything is in it.</b>{' '}
            {figures && d.total_debit ? <>{m(d.total_debit)} on each side, across {d.accounts_used} accounts. </> : null}
            {outstanding.length === 1 ? 'One thing below is outstanding.' : `${outstanding.length} things below are outstanding.`}
          </>
        ) : (
          <>
            <b className="text-ink">The ledger balances.</b> {figures && d.total_debit ? <>{m(d.total_debit)} on each side, across {d.accounts_used} accounts.</> : <>Across {d.accounts_used} accounts.</>}
          </>
        )}
      </p>

      {figures && d.year ? (
        <section className="mt-9">
          <Caps>Result for the year</Caps>
          <div className="text-[11.5px] text-ink-3">
            {d.year.name} · {longDate(d.year.starts_on)} to {longDate(d.year.ends_on)}
          </div>
          <div className={cx('mt-2.5 text-[34px] leading-none font-bold tracking-tight tabular-nums', isNegative(d.year.net) ? 'text-danger' : 'text-ink')}>{m(d.year.net)}</div>
          <Qualification d={d} />
          <dl className="mt-4 mb-0 flex flex-col gap-1.5 text-[13.5px]">
            <Row label="Revenue" value={m(d.year.revenue)} />
            <Row label="Cost of sales" value={m(d.year.cogs)} />
            <Row label="Gross profit" value={m(d.year.gross)} strong />
            <Row label="Expenses" value={m(d.year.expenses)} />
            <div className="flex items-baseline justify-between border-t-2 border-ink pt-1.5 font-bold text-ink">
              <dt>{isNegative(d.year.net) ? 'Net loss' : 'Net profit'}</dt>
              <dd className="m-0 tabular-nums">{m(d.year.net)}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {figures ? <BankSection d={d} cur={cur} onGo={onGo} /> : null}

      {figures && (d.receivables || d.payables) ? (
        <section className="mt-9 border-t border-line pt-5">
          <Caps>What is owed</Caps>
          <div className="mt-3 grid grid-cols-2 gap-6">
            {d.receivables ? <OwedBlock title="Owed to us" owed={d.receivables} cur={cur} onClick={() => onGo('receivables')} /> : null}
            {d.payables ? (
              <OwedBlock
                title="Owed by us"
                owed={d.payables}
                cur={cur}
                onClick={() => onGo('payables')}
                hideTie={isZero(d.payables.total)}
                note={isZero(d.payables.total) ? 'No supplier bills have ever been entered. This is not the same as owing nothing.' : undefined}
                warn={d.staff_payable && !isZero(d.staff_payable.total) ? `${money(d.staff_payable.total, cur)} is owed to staff in ${d.staff_payable.code} ${d.staff_payable.name}, and is not counted here.` : undefined}
              />
            ) : null}
          </div>
        </section>
      ) : null}

      <NotIncluded d={d} figures={figures} onGo={onGo} />
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cx('flex items-baseline justify-between', strong ? 'font-semibold text-ink' : 'text-ink-2')}>
      <dt>{label}</dt>
      <dd className="m-0 tabular-nums">{value}</dd>
    </div>
  );
}

/** What the headline figure leaves out, each clause conditional on its own data. */
function Qualification({ d }: { d: Dashboard }) {
  const parts: string[] = [];
  const docs = d.unposted_split?.documents ?? 0;
  if (docs > 0) parts.push(`leaves out ${docs} issued document${docs === 1 ? '' : 's'}`);
  if (isZero(d.year?.cogs)) parts.push('recognises nothing as cost of sales');
  if (d.bank?.no_ledger_payments_out) parts.push('includes no payment ever leaving the bank');
  if (!parts.length) return <p className="mt-2 mb-0 max-w-[62ch] text-[13px] text-ink-3">Everything issued is in the ledger, and the bank agrees with it.</p>;
  const sentence = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
  return <p className="mt-2 mb-0 max-w-[62ch] text-[13px] text-ink-3">This figure {sentence}.</p>;
}

function BankSection({ d, cur, onGo }: { d: Dashboard; cur: string; onGo: (v: FinanceView) => void }) {
  const b = d.bank;
  const m = (v?: string | null) => (v === null || v === undefined ? '—' : money(v, cur));
  if (!b || b.lines === 0) {
    return (
      <section className="mt-9 border-t border-line pt-5">
        <Caps>Cash and bank</Caps>
        <button type="button" onClick={() => onGo('banks')} className="mt-2 block text-left">
          <div className="text-[22px] font-bold text-ink tabular-nums">{m(b?.ledger ?? null)}</div>
          <p className="mt-1 mb-0 max-w-[62ch] text-[13px] text-ink-3">What the ledger says. No bank statement has been loaded, so there is nothing to compare it against.</p>
        </button>
      </section>
    );
  }
  // A bar of counts, never of money: widths need numbers, and figures stay the server's strings.
  const pct = b.lines > 0 ? Math.round((b.matched / b.lines) * 100) : 0;
  return (
    <section className="mt-9">
      <button type="button" onClick={() => onGo('reconcile')} className="block w-full rounded-[14px] border border-[#F5D48A] bg-[#FFF8E6] p-4 text-left dark:border-warning/40 dark:bg-warning-bg">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <b className="text-[13.5px] text-[#7A3B05] dark:text-warning">Bank against ledger</b>
          <span className="text-[11.5px] text-[#9A4A06] dark:text-warning">
            {b.first_seen} to {b.last_seen} · {b.lines} lines
          </span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-4">
          <Figure label="The bank says" value={m(b.closing)} sub={b.closing === null ? 'the statement carried no balance column' : `closing balance on ${b.last_seen}`} />
          <Figure label="The ledger says" value={m(b.ledger)} sub={`posted to ${b.last_seen}`} />
          <Figure label="Difference" value={m(b.difference)} danger={!isZero(b.difference)} sub={isZero(b.difference) ? 'they agree' : 'not explained by anything outstanding'} />
        </div>
        <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-[#F5D48A]/60 dark:bg-warning/20">
          <div className="bg-success" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 mb-0 text-[13px] text-[#7A3B05] dark:text-warning">
          <b>
            {b.unmatched} of {b.lines} statement lines are unmatched.
          </b>{' '}
          {b.in_open} money in, {money(b.in_value, cur)}. {b.out_open} money out, {money(b.out_value, cur)}
          {b.no_ledger_payments_out ? (
            <>
              {' '}
              — <b>and none of those {b.out_open} can ever match, because the bank account has no money going out of it in the ledger at all.</b>
            </>
          ) : (
            '.'
          )}
        </p>
        <p className="mt-2 mb-0 text-[11.5px] text-[#9A4A06] dark:text-warning">{b.locked_through ? `Reconciled through ${b.locked_through}.` : 'Nothing on this account has ever been reconciled.'}</p>
      </button>
    </section>
  );
}

function Figure({ label, value, sub, danger }: { label: string; value: string; sub?: string; danger?: boolean }) {
  return (
    <div>
      <div className="text-[11px] tracking-wide text-[#9A4A06] uppercase dark:text-warning">{label}</div>
      <div className={cx('mt-0.5 text-[17px] font-bold tabular-nums', danger ? 'text-danger' : 'text-ink')}>{value}</div>
      {sub ? <div className="text-[11.5px] text-[#9A4A06] dark:text-warning">{sub}</div> : null}
    </div>
  );
}

const BUCKETS: Array<[string, string, string]> = [
  ['current', 'Current', 'bg-ink-3'],
  ['d1_30', '1–30 days', 'bg-[#F2C14E]'],
  ['d31_60', '31–60 days', 'bg-[#E59A2F]'],
  ['d61_90', '61–90 days', 'bg-[#E26D5A]'],
  ['d90plus', 'Over 90 days', 'bg-danger'],
];

function OwedBlock({ title, owed, cur, onClick, hideTie, note, warn }: { title: string; owed: Owed; cur: string; onClick: () => void; hideTie?: boolean; note?: string; warn?: string }) {
  const b = owed.buckets;
  // Proportions only; the figures beside them stay strings.
  const sum = b ? BUCKETS.reduce((a, [k]) => a + Math.abs(Number(b[k] ?? 0)), 0) : 0;
  const old = b ? !isZero(b.d90plus) && !isNegative(b.d90plus) : false;
  const tie = hideTie ? null : owed.tie_out;
  return (
    <button type="button" onClick={onClick} className="block w-full text-left">
      <div className="text-[13px] text-ink-3">{title}</div>
      <div className="mt-0.5 text-[22px] font-bold text-ink tabular-nums">{money(owed.total, cur)}</div>
      {b && sum > 0 ? (
        <>
          <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-subtle">
            {BUCKETS.map(([k, label, tone]) => {
              const v = Math.abs(Number(b[k] ?? 0));
              return v === 0 ? null : <div key={k} className={tone} style={{ width: `${(v / sum) * 100}%` }} title={`${label}: ${money(b[k], cur)}`} />;
            })}
          </div>
          <div className={cx('mt-1 text-[11.5px]', old ? 'text-danger' : 'text-ink-3')}>{old ? `${money(b.d90plus, cur)} is over 90 days old` : 'Nothing is over 90 days old.'}</div>
        </>
      ) : null}
      {note ? <p className="mt-1 mb-0 max-w-[62ch] text-[11.5px] text-ink-3">{note}</p> : null}
      {warn ? <p className="mt-1 mb-0 max-w-[62ch] text-[11.5px] text-[#9A4A06] dark:text-warning">{warn}</p> : null}
      {tie && tie.agrees === false ? <p className="mt-1 mb-0 text-[11.5px] text-danger">This does not agree with its control account. One of the two is wrong.</p> : null}
      {tie && tie.agrees === true ? <p className="mt-1 mb-0 text-[11.5px] text-ink-3">Agrees with the control account.</p> : null}
    </button>
  );
}

function NotIncluded({ d, figures, onGo }: { d: Dashboard; figures: boolean; onGo: (v: FinanceView) => void }) {
  const rows: Array<{ label: string; sub: string; go: FinanceView }> = [];
  if (figures && (d.unposted_documents ?? 0) > 0) {
    const s = d.unposted_split;
    rows.push({
      label: `${d.unposted_documents} things issued but not in the ledger`,
      // The split matters: most of the count is often expense claims, and the answer for those is rarely "post it".
      sub: s ? `${s.documents} invoice${s.documents === 1 ? '' : 's'} or bill${s.documents === 1 ? '' : 's'}, and ${s.claims} expense claim${s.claims === 1 ? '' : 's'} — each with its own reason.` : 'Each carries the reason it has not posted.',
      go: 'unposted',
    });
  }
  if ((d.unposted ?? 0) > 0) {
    rows.push({
      label: `${d.unposted} journal${d.unposted === 1 ? '' : 's'} not yet posted`,
      sub: (d.awaiting_post ?? 0) > 0 ? `${d.awaiting_post} approved and waiting.` : 'Drafts and journals awaiting approval.',
      go: 'journals',
    });
  }
  if (!rows.length) return null;
  return (
    <section className="mt-9 overflow-hidden rounded-[14px] border border-line bg-surface">
      <Caps className="border-b border-line px-4 py-2.5">Not in the figures above</Caps>
      {rows.map((r) => (
        <GoRow key={r.go} title={r.label} sub={r.sub} onClick={() => onGo(r.go)} />
      ))}
    </section>
  );
}

// ── opening the books ────────────────────────────────────────────────────

/** The years books can sensibly be opened in: the last two, this one and the next. */
const years = () => Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - 2 + i);

function OpenBooks({ company, onOpened }: { company: Company; onOpened: () => void }) {
  const [asking, setAsking] = useState(false);
  return (
    <div className="mx-auto flex max-w-[760px] flex-col items-start gap-3 px-6 py-9">
      <h1 className="m-0 text-[21px] font-bold text-ink">{company.name}</h1>
      <p className="m-0 max-w-[62ch] text-[13.5px] text-ink-2">This company has no general ledger yet. Opening its books fixes the base currency and the financial year, and both are hard to change afterwards.</p>
      <button type="button" className={btnPrimary} onClick={() => setAsking(true)}>
        Open the books
      </button>
      {asking ? <OpenBooksSheet company={company} onClose={() => setAsking(false)} onOpened={onOpened} /> : null}
    </div>
  );
}

function OpenBooksSheet({ company, onClose, onOpened }: { company: Company; onClose: () => void; onOpened: () => void }) {
  const qc = useQueryClient();
  const cur = useQuery({ queryKey: K.currencies, queryFn: ({ signal }) => fetchCurrencies(signal), retry: false, staleTime: 3_600_000 });
  const offered = cur.data ?? [];
  const [currency, setCurrency] = useState('');
  const [month, setMonth] = useState('1');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [busy, setBusy] = useState(false);
  const chosen = currency || (offered.some((c) => c.code === 'LKR') ? 'LKR' : (offered[0]?.code ?? ''));
  const open = async () => {
    setBusy(true);
    try {
      const r = await openBooks(company.id, { base_currency: chosen, fiscal_year_start_month: Number(month), first_year: Number(year) });
      toast('success', r?.message ?? 'The books are open.');
      void qc.invalidateQueries({ queryKey: K.company(company.id) });
      onOpened();
      onClose();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={`Open the books for ${company.name}`}
      onClose={onClose}
      width={500}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !chosen} onClick={() => void open()}>
            {busy ? 'Opening…' : 'Open the books'}
          </button>
        </>
      }
    >
      <Notice tone="amber">
        This happens once. The base currency fixes what every figure in this company is denominated in, and the first month of the financial year fixes which period each entry falls into. Neither can be changed afterwards without rewriting history, so check both with whoever prepares the accounts before going on.
      </Notice>
      {cur.isLoading ? <Spinner /> : null}
      <Field label="Base currency">
        <Select aria-label="Base currency" searchable value={chosen} onChange={(e) => setCurrency(e.target.value)} className="h-[34px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px]">
          {offered.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Financial year starts in" hint="April, for a year running April to March.">
        <Select aria-label="First month of the financial year" value={month} onChange={(e) => setMonth(e.target.value)} className="h-[34px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px]">
          {MONTHS.map((mo, i) => (
            <option key={mo} value={String(i + 1)}>
              {mo}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="First year to open">
        <Select aria-label="First year to open" value={year} onChange={(e) => setYear(e.target.value)} className="h-[34px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px]">
          {years().map((y) => (
            <option key={y} value={String(y)}>
              {y}
            </option>
          ))}
        </Select>
      </Field>
    </Sheet>
  );
}
