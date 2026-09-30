import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Button, Modal, Spinner, TextField, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { get, getMeta, K, money, refusal, write, type Floor as FloorData, type FloorTable, type Order } from './api';
import { useT } from './i18n';
import { Failed, Heading, Note, ReasonField, TABLE_TONE, useLive, useTill } from './parts';

/**
 * The live floor (RM-TBL-001..005): every table the person's scope reaches,
 * by area, with its state, party, order and next booking, kept current from
 * the server's live events. From a table: seat a party, open its order, ask
 * for the bill, move, merge or split the party, free a table nothing was sent
 * from, and say a table is clean. Every move carries the tables' versions:
 * two waiters acting on one table at once, the second is told to refresh.
 *
 * Offline the floor is the copy the terminal last took, and a new order can
 * still be taken at a table — it is kept for WorkSuite, and if somebody else
 * seated the table meanwhile the server keeps the sale off it for a manager.
 */
export default function Floor() {
  const t = useT();
  const till = useTill();
  const qc = useQueryClient();
  const [floorId, setFloorId] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | null>(null);

  const q = useQuery({ queryKey: K.floor(till.branch), queryFn: ({ signal }) => getMeta<FloorData>('/floor', { branch_id: till.branch }, signal), enabled: !till.offline, refetchInterval: till.status?.last_seq ? false : 20_000 });
  useLive(till.branch, till.status?.last_seq ?? 0, !till.offline, 4_000, [K.floor(till.branch)]);

  const data: FloorData | null = q.data?.data ?? (till.offline ? ((till.copy?.floor as FloorData | undefined) ?? null) : null);
  const floors = data?.floors ?? [];
  const current = floorId ?? floors[0]?.id ?? null;
  const tables = useMemo(() => (data?.tables ?? []).filter((x) => current === null || x.floor_id === current), [data, current]);
  const areas = useMemo(() => {
    const out = new Map<number, { name: string; tables: FloorTable[] }>();
    for (const tb of tables) {
      const a = data?.areas.find((x) => x.id === tb.area_id);
      const e = out.get(tb.area_id) ?? { name: a?.name ?? t('floor.area'), tables: [] };
      e.tables.push(tb);
      out.set(tb.area_id, e);
    }
    return [...out.values()];
  }, [tables, data, t]);
  const table = data?.tables.find((x) => x.id === picked) ?? null;

  if (q.isError && !till.offline) return <div className="p-6"><Failed text={q.error instanceof Error ? q.error.message : t('floor.failed')} onRetry={() => void q.refetch()} /></div>;
  if (!data) return till.offline ? <div className="p-6"><Note tone="muted">{t('floor.noCopy')}</Note></div> : <Spinner label={t('floor.loading')} />;

  return (
    <div className="flex flex-col gap-4 p-6">
      <Heading
        title={t('floor.title')}
        hint={till.offline ? t('floor.fromCopy') : data.business_date ? t('floor.businessDate', { date: data.business_date }) : undefined}
        action={
          <Button variant="primary" icon="plus" disabled={!till.can('order_create')} onClick={() => till.go('order', { type: 'takeaway' })}>
            {t('floor.takeaway')}
          </Button>
        }
      />
      {floors.length > 1 ? (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t('floor.floors')}>
          {floors.map((f) => (
            <button key={f.id} role="tab" aria-selected={f.id === current} onClick={() => setFloorId(f.id)} className={cx('rounded-full border px-3 py-1 text-[12.5px] font-semibold', f.id === current ? 'border-primary bg-selection text-primary' : 'border-line text-ink-2 hover:bg-subtle')}>
              {f.name}
            </button>
          ))}
        </div>
      ) : null}
      <Legend counts={data.counts} statuses={data.statuses} />
      {areas.length === 0 ? <Note tone="muted">{t('floor.noTables')}</Note> : null}
      {areas.map((a) => (
        <section key={a.name} aria-label={a.name}>
          <h2 className="mb-2 text-[13px] font-bold tracking-wide text-ink-2 uppercase">{a.name}</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
            {a.tables.map((tb) => (
              <TableCard key={tb.id} table={tb} onOpen={() => setPicked(tb.id)} />
            ))}
          </div>
        </section>
      ))}
      {table ? <TablePanel table={table} all={data.tables} onClose={() => setPicked(null)} onChanged={() => void qc.invalidateQueries({ queryKey: K.floor(till.branch) })} /> : null}
    </div>
  );
}

