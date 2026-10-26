import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Spinner, cx } from '../../components/ui';
import { refusal, shortDate } from '../finance/api';
import { ConfirmSheet, LoadFailed, Notice } from '../finance/parts';
import { btn, btnGood, btnPrimary, btnSmall, Field, input, Kpi, PageHead, Panel, Sheet, SidePanel } from '../hr/parts';
import { can, K, money } from './api';
import {
  atLeast,
  buildRun,
  cancelRun,
  centsMoney,
  fetchMethods,
  fetchPayable,
  fetchPosting,
  fetchPostings,
  fetchRuns,
  fileName,
  LIST_CAP,
  methodLabel,
  MK,
  monthStart,
  payableIds,
  payRun,
  pickedCents,
  plural,
  prepareBatch,
  refusedSentence,
  runOpen,
  signedCents,
  sumCents,
  voidable,
  voidBatch,
  type PaymentDetails,
  type Posting,
  type Run,
} from './money';
import { Note, StatusPill } from './parts';
import type { ScreenProps } from './Rail';
import { Checkbox } from '../../components/Checkbox';
import { StatGrid } from '../../components/StatCard';

/**
 * Paying people back, and handing the figures to accounting.
 *
 * ONE SCREEN, TWO MODES, because they are the same act seen from two sides:
 * what leaves the bank, and what goes in the books.
 *
 * PAYING IS A RUN, NOT A BUTTON PER CLAIM. Twenty "mark paid" clicks leave the
 * one transfer that actually happened with no counterpart in this system. A
 * run is the thing that reconciles against the bank statement.
 *
 * POSTINGS ARE PREPARED HERE AND POSTED SOMEWHERE ELSE. The batch is balanced
 * double-entry lines exported for the system the books are kept in, and the
 * screen says so rather than implying otherwise.
 *
 * Both need `expense.pay` and the company's finance role; the server asks
 * again on every call, and its refusal is shown as it wrote it.
 */
export default function Reimburse({ mode, ...props }: ScreenProps & { mode: 'runs' | 'postings' }) {
  if (props.orgId === null) return <Note>{mode === 'runs' ? 'Reimbursements' : 'The accounting export'} works in one company at a time. Choose one in the switcher.</Note>;
  return mode === 'runs' ? <Runs {...props} orgId={props.orgId} /> : <Postings {...props} orgId={props.orgId} />;
}

/** A read refused on purpose: the server's sentence about this company, as said. */
function ReadFailed({ error, what, onRetry }: { error: unknown; what: string; onRetry: () => void }) {
  const said = refusedSentence(error);
  return said ? (
    <div className="px-6 py-5">
      <Notice tone="amber">{said}</Notice>
    </div>
  ) : (
    <LoadFailed what={what} onRetry={onRetry} />
  );
}

// ── payment runs ─────────────────────────────────────────────────────────

const RUN_COLS = { claims: 64, total: 150, status: 150, bank: 200, act: 190 };

