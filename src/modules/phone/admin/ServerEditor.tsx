import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTab } from '../../../core/tab-context';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Button, Spinner } from '../../../components/ui';
import { phoneApi, PK, useServer, type PbxServer, type ServerInput, type TestResult } from '../api';
import { ConfirmButton, Field, INPUT, PageBody, PageHeader, Panel, Refused } from '../parts';
import { Checkbox } from '../../../components/Checkbox';

/**
 * A05 · Server editor & test (VOIP-SRV-02/03/06, VOIP-DEP-01). Six sections — identity, where it is, the FreePBX API,
 * AMI, ARI, browser phones & sync — with "leave blank to keep" for every secret (they are stored encrypted and never
 * returned, only "configured"). Test connection reports each protocol separately with the switch's own words; who
 * owns what is said once; removing a server keeps its extensions, history and voicemail.
 */
type Text = 'name' | 'description' | 'region' | 'timezone' | 'hostname' | 'sip_domain' | 'public_ip' | 'private_ip' | 'api_base' | 'client_id' | 'api_user' | 'ami_host' | 'ami_user' | 'ari_host' | 'ari_user' | 'ari_app' | 'ws_url' | 'stun_url' | 'turn_url' | 'turn_user';
type Secret = 'client_secret' | 'api_key' | 'api_password' | 'ami_secret' | 'ari_secret' | 'turn_secret';
type Form = Record<Text | Secret | 'ami_port' | 'ari_port' | 'sync_interval', string> & {
  driver: PbxServer['driver'];
  auth_kind: PbxServer['auth_kind'];
  is_default: boolean;
  enabled: boolean;
};

function formOf(s: PbxServer | null): Form {
  const v = (x: string | null | undefined) => x ?? '';
  return {
    name: v(s?.name),
    description: v(s?.description),
    driver: s?.driver ?? 'freepbx',
    region: v(s?.region),
    timezone: v(s?.timezone) || 'Asia/Colombo',
    hostname: v(s?.hostname),
    sip_domain: v(s?.sip_domain),
    public_ip: v(s?.public_ip),
    private_ip: v(s?.private_ip),
    api_base: v(s?.api_base),
    auth_kind: s?.auth_kind ?? 'oauth_client',
    client_id: v(s?.client_id),
    api_user: v(s?.api_user),
    ami_host: v(s?.ami_host),
    ami_port: String(s?.ami_port ?? 5038),
    ami_user: v(s?.ami_user),
    ari_host: v(s?.ari_host),
    ari_port: String(s?.ari_port ?? 8088),
    ari_user: v(s?.ari_user),
    ari_app: v(s?.ari_app) || 'worksuite',
    ws_url: v(s?.ws_url),
    stun_url: v(s?.stun_url),
    turn_url: v(s?.turn_url),
    turn_user: v(s?.turn_user),
    sync_interval: String(s?.sync_interval ?? 60),
    is_default: s?.is_default ?? false,
    enabled: s?.enabled ?? true,
    client_secret: '',
    api_key: '',
    api_password: '',
    ami_secret: '',
    ari_secret: '',
    turn_secret: '',
  };
}

/** The ARI field takes a full URL (VOIP-DEP-01): `http://10.88.0.1:8088` is host 10.88.0.1, port 8088. */
export function splitAri(raw: string, port: string): { host: string; port: number } {
  const t = raw.trim();
  try {
    if (/^https?:\/\//i.test(t)) {
      const u = new URL(t);
      return { host: `${u.protocol}//${u.hostname}`, port: u.port ? Number(u.port) : u.protocol === 'https:' ? 8089 : 8088 };
    }
  } catch {
    /* as typed */
  }
  return { host: t, port: Number(port) || 8088 };
}

export function bodyOf(f: Form): ServerInput {
  const ari = splitAri(f.ari_host, f.ari_port);
  const body: ServerInput = {
    name: f.name.trim(),
    description: f.description || null,
    driver: f.driver,
    region: f.region || null,
    timezone: f.timezone || null,
    hostname: f.hostname || null,
    sip_domain: f.sip_domain || null,
    public_ip: f.public_ip || null,
    private_ip: f.private_ip || null,
    api_base: f.api_base || null,
    auth_kind: f.auth_kind,
    client_id: f.client_id || null,
    api_user: f.api_user || null,
    ami_host: f.ami_host || null,
    ami_port: Number(f.ami_port) || 5038,
    ami_user: f.ami_user || null,
    ari_host: ari.host || null,
    ari_port: ari.port,
    ari_user: f.ari_user || null,
    ari_app: f.ari_app || null,
    ws_url: f.ws_url || null,
    stun_url: f.stun_url || null,
    turn_url: f.turn_url || null,
    turn_user: f.turn_user || null,
    sync_interval: Number(f.sync_interval) || 0,
    is_default: f.is_default,
    enabled: f.enabled,
  };
  // A blank secret means "unchanged": it is left out, never sent empty.
  for (const k of ['client_secret', 'api_key', 'api_password', 'ami_secret', 'ari_secret', 'turn_secret'] as const) if (f[k]) body[k] = f[k];
  return body;
}

