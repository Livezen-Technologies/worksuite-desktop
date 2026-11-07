import { useState } from 'react';
import { money } from '@shared/service';
import { useStockSearch, type StockPart } from './api';
import { input } from './parts';

/** Finds a stocked part in Inventory by name, SKU or barcode; shows what is free to reserve. */
export default function StockPicker({ onPick, disabled, placeholder = 'Find a part: name, SKU or barcode' }: { onPick: (p: StockPart) => void; disabled?: boolean; placeholder?: string }) {
  const [q, setQ] = useState('');
  const found = useStockSearch(q);
  const items = found.data?.data.items ?? [];
  return (
    <div className="relative w-full">
      <input aria-label="Find a part" placeholder={placeholder} disabled={disabled} value={q} onChange={(e) => setQ(e.target.value)} className={input} />
      {q.trim().length >= 2 ? (
        <ul role="listbox" aria-label="Parts" className="absolute z-10 mt-1 max-h-[240px] w-full overflow-y-auto rounded-[8px] border border-line bg-surface text-[12.5px] shadow-lg scroll-thin">
          {found.isPending ? <li className="p-2 text-ink-3">Searching…</li> : found.isError ? <li className="p-2 text-danger">{(found.error as Error).message}</li> : null}
          {items.map((p) => {
            const free = p.available ?? p.on_hand ?? null;
            return (
              <li key={p.product_id} role="option" aria-selected={false}>
                <button type="button" onClick={() => { onPick(p); setQ(''); }} className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-subtle">
                  <span className="min-w-0 flex-1 truncate"><b>{p.name}</b>{p.sku ? <span className="text-ink-3"> · {p.sku}</span> : null}</span>
                  <span className={free != null && free <= 0 ? 'text-danger' : 'text-ink-2'}>{free == null ? '' : free <= 0 ? 'Out of stock' : `${free} free`}</span>
                  <span className="w-[110px] text-right">{money(p.unit_price, p.currency ?? 'LKR')}</span>
                </button>
              </li>
            );
          })}
          {found.isSuccess && !items.length ? <li className="p-2 text-ink-3">No stocked part matches.</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
