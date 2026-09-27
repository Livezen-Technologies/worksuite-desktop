import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { Select } from '../../components/Select';
import { num, qty, type Warehouse } from './api';
import { fetchProductBatches, KC, lookupProducts, pickName, type Pickable } from './control';

/** The look of a picker inside a form. */
export const pick = 'h-[34px] w-full rounded-[8px] border border-line bg-surface px-2.5 text-[13px] font-medium text-ink';

/**
 * A stocked product for a document line, searched on the server as it is
 * typed (name, code or barcode). With a warehouse, each shows what is on
 * hand there.
 */
export function ProductPick({
  org,
  warehouse,
  value,
  onChange,
  label,
  className,
  noSerial,
}: {
  org: string;
  warehouse: number | null;
  value: Pickable | null;
  onChange: (p: Pickable | null) => void;
  label: string;
  className?: string;
  noSerial?: boolean;
}) {
  const [q, setQ] = useState('');
  const [needle, setNeedle] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setNeedle(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const res = useQuery({ queryKey: KC.lookup(org, needle, warehouse), queryFn: ({ signal }) => lookupProducts(org, needle, warehouse, signal), enabled: needle.length > 0, staleTime: 30_000 });
  const found = (res.data ?? []).filter((p) => !noSerial || p.tracking !== 'serial');
  const all = [...(value && !found.some((p) => p.id === value.id) ? [value] : []), ...found];
  return (
    <Select<string>
      aria-label={label}
      value={value ? String(value.id) : ''}
      placeholder="Choose a product…"
      options={all.map((p) => ({ value: String(p.id), label: pickName(p), hint: [p.code, warehouse ? `${qty(num(p.on_hand))} here` : null, p.tracking !== 'none' ? p.tracking : null].filter(Boolean).join(' · ') || undefined }))}
      onSearch={setQ}
      loading={res.isFetching && !found.length}
      empty={res.error ? errorMessage(res.error) : needle ? 'No stocked product matches.' : 'Type a name, code or barcode.'}
      onValueChange={(v) => onChange(all.find((p) => String(p.id) === v) ?? null)}
      className={className ?? pick}
    />
  );
}

/** A warehouse, those this reader may not act in shown but not choosable. */
export function WarehousePick({ warehouses, value, onChange, label, placeholder }: { warehouses: Warehouse[]; value: number | null; onChange: (id: number | null) => void; label: string; placeholder?: string }) {
  return (
    <Select<string>
      aria-label={label}
      value={value ? String(value) : ''}
      placeholder={placeholder ?? 'Choose a warehouse'}
      options={warehouses.map((w) => ({ value: String(w.id), label: w.can_act === false ? `${w.name} (you cannot act here)` : w.name, hint: w.code, disabled: w.can_act === false }))}
      onValueChange={(v) => onChange(v ? Number(v) : null)}
      className={pick}
    />
  );
}

/** One of a batch-tracked product's batches that still hold stock. */
export function BatchPick({ productId, value, onChange, label }: { productId: number; value: number | null; onChange: (id: number | null) => void; label: string }) {
  const res = useQuery({ queryKey: KC.productBatches(productId), queryFn: ({ signal }) => fetchProductBatches(productId, signal), staleTime: 30_000 });
  const list = res.data ?? [];
  return (
    <Select<string>
      aria-label={label}
      value={value ? String(value) : ''}
      placeholder={res.isLoading ? 'Loading batches…' : list.length ? 'Choose the batch' : 'No batch holds stock'}
      options={list.map((b) => ({ value: String(b.id), label: b.batch_no, hint: [`${qty(b.on_hand)} on hand`, b.expiry_date ? `expires ${b.expiry_date}` : null].filter(Boolean).join(' · ') }))}
      onValueChange={(v) => onChange(v ? Number(v) : null)}
      className={pick}
    />
  );
}
