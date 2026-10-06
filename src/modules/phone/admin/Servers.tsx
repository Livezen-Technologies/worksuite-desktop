import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTab } from '../../../core/tab-context';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Button, cx, Empty, IconButton, Modal, Spinner } from '../../../components/ui';
import { phoneApi, PK, useServers, useSyncRuns, type Mapping, type PbxServer, type ServerDetail, type TestResult } from '../api';
import { stamp } from '../lib/format';
import { Field, INPUT, Mono, Notice, PageBody, PageHeader, Panel, Refused, StatusChip, TD, TR, Table } from '../parts';
import { useDepartments } from './lookups';

/**
 * A04 · PBX servers & health (VOIP-SRV-01…08). A card per switch: status, driver and version, which protocols it is
 * reached by, six measurements ("not measured" where the switch did not say), the last sync, and Test, Sync, Apply
 * (Asterisk) or Push (FreePBX), Maintenance and Edit. Below, which part of the business uses which switch and
 * number range — the most specific mapping wins.
 */
export default function Servers() {
  const { go } = useTab();
  const qc = useQueryClient();
  const q = useServers();
  const runs = useSyncRuns();
  const [tests, setTests] = useState<Record<number, TestResult>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [mapping, setMapping] = useState(false);
  const servers = useMemo(() => q.data?.servers ?? [], [q.data]);
  const details = useQueries({ queries: servers.map((s) => ({ queryKey: PK.server(s.id), queryFn: ({ signal }: { signal: AbortSignal }) => phoneApi.server(s.id, signal) })) });
  const mappings: Array<Mapping & { serverName: string }> = details.flatMap((d, i) => (d.data as ServerDetail | undefined)?.mappings.map((m) => ({ ...m, serverName: servers[i]?.name ?? '' })) ?? []).sort((a, b) => b.priority - a.priority);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: PK.servers });
    void qc.invalidateQueries({ queryKey: ['phone', 'server'] });
    void qc.invalidateQueries({ queryKey: ['phone', 'sync-runs'] });
  };
  const run = async (key: string, fn: () => Promise<string | null | void>) => {
    setBusy(key);
    try {
      const m = await fn();
      if (m) toast('success', m);
      refresh();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const lastRun = (id: number) => runs.data?.find((r) => r.server_id === id) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="PBX servers"
        actions={
          <>
            <Button icon="gauge" loading={busy === 'health'} disabled={!servers.length} onClick={() => void run('health', async () => {
              await Promise.all(servers.filter((s) => s.enabled).map((s) => phoneApi.sampleHealth(s.id)));
              return 'Health sampled.';
            })}>
              Sample health now
            </Button>
            <Button icon="sparkles" onClick={() => go('/phone/setup')}>
              Set up cloud FreePBX
            </Button>
            <Button variant="primary" icon="plus" onClick={() => go('/phone/servers/new')}>
              Add server
            </Button>
          </>
        }
      />
      <PageBody>
        {q.isLoading ? (
          <Spinner />
        ) : q.error ? (
          <Refused error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <div className="flex flex-col gap-4">
            {q.data?.notes.secrets ? <Notice tone="danger" icon="shield-alert">{q.data.notes.secrets}</Notice> : null}
            {servers.length === 0 ? (
              <Empty icon="server" title="No phone system is connected" hint="Add an Asterisk or FreePBX server, or follow the cloud FreePBX setup." action={<Button variant="primary" icon="plus" onClick={() => go('/phone/servers/new')}>Add server</Button>} />
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                {servers.map((s) => (
                  <ServerCard key={s.id} s={s} test={tests[s.id] ?? null} busy={busy} lastRun={lastRun(s.id)} onRun={run} onTested={(t) => setTests((x) => ({ ...x, [s.id]: t }))} onEdit={() => go(`/phone/servers/${s.id}`)} freepbxNote={q.data?.notes.freepbx ?? null} />
                ))}
              </div>
            )}
            <Panel title="Which part of the business uses which switch" sub="New extensions are allocated from the matching range; the most specific mapping wins." action={<Button icon="plus" disabled={!servers.length} onClick={() => setMapping(true)}>Add mapping</Button>}>
              {mappings.length ? (
                <Table head={['Scope', 'Applies to', 'Server', 'Number range', 'Prefix', 'Priority', '']}>
                  {mappings.map((m) => (
                    <tr key={m.id} className={TR}>
                      <td className={TD}>{m.scope.charAt(0).toUpperCase() + m.scope.slice(1)}</td>
                      <td className={cx(TD, 'font-semibold')}>{m.label ?? (m.scope_id ? `#${m.scope_id}` : 'Everything else')}</td>
                      <td className={TD}>{m.serverName}</td>
                      <td className={TD}>
                        <Mono>{m.range_from !== null && m.range_to !== null ? `${m.range_from}–${m.range_to}` : '—'}</Mono>
                      </td>
                      <td className={TD}>
                        <Mono>{m.prefix || '—'}</Mono>
                      </td>
                      <td className={TD}>{m.priority}</td>
                      <td className={TD}>
                        <IconButton icon="trash" label="Remove mapping" onClick={() => void run(`map-${m.id}`, async () => {
                          await phoneApi.deleteMapping(m.id);
                          return 'Mapping removed.';
                        })} />
                      </td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <p className="text-[12.5px] text-ink-3">No mappings: every extension uses the default server.</p>
              )}
            </Panel>
          </div>
        )}
      </PageBody>
      {mapping ? <AddMapping servers={servers} onClose={() => setMapping(false)} onSaved={() => (setMapping(false), refresh())} /> : null}
    </div>
  );
}

function ServerCard({ s, test, busy, lastRun, onRun, onTested, onEdit, freepbxNote }: {
  s: PbxServer;
  test: TestResult | null;
  busy: string | null;
  lastRun: { state: string; started_at: string | null; examined: number; updated: number; created: number; failed: number; trigger: string } | null;
  onRun: (key: string, fn: () => Promise<string | null | void>) => Promise<void>;
  onTested: (t: TestResult) => void;
  onEdit: () => void;
  freepbxNote: string | null;
}) {
  const h = s.health;
  const freepbx = s.driver === 'freepbx';
  const channels = test ? (Array.isArray(test.channels) ? Object.fromEntries(test.channels.map((c) => [String(c.name ?? c.channel ?? ''), c])) : test.channels) : null;
  const pill = (label: string, key: string, configured: boolean) => {
    const r = channels?.[key];
    return (
      <span key={key} title={r?.message ?? (configured ? 'Configured, not tested yet' : 'Not configured')} className={cx('inline-flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[11px] font-semibold', r ? (r.ok ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger') : configured ? 'bg-subtle text-ink-2' : 'bg-subtle text-ink-3 line-through')}>
        {label}
        {r ? <Icon name={r.ok ? 'check' : 'x'} size={11} /> : null}
        {r && !r.ok ? <span className="max-w-[90px] truncate font-normal">{r.message}</span> : null}
      </span>
    );
  };
  const metric = (label: string, v: string | number | null | undefined) => (
    <div className="rounded-[8px] bg-subtle px-2.5 py-1.5">
      <div className="text-[10.5px] font-semibold text-ink-3">{label}</div>
      {v === null || v === undefined ? <div className="text-[12px] font-semibold text-ink-3">not measured</div> : <Mono className="text-[15px] font-bold text-ink">{v}</Mono>}
    </div>
  );
  return (
    <section className="flex flex-col gap-3 rounded-[12px] border border-line bg-surface p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-bold text-ink">{s.name}</h2>
          <p className="truncate text-[11.5px] text-ink-3">
            {[freepbx ? `FreePBX ${s.freepbx_version ?? ''}`.trim() : null, s.asterisk_version ? `Asterisk ${s.asterisk_version}` : 'Asterisk', s.hostname, s.is_default ? 'Default' : null, s.timezone].filter(Boolean).join(' · ')}
          </p>
        </div>
        <StatusChip status={s.maintenance ? 'maintenance' : s.status} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {freepbx ? pill('GraphQL', 'api', !!s.api_base) : null}
        {pill('AMI', 'ami', !!s.ami_host && s.has_ami_secret)}
        {pill('ARI', 'ari', !!s.ari_host && s.has_ari_secret)}
        {pill('WSS', 'wss', !!s.ws_url)}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {metric('Calls', h?.active_calls)}
        {metric('Registered', h ? `${h.registered} / ${h.endpoints_total}` : null)}
        {metric('Trunks', h ? `${h.trunks_up} / ${h.trunks_total}` : null)}
        {metric('Waiting', h?.queued_callers)}
        {metric('Latency', h?.latency_ms !== null && h?.latency_ms !== undefined ? `${h.latency_ms} ms` : null)}
        {metric('CPU', h?.cpu_pct !== null && h?.cpu_pct !== undefined ? `${Math.round(h.cpu_pct)}%` : null)}
      </div>
      <p className="text-[11.5px] text-ink-3">
        {lastRun ? `Last sync ${stamp(lastRun.started_at)} · ${lastRun.state} · ${lastRun.examined} examined, ${lastRun.updated} updated${lastRun.created ? `, ${lastRun.created} created` : ''}${lastRun.failed ? `, ${lastRun.failed} failed` : ''}` : 'Never synchronised'}
        {s.maintenance ? ' · Sync paused during maintenance' : ''}
      </p>
      {s.status_message ? <p className="text-[11.5px] text-ink-2">{s.status_message}</p> : null}
      {freepbx && !s.driver_verified && freepbxNote ? <p className="rounded-[8px] bg-warning-bg px-2.5 py-1.5 text-[11.5px] text-warning-ink dark:text-warning">{freepbxNote}</p> : null}
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" loading={busy === `test-${s.id}`} onClick={() => void onRun(`test-${s.id}`, async () => {
          const t = await phoneApi.testServer(s.id);
          onTested(t);
          return t.ok ? 'Every protocol answered.' : t.message;
        })}>
          Test
        </Button>
        <Button size="sm" loading={busy === `sync-${s.id}`} disabled={!s.enabled} onClick={() => void onRun(`sync-${s.id}`, async () => {
          const r = await phoneApi.sync(s.id, 'full');
          return r.message ?? `Sync ${r.state}.`;
        })}>
          Sync
        </Button>
        <Button size="sm" loading={busy === `apply-${s.id}`} disabled={s.maintenance || !s.enabled} onClick={() => void onRun(`apply-${s.id}`, async () => {
          const r = await phoneApi.applyServer(s.id);
          if (!r.ok) throw new Error(r.message);
          return r.message;
        })}>
          {s.owns_configuration ? 'Apply config' : 'Push to FreePBX'}
        </Button>
        <Button size="sm" loading={busy === `mnt-${s.id}`} onClick={() => void onRun(`mnt-${s.id}`, async () => (await phoneApi.maintenance(s.id, !s.maintenance)).message)}>
          {s.maintenance ? 'End maintenance' : 'Maintenance'}
        </Button>
        <Button size="sm" onClick={onEdit}>
          Edit
        </Button>
      </div>
    </section>
  );
}

function AddMapping({ servers, onClose, onSaved }: { servers: PbxServer[]; onClose: () => void; onSaved: () => void }) {
  const departments = useDepartments();
  const [server, setServer] = useState(String(servers.find((s) => s.is_default)?.id ?? servers[0]?.id ?? ''));
  const [scope, setScope] = useState<Mapping['scope']>('department');
  const [scopeId, setScopeId] = useState('');
  const [label, setLabel] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [prefix, setPrefix] = useState('');
  const [priority, setPriority] = useState('10');
  const [saving, setSaving] = useState(false);
  const range = from && to ? Number(to) >= Number(from) : !from && !to;
  const save = async () => {
    setSaving(true);
    try {
      const dept = departments.data?.find((d) => String(d.id) === scopeId);
      await phoneApi.addMapping(Number(server), {
        scope,
        scope_id: scopeId && scope !== 'branch' ? Number(scopeId) : null,
        label: label.trim() || dept?.name || null,
        range_from: from ? Number(from) : null,
        range_to: to ? Number(to) : null,
        prefix: prefix || null,
        priority: Number(priority) || 10,
      });
      toast('success', 'Mapping added.');
      onSaved();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title="Add a mapping" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={saving} disabled={!server || !range} onClick={() => void save()}>Add mapping</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Server">
          <select aria-label="Server" value={server} onChange={(e) => setServer(e.target.value)} className={INPUT}>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Scope">
          <select aria-label="Scope" value={scope} onChange={(e) => setScope(e.target.value as Mapping['scope'])} className={INPUT}>
            <option value="organisation">Organisation</option>
            <option value="branch">Branch</option>
            <option value="department">Department</option>
          </select>
        </Field>
        {scope === 'department' ? (
          <Field label="Department" className="col-span-2">
            <select aria-label="Department" value={scopeId} onChange={(e) => setScopeId(e.target.value)} className={INPUT}>
              <option value="">Choose a department</option>
              {(departments.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <Field label={scope === 'branch' ? 'Branch name' : 'Label'} className="col-span-2">
          <input value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Label" className={INPUT} />
        </Field>
        <Field label="Range from">
          <input value={from} onChange={(e) => setFrom(e.target.value.replace(/\D/g, ''))} inputMode="numeric" aria-label="Range from" className={cx(INPUT, 'font-mono')} />
        </Field>
        <Field label="Range to" hint={!range ? 'The end is before the start.' : undefined}>
          <input value={to} onChange={(e) => setTo(e.target.value.replace(/\D/g, ''))} inputMode="numeric" aria-label="Range to" className={cx(INPUT, 'font-mono')} />
        </Field>
        <Field label="Prefix">
          <input value={prefix} onChange={(e) => setPrefix(e.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" aria-label="Prefix" className={cx(INPUT, 'font-mono')} />
        </Field>
        <Field label="Priority">
          <input value={priority} onChange={(e) => setPriority(e.target.value.replace(/\D/g, ''))} inputMode="numeric" aria-label="Priority" className={INPUT} />
        </Field>
      </div>
    </Modal>
  );
}

