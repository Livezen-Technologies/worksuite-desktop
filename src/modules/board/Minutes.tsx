import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Button, Modal, Spinner, cx } from '../../components/ui';
import { autosaveMinutes, compareMinutes, fetchAgenda, fetchMinutes, fmtTime, K, launchPoll, pollStep, saveMinutesVersion, type MinutesBlock, type Poll } from './api';
import { Muted, Status } from './parts';
import { elapsed, useLiveMeeting } from './Room';
import { useTick } from '../../core/connection';

const KINDS: Array<[MinutesBlock['kind'], string]> = [['discussion', 'Discussion'], ['decision', 'Decision'], ['action', 'Action'], ['conflict', 'Conflict note'], ['vote', 'Insert vote result']];
const AUTOSAVE_MS = 2_000;

/** A new block's id: unique enough within one set of minutes. */
const bid = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** D-13 Live minutes & poll (FR-LMN-01..04, FR-POL-01..03): minutes follow the presented item; autosave and versions. */
export default function Minutes({ meetingId, onRoom }: { meetingId: number; onRoom: () => void }) {
  const qc = useQueryClient();
  const now = useTick(1000);
  const mq = useLiveMeeting(meetingId);
  const m = mq.data;
  const minutesId = m?.minutes_id ?? null;
  const agenda = useQuery({ queryKey: K.agenda(meetingId), queryFn: ({ signal }) => fetchAgenda(meetingId, signal) });
  const mins = useQuery({ queryKey: K.minutes(minutesId ?? 0), queryFn: ({ signal }) => fetchMinutes(minutesId!, signal), enabled: !!minutesId });
  // What the secretary typed since the minutes were loaded; until then, the server's.
  const [edited, setBlocks] = useState<MinutesBlock[] | null>(null);
  const [ver, setVersion] = useState<number | null>(null);
  const [saved, setSavedAt] = useState<string | null>(null);
  const blocks = edited ?? (mins.data ? (mins.data.blocks ?? []) : null);
  const version = ver ?? mins.data?.version ?? 0;
  const savedAt = saved ?? mins.data?.saved_at ?? null;
  const [follow, setFollow] = useState<number | null>(null);
  const dirty = useRef(false);
  // Minutes follow the item being presented, unless the secretary picked another.
  const itemId = follow ?? m?.live?.item_id ?? agenda.data?.[0]?.id ?? null;
  const item = agenda.data?.find((i) => i.id === itemId) ?? null;

  useEffect(() => {
    if (!dirty.current || !edited || !minutesId) return;
    const t = setTimeout(() => {
      dirty.current = false;
      autosaveMinutes(minutesId, edited, version).then((r) => { setSavedAt(r?.saved_at ?? new Date().toISOString()); if (r?.version) setVersion(r.version); }).catch((e) => toast('error', `Autosave failed: ${errorMessage(e)}`));
    }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [edited, minutesId, version]);

  const edit = (next: MinutesBlock[]) => { dirty.current = true; setBlocks(next); };
  const add = (kind: MinutesBlock['kind'], text = '') => edit([...(blocks ?? []), { id: bid(), kind, text, item_id: itemId }]);
  const saveVersion = useMutation({
    mutationFn: () => saveMinutesVersion(minutesId!, blocks ?? []),
    onSuccess: (r) => { setVersion(r.version); void qc.invalidateQueries({ queryKey: K.minutes(minutesId!) }); toast('success', `Saved as v${r.version}.`); },
    onError: (e) => toast('error', errorMessage(e)),
  });

  if (mq.isPending) return <Spinner />;
  if (!m) return null;
  if (!minutesId) return <p className="m-6 text-[13px] text-ink-2">This meeting has no minutes yet.</p>;
  const mine = (blocks ?? []).filter((b) => !b.item_id || b.item_id === itemId);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2">
        <Status tone="danger">● LIVE {elapsed(m.started_at, now)}</Status>
        <div className="flex-1"><div className="text-[14px] font-bold">{m.body?.name} — {m.number ?? m.title}</div><Muted>You are Secretary · minuting</Muted></div>
        {m.quorum ? <Status tone={m.quorum.met ? 'success' : 'danger'}>{m.quorum.met ? '✓' : '▲'} Quorum {m.quorum.present}/{m.quorum.voting_total ?? '—'}</Status> : null}
        <Button size="sm" onClick={onRoom}>Room</Button>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[220px_1fr_300px]">
        <nav aria-label="Agenda" className="flex flex-col border-r border-line bg-surface p-2">
          <ol className="flex-1 overflow-y-auto">
            {(agenda.data ?? []).map((i) => (
              <li key={i.id}><button type="button" aria-current={i.id === itemId ? 'true' : undefined} onClick={() => setFollow(i.id === m.live?.item_id ? null : i.id)} className={cx('flex w-full gap-2 rounded-[7px] px-2 py-1.5 text-left text-[12.5px]', i.id === itemId ? 'bg-[#EEF1FD] font-bold text-primary dark:bg-selection' : 'text-ink-2 hover:bg-subtle')}><b className="w-[24px]">{i.number}</b>{i.title}</button></li>
            ))}
          </ol>
          <Muted>Minutes follow the item the chair presents.</Muted>
        </nav>
        <section className="flex min-h-0 flex-col p-3" aria-label="Minutes">
          <div className="flex items-center gap-2 pb-2">
            <b className="flex-1 text-[14px]">{item ? `${item.number} ${item.title}` : 'Minutes'}</b>
            <span className="text-[11.5px] text-ink-3">{savedAt ? `Autosaved ${fmtTime(savedAt)} · v${version}` : `v${version}`}</span>
            <Button size="sm" loading={saveVersion.isPending} onClick={() => saveVersion.mutate()}>Save version</Button>
          </div>
          <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto scroll-thin">
            {blocks === null ? <Spinner /> : null}
            {mine.map((b) => (
              <li key={b.id} className={cx('rounded-[8px] border border-line p-2.5', b.kind === 'poll' ? 'bg-subtle' : 'bg-surface')}>
                <div className="flex justify-between text-[10.5px] font-bold tracking-[.5px] text-ink-3 uppercase"><span>{b.kind === 'poll' ? 'Poll result · non-binding' : b.kind}</span>{b.kind === 'action' ? <span>→ Tasks on save</span> : null}</div>
                <textarea aria-label={`${b.kind} text`} value={b.text} onChange={(e) => edit((blocks ?? []).map((x) => (x.id === b.id ? { ...x, text: e.target.value } : x)))} className="mt-1 min-h-[48px] w-full resize-y bg-transparent text-[13px] outline-none" />
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-1.5 pt-2">
            {KINDS.map(([k, l]) => <Button key={k} size="sm" onClick={() => add(k === 'vote' ? 'vote' : k, k === 'vote' && m.live?.vote?.result ? `${m.live.resolution?.number ?? 'Vote'}: ${m.live.vote.result}` : '')}>+ {l}</Button>)}
          </div>
        </section>
        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-l border-line bg-surface p-3 scroll-thin">
          <PollCard meetingId={meetingId} poll={m.live?.poll ?? null} audience={(m.participants ?? []).filter((p) => p.presence === 'in_room' || p.presence === 'remote').length} onInserted={(text) => add('poll', text)} />
          <Versions minutesId={minutesId} versions={mins.data?.versions ?? []} />
        </aside>
      </div>
    </div>
  );
}

/** A non-binding poll (FR-POL): launch, live results, close and insert into the minutes. */
function PollCard({ meetingId, poll, audience, onInserted }: { meetingId: number; poll: Poll | null; audience: number; onInserted: (text: string) => void }) {
  const qc = useQueryClient();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: K.meeting(meetingId) });
  const launch = useMutation({
    mutationFn: () => {
      const opts = options.split(/\n|·|;/).map((o) => o.trim()).filter(Boolean);
      if (!question.trim() || opts.length < 2) throw new Error('A poll needs a question and at least two options.');
      return launchPoll(meetingId, { question: question.trim(), options: opts, anonymous });
    },
    onSuccess: refresh,
    onError: (e) => toast('error', errorMessage(e)),
  });
  const close = useMutation({
    mutationFn: async () => { await pollStep(poll!.id, 'close'); return pollStep(poll!.id, 'insert-minutes'); },
    onSuccess: (p) => { onInserted(`${poll!.question} — ${(p?.options ?? poll!.options).map((o) => `${o.label} ${o.count ?? 0}`).join(', ')}`); refresh(); },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const total = Math.max(1, ...(poll?.options.map((o) => o.count ?? 0) ?? [1]));
  return (
    <section aria-label="Poll">
      <div className="flex justify-between text-[13px] font-bold"><span>Poll</span><Status tone="indigo">Non-binding</Status></div>
      {poll && poll.status === 'open' ? (
        <>
          <p className="mt-1 text-[13px] font-semibold">{poll.question}</p>
          <ul className="mt-1.5 space-y-1.5">{poll.options.map((o) => <li key={o.id} className="grid grid-cols-[90px_1fr_20px] items-center gap-2 text-[12px]"><span className="truncate">{o.label}</span><span className="h-2 rounded-full bg-subtle"><span className="block h-2 rounded-full bg-primary" style={{ width: `${((o.count ?? 0) / total) * 100}%` }} /></span><b className="text-right">{o.count ?? 0}</b></li>)}</ul>
          <Muted>{poll.responded ?? 0} of {poll.audience ?? audience} responded</Muted>
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

function Versions({ minutesId, versions }: { minutesId: number; versions: Array<{ version: number; by: string; at: string }> }) {
  const [pick, setPick] = useState<number[]>([]);
  const [diff, setDiff] = useState<Array<{ op: 'same' | 'add' | 'del'; text: string }> | null>(null);
  const toggle = (v: number) => setPick((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v].slice(-2)));
  const compare = useMutation({ mutationFn: () => compareMinutes(minutesId, Math.min(...pick), Math.max(...pick)), onSuccess: (r) => setDiff(r.diff), onError: (e) => toast('error', errorMessage(e)) });
  return (
    <section aria-label="Minute versions">
      <div className="text-[13px] font-bold">Minute versions</div>
      <ul className="mt-1 space-y-1">{versions.map((v) => <li key={v.version}><label className="flex items-center gap-2 text-[12px]"><Checkbox checked={pick.includes(v.version)} onChange={() => toggle(v.version)} /><b>v{v.version}</b> · {v.by}<span className="ml-auto text-ink-3">{fmtTime(v.at)}</span></label></li>)}</ul>
      <Button size="sm" className="mt-1.5" disabled={pick.length !== 2} onClick={() => compare.mutate()}>Compare</Button>
      <Muted>Every save is kept. Compare any two before review starts.</Muted>
      {diff ? (
        <Modal title={`v${Math.min(...pick)} → v${Math.max(...pick)}`} onClose={() => setDiff(null)} width={640}>
          <div className="text-[13px] leading-6">{diff.map((d, i) => <span key={i} className={d.op === 'add' ? 'bg-success/20' : d.op === 'del' ? 'bg-danger/20 line-through' : ''}>{d.text} </span>)}</div>
        </Modal>
      ) : null}
    </section>
  );
}
