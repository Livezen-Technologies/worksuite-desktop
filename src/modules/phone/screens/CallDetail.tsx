import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTab, useTabTitle } from '../../../core/tab-context';
import { toast } from '../../../core/toasts';
import { Button, Chip, Spinner } from '../../../components/ui';
import { PK, phoneApi, useCall, useCallEvents, useCallIntelligence, type AnalysisKind, type CallDetail as Detail, type CallEvent } from '../api';
import { usePhoneAccess } from '../access';
import { placeCall } from '../dial';
import { clock, dispositionLabel, dispositionTone, money, parseStamp, prettyNumber, stamp } from '../lib/format';
import { Mono, PageBody, PageHeader, Panel, Refused, TEXTAREA } from '../parts';
import { ScreenPopCard } from './InCall';
import { Player } from './Player';
import { Checkbox } from '../../../components/Checkbox';

/**
 * W05 · Call detail (VOIP-HIS-03/04/07, VOIP-REC-02, VOIP-AI-01). The facts of the call, its recording with the notes
 * pinned at their seconds, the notes themselves, the call path (DID → IVR → queue → answer → hang-up), what it is
 * linked to in WorkSuite, and the call-intelligence panel — which says plainly when no engine is configured and never
 * invents a transcript.
 */
export default function CallDetail({ id }: { id: number }) {
  const { go } = useTab();
  const q = useCall(id);
  const d = q.data;
  const other = d ? (d.call.direction === 'outbound' ? d.call.to_number : d.call.from_number) : null;
  const who = d?.context.contact?.name ?? d?.context.account?.name ?? d?.context.lead?.name ?? prettyNumber(other);
  useTabTitle(d ? `${who} · Call` : 'Call');
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        back={
          <button type="button" onClick={() => go('/phone/calls')} className="text-[13px] font-semibold text-primary">
            Calls /
          </button>
        }
        title={d ? `${who} · ${stamp(d.call.started_at)}` : 'Call'}
        actions={
          d && other ? (
            <>
              <Button variant="success" icon="phone" onClick={() => void placeCall(other, { name: who, contactId: d.context.contact?.id ?? null })}>
                Call back
              </Button>
              <Button icon="link" onClick={() => void navigator.clipboard?.writeText(`worksuite://phone/calls/${id}`).then(() => toast('success', 'Link to this call copied.'), () => undefined)}>
                Copy link
              </Button>
            </>
          ) : null
        }
      />
      <PageBody>
        {q.isLoading ? <Spinner /> : q.error ? <Refused error={q.error} onRetry={() => void q.refetch()} /> : d ? <Body id={id} d={d} /> : null}
      </PageBody>
    </div>
  );
}

function Body({ id, d }: { id: number; d: Detail }) {
  const c = d.call;
  const [at, setAt] = useState(0);
  const pins = d.notes.filter((n) => n.at_second !== null).map((n) => ({ at: n.at_second!, label: n.body }));
  const mos = c.quality_mos === null || c.quality_mos === undefined || c.quality_mos === '' ? null : Number(c.quality_mos);
  const cost = c.cost === null || c.cost === '' || Number(c.cost) === 0 ? null : Number(c.cost);
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-4">
        <section className="grid grid-cols-2 gap-2 rounded-[12px] border border-line bg-surface p-4 sm:grid-cols-3 lg:grid-cols-6">
          <Fact label="Direction" value={c.direction.charAt(0).toUpperCase() + c.direction.slice(1)} />
          <Fact label="Outcome" value={<Chip tone={dispositionTone(c.disposition)}>{dispositionLabel(c.disposition)}</Chip>} />
          <Fact label="Ring / wait" value={<Mono>{clock(Number(c.ring_seconds))}</Mono>} />
          <Fact label="Talk" value={<Mono>{clock(Number(c.talk_seconds))}</Mono>} />
          <Fact label="Cost" value={cost === null ? <span className="text-ink-3">Not rated</span> : <Mono>{money(cost)}</Mono>} />
          <Fact label="Quality" value={mos === null ? <span className="text-ink-3">Not measured</span> : <Mono>MOS {mos.toFixed(1)}</Mono>} />
        </section>
        <Panel title="Call recording" sub={c.recording_id ? 'Stored in Drive › Telephony. Every play is logged.' : undefined}>
          {c.recording_id ? (
            <Player key={c.recording_id} recordingId={c.recording_id} duration={Number(c.talk_seconds) || 0} pins={pins} onTime={setAt} />
          ) : (
            <p className="text-[12.5px] text-ink-3">This call was not recorded, or its recording has not been imported from the phone system yet.</p>
          )}
        </Panel>
        <Notes id={id} d={d} at={c.recording_id ? at : null} />
      </div>
      <div className="flex flex-col gap-4">
        <CallPath id={id} d={d} />
        <ScreenPopCard line={{ remote: (c.direction === 'outbound' ? c.to_number : c.from_number) ?? '', context: d.context, remoteName: null }} />
        <Intelligence id={id} hasRecording={!!c.recording_id} />
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] font-semibold text-ink-3">{label}</span>
      <span className="truncate text-[14px] font-bold text-ink">{value}</span>
    </div>
  );
}

