import { useQuery } from '@tanstack/react-query';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { text } from '../../core/i18n';
import { fetchCosts, K } from './api';
import { Card, Kpi, NeedsUpdate, PageHead, Table, td, tdr } from './parts';

/** Costs (HDM-CST-02): the monthly totals per currency and the cost by client, project, provider and month — all the server's. */
export default function Costs({ org }: { org: number }) {
  const q = useQuery({ queryKey: K.costs(org), queryFn: ({ signal }) => fetchCosts(org, signal) });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  if (q.data === null) return (
    <div className="flex flex-col gap-3">
      <PageHead title="Costs" />
      <NeedsUpdate what={text('Costs')} />
    </div>
  );
  const c = q.data;
  const groups = [...new Set((c.by ?? []).map((r) => r.group))];
  return (
    <div className="flex flex-col gap-4">
      <PageHead title="Costs" sub="Monthly equivalents, as WorkSuite works them out" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(c.totals ?? []).map((t) => (
          <Kpi key={t.currency} label={text('Per month · {currency}', { currency: t.currency })} value={t.monthly} />
        ))}
      </div>
      {groups.map((g) => (
        <Card key={g} title={text('By {group}', { group: g })}>
          <Table head={['Name', ['Per month', 'r']]} label={text('By {group}', { group: g })}>
            {(c.by ?? [])
              .filter((r) => r.group === g)
              .map((r, i) => (
                <tr key={i}>
                  <td className={cx(td, 'font-semibold')}>{r.label}</td>
                  <td className={tdr}>{`${r.currency} ${r.amount}`}</td>
                </tr>
              ))}
          </Table>
        </Card>
      ))}
      {(c.months ?? []).length ? (
        <Card title="By month">
          <Table head={['Month', ['Amount', 'r']]} label="By month">
            {(c.months ?? []).map((m, i) => (
              <tr key={i}>
                <td className={td}>{m.month}</td>
                <td className={tdr}>{`${m.currency} ${m.amount}`}</td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : null}
    </div>
  );
}
