import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { Button, ErrorNote, Modal, Spinner, cx } from '../../../components/ui';
import { toast } from '../../../core/toasts';
import { errorText, FUEL_LABEL, gGet, gPost, K, money, newKey, nice, qty, when, type DeliveryView, type QualityCheck } from '../api';
import { Ask, DocActions, Field, input, Section, SignaturePad, ToneNote, useGarage } from '../parts';
import { Pill } from '../../inventory/parts';
import { Checkbox } from '../../../components/Checkbox';

const RESULT_ON: Record<string, string> = { PASS: 'border-success bg-success text-white', FAIL: 'border-danger bg-danger text-white', NA: 'border-ink-3 bg-ink-3 text-white' };
const QC_TONE: Record<string, 'blue' | 'amber' | 'red' | 'green' | 'grey'> = { PENDING: 'grey', IN_PROGRESS: 'blue', PASSED: 'green', FAILED: 'red', REWORK_REQUIRED: 'red' };

/**
 * Quality to handover (WF-16..18): the quality check and its rework, the
 * road test, the final review, and — for people who handle money — the
 * invoice, payment, release and the handover itself with the customer's
 * signature and the delivery note. Every gate is the server's; this shows
 * what it says is left.
 */
export default function DeliveryTab({ jobId, number, onChange }: { jobId: number; number: string; onChange: () => void }) {
  const qc = useQueryClient();
  const key = K.delivery(jobId);
  const q = useQuery({ queryKey: key, queryFn: ({ signal }) => gGet<DeliveryView>(`/jobs/${jobId}/delivery`, undefined, signal) });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error ?? new Error('This could not be loaded.')} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const reload = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: K.work(jobId) });
    onChange();
  };
  return (
    <div className="flex flex-col gap-4">
      <QualitySection d={d} onChange={reload} />
      {d.road_test_needed || d.road_tests.length > 0 ? <RoadTestSection d={d} jobId={jobId} onChange={reload} /> : null}
      {['QUALITY_CHECK', 'ROAD_TEST'].includes(d.job_status) ? <ReviewSection d={d} jobId={jobId} onChange={reload} /> : null}
      {d.can.money ? <MoneySection d={d} jobId={jobId} onChange={reload} /> : null}
      <HandoverSection d={d} jobId={jobId} number={number} onChange={reload} />
    </div>
  );
}

