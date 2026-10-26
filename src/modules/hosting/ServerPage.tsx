import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorNote, Spinner } from '../../components/ui';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { useTabTitle } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { fetchMetrics, fetchServer, fetchSnapshots, K, takeSnapshot, type PowerAction } from './api';
import type { Nav } from './HostingShell';
import { Btn, Card, NeedsUpdate, Note, PageHead, Pills, Row, Status, useReadOnly, when } from './parts';
import { PowerDialog, supports } from './Servers';

/**
 * One server in its own tab or window (HDM-DSK-03, SRV-01/04/05/06/08): its facts, the domains and certificates it
 * serves, power actions, snapshots and the provider's CPU / network / disk graphs for 24 h or 7 d.
 */
export default function ServerPage({ id, nav }: { id: number; nav: Nav }) {
  const ro = useReadOnly();
  const one = useQuery({ queryKey: K.server(id), queryFn: ({ signal }) => fetchServer(id, signal) });
  const [power, setPower] = useState<PowerAction | null>(null);
  useTabTitle(one.data?.name ?? null);
  if (one.isPending) return <Spinner />;
  if (one.isError) return <ErrorNote error={one.error} onRetry={() => void one.refetch()} />;
  const s = one.data;
  if (!s) return <Note tone="warn">This server is not in your register any more.</Note>;
  const off = ro ? 'Needs a connection' : undefined;
  return (
    <div className="flex flex-col gap-4">
      <PageHead title={s.name} sub={[s.provider, s.location, s.synced_at ? text('read {time}', { time: when(s.synced_at) }) : null].filter(Boolean).join(' · ')}>
        <Btn onClick={() => nav.openServer(s.id, 'window', s.name)}>Pop out</Btn>
        {(['power_on', 'reboot', 'power_off'] as PowerAction[])
          .filter((a) => supports(s, a))
          .map((a) => (
            <Btn key={a} danger={a === 'power_off'} disabled={ro} title={off} onClick={() => setPower(a)}>
              {a === 'power_on' ? 'Power on' : a === 'reboot' ? 'Reboot' : 'Power off'}
            </Btn>
          ))}
      </PageHead>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Facts">
          <div className="px-3.5 pb-3">
            <Row label="Status">
              <Status value={s.status} />
            </Row>
            <Row label="Kind">{s.kind ?? '—'}</Row>
            <Row label="Plan">{s.plan ?? '—'}</Row>
            <Row label="CPU · RAM · Disk">{[s.cpu, s.ram, s.storage].map((v) => v ?? '—').join(' · ')}</Row>
            <Row label="OS">{s.os ?? '—'}</Row>
            <Row label="IPv4">
              <span className="font-mono">{s.ipv4 ?? '—'}</span>
            </Row>
            <Row label="IPv6">
              <span className="font-mono">{s.ipv6 ?? '—'}</span>
            </Row>
            <Row label="Paid until">{when(s.expires_on)}</Row>
            <Row label="Cost">{s.cost_amount ? `${s.cost_currency ?? ''} ${s.cost_amount} / ${s.cost_period ?? text('period')}`.trim() : '—'}</Row>
            <Row label="Client">{[s.client, s.project].filter(Boolean).join(' · ') || '—'}</Row>
            {s.notes ? <Row label="Notes">{s.notes}</Row> : null}
          </div>
        </Card>
        <Card title="Serves">
          <div className="flex flex-col gap-1 px-3.5 pb-3 text-[12.5px]">
            {(s.domains ?? []).map((d) => (
              <button key={d.id} type="button" className="text-left font-semibold text-primary hover:underline" onClick={() => nav.openDomain(d.id, 'tab', d.name)}>
                {d.name}
              </button>
            ))}
            {(s.certificates ?? []).map((c) => (
              <button key={`c${c.id}`} type="button" className="text-left text-ink-2 hover:underline" onClick={() => nav.to('certificates', `&certificate=${c.id}`)}>
                {text('Certificate · {host}', { host: c.host })}
              </button>
            ))}
            {!(s.domains ?? []).length && !(s.certificates ?? []).length ? <span className="text-ink-3">Nothing in the register points at this server.</span> : null}
          </div>
        </Card>
      </div>
      <Metrics id={s.id} />
      <Snapshots id={s.id} />
      {power ? <PowerDialog s={s} action={power} onClose={() => setPower(null)} /> : null}
    </div>
  );
}

/** A row of bars, scaled to the series' own peak (display only). */
export function Bars({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11.5px] text-ink-3">{label}</span>
      <div role="img" aria-label={label} className="flex h-10 items-end gap-px">
        {values.map((v, i) => (
          <span key={i} className="flex-1 rounded-t-[1px] bg-[#0891B2]/70" style={{ height: `${Math.max(2, (v / max) * 100)}%` }} />
        ))}
      </div>
    </div>
  );
}

function Metrics({ id }: { id: number }) {
  const [range, setRange] = useState<'24h' | '7d'>('24h');
  const q = useQuery({ queryKey: ['hosting', 'metrics', id, range], queryFn: ({ signal }) => fetchMetrics(id, range, signal), retry: false });
  return (
    <Card title="Graphs" action={<Pills<'24h' | '7d'> label="Range" value={range} onChange={setRange} options={[{ id: '24h', label: '24 h' }, { id: '7d', label: '7 d' }]} />}>
      <div className="px-3.5 pb-3">
        {q.isPending ? <Spinner /> : q.isError ? <ErrorNote error={q.error} /> : q.data === null ? <NeedsUpdate what={text('Server graphs')} /> : (
          <div className="grid gap-4 md:grid-cols-3">
            <Bars label={text('CPU')} values={q.data.cpu ?? []} />
            <Bars label={text('Network')} values={q.data.network ?? []} />
            <Bars label={text('Disk')} values={q.data.disk ?? []} />
          </div>
        )}
      </div>
    </Card>
  );
}

function Snapshots({ id }: { id: number }) {
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
  return (
    <Card title="Snapshots and backups" action={q.data !== null ? <Btn disabled={ro || busy} title={ro ? 'Needs a connection' : undefined} onClick={() => void take()}>Take snapshot</Btn> : undefined}>
      <div className="px-3.5 pb-3 text-[12.5px]">
        {q.isPending ? <Spinner /> : q.isError ? <ErrorNote error={q.error} /> : q.data === null ? <NeedsUpdate what={text('Snapshots')} /> : q.data.length ? (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {q.data.map((x) => (
              <li key={String(x.id)} className="flex gap-3">
                <span className="min-w-0 flex-1 truncate text-ink">{x.name ?? String(x.id)}</span>
                <span className="text-ink-3">{x.kind ?? ''}</span>
                <span className="text-ink-3">{x.size ?? ''}</span>
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
