import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { DiscoveredPrinter, LabelLanguage, LabelSettingsPatch } from '@shared/label';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { ErrorNote, Spinner } from '../../components/ui';
import { refusal } from '../finance/api';
import { discover, fetchServerPrinters, hostSettings, hostStatus, K, pausePrinter, registerHost, resumePrinter, setHostSettings } from './api';
import type { ViewProps } from './LabelShell';
import { btn, btnPrimary, field, Section, StatePill, td, th } from './parts';

/**
 * D04 — Printers on this computer (FR-DSK-02, 03, FR-PRN-02): the OS's printers (getPrintersAsync) and raw-TCP
 * printers on the LAN, found by Discover or added by address. Register sends the list to WorkSuite; an administrator
 * approves each printer before it prints (FR-GWY-05). Bytes reach a printer only from the main process, through the
 * system's raw path (CUPS `lp -o raw`, the Windows spooler's RAW type) or raw TCP — never from this page.
 */
export default function Printers(_: ViewProps) {
  const qc = useQueryClient();
  const host = useQuery({ queryKey: K.host, queryFn: hostStatus });
  const settings = useQuery({ queryKey: K.settings, queryFn: hostSettings });
  const [found, setFound] = useState<DiscoveredPrinter[] | null>(null);
  const [lan, setLan] = useState({ address: '', port: 9100, name: '', language: 'zpl' as LabelLanguage });
  const set = (patch: LabelSettingsPatch) =>
    setHostSettings(patch).then(
      (s) => {
        qc.setQueryData(K.settings, s);
        void qc.invalidateQueries({ queryKey: K.host });
      },
      (e) => toast('error', errorMessage(e)),
    );
  const reg = useMutation({
    mutationFn: registerHost,
    onSuccess: (s) => (qc.setQueryData(K.host, s), toast('success', 'This computer’s printers are registered with WorkSuite. New ones wait for an administrator’s approval.')),
    onError: (e) => toast('error', errorMessage(e)),
  });
  const server = useQuery({ queryKey: ['label', 'server-printers'], queryFn: ({ signal }) => fetchServerPrinters(signal), retry: false, refetchInterval: 30_000 });
  const paused = new Map((server.data ?? []).map((p) => [String(p.id), p]));
  const toggle = useMutation({
    mutationFn: ({ id, pause }: { id: number; pause: boolean }) => (pause ? pausePrinter(id, 'Paused at the print station.') : resumePrinter(id)),
    onSuccess: (_r, v) => (toast('success', v.pause ? 'Paused. Its jobs wait in WorkSuite until it is resumed.' : 'Resumed.'), void qc.invalidateQueries({ queryKey: ['label', 'server-printers'] })),
    onError: (e) => toast('error', refusal(e)),
  });
  const scan = useMutation({ mutationFn: discover, onSuccess: setFound, onError: (e) => toast('error', errorMessage(e)) });

  if (host.isPending || settings.isPending) return <Spinner />;
  if (host.error) return <ErrorNote error={host.error} onRetry={() => void host.refetch()} />;
  const h = host.data;
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <h1 className="m-0 flex-1 text-[18px] font-extrabold text-ink">Printers on this computer</h1>
        <button type="button" className={btn} disabled={scan.isPending} onClick={() => scan.mutate()}>{scan.isPending ? 'Looking on the network…' : 'Discover LAN printers'}</button>
        <button type="button" className={btnPrimary} disabled={reg.isPending} onClick={() => reg.mutate()}>Register with WorkSuite</button>
      </div>
      <label className="flex items-center gap-2 text-[12.5px] font-semibold text-ink">
        <Checkbox checked={settings.data?.host ?? true} onChange={(e) => void set({ host: e.target.checked })} />
        Print WorkSuite’s label jobs for these printers on this computer
      </label>
      <p className="m-0 text-[11.5px] text-ink-3">{h.registeredAt ? `Registered ${new Date(h.registeredAt).toLocaleString()}${h.lastClaimAt ? ` · last checked for jobs ${new Date(h.lastClaimAt).toLocaleTimeString()}` : ''}` : 'Not registered yet.'}{h.problem ? ` · ${h.problem}` : ''}</p>
      <Section title="Printers">
        <table className="w-full border-collapse text-[12px] text-ink">
          <thead>
            <tr>
              <th className={th}>Printer</th>
              <th className={th}>Connection</th>
              <th className={th}>Language</th>
              <th className={th}>WorkSuite</th>
              <th className={th}>Status</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {h.printers.map((p) => (
              <tr key={p.key}>
                <td className={td}><span className="font-semibold">{p.name}</span>{p.isDefault ? <span className="ml-1 text-[11px] text-ink-3">default</span> : null}</td>
                <td className={td}>{p.connection === 'tcp' ? `Raw TCP ${p.address}:${p.port}` : 'OS queue (raw)'}</td>
                <td className={td}>{p.language === 'unknown' ? '—' : p.language.toUpperCase()}</td>
                <td className={td}>{p.serverId ? (p.approved ? <StatePill state="ready">Approved</StatePill> : <StatePill state="paused">Awaiting approval</StatePill>) : <StatePill state="unknown">Not registered</StatePill>}</td>
                <td className={td}>
                  {p.serverId && paused.get(p.serverId)?.paused ? <StatePill state="paused">Paused in WorkSuite</StatePill> : <StatePill state={p.state} />}
                  {p.message ? <span className="ml-1 text-[11px] text-ink-3">{p.message}</span> : null}
                </td>
                <td className={td}>
                  <span className="inline-flex gap-1.5">
                    {p.serverId && p.approved && server.data ? (
                      <button type="button" className={btn} disabled={toggle.isPending} onClick={() => toggle.mutate({ id: Number(p.serverId), pause: !paused.get(p.serverId!)?.paused })}>
                        {paused.get(p.serverId)?.paused ? 'Resume' : 'Pause'}
                      </button>
                    ) : null}
                    {p.connection === 'tcp' ? <button type="button" className={btn} onClick={() => void set({ removeLan: p.key })}>Remove</button> : null}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      {found ? (
        <Section title={`Found on the network (${found.length})`}>
          {found.length === 0 ? <p className="m-0 px-3.5 py-3 text-[12.5px] text-ink-3">Nothing answered on port 9100 on this computer’s networks.</p> : (
            <ul className="m-0 list-none p-0">
              {found.map((f) => (
                <li key={f.address} className="flex items-center gap-3 border-b border-line/70 px-3.5 py-2 text-[12.5px] last:border-0">
                  <span className="w-[130px] font-mono tabular-nums">{`${f.address}:${f.port}`}</span>
                  <span className="min-w-0 flex-1 truncate">{f.model ?? 'A raw printer (it did not say its model)'}</span>
                  <button type="button" className={btn} disabled={f.added} onClick={() => void set({ addLan: { address: f.address, port: f.port, name: f.model ?? `Printer ${f.address}`, language: f.language === 'unknown' ? 'zpl' : f.language } }).then(() => setFound(found.map((x) => (x === f ? { ...x, added: true } : x))))}>
                    {f.added ? 'Added' : 'Add'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}
      <Section title="Add a LAN printer by address">
        <form
          className="grid grid-cols-[1fr_90px_1fr_120px_auto] items-end gap-2 p-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            void set({ addLan: { ...lan, name: lan.name || `Printer ${lan.address}` } }).then(() => setLan({ address: '', port: 9100, name: '', language: 'zpl' }));
          }}
        >
          <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-ink-2">IPv4 address<input className={field} required pattern="^(\d{1,3}\.){3}\d{1,3}$" value={lan.address} onChange={(e) => setLan({ ...lan, address: e.target.value.trim() })} placeholder="192.168.1.40" /></label>
          <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-ink-2">Port<input type="number" className={field} value={lan.port} onChange={(e) => setLan({ ...lan, port: Number(e.target.value) || 9100 })} /></label>
          <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-ink-2">Name<input className={field} value={lan.name} onChange={(e) => setLan({ ...lan, name: e.target.value })} placeholder="Warehouse Zebra" /></label>
          <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-ink-2">
            Language
            <select className={field} value={lan.language} onChange={(e) => setLan({ ...lan, language: e.target.value as LabelLanguage })}>
              {(['zpl', 'tspl', 'epl', 'dpl', 'sbpl', 'escp'] as const).map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
            </select>
          </label>
          <button type="submit" className={btnPrimary}>Add</button>
        </form>
      </Section>
    </div>
  );
}
