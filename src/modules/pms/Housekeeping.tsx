import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Button, ErrorNote, OfflineNote, Spinner, cx } from '../../components/ui';
import { PageHead } from '../hr/parts';
import { K, pGet, pGetMeta, type HkTask, type Rack } from './api';
import { StatusBadge, usePms } from './parts';

/**
 * Housekeeping as the front desk reads it (PMS-HK-002, PMS-DSK-001): every
 * room's housekeeping status beside its front-office status, ready rooms
 * first to hand, and — for whoever may read housekeeping — the day's cleaning
 * tasks and who has them. The board, assignment and inspection are the
 * supervisors' (the web and the phone); nothing here changes a room.
 */
export default function Housekeeping({ room }: { room: number | null }) {
  const pms = usePms();
  const pid = pms.property.id;
  const [hk, setHk] = useState('');
  const readsRack = pms.mayAny('pms.room.view', 'pms.reservation.view', 'pms.checkin', 'pms.room.manage');
  const rack = useQuery({ queryKey: K.rack(pid), queryFn: ({ signal }) => pGetMeta<Rack>(`/properties/${pid}/rack`, undefined, signal), refetchInterval: pms.online ? 30_000 : false, enabled: readsRack });
  const readsTasks = pms.mayAny('pms.housekeeping.view', 'pms.housekeeping.manage');
  const tasks = useQuery({ queryKey: K.hkTasks(pid), queryFn: ({ signal }) => pGet<{ items: HkTask[] }>(`/properties/${pid}/housekeeping/tasks`, undefined, signal), enabled: readsTasks && pms.online, refetchInterval: 60_000 });
  const rooms = useMemo(() => (rack.data?.data.rooms ?? []).filter((r) => !hk || r.hk_status === hk), [rack.data, hk]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rack.data?.data.rooms ?? []) c[r.hk_status] = (c[r.hk_status] ?? 0) + 1;
    return c;
  }, [rack.data]);

  if (readsRack && rack.isLoading) return <Spinner />;
  if (readsRack && (rack.error || !rack.data)) return <div className="p-6"><ErrorNote error={rack.error ?? new Error('The rooms could not be loaded.')} onRetry={() => void rack.refetch()} /></div>;
  const ready = (rack.data?.data.rooms ?? []).filter((r) => r.ready).length;

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title="Housekeeping" sub={readsRack ? `${ready} vacant ${ready === 1 ? 'room' : 'rooms'} ready to sell` : pms.property.name}>
        {rack.data?.offline ? <OfflineNote cachedAt={rack.data.cachedAt} /> : null}
      </PageHead>
      {readsRack ? (
        <>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Housekeeping status">
            <button type="button" aria-pressed={!hk} onClick={() => setHk('')} className={cx('rounded-[8px] border px-2 py-1 text-[12px] font-semibold', !hk ? 'border-primary bg-selection text-primary' : 'border-line bg-surface')}>
              Every room
            </button>
            {pms.options.housekeeping_statuses.map((s) => (
              <button key={s.value} type="button" aria-pressed={hk === s.value} onClick={() => setHk(hk === s.value ? '' : s.value)} className={cx('rounded-[8px] border px-2 py-1 text-[12px] font-semibold', hk === s.value ? 'border-primary bg-selection text-primary' : 'border-line bg-surface')}>
                {s.label} <span className="tabular-nums opacity-75">{counts[s.value] ?? 0}</span>
              </button>
            ))}
          </div>
          <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-subtle text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
                <tr>
                  <th className="px-3 py-2">Room</th>
                  <th className="px-3 py-2">Housekeeping</th>
                  <th className="px-3 py-2">Front office</th>
                  <th className="px-3 py-2">Task</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rooms.map((r) => (
                  <tr key={r.id} className={cx('border-t border-line', room === r.id && 'bg-selection')}>
                    <td className="px-3 py-1.5">
                      <b className="tabular-nums">{r.number}</b> <span className="text-[11.5px] text-ink-3">{r.room_type}</span>
                    </td>
                    <td className="px-3 py-1.5">
                      {r.hk_status_label}
                      {r.ready ? <span className="ml-1.5 text-[11.5px] font-semibold text-success">ready</span> : null}
                    </td>
                    <td className="px-3 py-1.5">
                      <StatusBadge badge={r.badge} size="sm" />
                    </td>
                    <td className="px-3 py-1.5 text-ink-2">{r.hk_task ? r.hk_task.status.replace(/_/g, ' ') : '—'}</td>
                    <td className="px-3 py-1.5 text-right">
                      <Button size="sm" variant="ghost" onClick={() => pms.open({ kind: 'room', id: r.id })}>
                        Room
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      {readsTasks ? (
        <section aria-label="Today’s cleaning tasks">
          <h2 className="mb-2 text-[13.5px] font-bold">Today’s cleaning tasks</h2>
          {!pms.online ? (
            <p className="text-[13px] text-ink-3">The tasks show when WorkSuite is back.</p>
          ) : tasks.isLoading ? (
            <Spinner />
          ) : tasks.error ? (
            <ErrorNote error={tasks.error} />
          ) : (tasks.data?.items ?? []).length === 0 ? (
            <p className="text-[13px] text-ink-3">No tasks today.</p>
          ) : (
            <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2 p-0">
              {tasks.data!.items.map((t) => (
                <li key={t.id} className="rounded-[10px] border border-line bg-surface px-3 py-2 text-[12.5px]">
                  <div className="flex items-center gap-1.5">
                    <b className="text-[14px] tabular-nums">{t.room_number}</b>
                    <span className="text-ink-3">{t.task_type_label}</span>
                    {t.priority !== 'normal' ? <span className={cx('ml-auto font-semibold', t.priority === 'urgent' ? 'text-danger' : 'text-warning')}>{t.priority_label}</span> : null}
                  </div>
                  <div className="text-ink-2">
                    {t.status_label}
                    {t.assigned_name ? ` · ${t.assigned_name}` : ' · nobody yet'}
                  </div>
                  {t.flags?.due_in ? <div className="text-[11.5px] text-[#0891b2]">Guest due in today</div> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
