import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { timeLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Select } from '../../../components/Select';
import { ErrorNote, Modal, Spinner, cx } from '../../../components/ui';
import { btn, btnPrimary, btnSmall, input, PageHead } from '../../hr/parts';
import type { Transition } from '../api';
import { OFFLINE_WRITE, refusalOf } from '../api';
import { fetchBays, KB2, setBayStatus, type BayRow } from '../api-b2';
import { Pill } from '../parts';
import type { GarageViewProps } from '../registry';

/**
 * The bay board (SRS §16.1, FR-BAY-01..03, SM-05), stage B2: every bay with
 * its state in the server's words, the job in it and its work, the slot now
 * and the next one, and the moves a manager may make — cleaned, out for
 * maintenance or blocked (with a reason), back in service, the vehicle moved.
 * Bookings and timers move bays by themselves; those are not offered here.
 */
const TONE = (s: string): 'green' | 'blue' | 'amber' | 'red' | 'grey' => (s === 'available' ? 'green' : s === 'occupied' ? 'blue' : s === 'reserved' || s === 'cleaning' ? 'amber' : s === 'maintenance' || s === 'blocked' ? 'red' : 'grey');

export default function Bays({ org, options, online, onJob }: GarageViewProps) {
  const qc = useQueryClient();
  const [branch, setBranch] = useState('');
  const q = useQuery({ queryKey: KB2.bays(org, branch), queryFn: ({ signal }) => fetchBays(org, branch, signal), refetchInterval: 30_000, placeholderData: (p) => p });
  const [ask, setAsk] = useState<{ bay: BayRow; t: Transition } | null>(null);
  const branches = options.companies.filter((c) => !org || String(c.id) === org).flatMap((c) => c.branches.filter((b) => b.branch_id > 0).map((b) => ({ value: String(b.branch_id), label: b.name })));
  const move = async (bay: BayRow, t: Transition, reason?: string) => {
    if (!online) return toast('error', OFFLINE_WRITE);
    if (t.needs.includes('reason') && !reason) return setAsk({ bay, t });
    try {
      const r = await setBayStatus(bay.id, { to: t.to, ...(reason ? { reason } : {}) });
      toast('success', r.message || `${bay.code}: ${t.label}.`);
      setAsk(null);
      void qc.invalidateQueries({ queryKey: ['garage'] });
    } catch (e) {
      toast('error', refusalOf(e).message);
    }
  };
  const items = q.data?.items ?? [];
  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      <PageHead title="Service bays" sub={items.length ? `${items.filter((b) => b.status === 'available').length} of ${items.length} free` : undefined}>
        {branches.length > 1 ? <Select label="Branch" value={branch} onValueChange={setBranch} options={[{ value: '', label: 'Every branch' }, ...branches]} /> : null}
      </PageHead>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2.5">
        {items.map((b) => (
          <section key={b.id} aria-label={b.code} className={cx('flex flex-col gap-1.5 rounded-[12px] border border-line bg-surface px-3.5 py-3 text-[12.5px]', !b.active && 'opacity-60')}>
            <span className="flex items-center gap-2">
              <b className="text-[14px] text-ink">{b.code}</b>
              <span className="min-w-0 flex-1 truncate text-ink-3">
                {b.name} · {b.bay_type_label}
              </span>
              <Pill tone={TONE(b.status)}>{b.status_label}</Pill>
            </span>
            {b.status_reason ? <span className="text-ink-2">{b.status_reason}</span> : null}
            {b.job ? (
              <button type="button" className="text-left font-semibold text-primary hover:underline" onClick={() => onJob(b.job!.id)}>
                {b.job.number} · {b.job.vehicle?.vehicle_number ?? ''}
              </button>
            ) : b.occupied_by_hidden_job ? (
              <span className="text-ink-3">A job you do not see is in it.</span>
            ) : null}
            {b.work_orders.length ? <span className="text-ink-2">{b.work_orders.map((w) => `${w.code} ${w.status_label}`).join(' · ')}</span> : null}
            <span className="text-ink-3">
              {b.booking ? `Now: ${timeLabel(b.booking.starts_at)}–${timeLabel(b.booking.ends_at)}` : ''}
              {b.next_booking ? `${b.booking ? ' · ' : ''}Next: ${timeLabel(b.next_booking.starts_at)}${b.next_booking.job ? ` ${b.next_booking.job.number}` : ''}` : ''}
            </span>
            {b.actions.some((a) => a.allowed) ? (
              <div className="flex flex-wrap gap-1 pt-1">
                {b.actions
                  .filter((a) => a.allowed)
                  .map((a) => (
                    <button key={a.to} type="button" className={btnSmall} disabled={!online} onClick={() => void move(b, a)}>
                      {a.label}
                    </button>
                  ))}
              </div>
            ) : null}
          </section>
        ))}
      </div>
      {q.data && !items.length ? <p className="m-0 text-[12.5px] text-ink-3">No bays set up. Add them in Set-up.</p> : null}
      {ask ? <ReasonModal title={`${ask.bay.code}: ${ask.t.label}`} onClose={() => setAsk(null)} onSave={(r) => void move(ask.bay, ask.t, r)} /> : null}
    </div>
  );
}

function ReasonModal({ title, onClose, onSave }: { title: string; onClose: () => void; onSave: (reason: string) => void }) {
  const [t, setT] = useState('');
  return (
    <Modal
      title={title}
      width={440}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={!t.trim()} onClick={() => onSave(t.trim())}>
            Save
          </button>
        </>
      }
    >
      <input autoFocus aria-label="Why" placeholder="Why" value={t} onChange={(e) => setT(e.target.value)} className={input} maxLength={255} />
    </Modal>
  );
}
