import { useQuery } from '@tanstack/react-query';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { PageHead } from '../../components/PageKit';
import { day, K, money, pGet, type Widget } from './api';
import { NoAccess, usePms } from './parts';
import type { PmsView } from './routes';

/** Where a widget's list is on the desktop (DSH-004: a widget opens the list behind it). */
export const WIDGET_VIEW: Record<string, PmsView> = {
  occupancy_today: 'rack',
  available_rooms: 'rack',
  occupied_rooms: 'inhouse',
  arrivals: 'arrivals',
  departures: 'departures',
  stayovers: 'inhouse',
  no_shows: 'reservations',
  cancellations: 'reservations',
  rooms_to_clean: 'housekeeping',
  rooms_out_of_order: 'rack',
  room_status: 'rack',
  pending_payments: 'cashier',
  todays_revenue: 'audit',
  adr: 'audit',
  revpar: 'audit',
  booking_sources: 'reservations',
  guest_requests: 'requests',
};

const CURRENCY = /^[A-Z]{3}$/;

/** A widget's figure as the server gave it: a percentage, an amount in the property's currency, or a count. */
export function widgetValue(w: Widget): string {
  if (w.value === null || w.value === undefined) return '—';
  if (w.unit && CURRENCY.test(w.unit)) return money(String(w.value), w.unit);
  if (w.unit === '%') return `${w.value} %`;
  return `${w.value}${w.unit ? ` ${w.unit}` : ''}`;
}

const DETAIL: Record<string, Array<[string, string]>> = {
  arrivals: [['due', 'due'], ['done', 'in'], ['vip', 'VIP'], ['unassigned', 'no room']],
  departures: [['due', 'due'], ['done', 'out']],
  occupied_rooms: [['due_out', 'due out']],
  available_rooms: [['vacant_ready', 'ready'], ['vacant_dirty', 'dirty']],
  rooms_to_clean: [['cleaning', 'cleaning'], ['to_inspect', 'to inspect'], ['dnd', 'DND']],
  rooms_out_of_order: [['out_of_service', 'out of service'], ['blocked', 'blocked']],
  guest_requests: [['overdue', 'overdue']],
};

/**
 * The property's dashboard on the business date (§5.1, DSH-002…004): the
 * widgets the server gives this person — money ones only with their
 * permission — each opening the list behind it.
 */
export default function Dashboard() {
  const pms = usePms();
  const pid = pms.property.id;
  const q = useQuery({ queryKey: K.dashboard(pid), queryFn: ({ signal }) => pGet<{ business_date: string; currency: string; widgets: Widget[] }>(`/properties/${pid}/dashboard`, undefined, signal), enabled: pms.may('pms.dashboard.view'), refetchInterval: 120_000 });
  if (!pms.may('pms.dashboard.view')) return <NoAccess what="The dashboard needs “See the dashboard”." />;
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <div className="p-6"><ErrorNote error={q.error ?? new Error('The dashboard could not be loaded.')} onRetry={() => void q.refetch()} /></div>;
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title="Dashboard" sub={`${pms.property.name} · business date ${day(q.data.business_date, true)}`} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {q.data.widgets.map((w) => {
          const view = WIDGET_VIEW[w.name];
          const detail = (DETAIL[w.name] ?? []).filter(([k]) => w.data && w.data[k] !== undefined && w.data[k] !== null);
          return (
            <button
              key={w.name}
              type="button"
              disabled={!view}
              onClick={() => view && pms.go(view)}
              className={cx('flex flex-col gap-1 rounded-[12px] border border-line bg-surface p-3.5 text-left', view ? 'hover:border-primary/50' : 'cursor-default')}
            >
              <span className="text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">{w.label}</span>
              <span className="text-[20px] leading-snug font-extrabold text-ink tabular-nums">{widgetValue(w)}</span>
              {detail.length ? <span className="text-[11.5px] text-ink-3">{detail.map(([k, label]) => `${String(w.data![k])} ${label}`).join(' · ')}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