function Notes({ id, d, at }: { id: number; d: Detail; at: number | null }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [pin, setPin] = useState(true);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!body.trim()) return;
    setSaving(true);
    try {
      await phoneApi.addNote(id, body.trim(), pin && at !== null ? at : null);
      setBody('');
      void qc.invalidateQueries({ queryKey: PK.call(id) });
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Panel title="Notes" sub={d.notes.length ? `${d.notes.filter((n) => n.at_second !== null).length} pinned to the recording` : undefined} bodyClassName="flex flex-col gap-3">
      {d.notes.length ? (
        <ul className="flex flex-col gap-2">
          {d.notes.map((n) => (
            <li key={n.id} className="flex gap-3 text-[12.5px]">
              {n.at_second !== null ? <Mono className="h-fit shrink-0 rounded-[6px] bg-selection px-1.5 py-0.5 text-[11px] text-primary">{clock(n.at_second)}</Mono> : <span className="w-[42px] shrink-0" />}
              <span className="min-w-0 flex-1">
                <span className="block whitespace-pre-wrap text-ink">{n.body}</span>
                <span className="text-[11px] text-ink-3">
                  {n.author ?? 'Someone'} · {stamp(n.created_at)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-ink-3">No notes on this call yet.</p>
      )}
      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="Type a note…" aria-label="New note" className={TEXTAREA} />
        <div className="flex items-center justify-between gap-2">
          {at !== null ? (
            <label className="flex items-center gap-1.5 text-[12px] text-ink-2">
              <Checkbox checked={pin} onChange={(e) => setPin(e.target.checked)} />
              Pin at <Mono>{clock(at)}</Mono> of the recording
            </label>
          ) : (
            <span />
          )}
          <Button variant="primary" size="sm" loading={saving} disabled={!body.trim()} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </div>
    </Panel>
  );
}

/** The call path (VOIP-HIS-07): the switch's events when the server keeps them, else what the call record says. */
function CallPath({ id, d }: { id: number; d: Detail }) {
  const ev = useCallEvents(id);
  const events: CallEvent[] = ev.data?.offered ? ev.data.data : fromRecord(d);
  return (
    <Panel title="Call path" sub={ev.data && !ev.data.offered ? 'From the call record' : undefined}>
      {ev.isLoading ? (
        <Spinner />
      ) : events.length ? (
        <ol className="flex flex-col gap-2.5">
          {events.map((e, i) => (
            <li key={i} className="flex gap-2.5 text-[12.5px]">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${e.event === 'answer' ? 'bg-success' : e.event === 'queue' ? 'bg-warning' : e.event === 'hangup' ? 'bg-ink' : 'bg-primary'}`} />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-ink">{e.text}</span>
                {e.detail ? <span className="text-[11.5px] text-ink-3">{e.detail}</span> : null}
              </span>
              <Mono className="shrink-0 text-[11.5px] text-ink-3">{parseStamp(e.at)?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) ?? ''}</Mono>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[12px] text-ink-3">The phone system has not reported this call’s path.</p>
      )}
    </Panel>
  );
}

/** What the call record alone can say about the path — nothing more. */
export function fromRecord(d: Detail): CallEvent[] {
  const c = d.call;
  const out: CallEvent[] = [];
  if (c.started_at) out.push({ at: c.started_at, event: 'start', text: c.direction === 'inbound' ? `Call arrived from ${prettyNumber(c.from_number) || 'an unknown number'}` : c.direction === 'outbound' ? `Dialled ${prettyNumber(c.to_number)}` : 'Internal call', detail: c.direction === 'inbound' && c.to_number ? `To ${prettyNumber(c.to_number)}` : null });
  if (c.queue_id) out.push({ at: c.started_at ?? '', event: 'queue', text: 'Queued', detail: null });
  if (c.answered_at) out.push({ at: c.answered_at, event: 'answer', text: 'Answered', detail: null });
  if (c.ended_at) out.push({ at: c.ended_at, event: 'hangup', text: c.answered_at ? 'Hung up' : 'Ended unanswered', detail: c.hangup_cause });
  return out;
}

const KINDS: Array<{ kind: AnalysisKind; label: string }> = [
  { kind: 'summary', label: 'Summary' },
  { kind: 'transcript', label: 'Transcript' },
  { kind: 'sentiment', label: 'Sentiment' },
  { kind: 'action_items', label: 'Action items' },
];

/** Transcript & summary (VOIP-AI-01): "unavailable" with its reason until an engine or provider is approved. */
function Intelligence({ id, hasRecording }: { id: number; hasRecording: boolean }) {
  const qc = useQueryClient();
  const access = usePhoneAccess();
  const q = useCallIntelligence(id);
  const [busy, setBusy] = useState<AnalysisKind | null>(null);
  if (q.isLoading) return <Panel title="Transcript & summary"><Spinner /></Panel>;
  if (q.error) return <Panel title="Transcript & summary"><Refused error={q.error} /></Panel>;
  const st = q.data?.status;
  const jobs = q.data?.jobs ?? [];
  const ask = async (kind: AnalysisKind) => {
    setBusy(kind);
    try {
      const r = await phoneApi.analyse(id, kind);
      if (r.message) toast(r.ok ? 'info' : 'error', r.message);
      void qc.invalidateQueries({ queryKey: PK.intelligence(id) });
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Panel title="Transcript & summary" bodyClassName="flex flex-col gap-2 text-[12.5px]">
      {!st?.available ? (
        <>
          <p className="text-ink-2">{st?.reason ?? 'Not available on this installation.'}</p>
          {st?.missing?.length ? (
            <ul className="list-disc pl-4 text-ink-3">
              {st.missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          ) : null}
          <p className="text-[11.5px] text-ink-3">{access.manage ? 'You can choose a provider in Settings & sync › Recording. ' : 'An administrator can enable it in the Phone settings. '}WorkSuite never invents a summary.</p>
        </>
      ) : (
        <>
          {jobs.length ? (
            jobs.map((j) => (
              <div key={j.kind} className="rounded-[8px] border border-line p-2.5">
                <div className="mb-1 flex items-center justify-between">
                  <b className="capitalize">{j.kind.replace('_', ' ')}</b>
                  <Chip tone={j.state === 'done' ? 'success' : j.state === 'failed' ? 'danger' : 'muted'}>{j.state}</Chip>
                </div>
                {j.result ? <p className="whitespace-pre-wrap text-ink-2">{j.result}</p> : j.error ? <p className="text-danger">{j.error}</p> : null}
              </div>
            ))
          ) : (
            <p className="text-ink-3">Nothing has been asked for this call yet.</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {KINDS.map((k) => (
              <Button key={k.kind} size="sm" loading={busy === k.kind} disabled={!hasRecording || jobs.some((j) => j.kind === k.kind && (j.state === 'done' || j.state === 'running' || j.state === 'queued'))} onClick={() => void ask(k.kind)}>
                {k.label}
              </Button>
            ))}
          </div>
          {!hasRecording ? <p className="text-[11.5px] text-ink-3">Needs a recording of the call.</p> : null}
        </>
      )}
    </Panel>
  );
}
