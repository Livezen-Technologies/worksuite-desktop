import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, Field, input, PageHead, Sheet, SidePanel } from '../hr/parts';
import { cost, num, qty } from './api';
import { minWidth, Pill } from './parts';
import { pick } from './pickers';
import {
  archiveWarehouse,
  BIN_KINDS,
  createBin,
  fetchSettings,
  fetchWarehouse,
  fetchWarehousesAll,
  KS,
  saveSettings,
  saveWarehouse,
  settingChanges,
  WAREHOUSE_KINDS,
  warehouseBody,
  type InvSetting,
  type WarehouseDraft,
  type WarehouseRow,
} from './admin';
import { Checkbox } from '../../components/Checkbox';

/**
 * Settings (InvSettings): Inventory's own rules and document numbering, and
 * the warehouses and their locations. Who may do what, labels, screens,
 * notifications and the history are the installation's settings shell,
 * which opens in the browser (marked). The whole screen is for those who
 * hold `inventory.settings`.
 */
export type SetSection = 'rules' | 'warehouses';

const BROWSER = ['Labels', 'User access', 'Screens & components', 'Organization', 'Notifications', 'History'];
const kindLabel = (k: string) => WAREHOUSE_KINDS.find((x) => x.value === k)?.label ?? k;

export default function Setup({
  org,
  currency,
  canCost,
  section,
  onSection,
  warehouseId,
  onWarehouse,
}: {
  org: string;
  currency: string | null;
  canCost: boolean;
  section: SetSection;
  onSection: (s: SetSection) => void;
  warehouseId: number | null;
  onWarehouse: (id: number | null) => void;
}) {
  return (
    <div className="flex h-full min-h-0 gap-5 px-6 py-5">
      <nav aria-label="Settings sections" className="flex w-[200px] shrink-0 flex-col gap-0.5">
        {(
          [
            ['rules', 'Rules & numbering'],
            ['warehouses', 'Warehouses'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-current={section === id ? 'page' : undefined}
            onClick={() => onSection(id)}
            className={cx('h-[30px] rounded-[7px] px-2.5 text-left text-[12.5px]', section === id ? 'bg-info-bg font-bold text-info-ink dark:bg-selection dark:text-primary' : 'font-medium text-ink hover:bg-subtle')}
          >
            {label}
          </button>
        ))}
        <div className="mt-3 mb-0.5 px-2.5 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">In the browser</div>
        {BROWSER.map((label) => (
          <button
            key={label}
            type="button"
            title={`${label} — opens in your browser`}
            onClick={() => void call('app:openInBrowser', { path: '/inventory?view=admin' })}
            className="flex h-[30px] items-center gap-1.5 rounded-[7px] px-2.5 text-left text-[12.5px] font-medium text-ink hover:bg-subtle"
          >
            <span className="flex-1">{label}</span>
            <Icon name="external" size={12} className="text-ink-3" />
          </button>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col gap-3">{section === 'rules' ? <Rules /> : <Warehouses org={org} currency={currency} canCost={canCost} openId={warehouseId} onOpen={onWarehouse} />}</div>
    </div>
  );
}

function Rules() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KS.settings, queryFn: ({ signal }) => fetchSettings(signal) });
  const [draft, setDraft] = useState<Record<string, boolean | number | string>>({});
  const [busy, setBusy] = useState(false);
  const list = q.data?.settings ?? [];
  const changes = settingChanges(list, draft);
  const dirty = Object.keys(changes).length > 0;
  const val = (s: InvSetting) => (s.key in draft ? draft[s.key]! : s.value);
  const save = async () => {
    setBusy(true);
    try {
      await saveSettings(changes);
      toast('success', 'Settings saved');
      setDraft({});
      void qc.invalidateQueries({ queryKey: ['inventory'] });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const group = (title: string, items: InvSetting[], body: (s: InvSetting) => ReactNode) =>
    items.length ? (
      <section className="flex flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
        <b className="border-b border-line px-4 py-2.5 text-[13.5px] text-ink">{title}</b>
        {items.map((s) => (
          <div key={s.key} data-setting={s.key} className="border-b border-line/60 px-4 py-2.5 last:border-b-0">
            {body(s)}
          </div>
        ))}
      </section>
    ) : null;
  const editable = !!q.data?.editable;

  return (
    <>
      <PageHead title="Rules & numbering" sub="How stock may move, and how documents are numbered">
        {editable ? (
          <button type="button" className={btnPrimary} disabled={busy || !dirty} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        ) : null}
      </PageHead>
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto scroll-thin">
          {group(
            'Rules',
            list.filter((s) => s.type === 'bool'),
            (s) => (
              <label className="flex cursor-pointer items-start gap-2.5">
                <Checkbox className="mt-0.5" disabled={!editable} checked={!!val(s)} onChange={(e) => setDraft({ ...draft, [s.key]: e.target.checked })} aria-label={s.label} />
                <span className="flex flex-col gap-0.5">
                  <b className="text-[13px] text-ink">{s.label}</b>
                  {s.note ? <span className="text-[12px] leading-snug text-ink-3">{s.note}</span> : null}
                </span>
              </label>
            ),
          )}
          {group(
            'Numbers and prefixes',
            list.filter((s) => s.type !== 'bool'),
            (s) => (
              <div className="flex items-center gap-3">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <b className="text-[13px] text-ink">{s.label}</b>
                  {s.note ? <span className="text-[12px] leading-snug text-ink-3">{s.note}</span> : null}
                </span>
                <input
                  className={input + ' !w-[130px]' + (s.type === 'int' ? ' text-right tabular-nums' : ' font-mono')}
                  disabled={!editable}
                  value={String(val(s))}
                  onChange={(e) => setDraft({ ...draft, [s.key]: s.type === 'int' ? e.target.value.replace(/[^\d]/g, '') : e.target.value })}
                  aria-label={s.label}
                  maxLength={60}
                />
              </div>
            ),
          )}
          <span className="text-[12px] leading-relaxed text-ink-3">A prefix left blank keeps the one it has: a document number already issued can't be changed.</span>
        </div>
      )}
    </>
  );
}

function Warehouses({ org, currency, canCost, openId, onOpen }: { org: string; currency: string | null; canCost: boolean; openId: number | null; onOpen: (id: number | null) => void }) {
  const q = useQuery({ queryKey: KS.warehousesAll(org), queryFn: ({ signal }) => fetchWarehousesAll(org, signal) });
  const [making, setMaking] = useState(false);
  const rows = q.data ?? [];
  const W = { kind: 120, where: 150, products: 80, units: 90, value: 110, bins: 80 };
  return (
    <>
      <PageHead title="Warehouses" sub={q.isLoading ? '' : `${rows.filter((w) => w.status === 'active').length.toLocaleString()} active`}>
        <button type="button" className={btnPrimary} onClick={() => setMaking(true)}>
          <Icon name="plus" size={15} /> New warehouse
        </button>
      </PageHead>
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      ) : rows.length ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
          <div className="min-h-0 flex-1 overflow-auto scroll-thin">
            <div style={{ minWidth: minWidth(200, [W.kind, W.where, W.products, W.units, ...(canCost ? [W.value] : []), W.bins]) }}>
              <div className="sticky top-0 z-10 flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
                <span className="min-w-0 flex-1">Warehouse</span>
                <span style={{ width: W.kind }}>Kind</span>
                <span style={{ width: W.where }}>Where</span>
                <span className="text-right" style={{ width: W.products }}>
                  Products
                </span>
                <span className="text-right" style={{ width: W.units }}>
                  Units
                </span>
                {canCost ? (
                  <span className="text-right" style={{ width: W.value }}>
                    Value
                  </span>
                ) : null}
                <span className="text-right" style={{ width: W.bins }}>
                  Locations
                </span>
              </div>
              {rows.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  data-warehouse={w.code}
                  onClick={() => onOpen(w.id)}
                  className={cx(
                    'flex w-full items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-left text-[12.5px] last:border-b-0 hover:bg-subtle/60',
                    w.status !== 'active' && 'opacity-55',
                    openId === w.id && 'bg-info-soft dark:bg-selection/40',
                  )}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <b className="truncate text-ink">{w.name}</b>
                    <span className="font-mono text-[11px] text-ink-3">{w.code}</span>
                    {w.is_default ? <Pill tone="blue">default</Pill> : null}
                    {w.status !== 'active' ? <Pill tone="grey">archived</Pill> : null}
                  </span>
                  <span className="shrink-0 truncate text-ink-2" style={{ width: W.kind }}>
                    {kindLabel(w.kind)}
                  </span>
                  <span className="shrink-0 truncate text-ink-2" style={{ width: W.where }}>
                    {[w.city, w.country].filter(Boolean).join(', ') || '—'}
                  </span>
                  <span className="shrink-0 text-right text-ink-2 tabular-nums" style={{ width: W.products }}>
                    {w.product_count.toLocaleString()}
                  </span>
                  <span className="shrink-0 text-right text-ink tabular-nums" style={{ width: W.units }}>
                    {qty(num(w.units) ?? 0)}
                  </span>
                  {canCost ? (
                    <span className="shrink-0 text-right text-ink tabular-nums" style={{ width: W.value }}>
                      {cost(w.value, currency)}
                    </span>
                  ) : null}
                  <span className="shrink-0 text-right text-ink-2 tabular-nums" style={{ width: W.bins }}>
                    {w.bin_count.toLocaleString()}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <Empty text="No warehouses yet. Stock has to live somewhere before anything can be received." />
      )}
      {openId ? <WarehousePanel key={openId} id={openId} currency={currency} canCost={canCost} onClose={() => onOpen(null)} /> : null}
      {making ? <WarehouseSheet org={org} row={null} onClose={() => setMaking(false)} onSaved={(id) => (setMaking(false), onOpen(id))} /> : null}
    </>
  );
}

