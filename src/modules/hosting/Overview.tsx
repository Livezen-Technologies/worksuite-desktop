import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { text } from '../../core/i18n';
import { useTab } from '../../core/tab-context';
import { daysLeft, fetchDomains, type Overview as Data } from './api';
import type { Nav } from './HostingShell';
import { Btn, Card, Days, Kbd, Kpi, NeedsUpdate, PageHead, Table, td, useReadOnly, when } from './parts';

/**
 * The overview (D-01): six counts, renewals in the next 90 days and what needs attention, from the server's
 * `overview`. On a server without it, the domains expiring within 90 days stand in for the renewals.
 */
export default function Overview({ data, org, nav, syncing, onSyncAll }: { data: UseQueryResult<Data | null>; org: number; nav: Nav; syncing: boolean; onSyncAll: () => void }) {
  const ro = useReadOnly();
  const { openLink } = useTab();
  const missing = data.isSuccess && data.data === null;
  const fallback = useQuery({ queryKey: ['hosting', 'domains', { expires_within: 90, org, sort: 'expires_on' }], queryFn: ({ signal }) => fetchDomains({ expires_within: 90, org, sort: 'expires_on', per_page: 50 }, signal), enabled: missing });
  if (data.isPending) return <Spinner />;
  if (data.isError) return <ErrorNote error={data.error} onRetry={() => void data.refetch()} />;
  const o = data.data;
  const k = o?.kpi ?? {};
  const renewals = o?.renewals ?? (fallback.data?.items ?? []).map((d) => ({ kind: 'domain', id: d.id, name: d.name, expires_on: d.expires_on, days_left: daysLeft(d), note: d.auto_renew === false ? text('auto-renew off') : (d.registrar ?? d.provider ?? null) }));

  return (
    <div className="flex flex-col gap-4">
      <PageHead title="Overview" sub={o?.synced_at ? text('{orgs} · synced {time}', { orgs: (o.orgs ?? []).join(', ') || text('All my companies'), time: when(o.synced_at) }) : undefined}>
        <Btn disabled={ro || syncing} title={ro ? 'Needs a connection' : undefined} onClick={onSyncAll}>
          {syncing ? 'Syncing…' : 'Sync all'} <Kbd>⌘⇧S</Kbd>
        </Btn>
        <Btn primary disabled={ro} title={ro ? 'Needs a connection' : undefined} onClick={() => nav.to('new')}>
          Add domain <Kbd>⌘N</Kbd>
        </Btn>
      </PageHead>
      {missing ? <NeedsUpdate what={text('The overview')} /> : null}
      {o ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Kpi label="Domains" value={k.domains ?? '—'} />
          <Kpi label="Expiring 30 d" value={k.expiring_30 ?? '—'} tone={k.expiring_30 ? 'warn' : undefined} />
          <Kpi label="Certs at risk" value={k.certs_at_risk ?? '—'} tone={k.certs_at_risk ? 'warn' : undefined} />
          <Kpi label="Servers" value={k.servers ?? '—'} />
          <Kpi label="Monitors down" value={k.monitors_down ?? '—'} tone={k.monitors_down ? 'warn' : undefined} />
          <Kpi label="Per month" value={k.monthly ? `${k.monthly_currency ?? ''} ${k.monthly}`.trim() : '—'} />
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card title="Renewals · next 90 days">
          {renewals.length ? (
            <Table head={['Name', 'Kind', 'Days left', 'Note']} label="Renewals">
              {renewals.map((r) => (
                <tr
                  key={`${r.kind}-${r.id}`}
                  className="cursor-pointer hover:bg-subtle"
                  onClick={(e) => (r.kind === 'domain' ? nav.openDomain(r.id, e.metaKey || e.ctrlKey ? 'tab' : 'here', r.name) : r.kind === 'server' ? nav.openServer(r.id, 'here', r.name) : nav.to('certificates', `&certificate=${r.id}`))}
                >
                  <td className={cx(td, 'font-semibold')}>{r.name}</td>
                  <td className={td}>{r.kind === 'domain' ? 'Domain' : r.kind === 'server' ? 'Server' : 'Certificate'}</td>
                  <td className={td}>
                    <Days days={daysLeft(r)} long />
                  </td>
                  <td className={cx(td, 'text-ink-3')}>{r.note ?? ''}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <p className="m-0 px-3.5 pb-3 text-[12.5px] text-ink-3">Nothing renews in the next 90 days.</p>
          )}
        </Card>
        <Card title="Needs attention">
          {(o?.attention ?? []).length ? (
            <ul className="m-0 flex list-none flex-col gap-2.5 px-3.5 pb-3">
              {(o?.attention ?? []).map((a, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className={cx('mt-[5px] size-2 shrink-0 rounded-full', a.tone === 'red' ? 'bg-[#B42318]' : 'bg-[#B45309]')} />
                  <button type="button" disabled={!a.link} onClick={() => openLink(a.link)} className="min-w-0 text-left disabled:cursor-default">
                    <div className="text-[12.5px] font-semibold text-ink">{a.title}</div>
                    {a.detail ? <div className="text-[11.5px] text-ink-3">{a.detail}</div> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 px-3.5 pb-3 text-[12.5px] text-ink-3">{o ? 'Nothing needs you now.' : 'Shown once the server has the overview.'}</p>
          )}
        </Card>
      </div>
    </div>
  );
}
