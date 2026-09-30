import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { Ask, Section } from '../garage/parts';
import { PageHead } from '../hr/parts';
import { codeOf, errorText, K, newKey, pGet, pGetMeta, pPost, stamp, type GuestRequest, type Rack } from './api';
import { PersonPick } from './ops';
import { NoAccess, Refusal, usePms, VipPill } from './parts';

type Req = GuestRequest & { version: number; options?: Array<{ action: string; to: string; label: string; needs: string[] }> };

/**
 * Guest requests at the desk (§11.4): take one from the phone or the counter
 * — extra towels, a wake-up call, a repair — for a room; the server routes it
 * to its department with its response and completion times, and a cleaning
 * or a repair becomes the housekeeping task or maintenance issue it needs.
 * The open ones are listed with the moves the server allows this person;
 * a request is given to a person (the company's directory — the server takes
 * only someone who handles guest requests at this property) or passed to
 * someone else while it is open.
 */
export default function Requests({ open }: { open: number | null }) {
  const pms = usePms();
  const qc = useQueryClient();
  const pid = pms.property.id;
  const manages = pms.may('pms.guest_request.manage');
  const reads = manages || pms.may('pms.reservation.view');
  const list = useQuery({ queryKey: ['pms', 'live', 'requests', pid], queryFn: ({ signal }) => pGet<{ items: Req[]; types: Record<string, string> }>(`/properties/${pid}/requests`, { open: 1 }, signal), enabled: reads && pms.online, refetchInterval: 60_000 });
  const one = useQuery({ queryKey: K.request(open ?? 0), queryFn: ({ signal }) => pGet<{ request: Req }>(`/guest-requests/${open}`, undefined, signal), enabled: !!open && reads });
  const rack = useQuery({ queryKey: K.rack(pid), queryFn: ({ signal }) => pGetMeta<Rack>(`/properties/${pid}/rack`, undefined, signal), enabled: manages });
  const [taking, setTaking] = useState(false);
  const [acting, setActing] = useState<{ r: Req; action: string; label: string } | null>(null);
  const [giving, setGiving] = useState<Req | null>(null);
  const [person, setPerson] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(() => newKey('request'));

  if (!reads) return <NoAccess what="Guest requests are shown to guest services and the front desk." />;
  const reload = () => {
    void qc.invalidateQueries({ queryKey: ['pms', 'live', 'requests', pid] });
    if (open) void qc.invalidateQueries({ queryKey: K.request(open) });
  };
  const act = async (r: Req, action: string, body: Record<string, string | number> = {}) => {
    setBusy(true);
    setError(null);
    try {
      const res = await pPost(`/guest-requests/${r.id}/${action}`, { version: r.version, ...body });
      toast('success', res.message);
      setActing(null);
      setGiving(null);
      reload();
    } catch (e) {
      setError(codeOf(e) === 'conflict' || codeOf(e) === 'version_conflict' ? `${errorText(e)} It has been reloaded.` : errorText(e, 'Nothing was changed.'));
      setActing(null);
      setGiving(null);
      reload();
    } finally {
      setBusy(false);
    }
  };
  const take = async (v: Record<string, string>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await pPost(`/properties/${pid}/requests`, { request_type: v.request_type, room_id: Number(v.room_id), source: v.source || 'front_desk', priority: v.priority || undefined, ...(v.description ? { description: v.description } : {}) }, key);
      setKey(newKey('request'));
      toast('success', res.message);
      setTaking(false);
      reload();
    } catch (e) {
      setError(errorText(e, 'The request was not taken.'));
      setTaking(false);
    } finally {
      setBusy(false);
    }
  };

  const types = list.data?.types ?? { extra_towels: 'Extra towels', room_cleaning: 'Room cleaning', maintenance: 'Maintenance', room_service: 'Room service', wake_up_call: 'Wake-up call', airport_pickup: 'Airport pickup', late_checkout: 'Late checkout', other: 'Other' };
  const row = (r: Req) => (
    <li key={r.id} className={cx('flex flex-wrap items-center gap-2 rounded-[10px] border bg-surface px-3 py-2 text-[13px]', r.overdue ? 'border-danger/50' : 'border-line')}>
      <b className="w-14 tabular-nums">{r.room_number ?? '—'}</b>
      <span className="min-w-0 flex-1">
        <b>{r.type_label}</b> · {r.department_label}
        {r.description ? ` · ${r.description}` : ''}
        <span className="block text-[12px] text-ink-3">
          {r.status_label}
          {r.assigned_name ? ` · ${r.assigned_name}` : ''}
          {r.due_at ? ` · due ${stamp(r.due_at)}` : ''}
          {r.overdue ? <b className="text-danger"> · overdue</b> : null}
        </span>
      </span>
      {r.guest ? (
        <span className="flex items-center gap-1 text-[12px] text-ink-2">
          {r.guest.name} <VipPill level={r.guest.vip_level} />
        </span>
      ) : null}
      {(r.options ?? []).map((o) => (
        <Button
          key={o.action}
          size="sm"
          disabled={busy || !pms.online}
          onClick={() => {
            if (o.action === 'assign' || o.needs.includes('assignee')) {
              setPerson(null);
              setGiving(r);
            } else if (o.needs.includes('reason')) setActing({ r, action: o.action, label: o.label });
            else void act(r, o.action);
          }}
        >
          {o.action === 'assign' ? 'Assign…' : o.label}
        </Button>
      ))}
      {manages && ['assigned', 'accepted', 'in_progress'].includes(r.status) ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || !pms.online}
          onClick={() => {
            setPerson(null);
            setGiving(r);
          }}
        >
          Reassign…
        </Button>
      ) : null}
    </li>
  );

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title="Guest requests" sub={pms.property.name}>
        {manages ? (
          <Button variant="primary" icon="plus" disabled={!pms.online} onClick={() => setTaking(true)}>
            Take a request
          </Button>
        ) : null}
      </PageHead>
      {error ? <Refusal text={error} /> : null}
      {open ? <Section title="This request">{one.isLoading ? <Spinner /> : one.error ? <ErrorNote error={one.error} /> : one.data ? <ul className="m-0 list-none p-0">{row(one.data.request)}</ul> : null}</Section> : null}
      {!pms.online ? (
        <p className="text-[13px] text-ink-3">Requests show when WorkSuite is back.</p>
      ) : list.isLoading ? (
        <Spinner />
      ) : list.error ? (
        <ErrorNote error={list.error} onRetry={() => void list.refetch()} />
      ) : (list.data?.items ?? []).length === 0 ? (
        <p className="text-[13px] text-ink-3">No open requests.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">{list.data!.items.map(row)}</ul>
      )}
      {taking ? (
        <Ask
          title="Take a guest request"
          fields={[
            { name: 'room_id', label: 'Room', type: 'select', options: (rack.data?.data.rooms ?? []).filter((r) => r.occupancy === 'occupied').map((r) => ({ value: String(r.id), label: `${r.number}${r.in_house[0]?.guest.name ? ` · ${r.in_house[0].guest.name}` : ''}` })), required: true },
            { name: 'request_type', label: 'What', type: 'select', options: Object.entries(types).map(([value, label]) => ({ value, label })) },
            { name: 'description', label: 'Details', type: 'textarea', hint: 'Needed for “Other”.' },
            { name: 'priority', label: 'Priority', type: 'select', options: [{ value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' }, { value: 'low', label: 'Low' }] },
            { name: 'source', label: 'Taken', type: 'select', options: [{ value: 'front_desk', label: 'At the desk' }, { value: 'phone', label: 'By phone' }] },
          ]}
          confirm="Take request"
          busy={busy}
          onClose={() => setTaking(false)}
          onSubmit={(v) => void take(v)}
        />
      ) : null}
      {giving ? (
        <Modal
          title={`Give the request for room ${giving.room_number ?? '—'} to`}
          onClose={() => setGiving(null)}
          width={420}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setGiving(null)}>
                Cancel
              </Button>
              <Button variant="primary" loading={busy} disabled={!person || !pms.online} onClick={() => void act(giving, 'assign', { assigned_to: person! })}>
                Assign
              </Button>
            </div>
          }
        >
          <PersonPick label="Person" value={person} onChange={setPerson} />
          <p className="mt-2 mb-0 text-[12px] text-ink-3">They must handle guest requests at this property.</p>
        </Modal>
      ) : null}
      {acting ? <Ask title={acting.label} fields={[{ name: 'reason', label: 'Reason', required: true }]} busy={busy} onClose={() => setActing(null)} onSubmit={(v) => void act(acting.r, acting.action, v)} /> : null}
    </div>
  );
}
