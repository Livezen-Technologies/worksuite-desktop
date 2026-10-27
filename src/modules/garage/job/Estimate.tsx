import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Select } from '../../../components/Select';
import { Button, ErrorNote, IconButton, Modal, Spinner, cx } from '../../../components/ui';
import { toast } from '../../../core/toasts';
import { AVAILABILITY_LABEL, codeOf, errorText, gDelete, gGet, gPost, K, money, newKey, nice, span, when, type Decision, type EstimateLine, type EstimatesView, type EstimateVersion, type PartHit } from '../api';
import { PartPicker } from '../MyWork';
import { Ask, DocActions, Field, input, LightPill, Section, SignaturePad, ToneNote, useGarage } from '../parts';
import { Pill } from '../../../components/ListKit';
import { Checkbox } from '../../../components/Checkbox';

const DECISION_WORD: Record<string, string> = { PROPOSED: '', APPROVED: 'Approved', REJECTED: 'Rejected', DEFERRED: 'Later' };
const DECISION_TONE: Record<string, string> = { APPROVED: 'text-success', REJECTED: 'text-danger', DEFERRED: 'text-warning' };
const STATUS_TONE: Record<string, 'blue' | 'amber' | 'red' | 'green' | 'grey'> = {
  DRAFT: 'grey', PENDING_INTERNAL_APPROVAL: 'amber', SENT: 'blue', VIEWED: 'blue', APPROVED: 'green', PARTIALLY_APPROVED: 'green',
  REJECTED: 'red', CHANGES_REQUESTED: 'amber', SUPERSEDED: 'grey', EXPIRED: 'grey',
};

type Asking = 'next' | 'discount' | 'changes' | null;

/**
 * The estimate (WF-07/08, FR-EST-01..08, FR-APR-01..07). Every version is
 * kept: a sent one is never changed, and a change is the next version with a
 * line saying what changed. Lines are priced by the server — labour from the
 * rates, parts from Inventory — and the customer decides each one, through
 * the link or by phone or at the counter, recorded here naming who.
 */
