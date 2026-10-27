import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { OfflineMutation } from '@shared/types';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useScannerSeen } from '../../core/scanner';
import { useStore } from '../../core/store';
import { bytes, relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { cx } from '../../components/ui';
import { btn, btnSmall, PageHead, Panel } from '../hr/parts';
import { Pill } from './parts';

/**
 * This computer, for Inventory (the dashboard's card, and the rail's Desktop section): the barcode scanner (heard
 * this session or not — a scanner is a keyboard, so it is known only once it has scanned), the printer labels go to,
 * the copy of Inventory kept here for working offline, and the changes waiting to be sent.
 */
export interface Computer {
  scannerSeen: number | null;
  printer: string | null;
  printers: Array<{ name: string; displayName: string; isDefault: boolean }>;
  offlineBytes: number | null;
  pending: OfflineMutation[];
  offline: boolean;
}

export function useThisComputer(): Computer {
  const scannerSeen = useScannerSeen();
  const offline = useStore(app, (s) => s.status?.network === 'OFFLINE');
  const printers = useQuery({ queryKey: ['inventory', 'printers'], queryFn: () => call('print:printers'), staleTime: 5 * 60_000 });
  const size = useQuery({ queryKey: ['inventory', 'offline-bytes'], queryFn: () => call('offline:moduleBytes', { module: 'inventory' }), staleTime: 60_000 });
  const pending = useQuery({ queryKey: ['offline', 'pending'], queryFn: () => call('offline:pending'), refetchInterval: offline ? 4_000 : 30_000 });
  const list = printers.data ?? [];
  return {
    scannerSeen,
    printer: list.find((p) => p.isDefault)?.displayName ?? list[0]?.displayName ?? null,
    printers: list,
    offlineBytes: size.data ?? null,
    pending: (pending.data ?? []).filter((m: OfflineMutation) => m.module === 'inventory'),
    offline,
  };
}

/** The four lines of the dashboard's card. */
export function computerLines(c: Computer, copy: { products: number; warehouses: number } | null, now = Date.now()): Array<{ label: string; value: string; good?: boolean }> {
  const waiting = c.pending.filter((m) => m.state !== 'DONE').length;
  return [
    { label: 'Barcode scanner', value: c.scannerSeen ? `Connected · last scan ${relative(new Date(c.scannerSeen).toISOString(), now)}` : 'Not heard yet — scan anything to check', good: !!c.scannerSeen },
    { label: 'Label printer', value: c.printer ?? 'None found', good: !!c.printer },
    { label: 'Offline copy', value: copy ? `${copy.products.toLocaleString()} products · ${copy.warehouses} ${copy.warehouses === 1 ? 'warehouse' : 'warehouses'}${c.offlineBytes ? ` · ${bytes(c.offlineBytes)}` : ''}` : c.offlineBytes ? bytes(c.offlineBytes) : 'Kept as you open screens' },
    { label: 'Waiting to sync', value: `${waiting} ${waiting === 1 ? 'change' : 'changes'}` },
  ];
}

export function ComputerCard({ copy, onOpen }: { copy: { products: number; warehouses: number } | null; onOpen?: () => void }) {
  const c = useThisComputer();
  return (
    <Panel
      title="This computer"
      action={
        onOpen ? (
          <button type="button" className="text-[12.5px] font-semibold text-primary hover:underline" onClick={onOpen}>
            Details
          </button>
        ) : undefined
      }
      bodyClassName="flex flex-col gap-2.5 px-3.5 py-3 text-[13px]"
    >
      {computerLines(c, copy).map((l) => (
        <div key={l.label} className="flex items-baseline justify-between gap-3">
          <span className="text-ink-2">{l.label}</span>
          <span className={cx('truncate text-right', l.good ? 'font-semibold text-success-ink dark:text-success' : 'text-ink')}>{l.value}</span>
        </div>
      ))}
    </Panel>
  );
}

export default function ThisComputer({ copy }: { copy: { products: number; warehouses: number } | null }) {
  const qc = useQueryClient();
  const c = useThisComputer();
  const [busy, setBusy] = useState(false);
  const sync = () =>
    void call('offline:replay')
      .then((r) => {
        toast(r.failed || r.conflicts ? 'warning' : 'success', r.done ? `${r.done} sent${r.remaining ? `, ${r.remaining} still waiting` : ''}.` : r.remaining ? `${r.remaining} still waiting for the connection.` : 'Nothing was waiting.');
        void qc.invalidateQueries({ queryKey: ['offline', 'pending'] });
      })
      .catch((e: unknown) => toast('error', errorMessage(e)));
  const clear = async () => {
    setBusy(true);
    try {
      await call('offline:clearModule', { module: 'inventory' });
      toast('success', 'The offline copy is cleared. It fills again as you open screens.');
      void qc.invalidateQueries({ queryKey: ['inventory', 'offline-bytes'] });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="This computer" sub="The scanner, the printer and the copy of Inventory kept here for working offline." />
      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
        <Panel title="Scanner & printer" bodyClassName="flex flex-col gap-2.5 px-3.5 py-3 text-[13px]">
          <div className="flex items-center justify-between">
            <span className="text-ink-2">Barcode scanner</span>
            {c.scannerSeen ? <Pill tone="green">Connected</Pill> : <Pill>Not heard yet</Pill>}
          </div>
          <span className="text-[12.5px] text-ink-3">A USB or Bluetooth scanner types like a keyboard: scan anything on an Inventory screen and it shows as connected. Scans go to the screen's scan box wherever the focus is.</span>
          <div className="flex items-center justify-between">
            <span className="text-ink-2">Label printer</span>
            <b className="text-ink">{c.printer ?? 'None found'}</b>
          </div>
          {c.printers.length > 1 ? <span className="text-[12.5px] text-ink-3">Also on this computer: {c.printers.filter((p) => p.displayName !== c.printer).map((p) => p.displayName).join(', ')}. Labels go to the default printer; choose another in the print dialog.</span> : null}
          <span className="text-[12.5px] text-ink-3">Labels are 50 × 25 mm with a QR code.</span>
        </Panel>
        <Panel title="Offline data" bodyClassName="flex flex-col gap-2.5 px-3.5 py-3 text-[13px]">
          {computerLines(c, copy)
            .slice(2)
            .map((l) => (
              <div key={l.label} className="flex items-baseline justify-between gap-3">
                <span className="text-ink-2">{l.label}</span>
                <span className="text-ink">{l.value}</span>
              </div>
            ))}
          <span className="text-[12.5px] text-ink-3">The dashboard, products, warehouses and stock counts you open are kept here, encrypted, so counting goes on when the connection drops. Counts are sent in order when WorkSuite is back; nothing is posted to stock offline.</span>
          {c.pending.length ? (
            <div className="flex flex-col gap-1">
              {c.pending.map((m) => (
                <span key={m.id} className="flex justify-between gap-2 rounded-[8px] border border-line px-2.5 py-1.5 text-[12.5px]">
                  <span className="truncate text-ink">{m.label}</span>
                  <span className={cx('shrink-0', m.state === 'CONFLICT' || m.state === 'FAILED' ? 'font-semibold text-danger' : 'text-ink-3')}>{m.state === 'CONFLICT' ? 'needs a decision' : m.state === 'FAILED' ? 'not sent' : 'queued'}</span>
                </span>
              ))}
            </div>
          ) : null}
          <div className="flex gap-2">
            <button type="button" className={btn} onClick={sync}>
              Try to sync now
            </button>
            <button type="button" className={btnSmall} disabled={busy || !c.offlineBytes} onClick={() => void clear()}>
              Clear offline copy
            </button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
