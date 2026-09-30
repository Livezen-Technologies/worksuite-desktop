import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner } from '../../components/ui';
import { btn, btnPrimary, Field, input, Sheet } from '../hr/parts';
import ProductPictures, { sendPictures } from './ProductPictures';
import { bodyOf, COSTING, createProduct, draftOf, fetchBrands, fetchCategories, fetchProduct, fetchUnits, K, KINDS, TRACKING, treeOf, updateProduct, type Company, type ProductDraft } from './api';

/**
 * A new product, or an edit of one (InvProductSheet). The code is generated
 * when left blank. Tracking and costing are fixed once stock is on hand
 * anywhere — the server refuses the change, so the form does not offer it.
 * The cost price is only here for someone who may see costs. Pictures are
 * sent as they change on an edit, and after the save on a new product.
 */
const STOCKABLE = new Set(['product', 'bundle', 'combo']);
const sel = 'h-[34px] w-full rounded-[8px] border border-line bg-surface px-2.5 text-[13px] font-medium text-ink';

export default function ProductSheet({
  id,
  org,
  companies,
  canCost,
  onClose,
  onSaved,
  onManageCategories,
}: {
  id: number | null;
  org: string;
  companies: Company[];
  canCost: boolean;
  onClose: () => void;
  onSaved: (id: number) => void;
  onManageCategories: () => void;
}) {
  const existing = useQuery({
    queryKey: K.product(id ?? 0, org),
    queryFn: ({ signal }) => fetchProduct(id!, org, signal),
    enabled: !!id,
  });
  if (id && existing.isLoading) {
    return (
      <Sheet title="Edit product" side width={600} onClose={onClose} footer={null}>
        <Spinner />
      </Sheet>
    );
  }
  if (id && existing.error) {
    return (
      <Sheet
        title="Edit product"
        side
        width={600}
        onClose={onClose}
        footer={
          <button type="button" className={btn} onClick={onClose}>
            Close
          </button>
        }
      >
        <ErrorNote error={existing.error} onRetry={() => void existing.refetch()} />
      </Sheet>
    );
  }
  return <Form id={id} org={org} companies={companies} canCost={canCost} initial={draftOf(existing.data?.product)} locked={!!existing.data?.stock_locked} onClose={onClose} onSaved={onSaved} onManageCategories={onManageCategories} />;
}

