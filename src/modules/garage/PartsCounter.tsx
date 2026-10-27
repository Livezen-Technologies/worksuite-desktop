import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Select } from '../../components/Select';
import { Button, ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { PageHead } from '../../components/PageKit';
import { errorText, gGet, gPost, K, newKey, partCounts, qty, remaining, when, type PartUsage } from './api';
import { Field, input, PartPill, Section, useGarage } from './parts';

const QUEUES: { key: string; label: string }[] = [
  { key: 'requests', label: 'To reserve' },
  { key: 'reserved', label: 'Reserved' },
  { key: 'issued', label: 'Out, not settled' },
  { key: 'returned', label: 'Returned' },
];

/**
 * The parts counter (§17, WF-14), for the counter PC. A scanner that types —
 * a keyboard wedge — works as it is: scan the job's number, then the part's
 * barcode, and that job's row for the part opens ready to issue. Below, the
 * queues: what technicians asked for or estimates need, what is held for
 * jobs, what is out and not yet used or returned, and returns. What may be
 * issued, how much and by whom is the server's rule; the buttons only offer
 * what the row's status allows.
 */
export default function PartsCounter() {
  const g = useGarage();
  const qc = useQueryClient();
  const [view, setView] = useState('requests');
  const [search, setSearch] = useState('');
  const [job, setJob] = useState('');
  const [code, setCode] = useState('');
  const [found, setFound] = useState<PartUsage | null>(null);
  const partInput = useRef<HTMLInputElement>(null);
  const q = useQuery({ queryKey: K.parts(g.org, view, search), queryFn: ({ signal }) => gGet<{ parts: PartUsage[] }>('/parts-queue', { view, q: search, org: g.org }, signal) });
  const technicians = g.options.technicians.map((t) => ({ id: t.id, name: t.name }));
  const can = { issue: g.may('garage.parts.issue'), return: g.may('garage.parts.return'), override: g.may('garage.parts.override') };
  const reload = () => void qc.invalidateQueries({ queryKey: ['garage', 'parts'] });

  const scan = async () => {
    try {
      const r = await gPost<{ usage: PartUsage; job: { id: number; number: string } }>('/parts-scan', { job, code, org: g.org });
      const u = r.data?.usage;
      if (!u) return;
      if (u.status === 'RESERVED' || u.status === 'ISSUED') {
        setFound({ ...u, job_number: r.data.job.number });
      } else {
        toast('warning', `${u.description} on ${r.data.job.number} is ${u.status.toLowerCase().replace(/_/g, ' ')} — reserve it first.`);
        setSearch(r.data.job.number);
        setView('requests');
      }
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setCode('');
    }
  };

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title="Parts counter" sub="Reserve, issue by scan, take back." />
      <Section title="Scan">
        <form
          className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            void scan();
          }}
        >
          <input
            className={cx(input, 'font-mono')}
            placeholder="Job number, e.g. JOB-2026-000123"
            aria-label="Job number"
            value={job}
            onChange={(e) => setJob(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && job) {
                e.preventDefault();
                partInput.current?.focus();
              }
            }}
          />
          <input ref={partInput} className={cx(input, 'font-mono')} placeholder="Part barcode or code" aria-label="Part barcode" value={code} onChange={(e) => setCode(e.target.value)} />
          <Button type="submit" variant="primary" icon="scan" disabled={!job || !code}>
            Find
          </Button>
        </form>
      </Section>
      <div className="flex flex-wrap items-center gap-2">
        <nav className="flex flex-1 flex-wrap gap-1" aria-label="Queues">
          {QUEUES.map((v) => (
            <button
              key={v.key}
              type="button"
              aria-current={view === v.key ? 'page' : undefined}
              onClick={() => setView(v.key)}
              className={cx('h-7 rounded-[8px] px-2.5 text-[12px] font-semibold', view === v.key ? 'bg-primary text-white' : 'border border-line bg-surface text-ink-2 hover:bg-subtle')}
            >
              {v.label}
            </button>
          ))}
        </nav>
        <input className={cx(input, 'w-64')} placeholder="Job, plate or part" aria-label="Search parts" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {q.isLoading ? (
        <Spinner />
      ) : q.error || !q.data ? (
        <ErrorNote error={q.error ?? new Error('The parts could not be loaded.')} onRetry={() => void q.refetch()} />
      ) : q.data.parts.length === 0 ? (
        <p className="text-[13px] text-ink-3">{view === 'requests' ? 'Nothing waiting to be reserved.' : 'Nothing here.'}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-line overflow-hidden rounded-[12px] border border-line bg-surface p-0">
          {q.data.parts.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="m-0 flex flex-wrap items-center gap-1.5 text-[13px]">
                  <PartPill status={u.status} />
                  {u.urgency === 'URGENT' ? <span className="rounded-[6px] bg-danger-bg px-1.5 text-[10.5px] font-bold text-danger">URGENT</span> : null}
                  <span className="font-medium">{u.description}</span>
                </p>
                <p className="m-0 text-[12px] text-ink-3">
                  <button type="button" className="font-mono font-semibold text-primary" onClick={() => g.openJob(u.job_id)}>
                    {u.job_number}
                  </button>{' '}
                  · {u.vehicle}
                  {u.requested_by ? ` · asked by ${u.requested_by}` : ''}
                  {u.reason ? ` — ${u.reason}` : ''} · {when(u.created_at)}
                </p>
                <span className="text-[12px] text-ink-3">{partCounts(u)}</span>
              </div>
              <PartActions u={u} can={can} technicians={technicians} onChange={reload} />
            </li>
          ))}
        </ul>
      )}
      {found ? (
        <IssuePart
          u={found}
          canOverride={can.override}
          technicians={technicians}
          onClose={() => setFound(null)}
          onDone={() => {
            setFound(null);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

type Ask = { kind: 'used' | 'return' | 'release'; u: PartUsage } | null;

/**
 * The counter's actions on one row (WF-14, SM-06), here and on a job's Work
 * tab. `used` is a technician's own "this much went on" (the counter's too).
 */
export function PartActions({ u, can, technicians, onChange }: { u: PartUsage; can: { issue: boolean; return: boolean; override: boolean; used?: boolean }; technicians: { id: number; name: string }[]; onChange: () => void }) {
  const [issuing, setIssuing] = useState(false);
  const [asking, setAsking] = useState<Ask>(null);
  const [busy, setBusy] = useState(false);
  const act = async (action: string, body: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const r = await gPost(`/parts-usage/${u.id}/${action}`, body, newKey(`part-${action}`));
      toast('success', r.message);
      onChange();
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const out = Math.round((u.issued_qty - u.used_qty - u.returned_qty) * 1000) / 1000;
  const unissued = u.issued_qty === 0 && ['REQUESTED', 'RESERVED', 'PURCHASE_REQUESTED'].includes(u.status);

  return (
    <div className="flex flex-wrap justify-end gap-1">
      {can.issue && (u.status === 'REQUESTED' || u.status === 'PURCHASE_REQUESTED') ? (
        <Button size="sm" loading={busy} onClick={() => void act('reserve')}>
          Reserve
        </Button>
      ) : null}
      {can.issue && u.status === 'REQUESTED' ? (
        <Button size="sm" variant="ghost" loading={busy} onClick={() => void act('requisition')}>
          Purchase request
        </Button>
      ) : null}
      {can.issue && (u.status === 'RESERVED' || u.status === 'ISSUED') ? (
        <Button size="sm" variant="primary" onClick={() => setIssuing(true)}>
          Issue
        </Button>
      ) : null}
      {(can.used ?? can.issue) && u.status === 'ISSUED' ? (
        <Button size="sm" variant="ghost" onClick={() => setAsking({ kind: 'used', u })}>
          Used
        </Button>
      ) : null}
      {can.return && out > 0 ? (
        <Button size="sm" variant="ghost" onClick={() => setAsking({ kind: 'return', u })}>
          Return
        </Button>
      ) : null}
      {can.issue && unissued ? (
        <Button size="sm" variant="ghost" onClick={() => setAsking({ kind: 'release', u })}>
          Release
        </Button>
      ) : null}
      {issuing ? (
        <IssuePart
          u={u}
          canOverride={can.override}
          technicians={technicians}
          onClose={() => setIssuing(false)}
          onDone={() => {
            setIssuing(false);
            onChange();
          }}
        />
      ) : null}
      {asking ? (
        <Settle
          ask={asking}
          onClose={() => setAsking(null)}
          onSave={(action, body) => {
            setAsking(null);
            void act(action, body);
          }}
        />
      ) : null}
    </div>
  );
}

/** How many went on the vehicle, what comes back and in what state, or why it is released. */
function Settle({ ask, onClose, onSave }: { ask: NonNullable<Ask>; onClose: () => void; onSave: (action: string, body: Record<string, unknown>) => void }) {
  const u = ask.u;
  const out = Math.max(0, Math.round((u.issued_qty - u.used_qty - u.returned_qty) * 1000) / 1000);
  const [n, setN] = useState(ask.kind === 'used' ? qty(u.issued_qty - u.returned_qty) : qty(out));
  const [condition, setCondition] = useState('NEW');
  const [why, setWhy] = useState('');
  const title = ask.kind === 'used' ? `How many ${u.description} went on the vehicle?` : ask.kind === 'return' ? `Return ${u.description}` : `Release ${u.description}?`;
  const save = () =>
    ask.kind === 'used' ? onSave('used', { qty: Number(n) }) : ask.kind === 'return' ? onSave('return', { qty: Number(n), condition }) : onSave('release', { reason: why });
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={ask.kind !== 'release' && !(Number(n) >= 0 && n !== '')} onClick={save}>
            {ask.kind === 'used' ? 'Save' : ask.kind === 'return' ? 'Return' : 'Release'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {ask.kind === 'used' ? <p className="m-0 text-[12.5px] text-ink-3">{qty(u.issued_qty - u.returned_qty)} issued and not returned. The rest is returned to stock.</p> : null}
        {ask.kind === 'release' ? <p className="m-0 text-[12.5px] text-ink-3">It goes back to stock for other jobs.</p> : null}
        {ask.kind !== 'release' ? (
          <Field label="How many">
            <input className={input} inputMode="decimal" value={n} onChange={(e) => setN(e.target.value)} />
          </Field>
        ) : (
          <Field label="Why (optional)">
            <input className={input} value={why} onChange={(e) => setWhy(e.target.value)} />
          </Field>
        )}
        {ask.kind === 'return' ? (
          <Field label="Condition">
            <Select aria-label="Condition" value={condition} onChange={(e) => setCondition(e.target.value)} options={[{ value: 'NEW', label: 'New, unopened' }, { value: 'OPENED', label: 'Opened' }, { value: 'DAMAGED', label: 'Damaged' }]} className={input} />
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}

/** Issue to the job (FR-PRT-03): how many, to whom, the serial or batch, and — beyond what was approved — why (FR-PRT-07). */
export function IssuePart({ u, canOverride, technicians, onClose, onDone }: { u: PartUsage; canOverride: boolean; technicians: { id: number; name: string }[]; onClose: () => void; onDone: () => void }) {
  const left = remaining(u);
  const [n, setN] = useState(qty(left > 0 ? left : 1));
  const [tech, setTech] = useState('');
  const [serial, setSerial] = useState('');
  const [batch, setBatch] = useState('');
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const over = Number(n) > left;
  const issue = async () => {
    setBusy(true);
    try {
      const r = await gPost(
        `/parts-usage/${u.id}/issue`,
        { qty: Number(n), technician_id: Number(tech) || undefined, serial_no: serial || undefined, batch_no: batch || undefined, override_reason: over ? why : undefined },
        newKey('part-issue'),
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
      title={`Issue ${u.description}${u.job_number ? ` · ${u.job_number}` : ''}`}
      onClose={onClose}
      width={560}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!(Number(n) > 0) || (over && (!canOverride || !why.trim()))} onClick={() => void issue()}>
            Issue
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="How many" hint={`${qty(left)} ${u.source === 'ESTIMATE' ? 'approved' : 'asked for'} and not issued.`}>
            <input className={input} inputMode="decimal" value={n} onChange={(e) => setN(e.target.value)} autoFocus />
          </Field>
          <Field label="To">
            <Select aria-label="Technician" value={tech} onChange={(e) => setTech(e.target.value)} options={[{ value: '', label: 'Technician' }, ...technicians.map((t) => ({ value: String(t.id), label: t.name }))]} className={input} />
          </Field>
          <Field label="Serial number" hint="For serial-tracked parts.">
            <input className={input} value={serial} onChange={(e) => setSerial(e.target.value)} />
          </Field>
          <Field label="Batch" hint="For batch-tracked parts.">
            <input className={input} value={batch} onChange={(e) => setBatch(e.target.value)} />
          </Field>
        </div>
        {over ? (
          canOverride ? (
            <Field label="Why more than approved" hint="Kept in the audit log.">
              <input className={input} value={why} onChange={(e) => setWhy(e.target.value)} />
            </Field>
          ) : (
            <p className="m-0 rounded-[8px] bg-warning-bg px-3 py-2 text-[12.5px] text-warning">That is more than {u.source === 'ESTIMATE' ? 'the customer approved' : 'was asked for'}. Raise additional work, or ask a manager to issue it.</p>
          )
        ) : null}
      </div>
    </Modal>
  );
}