function Runs({ orgId, orgs, onGo }: ScreenProps & { orgId: number }) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const org = orgs.find((o) => o.id === orgId) ?? null;
  const may = can(perms, 'expense.pay') && atLeast(org, 'finance');
  const payable = useQuery({ queryKey: MK.payable(orgId), queryFn: ({ signal }) => fetchPayable(orgId, signal), retry: false });
  const runs = useQuery({ queryKey: MK.runs(orgId), queryFn: ({ signal }) => fetchRuns(orgId, signal), retry: false });
  const [picked, setPicked] = useState<number[]>([]);
  const [building, setBuilding] = useState(false);
  const [paying, setPaying] = useState<Run | null>(null);
  const [cancelling, setCancelling] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);

  // Paying a run pays claims: the dashboard, the lists and the quick bar all move.
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: K.one(orgId) });
    void qc.invalidateQueries({ queryKey: [...K.all, 's'] });
  };

  if (payable.isLoading || runs.isLoading) return <Spinner />;
  if (payable.error) return <ReadFailed error={payable.error} what="The claims waiting to be paid" onRetry={() => void payable.refetch()} />;

  const cur = payable.data?.currency || org?.currency || '';
  const people = payable.data?.people ?? [];
  const all = payableIds(people);
  const chosen = new Set(picked.filter((id) => all.includes(id)));
  const toggle = (ids: number[], on: boolean) => setPicked((v) => (on ? [...new Set([...v, ...ids])] : v.filter((x) => !ids.includes(x))));
  const items = runs.data ?? [];

  const download = (r: Run) =>
    void call('transfers:download', { expenseFile: { kind: 'run-csv', run: r.id, org: orgId }, name: fileName(r.reference || 'payment-run', 'csv') }).then(
      () => toast('success', 'Downloading the payment list — see Transfers.'),
      (e) => toast('error', errorMessage(e)),
    );
  const openReceipt = (r: Run) =>
    r.receipt_token
      ? void call('transfers:download', { expenseFile: { kind: 'receipt', token: r.receipt_token }, name: fileName(r.receipt_name || 'receipt'), open: true }).catch((e) => toast('error', errorMessage(e)))
      : undefined;
  const cancel = async (r: Run) => {
    setBusy(true);
    try {
      const res = await cancelRun(orgId, r.id);
      toast('success', res.message ?? 'Run cancelled.');
      setCancelling(null);
      refresh();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Reimbursements" sub="Approved claims, grouped by person, paid in runs." />
      <StatGrid className="max-w-[320px]">
        <Kpi icon="hourglass" tone="amber" label="Waiting to be paid" value={money(payable.data?.total, cur)} sub={`${plural(all.length, 'claim', 'claims')} across ${plural(people.length, 'person', 'people')}`} />
      </StatGrid>

      <Panel
        title="Payable now"
        bodyClassName="flex flex-col"
        action={
          may && chosen.size > 0 ? (
            <span className="flex items-center gap-2">
              <button type="button" className="text-[12px] font-semibold text-ink-3 hover:text-ink" onClick={() => setPicked([])}>
                Clear
              </button>
              <button type="button" className={btnPrimary} onClick={() => setBuilding(true)}>
                <Icon name="banknote" size={14} /> Build a run of {chosen.size}
              </button>
            </span>
          ) : may && all.length > 0 ? (
            <button type="button" className="text-[12.5px] font-semibold text-primary hover:underline" onClick={() => setPicked(all)}>
              Select everything
            </button>
          ) : undefined
        }
      >
        {!people.length ? (
          <div className="px-3.5 py-8 text-center text-[12.5px] text-ink-3">
            <b className="block text-ink-2">Nothing is waiting to be paid.</b>
            Approved claims land here.
          </div>
        ) : (
          people.map((p) => {
            const ids = p.claims.map((c) => c.id);
            const every = ids.every((id) => chosen.has(id));
            return (
              <div key={p.user_id} className="border-b border-line/70 px-3.5 py-2.5 last:border-b-0">
                <div className="flex flex-wrap items-center gap-2">
                  {may ? <Checkbox checked={every} indeterminate={!every && ids.some((id) => chosen.has(id))} aria-label={`Every claim of ${p.name}`} onChange={(e) => toggle(ids, e.target.checked)} /> : null}
                  <b className="text-[13px] text-ink">{p.name}</b>
                  <span className="text-[12px] text-ink-3">{plural(p.count, 'claim', 'claims')}</span>
                  <b className="text-[13px] text-ink tabular-nums">{money(p.total, cur)}</b>
                  {p.advance_outstanding ? (
                    // Not a refusal, a fact finance should see before transferring: they already hold company money.
                    <span className="rounded-[6px] bg-[#FFF4E0] px-2 py-0.5 text-[11.5px] font-semibold text-[#9A4A06] dark:bg-warning-bg dark:text-warning">also holds {money(p.advance_outstanding, cur)} in unsettled advances</span>
                  ) : null}
                </div>
                <div className="mt-1 flex flex-col">
                  {p.claims.map((c) => (
                    <label key={c.id} className="flex items-center gap-2.5 rounded-[7px] px-1.5 py-1 text-[12.5px] hover:bg-subtle">
                      {may ? <Checkbox checked={chosen.has(c.id)} onChange={(e) => toggle([c.id], e.target.checked)} /> : null}
                      <button type="button" className="w-[110px] shrink-0 truncate text-left font-mono text-[11.5px] text-primary hover:underline" title="Open the claim" onClick={(e) => (e.preventDefault(), onGo('organization', `&claim=${c.id}`))}>
                        {c.claim_no}
                      </button>
                      <span className="min-w-0 flex-1 truncate text-ink-2">{c.description || 'No description'}</span>
                      <span className="w-[96px] shrink-0 text-ink-3">{shortDate(c.spent_on)}</span>
                      <span className="w-[130px] shrink-0 text-right font-semibold text-ink tabular-nums">{money(c.base_amount, cur)}</span>
                    </label>
                  ))}
                </div>
              </div>
            )
          })
        )}
      </Panel>

      <div className="flex items-baseline gap-2">
        <b className="text-[14px] text-ink">Runs</b>
        <span className="text-[12px] text-ink-3">{items.length >= LIST_CAP ? `the newest ${LIST_CAP} only` : plural(items.length, 'run', 'runs')}</span>
      </div>
      {runs.error ? (
        <ReadFailed error={runs.error} what="The payment runs" onRetry={() => void runs.refetch()} />
      ) : (
        <div className="overflow-x-auto rounded-[12px] border border-line bg-surface scroll-thin">
          <div className="min-w-[900px]">
            <div className="flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
              <span className="min-w-0 flex-1">Run</span>
              <span className="shrink-0 text-right" style={{ width: RUN_COLS.claims }}>
                Claims
              </span>
              <span className="shrink-0 text-right" style={{ width: RUN_COLS.total }}>
                Total
              </span>
              <span className="shrink-0" style={{ width: RUN_COLS.status }}>
                Status
              </span>
              <span className="shrink-0" style={{ width: RUN_COLS.bank }}>
                Bank reference · receipt
              </span>
              <span className="shrink-0" style={{ width: RUN_COLS.act }} />
            </div>
            {items.map((r) => (
              <div key={r.id} className="flex items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-[13px] last:border-b-0">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-mono text-[12px] text-ink">{r.reference}</span>
                  <span className="truncate text-[11.5px] text-ink-3">
                    {methodLabel(r.method)}
                    {r.created_name ? ` · built by ${r.created_name}` : ''}
                  </span>
                </span>
                <span className="shrink-0 text-right text-ink-2 tabular-nums" style={{ width: RUN_COLS.claims }}>
                  {r.claim_count.toLocaleString()}
                </span>
                <span className="shrink-0 text-right font-semibold text-ink tabular-nums" style={{ width: RUN_COLS.total }}>
                  {money(r.total, r.currency || cur)}
                </span>
                <span className="flex shrink-0 flex-col items-start gap-0.5" style={{ width: RUN_COLS.status }}>
                  <StatusPill status={r.status} />
                  {r.paid_at ? (
                    <span className="truncate text-[11px] text-ink-3">
                      {shortDate(r.paid_at)}
                      {r.paid_name ? ` · ${r.paid_name}` : ''}
                    </span>
                  ) : null}
                </span>
                {/* The reference is the whole point of recording it, and the receipt is the proof — both reachable, never write-only. */}
                <span className="flex shrink-0 flex-col" style={{ width: RUN_COLS.bank }}>
                  {r.txn_reference ? <span className="truncate font-mono text-[12px] text-ink-2">{r.txn_reference}</span> : <span className="text-ink-3">—</span>}
                  {r.receipt_token ? (
                    <button type="button" className="truncate text-left text-[11.5px] font-semibold text-primary hover:underline" title="Open the receipt" onClick={() => openReceipt(r)}>
                      {r.receipt_name || 'View the receipt'}
                    </button>
                  ) : null}
                </span>
                <span className="flex shrink-0 items-center justify-end gap-2" style={{ width: RUN_COLS.act }}>
                  <button type="button" className={cx(btnSmall, 'w-[30px] justify-center px-0')} aria-label={`Download the payment list for ${r.reference}`} title="Download the payment list" onClick={() => download(r)}>
                    <Icon name="download" size={14} />
                  </button>
                  {may && runOpen(r) ? (
                    <>
                      <button type="button" className={btnGood} onClick={() => setPaying(r)}>
                        Mark paid
                      </button>
                      <button type="button" className="text-[12px] font-semibold text-ink-3 hover:text-danger" onClick={() => setCancelling(r)}>
                        Cancel…
                      </button>
                    </>
                  ) : null}
                </span>
              </div>
            ))}
            {!items.length ? <div className="px-3.5 py-8 text-center text-[12.5px] text-ink-3">No runs yet.</div> : null}
          </div>
        </div>
      )}

      <Notice tone="grey">The download is a generic list, not any one bank&rsquo;s upload format — bank file formats are exact and versioned, and a guessed one is rejected at best. Map it into your bank&rsquo;s own import.</Notice>

      {building ? (
        <BuildRunSheet
          orgId={orgId}
          ids={[...chosen]}
          total={centsMoney(pickedCents(people, chosen), cur)}
          onClose={() => setBuilding(false)}
          onBuilt={() => {
            setPicked([]);
            setBuilding(false);
            refresh();
          }}
        />
      ) : null}
      {paying ? (
        <PayRunSheet
          orgId={orgId}
          run={paying}
          currency={paying.currency || cur}
          onClose={() => setPaying(null)}
          onPaid={() => {
            setPaying(null);
            refresh();
          }}
        />
      ) : null}
      {cancelling ? (
        <ConfirmSheet
          title={`Cancel ${cancelling.reference}?`}
          body={`The run is kept, marked cancelled, and its ${plural(cancelling.claim_count, 'claim goes', 'claims go')} back to approved — payable again in another run. Cancel only a run whose transfer was never made: a paid run cannot be cancelled, because the money left the company.`}
          action="Cancel the run"
          danger
          busy={busy}
          onYes={() => void cancel(cancelling)}
          onClose={() => setCancelling(null)}
        />
      ) : null}
    </div>
  );
}

