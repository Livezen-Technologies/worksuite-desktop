import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { dateLabel } from '../../core/time';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { Empty, PageHead } from '../hr/parts';
import { cost, MOVE_LABEL, num, qty, stampWords, type Warehouse } from './api';
import { fetchReport, KI, reportQuery, reportsFor, reportView, SERIAL_STATE, type Col, type ReportData, type ReportDef } from './insight';
import { minWidth, Pill } from './parts';
import { pick } from './pickers';

/**
 * Reports (InvReports): what the server works out from the movement ledger
 * and the cost layers, one at a time. The warehouse is the rail's; the
 * window, a serial's state and which labels are the report's own. Every
 * report shows the server's note on how its figures were arrived at.
 */
const DAYS = [{ value: '', label: 'Its usual window' }, ...['30', '60', '90', '180', '365'].map((d) => ({ value: d, label: `${d} days` }))];
const STATES = [{ value: '', label: 'Every unit' }, ...['in_stock', 'delivered', 'returned', 'scrapped'].map((s) => ({ value: s, label: SERIAL_STATE[s]! }))];
const ONLY = [
  { value: 'untagged', label: 'Still to be tagged' },
  { value: 'tagged', label: 'Already tagged' },
  { value: '', label: 'Every unit' },
];

export default function Reports({
  org,
  warehouse,
  warehouses,
  currency,
  canCost,
  report,
  onReport,
}: {
  org: string;
  warehouse: number | null;
  warehouses: Warehouse[];
  currency: string | null;
  canCost: boolean;
  report: string | null;
  onReport: (key: string) => void;
}) {
  const list = reportsFor(canCost);
  const def = list.find((r) => r.key === report) ?? list.find((r) => r.key === 'balance')!;
  const [days, setDays] = useState('');
  const [serialStatus, setSerialStatus] = useState('');
  const [only, setOnly] = useState('untagged');
  const q = reportQuery(def, { warehouse, days, serialStatus, only });
  const data = useQuery({ queryKey: KI.report(def.key, org, q), queryFn: ({ signal }) => fetchReport(def.key, org, q, signal), placeholderData: keepPreviousData });
  const whName = warehouse ? (warehouses.find((w) => w.id === warehouse)?.name ?? 'that warehouse') : null;
  const groups = ['Stock', 'Movement', 'Money', 'Serials'] as const;

  return (
    <div className="flex h-full min-h-0 gap-5 px-6 py-5">
      <nav aria-label="Reports" className="flex w-[190px] shrink-0 flex-col gap-0.5 overflow-y-auto scroll-thin">
        {groups.map((g, gi) =>
          list.some((r) => r.group === g) ? (
            <div key={g} className={cx('flex flex-col gap-0.5', gi > 0 && 'mt-3')}>
              <div className="mb-0.5 px-2 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">{g}</div>
              {list
                .filter((r) => r.group === g)
                .map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    data-report={r.key}
                    aria-current={r.key === def.key ? 'page' : undefined}
                    onClick={() => onReport(r.key)}
                    className={cx('h-[29px] rounded-[7px] px-2.5 text-left text-[12.5px]', r.key === def.key ? 'bg-info-bg font-bold text-info-ink dark:bg-selection dark:text-primary' : 'font-medium text-ink hover:bg-subtle')}
                  >
                    {r.label}
                  </button>
                ))}
            </div>
          ) : null,
        )}
        {!canCost ? <span className="mt-3 px-2 text-[11.5px] leading-snug text-ink-3">Reports that are all money need cost access.</span> : null}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <PageHead title={def.label} sub={<Scope def={def} whName={whName} />}>
          {def.filters.includes('days') ? <Select aria-label="Window" value={days} onValueChange={setDays} options={DAYS} className={pick + ' !w-[170px]'} /> : null}
          {def.filters.includes('serialStatus') ? <Select aria-label="Unit state" value={serialStatus} onValueChange={setSerialStatus} options={STATES} className={pick + ' !w-[150px]'} /> : null}
          {def.filters.includes('only') ? <Select aria-label="Which units" value={only} onValueChange={setOnly} options={ONLY} className={pick + ' !w-[170px]'} /> : null}
        </PageHead>
        {data.isLoading ? <Spinner /> : data.error ? <ErrorNote error={data.error} onRetry={() => void data.refetch()} /> : data.data ? <Body def={def} data={data.data} currency={currency} /> : null}
      </div>
    </div>
  );
}

