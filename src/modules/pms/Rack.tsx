import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Button, ErrorNote, OfflineNote, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { Ask } from '../../components/FormKit';
import { PageHead } from '../../components/PageKit';
import { errorText, K, money, newKey, pGet, pGetMeta, pPost, type Rack as RackData, type RackAction, type RackRoom, type Stay } from './api';
import { Refusal, StatusBadge, usePms, VipPill } from './parts';
import { Checkbox } from '../../components/Checkbox';

/** The display filters of PMS-FD-003, applied to the rack as the server drew it. */
export interface RackFilter {
  building: string;
  floor: string;
  type: string;
  status: string;
  hk: string;
  vip: boolean;
  due: '' | 'in' | 'out';
}

export const NO_FILTER: RackFilter = { building: '', floor: '', type: '', status: '', hk: '', vip: false, due: '' };

export function filterRooms(rooms: RackRoom[], f: RackFilter): RackRoom[] {
  return rooms.filter(
    (r) =>
      (!f.building || String(r.building_id ?? '') === f.building) &&
      (!f.floor || String(r.floor_id ?? '') === f.floor) &&
      (!f.type || String(r.room_type_id) === f.type) &&
      (!f.status || r.badge.status === f.status) &&
      (!f.hk || r.hk_status === f.hk) &&
      (!f.vip || r.vip) &&
      (f.due !== 'in' || r.due_in) &&
      (f.due !== 'out' || r.due_out),
  );
}

/** The stay a room's guest is in: the in-house list names it by reservation room. */
export async function stayFor(propertyId: number, reservationRoomId: number): Promise<Stay | null> {
  const r = await pGet<{ items: Stay[] }>(`/properties/${propertyId}/in-house`);
  return r.items.find((s) => s.reservation_room_id === reservationRoomId) ?? null;
}

/**
 * The room rack (PMS-FD-001…005): every room by building and floor with the
 * server's badge — colour, icon and words — the filters of FD-003, and the
 * quick actions FD-004 gives this person on a click. The arrivals,
 * departures and in-house lists are one click away. It follows the house as
 * it moves: the server's live nudges refresh it, and it asks again every half
 * minute. With WorkSuite out of reach it is the last copy, and the actions
 * that change something wait.
 */
