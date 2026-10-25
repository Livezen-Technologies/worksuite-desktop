import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Spinner } from '../../components/ui';
import { fetchBatches, K } from './api';
import { Badge, Note, PageHead, btn, num, td, th } from './parts';

/** The batches to print (WF-14): approved ones to start, paused or interrupted ones to finish. */
export const BATCH_STATUS: Record<string, { label: string; tone: 'ok' | 'bad' | 'warn' | 'info' | 'muted' }> = {
  DRAFT: { label: 'Draft', tone: 'muted' },
  APPROVED: { label: 'Ready to print', tone: 'info' },
  PRINTING: { label: 'Printing', tone: 'info' },
  PAUSED: { label: 'Paused', tone: 'warn' },
  RECONCILE_REQUIRED: { label: 'Reconcile required', tone: 'bad' },
  COMPLETED: { label: 'Completed', tone: 'ok' },
};

export default function Batches({ onOpen }: { onOpen: (id: number) => void }) {
  const list = useQuery({ queryKey: K.batches, queryFn: ({ signal }) => fetchBatches(signal), retry: false });
  const [typed, setTyped] = useState('');
  const id = /^\d+$/.test(typed.trim()) ? Number(typed.trim()) : null;
  return (
    <div className="flex flex-col gap-3">
      <PageHead title="Batch print runs" sub="Cheques from one payment run, printed leaf by leaf">
        <input aria-label="Batch number" className={`h-8 w-28 rounded-[7px] border border-line bg-surface px-2.5 text-[13px] ${num}`} placeholder="Batch id" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <button type="button" className={btn} disabled={!id} onClick={() => id && onOpen(id)}>Open</button>
      </PageHead>
      {list.isLoading ? <Spinner /> : list.error ? <Note>{'This server does not list batches here. Open a batch by its number, or from the print queue on the web, which opens it on this computer.'}</Note> : null}
      {list.data ? (
        <section className="overflow-hidden rounded-[10px] border border-line bg-surface">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>Batch</th>
                <th className={`${th} text-right`}>Cheques</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((b) => (
                <tr key={b.id} className="hover:bg-subtle">
                  <td className={`${td} font-bold`}><button type="button" className="hover:underline" onClick={() => onOpen(b.id)}>{b.reference}</button></td>
                  <td className={`${td} ${num} text-right`}>{b.count || '—'}</td>
                  <td className={td}><Badge tone={BATCH_STATUS[b.status]?.tone ?? 'muted'}>{BATCH_STATUS[b.status]?.label ?? b.status}</Badge></td>
                </tr>
              ))}
              {list.data.length === 0 ? <tr><td className={td} colSpan={3}>No batches to print.</td></tr> : null}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