function Legend({ counts, statuses }: { counts: Record<string, number>; statuses: Record<string, string> }) {
  const shown = Object.entries(statuses).filter(([k]) => (counts[k] ?? 0) > 0);
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 text-[12px]">
      {shown.map(([k, label]) => (
        <span key={k} className={cx('rounded-full border px-2 py-0.5 font-semibold text-ink-2', TABLE_TONE[k])}>
          {label} · {counts[k]}
        </span>
      ))}
    </div>
  );
}

function TableCard({ table, onOpen }: { table: FloorTable; onOpen: () => void }) {
  const t = useT();
  const till = useTill();
  return (
    <button type="button" onClick={onOpen} className={cx('flex min-h-[104px] flex-col gap-1 rounded-[12px] border-2 p-2.5 text-start transition hover:shadow-md', TABLE_TONE[table.status] ?? 'border-line bg-surface')} aria-label={`${t('floor.table')} ${table.code} · ${table.status_label}`}>
      <div className="flex items-baseline gap-2">
        <span className="text-[18px] font-extrabold text-ink">{table.code}</span>
        <span className="text-[11.5px] text-ink-3">{t('floor.seats', { n: table.capacity })}</span>
      </div>
      <span className="text-[12px] font-semibold text-ink-2">{table.status_label}</span>
      {table.party ? (
        <span className="text-[12px] text-ink-2">
          {t('floor.guests', { n: table.party.guests })} · {t('floor.minutes', { n: table.party.elapsed_minutes })}
        </span>
      ) : null}
      {table.order ? (
        <span className="text-[12px] text-ink">
          #{table.order.number} · {money(table.order.total, till.currency)}
          {table.order.ready > 0 ? <span className="ms-1 font-bold text-success">· {t('floor.ready', { n: table.order.ready })}</span> : null}
        </span>
      ) : null}
      {table.next_reservation && !table.party ? (
        <span className="text-[11.5px] text-primary">
          {t('floor.booked', { name: table.next_reservation.name, at: table.next_reservation.reserved_for ? new Date(table.next_reservation.reserved_for).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '' })}
        </span>
      ) : null}
    </button>
  );
}

type Action = null | 'seat' | 'open' | 'free' | 'move' | 'merge' | 'split';

