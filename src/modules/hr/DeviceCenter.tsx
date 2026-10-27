import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { apiGet, apiPost, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnBad, btnPrimary, btnSmall, Empty, Facts, Field, input, Kpi, PageHead, Panel, Seg, Sheet, StatusChip } from '../../components/PageKit';
import { ago } from './Devices';
import { StatGrid } from '../../components/StatCard';

/**
 * HR › Attendance › Devices on the desktop: the attendance device framework (the web's DeviceCenter) —
 * every manufacturer and connection type (ZK TCP pull, ADMS push, on-site gateway), the Sync Center,
 * device users and the unmapped punches that need a person, live punches, gateways and the Biometric
 * Devices settings. The original ADMS terminal screen stays as "Push terminals".
 *
 * Reads `/api/hr/attendance/devices…`; nothing it receives carries a communication key, a gateway token or a
 * biometric template.
 */
const PushTerminals = lazy(() => import('./Devices'));

export type DeviceView = 'dashboard' | 'devices' | 'add' | 'sync' | 'unmapped' | 'live' | 'gateways' | 'settings' | 'terminals';

export interface AttDevice {
  id: number;
  name: string;
  model: string;
  model_code: string | null;
  serial_number: string;
  connection_type: string;
  host: string | null;
  port: number;
  online: boolean;
  is_active: boolean;
  health_state: string | null;
  last_sync_at: string | null;
  last_seen_at: string | null;
  location: string | null;
  firmware: string | null;
  user_count: number | null;
  record_count: number | null;
  last_error: string | null;
  capabilities: Record<string, boolean>;
}
interface Perms {
  view: boolean;
  create: boolean;
  edit: boolean;
  sync: boolean;
  test: boolean;
  manage_users: boolean;
  commands: boolean;
  gateway: boolean;
}
interface Job {
  id: number;
  device_id: number | null;
  kind: string;
  status: string;
  attempts: number;
  max_attempts: number;
  error: string | null;
  created_at: string | null;
  device_name: string | null;
}

export const CONNECTION: Record<string, string> = { pull_tcp: 'TCP pull', pull_udp: 'UDP pull', adms: 'ADMS push', gateway: 'Gateway', webhook: 'Webhook' };
export const HEALTH: Record<string, string> = { HEALTHY: 'Healthy', WARNING: 'Warning', OFFLINE: 'Offline', SYNC_ERROR: 'Sync error', AUTH_ERROR: 'Auth error', TIME_DRIFT: 'Clock drift', CAPACITY_WARNING: 'Nearly full' };

/** "12 records need attention", or nothing when every punch has a person. */
export function attentionLine(unmapped: number): string | null {
  return unmapped > 0 ? `${unmapped} record${unmapped === 1 ? '' : 's'} need${unmapped === 1 ? 's' : ''} attention` : null;
}

