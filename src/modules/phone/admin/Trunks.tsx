import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from '../../../core/toasts';
import { Button, cx, Empty, IconButton, Modal, Spinner } from '../../../components/ui';
import { isNotOffered, NOT_OFFERED, phoneApi, PK, rowsOf, useGateways, useRoutes, useSims, useTrunks, type Gateway, type OutboundRoute, type RouteTest, type SimCard, type Trunk } from '../api';
import { testRoute, type RouteTestStep } from '../lib/dialpattern';
import { money, prettyNumber } from '../lib/format';
import { LK_ROUTES } from '../lib/lkroutes';
import { ConfirmButton, Field, INPUT, Mono, NotOffered, PageBody, PageHeader, Panel, StatusChip, TD, TR, Table } from '../parts';
import { usePhoneState } from '../softphone/client';
import { Checkbox } from '../../../components/Checkbox';

/**
 * A06 · Trunks, gateways, routes (VOIP-TRK-01…05, VOIP-DEP-03/05, G-03, G-18). SIP trunks with status, channels in
 * use, LCR order and rate; each GSM gateway's SIMs with signal, balance and expiry; outbound routes in the order the
 * switch tries them, with failover and rewrites; and a route tester — which route, trunk and cost a number would use.
 * Emergency routes are never blocked.
 */