/** What can be done at one table, as the person may and as its state allows. */
function TablePanel({ table, all, onClose, onChanged }: { table: FloorTable; all: FloorTable[]; onClose: () => void; onChanged: () => void }) {
  const t = useT();
  const till = useTill();
  const [action, setAction] = useState<Action>(null);
  const [busy, setBusy] = useState(false);
  const [guests, setGuests] = useState(String(table.party?.guests ?? Math.min(2, table.capacity)));
  const [reason, setReason] = useState('');
  const [targets, setTargets] = useState<number[]>([]);
  const [lines, setLines] = useState<number[]>([]);
  const free = table.status === 'available' || table.status === 'reserved';
  const party = table.party;
  const on = till.offline;

  const order = useQuery({
    queryKey: K.order(table.order?.id ?? 0),
    queryFn: ({ signal }) => get<{ order: Order }>(`/orders/${table.order!.id}`, {}, signal).then((d) => d.order),
    enabled: action === 'split' && !!table.order,
  });

  async function run(path: string, body: Record<string, unknown>, after?: (data: Record<string, unknown>) => void) {
    setBusy(true);
    try {
      const r = await write<Record<string, unknown>>(path, body);
      if (r.message) toast('success', r.message);
      onChanged();
      after?.(r.data ?? {});
      setAction(null);
    } catch (e) {
      const f = refusal(e);
      toast(f.code === 'version_conflict' ? 'warning' : 'error', f.message);
      if (f.code === 'version_conflict') onChanged();
    } finally {
      setBusy(false);
    }
  }

  const n = Math.max(1, Math.min(500, Number(guests) || 1));
  const versions = (ids: number[]) => Object.fromEntries(all.filter((x) => ids.includes(x.id) || party?.tables.includes(x.id)).map((x) => [x.id, x.version]));
  const freeTables = all.filter((x) => (x.status === 'available' || x.status === 'reserved') && x.id !== table.id);
  const busyTables = all.filter((x) => x.party && x.party.session_id !== party?.session_id);

  const toggle = (list: number[], set: (v: number[]) => void, id: number) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <Modal title={`${t('floor.table')} ${table.code} · ${table.status_label}`} onClose={onClose} width={560}>
      <div className="flex flex-col gap-3">
        {party ? (
          <p className="text-[13px] text-ink-2">
            {t('floor.guests', { n: party.guests })} · {t('floor.minutes', { n: party.elapsed_minutes })}
            {party.waiter_name ? ` · ${party.waiter_name}` : ''}
            {party.tables.length > 1 ? ` · ${t('floor.joined', { tables: all.filter((x) => party.tables.includes(x.id)).map((x) => x.code).join(', ') })}` : ''}
          </p>
        ) : null}
        {table.order ? (
          <p className="text-[13px] text-ink">
            {t('floor.order', { number: table.order.number })} · {table.order.status_label} · {money(table.order.total, till.currency)}
          </p>
        ) : null}

        {action === null ? (
          <div className="flex flex-wrap gap-2">
            {free ? (
              <>
                <Button disabled={on || !till.can('table_manage')} onClick={() => setAction('seat')}>{t('floor.seat')}</Button>
                <Button variant="primary" disabled={!till.can('order_create')} onClick={() => (on ? till.go('order', { table: table.id }) : setAction('open'))}>{t('floor.openOrder')}</Button>
              </>
            ) : null}
            {table.order ? (
              <>
                <Button variant="primary" onClick={() => till.go('order', { order: table.order!.id })}>{t('floor.viewOrder')}</Button>
                <Button disabled={on || !till.can('order_create')} onClick={() => void run(`/floor/tables/${table.id}/request-bill`, { version: table.version })}>{t('floor.requestBill')}</Button>
                <Button disabled={on} onClick={() => till.go('bill', { order: table.order!.id })}>{t('floor.bill')}</Button>
              </>
            ) : party ? (
              <Button variant="primary" disabled={on || !till.can('order_create')} onClick={() => setAction('open')}>{t('floor.openOrder')}</Button>
            ) : null}
            {party ? (
              <>
                <Button disabled={on || !till.can('table_manage')} onClick={() => setAction('move')}>{t('floor.move')}</Button>
                <Button disabled={on || !till.can('table_manage')} onClick={() => setAction('merge')}>{t('floor.merge')}</Button>
                <Button disabled={on || !till.can('table_manage')} onClick={() => setAction('split')}>{t('floor.split')}</Button>
                <Button variant="danger" disabled={on || !till.can('table_manage')} onClick={() => setAction('free')}>{t('floor.free')}</Button>
              </>
            ) : null}
            {table.status === 'cleaning' ? <Button disabled={on || !till.can('table_manage')} onClick={() => void run(`/tables/${table.id}/clean`, { version: table.version })}>{t('floor.clean')}</Button> : null}
            {table.status === 'blocked' ? <Button disabled={on || !till.can('table_manage')} onClick={() => void run(`/tables/${table.id}/unblock`, { version: table.version, reason: 'Unblocked at the till' })}>{t('floor.unblock')}</Button> : null}
          </div>
        ) : null}
        {on && action === null ? <p className="text-[12px] text-ink-3">{t('floor.offlineActions')}</p> : null}

        {action === 'seat' || action === 'open' ? (
          <div className="flex flex-col gap-3">
            <TextField label={t('floor.howMany')} type="number" min={1} max={500} value={guests} onChange={(e) => setGuests(e.target.value)} />
            <div className="flex gap-2">
              <Button onClick={() => setAction(null)}>{t('common.back')}</Button>
              <Button
                variant="primary"
                loading={busy}
                onClick={() =>
                  action === 'seat'
                    ? void run(`/floor/tables/${table.id}/seat`, { guests: n, version: table.version })
                    : void run(`/floor/tables/${table.id}/open`, { guests: n, version: table.version }, (d) => {
                        const o = d.order as { id?: number } | null;
                        if (o?.id) till.go('order', { order: o.id });
                      })
                }
              >
                {action === 'seat' ? t('floor.seat') : t('floor.openOrder')}
              </Button>
            </div>
          </div>
        ) : null}

        {action === 'free' ? (
          <div className="flex flex-col gap-3">
            <ReasonField label={t('floor.freeWhy')} value={reason} onChange={setReason} />
            <div className="flex gap-2">
              <Button onClick={() => setAction(null)}>{t('common.back')}</Button>
              <Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={() => void run(`/floor/tables/${table.id}/free`, { reason: reason.trim(), version: table.version }, onClose)}>
                {t('floor.free')}
              </Button>
            </div>
          </div>
        ) : null}

        {action === 'move' || action === 'merge' || action === 'split' ? (
          <div className="flex flex-col gap-3">
            <p className="text-[12.5px] font-semibold text-ink-2">{action === 'move' ? t('floor.moveTo') : action === 'merge' ? t('floor.mergeWith') : t('floor.splitTo')}</p>
            <div className="flex max-h-[180px] flex-wrap gap-1.5 overflow-y-auto">
              {(action === 'merge' ? busyTables : freeTables).map((x) => {
                const chosen = targets.includes(x.id);
                return (
                  <button
                    key={x.id}
                    type="button"
                    aria-pressed={chosen}
                    onClick={() => (action === 'move' ? setTargets([x.id]) : toggle(targets, setTargets, x.id))}
                    className={cx('rounded-[8px] border px-2.5 py-1.5 text-[13px] font-semibold', chosen ? 'border-primary bg-selection text-primary' : 'border-line text-ink hover:bg-subtle')}
                  >
                    {x.code} <span className="font-normal text-ink-3">({x.capacity})</span>
                  </button>
                );
              })}
            </div>
            {action === 'split' ? (
              <>
                <TextField label={t('floor.splitGuests')} type="number" min={1} value={guests} onChange={(e) => setGuests(e.target.value)} />
                {order.data ? (
                  <div className="flex flex-col gap-1">
                    <span className="text-[12.5px] font-semibold text-ink-2">{t('floor.splitLines')}</span>
                    {order.data.lines
                      .filter((l) => l.parent_id === null && l.status !== 'voided')
                      .map((l) => (
                        <label key={l.id} className="flex items-center gap-2 text-[13px] text-ink">
                          <input type="checkbox" checked={lines.includes(l.id)} onChange={() => toggle(lines, setLines, l.id)} />
                          {l.qty.replace(/\.0+$/, '')} × {l.name}
                        </label>
                      ))}
                  </div>
                ) : null}
              </>
            ) : null}
            <div className="flex gap-2">
              <Button onClick={() => { setAction(null); setTargets([]); }}>{t('common.back')}</Button>
              <Button
                variant="primary"
                loading={busy}
                disabled={targets.length === 0 || !party}
                onClick={() => {
                  const sid = party!.session_id;
                  if (action === 'move') void run(`/floor/sessions/${sid}/move`, { to_table_id: targets[0], from_table_id: table.id, versions: versions(targets) }, onClose);
                  else if (action === 'merge') void run(`/floor/sessions/${sid}/merge`, { table_ids: targets, versions: versions(targets) }, onClose);
                  else void run(`/floor/sessions/${sid}/split`, { table_ids: targets, guests: n, line_ids: lines, versions: versions(targets) }, onClose);
                }}
              >
                {action === 'move' ? t('floor.move') : action === 'merge' ? t('floor.merge') : t('floor.split')}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