export default function Rack({ room }: { room: number | null }) {
  const pms = usePms();
  const pid = pms.property.id;
  const [f, setF] = useState<RackFilter>(NO_FILTER);
  const [open, setOpen] = useState<number | null>(room);
  const q = useQuery({
    queryKey: K.rack(pid),
    queryFn: ({ signal }) => pGetMeta<RackData>(`/properties/${pid}/rack`, undefined, signal),
    refetchInterval: pms.online ? 30_000 : false,
  });
  const rack = q.data?.data;
  const shown = useMemo(() => (rack ? filterRooms(rack.rooms, f) : []), [rack, f]);

  if (q.isLoading) return <Spinner label="Drawing the rack…" />;
  if (q.error || !rack) return <div className="p-6"><ErrorNote error={q.error ?? new Error('The rack could not be loaded.')} onRetry={() => void q.refetch()} /></div>;

  const byId = new Map(rack.rooms.map((r) => [r.id, r]));
  const buildings = [...new Map(rack.floors.map((fl) => [String(fl.building_id ?? ''), fl.building ?? 'Main building'])).entries()];
  const floors = [...new Map(rack.floors.filter((fl) => !f.building || String(fl.building_id ?? '') === f.building).map((fl) => [String(fl.floor_id ?? ''), fl.floor ?? '—'])).entries()];
  const set = (patch: Partial<RackFilter>) => setF((x) => ({ ...x, ...patch }));
  const visible = new Set(shown.map((r) => r.id));
  const selected = open ? (byId.get(open) ?? null) : null;

  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      <PageHead title="Room rack" sub={`${rack.rooms.length} rooms · business date ${rack.business_date}`}>
        {q.data?.offline ? <OfflineNote cachedAt={q.data.cachedAt} /> : null}
        {rack.lists.arrivals !== undefined ? (
          <>
            <Button icon="log-in" onClick={() => pms.go('arrivals')}>
              Arrivals <b className="tabular-nums">{rack.lists.arrivals}</b>
            </Button>
            <Button icon="logout" onClick={() => pms.go('departures')}>
              Departures <b className="tabular-nums">{rack.lists.departures ?? 0}</b>
            </Button>
            <Button icon="bed" onClick={() => pms.go('inhouse')}>
              In house <b className="tabular-nums">{rack.lists.in_house ?? 0}</b>
            </Button>
          </>
        ) : null}
        <Button variant="ghost" icon="app-window" title="The rack in a window of its own, for a second screen" onClick={() => pms.openWindow({ kind: 'view', view: 'rack' }, `Room rack · ${pms.property.name}`)}>
          Window
        </Button>
      </PageHead>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Rooms by status">
        {rack.legend.map((b) => (
          <button
            key={b.status}
            type="button"
            aria-pressed={f.status === b.status}
            onClick={() => set({ status: f.status === b.status ? '' : b.status })}
            className={cx('flex items-center gap-1 rounded-[8px] border px-1.5 py-1', f.status === b.status ? 'border-primary bg-selection' : 'border-line bg-surface hover:bg-subtle')}
          >
            <StatusBadge badge={b} size="sm" />
            <b className="text-[12px] tabular-nums text-ink">{rack.counts[b.status] ?? 0}</b>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
        {buildings.length > 1 ? (
          <Select aria-label="Building" value={f.building} onChange={(e) => set({ building: e.target.value, floor: '' })} options={[{ value: '', label: 'Every building' }, ...buildings.map(([v, l]) => ({ value: v, label: l }))]} className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[12px]" />
        ) : null}
        <Select aria-label="Floor" value={f.floor} onChange={(e) => set({ floor: e.target.value })} options={[{ value: '', label: 'Every floor' }, ...floors.map(([v, l]) => ({ value: v, label: l }))]} className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[12px]" />
        <Select aria-label="Room type" value={f.type} onChange={(e) => set({ type: e.target.value })} options={[{ value: '', label: 'Every room type' }, ...rack.room_types.map((t) => ({ value: String(t.id), label: t.name }))]} className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[12px]" />
        <Select aria-label="Housekeeping" value={f.hk} onChange={(e) => set({ hk: e.target.value })} options={[{ value: '', label: 'Any housekeeping' }, ...pms.options.housekeeping_statuses.map((s) => ({ value: s.value, label: s.label }))]} className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[12px]" />
        <Select aria-label="Due" value={f.due} onChange={(e) => set({ due: e.target.value as RackFilter['due'] })} options={[{ value: '', label: 'Due in or out' }, { value: 'in', label: 'Due in' }, { value: 'out', label: 'Due out' }]} className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[12px]" />
        <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
          <Checkbox checked={f.vip} onChange={(e) => set({ vip: e.target.checked })} /> VIPs
        </label>
        {JSON.stringify(f) !== JSON.stringify(NO_FILTER) ? (
          <Button size="sm" variant="ghost" onClick={() => setF(NO_FILTER)}>
            Clear filters
          </Button>
        ) : null}
        <span className="ml-auto text-[12px] text-ink-3">{shown.length} shown</span>
      </div>

      {rack.floors.map((fl) => {
        const rooms = fl.rooms.filter((id) => visible.has(id)).map((id) => byId.get(id)!);
        if (rooms.length === 0) return null;
        return (
          <section key={`${fl.building_id}-${fl.floor_id}`} aria-label={`${fl.building ?? ''} ${fl.floor ?? ''}`.trim() || 'Rooms'}>
            <h2 className="mb-1.5 text-[11px] font-bold tracking-[.5px] text-ink-3 uppercase">
              {[buildings.length > 1 ? fl.building : null, fl.floor ? `Floor ${fl.floor}` : null].filter(Boolean).join(' · ') || 'Rooms'}
            </h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-2">
              {rooms.map((r) => (
                <RoomTile key={r.id} room={r} online={pms.online} onOpen={() => setOpen(r.id)} />
              ))}
            </div>
          </section>
        );
      })}
      {shown.length === 0 ? <p className="text-[13px] text-ink-3">No room matches these filters.</p> : null}
      {selected ? <RoomPanel room={selected} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function RoomTile({ room: r, online, onOpen }: { room: RackRoom; online: boolean; onOpen: () => void }) {
  const guest = r.in_house[0] ?? r.arriving[0] ?? null;
  const owes = online ? (r.in_house.flatMap((g) => g.balance ?? []).find((b) => b.balance !== '0.00') ?? null) : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Room ${r.number}, ${r.badge.label}${guest?.guest.name ? `, ${guest.guest.name}` : ''}`}
      className={cx('flex min-h-[92px] flex-col gap-1 rounded-[10px] border bg-surface px-2.5 py-2 text-left hover:border-primary/60', r.vip ? 'border-warning/60' : 'border-line')}
    >
      <span className="flex items-center gap-1.5">
        <b className="text-[15px] text-ink tabular-nums">{r.number}</b>
        <span className="min-w-0 flex-1 truncate text-[11px] text-ink-3">{r.room_type}</span>
        {r.vip ? <Icon name="star" size={13} className="text-warning" label="VIP" /> : null}
      </span>
      <StatusBadge badge={r.badge} size="sm" />
      <span className="truncate text-[12px] text-ink-2">{guest?.guest.name ?? (r.ready && r.occupancy === 'vacant' ? 'Ready' : r.hk_status_label)}</span>
      <span className="flex items-center gap-1.5 text-[10.5px] font-semibold text-ink-3">
        {r.due_out ? <span className="text-red">Out today</span> : null}
        {r.due_in ? <span className="text-teal">In today</span> : null}
        {r.open_issues > 0 ? (
          <span className="flex items-center gap-0.5 text-danger">
            <Icon name="wrench" size={11} /> {r.open_issues}
          </span>
        ) : null}
        {owes ? <span className="ml-auto text-ink-2">{money(owes.balance, owes.currency)}</span> : null}
      </span>
    </button>
  );
}

/**
 * A room's quick-action panel (PMS-FD-004): the actions the server lists for
 * this person — new reservation, walk-in, block room, maintenance, view room;
 * for an occupied room also open folio, post charge, room move, check-out and
 * extend stay. Each is the server's endpoint; the panel only takes the desk
 * there.
 */
export function RoomPanel({ room: r, onClose }: { room: RackRoom; onClose: () => void }) {
  const pms = usePms();
  const qc = useQueryClient();
  const [asking, setAsking] = useState<'block' | 'maintenance' | null>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [told, setTold] = useState<string | null>(null);
  const guest = r.in_house[0] ?? null;
  const writes: RackAction[] = ['new_reservation', 'walk_in', 'block_room', 'maintenance', 'post_charge', 'room_move', 'check_out', 'extend_stay'];

  const toStay = async (act: 'folio' | 'charge' | 'move' | 'extend') => {
    if (!guest?.reservation_room_id) return;
    setBusy(true);
    try {
      const s = await stayFor(pms.property.id, guest.reservation_room_id);
      if (!s) {
        setRefusal('The guest in this room could not be found in house. Refresh the rack.');
        return;
      }
      pms.open({ kind: 'stay', id: s.id, folio: null, act: act === 'folio' ? null : act });
    } catch (e) {
      setRefusal(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const act = (a: RackAction) => {
    setRefusal(null);
    switch (a) {
      case 'new_reservation':
        return pms.go('new', { room: r.id });
      case 'walk_in':
        return pms.go('walkin', { room: r.id });
      case 'block_room':
        return setAsking('block');
      case 'maintenance':
        return setAsking('maintenance');
      case 'view_room':
        return pms.open({ kind: 'room', id: r.id });
      case 'open_folio':
        return void toStay('folio');
      case 'post_charge':
        return void toStay('charge');
      case 'room_move':
        return void toStay('move');
      case 'extend_stay':
        return void toStay('extend');
      case 'check_out':
        return guest?.reservation_id ? pms.open({ kind: 'checkout', id: guest.reservation_id }) : undefined;
    }
  };

  const block = async (v: Record<string, string>) => {
    setBusy(true);
    setRefusal(null);
    try {
      const res = await pPost<{ id: number; reassign: Array<{ confirmation_no?: string; reservation_id?: number }>; overbooked: unknown[] }>(`/rooms/${r.id}/outages`, {
        kind: 'blocked',
        start_date: v.start || undefined,
        end_date: v.end || undefined,
        reason: v.reason,
      });
      const moveThem = res.data.reassign ?? [];
      setTold(moveThem.length ? `${res.message} Move these reservations to another room: ${moveThem.map((x) => x.confirmation_no ?? `#${x.reservation_id}`).join(', ')}.` : res.message);
      setAsking(null);
      void qc.invalidateQueries({ queryKey: K.live });
    } catch (e) {
      setRefusal(errorText(e, 'The room was not blocked.'));
      setAsking(null);
    } finally {
      setBusy(false);
    }
  };

  const report = async (v: Record<string, string>) => {
    setBusy(true);
    setRefusal(null);
    try {
      const res = await pPost(`/properties/${pms.property.id}/maintenance`, { title: v.title, room_id: r.id, description: v.description || undefined, priority: v.priority || undefined }, newKey('issue'));
      toast('success', res.message);
      setAsking(null);
      void qc.invalidateQueries({ queryKey: K.live });
    } catch (e) {
      setRefusal(errorText(e, 'The fault was not reported.'));
      setAsking(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside aria-label={`Room ${r.number}`} className="fixed top-[92px] right-4 bottom-8 z-30 flex w-[340px] flex-col overflow-hidden rounded-[14px] border border-line bg-surface shadow-2xl">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <b className="text-[18px] tabular-nums">{r.number}</b>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] text-ink-2">{r.room_type}</div>
          <StatusBadge badge={r.badge} size="sm" />
        </div>
        <button type="button" aria-label="Close" onClick={onClose} className="grid size-8 place-items-center rounded-[8px] text-ink-2 hover:bg-subtle">
          <Icon name="x" size={17} />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 scroll-thin">
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12.5px]">
          <span className="text-ink-3">Housekeeping</span>
          <span>{r.hk_status_label}</span>
          <span className="text-ink-3">Occupancy</span>
          <span>{r.occupancy === 'occupied' ? 'Occupied' : 'Vacant'}</span>
          {r.hk_task ? (
            <>
              <span className="text-ink-3">Cleaning task</span>
              <span>{r.hk_task.status.replace(/_/g, ' ')}</span>
            </>
          ) : null}
          {r.open_issues ? (
            <>
              <span className="text-ink-3">Open faults</span>
              <span className="font-semibold text-danger">{r.open_issues}</span>
            </>
          ) : null}
        </div>
        {[...r.in_house.map((g) => ({ g, where: 'In house' })), ...r.arriving.map((g) => ({ g, where: 'Arriving' }))].map(({ g, where }, i) => (
          <div key={`${where}-${i}`} className="rounded-[10px] border border-line px-3 py-2 text-[12.5px]">
            <div className="flex items-center gap-1.5">
              <span className="text-[10.5px] font-bold tracking-[.4px] text-ink-3 uppercase">{where}</span>
              <VipPill level={g.guest.vip_level} />
            </div>
            <b className="block text-[13.5px]">{g.guest.name ?? '—'}</b>
            {g.confirmation_no ? (
              <button type="button" className="font-mono text-[12px] font-semibold text-primary" onClick={() => g.reservation_id && pms.open({ kind: 'reservation', id: g.reservation_id })}>
                {g.confirmation_no}
              </button>
            ) : null}
            {g.arrival_date ? (
              <div className="text-ink-3">
                {g.arrival_date} → {g.departure_date}
                {g.eta ? ` · ETA ${g.eta}` : ''}
              </div>
            ) : null}
            {g.guest.special_requirements ? <div className="text-ink-2">{g.guest.special_requirements}</div> : null}
            {pms.online && g.balance?.length ? <div className="font-semibold">Owes {g.balance.map((b) => money(b.balance, b.currency)).join(', ')}</div> : null}
            {where === 'Arriving' && g.reservation_id && pms.may('pms.checkin') ? (
              <Button size="sm" variant="primary" icon="log-in" className="mt-1.5" disabled={!pms.online} onClick={() => pms.open({ kind: 'checkin', id: g.reservation_id! })}>
                Check in
              </Button>
            ) : null}
          </div>
        ))}
        {told ? <div className="rounded-[8px] bg-success-bg px-3 py-2 text-[12.5px] text-success">{told}</div> : null}
        {refusal ? <Refusal text={refusal} /> : null}
      </div>
      <footer className="flex flex-wrap gap-1.5 border-t border-line px-4 py-3">
        {r.actions.map((a) => (
          <Button
            key={a.action}
            size="sm"
            variant={a.action === 'check_out' || a.action === 'walk_in' ? 'primary' : 'secondary'}
            disabled={busy || (!pms.online && writes.includes(a.action))}
            title={!pms.online && writes.includes(a.action) ? 'Needs WorkSuite' : undefined}
            onClick={() => act(a.action)}
          >
            {a.label}
          </Button>
        ))}
      </footer>
      {asking === 'block' ? (
        <Ask
          title={`Block room ${r.number}`}
          text="A blocked room is taken out of what can be sold for those nights. The reservations on it are named so they can be moved."
          fields={[
            { name: 'start', label: 'From', type: 'date', initial: pms.businessDate },
            { name: 'end', label: 'Sellable again on', type: 'date', hint: 'The first night it can be sold again. Blank: until it is released.' },
            { name: 'reason', label: 'Reason', required: true },
          ]}
          confirm="Block room"
          busy={busy}
          onClose={() => setAsking(null)}
          onSubmit={(v) => void block(v)}
        />
      ) : null}
      {asking === 'maintenance' ? (
        <Ask
          title={`Report a fault in room ${r.number}`}
          fields={[
            { name: 'title', label: 'What is wrong', required: true, placeholder: 'Air conditioning not cooling' },
            { name: 'description', label: 'Details', type: 'textarea' },
            { name: 'priority', label: 'Priority', type: 'select', options: [{ value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' }, { value: 'low', label: 'Low' }] },
          ]}
          confirm="Report"
          busy={busy}
          onClose={() => setAsking(null)}
          onSubmit={(v) => void report(v)}
        />
      ) : null}
    </aside>
  );
}
