import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from '../../core/toasts';
import { Spinner, cx } from '../../components/ui';
import { refusal } from '../finance/api';
import { fetchAsset, fetchLookups, saveAsset, type Company } from './api';
import { Btn, Card, Field, Note, PageHead, input, useReadOnly } from './parts';

/**
 * Add / edit an asset (D08). The company is asked every time for a new asset — "All companies" is a choice, never a
 * default — because an unanswered company is how assets came to belong to nobody (the server refuses it too). The
 * code is the server's (PREFIX-#### on save). ⌘S saves, Esc cancels.
 */
const FIELDS = ['name', 'category_id', 'serial_number', 'barcode', 'rustdesk_id', 'purchase_date', 'purchase_price', 'currency', 'branch', 'building', 'floor', 'room', 'depreciation_method', 'life_months', 'salvage_value', 'warranty_end', 'condition', 'notes', 'invoice_no', 'po_number'] as const;
type Form = Record<(typeof FIELDS)[number] | 'org_id', string>;

export default function AssetForm(props: { id: number | null; companies: Company[]; org: number; onDone: (id: number) => void; onCancel: () => void }) {
  const existing = useQuery({ queryKey: ['assets', 'one', props.id], queryFn: ({ signal }) => fetchAsset(props.id!, signal), enabled: !!props.id });
  if (props.id && existing.isPending) return <Spinner />;
  const a = existing.data?.asset as unknown as Record<string, unknown> | undefined;
  const initial = a
    ? (Object.fromEntries([...FIELDS, 'org_id'].map((k) => [k, a[k] == null ? '' : String(a[k])])) as Form)
    : ({ ...(Object.fromEntries([...FIELDS, 'org_id'].map((k) => [k, ''])) as Form), org_id: props.org ? String(props.org) : '', condition: 'good', depreciation_method: 'straight_line' } as Form);
  return <Editor {...props} code={existing.data?.asset.asset_code ?? null} initial={initial} />;
}

function Editor({ id, companies, code, initial, onDone, onCancel }: { id: number | null; companies: Company[]; code: string | null; initial: Form; onDone: (id: number) => void; onCancel: () => void }) {
  const ro = useReadOnly();
  const qc = useQueryClient();
  const cats = useQuery({ queryKey: ['assets', 'lookups', 'categories'], queryFn: ({ signal }) => fetchLookups('categories', signal), staleTime: 300_000 });
  const [f, setF] = useState<Form>(initial);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const save = async () => {
    if (busy || ro) return;
    if (!f.name.trim()) return toast('error', 'Give the asset a name.');
    if (!id && !f.org_id) return toast('error', 'Choose which company this asset belongs to, or "All companies" if it is shared.');
    setBusy(true);
    try {
      const body = Object.fromEntries(Object.entries(f).filter(([k, v]) => v !== '' || k === 'notes'));
      const r = await saveAsset(id, body);
      void qc.invalidateQueries({ queryKey: ['assets'] });
      toast('success', id ? 'Asset saved.' : `Asset ${r.asset_code ?? ''} added.`.replace('  ', ' '));
      onDone(id ?? Number(r.id));
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
      else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const txt = (k: keyof Form, label: string, type = 'text') => (
    <Field label={label}>
      <input className={input} type={type} value={f[k]} onChange={set(k)} />
    </Field>
  );

  return (
    <div className="flex max-w-[980px] flex-col gap-3">
      <PageHead title={id ? `Edit ${code ?? ''}` : 'New asset'} sub={id ? undefined : 'The code is given on save'}>
        <Btn onClick={onCancel}>Cancel · Esc</Btn>
        <Btn primary disabled={busy || ro} onClick={() => void save()}>Save · ⌘S</Btn>
      </PageHead>
      <Card title="The asset">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3 px-3.5 pb-3.5">
          <Field label="Company *">
            <select className={input} value={f.org_id} onChange={set('org_id')}>
              <option value="">Choose…</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
              <option value="all">All companies (shared)</option>
            </select>
          </Field>
          {txt('name', 'Name *')}
          <Field label="Category">
            <select className={input} value={f.category_id} onChange={set('category_id')}>
              <option value="">—</option>
              {(cats.data?.items ?? []).filter((c) => c.status !== 'archived').map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          {txt('serial_number', 'Serial')}
          {txt('barcode', 'Barcode / NFC')}
          {txt('rustdesk_id', 'RustDesk ID')}
          <Field label="Condition">
            <select className={input} value={f.condition} onChange={set('condition')}>
              {['new', 'good', 'fair', 'poor', 'damaged'].map((c) => (
                <option key={c} value={c}>{c[0]!.toUpperCase() + c.slice(1)}</option>
              ))}
            </select>
          </Field>
        </div>
      </Card>
      <Card title="Purchase, location and depreciation">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3 px-3.5 pb-3.5">
          {txt('purchase_date', 'Bought on', 'date')}
          {txt('purchase_price', 'Price')}
          {txt('currency', 'Currency')}
          {txt('invoice_no', 'Invoice')}
          {txt('po_number', 'Purchase order')}
          {txt('branch', 'Site')}
          {txt('building', 'Building')}
          {txt('floor', 'Floor')}
          {txt('room', 'Room')}
          <Field label="Method">
            <select className={input} value={f.depreciation_method} onChange={set('depreciation_method')}>
              <option value="straight_line">Straight line</option>
              <option value="declining_balance">Declining balance</option>
              <option value="units">Units of production</option>
              <option value="none">None</option>
            </select>
          </Field>
          {txt('life_months', 'Life (months)', 'number')}
          {txt('salvage_value', 'Salvage value')}
          {txt('warranty_end', 'Warranty ends', 'date')}
        </div>
      </Card>
      <Field label="Notes">
        <textarea className={cx(input, 'h-20 py-1.5')} value={f.notes} onChange={set('notes')} />
      </Field>
      <Note>The monthly charge, the book value and the account are worked out by the server when you save; the asset's Depreciation tab shows them.</Note>
    </div>
  );
}