function QualitySection({ d, onChange }: { d: DeliveryView; onChange: () => void }) {
  const g = useGarage();
  const [failing, setFailing] = useState<QualityCheck | null>(null);
  const [passing, setPassing] = useState(false);
  const [busy, setBusy] = useState(false);
  const current = d.checks[0] ?? null;
  const older = d.checks.slice(1);
  const mine = current?.status === 'IN_PROGRESS' && current.inspector_id === d.me;
  const code = (id: number) => d.work_orders.find((w) => w.id === id)?.code ?? '';
  const send = async (path: string, body: Record<string, unknown> = {}, key?: string) => {
    setBusy(true);
    try {
      const r = await gPost(path, body, key ? newKey(key) : undefined);
      toast('success', r.message);
      setPassing(false);
      onChange();
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };
  if (!current) {
    return (
      <Section title="Quality check">
        <p className="m-0 text-[13px] text-ink-3">It opens when every work order is completed.</p>
      </Section>
    );
  }
  return (
    <Section
      title={`Quality check${current.attempt > 1 ? ` · attempt ${current.attempt}` : ''}`}
      action={
        <span className="flex items-center gap-2">
          <Pill tone={QC_TONE[current.status] ?? 'grey'}>{nice(current.status)}</Pill>
          {current.status === 'PENDING' && d.can.perform ? (
            <Button size="sm" variant="primary" loading={busy} disabled={!d.self_qc || !g.online} title={d.self_qc ? undefined : 'You worked on this job'} onClick={() => void send(`/quality-checks/${current.id}/start`)}>
              Start
            </Button>
          ) : null}
          {mine && d.can.approve ? (
            <Button size="sm" disabled={!g.online} onClick={() => setFailing(current)}>
              Fail
            </Button>
          ) : null}
          {mine && d.can.approve ? (
            <Button size="sm" variant="primary" disabled={!g.online} onClick={() => setPassing(true)}>
              Pass
            </Button>
          ) : null}
        </span>
      }
    >
      {current.status === 'PENDING' && !d.self_qc ? <p className="m-0 mb-2 text-[12px] font-semibold text-warning">You worked on this job; someone else checks it.</p> : null}
      {current.inspector ? (
        <p className="m-0 mb-2 text-[12px] text-ink-3">
          Inspector {current.inspector}
          {current.completed_at ? ` · ${when(current.completed_at)}` : ''}
        </p>
      ) : null}
      <ul className="m-0 flex list-none flex-col divide-y divide-line rounded-[10px] border border-line p-0">
        {current.items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span className="text-[13px]">
              {i.label}
              {i.mandatory ? null : <span className="ml-1 text-[11px] text-ink-3">(optional)</span>}
              {i.note ? <span className="ml-2 text-[12px] text-ink-3">— {i.note}</span> : null}
            </span>
            <span className="flex gap-1" role="radiogroup" aria-label={`${i.label} result`}>
              {(['PASS', 'FAIL', 'NA'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={i.result === r}
                  disabled={!mine || busy || !g.online}
                  onClick={() => void send(`/quality-checks/${current.id}`, { items: [{ id: i.id, result: i.result === r ? '' : r }] })}
                  className={cx('rounded-[7px] border px-2.5 py-1 text-[12px] font-bold disabled:cursor-default', i.result === r ? RESULT_ON[r] : 'border-line bg-surface text-ink-3')}
                >
                  {r === 'NA' ? 'N/A' : r === 'PASS' ? 'Pass' : 'Fail'}
                </button>
              ))}
            </span>
          </li>
        ))}
      </ul>
      {older.length > 0 || d.rework.length > 0 ? (
        <div className="mt-3 flex flex-col gap-1 text-[12px] text-ink-3">
          {older.map((c) => (
            <p key={c.id} className="m-0">
              Attempt {c.attempt}: {nice(c.status).toLowerCase()}
              {c.fail_reason ? ` — ${c.fail_reason}` : ''}
              {c.inspector ? ` (${c.inspector})` : ''}
            </p>
          ))}
          {d.rework.map((r) => (
            <p key={r.id} className="m-0">
              Rework on {code(r.work_order_id)}: {r.reason} · {r.completed_at ? `done ${when(r.completed_at)}` : 'open'}
            </p>
          ))}
        </div>
      ) : null}
      {failing ? (
        <FailCheck
          check={failing}
          d={d}
          onClose={() => setFailing(null)}
          onDone={() => {
            setFailing(null);
            onChange();
          }}
        />
      ) : null}
      {passing ? (
        <Ask
          title="Pass the quality check?"
          text="Every item passed. Next: the road test where one is needed, then the final review."
          fields={[{ name: 'note', label: 'Note' }]}
          confirm="Pass"
          busy={busy}
          onClose={() => setPassing(false)}
          onSubmit={(v) => void send(`/quality-checks/${current.id}/pass`, { note: v.note }, 'qc-pass')}
        />
      ) : null}
    </Section>
  );
}

/** Fail the check (FR-QC-05): what is wrong, and the work orders that go back as rework (not billed). */
function FailCheck({ check, d, onClose, onDone }: { check: QualityCheck; d: DeliveryView; onClose: () => void; onDone: () => void }) {
  const failed = check.items.filter((i) => i.result === 'FAIL');
  const [reason, setReason] = useState(failed.map((i) => i.note || i.label).join('; '));
  const [wos, setWos] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await gPost(`/quality-checks/${check.id}/fail`, { reason, work_order_ids: wos }, newKey('qc-fail'));
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
      title="Fail the quality check"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} disabled={failed.length === 0 || !reason.trim() || wos.length === 0} onClick={() => void save()}>
            Fail and send back
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[12.5px] text-ink-3">{failed.length ? `Failed: ${failed.map((i) => i.label).join(', ')}` : 'Mark what failed first.'}</p>
        <Field label="What is wrong *">
          <textarea className={cx(input, 'h-auto py-2')} rows={2} aria-label="What is wrong" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="flex flex-col gap-1">
          <span className="text-[12.5px] font-semibold text-ink-2">Send back for rework</span>
          {d.work_orders
            .filter((w) => w.status === 'COMPLETED')
            .map((w) => (
              <label key={w.id} className="flex items-center gap-2 text-[13px]">
                <Checkbox checked={wos.includes(w.id)} onChange={(e) => setWos(e.target.checked ? [...wos, w.id] : wos.filter((x) => x !== w.id))} />
                {w.code} · {w.work_type}
                {w.technicians[0] ? <span className="text-[12px] text-ink-3">({w.technicians[0].name})</span> : null}
              </label>
            ))}
        </div>
        <p className="m-0 text-[12px] text-ink-3">Rework time is recorded as rework and not billed to the customer.</p>
      </div>
    </Modal>
  );
}

