import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { HostJob } from '@shared/label';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { ErrorNote, Modal, Spinner } from '../../components/ui';
import { cancelJob, fetchJobs, fetchReconciliation, hostStatus, K, reconcile, resolveJob, resumeServerJob, type ServerJob } from './api';
import type { ViewProps } from './LabelShell';
import { btn, btnPrimary, field, Progress, Section, StatePill } from './parts';

/**
 * D05 — Batch running and interrupted (FR-DSK-05, 06, FR-SEQ-09, WF-07). Two kinds of stop:
 *
 *  - on this computer: a job waiting for its printer keeps its count and goes on by itself when the printer is ready
 *    (a job paused on its account is resumed here); labels this computer may have sent when it stopped mid-chunk
 *    are uncertain until a person says what came out (`label:resolve`);
 *  - in WorkSuite: a sequence job that stopped with values sent but not confirmed is PARTIAL (C-08: never resumed by
 *    itself). The reconciliation sheet lists those values (`GET jobs/{id}/reconciliation`); the person marks the last
 *    good one, or each value printed / void / reprint, with a reason (`POST reconcile`), and the server re-queues
 *    what is left.
 */
export default function Batch({ job }: ViewProps & { job: string | null }) {
  const host = useQuery({ queryKey: K.host, queryFn: hostStatus, refetchInterval: 3_000 });
  const partial = useQuery({ queryKey: K.partial, queryFn: ({ signal }) => fetchJobs(signal, 'PARTIAL'), refetchInterval: 15_000 });
  const [local, setLocal] = useState<HostJob | null>(null);
  const [server, setServer] = useState<ServerJob | null>(null);
  if (host.isPending) return <Spinner />;
  const jobs = (host.data?.jobs ?? []).filter((j) => !job || j.id === job);
  const live = jobs.filter((j) => j.state !== 'done' && j.state !== 'cancelled' && j.state !== 'failed');
  const past = jobs.filter((j) => !live.includes(j));
  return (
    <div className="flex flex-col gap-3 p-4">
      <h1 className="m-0 text-[18px] font-extrabold text-ink">Running batches</h1>
      {live.length === 0 ? <p className="m-0 text-[12.5px] text-ink-3">Nothing is printing on this computer.</p> : null}
      {live.map((j) => (
        <JobCard key={j.id} j={j} onResolve={() => setLocal(j)} />
      ))}
      <Section title="Needs reconciling in WorkSuite">
        {partial.isPending ? <Spinner /> : partial.error ? <ErrorNote error={partial.error} /> : partial.data.length === 0 ? <p className="m-0 px-3.5 py-3 text-[12.5px] text-ink-3">No interrupted sequence jobs.</p> : (
          <ul className="m-0 list-none p-0">
            {partial.data.map((j) => (
              <li key={j.id} className="flex items-center gap-3 border-b border-line/70 px-3.5 py-2 text-[12.5px] last:border-0">
                <span className="min-w-0 flex-1 truncate font-semibold">{`${j.code}${j.error_message ? ` · ${j.error_message}` : ''}`}</span>
                <Progress done={j.labels_confirmed} total={j.labels_total} />
                <button type="button" className={btnPrimary} onClick={() => setServer(j)}>Reconcile…</button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {past.length ? (
        <Section title="Finished on this computer">
          <ul className="m-0 list-none p-0">
            {past.map((j) => (
              <li key={j.id} className="flex items-center gap-3 border-b border-line/70 px-3.5 py-2 text-[12.5px] last:border-0">
                <span className="min-w-0 flex-1 truncate">{`${j.ref ?? j.id}${j.error ? ` · ${j.error}` : ''}`}</span>
                <Progress done={j.confirmed} total={j.total} />
                <StatePill state={j.state} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {local ? <ResolveHere j={local} onClose={() => setLocal(null)} /> : null}
      {server ? <ReconcileSheet j={server} onClose={() => setServer(null)} /> : null}
    </div>
  );
}

function JobCard({ j, onResolve }: { j: HostJob; onResolve: () => void }) {
  const qc = useQueryClient();
  const cancel = useMutation({ mutationFn: () => cancelJob(j.id), onSuccess: () => void qc.invalidateQueries({ queryKey: K.host }), onError: (e) => toast('error', errorMessage(e)) });
  const resume = useMutation({ mutationFn: () => resumeServerJob(Number(j.id)), onSuccess: () => toast('success', 'Resumed. It goes on from the next label.'), onError: (e) => toast('error', errorMessage(e)) });
  const needs = j.state === 'interrupted' && !!j.uncertain;
  return (
    <Section
      title={`${j.ref ?? j.id}${j.template ? ` · ${j.template}` : ''}`}
      action={
        <div className="flex items-center gap-2">
          <StatePill state={j.state} />
          {needs ? <button type="button" className={btnPrimary} onClick={onResolve}>What came out…</button> : null}
          {j.state === 'paused' ? <button type="button" className={btn} disabled={resume.isPending} onClick={() => resume.mutate()}>Resume</button> : null}
          <button type="button" className={btn} disabled={cancel.isPending} onClick={() => cancel.mutate()}>Cancel job</button>
        </div>
      }
    >
      <div className="flex flex-col gap-2 p-3.5 text-[12.5px]">
        <Progress done={j.confirmed} total={j.total} />
        {j.error ? <p className="m-0 font-semibold text-[#B42318] dark:text-danger">{j.error}</p> : null}
        {j.uncertain ? <p className="m-0 text-ink-2">{`Labels ${j.uncertain.from + 1}–${j.uncertain.to} may or may not have printed. Look at the roll before deciding.`}</p> : null}
        {j.state === 'waiting_printer' ? <p className="m-0 text-ink-2">{`Kept at ${j.confirmed} of ${j.total}. It goes on from label ${j.confirmed + 1} by itself when the printer is ready.`}</p> : null}
        {j.state === 'paused' ? <p className="m-0 text-ink-2">{`Paused at ${j.confirmed} of ${j.total} with nothing uncertain. It is resumed here when the printer is ready, or now with Resume.`}</p> : null}
      </div>
    </Section>
  );
}

function ResolveHere({ j, onClose }: { j: HostJob; onClose: () => void }) {
  const qc = useQueryClient();
  const u = j.uncertain!;
  const [decision, setDecision] = useState<'printed' | 'reprint' | 'stop'>('reprint');
  const [last, setLast] = useState(u.to);
  const [reason, setReason] = useState('');
  const go = useMutation({
    mutationFn: () => resolveJob(j.id, decision, reason.trim(), decision === 'printed' ? last : undefined),
    onSuccess: () => (void qc.invalidateQueries({ queryKey: K.host }), toast('success', decision === 'stop' ? 'The job was cancelled.' : 'Recorded. The job goes on.'), onClose()),
    onError: (e) => toast('error', errorMessage(e)),
  });
  const opts = [
    { id: 'printed' as const, label: 'They printed', hint: 'Count them and go on from the next label.' },
    { id: 'reprint' as const, label: 'Print them again', hint: 'They did not come out, or came out spoiled.' },
    { id: 'stop' as const, label: 'Cancel the job', hint: 'Nothing more prints.' },
  ];
  return (
    <Modal
      title="What came out of the printer?"
      width={540}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={btn} onClick={onClose}>Not now</button>
          <button type="button" className={btnPrimary} disabled={reason.trim().length < 3 || go.isPending} onClick={() => go.mutate()}>Record and continue</button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-[12.5px] text-ink">
        <p className="m-0">{`${j.confirmed} of ${j.total} are confirmed. Labels ${u.from + 1}–${u.to} were being sent when this computer stopped.`}</p>
        <div role="radiogroup" aria-label="What happened" className="flex flex-col gap-1.5">
          {opts.map((d) => (
            <label key={d.id} className={`flex cursor-pointer items-start gap-2 rounded-[8px] border px-3 py-2 ${decision === d.id ? 'border-primary bg-selection' : 'border-line'}`}>
              <input type="radio" name="decision" checked={decision === d.id} onChange={() => setDecision(d.id)} className="mt-[3px]" />
              <span><span className="font-bold">{d.label}</span><br /><span className="text-ink-3">{d.hint}</span></span>
            </label>
          ))}
        </div>
        {decision === 'printed' && u.to - u.from > 1 ? (
          <label className="flex flex-col gap-1 font-semibold">
            How many of the job’s labels are out, in all
            <input type="number" className={field} min={u.from} max={u.to} value={last} onChange={(e) => setLast(Number(e.target.value))} />
          </label>
        ) : null}
        <label className="flex flex-col gap-1 font-semibold">
          Reason
          <input className={field} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Checked the roll after the restart" />
        </label>
      </div>
    </Modal>
  );
}

function ReconcileSheet({ j, onClose }: { j: ServerJob; onClose: () => void }) {
  const qc = useQueryClient();
  const r = useQuery({ queryKey: ['label', 'reconciliation', j.id], queryFn: () => fetchReconciliation(j.id) });
  const [lastGood, setLastGood] = useState('');
  const [each, setEach] = useState<Record<string, 'printed' | 'void' | 'reprint'>>({});
  const [reason, setReason] = useState('');
  const go = useMutation({
    mutationFn: () =>
      reconcile(j.id, {
        reason: reason.trim(),
        ...(lastGood ? { last_good_value: lastGood } : {}),
        decisions: Object.entries(each).map(([value, decision]) => ({ value, decision })),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: K.partial });
      toast('success', 'Reconciled. What is left is back in the queue.');
      onClose();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <Modal
      title={`Reconcile ${j.code}`}
      width={600}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={btn} onClick={onClose}>Not now</button>
          <button type="button" className={btnPrimary} disabled={reason.trim().length < 3 || go.isPending} onClick={() => go.mutate()}>Record decisions</button>
        </div>
      }
    >
      {r.isPending ? <Spinner /> : r.error ? <ErrorNote error={r.error} /> : (
        <div className="flex flex-col gap-3 text-[12.5px] text-ink">
          <p className="m-0">{`${r.data.printed} printed · ${r.data.reserved} still to print · ${r.data.void} void. Last confirmed: ${r.data.last_confirmed ?? 'none'}.`}</p>
          <label className="flex flex-col gap-1 font-semibold">
            The last value that came out readable (scan it, or leave empty and decide each)
            <input className={`${field} font-mono`} value={lastGood} onChange={(e) => setLastGood(e.target.value.trim())} placeholder={r.data.uncertain[0]?.value ?? ''} />
          </label>
          <ul className="m-0 max-h-[240px] list-none overflow-y-auto rounded-[8px] border border-line p-0 scroll-thin">
            {r.data.uncertain.map((u) => {
              const key = u.value ?? String(u.item_id);
              return (
                <li key={u.item_id} className="flex items-center gap-2 border-b border-line/70 px-3 py-1.5 last:border-0">
                  <span className="min-w-0 flex-1 font-mono">{u.value ?? `#${u.seq_no}`}</span>
                  <select className={`${field} h-[28px] w-[150px]`} aria-label={`Decision for ${key}`} value={each[key] ?? ''} onChange={(e) => setEach({ ...each, [key]: e.target.value as 'printed' })}>
                    <option value="">{lastGood ? 'By the last good value' : 'Void (default)'}</option>
                    <option value="printed">Printed</option>
                    <option value="reprint">Print again</option>
                    <option value="void">Void</option>
                  </select>
                </li>
              );
            })}
          </ul>
          <label className="flex flex-col gap-1 font-semibold">
            Reason (audited)
            <input className={field} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ribbon ran out at 237; 236 checked on the roll" />
          </label>
        </div>
      )}
    </Modal>
  );
}