export default function ServerEditor({ id }: { id: number | null }) {
  const { go } = useTab();
  const q = useServer(id);
  if (id && q.isLoading) return <Spinner />;
  if (id && q.error) return <Refused error={q.error} onRetry={() => void q.refetch()} />;
  return <Editor key={id ?? 'new'} server={q.data?.server ?? null} onDone={() => go('/phone/servers')} onCreated={(nid) => go(`/phone/servers/${nid}`)} />;
}

function Editor({ server, onDone, onCreated }: { server: PbxServer | null; onDone: () => void; onCreated: (id: number) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(() => formOf(server));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ at: Date; r: TestResult } | null>(null);
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));
  const freepbx = f.driver === 'freepbx';
  const secret = (has: boolean | undefined) => (has ? 'Set · leave blank to keep' : 'Not set');

  const save = async (): Promise<number | null> => {
    if (!f.name.trim()) {
      toast('error', 'A server needs a name.');
      return null;
    }
    setSaving(true);
    try {
      const r = server ? await phoneApi.updateServer(server.id, bodyOf(f)) : await phoneApi.createServer(bodyOf(f));
      void qc.invalidateQueries({ queryKey: PK.servers });
      void qc.invalidateQueries({ queryKey: PK.server(r.server.id) });
      toast('success', server ? 'Saved.' : `${r.server.name} added. Test the connection next.`);
      if (!server) onCreated(r.server.id);
      return r.server.id;
    } catch (e) {
      toast('error', (e as Error).message);
      return null;
    } finally {
      setSaving(false);
    }
  };
  const runTest = async () => {
    const sid = server?.id ?? (await save());
    if (!sid) return;
    setTesting(true);
    try {
      const r = await phoneApi.testServer(sid);
      setTest({ at: new Date(), r });
      void qc.invalidateQueries({ queryKey: PK.servers });
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setTesting(false);
    }
  };
  const remove = async () => {
    if (!server) return;
    try {
      const r = await phoneApi.deleteServer(server.id);
      toast('success', r.message);
      void qc.invalidateQueries({ queryKey: PK.servers });
      onDone();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  const channels = test ? (Array.isArray(test.r.channels) ? test.r.channels.map((c) => [String(c.name ?? c.channel ?? ''), c] as const) : Object.entries(test.r.channels)) : [];
  const NAMES: Record<string, string> = { api: 'FreePBX API', ami: 'AMI', ari: 'ARI', wss: 'WebSocket (WSS)' };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        back={
          <button type="button" onClick={onDone} className="text-[13px] font-semibold text-primary">
            PBX servers /
          </button>
        }
        title={server?.name ?? 'New server'}
        actions={
          <>
            <Button icon="zap" loading={testing} onClick={() => void runTest()}>
              Test connection
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void save()}>
              Save
            </Button>
          </>
        }
      />
      <PageBody>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Section title="Identity" sub="The driver decides who owns the configuration">
              <Field label="Name">
                <input value={f.name} onChange={(e) => set({ name: e.target.value })} aria-label="Name" className={INPUT} />
              </Field>
              <Field label="Driver">
                <select aria-label="Driver" value={f.driver} onChange={(e) => set({ driver: e.target.value as Form['driver'] })} className={INPUT}>
                  <option value="freepbx">FreePBX (API + AMI/ARI)</option>
                  <option value="asterisk">Asterisk (AMI + ARI + generated config)</option>
                </select>
              </Field>
              <Field label="Region">
                <input value={f.region} onChange={(e) => set({ region: e.target.value })} aria-label="Region" className={INPUT} />
              </Field>
              <Field label="Time zone">
                <input value={f.timezone} onChange={(e) => set({ timezone: e.target.value })} aria-label="Time zone" className={INPUT} />
              </Field>
            </Section>
            <Section title="Where it is" sub="Hostnames and addresses">
              <Field label="Hostname">
                <input value={f.hostname} onChange={(e) => set({ hostname: e.target.value })} aria-label="Hostname" placeholder="pbx.example.lk" className={INPUT} />
              </Field>
              <Field label="SIP domain">
                <input value={f.sip_domain} onChange={(e) => set({ sip_domain: e.target.value })} aria-label="SIP domain" className={INPUT} />
              </Field>
              <Field label="Public IP">
                <input value={f.public_ip} onChange={(e) => set({ public_ip: e.target.value })} aria-label="Public IP" className={INPUT} />
              </Field>
              <Field label="Private IP (tunnel)">
                <input value={f.private_ip} onChange={(e) => set({ private_ip: e.target.value })} aria-label="Private IP" placeholder="10.88.0.1" className={INPUT} />
              </Field>
            </Section>
            {freepbx ? (
              <Section title="FreePBX API" sub="OAuth2 client credentials, GraphQL">
                <Field label="Admin base URL" className="col-span-2">
                  <input value={f.api_base} onChange={(e) => set({ api_base: e.target.value })} aria-label="Admin base URL" placeholder="https://pbx.example.lk" className={INPUT} />
                </Field>
                <Field label="Authentication">
                  <select aria-label="Authentication" value={f.auth_kind} onChange={(e) => set({ auth_kind: e.target.value as Form['auth_kind'] })} className={INPUT}>
                    <option value="oauth_client">OAuth client</option>
                    <option value="api_key">API key</option>
                    <option value="basic">User and password</option>
                    <option value="jwt">JWT</option>
                    <option value="none">None</option>
                  </select>
                </Field>
                <Field label="Client ID">
                  <input value={f.client_id} onChange={(e) => set({ client_id: e.target.value })} aria-label="Client ID" className={INPUT} />
                </Field>
                <Field label={f.auth_kind === 'api_key' ? 'API key' : f.auth_kind === 'basic' ? 'Password' : 'Client secret'} className="col-span-2">
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={f.auth_kind === 'api_key' ? f.api_key : f.auth_kind === 'basic' ? f.api_password : f.client_secret}
                    onChange={(e) => set(f.auth_kind === 'api_key' ? { api_key: e.target.value } : f.auth_kind === 'basic' ? { api_password: e.target.value } : { client_secret: e.target.value })}
                    placeholder={secret(f.auth_kind === 'api_key' ? server?.has_api_key : f.auth_kind === 'basic' ? server?.has_api_password : server?.has_client_secret)}
                    aria-label="API secret"
                    className={INPUT}
                  />
                </Field>
              </Section>
            ) : null}
            <Section title="Asterisk Manager (AMI)" sub="Required: placing, watching, ending calls">
              <Field label="Host">
                <input value={f.ami_host} onChange={(e) => set({ ami_host: e.target.value })} aria-label="AMI host" className={INPUT} />
              </Field>
              <Field label="Port">
                <input value={f.ami_port} onChange={(e) => set({ ami_port: e.target.value.replace(/\D/g, '') })} inputMode="numeric" aria-label="AMI port" className={INPUT} />
              </Field>
              <Field label="User">
                <input value={f.ami_user} onChange={(e) => set({ ami_user: e.target.value })} aria-label="AMI user" className={INPUT} />
              </Field>
              <Field label="Secret">
                <input type="password" autoComplete="new-password" value={f.ami_secret} onChange={(e) => set({ ami_secret: e.target.value })} placeholder={secret(server?.has_ami_secret)} aria-label="AMI secret" className={INPUT} />
              </Field>
            </Section>
            <Section title="Asterisk REST (ARI)" sub="Optional: attended transfer, conference, recording control">
              <Field label="Host or URL">
                <input value={f.ari_host} onChange={(e) => set({ ari_host: e.target.value })} aria-label="ARI host or URL" placeholder="http://10.88.0.1:8088" className={INPUT} />
              </Field>
              <Field label="App name">
                <input value={f.ari_app} onChange={(e) => set({ ari_app: e.target.value })} aria-label="ARI app name" className={INPUT} />
              </Field>
              <Field label="User">
                <input value={f.ari_user} onChange={(e) => set({ ari_user: e.target.value })} aria-label="ARI user" className={INPUT} />
              </Field>
              <Field label="Secret">
                <input type="password" autoComplete="new-password" value={f.ari_secret} onChange={(e) => set({ ari_secret: e.target.value })} placeholder={secret(server?.has_ari_secret)} aria-label="ARI secret" className={INPUT} />
              </Field>
            </Section>
            <Section title="Browser phones & sync" sub="WebRTC media and schedule">
              <Field label="WebSocket URL" className="col-span-2">
                <input value={f.ws_url} onChange={(e) => set({ ws_url: e.target.value })} aria-label="WebSocket URL" placeholder="wss://pbx.example.lk:8089/ws" className={INPUT} />
              </Field>
              <Field label="STUN server">
                <input value={f.stun_url} onChange={(e) => set({ stun_url: e.target.value })} aria-label="STUN server" placeholder="stun:pbx.example.lk:3478" className={INPUT} />
              </Field>
              <Field label="TURN server">
                <input value={f.turn_url} onChange={(e) => set({ turn_url: e.target.value })} aria-label="TURN server" placeholder="turn:pbx.example.lk:3478" className={INPUT} />
              </Field>
              <Field label="TURN user">
                <input value={f.turn_user} onChange={(e) => set({ turn_user: e.target.value })} aria-label="TURN user" className={INPUT} />
              </Field>
              <Field label="TURN secret">
                <input type="password" autoComplete="new-password" value={f.turn_secret} onChange={(e) => set({ turn_secret: e.target.value })} placeholder={secret(server?.has_turn_secret)} aria-label="TURN secret" className={INPUT} />
              </Field>
              <Field label="Sync every (minutes, 0 = never)">
                <input value={f.sync_interval} onChange={(e) => set({ sync_interval: e.target.value.replace(/\D/g, '') })} inputMode="numeric" aria-label="Sync every" className={INPUT} />
              </Field>
              <div className="flex flex-col justify-end gap-1.5 pb-1 text-[12.5px]">
                <label className="flex items-center gap-1.5">
                  <Checkbox checked={f.is_default} onChange={(e) => set({ is_default: e.target.checked })} /> Default server
                </label>
                <label className="flex items-center gap-1.5">
                  <Checkbox checked={f.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Enabled
                </label>
              </div>
            </Section>
          </div>
          <div className="flex flex-col gap-4">
            <Panel title={`Connection test${test ? ` · ${test.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}`}>
              {test ? (
                <ul className="flex flex-col gap-2 text-[12.5px]">
                  {channels.map(([k, c]) => (
                    <li key={k} className="flex gap-2">
                      <Icon name={c.ok ? 'check-circle' : 'x-circle'} size={16} className={c.ok ? 'mt-px shrink-0 text-success' : 'mt-px shrink-0 text-danger'} />
                      <span>
                        <b>{NAMES[k] ?? k.toUpperCase()}</b>
                        <span className="block text-[11.5px] text-ink-3">{c.message}</span>
                      </span>
                    </li>
                  ))}
                  {test.r.versions.asterisk || test.r.versions.freepbx ? <li className="text-[11.5px] text-ink-3">{[test.r.versions.freepbx ? `FreePBX ${test.r.versions.freepbx}` : null, test.r.versions.asterisk ? `Asterisk ${test.r.versions.asterisk}` : null].filter(Boolean).join(' · ')}</li> : null}
                </ul>
              ) : (
                <p className="text-[12px] text-ink-3">Each protocol is tried separately, with the switch’s own answer when it refuses.</p>
              )}
            </Panel>
            <Panel title="Who owns what">
              <div className="flex flex-col gap-2 text-[12px] text-ink-2">
                {freepbx ? <p>FreePBX owns its config files — WorkSuite pushes through its API and never writes files on this server.</p> : <p>WorkSuite writes pjsip_worksuite.conf, extensions_worksuite.conf and queues_worksuite.conf and reloads them when the configuration is applied.</p>}
                <p>WorkSuite owns who an extension belongs to. The PBX owns registrations and live call state.</p>
                <p>Secrets are encrypted at rest and never shown again. Leave a password blank to keep it.</p>
              </div>
            </Panel>
            {server ? (
              <Panel title="Remove server">
                <p className="mb-2 text-[12px] text-ink-2">Its {server.extensions ?? ''} extensions are kept and detached, with their call history and voicemail.</p>
                <ConfirmButton label={`Remove ${server.name}`} confirm="Remove server" icon="trash" onConfirm={() => void remove()} />
              </Panel>
            ) : null}
          </div>
        </div>
      </PageBody>
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <Panel title={title} sub={sub}>
      <div className="grid grid-cols-2 gap-2.5">{children}</div>
    </Panel>
  );
}