const RECEIPT_TYPES = '.pdf,.jpg,.jpeg,.png,.gif,.webp,.heic,.docx,.xlsx';

/**
 * The two fields that describe a real transfer, asked when a run is built and
 * again when it is recorded as paid. Both optional: a cash payout has neither,
 * and refusing the record for want of a reference would leave the run
 * unpayable rather than merely unevidenced.
 */
function PaymentFields({ value, onChange }: { value: PaymentDetails; onChange: (v: PaymentDetails) => void }) {
  const pick = useRef<HTMLInputElement>(null);
  return (
    <>
      <Field label={<span>Transaction reference <span className="font-medium text-ink-3">— optional</span></span>}>
        <input value={value.reference} maxLength={120} placeholder="The bank's reference for the transfer" onChange={(e) => onChange({ ...value, reference: e.target.value })} className={input} aria-label="Transaction reference" />
      </Field>
      <div className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink">
        <span>
          Transaction receipt <span className="font-medium text-ink-3">— optional</span>
        </span>
        <input
          ref={pick}
          type="file"
          hidden
          accept={RECEIPT_TYPES}
          aria-label="Transaction receipt"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            e.target.value = '';
            onChange({ ...value, receipt: f });
          }}
        />
        <span className="flex items-center gap-2">
          <button type="button" className={btnSmall} onClick={() => pick.current?.click()}>
            <Icon name="paperclip" size={13} className="mr-1" />
            {value.receipt ? 'Choose another' : 'Choose a file'}
          </button>
          {value.receipt ? (
            <>
              <span className="min-w-0 flex-1 truncate font-medium text-ink-2">{value.receipt.name}</span>
              <button type="button" aria-label="Remove the receipt" className="flex h-6 w-6 items-center justify-center rounded-full text-ink-3 hover:bg-subtle hover:text-danger" onClick={() => onChange({ ...value, receipt: null })}>
                <Icon name="x" size={13} />
              </button>
            </>
          ) : null}
        </span>
        <span className="text-[11.5px] font-medium text-ink-3">PDF, image or Office document, up to 10 MB.</span>
      </div>
    </>
  );
}

