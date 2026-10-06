import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTab } from '../../../core/tab-context';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Button, cx } from '../../../components/ui';
import { isNotOffered, phoneApi, PK, type TestResult } from '../api';
import { LK_ROUTES } from '../lib/lkroutes';
import { Field, INPUT, Mono, PageBody, PageHeader, Panel } from '../parts';
import { Checkbox } from '../../../components/Checkbox';

/**
 * Cloud FreePBX setup (WS-VOIP-SRS-001 §13–14, VOIP-DEP-05): add the FreePBX server → test each protocol → the
 * trunks per gateway (Grandstream HT813 landline, Dinstar UC2000 SIMs) → the recommended Sri Lankan outbound routes →
 * map the organisation to it → sync and push. Every step uses the same endpoints as the screens; a step the server
 * cannot do yet says what to do on FreePBX instead.
 */
type Step = 0 | 1 | 2 | 3 | 4 | 5;
const STEPS = ['FreePBX server', 'Test connection', 'Trunks per gateway', 'Outbound routes', 'Organisation & range', 'Sync & push'];

export default function SetupWizard() {
  const { go } = useTab();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>(0);
  const [serverId, setServerId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [s, setS] = useState({
    name: 'Cloud FreePBX',
    host: 'pbx.example.lk',
    public_ip: '',
    private_ip: '10.88.0.1',
    client_id: '',
    client_secret: '',
    ami_user: 'worksuite',
    ami_secret: '',
    ari_user: 'worksuite',
    ari_secret: '',
    turn_user: '',
    turn_secret: '',
  });
  const [test, setTest] = useState<TestResult | null>(null);
  const [trunks, setTrunks] = useState({ landline: true, landlineUser: '9001', landlineSecret: '', landlineIp: '192.168.10.21', gsm: true, gsmIp: '192.168.10.22', gsmPorts: '4' });
  const [trunkIds, setTrunkIds] = useState<{ landline: number | null; gsm: number | null }>({ landline: null, gsm: null });
  const [range, setRange] = useState({ from: '1000', to: '1999' });
  const [log, setLog] = useState<string[]>([]);
  const note = (m: string) => setLog((l) => [...l, m]);
  const set = (p: Partial<typeof s>) => setS((x) => ({ ...x, ...p }));

  const step0 = async () => {
    setBusy(true);
    try {
      const body = {
        name: s.name,
        driver: 'freepbx' as const,
        hostname: s.host,
        sip_domain: s.host,
        public_ip: s.public_ip || null,
        private_ip: s.private_ip || null,
        api_base: `https://${s.host}`,
        auth_kind: 'oauth_client' as const,
        client_id: s.client_id || null,
        ami_host: s.private_ip || s.host,
        ami_port: 5038,
        ami_user: s.ami_user,
        ari_host: `http://${s.private_ip || s.host}`,
        ari_port: 8088,
        ari_user: s.ari_user,
        ari_app: 'worksuite',
        ws_url: `wss://${s.host}:8089/ws`,
        stun_url: `stun:${s.host}:3478`,
        turn_url: `turn:${s.host}:3478`,
        turn_user: s.turn_user || null,
        timezone: 'Asia/Colombo',
        sync_interval: 60,
        enabled: true,
        ...(s.client_secret ? { client_secret: s.client_secret } : {}),
        ...(s.ami_secret ? { ami_secret: s.ami_secret } : {}),
        ...(s.ari_secret ? { ari_secret: s.ari_secret } : {}),
        ...(s.turn_secret ? { turn_secret: s.turn_secret } : {}),
      };
      const r = serverId ? await phoneApi.updateServer(serverId, body) : await phoneApi.createServer(body);
      setServerId(r.server.id);
      note(`${r.server.name} saved.`);
      void qc.invalidateQueries({ queryKey: PK.servers });
      setStep(1);
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const step1 = async () => {
    if (!serverId) return;
    setBusy(true);
    try {
      const r = await phoneApi.testServer(serverId);
      setTest(r);
      note(r.ok ? 'Every protocol answered.' : `Test: ${r.message}`);
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const step2 = async () => {
    setBusy(true);
    try {
      const ids = { ...trunkIds };
      if (trunks.landline && !ids.landline) {
        const r = await phoneApi.saveTrunk(null, { name: 'SLT-PSTN', provider: 'Grandstream HT813 FXO · SLT landline', kind: 'sip', host: trunks.landlineIp, username: trunks.landlineUser, transport: 'udp', registers: true, codecs: 'alaw,ulaw', max_channels: 1, priority: 10, cost_per_min: null, enabled: true, server_id: serverId, ...(trunks.landlineSecret ? { secret: trunks.landlineSecret } : {}) });
        ids.landline = r.trunk.id;
        note('Trunk SLT-PSTN added (HT813, one line).');
      }
      if (trunks.gsm && !ids.gsm) {
        const r = await phoneApi.saveTrunk(null, { name: 'DINSTAR-GSM', provider: 'Dinstar UC2000-VE-4G · mobile SIMs', kind: 'gsm', host: trunks.gsmIp, transport: 'udp', registers: false, codecs: 'alaw,ulaw', max_channels: Number(trunks.gsmPorts) || 4, priority: 20, cost_per_min: null, enabled: true, server_id: serverId });
        ids.gsm = r.trunk.id;
        note('Trunk DINSTAR-GSM added (IP-authenticated over the tunnel).');
      }
      setTrunkIds(ids);
      setStep(3);
    } catch (e) {
      if (isNotOffered(e)) {
        note('This server cannot create trunks yet: add SLT-PSTN and DINSTAR-GSM in FreePBX › Connectivity › Trunks (§14.6), then Sync.');
        setStep(3);
      } else toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const step3 = async () => {
    setBusy(true);
    try {
      const pick = (k: string) => (k === 'landline' ? trunkIds.landline : k === 'gsm' ? trunkIds.gsm : null);
      let made = 0;
      for (const r of LK_ROUTES) {
        await phoneApi.saveRoute(null, { name: r.name, pattern: r.pattern, kind: r.kind, trunk_id: pick(r.primary), failover_trunk_id: r.failover ? pick(r.failover) : null, priority: r.priority, strip_digits: 0, prepend: null, enabled: true, server_id: serverId });
        made += 1;
      }
      note(`${made} outbound routes added.`);
      setStep(4);
    } catch (e) {
      if (isNotOffered(e)) {
        note('This server cannot create routes yet: add them in FreePBX › Connectivity › Outbound Routes in the order shown (§14.11).');
        setStep(4);
      } else toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const step4 = async () => {
    if (!serverId) return;
    setBusy(true);
    try {
      await phoneApi.addMapping(serverId, { scope: 'organisation', scope_id: null, label: 'Whole organisation', range_from: Number(range.from), range_to: Number(range.to), prefix: null, priority: 10 });
      await phoneApi.updateServer(serverId, { is_default: true });
      note(`Organisation mapped to ${s.name}, extensions ${range.from}–${range.to}.`);
      setStep(5);
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const step5 = async () => {
    if (!serverId) return;
    setBusy(true);
    try {
      const sync = await phoneApi.sync(serverId, 'full');
      note(`Sync: ${sync.state}${sync.message ? ` — ${sync.message}` : ''}`);
      const push = await phoneApi.applyServer(serverId);
      note(push.ok ? `Pushed: ${push.message}` : `Push: ${push.message}`);
      toast('success', 'The cloud FreePBX is connected. Assign extensions to people next.');
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const channels = test ? (Array.isArray(test.channels) ? test.channels.map((c) => [String(c.name ?? c.channel ?? ''), c] as const) : Object.entries(test.channels)) : [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        back={
          <button type="button" onClick={() => go('/phone/servers')} className="text-[13px] font-semibold text-primary">
            PBX servers /
          </button>
        }
        title="Set up a cloud FreePBX"
        sub="FreePBX 17 on a VPS · SLT landline via Grandstream HT813 · mobile SIMs via Dinstar UC2000 · WireGuard tunnel"
      />
      <PageBody>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[220px_minmax(0,1fr)_320px]">
          <ol className="flex flex-col gap-1">
            {STEPS.map((t, i) => (
              <li key={t}>
                <button type="button" disabled={i > step} onClick={() => setStep(i as Step)} className={cx('flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 text-left text-[12.5px]', i === step ? 'bg-selection font-bold text-primary' : i < step ? 'text-ink' : 'text-ink-3')}>
                  <span className={cx('flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold', i < step ? 'bg-success text-white' : i === step ? 'bg-primary text-white' : 'bg-subtle')}>{i < step ? <Icon name="check" size={12} /> : i + 1}</span>
                  {t}
                </button>
              </li>
            ))}
          </ol>
          <Panel title={STEPS[step]} bodyClassName="flex flex-col gap-3">
            {step === 0 ? (
              <>
                <p className="text-[12.5px] text-ink-2">The FreePBX side first (§14.1–14.8): a Machine-to-Machine API app, an AMI user bound to the tunnel, an ARI user, WebRTC on 8089 with a Let’s Encrypt certificate, coturn. Then fill in:</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Name">
                    <input value={s.name} onChange={(e) => set({ name: e.target.value })} aria-label="Name" className={INPUT} />
                  </Field>
                  <Field label="Hostname / SIP domain">
                    <input value={s.host} onChange={(e) => set({ host: e.target.value })} aria-label="Hostname" className={INPUT} />
                  </Field>
                  <Field label="Public IP">
                    <input value={s.public_ip} onChange={(e) => set({ public_ip: e.target.value })} aria-label="Public IP" placeholder="203.0.113.10" className={INPUT} />
                  </Field>
                  <Field label="Private IP (WireGuard)">
                    <input value={s.private_ip} onChange={(e) => set({ private_ip: e.target.value })} aria-label="Private IP" className={INPUT} />
                  </Field>
                  <Field label="API client ID">
                    <input value={s.client_id} onChange={(e) => set({ client_id: e.target.value })} aria-label="API client ID" className={INPUT} />
                  </Field>
                  <Field label="API client secret">
                    <input type="password" autoComplete="new-password" value={s.client_secret} onChange={(e) => set({ client_secret: e.target.value })} aria-label="API client secret" className={INPUT} />
                  </Field>
                  <Field label="AMI user">
                    <input value={s.ami_user} onChange={(e) => set({ ami_user: e.target.value })} aria-label="AMI user" className={INPUT} />
                  </Field>
                  <Field label="AMI secret (24+ characters)">
                    <input type="password" autoComplete="new-password" value={s.ami_secret} onChange={(e) => set({ ami_secret: e.target.value })} aria-label="AMI secret" className={INPUT} />
                  </Field>
                  <Field label="ARI user">
                    <input value={s.ari_user} onChange={(e) => set({ ari_user: e.target.value })} aria-label="ARI user" className={INPUT} />
                  </Field>
                  <Field label="ARI secret">
                    <input type="password" autoComplete="new-password" value={s.ari_secret} onChange={(e) => set({ ari_secret: e.target.value })} aria-label="ARI secret" className={INPUT} />
                  </Field>
                  <Field label="TURN user">
                    <input value={s.turn_user} onChange={(e) => set({ turn_user: e.target.value })} aria-label="TURN user" className={INPUT} />
                  </Field>
                  <Field label="TURN secret">
                    <input type="password" autoComplete="new-password" value={s.turn_secret} onChange={(e) => set({ turn_secret: e.target.value })} aria-label="TURN secret" className={INPUT} />
                  </Field>
                </div>
                <p className="text-[11.5px] text-ink-3">
                  Derived: API <Mono>https://{s.host}</Mono> · AMI <Mono>{s.private_ip || s.host}:5038</Mono> · ARI <Mono>http://{s.private_ip || s.host}:8088</Mono> · WSS <Mono>wss://{s.host}:8089/ws</Mono> · STUN/TURN <Mono>{s.host}:3478</Mono> · sync every 60 min.
                </p>
                <Next busy={busy} onClick={() => void step0()} disabled={!s.name.trim() || !s.host.trim()} label={serverId ? 'Save and continue' : 'Add server'} />
              </>
            ) : step === 1 ? (
              <>
                <p className="text-[12.5px] text-ink-2">Every protocol must show ✓ (§14.12). A refused one shows the switch’s own answer.</p>
                {channels.map(([k, c]) => (
                  <div key={k} className="flex gap-2 text-[12.5px]">
                    <Icon name={c.ok ? 'check-circle' : 'x-circle'} size={16} className={c.ok ? 'text-success' : 'text-danger'} />
                    <span>
                      <b>{k.toUpperCase()}</b> <span className="text-ink-3">{c.message}</span>
                    </span>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Button loading={busy} onClick={() => void step1()}>
                    Test connection
                  </Button>
                  <Button variant="primary" disabled={!test} onClick={() => setStep(2)}>
                    Continue
                  </Button>
                </div>
              </>
            ) : step === 2 ? (
              <>
                <label className="flex items-center gap-2 text-[13px] font-semibold">
                  <Checkbox checked={trunks.landline} onChange={(e) => setTrunks({ ...trunks, landline: e.target.checked })} /> SLT landline through a Grandstream HT813 (FXO)
                </label>
                {trunks.landline ? (
                  <div className="grid grid-cols-3 gap-2 pl-6">
                    <Field label="HT813 address">
                      <input value={trunks.landlineIp} onChange={(e) => setTrunks({ ...trunks, landlineIp: e.target.value })} aria-label="HT813 address" className={INPUT} />
                    </Field>
                    <Field label="Trunk user">
                      <input value={trunks.landlineUser} onChange={(e) => setTrunks({ ...trunks, landlineUser: e.target.value })} aria-label="Trunk user" className={INPUT} />
                    </Field>
                    <Field label="Trunk secret">
                      <input type="password" autoComplete="new-password" value={trunks.landlineSecret} onChange={(e) => setTrunks({ ...trunks, landlineSecret: e.target.value })} aria-label="Trunk secret" className={INPUT} />
                    </Field>
                  </div>
                ) : null}
                <label className="flex items-center gap-2 text-[13px] font-semibold">
                  <Checkbox checked={trunks.gsm} onChange={(e) => setTrunks({ ...trunks, gsm: e.target.checked })} /> Mobile SIMs through a Dinstar UC2000-VE-4G
                </label>
                {trunks.gsm ? (
                  <div className="grid grid-cols-3 gap-2 pl-6">
                    <Field label="Dinstar address">
                      <input value={trunks.gsmIp} onChange={(e) => setTrunks({ ...trunks, gsmIp: e.target.value })} aria-label="Dinstar address" className={INPUT} />
                    </Field>
                    <Field label="SIM ports">
                      <input value={trunks.gsmPorts} onChange={(e) => setTrunks({ ...trunks, gsmPorts: e.target.value.replace(/\D/g, '') })} aria-label="SIM ports" className={INPUT} />
                    </Field>
                  </div>
                ) : null}
                <Next busy={busy} onClick={() => void step2()} label="Add trunks" />
              </>
            ) : step === 3 ? (
              <>
                <ol className="flex flex-col gap-1 text-[12.5px]">
                  {LK_ROUTES.map((r) => (
                    <li key={r.pattern} className="flex gap-2">
                      <Mono className="w-[150px] shrink-0">{r.pattern}</Mono>
                      <span>
                        <b>{r.name}</b> → {r.primary === 'landline' ? 'SLT-PSTN' : r.primary === 'gsm' ? 'DINSTAR-GSM' : 'a SIP carrier, or blocked'}
                        {r.failover ? `, then ${r.failover === 'landline' ? 'SLT-PSTN' : 'DINSTAR-GSM'}` : ''} — {r.note}
                      </span>
                    </li>
                  ))}
                </ol>
                <Next busy={busy} onClick={() => void step3()} label="Add these routes" />
              </>
            ) : step === 4 ? (
              <>
                <p className="text-[12.5px] text-ink-2">New extensions are allocated from this range; the server becomes the organisation’s default.</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="From">
                    <input value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value.replace(/\D/g, '') })} aria-label="Range from" className={cx(INPUT, 'font-mono')} />
                  </Field>
                  <Field label="To">
                    <input value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value.replace(/\D/g, '') })} aria-label="Range to" className={cx(INPUT, 'font-mono')} />
                  </Field>
                </div>
                <Next busy={busy} onClick={() => void step4()} disabled={Number(range.to) < Number(range.from)} label="Map the organisation" />
              </>
            ) : (
              <>
                <p className="text-[12.5px] text-ink-2">A full sync brings FreePBX’s extensions into WorkSuite (assign each to an employee: WorkSuite owns ownership, the PBX owns existence); Push sends what WorkSuite owns to FreePBX.</p>
                <div className="flex gap-2">
                  <Button variant="primary" loading={busy} onClick={() => void step5()}>
                    Sync and push
                  </Button>
                  <Button onClick={() => go('/phone/extensions')}>Go to extensions</Button>
                </div>
              </>
            )}
          </Panel>
          <div className="flex flex-col gap-4">
            <Panel title="Progress">
              {log.length ? (
                <ul className="flex flex-col gap-1 text-[12px] text-ink-2">
                  {log.map((l, i) => (
                    <li key={i}>• {l}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12px] text-ink-3">Nothing done yet.</p>
              )}
            </Panel>
            <Panel title="Before going live (§14.13)">
              <ul className="flex list-disc flex-col gap-1 pl-4 text-[11.5px] text-ink-2">
                <Li>Never expose 5060/UDP, AMI, ARI or MariaDB to the internet; only 5061/TCP, 8089/TCP, RTP and TURN.</Li>
                <Li>Long random secrets on every endpoint and trunk; FreePBX Intrusion Detection on.</Li>
                <Li>No international calls through the GSM gateway; carrier with a spend cap.</Li>
                <Li>Change the HT813 and Dinstar default passwords; management only from the office LAN or tunnel.</Li>
                <Li>Nightly FreePBX backup off the server.</Li>
                <Li>Operator-approved business SIMs and a TRCSL type-approved gateway; never terminate international traffic on SIMs.</Li>
                <Li>Announce recording where required; set retention per organisation.</Li>
              </ul>
            </Panel>
          </div>
        </div>
      </PageBody>
    </div>
  );
}

function Li({ children }: { children: ReactNode }) {
  return <li>{children}</li>;
}

function Next({ busy, onClick, label, disabled }: { busy: boolean; onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <div>
      <Button variant="primary" loading={busy} disabled={disabled} onClick={onClick}>
        {label}
      </Button>
    </div>
  );
}
