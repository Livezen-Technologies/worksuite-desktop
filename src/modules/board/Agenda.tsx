import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Button, FileBadge, Spinner } from '../../components/ui';
import { fetchActions, fetchAgenda, fmtDate, fmtTime, K, setAttendance, summarize, type AgendaItem, type Meeting } from './api';
import { FlagChip, Muted, Panel, Status } from './parts';

const REPLY: Record<string, string> = { in_person: 'In person', remote: 'Remote', apologies: 'Apologies' };

/** D-02 Agenda, meeting information & participants (FR-DX-07..09, FR-DX-11, FR-ATT-01). */
export default function Agenda({ meeting, meetingId, onItem, onComments, onRoom }: { meeting: Meeting | null; meetingId: number; onItem: (id: number) => void; onComments: (id: number) => void; onRoom: () => void }) {
  const qc = useQueryClient();
  const agenda = useQuery({ queryKey: K.agenda(meetingId), queryFn: ({ signal }) => fetchAgenda(meetingId, signal) });
  const [drawer, setDrawer] = useState<'summary' | 'actions' | 'notes' | null>(null);
  const [sel, setSel] = useState<AgendaItem | null>(null);
  const attend = useMutation({
    mutationFn: (mode: 'in_person' | 'remote' | 'apologies') => setAttendance(meetingId, mode),
    onSuccess: () => void qc.invalidateQueries({ queryKey: K.meeting(meetingId) }),
    onError: (e) => toast('error', errorMessage(e)),
  });
  const offline = useMutation({
    mutationFn: () => call('board:packDownload', { meetingId }),
    onSuccess: () => toast('success', 'The pack is in the encrypted vault on this computer.'),
    onError: (e) => toast('error', errorMessage(e)),
  });
  const items = agenda.data ?? [];
  const opened = items.filter((i) => i.seen_at).length;
  const sections: Array<[string, AgendaItem[]]> = [];
  for (const i of items) {
    const s = i.section ?? '';
    const last = sections[sections.length - 1];
    if (last && last[0] === s) last[1].push(i);
    else sections.push([s, [i]]);
  }
  const live = meeting?.status === 'live' || meeting?.status === 'in_progress';

  return (
    <div className="flex h-full flex-col p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-bold">{meeting ? `${meeting.body?.name ?? ''} — ${meeting.number ?? meeting.title}` : 'Agenda'}</h1>
          <p className="text-[12px] text-ink-3">{meeting ? [fmtDate(meeting.starts_at), `${fmtTime(meeting.starts_at)}${meeting.ends_at ? `–${fmtTime(meeting.ends_at)}` : ''}`, meeting.room].filter(Boolean).join(' · ') : ''}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {meeting?.pack ? <Status tone="warning">Pack v{meeting.pack.version}{meeting.pack.amended_at ? ` · amended ${fmtDate(meeting.pack.amended_at)}` : ''}</Status> : null}
          {live ? <Button variant="primary" size="sm" onClick={onRoom}>Join live meeting</Button> : null}
          {(['summary', 'actions', 'notes'] as const).map((d) => (
            <Button key={d} size="sm" variant={drawer === d ? 'primary' : 'secondary'} aria-pressed={drawer === d} onClick={() => setDrawer(drawer === d ? null : d)}>
              {d === 'summary' ? 'AI Summary' : d === 'actions' ? 'Actions' : 'Notes'}
            </Button>
          ))}
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_300px] gap-3">
        <Panel title="Agenda" action={<span className="text-[12px] font-normal text-ink-3">Opened {opened} of {items.length} · <button type="button" className="text-primary underline" onClick={() => offline.mutate()} disabled={offline.isPending}>{offline.isPending ? 'Downloading…' : 'Download for offline'}</button></span>}>
          {agenda.isPending ? <Spinner /> : (
            <ol aria-label="Agenda items">
              {sections.map(([title, list]) => (
                <li key={title || '-'}>
                  {title ? <div className="-mx-3.5 bg-subtle px-3.5 py-1.5 text-[12px] font-bold">{title}</div> : null}
                  <ul>
                    {list.map((i) => (
                      <li key={i.id} className={`flex items-start gap-2.5 border-b border-line py-2.5 ${sel?.id === i.id ? 'bg-[#EEF1FD] dark:bg-selection' : ''}`}>
                        {i.paper ? <FileBadge name={i.paper.name} size={30} /> : <span className="w-[30px]" />}
                        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { setSel(i); if (i.paper) onItem(i.id); }} aria-label={`${i.number} ${i.title}`}>
                          <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold">{i.number} {i.title} <FlagChip flag={i.flag} /></div>
                          <div className="text-[11.5px] text-ink-3">
                            {[i.paper?.pages ? `${i.paper.pages} pp` : null, i.my_notes ? `My notes ${i.my_notes}` : null, i.comments ? `Comments ${i.comments}` : null, i.seen_at ? `Seen ${fmtDate(i.seen_at)} ${fmtTime(i.seen_at)}` : i.paper ? 'Not opened' : null].filter(Boolean).join(' · ')}
                          </div>
                          {i.status ? <span className="mt-1 inline-block"><Status tone="indigo">{i.status}</Status></span> : null}
                        </button>
                        <button type="button" className="text-[12px] text-primary" onClick={() => onComments(i.id)}>Comments</button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </Panel>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto scroll-thin">
          {drawer ? <Drawer kind={drawer} item={sel} /> : null}
          <Panel title="Meeting information">
            <label className="flex items-center justify-between gap-2 rounded-[8px] bg-subtle px-2.5 py-2 text-[12.5px]">
              My attendance
              <select aria-label="My attendance" value={meeting?.my_attendance ?? ''} onChange={(e) => attend.mutate(e.target.value as 'in_person')} className="rounded border border-line bg-surface px-1.5 py-1">
                <option value="" disabled>Reply</option>
                {Object.entries(REPLY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <dl className="mt-2 space-y-2 text-[12.5px]">
              <div><dt className="text-[11px] text-ink-3">Where</dt><dd>{meeting?.location ?? meeting?.room ?? '—'}{meeting?.meet_link ? <> · <button type="button" className="text-primary underline" onClick={() => void call('app:openInBrowser', { path: meeting.meet_link! })}>Join on Meet</button></> : null}</dd></div>
              <div><dt className="text-[11px] text-ink-3">Organiser</dt><dd>{meeting?.organiser ?? '—'}</dd></div>
              {meeting?.purpose ? <div><dt className="text-[11px] text-ink-3">Purpose</dt><dd>{meeting.purpose}</dd></div> : null}
              <div><dt className="text-[11px] text-ink-3">Quorum</dt><dd>{meeting?.quorum_rule ?? '—'}</dd></div>
            </dl>
          </Panel>
          <Panel title="Participants" action={<span className="text-[11.5px] font-normal text-ink-3">{meeting?.participants?.filter((p) => p.reply && p.reply !== 'apologies').length ?? 0} attending</span>}>
            <ul className="space-y-2">
              {(meeting?.participants ?? []).map((p) => (
                <li key={p.id} className="text-[12.5px]">
                  <div className="font-semibold">{p.name}{p.role ? <span className="font-normal text-ink-3"> · {p.role}</span> : null}</div>
                  <div className="text-[11.5px] text-ink-3">{p.kind === 'invitee' || p.kind === 'presenter' ? `In attendance${p.item_only?.length ? ` · ${p.item_only.join(', ')} only` : ''}` : p.reply ? REPLY[p.reply] : 'No reply'}</div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/** FR-DX-11: AI Summary with page citations, the item's actions, my private notes. */
function Drawer({ kind, item }: { kind: 'summary' | 'actions' | 'notes'; item: AgendaItem | null }) {
  const sum = useQuery({ queryKey: K.summary(item?.id ?? 0), queryFn: () => summarize(item!.id), enabled: kind === 'summary' && !!item?.paper });
  const acts = useQuery({ queryKey: K.actions, queryFn: ({ signal }) => fetchActions(signal), enabled: kind === 'actions' });
  if (!item) return <Panel title="Choose an item"><Muted>Pick an agenda item to see its {kind === 'summary' ? 'AI summary' : kind}.</Muted></Panel>;
  if (kind === 'summary') {
    return (
      <Panel title={`AI summary · ${item.number}`}>
        {sum.isPending ? <Spinner /> : (
          <ul className="space-y-2 text-[12.5px]">
            {(sum.data?.points ?? []).map((p, i) => <li key={i}><b>{p.label}.</b> {p.text} {p.page ? <span className="rounded bg-subtle px-1 text-[11px]">p{p.page}</span> : null}</li>)}
            {sum.data && !sum.data.points.length ? <li className="text-ink-3">Not found in the documents you can access.</li> : null}
          </ul>
        )}
        <Muted>Check the paper before relying on a summary.</Muted>
      </Panel>
    );
  }
  if (kind === 'actions') {
    const list = (acts.data ?? []).filter((a) => a.source?.includes(item.number));
    return <Panel title={`Actions · ${item.number}`}>{list.length ? list.map((a) => <div key={a.id} className="text-[12.5px]">{a.title}</div>) : <Muted>No actions linked to this item.</Muted>}</Panel>;
  }
  return <Panel title={`My notes · ${item.number}`}><Muted>{item.my_notes ? `${item.my_notes} private notes on this paper — open it to read them.` : 'No notes yet. Notes you add in the reader are private to you.'}</Muted></Panel>;
}
