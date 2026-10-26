import { useQuery } from '@tanstack/react-query';
import { Icon } from '../../components/Icon';
import { ErrorNote, Spinner } from '../../components/ui';
import { eGet, K, type Gate, type Summary } from './api';
import { Counter, Header, useEvent } from './parts';
import { StatGrid } from '../../components/StatCard';

/**
 * The event's live counters (EV-POR-011, EV-NFR-006): inside now, checked in
 * of those expected, today's entries, exits, refusals and walk-ins, each gate,
 * the devices and what waits for review — the server's figures, asked every
 * ten seconds. It opens in a window of its own for a second screen beside the
 * desk (the rail's "Counters in a window").
 */
export default function Counters() {
  const { event, online } = useEvent();
  const summary = useQuery({
    queryKey: [...K.live(event.id), 'summary'],
    queryFn: ({ signal }) => eGet<Summary>(`/events/${event.id}/checkin/summary`, undefined, signal),
    refetchInterval: 10_000,
    enabled: online,
  });
  const gates = useQuery({ queryKey: K.gates(event.id), queryFn: ({ signal }) => eGet<{ items: Gate[] }>(`/events/${event.id}/gates`, undefined, signal), enabled: online, refetchInterval: 30_000 });
  const s = summary.data;
  const names = new Map((gates.data?.items ?? []).map((g) => [String(g.id), g.name]));

  return (
    <div className="flex flex-col gap-4 pb-6">
      <Header title={event.name} sub={s ? `Today (${s.today.day}) — the server’s counts, every ten seconds` : 'Live counters'} />
      <div className="px-6">
        {!online ? (
          <div className="flex items-center gap-2 rounded-[12px] border border-line bg-surface px-4 py-3 text-[13px] text-ink-2">
            <Icon name="cloud-off" size={16} /> The counters are WorkSuite’s: they come back with the line.
          </div>
        ) : null}
        {summary.isLoading ? <Spinner /> : null}
        {summary.error ? <ErrorNote error={summary.error} onRetry={() => void summary.refetch()} /> : null}
        {s ? (
          <div className="flex flex-col gap-4">
            <StatGrid min={200}>
              <Counter icon="door" tone="blue" label="Inside now" value={s.inside} big />
              <Counter icon="ticket" tone="green" label="Checked in" value={s.checked_in} hint={`of ${s.expected} expected`} big />
              <Counter icon="log-in" tone="violet" label="In today" value={s.today.checked_in} hint={`${s.today.checked_out} out`} big />
              <Counter icon="ban" tone="red" label="Refused today" value={s.today.denied} hint={`${s.today.walk_ins} walk-ins`} big />
            </StatGrid>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[2fr_1fr]">
              <section className="rounded-[12px] border border-line bg-surface p-4">
                <h2 className="mt-0 mb-2 text-[12px] font-bold tracking-[.5px] text-ink-3 uppercase">By gate, today</h2>
                <table className="w-full text-[13.5px]">
                  <thead>
                    <tr className="text-left text-[11.5px] text-ink-3">
                      <th className="py-1 font-semibold">Gate</th>
                      <th className="py-1 text-right font-semibold">In</th>
                      <th className="py-1 text-right font-semibold">Out</th>
                      <th className="py-1 text-right font-semibold">Refused</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(s.by_gate).map(([id, g]) => (
                      <tr key={id} className="border-t border-line">
                        <td className="py-1.5">{names.get(id) ?? `Gate ${id}`}</td>
                        <td className="py-1.5 text-right font-bold tabular-nums">{g.checked_in}</td>
                        <td className="py-1.5 text-right tabular-nums">{g.checked_out}</td>
                        <td className="py-1.5 text-right tabular-nums">{g.denied}</td>
                      </tr>
                    ))}
                    {Object.keys(s.by_gate).length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-2 text-ink-3">
                          No scans at a gate today.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </section>
              <section className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-4 text-[13px]">
                <h2 className="mt-0 mb-1 text-[12px] font-bold tracking-[.5px] text-ink-3 uppercase">Devices</h2>
                <span>
                  <b className="text-[20px]">{s.devices.online}</b> of {s.devices.total} online
                </span>
                <span className="text-ink-2">{s.devices.queued} offline scans waiting to reach WorkSuite</span>
                <span className={s.reconciliation_open > 0 ? 'font-semibold text-warning' : 'text-ink-2'}>{s.reconciliation_open} to review (duplicates and conflicts)</span>
              </section>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
