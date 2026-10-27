import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Button, ErrorNote, OfflineNote, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { input } from '../../components/FormKit';
import { PageHead } from '../../components/PageKit';
import AssignRoom from './Assign';
import { day, errorText, K, pGetMeta, pPost, type ArrivalCard, type Stay } from './api';
import { occupants, Refusal, usePms, VipPill } from './parts';
import { printCards } from './print';
import { useShortcut } from './shortcuts';

type List = 'arrivals' | 'departures' | 'inhouse';

const TITLE: Record<List, string> = { arrivals: 'Arrivals', departures: 'Departures', inhouse: 'In house' };

/** Whether every room of an arrival due now is ready to be checked in (a number, in service, empty, clean). */
export function arrivalReady(a: ArrivalCard): boolean {
  return a.rooms.length > 0 && a.rooms.every((r) => r.readiness.ready && r.readiness.assigned && r.readiness.vacant && r.readiness.in_service);
}

/**
 * The front desk's three lists (PMS-FD-005), one click from the rack: the
 * day's arrivals with each room's readiness (PMS-CKI-002), assigned in bulk;
 * the departures; the guests in house, with their registration cards printed
 * in bulk. With WorkSuite out of reach they are the last copy (PMS-DSK-003).
 */
export default function Lists({ list, date }: { list: List; date: string | null }) {
  const pms = usePms();
  const [when, setWhen] = useState(date ?? pms.businessDate);
  const [text, setText] = useState('');
  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      <PageHead title={TITLE[list]} sub={list === 'inhouse' ? pms.property.name : `${day(when, true)}${when === pms.businessDate ? ' (business date)' : ''}`}>
        {list !== 'inhouse' ? <input type="date" aria-label="Date" className={cx(input, 'w-40')} value={when} onChange={(e) => e.target.value && setWhen(e.target.value)} /> : null}
        <input className={cx(input, 'w-56')} placeholder="Guest, room or confirmation" aria-label="Filter" value={text} onChange={(e) => setText(e.target.value)} />
      </PageHead>
      {list === 'arrivals' ? <Arrivals date={when} filter={text} /> : <Stays list={list} date={when} filter={text} />}
    </div>
  );
}

const matches = (filter: string, ...v: Array<string | null | undefined>) => !filter.trim() || v.some((x) => (x ?? '').toLowerCase().includes(filter.trim().toLowerCase()));

