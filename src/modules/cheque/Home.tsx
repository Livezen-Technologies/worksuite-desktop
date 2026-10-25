import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { ErrorNote, Spinner } from '../../components/ui';
import { fetchBatches, fetchProfiles, fetchVersions, has, K, type Access, type StationHome } from './api';
import type { ChequeView } from './ChequeShell';
import { Badge, Note, PageHead, Panel, Tile, btn, btnPrimary, num, useStation } from './parts';

/**
 * D01 — Cheque Manager home on the print station: what is ready to print, what waits for approval, a batch that
 * needs attention, received cheques waiting to be deposited, the printers on this computer with their cheque
 * profiles, and recent prints. Every count is the server's (`GET /dashboard`, `GET /batches`).
 */
const RESULT: Record<string, { label: string; tone: 'ok' | 'bad' | 'muted' | 'info' }> = {
  printed: { label: 'Confirmed', tone: 'ok' },
  confirmed: { label: 'Confirmed', tone: 'ok' },
  spoiled: { label: 'Spoiled', tone: 'bad' },
  failed_unused: { label: 'Not printed', tone: 'muted' },
  failed: { label: 'Unknown', tone: 'bad' },
  unknown: { label: 'Unknown', tone: 'bad' },
  spooled: { label: 'Awaiting confirmation', tone: 'info' },
  awaiting_confirmation: { label: 'Awaiting confirmation', tone: 'info' },
};

export default function Home({ data, access, onGo }: { data: UseQueryResult<StationHome>; access: Access | undefined; onGo: (v: ChequeView, extra?: string) => void }) {
  const name = useStore(app, (s) => s.auth?.user?.name ?? '');
  const st = useStation();
  const device = st.data?.device_id ?? null;
  const profiles = useQuery({ queryKey: K.profiles(device), queryFn: ({ signal }) => fetchProfiles(device, signal), enabled: !!device });
  const versions = useQuery({ queryKey: K.versions, queryFn: ({ signal }) => fetchVersions(signal), staleTime: 300_000, enabled: has(access, 'cheque.template.view') });
  const batches = useQuery({ queryKey: K.batches, queryFn: ({ signal }) => fetchBatches(signal), retry: false });
  const d = data.data;
  const hour = new Date().getHours();
  const hello = `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}${name ? `, ${name.split(' ')[0]}` : ''}`;
  const mine = profiles.data ?? [];
  const attention = (batches.data ?? []).filter((b) => b.status === 'RECONCILE_REQUIRED' || b.status === 'PAUSED');
  const vName = (id: number) => {
    const v = versions.data?.find((x) => x.id === id);
    return v ? `${v.name}${v.version ? ` v${v.version}` : ''}${v.status && v.status !== 'ACTIVE' ? ` (${v.status.toLowerCase()})` : ''}` : `version ${id}`;
  };

  return (
    <div className="flex flex-col gap-3">
      <PageHead title={hello} sub={device && mine.length ? 'This computer is a certified cheque print station' : device ? 'No cheque printer profile is bound to this computer yet' : 'This computer is not registered with WorkSuite'}>
        <button type="button" className={btn} onClick={() => onGo('calibration')}>Test alignment</button>
        <button type="button" className={btnPrimary} onClick={() => onGo('queue')}>Open print queue</button>
      </PageHead>

      {data.isLoading ? <Spinner /> : data.error ? <ErrorNote error={data.error} onRetry={() => void data.refetch()} /> : null}

      {d ? (
        <div className="grid grid-cols-4 gap-2.5">
          <Tile tone="violet" label="Ready to print" value={d.ready_to_print} sub="Approved, waiting for a leaf" onClick={() => onGo('queue')} />
          <Tile tone="amber" label="Awaiting approval" value={d.awaiting_approval} />
          <Tile tone="red" label="Batch needs attention" value={attention.length} sub={attention[0] ? `${attention[0].reference} ${attention[0].status === 'RECONCILE_REQUIRED' ? 'interrupted' : 'paused'}` : 'None'} onClick={attention[0] ? () => onGo('batch', `&batch=${attention[0]!.id}`) : undefined} />
          <Tile tone="green" label="Received, to deposit" value={d.received_pending} />
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2.5">
        <Panel title="Printers on this computer">
          <div className="flex flex-col gap-2.5">
            {st.data && st.data.printers.length === 0 ? <div className="text-[12.5px] text-ink-2">No printers are installed on this computer.</div> : null}
            {(st.data?.printers ?? []).map((p) => {
              const ps = mine.filter((m) => m.printer_name === p.name);
              return (
                <div key={p.name}>
                  <div className="flex items-center gap-2 text-[13px]">
                    <span aria-hidden className={`size-2 rounded-full ${ps.length ? 'bg-[#16A34A]' : 'bg-[#94A3B8]'}`} />
                    <b className="min-w-0 flex-1 truncate">{p.displayName}</b>
                    {ps.length ? <Badge tone="ok">Cheque profile</Badge> : <Badge>Not for cheques</Badge>}
                  </div>
                  {ps.length ? (
                    <div className="mt-0.5 pl-4 text-[11.5px] text-ink-2">
                      {[ps[0]!.tray, `profiles: ${ps.flatMap((x) => x.version_ids).map(vName).join(', ') || 'no templates linked'}`].filter(Boolean).join(' · ')}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Panel>
        <Panel title={d && d.recent_prints.length === 0 ? 'Needs attention' : 'Recent prints'}>
          <div className="flex flex-col gap-2">
            {d && d.recent_prints.length === 0 && d.attention.length === 0 ? <div className="text-[12.5px] text-ink-2">Nothing needs you right now.</div> : null}
            {d && d.recent_prints.length === 0
              ? d.attention.slice(0, 6).map((a, i) => (
                  <div key={i} className="flex items-start gap-2.5 text-[12.5px]">
                    <Badge tone={a.tone === 'bad' ? 'bad' : a.tone === 'warn' ? 'warn' : 'info'}>{a.tone === 'bad' ? 'Now' : 'Soon'}</Badge>
                    <span className="min-w-0 flex-1"><b>{a.title}</b>{a.text ? <span className="block text-ink-2">{a.text}</span> : null}</span>
                  </div>
                ))
              : null}
            {(d?.recent_prints ?? []).slice(0, 8).map((r) => {
              const res = RESULT[r.result] ?? { label: r.result || '—', tone: 'muted' as const };
              return (
                <div key={r.id} className="flex items-center gap-2.5 text-[12.5px]">
                  <span className={num}>{r.cheque_number}</span>
                  <span className="min-w-0 flex-1 truncate">{`${r.payee_name}${r.batch ? ' (batch)' : ''}`}</span>
                  <Badge tone={res.tone}>{res.label}</Badge>
                  <span className="text-[11.5px] text-ink-3">{r.at ? new Date(r.at).toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>
      {!has(access, 'cheque.print') ? <Note tone="warn">You can see this station, but printing cheques needs the cheque.print permission.</Note> : null}
      <Note tone="info">Cheques print only from this app at 100 % scale. The browser is never used for cheque printing.</Note>
    </div>
  );
}
