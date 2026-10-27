import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Menu } from '../../components/Menu';
import { btn } from '../../components/PageKit';
import { exportRequest, type ExportFormat } from './actions';
import { dateLabel, todayInZone } from '../../core/time';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { Empty, input, Kpi, PageHead, Panel, Seg } from '../../components/PageKit';
import { BarRow } from '../../components/ReportKit';
import { rangeOf, RANGES, type RangePreset } from '../sales/manage';
import { agingParts, amount, methodLabel } from './api';
import { BILL_REPORTS, fetchBillReport, KB, type BillReport, type ReportAnswer } from './more';
import { money } from './parts';
import { StatGrid } from '../../components/StatCard';

/**
 * Billing reports (BillReports, BillReportsSheet): how old the money is, what
 * was billed and received, the tax charged and credited, customers, payments
 * and what sold. Figures are in the base currency except ageing, which is as
 * invoiced. The window defaults to this year; ageing is everything owed today.
 * Each one exports as the screen shows it (G-13) — CSV, XLSX where the
 * server has a writer, or PDF — saved to disk through Transfers.
 */
const KEY = 'billing.reports.window';
type Window = { preset: RangePreset; from: string; to: string };

function savedWindow(): Window {
  try {
    const w = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Window | null;
    if (w?.preset === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(w.from) && /^\d{4}-\d{2}-\d{2}$/.test(w.to)) return w;
    if (w?.preset && w.preset !== 'custom') return { preset: w.preset, ...rangeOf(w.preset, todayInZone())! };
  } catch {
    /* a convenience */
  }
  return { preset: 'this_year', ...rangeOf('this_year', todayInZone())! };
}

export default function BillReports({ org, onOpenPayment }: { org: string; onOpenPayment: (id: number) => void }) {
  const [kind, setKind] = useState<BillReport>('aging');
  const [group, setGroup] = useState('month');
  const [win, setWin] = useState<Window>(savedWindow);
  const keep = (w: Window) => {
    setWin(w);
    try {
      localStorage.setItem(KEY, JSON.stringify(w));
    } catch {
      /* a convenience */
    }
  };
  const params = { org, from: win.from, to: win.to, group };
  const q = useQuery({ queryKey: KB.report(kind, params), queryFn: ({ signal }) => fetchBillReport(kind, params, signal), placeholderData: keepPreviousData });
  const d = q.data;
  const [exporting, setExporting] = useState(false);
  const exportRef = useRef<HTMLButtonElement | null>(null);
  const save = (format: ExportFormat) =>
    void call('transfers:download', exportRequest({ report: kind }, format, { org, ...(kind === 'aging' ? {} : { from: win.from, to: win.to }) })).then(
      () => toast('success', `Exporting ${format.toUpperCase()} — see Transfers.`),
      (e) => toast('error', errorMessage(e)),
    );

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Reports" sub="Billing">
        <button ref={exportRef} type="button" className={btn} aria-haspopup="menu" aria-expanded={exporting} onClick={() => setExporting((v) => !v)}>
          <Icon name="download" size={14} /> Export
        </button>
        {exporting ? (
          <Menu
            label="Export this report"
            anchor={exportRef}
            prefer="bottom"
            align="end"
            width={220}
            sections={[{ id: 'fmt', items: (['csv', 'xlsx', 'pdf'] as ExportFormat[]).map((f) => ({ id: f, label: f === 'csv' ? 'CSV' : f === 'xlsx' ? 'Excel (XLSX)' : 'PDF', onSelect: () => save(f) })) }]}
            onClose={() => setExporting(false)}
          />
        ) : null}
      </PageHead>
      <div className="flex flex-wrap items-center gap-2">
        <Seg<BillReport> label="Report" value={kind} onChange={setKind} options={BILL_REPORTS.map((r) => ({ id: r.id, label: r.label }))} />
        <span className="flex-1" />
        {kind === 'revenue' ? (
          <Select<string>
            aria-label="Grouped"
            value={group}
            onValueChange={setGroup}
            options={[
              { value: 'month', label: 'By month' },
              { value: 'client', label: 'By customer' },
              { value: 'project', label: 'By project' },
            ]}
            className={input + ' !w-[150px]'}
          />
        ) : null}
        {kind !== 'aging' ? (
          <>
            <Select<RangePreset> aria-label="Window" value={win.preset} onValueChange={(p) => keep(p === 'custom' ? { ...win, preset: 'custom' } : { preset: p, ...rangeOf(p, todayInZone())! })} options={RANGES.map((r) => ({ value: r.id, label: r.label }))} className={input + ' !w-[150px]'} />
            {win.preset === 'custom' ? (
              <>
                <input type="date" aria-label="From" value={win.from} max={win.to} onChange={(e) => e.target.value && keep({ ...win, from: e.target.value })} className={input + ' !w-[150px]'} />
                <span className="text-ink-3">–</span>
                <input type="date" aria-label="To" value={win.to} min={win.from} onChange={(e) => e.target.value && keep({ ...win, to: e.target.value })} className={input + ' !w-[150px]'} />
              </>
            ) : null}
          </>
        ) : null}
      </div>
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      ) : d ? (
        <>
          {kind === 'aging' ? <Aging d={d} /> : null}
          {kind === 'revenue' ? <Revenue d={d} /> : null}
          {kind === 'tax' ? <Tax d={d} /> : null}
          {kind === 'customers' ? <CustomersReport d={d} /> : null}
          {kind === 'payments' ? <PaymentsReport d={d} onOpen={onOpenPayment} /> : null}
          {kind === 'products' ? <Products d={d} /> : null}
          {d.basis || d.note ? <p className="m-0 rounded-[10px] bg-subtle px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-2">{d.basis ?? d.note}</p> : null}
        </>
      ) : null}
    </div>
  );
}