export default function DeviceCenter() {
  const [view, setView] = useState<DeviceView>('dashboard');
  const [open, setOpen] = useState<number | null>(null);
  const list = useQuery({ queryKey: ['hr', 'att-devices'], queryFn: ({ signal }) => apiGet<{ devices: AttDevice[]; permissions: Perms }>('/api/hr/attendance/devices', undefined, signal), refetchInterval: 30_000 });
  const perms = list.data?.permissions;
  const go = (v: DeviceView) => (setView(v), setOpen(null));

  return (
    <div className="flex flex-col gap-3.5">
      <PageHead title="Devices" sub="Attendance devices of every make. They provide punches; HR attendance decides what they mean." />
      <Seg<DeviceView>
        label="Devices"
        value={view}
        onChange={go}
        options={[
          { id: 'dashboard', label: 'Dashboard' },
          { id: 'devices', label: 'All devices' },
          ...(perms?.create ? [{ id: 'add' as const, label: 'Add device' }] : []),
          { id: 'sync', label: 'Sync Center' },
          { id: 'unmapped', label: 'Unmapped' },
          { id: 'live', label: 'Live' },
          { id: 'gateways', label: 'Gateways' },
          { id: 'settings', label: 'Settings' },
          { id: 'terminals', label: 'Push terminals' },
        ]}
      />
      {list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
      {view === 'dashboard' ? <Dashboard onGo={go} /> : null}
      {view === 'devices' ? open ? <DeviceDetail id={open} perms={perms} onClose={() => setOpen(null)} /> : <DeviceList devices={list.data?.devices ?? []} onOpen={setOpen} /> : null}
      {view === 'add' ? <AddDevice onDone={(id) => (void list.refetch(), setView('devices'), setOpen(id))} /> : null}
      {view === 'sync' ? <SyncCenter canRetry={!!perms?.sync} /> : null}
      {view === 'unmapped' ? <Unmapped onOpen={(id) => (setView('devices'), setOpen(id))} /> : null}
      {view === 'live' ? <Live /> : null}
      {view === 'gateways' ? <Gateways /> : null}
      {view === 'settings' ? <DeviceSettings /> : null}
      {view === 'terminals' ? (
        <Suspense fallback={<Spinner />}>
          <PushTerminals />
        </Suspense>
      ) : null}
    </div>
  );
}

type DashKey = 'total' | 'online' | 'offline' | 'warning' | 'drift' | 'errors' | 'punches_today' | 'jobs_queued' | 'jobs_failed' | 'needs_review' | 'gateways_online' | 'unmapped';

function Dashboard({ onGo }: { onGo: (v: DeviceView) => void }) {
  const q = useQuery({ queryKey: ['hr', 'att-dashboard'], queryFn: ({ signal }) => apiGet<Record<DashKey, number>>('/api/hr/attendance/devices/dashboard', undefined, signal), refetchInterval: 30_000 });
  const d = q.data;
  if (!d) return q.isLoading ? <Spinner /> : null;
  const line = attentionLine(d.unmapped);
  return (
    <div className="flex flex-col gap-2.5">
      {line ? (
        <button type="button" onClick={() => onGo('unmapped')} className="rounded-[12px] border border-line bg-warning-bg px-4 py-3 text-left text-[13px] text-ink">
          <b>{line}</b> — punches from device users not linked to an employee. Link them and their history is applied.
        </button>
      ) : null}
      <StatGrid min={180}>
        <Kpi icon="fingerprint" tone="blue" label="Devices" value={d.total} onClick={() => onGo('devices')} />
        <Kpi icon="wifi" label="Online" value={d.online} tone="green" />
        <Kpi icon="wifi-off" label="Offline" value={d.offline} tone={d.offline ? 'red' : undefined} />
        <Kpi icon="warning" label="Warnings" value={d.warning + d.drift} tone={d.warning + d.drift ? 'amber' : undefined} />
        <Kpi icon="refresh" label="Sync errors" value={d.errors} tone={d.errors ? 'red' : undefined} onClick={() => onGo('sync')} />
        <Kpi icon="hand" tone="violet" label="Punches today" value={d.punches_today} onClick={() => onGo('live')} />
        <Kpi icon="list-todo" tone="cyan" label="Jobs queued" value={d.jobs_queued} onClick={() => onGo('sync')} />
        <Kpi icon="x-circle" label="Jobs failed" value={d.jobs_failed} tone={d.jobs_failed ? 'red' : undefined} onClick={() => onGo('sync')} />
        <Kpi icon="eye" tone="amber" label="Needs review" value={d.needs_review} />
        <Kpi icon="server" tone="blue" label="Gateways online" value={d.gateways_online} onClick={() => onGo('gateways')} />
      </StatGrid>
    </div>
  );
}

function DeviceList({ devices, onOpen }: { devices: AttDevice[]; onOpen: (id: number) => void }) {
  if (!devices.length) return <Empty text="No devices yet. Add one — a K40 Pro on the LAN, a UA300 that pushes, or anything behind a gateway." />;
  return (
    <div className="flex flex-col gap-2">
      {devices.map((d) => (
        <button key={d.id} type="button" onClick={() => onOpen(d.id)} className="flex items-center gap-2.5 rounded-[12px] border border-line bg-surface px-3.5 py-3 text-left hover:border-primary/40">
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="truncate text-ink">
              {d.name} · {d.model}
            </b>
            <span className="truncate text-[12px] text-ink-3">
              {CONNECTION[d.connection_type] ?? d.connection_type}
              {d.host ? ` · ${d.host}:${d.port}` : ''} · SN {d.serial_number} · synced {ago(d.last_sync_at ?? d.last_seen_at)}
            </span>
          </span>
          <StatusChip>{!d.is_active ? 'Disabled' : d.online ? 'Online' : 'Offline'}</StatusChip>
          {d.health_state && d.health_state !== 'HEALTHY' ? <StatusChip>{HEALTH[d.health_state] ?? d.health_state}</StatusChip> : null}
        </button>
      ))}
    </div>
  );
}

type DetailPane = 'overview' | 'logs' | 'users' | 'commands' | 'diagnostics';

function DeviceDetail({ id, perms, onClose }: { id: number; perms?: Perms; onClose: () => void }) {
  const qc = useQueryClient();
  const [pane, setPane] = useState<DetailPane>('overview');
  const q = useQuery({ queryKey: ['hr', 'att-dev', id], queryFn: ({ signal }) => apiGet<{ device: AttDevice; commands: Array<{ key: string; label: string; supported: boolean; allowed: boolean; dangerous: boolean }>; counts: Record<string, number> }>(`/api/hr/attendance/devices/${id}`, undefined, signal) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['hr', 'att-dev', id] });
  const act = async (path: string) => {
    try {
      await apiPost(path);
      toast('success', 'Done.');
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  if (!q.data) return q.isLoading ? <Spinner /> : null;
  const d = q.data.device;
  return (
    <Panel title={`${d.name} · ${d.model}`} sub={`${CONNECTION[d.connection_type] ?? d.connection_type} · SN ${d.serial_number}`} action={<button type="button" className={btn} onClick={onClose}>Back</button>}>
      <Seg<DetailPane> label="Device" value={pane} onChange={setPane} options={[{ id: 'overview', label: 'Overview' }, { id: 'logs', label: 'Attendance logs' }, { id: 'users', label: 'Employees' }, { id: 'commands', label: 'Commands' }, { id: 'diagnostics', label: 'Diagnostics' }]} />
      {pane === 'overview' ? (
        <div className="flex flex-col gap-2 pt-2">
          <Facts rows={[['Status', d.online ? 'Online' : 'Offline'], ['Health', d.health_state ? HEALTH[d.health_state] ?? d.health_state : '—'], ['Firmware', d.firmware], ['Users / records', `${d.user_count ?? '?'} / ${d.record_count ?? '?'}`], ['Last sync', ago(d.last_sync_at)], ['Punches today', q.data.counts.today], ['Unmapped punches', q.data.counts.unmapped], ['Last error', d.last_error]]} />
          <div className="flex flex-wrap gap-2">
            {perms?.test ? <button type="button" className={btnSmall} onClick={() => void act(`/api/hr/attendance/devices/${id}/test`)}>Test connection</button> : null}
            {perms?.sync ? <button type="button" className={btnSmall} onClick={() => void act(`/api/hr/attendance/devices/${id}/sync`)}>Sync logs now</button> : null}
            {perms?.sync ? <button type="button" className={btnSmall} onClick={() => void act(`/api/hr/attendance/devices/${id}/sync-users`)}>Get users</button> : null}
            {perms?.sync && d.capabilities.set_time ? <button type="button" className={btnSmall} onClick={() => void act(`/api/hr/attendance/devices/${id}/sync-time`)}>Sync time</button> : null}
          </div>
        </div>
      ) : null}
      {pane === 'logs' ? <DeviceLogs id={id} /> : null}
      {pane === 'users' ? <DeviceUsers id={id} canMap={!!perms?.manage_users} /> : null}
      {pane === 'commands' ? <Commands device={d} commands={q.data.commands} onDone={refresh} /> : null}
      {pane === 'diagnostics' ? <Diagnostics id={id} /> : null}
    </Panel>
  );
}

function DeviceLogs({ id }: { id: number }) {
  const q = useQuery({ queryKey: ['hr', 'att-dev-logs', id], queryFn: ({ signal }) => apiGet<{ items: Array<Record<string, string | null>> }>(`/api/hr/attendance/devices/${id}/logs`, undefined, signal) });
  const rows = q.data?.items ?? [];
  if (!rows.length) return <Empty text="No punches yet." />;
  return (
    <div className="flex flex-col pt-2 text-[12.5px]">
      {rows.map((r) => (
        <div key={String(r.id)} className="flex gap-3 border-b border-line/70 py-1.5">
          <span className="w-[140px] shrink-0 font-mono text-ink-3">{r.event_time}</span>
          <span className="w-[90px] shrink-0">{r.device_user_id}</span>
          <span className="min-w-0 flex-1 truncate">{r.employee_name ?? '—'}</span>
          <span className="w-[90px] shrink-0">{r.direction ?? r.event_type}</span>
          <span className="w-[110px] shrink-0">{r.processing_status}</span>
        </div>
      ))}
    </div>
  );
}

function DeviceUsers({ id, canMap }: { id: number; canMap: boolean }) {
  const qc = useQueryClient();
  const [linking, setLinking] = useState<string | null>(null);
  const [emp, setEmp] = useState('');
  const q = useQuery({ queryKey: ['hr', 'att-dev-users', id], queryFn: ({ signal }) => apiGet<{ items: Array<Record<string, string | number | null>> }>(`/api/hr/attendance/devices/${id}/users`, undefined, signal) });
  const done = (m: string) => (toast('success', m), void qc.invalidateQueries({ queryKey: ['hr', 'att-dev-users', id] }));
  const post = async (path: string, body: unknown, msg: string) => {
    try {
      await apiPost(path, body);
      done(msg);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <div className="flex flex-col gap-2 pt-2">
      {canMap ? (
        <div className="flex gap-2">
          <button type="button" className={btnSmall} onClick={() => void post(`/api/hr/attendance/devices/${id}/users/auto-match`, { apply: true }, 'Matched by employee number or card.')}>
            Auto match
          </button>
        </div>
      ) : null}
      {(q.data?.items ?? []).map((u) => (
        <div key={String(u.id)} className="flex items-center gap-3 border-b border-line/70 py-1.5 text-[12.5px]">
          <span className="w-[90px] shrink-0 font-semibold">{u.device_user_id}</span>
          <span className="w-[140px] shrink-0 truncate">{u.device_name ?? '—'}</span>
          <span className="min-w-0 flex-1 truncate">{u.employee_name ? `${u.employee_name} (${u.employee_no})` : '—'}</span>
          <StatusChip>{String(u.mapping_status)}</StatusChip>
          {canMap ? (
            <span className="flex gap-1">
              <button type="button" className={btnSmall} onClick={() => setLinking(String(u.device_user_id))}>Link</button>
              {u.mapping_status === 'UNMAPPED' ? <button type="button" className={btnSmall} onClick={() => void post(`/api/hr/attendance/devices/${id}/users/ignore`, { device_user_id: u.device_user_id }, 'Ignored.')}>Ignore</button> : null}
            </span>
          ) : null}
        </div>
      ))}
      {linking ? (
        <Sheet
          title={`Link device user ${linking}`}
          onClose={() => setLinking(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setLinking(null)}>Cancel</button>
              <button type="button" className={btnPrimary} disabled={!emp} onClick={() => void post(`/api/hr/attendance/devices/${id}/users/map`, { device_user_id: linking, employee_id: Number(emp) }, 'Linked. Earlier punches were applied.').then(() => setLinking(null))}>
                Link
              </button>
            </>
          }
        >
          <Field label="Employee ID" hint="Earlier punches from this user are applied once linked.">
            <input className={input} value={emp} onChange={(e) => setEmp(e.target.value)} inputMode="numeric" />
          </Field>
        </Sheet>
      ) : null}
    </div>
  );
}

function Commands({ device, commands, onDone }: { device: AttDevice; commands: Array<{ key: string; label: string; supported: boolean; allowed: boolean; dangerous: boolean }>; onDone: () => void }) {
  const [danger, setDanger] = useState<{ key: string; label: string } | null>(null);
  const [typed, setTyped] = useState('');
  const run = async (key: string, confirm?: string) => {
    try {
      await apiPost(`/api/hr/attendance/devices/${device.id}/commands`, { command: key, confirm });
      toast('success', 'Sent.');
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <div className="grid grid-cols-3 gap-2 pt-2">
      {commands
        .filter((c) => !['push_user', 'remove_user'].includes(c.key))
        .map((c) => (
          <button key={c.key} type="button" disabled={!c.supported || !c.allowed} className={c.dangerous ? btnBad : btnSmall} onClick={() => (c.dangerous ? (setDanger(c), setTyped('')) : void run(c.key))}>
            {c.label}
          </button>
        ))}
      {danger ? (
        <Sheet
          title={danger.label}
          onClose={() => setDanger(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setDanger(null)}>Cancel</button>
              <button type="button" className={btnBad} disabled={typed !== device.name} onClick={() => void run(danger.key, typed).then(() => setDanger(null))}>
                Erase on device
              </button>
            </>
          }
        >
          <p className="text-[13px] text-ink-2">This erases data on the device itself and cannot be undone. It is audited.</p>
          <Field label={`Type "${device.name}" to confirm`}>
            <input className={input} value={typed} onChange={(e) => setTyped(e.target.value)} />
          </Field>
        </Sheet>
      ) : null}
    </div>
  );
}

function Diagnostics({ id }: { id: number }) {
  const q = useQuery({ queryKey: ['hr', 'att-dev-diag', id], queryFn: ({ signal }) => apiGet<{ checks: Array<{ key: string; label: string; ok: boolean | null; detail: string }> }>(`/api/hr/attendance/devices/${id}/diagnostics`, undefined, signal) });
  return (
    <div className="flex flex-col pt-2">
      {(q.data?.checks ?? []).map((c) => (
        <div key={c.key} className="flex gap-2.5 border-b border-line/70 py-1.5 text-[12.5px]">
          <span className={cx('w-4', c.ok === null ? 'text-ink-3' : c.ok ? 'text-success' : 'text-danger')}>{c.ok === null ? '•' : c.ok ? '✓' : '✕'}</span>
          <span className="min-w-0 flex-1">
            <b>{c.label}</b> <span className="text-ink-3">{c.detail}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function AddDevice({ onDone }: { onDone: (id: number) => void }) {
  const catalog = useQuery({ queryKey: ['hr', 'att-catalog'], queryFn: ({ signal }) => apiGet<{ catalog: Array<{ models: Array<{ code: string; label: string; status: string; connections: string[]; default_connection: string }> }>; adms: { server_address: string; server_port: number } }>('/api/hr/attendance/devices/catalog', undefined, signal) });
  const models = catalog.data?.catalog[0]?.models ?? [];
  const [f, setF] = useState({ model_code: 'K40_PRO', connection_type: 'pull_tcp', name: '', host: '', port: '4370', comm_key: '', serial_number: '', gateway_id: '' });
  const [test, setTest] = useState<{ ok: boolean | null; message?: string; latency_ms?: number; info?: Record<string, unknown>; capabilities?: Record<string, boolean> } | null>(null);
  const [busy, setBusy] = useState(false);
  const model = models.find((m) => m.code === f.model_code);
  const body = () => ({ ...f, manufacturer: 'zkteco', port: Number(f.port) || 4370, comm_key: f.comm_key || undefined, gateway_id: f.gateway_id ? Number(f.gateway_id) : undefined, serial_number: f.serial_number || (test?.info?.serial as string | undefined) || undefined });
  const runTest = async () => {
    setBusy(true);
    try {
      setTest(await apiPost('/api/hr/attendance/devices/test', body()));
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      const r = await apiPost<{ device: { id: number }; key: string | null }>('/api/hr/attendance/devices', { ...body(), test: test ?? undefined });
      toast('success', r.key ? `Saved. Device key (shown once): ${r.key}` : 'Device saved.');
      onDone(r.device.id);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Panel title="Add device" sub="Model → connection → details → Test Connection → Save.">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Model">
          <select className={input} value={f.model_code} onChange={(e) => {
            const m = models.find((x) => x.code === e.target.value);
            setF({ ...f, model_code: e.target.value, connection_type: m?.default_connection ?? 'pull_tcp' });
          }}>
            {models.map((m) => <option key={m.code} value={m.code}>{m.label} · {m.status.replace('_', ' ').toLowerCase()}</option>)}
          </select>
        </Field>
        <Field label="Connection">
          <select className={input} value={f.connection_type} onChange={set('connection_type')}>
            {(model?.connections ?? ['pull_tcp']).filter((c) => c !== 'cloud').map((c) => <option key={c} value={c}>{CONNECTION[c] ?? c}</option>)}
          </select>
        </Field>
        <Field label="Name"><input className={input} value={f.name} onChange={set('name')} /></Field>
        {f.connection_type !== 'adms' ? <Field label="IP address"><input className={input} value={f.host} onChange={set('host')} placeholder="192.168.1.201" /></Field> : null}
        {f.connection_type !== 'adms' ? <Field label="Port"><input className={input} value={f.port} onChange={set('port')} /></Field> : null}
        {f.connection_type !== 'adms' ? <Field label="Communication key" hint="Stored encrypted; never shown again."><input className={input} type="password" value={f.comm_key} onChange={set('comm_key')} /></Field> : null}
        {f.connection_type === 'gateway' ? <Field label="Gateway ID"><input className={input} value={f.gateway_id} onChange={set('gateway_id')} /></Field> : null}
        {f.connection_type === 'adms' || f.connection_type === 'gateway' ? <Field label="Serial number"><input className={input} value={f.serial_number} onChange={set('serial_number')} /></Field> : null}
      </div>
      {f.connection_type === 'adms' && catalog.data ? (
        <p className="pt-2 text-[12.5px] text-ink-2">On the device: Comm. › Cloud Server Setting — server <b>{catalog.data.adms.server_address}</b>, port <b>{catalog.data.adms.server_port}</b>, HTTPS on.</p>
      ) : null}
      {test ? (
        <div className="pt-2 text-[12.5px]">
          {test.ok ? <Facts rows={Object.entries(test.info ?? {}).filter(([, v]) => typeof v !== 'object').map(([k, v]) => [k, String(v)])} /> : <p className="text-danger">{test.message ?? 'The device did not answer.'}</p>}
        </div>
      ) : null}
      <div className="flex gap-2 pt-3">
        {f.connection_type.startsWith('pull') ? <button type="button" className={btn} disabled={busy} onClick={() => void runTest()}>Test connection</button> : null}
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()}>Save device</button>
      </div>
    </Panel>
  );
}

function SyncCenter({ canRetry }: { canRetry: boolean }) {
  const q = useQuery({ queryKey: ['hr', 'att-jobs'], queryFn: ({ signal }) => apiGet<{ items: Job[] }>('/api/hr/attendance/devices/sync-jobs', undefined, signal), refetchInterval: 15_000 });
  const retry = async (j: Job) => {
    try {
      await apiPost(`/api/hr/attendance/devices/sync-jobs/${j.id}/retry`);
      void q.refetch();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const rows = q.data?.items ?? [];
  if (!rows.length) return <Empty text="No sync jobs yet." />;
  return (
    <div className="flex flex-col text-[12.5px]">
      {rows.map((j) => (
        <div key={j.id} className="flex items-center gap-3 border-b border-line/70 py-1.5">
          <span className="w-[160px] shrink-0 font-semibold">#{j.id} {j.kind}</span>
          <span className="w-[160px] shrink-0 truncate">{j.device_name ?? '—'}</span>
          <StatusChip>{j.status}</StatusChip>
          <span className="w-[60px] shrink-0">{j.attempts}/{j.max_attempts}</span>
          <span className="min-w-0 flex-1 truncate text-ink-3" title={j.error ?? ''}>{j.error ?? ''}</span>
          {canRetry && ['FAILED', 'RETRYING', 'CANCELLED'].includes(j.status) ? <button type="button" className={btnSmall} onClick={() => void retry(j)}>Retry</button> : null}
        </div>
      ))}
    </div>
  );
}

function Unmapped({ onOpen }: { onOpen: (deviceId: number) => void }) {
  const q = useQuery({ queryKey: ['hr', 'att-unmapped'], queryFn: ({ signal }) => apiGet<{ total: number; groups: Array<{ device_id: number; device_name: string; device_user_id: string; punches: number; last_at: string }> }>('/api/hr/attendance/devices/unmapped', undefined, signal) });
  if (!q.data) return <Spinner />;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] text-ink-2">{attentionLine(q.data.total) ?? 'Every punch is linked to an employee.'}</p>
      {q.data.groups.map((g) => (
        <div key={`${g.device_id}-${g.device_user_id}`} className="flex items-center gap-3 border-b border-line/70 py-1.5 text-[12.5px]">
          <span className="w-[160px] shrink-0">{g.device_name}</span>
          <span className="w-[100px] shrink-0 font-semibold">{g.device_user_id}</span>
          <span className="min-w-0 flex-1">{g.punches} punch(es), last {g.last_at}</span>
          <button type="button" className={btnSmall} onClick={() => onOpen(g.device_id)}>Map employee</button>
        </div>
      ))}
    </div>
  );
}

function Live() {
  const q = useQuery({ queryKey: ['hr', 'att-live'], queryFn: ({ signal }) => apiGet<{ items: Array<Record<string, string | null>> }>('/api/hr/attendance/live', undefined, signal), refetchInterval: 10_000 });
  const rows = q.data?.items ?? [];
  if (!rows.length) return <Empty text="No punches yet today." />;
  return (
    <div className="flex flex-col text-[12.5px]">
      {rows.map((r) => (
        <div key={String(r.id)} className="flex gap-3 border-b border-line/70 py-1.5">
          <span className="w-[140px] shrink-0 font-mono text-ink-3">{r.event_time}</span>
          <span className="min-w-0 flex-1 truncate font-semibold">{r.employee_name ?? `device user ${r.device_user_id}`}</span>
          <span className="w-[90px] shrink-0">{r.applied_as ?? r.status}</span>
          <span className="w-[160px] shrink-0 truncate text-ink-3">{r.device}</span>
        </div>
      ))}
    </div>
  );
}

function Gateways() {
  const q = useQuery({ queryKey: ['hr', 'att-gateways'], queryFn: ({ signal }) => apiGet<{ items: Array<{ id: number; name: string; status: string; online: boolean; hostname: string | null; last_seen_at: string | null; devices?: number }>; can_manage: boolean }>('/api/hr/attendance/gateways', undefined, signal) });
  const [name, setName] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const add = async () => {
    try {
      const r = await apiPost<{ pairing_code: string }>('/api/hr/attendance/gateways', { name });
      setCode(r.pairing_code);
      setName('');
      void q.refetch();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const revoke = async (id: number) => {
    try {
      await apiPost(`/api/hr/attendance/gateways/${id}/revoke`);
      void q.refetch();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] text-ink-2">A gateway runs at the site, reaches LAN devices with the ZK protocol and talks to WorkSuite outbound over HTTPS.</p>
      {q.data?.can_manage ? (
        <div className="flex gap-2">
          <input className={cx(input, 'max-w-[260px]')} value={name} onChange={(e) => setName(e.target.value)} placeholder="Site name" aria-label="Gateway name" />
          <button type="button" className={btnPrimary} disabled={!name} onClick={() => void add()}>Add gateway</button>
        </div>
      ) : null}
      {code ? (
        <div className="rounded-[12px] border border-line bg-subtle px-4 py-3 text-[13px]">
          Pairing code (30 minutes, once): <b className="font-mono text-[16px]">{code}</b>
          <div className="font-mono text-[12px] text-ink-3">worksuite-attendance-gateway setup --code {code}</div>
        </div>
      ) : null}
      {(q.data?.items ?? []).map((g) => (
        <div key={g.id} className="flex items-center gap-3 border-b border-line/70 py-1.5 text-[12.5px]">
          <b className="w-[180px] shrink-0">{g.name}</b>
          <span className="min-w-0 flex-1 text-ink-3">{g.hostname ?? 'not paired'} · seen {ago(g.last_seen_at)} · {g.devices ?? 0} device(s)</span>
          <StatusChip>{g.status === 'pending' ? 'Waiting to pair' : g.online ? 'Online' : 'Offline'}</StatusChip>
          {q.data?.can_manage ? <button type="button" className={btnBad} onClick={() => void revoke(g.id)}>Revoke</button> : null}
        </div>
      ))}
    </div>
  );
}

function DeviceSettings() {
  const q = useQuery({ queryKey: ['hr', 'att-settings'], queryFn: ({ signal }) => apiGet<{ settings: Record<string, string | number | boolean>; permissions: { edit: boolean } }>('/api/hr/attendance/devices/settings', undefined, signal) });
  const [v, setV] = useState<Record<string, string | number | boolean> | null>(null);
  const values = v ?? q.data?.settings ?? {};
  const save = async () => {
    try {
      await apiPut('/api/hr/attendance/devices/settings', values);
      toast('success', 'Saved.');
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  if (!q.data) return <Spinner />;
  const edit = q.data.permissions.edit;
  const num = (k: string, label: string) => (
    <Field label={label}>
      <input className={input} disabled={!edit} value={String(values[k] ?? '')} onChange={(e) => setV({ ...values, [k]: e.target.value })} />
    </Field>
  );
  return (
    <Panel title="Settings › Biometric devices" sub="Defaults: auto sync on every minute, time sync daily, offline alert after 10 minutes, 5 retries, raw data 90 days.">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Pairing strategy">
          <select className={input} disabled={!edit} value={String(values.hr_device_punch_mode ?? 'auto')} onChange={(e) => setV({ ...values, hr_device_punch_mode: e.target.value })}>
            <option value="auto">Alternate in / out, shift aware</option>
            <option value="first_last">First in, last out</option>
            <option value="device_status">Device status key decides</option>
          </select>
        </Field>
        <Field label="Sync every">
          <select className={input} disabled={!edit} value={String(values.hr_device_sync_interval_seconds ?? '60')} onChange={(e) => setV({ ...values, hr_device_sync_interval_seconds: e.target.value })}>
            <option value="30">30 seconds</option>
            <option value="60">1 minute</option>
            <option value="300">5 minutes</option>
          </select>
        </Field>
        {num('hr_device_offline_alert_minutes', 'Offline alert after (minutes)')}
        {num('hr_device_job_retries', 'Retries')}
        {num('hr_device_raw_retention_days', 'Raw data kept (days)')}
        {num('hr_device_drift_warning_seconds', 'Clock drift warning (s)')}
      </div>
      {edit ? (
        <div className="pt-3">
          <button type="button" className={btnPrimary} onClick={() => void save()}>Save</button>
        </div>
      ) : null}
    </Panel>
  );
}
