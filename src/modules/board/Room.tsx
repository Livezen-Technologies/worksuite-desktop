import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../core/store';
import { app } from '../../core/app-state';
import { errorMessage, on } from '../../core/bridge';
import { useTick } from '../../core/connection';
import { toast } from '../../core/toasts';
import { FileViewer } from '../../components/FileViewer';
import { Button, Spinner, cx } from '../../components/ui';
import {
  castVote, choicesOf, closeVote, createVote, errorCode, fetchAgenda, fetchEvents, fetchMeeting, fetchPaper, fetchPolls, fetchResolutions, fetchVotes, K, lifecycle, liveResolution, needsStepUp,
  openVote, paperFilePath, present, roleOf, tallyView, titleCase, voteBlock, type Attendance, type Frame, type Vote,
} from './api';
import { Muted, Status } from './parts';

/** The `board.meeting.{id}` events (§9.3) that change the room; names are bare, a `board.` prefix is accepted too. */
export const ROOM_EVENTS = new Set(['attendance.changed', 'quorum.changed', 'present.item', 'vote.opened', 'vote.tally', 'vote.closed', 'item.started', 'item.ended', 'pack.revised', 'poll.opened', 'poll.closed', 'meeting.state']);

/** A frame of this meeting's channel, as the per-person gateway delivers it: `{type: "board.realtime", channel, event, seq, data}`. */
export function roomFrame(e: unknown, meetingId: number): Frame | null {
  const f = e as Partial<Frame> | null;
  if (!f || f.type !== 'board.realtime' || f.channel !== `board.meeting.${meetingId}` || typeof f.event !== 'string') return null;
  return ROOM_EVENTS.has(f.event.replace(/^board\./, '')) ? (f as Frame) : null;
}

/** The room's live records: the meeting's votes, resolutions and polls. */
export function useRoom(meetingId: number) {
  return useQuery({
    queryKey: K.room(meetingId),
    queryFn: async ({ signal }) => {
      const [votes, resolutions, polls] = await Promise.all([fetchVotes(meetingId, signal), fetchResolutions(meetingId, signal), fetchPolls(meetingId, signal)]);
      return { votes, resolutions, polls };
    },
  });
}

/**
 * Follows the room: frames on this person's socket, and `GET /meetings/{id}/events?after={seq}` every few seconds —
 * the replay after a reconnect and the feed where the gateway is off. A frame after the last seen `seq` refreshes it.
 */
export function useLiveMeeting(meetingId: number) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.meeting(meetingId), queryFn: ({ signal }) => fetchMeeting(meetingId, signal) });
  const seq = useRef<number | null>(null);
  useEffect(() => {
    seq.current = null;
    const refresh = () => { void qc.invalidateQueries({ queryKey: K.meeting(meetingId) }); void qc.invalidateQueries({ queryKey: K.room(meetingId) }); };
    const off = on('realtime:event', (e) => {
      const f = roomFrame(e, meetingId);
      if (!f) return;
      if (seq.current !== null && f.seq <= seq.current) return;
      if (f.seq) seq.current = f.seq;
      refresh();
    });
    let stop = false;
    const poll = async () => {
      try {
        const r = await fetchEvents(meetingId, seq.current ?? 0);
        // The first read only learns where the channel is; frames after it are news.
        if (seq.current !== null && r.items.some((f) => roomFrame(f, meetingId))) refresh();
        seq.current = Math.max(seq.current ?? 0, r.last_seq ?? 0);
      } catch {
        /* the next tick tries again */
      }
    };
    void poll();
    const t = setInterval(() => { if (!stop) void poll(); }, 4_000);
    return () => { stop = true; clearInterval(t); off(); };
  }, [qc, meetingId]);
  return q;
}

export function elapsed(since: string | null | undefined, now: number): string {
  if (!since) return '00:00:00';
  const s = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
}

const STATE: Record<string, string> = { PRESENT: 'In room', REMOTE: 'Remote', LEFT_EARLY: 'Left', ABSENT: 'Absent', EXCUSED: 'Apologies', DECLINED: 'Declined', ACCEPTED: 'Expected', INVITED: 'No reply' };
const here = (p: Attendance) => p.state === 'PRESENT' || p.state === 'REMOTE';

