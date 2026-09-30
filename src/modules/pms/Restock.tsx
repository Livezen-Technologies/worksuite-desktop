import { useState } from 'react';
import { Select } from '../../components/Select';
import { Button, Modal } from '../../components/ui';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { input } from '../garage/parts';
import type { Pickable } from '../inventory/control';
import { ProductPick } from '../inventory/pickers';
import { errorText, newKey, pPost } from './api';
import { Refusal, usePms } from './parts';

/** What went into a room, by kind (the server's `Restocks::KINDS`). */
export const RESTOCK_KINDS: Array<{ value: string; label: string }> = [
  { value: 'minibar', label: 'Mini bar' },
  { value: 'amenity', label: 'Amenities' },
  { value: 'linen', label: 'Linen' },
  { value: 'supply', label: 'Guest supplies' },
];

interface Line {
  product: Pickable | null;
  quantity: string;
  kind: string;
  chargeable: boolean;
}

const blank = (): Line => ({ product: null, quantity: '1', kind: 'amenity', chargeable: false });

/** Whether this person has Inventory, whose products a restock names. */
export function useHasInventory(): boolean {
  return useStore(app, (s) => s.apps.some((a) => a.id === 'inventory'));
}

/**
 * Recording what went into a room (§11.5, PMS-HK-012): "Room 305: 2 water,
 * 1 shampoo, 1 soap" — on a housekeeping task (`POST housekeeping-tasks/{id}/
 * restocks`) or the room alone (`POST rooms/{id}/restocks`). Each item is an
 * Inventory product, found as it is typed (Inventory's own lookup); the
 * server takes it from the housekeeping store when the property names one,
 * and a chargeable item (the mini bar) waits there for the guest's folio. One
 * idempotent press: every item or none.
 */
export function RestockDialog({ path, room, onClose, onDone }: { path: string; room: string; onClose: () => void; onDone: () => void }) {
  const pms = usePms();
  const hasInventory = useHasInventory();
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(() => newKey('restock'));
  const org = String(pms.property.org_id);
  const ready = lines.length > 0 && lines.every((l) => l.product && Number(l.quantity) > 0);
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await pPost(path, { items: lines.map((l) => ({ product_id: l.product!.id, quantity: Number(l.quantity), kind: l.kind, chargeable: l.chargeable })) }, key);
      toast('success', r.message);
      onDone();
    } catch (e) {
      setError(errorText(e, 'Nothing was recorded.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`What went into room ${room}`}
      onClose={onClose}
      width={640}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!ready || !pms.online || !hasInventory} onClick={() => void save()}>
            Record
          </Button>
        </div>
      }
    >
      {!hasInventory ? (
        <Refusal text="Choosing what went into the room needs Inventory, which you cannot open." />
      ) : (
        <div className="flex flex-col gap-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_72px_130px_auto_auto] items-center gap-2">
              <ProductPick org={org} warehouse={null} value={l.product} onChange={(p) => set(i, { product: p })} label={`Item ${i + 1}`} />
              <input aria-label={`Quantity ${i + 1}`} inputMode="decimal" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} className={input} />
              <Select aria-label={`Kind ${i + 1}`} value={l.kind} options={RESTOCK_KINDS} onChange={(e) => set(i, { kind: e.target.value, chargeable: e.target.value === 'minibar' ? true : l.chargeable })} className={input} />
              <label className="flex items-center gap-1 text-[12px] text-ink-2" title="Charged to the guest's folio at the product's price">
                <input type="checkbox" checked={l.chargeable} onChange={(e) => set(i, { chargeable: e.target.checked })} /> Charge
              </label>
              <Button size="sm" variant="ghost" icon="trash" aria-label={`Remove item ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))} />
            </div>
          ))}
          <div>
            <Button size="sm" icon="plus" disabled={lines.length >= 30} onClick={() => setLines((ls) => [...ls, blank()])}>
              Another item
            </Button>
          </div>
          <p className="m-0 text-[12px] text-ink-3">Taken from the housekeeping store when the property names one; a charged item goes to the guest in the room.</p>
        </div>
      )}
      {error ? <div className="mt-2"><Refusal text={error} /></div> : null}
    </Modal>
  );
}
