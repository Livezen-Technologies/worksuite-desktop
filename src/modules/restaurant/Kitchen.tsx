import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { get, K, qty, refusal, write, type Board, type Expo as ExpoData, type Ticket } from './api';
import { useT, type RKey } from './i18n';
import { Failed, Heading, Note, TICKET_TONE, useLive, useTill } from './parts';

/**
 * The kitchen display (§7.1–7.4): a station's tickets oldest first, each in
 * the colour of its age against the station's targets (on time, amber,
 * overdue — the server's `tone`), its lines ticked off one by one (done,
 * undo), and the moves the server offers (accept, start, bump, recall,
 * serve). ADD and VOID tickets are marked; one that did not print says so.
 * Beside them: the all-day count of every item still to make, what is held
 * for a later course, and the tickets bumped in the last quarter hour, to
 * recall. The pass (expo) shows every station's ticket of each order and
 * serves the order when all of them are ready.
 *
 * Kept current from the server's live events (`live?after=`); a kitchen
 * screen paired as a `kds` terminal opens on its own station.
 */
const MOVES: Array<{ on: string; label: RKey; variant?: 'primary' | 'success' }> = [
  { on: 'accept', label: 'kds.accept' },
  { on: 'start', label: 'kds.start' },
  { on: 'bump', label: 'kds.bump', variant: 'success' },
  { on: 'recall', label: 'kds.recall' },
  { on: 'serve', label: 'kds.serve', variant: 'primary' },
];

