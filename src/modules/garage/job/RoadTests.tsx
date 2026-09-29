import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { dateLabel, timeLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Modal, cx } from '../../../components/ui';
import { btn, btnPrimary, btnSmall, Field, input } from '../../hr/parts';
import { localToIso, OFFLINE_WRITE, refusalOf, tempId } from '../api';
import type { WorkOrdersTab } from '../api-b2';
import { recordRoadTest, updateRoadTest, type RoadTest, type RoadTestsTab } from '../api-b3';
import { Pill } from '../parts';
import type { JobTabProps } from '../registry';

/**
 * Road tests (SRS §18, FR-RDT-01..02, WF-17), stage B3 — usually recorded by
 * the phone on the drive; here a test can be written down after the fact
 * (the server keeps the times given and makes the end odometer a reading),
 * given its verdict, and — when a test after the check failed — the work
 * sent back to rework. Only a test ended after the quality check passed
 * counts for delivery.
 */
const stamp = (s: string | null | undefined) => (s ? `${dateLabel(s)} ${timeLabel(s)}` : '—');

/** The body of `POST jobs/{id}/road-tests`, with the key that makes a second press the same test. */
export function roadTestBody(f: { start: string; end: string; startKm: string; endKm: string; route: string; issueConfirmed: boolean; repairVerified: boolean; newIssue: string; result: string; notes: string }, key: string): Record<string, unknown> {
  const n = (v: string) => (v.trim() === '' ? undefined : Number(v));
  return {
    started_at: localToIso(f.start),
    ended_at: localToIso(f.end),
    ...(n(f.startKm) !== undefined ? { start_odometer: n(f.startKm) } : {}),
    ...(n(f.endKm) !== undefined ? { end_odometer: n(f.endKm) } : {}),
    ...(f.route.trim() ? { route: f.route.trim() } : {}),
    issue_confirmed: f.issueConfirmed,
    repair_verified: f.repairVerified,
    ...(f.newIssue.trim() ? { new_issue: f.newIssue.trim() } : {}),
    ...(f.result ? { result: f.result } : {}),
    ...(f.notes.trim() ? { notes: f.notes.trim() } : {}),
    client_temp_id: key,
  };
}