function RoadTestSection({ d, jobId, onChange }: { d: DeliveryView; jobId: number; onChange: () => void }) {
  const g = useGarage();
  const [open, setOpen] = useState(false);
  const qcPassed = d.checks[0]?.status === 'PASSED';
  return (
    <Section
      title={`Road test${d.road_test_needed ? '' : ' (not needed for this job)'}`}
      action={
        d.can.road_test && qcPassed && ['QUALITY_CHECK', 'ROAD_TEST'].includes(d.job_status) ? (
          <Button size="sm" variant="primary" disabled={!g.online} onClick={() => setOpen(true)}>
            Record road test
          </Button>
        ) : null
      }
    >
      {d.road_tests.length === 0 ? (
        <p className="m-0 text-[13px] text-ink-3">{qcPassed ? 'Not done yet.' : 'After the quality check passes.'}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {d.road_tests.map((t) => (
            <li key={t.id} className="text-[13px]">
              <Pill tone={t.result === 'PASSED' ? 'green' : 'red'}>{nice(t.result)}</Pill> {t.end_km - t.start_km} km
              {t.minutes ? ` · ${t.minutes} min` : ''}
              {t.route ? ` · ${t.route}` : ''} · {t.driver ?? '—'}
              {t.new_issue ? <span className="block text-[12px] text-danger">New issue: {t.new_issue}</span> : null}
              <span className="block text-[11px] text-ink-3">{when(t.at)}</span>
            </li>
          ))}
        </ul>
      )}
      {open ? (
        <RoadTestForm
          d={d}
          jobId={jobId}
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            onChange();
          }}
        />
      ) : null}
    </Section>
  );
}

