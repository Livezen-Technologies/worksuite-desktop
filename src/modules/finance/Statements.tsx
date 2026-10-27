import { useQuery } from '@tanstack/react-query';
import { Fragment, useState, type ReactNode } from 'react';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Spinner, cx } from '../../components/ui';
import { btn, btnSmall, Field, input, PageHead } from '../../components/PageKit';
import { can, isNegative, longDate, money, shortDate, type Company } from './api';
import { Notice } from '../../components/RecordKit';
import type { ScreenProps } from './Rail';
import {
  backwards,
  csvName,
  fetchBalanceSheet,
  fetchProfitAndLoss,
  hadPriorBS,
  hadPriorPL,
  ledgerExtra,
  mergeSections,
  missingGrant,
  printPath,
  refusedWhy,
  RK,
  type MergedLine,
  type StatementGroup,
} from './reports';

/**
 * The profit and loss and the balance sheet — and, exported for the other
 * report screens, the two pieces every report shares: the date range, and
 * the panel that says why a report is not on screen.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE COMPARATIVE IS THE SAME WINDOW A YEAR BACK, NOT LAST FISCAL YEAR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Asking for April–August and comparing it against a full prior year would
 * put five months beside twelve and call the difference a variance. The
 * server shifts whatever window was asked for back by a year, so the two
 * columns always cover the same span. A company in its first year has no
 * prior column at all: a dash, never 0.00.
 *
 * Every account on a statement opens its general ledger for the same window,
 * so a figure somebody doubts is one click from the entries that made it.
 */

// ── shared by the report screens ─────────────────────────────────────────

/**
 * A report that is not on screen, and why. A missing grant is named — the
 * report needs `finance.reports.view`, and "try again" would never help; a
 * refusal the server meant is quoted; anything else is a failed request, and
 * says it is not a statement about the books.
 */
export function ReportFailed({ what, not, error, onRetry, onAccess }: { what: string; not: string; error: unknown; onRetry?: () => void; onAccess?: () => void }) {
  const grant = missingGrant(error);
  const said = grant ? null : refusedWhy(error);
  const lower = what.charAt(0).toLowerCase() + what.slice(1);
  return (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-[12px] border border-line bg-surface px-4 py-3.5 text-[13px] leading-relaxed text-ink-2">
      {grant ? (
        <span>
          Reading {lower} needs <code className="font-mono text-[12px] text-ink">{grant}</code>, which you do not hold. The figures are a separate grant from opening Finance — whoever manages Finance access can give it.
        </span>
      ) : said ? (
        <span>
          The server refused {lower}: “{said}” This is not a statement {not}.
        </span>
      ) : (
        <span>
          {what} could not be loaded. This is a failed request, not a statement {not}.
        </span>
      )}
      <span className="flex gap-2">
        {!grant && onRetry ? (
          <button type="button" className={btnSmall} onClick={onRetry}>
            Try again
          </button>
        ) : null}
        {grant && onAccess ? (
          <button type="button" className={btnSmall} onClick={onAccess}>
            My access
          </button>
        ) : null}
      </span>
    </div>
  );
}

/**
 * From and To. Empty is the server's default window, which the reset button
 * names; the caption on each report then says what that window was.
 */
export function DateRange({ from, to, onChange, reset, hint }: { from: string; to: string; onChange: (r: { from: string; to: string }) => void; reset: string; hint?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="From" className="w-[160px]">
        <input type="date" value={from} onChange={(e) => onChange({ from: e.target.value, to })} className={input} />
      </Field>
      <Field label="To" className="w-[160px]">
        <input type="date" value={to} onChange={(e) => onChange({ from, to: e.target.value })} className={input} />
      </Field>
      {from || to ? (
        <button type="button" className={cx(btnSmall, 'mb-0.5')} onClick={() => onChange({ from: '', to: '' })}>
          {reset}
        </button>
      ) : null}
      {hint ? <p className="m-0 max-w-[56ch] pb-1.5 text-[12px] text-ink-3">{hint}</p> : null}
    </div>
  );
}

