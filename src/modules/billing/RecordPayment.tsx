import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { app } from '../../core/app-state';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Select } from '../../components/Select';
import { btn, btnPrimary, Field, input, SidePanel } from '../hr/parts';
import { amount, fetchBankAccounts, K, METHODS, recordPayment, searchCustomers, useBillingOrgs, type Customer, type InvoiceDetail } from './api';
import { Checkbox } from '../../components/Checkbox';

/**
 * Record a payment (BillPaymentSheet, BillInvoiceIssued): money that has
 * already arrived. On an invoice it is allocated to that invoice, in the
 * invoice's own currency and company (a payment only settles invoices in its
 * own company). From the dashboard it is a receipt for a customer: settled
 * against their oldest invoices, or held on account to allocate later.
 * Nothing here charges a card or moves money.
 */
export default function RecordPayment({ invoice, org, onClose }: { invoice?: InvoiceDetail; org: string; onClose: () => void }) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const orgs = useBillingOrgs();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [term, setTerm] = useState('');
  const [company, setCompany] = useState(/^\d+$/.test(org) ? org : '');
  const [value, setValue] = useState(invoice ? invoice.due.toFixed(2) : '');
  const [paidOn, setPaidOn] = useState(todayInZone());
  const [method, setMethod] = useState('bank_transfer');
  const [bank, setBank] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [oldestFirst, setOldestFirst] = useState(true);
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<Customer[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const search = (q: string) => {
    setTerm(q);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setSearching(true);
      searchCustomers(q, org)
        .then(setHits, () => setHits([]))
        .finally(() => setSearching(false));
    }, 250);
  };

  const onlyOrg = (orgs.data ?? []).length === 1 ? String(orgs.data![0]!.id) : '';
  const whose = invoice ? (invoice.org_id ? String(invoice.org_id) : '') : company || onlyOrg;
  const canBank = !!perms && (perms.includes('*') || perms.includes('finance.view'));
  const banks = useQuery({ queryKey: ['billing', 'banks', whose], queryFn: ({ signal }) => fetchBankAccounts(Number(whose), signal), enabled: canBank && !!whose && method !== 'cash', retry: false, staleTime: 300_000 });
  const clientId = invoice ? invoice.client_id : customer?.id;
  const sum = Number(value.replace(/,/g, ''));
  const ready = !!clientId && sum > 0 && /^\d{4}-\d{2}-\d{2}$/.test(paidOn) && (invoice ? true : (orgs.data ?? []).length <= 1 || !!company);

  const save = async () => {
    if (!ready || !clientId) return;
    setBusy(true);
    try {
      const r = await recordPayment({
        client_id: clientId,
        amount: sum,
        method,
        paid_on: paidOn,
        ...(invoice ? { currency: invoice.currency } : {}),
        ...(whose ? { org_id: Number(whose) } : {}),
        ...(bank ? { bank_account_id: Number(bank) } : {}),
        ...(reference.trim() ? { bank_reference: reference.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        allocate: invoice ? [{ invoice_id: invoice.id, amount: Math.min(sum, invoice.due) }] : oldestFirst ? 'auto' : null,
      });
      const n = r.allocation.count;
      toast('success', n > 0 ? `Payment ${r.payment.reference} recorded and allocated across ${n} ${n === 1 ? 'invoice' : 'invoices'}.` : `Payment ${r.payment.reference} recorded on account.`);
      for (const e of r.allocation.errors) toast('error', e);
      void qc.invalidateQueries({ queryKey: K.all });
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel
      label="Record a payment"
      width={420}
      onClose={onClose}
      head={
        <span className="flex min-w-0 flex-col">
          <b className="text-[15px] text-ink">Record a payment</b>
          <span className="truncate text-[12px] text-ink-3">{invoice ? `${invoice.number ?? `Draft #${invoice.id}`} · ${invoice.client ?? 'No customer'}` : 'Money that has already arrived'}</span>
        </span>
      }
    >
      {!invoice ? (
        <Field label="Customer">
          <Select<string>
            aria-label="Customer"
            value={customer ? String(customer.id) : ''}
            onSearch={search}
            loading={searching}
            empty={term ? 'No customer matches.' : 'Type to find a customer.'}
            placeholder="Choose a customer"
            options={[...(customer && !hits.some((h) => h.id === customer.id) ? [customer] : []), ...hits].map((c) => ({ value: String(c.id), label: c.name, hint: c.outstanding > 0 ? `owes ${amount(c.outstanding, c.currency)}` : (c.email ?? undefined) }))}
            onValueChange={(v) => setCustomer([...hits, ...(customer ? [customer] : [])].find((c) => String(c.id) === v) ?? null)}
            className={input}
          />
        </Field>
      ) : null}
      <div className="grid grid-cols-2 gap-2.5">
        <Field label={`Amount${invoice ? ` (${invoice.currency})` : ''}`} hint={invoice ? `Outstanding: ${amount(invoice.due, invoice.currency)}` : undefined}>
          <input aria-label="Amount" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className={input + ' tabular-nums'} />
        </Field>
        <Field label="Received on">
          <input aria-label="Received on" type="date" value={paidOn} max={todayInZone()} onChange={(e) => setPaidOn(e.target.value)} className={input} />
        </Field>
      </div>
      <Field label="Method">
        <Select<string> aria-label="Method" value={method} onValueChange={setMethod} options={METHODS.map((m) => ({ value: m.id, label: m.label }))} className={input} />
      </Field>
      {!invoice && (orgs.data ?? []).length > 1 ? (
        <Field label="Company" hint="Whose books this receipt belongs in. It settles only that company's invoices.">
          <Select<string> aria-label="Company" searchable value={company} onValueChange={setCompany} placeholder="Choose the company" options={(orgs.data ?? []).map((o) => ({ value: String(o.id), label: o.name }))} className={input} />
        </Field>
      ) : null}
      {banks.data && method !== 'cash' ? (
        <Field label="Bank account">
          <Select<string>
            aria-label="Bank account"
            value={bank}
            onValueChange={setBank}
            options={[{ value: '', label: 'Use the company default' }, ...banks.data.accounts.map((a) => ({ value: String(a.id), label: `${a.code ? `${a.code} ` : ''}${a.name}`, hint: a.currency ?? undefined }))]}
            className={input}
          />
        </Field>
      ) : null}
      <Field label="Bank reference" hint="What appears on the statement">
        <input aria-label="Bank reference" value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} className={input} />
      </Field>
      <Field label="Note">
        <textarea aria-label="Note" value={note} maxLength={400} onChange={(e) => setNote(e.target.value)} className={input + ' !h-[52px] resize-none py-2'} />
      </Field>
      {!invoice ? (
        <label className="flex items-start gap-2 text-[12.5px] text-ink">
          <Checkbox checked={oldestFirst} onChange={(e) => setOldestFirst(e.target.checked)} className="mt-0.5" />
          <span>
            <b>Settle the oldest invoices first.</b>
            <span className="block text-ink-3">Leave this off to hold the money on account and decide later.</span>
          </span>
        </label>
      ) : null}
      {invoice && sum > invoice.due + 0.005 ? <p className="m-0 rounded-[8px] bg-warning-bg px-3 py-2 text-[12px] text-[#9A4A06] dark:text-warning">More than is owed: {amount(invoice.due, invoice.currency)} settles the invoice and the rest stays on the customer's account.</p> : null}
      <p className="m-0 rounded-[8px] bg-subtle px-3 py-2 text-[12px] leading-relaxed text-ink-2">This records money that has already moved. Nothing here charges a card or transfers funds.</p>
      <div className="mt-auto flex justify-end gap-2 border-t border-line pt-3">
        <button type="button" className={btn} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={btnPrimary} disabled={busy || !ready} onClick={() => void save()}>
          {busy ? 'Recording…' : 'Record payment'}
        </button>
      </div>
    </SidePanel>
  );
}
