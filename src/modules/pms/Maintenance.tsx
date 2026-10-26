import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/Select';
import { Button, ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { input } from '../garage/parts';
import { PageHead } from '../hr/parts';
import { day, errorText, K, labelled, newKey, pGet, pGetMeta, pPost, type Issue, type IssueList, type Rack } from './api';
import { PersonPick } from './ops';
import { NoAccess, Refusal, usePms } from './parts';
import { clickOnKey } from '../../components/press';

/** Who reads maintenance, and who may report a fault (`MaintenanceController::READ`, `REPORT`). */
export const MAINT_READ = ['pms.maintenance.manage', 'pms.housekeeping.view', 'pms.room.manage', 'pms.guest_request.manage', 'pms.room.view'];
export const MAINT_REPORT = ['pms.maintenance.manage', 'pms.housekeeping.view', 'pms.room.manage', 'pms.guest_request.manage'];

export const CATEGORIES: Record<string, string> = {
  plumbing: 'Plumbing', electrical: 'Electrical', hvac: 'Air conditioning', furniture: 'Furniture', appliance: 'Appliance',
  carpentry: 'Carpentry', painting: 'Painting', it: 'TV, phone and Wi-Fi', safety: 'Safety and locks', general: 'General',
};
const PRIORITY: Record<string, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };

type Scope = 'open' | 'mine' | 'all';

/**
 * Maintenance (§11.3, PMS-MOB-004): the property's issues — open ones first,
 * urgent first — or the technician's own (`maintenance/my`), with a fault
 * reported for a room or a public area, given to a technician and, when the
 * room cannot be sold, taken out of order at once. Each issue opens on its
 * own screen for its lifecycle. Online only: an issue's state is the
 * server's.
 */
export default function Maintenance() {
  const pms = usePms();
  const pid = pms.property.id;
  const reads = pms.mayAny(...MAINT_READ);
  const fixes = pms.may('pms.maintenance.manage');
  const [scope, setScope] = useState<Scope>('open');
  const [category, setCategory] = useState('');
  const [reporting, setReporting] = useState(false);
  const f = { scope, category };
  const q = useQuery({
    queryKey: K.maintenance(pid, f),
    queryFn: ({ signal }) => pGet<IssueList>(scope === 'mine' ? `/properties/${pid}/maintenance/my` : `/properties/${pid}/maintenance`, scope === 'mine' ? undefined : { open: scope === 'open' ? 1 : undefined, category: category || undefined }, signal),
    enabled: reads && pms.online,
    refetchInterval: 60_000,
  });

  if (!reads) return <NoAccess what="Maintenance is shown to maintenance, housekeeping and the front desk." />;
  const items = (q.data?.items ?? []).filter((i) => !category || i.category === category);

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title="Maintenance" sub={pms.property.name}>
        {pms.mayAny(...MAINT_REPORT) ? (
          <Button variant="primary" icon="plus" disabled={!pms.online} onClick={() => setReporting(true)}>
            Report a fault
          </Button>
        ) : null}
      </PageHead>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Which issues">
        {(
          [
            ['open', 'Open'],
            ...(fixes ? [['mine', 'Mine']] : []),
            ['all', 'All'],
          ] as Array<[Scope, string]>
        ).map(([v, label]) => (
          <button key={v} type="button" aria-pressed={scope === v} onClick={() => setScope(v)} className={cx('rounded-[8px] border px-2 py-1 text-[12px] font-semibold', scope === v ? 'border-primary bg-selection text-primary' : 'border-line bg-surface')}>
            {label}
          </button>
        ))}
        <Select aria-label="Category" value={category} options={[{ value: '', label: 'Every category' }, ...Object.entries(CATEGORIES).map(([value, label]) => ({ value, label }))]} onChange={(e) => setCategory(e.target.value)} className={`${input} w-48`} />
      </div>
      {!pms.online ? (
        <p className="text-[13px] text-ink-3">Maintenance shows when WorkSuite is back.</p>
      ) : q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <p className="text-[13px] text-ink-3">{scope === 'mine' ? 'Nothing given to you.' : 'No issues.'}</p>
      ) : (
        <IssueRows items={items} />
      )}
      {reporting ? <ReportIssue onClose={() => setReporting(false)} onDone={(id) => pms.open({ kind: 'issue', id })} /> : null}
    </div>
  );
}