/** A window that ends before it starts — said, rather than asked of the server and shown as an empty report. */
export function Backwards() {
  return <Notice tone="red">The start is after the end, so no journal can fall in that window.</Notice>;
}

// ── the statement's rows ─────────────────────────────────────────────────

const FIG = 'w-[180px] shrink-0 text-right tabular-nums whitespace-nowrap';

function Head({ base, now, before }: { base: string; now: string; before: string }) {
  return (
    <div className="flex items-end gap-2.5 border-b border-line bg-ground px-4 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
      <span className="min-w-0 flex-1">{base ? `Figures in ${base}` : null}</span>
      <span className={FIG}>{now}</span>
      <span className={FIG}>{before}</span>
    </div>
  );
}

/** The comparative figure: a dash when there was no last year. */
function Prior({ value, had, className }: { value?: string | null; had: boolean; className?: string }) {
  return had ? (
    <span className={cx(FIG, 'text-ink-2', className)}>{money(value ?? '0')}</span>
  ) : (
    <span className={cx(FIG, 'text-ink-3')} title="There was no last year to compare with">
      —
    </span>
  );
}

function AccountRow({ line, indent, had, onAccount }: { line: MergedLine; indent: number; had: boolean; onAccount: (id: number) => void }) {
  return (
    <div className="flex items-baseline gap-2.5 px-4 py-[5px] text-[13px] hover:bg-subtle">
      <button type="button" onClick={() => onAccount(line.account_id)} title="Open this account's general ledger for the same dates" className="group flex min-w-0 flex-1 items-baseline gap-2 text-left" style={{ paddingLeft: indent * 16 }}>
        <span className="w-[46px] shrink-0 font-mono text-[11.5px] text-ink-3">{line.code}</span>
        <span className="truncate text-ink group-hover:text-primary group-hover:underline">{line.name}</span>
      </button>
      <span className={cx(FIG, 'text-ink')}>{money(line.amount ?? '0')}</span>
      <Prior value={line.prior} had={had} />
    </div>
  );
}

type Weight = 'section' | 'group' | 'sub' | 'net';

const WEIGHT: Record<Weight, string> = {
  section: 'border-t border-line/70 text-[12.5px] font-semibold text-ink-2',
  group: 'border-t border-line text-[13px] font-semibold text-ink',
  sub: 'mt-1 border-t border-line text-[13.5px] font-bold text-ink',
  net: 'mt-1 border-t-2 border-ink text-[14px] font-bold text-ink',
};

/** A line that adds up what is above it: a section, a group, a subtotal, or the result — ruled heavier as it matters more. */
function Total({ label, value, prior, had, weight, indent = 0 }: { label: ReactNode; value: string; prior?: string | null; had: boolean; weight: Weight; indent?: number }) {
  return (
    <div className={cx('flex items-baseline gap-2.5 px-4 py-2', WEIGHT[weight])}>
      <span className="min-w-0 flex-1 truncate" style={{ paddingLeft: indent * 16 }}>
        {label}
      </span>
      <span className={cx(FIG, weight === 'net' && isNegative(value) && 'text-danger')}>{money(value)}</span>
      <Prior value={prior} had={had} className={weight === 'net' || weight === 'sub' ? 'font-semibold' : undefined} />
    </div>
  );
}

/** A figure that is not an account: the computed profit lines of the balance sheet. */
function Computed({ label, note, value, prior, had }: { label: string; note?: string; value: string; prior?: string | null; had: boolean }) {
  return (
    <div className="flex items-baseline gap-2.5 px-4 py-[5px] text-[13px]">
      <span className="min-w-0 flex-1 truncate pl-4 text-ink">
        {label}
        {note ? <span className="ml-2 text-[11.5px] text-ink-3">{note}</span> : null}
      </span>
      <span className={cx(FIG, 'text-ink')}>{money(value)}</span>
      <Prior value={prior} had={had} />
    </div>
  );
}

