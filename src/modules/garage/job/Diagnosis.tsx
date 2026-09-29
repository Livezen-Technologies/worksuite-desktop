import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../../components/Select';
import { Button, ErrorNote, IconButton, Modal, Spinner, cx } from '../../../components/ui';
import { toast } from '../../../core/toasts';
import { errorText, gGet, gPost, K, span, when, type DiagnosisView, type Finding } from '../api';
import { PartPicker } from '../MyWork';
import { Ask, Field, input, LightPill, Section, ToneNote, useGarage } from '../parts';

/** While a finding may still be written: the job has not gone past its estimate. */
const OPEN_STATUSES = ['CHECKED_IN', 'INSPECTION', 'DIAGNOSIS', 'ESTIMATE_PREPARATION'];
const PRIORITY = [
  { value: 'RED', label: 'Urgent' },
  { value: 'AMBER', label: 'Soon' },
  { value: 'GREEN', label: 'Advisory' },
];

/**
 * Diagnosis (WF-06, FR-DIA-01..05): a finding for every complaint — "no
 * fault found" is one too — with its cause, the repair, its labour, parts
 * and urgency. The repair becomes a recommendation the estimate takes. Fault
 * codes are written down as read. A signed-off finding is changed only by a
 * lead technician.
 */
export default function DiagnosisTab({ jobId, jobStatus, onChange }: { jobId: number; jobStatus: string; onChange: () => void }) {
  const g = useGarage();
  const qc = useQueryClient();
  const key = K.diagnosis(jobId);
  const q = useQuery({ queryKey: key, queryFn: ({ signal }) => gGet<DiagnosisView>(`/jobs/${jobId}/diagnosis`, undefined, signal) });
  const [editing, setEditing] = useState<Finding | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error ?? new Error('The diagnosis could not be loaded.')} onRetry={() => void q.refetch()} />;

  const d = q.data;
  const open = OPEN_STATUSES.includes(jobStatus) && g.online;
  const reload = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: K.inspections(jobId) });
    onChange();
  };
  const unresolved = d.items.filter((f) => f.status === 'OPEN').length;
  const unsigned = d.items.filter((f) => !f.signed_off).length;

  const add = async (complaint: string) => {
    setBusy(true);
    try {
      const r = await gPost(`/jobs/${jobId}/diagnosis`, { complaint });
      toast('success', r.message);
      setAdding(false);
      reload();
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const signOff = async () => {
    setBusy(true);
    try {
      const r = await gPost(`/jobs/${jobId}/diagnosis/signoff`, {});
      toast('success', r.message);
      reload();
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
      <Section
        title="Findings"
        action={
          <span className="flex gap-2">
            {d.can.create && open ? (
              <Button size="sm" icon="plus" onClick={() => setAdding(true)}>
                Add
              </Button>
            ) : null}
            {d.can.signoff && open && unsigned > 0 ? (
              <Button size="sm" variant="primary" icon="check-check" loading={busy} disabled={unresolved > 0} title={unresolved > 0 ? 'Record every finding first' : undefined} onClick={() => void signOff()}>
                Sign off
              </Button>
            ) : null}
          </span>
        }
      >
        {d.signoff_required && unsigned > 0 ? (
          <div className="mb-2">
            <ToneNote>A lead technician signs the diagnosis off before the job goes to its estimate.</ToneNote>
          </div>
        ) : null}
        {d.items.length === 0 ? (
          <p className="m-0 text-[13px] text-ink-3">No complaints on this job.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
            {d.items.map((f) => (
              <li key={f.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-[13px] font-semibold text-ink">
                    {f.complaint}
                    {f.source === 'technician' ? <span className="ml-2 text-[10px] font-semibold text-ink-3 uppercase">found by technician</span> : null}
                  </p>
                  {f.status === 'OPEN' ? (
                    <p className="m-0 text-[12px] text-warning">No finding yet.</p>
                  ) : (
                    <div className="mt-1 flex flex-col gap-0.5 text-[13px] text-ink-2">
                      <p className="m-0">
                        {f.no_fault ? <b>No fault found. </b> : null}
                        {f.finding}
                      </p>
                      {f.cause ? <p className="m-0 text-[12px] text-ink-3">Cause: {f.cause}</p> : null}
                      {f.recommendation ? (
                        <p className="m-0 flex flex-wrap items-center gap-1 text-[12px]">
                          <LightPill value={f.priority} />
                          {f.recommendation}
                          {f.labour_minutes ? ` · ${span(f.labour_minutes)}` : ''}
                          {f.parts.length ? ` · ${f.parts.length} part${f.parts.length === 1 ? '' : 's'}` : ''}
                        </p>
                      ) : null}
                      <p className="m-0 text-[11px] text-ink-3">
                        {f.resolved_by}
                        {f.signed_off ? ` · signed off by ${f.signed_off_by}` : ''}
                      </p>
                    </div>
                  )}
                </div>
                {d.can.create && open && (!f.signed_off || d.can.signoff) ? (
                  <Button size="sm" variant={f.status === 'OPEN' ? 'primary' : 'ghost'} onClick={() => setEditing(f)}>
                    {f.status === 'OPEN' ? 'Record' : 'Change'}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <FaultCodes d={d} jobId={jobId} canAdd={d.can.create && open} onChange={reload} />
      {editing ? (
        <FindingForm
          jobId={jobId}
          finding={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      ) : null}
      {adding ? <Ask title="Add a finding" text="Something found that the customer did not mention." fields={[{ name: 'complaint', label: 'What was found', required: true }]} confirm="Add" busy={busy} onClose={() => setAdding(false)} onSubmit={(v) => void add(v.complaint ?? '')} /> : null}
    </div>
  );
}

function FaultCodes({ d, jobId, canAdd, onChange }: { d: DiagnosisView; jobId: number; canAdd: boolean; onChange: () => void }) {
  const [code, setCode] = useState('');
  const [desc, setDesc] = useState('');
  const [scanner, setScanner] = useState('');
  const [finding, setFinding] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      const r = await gPost(`/jobs/${jobId}/dtc`, { code, description: desc, scanner, diagnostic_id: Number(finding) || undefined });
      toast('success', r.message);
      setCode('');
      setDesc('');
      onChange();
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Fault codes">
      {d.codes.length === 0 ? (
        <p className="m-0 text-[13px] text-ink-3">None recorded.</p>
      ) : (
        <ul className="m-0 mb-3 flex list-none flex-col gap-1 p-0">
          {d.codes.map((c) => (
            <li key={c.id} className="text-[13px]">
              <span className="font-mono font-bold">{c.code}</span>
              {c.description ? ` — ${c.description}` : ''}
              <span className="block text-[11px] text-ink-3">
                {c.scanner ? `${c.scanner} · ` : ''}
                {when(c.scanned_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canAdd ? (
        <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
          <div className="grid grid-cols-[7rem_1fr] gap-2">
            <input className={cx(input, 'font-mono uppercase')} placeholder="P0301" aria-label="Fault code" maxLength={5} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            <input className={input} placeholder="As the scanner describes it" aria-label="Code description" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input className={input} placeholder="Scanner" aria-label="Scanner" value={scanner} onChange={(e) => setScanner(e.target.value)} />
            <Select aria-label="For finding" value={finding} onChange={(e) => setFinding(e.target.value)} options={[{ value: '', label: 'For no finding' }, ...d.items.map((f) => ({ value: String(f.id), label: f.complaint }))]} className={input} />
          </div>
          <div className="flex justify-end">
            <Button size="sm" loading={busy} disabled={!/^[PBCU][0-9A-F]{4}$/.test(code)} onClick={() => void add()}>
              Record code
            </Button>
          </div>
        </div>
      ) : null}
    </Section>
  );
}

interface PartRow {
  product_id: number | null;
  name: string;
  qty: number;
}

function FindingForm({ jobId, finding, onClose, onSaved }: { jobId: number; finding: Finding; onClose: () => void; onSaved: () => void }) {
  const g = useGarage();
  const [noFault, setNoFault] = useState(finding.no_fault);
  const [text, setText] = useState(finding.finding ?? '');
  const [cause, setCause] = useState(finding.cause ?? '');
  const [rec, setRec] = useState(finding.recommendation ?? '');
  const [minutes, setMinutes] = useState(finding.labour_minutes ? String(finding.labour_minutes) : '');
  const [priority, setPriority] = useState<string>(finding.priority ?? 'AMBER');
  const [parts, setParts] = useState<PartRow[]>(finding.parts.map((p) => ({ product_id: p.product_id, name: p.description ?? `Part #${p.product_id}`, qty: p.qty })));
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await gPost(`/diagnosis/${finding.id}`, {
        no_fault: noFault,
        finding: text,
        cause,
        recommendation: rec,
        labour_minutes: Number(minutes) || 0,
        priority,
        parts: parts.map((p) => ({ product_id: p.product_id, qty: p.qty, description: p.name })),
      });
      toast('success', r.message);
      onSaved();
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={finding.complaint}
      onClose={onClose}
      width={620}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!noFault && !text.trim()} onClick={() => void save()}>
            Save finding
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2 text-[13px] font-medium">
          <input type="checkbox" checked={noFault} onChange={(e) => setNoFault(e.target.checked)} /> No fault found
        </label>
        <Field label={noFault ? 'What was checked' : 'Finding *'}>
          <textarea className={cx(input, 'h-auto py-2')} rows={2} aria-label="Finding" value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <Field label="Cause">
          <textarea className={cx(input, 'h-auto py-2')} rows={2} aria-label="Cause" value={cause} onChange={(e) => setCause(e.target.value)} />
        </Field>
        {!noFault ? (
          <>
            <Field label="Recommended repair" hint="Becomes a recommendation the estimate can take.">
              <textarea className={cx(input, 'h-auto py-2')} rows={2} aria-label="Recommended repair" value={rec} onChange={(e) => setRec(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Labour, minutes">
                <input className={input} inputMode="numeric" aria-label="Labour, minutes" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ''))} />
              </Field>
              <Field label="How urgent">
                <Select aria-label="How urgent" value={priority} onChange={(e) => setPriority(e.target.value)} options={PRIORITY} className={input} />
              </Field>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[12.5px] font-semibold text-ink-2">Parts</span>
              {parts.map((p, i) => (
                <div key={i} className="flex items-center gap-2 text-[13px]">
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <input className={cx(input, 'w-20')} aria-label={`${p.name} quantity`} inputMode="decimal" value={p.qty} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) || 0 } : x)))} />
                  <IconButton icon="trash" label={`Remove ${p.name}`} size={15} onClick={() => setParts(parts.filter((_, j) => j !== i))} />
                </div>
              ))}
              {picking ? (
                <PartPicker
                  jobId={jobId}
                  currency={g.options.currency}
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
          </>
        ) : null}
      </div>
    </Modal>
  );
}
