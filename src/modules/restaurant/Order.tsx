import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { RestaurantLineInput } from '@shared/restaurant';
import { Button, Chip, Modal, Spinner, TextField, cx } from '../../components/ui';
import { call } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { get, getMeta, K, money, needsApproval, qty, refusal, unreachable, write, type BranchMenu, type MenuItem, type ModGroup, type Order, type OrderLine } from './api';
import { Approval, type ApprovalAsk } from './Approvals';
import { useT } from './i18n';
import { Failed, Heading, Note, ReasonField, useLive, useTill } from './parts';

/**
 * The order screen (RM-POS-001..006, §5.3): the branch's menu by category,
 * an item with its variant, modifiers, note, seat and course, the lines not
 * yet sent, and the order as the server has it — lines by state, what may be
 * done next (`choices`), send, fire and hold by course, serve, a line voided
 * with a reason (and an approval when the server asks for one), the KOT
 * printed again, and the bill.
 *
 * The server prices every line; what the till shows before it answers is a
 * preview, marked so. Offline, a new order or lines added to one are kept
 * for WorkSuite (the main process's outbox) with the device's own ids, and
 * sent to the kitchen when it takes them.
 */
interface CartLine extends RestaurantLineInput {
  name: string;
  detail: string;
  preview: number;
}

const newId = () => globalThis.crypto.randomUUID();

