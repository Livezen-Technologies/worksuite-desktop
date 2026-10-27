import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, apiGet, apiPost } from '../../core/api';
import { dateLabel, todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner } from '../../components/ui';
import { btn, btnPrimary, Empty, Field, input, Sheet } from '../../components/PageKit';
import { whole, withOrg } from '../inventory/api';
import { pick } from '../inventory/pickers';
import { PURCHASE_API } from '@shared/purchase';
import { OFFLINE_WRITE, refreshPurchase, usePurchaseCan, usePurchaseOffline } from './api';
import { fetchReceipts } from './buying';
import { refusalText } from './chain';
import { Frame, Head } from './parts';

/**
 * Landed-cost vouchers (G-03; docs/purchasing-core.md): a freight, duty or insurance bill that came after the goods,
 * spread over the receipts it belongs to (`POST /api/purchase/landed-costs`). The server adds each share to the cost
 * layers still holding stock and expenses the share of units already issued; the voucher says how much went where.
 */
interface Voucher {
  id: number;
  reference: string;
  kind: string;
  basis: string;
  voucher_date: string | null;
  currency: string | null;
  amount: number | null;
  capitalised: number | null;
  expensed: number | null;
  po_id: number | null;
  note: string | null;
}

const KINDS = [
  { value: 'freight', label: 'Freight' },
  { value: 'duty', label: 'Duty' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'other', label: 'Other' },
];

export default function LandedCosts({ org, currency, onOrder }: { org: string; currency: string | null; onOrder: (id: number) => void; onReceipt: (id: number) => void }) {
  const c = usePurchaseCan();
  const offline = usePurchaseOffline();
  const [making, setMaking] = useState(false);
  const q = useQuery({
    queryKey: ['purchase', 'landed-costs', org],
    queryFn: ({ signal }) => apiGet<{ vouchers: Voucher[] }>(`${PURCHASE_API}/landed-costs`, withOrg(org), signal).then((r) => r.vouchers ?? []),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });
  const rows = q.data ?? [];
  const may = c.bill || c.cost;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-6 py-5">
      <Head title="Landed costs" sub="Freight, duty and insurance that came after the goods, spread over their receipts">
        {may ? (
          <button type="button" className={btnPrimary} disabled={offline} title={offline ? OFFLINE_WRITE : undefined} onClick={() => setMaking(true)}>
            <Icon name="plus" size={15} /> New voucher
          </button>
        ) : null}
      </Head>
      <Frame
        min={820}
        head={
          <>
            <span className="min-w-0 flex-1">Voucher</span>
            <span className="w-[100px]">Kind</span>
            <span className="w-[90px]">Date</span>
            <span className="w-[110px] text-right">Amount</span>
            <span className="w-[120px] text-right">Into stock</span>
            <span className="w-[120px] text-right">Expensed</span>
          </>
        }
      >
        {q.isLoading ? (
          <Spinner />
        ) : q.error instanceof ApiError && q.error.status === 404 ? (
          <Empty text="This WorkSuite server has no landed-cost vouchers yet." />
        ) : q.error ? (
          <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
        ) : rows.length ? (
          rows.map((v) => (
            <div key={v.id} data-voucher={v.id} className="flex items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-[12.5px] last:border-b-0">
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="truncate text-ink">{v.reference}</b>
                <span className="truncate text-[11.5px] text-ink-3">
                  {v.po_id ? (
                    <button type="button" className="text-primary hover:underline" onClick={() => onOrder(v.po_id!)}>
                      Its order
                    </button>
                  ) : null}
                  {v.note ? ` ${v.note}` : ''}
                </span>
              </span>
              <span className="w-[100px] text-ink-2">{KINDS.find((k) => k.value === v.kind)?.label ?? v.kind}</span>
              <span className="w-[90px] text-ink-2">{v.voucher_date ? dateLabel(v.voucher_date) : '—'}</span>
              <b className="w-[110px] text-right text-ink tabular-nums">{whole(v.amount, v.currency && v.currency !== currency ? v.currency : null)}</b>
              <span className="w-[120px] text-right text-ink-2 tabular-nums">{whole(v.capitalised)}</span>
              <span className="w-[120px] text-right text-ink-2 tabular-nums">{whole(v.expensed)}</span>
            </div>
          ))
        ) : (
          <Empty text="No landed-cost vouchers yet." />
        )}
      </Frame>
      {making ? <VoucherSheet org={org} onClose={() => setMaking(false)} /> : null}
    </div>
  );
}

function VoucherSheet({ org, onClose }: { org: string; onClose: () => void }) {
  const qc = useQueryClient();
  const receipts = useQuery({ queryKey: ['purchase', 'posted-grns', org], queryFn: ({ signal }) => fetchReceipts(org, null, { status: 'posted', page: 1 }, signal).then((r) => r.rows) });
  const [grn, setGrn] = useState('');
  const [amount, setAmount] = useState('');
  const [cur, setCur] = useState('');
  const [rate, setRate] = useState('');
  const [kind, setKind] = useState('freight');
  const [basis, setBasis] = useState('value');
  const [date, setDate] = useState(todayInZone());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setError(null);
    if (!grn) return setError('Choose the receipt the charge belongs to.');
    const n = Number(amount.replace(/,/g, ''));
    if (!Number.isFinite(n) || n <= 0) return setError('Give the amount.');
    const r = rate.trim() ? Number(rate.replace(/,/g, '')) : null;
    if (r !== null && (!Number.isFinite(r) || r <= 0)) return setError('The exchange rate must be a number above zero.');
    setSaving(true);
    try {
      await apiPost(`${PURCHASE_API}/landed-costs`, { ...(org ? { org_id: Number(org) } : {}), grn_id: Number(grn), amount: n, kind, basis, date, note: note.trim() || null, ...(cur.trim() ? { currency: cur.trim().toUpperCase(), ...(r ? { exchange_rate: r } : {}) } : {}) });
      refreshPurchase(qc);
      toast('success', 'Voucher posted — the stock still on hand carries its share');
      onClose();
    } catch (e) {
      setError(refusalText(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet
      title="New landed-cost voucher"
      width={560}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={saving} onClick={() => void save()}>
            {saving ? 'Posting…' : 'Post the voucher'}
          </button>
        </>
      }
    >
      <div role="form" aria-label="New landed-cost voucher" className="flex flex-col gap-2.5">
        <Field label="Receipt">
          <Select<string> aria-label="Receipt" value={grn} placeholder="Choose a posted receipt" options={(receipts.data ?? []).map((g) => ({ value: String(g.id), label: g.grn_number, hint: [g.vendor, g.po_number].filter(Boolean).join(' · ') || undefined }))} onValueChange={setGrn} loading={receipts.isFetching} empty="No posted receipt." className={pick} />
        </Field>
        <div className="grid grid-cols-3 gap-2.5">
          <Field label="Amount">
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
          <Field label="Kind">
            <Select aria-label="Kind" value={kind} onValueChange={setKind} options={KINDS} className={pick} />
          </Field>
          <Field label="Spread by">
            <Select
              aria-label="Spread by"
              value={basis}
              onValueChange={setBasis}
              options={[
                { value: 'value', label: 'Value' },
                { value: 'quantity', label: 'Quantity' },
              ]}
              className={pick}
            />
          </Field>
          <Field label="Date">
            <input type="date" className={input} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
          </Field>
        </div>
        <Field label="Note">
          <input className={input} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" maxLength={500} />
        </Field>
        {error ? (
          <span role="alert" className="rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] font-semibold text-danger">
            {error}
          </span>
        ) : null}
      </div>
    </Sheet>
  );
}
