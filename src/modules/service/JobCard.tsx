import { Checkbox } from '../../components/Checkbox';
import { useState } from 'react';
import { money, needsReason, nextStatuses, statusLabel, type ServiceStatus } from '@shared/service';
import { Button, cx, ErrorNote, OfflineNote, Spinner } from '../../components/ui';
import { useAddDiagnostic, useAddPart, useCreateInvoice, useCreateQuote, useHandover, useJob, usePart, useQa, useQuoteDecision, useReturnPart, useTransition, type Job, type QuoteItem } from './api';
import StockPicker from './StockPicker';
import { deviceName, input, StatusChip, when } from './parts';

const TABS = ['overview', 'diagnosis', 'parts', 'quotation', 'financials', 'qa', 'activity'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { overview: 'Overview', diagnosis: 'Diagnosis', parts: 'Parts', quotation: 'Quotation', financials: 'Financials', qa: 'QA & Handover', activity: 'Activity Log' };

/** One repair job (blueprint §5 job detail): its status steps and the tabs. Every change is the server's to accept. */
/** `onRoute` opens another desktop module's screen (the part in Inventory, the invoice in Billing). */
export default function JobCard({ id, offline, onClose, onWeb, onRoute }: { id: string; offline: boolean; onClose?: () => void; onWeb: (path: string) => void; onRoute: (route: string) => void }) {
  const job = useJob(id);
  const [tab, setTab] = useState<Tab>('overview');
  if (job.isPending) return <Spinner />;
  if (job.isError) return <div className="p-4"><ErrorNote error={job.error} onRetry={() => void job.refetch()} /></div>;
  const j = job.data.data;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <h2 className="text-[16px] font-bold">{j.number}</h2>
        <StatusChip status={j.status} />
        {j.under_warranty ? <span className="text-[12px] font-semibold text-success">Under warranty</span> : null}
        {job.data.offline ? <OfflineNote cachedAt={job.data.cachedAt} /> : null}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" icon="external" onClick={() => onWeb(`/service/jobs/${j.id}`)}>Open on the web</Button>
        {onClose ? <Button size="sm" variant="ghost" onClick={onClose}>Close</Button> : null}
      </header>
      <Steps job={j} offline={offline} />
      <nav role="tablist" aria-label="Job" className="flex gap-1 overflow-x-auto border-b border-line px-3">
        {TABS.map((t) => <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)} className={cx('border-b-2 px-2 py-1.5 text-[12.5px] whitespace-nowrap', tab === t ? 'border-primary font-bold' : 'border-transparent text-ink-2')}>{TAB_LABEL[t]}</button>)}
      </nav>
      <div className="min-h-0 flex-1 overflow-auto p-3 text-[13px] scroll-thin">
        {tab === 'overview' ? <Overview j={j} /> : tab === 'diagnosis' ? <Diagnosis j={j} offline={offline} /> : tab === 'parts' ? <Parts j={j} offline={offline} onRoute={onRoute} /> : tab === 'quotation' ? <Quotation j={j} offline={offline} /> : tab === 'financials' ? <Financials j={j} offline={offline} onRoute={onRoute} /> : tab === 'qa' ? <Qa j={j} offline={offline} /> : <ActivityLog j={j} />}
      </div>
    </div>
  );
}

