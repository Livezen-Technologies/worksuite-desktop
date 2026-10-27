import { keepPreviousData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { dateLabel, todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner } from '../../components/ui';
import { btn, btnPrimary, Empty, Field, input, Sheet } from '../../components/PageKit';
import { whole } from '../inventory/api';
import { pick } from '../inventory/pickers';
import { allocateOldest, fetchPayments, KP, OFFLINE_WRITE, recordPayment, refreshPurchase, usePurchaseCan, usePurchaseOffline } from './api';
import { Frame, Head } from './parts';
import { VendorPick } from './Purchasing';

/**
 * Payments (S-09): money paid to vendors — method, bank reference, what is still on account — and recording one, in
 * the vendor's currency at a rate when it is not the company's (G-02: the realised difference posts through Finance),
 * set against the vendor's bills oldest first. Payment runs pay many at once (PaymentRuns.tsx).
 */
const METHODS = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
];

export default function Payments({ org, currency }: { org: string; currency: string | null }) {
  const c = usePurchaseCan();
  const offline = usePurchaseOffline();
  const [paying, setPaying] = useState(false);
  const list = useInfiniteQuery({
    queryKey: KP.payments(org, {}),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => fetchPayments(org, { page: pageParam }, signal),
    getNextPageParam: (last, pages) => (pages.length * 50 < last.total ? pages.length + 1 : undefined),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.rows), [list.data]);
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-6 py-5">
      <Head title="Payments" sub="Money paid to vendors, and what is still on account">
        {c.pay ? (
          <button type="button" className={btnPrimary} disabled={offline} title={offline ? OFFLINE_WRITE : undefined} onClick={() => setPaying(true)}>
            <Icon name="plus" size={15} /> Record a payment
          </button>
        ) : null}
      </Head>
      <Frame
        min={860}
        head={
          <>
            <span className="min-w-0 flex-1">Payment</span>
            <span className="w-[170px]">Vendor</span>
            <span className="w-[90px]">Paid on</span>
            <span className="w-[120px]">Method</span>
            <span className="w-[130px]">Reference</span>
            <span className="w-[110px] text-right">Amount</span>
            <span className="w-[100px] text-right">On account</span>
          </>
        }
        more={
          list.hasNextPage ? (
            <div className="flex shrink-0 justify-center border-t border-line px-3.5 py-2 text-[12px]">
              <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void list.fetchNextPage()}>
                Load more
              </button>
            </div>
          ) : null
        }
      >
        {list.isLoading ? (
          <Spinner />
        ) : list.error ? (
          <ErrorNote error={list.error} onRetry={() => void list.refetch()} />
        ) : rows.length ? (
          rows.map((p) => (
            <div key={p.id} data-payment={p.id} className="flex items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-[12.5px] last:border-b-0">
              <b className="min-w-0 flex-1 truncate text-ink">{p.reference}</b>
              <span className="w-[170px] truncate text-ink">{p.vendor ?? '—'}</span>
              <span className="w-[90px] text-ink-2">{dateLabel(p.paid_on)}</span>
              <span className="w-[120px] text-ink-2">{METHODS.find((m) => m.value === p.method)?.label ?? p.method}</span>
              <span className="w-[130px] truncate text-ink-2">{p.bank_reference ?? '—'}</span>
              <b className="w-[110px] text-right text-ink tabular-nums">{whole(p.amount, p.currency !== currency ? p.currency : null)}</b>
              <span className="w-[100px] text-right text-ink-2 tabular-nums">{p.unallocated ? whole(p.unallocated) : '—'}</span>
            </div>
          ))
        ) : (
          <Empty text="No payments yet." />
        )}
      </Frame>
      {paying ? <PaySheet org={org} currency={currency} onClose={() => setPaying(false)} /> : null}
    </div>
  );
}

function PaySheet({ org, currency, onClose }: { org: string; currency: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const c = usePurchaseCan();
  const [vendor, setVendor] = useState<{ id: number; name: string } | null>(null);
  const [amount, setAmount] = useState('');
  const [cur, setCur] = useState('');
  const [rate, setRate] = useState('');
  const [method, setMethod] = useState('bank_transfer');
  const [paidOn, setPaidOn] = useState(todayInZone());
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [oldest, setOldest] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setError(null);
    if (!vendor) return setError('Choose the vendor.');
    const n = Number(amount.replace(/,/g, ''));
    if (!Number.isFinite(n) || n <= 0) return setError('Give the amount paid.');
    const code = cur.trim().toUpperCase();
    if (code && !/^[A-Z]{3}$/.test(code)) return setError('The currency is a three-letter code, such as USD.');
    const r = rate.trim() ? Number(rate.replace(/,/g, '')) : null;
    if (r !== null && (!Number.isFinite(r) || r <= 0)) return setError('The exchange rate must be a number above zero.');
    setSaving(true);
    try {
      const made = await recordPayment(org, { vendor_id: vendor.id, amount: n, method, paid_on: paidOn, bank_reference: ref.trim() || null, note: note.trim() || null, ...(code ? { currency: code, exchange_rate: r } : {}) });
      if (oldest && c.allocate && made.id) await allocateOldest(made.id);
      refreshPurchase(qc);
      toast('success', oldest && c.allocate ? 'Payment recorded and set against the oldest bills' : 'Payment recorded');
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet
      title="Record a payment"
      width={560}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Record the payment'}
          </button>
        </>
      }
    >
      <div role="form" aria-label="Record a payment" className="flex flex-col gap-2.5">
        <Field label="Vendor">
          <VendorPick value={vendor} onChange={setVendor} />
        </Field>
        <div className="grid grid-cols-3 gap-2.5">
          <Field label={`Amount${currency && !cur ? ` (${currency})` : ''}`}>
            <input className={input + ' text-right tabular-nums'} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount" inputMode="decimal" />
          </Field>
          <Field label="Currency" hint="Blank: the company's">
            <input className={input + ' uppercase'} value={cur} onChange={(e) => setCur(e.target.value.slice(0, 3))} aria-label="Currency" maxLength={3} />
          </Field>
          <Field label="Rate" hint="Blank: Finance's">
            <input className={input + ' text-right tabular-nums'} value={rate} onChange={(e) => setRate(e.target.value)} aria-label="Exchange rate" inputMode="decimal" disabled={!cur.trim()} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          <Field label="Method">
            <Select aria-label="Method" value={method} onValueChange={setMethod} options={METHODS} className={pick} />
          </Field>
          <Field label="Paid on">
            <input type="date" className={input} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} aria-label="Paid on" />
          </Field>
          <Field label="Bank reference">
            <input className={input} value={ref} onChange={(e) => setRef(e.target.value)} aria-label="Bank reference" maxLength={80} />
          </Field>
        </div>
        <Field label="Note">
          <input className={input} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" maxLength={300} />
        </Field>
        {c.allocate ? (
          <label className="flex items-center gap-2 text-[12.5px] text-ink">
            <Checkbox checked={oldest} onChange={(e) => setOldest(e.target.checked)} /> Set it against the oldest bills first
          </label>
        ) : null}
        <span className="text-[12px] text-ink-3">Posting debits Accounts Payable and credits the bank account. A payment in another currency posts the difference from the bills' rates as realised exchange.</span>
        {error ? (
          <span role="alert" className="rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] font-semibold text-danger">
            {error}
          </span>
        ) : null}
      </div>
    </Sheet>
  );
}
