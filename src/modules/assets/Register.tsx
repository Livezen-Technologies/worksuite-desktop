import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { useWedge } from '../../core/scanner';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { shortDate } from '../finance/api';
import { fetchAsset, fetchAssets, resolveCode, toCsv, type Asset, type Can } from './api';
import { printLabels } from './labels';
import { Badge, Btn, Card, Kbd, PageHead, Pills, Table, amt, td, useReadOnly } from './parts';
import type { AssetView } from './Rail';

/**
 * The register (D01): a filter box that also takes a scan from the USB scanner (an exact code, barcode or serial
 * opens the asset), the list with the selected asset beside it, ↑↓ to move, ↵ to open, ⌘↵ or a double-click for a
 * new tab, and Export to a CSV file chosen in the save dialog.
 */
const STATUSES = ['', 'available', 'assigned', 'maintenance', 'repair', 'reserved', 'missing'] as const;

export async function exportRegister(q: Record<string, string | number | undefined>): Promise<string | null> {
  const rows: Asset[] = [];
  for (let page = 1; page <= 50; page++) {
    const r = await fetchAssets({ ...q, page, per_page: 100 });
    rows.push(...r.assets);
    if (rows.length >= r.total || !r.assets.length) break;
  }
  const csv = toCsv(
    ['Code', 'Name', 'Category', 'Brand', 'Model', 'Serial', 'Barcode', 'Status', 'Condition', 'Company', 'Location', 'Purchased', 'Price', 'Currency', 'Book value', 'Warranty ends'],
    rows.map((a) => [a.asset_code, a.name, a.category, a.brand, a.model, a.serial_number, a.barcode, a.status, a.condition, a.company, a.location, a.purchase_date, a.purchase_price, a.currency, a.net_book_value, a.warranty_end]),
  );
  return call('files:saveText', { name: `assets-${new Date().toISOString().slice(0, 10)}.csv`, text: csv });
}

