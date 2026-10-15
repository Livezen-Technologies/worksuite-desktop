import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../../core/api';
import { call } from '../../core/bridge';
import { dateLabel, todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { ErrorNote, Spinner } from '../../components/ui';
import { btn, btnGood, btnPrimary, btnSmall, Empty, Field, input, Sheet, SidePanel } from '../hr/parts';
import { stampWords, whole } from '../inventory/api';
import { Pill } from '../inventory/parts';
import { approveRun, fetchRun, fetchRuns, KP, markRunPaid, OFFLINE_WRITE, proposeRun, refreshPurchase, usePurchaseCan, usePurchaseOffline } from './api';
import { refusalText } from './chain';
import { Frame, Head, rowCls } from './parts';
import { RUN_LABEL, runActions, runExportRequest, runTone, type BankFormat } from './payrun';

/**
 * Payment runs (G-20; "Payment runs" in the Bills design's rail): propose the bills due by a date → somebody else
 * approves the batch → the bank file, CSV or ISO 20022 pain.001, saved on this computer for the bank → mark it paid,
 * which records each payment and sets it against its bill.
 */
export default function PaymentRuns({ org, currency, openId, onOpen }: { org: string; currency: string | null; openId: number | null; onOpen: (id: number | null) => void }) {
  const c = usePurchaseCan();
  const offline = usePurchaseOffline();
  const [proposing, setProposing] = useState(false);
  const q = useQuery({ queryKey: KP.runs(org), queryFn: ({ signal }) => fetchRuns(org, signal), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 });
  const rows = q.data ?? [];
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-6 py-5">
      <Head title="Payment runs" sub="Pay what is due in one batch: propose, approve, the bank file, paid">
        {c.pay ? (
          <button type="button" className={btnPrimary} disabled={offline} title={offline ? OFFLINE_WRITE : undefined} onClick={() => setProposing(true)}>
            <Icon name="plus" size={15} /> Propose a run
          </button>
        ) : null}
      </Head>
      <Frame
        min={820}
        head={
          <>
            <span className="min-w-0 flex-1">Run</span>
            <span className="w-[100px]">Due by</span>
            <span className="w-[80px] text-right">Bills</span>
            <span className="w-[120px] text-right">Total</span>
            <span className="w-[140px]">Status</span>
            <span className="w-[150px]">Proposed by</span>
          </>
        }
      >
        {q.isLoading ? (
          <Spinner />
        ) : q.error instanceof ApiError && q.error.status === 404 ? (
          <Empty text="This WorkSuite server has no payment runs yet." />
        ) : q.error ? (
          <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
        ) : rows.length ? (
          rows.map((r) => (
            <button key={r.id} type="button" data-run={r.id} className={rowCls} onClick={() => onOpen(r.id)}>
              <b className="min-w-0 flex-1 truncate text-ink">{r.reference}</b>
              <span className="w-[100px] text-ink-2">{r.due_by ? dateLabel(r.due_by) : '—'}</span>
              <span className="w-[80px] text-right text-ink-2 tabular-nums">{r.bill_count}</span>
              <b className="w-[120px] text-right text-ink tabular-nums">{whole(r.total, r.currency && r.currency !== currency ? r.currency : null)}</b>
              <span className="w-[140px]">
                <Pill tone={runTone(r.status)}>{RUN_LABEL[r.status] ?? r.status}</Pill>
              </span>
              <span className="w-[150px] truncate text-ink-2">{r.created_by_name ?? '—'}</span>
            </button>
          ))
        ) : (
          <Empty text="No payment runs yet." />
        )}
      </Frame>
      {openId ? <RunPanel key={openId} id={openId} currency={currency} onClose={() => onOpen(null)} /> : null}
      {proposing ? <ProposeSheet org={org} onClose={() => setProposing(false)} onSaved={(id) => (setProposing(false), onOpen(id))} /> : null}
    </div>
  );
}