/**
 * Build a run from the claims picked. The reference and receipt are optional
 * here on purpose: at build the transfer usually has not happened yet, and the
 * same two fields are asked again when the run is recorded as paid.
 */
function BuildRunSheet({ orgId, ids, total, onClose, onBuilt }: { orgId: number; ids: number[]; total: string; onClose: () => void; onBuilt: () => void }) {
  const methods = useQuery({ queryKey: MK.methods(orgId), queryFn: ({ signal }) => fetchMethods(signal), staleTime: 300_000, retry: false });
  const [method, setMethod] = useState('');
  const [d, setD] = useState<PaymentDetails>({ reference: '', receipt: null });
  // Its own flag, on from the first click: the receipt uploads before the run is built, and a second press in that window built a second run.
  const [busy, setBusy] = useState(false);
  const list = methods.data ?? [];
  const chosen = method || list[0] || '';

  const build = async () => {
    setBusy(true);
    try {
      const r = await buildRun(orgId, ids, chosen, d);
      toast('success', r?.message ?? 'Built.');
      onBuilt();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Build a payment run"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !chosen} onClick={() => void build()}>
            {busy ? 'Building…' : 'Build run'}
          </button>
        </>
      }
    >
      <p className="m-0 text-[13px] text-ink-2">
        {plural(ids.length, 'claim', 'claims')}, <b className="text-ink tabular-nums">{total}</b>. Nothing is paid by building it — mark it paid once the transfer is actually made.
      </p>
      <Field label={<span>How will these be paid? <span className="text-danger">*</span></span>}>
        {methods.error ? <span className="text-[12px] font-medium text-danger">The payment methods could not be loaded.</span> : <Select aria-label="Payment method" className="w-full" value={chosen} onValueChange={setMethod} options={list.map((m) => ({ value: m, label: methodLabel(m) }))} />}
      </Field>
      <PaymentFields value={d} onChange={setD} />
    </Sheet>
  );
}