function Scope({ def, whName }: { def: ReportDef; whName: string | null }) {
  if (!def.filters.includes('warehouse')) return <>Every warehouse you can see</>;
  return <>{whName ? `In ${whName} — the warehouse picked in the rail` : 'Every warehouse — pick one in the rail to narrow it'}</>;
}

function Body({ def, data, currency }: { def: ReportDef; data: ReportData; currency: string | null }) {
  const v = reportView(def.key, data, currency);
  return (
    <div data-report-body className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto scroll-thin">
      {v.headline ? (
        <b data-report-headline className="text-[15px] text-ink">
          {v.headline}
        </b>
      ) : null}
      {v.tiles.length ? (
        <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${Math.min(v.tiles.length, 5)}, minmax(0, 1fr))` }}>
          {v.tiles.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5 rounded-[10px] border border-line bg-surface px-3 py-2.5">
              <b className="text-[14px] text-ink tabular-nums">{value}</b>
              <span className="text-[11.5px] text-ink-3">{label}</span>
            </div>
          ))}
        </div>
      ) : null}
      {v.chips.length ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="text-ink-3">Every state in this selection:</span>
          {v.chips.map(([label, count]) => (
            <span key={label} className="rounded-full bg-subtle px-2.5 py-1 text-ink-2">
              {label} <b className="text-ink tabular-nums">{count.toLocaleString()}</b>
            </span>
          ))}
        </div>
      ) : null}
      {v.tables.map((t, i) => (
        <section key={i} className="flex flex-col gap-1.5">
          {t.title ? <b className="text-[13px] text-ink">{t.title}</b> : null}
          <Table rows={t.rows} cols={t.cols} empty={t.empty} />
        </section>
      ))}
      {v.notes.map((note) => (
        <span key={note} role="note" className="rounded-[8px] bg-warning-bg px-3 py-2 text-[12.5px] text-warning-ink dark:text-warning">
          {note}
        </span>
      ))}
      {v.basis ? <span className="text-[12px] leading-relaxed text-ink-3">{v.basis}</span> : null}
    </div>
  );
}

const RIGHT = new Set(['qty', 'cost', 'pct', 'days']);

function cell(c: Col, r: ReportData): ReactNode {
  const v = r[c.key];
  switch (c.fmt) {
    case 'qty':
      return num(v) === null ? '—' : `${qty(num(v)!)}${r.unit ? ` ${r.unit}` : ''}`;
    case 'cost':
      return cost(v, null);
    case 'pct':
      return num(v) === null ? '—' : `${v}%`;
    case 'days':
      return num(v) === null ? '—' : `${num(v)} d`;
    case 'date':
      return v ? dateLabel(String(v)) : '—';
    case 'stamp':
      return v ? stampWords(String(v)) : '—';
    case 'status':
      return v ? (SERIAL_STATE[v] ?? String(v)) : '—';
    case 'move':
      return v ? (MOVE_LABEL[v] ?? String(v)) : '—';
    case 'class':
      return <Pill tone={v === 'A' ? 'green' : v === 'B' ? 'amber' : 'grey'}>{v}</Pill>;
    default:
      return v === null || v === undefined || v === '' ? '—' : String(v);
  }
}

function Table({ rows, cols, empty }: { rows: ReportData[]; cols: Col[]; empty: string }) {
  if (!rows.length) return <Empty text={empty} />;
  const fixed = cols.filter((c) => c.width).map((c) => c.width!);
  return (
    <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
      <div className="max-h-[560px] overflow-auto scroll-thin">
        <div style={{ minWidth: minWidth(160, fixed) }}>
          <div className="sticky top-0 z-10 flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
            {cols.map((c) => (
              <span key={c.key} className={cx(c.width ? 'shrink-0' : 'min-w-0 flex-1', RIGHT.has(c.fmt ?? '') && 'text-right')} style={c.width ? { width: c.width } : undefined}>
                {c.label}
              </span>
            ))}
          </div>
          {rows.map((r, i) => (
            <div key={r.id ?? r.product_id ?? r.batch_id ?? r.warehouse_id ?? r.vendor_id ?? r.day ?? i} data-report-row className="flex items-center gap-2.5 border-b border-line/60 px-3.5 py-1.5 text-[12.5px] last:border-b-0">
              {cols.map((c) => (
                <span
                  key={c.key}
                  className={cx(c.width ? 'shrink-0 truncate' : 'min-w-0 flex-1 truncate', RIGHT.has(c.fmt ?? '') ? 'text-right tabular-nums' : '', c.fmt === 'code' ? 'font-mono text-[11.5px] text-ink-2' : 'text-ink')}
                  style={c.width ? { width: c.width } : undefined}
                >
                  {cell(c, r)}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