export function IssueRows({ items }: { items: Issue[] }) {
  const pms = usePms();
  return (
    <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
      <table className="w-full text-left text-[13px]">
        <thead className="bg-subtle text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
          <tr>
            <th className="px-3 py-2">Issue</th>
            <th className="px-3 py-2">Where</th>
            <th className="px-3 py-2">Priority</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Assigned</th>
            <th className="px-3 py-2">Reported</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr tabIndex={0} onKeyDown={clickOnKey} key={i.id} className="cursor-pointer border-t border-line hover:bg-subtle" onClick={() => pms.open({ kind: 'issue', id: i.id })}>
              <td className="px-3 py-1.5">
                <button type="button" className="text-left font-semibold text-primary" onClick={() => pms.open({ kind: 'issue', id: i.id })}>
                  {i.title}
                </button>
                <span className="block text-[11.5px] text-ink-3">{i.category_label}</span>
              </td>
              <td className="px-3 py-1.5">
                {i.room_number ? `Room ${i.room_number}` : '—'}
                {i.outage && i.outage.status === 'active' ? <span className="block text-[11.5px] font-semibold text-danger">{i.outage.kind_label}</span> : null}
              </td>
              <td className={cx('px-3 py-1.5', i.priority === 'urgent' ? 'font-semibold text-danger' : i.priority === 'high' ? 'font-semibold text-warning' : '')}>{PRIORITY[i.priority] ?? i.priority}</td>
              <td className="px-3 py-1.5">{i.status_label}</td>
              <td className="px-3 py-1.5 text-ink-2">{i.assigned_name ?? '—'}</td>
              <td className="px-3 py-1.5 text-ink-2">{day(i.business_date ?? i.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A fault reported (PMS-MNT-001): what, where, how urgent; given to a
 * technician by someone in maintenance; and — for maintenance or room
 * managers — the room taken out of order or out of service with it (AC-12).
 * One idempotent press.
 */
export function ReportIssue({ room, onClose, onDone }: { room?: { id: number; number: string } | null; onClose: () => void; onDone: (id: number) => void }) {
  const pms = usePms();
  const qc = useQueryClient();
  const pid = pms.property.id;
  const fixes = pms.may('pms.maintenance.manage');
  const outs = pms.mayAny('pms.maintenance.manage', 'pms.room.manage');
  const readsRack = pms.mayAny('pms.room.view', 'pms.reservation.view', 'pms.checkin', 'pms.room.manage');
  const rack = useQuery({ queryKey: K.rack(pid), queryFn: ({ signal }) => pGetMeta<Rack>(`/properties/${pid}/rack`, undefined, signal), enabled: !room && readsRack });
  const [v, setV] = useState({ title: '', room_id: room ? String(room.id) : '', category: 'general', priority: 'normal', description: '', ooo: '', end_date: '', reason: '' });
  const [assignee, setAssignee] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(() => newKey('issue'));
  const set = (patch: Partial<typeof v>) => setV((x) => ({ ...x, ...patch }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await pPost<{ id: number; out_of_order?: { message?: string; reassign?: Array<{ confirmation_no?: string }> } }>(
        `/properties/${pid}/maintenance`,
        {
          title: v.title.trim(),
          ...(v.room_id ? { room_id: Number(v.room_id) } : {}),
          category: v.category,
          priority: v.priority,
          ...(v.description.trim() ? { description: v.description.trim() } : {}),
          ...(assignee ? { assigned_to: assignee } : {}),
          ...(v.ooo && v.room_id ? { out_of_order: { kind: v.ooo, ...(v.end_date ? { end_date: v.end_date } : {}), ...(v.reason ? { reason: v.reason } : {}) } } : {}),
        },
        key,
      );
      toast('success', r.message);
      const move = r.data.out_of_order?.reassign ?? [];
      if (move.length) toast('info', `${move.length} reservation${move.length === 1 ? '' : 's'} to move: ${move.map((x) => x.confirmation_no).filter(Boolean).join(', ')}.`);
      void qc.invalidateQueries({ queryKey: ['pms', 'live'] });
      onClose();
      onDone(r.data.id);
    } catch (e) {
      setError(errorText(e, 'The fault was not reported.'));
    } finally {
      setBusy(false);
    }
  };

  const rooms = room ? [{ value: String(room.id), label: room.number }] : [{ value: '', label: 'No room (a public area)' }, ...(rack.data?.data.rooms ?? []).map((r) => ({ value: String(r.id), label: r.number }))];
  return (
    <Modal
      title={room ? `Report a fault in room ${room.number}` : 'Report a fault'}
      onClose={onClose}
      width={560}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!v.title.trim() || !pms.online} onClick={() => void save()}>
            Report
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-2 text-[12.5px]">
        <label className="col-span-2 flex flex-col gap-1">
          What is wrong
          <input aria-label="What is wrong" value={v.title} onChange={(e) => set({ title: e.target.value })} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          Room
          <Select aria-label="Room" value={v.room_id} options={rooms} onChange={(e) => set({ room_id: e.target.value })} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          Category
          <Select aria-label="Category" value={v.category} options={Object.entries(CATEGORIES).map(([value, label]) => ({ value, label }))} onChange={(e) => set({ category: e.target.value })} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          Priority
          <Select aria-label="Priority" value={v.priority} options={labelled(PRIORITY)} onChange={(e) => set({ priority: e.target.value })} className={input} />
        </label>
        {fixes ? (
          <label className="flex flex-col gap-1">
            Give to
            <PersonPick label="Technician" value={assignee} onChange={setAssignee} />
          </label>
        ) : null}
        <label className="col-span-2 flex flex-col gap-1">
          Details
          <textarea aria-label="Details" rows={2} value={v.description} onChange={(e) => set({ description: e.target.value })} className="rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px]" />
        </label>
        {outs && v.room_id ? (
          <>
            <label className="flex flex-col gap-1">
              The room
              <Select aria-label="Take the room out" value={v.ooo} options={[{ value: '', label: 'Stays in service' }, { value: 'out_of_order', label: 'Out of order (not sold)' }, { value: 'out_of_service', label: 'Out of service (still sold)' }]} onChange={(e) => set({ ooo: e.target.value })} className={input} />
            </label>
            {v.ooo ? (
              <>
                <label className="flex flex-col gap-1">
                  Until
                  <input aria-label="Until" type="date" value={v.end_date} onChange={(e) => set({ end_date: e.target.value })} className={input} />
                </label>
                <label className="col-span-2 flex flex-col gap-1">
                  Reason (blank: the fault)
                  <input aria-label="Reason" value={v.reason} onChange={(e) => set({ reason: e.target.value })} className={input} />
                </label>
              </>
            ) : null}
          </>
        ) : null}
      </div>
      {error ? <div className="mt-2"><Refusal text={error} /></div> : null}
    </Modal>
  );
}