function Steps({ job, offline }: { job: Job; offline: boolean }) {
  const move = useTransition(job);
  const [asking, setAsking] = useState<ServiceStatus | null>(null);
  const [note, setNote] = useState('');
  const [visible, setVisible] = useState(true);
  const next = nextStatuses(String(job.status));
  if (!next.length) return null;
  const go = (to: ServiceStatus, n?: string) => move.mutate({ to, note: n || undefined, customer_visible: visible }, { onSuccess: () => { setAsking(null); setNote(''); } });
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
      <span className="text-[12px] text-ink-3">Move to</span>
      {next.map((to) => <Button key={to} size="sm" variant={to === 'cancelled' || to === 'unrepairable' ? 'ghost' : 'secondary'} disabled={offline || move.isPending} onClick={() => (needsReason(to) ? setAsking(to) : go(to))}>{statusLabel(to)}</Button>)}
      {asking ? (
        <div className="flex w-full items-center gap-2 pt-1">
          <input aria-label="Reason" autoFocus placeholder={`Why: ${statusLabel(asking)}`} value={note} onChange={(e) => setNote(e.target.value)} className={input} />
          <label className="flex items-center gap-1 text-[12px] whitespace-nowrap"><Checkbox checked={visible} onChange={(e) => setVisible(e.target.checked)} />Customer sees it</label>
          <Button size="sm" variant="primary" disabled={!note.trim() || move.isPending} onClick={() => go(asking, note.trim())}>Confirm</Button>
          <Button size="sm" variant="ghost" onClick={() => setAsking(null)}>Back</Button>
        </div>
      ) : null}
      {move.isError ? <p className="w-full text-[12px] text-danger">{(move.error as Error).message}</p> : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="text-[11.5px] text-ink-3">{label}</div><div className="font-medium">{children || '—'}</div></div>;
}

function Overview({ j }: { j: Job }) {
  const d = j.device;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Field label="Customer">{j.customer?.name}{j.customer?.phone ? ` · ${j.customer.phone}` : ''}</Field>
        <Field label="Device">{deviceName(d)}</Field>
        <Field label="IMEI / Serial">{d?.imei ?? d?.serial}</Field>
        <Field label="Technician">{j.technician?.name ?? 'Unassigned'}</Field>
        <Field label="Priority"><span className="capitalize">{j.priority}</span></Field>
        <Field label="Promised">{when(j.promised_at)}</Field>
        <Field label="Condition">{d?.condition}</Field>
        <Field label="Accessories">{j.accessories?.join(', ')}</Field>
      </div>
      <Field label="Reported problem">{j.problem}</Field>
      {j.internal_notes ? <div className="rounded-[8px] bg-warning-bg p-2"><div className="text-[11.5px] font-semibold text-warning">Internal notes — not shown to the customer</div>{j.internal_notes}</div> : null}
      {j.intake_checklist?.length ? (
        <section><h3 className="mb-1 font-bold">Intake checklist ({j.intake_checklist.filter((c) => c.done).length} of {j.intake_checklist.length})</h3>
          <ul>{j.intake_checklist.map((c) => <li key={c.label} className={c.done ? '' : 'text-ink-3'}>{c.done ? '☑' : '☐'} {c.label}</li>)}</ul></section>
      ) : null}
      {j.history?.length ? (
        <section><h3 className="mb-1 font-bold">Status history</h3>
          <ol className="flex flex-col gap-1">{j.history.map((h) => <li key={h.id} className="flex gap-2"><span className="w-[120px] shrink-0 text-ink-3">{when(h.at)}</span><StatusChip status={h.to} /><span className="text-ink-2">{h.by}{h.note ? ` — ${h.note}` : ''}</span></li>)}</ol></section>
      ) : null}
    </div>
  );
}

