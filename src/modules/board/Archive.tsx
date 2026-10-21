import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Button, Spinner, cx } from '../../components/ui';
import { checkIntegrity, fetchMeeting, fetchMeetings, fmtDate, K, type Body, type MeetingCard } from './api';
import { BodyTabs, Muted, Panel, Status } from './parts';

/** D-10 Archive: past meetings by year, read-only, with integrity verification (FR-ARC-01). */
export default function Archive({ bodies, onOpen }: { bodies: Body[]; onOpen: (meetingId: number) => void }) {
  const [body, setBody] = useState<number | null>(null);
  const [selId, setSelId] = useState<number | null>(null);
  const list = useQuery({ queryKey: K.archive, queryFn: ({ signal }) => fetchMeetings({ archived: true }, signal) });
  const rows = (list.data ?? []).filter((m) => !body || m.body?.id === body).sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  const years = new Map<string, MeetingCard[]>();
  for (const m of rows) years.set(m.starts_at.slice(0, 4), [...(years.get(m.starts_at.slice(0, 4)) ?? []), m]);
  const selId2 = selId ?? rows[0]?.id ?? null;
  const rec = useQuery({ queryKey: K.meeting(selId2 ?? 0), queryFn: ({ signal }) => fetchMeeting(selId2!, signal), enabled: !!selId2 });
  const verify = useMutation({
    mutationFn: () => checkIntegrity(selId2!),
    onSuccess: (r) => toast(r.ok ? 'success' : 'error', r.ok ? 'Integrity verified: nothing here has changed since it was archived.' : (r.message ?? 'The integrity check failed.')),
    onError: (e) => toast('error', errorMessage(e)),
  });
  const r = rec.data as (typeof rec.data & { record?: { packs?: string[]; minutes?: string; resolutions?: string[]; actions?: number; notes?: number; archived_at?: string } }) | undefined;
  const web = (p: string) => void call('app:openInBrowser', { path: p });
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
                      <Status tone={m.status === 'complete' || m.status === 'completed' ? 'success' : 'indigo'}>{m.status}</Status>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <Panel title={r ? r.number ?? r.title : 'Meeting record'}>
          {r ? (
            <div className="space-y-2 text-[12.5px]">
              <Muted>{r.body?.name} · {fmtDate(r.starts_at)}</Muted>
              {r.pack ? <div className="flex justify-between">Board pack v{r.pack.version} (final)<button type="button" className="text-primary underline" onClick={() => onOpen(r.id)}>Open</button></div> : null}
              {r.record?.minutes ? <div className="flex justify-between">Signed minutes<button type="button" className="text-primary underline" onClick={() => web(`/board/minutes/${r.minutes_id}`)}>Open</button></div> : null}
              {r.record?.resolutions?.length ? <div>{r.record.resolutions.join(', ')}</div> : null}
              {r.record?.actions !== undefined ? <div>Actions · {r.record.actions}</div> : null}
              {r.record?.notes !== undefined ? <div>My private notes · {r.record.notes}</div> : null}
              <Button size="sm" loading={verify.isPending} onClick={() => verify.mutate()}>Verify integrity</Button>
              <Muted>Archived {fmtDate(r.archived_at ?? r.record?.archived_at)} · nothing here can be edited</Muted>
            </div>
          ) : <Muted>Choose a meeting.</Muted>}
        </Panel>
      </div>
    </div>
  );
}