function RoadTestForm({ d, jobId, onClose, onDone }: { d: DeliveryView; jobId: number; onClose: () => void; onDone: () => void }) {
  const [start, setStart] = useState(String(d.odometer_now ?? ''));
  const [end, setEnd] = useState('');
  const [minutes, setMinutes] = useState('');
  const [route, setRoute] = useState('');
  const [verified, setVerified] = useState(false);
  const [fixed, setFixed] = useState(false);
  const [issue, setIssue] = useState('');
  const [wos, setWos] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => newKey('road-test'));
  const passing = verified && fixed && !issue.trim();
  const save = async () => {
    setBusy(true);
    try {
      const r = await gPost(
        `/jobs/${jobId}/road-test`,
        { start_km: Number(start), end_km: Number(end), minutes: Number(minutes) || undefined, route, repair_verified: verified, issue_confirmed_fixed: fixed, new_issue: issue, rework_work_order_ids: passing ? [] : wos, reason: issue },
        key,
      );
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
      title="Road test"
      onClose={onClose}
      width={560}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <span className={cx('text-[13px] font-semibold', passing ? 'text-success' : 'text-danger')}>{passing ? 'Passes' : 'Fails'}</span>
          <span className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} disabled={!start || !end} onClick={() => void save()}>
              Record
            </Button>
          </span>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Start km">
            <input className={input} inputMode="numeric" aria-label="Start km" value={start} onChange={(e) => setStart(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label="End km">
            <input className={input} inputMode="numeric" aria-label="End km" value={end} onChange={(e) => setEnd(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label="Minutes">
            <input className={input} inputMode="numeric" aria-label="Minutes" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ''))} />
          </Field>
        </div>
        <Field label="Route">
          <input className={input} aria-label="Route" value={route} onChange={(e) => setRoute(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-[13px]">
          <Checkbox checked={fixed} onChange={(e) => setFixed(e.target.checked)} /> The customer's complaint is fixed
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <Checkbox checked={verified} onChange={(e) => setVerified(e.target.checked)} /> The repair is verified on the road
        </label>
        <Field label="New issue found">
          <textarea className={cx(input, 'h-auto py-2')} rows={2} aria-label="New issue found" value={issue} onChange={(e) => setIssue(e.target.value)} />
        </Field>
        {!passing ? (
          <div className="flex flex-col gap-1">
            <span className="text-[12.5px] font-semibold text-ink-2">Send back for rework (optional)</span>
            {d.work_orders
              .filter((w) => w.status === 'COMPLETED')
              .map((w) => (
                <label key={w.id} className="flex items-center gap-2 text-[13px]">
                  <Checkbox checked={wos.includes(w.id)} onChange={(e) => setWos(e.target.checked ? [...wos, w.id] : wos.filter((x) => x !== w.id))} /> {w.code} · {w.work_type}
                </label>
              ))}
            <span className="text-[12px] text-ink-3">Or raise additional work from the Work tab for something new.</span>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/** The final review (FR-DLV-01): each check with its detail, and the customer's items to confirm. */
function ReviewSection({ d, jobId, onChange }: { d: DeliveryView; jobId: number; onChange: () => void }) {
  const g = useGarage();
  const [present, setPresent] = useState(false);
  const [busy, setBusy] = useState(false);
  const rest = d.review.filter((c) => c.key !== 'items');
  const allOk = rest.every((c) => c.ok);
  const items = d.review.find((c) => c.key === 'items');
  const ready = async () => {
    setBusy(true);
    try {
      const r = await gPost(`/jobs/${jobId}/ready`, { items_present: present }, newKey('ready'));
      toast('success', r.message);
      onChange();
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Final review">
      <ul className="m-0 grid list-none gap-x-6 gap-y-1.5 p-0 sm:grid-cols-2">
        {rest.map((c) => (
          <li key={c.key} className="flex items-start gap-2 text-[13px]">
            <Icon name={c.ok ? 'check-circle' : 'warning'} size={16} className={cx('mt-0.5 shrink-0', c.ok ? 'text-success' : 'text-warning')} />
            <span>
              <span className={c.ok ? 'text-ink' : 'font-semibold text-warning'}>{c.label}</span>
              <span className="block text-[12px] text-ink-3">{c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <label className="mt-3 flex items-start gap-2 text-[13px]">
        <Checkbox className="mt-1" checked={present} onChange={(e) => setPresent(e.target.checked)} />
        <span>
          The customer's items are present
          <span className="block text-[12px] text-ink-3">{items?.detail}</span>
        </span>
      </label>
      {d.can.complete ? (
        <div className="mt-3 flex justify-end">
          <Button variant="primary" loading={busy} disabled={!allOk || !present || !g.online} onClick={() => void ready()}>
            Mark ready for delivery
          </Button>
        </div>
      ) : null}
    </Section>
  );
}

/** The invoice from what was approved (FR-DLV-02) and payment into it (FR-DLV-04): Billing's figures, read back. */
function MoneySection({ d, jobId, onChange }: { d: DeliveryView; jobId: number; onChange: () => void }) {
  const g = useGarage();
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);
  const [raiseKey] = useState(() => newKey('invoice'));
  const [payKey, setPayKey] = useState(() => newKey('pay'));
  const inv = d.invoice ?? null;
  const c = d.charges;
  const raise = async () => {
    setBusy(true);
    try {
      const r = await gPost(`/jobs/${jobId}/invoice`, {}, raiseKey);
      toast('success', r.message);
      onChange();
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const pay = async (v: Record<string, string>) => {
    setBusy(true);
    try {
      const r = await gPost(`/jobs/${jobId}/pay`, { amount: Number(v.amount), method: v.method, reference: v.reference }, payKey);
      toast('success', r.message);
      setPaying(false);
      setPayKey(newKey('pay'));
      onChange();
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };
  if (!inv && d.job_status !== 'READY_FOR_DELIVERY') return null;
  return (
    <Section
      title="Invoice and payment"
      action={
        inv ? (
          d.can.pay && inv.outstanding > 0 ? (
            <Button size="sm" variant="primary" disabled={!g.online} onClick={() => setPaying(true)}>
              Take payment
            </Button>
          ) : null
        ) : d.can.invoice ? (
          <Button size="sm" variant="primary" loading={busy} disabled={!g.online} onClick={() => void raise()}>
            Raise invoice
          </Button>
        ) : null
      }
    >
      {inv ? (
        <dl className="m-0 grid grid-cols-2 gap-y-1 text-[13px] sm:grid-cols-4">
          <div>
            <dt className="text-[11.5px] text-ink-3">Invoice</dt>
            <dd className="m-0 font-mono font-semibold">{inv.number ?? 'draft'}</dd>
          </div>
          <div>
            <dt className="text-[11.5px] text-ink-3">Total</dt>
            <dd className="m-0 tabular-nums">{money(inv.total, inv.currency)}</dd>
          </div>
          <div>
            <dt className="text-[11.5px] text-ink-3">Paid</dt>
            <dd className="m-0 tabular-nums">{money(inv.paid, inv.currency)}</dd>
          </div>
          <div>
            <dt className="text-[11.5px] text-ink-3">Outstanding</dt>
            <dd className={cx('m-0 tabular-nums', inv.outstanding > 0 ? 'font-semibold text-warning' : 'text-success')}>{money(inv.outstanding, inv.currency)}</dd>
          </div>
        </dl>
      ) : c ? (
        <>
          <table className="w-full text-left text-[13px]">
            <tbody>
              {c.lines.map((l) => (
                <tr key={l.line_id} className="border-b border-line/70 last:border-b-0">
                  <td className="py-1.5">
                    {l.description}
                    {l.qty !== l.approved_qty ? (
                      <span className="ml-1 text-[12px] text-ink-3">
                        (used {qty(l.qty)} of {qty(l.approved_qty)} approved)
                      </span>
                    ) : null}
                  </td>
                  <td className="text-right tabular-nums">{money(l.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {c.covered.length > 0 ? <p className="m-0 mt-2 text-[12px] text-ink-3">Not charged: {c.covered.map((l) => `${l.description} (${l.coverage})`).join(', ')}</p> : null}
          <p className="m-0 mt-2 text-right text-[13px] font-bold">With tax: {money(c.total, g.options.currency)}</p>
        </>
      ) : null}
      {paying && inv ? (
        <Ask
          title={`Payment for ${inv.number ?? 'the invoice'}`}
          text={`${money(inv.outstanding, inv.currency)} outstanding.`}
          fields={[
            { name: 'amount', label: 'Amount', type: 'number', initial: String(inv.outstanding), required: true },
            {
              name: 'method',
              label: 'How',
              type: 'select',
              options: [
                { value: 'cash', label: 'Cash' },
                { value: 'card', label: 'Card' },
                { value: 'bank_transfer', label: 'Bank transfer' },
                { value: 'online', label: 'Online' },
                { value: 'cheque', label: 'Cheque' },
              ],
            },
            { name: 'reference', label: 'Reference', placeholder: 'Card slip, transfer reference…' },
          ]}
          confirm="Take payment"
          busy={busy}
          onClose={() => setPaying(false)}
          onSubmit={(v) => void pay(v)}
        />
      ) : null}
    </Section>
  );
}

function HandoverSection({ d, jobId, number, onChange }: { d: DeliveryView; jobId: number; number: string; onChange: () => void }) {
  const g = useGarage();
  const [open, setOpen] = useState(false);
  const [credit, setCredit] = useState(false);
  const [busy, setBusy] = useState(false);
  const h = d.handover;
  const saveCredit = async (v: Record<string, string>) => {
    setBusy(true);
    try {
      const limit = (v.limit ?? '').trim();
      const r = await gPost(`/customers/${d.client_id}/credit`, { limit: limit === '' ? null : Number(limit), note: v.note, org: g.org });
      toast('success', r.message);
      setCredit(false);
      onChange();
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };
  if (h) {
    return (
      <Section title="Handed over" action={<DocActions doc={{ kind: 'delivery-note', job: jobId }} name={`${number} delivery note.html`} label="Delivery note" what="delivery note" />}>
        <p className="m-0 text-[13px]">
          To <b>{h.received_by}</b>
          {h.received_relation ? ` (${h.received_relation})` : ''} on {when(h.delivered_at)} by {h.delivered_by ?? '—'} · {h.odometer_out.toLocaleString()} {g.options.units}
          {h.fuel_out !== null ? ` · fuel ${FUEL_LABEL[h.fuel_out] ?? h.fuel_out}` : ''}
        </p>
        <p className="m-0 text-[12px] text-ink-3">
          Released {h.release_basis === 'PAID' ? 'paid' : h.release_basis === 'CREDIT' ? 'on credit terms' : `by override: ${h.override_reason ?? ''}`}
          {h.items.length ? ` · handed back ${h.items.join(', ')}` : ''}
        </p>
      </Section>
    );
  }
  if (d.job_status !== 'INVOICE_PENDING') return null;
  return (
    <Section
      title="Handover"
      action={
        <span className="flex gap-2">
          {d.can.credit ? (
            <Button size="sm" variant="ghost" disabled={!g.online} onClick={() => setCredit(true)}>
              Credit terms
            </Button>
          ) : null}
          {d.can.complete ? (
            <Button size="sm" variant="primary" disabled={!g.online} onClick={() => setOpen(true)}>
              Hand over
            </Button>
          ) : null}
        </span>
      }
    >
      {d.release ? (
        <p className={cx('m-0 text-[13px]', d.release.basis ? 'text-success' : 'text-warning')}>
          {d.release.message}
          {!d.release.basis && !d.can.override ? ' A manager releases it.' : ''}
        </p>
      ) : (
        <p className="m-0 text-[13px] text-ink-3">The vehicle is handed over once it is paid, on credit terms, or released by a manager.</p>
      )}
      {open ? (
        <HandoverForm
          d={d}
          jobId={jobId}
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            toast('success', 'Handed over.');
            onChange();
          }}
        />
      ) : null}
      {credit ? (
        <Ask
          title={`Credit terms for ${d.customer ?? 'this customer'}`}
          text="Up to this much may be owed when a vehicle leaves. Empty for none."
          fields={[
            { name: 'limit', label: 'Credit limit', type: 'number', initial: d.release?.credit_limit != null ? String(d.release.credit_limit) : '' },
            { name: 'note', label: 'Note', placeholder: 'Fleet account, 30 days' },
          ]}
          busy={busy}
          onClose={() => setCredit(false)}
          onSubmit={(v) => void saveCredit(v)}
        />
      ) : null}
    </Section>
  );
}

/** The handover (FR-DLV-06): who takes it, the odometer and fuel, what goes back, the signature; and why, when a manager releases it unpaid. */
function HandoverForm({ d, jobId, onClose, onDone }: { d: DeliveryView; jobId: number; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(d.customer ?? '');
  const [relation, setRelation] = useState('');
  const [odo, setOdo] = useState(String(d.odometer_now ?? d.odometer_in ?? ''));
  const [fuel, setFuel] = useState('');
  const [items, setItems] = useState<string[]>(d.accessories);
  const [returned, setReturned] = useState(false);
  const [notes, setNotes] = useState('');
  const [why, setWhy] = useState('');
  const [sig, setSig] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => newKey('handover'));
  const override = d.release ? !d.release.basis : false;
  const save = async () => {
    setBusy(true);
    try {
      await gPost(
        `/jobs/${jobId}/handover`,
        {
          received_by: name,
          received_relation: relation,
          odometer: Number(odo),
          fuel_level: fuel === '' ? undefined : Number(fuel),
          items,
          removed_returned: returned,
          notes,
          signature: sig ?? undefined,
          override_reason: override ? why : undefined,
        },
        key,
      );
      onDone();
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Hand the vehicle over"
      onClose={onClose}
      width={620}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!name.trim() || !odo || !sig || (override && (!d.can.override || !why.trim()))} onClick={() => void save()}>
            Hand over
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Taken by *">
            <input className={input} aria-label="Taken by" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Who they are">
            <input className={input} aria-label="Who they are" placeholder="Owner, driver…" value={relation} onChange={(e) => setRelation(e.target.value)} />
          </Field>
          <Field label="Odometer *">
            <input className={input} inputMode="numeric" aria-label="Odometer out" value={odo} onChange={(e) => setOdo(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label="Fuel">
            <Select aria-label="Fuel" value={fuel} onChange={(e) => setFuel(e.target.value)} options={[{ value: '', label: '—' }, ...Object.entries(FUEL_LABEL).map(([v, l]) => ({ value: v, label: l }))]} className={input} />
          </Field>
        </div>
        {d.accessories.length > 0 ? (
          <div className="flex flex-col gap-1">
            <span className="text-[12.5px] font-semibold text-ink-2">Handed back</span>
            <div className="flex flex-wrap gap-3">
              {d.accessories.map((a) => (
                <label key={a} className="flex items-center gap-1.5 text-[13px]">
                  <Checkbox checked={items.includes(a)} onChange={(e) => setItems(e.target.checked ? [...items, a] : items.filter((x) => x !== a))} /> {a}
                </label>
              ))}
            </div>
          </div>
        ) : null}
        <label className="flex items-center gap-2 text-[13px]">
          <Checkbox checked={returned} onChange={(e) => setReturned(e.target.checked)} /> Removed parts the customer keeps are returned
        </label>
        <Field label="Notes">
          <input className={input} aria-label="Handover notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {override ? (
          d.can.override ? (
            <Field label="Why it leaves unpaid *" hint={d.release?.message}>
              <input className={input} aria-label="Why it leaves unpaid" value={why} onChange={(e) => setWhy(e.target.value)} />
            </Field>
          ) : (
            <ToneNote>{d.release?.message} A manager releases it.</ToneNote>
          )
        ) : null}
        <Field label="Signature *">
          <SignaturePad onChange={setSig} />
        </Field>
      </div>
    </Modal>
  );
}