function Form({
  id,
  org,
  companies,
  canCost,
  initial,
  locked,
  onClose,
  onSaved,
  onManageCategories,
}: {
  id: number | null;
  org: string;
  companies: Company[];
  canCost: boolean;
  initial: ProductDraft;
  locked: boolean;
  onClose: () => void;
  onSaved: (id: number) => void;
  onManageCategories: () => void;
}) {
  const qc = useQueryClient();
  const [d, setD] = useState<ProductDraft>(initial);
  // A new product belongs to one company: the one being looked at, or —
  // looking at all of them — the one chosen here.
  const [company, setCompany] = useState(org || (companies.length === 1 ? String(companies[0]!.id) : ''));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<File[]>([]);
  const scope = id ? org : company;
  const cats = useQuery({
    queryKey: K.categories(scope),
    queryFn: ({ signal }) => fetchCategories(scope, signal),
    staleTime: 60_000,
  });
  const brands = useQuery({
    queryKey: K.brands(scope),
    queryFn: ({ signal }) => fetchBrands(scope, signal),
    staleTime: 300_000,
  });
  const units = useQuery({
    queryKey: K.units,
    queryFn: ({ signal }) => fetchUnits(signal),
    staleTime: 300_000,
  });
  const set = <F extends keyof ProductDraft>(k: F, v: ProductDraft[F]) => setD((x) => ({ ...x, [k]: v }));
  const pickCompany = !id && !org && companies.length > 1;
  const stockable = STOCKABLE.has(d.kind);

  const save = async () => {
    setError(null);
    if (pickCompany && !company) {
      setError('Choose the company this product belongs to.');
      return;
    }
    const { body, error: bad } = bodyOf(d, canCost);
    if (bad) {
      setError(bad);
      return;
    }
    if (id && locked) {
      delete body.tracking;
      delete body.costing_method;
    }
    setSaving(true);
    try {
      const r = id ? await updateProduct(id, body) : await createProduct(company, body);
      const saved = r.product?.id ?? id!;
      // A new product's pictures go once it has an id; one refused is said, and the product stays.
      const failed = !id && pending.length ? await sendPictures(saved, pending, () => undefined) : [];
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      toast('success', id ? 'Product saved' : failed.length ? 'Product added — edit it to add the pictures that were not kept' : 'Product added');
      onSaved(saved);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const tree = treeOf((cats.data ?? []).filter((c) => c.status === 'active' || c.id === d.category_id));
  const brandList = (brands.data ?? []).filter((b) => b.status === 'active' || b.id === d.brand_id);
  const unitList = (units.data ?? []).filter((u) => u.status === 'active' || u.id === d.unit_id);

  return (
    <Sheet
      title={id ? 'Edit product' : 'New product'}
      side
      width={600}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form
        aria-label={id ? 'Edit product' : 'New product'}
        className="flex flex-col gap-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {pickCompany ? (
          <Field label="Company">
            <Select
              aria-label="Company"
              value={company}
              onValueChange={setCompany}
              placeholder="Choose a company"
              options={companies.map((c) => ({
                value: String(c.id),
                label: c.name,
              }))}
              className={sel}
            />
          </Field>
        ) : null}
        <Field label="Name">
          <input className={input} value={d.name} onChange={(e) => set('name', e.target.value)} aria-label="Name" autoFocus={!id} maxLength={190} />
        </Field>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Code / SKU" hint={id ? undefined : 'Left blank, one is generated'}>
            <input className={input + ' font-mono'} value={d.code} onChange={(e) => set('code', e.target.value)} aria-label="Code" maxLength={60} />
          </Field>
          <Field label="Barcode">
            <input className={input + ' font-mono'} value={d.barcode} onChange={(e) => set('barcode', e.target.value)} aria-label="Barcode" maxLength={64} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Kind">
            <Select aria-label="Kind" value={d.kind} onValueChange={(v) => set('kind', v)} options={KINDS.map((k) => ({ value: k.id, label: k.label }))} className={sel} />
          </Field>
          <Field
            label={
              <span className="flex items-center">
                <span className="flex-1">Category</span>
                <button type="button" className="text-[11.5px] font-semibold text-primary hover:underline" onClick={onManageCategories}>
                  Manage
                </button>
              </span>
            }
          >
            <Select
              aria-label="Category"
              searchable
              value={d.category_id === null ? '' : String(d.category_id)}
              onValueChange={(v) => set('category_id', v ? Number(v) : null)}
              options={[
                { value: '', label: 'None' },
                ...tree.map((c) => ({
                  value: String(c.id),
                  label: c.name,
                  hint: c.level ? tree.find((p) => p.id === c.parent_id)?.name : undefined,
                })),
              ]}
              className={sel}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Brand">
            <Select
              aria-label="Brand"
              searchable
              value={d.brand_id === null ? '' : String(d.brand_id)}
              onValueChange={(v) => set('brand_id', v ? Number(v) : null)}
              options={[
                { value: '', label: 'None' },
                ...brandList.map((b) => ({
                  value: String(b.id),
                  label: b.name,
                })),
              ]}
              className={sel}
            />
          </Field>
          <Field label="Unit">
            <Select
              aria-label="Unit"
              searchable
              value={d.unit_id === null ? '' : String(d.unit_id)}
              onValueChange={(v) => set('unit_id', v ? Number(v) : null)}
              options={[
                { value: '', label: 'None' },
                ...unitList.map((u) => ({
                  value: String(u.id),
                  label: `${u.name} · ${u.code}`,
                })),
              ]}
              className={sel}
            />
          </Field>
        </div>
        {stockable ? (
          <>
            <label className="flex items-center gap-2 text-[12.5px] font-semibold text-ink">
              <input type="checkbox" checked={d.is_stocked} onChange={(e) => set('is_stocked', e.target.checked)} className="accent-primary" aria-label="Held in stock" />
              Held in stock — counted on shelves, moved in and out
            </label>
            {d.is_stocked ? (
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Tracking" hint={locked ? 'Stock is on hand, so this cannot change.' : undefined}>
                  <Select
                    aria-label="Tracking"
                    value={d.tracking}
                    disabled={locked}
                    onValueChange={(v) => set('tracking', v)}
                    options={TRACKING.map((t) => ({
                      value: t.id,
                      label: t.label,
                    }))}
                    className={sel}
                  />
                </Field>
                <Field label="Costing" hint={locked ? 'Stock is on hand, so this cannot change.' : 'No LIFO — it is not permitted under IFRS'}>
                  <Select
                    aria-label="Costing"
                    value={d.costing_method}
                    disabled={locked}
                    onValueChange={(v) => set('costing_method', v)}
                    options={COSTING.map((c) => ({
                      value: c.id,
                      label: c.label,
                    }))}
                    className={sel}
                  />
                </Field>
              </div>
            ) : null}
          </>
        ) : null}
        <div className={canCost ? 'grid grid-cols-3 gap-2.5' : 'grid grid-cols-2 gap-2.5'}>
          <Field label="Selling price">
            <input className={input + ' text-right tabular-nums'} inputMode="decimal" value={d.unit_price} onChange={(e) => set('unit_price', e.target.value)} aria-label="Selling price" />
          </Field>
          {canCost ? (
            <Field label="Cost price">
              <input className={input + ' text-right tabular-nums'} inputMode="decimal" value={d.cost_price} onChange={(e) => set('cost_price', e.target.value)} aria-label="Cost price" />
            </Field>
          ) : null}
          <Field label="Tax rate %">
            <input className={input + ' text-right tabular-nums'} inputMode="decimal" value={d.tax_rate} onChange={(e) => set('tax_rate', e.target.value)} aria-label="Tax rate" />
          </Field>
        </div>
        {stockable && d.is_stocked ? (
          <div className="grid grid-cols-3 gap-2.5">
            <Field label="Reorder point">
              <input className={input + ' text-right tabular-nums'} inputMode="decimal" value={d.reorder_point} onChange={(e) => set('reorder_point', e.target.value)} aria-label="Reorder point" />
            </Field>
            <Field label="Reorder quantity">
              <input className={input + ' text-right tabular-nums'} inputMode="decimal" value={d.reorder_qty} onChange={(e) => set('reorder_qty', e.target.value)} aria-label="Reorder quantity" />
            </Field>
            <Field label="Lead time (days)">
              <input className={input + ' text-right tabular-nums'} inputMode="numeric" value={d.lead_time_days} onChange={(e) => set('lead_time_days', e.target.value)} aria-label="Lead time" />
            </Field>
          </div>
        ) : null}
        {/* Not a Field: that is a <label>, and a click on it would press the first button inside. */}
        <div className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink">
          Pictures
          <ProductPictures productId={id} pending={pending} onPending={setPending} />
        </div>
        <Field label="Description">
          <textarea className={input + ' !h-[76px] py-2'} value={d.description} onChange={(e) => set('description', e.target.value)} aria-label="Description" />
        </Field>
        {error ? (
          <span role="alert" className="rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] font-semibold text-danger">
            {error}
          </span>
        ) : null}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
