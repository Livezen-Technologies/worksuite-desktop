import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { ChequePrintOutcome } from '@shared/cheque';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { refusal } from '../finance/api';
import { confirmPrint, fetchBatch, has, interruptBatch, K, pauseBatch, printQueued, reconcileBatch, resumeBatch, startBatch, type Access, type Batch, type BatchItem, type LeafFound, type PrintResult } from './api';
import { BATCH_STATUS } from './Batches';
import { Badge, Check, Note, PageHead, Panel, Tile, amt, btn, btnDanger, btnPrimary, num, td, th } from './parts';

/**
 * D05 — Batch print run and D06 — Batch interrupted: reconcile leaves (CHQ-BAT-02..05, BR-19, WF-14; the server's
 * `Batches`). Starting the batch has the server queue one job at a time, lowest cheque number first. Each is
 * claimed, verified and printed by the main process (`cheque:printQueued`) only when it is the next leaf in the
 * stack; then the person says how it came out — Printed OK, and the server queues the next one; anything else
 * stops the run. Pause after this cheque and Stop are there throughout.
 *
 * A print that fails, a stop, or a leaf that did not print correctly interrupts the batch (`RECONCILE_REQUIRED`).
 * The software never assumes the printer stopped where it thinks (CHQ-BAT-05): it resumes only after the person
 * has said, for every leaf the server lists as unsettled, whether it printed OK, was spoiled or is still blank.
 */
type Local = Record<number, 'sending' | 'spooled' | 'unknown' | 'confirmed'>;
type Answer = { result: PrintResult } | { stop: true };