type Col = { key: string; label: string; w?: number; money?: boolean; num?: boolean; render?: (r: Record<string, unknown>) => ReactNode };

function Table({ rows, cols, empty = 'Nothing in this window.' }: { rows: Array<Record<string, unknown>>; cols: Col[]; empty?: string }) {
  if (!rows.length) return <Empty text={empty} />;
  return (
    <div role="table" className="flex flex-col">
      <div role="row" className="flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
        {cols.map((c) => (
          <span key={c.key} role="columnheader" className={c.w ? 'shrink-0' : 'min-w-0 flex-1'} style={{ width: c.w, textAlign: c.money || c.num ? 'right' : undefined }}>
            {c.label}
          </span>
        ))}
      </div>
      {rows.map((r, i) => (
        <div key={i} role="row" className="flex items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-[12.5px] text-ink last:border-b-0">
          {cols.map((c, j) => (
            <span key={c.key} role="cell" className={cx(c.w ? 'shrink-0' : 'min-w-0 flex-1', 'truncate', (c.money || c.num) && 'text-right tabular-nums', j === 0 && 'font-semibold')} style={{ width: c.w }}>
              {c.render ? c.render(r) : c.money ? amount(Number(r[c.key] ?? 0)) : r[c.key] === null || r[c.key] === undefined || r[c.key] === '' ? '—' : String(r[c.key])}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function Aging({ d }: { d: ReportAnswer }) {
  const parts = agingParts(d.buckets);
  const cell = (k: string) => (r: Record<string, unknown>) => (Number(r[k]) > 0 ? money(Number(r[k])) : '—');
  return (
    <>
      <Panel title="Everything outstanding" bodyClassName="flex flex-col gap-2 p-3.5">
        <div className="flex h-3.5 overflow-hidden rounded-[7px] bg-subtle">{parts.map((a) => (a.pct > 0 ? <span key={a.key} style={{ width: `${a.pct}%`, background: a.colour }} title={`${a.label}: ${amount(a.value)}`} /> : null))}</div>
        <div className="grid grid-cols-5 gap-2">
          {parts.map((a) => (
            <span key={a.key} className="flex flex-col text-[11.5px] text-ink-3">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-[2px]" style={{ background: a.colour }} />
                {a.label}
              </span>
              <b className="text-[13px] text-ink tabular-nums">{amount(a.value)}</b>
            </span>
          ))}
        </div>
      </Panel>
      <Panel title="By customer">
        <Table
          rows={d.by_client ?? []}
          empty="Nothing is owed."
          cols={[
            { key: 'client', label: 'Customer' },
            { key: 'current', label: 'Not due', w: 110, num: true, render: cell('current') },
            { key: '1_30', label: '1–30', w: 100, num: true, render: cell('1_30') },
            { key: '31_60', label: '31–60', w: 100, num: true, render: cell('31_60') },
            { key: '61_90', label: '61–90', w: 100, num: true, render: cell('61_90') },
            { key: 'over_90', label: '90+', w: 100, num: true, render: cell('over_90') },
            { key: 'total', label: 'Total', w: 130, num: true, render: (r) => <b>{amount(Number(r.total), r.currency as string)}</b> },
          ]}
        />
      </Panel>
    </>
  );
}

function Revenue({ d }: { d: ReportAnswer }) {
  const t = d.totals ?? {};
  const cur = d.base_currency;
  const rows = (d.rows ?? []) as Array<{ key: string; label: string; count: number; total: number }>;
  const top = Math.max(1, ...rows.map((r) => r.total));
  return (
    <>
      <StatGrid>
        <Kpi icon="receipt" tone="blue" label="Billed" value={money(t.gross, cur)} sub={`${t.invoices ?? 0} ${t.invoices === 1 ? 'invoice' : 'invoices'}`} />
        <Kpi icon="scale" tone="violet" label="Net of credits" value={money(t.net_of_credits, cur)} sub={`${t.credit_notes ?? 0} ${t.credit_notes === 1 ? 'credit note' : 'credit notes'}`} />
        <Kpi icon="landmark" tone="amber" label="Tax charged" value={money(t.tax, cur)} sub="included above" />
        <Kpi icon="banknote" label="Cash received" value={money(t.received, cur)} sub={`${t.receipts ?? 0} ${t.receipts === 1 ? 'receipt' : 'receipts'}`} tone="green" />
      </StatGrid>
      <Panel title="Breakdown" bodyClassName="flex flex-col gap-2.5 p-3.5">
        {rows.length ? rows.map((r) => <BarRow key={r.key} label={r.label} value={`${money(r.total, cur)} · ${r.count}`} pct={(r.total / top) * 100} colour="#7C3AED" />) : <Empty text="Nothing billed in this window." />}
      </Panel>
    </>
  );
}

function Tax({ d }: { d: ReportAnswer }) {
  const t = d.totals ?? {};
  const cur = d.base_currency;
  return (
    <>
      <StatGrid>
        <Kpi icon="landmark" tone="amber" label="Tax charged" value={money(t.charged, cur)} />
        <Kpi icon="undo" tone="cyan" label="Credited back" value={money(t.credited, cur)} />
        <Kpi icon="sigma" tone="violet" label="Net tax" value={money(t.net, cur)} />
        <Kpi icon="shield" label="Withheld by customers" value={money(t.withheld, cur)} />
      </StatGrid>
      <Panel title="By rate">
        <Table
          rows={d.rates ?? []}
          empty="No tax was charged in this window."
          cols={[
            { key: 'name', label: 'Rate', render: (r) => `${r.name} ${Number(r.rate)}%${r.is_compound ? ' (compound)' : ''}` },
            { key: 'invoices', label: 'Invoices', w: 80, num: true },
            { key: 'taxable', label: 'Taxable', w: 140, money: true },
            { key: 'charged', label: 'Charged', w: 130, money: true },
            { key: 'credited', label: 'Credited', w: 120, money: true },
            { key: 'net', label: 'Net', w: 130, money: true },
          ]}
        />
      </Panel>
    </>
  );
}

function CustomersReport({ d }: { d: ReportAnswer }) {
  return (
    <Panel title="Customers" sub="Average days to pay counts fully settled invoices only.">
      <Table
        rows={d.customers ?? []}
        cols={[
          { key: 'client', label: 'Customer' },
          { key: 'invoices', label: 'Invoices', w: 80, num: true },
          { key: 'billed', label: 'Billed', w: 130, money: true },
          { key: 'settled', label: 'Settled', w: 130, money: true },
          { key: 'outstanding', label: 'Outstanding', w: 130, money: true },
          { key: 'overdue', label: 'Overdue', w: 120, money: true },
          { key: 'avg_days_to_pay', label: 'Avg days to pay', w: 110, num: true, render: (r) => (r.avg_days_to_pay === null || r.avg_days_to_pay === undefined ? '—' : `${Math.round(Number(r.avg_days_to_pay))}d`) },
          { key: 'last_invoice', label: 'Last invoice', w: 100, render: (r) => (r.last_invoice ? dateLabel(String(r.last_invoice)) : '—') },
        ]}
      />
    </Panel>
  );
}

function PaymentsReport({ d, onOpen }: { d: ReportAnswer; onOpen: (id: number) => void }) {
  const cur = d.base_currency;
  const methods = (d.by_method ?? []) as Array<{ method: string; direction: string; count: number; total: number }>;
  const topM = Math.max(1, ...methods.map((m) => m.total));
  const months = (d.by_month ?? []) as Array<{ key: string; label: string; received: number; refunded: number }>;
  const topR = Math.max(1, ...months.map((m) => m.received));
  return (
    <>
      <div className="grid grid-cols-2 gap-3.5">
        <Panel title="By method" bodyClassName="flex flex-col gap-2.5 p-3.5">
          {methods.length ? methods.map((m) => <BarRow key={`${m.method}-${m.direction}`} label={`${methodLabel(m.method)}${m.direction === 'out' ? ' · refunds' : ''}`} value={`${money(m.total, cur)} · ${m.count}`} pct={(m.total / topM) * 100} colour={m.direction === 'out' ? 'var(--color-danger)' : '#0E7C86'} />) : <Empty text="Nothing received in this window." />}
        </Panel>
        <Panel title="Received by month" bodyClassName="flex flex-col gap-2.5 p-3.5">
          {months.length ? months.map((m) => <BarRow key={m.key} label={m.label} value={`${money(m.received, cur)}${m.refunded ? ` · refunded ${money(m.refunded, cur)}` : ''}`} pct={(m.received / topR) * 100} colour="#16A34A" />) : <Empty text="Nothing received in this window." />}
        </Panel>
      </div>
      <Panel title="Money not against any invoice" sub="Everything on account today, oldest first">
        <Table
          rows={d.unallocated ?? []}
          empty="Nothing is on account."
          cols={[
            { key: 'reference', label: 'Reference', w: 130, render: (r) => <button type="button" className="font-bold text-primary hover:underline" onClick={() => onOpen(Number(r.id))}>{String(r.reference)}</button> },
            { key: 'client', label: 'Customer' },
            { key: 'paid_on', label: 'Received', w: 100, render: (r) => dateLabel(String(r.paid_on)) },
            { key: 'amount', label: 'Amount', w: 130, num: true, render: (r) => amount(Number(r.amount), r.currency as string) },
            { key: 'unallocated', label: 'Unallocated', w: 130, num: true, render: (r) => <b className="text-warning-ink dark:text-warning">{amount(Number(r.unallocated), r.currency as string)}</b> },
          ]}
        />
      </Panel>
    </>
  );
}

function Products({ d }: { d: ReportAnswer }) {
  const cur = d.base_currency;
  const rows = (d.products ?? []) as Array<{ product_id: number | null; label: string; free_text: boolean; lines: number; quantity: number; revenue: number }>;
  const top = Math.max(1, ...rows.map((r) => r.revenue));
  return (
    <Panel title="What sold" sub="Revenue before tax" bodyClassName="flex flex-col gap-2.5 p-3.5">
      {rows.length ? rows.map((r, i) => <BarRow key={`${r.product_id ?? 'typed'}-${i}`} label={`${r.label}${r.free_text ? ' (typed)' : ''}`} value={`${r.lines} ${r.lines === 1 ? 'line' : 'lines'} · ${money(r.revenue, cur)}`} pct={(r.revenue / top) * 100} />) : <Empty text="Nothing sold in this window." />}
    </Panel>
  );
}
