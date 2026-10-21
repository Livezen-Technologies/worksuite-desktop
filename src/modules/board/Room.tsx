import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useStore } from '../../core/store';
import { app } from '../../core/app-state';
import { errorMessage, on } from '../../core/bridge';
import { useTick } from '../../core/connection';
import { toast } from '../../core/toasts';
import { FileViewer } from '../../components/FileViewer';
import { Button, Spinner, cx } from '../../components/ui';
import { castVote, createVote, fetchAgenda, fetchMeeting, K, lifecycle, present, tallyView, voteBlock, voteStep, type Meeting, type Participant } from './api';
import { Muted, Status } from './parts';

/** The `board.meeting.{id}` events (§9.3) that change the room. */
export const ROOM_EVENTS = new Set(['attendance.changed', 'quorum.changed', 'present.item', 'vote.opened', 'vote.tally', 'vote.closed', 'item.started', 'item.ended', 'pack.revised']);

/** Follows the room: realtime events for this meeting, and a poll every few seconds in case one is missed. */
export function useLiveMeeting(meetingId: number) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.meeting(meetingId), queryFn: ({ signal }) => fetchMeeting(meetingId, signal), refetchInterval: 4_000 });
  useEffect(() => on<{ type?: string; channel?: string; event?: string; meeting_id?: number }>('realtime:event', (e) => {
    const ev = e.event ?? e.type ?? '';
    const mine = e.channel === `board.meeting.${meetingId}` || e.meeting_id === meetingId;
    if (mine && (ROOM_EVENTS.has(ev) || ROOM_EVENTS.has(ev.replace(/^board\./, '')))) void qc.invalidateQueries({ queryKey: K.meeting(meetingId) });
  }), [qc, meetingId]);
  return q;
}

export function elapsed(since: string | null | undefined, now: number): string {
  if (!since) return '00:00:00';
  const s = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
}

const PRESENCE: Record<string, string> = { in_room: 'In room', remote: 'Remote', left: 'Left', absent: 'Absent' };

