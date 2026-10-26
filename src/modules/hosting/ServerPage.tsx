import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorNote, Spinner } from '../../components/ui';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { useTabTitle } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { fetchMetrics, fetchOrgs, fetchServer, fetchServerActivity, fetchSnapshots, K, money, offers, serverTask, takeSnapshot, type Metrics as MetricsData, type PowerAction } from './api';
import type { Nav } from './HostingShell';
import { Btn, Card, Chip, Days, NeedsUpdate, Note, PageHead, Pills, Row, Status, useReadOnly, when } from './parts';
import { isRunning, PowerDialog, supports } from './Servers';
import { ServerForm } from './ServerForm';

/**
 * One server in its own tab or window (HDM-DSK-03, SRV-01/04/05/06/08) from `GET servers/{id}`: its facts, the domains
 * and certificates it serves, power actions, snapshots (`GET servers/{id}/snapshots` → `{available, why, items}`), the
 * provider's CPU / network / disk graphs for 24 h or 7 d (`GET servers/{id}/metrics` → `{available, why, series}`),
 * its activity, and Edit. What the provider's API does not offer says so in the server's words.
 */
export default function ServerPage({ id, nav }: { id: number; nav: Nav }) {
  const ro = useReadOnly();
  const one = useQuery({ queryKey: K.server(id), queryFn: ({ signal }) => fetchServer(id, signal) });
  const orgs = useQuery({ queryKey: K.orgs, queryFn: ({ signal }) => fetchOrgs(signal), staleTime: 300_000 });
  const [power, setPower] = useState<PowerAction | null>(null);
  const [edit, setEdit] = useState(false);
  useTabTitle(one.data?.name ?? null);
  if (one.isPending) return <Spinner />;
  if (one.isError) return <ErrorNote error={one.error} onRetry={() => void one.refetch()} />;
  const s = one.data;
  if (!s) return <Note tone="warn">This server is not in your register any more.</Note>;
  const off = ro ? 'Needs a connection' : undefined;
  const running = isRunning(s);
  const acts: PowerAction[] = !supports(s, 'reboot') ? [] : running ? ['reboot', 'power_off'] : s.status === 'cancelled' ? [] : ['power_on'];
  const task = async () => {
    try {
      const m = await serverTask(s.id);
      toast(m === null ? 'info' : 'success', m === null ? text('Renewal tasks need a server update.') : m || text('Renewal task created.'));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHead title={s.name} sub={[s.source === 'manual' ? text('Added by hand') : (s.provider_label ?? s.provider), s.account_name, s.location, s.synced_at ? text('read {time}', { time: when(s.synced_at) }) : null].filter(Boolean).join(' · ')}>
        <Btn onClick={() => nav.openServer(s.id, 'window', s.name)}>Pop out</Btn>
        <Btn disabled={ro} title={off} onClick={() => setEdit(true)}>
          Edit…
        </Btn>
        {s.tasks_available ? (
          <Btn disabled={ro} title={off} onClick={() => void task()}>
            Create renewal task
          </Btn>
        ) : null}
        {acts.map((a) => (
          <Btn key={a} danger={a === 'power_off'} disabled={ro} title={off} onClick={() => setPower(a)}>
            {a === 'power_on' ? 'Power on' : a === 'reboot' ? 'Reboot' : 'Power off'}
          </Btn>
        ))}
      </PageHead>
      {s.source === 'sync' && !offers(s, 'server_actions') ? <p className="m-0 text-[11.5px] text-ink-3">{text('{provider} does not offer power actions through its API.', { provider: s.provider_label ?? text('The provider') })}</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Facts">
          <div className="px-3.5 pb-3">
            <Row label="Status">
              <Status value={s.status} label={s.status_label} />
            </Row>
            <Row label="Kind">{s.kind_label ?? s.kind ?? '—'}</Row>
            <Row label="Plan">{s.plan ?? '—'}</Row>
            <Row label="CPU · RAM · Disk">{[s.cpu, s.ram, s.storage].map((v) => v ?? '—').join(' · ')}</Row>
            <Row label="OS">{s.os ?? '—'}</Row>
            <Row label="IPv4">
              <span className="font-mono">{s.ipv4 ?? '—'}</span>
            </Row>
            <Row label="IPv6">
              <span className="font-mono">{s.ipv6 ?? '—'}</span>
            </Row>
            <Row label="Paid until">
              {s.expires_on ? (
                <span className="inline-flex items-center gap-2">
                  {when(s.expires_on)} <Days days={s.days_left ?? null} />
                </span>
              ) : (
                '—'
              )}
            </Row>
            <Row label="Cost">{s.cost_amount ? `${money(s.cost_amount, s.cost_currency)} / ${s.cost_period ?? text('period')}${typeof s.cost_monthly === 'number' ? ` · ${text('{v} a month', { v: money(s.cost_monthly, s.cost_currency) })}` : ''}` : '—'}</Row>
            <Row label="Customer">{[s.client, s.project].filter(Boolean).join(' · ') || '—'}</Row>
            <Row label="Responsible">{s.owner ?? '—'}</Row>
            {s.tags?.length ? (
              <Row label="Tags">
                <span className="flex flex-wrap gap-1">
                  {s.tags.map((t) => (
                    <Chip key={t} tone="grey">
                      {t}
                    </Chip>
                  ))}
                </span>
              </Row>
            ) : null}
            {s.notes ? <Row label="Notes">{s.notes}</Row> : null}
            {s.ssh && !s.ssh.available ? null : s.ssh?.why ? <Row label="SSH">{s.ssh.why}</Row> : null}
          </div>
        </Card>
        <Card title="Serves">
          <div className="flex flex-col gap-1 px-3.5 pb-3 text-[12.5px]">
            {(s.domains_list ?? []).map((d) => (
              <button key={d.id} type="button" className="text-left font-semibold text-primary hover:underline" onClick={() => nav.openDomain(d.id, 'tab', d.name)}>
                {d.name}
              </button>
            ))}
            {(s.certificates ?? []).map((c) => (
              <button key={`c${c.id}`} type="button" className="text-left text-ink-2 hover:underline" onClick={() => nav.to('certificates', `&certificate=${c.id}`)}>
                {text('Certificate · {host}', { host: c.label ?? c.host })}
              </button>
            ))}
            {(s.monitors ?? []).map((m) => (
              <span key={`m${m.id}`} className="flex items-center gap-2 text-ink-2">
                {text('Monitor · {name}', { name: m.name || m.target })} <Status value={m.state} />
              </span>
            ))}
            {!(s.domains_list ?? []).length && !(s.certificates ?? []).length ? <span className="text-ink-3">Nothing in the register points at this server.</span> : null}
          </div>
        </Card>
      </div>
      <Metrics id={s.id} />
      <Snapshots id={s.id} can={offers(s, 'snapshots')} />
      <ServerActivity id={s.id} />
      {power ? <PowerDialog s={s} action={power} onClose={() => setPower(null)} /> : null}
      {edit ? <ServerForm server={s} companies={orgs.data ?? []} org={s.org_id ?? 0} onClose={() => setEdit(false)} /> : null}
    </div>
  );
}

/** A row of bars, scaled to the series' own peak (display only). */
export function Bars({ values, label, unit = '' }: { values: number[]; label: string; unit?: string }) {
  const max = Math.max(1e-9, ...values);
  const last = values[values.length - 1];
  return (
    <div className="flex flex-col gap-1">
      <span className="flex text-[11.5px] text-ink-3">
        <span className="flex-1">{label}</span>
        {last !== undefined ? <span className="tabular-nums">{`${Math.round(last * 10) / 10}${unit}`}</span> : null}
      </span>
      <div role="img" aria-label={label} className="flex h-10 items-end gap-px">
        {values.map((v, i) => (
          <span key={i} className="flex-1 rounded-t-[1px] bg-[#0891B2]/70" style={{ height: `${Math.max(2, (v / max) * 100)}%` }} />
        ))}
      </div>
    </div>
  );
}

/** The values of a series, thinned to at most `n` bars by taking the peak of each slice (display only). */
export function seriesValues(series: MetricsData['series'] | undefined, name: string, n = 96): number[] {
  const pts = (series?.[name] ?? []).map((p) => p[1]).filter((v) => Number.isFinite(v));
  if (pts.length <= n) return pts;
  const step = pts.length / n;
  return Array.from({ length: n }, (_, i) => Math.max(...pts.slice(Math.floor(i * step), Math.max(Math.floor(i * step) + 1, Math.floor((i + 1) * step)))));
}

function Metrics({ id }: { id: number }) {
  const [range, setRange] = useState<'24h' | '7d'>('24h');
  const q = useQuery({ queryKey: ['hosting', 'metrics', id, range], queryFn: ({ signal }) => fetchMetrics(id, range, signal), retry: false });
  const s = q.data?.series;
  return (
    <Card title="Graphs" action={<Pills<'24h' | '7d'> label="Range" value={range} onChange={setRange} options={[{ id: '24h', label: '24 h' }, { id: '7d', label: '7 d' }]} />}>
      <div className="px-3.5 pb-3">
        {q.isPending ? <Spinner /> : q.isError ? <ErrorNote error={q.error} /> : q.data === null ? <NeedsUpdate what={text('Server graphs')} /> : !q.data.available ? (
          <p className="m-0 text-[12.5px] text-ink-3">{q.data.why || text('The provider does not send usage graphs for this server.')}</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            <Bars label={text('CPU')} unit="%" values={seriesValues(s, 'cpu')} />
            <Bars label={text('Network in')} values={seriesValues(s, 'network_in')} />
            <Bars label={text('Network out')} values={seriesValues(s, 'network_out')} />
            <Bars label={text('Disk read')} values={seriesValues(s, 'disk_read')} />
            <Bars label={text('Disk write')} values={seriesValues(s, 'disk_write')} />
          </div>
        )}
      </div>
    </Card>
  );
}

function Snapshots({ id, can }: { id: number; can: boolean }) {
  const ro = useReadOnly();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['hosting', 'snapshots', id], queryFn: ({ signal }) => fetchSnapshots(id, signal), retry: false });
  const [busy, setBusy] = useState(false);
  const take = async () => {
    setBusy(true);
    try {
      const r = await takeSnapshot(id);
      toast(r === null ? 'info' : 'success', r === null ? text('Snapshots need a server update.') : text('Snapshot started.'));
      void qc.invalidateQueries({ queryKey: ['hosting', 'snapshots', id] });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const available = q.data?.available;
  return (
    <Card title="Snapshots and backups" action={available && can ? <Btn disabled={ro || busy} title={ro ? 'Needs a connection' : undefined} onClick={() => void take()}>Take snapshot</Btn> : undefined}>
      <div className="px-3.5 pb-3 text-[12.5px]">
        {q.isPending ? <Spinner /> : q.isError ? <ErrorNote error={q.error} /> : q.data === null ? <NeedsUpdate what={text('Snapshots')} /> : !q.data.available ? (
          <span className="text-ink-3">{q.data.why || text('The provider does not offer snapshots for this server.')}</span>
        ) : q.data.items.length ? (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {q.data.items.map((x) => (
              <li key={String(x.id)} className="flex gap-3">
                <span className="min-w-0 flex-1 truncate text-ink">{x.name || String(x.id)}</span>
                <span className="text-ink-3">{x.kind ?? ''}</span>
                <span className="text-ink-3 tabular-nums">{typeof x.size_gb === 'number' ? `${x.size_gb} GB` : ''}</span>
                <span className="text-ink-3 tabular-nums">{when(x.created_at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-ink-3">No snapshots yet.</span>
        )}
      </div>
    </Card>
  );
}

function ServerActivity({ id }: { id: number }) {
  const q = useQuery({ queryKey: ['hosting', 'server-activity', id], queryFn: ({ signal }) => fetchServerActivity(id, signal) });
  if (!q.data?.length) return null;
  return (
    <Card title="Activity">
      <ol className="m-0 flex list-none flex-col gap-2 px-3.5 pb-3">
        {q.data.slice(0, 30).map((a, i) => (
          <li key={`${a.at}-${i}`} className="flex gap-3 text-[12.5px]">
            <span className="w-[110px] shrink-0 text-ink-3 tabular-nums">{when(a.at)}</span>
            <span className="min-w-0 flex-1 text-ink">{a.text}</span>
            <span className="text-ink-3">{a.by ?? text('Sync')}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