/**
 * One group of a statement — Revenue, Assets — its chart headings as
 * sections, its accounts indented under them. A section's own total shows
 * only where there is more than one section and more than one account in it,
 * and the group's only where it has more than one account: a total that
 * repeats the line above it is a rule for nothing.
 */
function Group({ label, now, before, had, total, keepHeading, onAccount }: { label: string; now?: StatementGroup; before?: StatementGroup; had: boolean; total?: string; keepHeading?: boolean; onAccount: (id: number) => void }) {
  const sections = mergeSections(now, had ? before : null);
  if (!sections.length && !keepHeading) return null;
  const many = sections.length > 1;
  const lines = sections.reduce((n, s) => n + s.lines.length, 0);
  return (
    <>
      <div className="px-4 pt-4 pb-1 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">{label}</div>
      {sections.map((s) => (
        <Fragment key={s.name}>
          {many ? <div className="px-4 pt-2 pb-0.5 pl-8 text-[12.5px] font-semibold text-ink-2">{s.name}</div> : null}
          {s.lines.map((l) => (
            <AccountRow key={l.account_id} line={l} indent={many ? 2 : 1} had={had} onAccount={onAccount} />
          ))}
          {many && s.lines.length > 1 ? <Total label={`Total ${s.name}`} value={s.total ?? '0'} prior={s.prior} had={had} weight="section" indent={1} /> : null}
        </Fragment>
      ))}
      {total && lines > 1 ? <Total label={total} value={now?.total ?? '0'} prior={before?.total} had={had} weight="group" /> : null}
    </>
  );
}

// ── the profit and loss ──────────────────────────────────────────────────