/** D-12 Live meeting room: present items, watch quorum, open and close votes (FR-ROOM, FR-ATT, FR-QRM, FR-VOT). */
export default function Room({ meetingId, onMinutes }: { meetingId: number; onMinutes: () => void }) {
  const qc = useQueryClient();
  const now = useTick(1000);
  const mq = useLiveMeeting(meetingId);
  const agenda = useQuery({ queryKey: K.agenda(meetingId), queryFn: ({ signal }) => fetchAgenda(meetingId, signal) });
  const offline = useStore(app, (s) => s.status?.network === 'OFFLINE');
  const [side, setSide] = useState(false);
  const m = mq.data;
  const refresh = () => void qc.invalidateQueries({ queryKey: K.meeting(meetingId) });
  const act = useMutation({ mutationFn: (f: () => Promise<unknown>) => f(), onSuccess: refresh, onError: (e) => toast('error', errorMessage(e)) });
  if (mq.isPending) return <Spinner />;
  if (!m) return <p className="m-6 text-[13px] text-ink-2">The meeting could not be loaded.</p>;
  const chair = m.my_role === 'chair' || m.can?.chair === true;
  const items = agenda.data ?? [];
  const cur = items.find((i) => i.id === m.live?.item_id) ?? null;
  const q = m.quorum ?? null;
  const vote = m.live?.vote ?? null;
  const res = m.live?.resolution ?? null;
  const block = voteBlock(q, vote);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2">
        <Status tone="danger">● LIVE {elapsed(m.started_at, now)}</Status>
        <div className="min-w-0 flex-1"><div className="truncate text-[14px] font-bold">{m.body?.name} — {m.number ?? m.title}</div><Muted>{[m.room, m.meet_link ? 'WorkSuite Meet' : null, chair ? 'you chair' : m.my_role].filter(Boolean).join(' · ')}</Muted></div>
        {q ? <Status tone={q.met ? 'success' : 'danger'}>{q.met ? '✓ Quorum' : '▲ Quorum lost'} · {q.present}/{q.voting_total ?? '—'} voting present (needs {q.required})</Status> : null}
        {m.my_role === 'secretary' ? <Button size="sm" onClick={onMinutes}>Live minutes</Button> : null}
        {chair ? <><Button size="sm" onClick={() => act.mutate(() => lifecycle(meetingId, 'adjourn'))}>Adjourn</Button><Button size="sm" variant="danger" onClick={() => act.mutate(() => lifecycle(meetingId, 'complete'))}>End meeting</Button></> : null}
      </header>
      {offline ? <div role="alert" className="bg-warning/10 px-4 py-1.5 text-[12.5px] text-warning">Offline — votes in a live meeting are online only. Reconnect to vote.</div> : null}
      <div className="grid min-h-0 flex-1 grid-cols-[230px_1fr_300px]">
        <nav aria-label="Agenda" className="overflow-y-auto border-r border-line bg-surface p-2 scroll-thin">
          <div className="flex justify-between px-1.5 pb-1 text-[11px] font-bold text-ink-3 uppercase"><span>Agenda</span>{chair ? <span className="font-normal normal-case">click to present</span> : null}</div>
          <ol>
            {items.map((i) => (
              <li key={i.id}>
                <button type="button" disabled={!chair} aria-current={cur?.id === i.id ? 'true' : undefined} onClick={() => act.mutate(() => present(meetingId, i.id))} className={cx('flex w-full gap-2 rounded-[7px] px-2 py-1.5 text-left text-[12.5px]', cur?.id === i.id ? 'bg-[#EEF1FD] font-bold text-primary dark:bg-selection' : 'text-ink-2 enabled:hover:bg-subtle')}>
                  <span className="w-[26px] shrink-0 font-bold">{i.number}</span><span className="min-w-0 flex-1">{i.title}</span>{i.minutes ? <span className="text-ink-3">{i.minutes}m</span> : null}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <section className="flex min-h-0 flex-col bg-[#475069]">
          <div className="flex items-center gap-2 bg-surface px-3 py-1.5 text-[12.5px]">
            <Status tone="indigo">Presenting to {m.participants?.filter((p) => p.presence === 'in_room' || p.presence === 'remote').length ?? 0}</Status>
            <b className="min-w-0 flex-1 truncate">{cur ? `${cur.number} ${cur.title}` : 'Nothing presented yet'}</b>
            <span className="text-ink-3">Page {m.live?.page ?? 1}{cur?.paper?.pages ? ` / ${cur.paper.pages}` : ''}</span>
            <Button size="sm" aria-pressed={side} onClick={() => setSide(!side)}>Side by side</Button>
          </div>
          <div className={cx('relative grid min-h-0 flex-1 gap-2 p-3', side ? 'grid-cols-2' : 'grid-cols-1')}>
            {cur?.paper ? (
              <>
                <Paper path={`/api/board/papers/${cur.paper.id}/file?member=me`} name={cur.paper.name} />
                {side ? <Paper path={`/api/board/papers/${cur.paper.id}/file?member=me&version=previous`} name={`${cur.paper.name} (previous)`} /> : null}
              </>
            ) : <p className="m-auto text-[13px] text-white/80">The chair has not presented an item.</p>}
          </div>
        </section>
        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-l border-line bg-surface p-3 scroll-thin">
          {res ? (
            <section aria-label="Resolution">
              <div className="flex justify-between text-[13px] font-bold"><span>Resolution</span><Status tone="indigo">{res.number}</Status></div>
              <p className="mt-1.5 rounded-[8px] bg-subtle p-2 font-serif text-[12.5px]">{res.text}</p>
              <Muted>{[res.proposer ? `Proposed ${res.proposer}` : null, res.seconder ? `seconded ${res.seconder}` : null, res.rule].filter(Boolean).join(' · ')}</Muted>
              {vote?.status === 'open' || vote?.status === 'closed' ? <Tally m={m} /> : null}
              {chair ? (
                vote?.status === 'open' ? <Button className="mt-2 w-full" disabled={offline} onClick={() => act.mutate(() => voteStep(vote.id, 'close'))}>Close vote &amp; record result</Button>
                  : vote?.status === 'closed' ? <p className="mt-2 text-[12.5px] font-semibold">Result: {vote.result ?? 'recorded'}</p>
                  : <Button className="mt-2 w-full" variant="primary" disabled={!!block || offline} onClick={() => act.mutate(async () => { const v = vote ?? (await createVote(res.id)); return voteStep(v.id, 'open'); })}>{block ?? 'Open vote'}</Button>
              ) : vote?.status === 'open' ? <VoteCard m={m} disabled={offline} onCast={(c) => act.mutate(() => castVote(vote.id, c))} /> : null}
              {q ? <Muted>Eligible: {vote?.eligible ?? q.present} voting members present without a conflict.</Muted> : null}
            </section>
          ) : null}
          <section aria-label="Participants">
            <div className="text-[13px] font-bold">Participants</div>
            <ul className="mt-1 space-y-1.5">{(m.participants ?? []).map((p) => <ParticipantRow key={p.id} p={p} item={cur?.number ?? null} />)}</ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Paper({ path, name }: { path: string; name: string }) {
  return (
    <div className="relative min-h-0 overflow-hidden rounded bg-white">
      <FileViewer path={path} name={name} />
      {/* The server's per-member rendition carries the watermark; this one only reminds the screen. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center text-[28px] font-bold text-[#c00]/10 -rotate-[30deg]">CONFIDENTIAL</div>
    </div>
  );
}

function Tally({ m }: { m: Meeting }) {
  const v = m.live!.vote!;
  const t = tallyView(v);
  return (
    <div className="mt-2" aria-label="Tally">
      <div className="flex justify-between text-[12px]"><Status tone="indigo">{v.status === 'open' ? 'Voting open' : 'Closed'}</Status><span>{t.cast} of {t.eligible} eligible voted</span></div>
      {t.counts ? (
        <div className="mt-1.5 grid grid-cols-3 gap-1.5 text-center">
          {(['for', 'against', 'abstain'] as const).map((k) => <div key={k} className="rounded-[8px] border border-line py-1.5"><div className={cx('text-[18px] font-bold', k === 'for' ? 'text-success' : k === 'against' ? 'text-danger' : '')}>{t.counts![k]}</div><div className="text-[11px] capitalize text-ink-3">{k}</div></div>)}
        </div>
      ) : <Muted>Secret ballot: only the number of ballots cast is shown.</Muted>}
      {v.excluded?.length ? <Muted>{v.excluded.length} excluded: {v.excluded.join(', ')}</Muted> : null}
    </div>
  );
}

/** The member's own ballot (VoteCard design): online only, changeable until the chair closes voting. */
function VoteCard({ m, disabled, onCast }: { m: Meeting; disabled: boolean; onCast: (c: 'for' | 'against' | 'abstain') => void }) {
  const v = m.live!.vote!;
  return (
    <div className="mt-2 space-y-1.5" aria-label="Your vote">
      {(['for', 'against', 'abstain'] as const).map((c) => (
        <Button key={c} className="w-full" variant={v.my_choice === c ? 'primary' : 'secondary'} disabled={disabled} aria-pressed={v.my_choice === c} onClick={() => onCast(c)}>{c[0]!.toUpperCase() + c.slice(1)}</Button>
      ))}
      <Muted>{v.my_choice ? `You voted ${v.my_choice}. ` : ''}You can change your vote until the chair closes voting.</Muted>
    </div>
  );
}

function ParticipantRow({ p, item }: { p: Participant; item: string | null }) {
  const conflict = item && p.conflict_items?.includes(item);
  const label = conflict ? `Conflict ${item}` : p.reply === 'apologies' ? 'Apologies' : p.role === 'Secretary' ? 'Minuting' : p.presence ? PRESENCE[p.presence] : '—';
  return (
    <li className="flex items-center justify-between text-[12.5px]">
      <span><span className={cx('mr-1.5 inline-block h-2 w-2 rounded-full', p.presence === 'in_room' || p.presence === 'remote' ? 'bg-success' : 'bg-line')} />{p.name}{p.role ? <span className="text-ink-3"> {p.role}</span> : null}</span>
      {conflict ? <Status tone="danger">{label}</Status> : <span className="text-ink-3">{label}</span>}
    </li>
  );
}
