import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import type { RestaurantCopy, RestaurantPairing, RestaurantStatus } from '@shared/restaurant';
import { Button, cx } from '../../components/ui';
import { app } from '../../core/app-state';
import { on } from '../../core/bridge';
import { useStore } from '../../core/store';
import { bridge, get, K, type LiveEvent, type Options, type PosContext } from './api';
import { useT } from './i18n';
import { routeOf, type Screen, type View } from './routes';

/**
 * What every Restaurant screen reads: which terminal this computer is, its
 * branch and company, what the signed-in person may do there (the server's
 * `options.can`), whether WorkSuite answers, the copy kept for when it does
 * not, and how to move between the screens.
 */
export interface Till {
  pairing: RestaurantPairing;
  org: number;
  branch: number;
  options: Options | null;
  pos: PosContext | null;
  currency: string;
  /** A permission, as `options.can` names it: `order_create` for `restaurant.order.create`. Unknown offline: the server decides when the queue goes up. */
  can: (perm: string) => boolean;
  offline: boolean;
  copy: RestaurantCopy | null;
  status: RestaurantStatus | null;
  screen: Screen;
  go: (view: View, params?: Record<string, string | number | null | undefined>) => void;
}

export const TillContext = createContext<Till | null>(null);

export function useTill(): Till {
  const t = useContext(TillContext);
  if (!t) throw new Error('useTill outside the Restaurant terminal');
  return t;
}

export function tillGo(goRoute: (r: string) => void): Till['go'] {
  return (view, params = {}) => goRoute(routeOf(view, params));
}

/** The main process says something changed (a sync, the agent, a pairing): refresh what it keeps. */
export function useRestaurantChanged(): void {
  const qc = useQueryClient();
  useEffect(
    () =>
      on('restaurant:changed', () => {
        void qc.invalidateQueries({ queryKey: K.status });
        void qc.invalidateQueries({ queryKey: K.outbox });
        void qc.invalidateQueries({ queryKey: K.copy });
        void qc.invalidateQueries({ queryKey: K.pairing });
      }),
    [qc],
  );
}

export function useStatus() {
  return useQuery({ queryKey: K.status, queryFn: bridge.status, refetchInterval: 15_000 });
}

export function useCopy(enabled: boolean) {
  return useQuery({ queryKey: K.copy, queryFn: bridge.copy, enabled, staleTime: 30_000 });
}

/** Which of the server's entities touch which of the screens' queries. */
function keysFor(e: LiveEvent, branch: number): ReadonlyArray<readonly unknown[]> {
  switch (e.entity) {
    case 'order':
    case 'order_item':
      return [K.order(e.id), K.orders(branch), K.floor(branch), ['restaurant', 'kitchen', branch], K.expo(branch)];
    case 'ticket':
      return [['restaurant', 'kitchen', branch], K.expo(branch), ['restaurant', 'order']];
    case 'table':
    case 'session':
    case 'table_session':
    case 'floor':
      return [K.floor(branch)];
    case 'reservation':
      return [K.floor(branch), ['restaurant', 'reservations', branch], ['restaurant', 'timeline', branch]];
    case 'bill':
    case 'payment':
      return [['restaurant', 'bills'], ['restaurant', 'order'], ['restaurant', 'payments'], K.floor(branch)];
    case 'adjustment':
      return [['restaurant', 'adjustments'], ['restaurant', 'bills'], ['restaurant', 'order']];
    case 'business_date':
      return [K.pos(branch)];
    case 'print_job':
      return [K.printJobs(branch), ['restaurant', 'kitchen', branch]];
    case 'sync_conflict':
      return [K.conflicts(branch)];
    case 'approval':
      return [K.approvals];
    case 'cashier_session':
      return [K.cashier];
    default:
      return e.entity.startsWith('menu') ? [['restaurant', 'menu', branch]] : [];
  }
}

/** The gateway's `restaurant.live` push (`Live::emit`): the same event as a `live?after=` row, with the branch. */
interface LivePush extends LiveEvent {
  type: string;
  branch_id?: number;
}

/** While the realtime socket is up, the catch-up poll only covers what a push might have missed. */
export const PUSHED_POLL_MS = 30_000;

/** Refresh the queries an event touches, each once. */
function refreshFor(qc: ReturnType<typeof useQueryClient>, events: LiveEvent[], branch: number): void {
  const seen = new Set<string>();
  for (const e of events) {
    for (const k of keysFor(e, branch)) {
      const id = JSON.stringify(k);
      if (seen.has(id)) continue;
      seen.add(id);
      void qc.invalidateQueries({ queryKey: k as unknown[] });
    }
  }
}

