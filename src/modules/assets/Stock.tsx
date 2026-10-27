import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiGet } from '../../core/api';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { refusal, shortDate } from '../finance/api';
import { BASE, fetchWarehouses, moveStock, type Can, type StockItem } from './api';
import { Badge, Btn, Card, Field, PageHead, Pills, Table, amt, input, td, tdr, useReadOnly } from './parts';
import { clickOnKey } from '../../components/press';

/**
 * Consumables & accessories (D17): on hand against the reorder level (the server's counts and its "low"), the selected
 * item's movements, and Receive (⌘R) / Issue (⌘I) with a quantity. Stock levels are never worked out here.
 */
interface Movement {
  id: number;
  kind: string;
  qty: number;
  unit_cost: string;
  issued_to: string | null;
  note: string | null;
  actor: string | null;
  at: string;
}

export default function Stock({ can, active }: { org: number; can: Can; active: boolean }) {
  const ro = useReadOnly() || !can.manage;
  const qc = useQueryClient();
  const [kind, setKind] = useState('accessory');
  const [sel, setSel] = useState<number | null>(null);
  const [mode, setMode] = useState<'in' | 'out'>('out');
  const [qty, setQty] = useState('1');
  const [cost, setCost] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [warehouse, setWarehouse] = useState(0);
  const q = useQuery({ queryKey: ['assets', 'stock', kind], queryFn: ({ signal }) => apiGet<{ items: StockItem[] }>(`${BASE}/consumables`, { kind }, signal) });
  const items = q.data?.items ?? [];
  const cur = items.find((i) => i.id === sel) ?? items[0] ?? null;
  const inInventory = !!cur?.inventory_product_id;
  const warehouses = useQuery({ queryKey: ['assets', 'inventory-warehouses'], queryFn: ({ signal }) => fetchWarehouses(signal), staleTime: 300_000, enabled: inInventory });
  const moves = useQuery({ queryKey: ['assets', 'stock-moves', cur?.id], queryFn: ({ signal }) => apiGet<{ movements: Movement[]; stock: number }>(`${BASE}/consumables/${cur!.id}/movements`, undefined, signal), enabled: !!cur });

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        setMode('in');
      }
      else if (e.key.toLowerCase() === 'i') {
        e.preventDefault();
        setMode('out');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  const move = async () => {
    const n = Number(qty);
    if (!cur || !Number.isInteger(n) || n <= 0) return toast('error', 'Give a whole number.');
    if (inInventory && !warehouse) return toast('error', 'Choose the Inventory warehouse it moves at.');
    setBusy(true);
    try {
      await moveStock(cur.id, { kind: mode, qty: n, unit_cost: mode === 'in' && cost.trim() ? cost.trim() : undefined, issued_to: mode === 'out' && to.trim() ? to.trim() : undefined, warehouse_id: inInventory ? warehouse : undefined });
      toast('success', mode === 'in' ? 'Received.' : 'Issued.');
      setQty('1');
      setTo('');
      void qc.invalidateQueries({ queryKey: ['assets'] });
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-4">
      <div className="flex min-w-0 flex-[2_1_520px] flex-col gap-3">
        <PageHead title="Consumables & accessories" />
        <Pills label="Kind" value={kind} onChange={(k) => (setKind(k), setSel(null))} options={[{ id: 'accessory', label: 'Accessories' }, { id: 'consumable', label: 'Consumables' }]} />
        <Card>
          {q.isLoading ? <Spinner /> : q.error ? <div className="p-3"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div> : null}
          <Table head={['Item', 'Category', ['On hand', 'r'], ['Reorder', 'r'], '']}>
            {items.map((i) => (
              <tr tabIndex={0} onKeyDown={clickOnKey} key={i.id} onClick={() => setSel(i.id)} className={cx('cursor-default', i.id === cur?.id ? 'bg-selection dark:bg-selection' : 'hover:bg-subtle')}>
                <td className={td}><b>{i.name}</b> <span className="font-mono text-[11px] text-ink-3">{i.sku}</span></td>
                <td className={td}>{i.category ?? '—'}</td>
                <td className={tdr}>{`${i.stock} ${i.unit}`}</td>
                <td className={tdr}>{i.reorder_level}</td>
                <td className={td}>{i.low ? <Badge status="low">Low</Badge> : null}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
      {cur ? (
        <aside aria-label={cur.name} className="flex min-w-0 flex-[1_1_280px] flex-col gap-2.5 self-start rounded-[10px] border border-line bg-surface p-3.5">
          <h2 className="m-0 text-[14px] font-bold">{cur.name}</h2>
          <Pills label="Movement" value={mode} onChange={setMode} options={[{ id: 'out', label: 'Issue · ⌘I' }, { id: 'in', label: 'Receive · ⌘R' }]} />
          <Field label="Quantity"><input className={input} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
          {mode === 'in' ? <Field label="Unit cost"><input className={input} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></Field> : <Field label="Issued to"><input className={input} value={to} onChange={(e) => setTo(e.target.value)} /></Field>}
          {inInventory ? (
            <Field label="Inventory warehouse">
              {warehouses.data?.length ? (
                <select className={input} aria-label="Inventory warehouse" value={warehouse} onChange={(e) => setWarehouse(Number(e.target.value))}>
                  <option value={0}>Choose…</option>
                  {warehouses.data.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              ) : <input className={input} aria-label="Warehouse id" inputMode="numeric" placeholder="Warehouse id" value={warehouse || ''} onChange={(e) => setWarehouse(Number(e.target.value.replace(/\D/g, '')) || 0)} />}
            </Field>
          ) : null}
          {inInventory ? <p className="m-0 text-[11px] text-ink-3">Kept in Inventory: the stock moves in Inventory's ledger.</p> : null}
          <Btn primary disabled={ro || busy} onClick={() => void move()}>{mode === 'in' ? 'Receive' : 'Issue'}</Btn>
          <h3 className="m-0 mt-2 text-[12.5px] font-bold">Movements</h3>
          {(moves.data?.movements ?? []).slice(0, 20).map((m) => (
            <div key={m.id} className="flex gap-2 text-[12px]">
              <b className={cx('w-10 shrink-0 tabular-nums', m.kind === 'out' ? 'text-danger' : 'text-success')}>{`${m.kind === 'out' ? '−' : '+'}${m.qty}`}</b>
              <span className="min-w-0 flex-1 truncate">{[m.issued_to, m.kind === 'in' && Number(m.unit_cost) ? `${amt(m.unit_cost)} each` : null, m.note].filter(Boolean).join(' · ') || m.actor}</span>
              <span className="shrink-0 text-ink-3">{shortDate(m.at)}</span>
            </div>
          ))}
        </aside>
      ) : null}
    </div>
  );
}
