import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Field, input, PageHead, Sheet } from '../hr/parts';
import { Pill } from './parts';
import { pick } from './pickers';
import { addAttributeValue, attributeValues, createAttribute, createUnit, deleteAttribute, deleteBrand, deleteUnit, fetchAttributes, fetchBrands, fetchUnits, KS, saveBrand, UNIT_KINDS, unitBody, type Brand, type UnitDraft } from './admin';

/**
 * Brands & units (InvLookups): the words products are described with —
 * their brands, the units they are counted in, and the attributes their
 * variants are made from. Each belongs to a company. Brands and attributes
 * are for those who keep the catalogue; units for those who set Inventory
 * up, because every quantity is read through them.
 */
export default function Lookups({ org, canCatalogue, canSettings }: { org: string; canCatalogue: boolean; canSettings: boolean }) {
  const qc = useQueryClient();
  const brands = useQuery({ queryKey: KS.brands(org), queryFn: ({ signal }) => fetchBrands(org, signal) });
  const units = useQuery({ queryKey: KS.units(org), queryFn: ({ signal }) => fetchUnits(org, signal) });
  const attrs = useQuery({ queryKey: KS.attributes(org), queryFn: ({ signal }) => fetchAttributes(org, signal) });
  const [brand, setBrand] = useState<Brand | 'new' | null>(null);
  const [unit, setUnit] = useState(false);
  const [attribute, setAttribute] = useState(false);
  const [adding, setAdding] = useState<{ id: number; value: string } | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['inventory'] });
  const act = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      toast('success', label);
      refresh();
      return true;
    } catch (e) {
      toast('error', errorMessage(e));
      return false;
    }
  };

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Brands & units" sub="The words products are described with, for the company picked in the rail" />
      <div className="grid grid-cols-3 gap-3.5">
        <Box title="Brands" action={canCatalogue ? () => setBrand('new') : null} actionLabel="New brand">
          {brands.isLoading ? (
            <Spinner />
          ) : brands.error ? (
            <ErrorNote error={brands.error} onRetry={() => void brands.refetch()} />
          ) : brands.data?.length ? (
            brands.data.map((b) => (
              <button
                key={b.id}
                type="button"
                data-brand={b.id}
                disabled={!canCatalogue}
                onClick={() => setBrand(b)}
                className="flex items-center gap-2 border-b border-line/60 px-3.5 py-2 text-left text-[12.5px] last:border-b-0 enabled:hover:bg-subtle/60"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="truncate text-ink">{b.name}</b>
                  {b.country || b.manufacturer ? <span className="truncate text-[11px] text-ink-3">{[b.manufacturer, b.country].filter(Boolean).join(' · ')}</span> : null}
                </span>
                {b.status !== 'active' ? <Pill tone="grey">archived</Pill> : null}
                <span className="text-[11.5px] text-ink-3 tabular-nums">{b.product_count.toLocaleString()}</span>
              </button>
            ))
          ) : (
            <Quiet>No brands yet.</Quiet>
          )}
        </Box>
        <Box title="Units" action={canSettings ? () => setUnit(true) : null} actionLabel="New unit" foot="A derived unit states its factor against a base unit directly. Chains are refused, because each hop compounds rounding.">
          {units.isLoading ? (
            <Spinner />
          ) : units.error ? (
            <ErrorNote error={units.error} onRetry={() => void units.refetch()} />
          ) : units.data?.length ? (
            units.data.map((u) => (
              <div key={u.id} data-unit={u.code} className="group flex items-center gap-2 border-b border-line/60 px-3.5 py-2 text-[12.5px] last:border-b-0">
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="truncate text-ink">
                    {u.name} <span className="font-mono text-[11.5px] font-medium text-ink-3">{u.code}</span>
                  </b>
                  <span className="truncate text-[11px] text-ink-3">{u.base_code ? `= ${u.factor.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${u.base_code}` : `base ${u.kind} unit`}</span>
                </span>
                {canSettings ? (
                  <button
                    type="button"
                    aria-label={`Remove ${u.code}`}
                    onClick={() => void act('Unit removed', () => deleteUnit(u.id))}
                    className="hidden h-6 w-6 items-center justify-center rounded-[6px] text-ink-3 group-hover:flex hover:bg-subtle hover:text-danger"
                  >
                    <Icon name="x" size={13} />
                  </button>
                ) : null}
              </div>
            ))
          ) : (
            <Quiet>No units yet.</Quiet>
          )}
        </Box>
        <Box title="Attributes" action={canCatalogue ? () => setAttribute(true) : null} actionLabel="New attribute" foot="A list or colour attribute can make variants — one product for each value.">
          {attrs.isLoading ? (
            <Spinner />
          ) : attrs.error ? (
            <ErrorNote error={attrs.error} onRetry={() => void attrs.refetch()} />
          ) : attrs.data?.length ? (
            attrs.data.map((a) => (
              <div key={a.id} data-attribute={a.name} className="group flex flex-col gap-1.5 border-b border-line/60 px-3.5 py-2 text-[12.5px] last:border-b-0">
                <span className="flex items-center gap-2">
                  <b className="min-w-0 flex-1 truncate text-ink">{a.name}</b>
                  {a.is_variantal ? <Pill tone="blue">makes variants</Pill> : <span className="text-[11px] text-ink-3">{a.kind}</span>}
                  {canCatalogue ? (
                    <button
                      type="button"
                      aria-label={`Remove ${a.name}`}
                      onClick={() => void act('Attribute removed', () => deleteAttribute(a.id))}
                      className="hidden h-6 w-6 items-center justify-center rounded-[6px] text-ink-3 group-hover:flex hover:bg-subtle hover:text-danger"
                    >
                      <Icon name="x" size={13} />
                    </button>
                  ) : null}
                </span>
                <span className="flex flex-wrap items-center gap-1">
                  {a.values.map((v) => (
                    <span key={v.id} className="flex items-center gap-1 rounded-[6px] bg-subtle px-1.5 py-0.5 text-[11px] text-ink-2">
                      {v.colour_hex ? <i className="h-2 w-2 rounded-full" style={{ background: v.colour_hex }} /> : null}
                      {v.value}
                    </span>
                  ))}
                  {canCatalogue ? (
                    adding?.id === a.id ? (
                      <input
                        autoFocus
                        className={input + ' !h-6 !w-[110px] !px-1.5 !text-[11.5px]'}
                        value={adding.value}
                        aria-label={`New value for ${a.name}`}
                        onChange={(e) => setAdding({ id: a.id, value: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setAdding(null);
                          if (e.key === 'Enter' && adding.value.trim()) void act('Value added', () => addAttributeValue(a.id, adding.value.trim())).then((ok) => ok && setAdding(null));
                        }}
                        onBlur={() => setAdding(null)}
                        placeholder="Value, then Enter"
                      />
                    ) : (
                      <button type="button" className="text-[11.5px] font-semibold text-primary hover:underline" onClick={() => setAdding({ id: a.id, value: '' })}>
                        + value
                      </button>
                    )
                  ) : null}
                </span>
              </div>
            ))
          ) : (
            <Quiet>No attributes yet.</Quiet>
          )}
        </Box>
      </div>
      {brand ? <BrandSheet org={org} brand={brand === 'new' ? null : brand} onClose={() => setBrand(null)} onDone={refresh} /> : null}
      {unit ? <UnitSheet org={org} units={units.data ?? []} onClose={() => setUnit(false)} onDone={refresh} /> : null}
      {attribute ? <AttributeSheet org={org} onClose={() => setAttribute(false)} onDone={refresh} /> : null}
    </div>
  );
}

