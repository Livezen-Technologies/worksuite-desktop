import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { app } from '../../core/app-state';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, Field, input, PageHead, Sheet, SidePanel } from '../hr/parts';
import { can, fetchCategories, K, num, qty, signed, stampWords, treeOf, type Warehouse } from './api';
import { DocChip } from './Adjustments';
import { countAct, countedOf, countKind, COUNT_KINDS, createCount, deleteCount, fetchCount, fetchCounts, KC, PER, saveCountLines } from './control';
import { minWidth, Signed } from './parts';
import { pick, WarehousePick } from './pickers';
import CountDesk, { countsHere } from './CountDesk';

/**
 * Stock counts (InvCounts): a sheet of what the books say is on the shelves,
 * frozen when counting starts, filled in with what is actually there, and
 * posted as one adjustment for the differences. An empty count is not a
 * count of zero — those lines are left out.
 */
const STATUSES = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'counting', label: 'Counting' },
  { value: 'review', label: 'Review' },
  { value: 'posted', label: 'Posted' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function Counts({
  initialStatus,
  org,
  warehouse,
  currency,
  openId,
  onOpen,
  onNew,
  onOpenAdjustment,
}: {
  org: string;
  warehouse: number | null;
  currency: string | null;
  /** The status the list opens on (the dashboard's "needs attention" links). */
  initialStatus?: string | null;
  openId: number | null;
  onOpen: (id: number | null) => void;
  onNew: (() => void) | null;
  onOpenAdjustment: (id: number) => void;
}) {
  const [status, setStatus] = useState(initialStatus ?? '');
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  // A sheet open for counting takes the whole screen: the counting desk, which keeps working offline.
  const opened = useQuery({ queryKey: KC.count(openId ?? 0), queryFn: ({ signal }) => fetchCount(openId!, signal), enabled: !!openId });
  const f = { status, q: '' };
  const list = useInfiniteQuery({
    queryKey: KC.counts(org, { ...f, warehouse }),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => fetchCounts(org, warehouse, { ...f, page: pageParam }, signal),
    getNextPageParam: (last, pages) => (pages.length * PER < last.total ? pages.length + 1 : undefined),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.rows), [list.data]);
  const total = list.data?.pages[0]?.total ?? 0;
  const seesCost = rows.some((r) => r.variance_value !== null);
  const W = { wh: 160, kind: 140, st: 96, counted: 80, vars: 80, val: 96 };
  const min = minWidth(120, [W.wh, W.kind, W.st, W.counted, W.vars, ...(seesCost ? [W.val] : [])]);

  if (openId && opened.data && countsHere(opened.data.count.status, can(perms, 'inventory.adjust'))) {
    return <CountDesk key={openId} id={openId} detail={opened.data} currency={currency} onBack={() => onOpen(null)} onOpenAdjustment={onOpenAdjustment} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-6 py-5">
      <PageHead title="Stock counts" sub={<span data-doc-count>{list.isLoading ? ' ' : `${total.toLocaleString()} ${total === 1 ? 'count' : 'counts'}`}</span>}>
        {onNew ? (
          <button type="button" className={btnPrimary} onClick={onNew}>
            <Icon name="plus" size={15} /> New count
          </button>
        ) : null}
      </PageHead>
      <div className="flex items-center gap-2">
        <Select aria-label="Status" value={status} onValueChange={setStatus} options={STATUSES} className={pick + ' !w-[160px]'} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
        <div className="min-h-0 flex-1 overflow-auto scroll-thin">
          <div style={{ minWidth: min }}>
            <div className="sticky top-0 z-10 flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
              <span className="min-w-0 flex-1">Reference</span>
              <span style={{ width: W.wh }}>Warehouse</span>
              <span style={{ width: W.kind }}>Kind</span>
              <span style={{ width: W.st }}>Status</span>
              <span className="text-right" style={{ width: W.counted }}>
                Counted
              </span>
              <span className="text-right" style={{ width: W.vars }}>
                Variances
              </span>
              {seesCost ? (
                <span className="text-right" style={{ width: W.val }}>
                  Value
                </span>
              ) : null}
            </div>
            {list.isLoading ? (
              <Spinner />
            ) : list.error ? (
              <ErrorNote error={list.error} onRetry={() => void list.refetch()} />
            ) : rows.length ? (
              rows.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  data-count={c.id}
                  onClick={() => onOpen(c.id)}
                  className={cx('flex w-full items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-left text-[12.5px] last:border-b-0 hover:bg-subtle/60', openId === c.id && 'bg-info-soft dark:bg-selection/40')}
                >
                  <b className="min-w-0 flex-1 truncate text-ink">{c.reference}</b>
                  <span className="shrink-0 truncate text-ink-2" style={{ width: W.wh }}>
                    {c.warehouse ?? '—'}
                  </span>
                  <span className="shrink-0 truncate text-ink-2" style={{ width: W.kind }}>
                    {countKind(c.kind)}
                  </span>
                  <span className="shrink-0" style={{ width: W.st }}>
                    <DocChip status={c.status} />
                  </span>
                  <span className="shrink-0 text-right text-ink-2 tabular-nums" style={{ width: W.counted }}>
                    {num(c.line_count) ? `${num(c.counted_lines) ?? 0}/${num(c.line_count)}` : '—'}
                  </span>
                  <span className="shrink-0 text-right text-ink-2 tabular-nums" style={{ width: W.vars }}>
                    {num(c.counted_lines) ? (num(c.variance_lines) ?? 0) : '—'}
                  </span>
                  {seesCost ? (
                    <span className="shrink-0 text-right text-ink tabular-nums" style={{ width: W.val }}>
                      {c.status === 'posted' && c.variance_value !== null ? signed(Math.round(num(c.variance_value) ?? 0)) : '—'}
                    </span>
                  ) : null}
                </button>
              ))
            ) : (
              <Empty text={status ? 'No count matches.' : 'No counts yet.'} />
            )}
          </div>
        </div>
        {list.hasNextPage ? (
          <div className="flex shrink-0 justify-center border-t border-line px-3.5 py-2 text-[12px]">
            <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
              {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          </div>
        ) : null}
      </div>
      {openId ? <CountPanel key={openId} id={openId} currency={currency} onClose={() => onOpen(null)} onOpenAdjustment={onOpenAdjustment} /> : null}
    </div>
  );
}