/**
 * The live floor, board and orders (RM-ARC-010/012). The server pushes each
 * change through the app's realtime socket as `restaurant.live` (the main
 * process fans it out as `realtime:event`); an event for this branch
 * refreshes only the queries it touches, at once. Behind it, the screen
 * still catches up with the server's numbered events (`GET live?after=`)
 * from where the terminal's heartbeat last saw the branch — every few
 * seconds while the socket is down or the server runs without the gateway,
 * every 30 s while it is up, since a push can be missed but a numbered row
 * cannot. A gap too old to catch up (`reload`) refreshes everything. With
 * no starting point yet, the screen's own queries are refreshed on the beat.
 */
export function useLive(branch: number, start: number, active: boolean, every = 4_000, fallback: ReadonlyArray<readonly unknown[]> = []): void {
  const qc = useQueryClient();
  const after = useRef<number>(start);
  const fb = useRef(fallback);
  const pushed = useStore(app, (s) => s.status?.realtime === 'connected');
  const beat = pushed ? Math.max(every, PUSHED_POLL_MS) : every;
  useEffect(() => {
    fb.current = fallback;
    /* The heartbeat's number arrives after the screen: start from it once it is known. */
    if (after.current === 0 && start > 0) after.current = start;
  });

  useEffect(() => {
    if (!active) return;
    return on<LivePush>('realtime:event', (e) => {
      if (e?.type !== 'restaurant.live' || typeof e.entity !== 'string') return;
      if (e.branch_id !== undefined && Number(e.branch_id) !== branch) return;
      refreshFor(qc, [e], branch);
    });
  }, [branch, active, qc]);

  useEffect(() => {
    if (!active) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      let again = false;
      try {
        if (after.current > 0) {
          const d = await get<{ events: LiveEvent[]; last: number; reload: boolean; more: boolean }>('/live', { branch_id: branch, after: after.current, limit: 200 });
          if (d.reload) {
            void qc.invalidateQueries({ queryKey: K.all });
          } else {
            refreshFor(qc, d.events, branch);
          }
          after.current = d.last;
          again = d.more;
        } else {
          for (const k of fb.current) void qc.invalidateQueries({ queryKey: k as unknown[] });
        }
      } catch {
        /* Out of reach: the next beat tries again; the screens say so themselves. */
      }
      if (!stop) timer = setTimeout(() => void tick(), again ? 50 : beat);
    };
    timer = setTimeout(() => void tick(), beat);
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [branch, active, beat, qc]);
}

export function Note({ tone = 'muted', children, action }: { tone?: 'muted' | 'warning' | 'danger' | 'indigo' | 'success'; children: ReactNode; action?: ReactNode }) {
  const toneCls = {
    muted: 'border-line bg-subtle text-ink-2',
    warning: 'border-warning/40 bg-warning/10 text-ink',
    danger: 'border-danger/40 bg-danger/10 text-ink',
    indigo: 'border-primary/30 bg-selection text-ink',
    success: 'border-success/40 bg-success/10 text-ink',
  }[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : undefined} className={cx('flex items-start gap-3 rounded-[10px] border px-3.5 py-2.5 text-[13px]', toneCls)}>
      <div className="min-w-0 flex-1">{children}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Failed({ text, onRetry }: { text: string; onRetry?: () => void }) {
  const t = useT();
  return (
    <Note tone="danger" action={onRetry ? <Button size="sm" icon="refresh" onClick={onRetry}>{t('common.retry')}</Button> : undefined}>
      {text}
    </Note>
  );
}

export function Heading({ title, hint, action }: { title: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-[22px] font-extrabold text-ink">{title}</h1>
        {hint ? <p className="mt-0.5 text-[13px] text-ink-2">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** A table or ticket's state as a colour: what a floor or a kitchen reads at a glance. */
export const TABLE_TONE: Record<string, string> = {
  available: 'border-success/50 bg-success/10',
  reserved: 'border-primary/40 bg-selection',
  seated: 'border-warning/50 bg-warning/10',
  ordering: 'border-warning/50 bg-warning/15',
  food_preparing: 'border-warning/60 bg-warning/20',
  serving: 'border-primary/50 bg-primary/10',
  occupied: 'border-primary/50 bg-primary/10',
  bill_requested: 'border-danger/50 bg-danger/10',
  payment: 'border-danger/50 bg-danger/15',
  cleaning: 'border-line bg-subtle',
  blocked: 'border-line bg-subtle opacity-60',
};

export const TICKET_TONE: Record<'ok' | 'warn' | 'late', string> = {
  ok: 'border-line bg-surface',
  warn: 'border-warning bg-warning/10',
  late: 'border-danger bg-danger/10',
};

/** A reason typed for a void, a cancellation, freeing a table: the server wants one in words. */
export function ReasonField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-semibold text-ink-2">{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} maxLength={500} className="rounded-[8px] border border-line bg-surface px-3 py-2 text-[13.5px] text-ink outline-none focus:border-primary" />
    </label>
  );
}