function Box({ title, action, actionLabel, foot, children }: { title: string; action: (() => void) | null; actionLabel: string; foot?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
        <b className="flex-1 text-[13.5px] text-ink">{title}</b>
        {action ? (
          <button type="button" className={btnSmall} onClick={action}>
            {actionLabel}
          </button>
        ) : null}
      </div>
      <div className="flex max-h-[520px] flex-col overflow-y-auto scroll-thin">{children}</div>
      {foot ? <span className="border-t border-line px-3.5 py-2 text-[11.5px] leading-snug text-ink-3">{foot}</span> : null}
    </section>
  );
}

const Quiet = ({ children }: { children: ReactNode }) => <span className="px-3.5 py-3 text-[12.5px] text-ink-3">{children}</span>;

function Failure({ text }: { text: string | null }) {
  return text ? (
    <span role="alert" className="rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] font-semibold text-danger">
      {text}
    </span>
  ) : null;
}

function BrandSheet({ org, brand, onClose, onDone }: { org: string; brand: Brand | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: brand?.name ?? '', code: brand?.code ?? '', manufacturer: brand?.manufacturer ?? '', country: brand?.country ?? '', website: brand?.website ?? '', archived: brand?.status === 'archived' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, label: string) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
      toast('success', label);
      onDone();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const save = () => {
    if (!f.name.trim()) return setError('Give the brand a name.');
    void run(
      () =>
        saveBrand(org, brand?.id ?? null, {
          name: f.name.trim(),
          code: f.code.trim() || null,
          manufacturer: f.manufacturer.trim() || null,
          country: f.country.trim() || null,
          website: f.website.trim() || null,
          ...(brand ? { status: f.archived ? 'archived' : 'active' } : {}),
        }),
      brand ? 'Brand saved' : 'Brand added',
    );
  };
  return (
    <Sheet
      title={brand ? `Edit ${brand.name}` : 'New brand'}
      width={480}
      onClose={onClose}
      footer={
        <>
          {brand ? (
            <button type="button" className={btn + ' mr-auto !text-danger'} disabled={busy} onClick={() => void run(() => deleteBrand(brand.id), 'Brand removed')}>
              Delete
            </button>
          ) : null}
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy} onClick={save}>
            {brand ? 'Save' : 'Add'}
          </button>
        </>
      }
    >
      <div role="form" aria-label={brand ? 'Edit brand' : 'New brand'} className="flex flex-col gap-2.5">
        <div className="grid grid-cols-3 gap-2.5">
          <Field label="Name" className="col-span-2">
            <input className={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Name" maxLength={150} />
          </Field>
          <Field label="Code">
            <input className={input} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} aria-label="Code" maxLength={40} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Manufacturer">
            <input className={input} value={f.manufacturer} onChange={(e) => setF({ ...f, manufacturer: e.target.value })} aria-label="Manufacturer" />
          </Field>
          <Field label="Country">
            <input className={input} value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })} aria-label="Country" />
          </Field>
        </div>
        <Field label="Website">
          <input className={input} value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} aria-label="Website" />
        </Field>
        {brand ? (
          <label className="flex items-center gap-2 text-[13px] text-ink">
            <input type="checkbox" checked={f.archived} onChange={(e) => setF({ ...f, archived: e.target.checked })} /> Archived — kept on its products, not offered for new ones
          </label>
        ) : null}
        {brand?.product_count ? <span className="text-[12px] text-ink-3">{brand.product_count.toLocaleString()} products carry it, so it can be archived but not deleted.</span> : null}
        <Failure text={error} />
      </div>
    </Sheet>
  );
}

