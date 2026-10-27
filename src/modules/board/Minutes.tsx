import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Button, Modal, Spinner, cx } from '../../components/ui';
import {
  autosaveMinutes, closePoll, compareMinutes, fetchAgenda, fetchMeetingMinutes, fetchMinuteVersions, fmtTime, insertPoll, K, launchPoll, saveMinutesVersion, startMinutes, titleCase,
  type BlockType, type MinutesBlock, type MinuteVersion, type Poll,
} from './api';
import { Muted, Status } from './parts';
import { elapsed, useLiveMeeting, useRoom } from './Room';
import { useTick } from '../../core/connection';

/** What the secretary writes; record blocks (attendance, quorum, decisions, votes, polls, actions, conflicts) come from the records. */
const KINDS: Array<[BlockType, string]> = [['discussion', 'Discussion'], ['note', 'Note'], ['action_note', 'Action note'], ['deferred', 'Deferred'], ['heading', 'Heading']];
const AUTOSAVE_MS = 2_000;

/** A new block's id: unique enough within one set of minutes. */
const bid = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** D-13 Live minutes & poll (FR-LMN-01..04, FR-POL-01..03): minutes follow the presented item; autosave and versions. */
export default function Minutes({ meetingId, onRoom }: { meetingId: number; onRoom: () => void }) {
  const qc = useQueryClient();
  const now = useTick(1000);
  const mq = useLiveMeeting(meetingId);
  const room = useRoom(meetingId);
  const m = mq.data;
  const agenda = useQuery({ queryKey: K.agenda(meetingId), queryFn: ({ signal }) => fetchAgenda(meetingId, signal) });
  const mins = useQuery({ queryKey: K.minutes(meetingId), queryFn: ({ signal }) => fetchMeetingMinutes(meetingId, signal) });
  const minutesId = mins.data?.id ?? null;
  const versions = useQuery({ queryKey: K.minuteVersions(minutesId ?? 0), queryFn: ({ signal }) => fetchMinuteVersions(minutesId!, signal), enabled: !!minutesId });
  // What the secretary typed since the minutes were loaded; until then, the server's.
  const [edited, setBlocks] = useState<MinutesBlock[] | null>(null);
  const [saved, setSavedAt] = useState<string | null>(null);
  const rev = useRef(0);
  const blocks = edited ?? (mins.data ? (mins.data.blocks ?? []) : null);
  const label = mins.data?.current_version?.version ?? 'draft';
  const [follow, setFollow] = useState<number | null>(null);
  const dirty = useRef(false);
  // Minutes follow the item being presented, unless the secretary picked another.
  const itemId = follow ?? m?.presenting?.agenda_item_id ?? agenda.data?.[0]?.id ?? null;
  const item = agenda.data?.find((i) => i.id === itemId) ?? null;
  const editable = mins.data?.editable !== false;

  useEffect(() => {
    if (!dirty.current || !edited || !minutesId) return;
    const t = setTimeout(() => {
      dirty.current = false;
      rev.current += 1;
      autosaveMinutes(minutesId, edited, rev.current).then((r) => setSavedAt(r?.saved_at ?? new Date().toISOString())).catch((e) => toast('error', `Autosave failed: ${errorMessage(e)}`));
    }, (mins.data?.autosave_seconds ?? 0) * 1000 || AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [edited, minutesId, mins.data?.autosave_seconds]);

  const edit = (next: MinutesBlock[]) => { dirty.current = true; setBlocks(next); };
  const add = (type: BlockType) => edit([...(blocks ?? []), { id: bid(), type, text: '', agenda_item_id: itemId, source: 'human' }]);
  const reload = () => { setBlocks(null); void qc.invalidateQueries({ queryKey: K.minutes(meetingId) }); if (minutesId) void qc.invalidateQueries({ queryKey: K.minuteVersions(minutesId) }); };
  const saveVersion = useMutation({
    mutationFn: () => saveMinutesVersion(minutesId!, blocks ?? []),
    onSuccess: (r) => { reload(); toast('success', `Saved as ${r.version.version}.`); },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const start = useMutation({ mutationFn: () => startMinutes(meetingId), onSuccess: reload, onError: (e) => toast('error', errorMessage(e)) });

  if (mq.isPending || mins.isPending) return <Spinner />;
  if (!m) return null;
  if (!minutesId) {
    return (
      <div className="m-6 space-y-2 text-[13px] text-ink-2">
        <p>This meeting has no minutes yet.</p>
        {m.can_run ? <Button variant="primary" loading={start.isPending} onClick={() => start.mutate()}>Start the minutes</Button> : null}
      </div>
    );
  }
  const mine = (blocks ?? []).filter((b) => !b.agenda_item_id || b.agenda_item_id === itemId);
  const poll = [...(room.data?.polls ?? [])].sort((a, b) => b.id - a.id).find((p) => p.status === 'OPEN') ?? null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2">
        <Status tone="danger">● LIVE {elapsed(m.started_at, now)}</Status>
        <div className="flex-1"><div className="text-[14px] font-bold">{m.body} — {m.meeting_number ?? m.title}</div><Muted>You are {titleCase(m.my_role)} · minuting · {titleCase(mins.data?.status)}</Muted></div>
        {m.quorum ? <Status tone={m.quorum.established ? 'success' : 'danger'}>{m.quorum.established ? '✓' : '▲'} Quorum {m.quorum.present_voting}/{m.quorum.eligible_voting}</Status> : null}
        <Button size="sm" onClick={onRoom}>Room</Button>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[220px_1fr_300px]">
        <nav aria-label="Agenda" className="flex flex-col border-r border-line bg-surface p-2">
          <ol className="flex-1 overflow-y-auto">
            {(agenda.data ?? []).map((i) => (
              <li key={i.id}><button type="button" aria-current={i.id === itemId ? 'true' : undefined} onClick={() => setFollow(i.id === m.presenting?.agenda_item_id ? null : i.id)} className={cx('flex w-full gap-2 rounded-[7px] px-2 py-1.5 text-left text-[12.5px]', i.id === itemId ? 'bg-selection font-bold text-primary dark:bg-selection' : 'text-ink-2 hover:bg-subtle')}><b className="w-[24px]">{i.number}</b>{i.title}</button></li>
            ))}
          </ol>
          <Muted>Minutes follow the item the chair presents.</Muted>
        </nav>
        <section className="flex min-h-0 flex-col p-3" aria-label="Minutes">
          <div className="flex items-center gap-2 pb-2">
            <b className="flex-1 text-[14px]">{item ? `${item.number} ${item.title}` : 'Minutes'}</b>
            <span className="text-[11.5px] text-ink-3">{saved ? `Autosaved ${fmtTime(saved)} · ${label}` : label}</span>
            <Button size="sm" disabled={!editable} loading={saveVersion.isPending} onClick={() => saveVersion.mutate()}>Save version</Button>
          </div>
          <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto scroll-thin">
            {blocks === null ? <Spinner /> : null}
            {mine.map((b) => (
              <li key={b.id} className={cx('rounded-[8px] border border-line p-2.5', b.read_only ? 'bg-subtle' : 'bg-surface')}>
                <div className="flex justify-between text-[10.5px] font-bold tracking-[.5px] text-ink-3 uppercase"><span>{b.type === 'poll' ? 'Poll result · non-binding' : titleCase(b.type)}</span>{b.read_only ? <span>From the record</span> : b.source === 'ai' ? <span>AI suggestion</span> : null}</div>
                {b.read_only || !editable ? <p className="mt-1 whitespace-pre-wrap text-[13px]">{b.text}</p>
                  : <textarea aria-label={`${b.type} text`} value={b.text} onChange={(e) => edit((blocks ?? []).map((x) => (x.id === b.id ? { ...x, text: e.target.value } : x)))} className="mt-1 min-h-[48px] w-full resize-y bg-transparent text-[13px] outline-none" />}
              </li>
            ))}
          </ul>
          {editable ? <div className="flex flex-wrap gap-1.5 pt-2">{KINDS.map(([k, l]) => <Button key={k} size="sm" onClick={() => add(k)}>+ {l}</Button>)}</div> : null}
          <Muted>Decisions, votes, polls, actions and conflicts are taken from the records when a version is saved.</Muted>
        </section>
        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-l border-line bg-surface p-3 scroll-thin">
          <PollCard meetingId={meetingId} itemId={itemId} poll={poll} audience={(m.participants ?? []).filter((p) => p.state === 'PRESENT' || p.state === 'REMOTE').length} onInserted={reload} />
          <Versions minutesId={minutesId} versions={versions.data ?? []} />
        </aside>
      </div>
    </div>
  );
}

/** A non-binding poll (FR-POL): launch, live results (to those who run the meeting), close and insert into the minutes. */
function PollCard({ meetingId, itemId, poll, audience, onInserted }: { meetingId: number; itemId: number | null; poll: Poll | null; audience: number; onInserted: () => void }) {
  const qc = useQueryClient();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: K.room(meetingId) });
  const launch = useMutation({
    mutationFn: () => {
      const opts = options.split(/\n|·|;/).map((o) => o.trim()).filter(Boolean);
      if (!question.trim() || opts.length < 2) throw new Error('A poll needs a question and at least two options.');
      return launchPoll(meetingId, { question: question.trim(), options: opts, anonymous, agenda_item_id: itemId });
    },
    onSuccess: () => { setQuestion(''); setOptions(''); refresh(); },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const close = useMutation({
    mutationFn: async () => { await closePoll(poll!.id); return insertPoll(poll!.id); },
    onSuccess: () => { onInserted(); refresh(); },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const counts = poll?.results?.counts ?? {};
  const total = Math.max(1, ...Object.values(counts));
  return (
    <section aria-label="Poll">
      <div className="flex justify-between text-[13px] font-bold"><span>Poll</span><Status tone="indigo">Non-binding</Status></div>
      {poll ? (
        <>
          <p className="mt-1 text-[13px] font-semibold">{poll.question}</p>
          <ul className="mt-1.5 space-y-1.5">{poll.options.map((o) => <li key={o} className="grid grid-cols-[90px_1fr_20px] items-center gap-2 text-[12px]"><span className="truncate">{o}</span><span className="h-2 rounded-full bg-subtle"><span className="block h-2 rounded-full bg-primary" style={{ width: `${((counts[o] ?? 0) / total) * 100}%` }} /></span><b className="text-right">{counts[o] ?? 0}</b></li>)}</ul>
          <Muted>{Object.values(counts).reduce((a, b) => a + b, 0)} of {audience} responded</Muted>
          <Button className="mt-1.5 w-full" loading={close.isPending} onClick={() => close.mutate()}>Close poll &amp; insert into minutes</Button>
        </>
      ) : (
        <>
          <input aria-label="Poll question" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Question" className="mt-1.5 w-full rounded-[8px] border border-line bg-surface p-1.5 text-[12.5px]" />
          <textarea aria-label="Poll options" value={options} onChange={(e) => setOptions(e.target.value)} placeholder="One option per line" className="mt-1.5 h-[60px] w-full rounded-[8px] border border-line bg-surface p-1.5 text-[12.5px]" />
          <label className="mt-1 flex items-center gap-1.5 text-[12px]"><Checkbox checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} /> Anonymous</label>
          <Button className="mt-1.5 w-full" variant="primary" loading={launch.isPending} onClick={() => launch.mutate()}>Launch poll to {audience} members</Button>
        </>
      )}
      <Muted>Polls gauge opinion. Formal decisions still need a vote on a resolution.</Muted>
    </section>
  );
}

function Versions({ minutesId, versions }: { minutesId: number; versions: MinuteVersion[] }) {
  const [pick, setPick] = useState<number[]>([]);
  const [diff, setDiff] = useState<Array<{ op: 'same' | 'added' | 'removed'; text: string }> | null>(null);
  const toggle = (seq: number) => setPick((p) => (p.includes(seq) ? p.filter((x) => x !== seq) : [...p, seq].slice(-2)));
  const name = (seq: number) => versions.find((v) => v.seq === seq)?.version ?? `#${seq}`;
  const compare = useMutation({ mutationFn: () => compareMinutes(minutesId, Math.min(...pick), Math.max(...pick)), onSuccess: (r) => setDiff(r.diff.lines), onError: (e) => toast('error', errorMessage(e)) });
  return (
    <section aria-label="Minute versions">
      <div className="text-[13px] font-bold">Minute versions</div>
      <ul className="mt-1 space-y-1">{versions.map((v) => <li key={v.seq}><label className="flex items-center gap-2 text-[12px]"><Checkbox checked={pick.includes(v.seq)} onChange={() => toggle(v.seq)} /><b>{v.version}</b> · {v.author ?? ''}<span className="ml-auto text-ink-3">{fmtTime(v.created_at)}</span></label></li>)}</ul>
      <Button size="sm" className="mt-1.5" disabled={pick.length !== 2} onClick={() => compare.mutate()}>Compare</Button>
      <Muted>Every save is kept. Compare any two before review starts.</Muted>
      {diff ? (
        <Modal title={`${name(Math.min(...pick))} → ${name(Math.max(...pick))}`} onClose={() => setDiff(null)} width={640}>
          <div className="text-[13px] leading-6">{diff.map((d, i) => <div key={i} className={d.op === 'added' ? 'bg-success/20' : d.op === 'removed' ? 'bg-danger/20 line-through' : ''}>{d.text}</div>)}</div>
        </Modal>
      ) : null}
    </section>
  );
}
