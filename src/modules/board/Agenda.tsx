import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Button, FileBadge, Spinner } from '../../components/ui';
import { fetchActions, fetchAgenda, flagOf, fmtDate, fmtTime, isLive, K, setAttendance, summarize, titleCase, type AgendaItem, type Meeting, type Rsvp } from './api';
import { FlagChip, Muted, Panel, Status } from './parts';

/** What a participant may answer for themselves (FR-ATT-01). */
const REPLY: Record<Rsvp, string> = { ACCEPTED: 'Attending', REMOTE: 'Remote', EXCUSED: 'Apologies', DECLINED: 'Declined' };
/** Every attendance state, as the participants list shows it. */
const STATE: Record<string, string> = { INVITED: 'No reply', ACCEPTED: 'Attending', DECLINED: 'Declined', PRESENT: 'Present', REMOTE: 'Remote', ABSENT: 'Absent', EXCUSED: 'Apologies', LEFT_EARLY: 'Left early' };

/** D-02 Agenda, meeting information & participants (FR-DX-07..09, FR-DX-11, FR-ATT-01). */
export default function Agenda({ meeting, meetingId, onItem, onComments, onRoom }: { meeting: Meeting | null; meetingId: number; onItem: (id: number) => void; onComments: (id: number) => void; onRoom: () => void }) {
  const qc = useQueryClient();
  const agenda = useQuery({ queryKey: K.agenda(meetingId), queryFn: ({ signal }) => fetchAgenda(meetingId, signal) });
  const [drawer, setDrawer] = useState<'summary' | 'actions' | 'notes' | null>(null);
  const [sel, setSel] = useState<AgendaItem | null>(null);
  const attend = useMutation({
    mutationFn: (state: Rsvp) => setAttendance(meetingId, state),
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
  const live = isLive(meeting);
  const mine = meeting?.my_attendance?.state ?? '';

  return (
    <div className="flex h-full flex-col p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-bold">{meeting ? `${meeting.body ?? ''} — ${meeting.meeting_number ?? meeting.title}` : 'Agenda'}</h1>
          <p className="text-[12px] text-ink-3">{meeting ? [fmtDate(meeting.starts_at), `${fmtTime(meeting.starts_at)}${meeting.ends_at ? `–${fmtTime(meeting.ends_at)}` : ''}`, meeting.location].filter(Boolean).join(' · ') : ''}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {meeting?.pack?.current_version ? <Status tone={meeting.pack_revision_pending ? 'warning' : 'indigo'}>Pack v{meeting.pack.current_version}{meeting.pack_revision_pending ? ' · revision coming' : ''}</Status> : null}
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
              {items.map((i) => {
                const paper = i.papers?.[0] ?? null;
                return (
                  <li key={i.id} style={{ paddingInlineStart: `${(i.depth ?? 0) * 18}px` }} className={`flex items-start gap-2.5 border-b border-line py-2.5 ${sel?.id === i.id ? 'bg-selection dark:bg-selection' : ''}`}>
                    {paper ? <FileBadge name={`${paper.title}.pdf`} size={30} /> : <span className="w-[30px]" />}
                    <button type="button" disabled={i.withheld} className="min-w-0 flex-1 text-left" onClick={() => { setSel(i); if (paper) onItem(i.id); }} aria-label={`${i.number} ${i.title}`}>
                      <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold">{i.number} {i.title} <FlagChip flag={flagOf(i.flags)} /></div>
                      <div className="text-[11.5px] text-ink-3">
                        {i.withheld ? (i.reason ?? 'Restricted') : [i.presenter, i.duration_minutes ? `${i.duration_minutes} min` : null, i.my_notes ? `My notes ${i.my_notes}` : null, i.comment_count ? `Comments ${i.comment_count}` : null, i.seen_at ? `Seen ${fmtDate(i.seen_at)} ${fmtTime(i.seen_at)}` : paper ? 'Not opened' : null].filter(Boolean).join(' · ')}
                      </div>
                      {i.item_type && !i.withheld ? <span className="mt-1 inline-block"><Status tone="indigo">{titleCase(i.item_type)}</Status></span> : null}
                    </button>
                    {!i.withheld ? <button type="button" className="text-[12px] text-primary" onClick={() => onComments(i.id)}>Comments</button> : null}
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto scroll-thin">
          {drawer ? <Drawer kind={drawer} item={sel} /> : null}
          <Panel title="Meeting information">
            <label className="flex items-center justify-between gap-2 rounded-[8px] bg-subtle px-2.5 py-2 text-[12.5px]">
              My attendance
              <select aria-label="My attendance" value={mine in REPLY ? mine : ''} onChange={(e) => attend.mutate(e.target.value as Rsvp)} className="rounded border border-line bg-surface px-1.5 py-1">
                <option value="" disabled>{mine ? (STATE[mine] ?? titleCase(mine)) : 'Reply'}</option>
                {Object.entries(REPLY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <dl className="mt-2 space-y-2 text-[12.5px]">
              <div><dt className="text-[11px] text-ink-3">Where</dt><dd>{meeting?.location ?? '—'}{meeting?.online_url ? <> · <button type="button" className="text-primary underline" onClick={() => void call('app:openInBrowser', { path: meeting.online_url! })}>Join online</button></> : null}</dd></div>
              <div><dt className="text-[11px] text-ink-3">Organiser</dt><dd>{meeting?.organizer ?? '—'}</dd></div>
              {meeting?.chair ? <div><dt className="text-[11px] text-ink-3">Chair</dt><dd>{meeting.chair}</dd></div> : null}
              {meeting?.purpose ? <div><dt className="text-[11px] text-ink-3">Purpose</dt><dd>{meeting.purpose}</dd></div> : null}
              <div><dt className="text-[11px] text-ink-3">Quorum</dt><dd>{meeting?.quorum?.label ?? (titleCase(meeting?.quorum_state) || '—')}</dd></div>
            </dl>
          </Panel>
          <Panel title="Participants" action={<span className="text-[11.5px] font-normal text-ink-3">{meeting?.participants?.filter((p) => ['ACCEPTED', 'PRESENT', 'REMOTE'].includes(p.state)).length ?? 0} attending</span>}>
            <ul className="space-y-2">
              {(meeting?.participants ?? []).map((p) => (
                <li key={p.user_id} className="text-[12.5px]">
                  <div className="font-semibold">{p.name}{p.meeting_role ? <span className="font-normal text-ink-3"> · {titleCase(p.meeting_role)}</span> : null}</div>
                  <div className="text-[11.5px] text-ink-3">{[STATE[p.state] ?? titleCase(p.state), p.item_only_id ? `item ${items.find((i) => i.id === p.item_only_id)?.number ?? ''} only` : null].filter(Boolean).join(' · ')}</div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/** FR-DX-11: AI Summary with its sources, the item's actions, my private notes. */
function Drawer({ kind, item }: { kind: 'summary' | 'actions' | 'notes'; item: AgendaItem | null }) {
  const paper = item?.papers?.[0] ?? null;
  const sum = useQuery({ queryKey: K.summary(paper?.id ?? 0), queryFn: () => summarize(paper!.id), enabled: kind === 'summary' && !!paper });
  const acts = useQuery({ queryKey: K.actions, queryFn: ({ signal }) => fetchActions(signal), enabled: kind === 'actions' });
  if (!item) return <Panel title="Choose an item"><Muted>Pick an agenda item to see its {kind === 'summary' ? 'AI summary' : kind}.</Muted></Panel>;
  if (kind === 'summary') return <SummaryPanel title={`AI summary · ${item.number}`} paper={paper} q={sum} />;
  if (kind === 'actions') {
    const list = (acts.data ?? []).filter((a) => a.agenda_item_id === item.id);
    return <Panel title={`Actions · ${item.number}`}>{list.length ? list.map((a) => <div key={a.id} className="text-[12.5px]">{a.title}</div>) : <Muted>No actions linked to this item.</Muted>}</Panel>;
  }
  return <Panel title={`My notes · ${item.number}`}><Muted>{item.my_notes ? `${item.my_notes} private notes on this paper — open it to read them.` : 'No notes yet. Notes you add in the reader are private to you.'}</Muted></Panel>;
}

/** `POST /ai/summarize` answers one text and its sources, labelled AI or the paper's own fields. */
export function SummaryPanel({ title, paper, q }: { title: string; paper: { id: number; title: string } | null; q: { isPending: boolean; data?: { summary: string; label?: string } | undefined } }) {
  return (
    <Panel title={title}>
      {!paper ? <Muted>No paper on this item.</Muted> : q.isPending ? <Spinner /> : q.data?.summary ? (
        <p className="whitespace-pre-wrap text-[12.5px]">{q.data.summary} <span className="rounded bg-subtle px-1 text-[11px]">{paper.title}</span></p>
      ) : <p className="text-[12.5px] text-ink-3">Not found in the documents you can access.</p>}
      <Muted>{q.data?.label ?? 'Check the paper before relying on a summary.'}</Muted>
    </Panel>
  );
}
