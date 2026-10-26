import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { text } from '../../core/i18n';
import { daysLeft, fetchDomains, money, type Attention, type Overview as Data, type Renewal } from './api';
import type { Nav } from './HostingShell';
import { Btn, Card, Days, Kbd, Kpi, MenuButton, NeedsUpdate, PageHead, Table, td, useReadOnly, when } from './parts';
import { StatGrid } from '../../components/StatCard';

/**
 * The overview (D-01) from the server's `GET overview` (Overview::build): the domains, the 30-day expiries, the
 * certificates at risk, the servers, the monitors down and the monthly cost — each the count the matching list shows —
 * the renewals in the next 90 days and what needs attention. On a server without it, the domains expiring within 90
 * days stand in for the renewals.
 */
export const renewalNote = (r: Renewal) => [r.auto_renew === false ? text('auto-renew off') : r.auto_renew ? text('auto-renew on') : null, r.cost ? money(r.cost.amount, r.cost.currency) : null].filter(Boolean).join(' · ');

/** Where an attention item opens: the account, the incident's monitors, the certificate or the domain. */
export function openAttention(a: Attention, nav: Nav, newTab = false): void {
  if (a.kind === 'domain') nav.openDomain(a.id, newTab ? 'tab' : 'here');
  else if (a.kind === 'certificate') nav.to('certificates', `&certificate=${a.id}`, newTab);
  else if (a.kind === 'incident') nav.to('monitors', '', newTab);
  else if (a.kind === 'account') nav.to('accounts', '', newTab);
}

export default function Overview({ data, org, nav, syncing, onSyncAll }: { data: UseQueryResult<Data | null>; org: number; nav: Nav; syncing: boolean; onSyncAll: () => void }) {
  const ro = useReadOnly();
  const missing = data.isSuccess && data.data === null;
  const fallback = useQuery({ queryKey: ['hosting', 'domains', { expires_within: 90, org, sort: 'expires_on' }], queryFn: ({ signal }) => fetchDomains({ expires_within: 90, org, sort: 'expires_on', per_page: 50 }, signal), enabled: missing });
  if (data.isPending) return <Spinner />;
  if (data.isError) return <ErrorNote error={data.error} onRetry={() => void data.refetch()} />;
  const o = data.data;
  const renewals: Renewal[] = o?.renewals ?? (fallback.data?.items ?? []).map((d) => ({ kind: 'domain', id: d.id, name: d.name, expires_on: d.expires_on, days_left: daysLeft(d), auto_renew: d.auto_renew ?? null, cost: d.renew_price ? { amount: d.renew_price, currency: d.renew_currency ?? '' } : null }));
  const attention = o?.attention ?? [];
  const n = (v: number | undefined) => (typeof v === 'number' ? v : '—');

  return (
    <div className="flex flex-col gap-4">
      <PageHead title="Overview" sub={o?.as_of ? text('As of {time}', { time: when(o.as_of) }) : undefined}>
        <MenuButton
          label={text('More')}
          items={[
            { id: 'register', label: text('Find and register a domain…'), disabled: ro, onSelect: () => nav.to('register') },
            { id: 'import', label: text('Import from CSV…'), disabled: ro, onSelect: () => nav.to('import') },
            { id: 'reports', label: text('Reports'), onSelect: () => nav.to('reports') },
          ]}
        />
        <Btn disabled={ro || syncing} title={ro ? 'Needs a connection' : undefined} onClick={onSyncAll}>
          {syncing ? 'Syncing…' : 'Sync all'} <Kbd>⌘⇧S</Kbd>
        </Btn>
        <Btn primary disabled={ro} title={ro ? 'Needs a connection' : undefined} onClick={() => nav.to('new')}>
          Add domain <Kbd>⌘N</Kbd>
        </Btn>
      </PageHead>
      {missing ? <NeedsUpdate what={text('The overview')} /> : null}
      {o ? (
        <StatGrid min={180}>
          <Kpi icon="globe" tone="blue" label="Domains" value={n(o.domains?.total)} sub={o.domains?.manual ? text('{n} added by hand', { n: o.domains.manual }) : undefined} />
          <Kpi icon="calendar-clock" label="Expiring 30 d" value={n(o.domains?.within_30)} tone={o.domains?.within_30 ? 'warn' : undefined} sub={o.domains?.renew_off_30 ? text('{n} with auto-renew off', { n: o.domains.renew_off_30 }) : undefined} />
          <Kpi icon="shield-alert" label="Certs at risk" value={n(o.certificates?.at_risk)} tone={o.certificates?.at_risk ? 'warn' : undefined} />
          <Kpi icon="server" tone="violet" label="Servers" value={n(o.servers?.total)} sub={o.servers?.stopped ? text('{n} stopped', { n: o.servers.stopped }) : undefined} />
          <Kpi icon="activity" label="Monitors down" value={n(o.monitors?.down)} tone={o.monitors?.down ? 'red' : undefined} sub={o.monitors?.open_incidents ? text('{n} open incidents', { n: o.monitors.open_incidents }) : undefined} />
          <Kpi icon="coins" tone="cyan" label="Per month" value={typeof o.cost?.monthly === 'number' ? money(o.cost.monthly, o.cost.currency ?? o.currency) : '—'} sub={o.cost?.unconverted?.length ? text('plus {list} not converted', { list: o.cost.unconverted.map((u) => money(u.monthly, u.currency)).join(', ') }) : undefined} />
        </StatGrid>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card title="Renewals · next 90 days">
          {renewals.length ? (
            <Table head={['Name', 'Kind', 'Days left', 'Note']} label="Renewals">
              {renewals.map((r) => (
                <tr
                  key={`${r.kind}-${r.id}`}
                  className="cursor-pointer hover:bg-subtle"
                  onClick={(e) => {
                    const tab = e.metaKey || e.ctrlKey;
                    if (r.kind === 'domain') nav.openDomain(r.id, tab ? 'tab' : 'here', r.name);
                    else if (r.kind === 'server') nav.openServer(r.id, tab ? 'tab' : 'here', r.name);
                    else nav.to('certificates', `&certificate=${r.id}`, tab);
                  }}
                >
                  <td className={cx(td, 'font-semibold')}>{r.name}</td>
                  <td className={td}>{r.kind === 'domain' ? text('Domain') : r.kind === 'server' ? text('Server') : text('Certificate')}</td>
                  <td className={td}>
                    <Days days={daysLeft(r)} long />
                  </td>
                  <td className={cx(td, 'text-ink-3')}>{renewalNote(r)}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <p className="m-0 px-3.5 pb-3 text-[12.5px] text-ink-3">Nothing renews in the next 90 days.</p>
          )}
        </Card>
        <Card title="Needs attention">
          {attention.length ? (
            <ul className="m-0 flex list-none flex-col gap-2.5 px-3.5 pb-3">
              {attention.map((a) => (
                <li key={`${a.kind}-${a.id}`} className="flex gap-2.5">
                  <span className={cx('mt-[5px] size-2 shrink-0 rounded-full', a.severity === 'error' ? 'bg-[#B42318]' : 'bg-[#B45309]')} />
                  <button type="button" onClick={(e) => openAttention(a, nav, e.metaKey || e.ctrlKey)} className="min-w-0 text-left hover:underline">
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