export default function RoadTests({ job, online, onChanged }: JobTabProps) {
  const qc = useQueryClient();
  const tab = job.road_tests as RoadTestsTab;
  const [recording, setRecording] = useState(false);
  const [sending, setSending] = useState<RoadTest | null>(null);
  const [busy, setBusy] = useState(false);
  const workOrders = ((job.work_orders as WorkOrdersTab | null | undefined)?.items ?? []).filter((w) => !w.internal);
  const act = async (fn: () => Promise<{ message?: string | null }>, done: string) => {
    if (!online) {
      toast('error', OFFLINE_WRITE);
      return false;
    }
    setBusy(true);
    try {
      const r = await fn();
      toast('success', r.message || done);
      void qc.invalidateQueries({ queryKey: ['garage', 'job', job.id] });
      onChanged();
      return true;
    } catch (e) {
      toast('error', refusalOf(e).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const inShop = !['draft', 'completed', 'cancelled'].includes(job.status);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="flex-1 text-ink-2">
          {tab.required ? 'This job needs a road test after the quality check.' : 'No road test is required for this job.'}
          {tab.result_since_qc ? ` Since the check: ${tab.result_since_qc === 'passed' ? 'passed' : 'failed'}.` : ''}
        </span>
        {tab.can.record && inShop ? (
          <button type="button" className={btnPrimary} disabled={!online} onClick={() => setRecording(true)}>
            <Icon name="plus" size={15} /> Record a road test
          </button>
        ) : null}
      </div>
      {tab.tests.map((t) => (
        <section key={t.id} aria-label={`Road test ${stamp(t.started_at)}`} className="flex flex-col gap-1 rounded-[12px] border border-line bg-surface px-4 py-3 text-[12.5px]">
          <span className="flex flex-wrap items-center gap-2">
            <b className="text-ink">{stamp(t.started_at)}</b>
            <span className="text-ink-3">{[t.driver?.name, t.distance_km !== null ? `${t.distance_km} km` : null, t.duration_s ? `${Math.round(t.duration_s / 60)} min` : null, t.points_count ? `${t.points_count} points` : null].filter(Boolean).join(' · ')}</span>
            <span className="flex-1" />
            {t.result ? <Pill tone={t.result === 'passed' ? 'green' : 'red'}>{t.result === 'passed' ? 'Passed' : 'Failed'}</Pill> : <Pill>No verdict</Pill>}
          </span>
          <span className="text-ink-2">{[t.route, t.issue_confirmed ? 'issue confirmed' : null, t.repair_verified ? 'repair verified' : null, t.new_issue ? `new issue: ${t.new_issue}` : null, t.notes].filter(Boolean).join(' · ')}</span>
          <span className="flex flex-wrap gap-1">
            {!t.result && tab.can.record ? (
              <>
                <button type="button" className={btnSmall} disabled={!online || busy} onClick={() => void act(() => updateRoadTest(t.id, { result: 'passed' }), 'Passed.')}>
                  Passed
                </button>
                <button type="button" className={btnSmall} disabled={!online || busy} onClick={() => void act(() => updateRoadTest(t.id, { result: 'failed' }), 'Failed.')}>
                  Failed
                </button>
              </>
            ) : null}
            {t.result === 'failed' && tab.can.send_back && job.status === 'road_test' ? (
              <button type="button" className={btnSmall} disabled={!online} onClick={() => setSending(t)}>
                Send back to rework
              </button>
            ) : null}
          </span>
        </section>
      ))}
      {!tab.tests.length ? <p className="m-0 text-[12.5px] text-ink-3">No road test yet.</p> : null}
      {recording ? <RecordSheet onClose={() => setRecording(false)} onSave={(body) => void act(() => recordRoadTest(job.id, body), 'Road test recorded.').then((ok) => ok && setRecording(false))} /> : null}
      {sending ? <SendBack workOrders={workOrders} onClose={() => setSending(null)} onSave={(reason, ids) => void act(() => updateRoadTest(sending.id, { result: 'failed', reason, work_orders: ids }), 'Sent back to rework.').then((ok) => ok && setSending(null))} /> : null}
    </div>
  );
}

function RecordSheet({ onClose, onSave }: { onClose: () => void; onSave: (body: Record<string, unknown>) => void }) {
  // One key for this form: pressing Save again after a dropped connection is the same test.
  const [key] = useState(tempId);
  const [f, setF] = useState({ start: '', end: '', startKm: '', endKm: '', route: '', issueConfirmed: false, repairVerified: false, newIssue: '', result: '', notes: '' });
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  return (
    <Modal
      title="Record a road test"
      width={560}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={!f.start || !f.end} onClick={() => onSave(roadTestBody(f, key))}>
            Save
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2.5 text-[12.5px]">
        <Field label="Started" hint="Your clock">
          <input aria-label="Started" type="datetime-local" value={f.start} onChange={(e) => set({ start: e.target.value })} className={input} />
        </Field>
        <Field label="Ended">
          <input aria-label="Ended" type="datetime-local" value={f.end} onChange={(e) => set({ end: e.target.value })} className={input} />
        </Field>
        <Field label="Odometer at the start">
          <input aria-label="Odometer at the start" inputMode="numeric" value={f.startKm} onChange={(e) => set({ startKm: e.target.value.replace(/[^\d]/g, '') })} className={input} />
        </Field>
        <Field label="Odometer at the end">
          <input aria-label="Odometer at the end" inputMode="numeric" value={f.endKm} onChange={(e) => set({ endKm: e.target.value.replace(/[^\d]/g, '') })} className={input} />
        </Field>
        <Field label="Route" className="col-span-2">
          <input aria-label="Route" value={f.route} onChange={(e) => set({ route: e.target.value })} className={input} maxLength={255} />
        </Field>
        <label className="flex items-center gap-1.5 font-semibold">
          <input type="checkbox" checked={f.issueConfirmed} onChange={(e) => set({ issueConfirmed: e.target.checked })} /> The reported issue was felt
        </label>
        <label className="flex items-center gap-1.5 font-semibold">
          <input type="checkbox" checked={f.repairVerified} onChange={(e) => set({ repairVerified: e.target.checked })} /> The repair holds
        </label>
        <Field label="Something new?" className="col-span-2">
          <input aria-label="New issue" value={f.newIssue} onChange={(e) => set({ newIssue: e.target.value })} className={input} maxLength={500} />
        </Field>
        <div role="radiogroup" aria-label="Result" className="col-span-2 flex gap-1">
          {[
            ['passed', 'Passed'],
            ['failed', 'Failed'],
            ['', 'Decide later'],
          ].map(([v, label]) => (
            <button key={v} type="button" role="radio" aria-checked={f.result === v} onClick={() => set({ result: v! })} className={cx('h-8 rounded-[7px] px-3 font-semibold', f.result === v ? 'bg-primary text-white' : 'border border-line bg-surface text-ink-2')}>
              {label}
            </button>
          ))}
        </div>
        <Field label="Notes" className="col-span-2">
          <textarea aria-label="Notes" value={f.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} className={cx(input, 'h-auto py-2')} maxLength={1000} />
        </Field>
      </div>
    </Modal>
  );
}

function SendBack({ workOrders, onClose, onSave }: { workOrders: Array<{ id: number; code: string; work_type: string }>; onClose: () => void; onSave: (reason: string, ids: number[]) => void }) {
  const [reason, setReason] = useState('');
  const [ids, setIds] = useState<number[]>([]);
  return (
    <Modal
      title="Send back to rework"
      width={480}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={!reason.trim() || !ids.length} onClick={() => onSave(reason.trim(), ids)}>
            Send back
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2 text-[12.5px]">
        <input autoFocus aria-label="Why" placeholder="Why" value={reason} onChange={(e) => setReason(e.target.value)} className={input} maxLength={500} />
        {workOrders.map((w) => (
          <label key={w.id} className="flex items-center gap-2">
            <input type="checkbox" checked={ids.includes(w.id)} onChange={(e) => setIds((x) => (e.target.checked ? [...x, w.id] : x.filter((y) => y !== w.id)))} /> {w.code} · {w.work_type}
          </label>
        ))}
      </div>
    </Modal>
  );
}
