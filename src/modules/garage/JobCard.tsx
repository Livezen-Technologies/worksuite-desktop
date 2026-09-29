import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/Select';
import { Button, ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { errorText, gGet, gPost, K, lateBy, newKey, nice, partCounts, span, when, type JobView, type WorkView } from './api';
import { Field, input, openWeb, PartPill, PriorityPill, Section, StatusPill, useGarage, WorkPill } from './parts';

/**
 * A job card, read-mostly: who and what, where it is in its flow and the
 * moves it can make from there, its work orders and parts, notes and history.
 * Check-in (photos, marks, signature), estimates, QC and delivery are on the
 * web for now; the card opens them there.
 */
export default function JobCard({ id, onBack }: { id: number; onBack: () => void }) {
  const g = useGarage();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.job(id), queryFn: ({ signal }) => gGet<JobView>(`/jobs/${id}`, undefined, signal) });
  const seesWork = g.may('garage.work_order.view');
  const work = useQuery({ queryKey: K.work(id), queryFn: ({ signal }) => gGet<WorkView>(`/jobs/${id}/work`, undefined, signal), enabled: seesWork });
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
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
  const needsCheckin = d.can.checkin && !d.checkin?.completed_at && open;

  const move = async (to: string) => {
    setBusy(to);
    try {
      const r = await gPost(`/jobs/${id}/move`, { to }, newKey('move'));
      toast('success', r.message);
      reload();
    } catch (e) {
      toast('error', errorText(e, 'The job could not be moved.'));
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

  const complaints = d.checkin?.complaints ?? [];

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <div className="flex flex-wrap items-start gap-3">
        <Button icon="back" onClick={onBack}>
          Back
        </Button>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="font-mono text-[12px] font-semibold text-ink-3">{j.number}</span>
          <h1 className="m-0 flex flex-wrap items-center gap-2 text-[20px] font-bold tracking-wide text-ink">
            {j.vehicle?.number ?? '—'}
            <StatusPill status={j.status} label={j.status_label} />
            <PriorityPill priority={j.priority} />
          </h1>
          <span className="text-[12.5px] text-ink-3">
            {[[j.vehicle?.make, j.vehicle?.model].filter(Boolean).join(' '), j.customer?.name, nice(j.job_type)].filter(Boolean).join(' · ')}
          </span>
        </div>
        {needsCheckin ? (
          <Button variant="primary" icon="external" onClick={() => openWeb(`/garage?checkin=${id}`)}>
            Check in
          </Button>
        ) : null}
        <Button icon="external" onClick={() => openWeb(`/garage?job=${id}`)}>
          Estimates, QC & delivery
        </Button>
      </div>

      {j.overdue && open ? <div className="rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] font-semibold text-danger">{lateBy(j.late_minutes)} — past the time the customer was promised.</div> : null}

      {open && (d.choices.length > 0 || d.can.cancel) ? (
        <Section title="Move the job on">
          <div className="flex flex-wrap gap-2">
            {d.choices.map((c) => (
              <Button key={c.to} loading={busy === c.to} disabled={busy !== null} onClick={() => void move(c.to)}>
                {c.label}
              </Button>
            ))}
            {d.can.cancel ? (
              <Button variant="ghost" className="text-danger" onClick={() => setCancelling(true)}>
                Cancel the job
              </Button>
            ) : null}
          </div>
        </Section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Customer and vehicle">
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
            <dt className="text-ink-3">Customer</dt>
            <dd className="m-0">{d.customer?.name ?? '—'}</dd>
            <dt className="text-ink-3">Phone</dt>
            <dd className="m-0">{d.customer?.phone ?? '—'}</dd>
            <dt className="text-ink-3">Vehicle</dt>
            <dd className="m-0">{[d.vehicle?.make, d.vehicle?.model, d.vehicle?.year].filter(Boolean).join(' ') || '—'}</dd>
            <dt className="text-ink-3">VIN</dt>
            <dd className="m-0 font-mono text-[12px]">{d.vehicle?.vin ?? '—'}</dd>
            <dt className="text-ink-3">Odometer in</dt>
            <dd className="m-0 tabular-nums">{j.odometer_in !== null ? `${j.odometer_in.toLocaleString()} ${g.options.units}` : '—'}</dd>
          </dl>
        </Section>
        <Section title="The job">
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
            <dt className="text-ink-3">Branch</dt>
            <dd className="m-0">{j.branch?.name ?? '—'}</dd>
            <dt className="text-ink-3">Advisor</dt>
            <dd className="m-0">{j.advisor || '—'}</dd>
            <dt className="text-ink-3">Checked in</dt>
            <dd className="m-0">{when(j.checkin_at)}</dd>
            <dt className="text-ink-3">Promised</dt>
            <dd className="m-0">{when(j.target)}</dd>
            {j.cancel_reason ? (
              <>
                <dt className="text-ink-3">Cancelled</dt>
                <dd className="m-0">{nice(j.cancel_reason)}</dd>
              </>
            ) : null}
          </dl>
        </Section>
        <Section title="What the customer says">
          {complaints.length === 0 && !j.requested_services ? <p className="m-0 text-[13px] text-ink-3">Nothing recorded yet.</p> : null}
          {complaints.length ? (
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
        <Section title="Work orders and parts">
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
          {d.can.edit && open ? (
            <div className="mb-3 flex flex-col gap-2">
              <textarea className={cx(input, 'h-auto py-2')} rows={2} placeholder="Add a note" aria-label="New note" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex items-center gap-2">
                <label className="flex flex-1 items-center gap-1.5 text-[12.5px] text-ink-2">
                  <input type="checkbox" checked={toCustomer} onChange={(e) => setToCustomer(e.target.checked)} /> The customer may see it
                </label>
                <Button size="sm" variant="primary" loading={busy === 'note'} disabled={!note.trim()} onClick={() => void addNote()}>
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
                  <span className="text-[11.5px] text-ink-3">
                    {n.by ?? '—'} · {when(n.at)}
                    {n.visibility === 'CUSTOMER' ? ' · shown to the customer' : ''}
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
      </div>
    </Modal>
  );
}
