import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { dateLabel, dayWords, todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner } from '../../components/ui';
import { btn, Empty, input, Kpi, PageHead, Panel } from '../hr/parts';
import { BarRow } from '../crm/parts';
import { statusOf } from './api';
import { fetchReport, GROUPS, KM, periodLabel, rangeOf, RANGES, REPORTS, type RangePreset, type ReportData, type ReportKind, type ReportParams } from './manage';
import { money, moneyFull, StatusPill } from './parts';
import { saveReportPdf } from './print';
import { cx } from '../../components/ui';
import { StatGrid } from '../../components/StatCard';

/**
 * Reports (OmsReports, OmsReportsSales): seven reports over a date window,
 * each exported as the server's own CSV. Money is never added across
 * currencies — a row per currency, as the server gives it — and every
 * report ends with the server's basis sentence, drawn in full, because
 * several figures rest on something a reader must know to quote them.
 * The window is remembered on this computer.
 *
 * D-09 (v1.1): the reports picked on the left; each exports as CSV, or is saved
 * as the server's PDF wherever you choose, with Show in folder (FR-DSK-06).
 */
const has = (perms: readonly string[] | undefined, p: string) => !!perms && (perms.includes('*') || perms.includes(p));
const KEY = 'sales.reports.window';
type Window = { preset: RangePreset; from: string; to: string };

function savedWindow(): Window {
  try {
    const w = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Window | null;
    if (w?.preset === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(w.from) && /^\d{4}-\d{2}-\d{2}$/.test(w.to)) return w;
    if (w?.preset && w.preset !== 'custom') return { preset: w.preset, ...rangeOf(w.preset, todayInZone())! };
  } catch {
    /* a convenience */
  }
  return { preset: 'this_month', ...rangeOf('this_month', todayInZone())! };
}

const cur = (c: string | null | undefined) => (c && c !== '—' ? c : undefined);

