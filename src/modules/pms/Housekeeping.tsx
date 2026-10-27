import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Button, ErrorNote, OfflineNote, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { Ask } from '../../components/FormKit';
import { PageHead } from '../../components/PageKit';
import { errorText, K, newKey, pGet, pGetMeta, pPost, type HkTaskFull, type Rack } from './api';
import { useActions } from './ops';
import { Refusal, StatusBadge, usePms } from './parts';

const TASK_TYPES = [
  { value: 'stayover', label: 'Stayover service' },
  { value: 'checkout', label: 'Checkout clean' },
  { value: 'touch_up', label: 'Touch-up' },
  { value: 'deep_clean', label: 'Deep clean' },
  { value: 'turndown', label: 'Turndown' },
  { value: 'inspection', label: 'Inspection' },
];
const PRIORITIES = [
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'low', label: 'Low' },
];

/**
 * Housekeeping at the desk (PMS-HK-002, PMS-DSK-001): every room's
 * housekeeping status beside its front-office status, ready rooms first to
 * hand, and — for whoever may read housekeeping — the day's cleaning tasks,
 * who has them and the one next move the server offers on each (start,
 * complete, inspect…). A task opens on its own screen (checklist, assignment,
 * restocks); a supervisor (`pms.housekeeping.manage`) adds a task or makes
 * the day's tasks. A room's own status is changed on the room's screen.
 * Offline the rooms are the last copy and the tasks wait for WorkSuite.
 */
export default function Housekeeping({ room }: { room: number | null }) {
  const pms = usePms();
  const qc = useQueryClient();
  const pid = pms.property.id;
  const [hk, setHk] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(() => newKey('hk-task'));
  const manages = pms.may('pms.housekeeping.manage');
  const acts = useActions([K.hkTasks(pid), K.live]);
  const readsRack = pms.mayAny('pms.room.view', 'pms.reservation.view', 'pms.checkin', 'pms.room.manage');
  const rack = useQuery({ queryKey: K.rack(pid), queryFn: ({ signal }) => pGetMeta<Rack>(`/properties/${pid}/rack`, undefined, signal), refetchInterval: pms.online ? 30_000 : false, enabled: readsRack });
  const readsTasks = pms.mayAny('pms.housekeeping.view', 'pms.housekeeping.manage');
  const tasks = useQuery({ queryKey: K.hkTasks(pid), queryFn: ({ signal }) => pGet<{ items: HkTaskFull[] }>(`/properties/${pid}/housekeeping/tasks`, undefined, signal), enabled: readsTasks && pms.online, refetchInterval: 60_000 });
  const rooms = useMemo(() => (rack.data?.data.rooms ?? []).filter((r) => !hk || r.hk_status === hk), [rack.data, hk]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rack.data?.data.rooms ?? []) c[r.hk_status] = (c[r.hk_status] ?? 0) + 1;
    return c;
  }, [rack.data]);

  if (readsRack && rack.isLoading) return <Spinner />;
  if (readsRack && (rack.error || !rack.data)) return <div className="p-6"><ErrorNote error={rack.error ?? new Error('The rooms could not be loaded.')} onRetry={() => void rack.refetch()} /></div>;
  const ready = (rack.data?.data.rooms ?? []).filter((r) => r.ready).length;
  const write = async (fn: () => Promise<{ message: string }>) => {
    setBusy(true);
    setError(null);
    try {
      toast('success', (await fn()).message);
      setAdding(false);
      void qc.invalidateQueries({ queryKey: K.hkTasks(pid) });
      void qc.invalidateQueries({ queryKey: K.live });
    } catch (e) {
      setError(errorText(e, 'Nothing was changed.'));
      setAdding(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title="Housekeeping" sub={readsRack ? `${ready} vacant ${ready === 1 ? 'room' : 'rooms'} ready to sell` : pms.property.name}>
        {rack.data?.offline ? <OfflineNote cachedAt={rack.data.cachedAt} /> : null}
        {manages ? (
          <>
            <Button disabled={!pms.online || busy} title="The day's stay-over and checkout cleans, now" onClick={() => void write(() => pPost(`/properties/${pid}/housekeeping/generate`, { stayovers: true }))}>
              Make today’s tasks
            </Button>
            {readsRack ? (
              <Button variant="primary" icon="plus" disabled={!pms.online} onClick={() => setAdding(true)}>
                New task
              </Button>
            ) : null}
          </>
        ) : null}
      </PageHead>
      {error || acts.error ? <Refusal text={(error ?? acts.error)!} /> : null}
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
              {tasks.data!.items.map((t) => {
                const next = (t.options ?? []).find((o) => o.action === t.primary);
                return (
                  <li key={t.id} className="flex flex-col gap-1 rounded-[10px] border border-line bg-surface px-3 py-2 text-[12.5px]">
                    <button type="button" className="text-left" aria-label={`Room ${t.room_number}, ${t.task_type_label}, ${t.status_label}`} onClick={() => pms.open({ kind: 'task', id: t.id })}>
                      <div className="flex items-center gap-1.5">
                        <b className="text-[14px] tabular-nums">{t.room_number}</b>
                        <span className="text-ink-3">{t.task_type_label}</span>
                        {t.priority !== 'normal' ? <span className={cx('ml-auto font-semibold', t.priority === 'urgent' ? 'text-danger' : 'text-warning')}>{t.priority_label}</span> : null}
                      </div>
                      <div className="text-ink-2">
                        {t.status_label}
                        {t.assigned_name ? ` · ${t.assigned_name}` : ' · nobody yet'}
                      </div>
                      {t.flags?.due_in ? <div className="text-[11.5px] text-teal">Guest due in today</div> : null}
                    </button>
                    {next && typeof t.version === 'number' ? (
                      <div>
                        <Button size="sm" variant="primary" disabled={acts.busy || !pms.online} onClick={() => acts.run(`/housekeeping-tasks/${t.id}`, next, t.version)}>
                          {next.label}
                        </Button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}
      {acts.dialog}
      {adding ? (
        <Ask
          title="A housekeeping task"
          fields={[
            { name: 'room_id', label: 'Room', type: 'select', required: true, options: (rack.data?.data.rooms ?? []).map((r) => ({ value: String(r.id), label: `${r.number} · ${r.hk_status_label}` })) },
            { name: 'task_type', label: 'What', type: 'select', options: TASK_TYPES },
            { name: 'priority', label: 'Priority', type: 'select', options: PRIORITIES },
            { name: 'notes', label: 'Notes', type: 'textarea' },
          ]}
          confirm="Add task"
          busy={busy}
          onClose={() => setAdding(false)}
          onSubmit={(v) =>
            void write(async () => {
              const r = await pPost(`/properties/${pid}/housekeeping/tasks`, { room_id: Number(v.room_id), task_type: v.task_type, priority: v.priority, ...(v.notes ? { notes: v.notes } : {}) }, key);
              setKey(newKey('hk-task'));
              return r;
            })
          }
        />
      ) : null}
    </div>
  );
}