function Diagnosis({ j, offline }: { j: Job; offline: boolean }) {
  const add = useAddDiagnostic(j.id);
  const [f, setF] = useState({ finding: '', cause: '', recommendation: '' });
  return (
    <div className="flex flex-col gap-3">
      {(j.diagnostics ?? []).map((d) => (
        <div key={d.id} className="rounded-[8px] border border-line p-2">
          <div className="font-semibold">{d.finding}</div>
          {d.cause ? <div><span className="text-ink-3">Cause: </span>{d.cause}</div> : null}
          {d.recommendation ? <div><span className="text-ink-3">Repair: </span>{d.recommendation}</div> : null}
          <div className="text-[11.5px] text-ink-3">{d.by} · {when(d.at)}</div>
        </div>
      ))}
      {!j.diagnostics?.length ? <p className="text-ink-3">No findings yet.</p> : null}
      <fieldset disabled={offline} className="flex flex-col gap-1.5 rounded-[8px] border border-line p-2">
        <legend className="px-1 font-semibold">Add a finding</legend>
        <input aria-label="Finding" placeholder="Finding" value={f.finding} onChange={(e) => setF({ ...f, finding: e.target.value })} className={input} />
        <input aria-label="Cause" placeholder="Cause" value={f.cause} onChange={(e) => setF({ ...f, cause: e.target.value })} className={input} />
        <input aria-label="Recommended repair" placeholder="Recommended repair" value={f.recommendation} onChange={(e) => setF({ ...f, recommendation: e.target.value })} className={input} />
        <div><Button size="sm" variant="primary" disabled={!f.finding.trim() || add.isPending} onClick={() => add.mutate(f, { onSuccess: () => setF({ finding: '', cause: '', recommendation: '' }) })}>Add finding</Button></div>
        {add.isError ? <p className="text-[12px] text-danger">{(add.error as Error).message}</p> : null}
      </fieldset>
    </div>
  );
}