export default function Register({ org, can, active, status: initial, onOpen, onNew, onGo }: {
  org: number;
  can: Can;
  active: boolean;
  status: string;
  onOpen: (id: number, how?: 'here' | 'tab', sub?: string) => void;
  onNew: () => void;
  onGo: (v: AssetView, extra?: string) => void;
}) {
  const ro = useReadOnly();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(initial);
  const [page, setPage] = useState(1);
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const params = { q: q.trim() || undefined, status: status || undefined, org: org || undefined, page, per_page: 50 };
  const list = useQuery({ queryKey: ['assets', 'list', params], queryFn: ({ signal }) => fetchAssets(params, signal), placeholderData: keepPreviousData });
  const items = list.data?.assets ?? [];
  const sel = items[Math.min(at, Math.max(0, items.length - 1))];
  const detail = useQuery({ queryKey: ['assets', 'one', sel?.id], queryFn: ({ signal }) => fetchAsset(sel!.id, signal), enabled: !!sel, staleTime: 30_000 });
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / Math.max(1, list.data.per_page))) : 1;

  const scan = async (code: string) => {
    try {
      const r = await resolveCode(code);
      if (r.kind === 'asset') onOpen(r.asset.id);
      else {
        setQ(code);
        toast('info', `No asset has the code ${code}.`);
      }
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  useWedge((code) => void scan(code), active);
  useEffect(() => {
    if (active) body.current?.focus({ preventScroll: true });
  }, [active]);

  const onKey = (e: KeyboardEvent) => {
    if (!items.length) return;
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAt((i) => Math.min(items.length - 1, i + 1));
      }
    else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAt((i) => Math.max(0, i - 1));
      }
    else if (e.key === 'Enter' && sel) {
        e.preventDefault();
        onOpen(sel.id, e.metaKey || e.ctrlKey ? 'tab' : 'here');
      }
  };

  const doExport = async () => {
    setBusy(true);
    try {
      const path = await exportRegister({ q: params.q, status: params.status, org: params.org });
      if (path) toast('success', 'Register saved.');
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const d = detail.data;
  return (
    <div className="flex flex-wrap gap-4">
      <div className="flex min-w-0 flex-[2_1_520px] flex-col gap-3">
        <PageHead title="All assets" sub={list.data ? `${list.data.total} in the register` : undefined}>
          <Btn disabled={busy} onClick={() => void doExport()}>Export</Btn>
          {can.manage ? <Btn primary disabled={ro} onClick={onNew}>Add</Btn> : null}
        </PageHead>
        <input
          aria-label="Filter"
          className="h-9 w-full rounded-[8px] border border-line bg-surface px-3 text-[13px] text-ink outline-none focus:border-primary"
          placeholder="Filter — or scan with the USB scanner"
          value={q}
          onChange={(e) => (setQ(e.target.value), setPage(1), setAt(0))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && q.trim()) void scan(q.trim());
          }}
        />
        <Pills label="Status" value={status} onChange={(v) => (setStatus(v), setPage(1), setAt(0))} options={STATUSES.map((s) => ({ id: s, label: s ? s[0]!.toUpperCase() + s.slice(1) : 'All' }))} />
        <Card>
          {list.isLoading ? <Spinner /> : list.error ? <div className="p-3"><ErrorNote error={list.error} onRetry={() => void list.refetch()} /></div> : null}
          <div ref={body} tabIndex={0} role="grid" aria-label="Assets" onKeyDown={onKey} className="outline-none">
            <Table head={['Code', 'Name', 'Holder / location', 'Company', 'Status']}>
              {items.map((a, i) => (
                <tr key={a.id} aria-selected={a.id === sel?.id} onClick={() => setAt(i)} onDoubleClick={() => onOpen(a.id, 'tab')} className={cx('cursor-default', a.id === sel?.id ? 'bg-[#EEF1FD] dark:bg-selection' : 'hover:bg-subtle')}>
                  <td className={td}><span className="font-mono text-[11px]">{a.asset_code}</span></td>
                  <td className={td}><b>{a.name}</b></td>
                  <td className={td}>{a.holder ?? <span className="text-ink-3">{a.location ?? '—'}</span>}</td>
                  <td className={td}>{a.company ?? <span className="text-warning">No company</span>}</td>
                  <td className={td}><Badge status={a.status} /></td>
                </tr>
              ))}
            </Table>
            {list.data && !items.length ? <p className="m-0 px-3.5 py-4 text-[12.5px] text-ink-3">No assets match.</p> : null}
          </div>
        </Card>
        <div className="flex flex-wrap items-center gap-3.5 text-[11px] text-ink-2">
          <span><Kbd>↑↓</Kbd> move</span>
          <span><Kbd>↵</Kbd> open</span>
          <span><Kbd>⌘↵</Kbd> or double-click: new tab</span>
          {pages > 1 ? (
            <span className="ml-auto flex items-center gap-2">
              <button type="button" className="font-semibold text-primary disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
              {`Page ${page} of ${pages}`}
              <button type="button" className="font-semibold text-primary disabled:opacity-40" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
            </span>
          ) : null}
        </div>
      </div>
      {sel ? (
        <aside aria-label="Selected asset" className="flex min-w-0 flex-[1_1_300px] flex-col gap-3 rounded-[10px] border border-line bg-surface p-4">
          <div>
            <div className="font-mono text-[11px] text-ink-3">{sel.asset_code}</div>
            <h2 className="m-0 text-[17px] font-bold text-ink">{sel.name}</h2>
            <div className="mt-1 flex gap-1.5"><Badge status={sel.status} /><Badge status={sel.condition} /></div>
          </div>
          <dl className="m-0 grid grid-cols-[110px_1fr] gap-x-2 gap-y-1.5 text-[12.5px]">
            <dt className="text-ink-3">Holder</dt><dd className="m-0">{d?.holder?.name ?? '—'}</dd>
            <dt className="text-ink-3">Location</dt><dd className="m-0">{sel.location ?? '—'}</dd>
            <dt className="text-ink-3">Book value</dt><dd className="m-0 tabular-nums">{amt(sel.net_book_value, sel.currency)}</dd>
            <dt className="text-ink-3">Warranty</dt>
            <dd className={cx('m-0', (sel.warranty_days_left ?? 99) <= 30 && (sel.warranty_days_left ?? -1) >= 0 && 'text-[#B45309]')}>
              {sel.warranty_end ? (sel.warranty_days_left != null && sel.warranty_days_left >= 0 ? `ends in ${sel.warranty_days_left} days` : `ended ${shortDate(sel.warranty_end)}`) : '—'}
            </dd>
            {d?.asset.rustdesk_id ? (<><dt className="text-ink-3">RustDesk</dt><dd className="m-0 font-mono">{d.asset.rustdesk_id}</dd></>) : null}
          </dl>
          <div className="grid grid-cols-2 gap-2">
            {can.assign && sel.status === 'assigned' ? <Btn disabled={ro} onClick={() => onOpen(sel.id, 'here', 'custody')}>Record return</Btn> : null}
            {can.assign && sel.status === 'available' ? <Btn disabled={ro} onClick={() => onGo('scan')}>Issue…</Btn> : null}
            <Btn disabled={ro} onClick={() => onGo('transfers', `&asset=${sel.id}`)}>Transfer</Btn>
            <Btn onClick={() => void printLabels([{ code: sel.asset_code, name: sel.name, company: sel.company }])}>Print label</Btn>
            {d?.asset.rustdesk_uri ? <Btn primary onClick={() => void call('app:openExternal', { url: d.asset.rustdesk_uri! })}>Remote help</Btn> : null}
          </div>
          <Btn onClick={() => onOpen(sel.id)}>Open</Btn>
          <div className="text-[11px] text-ink-3">Open in a new tab: double-click a row · ⌘↵</div>
        </aside>
      ) : null}
    </div>
  );
}