function UnitSheet({ org, units, onClose, onDone }: { org: string; units: Array<{ id: number; code: string; name: string; base_unit_id: number | null }>; onClose: () => void; onDone: () => void }) {
  const [d, setD] = useState<UnitDraft>({ name: '', code: '', kind: 'count', base: null, factor: '', decimals: '2' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = units.find((u) => u.id === d.base);
  const save = async () => {
    const { body, error: bad } = unitBody(d);
    if (bad) return setError(bad);
    setBusy(true);
    try {
      await createUnit(org, body);
      toast('success', 'Unit added');
      onDone();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="New unit"
      width={480}
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
      <div role="form" aria-label="New unit" className="flex flex-col gap-2.5">
        <div className="grid grid-cols-3 gap-2.5">
          <Field label="Name" className="col-span-2">
            <input className={input} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} aria-label="Unit name" maxLength={60} placeholder="Carton" />
          </Field>
          <Field label="Code">
            <input className={input} value={d.code} onChange={(e) => setD({ ...d, code: e.target.value })} aria-label="Unit code" maxLength={20} placeholder="ctn" />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          <Field label="Measures">
            <Select aria-label="Measures" value={d.kind} onValueChange={(v) => setD({ ...d, kind: v })} options={UNIT_KINDS} className={pick} />
          </Field>
          <Field label="Made of" hint="Blank for a base unit">
            <Select<string>
              aria-label="Made of"
              value={d.base ? String(d.base) : ''}
              onValueChange={(v) => setD({ ...d, base: v ? Number(v) : null })}
              options={[{ value: '', label: 'Nothing — a base unit' }, ...units.filter((u) => !u.base_unit_id).map((u) => ({ value: String(u.id), label: `${u.name} (${u.code})` }))]}
              className={pick}
            />
          </Field>
          <Field label="Decimals">
            <input className={input + ' text-right'} value={d.decimals} onChange={(e) => setD({ ...d, decimals: e.target.value })} aria-label="Decimals" inputMode="numeric" />
          </Field>
        </div>
        {base ? (
          <Field label={`One ${d.name.trim() || 'of these'} is how many ${base.code}?`}>
            <input className={input + ' text-right tabular-nums'} value={d.factor} onChange={(e) => setD({ ...d, factor: e.target.value })} aria-label="Factor" inputMode="decimal" placeholder="12" />
          </Field>
        ) : null}
        <Failure text={error} />
      </div>
    </Sheet>
  );
}

function AttributeSheet({ org, onClose, onDone }: { org: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: '', kind: 'list', variants: true, values: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const listLike = f.kind === 'list' || f.kind === 'colour';
  const save = async () => {
    if (!f.name.trim()) return setError('Give the attribute a name.');
    setBusy(true);
    try {
      await createAttribute(org, { name: f.name.trim(), kind: f.kind, is_variantal: listLike && f.variants ? 1 : 0, values: listLike ? attributeValues(f.values).map((value) => ({ value })) : [] });
      toast('success', 'Attribute added');
      onDone();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="New attribute"
      width={480}
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
      <div role="form" aria-label="New attribute" className="flex flex-col gap-2.5">
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Name">
            <input className={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Attribute name" maxLength={80} placeholder="Size" />
          </Field>
          <Field label="Kind">
            <Select
              aria-label="Kind"
              value={f.kind}
              onValueChange={(v) => setF({ ...f, kind: v })}
              options={[
                { value: 'list', label: 'A list of values' },
                { value: 'colour', label: 'Colours' },
                { value: 'text', label: 'Free text' },
                { value: 'number', label: 'A number' },
                { value: 'boolean', label: 'Yes or no' },
              ]}
              className={pick}
            />
          </Field>
        </div>
        {listLike ? (
          <>
            <Field label="Values" hint="One a line, or separated by commas">
              <textarea className={input + ' !h-[80px] py-1.5'} value={f.values} onChange={(e) => setF({ ...f, values: e.target.value })} aria-label="Values" placeholder={'Small\nMedium\nLarge'} />
            </Field>
            <label className="flex items-center gap-2 text-[13px] text-ink">
              <input type="checkbox" checked={f.variants} onChange={(e) => setF({ ...f, variants: e.target.checked })} /> Makes variants — one product for each value
            </label>
          </>
        ) : null}
        <Failure text={error} />
      </div>
    </Sheet>
  );
}
