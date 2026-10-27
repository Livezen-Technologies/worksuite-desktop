import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { call, errorMessage, on } from '../../core/bridge';
import { timeLabel, todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, Empty, PageHead } from '../../components/PageKit';
import { money } from './parts';
import { dayTotals, fetchLiveRoutes, KS, routeTone, vehicleName, type Route, type Stop } from './ship';

/**
 * The dispatch board (D-14, FR-DLV-05…07): every own-fleet route today, live from the driver app — stops done or
 * failed, the ETA of the next, cash collected and handed in. It follows the server's events and asks again every
 * twenty seconds besides. Route sheets print for drivers without the app (FR-DLV-06); planning is the web's
 * Delivery planner (W-25).
 */
const TONE = {
  ok: 'bg-success-bg text-success',
  warn: 'bg-warning-bg text-warning',
  bad: 'bg-danger-bg text-danger',
  idle: 'bg-selection text-primary',
} as const;

export default function Dispatch({ org, onOpen }: { org: string; onOpen: (orderId: number) => void }) {
  const qc = useQueryClient();
  const date = todayInZone();
  const q = useQuery({ queryKey: [...KS.live(date), org], queryFn: ({ signal }) => fetchLiveRoutes(date, org, signal), refetchInterval: 20_000 });
  useEffect(
    () =>
      on<{ type?: string }>('realtime:event', (e) => {
        const t = e.type ?? '';
        if (t.startsWith('oms.route') || t.startsWith('oms.stop') || t.startsWith('oms.delivery')) void qc.invalidateQueries({ queryKey: KS.live(date) });
      }),
    [qc, date],
  );
  const routes = q.data?.routes ?? [];
  const t = dayTotals(routes);
  const sheets = () =>
    void Promise.all(routes.map((r) => call('transfers:download', { omsRouteSheet: r.id, name: `route-${r.id}-${date}.pdf`, open: true }))).then(
      () => toast('success', routes.length === 1 ? 'Opening the route sheet to print.' : `Opening ${routes.length} route sheets to print.`),
      (e) => toast('error', errorMessage(e)),
    );

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Dispatch board · today" sub={`Live from the driver app · ${t.done} of ${t.stops} stops done${t.failed ? ` · ${t.failed} failed` : ''} · ${money(t.cash)} cash collected`}>
        <button type="button" className={btn} disabled={!routes.length} onClick={sheets}>
          <Icon name="printer" size={14} /> Print route sheets
        </button>
        <button type="button" className={btn} onClick={() => void call('app:openInBrowser', { path: '/oms?view=planner' })} title="The Delivery planner — opens in your browser">
          Plan tomorrow <Icon name="external" size={12} />
        </button>
      </PageHead>
      {q.isLoading ? <Spinner /> : null}
      {q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {!q.isLoading && !q.error && !routes.length ? (
        <div className="rounded-[12px] border border-line bg-surface">
          <Empty text="No route is out today." />
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        {routes.map((r) => (
          <RouteCard key={r.id} r={r} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

function RouteCard({ r, onOpen }: { r: Route; onOpen: (orderId: number) => void }) {
  const tone = routeTone(r);
  const next = r.stops.find((s) => s.state === 'pending' || s.state === 'arrived');
  const back = r.state === 'back' || r.state === 'done';
  return (
    <section data-route={r.id} className="flex flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
        <b className="flex-1 truncate text-[13px] text-ink">
          {r.name ?? `Route ${r.id}`} · {vehicleName(r.vehicle)}
        </b>
        <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-bold', TONE[tone.tone])}>{tone.label}</span>
      </div>
      <div className="px-3.5 pt-2 text-[12px] text-ink-3">
        {[
          r.driver?.name,
          r.state === 'loading' ? `${r.totals.stops} stops` : `${r.totals.done} of ${r.totals.stops} done`,
          back && r.cash_handed_in != null ? `${money(r.cash_handed_in)} cash handed in` : r.totals.cod_collected ? `${money(r.totals.cod_collected)} of ${money(r.totals.cod_expected)} cash` : null,
          !back && r.back_eta ? `back ~${timeLabel(r.back_eta)}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </div>
      {r.state === 'loading' && r.loaded ? (
        <p className="m-0 px-3.5 pt-1 text-[12px] text-warning">
          {r.loaded.scanned} of {r.loaded.parcels} parcels scanned onto the vehicle
        </p>
      ) : null}
      <div className="flex flex-col py-1.5">
        {(back ? [] : r.stops).map((s) => (
          <StopLine key={s.id} s={s} next={s === next} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

function StopLine({ s, next, onOpen }: { s: Stop; next: boolean; onOpen: (orderId: number) => void }) {
  const mark = s.state === 'delivered' ? '✓' : s.state === 'failed' ? '!' : String(s.seq);
  return (
    <div data-stop={s.id} className="flex items-center gap-2.5 px-3.5 py-1 text-[12.5px]">
      <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold', s.state === 'delivered' ? 'bg-success text-white' : s.state === 'failed' ? 'bg-danger text-white' : next ? 'bg-primary text-white' : 'bg-subtle text-ink-2')}>{mark}</span>
      {s.order ? (
        <button type="button" className="min-w-0 flex-1 truncate text-left text-ink hover:underline" onClick={() => onOpen(s.order!.id)}>
          {s.customer ?? s.order.number}
        </button>
      ) : (
        <span className="min-w-0 flex-1 truncate text-ink">{s.customer ?? s.delivery?.number ?? '—'}</span>
      )}
      <span className="shrink-0 text-[12px] text-ink-3">
        {s.state === 'failed' ? (s.reason ?? 'failed') : s.state === 'delivered' ? (s.cash_collected ? `cash ${money(s.cash_collected)}` : '') : next && s.eta ? `ETA ${timeLabel(s.eta)}` : ''}
      </span>
    </div>
  );
}