/**
 * Record a run as paid, with what actually happened. No money moves through
 * this software — the transfer happened at a bank and somebody says so here.
 * The reference ties this row to it; the receipt is the proof.
 */
function PayRunSheet({ orgId, run, currency, onClose, onPaid }: { orgId: number; run: Run; currency: string; onClose: () => void; onPaid: () => void }) {
  const [d, setD] = useState<PaymentDetails>({ reference: '', receipt: null });
  const [busy, setBusy] = useState(false);
  const pay = async () => {
    setBusy(true);
    try {
      const r = await payRun(orgId, run.id, d);
      const said = r.message ?? 'Recorded.';
      // Paid, and the ledger would not take it yet: the run stands, and the sentence says what to fix.
      toast(/not in the accounts yet/i.test(said) ? 'warning' : 'success', said);
      onPaid();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={`Record ${run.reference} as paid`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => void pay()}>
            {busy ? 'Recording…' : 'It has been paid'}
          </button>
        </>
      }
    >
      <p className="m-0 text-[13px] leading-[1.55] text-ink-2">
        {plural(run.claim_count, 'claim', 'claims')}, <b className="text-ink tabular-nums">{money(run.total, currency)}</b>. This records that the transfer was made elsewhere — no money moves through this software. Every claim in the run becomes paid.
      </p>
      {run.txn_reference ? <p className="m-0 text-[12px] text-ink-3">Recorded at build: reference {run.txn_reference}. Leave the field empty to keep it.</p> : null}
      <PaymentFields value={d} onChange={setD} />
    </Sheet>
  );
}

// ── the accounting export ────────────────────────────────────────────────

const POST_COLS = { period: 200, claims: 64, lines: 64, debit: 140, credit: 150, status: 96, act: 120 };

