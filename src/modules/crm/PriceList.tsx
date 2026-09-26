import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { app } from '../../core/app-state';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Field, input, PageHead, Sheet } from '../hr/parts';
import type { Product } from './api';
import { crmCan, moneyFull } from './parts';

/**
 * Price list (CrmPriceList): the catalogue quotes pick from — the products
 * table Inventory shares. Adding, changing and retiring need CRM settings.
 * Retiring takes an item out of the picker; quotes that used it keep their
 * lines exactly as written, because a line copies its description, price
 * and tax when it is added.
 */
const KINDS: Array<[string, string]> = [
  ['product', 'Product'],
  ['service', 'Service'],
  ['subscription', 'Subscription'],
  ['bundle', 'Bundle'],
];

export default function PriceList() {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const canEdit = crmCan(perms, 'crm.settings');
  const [q, setQ] = useState('');
  const [retired, setRetired] = useState(false);
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [retiring, setRetiring] = useState<Product | null>(null);
  const params = { q: q.trim() || undefined, include_inactive: retired ? 1 : undefined, per_page: 100 };
  const list = useQuery({ queryKey: ['crm', 'products', params], queryFn: ({ signal }) => apiGet<{ products: Product[]; total: number }>('/api/crm/products', params, signal) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['crm', 'products'] });
  const rows = list.data?.products ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PageHead title="Price list" sub="The catalogue quotes pick from">
        {canEdit ? (
          <button type="button" className={btnPrimary} onClick={() => setEditing('new')}>
            New product
          </button>
        ) : null}
      </PageHead>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-[34px] w-[280px] items-center gap-2 rounded-[8px] border border-line bg-surface px-2.5 focus-within:border-primary">
          <Icon name="search" size={14} className="text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the price list" aria-label="Search the price list" className="bare-focus min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3" />
        </label>
        <label className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-2">
          <input type="checkbox" checked={retired} onChange={(e) => setRetired(e.target.checked)} className="accent-primary" />
          Show retired
        </label>
      </div>
      <div className="flex min-h-0 flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
        <div className="flex shrink-0 items-center gap-2.5 border-b border-line bg-[#F7F8FB] px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase dark:bg-well">
          <span className="w-[110px] shrink-0">Code</span>
          <span className="min-w-0 flex-1">Name</span>
          <span className="w-[110px] shrink-0">Kind</span>
          <span className="w-[140px] shrink-0 text-right">Price</span>
          <span className="w-[70px] shrink-0 text-right">Tax %</span>
          <span className="w-[150px] shrink-0" />
        </div>
        <div className="min-h-0 overflow-y-auto scroll-thin">
          {list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
          {rows.map((p) => (
            <div key={p.id} data-product={p.id} className={cx('flex items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-[12.5px]', !p.active && 'opacity-60')}>
              <span className="w-[110px] shrink-0 truncate font-mono text-[12px] text-ink-2">{p.code ?? '—'}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="truncate text-ink">
                  {p.name}
                  {!p.active ? <span className="ml-1.5 rounded-full bg-subtle px-1.5 text-[10.5px] font-bold text-ink-2">Retired</span> : null}
                </b>
                {p.description ? <span className="truncate text-[11.5px] text-ink-3">{p.description}</span> : null}
              </span>
              <span className="w-[110px] shrink-0 text-ink-2 capitalize">{p.kind}</span>
              <b className="w-[140px] shrink-0 text-right text-ink tabular-nums">
                {moneyFull(p.unit_price, p.currency)}
                {p.unit ? <span className="font-normal text-ink-3"> / {p.unit}</span> : null}
              </b>
              <span className="w-[70px] shrink-0 text-right text-ink-2 tabular-nums">{p.tax_rate || '—'}</span>
              <span className="flex w-[150px] shrink-0 justify-end gap-1.5">
                {canEdit ? (
                  <>
                    <button type="button" className={btnSmall} onClick={() => setEditing(p)}>
                      Edit
                    </button>
                    {p.active ? (
                      <button type="button" className={btnSmall} onClick={() => setRetiring(p)}>
                        Retire
                      </button>
                    ) : (
                      <button type="button" className={btnSmall} onClick={() => void apiPut(`/api/crm/products/${p.id}`, { active: 1 }).then(() => (toast('success', `${p.name} is back in the picker.`), refresh())).catch((e) => toast('error', errorMessage(e)))}>
                        Bring back
                      </button>
                    )}
                  </>
                ) : null}
              </span>
            </div>
          ))}
          {list.data && !rows.length ? <p className="m-0 px-3.5 py-8 text-center text-[12.5px] text-ink-3">Nothing in the price list{q ? ' matches' : ' yet'}.</p> : null}
        </div>
      </div>
      {editing ? <ProductEditor product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), refresh())} /> : null}
      {retiring ? (
        <Sheet
          title={`Retire ${retiring.name}?`}
          width={420}
          onClose={() => setRetiring(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setRetiring(null)}>
                Cancel
              </button>
              <button type="button" className={btnPrimary} onClick={() => void apiDelete(`/api/crm/products/${retiring.id}`).then(() => (toast('success', 'Retired.'), setRetiring(null), refresh())).catch((e) => toast('error', errorMessage(e)))}>
                Retire
              </button>
            </>
          }
        >
          <p className="m-0 text-[13px] text-ink-2">It comes out of the picker. Quotes that already use it keep their lines exactly as written.</p>
        </Sheet>
      ) : null}
    </div>
  );
}

function ProductEditor({ product, onClose, onSaved }: { product: Product | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    code: product?.code ?? '',
    kind: product?.kind ?? 'product',
    name: product?.name ?? '',
    unit_price: product?.unit_price ?? 0,
    tax_rate: product?.tax_rate ?? 0,
    unit: product?.unit ?? '',
    description: product?.description ?? '',
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.name.trim() || busy) return;
    setBusy(true);
    try {
      const body = { ...f, code: f.code.trim() || null, unit: f.unit.trim() || null, name: f.name.trim() };
      if (product) await apiPut(`/api/crm/products/${product.id}`, body);
      else await apiPost('/api/crm/products', body);
      toast('success', product ? 'Saved.' : 'Added to the price list.');
      onSaved();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={product ? `Edit ${product.name}` : 'New product'}
      width={480}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={!f.name.trim() || busy} onClick={() => void save()}>
            {product ? 'Save' : 'Add'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Code" hint="Unique — two items cannot share one">
          <input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} aria-label="Code" className={input} />
        </Field>
        <Field label="Kind">
          <Select<string> label="Kind" value={f.kind} onValueChange={(v) => setF({ ...f, kind: v as Product['kind'] })} options={KINDS.map(([v, l]) => ({ value: v, label: l }))} />
        </Field>
        <Field label="Name" className="col-span-2">
          <input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Name" className={input} />
        </Field>
        <Field label="Unit price">
          <input type="number" min={0} step="any" value={f.unit_price} onChange={(e) => setF({ ...f, unit_price: Math.max(0, Number(e.target.value) || 0) })} aria-label="Unit price" className={input} />
        </Field>
        <Field label="Tax %">
          <input type="number" min={0} max={100} step="any" value={f.tax_rate} onChange={(e) => setF({ ...f, tax_rate: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })} aria-label="Tax rate" className={input} />
        </Field>
        <Field label="Unit" hint="seat, hour, month…">
          <input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} aria-label="Unit" className={input} />
        </Field>
        <Field label="Description" className="col-span-2">
          <textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={3} aria-label="Description" className={cx(input, 'h-auto py-2')} />
        </Field>
      </div>
    </Sheet>
  );
}