const SAYS: Record<string, { label: string; tone: 'ok' | 'bad' | 'muted' | 'info' }> = {
  confirmed: { label: 'Confirmed', tone: 'ok' },
  spooled: { label: 'Sent', tone: 'info' },
  sending: { label: 'Sending', tone: 'info' },
  unknown: { label: 'Unknown', tone: 'bad' },
  queued: { label: 'Not sent', tone: 'muted' },
  waiting: { label: 'Not sent', tone: 'muted' },
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const open = (s: string) => s === 'waiting' || s === 'queued';

export default function BatchRun({ id, access, onBack }: { id: number; access: Access | undefined; onBack: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.batch(id), queryFn: ({ signal }) => fetchBatch(id, signal) });
  const [local, setLocal] = useState<Local>({});
  const [running, setRunning] = useState(false);
  const [asked, setAsked] = useState<'pause' | 'stop' | null>(null);
  const [check, setCheck] = useState<BatchItem | null>(null);
  const pauseAsked = useRef(false);
  const stopAsked = useRef(false);
  const answer = useRef<((a: Answer) => void) | null>(null);
  const canPrint = has(access, 'cheque.print');

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const b = q.data;
  const stateOf = (i: BatchItem): string => local[i.cheque_id] ?? i.state;
  const printed = b.items.filter((i) => stateOf(i) === 'confirmed');
  const waiting = b.items.filter((i) => open(stateOf(i)));
  const sending = b.items.find((i) => stateOf(i) === 'sending' || stateOf(i) === 'spooled');
  const range = (xs: BatchItem[]) => (xs.length === 0 ? '—' : xs.length === 1 ? xs[0]!.cheque_number : `${xs[0]!.cheque_number} – ${xs[xs.length - 1]!.cheque_number}`);
  const needsReconcile = !running && b.status === 'RECONCILE_REQUIRED';

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: K.batch(id) });
    void qc.invalidateQueries({ queryKey: K.home });
    void qc.invalidateQueries({ queryKey: K.batches });
  };

  const run = async (from: Batch) => {
    if (!from.profile_id) return toast('error', 'Choose this batch’s printer profile on the web first.');
    const profile = from.profile_id;
    pauseAsked.current = false;
    stopAsked.current = false;
    setAsked(null);
    setRunning(true);
    try {
      if (from.status === 'PAUSED') await resumeBatch(id);
      else if (from.status !== 'PRINTING') await startBatch(id, profile);
      // Lowest number first, as the server queues them and as the leaves lie in the tray.
      const order = from.items.filter((i) => open(i.state)).sort((x, y) => x.cheque_number.localeCompare(y.cheque_number, undefined, { numeric: true }));
      for (const item of order) {
        if (pauseAsked.current || stopAsked.current) break;
        setLocal((l) => ({ ...l, [item.cheque_id]: 'sending' }));
        let r: ChequePrintOutcome | null = null;
        for (let tries = 0; tries < 4; tries += 1) {
          r = await printQueued({ cheque_ids: [item.cheque_id], profile_id: profile }).catch((e: unknown): ChequePrintOutcome => ({ ok: false, job_id: null, cheque_id: item.cheque_id, spooled: false, message: refusal(e) }));
          if (!r.none_waiting) break;
          await wait(1000);
        }
        if (!r?.spooled || !r.job_id) {
          setLocal((l) => ({ ...l, [item.cheque_id]: 'unknown' }));
          // A failure the station reported interrupts the batch on the server already; this covers the rest.
          await interruptBatch(id, `${item.cheque_number}: ${r?.message ?? 'not printed'}`).catch(() => undefined);
          toast('error', `Batch interrupted at ${item.cheque_number}: ${r?.message ?? 'not printed'}`);
          return;
        }
        setLocal((l) => ({ ...l, [item.cheque_id]: 'spooled' }));
        // The person checks the leaf: nothing moves on until they answer.
        setCheck(item);
        const a = await new Promise<Answer>((resolve) => (answer.current = resolve));
        setCheck(null);
        answer.current = null;
        if ('stop' in a) {
          await interruptBatch(id, `Stopped at ${item.cheque_number} before it was confirmed`).catch(() => undefined);
          return;
        }
        await confirmPrint(r.job_id, a.result);
        if (a.result !== 'printed') return; // the server interrupts the batch; the reconciliation follows
        setLocal((l) => ({ ...l, [item.cheque_id]: 'confirmed' }));
      }
      if (stopAsked.current) await interruptBatch(id, 'Stopped by the person at the printer').catch(() => undefined);
      else if (pauseAsked.current) await pauseBatch(id).catch(() => undefined);
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setRunning(false);
      setCheck(null);
      setLocal({});
      await refresh();
    }
  };

  const status = BATCH_STATUS[b.status];
  const idx = sending ? b.items.indexOf(sending) + 1 : 0;
  return (
    <div className="flex flex-col gap-3">
      <PageHead
        title={needsReconcile ? 'Batch interrupted — check the physical leaves' : `${b.reference}${running ? ' · printing' : ''}`}
        sub={needsReconcile && b.message ? b.message : `${b.items.length} cheques · leaves ${range(b.items)}`}
      >
        <button type="button" className={btn} onClick={onBack}>All batches</button>
        {running ? (
          <>
            <button type="button" className={btn} disabled={asked !== null} onClick={() => ((pauseAsked.current = true), setAsked('pause'))}>Pause after this cheque</button>
            <button
              type="button"
              className={btnDanger}
              disabled={asked === 'stop'}
              onClick={() => {
                stopAsked.current = true;
                setAsked('stop');
                answer.current?.({ stop: true });
              }}
            >
              Stop
            </button>
          </>
        ) : needsReconcile ? (
          <Badge tone="bad">{status?.label ?? 'Reconcile required'}</Badge>
        ) : ['APPROVED', 'PAUSED', 'PRINTING', 'DRAFT'].includes(b.status) && waiting.length > 0 ? (
          <button type="button" className={btnPrimary} disabled={!canPrint} onClick={() => void run(b)}>{b.status === 'APPROVED' || b.status === 'DRAFT' ? 'Start printing' : `Resume from ${waiting[0]!.cheque_number}`}</button>
        ) : (
          <Badge tone={status?.tone ?? 'muted'}>{status?.label ?? b.status}</Badge>
        )}
      </PageHead>

      {needsReconcile ? (
        <Reconcile
          batch={b}
          canPrint={canPrint}
          onSaved={async (resume) => {
            await refresh();
            if (!resume) return;
            const next = await qc.fetchQuery({ queryKey: K.batch(id), queryFn: ({ signal }) => fetchBatch(id, signal) });
            if (next.status === 'PAUSED' && next.items.some((i) => open(i.state))) void run(next);
          }}
        />
      ) : (
        <>
          <Panel>
            <div className="flex flex-col gap-3.5">
              <div className="flex items-center justify-between text-[13px]">
                <b>{sending ? `Printing cheque ${idx} of ${b.items.length}` : `${printed.length} of ${b.items.length} printed`}</b>
                {sending ? <span className={num}>{`${sending.cheque_number} · ${sending.payee_name} · ${amt(sending.amount, sending.currency)}`}</span> : null}
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-label="Leaves printed" aria-valuemin={0} aria-valuemax={b.items.length} aria-valuenow={printed.length}>
                <i className="block h-full bg-[#23349E]" style={{ width: `${(printed.length / Math.max(1, b.items.length)) * 100}%` }} />
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                <Tile tone="green" label="Printed" value={printed.length} sub={range(printed)} />
                <Tile tone="violet" label="Sending" value={sending ? 1 : 0} sub={sending?.cheque_number ?? '—'} />
                <Tile tone="slate" label="Waiting" value={waiting.length} sub={range(waiting)} />
              </div>
              {check ? (
                <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-primary bg-[#EEF1FD] p-3 dark:bg-selection" role="group" aria-label={`How did ${check.cheque_number} print?`}>
                  <span className="min-w-0 flex-1 text-[13px]">
                    <b>{`Check leaf ${check.cheque_number}`}</b>
                    <span className="block text-[12px] text-ink-2">Date, payee, words, figures and crossing inside their boxes, nothing on the MICR line.</span>
                  </span>
                  <button type="button" className={btn} onClick={() => answer.current?.({ result: 'failed_unused' })}>Still blank</button>
                  <button type="button" className={btn} onClick={() => answer.current?.({ result: 'spoiled' })}>Spoiled</button>
                  <button type="button" className={btnPrimary} onClick={() => answer.current?.({ result: 'printed' })}>Printed OK</button>
                </div>
              ) : null}
            </div>
          </Panel>
          <div className="grid grid-cols-2 gap-2.5">
            <Panel title="Before each cheque">
              <Check tone="ok">WorkSuite checks the approval and the cheque’s hash when it queues the job</Check>
              <Check tone="ok">Only the next leaf in the stack is printed; a job for any other leaf is left alone</Check>
              <Check tone="ok">Each job’s signature, computer and expiry are checked here before it prints</Check>
            </Panel>
            <Panel title="Stack in the tray">
              <div className="flex flex-col gap-2">
                <Note>{`Leaves loaded face up in number order, ${waiting[0]?.cheque_number ?? sending?.cheque_number ?? 'the first'} on top.`}</Note>
                <Note tone="warn">If anything jams, stop. You will confirm each leaf before printing continues.</Note>
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function Reconcile({ batch, canPrint, onSaved }: { batch: Batch; canPrint: boolean; onSaved: (resume: boolean) => Promise<void> }) {
  const byNumber = new Map(batch.items.map((i) => [i.cheque_number, i]));
  const rows = batch.unsettled.map((u) => ({ ...u, item: byNumber.get(u.cheque_number) }));
  const last = batch.items.filter((i) => i.state === 'confirmed').slice(-1);
  // A job never sent starts as blank; anything that went to the printer must be looked at.
  const [found, setFound] = useState<Record<number, LeafFound>>(() => Object.fromEntries(rows.filter((r) => r.job_status === 'QUEUED').map((r) => [r.leaf_id, 'blank' as LeafFound])));
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  const complete = rows.every((r) => found[r.leaf_id]);
  const firstBlank = rows.find((r) => found[r.leaf_id] === 'blank');
  const more = batch.items.some((i) => open(i.state));
  const save = async (resume: boolean) => {
    setSaving(true);
    try {
      await reconcileBatch(batch.id, rows.map((r) => ({ leaf_id: r.leaf_id, outcome: found[r.leaf_id]! })), note.trim() || undefined);
      toast('success', resume ? 'Saved. Printing carries on from the next blank leaf.' : 'Saved.');
      await onSaved(resume);
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setSaving(false);
    }
  };
  const says = (s: string) => (s === 'QUEUED' ? SAYS.queued! : s === 'SPOOLED' || s === 'AWAITING_CONFIRMATION' ? SAYS.spooled! : SAYS.unknown!);

  return (
    <>
      <Note tone="err">{`Do not resume yet. Open the printer and the tray, then say what happened to each leaf${rows[0] ? ` from ${rows[0].cheque_number} onwards` : ''}. Printing continues only after every leaf below is accounted for.`}</Note>
      <section className="overflow-hidden rounded-[10px] border border-line bg-surface">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>Leaf</th>
              <th className={th}>Cheque</th>
              <th className={`${th} text-right`}>Amount</th>
              <th className={th}>Software says</th>
              <th className={th}>What you found</th>
            </tr>
          </thead>
          <tbody>
            {last.map((i) => (
              <tr key={`c${i.cheque_id}`}>
                <td className={`${td} ${num}`}>{i.cheque_number}</td>
                <td className={td}>{i.payee_name}</td>
                <td className={`${td} ${num} text-right`}>{amt(i.amount, i.currency)}</td>
                <td className={td}><Badge tone="ok">Confirmed</Badge></td>
                <td className={`${td} text-ink-2`}>Printed — confirmed</td>
              </tr>
            ))}
            {rows.map((r) => {
              const s = says(r.job_status);
              return (
                <tr key={r.leaf_id} className={s === SAYS.unknown ? 'bg-[#FEF2F2] dark:bg-danger/10' : ''}>
                  <td className={`${td} ${num}`}>{r.cheque_number}</td>
                  <td className={td}>{r.item?.payee_name ?? ''}</td>
                  <td className={`${td} ${num} text-right`}>{r.item ? amt(r.item.amount, r.item.currency) : ''}</td>
                  <td className={td}><Badge tone={s.tone}>{s.label}</Badge></td>
                  <td className={td}>
                    <div role="radiogroup" aria-label={`What you found for ${r.cheque_number}`} className="inline-flex overflow-hidden rounded-[7px] border border-line">
                      {(['printed', 'spoiled', 'blank'] as const).map((k) => (
                        <button key={k} type="button" role="radio" aria-checked={found[r.leaf_id] === k} onClick={() => setFound((f) => ({ ...f, [r.leaf_id]: k }))} className={cx('px-2.5 py-1 text-[12px] font-semibold', found[r.leaf_id] === k ? 'bg-primary text-white' : 'bg-surface text-ink-2 hover:bg-subtle')}>
                          {k === 'printed' ? 'Printed OK' : k === 'spoiled' ? 'Spoiled' : 'Blank'}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? <tr><td className={td} colSpan={5}>Every leaf sent so far has an answer. Save to clear the interruption.</td></tr> : null}
          </tbody>
        </table>
      </section>
      <div className="grid grid-cols-2 gap-2.5">
        <Panel title="Result if you continue">
          {!complete ? <div className="text-[12.5px] text-ink-2">Say what you found for every leaf.</div> : null}
          {complete
            ? rows.map((r) =>
                found[r.leaf_id] === 'spoiled' ? (
                  <Check key={r.leaf_id} tone="bad">{`${r.cheque_number} becomes VOID; ${r.item?.payee_name || 'its cheque'} moves to the next leaf, and WorkSuite says whether it needs approving again`}</Check>
                ) : found[r.leaf_id] === 'printed' ? (
                  <Check key={r.leaf_id} tone="ok">{`${r.cheque_number} is PRINTED`}</Check>
                ) : (
                  <Check key={r.leaf_id} tone="warn">{`${r.cheque_number} stays reserved for its cheque`}</Check>
                ),
              )
            : null}
        </Panel>
        <Panel title="Confirm">
          <label className="mb-2 block text-[12px] text-ink-2">
            What happened (kept with the batch's audit)
            <textarea aria-label="Reconciliation note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full resize-none rounded-[7px] border border-line bg-surface px-2 py-1.5 text-[12.5px] text-ink outline-none focus:border-primary" placeholder="Paper jam after 001207; leaf 001208 torn" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn} disabled={!canPrint || !complete || saving} onClick={() => void save(false)}>Save and stay paused</button>
            {more || firstBlank ? (
              <button type="button" className={btnPrimary} disabled={!canPrint || !complete || saving} onClick={() => void save(true)}>{firstBlank ? `Save and resume from ${firstBlank.cheque_number}` : 'Save and resume'}</button>
            ) : null}
          </div>
        </Panel>
      </div>
    </>
  );
}
