import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { normalisePairingCode } from '@shared/label';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Spinner } from '../../components/ui';
import { checkGatewayUpdate, downloadGatewayUpdate, gatewayStatus, K, pairGateway, setGatewayHeadless, unpairGateway } from './api';
import type { ViewProps } from './LabelShell';
import { btn, btnPrimary, field, Progress, Section, StatePill } from './parts';

const KEYSTORE = { os: 'the OS key store (Keychain, Windows DPAPI or Secret Service)', file: 'a file only this user can read (no key store on this computer)', memory: 'memory only' } as const;

/**
 * D06 — Print Gateway pairing and D07 — status (FR-GWY-01…07). The gateway is WorkSuite Desktop in a tray mode:
 * paired with the WorkSuite URL and a one-time code an administrator made (W24), it keeps its own device key here and
 * no password. Status shows the connection, the printers registered to it, the job printing now with its progress,
 * the last signature check and the update channel.
 */
export default function Gateway(_: ViewProps) {
  const qc = useQueryClient();
  const s = useQuery({ queryKey: K.gateway, queryFn: gatewayStatus, refetchInterval: 5_000 });
  const [url, setUrl] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const pair = useMutation({
    mutationFn: () => pairGateway(url, code, name || 'Print Gateway'),
    onSuccess: (v) => (qc.setQueryData(K.gateway, v), toast('success', 'Paired. Approve its printers on the web (Print gateways).')),
    onError: (e) => toast('error', errorMessage(e)),
  });
  const check = useMutation({ mutationFn: checkGatewayUpdate, onSuccess: (v) => qc.setQueryData(K.gateway, v), onError: (e) => toast('error', errorMessage(e)) });
  const download = useMutation({
    mutationFn: downloadGatewayUpdate,
    onSuccess: (r) => toast('success', `Version ${r.version} downloaded and its SHA-256 checked: ${r.path}. Install it when no job is printing.`),
    onError: (e) => (toast('error', errorMessage(e)), void qc.invalidateQueries({ queryKey: K.gateway })),
  });
  const unpair = useMutation({ mutationFn: unpairGateway, onSuccess: (v) => qc.setQueryData(K.gateway, v), onError: (e) => toast('error', errorMessage(e)) });
  const headless = useMutation({ mutationFn: setGatewayHeadless, onSuccess: (v) => (qc.setQueryData(K.gateway, v), toast('success', 'Saved. It applies the next time this computer starts.')), onError: (e) => toast('error', errorMessage(e)) });
  if (s.isPending) return <Spinner />;
  const g = s.data!;
  const codeOk = !!normalisePairingCode(code);

  if (!g.paired) {
    return (
      <div className="flex max-w-[640px] flex-col gap-3 p-4">
        <h1 className="m-0 text-[18px] font-extrabold text-ink">Print Gateway</h1>
        {g.connection === 'revoked' ? <p className="m-0 rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger">This gateway was revoked on the server; its key was deleted. Pair it again with a new code.</p> : null}
        <p className="m-0 text-[12.5px] text-ink-2">Make this computer the gateway for the label printers next to it, so WorkSuite in the cloud can print to them. It connects out to WorkSuite only, accepts only signed jobs, and prints only to printers an administrator approved.</p>
        <Section title="Pair with WorkSuite">
          <form className="flex flex-col gap-3 p-3.5" onSubmit={(e) => (e.preventDefault(), pair.mutate())}>
            <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink">WorkSuite address<input className={field} required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://company.worksuitecloud.com" /></label>
            <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink">One-time code<input className={`${field} font-mono uppercase`} required value={code} onChange={(e) => setCode(e.target.value)} placeholder="PG-82KD-91AX" /></label>
            <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink">Name<input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Colombo warehouse gateway" /></label>
            <p className="m-0 text-[11.5px] text-ink-3">An administrator makes the code in Label Studio › Print gateways on the web; it works once, for 15 minutes. No password is kept here.</p>
            <div><button type="submit" className={btnPrimary} disabled={!codeOk || !url || pair.isPending}>{pair.isPending ? 'Pairing…' : 'Pair'}</button></div>
          </form>
        </Section>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <h1 className="m-0 flex-1 text-[18px] font-extrabold text-ink">{g.name ?? 'Print Gateway'}</h1>
        <StatePill state={g.connection}>{g.connection === 'online' ? 'Connected' : g.connection === 'connecting' ? 'Connecting' : 'Offline'}</StatePill>
        <button type="button" className={btn} disabled={unpair.isPending} onClick={() => unpair.mutate()}>Unpair</button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Section title="Connection">
          <dl className="m-0 grid grid-cols-[150px_1fr] gap-x-3 gap-y-1.5 p-3.5 text-[12.5px]">
            <dt className="text-ink-3">Server</dt><dd className="m-0 truncate">{g.server}</dd>
            {g.company ? <><dt className="text-ink-3">Company</dt><dd className="m-0 truncate font-semibold">{g.company.name ?? `Company ${g.company.id}`}</dd></> : null}
            <dt className="text-ink-3">Gateway id</dt><dd className="m-0 font-mono">{g.gatewayId}</dd>
            <dt className="text-ink-3">Paired</dt><dd className="m-0">{g.pairedAt ? new Date(g.pairedAt).toLocaleString() : '—'}</dd>
            <dt className="text-ink-3">Last heartbeat</dt><dd className="m-0">{g.lastHeartbeatAt ? new Date(g.lastHeartbeatAt).toLocaleTimeString() : '—'}</dd>
            <dt className="text-ink-3">Token until</dt><dd className="m-0">{g.tokenExpiresAt ? new Date(g.tokenExpiresAt).toLocaleTimeString() : '—'}</dd>
            <dt className="text-ink-3">Device key</dt><dd className="m-0">{g.keyStore ? KEYSTORE[g.keyStore] : '—'}</dd>
            <dt className="text-ink-3">Version</dt><dd className="m-0">{`${g.version}${g.updateChannel ? ` · ${g.updateChannel} channel` : ''}`}</dd>
          </dl>
          {g.problem ? <p className="m-0 border-t border-line px-3.5 py-2 text-[12px] text-danger dark:text-danger">{g.problem}</p> : null}
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-3.5 py-2 text-[12px]">
            {g.update ? (
              <>
                <span className="min-w-0 flex-1">{`Version ${g.update.version} is available (${g.update.channel}), signed by WorkSuite.`}{g.update.notes ? <span className="text-ink-3">{` ${g.update.notes}`}</span> : null}</span>
                <button type="button" className={btnPrimary} disabled={download.isPending} onClick={() => download.mutate()}>{download.isPending ? 'Downloading…' : 'Download'}</button>
              </>
            ) : (
              <>
                <span className="min-w-0 flex-1 text-ink-3">{g.updateProblem ?? 'This gateway is up to date.'}</span>
                <button type="button" className={btn} disabled={check.isPending} onClick={() => check.mutate()}>{check.isPending ? 'Checking…' : 'Check for updates'}</button>
              </>
            )}
          </div>
        </Section>
        <Section title="Now printing">
          <div className="flex flex-col gap-2 p-3.5 text-[12.5px]">
            {g.current ? (
              <>
                <div className="font-semibold">{g.current.ref ?? g.current.id}</div>
                <Progress done={g.current.confirmed} total={g.current.total} />
              </>
            ) : <span className="text-ink-3">Nothing printing.</span>}
            <div className="mt-1 border-t border-line pt-2">
              <div className="text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">Last signature check</div>
              {g.lastCheck ? (
                <div className="flex items-center gap-2">
                  <StatePill state={g.lastCheck.ok ? 'ready' : 'failed'}>{g.lastCheck.ok ? 'Verified' : 'Refused'}</StatePill>
                  <span className="truncate">{`${g.lastCheck.job}${g.lastCheck.reason ? ` — ${g.lastCheck.reason}` : ''}`}</span>
                </div>
              ) : <span className="text-ink-3">No job yet.</span>}
            </div>
          </div>
        </Section>
      </div>
      <Section title="Hosted printers">
        {g.printers.length === 0 ? <p className="m-0 px-3.5 py-3 text-[12.5px] text-ink-3">No printers registered yet. The printers on this computer were offered to WorkSuite; approve them on the web.</p> : (
          <ul className="m-0 list-none p-0">
            {g.printers.map((p) => (
              <li key={p.id} className="flex items-center gap-3 border-b border-line/70 px-3.5 py-2 text-[12.5px] last:border-0">
                <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                <span className="text-[11px] text-ink-3">{p.key.replace(/^os:/, 'OS queue ').replace(/^tcp:/, 'LAN ')}</span>
                {p.approved ? <StatePill state={p.state} /> : <StatePill state="paused">Awaiting approval</StatePill>}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <label className="flex items-center gap-2 text-[12.5px] font-semibold text-ink">
        <Checkbox checked={g.autostart} onChange={(e) => headless.mutate(e.target.checked)} />
        Start with this computer as the Print Gateway (tray only, no window)
      </label>
    </div>
  );
}
