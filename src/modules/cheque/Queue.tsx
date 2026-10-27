import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { signedMm } from '@shared/cheque';
import { Checkbox } from '../../components/Checkbox';
import { ErrorNote, Spinner } from '../../components/ui';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { fetchProfiles, fetchQueue, has, K, openPdf, profileFor, type Access, type QueueItem } from './api';
import { Note, PageHead, Panel, amt, btn, btnPrimary, num, td, th, useStation } from './parts';
import { PrintDialog } from './PrintDialog';
import { useOfflineReadOnly } from '../../core/offline-read';

/**
 * D02 — Print station queue + printer status (CHQ-PRT-01, CHQ-PRN-02, WF-06). Approved cheques; those a printer
 * profile on this computer can print (linked to the cheque's template version and not restricted away from its
 * account) can be picked, the rest are dimmed. One bank account per run, in leaf order. Printing one opens D03; the
 * next leaf of the run only after the last one was confirmed printed.
 */
export default function Queue({ access }: { access: Access | undefined }) {
  const qc = useQueryClient();
  const st = useStation();
  const device = st.data?.device_id ?? null;
  const queue = useQuery({ queryKey: K.queue, queryFn: ({ signal }) => fetchQueue(signal), enabled: !!device });
  const profiles = useQuery({ queryKey: K.profiles(device), queryFn: ({ signal }) => fetchProfiles(device, signal), enabled: !!device });
  const [picked, setPicked] = useState<number[]>([]);
  const [printing, setPrinting] = useState<QueueItem[] | null>(null);
  const lastOk = useRef(false);
  const items = queue.data ?? [];
  const mine = profiles.data ?? [];
  // Printing needs WorkSuite: offline the lists read from this computer's copy and nothing prints (D-G14).
  const offline = useOfflineReadOnly('cheque').readOnly;
  const canPrint = has(access, 'cheque.print') && !offline;
  const printable = items.filter((i) => profileFor(i, mine));

  const selected = items.filter((i) => picked.includes(i.cheque_id));
  const account = selected[0]?.bank_account_id;
  const ordered = [...selected].sort((a, b) => a.cheque_number.localeCompare(b.cheque_number, undefined, { numeric: true }));
  const first = ordered[0] ?? printable[0];
  const profile = (first ? profileFor(first, mine) : null) ?? mine[0] ?? null;
  const toggle = (i: QueueItem) => setPicked((p) => (p.includes(i.cheque_id) ? p.filter((x) => x !== i.cheque_id) : account !== undefined && account !== i.bank_account_id ? [i.cheque_id] : [...p, i.cheque_id]));
  const refresh = () => void qc.invalidateQueries({ queryKey: ['cheque'] });

  if (!device) return <Note tone="warn">This computer is not registered with WorkSuite, so it has no printer profiles and cannot print cheques.</Note>;

  const current = printing?.[0];
  const currentProfile = current ? profileFor(current, mine) : null;

  return (
    <div className="flex flex-col gap-3">
      <PageHead title="Print queue" sub={queue.data ? `${printable.length} ${printable.length === 1 ? 'cheque' : 'cheques'} this computer can print${items.length > printable.length ? ` · ${items.length - printable.length} more need a profile here` : ''}` : undefined}>
        <button type="button" className={btn} onClick={refresh}>Refresh</button>
        <button type="button" className={btnPrimary} disabled={!canPrint || ordered.length === 0} onClick={() => setPrinting(ordered)}>{`Print selected (${ordered.length})`}</button>
      </PageHead>
      {queue.isLoading ? <Spinner /> : queue.error ? <ErrorNote error={queue.error} onRetry={() => void queue.refetch()} /> : null}
      <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-start gap-2.5">
        <div className="flex flex-col gap-2.5">
          <section className="overflow-hidden rounded-[10px] border border-line bg-surface">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={th}><span className="sr-only">Select</span></th>
                  <th className={th}>Cheque</th>
                  <th className={th}>Payee</th>
                  <th className={th}>Account</th>
                  <th className={`${th} text-right`}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const ok = !!profileFor(i, mine);
                  return (
                    <tr key={i.cheque_id} className={ok ? (picked.includes(i.cheque_id) ? 'bg-selection dark:bg-selection' : '') : 'opacity-50'}>
                      <td className={td}><Checkbox aria-label={`Select ${i.cheque_number}`} checked={picked.includes(i.cheque_id)} disabled={!ok || !canPrint} onChange={() => toggle(i)} /></td>
                      <td className={`${td} ${num}`}>
                        {i.cheque_number}
                        <button type="button" className="ms-2 font-sans text-[11px] font-semibold text-primary hover:underline" onClick={() => void openPdf('preview', i.cheque_id, `Cheque ${i.cheque_number} preview`).catch((e) => toast('error', errorMessage(e)))}>Preview</button>
                      </td>
                      <td className={td}>{i.payee_name}{!ok ? <div className="text-[11px] text-ink-3">No printer profile on this computer for this template or account</div> : null}</td>
                      <td className={td}>{i.bank_account}</td>
                      <td className={`${td} ${num} text-right`}>{amt(i.amount, i.currency)}</td>
                    </tr>
                  );
                })}
                {queue.data && items.length === 0 ? <tr><td className={td} colSpan={5}>Nothing is waiting to print.</td></tr> : null}
              </tbody>
            </table>
          </section>
          {ordered.length ? <Note tone="warn">{`Only one account per run: printing ${ordered[0]!.bank_account}. Load ${ordered.length} ${ordered.length === 1 ? 'leaf' : 'leaves'} (${ordered.map((o) => o.cheque_number).join(', ')}) in that order.`}</Note> : null}
        </div>
        <Panel title="Load the printer">
          {profile ? (
            <div className="flex flex-col gap-3">
              <div className="relative h-[170px] rounded-[10px] border border-line bg-subtle">
                <div className="absolute top-[18px] left-1/2 h-[30px] w-[220px] -translate-x-1/2 rounded-[6px] bg-primary-soft dark:bg-line" />
                <div className="absolute top-[52px] left-1/2 grid h-[82px] w-[178px] -translate-x-1/2 place-items-center border border-slate-line bg-ground text-[11px] font-semibold text-teal">FACE UP · TOP FIRST</div>
                <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 text-[11px] text-ink-2">{profile.tray ?? 'Manual tray'}</div>
              </div>
              <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
                <dt className="text-ink-2">Printer</dt>
                <dd className="m-0">{profile.printer_name}</dd>
                <dt className="text-ink-2">Offsets</dt>
                <dd className={`m-0 ${num}`}>{`X ${signedMm(profile.offset_x_mm)} mm · Y ${signedMm(profile.offset_y_mm)} mm`}</dd>
                <dt className="text-ink-2">Scale</dt>
                <dd className="m-0">100 % fixed</dd>
              </dl>
              <button type="button" className={btnPrimary} disabled={!canPrint || !ordered[0]} onClick={() => setPrinting(ordered)}>{ordered[0] ? `Print ${ordered[0].cheque_number}` : 'Select a cheque'}</button>
            </div>
          ) : (
            <div className="text-[12.5px] text-ink-2">{profiles.isLoading ? 'Loading the printer profiles…' : 'No cheque printer profile is bound to this computer. A template administrator sets one up on the web under Cheque Manager › Settings › Printers.'}</div>
          )}
        </Panel>
      </div>
      {current && currentProfile ? (
        <PrintDialog
          key={current.cheque_id}
          item={current}
          profile={currentProfile}
          onDone={(r) => {
            lastOk.current = r === 'printed';
            if (r === 'printed') setPicked((p) => p.filter((x) => x !== current.cheque_id));
          }}
          onClose={() => {
            // The next leaf in the run only after this one was confirmed printed; anything else ends the run here.
            const next = lastOk.current;
            lastOk.current = false;
            setPrinting((list) => (next && list && list.length > 1 ? list.slice(1) : null));
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}