export default function Trunks() {
  const qc = useQueryClient();
  const trunks = useTrunks();
  const routes = useRoutes();
  const gateways = useGateways();
  const sims = useSims();
  const [editTrunk, setEditTrunk] = useState<Trunk | 'new' | null>(null);
  const [editRoute, setEditRoute] = useState<OutboundRoute | 'new' | null>(null);
  const [editGateway, setEditGateway] = useState<Gateway | 'new' | null>(null);
  const [seeding, setSeeding] = useState(false);
  const offered = trunks.data?.offered;
  const tlist = rowsOf(trunks.data);
  const rlist = [...rowsOf(routes.data)].sort((a, b) => a.priority - b.priority || a.id - b.id);
  const refresh = () => {
    for (const k of [PK.trunks, PK.routes, PK.gateways, PK.sims]) void qc.invalidateQueries({ queryKey: k });
  };
  const trunkName = (id: number | null) => (id === null ? '—' : (tlist.find((t) => t.id === id)?.name ?? `#${id}`));

  /** VOIP-DEP-05: the reference Sri Lankan routes on the chosen trunks. */
  const seed = async (landline: number | null, gsm: number | null, carrier: number | null) => {
    setSeeding(true);
    let made = 0;
    try {
      const pick = (k: 'landline' | 'gsm' | 'carrier' | 'none' | null) => (k === 'landline' ? landline : k === 'gsm' ? gsm : k === 'carrier' ? carrier : null);
      for (const r of LK_ROUTES) {
        if (rlist.some((x) => x.pattern === r.pattern)) continue;
        await phoneApi.saveRoute(null, { name: r.name, pattern: r.pattern, kind: r.kind, trunk_id: pick(r.primary), failover_trunk_id: pick(r.failover), priority: r.priority, strip_digits: 0, prepend: null, enabled: true });
        made += 1;
      }
      toast('success', `${made} routes added. Apply the configuration to make them live.`);
      refresh();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Trunks & routes"
        actions={
          offered ? (
            <>
              <Button icon="sim" onClick={() => setEditGateway('new')}>
                Add GSM gateway
              </Button>
              <Button variant="primary" icon="plus" onClick={() => setEditTrunk('new')}>
                Add trunk
              </Button>
            </>
          ) : null
        }
      />
      <PageBody>
        {trunks.isLoading ? (
          <Spinner />
        ) : offered === false ? (
          <NotOffered what="Managing trunks, gateways and routes" detail="The switch still uses the trunks and routes configured on it; WorkSuite only renders them into the configuration today (G-03)." />
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="flex flex-col gap-4">
              <Panel title="SIP trunks">
                {tlist.length ? (
                  <Table head={['Trunk', 'Status', 'Host', 'Channels', 'Order', 'Rate / min', 'Today', '']}>
                    {[...tlist]
                      .sort((a, b) => a.priority - b.priority)
                      .map((t) => (
                        <tr key={t.id} className={TR}>
                          <td className={TD}>
                            <div className="font-semibold">{t.name}</div>
                            <div className="text-[11px] text-ink-3">{[t.provider, t.kind === 'gsm' ? 'GSM' : t.transport.toUpperCase()].filter(Boolean).join(' · ')}</div>
                          </td>
                          <td className={TD}>
                            <StatusChip status={t.enabled ? t.status : 'disabled'} />
                          </td>
                          <td className={TD}>
                            <Mono className="text-[11.5px]">
                              {t.host ?? '—'}
                              {t.port && t.port !== 5060 ? `:${t.port}` : ''}
                            </Mono>
                            {t.username ? <div className="text-[11px] text-ink-3">user {t.username}</div> : null}
                          </td>
                          <td className={TD}>
                            <Mono>
                              {t.channels_in_use ?? '—'} / {t.max_channels || '∞'}
                            </Mono>
                          </td>
                          <td className={TD}>{t.priority}</td>
                          <td className={TD}>
                            <Mono>{t.cost_per_min === null ? 'not rated' : money(t.cost_per_min, t.currency ?? 'LKR')}</Mono>
                          </td>
                          <td className={TD}>{t.calls_today ?? '—'} calls</td>
                          <td className={TD}>
                            <IconButton icon="pen" label={`Edit ${t.name}`} onClick={() => setEditTrunk(t)} />
                          </td>
                        </tr>
                      ))}
                  </Table>
                ) : (
                  <Empty icon="route" title="No trunks" hint="Add the SIP or GSM trunks the switch uses: an HT813 FXO line, a Dinstar gateway, a carrier." />
                )}
              </Panel>
              <GatewayPanels gateways={rowsOf(gateways.data)} sims={rowsOf(sims.data)} offered={gateways.data?.offered !== false} onEdit={(g) => setEditGateway(g)} onChanged={refresh} />
              <Panel
                title="Outbound routes · first match wins"
                action={
                  <span className="flex gap-2">
                    <SeedButton trunks={tlist} loading={seeding} onSeed={seed} />
                    <Button icon="plus" disabled={routes.data?.offered === false} onClick={() => setEditRoute('new')}>
                      Add route
                    </Button>
                  </span>
                }
              >
                {routes.data?.offered === false ? (
                  <p className="text-[12.5px] text-ink-3">{NOT_OFFERED}</p>
                ) : rlist.length ? (
                  <ol className="flex flex-col">
                    {rlist.map((r, i) => (
                      <li key={r.id} className={cx('grid grid-cols-[24px_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3 border-b border-line py-2 text-[12.5px] last:border-b-0', !r.enabled && 'opacity-50')}>
                        <span className="font-mono text-ink-3">{i + 1}</span>
                        <b className="truncate">{r.name}</b>
                        <Mono className="truncate text-[11.5px]">{r.pattern}</Mono>
                        <span className="truncate">{r.trunk_id ? trunkName(r.trunk_id) : 'Refuse'}</span>
                        <span className="truncate text-ink-3">{r.failover_trunk_id ? `then ${trunkName(r.failover_trunk_id)}` : 'then —'}</span>
                        <span className="flex items-center gap-1">
                          <span className="text-[11px] text-ink-3">{r.strip_digits ? `strip ${r.strip_digits}` : ''}{r.prepend ? ` +${r.prepend}` : ''}</span>
                          <IconButton icon="pen" label={`Edit ${r.name}`} onClick={() => setEditRoute(r)} />
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <Empty icon="route" title="No outbound routes" hint="Add the recommended Sri Lankan routes, or your own." />
                )}
              </Panel>
            </div>
            <Tester routes={rlist} trunks={tlist} />
          </div>
        )}
      </PageBody>
      {editTrunk ? <TrunkEditor trunk={editTrunk === 'new' ? null : editTrunk} gateways={rowsOf(gateways.data)} onClose={() => setEditTrunk(null)} onSaved={() => (setEditTrunk(null), refresh())} /> : null}
      {editRoute ? <RouteEditor route={editRoute === 'new' ? null : editRoute} trunks={tlist} next={(rlist.at(-1)?.priority ?? 0) + 10} onClose={() => setEditRoute(null)} onSaved={() => (setEditRoute(null), refresh())} /> : null}
      {editGateway ? <GatewayEditor gateway={editGateway === 'new' ? null : editGateway} onClose={() => setEditGateway(null)} onSaved={() => (setEditGateway(null), refresh())} /> : null}
    </div>
  );
}

function SeedButton({ trunks, loading, onSeed }: { trunks: Trunk[]; loading: boolean; onSeed: (landline: number | null, gsm: number | null, carrier: number | null) => void }) {
  const [open, setOpen] = useState(false);
  const guess = (re: RegExp) => trunks.find((t) => re.test(`${t.name} ${t.provider ?? ''}`))?.id ?? null;
  const [landline, setLandline] = useState<string>(() => String(guess(/slt|pstn|fxo|ht8|landline/i) ?? ''));
  const [gsm, setGsm] = useState<string>(() => String(guess(/gsm|dinstar|sim|mobile/i) ?? ''));
  const [carrier, setCarrier] = useState('');
  const opts = (
    <>
      <option value="">None</option>
      {trunks.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </>
  );
  return (
    <>
      <Button icon="sparkles" loading={loading} disabled={!trunks.length} onClick={() => setOpen(true)}>
        Sri Lankan routes
      </Button>
      {open ? (
        <Modal title="Add the recommended Sri Lankan routes" onClose={() => setOpen(false)} footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={() => { setOpen(false); onSeed(landline ? Number(landline) : null, gsm ? Number(gsm) : null, carrier ? Number(carrier) : null); }}>Add routes</Button></>}>
          <div className="flex flex-col gap-3 text-[12.5px]">
            <div className="grid grid-cols-3 gap-2">
              <Field label="Landline (FXO)">
                <select aria-label="Landline trunk" value={landline} onChange={(e) => setLandline(e.target.value)} className={INPUT}>
                  {opts}
                </select>
              </Field>
              <Field label="GSM gateway">
                <select aria-label="GSM trunk" value={gsm} onChange={(e) => setGsm(e.target.value)} className={INPUT}>
                  {opts}
                </select>
              </Field>
              <Field label="International carrier">
                <select aria-label="International trunk" value={carrier} onChange={(e) => setCarrier(e.target.value)} className={INPUT}>
                  {opts}
                </select>
              </Field>
            </div>
            <ol className="flex flex-col gap-1">
              {LK_ROUTES.map((r) => (
                <li key={r.pattern} className="flex gap-2">
                  <Mono className="w-[140px] shrink-0">{r.pattern}</Mono>
                  <span>
                    <b>{r.name}</b> — {r.note}
                  </span>
                </li>
              ))}
            </ol>
            <p className="text-[11.5px] text-ink-3">Routes that already exist with the same pattern are left alone. International calls never go through the GSM gateway: terminating international traffic on SIMs is unlawful in Sri Lanka.</p>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function GatewayPanels({ gateways, sims, offered, onEdit, onChanged }: { gateways: Gateway[]; sims: SimCard[]; offered: boolean; onEdit: (g: Gateway) => void; onChanged: () => void }) {
  const [polling, setPolling] = useState<number | null>(null);
  if (!offered) return null;
  return (
    <>
      {gateways.map((g) => {
        const ports = sims.filter((s) => s.gateway_id === g.id).sort((a, b) => (a.channel ?? 0) - (b.channel ?? 0));
        return (
          <Panel
            key={g.id}
            title={`GSM gateway · ${[g.vendor, g.model].filter(Boolean).join(' ') || g.name}${g.channels ? ` (${g.channels} × 4G)` : ''}`}
            sub={[g.ip, g.via ? `via ${g.via}` : null, g.status].filter(Boolean).join(' · ')}
            action={
              <span className="flex gap-1">
                <Button size="sm" loading={polling === g.id} onClick={() => {
                  setPolling(g.id);
                  void phoneApi.pollGateway(g.id).then(
                    (r) => {
                      toast('success', r.message ?? 'Gateway read.');
                      onChanged();
                    },
                    (e: unknown) => toast(isNotOffered(e) ? 'info' : 'error', isNotOffered(e) ? 'Reading the gateway’s own status needs a newer server (G-18).' : (e as Error).message),
                  ).finally(() => setPolling(null));
                }}>
                  Read status
                </Button>
                <IconButton icon="pen" label={`Edit ${g.name}`} onClick={() => onEdit(g)} />
              </span>
            }
          >
            {ports.length ? (
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                {ports.map((s) => {
                  const low = s.balance !== null && s.balance < 500;
                  const expiring = s.expires_on ? Date.parse(s.expires_on) - Date.now() < 14 * 86_400_000 : false;
                  return (
                    <div key={s.id} className={cx('rounded-[10px] border p-2.5 text-[11.5px]', s.status === 'ready' ? 'border-line' : 'border-danger/30 bg-danger-bg')}>
                      <div className="flex items-center justify-between">
                        <b className="text-[12.5px]">
                          Port {s.channel ?? '?'} · {s.operator ?? 'SIM'}
                        </b>
                        <span className={cx('font-mono', s.signal_dbm === null ? 'text-ink-3' : s.signal_dbm > -85 ? 'text-success' : s.signal_dbm > -95 ? 'text-warning' : 'text-danger')}>{s.signal_dbm === null ? (s.status === 'no_signal' ? 'no signal' : '—') : `${s.signal_dbm} dBm`}</span>
                      </div>
                      <Mono className="block">{prettyNumber(s.msisdn) || '—'}</Mono>
                      <span className={cx('block', low && 'font-semibold text-danger')}>
                        Balance {s.balance === null ? 'unknown' : `${s.currency ?? 'LKR'} ${s.balance.toLocaleString()}`}
                      </span>
                      <span className={cx('block', expiring ? 'font-semibold text-danger' : 'text-ink-3')}>{s.expires_on ? `expires ${s.expires_on}` : ''}</span>
                      {s.status !== 'ready' ? <span className="font-semibold text-danger">{s.status.replace('_', ' ')}</span> : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-[12px] text-ink-3">No SIMs recorded for this gateway yet. Read status to fill them from the gateway.</p>
            )}
          </Panel>
        );
      })}
    </>
  );
}

function Tester({ routes, trunks }: { routes: OutboundRoute[]; trunks: Trunk[] }) {
  const ext = usePhoneState((s) => s.extension);
  const [n, setN] = useState('');
  const [server, setServer] = useState<RouteTest | null>(null);
  const [asked, setAsked] = useState(false);
  const local = testRoute(n, routes, trunks);
  const ask = async () => {
    const r = await phoneApi.testRoute(n, ext).catch(() => null);
    setAsked(true);
    setServer(r && r.offered ? r.data : null);
  };
  const steps: RouteTestStep[] = server ? server.steps.map((s) => ({ text: s.text, tone: s.tone ?? 'ok' })) : local.steps;
  return (
    <Panel title="Test a number" sub={ext ? `Dialled from ${ext}` : undefined} bodyClassName="flex flex-col gap-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <input value={n} onChange={(e) => (setN(e.target.value), setServer(null), setAsked(false))} placeholder="0771234567" inputMode="tel" aria-label="Number to test" className={cx(INPUT, 'font-mono')} />
        <Button type="submit" disabled={!n.trim()}>
          Test
        </Button>
      </form>
      {n.trim() ? (
        <ol className="flex flex-col gap-2 text-[12.5px]">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-2">
              <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold', s.tone === 'ok' ? 'bg-selection text-primary' : s.tone === 'warn' ? 'bg-warning-bg text-warning' : 'bg-danger-bg text-danger')}>{i + 1}</span>
              <span>{s.text}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <p className="text-[11.5px] text-ink-3">{asked && !server ? 'Worked out here from the routes and trunks above; the switch itself was not asked.' : server ? 'As the switch would route it.' : 'Worked out from the routes and trunks above as you type.'}</p>
      <p className="rounded-[8px] bg-subtle px-2.5 py-2 text-[11.5px] text-ink-3">Emergency numbers (110, 119, 1990) always use the first available trunk and are never blocked by budgets or time rules.</p>
    </Panel>
  );
}

function TrunkEditor({ trunk, gateways, onClose, onSaved }: { trunk: Trunk | null; gateways: Gateway[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: trunk?.name ?? '',
    provider: trunk?.provider ?? '',
    kind: trunk?.kind ?? 'sip',
    host: trunk?.host ?? '',
    port: String(trunk?.port ?? 5060),
    username: trunk?.username ?? '',
    secret: '',
    transport: trunk?.transport ?? 'udp',
    registers: trunk?.registers ?? false,
    codecs: trunk?.codecs ?? 'alaw,ulaw',
    caller_id: trunk?.caller_id ?? '',
    max_channels: String(trunk?.max_channels ?? 0),
    priority: String(trunk?.priority ?? 10),
    cost_per_min: trunk?.cost_per_min === null || trunk?.cost_per_min === undefined ? '' : String(trunk.cost_per_min),
    gateway_id: trunk?.gateway_id ? String(trunk.gateway_id) : '',
    enabled: trunk?.enabled ?? true,
  });
  const [saving, setSaving] = useState(false);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const save = async () => {
    setSaving(true);
    try {
      await phoneApi.saveTrunk(trunk?.id ?? null, {
        name: f.name.trim(),
        provider: f.provider || null,
        kind: f.kind,
        host: f.host || null,
        port: Number(f.port) || 5060,
        username: f.username || null,
        ...(f.secret ? { secret: f.secret } : {}),
        transport: f.transport,
        registers: f.registers,
        codecs: f.codecs || null,
        caller_id: f.caller_id || null,
        max_channels: Number(f.max_channels) || 0,
        priority: Number(f.priority) || 10,
        cost_per_min: f.cost_per_min === '' ? null : Number(f.cost_per_min),
        gateway_id: f.gateway_id ? Number(f.gateway_id) : null,
        enabled: f.enabled,
      });
      toast('success', 'Saved. Apply the configuration to make it live.');
      onSaved();
    } catch (e) {
      toast(isNotOffered(e) ? 'info' : 'error', isNotOffered(e) ? NOT_OFFERED : (e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title={trunk ? `Edit ${trunk.name}` : 'Add a trunk'} width={600} onClose={onClose} footer={<>{trunk ? <ConfirmButton label="Delete" confirm="Delete trunk" onConfirm={() => void phoneApi.deleteTrunk(trunk.id).then(onSaved, (e: Error) => toast('error', e.message))} /> : null}<span className="flex-1" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={saving} disabled={!f.name.trim()} onClick={() => void save()}>Save</Button></>}>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Name" className="col-span-2">
          <input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="SLT-PSTN" aria-label="Trunk name" className={INPUT} />
        </Field>
        <Field label="Kind">
          <select aria-label="Kind" value={f.kind} onChange={(e) => set({ kind: e.target.value as 'sip' | 'gsm' })} className={INPUT}>
            <option value="sip">SIP</option>
            <option value="gsm">GSM gateway</option>
          </select>
        </Field>
        <Field label="Provider">
          <input value={f.provider} onChange={(e) => set({ provider: e.target.value })} placeholder="HT813 FXO · SLT landline" aria-label="Provider" className={INPUT} />
        </Field>
        <Field label="Host">
          <input value={f.host} onChange={(e) => set({ host: e.target.value })} placeholder="192.168.10.21" aria-label="Host" className={INPUT} />
        </Field>
        <Field label="Port">
          <input value={f.port} onChange={(e) => set({ port: e.target.value.replace(/\D/g, '') })} aria-label="Port" className={INPUT} />
        </Field>
        <Field label="Username">
          <input value={f.username} onChange={(e) => set({ username: e.target.value })} placeholder="9001" aria-label="Username" className={INPUT} />
        </Field>
        <Field label="Secret">
          <input type="password" autoComplete="new-password" value={f.secret} onChange={(e) => set({ secret: e.target.value })} placeholder={trunk?.has_secret ? 'Set · leave blank to keep' : 'Not set'} aria-label="Secret" className={INPUT} />
        </Field>
        <Field label="Transport">
          <select aria-label="Transport" value={f.transport} onChange={(e) => set({ transport: e.target.value as Trunk['transport'] })} className={INPUT}>
            <option value="udp">UDP (inside the tunnel)</option>
            <option value="tcp">TCP</option>
            <option value="tls">TLS</option>
          </select>
        </Field>
        <Field label="Codecs">
          <input value={f.codecs} onChange={(e) => set({ codecs: e.target.value })} aria-label="Codecs" className={INPUT} />
        </Field>
        <Field label="Caller ID">
          <input value={f.caller_id} onChange={(e) => set({ caller_id: e.target.value })} placeholder="0112447000" aria-label="Caller ID" className={INPUT} />
        </Field>
        <Field label="Max channels (0 = any)">
          <input value={f.max_channels} onChange={(e) => set({ max_channels: e.target.value.replace(/\D/g, '') })} aria-label="Max channels" className={INPUT} />
        </Field>
        <Field label="LCR order">
          <input value={f.priority} onChange={(e) => set({ priority: e.target.value.replace(/\D/g, '') })} aria-label="Order" className={INPUT} />
        </Field>
        <Field label="Rate per minute" hint="Leave blank when unknown: cost is then not counted.">
          <input value={f.cost_per_min} onChange={(e) => set({ cost_per_min: e.target.value.replace(/[^0-9.]/g, '') })} aria-label="Rate per minute" className={INPUT} />
        </Field>
        {f.kind === 'gsm' ? (
          <Field label="Gateway">
            <select aria-label="Gateway" value={f.gateway_id} onChange={(e) => set({ gateway_id: e.target.value })} className={INPUT}>
              <option value="">None</option>
              {gateways.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <div className="col-span-3 flex gap-4 text-[12.5px]">
          <label className="flex items-center gap-1.5">
            <Checkbox checked={f.registers} onChange={(e) => set({ registers: e.target.checked })} /> The trunk registers to the switch
          </label>
          <label className="flex items-center gap-1.5">
            <Checkbox checked={f.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Enabled
          </label>
        </div>
      </div>
    </Modal>
  );
}

function RouteEditor({ route, trunks, next, onClose, onSaved }: { route: OutboundRoute | null; trunks: Trunk[]; next: number; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: route?.name ?? '',
    pattern: route?.pattern ?? '',
    kind: route?.kind ?? 'other',
    trunk_id: route?.trunk_id ? String(route.trunk_id) : '',
    failover_trunk_id: route?.failover_trunk_id ? String(route.failover_trunk_id) : '',
    strip_digits: String(route?.strip_digits ?? 0),
    prepend: route?.prepend ?? '',
    priority: String(route?.priority ?? next),
    enabled: route?.enabled ?? true,
  });
  const [saving, setSaving] = useState(false);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const valid = f.name.trim() && /^_?[0-9XZNxzn[\]\-.!*#+]{1,40}$/.test(f.pattern.trim());
  const save = async () => {
    setSaving(true);
    try {
      await phoneApi.saveRoute(route?.id ?? null, {
        name: f.name.trim(),
        pattern: f.pattern.trim(),
        kind: f.kind,
        trunk_id: f.trunk_id ? Number(f.trunk_id) : null,
        failover_trunk_id: f.failover_trunk_id ? Number(f.failover_trunk_id) : null,
        strip_digits: Number(f.strip_digits) || 0,
        prepend: f.prepend || null,
        priority: Number(f.priority) || next,
        enabled: f.enabled,
      });
      toast('success', 'Saved. Apply the configuration to make it live.');
      onSaved();
    } catch (e) {
      toast(isNotOffered(e) ? 'info' : 'error', isNotOffered(e) ? NOT_OFFERED : (e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const tOpts = trunks.map((t) => (
    <option key={t.id} value={t.id}>
      {t.name}
    </option>
  ));
  return (
    <Modal title={route ? `Edit ${route.name}` : 'Add an outbound route'} width={560} onClose={onClose} footer={<>{route ? <ConfirmButton label="Delete" confirm="Delete route" onConfirm={() => void phoneApi.deleteRoute(route.id).then(onSaved, (e: Error) => toast('error', e.message))} /> : null}<span className="flex-1" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={saving} disabled={!valid} onClick={() => void save()}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="LK-MOBILE" aria-label="Route name" className={INPUT} />
        </Field>
        <Field label="Dial pattern" hint="_07XXXXXXXX, _0[1-689]XXXXXXXX, 119, _00.">
          <input value={f.pattern} onChange={(e) => set({ pattern: e.target.value })} aria-label="Dial pattern" className={cx(INPUT, 'font-mono')} />
        </Field>
        <Field label="Kind">
          <select aria-label="Kind" value={f.kind} onChange={(e) => set({ kind: e.target.value as OutboundRoute['kind'] })} className={INPUT}>
            <option value="emergency">Emergency (never blocked)</option>
            <option value="mobile">Mobile</option>
            <option value="local">Local / landline</option>
            <option value="international">International</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Order">
          <input value={f.priority} onChange={(e) => set({ priority: e.target.value.replace(/\D/g, '') })} aria-label="Order" className={INPUT} />
        </Field>
        <Field label="Trunk">
          <select aria-label="Trunk" value={f.trunk_id} onChange={(e) => set({ trunk_id: e.target.value })} className={INPUT}>
            <option value="">None — refuse the call</option>
            {tOpts}
          </select>
        </Field>
        <Field label="Failover trunk">
          <select aria-label="Failover trunk" value={f.failover_trunk_id} onChange={(e) => set({ failover_trunk_id: e.target.value })} className={INPUT}>
            <option value="">None</option>
            {tOpts}
          </select>
        </Field>
        <Field label="Strip leading digits">
          <input value={f.strip_digits} onChange={(e) => set({ strip_digits: e.target.value.replace(/\D/g, '') })} aria-label="Strip digits" className={INPUT} />
        </Field>
        <Field label="Prepend">
          <input value={f.prepend} onChange={(e) => set({ prepend: e.target.value.replace(/[^0-9+]/g, '') })} aria-label="Prepend" className={cx(INPUT, 'font-mono')} />
        </Field>
        <label className="col-span-2 flex items-center gap-1.5 text-[12.5px]">
          <Checkbox checked={f.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Enabled
        </label>
      </div>
    </Modal>
  );
}

function GatewayEditor({ gateway, onClose, onSaved }: { gateway: Gateway | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: gateway?.name ?? '',
    vendor: gateway?.vendor ?? 'Dinstar',
    model: gateway?.model ?? 'UC2000-VE-4G',
    ip: gateway?.ip ?? '',
    port: String(gateway?.port ?? 5060),
    channels: String(gateway?.channels ?? 4),
    adapter: gateway?.adapter ?? 'dinstar',
    admin_password: '',
    notes: gateway?.notes ?? '',
    enabled: gateway?.enabled ?? true,
  });
  const [saving, setSaving] = useState(false);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const save = async () => {
    setSaving(true);
    try {
      await phoneApi.saveGateway(gateway?.id ?? null, { name: f.name.trim(), vendor: f.vendor || null, model: f.model || null, ip: f.ip || null, port: Number(f.port) || 5060, channels: Number(f.channels) || 4, adapter: (f.adapter || null) as Gateway['adapter'], notes: f.notes || null, enabled: f.enabled, ...(f.admin_password ? { admin_password: f.admin_password } : {}) });
      toast('success', 'Gateway saved.');
      onSaved();
    } catch (e) {
      toast(isNotOffered(e) ? 'info' : 'error', isNotOffered(e) ? NOT_OFFERED : (e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title={gateway ? `Edit ${gateway.name}` : 'Add a GSM gateway'} width={560} onClose={onClose} footer={<>{gateway ? <ConfirmButton label="Delete" confirm="Delete gateway" onConfirm={() => void phoneApi.deleteGateway(gateway.id).then(onSaved, (e: Error) => toast('error', e.message))} /> : null}<span className="flex-1" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={saving} disabled={!f.name.trim()} onClick={() => void save()}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="DINSTAR-GSM" aria-label="Gateway name" className={INPUT} />
        </Field>
        <Field label="Status adapter" hint="Reads ports, signal, balance and SMS from the gateway (G-18).">
          <select aria-label="Adapter" value={f.adapter ?? ''} onChange={(e) => set({ adapter: e.target.value as 'dinstar' | 'grandstream' })} className={INPUT}>
            <option value="dinstar">Dinstar UC2000 (HTTP API)</option>
            <option value="grandstream">Grandstream HT8xx (status page)</option>
            <option value="">None</option>
          </select>
        </Field>
        <Field label="Vendor">
          <input value={f.vendor} onChange={(e) => set({ vendor: e.target.value })} aria-label="Vendor" className={INPUT} />
        </Field>
        <Field label="Model">
          <input value={f.model} onChange={(e) => set({ model: e.target.value })} aria-label="Model" className={INPUT} />
        </Field>
        <Field label="IP address">
          <input value={f.ip} onChange={(e) => set({ ip: e.target.value })} placeholder="192.168.10.22" aria-label="IP address" className={INPUT} />
        </Field>
        <Field label="SIP port">
          <input value={f.port} onChange={(e) => set({ port: e.target.value.replace(/\D/g, '') })} aria-label="SIP port" className={INPUT} />
        </Field>
        <Field label="Channels (SIM ports)">
          <input value={f.channels} onChange={(e) => set({ channels: e.target.value.replace(/\D/g, '') })} aria-label="Channels" className={INPUT} />
        </Field>
        <Field label="Gateway admin password">
          <input type="password" autoComplete="new-password" value={f.admin_password} onChange={(e) => set({ admin_password: e.target.value })} placeholder={gateway ? 'Leave blank to keep' : 'For the status adapter'} aria-label="Gateway admin password" className={INPUT} />
        </Field>
        <Field label="Notes" className="col-span-2">
          <input value={f.notes} onChange={(e) => set({ notes: e.target.value })} aria-label="Notes" className={INPUT} />
        </Field>
      </div>
    </Modal>
  );
}