function WarehousePanel({ id, currency, canCost, onClose }: { id: number; currency: string | null; canCost: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KS.warehouse(id), queryFn: ({ signal }) => fetchWarehouse(id, signal) });
  const [sheet, setSheet] = useState<'edit' | 'bin' | 'archive' | null>(null);
  const [busy, setBusy] = useState(false);
  const w = q.data?.warehouse;
  const archive = async () => {
    setBusy(true);
    try {
      await archiveWarehouse(id);
      toast('success', 'Warehouse archived');
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      setSheet(null);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SidePanel
        label={w ? `Warehouse ${w.name}` : 'Warehouse'}
        width={560}
        onClose={onClose}
        head={
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-2">
              <b className="truncate text-[15px] text-ink">{w?.name ?? 'Warehouse'}</b>
              {w?.is_default ? <Pill tone="blue">default</Pill> : null}
              {w && w.status !== 'active' ? <Pill tone="grey">archived</Pill> : null}
            </span>
            {w ? <span className="truncate text-[12.5px] text-ink-3">{[w.code, kindLabel(w.kind), [w.street, w.city, w.country].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</span> : null}
          </span>
        }
      >
        {q.isLoading ? (
          <Spinner />
        ) : q.error ? (
          <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
        ) : w && q.data ? (
          <>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btnSmall} onClick={() => setSheet('edit')}>
                Edit
              </button>
              <button type="button" className={btnSmall} onClick={() => setSheet('bin')}>
                Add a location
              </button>
              {w.status === 'active' ? (
                <button type="button" className={btnSmall + ' ml-auto text-danger'} onClick={() => setSheet('archive')}>
                  Archive
                </button>
              ) : null}
            </div>
            <section className="flex flex-col gap-1">
              <b className="text-[13px] text-ink">Locations</b>
              {q.data.bins.length ? (
                q.data.bins.map((b) => (
                  <div key={b.id} data-bin={b.code} className="flex items-center gap-2 border-b border-line/60 py-1.5 text-[12.5px] last:border-b-0" style={{ paddingLeft: b.depth * 16 }}>
                    <span className="font-mono text-[11.5px] text-ink-2">{b.code}</span>
                    <span className="min-w-0 flex-1 truncate text-ink">{b.name ?? ''}</span>
                    <span className="text-[11px] text-ink-3">{b.kind}</span>
                    <span className="w-[70px] text-right text-ink-2 tabular-nums">{b.on_hand > 0 ? qty(b.on_hand) : ''}</span>
                  </div>
                ))
              ) : (
                <span className="text-[12.5px] text-ink-3">No locations. Stock is held against the warehouse as a whole.</span>
              )}
            </section>
            <section className="flex flex-col gap-1">
              <b className="text-[13px] text-ink">Most stock here</b>
              {q.data.top_stock.length ? (
                q.data.top_stock.map((s) => (
                  <div key={s.product_id} className="flex items-center gap-2 border-b border-line/60 py-1.5 text-[12.5px] last:border-b-0">
                    <span className="min-w-0 flex-1 truncate text-ink">
                      {s.code ? <span className="mr-1.5 font-mono text-[11px] text-ink-3">{s.code}</span> : null}
                      {s.name}
                    </span>
                    <span className="w-[90px] text-right text-ink tabular-nums">
                      {qty(num(s.on_hand) ?? 0)}
                      {s.unit ? ` ${s.unit}` : ''}
                    </span>
                    {canCost ? <span className="w-[90px] text-right text-ink-2 tabular-nums">{cost(s.average_cost, currency)}</span> : null}
                  </div>
                ))
              ) : (
                <span className="text-[12.5px] text-ink-3">Nothing on hand.</span>
              )}
            </section>
            <section className="flex flex-col gap-1">
              <b className="text-[13px] text-ink">Who can act here</b>
              {q.data.users.length ? (
                q.data.users.map((u) => (
                  <div key={u.user_id} className="flex items-center gap-2 text-[12.5px]">
                    <span className="flex-1 text-ink">{u.name}</span>
                    <span className="text-ink-3 capitalize">{u.role}</span>
                  </div>
                ))
              ) : (
                <span className="text-[12.5px] text-ink-3">Nobody is named, so anyone who may act in Inventory may act here. Naming the first person closes it to everybody else.</span>
              )}
            </section>
          </>
        ) : null}
      </SidePanel>
      {sheet === 'edit' && w ? <WarehouseSheet org="" row={w} onClose={() => setSheet(null)} onSaved={() => setSheet(null)} /> : null}
      {sheet === 'bin' && q.data ? <BinSheet warehouseId={id} bins={q.data.bins} onClose={() => setSheet(null)} /> : null}
      {sheet === 'archive' && w ? (
        <Sheet
          title={`Archive ${w.name}?`}
          width={440}
          onClose={() => setSheet(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setSheet(null)}>
                Keep it
              </button>
              <button type="button" className={btnPrimary} disabled={busy} onClick={() => void archive()}>
                Archive
              </button>
            </>
          }
        >
          <span className="text-[13px] text-ink-2">It stops being offered for new documents and keeps its history. A warehouse that still holds stock can't be archived — transfer the stock or write it off first.</span>
        </Sheet>
      ) : null}
    </>
  );
}

function WarehouseSheet({ org, row, onClose, onSaved }: { org: string; row: WarehouseRow | null; onClose: () => void; onSaved: (id: number) => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState<WarehouseDraft>({
    code: row?.code ?? '',
    name: row?.name ?? '',
    kind: row?.kind ?? 'warehouse',
    street: row?.street ?? '',
    city: row?.city ?? '',
    country: row?.country ?? '',
    phone: row?.phone ?? '',
    isDefault: row?.is_default ?? false,
    allowNegative: row?.allow_negative ?? false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const { body, error: bad } = warehouseBody(d);
    if (bad) return setError(bad);
    setBusy(true);
    try {
      const r = (await saveWarehouse(org, row?.id ?? null, body)) as { id?: number } | undefined;
      toast('success', row ? 'Warehouse saved' : 'Warehouse added');
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      onSaved(Number(row?.id ?? r?.id));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={row ? `Edit ${row.name}` : 'New warehouse'}
      width={520}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()}>
            {row ? 'Save' : 'Add'}
          </button>
        </>
      }
    >
      <div role="form" aria-label={row ? 'Edit warehouse' : 'New warehouse'} className="flex flex-col gap-2.5">
        <div className="grid grid-cols-3 gap-2.5">
          <Field label="Code">
            <input className={input + ' font-mono uppercase'} value={d.code} onChange={(e) => setD({ ...d, code: e.target.value })} aria-label="Code" maxLength={20} placeholder="MAIN" />
          </Field>
          <Field label="Name" className="col-span-2">
            <input className={input} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} aria-label="Name" maxLength={150} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Kind">
            <Select aria-label="Kind" value={d.kind} onValueChange={(v) => setD({ ...d, kind: v })} options={WAREHOUSE_KINDS} className={pick} />
          </Field>
          <Field label="Phone">
            <input className={input} value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} aria-label="Phone" />
          </Field>
        </div>
        <Field label="Street">
          <input className={input} value={d.street} onChange={(e) => setD({ ...d, street: e.target.value })} aria-label="Street" />
        </Field>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="City">
            <input className={input} value={d.city} onChange={(e) => setD({ ...d, city: e.target.value })} aria-label="City" />
          </Field>
          <Field label="Country">
            <input className={input} value={d.country} onChange={(e) => setD({ ...d, country: e.target.value })} aria-label="Country" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-[13px] text-ink">
          <Checkbox checked={d.isDefault} onChange={(e) => setD({ ...d, isDefault: e.target.checked })} /> The default warehouse for this company
        </label>
        <label className="flex items-start gap-2 text-[13px] text-ink">
          <Checkbox className="mt-0.5" checked={d.allowNegative} onChange={(e) => setD({ ...d, allowNegative: e.target.checked })} />
          <span>
            Stock may go below zero here
            <span className="block text-[12px] text-ink-3">Nearly always a receipt somebody forgot to post. Off is safer.</span>
          </span>
        </label>
        {error ? (
          <span role="alert" className="rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] font-semibold text-danger">
            {error}
          </span>
        ) : null}
      </div>
    </Sheet>
  );
}

