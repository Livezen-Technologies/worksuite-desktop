import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Button, Spinner, cx } from '../../components/ui';
import { bodyKeyOf, checkIntegrity, fetchArchive, fmtDate, K, titleCase, type Body, type MeetingRow } from './api';
import { BodyTabs, Muted, Panel, Status } from './parts';

/** D-10 Archive: past meetings by year, read-only, with integrity verification (FR-ARC-01). */
export default function Archive({ bodies, onOpen }: { bodies: Body[]; onOpen: (meetingId: number) => void }) {
  const [body, setBody] = useState<string | null>(null);
  const [selId, setSelId] = useState<number | null>(null);
  const list = useQuery({ queryKey: K.archive, queryFn: ({ signal }) => fetchArchive(signal) });
  const rows = (list.data ?? []).filter((m) => !body || bodyKeyOf(m) === body).sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  const years = new Map<string, MeetingRow[]>();
  for (const m of rows) years.set(m.starts_at.slice(0, 4), [...(years.get(m.starts_at.slice(0, 4)) ?? []), m]);
  const selId2 = selId ?? rows[0]?.id ?? null;
  const r = rows.find((m) => m.id === selId2) ?? null;
  // The archive's integrity check covers the company's audit chain and every pack and paper version (FR-ARC-01).
  const verify = useMutation({
    mutationFn: () => checkIntegrity(),
    onSuccess: (x) => toast(x.ok ? 'success' : 'error', x.ok ? 'Integrity verified: nothing has changed since it was sealed.' : `The integrity check found ${x.failures?.length ?? 0} problems.`),
    onError: (e) => toast('error', errorMessage(e)),
  });
  const a = r?.archive ?? null;
  return (
    <div className="flex h-full flex-col gap-3 p-5">
      <div><h1 className="text-[18px] font-bold">Archive</h1><Muted>Read-only · meetings you attended or may view</Muted></div>
      <BodyTabs bodies={bodies} value={body} onChange={setBody} />
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_320px] gap-3">
        <div className="overflow-y-auto scroll-thin">
          {list.isPending ? <Spinner /> : null}
          {[...years.entries()].map(([y, ms]) => (
            <section key={y} aria-label={y}>
              <h2 className="mt-2 mb-1 text-[12px] font-bold text-ink-3">{y}</h2>
              <ul className="space-y-1.5">
                {ms.map((m) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => setSelId(m.id)} className={cx('flex w-full items-center gap-3 rounded-[8px] border bg-surface p-2.5 text-left', selId2 === m.id ? 'border-primary' : 'border-line')}>
                      <span className="w-[34px] text-center text-[10px] font-bold text-ink-3 uppercase">{new Date(m.starts_at).toLocaleDateString(undefined, { month: 'short' })}<span className="block text-[16px] text-ink">{new Date(m.starts_at).getDate()}</span></span>
                      <span className="min-w-0 flex-1"><span className="block text-[13px] font-bold">{m.title}</span></span>
                      <Status tone={m.gov_status === 'ARCHIVED' ? 'success' : 'indigo'}>{titleCase(m.gov_status)}</Status>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <Panel title={r ? r.meeting_number ?? r.title : 'Meeting record'}>
          {r ? (
            <div className="space-y-2 text-[12.5px]">
              <Muted>{r.body} · {fmtDate(r.starts_at)}</Muted>
              {r.pack ? <div className="flex justify-between">Board pack v{r.pack.current_version} (final)<button type="button" className="text-primary underline" onClick={() => onOpen(r.id)}>Open</button></div> : null}
              {a ? <div>{[a.pack_versions !== undefined ? `Pack versions · ${a.pack_versions}` : null, a.minutes ? 'Minutes' : null, a.resolutions !== undefined ? `Resolutions · ${a.resolutions}` : null, a.votes !== undefined ? `Votes · ${a.votes}` : null, a.actions !== undefined ? `Actions · ${a.actions}` : null].filter(Boolean).join(' · ')}</div> : null}
              <Button size="sm" loading={verify.isPending} onClick={() => verify.mutate()}>Verify integrity</Button>
              <Muted>{a?.read_only === false ? 'Not yet sealed' : 'Read-only · nothing here can be edited'}</Muted>
            </div>
          ) : <Muted>Choose a meeting.</Muted>}
        </Panel>
      </div>
    </div>
  );
}
