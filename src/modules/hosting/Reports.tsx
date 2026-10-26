import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { text } from '../../core/i18n';
import { daysLeft, fetchReport, K, money, type CostGroup, type Monitor, type Renewal, type ReportName } from './api';
import { printRenewals } from './files';
import type { Nav } from './HostingShell';
import { renewalNote } from './Overview';
import { Btn, Card, Days, ExportButton, NeedsUpdate, PageHead, Pills, Status, Table, td, tdr, useReadOnly } from './parts';

/**
 * Reports (HDM-RPT-02, HDM-IMP-03) from `GET reports/{name}`: the renewal calendar for the next 30 to 365 days — with
 * Export (the server's CSV or Excel, `export/renewals`) and Print (`print/renewals`, in the desktop's print dialog) —
 * the monthly cost by customer, provider spend with its months, and uptime per monitor. Every figure is the server's.
 */
const REPORTS: Array<{ id: ReportName; label: string }> = [
  { id: 'renewals', label: 'Renewals' },
  { id: 'cost-by-client', label: 'Cost by customer' },
  { id: 'provider-spend', label: 'Provider spend' },
  { id: 'uptime', label: 'Uptime' },
];
const DAYS = [30, 60, 90, 180, 365];

export default function Reports({ org, nav }: { org: number; nav: Nav }) {
  const ro = useReadOnly();
  const [name, setName] = useState<ReportName>('renewals');
  const [days, setDays] = useState(90);
  const query = name === 'renewals' ? { org, days } : { org };
  const q = useQuery({ queryKey: K.report(name, query), queryFn: ({ signal }) => fetchReport<Record<string, unknown>>(name, query, signal), placeholderData: keepPreviousData });
  const d = q.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHead title="Reports">
        {name === 'renewals' ? (
          <>
            <Select aria-label="Days ahead" value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-8 rounded-[7px] border border-line bg-surface px-2 text-[12px] font-semibold text-ink">
              {DAYS.map((n) => (
                <option key={n} value={n}>
                  {text('Next {n} days', { n })}
                </option>
              ))}
            </Select>
            <ExportButton kind="renewals" query={{ org: org || undefined, days }} disabled={ro} />
            <Btn disabled={ro} title={ro ? 'Needs a connection' : undefined} onClick={() => void printRenewals(days, org)}>
              Print
            </Btn>
          </>
        ) : null}
      </PageHead>
      <Pills<ReportName> label="Report" value={name} onChange={setName} options={REPORTS.map((r) => ({ id: r.id, label: text(r.label) }))} />
      {q.isPending ? <Spinner /> : q.isError ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : d === null || d === undefined ? <NeedsUpdate what={text('Reports')} /> : name === 'renewals' ? (
        <RenewalsReport items={(d.items as Renewal[] | undefined) ?? []} nav={nav} />
      ) : name === 'uptime' ? (
        <UptimeReport items={(d.items as Monitor[] | undefined) ?? []} />
      ) : (
        <CostReport groups={(d.groups as CostGroup[] | undefined) ?? []} currency={String(d.currency ?? '')} total={typeof d.total === 'number' ? d.total : null} months={name === 'provider-spend' ? ((d.by_month as Array<{ month: string; amount: number }> | undefined) ?? []) : []} by={name === 'cost-by-client' ? text('Customer') : text('Provider')} />
      )}
    </div>
  );
}

function RenewalsReport({ items, nav }: { items: Renewal[]; nav: Nav }) {
  if (!items.length) return <p className="m-0 text-[12.5px] text-ink-3">Nothing renews in this time.</p>;
  return (
    <Card>
      <Table head={['Name', 'Kind', 'Expires', 'Days left', 'Note']} label="Renewals">
        {items.map((r) => (
          <tr key={`${r.kind}-${r.id}`} className="cursor-pointer hover:bg-subtle" onClick={() => (r.kind === 'domain' ? nav.openDomain(r.id, 'tab', r.name) : r.kind === 'server' ? nav.openServer(r.id, 'tab', r.name) : nav.to('certificates', `&certificate=${r.id}`, true))}>
            <td className={cx(td, 'font-semibold')}>{r.name}</td>
            <td className={td}>{r.kind === 'domain' ? text('Domain') : r.kind === 'server' ? text('Server') : text('Certificate')}</td>
            <td className={cx(td, 'tabular-nums')}>{r.expires_on ?? '—'}</td>
            <td className={td}>
              <Days days={daysLeft(r)} long />
            </td>
            <td className={cx(td, 'text-ink-3')}>{renewalNote(r)}</td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

function CostReport({ groups, currency, total, months, by }: { groups: CostGroup[]; currency: string; total: number | null; months: Array<{ month: string; amount: number }>; by: string }) {
  return (
    <div className="flex flex-col gap-4">
      <Card title={total !== null ? text('{total} a month', { total: money(total, currency) }) : undefined}>
        {groups.length ? (
          <Table head={[by, ['Domains', 'r'], ['Servers', 'r'], ['Per month', 'r']]} label={by}>
            {groups.map((g) => (
              <tr key={g.key}>
                <td className={cx(td, 'font-semibold')}>{g.label}</td>
                <td className={tdr}>{g.domains}</td>
                <td className={tdr}>{g.servers}</td>
                <td className={tdr}>{money(g.monthly, currency)}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="m-0 px-3.5 py-3 text-[12.5px] text-ink-3">No costs are recorded yet.</p>
        )}
      </Card>
      {months.length ? (
        <Card title="Paid by month">
          <Table head={['Month', ['Amount', 'r']]} label="Paid by month">
            {months.map((m) => (
              <tr key={m.month}>
                <td className={td}>{m.month}</td>
                <td className={tdr}>{money(m.amount, currency)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : null}
    </div>
  );
}

function UptimeReport({ items }: { items: Monitor[] }) {
  if (!items.length) return <p className="m-0 text-[12.5px] text-ink-3">No monitors yet.</p>;
  const pct = (v: number | null | undefined) => (typeof v === 'number' ? `${v}%` : '—');
  return (
    <Card>
      <Table head={['Monitor', 'Kind', 'State', ['24 hours', 'r'], ['30 days', 'r']]} label="Uptime">
        {items.map((m) => (
          <tr key={m.id}>
            <td className={cx(td, 'font-semibold')}>{m.name || m.target}</td>
            <td className={td}>{m.kind.toUpperCase()}</td>
            <td className={td}>
              <Status value={m.state} />
            </td>
            <td className={tdr}>{pct(m.uptime_24h)}</td>
            <td className={tdr}>{pct(m.uptime_30d)}</td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}