function Postings({ orgId, orgs }: ScreenProps & { orgId: number }) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const org = orgs.find((o) => o.id === orgId) ?? null;
  const may = can(perms, 'expense.pay') && atLeast(org, 'finance');
  const q = useQuery({ queryKey: MK.postings(orgId), queryFn: ({ signal }) => fetchPostings(orgId, signal), retry: false });
  const [open, setOpen] = useState<number | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [voiding, setVoiding] = useState<Posting | null>(null);
  const [said, setSaid] = useState<{ message: string; unmapped: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: MK.postings(orgId) });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ReadFailed error={q.error} what="The accounting batches" onRetry={() => void q.refetch()} />;

  const items = q.data?.items ?? [];
  const cur = q.data?.currency || org?.currency || '';

  const exportBatch = (p: Posting) =>
    void call('transfers:download', { expenseFile: { kind: 'posting', posting: p.id, org: orgId }, name: fileName(p.reference || 'batch', 'csv') }).then(
      () => {
        toast('success', 'Exporting — see Transfers.');
        // The first export marks the batch handed over; the file is fetched in the background, so look again once it has been.
        refresh();
        setTimeout(refresh, 2500);
      },
      (e) => toast('error', errorMessage(e)),
    );
  const doVoid = async (p: Posting) => {
    setBusy(true);
    try {
      const r = await voidBatch(orgId, p.id);
      toast('success', r.message ?? 'Batch voided.');
      setVoiding(null);
      if (open === p.id) setOpen(null);
      void qc.invalidateQueries({ queryKey: K.one(orgId) });
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Accounting export" sub="Balanced double-entry lines, prepared here and imported into the system your books are kept in.">
        {may ? (
          <button type="button" className={btnPrimary} onClick={() => setPreparing(true)}>
            <Icon name="plus" size={14} /> Prepare a batch
          </button>
        ) : null}
      </PageHead>
      {q.data?.note ? <Notice tone="grey">{q.data.note}</Notice> : null}
      {said ? (
        <Notice tone={said.unmapped.length ? 'amber' : 'green'} className="flex items-start gap-2">
          <span className="flex-1">{said.message}</span>
          <button type="button" aria-label="Dismiss" className="shrink-0 opacity-70 hover:opacity-100" onClick={() => setSaid(null)}>
            <Icon name="x" size={14} />
          </button>
        </Notice>
      ) : null}

      <div className="overflow-x-auto rounded-[12px] border border-line bg-surface scroll-thin">
        <div className="min-w-[1000px]">
          <div className="flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
            <span className="min-w-0 flex-1">Batch</span>
            <span className="shrink-0" style={{ width: POST_COLS.period }}>
              Period
            </span>
            <span className="shrink-0 text-right" style={{ width: POST_COLS.claims }}>
              Claims
            </span>
            <span className="shrink-0 text-right" style={{ width: POST_COLS.lines }}>
              Lines
            </span>
            <span className="shrink-0 text-right" style={{ width: POST_COLS.debit }}>
              Debits
            </span>
            <span className="shrink-0 text-right" style={{ width: POST_COLS.credit }}>
              Credits
            </span>
            <span className="shrink-0" style={{ width: POST_COLS.status }}>
              Status
            </span>
            <span className="shrink-0" style={{ width: POST_COLS.act }} />
          </div>
          {items.map((p) => (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              onClick={() => setOpen(p.id)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setOpen(p.id))}
              className={cx('flex cursor-pointer items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-[13px] last:border-b-0 hover:bg-subtle', open === p.id && 'bg-selection')}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-mono text-[12px] text-ink">{p.reference}</span>
                {p.created_name ? <span className="truncate text-[11.5px] text-ink-3">prepared by {p.created_name}</span> : null}
              </span>
              <span className="shrink-0 text-[12px] text-ink-2" style={{ width: POST_COLS.period }}>
                {shortDate(p.period_start)} → {shortDate(p.period_end)}
              </span>
              <span className="shrink-0 text-right text-ink-2 tabular-nums" style={{ width: POST_COLS.claims }}>
                {p.claim_count.toLocaleString()}
              </span>
              <span className="shrink-0 text-right text-ink-2 tabular-nums" style={{ width: POST_COLS.lines }}>
                {p.line_count.toLocaleString()}
              </span>
              <span className="shrink-0 text-right font-semibold text-ink tabular-nums" style={{ width: POST_COLS.debit }}>
                {money(p.total_debit, p.currency || cur)}
              </span>
              {/* A batch that does not balance is the one thing this column exists to say. */}
              <span className={cx('flex shrink-0 flex-col items-end font-semibold tabular-nums', p.balanced ? 'text-ink' : 'text-danger')} style={{ width: POST_COLS.credit }}>
                {money(p.total_credit, p.currency || cur)}
                {!p.balanced ? <span className="text-[11px] font-semibold">does not balance</span> : null}
              </span>
              <span className="shrink-0" style={{ width: POST_COLS.status }}>
                <StatusPill status={p.status} />
              </span>
              <span role="presentation" className="flex shrink-0 items-center justify-end gap-2" style={{ width: POST_COLS.act }} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                {may && p.balanced && p.status !== 'void' ? (
                  <button
                    type="button"
                    className={cx(btnSmall, 'w-[30px] justify-center px-0')}
                    aria-label={`Export ${p.reference} as CSV`}
                    title={p.status === 'draft' ? 'Export as CSV. Once exported a batch cannot be voided — it may already be in your books.' : 'Export as CSV'}
                    onClick={() => exportBatch(p)}
                  >
                    <Icon name="download" size={14} />
                  </button>
                ) : null}
                {may && voidable(p) ? (
                  <button type="button" className="text-[12px] font-semibold text-ink-3 hover:text-danger" onClick={() => setVoiding(p)}>
                    Void…
                  </button>
                ) : null}
              </span>
            </div>
          ))}
          {!items.length ? (
            <div className="px-3.5 py-8 text-center text-[12.5px] text-ink-3">
              <b className="block text-ink-2">No batches yet.</b>
              A batch takes every approved claim in a period that is not already in one.
            </div>
          ) : null}
          {items.length >= LIST_CAP ? <div className="border-t border-line bg-ground px-3.5 py-2 text-[12px] font-semibold text-[#9A4A06] dark:text-warning">The newest {LIST_CAP} only — older batches are not listed.</div> : null}
        </div>
      </div>

      {open !== null ? <PostingPanel key={open} orgId={orgId} id={open} currency={cur} onClose={() => setOpen(null)} /> : null}
      {preparing ? (
        <PrepareSheet
          orgId={orgId}
          onClose={() => setPreparing(false)}
          onDone={(r) => {
            setPreparing(false);
            setSaid(r);
            refresh();
          }}
        />
      ) : null}
      {voiding ? (
        <ConfirmSheet
          title={`Void ${voiding.reference}?`}
          body={`Its ${plural(voiding.claim_count, 'claim is', 'claims are')} released to be batched again and its ${plural(voiding.line_count, 'line is', 'lines are')} deleted. Only a batch nobody has exported can be voided — an exported one may already be in your accounting system, and voiding it would let the same expenses into the books twice.`}
          action="Void the batch"
          danger
          busy={busy}
          onYes={() => void doVoid(voiding)}
          onClose={() => setVoiding(null)}
        />
      ) : null}
    </div>
  );
}