export default function Kitchen() {
  const t = useT();
  const till = useTill();
  const qc = useQueryClient();
  const [station, setStation] = useState<number | null>(till.screen.station ?? till.pairing.station_id);
  const key = K.kitchen(till.branch, station);
  const q = useQuery({ queryKey: key, queryFn: ({ signal }) => get<Board>('/kitchen', { branch_id: till.branch, station_id: station ?? undefined }, signal), refetchInterval: 30_000 });
  useLive(till.branch, till.status?.last_seq ?? 0, true, 3_000, [key]);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(what: string, path: string, body: Record<string, unknown>) {
    setBusy(what);
    try {
      await write(path, body);
      void qc.invalidateQueries({ queryKey: ['restaurant', 'kitchen', till.branch] });
      void qc.invalidateQueries({ queryKey: K.expo(till.branch) });
    } catch (e) {
      const f = refusal(e);
      toast(f.code === 'version_conflict' ? 'warning' : 'error', f.message);
      void qc.invalidateQueries({ queryKey: key });
    } finally {
      setBusy(null);
    }
  }

  if (q.isError) return <div className="p-6"><Failed text={q.error instanceof Error ? q.error.message : t('kds.failed')} onRetry={() => void q.refetch()} /></div>;
  if (!q.data) return <Spinner label={t('kds.loading')} />;
  const b = q.data;
  const manage = till.can('kitchen_manage');

  return (
    <div className="flex flex-col gap-4 p-6">
      <Heading
        title={station ? (b.stations.find((s) => s.id === station)?.name ?? t('nav.kitchen')) : t('kds.allStations')}
        hint={t('kds.count', { n: b.tickets.length })}
        action={
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t('kds.stations')}>
            <StationTab on={station === null} onClick={() => setStation(null)} label={t('kds.all')} />
            {b.stations.map((s) => (
              <StationTab key={s.id} on={station === s.id} onClick={() => setStation(s.id)} label={s.name} />
            ))}
          </div>
        }
      />
      <div className="flex flex-col gap-4 xl:flex-row">
        <div className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fill,minmax(250px,1fr))] content-start gap-3">
          {b.tickets.length === 0 ? <Note tone="muted">{t('kds.empty')}</Note> : null}
          {b.tickets.map((k) => (
            <TicketCard key={k.id} ticket={k} busy={busy} manage={manage} onAct={act} />
          ))}
        </div>
        <aside className="flex w-full shrink-0 flex-col gap-3 xl:w-[260px]">
          <section className="rounded-[12px] border border-line bg-surface p-3" aria-label={t('kds.allDay')}>
            <h2 className="mb-1.5 text-[12.5px] font-bold text-ink-2 uppercase">{t('kds.allDay')}</h2>
            {b.all_day.length === 0 ? <p className="text-[12.5px] text-ink-3">—</p> : null}
            <ul className="flex flex-col gap-0.5 text-[13px]">
              {b.all_day.map((a) => (
                <li key={`${a.name}-${a.variant_name ?? ''}`} className="flex gap-2">
                  <span className="w-8 text-end font-extrabold tabular-nums">{qty(a.qty)}</span>
                  <span className="min-w-0 flex-1">
                    {a.name}
                    {a.variant_name ? ` (${a.variant_name})` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          {b.held.length ? (
            <section className="rounded-[12px] border border-line bg-surface p-3" aria-label={t('kds.held')}>
              <h2 className="mb-1.5 text-[12.5px] font-bold text-ink-2 uppercase">{t('kds.held')}</h2>
              <ul className="flex flex-col gap-0.5 text-[12.5px]">
                {b.held.map((h) => (
                  <li key={h.order_item_id}>
                    #{h.order_number} · {qty(h.qty)} × {h.name}
                    {h.course ? ` · ${till.options?.courses?.[h.course] ?? h.course}` : ''}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {b.bumped.length ? (
            <section className="rounded-[12px] border border-line bg-surface p-3" aria-label={t('kds.bumped')}>
              <h2 className="mb-1.5 text-[12.5px] font-bold text-ink-2 uppercase">{t('kds.bumped')}</h2>
              <ul className="flex flex-col gap-1.5 text-[12.5px]">
                {b.bumped.map((k) => (
                  <li key={k.id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1">
                      {k.number} · {k.table_label ? `${t('floor.table')} ${k.table_label}` : k.order_type}
                    </span>
                    {manage && (k.choices ?? []).includes('recall') ? (
                      <Button size="sm" loading={busy === `recall-${k.id}`} onClick={() => void act(`recall-${k.id}`, `/kitchen/tickets/${k.id}/recall`, { version: k.version })}>
                        {t('kds.recall')}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function StationTab({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button role="tab" aria-selected={on} onClick={onClick} className={cx('rounded-full border px-3 py-1 text-[12.5px] font-semibold', on ? 'border-primary bg-selection text-primary' : 'border-line text-ink-2 hover:bg-subtle')}>
      {label}
    </button>
  );
}

function TicketCard({ ticket: k, busy, manage, onAct }: { ticket: Ticket; busy: string | null; manage: boolean; onAct: (what: string, path: string, body: Record<string, unknown>) => Promise<void> }) {
  const t = useT();
  const choices = k.choices ?? [];
  return (
    <article className={cx('flex flex-col gap-2 rounded-[12px] border-2 p-3', TICKET_TONE[k.tone] ?? TICKET_TONE.ok)} aria-label={`${t('kds.ticket')} ${k.number}`} data-tone={k.tone}>
      <header className="flex items-baseline gap-2">
        {k.mark ? <span className={cx('rounded px-1.5 text-[11px] font-extrabold text-white', k.kind === 'void' ? 'bg-danger' : 'bg-primary')}>{k.mark}</span> : null}
        <span className="text-[16px] font-extrabold text-ink">{k.number}</span>
        <span className="text-[12px] text-ink-2">#{k.order_number ?? k.order_id}</span>
        <span className={cx('ms-auto text-[15px] font-extrabold tabular-nums', k.tone === 'late' ? 'text-danger' : k.tone === 'warn' ? 'text-warning' : 'text-ink-2')}>{t('kds.minutes', { n: k.elapsed_minutes })}</span>
      </header>
      <div className="text-[12.5px] text-ink-2">
        {k.table_label ? `${t('floor.table')} ${k.table_label}` : k.order_type} · {k.status_label}
        {k.course ? ` · ${k.course}` : ''}
      </div>
      {k.allergy_warning ? <div className="rounded bg-danger/15 px-2 py-1 text-[12px] font-bold text-danger">{k.allergy_warning}</div> : null}
      {k.print_status === 'failed' ? <div className="text-[11.5px] font-semibold text-warning">{t('kds.notPrinted')}</div> : null}
      <ul className="flex flex-col gap-1">
        {(k.items ?? []).map((i) => {
          const done = i.status === 'done';
          return (
            <li key={i.id}>
              <button
                type="button"
                disabled={!manage || k.kind === 'void' || busy === `item-${i.id}`}
                aria-pressed={done}
                onClick={() => void onAct(`item-${i.id}`, `/kitchen/tickets/${k.id}/items/${i.id}/${done ? 'undo' : 'done'}`, { version: k.version })}
                className={cx('flex w-full items-start gap-2 rounded-[6px] px-1.5 py-1 text-start hover:bg-subtle disabled:hover:bg-transparent', done && 'opacity-50 line-through')}
              >
                <span className="text-[15px] font-extrabold tabular-nums">{qty(i.qty)}</span>
                <span className="min-w-0 flex-1">
                  <span className="text-[14px] font-bold text-ink">
                    {i.name}
                    {i.variant_name ? ` (${i.variant_name})` : ''}
                  </span>
                  {i.modifiers?.length ? <span className="block text-[12px] text-ink-2">{i.modifiers.join(', ')}</span> : null}
                  {i.notes ? <span className="block text-[12px] font-semibold text-warning">! {i.notes}</span> : null}
                  {i.seat ? <span className="block text-[11.5px] text-ink-3">{t('order.seatN', { n: i.seat })}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {k.notes ? <div className="text-[12px] text-ink-2">{k.notes}</div> : null}
      <footer className="mt-auto flex flex-wrap gap-1.5">
        {MOVES.filter((m) => choices.includes(m.on)).map((m) => (
          <Button key={m.on} size="sm" variant={m.variant ?? 'secondary'} loading={busy === `${m.on}-${k.id}`} onClick={() => void onAct(`${m.on}-${k.id}`, `/kitchen/tickets/${k.id}/${m.on}`, { version: k.version })}>
            {t(m.label)}
          </Button>
        ))}
        <Button size="sm" variant="ghost" icon="printer" aria-label={t('kds.print')} loading={busy === `print-${k.id}`} onClick={() => void onAct(`print-${k.id}`, `/kitchen/tickets/${k.id}/print`, {})} />
      </footer>
    </article>
  );
}

/** The pass: every order with tickets out, each station's ticket beside it, served when all are ready. */
export function Expo() {
  const t = useT();
  const till = useTill();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.expo(till.branch), queryFn: ({ signal }) => get<ExpoData>('/kitchen/expo', { branch_id: till.branch }, signal), refetchInterval: 30_000 });
  useLive(till.branch, till.status?.last_seq ?? 0, true, 3_000, [K.expo(till.branch)]);
  const [busy, setBusy] = useState<number | null>(null);

  async function serve(o: ExpoData['orders'][number]) {
    setBusy(o.order_id);
    try {
      for (const k of o.tickets.filter((x) => x.status === 'ready')) await write(`/kitchen/tickets/${k.id}/serve`, { version: k.version });
      toast('success', t('kds.served', { number: o.number }));
    } catch (e) {
      toast('error', refusal(e).message);
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: K.expo(till.branch) });
    }
  }

  if (q.isError) return <div className="p-6"><Failed text={q.error instanceof Error ? q.error.message : t('kds.failed')} onRetry={() => void q.refetch()} /></div>;
  if (!q.data) return <Spinner />;
  return (
    <div className="flex flex-col gap-4 p-6">
      <Heading title={t('nav.expo')} hint={t('kds.expoHint')} />
      {q.data.orders.length === 0 ? <Note tone="muted">{t('kds.empty')}</Note> : null}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
        {q.data.orders.map((o) => (
          <article key={o.order_id} className={cx('flex flex-col gap-2 rounded-[12px] border-2 p-3', o.releasable ? 'border-success bg-success/10' : 'border-line bg-surface')}>
            <header className="flex items-baseline gap-2">
              <span className="text-[16px] font-extrabold">#{o.number}</span>
              <span className="text-[12.5px] text-ink-2">{o.table_label ? `${t('floor.table')} ${o.table_label}` : o.order_type}</span>
              {o.waiter_name ? <span className="ms-auto text-[12px] text-ink-3">{o.waiter_name}</span> : null}
            </header>
            <ul className="flex flex-col gap-1 text-[13px]">
              {o.tickets.map((k) => (
                <li key={k.id} className="flex items-center gap-2">
                  <span className={cx('h-2.5 w-2.5 rounded-full', k.status === 'ready' ? 'bg-success' : k.tone === 'late' ? 'bg-danger' : k.tone === 'warn' ? 'bg-warning' : 'bg-line')} />
                  <span className="min-w-0 flex-1">{k.station_name ?? k.number}</span>
                  <span className="text-ink-2">{k.status_label}</span>
                  <span className="w-12 text-end tabular-nums text-ink-3">{t('kds.minutes', { n: k.elapsed_minutes })}</span>
                </li>
              ))}
            </ul>
            <Button variant="primary" disabled={!o.releasable || !till.can('order_edit')} loading={busy === o.order_id} onClick={() => void serve(o)}>
              {t('kds.serveOrder')}
            </Button>
          </article>
        ))}
      </div>
    </div>
  );
}
