import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { cx } from '../../components/ui';
import { btn, btnPrimary } from '../hr/parts';
import { costingLabel, fetchProduct, K, pictureSrc, trackingLabel, type Product } from './api';
import { printLabels } from './labels';
import { ProductContent } from './ProductDrawer';

/**
 * Products in tabs (the "Desktop products" design): beside the list, one tab per product opened from it, and the one
 * in front shown in full — its picture, code, tracking and costing, Print label, Open 360 and Edit, then the same
 * tabs as the drawer (overview, sales, purchase, history). The middle button or × closes a tab; ⌘/Ctrl+P prints the
 * label of the product in front. The tabs are on the address (tabs.ts), so they come back after a restart.
 */
export default function ProductPane({
  org,
  ids,
  active,
  ptab,
  onActivate,
  onClose,
  onTab,
  onOpenProduct,
  onEdit,
  on360,
}: {
  org: string;
  ids: number[];
  active: number;
  ptab: string;
  onActivate: (id: number) => void;
  onClose: (id: number) => void;
  onTab: (t: string) => void;
  onOpenProduct: (id: number) => void;
  onEdit: ((id: number) => void) | null;
  on360: (id: number) => void;
}) {
  return (
    <section
      aria-label="Open products"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-line bg-surface"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'p') {
          e.preventDefault();
          void labelFor(org, active);
        }
      }}
    >
      <div role="tablist" aria-label="Open products" className="flex shrink-0 items-end gap-0.5 overflow-x-auto border-b border-line bg-ground px-2 pt-1.5 scroll-thin">
        {ids.map((id) => (
          <TabButton key={id} id={id} org={org} on={id === active} onActivate={() => onActivate(id)} onClose={() => onClose(id)} />
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scroll-thin">
        <Head key={active} id={active} org={org} onEdit={onEdit ? () => onEdit(active) : null} on360={() => on360(active)} />
        <div className="flex flex-col gap-3.5 px-5 pb-5">
          <ProductContent key={active} id={active} org={org} tab={ptab} onTab={onTab} onOpenProduct={onOpenProduct} flush />
        </div>
      </div>
    </section>
  );
}

/** Prints a product's label: its name, its code, and a QR of its barcode (or code). */
export async function labelFor(org: string, id: number, p?: Pick<Product, 'name' | 'variant_label' | 'code' | 'barcode' | 'category'>): Promise<boolean> {
  const prod = p ?? (await fetchProduct(id, org)).product;
  const code = prod.barcode || prod.code || String(id);
  return printLabels([{ title: `${prod.name}${prod.variant_label ? ` — ${prod.variant_label}` : ''}`, code, note: prod.category, qr: code }], `Label ${prod.code ?? prod.name}`);
}

function TabButton({ id, org, on, onActivate, onClose }: { id: number; org: string; on: boolean; onActivate: () => void; onClose: () => void }) {
  const q = useQuery({ queryKey: K.product(id, org), queryFn: ({ signal }) => fetchProduct(id, org, signal), staleTime: 60_000 });
  const p = q.data?.product;
  const name = p ? `${p.name}${p.variant_label ? ` — ${p.variant_label}` : ''}` : q.error ? 'Not found' : '…';
  return (
    <span
      role="tab"
      aria-selected={on}
      tabIndex={on ? 0 : -1}
      title={name}
      onClick={onActivate}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          onClose();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate();
        }
        if (e.key === 'Delete') onClose();
      }}
      className={cx('group flex h-8 max-w-[200px] min-w-[120px] shrink-0 cursor-default items-center gap-1.5 rounded-t-[8px] px-3 text-[12.5px]', on ? 'bg-surface font-semibold text-ink' : 'text-ink-2 hover:bg-subtle')}
    >
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <button
        type="button"
        aria-label={`Close ${name}`}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className={cx('grid size-5 shrink-0 place-items-center rounded-[5px] text-ink-3 hover:bg-subtle hover:text-ink', !on && 'opacity-0 group-hover:opacity-100')}
      >
        <span aria-hidden className="text-[14px] leading-none">×</span>
      </button>
    </span>
  );
}

function Head({ id, org, onEdit, on360 }: { id: number; org: string; onEdit: (() => void) | null; on360: () => void }) {
  const q = useQuery({ queryKey: K.product(id, org), queryFn: ({ signal }) => fetchProduct(id, org, signal) });
  const [broken, setBroken] = useState(false);
  const p = q.data?.product;
  const pic = p?.image_url ?? p?.images?.[0]?.url ?? null;
  return (
    <div className="flex items-center gap-3.5 px-5 py-4">
      <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-[12px] border border-line bg-subtle">{pic && !broken ? <img src={pictureSrc(pic)} alt="" className="size-full object-cover" onError={() => setBroken(true)} /> : null}</span>
      <div className="flex min-w-0 flex-1 flex-col">
        <b className="truncate text-[18px] text-ink">{p ? `${p.name}${p.variant_label ? ` — ${p.variant_label}` : ''}` : ' '}</b>
        <span className="truncate text-[12.5px] text-ink-3">{p ? [p.code, p.is_stocked ? trackingLabel(p.tracking).toLowerCase() : 'not stocked', p.is_stocked ? costingLabel(p.costing_method) : null].filter(Boolean).join(' · ') : ''}</span>
      </div>
      <button type="button" className={btn} disabled={!p} title="Print label (⌘/Ctrl+P)" onClick={() => void labelFor(org, id, p)}>
        Print label
      </button>
      <button type="button" className={btn} onClick={on360}>
        Open 360
      </button>
      {onEdit ? (
        <button type="button" className={btnPrimary} onClick={onEdit}>
          Edit
        </button>
      ) : null}
    </div>
  );
}