export default function Reports({ org }: { org: string }) {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const [report, setReport] = useState<ReportKind>('summary');
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
  const params: ReportParams = { report, from: win.from, to: win.to, org, group };
  const q = useQuery({ queryKey: KM.report(report, params), queryFn: ({ signal }) => fetchReport(params, signal), placeholderData: keepPreviousData });
  // The summary also draws the status and ageing breakdowns, as the design does.
  const extra = (r: ReportKind) => ({ ...params, report: r });
  const status = useQuery({ queryKey: KM.report('status', extra('status')), queryFn: ({ signal }) => fetchReport(extra('status'), signal), enabled: report === 'summary' });
  const aging = useQuery({ queryKey: KM.report('aging', extra('aging')), queryFn: ({ signal }) => fetchReport(extra('aging'), signal), enabled: report === 'summary' });
  const d = q.data;

  const exportCsv = () =>
    void call('transfers:download', {
      omsReport: { report, from: win.from, to: win.to, ...(org ? { org } : {}), ...(report === 'sales' ? { group: group as 'month' } : {}) },
      name: `orders-${report}-${win.from}-to-${win.to}.csv`,
      open: true,
    }).then(
      () => toast('success', 'Exporting — see Transfers.'),
      (e) => toast('error', errorMessage(e)),
    );

  const [saving, setSaving] = useState(false);
  const label = REPORTS.find((r) => r.id === report)?.label ?? 'Report';
  const savePdf = () => {
    setSaving(true);
    void saveReportPdf({ report, from: win.from, to: win.to, ...(org ? { org } : {}), ...(report === 'sales' ? { group: group as 'month' } : {}), name: `${label} — ${win.from} to ${win.to}` }).finally(() => setSaving(false));
  };

  return (
    <div className="flex items-start gap-3.5 px-6 py-5">
      <nav aria-label="Reports" className="sticky top-0 flex w-[190px] shrink-0 flex-col gap-0.5">
        <div className="mb-1 px-2 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">Reports</div>
        {REPORTS.map((r) => (
          <button key={r.id} type="button" aria-current={r.id === report ? 'page' : undefined} onClick={() => setReport(r.id)} className={cx('flex h-8 items-center rounded-[8px] px-2.5 text-left text-[13px]', r.id === report ? 'bg-[#EAEDFB] font-bold text-[#1B2A85] dark:bg-selection dark:text-primary' : 'font-medium text-ink hover:bg-subtle')}>
            {r.label}
          </button>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col gap-3.5">
      <PageHead title={label} sub="Orders" />
      <div className="flex flex-wrap items-center gap-2">
        {report === 'sales' ? <Select<string> aria-label="Grouped" value={group} onValueChange={setGroup} options={GROUPS.map((g) => ({ value: g.id, label: g.label }))} className={input + ' !w-[180px]'} /> : null}
        <Select<RangePreset>
          aria-label="Window"
          value={win.preset}
          onValueChange={(p) => keep(p === 'custom' ? { ...win, preset: 'custom' } : { preset: p, ...rangeOf(p, todayInZone())! })}
          options={RANGES.map((r) => ({ value: r.id, label: r.label }))}
          className={input + ' !w-[160px]'}
        />
        {win.preset === 'custom' ? (
          <>
            <input type="date" aria-label="From" value={win.from} max={win.to} onChange={(e) => e.target.value && keep({ ...win, from: e.target.value })} className={input + ' !w-[150px]'} />
            <span className="text-ink-3">to</span>
            <input type="date" aria-label="To" value={win.to} min={win.from} onChange={(e) => e.target.value && keep({ ...win, to: e.target.value })} className={input + ' !w-[150px]'} />
          </>
        ) : null}
        <span className="flex-1" />
        {has(perms, 'oms.orders.export') ? (
          <button type="button" className={btn} onClick={exportCsv}>
            <Icon name="download" size={14} /> Export CSV
          </button>
        ) : null}
        <button type="button" className={btn} disabled={saving} onClick={savePdf} title="The server's PDF of this report, saved where you choose">
          <Icon name="printer" size={14} /> Save PDF…
        </button>
      </div>

      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        // A report that failed must not look like an honestly empty one.
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      ) : d ? (
        <>
          {report === 'summary' ? <Summary d={d} status={status.data} aging={aging.data} /> : null}
          {report === 'sales' ? <Sales d={d} group={group} /> : null}
          {report === 'status' ? <StatusReport d={d} /> : null}
          {report === 'payment' ? <Payment d={d} /> : null}
          {report === 'aging' ? <Aging d={d} /> : null}
          {report === 'returns' ? <ReturnsReport d={d} /> : null}
          {report === 'coupons' ? <CouponUsage d={d} /> : null}
          {d.basis ? <p className="m-0 rounded-[10px] bg-subtle px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-2">{d.basis}</p> : null}
        </>
      ) : null}
      </div>
    </div>
  );
}

/** "1 Sep 2026 to 25 Sep 2026". */
const windowTitle = (d: ReportData) => `${dayWords(d.from, { year: true })} to ${dayWords(d.to, { year: true })}`;

type Col = { key: string; label: string; w?: number; kind?: 'num' | 'money' | 'status' | 'date' };

function Table({ rows, cols, empty = 'Nothing in this report.' }: { rows: Array<Record<string, unknown>>; cols: Col[]; empty?: string }) {
  if (!rows.length) return <Empty text={empty} />;
  const cell = (r: Record<string, unknown>, c: Col): ReactNode => {
    const v = r[c.key];
    if (c.kind === 'money') return moneyFull(Number(v ?? 0), cur(r.currency as string));
    if (c.kind === 'num') return Number(v ?? 0).toLocaleString();
    if (c.kind === 'status') return v ? <StatusPill status={String(v)} /> : '—';
    if (c.kind === 'date') return v ? dateLabel(String(v)) : '—';
    return v === null || v === undefined || v === '' ? '—' : String(v);
  };
  return (
    <div role="table" className="flex flex-col">
      <div role="row" className="flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
        {cols.map((c) => (
          <span key={c.key} role="columnheader" className={c.w ? 'shrink-0' : 'min-w-0 flex-1'} style={{ width: c.w, textAlign: c.kind === 'num' || c.kind === 'money' ? 'right' : undefined }}>
            {c.label}
          </span>
        ))}
      </div>
      {rows.map((r, i) => (
        <div key={String(r.id ?? r.key ?? i) + i} role="row" className="flex items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-[12.5px] text-ink last:border-b-0">
          {cols.map((c, j) => (
            <span key={c.key} role="cell" className={(c.w ? 'shrink-0 ' : 'min-w-0 flex-1 ') + 'truncate' + (c.kind === 'num' || c.kind === 'money' ? ' text-right tabular-nums' : '') + (j === 0 ? ' font-semibold' : '')} style={{ width: c.w }}>
              {cell(r, c)}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Money per currency, one after another — never summed into one figure. */
function PerCurrency({ rows, field = 'value' }: { rows: Array<Record<string, unknown>> | undefined; field?: string }) {
  if (!rows?.length) return <span className="text-ink-3">—</span>;
  return <span className="tabular-nums">{rows.map((r) => money(Number(r[field] ?? 0), cur(r.currency as string))).join(' + ')}</span>;
}

function Summary({ d, status, aging }: { d: ReportData; status?: ReportData; aging?: ReportData }) {
  const m = d.money ?? {};
  const byCur: Array<Record<string, unknown>> = m.by_currency ?? [];
  // Invoiced and paid come as one figure; it names a currency only when there is one.
  const one = byCur.length === 1 ? cur(byCur[0]!.currency as string) : undefined;
  const bars = ((status?.rows ?? []) as Array<{ status: string; orders: number; percent: number }>).filter((r) => r.orders > 0).sort((a, b) => b.orders - a.orders);
  const topBar = Math.max(1, ...bars.map((b) => b.orders));
  const buckets = (aging?.buckets ?? []) as Array<{ key: string; label: string; orders: number }>;
  const topBucket = Math.max(1, ...buckets.map((b) => b.orders));
  return (
    <>
      <Panel title={windowTitle(d)} bodyClassName="p-3.5">
        <StatGrid min={180}>
          <Kpi icon="cart" tone="blue" label="Orders" value={Number(d.orders ?? 0).toLocaleString()} />
          <Kpi icon="calendar-check" tone="violet" label="Today" value={Number(d.today ?? 0).toLocaleString()} />
          <Kpi icon="hourglass" label="Pending" value={Number(d.by_status?.pending ?? 0).toLocaleString()} tone="amber" />
          <Kpi icon="check-circle" label="Completed" value={Number(d.by_status?.completed ?? 0).toLocaleString()} tone="green" />
          <Kpi icon="ban" label="Cancelled" value={Number(d.by_status?.cancelled ?? 0).toLocaleString()} />
          <Kpi icon="undo" label="Returned" value={Number(d.by_status?.returned ?? 0).toLocaleString()} tone="red" />
          <Kpi icon="receipt" tone="blue" label="Invoiced" value={money(m.invoiced ?? 0, one)} sub={`${m.invoiced_orders ?? 0} ${m.invoiced_orders === 1 ? 'order' : 'orders'} billed`} />
          <Kpi icon="clock" label="Outstanding" value={money(m.outstanding ?? 0, one)} sub={`${money(m.paid ?? 0, one)} received`} tone={Number(m.outstanding) > 0 ? 'red' : undefined} />
        </StatGrid>
      </Panel>
      <Panel title="Order value, by currency">
        <Table
          rows={byCur}
          cols={[
            { key: 'currency', label: 'Currency', w: 110 },
            { key: 'orders', label: 'Orders', w: 90, kind: 'num' },
            { key: 'value', label: 'Total', kind: 'money' },
            { key: 'discount', label: 'Discount', kind: 'money' },
            { key: 'tax', label: 'Tax', kind: 'money' },
          ]}
        />
        {(m.average ?? []).length ? (
          <div className="border-t border-line/60 px-3.5 py-2 text-[12px] text-ink-3">
            Average order value: {(m.average as Array<{ currency: string; average: number }>).map((a) => moneyFull(a.average, cur(a.currency))).join(' · ')}
          </div>
        ) : null}
      </Panel>
      <div className="grid grid-cols-2 gap-3.5">
        <Panel title={`Order status — ${Number(status?.total ?? d.orders ?? 0).toLocaleString()} ${(status?.total ?? d.orders) === 1 ? 'order' : 'orders'}`} bodyClassName="flex flex-col gap-2.5 p-3.5">
          {bars.length ? bars.slice(0, 6).map((b) => <BarRow key={b.status} label={statusOf(b.status).label} value={`${b.orders} · ${Math.round(b.percent)}%`} pct={(b.orders / topBar) * 100} colour={statusOf(b.status).dot} />) : <Empty text="No orders in this window." />}
        </Panel>
        <Panel title="How long open orders have been waiting" bodyClassName="flex flex-col gap-2.5 p-3.5">
          {buckets.length ? buckets.map((b, i) => <BarRow key={b.key} label={b.label} value={String(b.orders)} pct={(b.orders / topBucket) * 100} colour={i > 2 ? 'var(--color-danger)' : undefined} />) : <Empty text="No open orders." />}
        </Panel>
      </div>
    </>
  );
}

function Sales({ d, group }: { d: ReportData; group: string }) {
  const rows = ((d.rows ?? []) as Array<Record<string, unknown> & { label: string; value: number; orders: number; currency: string }>).map((r) => ({ ...r, label: periodLabel(r.label, group) }));
  const top = Math.max(1, ...rows.map((r) => Number(r.value) || 0));
  const byProduct = group === 'product' || group === 'category';
  const title = GROUPS.find((g) => g.id === group)?.label ?? 'Sales';
  return (
    <>
      <Panel title={title} bodyClassName="flex flex-col gap-2.5 p-3.5">
        {rows.length ? (
          <>
            {rows.slice(0, 20).map((r, i) => (
              <BarRow key={`${r.label}-${r.currency}-${i}`} label={`${r.label}${cur(r.currency) && rows.some((x) => x.currency !== r.currency) ? ` · ${r.currency}` : ''}`} value={byProduct ? money(r.value, cur(r.currency)) : `${r.orders} · ${money(r.value, cur(r.currency))}`} pct={((Number(r.value) || 0) / top) * 100} />
            ))}
            {rows.length > 20 ? <span className="text-[11.5px] text-ink-3">The largest 20 of {rows.length}. The table below has them all.</span> : null}
          </>
        ) : (
          <Empty text="Nothing in this report." />
        )}
      </Panel>
      <Panel title="Detail">
        <Table
          rows={rows}
          cols={
            byProduct
              ? [
                  { key: 'label', label: group === 'category' ? 'Category' : 'Product' },
                  { key: 'code', label: 'Code', w: 110 },
                  { key: 'orders', label: 'Orders', w: 70, kind: 'num' },
                  { key: 'quantity', label: 'Quantity', w: 80, kind: 'num' },
                  { key: 'delivered', label: 'Delivered', w: 80, kind: 'num' },
                  { key: 'value', label: 'Value', w: 140, kind: 'money' },
                  { key: 'tax', label: 'Tax', w: 120, kind: 'money' },
                ]
              : [
                  { key: 'label', label: group === 'month' || group === 'day' ? 'Period' : 'Name' },
                  { key: 'orders', label: 'Orders', w: 64, kind: 'num' },
                  { key: 'gross', label: 'Gross', w: 120, kind: 'money' },
                  { key: 'discount', label: 'Line disc.', w: 104, kind: 'money' },
                  { key: 'coupon', label: 'Coupons', w: 96, kind: 'money' },
                  { key: 'value', label: 'Net', w: 120, kind: 'money' },
                  { key: 'average', label: 'Average', w: 110, kind: 'money' },
                  { key: 'tax', label: 'Tax', w: 100, kind: 'money' },
                ]
          }
        />
      </Panel>
    </>
  );
}

function StatusReport({ d }: { d: ReportData }) {
  const rows = (d.rows ?? []) as Array<{ status: string; orders: number; percent: number; by_currency: Array<Record<string, unknown>> }>;
  const top = Math.max(1, ...rows.map((r) => r.orders));
  return (
    <Panel title={`Order status — ${Number(d.total ?? 0).toLocaleString()} ${d.total === 1 ? 'order' : 'orders'}`} bodyClassName="flex flex-col gap-2 p-3.5">
      {rows.map((r) => (
        <div key={r.status} className="flex items-center gap-3">
          <span className="w-[170px] shrink-0">
            <StatusPill status={r.status} />
          </span>
          <span className="min-w-0 flex-1">
            <BarRow label="" value={`${r.orders} · ${r.percent}%`} pct={(r.orders / top) * 100} colour={statusOf(r.status).dot} />
          </span>
          <span className="w-[220px] shrink-0 text-right text-[12px] text-ink-3">
            <PerCurrency rows={r.by_currency} />
          </span>
        </div>
      ))}
    </Panel>
  );
}

function Payment({ d }: { d: ReportData }) {
  const c = d.counts ?? {};
  return (
    <>
      {d.counts ? (
        <StatGrid min={180}>
          <Kpi icon="alert" label="Unpaid" value={Number(c.unpaid ?? 0).toLocaleString()} tone="red" />
          <Kpi icon="percent" label="Partly paid" value={Number(c.partial ?? 0).toLocaleString()} tone="amber" />
          <Kpi icon="check-check" label="Settled" value={Number(c.settled ?? 0).toLocaleString()} tone="green" />
        </StatGrid>
      ) : null}
      <Panel title="Outstanding, largest first">
        <Table
          rows={d.rows ?? []}
          cols={[
            { key: 'so_number', label: 'Order', w: 140 },
            { key: 'order_date', label: 'Date', w: 110, kind: 'date' },
            { key: 'status', label: 'Status', w: 150, kind: 'status' },
            { key: 'invoiced', label: 'Invoiced', kind: 'money' },
            { key: 'paid', label: 'Paid', kind: 'money' },
            { key: 'outstanding', label: 'Outstanding', kind: 'money' },
          ]}
        />
      </Panel>
    </>
  );
}

function Aging({ d }: { d: ReportData }) {
  const buckets = (d.buckets ?? []) as Array<{ key: string; label: string; orders: number; by_currency: Array<Record<string, unknown>> }>;
  const top = Math.max(1, ...buckets.map((b) => b.orders));
  return (
    <>
      <Panel title="How long open orders have been waiting" bodyClassName="flex flex-col gap-2 p-3.5">
        {buckets.map((b, i) => (
          <div key={b.key} className="flex items-center gap-3">
            <span className="w-[110px] shrink-0 text-[12.5px] text-ink-2">{b.label}</span>
            <span className="min-w-0 flex-1">
              <BarRow label="" value={String(b.orders)} pct={(b.orders / top) * 100} colour={i > 2 ? 'var(--color-danger)' : undefined} />
            </span>
            <span className="w-[220px] shrink-0 text-right text-[12px] text-ink-3">
              <PerCurrency rows={b.by_currency} />
            </span>
          </div>
        ))}
      </Panel>
      <Panel title="Oldest first">
        <Table
          rows={d.rows ?? []}
          cols={[
            { key: 'so_number', label: 'Order', w: 140 },
            { key: 'order_date', label: 'Ordered', w: 110, kind: 'date' },
            { key: 'status', label: 'Status', w: 150, kind: 'status' },
            { key: 'age', label: 'Days', w: 70, kind: 'num' },
            { key: 'total', label: 'Value', kind: 'money' },
          ]}
        />
      </Panel>
    </>
  );
}

function ReturnsReport({ d }: { d: ReportData }) {
  return (
    <>
      <Panel title="Returns by reason">
        <Table rows={d.reasons ?? []} cols={[{ key: 'reason', label: 'Reason' }, { key: 'returns', label: 'Returns', w: 90, kind: 'num' }, { key: 'value', label: 'Value', w: 160, kind: 'money' }]} />
      </Panel>
      <Panel title="Returns">
        <Table
          rows={d.returns ?? []}
          cols={[
            { key: 'return_date', label: 'Date', w: 110, kind: 'date' },
            { key: 'so_number', label: 'Order', w: 140 },
            { key: 'client', label: 'Customer' },
            { key: 'status', label: 'Status', w: 110 },
            { key: 'reason', label: 'Reason', w: 130 },
            { key: 'value', label: 'Value', w: 150, kind: 'money' },
          ]}
        />
      </Panel>
      {/* Named for what they are: nothing records a reason for cancelling, so these are the approvers' rejection reasons. */}
      <Panel title="Rejection reasons">
        <Table rows={d.rejections ?? []} cols={[{ key: 'reason', label: 'Reason' }, { key: 'count', label: 'Times', w: 90, kind: 'num' }]} />
      </Panel>
    </>
  );
}

function CouponUsage({ d }: { d: ReportData }) {
  return (
    <Panel title="Coupon usage">
      <Table
        rows={d.rows ?? []}
        cols={[
          { key: 'code', label: 'Code', w: 120 },
          { key: 'name', label: 'Name' },
          { key: 'uses', label: 'Uses', w: 70, kind: 'num' },
          { key: 'customers', label: 'Customers', w: 90, kind: 'num' },
          { key: 'given', label: 'Given away', w: 140, kind: 'money' },
          { key: 'revenue', label: 'Order value', w: 150, kind: 'money' },
          { key: 'return', label: 'Per unit given', w: 110, kind: 'num' },
        ]}
      />
    </Panel>
  );
}