function RunPanel({ id, currency, onClose }: { id: number; currency: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const c = usePurchaseCan();
  const offline = usePurchaseOffline();
  const q = useQuery({ queryKey: KP.run(id), queryFn: ({ signal }) => fetchRun(id, signal) });
  const r = q.data;
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);
  const [paidOn, setPaidOn] = useState(todayInZone());
  const [ref, setRef] = useState('');
  const acts = r ? runActions(r, { pay: c.pay, approve: c.approve, offline }) : null;
  const cur = r?.currency ?? currency;
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast('success', ok);
      setPaying(false);
    } catch (e) {
      toast('error', refusalText(e));
    } finally {
      setBusy(false);
      refreshPurchase(qc);
    }
  };
  const bankFile = async (format: BankFormat) => {
    if (!r) return;
    const req = runExportRequest(r, format);
    if (!req) return toast('error', 'The bank file is made once the run is approved.');
    try {
      await call('transfers:download', req);
      toast('success', `${req.name} is downloading — see Downloads`);
      refreshPurchase(qc);
    } catch (e) {
      toast('error', refusalText(e));
    }
  };
  return (
    <SidePanel
      label={r ? `Payment run ${r.reference}` : 'Payment run'}
      width={620}
      onClose={onClose}
      head={
        <span className="flex items-center gap-2">
          <b className="text-[15px] text-ink">{r?.reference ?? 'Payment run'}</b>
          {r ? <Pill tone={runTone(r.status)}>{RUN_LABEL[r.status] ?? r.status}</Pill> : null}
        </span>
      }
    >
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      ) : r ? (
        <>
          <span className="text-[12.5px] text-ink-2">
            {[`${r.bill_count} bills`, `total ${whole(r.total, cur)}`, r.due_by ? `due by ${dateLabel(r.due_by)}` : null, r.pay_on ? `pay on ${dateLabel(r.pay_on)}` : null, r.created_by_name ? `proposed by ${r.created_by_name}` : null, r.approved_by_name ? `approved by ${r.approved_by_name}` : null, r.exported_at ? `bank file ${stampWords(r.exported_at)}` : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <div className="overflow-hidden rounded-[10px] border border-line">
            {(r.bills ?? []).map((b) => (
              <span key={b.id} className="flex gap-2 border-b border-line/60 px-3 py-1.5 text-[12.5px] last:border-b-0">
                <b className="w-[110px] truncate text-ink">{b.bill_number}</b>
                <span className="min-w-0 flex-1 truncate text-ink-2">{[b.vendor, b.bank].filter(Boolean).join(' · ')}</span>
                <span className="w-[80px] text-ink-3">{b.due_date ? dateLabel(b.due_date) : '—'}</span>
                <span className="w-[100px] text-right text-ink tabular-nums">{whole(b.amount, b.currency && b.currency !== cur ? b.currency : null)}</span>
              </span>
            ))}
            {!(r.bills ?? []).length ? <span className="block px-3 py-2 text-[12px] text-ink-3">No bills in this run.</span> : null}
          </div>
          {acts ? (
            <div className="flex flex-wrap items-center gap-2">
              {acts.approve ? (
                <button type="button" className={btnGood} disabled={busy} onClick={() => void act(() => approveRun(id), 'Run approved — make the bank file')}>
                  Approve the run
                </button>
              ) : null}
              {acts.export ? (
                <>
                  <button type="button" className={btnSmall} disabled={busy} onClick={() => void bankFile('csv')}>
                    Bank file · CSV
                  </button>
                  <button type="button" className={btnSmall} disabled={busy} onClick={() => void bankFile('pain001')}>
                    Bank file · pain.001
                  </button>
                </>
              ) : null}
              {acts.markPaid ? (
                <button type="button" className={btnPrimary + ' !h-[30px] !text-[12.5px]'} disabled={busy} onClick={() => setPaying(true)}>
                  Mark paid
                </button>
              ) : null}
              {acts.note ? <span className="text-[12.5px] text-ink-3">{acts.note}</span> : null}
            </div>
          ) : null}
        </>
      ) : null}
      {paying && r ? (
        <Sheet
          title={`Mark ${r.reference} paid?`}
          width={460}
          onClose={() => setPaying(false)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setPaying(false)}>
                Back
              </button>
              <button type="button" className={btnPrimary} disabled={busy} onClick={() => void act(() => markRunPaid(id, { paid_on: paidOn, bank_reference: ref.trim() || null }), 'Paid — each payment is recorded and set against its bill')}>
                Mark paid
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-2.5">
            <span className="text-[13px] text-ink-2">Only once the bank has made the payments: each bill gets its payment, posted to the ledger.</span>
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Paid on">
                <input type="date" className={input} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} aria-label="Paid on" />
              </Field>
              <Field label="Bank reference">
                <input className={input} value={ref} onChange={(e) => setRef(e.target.value)} aria-label="Bank reference" maxLength={80} />
              </Field>
            </div>
          </div>
        </Sheet>
      ) : null}
    </SidePanel>
  );
}

function ProposeSheet({ org, onClose, onSaved }: { org: string; onClose: () => void; onSaved: (id: number) => void }) {
  const qc = useQueryClient();
  const today = todayInZone();
  const [dueBy, setDueBy] = useState(today);
  const [payOn, setPayOn] = useState(today);
  const [cur, setCur] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const r = await proposeRun(org, { due_by: dueBy, pay_on: payOn, currency: cur.trim().toUpperCase() || null });
      refreshPurchase(qc);
      toast('success', 'Run proposed — somebody else approves it');
      onSaved(Number(r.run?.id ?? r.id));
    } catch (e) {
      setError(refusalText(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet
      title="Propose a payment run"
      width={480}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={saving || !dueBy || !payOn} onClick={() => void save()}>
            {saving ? 'Proposing…' : 'Propose'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        <span className="text-[13px] text-ink-2">Every approved bill due by the date, not disputed, with a vendor whose bank details are on file.</span>
        <div className="grid grid-cols-3 gap-2.5">
          <Field label="Due by">
            <input type="date" className={input} value={dueBy} onChange={(e) => setDueBy(e.target.value)} aria-label="Due by" />
          </Field>
          <Field label="Pay on">
            <input type="date" className={input} value={payOn} onChange={(e) => setPayOn(e.target.value)} aria-label="Pay on" />
          </Field>
          <Field label="Currency" hint="Blank: all">
            <input className={input + ' uppercase'} value={cur} onChange={(e) => setCur(e.target.value.slice(0, 3))} aria-label="Currency" maxLength={3} />
          </Field>
        </div>
        {error ? (
          <span role="alert" className="rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] font-semibold text-danger">
            {error}
          </span>
        ) : null}
      </div>
    </Sheet>
  );
}
