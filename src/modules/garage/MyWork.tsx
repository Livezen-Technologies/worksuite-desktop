import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Select } from '../../components/Select';
import { Button, Empty, ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { PageHead } from '../hr/parts';
import { elapsed, errorText, gGet, gPost, K, newKey, PAUSE_LABEL, nice, span, timer, when, WORK_GROUPS, type MyWork as Data, type MyWorkItem, type PartHit } from './api';
import { Field, input, PriorityPill, useGarage, useTick, WorkPill } from './parts';

/**
 * The technician's own screen (FR-TEC-01, WF-12): what is theirs, in the
 * order it should be done, with big buttons for a workshop terminal — start,
 * pause with a reason, complete, ask for a part, and say when they found more
 * work. Start and pause keep working without WorkSuite (NFR-05): they are
 * kept with the moment they were pressed and sent when it answers.
 */
export default function MyWork() {
  const g = useGarage();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.mywork, queryFn: ({ signal }) => gGet<Data>('/my-work', undefined, signal), refetchInterval: 60_000 });
  const [pausing, setPausing] = useState<MyWorkItem | null>(null);
  const [completing, setCompleting] = useState<MyWorkItem | null>(null);
  const [asking, setAsking] = useState<MyWorkItem | null>(null);
  const [raising, setRaising] = useState<MyWorkItem | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  /* Starts kept offline, so the card reads as running until WorkSuite has them. */
  const [kept, setKept] = useState<Record<number, string>>({});
  const now = useTick();

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <div className="p-6"><ErrorNote error={q.error ?? new Error('Your work could not be loaded.')} onRetry={() => void q.refetch()} /></div>;
  const d = q.data;
  const reload = () => {
    void qc.invalidateQueries({ queryKey: K.mywork });
    void qc.invalidateQueries({ queryKey: ['garage', 'board'] });
  };

  if (!d.technician) {
    return (
      <div className="p-6">
        <Empty icon="wrench" title="You are not on the technician roster" hint="A workshop manager adds you under Workshop → Technicians, on the web." />
      </div>
    );
  }

  const start = async (w: MyWorkItem) => {
    setBusy(w.id);
    try {
      const r = await timer(w.id, 'start', { technician_id: w.my_technician_id }, `Start ${w.code} on ${w.job_number}`);
      if (r.queued) {
        setKept((k) => ({ ...k, [w.id]: new Date().toISOString() }));
        toast('info', r.message);
      } else {
        toast('success', r.message);
        reload();
      }
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const running = d.running ? d.work.find((w) => w.id === d.running!.work_order_id) : null;
  const keptRunning = Object.keys(kept).map(Number);
  const open = d.work.filter((w) => w.status !== 'COMPLETED').length;

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title="My work" sub={`${open} work ${open === 1 ? 'order' : 'orders'} to do`}>
        <Button icon="refresh" onClick={() => void q.refetch()}>
          Refresh
        </Button>
      </PageHead>
      {running && d.running ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] bg-primary p-4 text-white" role="status">
          <div>
            <p className="m-0 text-[11px] font-bold tracking-[.6px] uppercase opacity-80">Timer running</p>
            <p className="m-0 text-[17px] font-bold">
              {running.code} · {running.vehicle}
            </p>
          </div>
          <span className="font-mono text-[26px] tabular-nums">{elapsed(d.running.started_at, now)}</span>
        </div>
      ) : null}
      {d.work.length === 0 ? <Empty icon="check-circle" title="Nothing assigned to you" hint="New work shows here as soon as it is assigned." /> : null}
      {WORK_GROUPS.map((grp) => {
        const items = d.work.filter(grp.has);
        if (items.length === 0) return null;
        return (
          <section key={grp.key} aria-label={grp.label}>
            <h2 className="mt-0 mb-2 text-[11px] font-bold tracking-[.6px] text-ink-3 uppercase">
              {grp.label} ({items.length})
            </h2>
            <ul className="m-0 grid list-none gap-3 p-0 lg:grid-cols-2">
              {items.map((w) => {
                const me = w.technicians.find((t) => t.id === w.my_technician_id);
                const mine = !!me?.running || keptRunning.includes(w.id);
                const [plate, car] = w.vehicle.split(' · ');
                return (
                  <li key={w.id} className="rounded-[12px] border border-line bg-surface p-4">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="m-0 text-[19px] font-bold tracking-wide text-ink">{plate}</p>
                        <p className="m-0 truncate text-[12.5px] text-ink-3">
                          {car ?? ''} ·{' '}
                          <button type="button" className="font-mono font-semibold text-primary" onClick={() => g.openJob(w.job_id)}>
                            {w.job_number}
                          </button>
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <WorkPill status={w.status} />
                        <PriorityPill priority={w.priority} />
                      </div>
                    </div>
                    <p className="mt-2 mb-0 text-[13px] font-semibold text-ink">
                      {w.code} · {w.work_type}
                      {w.my_role !== 'LEAD' ? <span className="ml-1 text-[12px] font-normal text-ink-3">({w.my_role.toLowerCase()})</span> : null}
                    </p>
                    {w.lines.length > 0 ? (
                      <ul className="mt-1 mb-0 list-inside list-disc p-0 text-[13px] text-ink-2">
                        {w.lines.map((l) => (
                          <li key={l.id}>{l.description}</li>
                        ))}
                      </ul>
                    ) : w.description ? (
                      <p className="mt-1 mb-0 text-[13px] text-ink-2">{w.description}</p>
                    ) : null}
                    <p className="mt-2 mb-0 text-[12px] text-ink-3">
                      {w.bay ? `Bay ${w.bay.code} · ` : ''}
                      {span(w.logged_minutes)} of {span(w.estimated_minutes)}
                      {w.target ? ` · promised ${when(w.target)}` : ''}
                    </p>
                    {kept[w.id] ? <p className="mt-1 mb-0 text-[12px] font-semibold text-warning">Started offline at {new Date(kept[w.id]!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — sent when WorkSuite is back.</p> : null}
                    {w.status !== 'COMPLETED' ? (
                      <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                        {mine ? (
                          <Button size="lg" icon="pause" onClick={() => setPausing(w)}>
                            Pause
                          </Button>
                        ) : (
                          <Button size="lg" variant="primary" icon="play" loading={busy === w.id} disabled={w.status === 'PENDING' || w.status === 'READY'} onClick={() => void start(w)}>
                            {w.status === 'ASSIGNED' ? 'Start' : 'Resume'}
                          </Button>
                        )}
                        {['IN_PROGRESS', 'PAUSED', 'WAITING_PARTS', 'REWORK'].includes(w.status) ? (
                          <Button size="lg" icon="check-circle" onClick={() => setCompleting(w)}>
                            Complete
                          </Button>
                        ) : null}
                        <Button size="lg" variant="ghost" onClick={() => setAsking(w)}>
                          Ask for a part
                        </Button>
                        {['IN_PROGRESS', 'PAUSED', 'WAITING_PARTS', 'ASSIGNED', 'REWORK'].includes(w.status) ? (
                          <Button size="lg" variant="ghost" onClick={() => setRaising(w)}>
                            Found more work
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                    {w.status === 'PENDING' ? <p className="mt-2 mb-0 text-[12px] text-warning">Its parts are not all here yet.</p> : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {pausing ? (
        <PauseTimer
          w={pausing}
          reasons={d.pause_reasons}
          onClose={() => setPausing(null)}
          onDone={(queued) => {
            setKept((k) => {
              const n = { ...k };
              delete n[pausing.id];
              return n;
            });
            setPausing(null);
            if (!queued) reload();
          }}
        />
      ) : null}
      {completing ? <Complete w={completing} onClose={() => setCompleting(null)} onDone={() => { setCompleting(null); reload(); }} /> : null}
      {asking ? <AskForPart w={asking} currency={g.options.currency} onClose={() => setAsking(null)} onDone={() => { setAsking(null); reload(); }} /> : null}
      {raising ? <RaiseAdditional w={raising} currency={g.options.currency} onClose={() => setRaising(null)} onDone={() => { setRaising(null); reload(); }} /> : null}
    </div>
  );
}

function PauseTimer({ w, reasons, onClose, onDone }: { w: MyWorkItem; reasons: string[]; onClose: () => void; onDone: (queued: boolean) => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const pause = async (reason: string) => {
    setBusy(true);
    try {
      const r = await timer(w.id, 'pause', { technician_id: w.my_technician_id, reason, note: note || undefined }, `Pause ${w.code} on ${w.job_number}`);
      toast(r.queued ? 'info' : 'success', r.message);
      onDone(r.queued);
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Pause ${w.code} — why?`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-2">
        {reasons.map((r) => (
          <button key={r} type="button" disabled={busy} onClick={() => void pause(r)} className="rounded-[10px] border border-line px-3 py-4 text-[13.5px] font-semibold text-ink hover:border-primary hover:bg-selection disabled:opacity-50">
            {PAUSE_LABEL[r] ?? nice(r)}
          </button>
        ))}
      </div>
      <input className={cx(input, 'mt-3')} placeholder="Note (optional)" aria-label="Pause note" value={note} onChange={(e) => setNote(e.target.value)} />
    </Modal>
  );
}

function Complete({ w, onClose, onDone }: { w: MyWorkItem; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await gPost(`/work-orders/${w.id}/complete`, { technician_id: w.my_technician_id }, newKey('my-complete'));
      toast('success', r.message);
      onDone();
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Complete ${w.code}?`}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Not yet
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Complete
          </Button>
        </div>
      }
    >
      <p className="m-0 text-[13px] text-ink-2">Your timer stops. Parts issued to it must be used or returned first.</p>
    </Modal>
  );
}

/** Find a part in Inventory for this job, with what the branch has of it. */
function PartPicker({ jobId, currency, onPick }: { jobId: number; currency: string; onPick: (p: PartHit) => void }) {
  const [text, setText] = useState('');
  const [hits, setHits] = useState<PartHit[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      gGet<{ parts: PartHit[] }>('/parts', { job: jobId, q: text })
        .then((r) => {
          if (live) {
            setHits(r.parts);
            setFailed(false);
          }
        })
        .catch(() => {
          if (live) setFailed(true);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [jobId, text]);
  return (
    <div>
      <input className={input} placeholder="Search parts by name or code" aria-label="Search parts" value={text} onChange={(e) => setText(e.target.value)} />
      {failed ? <p className="mt-1 mb-0 text-[12px] text-danger">Parts could not be searched.</p> : null}
      {hits ? (
        <ul className="mt-1 mb-0 max-h-48 list-none overflow-y-auto rounded-[8px] border border-line p-0">
          {hits.length === 0 ? <li className="px-3 py-2 text-[12px] text-ink-3">Nothing matches.</li> : null}
          {hits.map((p) => (
            <li key={p.id}>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-subtle" onClick={() => onPick(p)}>
                <span className="min-w-0 flex-1 truncate">
                  {p.name}
                  {p.code ? <span className="ml-1 text-[11.5px] text-ink-3">{p.code}</span> : null}
                </span>
                <span className="shrink-0 text-[11.5px] text-ink-3">
                  {currency} {p.unit_price.toFixed(2)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function AskForPart({ w, currency, onClose, onDone }: { w: MyWorkItem; currency: string; onClose: () => void; onDone: () => void }) {
  const [part, setPart] = useState<PartHit | null>(null);
  const [n, setN] = useState('1');
  const [reason, setReason] = useState('');
  const [urgency, setUrgency] = useState('NORMAL');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await gPost(`/jobs/${w.job_id}/parts`, { product_id: part?.id, qty: Number(n), reason, urgency, work_order_id: w.id }, newKey('part-ask'));
      toast('success', r.message);
      onDone();
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Ask for a part"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!part || !(Number(n) > 0)} onClick={() => void save()}>
            Ask
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[12.5px] text-ink-3">The parts counter gets it. A part not on the estimate is not charged unless it is added as additional work.</p>
        <Field label="Part">
          {part ? (
            <div className="flex items-center justify-between rounded-[8px] border border-line px-3 py-2 text-[13px]">
              <span>{part.name}</span>
              <button type="button" className="text-[12px] font-semibold text-primary" onClick={() => setPart(null)}>
                Change
              </button>
            </div>
          ) : (
            <PartPicker jobId={w.job_id} currency={currency} onPick={setPart} />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="How many">
            <input className={input} inputMode="decimal" value={n} onChange={(e) => setN(e.target.value)} />
          </Field>
          <Field label="Urgency">
            <Select aria-label="Urgency" value={urgency} onChange={(e) => setUrgency(e.target.value)} options={[{ value: 'LOW', label: 'Low' }, { value: 'NORMAL', label: 'Normal' }, { value: 'URGENT', label: 'Urgent' }]} className={input} />
          </Field>
        </div>
        <Field label="Why">
          <input className={input} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

const FIND_PRIORITY = [
  { value: 'RED', label: 'Needs doing now' },
  { value: 'AMBER', label: 'Soon' },
  { value: 'GREEN', label: 'Can wait' },
];

function RaiseAdditional({ w, currency, onClose, onDone }: { w: MyWorkItem; currency: string; onClose: () => void; onDone: () => void }) {
  const [finding, setFinding] = useState('');
  const [priority, setPriority] = useState('AMBER');
  const [minutes, setMinutes] = useState('');
  const [parts, setParts] = useState<{ product_id: number; name: string; qty: number }[]>([]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await gPost(`/work-orders/${w.id}/additional`, { finding, priority, labour_minutes: Number(minutes) || 0, parts: parts.map((p) => ({ product_id: p.product_id, qty: p.qty })) });
      toast('success', r.message);
      onDone();
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Found more work"
      onClose={onClose}
      width={560}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!finding.trim()} onClick={() => void save()}>
            Raise
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[12.5px] text-ink-3">From {w.code}. The customer approves it before it is done; approved work carries on.</p>
        <Field label="What was found">
          <textarea className={cx(input, 'h-auto py-2')} rows={3} value={finding} onChange={(e) => setFinding(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="How urgent">
            <Select aria-label="How urgent" value={priority} onChange={(e) => setPriority(e.target.value)} options={FIND_PRIORITY} className={input} />
          </Field>
          <Field label="Labour, minutes">
            <input className={input} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ''))} />
          </Field>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[12.5px] font-semibold text-ink-2">Parts</span>
          {parts.map((p, i) => (
            <div key={i} className="flex items-center gap-2 text-[13px]">
              <span className="flex-1">{p.name}</span>
              <input className={cx(input, 'w-20')} aria-label={`${p.name} quantity`} inputMode="decimal" value={p.qty} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) || 0 } : x)))} />
              <Button size="sm" variant="ghost" icon="trash" aria-label={`Remove ${p.name}`} onClick={() => setParts(parts.filter((_, j) => j !== i))} />
            </div>
          ))}
          {picking ? (
            <PartPicker
              jobId={w.job_id}
              currency={currency}
              onPick={(p) => {
                setParts([...parts, { product_id: p.id, name: p.name, qty: 1 }]);
                setPicking(false);
              }}
            />
          ) : (
            <button type="button" className="self-start text-[12px] font-semibold text-primary" onClick={() => setPicking(true)}>
              + Add a part
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