/** A batch for a period: every approved claim in it that is not already in one. */
function PrepareSheet({ orgId, onClose, onDone }: { orgId: number; onClose: () => void; onDone: (r: { message: string; unmapped: string[] }) => void }) {
  const [today] = useState(todayInZone);
  const [from, setFrom] = useState(() => monthStart(today));
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const bad = !from || !to ? 'Give the period as two dates.' : to < from ? 'The period ends before it starts.' : null;
  const go = async () => {
    setBusy(true);
    try {
      const r = await prepareBatch(orgId, from, to);
      onDone({ message: r?.message ?? 'Prepared.', unmapped: Array.isArray(r?.unmapped) ? r.unmapped.map(String) : [] });
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="Prepare a batch"
      width={440}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !!bad} onClick={() => void go()}>
            {busy ? 'Preparing…' : 'Prepare'}
          </button>
        </>
      }
    >
      <p className="m-0 text-[13px] text-ink-2">Every approved claim spent in the period that is not already in a batch becomes two balanced lines: the expense, and what the company owes the person.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Period start">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} />
        </Field>
        <Field label="Period end">
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={input} />
        </Field>
      </div>
      {bad && from && to ? <span className="text-[12px] text-danger">{bad}</span> : null}
    </Sheet>
  );
}

/** One batch's lines, as they will be exported. */
function PostingPanel({ orgId, id, currency, onClose }: { orgId: number; id: number; currency: string; onClose: () => void }) {
  const q = useQuery({ queryKey: MK.posting(orgId, id), queryFn: ({ signal }) => fetchPosting(orgId, id, signal), retry: false });
  const p = q.data;
  const cur = p?.currency || currency;
  const dr = p ? sumCents(p.lines.map((l) => l.debit)) : null;
  const cr = p ? sumCents(p.lines.map((l) => l.credit)) : null;
  // A line is a debit or a credit; the other side is left blank rather than 0.00.
  const shown = (v: string) => ((signedCents(v) ?? 0) !== 0 ? money(v) : '');
  return (
    <SidePanel
      label="Accounting batch"
      width={900}
      onClose={onClose}
      head={
        <span className="flex min-w-0 flex-1 flex-col">
          <b className="truncate font-mono text-[14px] text-ink">{p?.reference ?? 'Batch'}</b>
          {p ? (
            <span className="text-[12px] text-ink-3">
              {shortDate(p.period_start)} → {shortDate(p.period_end)} · {plural(p.line_count, 'line', 'lines')} · {cur}
            </span>
          ) : null}
        </span>
      }
    >
      {q.isLoading ? <Spinner /> : null}
      {q.error ? refusedSentence(q.error) ? <Notice tone="amber">{refusedSentence(q.error)}</Notice> : <LoadFailed what="That batch" onRetry={() => void q.refetch()} /> : null}
      {p ? (
        <>
          {!p.balanced ? <Notice tone="red">This batch does not balance, so it will not export. Debits and credits must be equal before anything is handed to accounting.</Notice> : null}
          <div className="overflow-x-auto rounded-[10px] border border-line scroll-thin">
            <div className="min-w-[820px] text-[12.5px]">
              <div className="flex gap-2.5 border-b border-line bg-ground px-3 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
                <span className="w-[30px] shrink-0">#</span>
                <span className="w-[92px] shrink-0">Date</span>
                <span className="min-w-0 flex-1">Account</span>
                <span className="w-[96px] shrink-0">Cost centre</span>
                <span className="w-[110px] shrink-0 text-right">Debit</span>
                <span className="w-[110px] shrink-0 text-right">Credit</span>
                <span className="w-[200px] shrink-0">Memo</span>
              </div>
              {p.lines.map((l) => (
                <div key={l.id} className="flex items-center gap-2.5 border-b border-line/60 px-3 py-1.5 last:border-b-0">
                  <span className="w-[30px] shrink-0 text-ink-3 tabular-nums">{l.line_no}</span>
                  <span className="w-[92px] shrink-0 text-ink-2">{shortDate(l.entry_date)}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-mono text-[12px] text-ink">{l.account_code}</span>
                    {l.account_name ? <span className="truncate text-[11px] text-ink-3">{l.account_name}</span> : null}
                  </span>
                  <span className="w-[96px] shrink-0 truncate text-ink-2">{l.cost_centre ?? '—'}</span>
                  <span className="w-[110px] shrink-0 text-right text-ink tabular-nums">{shown(l.debit)}</span>
                  <span className="w-[110px] shrink-0 text-right text-ink tabular-nums">{shown(l.credit)}</span>
                  <span className="w-[200px] shrink-0 truncate text-ink-3" title={l.memo ?? undefined}>
                    {l.memo}
                  </span>
                </div>
              ))}
              <div className="flex gap-2.5 border-t border-line bg-ground px-3 py-2 font-bold text-ink">
                <span className="min-w-0 flex-1">Totals</span>
                <span className={cx('w-[110px] shrink-0 text-right tabular-nums', !p.balanced && 'text-danger')}>{centsMoney(dr, '')}</span>
                <span className={cx('w-[110px] shrink-0 text-right tabular-nums', !p.balanced && 'text-danger')}>{centsMoney(cr, '')}</span>
                <span className="w-[200px] shrink-0" />
              </div>
            </div>
          </div>
          <Notice tone="grey">The reimbursement side — clearing what the company owes against a bank account — is deliberately not generated. It depends on which account the payment left from, which this software does not know.</Notice>
        </>
      ) : null}
    </SidePanel>
  );
}
