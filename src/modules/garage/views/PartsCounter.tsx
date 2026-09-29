import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { ErrorNote, Spinner, cx } from '../../../components/ui';
import { btnPrimary, btnSmall, Field, input, PageHead, Panel } from '../../hr/parts';
import { canIn, OFFLINE_WRITE, refusalOf } from '../api';
import { fetchQueue, issueBody, issuePart, KB3, reservePart, scanPart, type ScanAnswer } from '../api-b3';
import { Pill } from '../parts';
import type { GarageViewProps } from '../registry';

/**
 * The parts counter (SRS §17, §28.9, FR-PRT-01..08, WF-14), stage B3.
 * Scan-first: the job (its number or QR), then the part (barcode, code or
 * serial) — a scanner types the code and presses Enter, which moves on by
 * itself — and WorkSuite answers with what was approved, issued and on the
 * shelf. Issuing more than the customer approved needs a manager's override
 * and a reason. Below, the queue of requests by urgency.
 */
export default function PartsCounter({ org, options, online, onJob }: GarageViewProps) {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [urgency, setUrgency] = useState('');
  const [search, setSearch] = useState('');
  const filter = { status: status || undefined, urgency: urgency || undefined, q: search.trim() || undefined };
  const queue = useQuery({ queryKey: KB3.queue(org, filter), queryFn: ({ signal }) => fetchQueue(org, filter, signal), refetchInterval: 30_000, placeholderData: (p) => p });
  const [job, setJob] = useState('');
  const [code, setCode] = useState('');
  const [qty, setQty] = useState('1');
  const [found, setFound] = useState<ScanAnswer | null>(null);
  const [serial, setSerial] = useState('');
  const [batch, setBatch] = useState('');
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const jobBox = useRef<HTMLInputElement>(null);
  const codeBox = useRef<HTMLInputElement>(null);

  const scan = async () => {
    if (!job.trim() || !code.trim()) return;
    setBusy(true);
    setFound(null);
    try {
      const r = await scanPart(job.trim(), code.trim(), qty);
      setFound(r);
      setSerial(r.serial_no ?? '');
      setOverride(false);
      setReason('');
    } catch (e) {
      toast('error', refusalOf(e).message);
    } finally {
      setBusy(false);
    }
  };
  const issue = async () => {
    if (!online) return toast('error', OFFLINE_WRITE);
    setBusy(true);
    try {
      const r = await issuePart(issueBody({ job: job, code, qty, serial, batch, technician: '', override, reason }));
      toast('success', r.message || 'Issued.');
      setFound(null);
      setCode('');
      setSerial('');
      setBatch('');
      void qc.invalidateQueries({ queryKey: ['garage'] });
      codeBox.current?.focus();
    } catch (e) {
      toast('error', refusalOf(e).message);
    } finally {
      setBusy(false);
    }
  };
  const reserve = async (id: number) => {
    if (!online) return toast('error', OFFLINE_WRITE);
    try {
      const r = await reservePart(id);
      toast('success', r.message || 'Reserved.');
      void qc.invalidateQueries({ queryKey: ['garage'] });
    } catch (e) {
      toast('error', refusalOf(e).message);
    }
  };
  const mayOverride = found ? canIn(options, found.job.org_id, 'assign') : false;
  const serialised = found?.product.tracking === 'serial';

  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      <PageHead title="Parts counter" sub="Scan the job, then the part" />
      <section aria-label="Issue by scan" className="flex flex-wrap items-end gap-2 rounded-[12px] border border-line bg-surface px-4 py-3">
        <Field label="1. Job">
          <input
            ref={jobBox}
            autoFocus
            data-garage-search
            aria-label="Job number"
            placeholder="JOB-2026-000012"
            value={job}
            onChange={(e) => setJob(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && job.trim()) {
                e.preventDefault();
                codeBox.current?.focus();
              }
            }}
            className={cx(input, 'w-[200px] font-mono')}
          />
        </Field>
        <Field label="2. Part">
          <input
            ref={codeBox}
            aria-label="Part barcode, code or serial"
            placeholder="Barcode, code or serial"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void scan();
              }
            }}
            className={cx(input, 'w-[220px] font-mono')}
          />
        </Field>
        <Field label="Qty">
          <input aria-label="Quantity" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ''))} className={cx(input, 'w-[80px]')} />
        </Field>
        <button type="button" className={btnSmall} disabled={busy || !job.trim() || !code.trim()} onClick={() => void scan()}>
          <Icon name="scan" size={14} /> Look up
        </button>
        <button
          type="button"
          className={btnSmall}
          onClick={() => {
            setJob('');
            setCode('');
            setFound(null);
            jobBox.current?.focus();
          }}
        >
          Next job
        </button>
      </section>

      {found ? (
        <section aria-label="What will be issued" className="flex flex-col gap-2 rounded-[12px] border border-primary/40 bg-surface px-4 py-3 text-[12.5px]">
          <span className="flex flex-wrap items-center gap-2">
            <b className="text-[14px] text-ink">{found.product.name}</b>
            {found.product.code ? <span className="font-mono text-ink-3">{found.product.code}</span> : null}
            <span className="flex-1" />
            <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onJob(found.job.id, 'parts')}>
              {found.job.number}
            </button>
          </span>
          <span className="text-ink-2">
            Approved {found.approved} · issued {found.issued} · on the shelf {found.available ?? '—'}
            {found.request ? ` · request #${found.request.id} (${found.request.status}, ${found.request.reserved_outstanding} reserved)` : ' · no request yet: one is made at the counter'}
          </span>
          {found.why ? <span className="font-semibold text-warning">{found.why}</span> : null}
          <div className="flex flex-wrap items-end gap-2">
            {serialised ? (
              <Field label="Serial">
                <input aria-label="Serial" value={serial} onChange={(e) => setSerial(e.target.value)} className={cx(input, 'w-[200px] font-mono')} />
              </Field>
            ) : null}
            {found.product.tracking === 'batch' ? (
              <Field label="Batch" hint="Empty: the first to expire">
                <input aria-label="Batch" value={batch} onChange={(e) => setBatch(e.target.value)} className={cx(input, 'w-[160px]')} />
              </Field>
            ) : null}
            {found.over_approved && mayOverride ? (
              <>
                <label className="flex items-center gap-1.5 pb-2 font-semibold">
                  <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Issue beyond the approval
                </label>
                {override ? <input aria-label="Why beyond the approval" placeholder="Why" value={reason} onChange={(e) => setReason(e.target.value)} className={cx(input, 'w-[240px]')} maxLength={255} /> : null}
              </>
            ) : null}
            <span className="flex-1" />
            <button type="button" className={btnPrimary} disabled={!online || busy || (serialised && !serial.trim()) || (found.over_approved && (!override || !reason.trim()))} onClick={() => void issue()}>
              <Icon name="check" size={15} /> Issue
            </button>
          </div>
          {found.over_approved && !mayOverride ? <span className="text-warning">More than the customer approved: a workshop manager can issue it with a reason, or raise it as additional work.</span> : null}
        </section>
      ) : null}

      <Panel
        title="Requests"
        sub={queue.data ? `${queue.data.meta.total}` : undefined}
        action={
          <span className="flex flex-wrap gap-1.5">
            <input aria-label="Search requests" placeholder="Job or part" value={search} onChange={(e) => setSearch(e.target.value)} className={cx(input, 'h-8 w-[160px]')} />
            <Select aria-label="Status" value={status} onValueChange={setStatus} options={[{ value: '', label: 'Open' }, { value: 'unreconciled', label: 'Issued, not reconciled' }, { value: 'issued', label: 'Issued' }, { value: 'cancelled', label: 'Cancelled' }]} />
            <Select aria-label="Urgency" value={urgency} onValueChange={setUrgency} options={[{ value: '', label: 'Any urgency' }, { value: 'urgent', label: 'Urgent' }, { value: 'normal', label: 'Normal' }]} />
          </span>
        }
      >
        {queue.isLoading ? <Spinner /> : queue.error ? <ErrorNote error={queue.error} onRetry={() => void queue.refetch()} /> : null}
        {(queue.data?.items ?? []).map((r) => (
          <div key={r.id} className="flex items-center gap-2.5 border-b border-line/70 px-3.5 py-2 text-[12.5px] last:border-b-0">
            {r.urgency === 'urgent' ? <Pill tone="red">Urgent</Pill> : null}
            <button type="button" className="w-[130px] shrink-0 text-left font-bold text-primary hover:underline" onClick={() => onJob(r.job.id, 'parts')}>
              {r.job.number}
            </button>
            <span className="min-w-0 flex-1 truncate">
              <b className="text-ink">{r.product.name}</b> × {r.qty} <span className="text-ink-3">· {r.job.vehicle}</span>
            </span>
            <span className="text-ink-3">{[r.available !== null ? `${r.available} free` : null, r.requisition_ref, `${r.age_days} d`].filter(Boolean).join(' · ')}</span>
            <Pill tone={r.status === 'reserved' ? 'blue' : 'amber'}>{r.status_label}</Pill>
            {r.status === 'requested' || r.status === 'purchase_requested' ? (
              <button type="button" className={btnSmall} disabled={!online} onClick={() => void reserve(r.id)}>
                Reserve
              </button>
            ) : null}
            {r.status === 'reserved' || r.status === 'requested' ? (
              <button
                type="button"
                className={btnSmall}
                onClick={() => {
                  setJob(r.job.number);
                  setCode(r.product.code ?? '');
                  setQty(String(r.qty));
                  codeBox.current?.focus();
                }}
              >
                Issue…
              </button>
            ) : null}
          </div>
        ))}
        {queue.data && !queue.data.items.length ? <div className="px-3.5 py-5 text-center text-[12.5px] text-ink-3">Nothing waits at the counter.</div> : null}
      </Panel>
    </div>
  );
}