/** D-12 Live meeting room: present items, watch quorum, open and close votes (FR-ROOM, FR-ATT, FR-QRM, FR-VOT). */
export default function Room({ meetingId, onMinutes }: { meetingId: number; onMinutes: () => void }) {
  const qc = useQueryClient();
  const now = useTick(1000);
  const mq = useLiveMeeting(meetingId);
  const room = useRoom(meetingId);
  const agenda = useQuery({ queryKey: K.agenda(meetingId), queryFn: ({ signal }) => fetchAgenda(meetingId, signal) });
  const offline = useStore(app, (s) => s.status?.network === 'OFFLINE');
  const [side, setSide] = useState(false);
  const [casting, setCasting] = useState<number | null>(null);
  const m = mq.data;
  const refresh = () => { void qc.invalidateQueries({ queryKey: K.meeting(meetingId) }); void qc.invalidateQueries({ queryKey: K.room(meetingId) }); };
  const act = useMutation({ mutationFn: (f: () => Promise<unknown>) => f(), onSuccess: refresh, onError: (e) => toast('error', errorMessage(e)) });
  // Closing a tie where the chair has the casting vote answers 409 casting_vote_required (deviation 3).
  const close = useMutation({
    mutationFn: ({ id, choice }: { id: number; choice?: string }) => closeVote(id, choice),
    onSuccess: () => { setCasting(null); refresh(); },
    onError: (e, v) => { if (errorCode(e) === 'casting_vote_required') { setCasting(v.id); refresh(); } else toast('error', errorMessage(e)); },
  });
  const items = agenda.data ?? [];
  const curId = m?.presenting?.agenda_item_id ?? null;
  const cur = items.find((i) => i.id === curId) ?? null;
  const paperRef = cur?.papers?.[0] ?? null;
  const paper = useQuery({ queryKey: K.paper(paperRef?.id ?? 0), queryFn: ({ signal }) => fetchPaper(paperRef!.id, signal), enabled: !!paperRef });
  if (mq.isPending) return <Spinner />;
  if (!m) return <p className="m-6 text-[13px] text-ink-2">The meeting could not be loaded.</p>;
  const runs = m.can_run === true;
  const q = m.quorum ?? null;
  const res = liveResolution(room.data?.resolutions ?? [], curId);
  const vote: Vote | null = res ? [...(room.data?.votes ?? [])].filter((v) => v.resolution_id === res.id && v.status !== 'CANCELLED').sort((a, b) => b.id - a.id)[0] ?? null : null;
  const block = voteBlock(q, vote);
  const versions = [...(paper.data?.versions ?? [])].sort((a, b) => b.version - a.version);
  const curVersion = paper.data?.current_version ?? versions[0] ?? null;
  const previous = versions.find((v) => curVersion && v.version < curVersion.version) ?? null;
  const present_ = (m.participants ?? []).filter(here).length;
  const needsCasting = vote && (vote.status === 'CLOSING' || casting === vote.id);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2">
        <Status tone="danger">● LIVE {elapsed(m.started_at, now)}</Status>
        <div className="min-w-0 flex-1"><div className="truncate text-[14px] font-bold">{m.body} — {m.meeting_number ?? m.title}</div><Muted>{[m.location, m.online_url ? 'Online' : null, titleCase(m.my_role)].filter(Boolean).join(' · ')}</Muted></div>
        {q ? <Status tone={q.established ? 'success' : 'danger'}>{q.label ?? `${q.established ? '✓ Quorum' : '▲ No quorum'} · ${q.present_voting}/${q.eligible_voting} voting present (needs ${q.required})`}</Status> : null}
        {roleOf(m) === 'secretary' ? <Button size="sm" onClick={onMinutes}>Live minutes</Button> : null}
        {runs ? <><Button size="sm" onClick={() => act.mutate(() => lifecycle(meetingId, 'adjourn'))}>Adjourn</Button><Button size="sm" variant="danger" onClick={() => act.mutate(() => lifecycle(meetingId, 'complete'))}>End meeting</Button></> : null}
      </header>
      {offline ? <div role="alert" className="bg-warning/10 px-4 py-1.5 text-[12.5px] text-warning">Offline — votes in a live meeting are online only. Reconnect to vote.</div> : null}
      <div className="grid min-h-0 flex-1 grid-cols-[230px_1fr_300px]">
        <nav aria-label="Agenda" className="overflow-y-auto border-r border-line bg-surface p-2 scroll-thin">
          <div className="flex justify-between px-1.5 pb-1 text-[11px] font-bold text-ink-3 uppercase"><span>Agenda</span>{runs ? <span className="font-normal normal-case">click to present</span> : null}</div>
          <ol>
            {items.map((i) => (
              <li key={i.id}>
                <button type="button" disabled={!runs || i.withheld} aria-current={cur?.id === i.id ? 'true' : undefined} onClick={() => act.mutate(() => present(meetingId, i.id))} className={cx('flex w-full gap-2 rounded-[7px] px-2 py-1.5 text-left text-[12.5px]', cur?.id === i.id ? 'bg-[#EEF1FD] font-bold text-primary dark:bg-selection' : 'text-ink-2 enabled:hover:bg-subtle')}>
                  <span className="w-[26px] shrink-0 font-bold">{i.number}</span><span className="min-w-0 flex-1">{i.title}</span>{i.duration_minutes ? <span className="text-ink-3">{i.duration_minutes}m</span> : null}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <section className="flex min-h-0 flex-col bg-[#475069]">
          <div className="flex items-center gap-2 bg-surface px-3 py-1.5 text-[12.5px]">
            <Status tone="indigo">Presenting to {present_}</Status>
            <b className="min-w-0 flex-1 truncate">{cur ? `${cur.number} ${cur.title}` : 'Nothing presented yet'}</b>
            <span className="text-ink-3">Page {m.presenting?.page ?? 1}{curVersion?.pages ? ` / ${curVersion.pages}` : ''}</span>
            <Button size="sm" aria-pressed={side} disabled={!previous} onClick={() => setSide(!side)}>Side by side</Button>
          </div>
          <div className={cx('relative grid min-h-0 flex-1 gap-2 p-3', side && previous ? 'grid-cols-2' : 'grid-cols-1')}>
            {curVersion ? (
              <>
                <Paper path={paperFilePath(curVersion.id)} name={`${paperRef?.title ?? 'paper'}.pdf`} />
                {side && previous ? <Paper path={paperFilePath(previous.id)} name={`${paperRef?.title ?? 'paper'} (v${previous.version}).pdf`} /> : null}
              </>
            ) : <p className="m-auto text-[13px] text-white/80">{cur ? 'This item has no paper.' : 'The chair has not presented an item.'}</p>}
          </div>
        </section>
        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-l border-line bg-surface p-3 scroll-thin">
          {res ? (
            <section aria-label="Resolution">
              <div className="flex justify-between text-[13px] font-bold"><span>Resolution</span><Status tone="indigo">{res.resolution_number}</Status></div>
              <p className="mt-1.5 rounded-[8px] bg-subtle p-2 font-serif text-[12.5px]">{res.resolution_text}</p>
              <Muted>{[res.proposer ? `Proposed ${res.proposer}` : null, res.seconder ? `seconded ${res.seconder}` : null, titleCase(res.status)].filter(Boolean).join(' · ')}</Muted>
              {vote && vote.status !== 'CREATED' ? <Tally v={vote} /> : null}
              {runs ? (
                needsCasting ? (
                  <div className="mt-2" role="group" aria-label="Casting vote">
                    <Muted>The vote is tied. As chair you give the casting vote.</Muted>
                    <div className="mt-1 flex gap-1.5">{(vote!.method === 'APPROVE_REJECT_ABSTAIN' ? ['APPROVE', 'REJECT'] : ['FOR', 'AGAINST']).map((c) => <Button key={c} className="flex-1" disabled={offline || close.isPending} onClick={() => close.mutate({ id: vote!.id, choice: c })}>{titleCase(c)}</Button>)}</div>
                  </div>
                ) : vote?.status === 'OPEN' ? <Button className="mt-2 w-full" disabled={offline || close.isPending} onClick={() => close.mutate({ id: vote.id })}>Close vote &amp; record result</Button>
                  : vote?.status === 'RESULT_FINAL' ? <p className="mt-2 text-[12.5px] font-semibold">Result: {titleCase(vote.result?.outcome) || 'recorded'}{vote.result?.casting_vote_used ? ' (casting vote)' : ''}</p>
                  : <Button className="mt-2 w-full" variant="primary" disabled={!!block || offline} onClick={() => act.mutate(async () => { const v = vote ?? (await createVote(meetingId, res.id)); return openVote(v.id); })}>{block ?? 'Open vote'}</Button>
              ) : vote?.status === 'OPEN' ? <VoteCard v={vote} disabled={offline} onDone={refresh} />
                : vote?.status === 'RESULT_FINAL' ? <p className="mt-2 text-[12.5px] font-semibold">Result: {titleCase(vote.result?.outcome)}</p> : null}
            </section>
          ) : null}
          <section aria-label="Participants">
            <div className="text-[13px] font-bold">Participants</div>
            <ul className="mt-1 space-y-1.5">{(m.participants ?? []).map((p) => <ParticipantRow key={p.user_id} p={p} excluded={vote?.voters?.find((x) => x.user_id === p.user_id)?.conflict_excluded === true} item={cur?.number ?? null} />)}</ul>
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
      {/* The server's file carries the viewer's watermark; this one only reminds the screen. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center text-[28px] font-bold text-[#c00]/10 -rotate-[30deg]">CONFIDENTIAL</div>
    </div>
  );
}

function Tally({ v }: { v: Vote }) {
  const t = tallyView(v);
  const excluded = (v.voters ?? []).filter((x) => x.conflict_excluded);
  return (
    <div className="mt-2" aria-label="Tally">
      <div className="flex justify-between text-[12px]"><Status tone="indigo">{v.status === 'OPEN' ? 'Voting open' : v.status === 'CLOSING' ? 'Tied — casting vote' : 'Closed'}</Status><span>{t.cast} of {t.eligible} eligible voted</span></div>
      {t.counts ? (
        <div className="mt-1.5 grid grid-cols-3 gap-1.5 text-center">
          {(['for', 'against', 'abstain'] as const).map((k) => <div key={k} className="rounded-[8px] border border-line py-1.5"><div className={cx('text-[18px] font-bold', k === 'for' ? 'text-success' : k === 'against' ? 'text-danger' : '')}>{t.counts![k]}</div><div className="text-[11px] capitalize text-ink-3">{k}</div></div>)}
        </div>
      ) : <Muted>{v.secret ? 'Secret ballot: only the number of ballots cast is shown.' : 'The counts are shown when the vote closes.'}</Muted>}
      {excluded.length ? <Muted>{excluded.length} excluded: {excluded.map((x) => x.name).join(', ')}</Muted> : null}
    </div>
  );
}

/** The member's own ballot (VoteCard design): online only; the server asks for a step-up when the board's policy wants one. */
function VoteCard({ v, disabled, onDone }: { v: Vote; disabled: boolean; onDone: () => void }) {
  const [password, setPassword] = useState<string | null>(null);
  const cast = useMutation({
    mutationFn: (choice: string) => castVote(v.id, choice, password ? { current_password: password } : {}),
    onSuccess: () => { setPassword(null); onDone(); },
    onError: (e) => { if (needsStepUp(e) && password === null) setPassword(''); else toast('error', errorMessage(e)); },
  });
  if (v.me && v.me.eligible === false) return <Muted>{v.me.reason ?? 'You are not eligible to vote on this.'}</Muted>;
  const mine = v.me?.choice ?? null;
  return (
    <div className="mt-2 space-y-1.5" aria-label="Your vote">
      {password !== null ? <label className="block text-[12px]">Confirm it is you<input type="password" aria-label="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded border border-line bg-surface p-1.5" /></label> : null}
      {choicesOf(v).map((c) => (
        <Button key={c} className="w-full" variant={mine === c ? 'primary' : 'secondary'} disabled={disabled || cast.isPending || password === ''} aria-pressed={mine === c} onClick={() => cast.mutate(c)}>{titleCase(c)}</Button>
      ))}
      <Muted>{v.me?.has_voted ? `You have voted${mine ? ` ${titleCase(mine)}` : ''}. ` : ''}Your ballot is recorded when you choose.</Muted>
    </div>
  );
}

function ParticipantRow({ p, excluded, item }: { p: Attendance; excluded: boolean; item: string | null }) {
  const label = excluded ? `Conflict${item ? ` ${item}` : ''}` : (STATE[p.state] ?? titleCase(p.state));
  return (
    <li className="flex items-center justify-between text-[12.5px]">
      <span><span className={cx('mr-1.5 inline-block h-2 w-2 rounded-full', here(p) ? 'bg-success' : 'bg-line')} />{p.name}{p.meeting_role ? <span className="text-ink-3"> {titleCase(p.meeting_role)}</span> : null}</span>
      {excluded ? <Status tone="danger">{label}</Status> : <span className="text-ink-3">{label}</span>}
    </li>
  );
}