function Arrivals({ date, filter }: { date: string; filter: string }) {
  const pms = usePms();
  const qc = useQueryClient();
  const pid = pms.property.id;
  const q = useQuery({ queryKey: K.arrivals(pid, date), queryFn: ({ signal }) => pGetMeta<{ business_date: string; date: string; items: ArrivalCard[] }>(`/properties/${pid}/arrivals`, { date }, signal), refetchInterval: pms.online ? 60_000 : false });
  const [assigning, setAssigning] = useState<{ line: number; version: number; what: string; current: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ message: string; left: Array<{ confirmation_no: string; why?: string }> } | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const items = useMemo(() => (q.data?.data.items ?? []).filter((a) => matches(filter, a.guest_name, a.confirmation_no, ...a.rooms.map((r) => r.room_number))), [q.data, filter]);
  const assigns = pms.mayAny('pms.room.move', 'pms.reservation.edit');
  const checks = pms.may('pms.checkin');

  useShortcut('checkin', () => {
    const next = items.find(arrivalReady);
    if (!next || !checks) return false;
    pms.open({ kind: 'checkin', id: next.reservation_id });
    return true;
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: K.live });
  const assignAll = async () => {
    setBusy(true);
    setRefusal(null);
    try {
      const r = await pPost<{ assigned: unknown[]; unassigned: Array<{ confirmation_no: string; why?: string }> }>(`/properties/${pid}/assign-rooms`, { date });
      setResult({ message: r.message, left: r.data.unassigned ?? [] });
      refresh();
    } catch (e) {
      setRefusal(errorText(e, 'The rooms were not assigned.'));
    } finally {
      setBusy(false);
    }
  };

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const unassigned = items.reduce((n, a) => n + a.rooms.filter((r) => !r.readiness.assigned).length, 0);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {q.data?.offline ? <OfflineNote cachedAt={q.data.cachedAt} /> : null}
        <span className="text-[12.5px] text-ink-3">
          {items.length} {items.length === 1 ? 'reservation' : 'reservations'} · {unassigned} {unassigned === 1 ? 'room' : 'rooms'} without a number
        </span>
        <span className="flex-1" />
        {assigns && unassigned > 0 ? (
          <Button icon="bed" loading={busy} disabled={!pms.online} title={pms.online ? 'VIPs first; each room free for its whole stay' : 'Needs WorkSuite'} onClick={() => void assignAll()}>
            Assign rooms
          </Button>
        ) : null}
      </div>
      {result ? (
        <div className="rounded-[10px] bg-success-bg px-3 py-2 text-[12.5px] text-success">
          {result.message}
          {result.left.map((l) => (
            <div key={l.confirmation_no} className="text-ink-2">
              {l.confirmation_no}: {l.why ?? 'no room fits'}
            </div>
          ))}
        </div>
      ) : null}
      {refusal ? <Refusal text={refusal} /> : null}
      {items.length === 0 ? (
        <p className="text-[13px] text-ink-3">No arrivals left for this day.</p>
      ) : (
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-subtle text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
              <tr>
                <th className="px-3 py-2">Guest</th>
                <th className="px-3 py-2">Rooms</th>
                <th className="px-3 py-2">Readiness</th>
                <th className="px-3 py-2">ETA</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.reservation_id} className="border-t border-line align-top">
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1.5">
                      <b>{a.guest_name ?? '—'}</b>
                      <VipPill level={a.vip_level} />
                    </span>
                    <button type="button" className="font-mono text-[12px] font-semibold text-primary" onClick={() => pms.open({ kind: 'reservation', id: a.reservation_id })}>
                      {a.confirmation_no}
                    </button>
                    <span className="block text-[11.5px] text-ink-3">
                      {a.status_label}
                      {a.id_verified ? ' · ID verified' : ''}
                      {a.deposit ? ` · deposit ${a.deposit.status}` : ''}
                    </span>
                    {a.special_requests ? <span className="block text-[11.5px] text-ink-2">{a.special_requests}</span> : null}
                  </td>
                  <td className="px-3 py-2">
                    {a.rooms.map((r) => (
                      <div key={r.reservation_room_id} className="flex items-center gap-1.5">
                        <span className="text-ink-2">{r.room_type}</span>
                        {r.room_number ? <b className="tabular-nums">{r.room_number}</b> : <span className="text-warning">no room</span>}
                        {assigns ? (
                          <button
                            type="button"
                            className="text-[12px] font-semibold text-primary disabled:opacity-50"
                            disabled={!pms.online}
                            onClick={() => setAssigning({ line: r.reservation_room_id, version: a.version, what: `${a.guest_name ?? a.confirmation_no} (${r.room_type ?? 'room'})`, current: r.room_number })}
                          >
                            {r.room_number ? 'Change' : 'Assign'}
                          </button>
                        ) : null}
                        <span className="text-[11.5px] text-ink-3">{occupants(r.adults, r.children)}</span>
                      </div>
                    ))}
                  </td>
                  <td className="px-3 py-2">
                    {a.rooms.map((r) => (
                      <div key={r.reservation_room_id} className={cx('text-[12px]', r.readiness.ready ? 'text-success' : 'text-warning')}>
                        {r.readiness.ready ? (
                          <span className="flex items-center gap-1">
                            <Icon name="check-circle" size={13} /> Ready
                          </span>
                        ) : (
                          r.readiness.blockers.join(' ')
                        )}
                      </div>
                    ))}
                  </td>
                  <td className="px-3 py-2 text-ink-2">{a.eta ?? '—'}</td>
                  <td className="px-3 py-2 text-right">
                    {checks ? (
                      <Button size="sm" variant={arrivalReady(a) ? 'primary' : 'secondary'} icon="log-in" disabled={!pms.online} title={pms.online ? undefined : 'Needs WorkSuite'} onClick={() => pms.open({ kind: 'checkin', id: a.reservation_id })}>
                        Check in
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {assigning ? (
        <AssignRoom
          lineId={assigning.line}
          version={assigning.version}
          what={assigning.what}
          current={assigning.current}
          onClose={() => setAssigning(null)}
          onDone={() => {
            setAssigning(null);
            refresh();
          }}
        />
      ) : null}
    </>
  );
}

function Stays({ list, date, filter }: { list: 'departures' | 'inhouse'; date: string; filter: string }) {
  const pms = usePms();
  const pid = pms.property.id;
  const q = useQuery({
    queryKey: list === 'departures' ? K.departures(pid, date) : K.inHouse(pid),
    queryFn: ({ signal }) => pGetMeta<{ items: Stay[] }>(list === 'departures' ? `/properties/${pid}/departures` : `/properties/${pid}/in-house`, list === 'departures' ? { date } : undefined, signal),
    refetchInterval: pms.online ? 60_000 : false,
  });
  const [printing, setPrinting] = useState(false);
  const items = useMemo(() => (q.data?.data.items ?? []).filter((s) => matches(filter, s.guest_name, s.room_number, s.confirmation_no)), [q.data, filter]);
  const arrivedToday = items.filter((s) => s.arrival_date === pms.businessDate || (s.checked_in_at ?? '').slice(0, 10) === pms.businessDate);
  const printToday = async () => {
    setPrinting(true);
    try {
      await printCards(arrivedToday.map((s) => s.id));
    } catch (e) {
      toast('error', errorText(e, 'The registration cards could not be printed.'));
    } finally {
      setPrinting(false);
    }
  };

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {q.data?.offline ? <OfflineNote cachedAt={q.data.cachedAt} /> : null}
        <span className="text-[12.5px] text-ink-3">
          {items.length} {items.length === 1 ? 'room' : 'rooms'}
        </span>
        <span className="flex-1" />
        {list === 'inhouse' && pms.may('pms.checkin') && arrivedToday.length > 0 ? (
          <Button icon="printer" loading={printing} disabled={!pms.online} onClick={() => void printToday()}>
            Print registration cards ({arrivedToday.length} arrived today)
          </Button>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="text-[13px] text-ink-3">{list === 'departures' ? 'Nobody else is due out.' : 'Nobody is in house.'}</p>
      ) : (
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-subtle text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
              <tr>
                <th className="px-3 py-2">Room</th>
                <th className="px-3 py-2">Guest</th>
                <th className="px-3 py-2">Stay</th>
                <th className="px-3 py-2">Key</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="border-t border-line">
                  <td className="px-3 py-2">
                    <b className="tabular-nums">{s.room_number}</b>
                    <span className="block text-[11.5px] text-ink-3">{s.room_type}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1.5">
                      <b>{s.guest_name ?? '—'}</b>
                      <VipPill level={s.vip_level} />
                    </span>
                    <button type="button" className="font-mono text-[12px] font-semibold text-primary" onClick={() => pms.open({ kind: 'reservation', id: s.reservation_id })}>
                      {s.confirmation_no}
                    </button>
                    {!s.posting_allowed ? <span className="ml-1.5 text-[11px] font-semibold text-warning">cash only</span> : null}
                  </td>
                  <td className="px-3 py-2 text-ink-2">
                    {day(s.arrival_date)} → <b className={s.departure_date <= pms.businessDate ? 'text-red' : 'text-ink'}>{day(s.departure_date)}</b>
                    <span className="block text-[11.5px] text-ink-3">{occupants(s.adults, s.children)}</span>
                  </td>
                  <td className="px-3 py-2 text-[12px] text-ink-2">{s.key_status_label ?? '—'}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Button size="sm" onClick={() => pms.open({ kind: 'stay', id: s.id, folio: null })}>
                      Open
                    </Button>{' '}
                    {pms.may('pms.checkout') && s.departure_date <= pms.businessDate ? (
                      <Button size="sm" variant="primary" icon="logout" disabled={!pms.online} title={pms.online ? undefined : 'Needs WorkSuite'} onClick={() => pms.open({ kind: 'checkout', id: s.reservation_id })}>
                        Check out
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