export function ProfitAndLoss({ company, onGo }: ScreenProps) {
  const [range, setRange] = useState({ from: '', to: '' });
  const bad = backwards(range.from, range.to);
  const q = useQuery({
    // The dates are in the key: a range that changed the request and not the key would show last window's figures under this one's caption.
    queryKey: RK.pl(company.id, range.from, range.to),
    queryFn: ({ signal }) => fetchProfitAndLoss(company.id, range.from, range.to, signal),
    enabled: company.has_books && !bad,
    retry: false,
  });
  const s = q.data?.statement;
  const p = q.data?.comparative;
  const base = q.data?.base_currency ?? company.base_currency ?? '';

  let body: ReactNode;
  if (!company.has_books) body = <p className="m-0 text-[13px] text-ink-2">{company.name} has no general ledger yet.</p>;
  else if (bad) body = <Backwards />;
  else if (q.isLoading) body = <Spinner />;
  else if (q.error || !s || !p) body = <ReportFailed what="The profit and loss" not="that the company traded nothing" error={q.error} onRetry={() => void q.refetch()} onAccess={() => onGo('myaccess')} />;
  else {
    const had = hadPriorPL(p);
    const open = (id: number) => onGo('ledger', ledgerExtra(id, s.from, s.to));
    const g = (k: keyof typeof s.groups) => ({ now: s.groups[k], before: p.groups[k] });
    // The same test as "was there a last year", asked of this one: is there anything in either column at all.
    const quiet = !hadPriorPL(s) && !had;
    body = (
      <div className="overflow-hidden rounded-[12px] border border-line bg-surface pb-1">
        <Head base={base} now={`${shortDate(s.from)} – ${shortDate(s.to)}`} before={`${shortDate(p.from)} – ${shortDate(p.to)}`} />
        {quiet ? <p className="m-0 px-4 pt-3 text-[12.5px] text-ink-3">Nothing was posted to an income or expense account in this window, or in the same window a year earlier.</p> : null}
        <Group label="Revenue" {...g('revenue')} had={had} total="Total revenue" onAccount={open} />
        <Group label="Cost of sales" {...g('cogs')} had={had} total="Total cost of sales" onAccount={open} />
        <Total label="Gross profit" value={s.subtotals.gross_profit ?? '0'} prior={p.subtotals.gross_profit} had={had} weight="sub" />
        <Group label="Operating expenses" {...g('expense')} had={had} total="Total operating expenses" onAccount={open} />
        <Total label="Operating profit" value={s.subtotals.operating_profit ?? '0'} prior={p.subtotals.operating_profit} had={had} weight="sub" />
        <Group label="Other income" {...g('other_income')} had={had} total="Total other income" onAccount={open} />
        <Group label="Other expenses" {...g('other_expense')} had={had} total="Total other expenses" onAccount={open} />
        <Total label="Net profit" value={s.net_profit} prior={p.net_profit} had={had} weight="net" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Profit and loss" sub={s ? `${longDate(s.from)} to ${longDate(s.to)}, from posted journals only.` : 'From posted journals only.'}>
        {s && !bad && !q.error ? <GetItOut company={company} from={s.from} to={s.to} /> : null}
      </PageHead>
      <DateRange from={range.from} to={range.to} onChange={setRange} reset="The open financial year" hint="Left empty, the open financial year. The second column is the same window a year earlier, so part of a year compares with the same part of last year." />
      {body}
    </div>
  );
}

/**
 * Getting the profit and loss out: the summary as shown, every journal line
 * behind it, or a page to print — three acts, three grants, and each button
 * is there only for somebody who holds its grant, because a button that can
 * only ever be refused is a control that does nothing. The server checks
 * again. The window is the one on screen, always both dates: the export's own
 * default is the calendar year, not the financial year this page shows.
 */
function GetItOut({ company, from, to }: { company: Company; from: string; to: string }) {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const [busy, setBusy] = useState<'' | 'export' | 'lines'>('');
  const save = async (lines: boolean) => {
    const name = csvName(company.name, 'profit-and-loss', from, to, lines);
    setBusy(lines ? 'lines' : 'export');
    try {
      await call('transfers:download', { financeCsv: { report: 'profit-and-loss', ...(lines ? { lines: true } : {}), company: company.id, from, to }, name });
      toast('success', `Saving ${name} to your downloads.`);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy('');
    }
  };
  const print = () => {
    // The web's print page: the report on its own, which prints itself. Printing this window would print the rail and a clipped table.
    void call('app:openInBrowser', { path: printPath('profit-and-loss', company.id, from, to) });
    toast('info', 'Opening the printable page in your browser.');
  };
  const mayExport = can(perms, 'finance.reports.export');
  const mayLines = can(perms, 'finance.reports.download');
  const mayPrint = can(perms, 'finance.reports.print');
  if (!mayExport && !mayLines && !mayPrint) return null;
  return (
    <span className="flex flex-wrap gap-2">
      {mayExport ? (
        <button type="button" className={btn} disabled={busy !== ''} title="This report as it is shown, as a CSV" onClick={() => void save(false)}>
          <Icon name="file-sheet" size={14} /> {busy === 'export' ? 'Saving…' : 'Export'}
        </button>
      ) : null}
      {mayLines ? (
        <button type="button" className={btn} disabled={busy !== ''} title="Every journal line behind this report, as a CSV" onClick={() => void save(true)}>
          <Icon name="download" size={14} /> {busy === 'lines' ? 'Saving…' : 'Transactions'}
        </button>
      ) : null}
      {mayPrint ? (
        <button type="button" className={btn} title="Opens a page laid out to print, in your browser" onClick={print}>
          <Icon name="printer" size={14} /> Print
        </button>
      ) : null}
    </span>
  );
}

// ── the balance sheet ────────────────────────────────────────────────────

export function BalanceSheet({ company, onGo }: ScreenProps) {
  const [asOf, setAsOf] = useState('');
  const q = useQuery({
    queryKey: RK.bs(company.id, asOf),
    queryFn: ({ signal }) => fetchBalanceSheet(company.id, asOf, signal),
    enabled: company.has_books,
    retry: false,
  });
  const s = q.data?.statement;
  const p = q.data?.comparative;
  const base = q.data?.base_currency ?? company.base_currency ?? '';

  let body: ReactNode;
  if (!company.has_books) body = <p className="m-0 text-[13px] text-ink-2">{company.name} has no general ledger yet.</p>;
  else if (q.isLoading) body = <Spinner />;
  else if (q.error || !s || !p) body = <ReportFailed what="The balance sheet" not="about the company's position" error={q.error} onRetry={() => void q.refetch()} onAccess={() => onGo('myaccess')} />;
  else {
    const had = hadPriorBS(p);
    // Everything to the date: the ledger from the beginning, closing on the day this balance is struck.
    const open = (id: number) => onGo('ledger', ledgerExtra(id, '', s.as_of));
    const t = s.totals;
    const pt = p.totals;
    body = (
      <>
        {/* The check is the report, not a footnote: a balance sheet that does not balance says so where somebody about to send it will see it. */}
        <Notice tone={s.balanced ? 'green' : 'red'}>
          <span className="flex items-start gap-2">
            <Icon name={s.balanced ? 'check-circle' : 'warning'} size={15} className="mt-0.5 shrink-0" />
            {s.balanced ? (
              <span>
                Assets equal liabilities plus equity, at <b className="tabular-nums">{money(t.assets, base)}</b>.
              </span>
            ) : (
              <span>
                This does not balance. Assets are <b className="tabular-nums">{money(t.assets, base)}</b> against liabilities and equity of <b className="tabular-nums">{money(t.liabilities_and_equity, base)}</b> — out by <b className="tabular-nums">{money(s.difference, base)}</b>. Do not issue this.
              </span>
            )}
          </span>
        </Notice>
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface pb-1">
          <Head base={base} now={shortDate(s.as_of)} before={shortDate(p.as_of)} />
          <Group label="Assets" now={s.groups.asset} before={p.groups.asset} had={had} keepHeading onAccount={open} />
          <Total label="Total assets" value={t.assets} prior={pt.assets} had={had} weight="sub" />
          <Group label="Liabilities" now={s.groups.liability} before={p.groups.liability} had={had} keepHeading onAccount={open} />
          <Total label="Total liabilities" value={t.liabilities} prior={pt.liabilities} had={had} weight="group" />
          {/* Equity always has its heading: the two profit lines belong under it even when no equity account has moved. */}
          <Group label="Equity" now={s.groups.equity} before={p.groups.equity} had={had} keepHeading onAccount={open} />
          <Computed label="Profit brought forward" value={t.profit_brought_forward} prior={pt.profit_brought_forward} had={had} />
          <Computed label="Profit for the year" note="computed, until a year-end close writes it to 3300" value={t.profit_for_the_year} prior={pt.profit_for_the_year} had={had} />
          {t.equity !== undefined ? <Total label="Total equity" value={t.equity} prior={pt.equity} had={had} weight="group" /> : null}
          <Total label="Total liabilities and equity" value={t.liabilities_and_equity} prior={pt.liabilities_and_equity} had={had} weight="net" />
        </div>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Balance sheet" sub={s ? `As at ${longDate(s.as_of)}, from posted journals only.` : 'From posted journals only.'} />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="As at" className="w-[160px]">
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className={input} />
        </Field>
        {asOf ? (
          <button type="button" className={cx(btnSmall, 'mb-0.5')} onClick={() => setAsOf('')}>
            End of the open year
          </button>
        ) : null}
        <p className="m-0 max-w-[56ch] pb-1.5 text-[12px] text-ink-3">The second column is the same date a year earlier.</p>
      </div>
      {body}
    </div>
  );
}
