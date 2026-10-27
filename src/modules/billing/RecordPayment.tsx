import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { app } from '../../core/app-state';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Select } from '../../components/Select';
import { cx } from '../../components/ui';
import { btn, btnPrimary, Field, input, SidePanel } from '../../components/PageKit';
import { amount, fetchBankAccounts, K, METHODS, recordPayment, searchCustomers, useBillingOrgs, type Customer, type InvoiceDetail } from './api';
import { Checkbox } from '../../components/Checkbox';
import { allocateFx, converted, fetchModes, KB, oldestFirst, openInvoicesOf, uploadSlip } from './more';
import { OFFLINE_WRITE, useBillingOffline } from './offline';

/**
 * Record a payment (D03, BillPaymentSheet): money that has already arrived.
 * On an invoice it is allocated to that invoice in the invoice's company; it
 * may have been paid in another currency, at a rate (G-17), and the invoice is
 * settled by its value in the invoice's currency. From the dashboard or the
 * payments list it is a receipt for a customer — "owes" beside their name —
 * settled against their oldest invoices (the split shown before it is made),
 * or held on account. The mode is the company's own payment mode, the account
 * its bank account, and the bank slip can be dropped on the panel to go with
 * it. Nothing here charges a card or moves money.
 */
export default function RecordPayment({ invoice, org, onClose }: { invoice?: InvoiceDetail; org: string; onClose: () => void }) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const orgs = useBillingOrgs();
  const offline = useBillingOffline();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [term, setTerm] = useState('');
  const [company, setCompany] = useState(/^\d+$/.test(org) ? org : '');
  const [value, setValue] = useState(invoice ? invoice.due.toFixed(2) : '');
  const [paidOn, setPaidOn] = useState(todayInZone());
  const [mode, setMode] = useState('');
  const [method, setMethod] = useState('bank_transfer');
  const [bank, setBank] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [oldest, setOldest] = useState(true);
  const [currency, setCurrency] = useState(invoice?.currency ?? '');
  const [rate, setRate] = useState('');
  const [slips, setSlips] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<Customer[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pick = useRef<HTMLInputElement | null>(null);
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
  const modes = useQuery({ queryKey: KB.modes(whose), queryFn: ({ signal }) => fetchModes(whose, signal), retry: false, staleTime: 300_000 });
  const activeModes = (modes.data ?? []).filter((m) => m.is_active && m.kind !== 'offset');
  const chosenMode = activeModes.find((m) => String(m.id) === mode);
  const kind = chosenMode?.kind ?? method;
  const banks = useQuery({ queryKey: ['billing', 'banks', whose], queryFn: ({ signal }) => fetchBankAccounts(Number(whose), signal), enabled: canBank && !!whose && kind !== 'cash', retry: false, staleTime: 300_000 });
  const clientId = invoice ? invoice.client_id : customer?.id;
  const open = useQuery({ queryKey: ['billing', 'open-invoices', clientId], queryFn: ({ signal }) => openInvoicesOf(clientId!, signal), enabled: !invoice && !!clientId });
  const sum = Number(value.replace(/,/g, ''));
  const foreign = !!invoice && !!currency && currency !== invoice.currency;
  const fx = Number(rate.replace(/,/g, ''));
  const settles = invoice ? (foreign ? (fx > 0 ? converted(sum, fx) : 0) : sum) : 0;
  const ready = !offline && !!clientId && sum > 0 && /^\d{4}-\d{2}-\d{2}$/.test(paidOn) && (invoice ? !foreign || fx > 0 : (orgs.data ?? []).length <= 1 || !!company);
  // The receipt's currency: the customer's open invoices are in it, so "oldest first" spreads over those.
  const owing = (open.data ?? []).filter((i) => i.due > 0 && (!customer?.currency || i.currency === customer.currency));
  const plan = !invoice && oldest && sum > 0 ? oldestFirst(owing, sum) : {};

  const save = async () => {
    if (!ready || !clientId) return;
    setBusy(true);
    try {
      // In another currency the payment is recorded on account first, then settles the invoice at the rate (allocate-fx).
      const allocation = invoice ? (foreign ? null : [{ invoice_id: invoice.id, amount: Math.min(sum, invoice.due) }]) : oldest ? ('auto' as const) : null;
      const r = await recordPayment({
        client_id: clientId,
        amount: sum,
        method: kind,
        paid_on: paidOn,
        ...(invoice ? { currency: currency || invoice.currency } : {}),
        ...(whose ? { org_id: Number(whose) } : {}),
        ...(bank ? { bank_account_id: Number(bank) } : {}),
        ...(reference.trim() ? { bank_reference: reference.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        allocate: allocation,
      });
      let n = r.allocation.count;
      if (invoice && foreign) {
        try {
          await allocateFx(r.payment.id, { invoice_id: invoice.id, payment_amount: Math.min(sum, Math.round((invoice.due / fx) * 100) / 100), rate: fx });
          n = 1;
        } catch (e) {
          toast('error', `Recorded on account, but not set against ${invoice.number ?? 'the invoice'}: ${errorMessage(e)}`);
        }
      }
      toast('success', n > 0 ? `Payment ${r.payment.reference} recorded and allocated across ${n} ${n === 1 ? 'invoice' : 'invoices'}.` : `Payment ${r.payment.reference} recorded on account.`);
      for (const e of r.allocation.errors) toast('error', e);
      // The slips go with it once it exists; one that fails is said, and the payment stands.
      for (const f of slips) await uploadSlip(r.payment.id, f).catch((e) => toast('error', `${f.name}: ${errorMessage(e)}`));
      void qc.invalidateQueries({ queryKey: K.all });
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const addSlips = (files: FileList | File[] | null) => {
    const list = Array.from(files ?? []);
    const big = list.filter((f) => f.size > 10 * 1024 * 1024);
    for (const f of big) toast('error', `${f.name} is over 10 MB.`);
    setSlips((s) => [...s, ...list.filter((f) => f.size <= 10 * 1024 * 1024)]);
  };

  return (
    <SidePanel
      label="Record a payment"
      width={400}
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
            options={[...(customer && !hits.some((h) => h.id === customer.id) ? [customer] : []), ...hits].map((c) => ({
              value: String(c.id),
              label: c.outstanding > 0 ? `${c.name} — owes ${amount(c.outstanding, c.currency)}` : c.name,
              hint: c.outstanding > 0 ? undefined : (c.email ?? undefined),
            }))}
            onValueChange={(v) => setCustomer([...hits, ...(customer ? [customer] : [])].find((c) => String(c.id) === v) ?? null)}
            className={input}
          />
        </Field>
      ) : null}
      <div className="grid grid-cols-2 gap-2.5">
        <Field label={`Amount${invoice ? ` (${currency || invoice.currency})` : ''}`} hint={invoice ? `Outstanding: ${amount(invoice.due, invoice.currency)}` : undefined}>
          <input aria-label="Amount" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className={input + ' text-right font-semibold tabular-nums'} />
        </Field>
        <Field label="Received on">
          <input aria-label="Received on" type="date" value={paidOn} max={todayInZone()} onChange={(e) => setPaidOn(e.target.value)} className={input} />
        </Field>
        {activeModes.length ? (
          <Field label="Mode">
            <Select<string>
              aria-label="Mode"
              value={mode}
              onValueChange={setMode}
              placeholder="Choose the mode"
              options={activeModes.map((m) => ({ value: String(m.id), label: m.name, hint: METHODS.find((x) => x.id === m.kind)?.label }))}
              className={input}
            />
          </Field>
        ) : (
          <Field label="Method">
            <Select<string> aria-label="Method" value={method} onValueChange={setMethod} options={METHODS.map((m) => ({ value: m.id, label: m.label }))} className={input} />
          </Field>
        )}
        {banks.data && kind !== 'cash' ? (
          <Field label="Account">
            <Select<string>
              aria-label="Account"
              value={bank || (chosenMode?.bank_account_id ? String(chosenMode.bank_account_id) : '')}
              onValueChange={setBank}
              options={[{ value: '', label: 'The company default' }, ...banks.data.accounts.map((a) => ({ value: String(a.id), label: `${a.code ? `${a.code} ` : ''}${a.name}`, hint: a.currency ?? undefined }))]}
              className={input}
            />
          </Field>
        ) : null}
      </div>
      {invoice ? (
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Paid in" hint="Another currency settles at a rate">
            <input aria-label="Paid in" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} className={input + ' font-mono'} />
          </Field>
          {foreign ? (
            <Field label={`1 ${currency} = ? ${invoice.currency}`} hint={fx > 0 && sum > 0 ? `Settles ${amount(Math.min(settles, invoice.due), invoice.currency)}` : 'The rate the bank used'}>
              <input aria-label="Rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className={input + ' tabular-nums'} />
            </Field>
          ) : null}
        </div>
      ) : null}
      {!invoice && (orgs.data ?? []).length > 1 ? (
        <Field label="Company" hint="Whose books this receipt belongs in. It settles only that company's invoices.">
          <Select<string> aria-label="Company" searchable value={company} onValueChange={setCompany} placeholder="Choose the company" options={(orgs.data ?? []).map((o) => ({ value: String(o.id), label: o.name }))} className={input} />
        </Field>
      ) : null}
      <Field label="Bank reference" hint="What appears on the statement">
        <input aria-label="Bank reference" value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} className={input} />
      </Field>
      {!invoice ? (
        <div className="rounded-[8px] border border-line text-[12.5px]">
          <label className={cx('flex items-start gap-2 px-2.5 py-2 font-semibold text-ink', oldest && Object.keys(plan).length > 0 && 'border-b border-line')}>
            <Checkbox checked={oldest} onChange={(e) => setOldest(e.target.checked)} className="mt-0.5" />
            <span>
              Settle the oldest first
              {!oldest ? <span className="block font-normal text-ink-3">The money is held on account, to allocate later.</span> : null}
            </span>
          </label>
          {oldest
            ? owing
                .filter((i) => plan[i.id])
                .map((i) => (
                  <div key={i.id} className="flex justify-between px-2.5 py-[7px]">
                    <span className="text-ink">{i.number ?? `#${i.id}`}</span>
                    <b className={cx('tabular-nums', plan[i.id]! >= i.due - 0.005 ? 'text-success dark:text-success' : 'text-warning-ink dark:text-warning')}>{amount(plan[i.id], i.currency)}</b>
                  </div>
                ))
            : null}
        </div>
      ) : null}
      <Field label="Note">
        <textarea aria-label="Note" value={note} maxLength={400} onChange={(e) => setNote(e.target.value)} className={input + ' !h-[52px] resize-none py-2'} />
      </Field>
      <div
        role="button"
        tabIndex={0}
        aria-label="Add the bank slip"
        onClick={() => pick.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && pick.current?.click()}
        onDragOver={(e) => (e.preventDefault(), setDragging(true))}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => (e.preventDefault(), setDragging(false), addSlips(e.dataTransfer.files))}
        className={cx('cursor-pointer rounded-[8px] border border-dashed px-2.5 py-[9px] text-[12px] text-ink-2', dragging ? 'border-primary bg-selection' : 'border-slate-line dark:border-line')}
      >
        {slips.length ? slips.map((f) => f.name).join(', ') : 'Drag the bank slip here, or click to choose it'}
      </div>
      <input ref={pick} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.gif,application/pdf,image/*" aria-label="Choose the bank slip" className="hidden" onChange={(e) => (addSlips(e.target.files), (e.target.value = ''))} />
      {invoice && settles > invoice.due + 0.005 ? (
        <p className="m-0 rounded-[8px] bg-warning-bg px-3 py-2 text-[12px] text-warning-ink dark:text-warning">More than is owed: {amount(invoice.due, invoice.currency)} settles the invoice and the rest stays on the customer's account.</p>
      ) : null}
      {offline ? <p className="m-0 rounded-[8px] bg-subtle px-3 py-2 text-[12px] text-ink-2">{OFFLINE_WRITE}</p> : null}
      <div className="mt-auto flex justify-end gap-2 border-t border-line pt-3">
        <button type="button" className={btn} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={btnPrimary + ' !bg-success hover:!bg-success'} disabled={busy || !ready} onClick={() => void save()}>
          {busy ? 'Recording…' : 'Record'}
        </button>
      </div>
    </SidePanel>
  );
}