function Parts({ j, offline, onRoute }: { j: Job; offline: boolean; onRoute: (route: string) => void }) {
  const reserve = usePart(j.id, 'reserve');
  const consume = usePart(j.id, 'consume');
  const add = useAddPart(j.id);
  const back = useReturnPart(j.id);
  const [own, setOwn] = useState({ name: '', qty: 1 });
  const err = reserve.error ?? consume.error ?? add.error ?? back.error;
  const busy = offline || reserve.isPending || consume.isPending || add.isPending || back.isPending;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] text-ink-3">Parts come from Inventory. Reserving holds a part for this job; stock is deducted only when it is marked used.</p>
      <table className="w-full text-[12.5px]">
        <thead className="text-left text-ink-3"><tr><th className="py-1">Part</th><th>Qty</th><th>State</th><th>Price</th><th /></tr></thead>
        <tbody>
          {(j.parts ?? []).map((p) => (
            <tr key={p.id} className="border-t border-line">
              <td className="py-1">
                {p.product_id ? <button type="button" className="font-medium underline-offset-2 hover:underline" title="Open in Inventory" onClick={() => onRoute(`/inventory?product=${p.product_id}`)}>{p.name}</button> : p.name}
                {p.sku ? <span className="text-ink-3"> · {p.sku}</span> : null}{p.warehouse ? <span className="text-ink-3"> · {p.warehouse}</span> : null}{p.customer_supplied ? <span className="text-ink-3"> · customer's own</span> : null}
              </td>
              <td>{p.qty}</td><td className="capitalize">{p.state}</td><td>{p.customer_supplied ? '—' : money(p.unit_price, j.currency ?? 'LKR')}</td>
              <td className="space-x-1 text-right whitespace-nowrap">
                {p.state === 'required' && !p.customer_supplied ? <Button size="sm" disabled={busy} onClick={() => reserve.mutate({ part_id: p.id, qty: p.qty })}>Reserve</Button> : null}
                {p.state === 'reserved' || (p.state === 'required' && p.customer_supplied) ? <Button size="sm" disabled={busy} onClick={() => consume.mutate({ part_id: p.id, qty: p.qty })}>Mark used</Button> : null}
                {p.state === 'reserved' && !p.customer_supplied ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => back.mutate({ part_id: p.id, qty: p.qty, condition: 'good' })}>Release</Button> : null}
                {p.state === 'used' && !p.customer_supplied ? <Button size="sm" variant="ghost" disabled={busy} title="Back to stock as defective" onClick={() => back.mutate({ part_id: p.id, qty: p.qty, condition: 'defective' })}>Return defective</Button> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!j.parts?.length ? <p className="text-ink-3">No parts on this job.</p> : null}
      <fieldset disabled={offline} className="flex flex-col gap-1.5 rounded-[8px] border border-line p-2">
        <legend className="px-1 font-semibold">Add a part</legend>
        <StockPicker disabled={busy} onPick={(sp) => add.mutate({ product_id: sp.product_id, qty: 1, unit_price: sp.unit_price, reserve: (sp.available ?? sp.on_hand ?? 1) > 0 })} />
        <div className="flex items-center gap-1.5">
          <input aria-label="Customer's own part" placeholder="Or the customer's own part" value={own.name} onChange={(e) => setOwn({ ...own, name: e.target.value })} className={input} />
          <input aria-label="Quantity" type="number" min={1} value={own.qty} onChange={(e) => setOwn({ ...own, qty: Number(e.target.value) })} className={cx(input, 'w-[70px]')} />
          <Button size="sm" disabled={busy || !own.name.trim() || own.qty < 1} onClick={() => add.mutate({ name: own.name.trim(), qty: own.qty, customer_supplied: true }, { onSuccess: () => setOwn({ name: '', qty: 1 }) })}>Add</Button>
        </div>
        <p className="text-[11.5px] text-ink-3">A stocked part is reserved when some is free; otherwise it waits as required. A customer's own part is never added to stock.</p>
      </fieldset>
      {err ? <p className="text-[12px] text-danger">{(err as Error).message}</p> : null}
    </div>
  );
}

const blankItem = (): QuoteItem => ({ kind: 'labour', description: '', qty: 1, unit_price: 0 });

function Quotation({ j, offline }: { j: Job; offline: boolean }) {
  const create = useCreateQuote(j.id);
  const approve = useQuoteDecision('approve');
  const reject = useQuoteDecision('reject');
  const [items, setItems] = useState<QuoteItem[]>([blankItem()]);
  const [discount, setDiscount] = useState(0);
  const cur = j.currency ?? 'LKR';
  const subtotal = items.reduce((s, i) => s + i.qty * i.unit_price, 0);
  const set = (n: number, patch: Partial<QuoteItem>) => setItems(items.map((it, k) => (k === n ? { ...it, ...patch } : it)));
  const valid = items.length > 0 && items.every((i) => i.description.trim() && i.qty > 0 && i.unit_price >= 0);
  const err = create.error ?? approve.error ?? reject.error;
  return (
    <div className="flex flex-col gap-3">
      {(j.quotes ?? []).slice().sort((a, b) => b.version - a.version).map((q) => (
        <div key={q.id} className="rounded-[8px] border border-line p-2">
          <div className="flex items-center gap-2"><span className="font-semibold">Version {q.version}</span><span className="capitalize text-ink-2">{q.status}</span><span className="flex-1" /><span className="font-bold">{money(q.total, q.currency ?? cur)}</span></div>
          <ul className="text-[12.5px]">{q.items.map((i, k) => <li key={k} className="flex justify-between"><span>{i.description} × {i.qty}</span><span>{money(i.qty * i.unit_price, q.currency ?? cur)}</span></li>)}</ul>
          {q.status === 'sent' ? (
            <div className="mt-1 flex gap-1.5">
              <Button size="sm" variant="primary" disabled={offline || approve.isPending} onClick={() => approve.mutate({ quote_id: q.id })}>Customer approved</Button>
              <Button size="sm" disabled={offline || reject.isPending} onClick={() => reject.mutate({ quote_id: q.id })}>Customer rejected</Button>
            </div>
          ) : null}
        </div>
      ))}
      <fieldset disabled={offline} className="flex flex-col gap-1.5 rounded-[8px] border border-line p-2">
        <legend className="px-1 font-semibold">{j.quotes?.length ? 'Revise the quotation' : 'New quotation'}</legend>
        {items.map((it, n) => (
          <div key={n} className="flex gap-1.5">
            <select aria-label="Kind" value={it.kind} onChange={(e) => set(n, { kind: e.target.value as QuoteItem['kind'], product_id: null })} className="rounded-[7px] border border-line bg-surface px-1 text-[13px]"><option value="diagnosis">Diagnosis</option><option value="labour">Labour</option><option value="part">Part</option><option value="other">Other</option></select>
            {it.kind === 'part' && !it.product_id ? (
              <StockPicker placeholder="Pick the part from Inventory" onPick={(sp) => set(n, { product_id: sp.product_id, description: sp.sku ? `${sp.name} (${sp.sku})` : sp.name, unit_price: sp.unit_price })} />
            ) : (
              <input aria-label="Description" placeholder="Description" value={it.description} onChange={(e) => set(n, { description: e.target.value, ...(it.kind === 'part' ? {} : { product_id: null }) })} className={input} />
            )}
            <input aria-label="Quantity" type="number" min={1} value={it.qty} onChange={(e) => set(n, { qty: Number(e.target.value) })} className={cx(input, 'w-[70px]')} />
            <input aria-label="Unit price" type="number" min={0} step="0.01" value={it.unit_price} onChange={(e) => set(n, { unit_price: Number(e.target.value) })} className={cx(input, 'w-[110px]')} />
            <Button size="sm" variant="ghost" aria-label="Remove line" onClick={() => setItems(items.filter((_, k) => k !== n))}>×</Button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setItems([...items, blankItem()])}>Add line</Button>
          <span className="flex-1" />
          <label className="flex items-center gap-1 text-[12.5px]">Discount<input aria-label="Discount" type="number" min={0} value={discount} onChange={(e) => setDiscount(Number(e.target.value))} className={cx(input, 'w-[100px]')} /></label>
          <span className="font-bold">{money(Math.max(0, subtotal - discount), cur)}</span>
          <Button size="sm" variant="primary" disabled={!valid || create.isPending} onClick={() => create.mutate({ items, discount }, { onSuccess: () => { setItems([blankItem()]); setDiscount(0); } })}>Save quotation</Button>
        </div>
        <p className="text-[11.5px] text-ink-3">Tax is worked out by the server. Work beyond an approved quotation needs the customer to approve a new version.</p>
      </fieldset>
      {err ? <p className="text-[12px] text-danger">{(err as Error).message}</p> : null}
    </div>
  );
}

function Financials({ j, offline, onRoute }: { j: Job; offline: boolean; onRoute: (route: string) => void }) {
  const make = useCreateInvoice(j.id);
  const cur = j.currency ?? 'LKR';
  const inv = j.invoice;
  const approved = (j.quotes ?? []).some((q) => q.status === 'approved');
  const billable = approved || !!j.under_warranty;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label="Total">{money(j.total, cur)}</Field><Field label="Deposit">{money(j.deposit, cur)}</Field>
        <Field label="Paid">{money(j.paid, cur)}</Field><Field label="Balance">{money(j.balance, cur)}</Field>
      </div>
      <Field label="Payment status"><span className="capitalize">{j.payment_status}</span></Field>
      <section className="rounded-[8px] border border-line p-2">
        <h3 className="mb-1 font-bold">Invoice</h3>
        {inv ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{inv.number ?? `Draft #${inv.id}`}</span>
            <span className="capitalize text-ink-2">{inv.status}</span>
            <span>{money(inv.total, inv.currency ?? cur)}</span>
            {inv.balance ? <span className="text-warning">Due {money(inv.balance, inv.currency ?? cur)}</span> : null}
            <span className="flex-1" />
            <Button size="sm" icon="receipt" onClick={() => onRoute(`/billing?invoice=${inv.id}`)}>Open in Invoices</Button>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <p className="text-[12.5px] text-ink-2">Made in Billing from the approved quotation's lines, the parts used and the deposit already taken. Nothing unapproved is charged.</p>
            <div><Button size="sm" variant="primary" disabled={offline || !billable || make.isPending} loading={make.isPending} onClick={() => make.mutate(undefined, { onSuccess: (r) => onRoute(`/billing?invoice=${r.invoice.id}`) })}>Create invoice</Button></div>
            {!billable ? <p className="text-[12px] text-ink-3">The customer has to approve a quotation first.</p> : null}
          </div>
        )}
        {make.isError ? <p className="mt-1 text-[12px] text-danger">{(make.error as Error).message}</p> : null}
      </section>
      <p className="text-[12px] text-ink-3">Payments, refunds and credit notes are taken on the invoice in Invoices.</p>
    </div>
  );
}

function Qa({ j, offline }: { j: Job; offline: boolean }) {
  const qa = useQa(j.id);
  const handover = useHandover(j.id);
  const base = (j.intake_checklist ?? []).map((c) => c.label);
  const [checks, setChecks] = useState(() => (base.length ? base : ['Device powers on', 'Reported fault fixed', 'No new faults']).map((label) => ({ label, ok: false })));
  const [note, setNote] = useState('');
  const [verified, setVerified] = useState(false);
  const [receiver, setReceiver] = useState(j.customer?.name ?? '');
  const passed = checks.every((c) => c.ok);
  return (
    <div className="flex flex-col gap-3">
      {(j.qa ?? []).map((r) => <div key={r.id} className={cx('rounded-[8px] p-2', r.passed ? 'bg-success-bg' : 'bg-danger-bg')}><b>{r.passed ? 'Passed' : 'Failed'}</b> · {r.by} · {when(r.at)}{r.note ? ` — ${r.note}` : ''}</div>)}
      {j.status === 'qa_testing' ? (
        <fieldset disabled={offline} className="flex flex-col gap-1 rounded-[8px] border border-line p-2">
          <legend className="px-1 font-semibold">Functional tests</legend>
          {checks.map((c, n) => <label key={c.label} className="flex items-center gap-2"><Checkbox checked={c.ok} onChange={(e) => setChecks(checks.map((x, k) => (k === n ? { ...x, ok: e.target.checked } : x)))} />{c.label}</label>)}
          <input aria-label="QA note" placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} className={input} />
          <div className="flex gap-1.5">
            <Button size="sm" variant="primary" disabled={!passed || qa.isPending} onClick={() => qa.mutate({ passed: true, checks, note })}>Pass</Button>
            <Button size="sm" disabled={qa.isPending || !note.trim()} title="Say what failed in the note" onClick={() => qa.mutate({ passed: false, checks, note })}>Fail — send for rework</Button>
          </div>
        </fieldset>
      ) : null}
      {j.status === 'ready_for_pickup' ? (
        <fieldset disabled={offline} className="flex flex-col gap-1.5 rounded-[8px] border border-line p-2">
          <legend className="px-1 font-semibold">Hand the device over</legend>
          {j.balance ? <p className="text-warning">Balance due: {money(j.balance, j.currency ?? 'LKR')}</p> : null}
          <input aria-label="Received by" placeholder="Received by" value={receiver} onChange={(e) => setReceiver(e.target.value)} className={input} />
          <label className="flex items-center gap-2"><Checkbox checked={verified} onChange={(e) => setVerified(e.target.checked)} />Identity verified (job receipt, ID or code)</label>
          <div><Button size="sm" variant="primary" disabled={!verified || !receiver.trim() || handover.isPending} onClick={() => handover.mutate({ identity_verified: true, received_by: receiver.trim() })}>Record handover</Button></div>
        </fieldset>
      ) : null}
      {j.warranty?.until ? <Field label="Warranty until">{when(j.warranty.until)}{j.warranty.terms ? ` — ${j.warranty.terms}` : ''}</Field> : null}
      {qa.error ?? handover.error ? <p className="text-[12px] text-danger">{((qa.error ?? handover.error) as Error).message}</p> : null}
    </div>
  );
}

function ActivityLog({ j }: { j: Job }) {
  if (!j.activity?.length) return <p className="text-ink-3">Nothing recorded yet.</p>;
  return <ol className="flex flex-col gap-1">{j.activity.map((a) => <li key={a.id} className="flex gap-2"><span className="w-[120px] shrink-0 text-ink-3">{when(a.at)}</span><span>{a.by ? <b>{a.by}: </b> : null}{a.text}</span></li>)}</ol>;
}