function BinSheet({ warehouseId, bins, onClose }: { warehouseId: number; bins: Array<{ id: number; code: string; name: string | null; depth: number }>; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ code: '', name: '', kind: 'bin', parent: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.code.trim()) return setError('Give the location a code.');
    setBusy(true);
    try {
      await createBin(warehouseId, { code: f.code.trim(), name: f.name.trim() || null, kind: f.kind, parent_id: f.parent ? Number(f.parent) : null });
      toast('success', 'Location added');
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="New location"
      width={460}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()}>
            Add
          </button>
        </>
      }
    >
      <div role="form" aria-label="New location" className="flex flex-col gap-2.5">
        <div className="grid grid-cols-3 gap-2.5">
          <Field label="Code">
            <input className={input + ' font-mono uppercase'} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} aria-label="Location code" maxLength={40} placeholder="A-01" />
          </Field>
          <Field label="Name" className="col-span-2">
            <input className={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Location name" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Kind">
            <Select aria-label="Location kind" value={f.kind} onValueChange={(v) => setF({ ...f, kind: v })} options={BIN_KINDS} className={pick} />
          </Field>
          <Field label="Inside">
            <Select<string>
              aria-label="Inside"
              value={f.parent}
              onValueChange={(v) => setF({ ...f, parent: v })}
              options={[{ value: '', label: 'The warehouse itself' }, ...bins.map((b) => ({ value: String(b.id), label: `${'— '.repeat(b.depth)}${b.code}${b.name ? ` ${b.name}` : ''}` }))]}
              className={pick}
            />
          </Field>
        </div>
        {error ? (
          <span role="alert" className="rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] font-semibold text-danger">
            {error}
          </span>
        ) : null}
      </div>
    </Sheet>
  );
}
