import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { Select } from '../../components/Select';
import { Button, ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { errorText, fromLocalInput, FUEL_LABEL, gGet, gPost, K, lateBy, money, newKey, nice, partCounts, span, toLocalInput, when, type JobView, type WorkView } from './api';
import { DocActions, Field, input, PartPill, PriorityPill, Section, StatusPill, Tabs, Thumb, ToneNote, Tracker, useGarage, WorkPill } from './parts';
import { Checkbox } from '../../components/Checkbox';

const InspectionTab = lazy(() => import('./job/Inspection'));
const DiagnosisTab = lazy(() => import('./job/Diagnosis'));
const EstimateTab = lazy(() => import('./job/Estimate'));
const WorkTab = lazy(() => import('./job/Work'));
const DeliveryTab = lazy(() => import('./job/Delivery'));
const MediaTab = lazy(() => import('./job/Media'));

export type JobTab = 'overview' | 'checkin' | 'inspection' | 'diagnosis' | 'estimate' | 'work' | 'delivery' | 'media' | 'activity';

const TAB_LABEL: Record<JobTab, string> = {
  overview: 'Overview',
  checkin: 'Check-in',
  inspection: 'Inspection',
  diagnosis: 'Diagnosis',
  estimate: 'Estimate',
  work: 'Work',
  delivery: 'Quality & delivery',
  media: 'Media',
  activity: 'Activity',
};

/**
 * The tabs a job has, from where it is and what this person may see: the
 * inspection, diagnosis and estimate once it is checked in, its work once the
 * customer approved, quality and delivery once it reached its check.
 */
export function jobTabs(d: JobView, may: (perm: string) => boolean): JobTab[] {
  const s = d.job.status;
  const tabs: JobTab[] = ['overview', 'checkin'];
  if (s !== 'DRAFT' && may('garage.inspection.view')) tabs.push('inspection');
  if (s !== 'DRAFT') tabs.push('diagnosis');
  if (s !== 'DRAFT' && may('garage.estimate.view')) tabs.push('estimate');
  if (d.history.some((h) => h.to === 'APPROVED') && may('garage.work_order.view')) tabs.push('work');
  if (d.history.some((h) => h.to === 'QUALITY_CHECK')) tabs.push('delivery');
  tabs.push('media', 'activity');
  return tabs;
}

/**
 * A job card, the Job 360° (FR-JOB-07, §13): who and what, where it stands on
 * the tracker and the moves it can make from there; then its check-in,
 * inspection, diagnosis and estimate, its work orders, parts and labour, its
 * quality check, road test, final review, invoice and handover, its media and
 * its activity. Every gate is the server's; the card shows what it says.
 */
export default function JobCard({ id, onBack, tab: asked }: { id: number; onBack: () => void; tab?: string | null }) {
  const g = useGarage();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.job(id), queryFn: ({ signal }) => gGet<JobView>(`/jobs/${id}`, undefined, signal) });
  const seesWork = g.may('garage.work_order.view');
  const work = useQuery({ queryKey: K.work(id), queryFn: ({ signal }) => gGet<WorkView>(`/jobs/${id}/work`, undefined, signal), enabled: seesWork });
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<JobTab | null>(null);
  const [note, setNote] = useState('');
  const [toCustomer, setToCustomer] = useState(false);

  const reload = () => {
    void qc.invalidateQueries({ queryKey: K.job(id) });
    void qc.invalidateQueries({ queryKey: K.work(id) });
    void qc.invalidateQueries({ queryKey: ['garage', 'board'] });
    void qc.invalidateQueries({ queryKey: ['garage', 'jobs'] });
    void qc.invalidateQueries({ queryKey: ['garage', 'overview'] });
  };

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <Button icon="back" className="self-start" onClick={onBack}>
          Back
        </Button>
        <ErrorNote error={q.error ?? new Error('The job could not be loaded.')} onRetry={() => void q.refetch()} />
      </div>
    );
  }
  const d = q.data;
  const j = d.job;
  const open = j.status !== 'COMPLETED' && j.status !== 'CANCELLED';
  const tabs = jobTabs(d, g.may);
  const tab: JobTab = picked && tabs.includes(picked) ? picked : asked && tabs.includes(asked as JobTab) ? (asked as JobTab) : 'overview';
  const needsCheckin = d.can.checkin && !d.checkin?.completed_at && open;
  const moves = d.choices.filter((c) => c.to !== 'CANCELLED');
  const mayCancel = open && (d.choices.some((c) => c.to === 'CANCELLED') || d.can.cancel);
  const publish = d.can.publish ?? false;

  const move = async (to: string) => {
    setBusy(to);
    try {
      const r = await gPost(`/jobs/${id}/move`, { to }, newKey('move'));
      toast('success', r.message);
      reload();
    } catch (e) {
      toast('error', errorText(e, 'The job could not be moved.'));
      reload();
    } finally {
      setBusy(null);
    }
  };

  const addNote = async () => {
    const body = note.trim();
    if (!body) return;
    setBusy('note');
    try {
      const r = await gPost(`/jobs/${id}/notes`, { body, visibility: toCustomer ? 'CUSTOMER' : 'INTERNAL' });
      toast('success', r.message);
      setNote('');
      setToCustomer(false);
      reload();
    } catch (e) {
      toast('error', errorText(e, 'The note was not added.'));
    } finally {
      setBusy(null);
    }
  };

  const noteVisibility = async (noteId: number, visibility: 'INTERNAL' | 'CUSTOMER') => {
    try {
      const r = await gPost(`/notes/${noteId}/visibility`, { visibility });
      toast('success', r.message);
      reload();
    } catch (e) {
      toast('error', errorText(e));
    }
  };

  const complaints = d.checkin?.complaints ?? [];
  const findings = d.diagnostics ?? [];

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <div className="flex flex-wrap items-start gap-3">
        <Button icon="back" onClick={onBack}>
          Back
        </Button>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="font-mono text-[12px] font-semibold text-ink-3">{j.number}</span>
          <h1 className="m-0 flex flex-wrap items-center gap-2 text-[20px] font-bold tracking-wide text-ink">
            {d.vehicle && g.may('garage.vehicle.view') ? (
              <button type="button" className="tracking-wide hover:text-primary" title="Open the vehicle" onClick={() => g.openVehicle(d.vehicle!.id)}>
                {j.vehicle?.number ?? d.vehicle.vehicle_number}
              </button>
            ) : (
              (j.vehicle?.number ?? '—')
            )}
            <StatusPill status={j.status} label={j.status_label} />
            <PriorityPill priority={j.priority} />
          </h1>
          <span className="text-[12.5px] text-ink-3">
            {[[j.vehicle?.make, j.vehicle?.model].filter(Boolean).join(' '), j.customer?.name, nice(j.job_type), j.pipeline ? `${j.pipeline} workflow` : null].filter(Boolean).join(' · ')}
          </span>
        </div>
        {needsCheckin ? (
          <Button variant="primary" icon="list-todo" disabled={!g.online} onClick={() => g.openCheckin(id)}>
            {d.checkin ? 'Continue check-in' : 'Check in'}
          </Button>
        ) : null}
        {d.checkin?.completed_at ? <DocActions doc={{ kind: 'checkin-sheet', job: id }} name={`${j.number} check-in sheet.html`} label="Check-in sheet" what="check-in sheet" size="md" /> : null}
        {d.can.edit && open ? (
          <Button icon="compose" onClick={() => setEditing(true)} disabled={!g.online}>
            Edit
          </Button>
        ) : null}
      </div>

      {j.overdue && open ? <div className="rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] font-semibold text-danger">{lateBy(j.late_minutes)} — past the time the customer was promised.</div> : null}

      <Tracker steps={d.steps ?? g.options.steps ?? []} at={j.step ?? -1} cancelled={j.status === 'CANCELLED'} />

      {open && (moves.length > 0 || mayCancel) ? (
        <Section title="Move the job on">
          <div className="flex flex-wrap gap-2">
            {moves.map((c) => (
              <Button key={c.to} loading={busy === c.to} disabled={busy !== null || !g.online} onClick={() => void move(c.to)}>
                {c.label}
              </Button>
            ))}
            {mayCancel ? (
              <Button variant="ghost" className="text-danger" disabled={!g.online} onClick={() => setCancelling(true)}>
                Cancel the job
              </Button>
            ) : null}
          </div>
        </Section>
      ) : null}

      <Tabs label="Job sections" value={tab} onChange={setPicked} tabs={tabs.map((t) => ({ id: t, label: t === 'media' && (d.media?.length ?? 0) > 0 ? `Media ${d.media!.length}` : TAB_LABEL[t] }))} />

      <Suspense fallback={<Spinner />}>
        {tab === 'overview' ? (
          <>
            <div className="grid gap-4 lg:grid-cols-3">
              <Section title="Customer and vehicle">
                <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
                  <dt className="text-ink-3">Customer</dt>
                  <dd className="m-0">{d.customer?.name ?? '—'}</dd>
                  <dt className="text-ink-3">Phone</dt>
                  <dd className="m-0">{d.customer?.phone ?? '—'}</dd>
                  {d.prefs?.preferred_channel ? (
                    <>
                      <dt className="text-ink-3">Prefers</dt>
                      <dd className="m-0">
                        {nice(d.prefs.preferred_channel)}
                        {d.prefs.whatsapp ? ` (${d.prefs.whatsapp})` : ''}
                      </dd>
                    </>
                  ) : null}
                  <dt className="text-ink-3">Vehicle</dt>
                  <dd className="m-0">{[d.vehicle?.make, d.vehicle?.model, d.vehicle?.year].filter(Boolean).join(' ') || '—'}</dd>
                  <dt className="text-ink-3">VIN</dt>
                  <dd className="m-0 font-mono text-[12px]">{d.vehicle?.vin ?? '—'}</dd>
                  <dt className="text-ink-3">Odometer in</dt>
                  <dd className="m-0 tabular-nums">
                    {j.odometer_in !== null ? `${j.odometer_in.toLocaleString()} ${g.options.units}` : '—'}
                    {j.fuel_in !== null ? ` · fuel ${FUEL_LABEL[j.fuel_in] ?? `${j.fuel_in}%`}` : ''}
                  </dd>
                </dl>
              </Section>
              <Section title="The job">
                <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
                  <dt className="text-ink-3">Branch</dt>
                  <dd className="m-0">
                    {j.branch?.name ?? '—'}
                    {j.workshop ? ` / ${j.workshop.name}` : ''}
                  </dd>
                  <dt className="text-ink-3">Advisor</dt>
                  <dd className="m-0">{j.advisor || '—'}</dd>
                  <dt className="text-ink-3">Checked in</dt>
                  <dd className="m-0">{when(j.checkin_at)}</dd>
                  <dt className="text-ink-3">Promised</dt>
                  <dd className="m-0">{when(j.target)}</dd>
                  {j.total !== null ? (
                    <>
                      <dt className="text-ink-3">Amount</dt>
                      <dd className="m-0 tabular-nums">{money(j.total, g.options.currency)}</dd>
                    </>
                  ) : null}
                  {j.cancel_reason ? (
                    <>
                      <dt className="text-ink-3">Cancelled</dt>
                      <dd className="m-0">
                        {nice(j.cancel_reason)}
                        {j.cancel_note ? ` — ${j.cancel_note}` : ''}
                      </dd>
                    </>
                  ) : null}
                </dl>
              </Section>
              <Section title="What the customer says">
                {complaints.length === 0 && findings.length === 0 && !j.requested_services ? <p className="m-0 text-[13px] text-ink-3">Nothing recorded yet.</p> : null}
                {findings.length > 0 ? (
                  <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
                    {findings.map((x) => (
                      <li key={x.id}>
                        <b>{x.complaint}</b>
                        <span className="block text-[12px] text-ink-3">{x.finding ?? (x.status === 'OPEN' ? 'No finding yet.' : '')}</span>
                      </li>
                    ))}
                  </ul>
                ) : complaints.length ? (
                  <ul className="m-0 list-inside list-disc p-0 text-[13px]">
                    {complaints.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                ) : null}
                {j.requested_services ? <p className="mt-2 mb-0 text-[13px] text-ink-2">Asked for: {j.requested_services}</p> : null}
              </Section>
            </div>

            {seesWork ? (
              <Section
                title="Work orders and parts"
                action={
                  tabs.includes('work') ? (
                    <button type="button" className="text-[12px] font-semibold text-primary" onClick={() => setPicked('work')}>
                      Open the work
                    </button>
                  ) : null
                }
              >
                {work.isLoading ? (
                  <Spinner />
                ) : work.error || !work.data ? (
                  <ErrorNote error={work.error ?? new Error('The work could not be loaded.')} onRetry={() => void work.refetch()} />
                ) : work.data.work_orders.length === 0 ? (
                  <p className="m-0 text-[13px] text-ink-3">No work orders yet. They are made from the approved estimate.</p>
                ) : (
                  <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
                    {work.data.work_orders.map((w) => (
                      <li key={w.id} className="flex flex-wrap items-center gap-2 py-2 text-[13px]">
                        <b className="font-mono text-[12px]">{w.code}</b>
                        <span className="min-w-0 flex-1">
                          {w.work_type}
                          {w.is_additional ? <span className="ml-1 text-[11.5px] text-ink-3">(additional)</span> : null}
                          <span className="block text-[11.5px] text-ink-3">
                            {w.technicians.map((t) => `${t.name}${t.running ? ' (on the clock)' : ''}`).join(', ') || 'Not assigned'}
                            {w.bay ? ` · Bay ${w.bay.code}` : ''} · {span(w.logged_minutes)} of {span(w.estimated_minutes)}
                          </span>
                        </span>
                        <WorkPill status={w.status} />
                      </li>
                    ))}
                  </ul>
                )}
                {work.data && work.data.parts.length > 0 ? (
                  <>
                    <h3 className="mt-3 mb-1 text-[12px] font-bold text-ink-2">Parts</h3>
                    <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
                      {work.data.parts.map((u) => (
                        <li key={u.id} className="flex flex-wrap items-center gap-2">
                          <PartPill status={u.status} />
                          <span className="min-w-0 flex-1">{u.description}</span>
                          <span className="text-[11.5px] text-ink-3">{partCounts(u)}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </Section>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-2">
              <Section title="Notes">
                {open ? (
                  <div className="mb-3 flex flex-col gap-2">
                    <textarea className={cx(input, 'h-auto py-2')} rows={2} placeholder="What the next person needs to know" aria-label="New note" value={note} onChange={(e) => setNote(e.target.value)} />
                    <div className="flex items-center gap-2">
                      {publish ? (
                        <label className="flex flex-1 items-center gap-1.5 text-[12.5px] text-ink-2">
                          <Checkbox checked={toCustomer} onChange={(e) => setToCustomer(e.target.checked)} /> The customer may see it
                        </label>
                      ) : (
                        <span className="flex-1 text-[12px] text-ink-3">Staff only.</span>
                      )}
                      <Button size="sm" variant="primary" loading={busy === 'note'} disabled={!note.trim() || !g.online} onClick={() => void addNote()}>
                        Add note
                      </Button>
                    </div>
                  </div>
                ) : null}
                {d.notes.length === 0 ? (
                  <p className="m-0 text-[13px] text-ink-3">No notes.</p>
                ) : (
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {d.notes.map((n) => (
                      <li key={n.id} className="text-[13px]">
                        <p className="m-0 whitespace-pre-wrap">{n.body}</p>
                        <span className="flex flex-wrap items-center gap-2 text-[11.5px] text-ink-3">
                          <span>
                            {n.by ?? '—'} · {when(n.at)} · {n.visibility === 'CUSTOMER' ? 'shown to the customer' : 'staff only'}
                          </span>
                          {publish ? (
                            <button type="button" className="font-semibold text-primary disabled:opacity-50" disabled={!g.online} onClick={() => void noteVisibility(n.id, n.visibility === 'CUSTOMER' ? 'INTERNAL' : 'CUSTOMER')}>
                              {n.visibility === 'CUSTOMER' ? 'Make staff only' : 'Show to the customer'}
                            </button>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
              <Section title="History">
                {d.history.length === 0 ? (
                  <p className="m-0 text-[13px] text-ink-3">Nothing yet.</p>
                ) : (
                  <ol className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
                    {d.history.map((h, i) => (
                      <li key={i}>
                        <b>{h.label}</b>
                        {h.waiting ? <span className="text-ink-2"> — {h.waiting}</span> : null}
                        <span className="block text-[11.5px] text-ink-3">
                          {h.by ?? '—'} · {when(h.at)}
                          {h.reason ? ` · ${h.reason}` : ''}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </Section>
            </div>
          </>
        ) : tab === 'checkin' ? (
          <CheckinSummary d={d} onOpen={() => g.openCheckin(id)} />
        ) : tab === 'inspection' ? (
          <InspectionTab jobId={id} open={open && j.status !== 'DRAFT'} onChange={reload} />
        ) : tab === 'diagnosis' ? (
          <DiagnosisTab jobId={id} jobStatus={j.status} onChange={reload} />
        ) : tab === 'estimate' ? (
          <EstimateTab jobId={id} number={j.number} customerName={d.customer?.name ?? ''} onChange={reload} />
        ) : tab === 'work' ? (
          <WorkTab jobId={id} onChange={reload} onEstimate={() => setPicked('estimate')} />
        ) : tab === 'delivery' ? (
          <DeliveryTab jobId={id} number={j.number} onChange={reload} />
        ) : tab === 'media' ? (
          <MediaTab d={d} onChange={reload} />
        ) : (
          <Section title="Timeline">
            {(d.activity ?? []).length === 0 ? (
              <p className="m-0 text-[13px] text-ink-3">Nothing yet.</p>
            ) : (
              <ol className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
                {(d.activity ?? []).map((a) => (
                  <li key={a.id}>
                    {a.text}
                    <span className="block text-[11.5px] text-ink-3">
                      {when(a.at)}
                      {a.by ? ` · ${a.by}` : ''}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        )}
      </Suspense>

      {cancelling ? (
        <CancelJob
          id={id}
          number={j.number}
          reasons={d.cancel_reasons}
          onClose={() => setCancelling(false)}
          onDone={() => {
            setCancelling(false);
            reload();
          }}
        />
      ) : null}
      {editing ? (
        <EditJob
          d={d}
          onClose={() => setEditing(false)}
          onDone={() => {
            setEditing(false);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

/** The check-in as recorded: readings, condition, damage, photos and the signature; the screen itself to continue it. */
function CheckinSummary({ d, onOpen }: { d: JobView; onOpen: () => void }) {
  const g = useGarage();
  const c = d.checkin;
  const open = d.job.status !== 'COMPLETED' && d.job.status !== 'CANCELLED';
  if (!c) {
    return (
      <Section title="Check-in">
        <p className="m-0 text-[13px] text-ink-3">The vehicle has not been checked in.</p>
        {d.can.checkin && open ? (
          <Button variant="primary" className="mt-3" disabled={!g.online} onClick={onOpen}>
            Start check-in
          </Button>
        ) : null}
      </Section>
    );
  }
  const photos = c.photos ?? [];
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Section
        title="Readings"
        action={
          !c.completed_at && d.can.checkin && open ? (
            <button type="button" className="text-[12px] font-semibold text-primary" onClick={onOpen}>
              Continue check-in
            </button>
          ) : null
        }
      >
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
          <dt className="text-ink-3">Odometer</dt>
          <dd className="m-0">{c.odometer != null ? `${c.odometer.toLocaleString()} ${g.options.units}` : '—'}</dd>
          <dt className="text-ink-3">Fuel</dt>
          <dd className="m-0">{c.fuel_level != null ? (FUEL_LABEL[c.fuel_level] ?? `${c.fuel_level}%`) : '—'}</dd>
          <dt className="text-ink-3">Left in it</dt>
          <dd className="m-0">{(c.accessories ?? []).join(', ') || 'Nothing'}</dd>
          <dt className="text-ink-3">Valuables</dt>
          <dd className="m-0">{c.valuables || 'None declared'}</dd>
          <dt className="text-ink-3">Completed</dt>
          <dd className="m-0">{c.completed_at ? `${when(c.completed_at)}${c.completed_by ? ` · ${c.completed_by}` : ''}` : 'Not yet'}</dd>
        </dl>
        {c.signature ? (
          <p className={cx('mt-2 mb-0 text-[12px] font-semibold', c.signature.current ? 'text-success' : 'text-warning')}>
            Signed by {c.signature.name}
            {c.signature.current ? '' : ' — changed since, so it is signed again'}
          </p>
        ) : null}
        {!c.completed_at && (c.missing ?? []).length > 0 ? (
          <ul className="mt-2 mb-0 list-inside list-disc p-0 text-[12px] text-warning">
            {c.missing!.map((m) => (
              <li key={m.key}>{m.text}</li>
            ))}
          </ul>
        ) : null}
      </Section>
      <Section title="Condition">
        <ul className="m-0 grid list-none grid-cols-2 gap-x-3 gap-y-1 p-0 text-[13px]">
          {Object.entries(c.conditions ?? {}).map(([area, v]) => (
            <li key={area} className="flex justify-between gap-2">
              <span className="text-ink-3">{nice(area)}</span>
              <span className={v.value === 'GOOD' ? 'text-ink-2' : 'font-semibold text-warning'}>{nice(v.value)}</span>
            </li>
          ))}
        </ul>
        {(c.marks ?? []).length > 0 ? (
          <ul className="mt-3 mb-0 list-none p-0 text-[12px] text-ink-2">
            {c.marks!.map((m, i) => (
              <li key={i}>
                {nice(m.view)} {m.zone}: {nice(m.kind)}
                {m.note ? ` — ${m.note}` : ''}
              </li>
            ))}
          </ul>
        ) : null}
      </Section>
      <Section title={`Photos (${photos.length})`}>
        {photos.length === 0 ? (
          <p className="m-0 text-[13px] text-ink-3">No photos.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p) => (
              <figure key={p.id} className="m-0">
                <Thumb id={p.id} mime={p.mime} alt={p.slot ?? 'photo'} className="aspect-square w-full" />
                <figcaption className="text-[10.5px] text-ink-3">{nice(p.slot) || nice(p.subject_type)}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function CancelJob({ id, number, reasons, onClose, onDone }: { id: number; number: string; reasons: string[]; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState(reasons[0] ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await gPost(`/jobs/${id}/cancel`, { reason, note });
      toast('success', r.message);
      onDone();
    } catch (e) {
      toast('error', errorText(e, 'The job was not cancelled.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Cancel ${number}?`}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Keep it
          </Button>
          <Button variant="danger" loading={busy} disabled={!reason} onClick={() => void save()}>
            Cancel the job
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Why">
          <Select aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} options={reasons.map((r) => ({ value: r, label: nice(r) }))} className={input} />
        </Field>
        <Field label="Note">
          <input className={input} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Cancel note" />
        </Field>
        <p className="m-0 text-[12px] text-ink-3">Parts held for the job are released. The job stays on file, cancelled.</p>
      </div>
    </Modal>
  );
}

/** Change what the job card says: priority, type, the promised time, the advisor, what was asked for. */
function EditJob({ d, onClose, onDone }: { d: JobView; onClose: () => void; onDone: () => void }) {
  const g = useGarage();
  const o = g.options;
  const j = d.job;
  const [priority, setPriority] = useState<string>(j.priority);
  const [type, setType] = useState(j.job_type);
  const [target, setTarget] = useState(toLocalInput(j.target));
  const [advisor, setAdvisor] = useState(String(j.service_advisor_id ?? ''));
  const [requested, setRequested] = useState(j.requested_services ?? '');
  const [busy, setBusy] = useState(false);
  const advisors = o.advisors ?? [];
  const save = async () => {
    setBusy(true);
    try {
      const r = await gPost(`/jobs/${j.id}`, {
        priority,
        job_type: type,
        target_completion_at: target ? fromLocalInput(target) : '',
        service_advisor_id: Number(advisor) || undefined,
        requested_services: requested,
      });
      toast('success', r.message);
      onDone();
    } catch (e) {
      toast('error', errorText(e, 'The job was not saved.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Edit ${j.number}`}
      onClose={onClose}
      width={560}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Save
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Priority">
            <Select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)} options={o.priorities.map((p) => ({ value: p, label: nice(p) }))} className={input} />
          </Field>
          <Field label="Job type">
            <Select aria-label="Job type" value={type} onChange={(e) => setType(e.target.value)} options={o.job_types.map((t) => ({ value: t, label: nice(t) }))} className={input} />
          </Field>
          <Field label="Promised for">
            <input type="datetime-local" className={input} aria-label="Promised for" value={target} onChange={(e) => setTarget(e.target.value)} />
          </Field>
          <Field label="Service advisor">
            {advisors.length ? (
              <Select aria-label="Service advisor" value={advisor} onChange={(e) => setAdvisor(e.target.value)} options={[{ value: '', label: j.advisor || '—' }, ...advisors.map((a) => ({ value: String(a.id), label: a.name }))]} className={input} />
            ) : (
              <span className="text-[13px] text-ink-3">{j.advisor || '—'}</span>
            )}
          </Field>
        </div>
        <Field label="Requested services">
          <textarea className={cx(input, 'h-auto py-2')} rows={3} value={requested} onChange={(e) => setRequested(e.target.value)} aria-label="Requested services" />
        </Field>
        {j.priority !== 'URGENT' && priority === 'URGENT' ? <ToneNote>Urgent is a choice someone makes; a walk-in is never made urgent on its own.</ToneNote> : null}
      </div>
    </Modal>
  );
}
