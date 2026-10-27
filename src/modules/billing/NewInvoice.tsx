import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { app } from '../../core/app-state';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { dateLabel, todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Select } from '../../components/Select';
import { cx } from '../../components/ui';
import { btn, btnPrimary, Field, input, Sheet } from '../../components/PageKit';
import { amount, can, createInvoice, dueFor, fetchPeople, fetchSettings, fetchTaxes, fetchWarehouses, issueInvoice, K, lineNet, searchCustomers, TYPES, useBillingOrgs, type Customer } from './api';
import { Lines, blankLine, toSend, type EditLine } from './Lines';

/**
 * Create a new invoice (BillNewInvoice). It starts as a draft — nothing is
 * numbered until it is issued, which "Create invoice" does straight away for
 * those who may issue. Bill to is not typed here: when the invoice is issued
 * the server takes it from the customer's own record (name, billing address,
 * tax number), so a typed one would be replaced. Ship to is kept as typed.
 */
export default function NewInvoice({ org, onClose }: { org: string; onClose: (createdId?: number) => void }) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const me = useStore(app, (s) => s.bootstrap?.user?.id ?? null);
  const orgs = useBillingOrgs();
  const taxes = useQuery({ queryKey: K.taxes, queryFn: ({ signal }) => fetchTaxes(signal), staleTime: 300_000 });
  const settings = useQuery({ queryKey: K.settings, queryFn: ({ signal }) => fetchSettings(signal), staleTime: 300_000 });
  const houses = useQuery({ queryKey: K.warehouses, queryFn: ({ signal }) => fetchWarehouses(signal), staleTime: 300_000 });
  const canPeople = !!perms && (perms.includes('*') || perms.includes('users.view'));
  const people = useQuery({ queryKey: ['billing', 'people'], queryFn: ({ signal }) => fetchPeople(signal), enabled: canPeople, retry: false, staleTime: 300_000 });
  const defaultTaxes = (taxes.data ?? []).filter((t) => t.is_default).map((t) => t.id);

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [hits, setHits] = useState<Customer[]>([]);
  const [term, setTerm] = useState('');
  const [searching, setSearching] = useState(false);
  const [company, setCompany] = useState(/^\d+$/.test(org) ? org : '');
  const [house, setHouse] = useState('');
  const [type, setType] = useState('standard');
  const [issueDate, setIssueDate] = useState(todayInZone());
  const [termsTyped, setTerms] = useState<string | null>(null);
  const [po, setPo] = useState('');
  const [agent, setAgent] = useState('');
  const [shipName, setShipName] = useState('');
  const [shipAddress, setShipAddress] = useState('');
  const [lines, setLines] = useState<EditLine[] | null>(null);
  const [discount, setDiscount] = useState('');
  const [discountPct, setDiscountPct] = useState(false);
  const [notes, setNotes] = useState('');
  const [termsText, setTermsText] = useState('');
  const [busy, setBusy] = useState<'draft' | 'issue' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const rows = lines ?? [blankLine(defaultTaxes)];
  const termsDays = termsTyped ?? String(settings.data?.payment_terms_days ?? 14);
  const due = dueFor(issueDate, Number(termsDays));
  const several = (orgs.data ?? []).length > 1;
  const subtotal = rows.reduce((s, l) => s + lineNet(l), 0);
  const disc = Number(discount.replace(/,/g, '')) || 0;
  const discountAmount = discountPct ? Math.round(subtotal * Math.min(100, disc)) / 100 : disc;
  const sendable = toSend(rows);
  const ready = !!customer && sendable.length > 0 && (!several || !!company) && /^\d{4}-\d{2}-\d{2}$/.test(issueDate);

  const search = (q: string) => {
    setTerm(q);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setSearching(true);
      searchCustomers(q, company || org)
        .then(setHits, () => setHits([]))
        .finally(() => setSearching(false));
    }, 250);
  };

  const create = async (issueNow: boolean) => {
    if (!ready || !customer) return;
    setBusy(issueNow ? 'issue' : 'draft');
    try {
      const r = await createInvoice({
        client_id: customer.id,
        type,
        issue_date: issueDate,
        payment_terms_days: Math.max(0, Math.round(Number(termsDays) || 0)),
        ...(company ? { org_id: Number(company) } : (orgs.data ?? []).length === 1 ? { org_id: orgs.data![0]!.id } : {}),
        ...(po.trim() ? { po_number: po.trim() } : {}),
        ...(agent ? { owner_id: Number(agent) } : {}),
        ...(house ? { warehouse_id: Number(house) } : {}),
        ...(shipName.trim() ? { ship_to_name: shipName.trim() } : {}),
        ...(shipAddress.trim() ? { ship_to_address: shipAddress.trim() } : {}),
        ...(discountAmount > 0 ? { discount: discountAmount } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(termsText.trim() ? { terms: termsText.trim() } : {}),
        lines: sendable,
      });
      const id = r.invoice.id;
      if (issueNow) {
        try {
          const issued = await issueInvoice(id);
          toast('success', issued.message ?? 'Issued.');
          for (const p of issued.data.posting?.problems ?? []) toast('error', p);
        } catch (e) {
          // The draft exists; say why it was not issued and open it so it can be put right.
          toast('error', `Saved as a draft, not issued: ${errorMessage(e)}`);
        }
      } else {
        toast('success', 'Draft invoice saved. Nothing is numbered until it is issued.');
      }
      void qc.invalidateQueries({ queryKey: K.all });
      onClose(id);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const currency = (company ? orgs.data?.find((o) => String(o.id) === company)?.currency : null) ?? String(settings.data?.base_currency ?? '');

  return (
    <Sheet
      title="Create new invoice"
      width={920}
      onClose={() => onClose()}
      footer={
        <>
          <button type="button" className={btn} onClick={() => onClose()}>
            Cancel
          </button>
          <button type="button" className={btn} disabled={!!busy || !ready} onClick={() => void create(false)}>
            {busy === 'draft' ? 'Saving…' : 'Save as draft'}
          </button>
          {can(perms, 'billing.issue') ? (
            <button type="button" className={btnPrimary} title="Gives the invoice its number. This cannot be undone." disabled={!!busy || !ready} onClick={() => void create(true)}>
              {busy === 'issue' ? 'Issuing…' : 'Create invoice'}
            </button>
          ) : null}
        </>
      }
    >
      <p className="m-0 text-[12.5px] text-ink-3">Starts as a draft — nothing is numbered until you issue it.</p>
      <div className="grid grid-cols-4 gap-2.5" data-new-invoice>
        <Field label="Customer *" className="col-span-2">
          <Select<string>
            aria-label="Customer"
            value={customer ? String(customer.id) : ''}
            onSearch={search}
            loading={searching}
            empty={term ? 'No customer matches.' : 'Type to find a customer.'}
            placeholder="Select customer…"
            options={[...(customer && !hits.some((h) => h.id === customer.id) ? [customer] : []), ...hits].map((c) => ({ value: String(c.id), label: c.name, hint: [c.email, c.outstanding > 0 ? `owes ${amount(c.outstanding, c.currency)}` : null].filter(Boolean).join(' · ') || undefined }))}
            onValueChange={(v) => setCustomer([...hits, ...(customer ? [customer] : [])].find((c) => String(c.id) === v) ?? null)}
            className={input}
          />
        </Field>
        {several ? (
          <Field label="Company *">
            <Select<string> aria-label="Company" searchable value={company} onValueChange={setCompany} placeholder="Choose the company" options={(orgs.data ?? []).map((o) => ({ value: String(o.id), label: o.name }))} className={input} />
          </Field>
        ) : null}
        <Field label="Type">
          <Select<string> aria-label="Type" value={type} onValueChange={setType} options={TYPES.map((t) => ({ value: t.id, label: t.label }))} className={input} />
        </Field>
        <Field label="Invoice date">
          <input aria-label="Invoice date" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={input} />
        </Field>
        <Field label="Payment terms (days)" hint={due ? `Due ${dateLabel(due)}` : undefined}>
          <input aria-label="Payment terms (days)" type="number" min={0} max={365} value={termsDays} onChange={(e) => setTerms(e.target.value)} className={input} />
        </Field>
        <Field label="Customer PO number">
          <input aria-label="Customer PO number" value={po} maxLength={60} onChange={(e) => setPo(e.target.value)} className={input} />
        </Field>
        {(houses.data ?? []).length ? (
          <Field label="Warehouse">
            <Select<string> aria-label="Warehouse" searchable value={house} onValueChange={setHouse} options={[{ value: '', label: 'None' }, ...(houses.data ?? []).map((h) => ({ value: String(h.id), label: h.name, hint: h.code ?? undefined }))]} className={input} />
          </Field>
        ) : null}
        {people.data?.length ? (
          <Field label="Sale agent" hint="Accountable for the invoice — one person">
            <Select<string>
              aria-label="Sale agent"
              searchable
              value={agent}
              onValueChange={setAgent}
              options={[{ value: '', label: 'Me' }, ...people.data.filter((p) => String(p.id) !== me).map((p) => ({ value: String(p.id), label: p.name }))]}
              className={input}
            />
          </Field>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="flex flex-col gap-1 rounded-[10px] border border-line px-3 py-2.5">
          <b className="text-[12.5px] text-ink">Bill to</b>
          <span className="text-[12.5px] text-ink-2">{customer ? customer.name : 'The customer'}</span>
          <span className="text-[11.5px] text-ink-3">Taken from the customer's own record — name, billing address and tax number — when the invoice is issued, and kept as it was that day.</span>
        </div>
        <div className="flex flex-col gap-1.5 rounded-[10px] border border-line px-3 py-2.5">
          <b className="text-[12.5px] text-ink">Ship to</b>
          <input aria-label="Ship to name" value={shipName} maxLength={190} placeholder="Name" onChange={(e) => setShipName(e.target.value)} className={input + ' !h-[30px]'} />
          <input aria-label="Ship to address" value={shipAddress} maxLength={400} placeholder="Address" onChange={(e) => setShipAddress(e.target.value)} className={input + ' !h-[30px]'} />
          <span className="text-[11.5px] text-ink-3">Left blank when nothing ships — it is not assumed to be the billing address.</span>
        </div>
      </div>
      <div className="rounded-[10px] border border-line px-3 py-2.5">
        <Lines lines={rows} onChange={setLines} taxes={taxes.data ?? []} currency={currency} defaultTaxes={defaultTaxes} />
      </div>
      <div className="flex items-center justify-end gap-2 text-[12.5px]">
        <span className="text-ink-2">Discount on the invoice</span>
        <span className="flex overflow-hidden rounded-[7px] border border-line">
          {[false, true].map((p) => (
            <button key={String(p)} type="button" aria-pressed={discountPct === p} onClick={() => setDiscountPct(p)} className={cx('h-[30px] px-2.5 text-[12px] font-bold', discountPct === p ? 'bg-primary text-white' : 'bg-surface text-ink-2')}>
              {p ? '%' : currency || 'Amount'}
            </button>
          ))}
        </span>
        <input aria-label="Discount on the invoice" inputMode="decimal" value={discount} placeholder="0.00" onChange={(e) => setDiscount(e.target.value)} className={input + ' !h-[30px] !w-[120px] tabular-nums'} />
        {discountPct && discountAmount > 0 ? <span className="text-ink-3 tabular-nums">= {amount(discountAmount, currency)}</span> : null}
      </div>
      <p className="m-0 self-end text-[11.5px] text-ink-3">Taxes, the discount across the lines and any withholding are worked out by the server when the invoice is saved.</p>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Notes" hint="Printed on the invoice">
          <textarea aria-label="Notes" value={notes} placeholder="Optional notes…" onChange={(e) => setNotes(e.target.value)} className={input + ' !h-[56px] resize-none py-2'} />
        </Field>
        <Field label="Terms and conditions" hint="From Billing settings when left blank">
          <textarea aria-label="Terms and conditions" value={termsText} onChange={(e) => setTermsText(e.target.value)} className={input + ' !h-[56px] resize-none py-2'} />
        </Field>
      </div>
    </Sheet>
  );
}
