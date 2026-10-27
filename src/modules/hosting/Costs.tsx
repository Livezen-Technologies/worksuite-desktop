import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { text } from '../../core/i18n';
import { fetchCosts, K, money } from './api';
import type { Nav } from './HostingShell';
import { Btn, Card, Kpi, NeedsUpdate, PageHead, Pills, Table, td, tdr } from './parts';
import { StatGrid } from '../../components/StatCard';

/**
 * Costs (HDM-CST-02) from `GET costs?by=client|project|provider&currency=`: the monthly total in the reporting
 * currency, what could not be converted, the groups with their domains and servers, and the spend by month — all the
 * server's figures. Reports (renewals, cost by client, provider spend, uptime) are a step away.
 */
type By = 'client' | 'project' | 'provider';

export default function Costs({ org, nav }: { org: number; nav?: Nav }) {
  const [by, setBy] = useState<By>('client');
  const [currency, setCurrency] = useState('');
  const q = useQuery({ queryKey: K.costs(org, by, currency), queryFn: ({ signal }) => fetchCosts(org, by, currency, signal), placeholderData: keepPreviousData });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  if (q.data === null)
    return (
      <div className="flex flex-col gap-3">
        <PageHead title="Costs" />
        <NeedsUpdate what={text('Costs')} />
      </div>
    );
  const c = q.data;
  const cur = c.currency ?? '';
  return (
    <div className="flex flex-col gap-4">
      <PageHead title="Costs" sub="Monthly equivalents, as WorkSuite works them out">
        {(c.currencies ?? []).length ? (
          <Select aria-label="Currency" value={currency || cur} onChange={(e) => setCurrency(e.target.value)} className="h-8 rounded-[7px] border border-line bg-surface px-2 text-[12px] font-semibold text-ink">
            {(c.currencies ?? []).map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </Select>
        ) : null}
        {nav ? <Btn onClick={() => nav.to('reports')}>Reports</Btn> : null}
      </PageHead>
      <StatGrid>
        <Kpi icon="coins" tone="cyan" label={text('Per month · {currency}', { currency: cur })} value={money(c.total ?? 0, cur)} />
        {(c.unconverted ?? []).map((u) => (
          <Kpi icon="arrow-left-right" tone="amber" key={u.currency} label={text('Not converted · {currency}', { currency: u.currency })} value={money(u.monthly, u.currency)} sub={text('No rate to {currency}', { currency: cur })} />
        ))}
      </StatGrid>
      <Card
        title={text('By {group}', { group: by === 'client' ? text('customer') : by === 'project' ? text('project') : text('provider') })}
        action={<Pills<By> label="Group by" value={by} onChange={setBy} options={[{ id: 'client', label: text('Customer') }, { id: 'project', label: text('Project') }, { id: 'provider', label: text('Provider') }]} />}
      >
        {(c.groups ?? []).length ? (
          <Table head={['Name', ['Domains', 'r'], ['Servers', 'r'], ['Per month', 'r']]} label={text('By {group}', { group: by })}>
            {(c.groups ?? []).map((g) => (
              <tr key={g.key}>
                <td className={cx(td, 'font-semibold')}>{g.label}</td>
                <td className={tdr}>{g.domains}</td>
                <td className={tdr}>{g.servers}</td>
                <td className={tdr}>{money(g.monthly, cur)}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="m-0 px-3.5 pb-3 text-[12.5px] text-ink-3">No costs are recorded yet.</p>
        )}
      </Card>
      {(c.by_month ?? []).length ? (
        <Card title="Paid by month">
          <Table head={['Month', ['Amount', 'r']]} label="Paid by month">
            {(c.by_month ?? []).map((m) => (
              <tr key={m.month}>
                <td className={td}>{m.month}</td>
                <td className={tdr}>{money(m.amount, cur)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : null}
    </div>
  );
}
