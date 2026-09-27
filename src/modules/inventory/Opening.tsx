import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { btn, btnPrimary, Field, input, Sheet } from '../hr/parts';
import { type Warehouse } from './api';
import { openingBody, recordOpening, type Pickable } from './control';
import { ProductPick, WarehousePick } from './pickers';

/**
 * Opening stock (InvControlSheet): what was on the shelf on the day this
 * system was switched on. Once per product per warehouse — after that a
 * change to a balance is an adjustment, which has to say why. A product that
 * already has movements in the warehouse is skipped, and named.
 */
interface OLine {
  key: number;
  product: Pickable | null;
  qty: string;
  cost: string;
  batch: string;
  expiry: string;
  serials: string;
}
const blank = (key: number): OLine => ({ key, product: null, qty: '', cost: '', batch: '', expiry: '', serials: '' });

export default function Opening({ org, warehouses, defaultWarehouse, canCost, onClose }: { org: string; warehouses: Warehouse[]; defaultWarehouse?: number | null; canCost: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [wh, setWh] = useState<number | null>(defaultWarehouse ?? null);
  const [asAt, setAsAt] = useState(todayInZone());
  const [lines, setLines] = useState<OLine[]>([blank(0), blank(1), blank(2)]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (key: number, patch: Partial<OLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const record = async () => {
    setError(null);
    const { body, error: bad } = openingBody({ warehouse: wh, asAt }, lines);
    if (bad) return setError(bad);
    setSaving(true);
    try {
      const r = await recordOpening(org, body);
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      const skipped = r.skipped ?? [];
      toast(skipped.length ? 'warning' : 'success', `${r.recorded} opening ${r.recorded === 1 ? 'balance' : 'balances'} recorded${skipped.length ? `. Skipped — already moving in this warehouse: ${skipped.join(', ')}` : ''}`);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      title="Opening stock"
      width={720}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Close
          </button>
          <button type="button" className={btnPrimary} disabled={saving} onClick={() => void record()}>
            {saving ? 'Recording…' : 'Record'}
          </button>
        </>
      }
    >
      <div role="form" aria-label="Opening stock" className="flex flex-col gap-2.5">
        <span className="text-[12.5px] text-ink-2">What was on the shelf on the day this system was switched on. It can be recorded once per product per warehouse — after that, a change to a balance is an adjustment, which has to say why.</span>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Warehouse">
            <WarehousePick warehouses={warehouses} value={wh} onChange={setWh} label="Warehouse" />
          </Field>
          <Field label="As at">
            <input type="date" className={input} value={asAt} max={todayInZone()} onChange={(e) => setAsAt(e.target.value)} aria-label="As at" />
          </Field>
        </div>
        <div className="flex flex-col gap-2">
          {lines.map((l, i) => (
            <div key={l.key} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  <ProductPick org={org} warehouse={wh} value={l.product} onChange={(p) => set(l.key, { product: p, batch: '', serials: '' })} label={`Line ${i + 1} product`} />
                </span>
                <input className={input + ' !w-[86px] text-right tabular-nums'} value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} placeholder="Qty" aria-label={`Line ${i + 1} quantity`} />
                {canCost ? <input className={input + ' !w-[110px] text-right tabular-nums'} value={l.cost} onChange={(e) => set(l.key, { cost: e.target.value })} placeholder="Unit cost" aria-label={`Line ${i + 1} unit cost`} /> : null}
                <button
                  type="button"
                  aria-label={`Remove line ${i + 1}`}
                  onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [blank(l.key + 1)]))}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-ink"
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
              {l.product?.tracking === 'batch' ? (
                <div className="flex items-center gap-2 pl-1 text-[12px] text-ink-3">
                  Batch
                  <input className={input + ' !h-[30px] !w-[160px]'} value={l.batch} onChange={(e) => set(l.key, { batch: e.target.value })} aria-label={`Line ${i + 1} batch`} />
                  Expires
                  <input type="date" className={input + ' !h-[30px] !w-[150px]'} value={l.expiry} onChange={(e) => set(l.key, { expiry: e.target.value })} aria-label={`Line ${i + 1} expiry`} />
                </div>
              ) : null}
              {l.product?.tracking === 'serial' ? (
                <label className="flex flex-col gap-1 pl-1 text-[12px] text-ink-3">
                  Serial numbers, one per unit
                  <textarea className={input + ' !h-[56px] py-1.5 font-mono'} value={l.serials} onChange={(e) => set(l.key, { serials: e.target.value })} aria-label={`Line ${i + 1} serials`} />
                </label>
              ) : null}
            </div>
          ))}
          <button type="button" className="self-start text-[12.5px] font-semibold text-primary hover:underline" onClick={() => setLines((ls) => [...ls, blank(Math.max(...ls.map((x) => x.key)) + 1)])}>
            + Add a line
          </button>
        </div>
        {!canCost ? <span className="text-[12px] text-ink-3">Each line is valued at the product's cost price.</span> : null}
        {error ? (
          <span role="alert" className="rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] font-semibold text-danger">
            {error}
          </span>
        ) : null}
      </div>
    </Sheet>
  );
}