function CountPanel({ id, currency, onClose, onOpenAdjustment }: { id: number; currency: string | null; onClose: () => void; onOpenAdjustment: (id: number) => void }) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const q = useQuery({ queryKey: KC.count(id), queryFn: ({ signal }) => fetchCount(id, signal) });
  const [typed, setTyped] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'post' | 'cancel' | 'remove' | null>(null);
  const d = q.data;
  const c = d?.count;
  const mayAdjust = can(perms, 'inventory.adjust');
  const open = c?.status === 'counting' || c?.status === 'review';
  const seesCost = !!d && d.lines.some((l) => l.unit_cost !== null);
  const dirty = Object.keys(typed).length > 0;
  const shown = (l: { id: number; counted_qty: unknown }) => typed[l.id] ?? (num(l.counted_qty) === null ? '' : String(num(l.counted_qty)));
  const counted = d ? d.lines.filter((l) => countedOf(shown(l)).value !== null).length : 0;

  const refresh = () => void qc.invalidateQueries({ queryKey: ['inventory'] });
  const act = async (label: string, fn: () => Promise<unknown>, after?: (r: unknown) => void) => {
    setBusy(true);
    try {
      const r = await fn();
      toast('success', label);
      refresh();
      after?.(r);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };
  const saveCounts = async (): Promise<boolean> => {
    if (!d) return false;
    const lines: Array<{ id: number; counted_qty: number | null }> = [];
    for (const [k, v] of Object.entries(typed)) {
      const r = countedOf(v);
      if (!r.ok) {
        const l = d.lines.find((x) => x.id === Number(k));
        toast('error', `${l?.code ?? l?.name ?? 'A line'}: a count is a number, zero or more — or left empty.`);
        return false;
      }
      lines.push({ id: Number(k), counted_qty: r.value });
    }
    if (!lines.length) return true;
    try {
      await saveCountLines(id, lines);
      setTyped({});
      refresh();
      return true;
    } catch (e) {
      toast('error', errorMessage(e));
      return false;
    }
  };

  return (
    <>
      <SidePanel
        label={c ? `Count ${c.reference}` : 'Count'}
        width={680}
        onClose={onClose}
        head={
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <b className="truncate text-[15px] text-ink">{c?.reference ?? 'Count'}</b>
            {c ? <span className="truncate text-[12.5px] text-ink-3">{c.warehouse}</span> : null}
            {c ? <DocChip status={c.status} /> : null}
          </span>
        }
      >
        {q.isLoading ? (
          <Spinner />
        ) : q.error ? (
          <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
        ) : c && d ? (
          <>
            <span className="text-[12.5px] text-ink-2">
              {[countKind(c.kind), c.scope === 'all' ? 'Everything in the warehouse' : `By ${c.scope}`, d.lines.length ? `${counted}/${d.lines.length} counted` : null, c.counted_by_name ? `counted by ${c.counted_by_name}` : null]
                .filter(Boolean)
                .join(' · ')}
            </span>
            {c.status === 'draft' ? <span className="rounded-[10px] bg-subtle px-3 py-2 text-[12.5px] text-ink-2">Starting the count freezes what is expected on every line. Start it when the counters are ready.</span> : null}
            {d.drifted && open ? (
              <span className="rounded-[10px] bg-warning-bg px-3 py-2 text-[12.5px] text-warning-ink dark:bg-warning-bg dark:text-warning">
                {d.drifted} {d.drifted === 1 ? 'line has' : 'lines have'} moved since the sheet was frozen. Posting applies the variance on top of that movement.
              </span>
            ) : null}
            {d.lines.length ? (
              <div className="overflow-hidden rounded-[10px] border border-line">
                <div className="flex gap-2 border-b border-line bg-ground px-3 py-1.5 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
                  <span className="min-w-0 flex-1">Product</span>
                  <span className="w-[56px]">Where</span>
                  <span className="w-[86px] text-right">Expected</span>
                  <span className="w-[80px] text-right">Counted</span>
                  <span className="w-[64px] text-right">Variance</span>
                  {seesCost ? <span className="w-[80px] text-right">Value</span> : null}
                </div>
                {d.lines.map((l) => {
                  const exp = num(l.expected_qty) ?? 0;
                  const got = countedOf(shown(l));
                  const v = got.value === null ? null : Math.round((got.value - exp) * 10000) / 10000;
                  const val = v === null || l.unit_cost === null ? null : v * (num(l.unit_cost) ?? 0);
                  return (
                    <div key={l.id} data-count-line={l.code ?? l.id} className="flex items-center gap-2 border-b border-line/60 px-3 py-1.5 text-[12.5px] last:border-b-0">
                      <span className="flex min-w-0 flex-1 flex-col">
                        <b className="truncate text-ink">
                          {l.name}
                          {l.variant_label ? ` — ${l.variant_label}` : ''}
                        </b>
                        <span className="truncate text-[11px] text-ink-3">
                          {[l.code, l.tracking === 'batch' ? 'batch tracked — adjust a difference naming the batch' : l.tracking === 'serial' ? 'serialised — adjust a difference naming each unit' : null].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className="w-[56px] truncate text-ink-2">{l.bin ?? '—'}</span>
                      <span className="w-[86px] text-right text-ink-2 tabular-nums">
                        {qty(exp)}
                        {l.drifted ? <span className="block text-[11px] text-warning-ink dark:text-warning">now {qty(l.on_hand_now)}</span> : null}
                      </span>
                      <span className="w-[80px]">
                        {open && mayAdjust ? (
                          <input
                            className={cx(input, '!h-[28px] text-right tabular-nums', !got.ok && '!border-danger')}
                            value={shown(l)}
                            placeholder="—"
                            onChange={(e) => setTyped({ ...typed, [l.id]: e.target.value })}
                            aria-label={`Counted ${l.code ?? l.name}`}
                          />
                        ) : (
                          <span className="block text-right text-ink tabular-nums">{got.value === null ? '—' : qty(got.value)}</span>
                        )}
                      </span>
                      <span className="w-[64px] text-right">{v === null ? <span className="text-ink-3">—</span> : <Signed value={v} text={signed(v)} />}</span>
                      {seesCost ? <span className="w-[80px] text-right text-ink-2 tabular-nums">{val === null ? '' : signed(Math.round(val))}</span> : null}
                    </div>
                  );
                })}
              </div>
            ) : c.status !== 'draft' ? (
              <span className="text-[12.5px] text-ink-3">No lines on this sheet.</span>
            ) : null}
            {open ? <span className="text-[11.5px] text-ink-3">An empty count is not a count of zero — those lines are left out of the adjustment entirely.</span> : null}
            {c.status === 'posted' ? (
              <span className="text-[12.5px] font-semibold text-ink-2">
                Posted{c.posted_at ? ` ${stampWords(c.posted_at)}` : ''}
                {c.variance_value !== null ? ` · ${currency ? `${currency} ` : ''}${signed(Math.round(num(c.variance_value) ?? 0))} of difference` : ''}.{' '}
                {num(c.adjustment_id) ? (
                  <button type="button" className="text-primary hover:underline" onClick={() => onOpenAdjustment(num(c.adjustment_id)!)}>
                    Its adjustment
                  </button>
                ) : null}
              </span>
            ) : null}
            {mayAdjust && c.status !== 'posted' ? (
              <div className="flex flex-wrap gap-2">
                {c.status === 'draft' ? (
                  <button type="button" className={btnPrimary + ' !h-[30px] !text-[12.5px]'} disabled={busy} onClick={() => void act('Counting — the expected quantities are frozen', () => countAct(id, 'start'))}>
                    Start counting
                  </button>
                ) : null}
                {open ? (
                  <button type="button" className={btnSmall} disabled={busy || !dirty} onClick={() => void saveCounts().then((ok) => ok && toast('success', 'Counts saved'))}>
                    Save counts
                  </button>
                ) : null}
                {open ? (
                  <button type="button" className={btnPrimary + ' !h-[30px] !text-[12.5px]'} disabled={busy || counted === 0} onClick={() => setConfirm('post')}>
                    Post variances
                  </button>
                ) : null}
                {c.status !== 'cancelled' ? (
                  <button type="button" className={btnSmall} disabled={busy} onClick={() => setConfirm('cancel')}>
                    Cancel count
                  </button>
                ) : null}
                <button type="button" className={btnSmall + ' ml-auto text-danger'} disabled={busy} onClick={() => setConfirm('remove')}>
                  Delete
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </SidePanel>
      {confirm && c ? (
        <Sheet
          title={confirm === 'post' ? `Post ${c.reference}?` : confirm === 'cancel' ? `Cancel ${c.reference}?` : `Delete ${c.reference}?`}
          width={440}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setConfirm(null)}>
                Back
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={busy}
                onClick={() => {
                  if (confirm === 'post') {
                    setBusy(true);
                    void saveCounts().then((ok) => {
                      setBusy(false);
                      if (ok) void act('Variances posted', () => countAct(id, 'post'));
                      else setConfirm(null);
                    });
                  } else if (confirm === 'cancel') void act('Count cancelled', () => countAct(id, 'cancel'));
                  else void act('Count deleted', () => deleteCount(id), onClose);
                }}
              >
                {confirm === 'post' ? 'Post variances' : confirm === 'cancel' ? 'Cancel count' : 'Delete'}
              </button>
            </>
          }
        >
          <span className="text-[13px] text-ink-2">
            {confirm === 'post'
              ? `The ${counted} counted ${counted === 1 ? 'line is' : 'lines are'} compared with what was expected, and the differences are posted as one adjustment. Lines left empty are left out.`
              : confirm === 'cancel'
                ? 'The sheet stays on the list, marked cancelled. Nothing moves.'
                : 'It is removed from the list. Nothing moves.'}
          </span>
        </Sheet>
      ) : null}
    </>
  );
}

/** A new count sheet (InvControlSheet). */
export function CountSheet({ org, warehouses, defaultWarehouse, onClose, onSaved }: { org: string; warehouses: Warehouse[]; defaultWarehouse?: number | null; onClose: () => void; onSaved: (id: number) => void }) {
  const qc = useQueryClient();
  const [wh, setWh] = useState<number | null>(defaultWarehouse ?? null);
  const [kind, setKind] = useState<string>('random');
  const [sample, setSample] = useState('20');
  const [scope, setScope] = useState<'all' | 'category'>('all');
  const [category, setCategory] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const cats = useQuery({ queryKey: K.categories(org), queryFn: ({ signal }) => fetchCategories(org, signal), staleTime: 60_000, enabled: scope === 'category' });
  const tree = treeOf(cats.data ?? []);

  const save = async () => {
    setError(null);
    if (!wh) return setError('Choose the warehouse.');
    const n = Number(sample);
    if (kind === 'random' && (!Number.isInteger(n) || n < 1)) return setError('Say how many lines to sample, one or more.');
    if (scope === 'category' && !category) return setError('Choose the category to count.');
    setSaving(true);
    try {
      const r = await createCount(org, { warehouse_id: wh, kind, scope, ...(scope === 'category' ? { category_id: category } : {}), ...(kind === 'random' ? { sample: n } : {}) });
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      toast('success', 'Count sheet created — start it to freeze the expected quantities');
      onSaved(r.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      title="New stock count"
      width={480}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Create'}
          </button>
        </>
      }
    >
      <div role="form" aria-label="New stock count" className="flex flex-col gap-2.5">
        <Field label="Warehouse">
          <WarehousePick warehouses={warehouses} value={wh} onChange={setWh} label="Warehouse" />
        </Field>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Kind">
            <Select aria-label="Kind" value={kind} onValueChange={setKind} options={COUNT_KINDS.map((k) => ({ value: k.id, label: k.label }))} className={pick} />
          </Field>
          {kind === 'random' ? (
            <Field label="How many lines">
              <input className={input + ' text-right tabular-nums'} value={sample} onChange={(e) => setSample(e.target.value)} aria-label="How many lines" inputMode="numeric" />
            </Field>
          ) : null}
        </div>
        <Field label="Scope">
          <Select
            aria-label="Scope"
            value={scope}
            onValueChange={setScope}
            options={[
              { value: 'all', label: 'Everything in the warehouse' },
              { value: 'category', label: 'One category' },
            ]}
            className={pick}
          />
        </Field>
        {scope === 'category' ? (
          <Field label="Category">
            <Select
              aria-label="Category"
              searchable
              value={category ? String(category) : ''}
              placeholder="Choose a category"
              onValueChange={(v) => setCategory(v ? Number(v) : null)}
              options={tree.map((c) => ({ value: String(c.id), label: c.name, hint: `${c.total} products` }))}
              className={pick}
            />
          </Field>
        ) : null}
        {error ? (
          <span role="alert" className="rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] font-semibold text-danger">
            {error}
          </span>
        ) : null}
      </div>
    </Sheet>
  );
}
