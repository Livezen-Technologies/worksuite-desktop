import { useQuery } from '@tanstack/react-query';
import { ErrorNote, Spinner } from '../../components/ui';
import { fetchJobs, fetchTemplates, hostStatus, K } from './api';
import type { ViewProps } from './LabelShell';
import { btn, btnPrimary, Progress, Section, StatePill, td, th } from './parts';

/**
 * D01 — Label Studio home (FR-DSK-01): this computer's printers first, then the templates printed most lately (the
 * server keeps no pins yet; these are what people here reach for) and the recent jobs.
 */
export default function Home({ to }: ViewProps) {
  const host = useQuery({ queryKey: K.host, queryFn: hostStatus });
  const pinned = useQuery({ queryKey: K.templates('', true), queryFn: ({ signal }) => fetchTemplates('', true, signal), staleTime: 60_000 });
  const jobs = useQuery({ queryKey: K.jobs, queryFn: ({ signal }) => fetchJobs(signal), refetchInterval: 15_000 });
  const printers = host.data?.printers ?? [];
  const local = host.data?.jobs.filter((j) => j.state !== 'done' && j.state !== 'cancelled') ?? [];
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <h1 className="m-0 flex-1 text-[18px] font-extrabold text-ink">Label Studio</h1>
        <button type="button" className={btn} onClick={() => to('designer')}>Designer</button>
        <button type="button" className={btnPrimary} onClick={() => to('station')}>Print station</button>
      </div>
      {local.length ? (
        <Section title="Printing on this computer" action={<button type="button" className={btn} onClick={() => to('batch')}>Open</button>}>
          <ul className="m-0 list-none p-0">
            {local.map((j) => (
              <li key={j.id} className="flex items-center gap-3 border-b border-line/70 px-3.5 py-2 text-[12.5px] last:border-0">
                <span className="min-w-0 flex-1 truncate font-semibold">{j.ref ?? j.id} · {j.template ?? 'Label'}</span>
                <Progress done={j.confirmed} total={j.total} />
                <StatePill state={j.state} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Section title="Printers on this computer" action={<button type="button" className={btn} onClick={() => to('printers')}>Manage</button>}>
          {host.isPending ? <Spinner /> : host.error ? <ErrorNote error={host.error} /> : printers.length === 0 ? <p className="m-0 px-3.5 py-3 text-[12.5px] text-ink-3">No printers found. Add a LAN printer in Printers.</p> : (
            <ul className="m-0 list-none p-0">
              {printers.slice(0, 8).map((p) => (
                <li key={p.key} className="flex items-center gap-2 border-b border-line/70 px-3.5 py-2 text-[12.5px] last:border-0">
                  <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                  <span className="text-[11px] text-ink-3 uppercase">{p.connection === 'tcp' ? `LAN ${p.address}` : 'USB / OS queue'}</span>
                  {p.serverId ? <StatePill state={p.approved ? p.state : 'paused'}>{p.approved ? undefined : 'Awaiting approval'}</StatePill> : <StatePill state="unknown">Not registered</StatePill>}
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Templates printed lately">
          {pinned.isPending ? <Spinner /> : pinned.error ? <ErrorNote error={pinned.error} onRetry={() => void pinned.refetch()} /> : pinned.data.length === 0 ? <p className="m-0 px-3.5 py-3 text-[12.5px] text-ink-3">No published templates yet. Make one in the web’s template library.</p> : (
            <ul className="m-0 list-none p-0">
              {pinned.data.map((t) => (
                <li key={t.id} className="flex items-center gap-2 border-b border-line/70 px-3.5 py-2 text-[12.5px] last:border-0">
                  <span className="min-w-0 flex-1 truncate font-semibold">{t.name}</span>
                  {t.category ? <span className="text-[11px] text-ink-3">{t.category}</span> : null}
                  <button type="button" className={btn} onClick={(e) => to('designer', `&template=${t.id}`, e.metaKey || e.ctrlKey)}>Open</button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      <Section title="My recent jobs">
        {jobs.isPending ? <Spinner /> : jobs.error ? <ErrorNote error={jobs.error} onRetry={() => void jobs.refetch()} /> : (
          <table className="w-full border-collapse text-[12px] text-ink">
            <thead>
              <tr>
                <th className={th}>Job</th>
                <th className={th}>Template</th>
                <th className={th}>Printer</th>
                <th className={th}>Labels</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {jobs.data.map((j) => (
                <tr key={j.id}>
                  <td className={td}>{j.code}</td>
                  <td className={td}>{j.template_name ?? (j.template_id ? `#${j.template_id}` : '—')}</td>
                  <td className={td}>{j.printer_name ?? (j.printer_id ? `#${j.printer_id}` : '—')}</td>
                  <td className={td}><Progress done={j.labels_confirmed ?? 0} total={j.labels_total} /></td>
                  <td className={td}><StatePill state={j.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}