export default function OrderScreen() {
  const t = useT();
  const till = useTill();
  const qc = useQueryClient();
  const { order: orderId, table: tableId, takeaway } = till.screen;
  const [cart, setCart] = useState<CartLine[]>([]);
  const [picking, setPicking] = useState<MenuItem | null>(null);
  const [category, setCategory] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [seat, setSeat] = useState<number | null>(null);
  const [customer, setCustomer] = useState('');
  const [guests, setGuests] = useState('2');
  const [busy, setBusy] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<OrderLine | null>(null);
  const [uuid] = useState(newId);
  const channel = takeaway ? 'takeaway' : 'dine_in';

  const menuQ = useQuery({ queryKey: K.menu(till.branch, channel), queryFn: ({ signal }) => get<BranchMenu>(`/menu/branch/${till.branch}`, { channel }, signal), enabled: !till.offline, staleTime: 60_000 });
  const menu: BranchMenu | null = menuQ.data ?? ((till.offline || unreachable(menuQ.error)) ? ((till.copy?.menu as BranchMenu | undefined) ?? null) : null);

  const orderQ = useQuery({
    queryKey: K.order(orderId ?? 0),
    queryFn: ({ signal }) => getMeta<{ order: Order }>(`/orders/${orderId}`, {}, signal).then((r) => r.data.order),
    enabled: !!orderId && !till.offline,
  });
  useLive(till.branch, till.status?.last_seq ?? 0, !!orderId && !till.offline, 5_000, [K.order(orderId ?? 0)]);
  const order = orderQ.data ?? null;

  const cats = useMemo(() => (menu?.categories ?? []).filter((c) => (menu?.items ?? []).some((i) => i.category_id === c.id)), [menu]);
  const shownCat = category ?? cats[0]?.id ?? null;
  const items = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (menu?.items ?? []).filter((i) => (s ? i.name.toLowerCase().includes(s) : i.category_id === shownCat));
  }, [menu, search, shownCat]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: K.order(orderId ?? 0) });
    void qc.invalidateQueries({ queryKey: K.floor(till.branch) });
  };

  const lines = (): RestaurantLineInput[] => cart.map(({ name: _n, detail: _d, preview: _p, ...l }) => l);

  async function act(what: string, path: string, body: Record<string, unknown> = {}) {
    setBusy(what);
    try {
      const r = await write<{ order?: Order }>(path, body);
      if (r.message) toast('success', r.message);
      if (r.data?.order) qc.setQueryData(K.order(r.data.order.id), r.data.order);
      refresh();
      return r.data;
    } catch (e) {
      const f = refusal(e);
      toast(f.code === 'version_conflict' ? 'warning' : 'error', f.message);
      if (f.code === 'version_conflict') refresh();
      return null;
    } finally {
      setBusy(null);
    }
  }

  /** Lines to the server: a new order, lines added to one — or, offline, kept for WorkSuite. */
  async function place(send: boolean) {
    if (cart.length === 0) return;
    if (till.offline) {
      setBusy(send ? 'send' : 'add');
      try {
        if (order || orderId) {
          await call('restaurant:outboxAdd', { op: 'add_items', label: t('order.offlineLabelAdd', { n: cart.length, order: order?.number ?? floorOrderNumber(orderId!) ?? String(orderId) }), data: { order_id: orderId!, lines: lines(), send } });
        } else {
          await call('restaurant:outboxAdd', {
            op: 'create_order',
            label: tableId ? t('order.offlineLabelTable', { table: tableCode(tableId) ?? String(tableId) }) : t('order.offlineLabelTakeaway', { name: customer || '—' }),
            data: { uuid, order_type: tableId ? 'dine_in' : 'takeaway', table_id: tableId ?? null, guests: tableId ? Math.max(1, Number(guests) || 1) : null, customer_name: customer || null, lines: lines(), send },
          });
        }
        toast('success', t('order.keptOffline'));
        setCart([]);
        void qc.invalidateQueries({ queryKey: K.status });
        till.go('floor');
      } catch (e) {
        toast('error', e instanceof Error ? e.message : t('order.notKept'));
      } finally {
        setBusy(null);
      }
      return;
    }
    if (order) {
      const d = await act(send ? 'send' : 'add', `/orders/${order.id}/items`, { lines: lines(), send, version: order.version });
      if (d) setCart([]);
      return;
    }
    const d = tableId
      ? await act('send', `/floor/tables/${tableId}/open`, { guests: Math.max(1, Number(guests) || 1), lines: lines(), send, uuid, version: tableVersion(tableId) })
      : await act('send', '/orders', { branch_id: till.branch, order_type: 'takeaway', customer_name: customer || null, lines: lines(), send, uuid });
    const made = d?.order as Order | undefined;
    if (made?.id) {
      setCart([]);
      till.go('order', { order: made.id });
    }
  }

  const floorCopy = (qc.getQueryData(K.floor(till.branch)) as { data?: { tables?: Array<{ id: number; code: string; version: number }> } } | undefined)?.data ?? (till.copy?.floor as { tables?: Array<{ id: number; code: string; version: number }> } | undefined);
  function tableCode(id: number): string | null {
    return floorCopy?.tables?.find((x) => x.id === id)?.code ?? null;
  }
  function floorOrderNumber(id: number): string | null {
    return (floorCopy?.tables as Array<{ order?: { id: number; number: string } | null }> | undefined)?.find((x) => x.order?.id === id)?.order?.number ?? null;
  }
  function tableVersion(id: number): number | undefined {
    return floorCopy?.tables?.find((x) => x.id === id)?.version;
  }

  if (orderId && !till.offline && orderQ.isError) return <div className="p-6"><Failed text={orderQ.error instanceof Error ? orderQ.error.message : t('order.failed')} onRetry={() => void orderQ.refetch()} /></div>;
  if (orderId && !till.offline && !order) return <Spinner label={t('order.loading')} />;

  const title = order ? t('order.title', { number: order.number }) : orderId ? t('order.title', { number: floorOrderNumber(orderId) ?? String(orderId) }) : tableId ? t('order.newTable', { table: tableCode(tableId) ?? String(tableId) }) : t('order.newTakeaway');
  const preview = cart.reduce((s, l) => s + l.preview, 0);
  const courses = Object.entries(till.options?.courses ?? { drinks: 'Drinks', starter: 'Starter', main: 'Main', dessert: 'Dessert' });
  const has = (c: string) => order?.choices.includes(c) ?? false;
  const unsent = order?.lines.filter((l) => l.parent_id === null && l.status === 'new') ?? [];
  const heldCourses = [...new Set((order?.lines ?? []).filter((l) => l.status === 'held' && l.course).map((l) => l.course!))];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-6 lg:flex-row">
      {/* The menu */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3" aria-label={t('order.menu')}>
        <Heading title={title} hint={order ? `${order.order_type_label} · ${order.status_label}${order.table_label ? ` · ${t('floor.table')} ${order.table_label}` : ''}` : undefined} />
        {order?.allergy_warning ? <Note tone="danger">{order.allergy_warning}</Note> : null}
        {!menu ? (
          menuQ.isError && !till.offline ? <Failed text={menuQ.error instanceof Error ? menuQ.error.message : t('order.menuFailed')} onRetry={() => void menuQ.refetch()} /> : till.offline ? <Note tone="muted">{t('order.noMenuCopy')}</Note> : <Spinner label={t('order.menuLoading')} />
        ) : (
          <>
            <TextField placeholder={t('order.search')} aria-label={t('order.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
            {!search ? (
              <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t('order.categories')}>
                {cats.map((c) => (
                  <button key={c.id} role="tab" aria-selected={c.id === shownCat} onClick={() => setCategory(c.id)} className={cx('rounded-full border px-3 py-1 text-[12.5px] font-semibold', c.id === shownCat ? 'border-primary bg-selection text-primary' : 'border-line text-ink-2 hover:bg-subtle')}>
                    {c.name}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="grid min-h-0 grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2 overflow-y-auto">
              {items.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  disabled={!i.orderable}
                  onClick={() => setPicking(i)}
                  className="flex min-h-[78px] flex-col items-start gap-1 rounded-[10px] border border-line bg-surface p-2.5 text-start hover:border-primary disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <span className="text-[13.5px] leading-tight font-bold text-ink">{i.name}</span>
                  <span className="text-[12px] text-ink-2">{i.open_price ? t('order.openPrice') : money(i.price, till.currency)}</span>
                  {!i.orderable ? <span className="text-[11px] font-semibold text-danger">{i.state === 'sold_out' ? t('order.soldOut') : t('order.unavailable')}</span> : null}
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      {/* The ticket */}
      <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-[380px]" aria-label={t('order.ticket')}>
        {!order && !orderId ? (
          <div className="flex gap-2">
            {tableId ? <TextField label={t('floor.howMany')} type="number" min={1} value={guests} onChange={(e) => setGuests(e.target.value)} /> : <TextField label={t('order.customer')} value={customer} onChange={(e) => setCustomer(e.target.value)} />}
          </div>
        ) : null}

        {order ? (
          <div className="flex flex-col gap-1.5 rounded-[12px] border border-line bg-surface p-3">
            {order.lines.filter((l) => l.parent_id === null).length === 0 ? <p className="text-[13px] text-ink-3">{t('order.empty')}</p> : null}
            {order.lines
              .filter((l) => l.parent_id === null)
              .map((l) => (
                <div key={l.id} className={cx('flex items-start gap-2 border-b border-line pb-1.5 last:border-0', l.status === 'voided' && 'opacity-50 line-through')}>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold text-ink">
                      {qty(l.qty)} × {l.name}
                      {l.variant_name ? ` (${l.variant_name})` : ''}
                    </div>
                    {l.modifiers.length ? <div className="text-[12px] text-ink-2">{l.modifiers.map((m) => m.name).join(', ')}</div> : null}
                    {l.notes ? <div className="text-[12px] text-warning">! {l.notes}</div> : null}
                    <div className="text-[11.5px] text-ink-3">
                      {l.status_label}
                      {l.seat ? ` · ${t('order.seatN', { n: l.seat })}` : ''}
                      {l.course ? ` · ${till.options?.courses?.[l.course] ?? l.course}` : ''}
                    </div>
                  </div>
                  <span className="text-[13px] text-ink tabular-nums">{money(l.line_total)}</span>
                  {l.status !== 'voided' && (l.choices.includes('void') || l.choices.includes('remove') || l.status === 'new') ? (
                    <Button size="sm" variant="ghost" icon="x" aria-label={t('order.voidLine', { name: l.name })} onClick={() => setVoiding(l)} />
                  ) : null}
                </div>
              ))}
            <div className="mt-1 flex flex-col gap-0.5 text-[13px]">
              <Row label={t('bill.subtotal')} value={money(order.subtotal)} />
              {Number(order.discount_total) ? <Row label={t('bill.discount')} value={`− ${money(order.discount_total)}`} /> : null}
              {Number(order.charge_total) ? <Row label={t('bill.charges')} value={money(order.charge_total)} /> : null}
              {Number(order.tax_total) ? <Row label={t('bill.tax')} value={money(order.tax_total)} /> : null}
              <Row label={t('bill.total')} value={money(order.total, order.currency ?? till.currency)} strong />
              {Number(order.paid_total) ? <Row label={t('bill.balance')} value={money(order.balance, order.currency ?? till.currency)} /> : null}
            </div>
          </div>
        ) : null}

        {/* Not yet sent anywhere */}
        <div className="flex flex-col gap-2 rounded-[12px] border border-dashed border-primary/50 bg-surface p-3">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-[12.5px] font-bold text-ink-2">{t('order.new')}</span>
            <label className="flex items-center gap-1.5 text-[12px] text-ink-2">
              {t('order.seat')}
              <select aria-label={t('order.seat')} value={seat ?? ''} onChange={(e) => setSeat(e.target.value ? Number(e.target.value) : null)} className="rounded-[6px] border border-line bg-surface px-1 py-0.5">
                <option value="">—</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {cart.length === 0 ? <p className="text-[12.5px] text-ink-3">{t('order.pickHint')}</p> : null}
          {cart.map((l, i) => (
            <div key={l.client_line_id} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-ink">
                  {qty(l.qty)} × {l.name}
                </div>
                {l.detail ? <div className="text-[11.5px] text-ink-2">{l.detail}</div> : null}
              </div>
              <Button size="sm" variant="ghost" icon="x" aria-label={t('order.remove', { name: l.name })} onClick={() => setCart(cart.filter((_, j) => j !== i))} />
            </div>
          ))}
          {cart.length ? <p className="text-[11.5px] text-ink-3">{t('order.preview', { amount: money(preview.toFixed(2), till.currency) })}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button disabled={cart.length === 0 || !till.can('order_create')} loading={busy === 'add'} onClick={() => void place(false)}>
              {order ? t('order.add') : t('order.hold')}
            </Button>
            <Button variant="primary" icon="send" disabled={cart.length === 0 || !till.can('order_create')} loading={busy === 'send'} onClick={() => void place(true)}>
              {t('order.sendKitchen')}
            </Button>
          </div>
        </div>

        {order && !till.offline ? (
          <div className="flex flex-wrap gap-2">
            {unsent.length ? (
              <Button variant="primary" icon="send" loading={busy === 'sendAll'} onClick={() => void act('sendAll', `/orders/${order.id}/send`, { version: order.version })}>
                {t('order.sendUnsent', { n: unsent.length })}
              </Button>
            ) : null}
            {heldCourses.map((c) => (
              <Button key={c} icon="play" loading={busy === `fire-${c}`} onClick={() => void act(`fire-${c}`, `/orders/${order.id}/fire`, { course: c, version: order.version })}>
                {t('order.fire', { course: till.options?.courses?.[c] ?? c })}
              </Button>
            ))}
            {unsent.length
              ? courses
                  .filter(([c]) => unsent.some((l) => l.course === c))
                  .map(([c, label]) => (
                    <Button key={c} icon="pause" loading={busy === `hold-${c}`} onClick={() => void act(`hold-${c}`, `/orders/${order.id}/hold`, { course: c, version: order.version })}>
                      {t('order.holdCourse', { course: label })}
                    </Button>
                  ))
              : null}
            {has('serve') ? <Button icon="check" loading={busy === 'serve'} onClick={() => void act('serve', `/orders/${order.id}/serve`, { version: order.version })}>{t('order.serve')}</Button> : null}
            <Button icon="printer" loading={busy === 'kot'} onClick={() => void act('kot', `/orders/${order.id}/print-kot`, {})}>{t('order.printKot')}</Button>
            <Button icon="banknote" onClick={() => till.go('bill', { order: order.id })}>{t('floor.bill')}</Button>
          </div>
        ) : null}
        {order && till.offline ? <Note tone="muted">{t('order.offlineExisting')}</Note> : null}
      </aside>

      {picking ? (
        <ItemPicker
          item={picking}
          seat={seat}
          onClose={() => setPicking(null)}
          onAdd={(l) => {
            setCart([...cart, l]);
            setPicking(null);
          }}
        />
      ) : null}
      {voiding && order ? <VoidLine order={order} line={voiding} onClose={() => setVoiding(null)} onDone={refresh} /> : null}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cx('flex items-center gap-2', strong && 'text-[15px] font-extrabold')}>
      <span className="flex-1 text-ink-2">{label}</span>
      <span className="text-ink tabular-nums">{value}</span>
    </div>
  );
}

/** An item as the waiter orders it: variant, modifiers (with the one nested level), quantity, note, course. */
export function ItemPicker({ item, seat, onClose, onAdd }: { item: MenuItem; seat: number | null; onClose: () => void; onAdd: (l: CartLine) => void }) {
  const t = useT();
  const till = useTill();
  const [variant, setVariant] = useState<number | null>(item.variants.find((v) => v.is_default)?.id ?? item.variants[0]?.id ?? null);
  const [picked, setPicked] = useState<Record<number, number[]>>(() => {
    const out: Record<number, number[]> = {};
    for (const g of item.groups) out[g.id] = g.options.filter((o) => o.is_default && o.orderable).map((o) => o.id);
    return out;
  });
  const [n, setN] = useState('1');
  const [notes, setNotes] = useState('');
  const [course, setCourse] = useState(item.course ?? '');
  const [price, setPrice] = useState('');

  const groups: Array<{ g: ModGroup; parent: number | null }> = [];
  for (const g of item.groups) {
    groups.push({ g, parent: null });
    for (const o of g.options) if ((picked[g.id] ?? []).includes(o.id)) for (const sub of o.groups) groups.push({ g: sub, parent: o.id });
  }
  const problems = groups.filter(({ g }) => {
    const c = (picked[g.id] ?? []).length;
    return (g.required && c < Math.max(1, g.min)) || c < g.min || (g.max > 0 && c > g.max);
  });

  const toggle = (g: ModGroup, id: number) => {
    const cur = picked[g.id] ?? [];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : g.max === 1 ? [id] : [...cur, id];
    setPicked({ ...picked, [g.id]: next });
  };

  const unit = Number(item.open_price ? price || 0 : (item.variants.find((v) => v.id === variant)?.price ?? item.price)) + groups.reduce((s, { g }) => s + g.options.filter((o) => (picked[g.id] ?? []).includes(o.id)).reduce((a, o) => a + Number(o.price_delta || 0), 0), 0);
  const count = Math.max(0.001, Math.min(999, Number(n) || 1));

  function add() {
    const top = item.groups.flatMap((g) =>
      (picked[g.id] ?? []).map((id) => {
        const o = g.options.find((x) => x.id === id)!;
        const subs = o.groups.flatMap((sg) => (picked[sg.id] ?? []).map((sid) => ({ option_id: sid })));
        return { option_id: id, ...(subs.length ? { modifiers: subs } : {}) };
      }),
    );
    const names = groups.flatMap(({ g }) => g.options.filter((o) => (picked[g.id] ?? []).includes(o.id)).map((o) => o.name));
    const v = item.variants.find((x) => x.id === variant);
    onAdd({
      item_id: item.id,
      variant_id: variant,
      qty: count,
      notes: notes.trim() || null,
      seat,
      course: course || null,
      modifiers: top,
      ...(item.open_price && price ? { price: Number(price).toFixed(2) } : {}),
      client_line_id: `l-${newId()}`,
      name: v ? `${item.name} (${v.name})` : item.name,
      detail: [...names, notes.trim() ? `! ${notes.trim()}` : '', seat ? t('order.seatN', { n: seat }) : ''].filter(Boolean).join(' · '),
      preview: unit * count,
    });
  }

  return (
    <Modal
      title={item.name}
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={problems.length > 0 || (item.open_price && !(Number(price) > 0))} onClick={add}>
            {t('order.addLine', { amount: money((unit * count).toFixed(2), till.currency) })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {item.description ? <p className="text-[13px] text-ink-2">{item.description}</p> : null}
        {item.allergens?.length ? (
          <div className="flex flex-wrap gap-1">
            {item.allergens.map((a) => (
              <Chip key={a} tone="warning">
                {a}
              </Chip>
            ))}
          </div>
        ) : null}
        {item.variants.length ? (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-[12.5px] font-semibold text-ink-2">{t('order.variant')}</legend>
            {item.variants.map((v) => (
              <label key={v.id} className={cx('flex items-center gap-2 text-[13.5px]', !v.orderable && 'opacity-45')}>
                <input type="radio" name="variant" disabled={!v.orderable} checked={variant === v.id} onChange={() => setVariant(v.id)} />
                <span className="flex-1">{v.name}</span>
                <span className="text-ink-2 tabular-nums">{money(v.price)}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        {groups.map(({ g, parent }) => (
          <fieldset key={`${parent ?? 0}-${g.id}`} className={cx('flex flex-col gap-1.5', parent !== null && 'ms-5 border-s border-line ps-3')}>
            <legend className="mb-1 text-[12.5px] font-semibold text-ink-2">
              {g.name} {g.required || g.min > 0 ? <span className="text-danger">*</span> : null}
              <span className="ms-1 font-normal text-ink-3">{g.max === 1 ? t('order.chooseOne') : g.max > 0 ? t('order.chooseUpTo', { n: g.max }) : ''}</span>
            </legend>
            {g.options.map((o) => (
              <label key={o.id} className={cx('flex items-center gap-2 text-[13.5px]', !o.orderable && 'opacity-45')}>
                <input type={g.max === 1 ? 'radio' : 'checkbox'} name={`g${g.id}`} disabled={!o.orderable} checked={(picked[g.id] ?? []).includes(o.id)} onChange={() => toggle(g, o.id)} />
                <span className="flex-1">{o.name}</span>
                {Number(o.price_delta) ? <span className="text-ink-2 tabular-nums">+{money(o.price_delta)}</span> : null}
              </label>
            ))}
          </fieldset>
        ))}
        <div className="grid grid-cols-2 gap-3">
          <TextField label={t('order.qty')} type="number" min={1} max={999} value={n} onChange={(e) => setN(e.target.value)} />
          <label className="flex flex-col gap-1">
            <span className="text-[12.5px] font-semibold text-ink-2">{t('order.course')}</span>
            <select value={course} onChange={(e) => setCourse(e.target.value)} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px] text-ink">
              <option value="">—</option>
              {Object.entries(till.options?.courses ?? {}).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {item.open_price ? <TextField label={t('order.price')} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ''))} /> : null}
        <TextField label={t('order.note')} value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Modal>
  );
}

/**
 * Take a line off, or void it after the kitchen has it: a reason always, a
 * quantity for part of a line, and — when the server says it is above the
 * person's limit — an approval, answered by a manager's PIN on this till or
 * from their own device, then the void again with the approval's id.
 */
function VoidLine({ order, line, onClose, onDone }: { order: Order; line: OrderLine; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [reason, setReason] = useState('');
  const [n, setN] = useState(qty(line.qty));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<ApprovalAsk | null>(null);

  async function run(approvalId?: number) {
    setBusy(true);
    setError(null);
    try {
      const r = await write(`/orders/${order.id}/items/${line.id}/void`, { reason: reason.trim(), qty: Number(n) || undefined, version: line.version, ...(approvalId ? { approval_id: approvalId } : {}) });
      toast('success', r.message ?? t('order.voided'));
      onDone();
      onClose();
    } catch (e) {
      const f = refusal(e);
      if (needsApproval(f) && f.approval) setAsk({ ...f.approval, reason: reason.trim(), order_id: order.id, branch_id: order.branch_id, message: f.message });
      else setError(f.message);
    } finally {
      setBusy(false);
    }
  }

  if (ask) return <Approval ask={ask} onClose={onClose} onApproved={(id) => void run(id)} />;

  return (
    <Modal
      title={t('order.voidTitle', { name: line.name })}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={() => void run()}>
            {line.status === 'new' ? t('order.takeOff') : t('order.void')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {line.status !== 'new' ? <Note tone="warning">{t('order.voidAfterKitchen')}</Note> : null}
        <TextField label={t('order.qty')} type="number" min={0.001} max={Number(line.qty)} value={n} onChange={(e) => setN(e.target.value)} />
        <ReasonField label={t('order.voidWhy')} value={reason} onChange={setReason} />
        {error ? <Note tone="danger">{error}</Note> : null}
      </div>
    </Modal>
  );
}