export default function EstimateTab({ jobId, number, customerName, onChange }: { jobId: number; number: string; customerName: string; onChange: () => void }) {
  const g = useGarage();
  const qc = useQueryClient();
  const key = K.estimates(jobId);
  const q = useQuery({ queryKey: key, queryFn: ({ signal }) => gGet<EstimatesView>(`/jobs/${jobId}/estimates`, undefined, signal) });
  const [pick, setPick] = useState<number | null>(null);
  const [lineFor, setLineFor] = useState<{ est: EstimateVersion; line: EstimateLine | null } | null>(null);
  const [adding, setAdding] = useState<EstimateVersion | null>(null);
  const [sending, setSending] = useState<EstimateVersion | null>(null);
  const [deciding, setDeciding] = useState<EstimateVersion | null>(null);
  const [asking, setAsking] = useState<Asking>(null);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error ?? new Error('The estimate could not be loaded.')} onRetry={() => void q.refetch()} />;

  const d = q.data;
  const online = g.online;
  const reload = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: K.inspections(jobId) });
    onChange();
  };
  const latest = d.versions[0] ?? null;
  const est = d.versions.find((v) => v.id === pick) ?? latest;
  const isLatest = est !== null && latest !== null && est.id === latest.id;
  const openRecs = d.recommendations.filter((r) => r.status === 'OPEN');

  const run = async (fn: () => Promise<{ message: string }>) => {
    setBusy(true);
    try {
      const r = await fn();
      toast('success', r.message);
      setAsking(null);
      reload();
    } catch (e) {
      toast('error', errorText(e));
      if (codeOf(e) === 'discount') reload();
    } finally {
      setBusy(false);
    }
  };

  if (!est) {
    return (
      <Section title="Estimate">
        <p className="m-0 mb-3 text-[13px] text-ink-3">
          No estimate yet.{' '}
          {openRecs.length ? `${openRecs.length} recommendation${openRecs.length === 1 ? '' : 's'} from the inspection and diagnosis can go on it in one step.` : 'Labour is priced from the labour rates, parts from Inventory.'}
        </p>
        {d.can.create ? (
          <Button variant="primary" loading={busy} disabled={!online} onClick={() => void run(() => gPost(`/jobs/${jobId}/estimates`, {}, newKey('est')))}>
            Start estimate
          </Button>
        ) : null}
      </Section>
    );
  }

  const draft = est.status === 'DRAFT' && isLatest;
  const out = (est.status === 'SENT' || est.status === 'VIEWED') && isLatest;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Versions">
          {d.versions.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={v.id === est.id}
              onClick={() => setPick(v.id)}
              className={cx('rounded-[8px] border px-2.5 py-1 text-[12px] font-semibold', v.id === est.id ? 'border-primary bg-primary text-white' : 'border-line bg-surface text-ink-2 hover:bg-subtle')}
            >
              v{v.version}
              {v.kind === 'SUPPLEMENTARY' ? ' · additional' : ''} · {nice(v.status)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {draft && d.can.edit && openRecs.length > 0 ? (
            <Button size="sm" disabled={!online} onClick={() => setAdding(est)}>
              Add recommendations ({openRecs.length})
            </Button>
          ) : null}
          {draft && d.can.edit ? (
            <Button size="sm" icon="plus" disabled={!online} onClick={() => setLineFor({ est, line: null })}>
              Line
            </Button>
          ) : null}
          {draft && d.can.send ? (
            <Button size="sm" variant="primary" icon="send" disabled={est.lines.length === 0 || !online} onClick={() => setSending(est)}>
              Send
            </Button>
          ) : null}
          {est.status === 'PENDING_INTERNAL_APPROVAL' && isLatest && d.can.discount_override ? (
            <Button size="sm" variant="primary" disabled={!online} onClick={() => setAsking('discount')}>
              Approve discount
            </Button>
          ) : null}
          {out && d.can.record ? (
            <Button size="sm" variant="primary" disabled={!online} onClick={() => setDeciding(est)}>
              Record decision
            </Button>
          ) : null}
          {out && d.can.record ? (
            <Button size="sm" variant="ghost" disabled={!online} onClick={() => setAsking('changes')}>
              Changes asked
            </Button>
          ) : null}
          {isLatest && d.can.create && est.kind !== 'SUPPLEMENTARY' && ['SENT', 'VIEWED', 'CHANGES_REQUESTED', 'EXPIRED'].includes(est.status) ? (
            <Button size="sm" disabled={!online} onClick={() => setAsking('next')}>
              New version
            </Button>
          ) : null}
          <DocActions doc={{ kind: 'estimate', estimate: est.id }} name={`${number} estimate v${est.version}.html`} label="Print" what="estimate" />
        </div>
      </div>

      {est.status === 'PENDING_INTERNAL_APPROVAL' ? <ToneNote>A discount on this version is above the {d.discount_limit}% limit. It goes to the customer once a manager approves it.</ToneNote> : null}
      {est.status === 'CHANGES_REQUESTED' && est.kind !== 'SUPPLEMENTARY' ? <ToneNote>The customer asked for changes — see the activity. Start the next version to answer them.</ToneNote> : null}
      {est.kind === 'SUPPLEMENTARY' ? <ToneNote tone="blue">Additional work found during the repair. The approved estimate stands; approved lines here become new work orders.</ToneNote> : null}
      {est.kind === 'SUPPLEMENTARY' && est.status === 'CHANGES_REQUESTED' ? <ToneNote>The work goes back to the Work tab to be priced again.</ToneNote> : null}

      <Section
        title={`${est.kind === 'SUPPLEMENTARY' ? 'Additional work' : 'Estimate'} v${est.version}`}
        action={
          <span className="flex flex-wrap items-center gap-2 text-[11.5px] text-ink-3">
            <Pill tone={STATUS_TONE[est.status] ?? 'grey'}>{nice(est.status)}</Pill>
            {est.sent_at ? <span>sent {when(est.sent_at)}</span> : null}
            {est.viewed_at ? <span>· opened {when(est.viewed_at)}</span> : null}
            {est.valid_until ? <span>· valid until {when(est.valid_until, false)}</span> : null}
          </span>
        }
      >
        {est.change_summary ? (
          <p className="m-0 mb-2 text-[13px] text-ink-2">
            <b>What changed:</b> {est.change_summary}
          </p>
        ) : null}
        {est.lines.length === 0 ? (
          <p className="m-0 text-[13px] text-ink-3">No lines yet. Add labour, parts, or the recommendations found on the inspection and diagnosis.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] text-ink-3">
                  <th className="py-1.5 pr-2 font-semibold">Type</th>
                  <th className="py-1.5 pr-2 font-semibold">Description</th>
                  <th className="py-1.5 pr-2 text-right font-semibold">Qty</th>
                  <th className="py-1.5 pr-2 text-right font-semibold">Price</th>
                  <th className="py-1.5 pr-2 text-right font-semibold">Disc.</th>
                  <th className="py-1.5 pr-2 text-right font-semibold">Total</th>
                  <th className="py-1.5 font-semibold">{draft ? '' : 'Decision'}</th>
                </tr>
              </thead>
              <tbody>
                {est.lines.map((l) => (
                  <tr key={l.id} className="border-b border-line/70 last:border-b-0">
                    <td className="py-2 pr-2 text-[12px] text-ink-3">{nice(l.line_type)}</td>
                    <td className="py-2 pr-2">
                      <span className="flex flex-wrap items-center gap-1">
                        <LightPill value={l.priority} />
                        <span>{l.description}</span>
                      </span>
                      <span className="block text-[11px] text-ink-3">
                        {l.labour_minutes ? `${span(l.labour_minutes)} · ${l.rate_class} rate` : ''}
                        {l.availability ? ` ${AVAILABILITY_LABEL[l.availability] ?? l.availability}` : ''}
                        {l.coverage !== 'customer' ? ` · paid by ${l.coverage}` : ''}
                        {l.tax_rate > 0 ? ` · tax ${l.tax_rate}%` : ''}
                      </span>
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">{l.qty}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{money(l.unit_price)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{l.discount_pct > 0 ? `${l.discount_pct}%` : ''}</td>
                    <td className={cx('py-2 pr-2 text-right tabular-nums', l.coverage !== 'customer' && 'text-ink-3 line-through')}>{money(l.total)}</td>
                    <td className="py-2">
                      {draft && d.can.edit ? (
                        <span className="flex gap-0.5">
                          <IconButton icon="compose" label={`Change ${l.description}`} size={15} disabled={!online} onClick={() => setLineFor({ est, line: l })} />
                          <IconButton icon="trash" label={`Remove ${l.description}`} size={15} disabled={!online} onClick={() => void run(() => gDelete(`/estimates/${est.id}/lines/${l.id}`))} />
                        </span>
                      ) : (
                        <span className={cx('text-[12px] font-semibold', DECISION_TONE[l.decision])}>{DECISION_WORD[l.decision]}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <dl className="mt-3 ml-auto grid w-full max-w-xs grid-cols-2 gap-y-0.5 text-[13px]">
          <dt className="text-ink-3">Subtotal</dt>
          <dd className="m-0 text-right tabular-nums">{money(est.subtotal, est.currency)}</dd>
          {est.discount > 0 ? (
            <>
              <dt className="text-ink-3">Discount given</dt>
              <dd className="m-0 text-right tabular-nums">{money(est.discount, est.currency)}</dd>
            </>
          ) : null}
          <dt className="text-ink-3">Tax</dt>
          <dd className="m-0 text-right tabular-nums">{money(est.tax, est.currency)}</dd>
          <dt className="font-bold">Total</dt>
          <dd className="m-0 text-right font-bold tabular-nums">{money(est.total, est.currency)}</dd>
          {est.decided_at ? (
            <>
              <dt className="text-success">Approved</dt>
              <dd className="m-0 text-right text-success tabular-nums">{money(est.approved_total, est.currency)}</dd>
            </>
          ) : null}
          {est.deferred_total > 0 ? (
            <>
              <dt className="text-warning">Left for later</dt>
              <dd className="m-0 text-right text-warning tabular-nums">{money(est.deferred_total, est.currency)}</dd>
            </>
          ) : null}
        </dl>
      </Section>

      {d.approvals.length > 0 ? (
        <Section title="Decisions">
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {d.approvals.map((a) => (
              <li key={a.id} className="text-[13px]">
                <b>{a.approver}</b> {nice(a.outcome).toLowerCase()} v{a.version} ({nice(a.method).toLowerCase()}) — {money(a.approved_total, d.currency)} approved
                {a.signed ? <span className="ml-1 text-[12px] text-success">· signed</span> : null}
                {a.note ? <span className="block text-[12px] text-ink-3">{a.note}</span> : null}
                <span className="block text-[11px] text-ink-3">
                  {when(a.at)}
                  {a.recorded_by ? ` · recorded by ${a.recorded_by}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {lineFor ? (
        <LineForm
          jobId={jobId}
          d={d}
          est={lineFor.est}
          line={lineFor.line}
          onClose={() => setLineFor(null)}
          onSaved={() => {
            setLineFor(null);
            reload();
          }}
        />
      ) : null}
      {adding ? (
        <AddRecommendations
          d={d}
          est={adding}
          onClose={() => setAdding(null)}
          onSaved={() => {
            setAdding(null);
            reload();
          }}
        />
      ) : null}
      {sending ? (
        <SendEstimate
          est={sending}
          onClose={() => setSending(null)}
          onSent={(l) => {
            setSending(null);
            setLink(l);
            reload();
          }}
          onRefused={() => {
            setSending(null);
            reload();
          }}
        />
      ) : null}
      {deciding ? (
        <RecordDecision
          est={deciding}
          customerName={customerName}
          onClose={() => setDeciding(null)}
          onSaved={() => {
            setDeciding(null);
            reload();
          }}
        />
      ) : null}
      {asking === 'next' ? (
        <Ask
          title="Start the next version"
          text={`v${latest?.version} stays as it was sent. Say what changes in the new one — the customer sees it.`}
          fields={[{ name: 'summary', label: 'What changes', required: true, placeholder: 'Interior clean removed' }]}
          confirm="Start"
          busy={busy}
          onClose={() => setAsking(null)}
          onSubmit={(v) => {
            setPick(null);
            void run(() => gPost(`/jobs/${jobId}/estimates`, { summary: v.summary }, newKey('est')));
          }}
        />
      ) : null}
      {asking === 'discount' ? (
        <Ask
          title="Approve the discount"
          text={`The largest discount on v${est.version} is above the ${d.discount_limit}% limit.`}
          fields={[{ name: 'note', label: 'Why (kept with the approval)' }]}
          confirm="Approve"
          busy={busy}
          onClose={() => setAsking(null)}
          onSubmit={(v) => void run(() => gPost(`/estimates/${est.id}/approve-discount`, { note: v.note }))}
        />
      ) : null}
      {asking === 'changes' ? (
        <Ask
          title="The customer asked for changes"
          text="The job goes back to its estimate, and the next version answers this."
          fields={[{ name: 'comment', label: 'What they would like changed', required: true, type: 'textarea' }]}
          confirm="Record"
          busy={busy}
          onClose={() => setAsking(null)}
          onSubmit={(v) => void run(() => gPost(`/estimates/${est.id}/changes`, { comment: v.comment }))}
        />
      ) : null}
      {link ? <LinkNotice link={link} onClose={() => setLink(null)} /> : null}
    </div>
  );
}

function LineForm({ jobId, d, est, line, onClose, onSaved }: { jobId: number; d: EstimatesView; est: EstimateVersion; line: EstimateLine | null; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState(line?.line_type ?? d.line_types[0] ?? 'LABOUR');
  const [desc, setDesc] = useState(line?.description ?? '');
  const [part, setPart] = useState<{ id: number; name: string } | null>(line?.product_id ? { id: line.product_id, name: line.description } : null);
  const [rateClass, setRateClass] = useState(line?.rate_class ?? d.rates[0]?.rate_class ?? 'general');
  const [minutes, setMinutes] = useState(String(line?.labour_minutes ?? 60));
  const [qty, setQty] = useState(String(line?.qty ?? 1));
  const [price, setPrice] = useState(line && line.line_type !== 'LABOUR' ? String(line.unit_price) : '');
  const [disc, setDisc] = useState(String(line?.discount_pct ?? 0));
  const [coverage, setCoverage] = useState(line?.coverage ?? 'customer');
  const [priority, setPriority] = useState(line?.priority ?? '');
  const [busy, setBusy] = useState(false);
  const classes = useMemo(() => Array.from(new Map(d.rates.map((r) => [r.rate_class, r.label])).entries()), [d.rates]);
  const isPart = type === 'PART' || type === 'CONSUMABLE';
  const save = async () => {
    setBusy(true);
    const body: Record<string, unknown> = { line_type: type, description: desc, qty: Number(qty), discount_pct: Number(disc) || 0, coverage, priority: priority || null };
    if (type === 'LABOUR') {
      body.rate_class = rateClass;
      body.labour_minutes = Number(minutes);
    } else if (isPart) {
      body.product_id = part?.id;
      if (price !== '') body.unit_price = Number(price);
    } else {
      body.unit_price = Number(price) || 0;
    }
    try {
      const r = await gPost(line ? `/estimates/${est.id}/lines/${line.id}` : `/estimates/${est.id}/lines`, body);
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
      title={line ? 'Change line' : `Add a line to v${est.version}`}
      onClose={onClose}
      width={620}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={isPart && !part} onClick={() => void save()}>
            Save line
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select aria-label="Line type" value={type} disabled={!!line} onChange={(e) => setType(e.target.value)} options={d.line_types.map((t) => ({ value: t, label: nice(t) }))} className={input} />
          </Field>
          <Field label="Who pays">
            <Select aria-label="Who pays" value={coverage} onChange={(e) => setCoverage(e.target.value)} options={d.coverage.map((c) => ({ value: c, label: c === 'customer' ? 'The customer' : c === 'amc' ? 'AMC' : nice(c) }))} className={input} />
          </Field>
        </div>
        {isPart ? (
          <Field label="Part *">
            {part ? (
              <div className="flex items-center justify-between rounded-[8px] border border-line px-3 py-2 text-[13px]">
                <span>{part.name}</span>
                {!line ? (
                  <button type="button" className="text-[12px] font-semibold text-primary" onClick={() => setPart(null)}>
                    Change
                  </button>
                ) : null}
              </div>
            ) : (
              <PartPicker
                jobId={jobId}
                currency={d.currency}
                onPick={(p: PartHit) => {
                  setPart({ id: p.id, name: p.name });
                  setPrice(String(p.unit_price));
                }}
              />
            )}
          </Field>
        ) : null}
        <Field label="Description" hint={type === 'LABOUR' ? 'Left empty, it says the rate and the time.' : isPart ? "Left empty, it is the part's name." : undefined}>
          <input className={input} aria-label="Description" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </Field>
        {type === 'LABOUR' ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Labour rate">
              <Select aria-label="Labour rate" value={rateClass} onChange={(e) => setRateClass(e.target.value)} options={classes.map(([c, l]) => ({ value: c, label: l }))} className={input} />
            </Field>
            <Field label="Minutes">
              <input className={input} inputMode="numeric" aria-label="Minutes" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ''))} />
            </Field>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity">
              <input className={input} inputMode="decimal" aria-label="Quantity" value={qty} onChange={(e) => setQty(e.target.value)} />
            </Field>
            <Field label="Unit price" hint={isPart ? "Inventory's price unless changed." : undefined}>
              <input className={input} inputMode="decimal" aria-label="Unit price" value={price} onChange={(e) => setPrice(e.target.value)} />
            </Field>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Discount %" hint={`Above ${d.discount_limit}% needs a manager.`}>
            <input className={input} inputMode="decimal" aria-label="Discount %" value={disc} onChange={(e) => setDisc(e.target.value)} />
          </Field>
          <Field label="Urgency">
            <Select
              aria-label="Urgency"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              options={[
                { value: '', label: 'Not set' },
                { value: 'RED', label: 'Urgent' },
                { value: 'AMBER', label: 'Soon' },
                { value: 'GREEN', label: 'Advisory' },
              ]}
              className={input}
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function AddRecommendations({ d, est, onClose, onSaved }: { d: EstimatesView; est: EstimateVersion; onClose: () => void; onSaved: () => void }) {
  const open = d.recommendations.filter((r) => r.status === 'OPEN');
  const [ids, setIds] = useState<number[]>(open.map((r) => r.id));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await gPost(`/estimates/${est.id}/recommendations`, { ids });
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
      title="Add recommendations"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={ids.length === 0} onClick={() => void save()}>
            Add {ids.length}
          </Button>
        </div>
      }
    >
      <p className="m-0 mb-2 text-[12.5px] text-ink-3">Labour at the general rate for the time suggested, and the part where there is one.</p>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {open.map((r) => (
          <li key={r.id}>
            <label className="flex items-start gap-2 text-[13px]">
              <Checkbox className="mt-1" checked={ids.includes(r.id)} onChange={(e) => setIds(e.target.checked ? [...ids, r.id] : ids.filter((x) => x !== r.id))} />
              <span>
                <LightPill value={r.priority} /> {r.description}
                <span className="block text-[11.5px] text-ink-3">
                  {nice(r.source_type)}
                  {r.labour_minutes ? ` · ${span(r.labour_minutes)}` : ''}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function SendEstimate({ est, onClose, onSent, onRefused }: { est: EstimateVersion; onClose: () => void; onSent: (link: string) => void; onRefused: () => void }) {
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const r = await gPost<{ link?: string }>(`/estimates/${est.id}/send`, { message, email }, newKey('est-send'));
      toast('success', r.message);
      onSent(r.data?.link ?? '');
    } catch (e) {
      toast('error', errorText(e));
      if (codeOf(e) === 'discount') onRefused();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Send estimate v${est.version}`}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="send" loading={busy} onClick={() => void send()}>
            Send
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[13px] text-ink-2">
          {money(est.total, est.currency)} · {est.lines.length} line{est.lines.length === 1 ? '' : 's'}. Once sent, this version is locked. The customer gets a link to approve each line, leave it for later or reject it, and to sign.
        </p>
        <Field label="Message to the customer">
          <textarea className={cx(input, 'h-auto py-2')} rows={3} aria-label="Message to the customer" value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-[13px]">
          <Checkbox checked={email} onChange={(e) => setEmail(e.target.checked)} /> Email the link to the customer
        </label>
      </div>
    </Modal>
  );
}

/** The customer's link, shown once — to copy into WhatsApp or a text message if it was not emailed. */
function LinkNotice({ link, onClose }: { link: string; onClose: () => void }) {
  const copy = () => {
    void navigator.clipboard?.writeText(link).then(
      () => toast('success', 'Copied.'),
      () => toast('error', 'The link could not be copied; select it and copy it.'),
    );
  };
  return (
    <Modal
      title="The customer's link"
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <p className="m-0 mb-2 text-[12.5px] text-ink-3">Share it by WhatsApp or a text message if it was not emailed. It is shown only now.</p>
      <div className="flex items-center gap-2">
        <input className={cx(input, 'font-mono text-[12px]')} readOnly value={link} aria-label="Estimate link" onFocus={(e) => e.target.select()} />
        <Button icon="copy" onClick={copy}>
          Copy
        </Button>
      </div>
    </Modal>
  );
}

function RecordDecision({ est, customerName, onClose, onSaved }: { est: EstimateVersion; customerName: string; onClose: () => void; onSaved: () => void }) {
  const [dec, setDec] = useState<Record<number, Decision>>({});
  const [method, setMethod] = useState('phone');
  const [name, setName] = useState(customerName);
  const [note, setNote] = useState('');
  const [sig, setSig] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const all = est.lines.every((l) => dec[l.id]);
  const anyApproved = Object.values(dec).includes('APPROVED');
  const needsSig = method === 'in_person' && anyApproved;
  const setAll = (v: Decision) => setDec(Object.fromEntries(est.lines.map((l) => [l.id, v])));
  const save = async () => {
    setBusy(true);
    try {
      const r = await gPost(`/estimates/${est.id}/decision`, { method, decisions: dec, name, note, signature: sig ?? undefined }, newKey('est-decide'));
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
      title={`Record the decision on v${est.version}`}
      onClose={onClose}
      width={660}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!all || !name.trim() || !note.trim() || (needsSig && !sig)} onClick={() => void save()}>
            Record decision
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[12.5px] text-ink-3">A decision given by phone, at the counter or by email, recorded naming who gave it.</p>
        <div className="flex gap-3 text-[12px]">
          <button type="button" className="font-semibold text-success" onClick={() => setAll('APPROVED')}>
            Approve all
          </button>
          <button type="button" className="font-semibold text-danger" onClick={() => setAll('REJECTED')}>
            Reject all
          </button>
        </div>
        <ul className="m-0 flex list-none flex-col divide-y divide-line rounded-[10px] border border-line p-0">
          {est.lines.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0 text-[13px]">
                {l.description} <span className="text-[12px] text-ink-3">{money(l.total, est.currency)}</span>
              </span>
              <span className="flex gap-1" role="radiogroup" aria-label={`Decision on ${l.description}`}>
                {(['APPROVED', 'DEFERRED', 'REJECTED'] as Decision[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={dec[l.id] === v}
                    onClick={() => setDec({ ...dec, [l.id]: v })}
                    className={cx(
                      'rounded-[7px] border px-2 py-1 text-[12px] font-semibold',
                      dec[l.id] === v ? (v === 'APPROVED' ? 'border-success bg-success text-white' : v === 'REJECTED' ? 'border-danger bg-danger text-white' : 'border-warning bg-warning text-white') : 'border-line bg-surface text-ink-2',
                    )}
                  >
                    {DECISION_WORD[v]}
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-2 gap-3">
          <Field label="How">
            <Select
              aria-label="How the customer decided"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              options={[
                { value: 'phone', label: 'By phone' },
                { value: 'in_person', label: 'In person' },
                { value: 'email', label: 'By email' },
              ]}
              className={input}
            />
          </Field>
          <Field label="Who decided *">
            <input className={input} aria-label="Who decided" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <Field label="Note *" hint="e.g. Called 077… at 10:15, spoke to the owner.">
          <textarea className={cx(input, 'h-auto py-2')} rows={2} aria-label="Decision note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {method === 'in_person' ? (
          <Field label={needsSig ? "Customer's signature *" : "Customer's signature"}>
            <SignaturePad onChange={setSig} />
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}
