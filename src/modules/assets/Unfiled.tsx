import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner } from '../../components/ui';
import { refusal, shortDate } from '../finance/api';
import { fetchAssets, fileToCompany, type Company } from './api';
import { Btn, Card, Note, PageHead, Table, amt, input, td, tdr, useReadOnly } from './parts';

/**
 * File assets that belong to no company (D26): until filed they are left out of every company's register, dashboard
 * and accounts. Choose the company for each and File; each is an ordinary edit, written to the asset's history.
 */
export default function Unfiled({ companies, onDone }: { companies: Company[]; onDone: () => void }) {
  const ro = useReadOnly();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['assets', 'unfiled'], queryFn: ({ signal }) => fetchAssets({ unassigned: 1, per_page: 100 }, signal) });
  const [to, setTo] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const chosen = Object.entries(to).filter(([, v]) => v > 0);

  const file = async () => {
    setBusy(true);
    let ok = 0;
    for (const [id, org] of chosen) {
      try {
        await fileToCompany(Number(id), org);
        ok++;
      } catch (e) {
        toast('error', refusal(e));
      }
    }
    setBusy(false);
    void qc.invalidateQueries({ queryKey: ['assets'] });
    if (ok) {
      toast('success', `${ok} ${ok === 1 ? 'asset' : 'assets'} filed.`);
      if (ok === chosen.length) onDone();
    }
  };

  if (q.isPending) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const rows = (q.data?.assets ?? []).filter((a) => a.org_id === null);

  return (
    <div className="flex flex-col gap-3">
      <PageHead title="File assets that belong to no company">
        <Btn onClick={onDone}>Cancel</Btn>
        <Btn primary disabled={ro || busy || !chosen.length} onClick={() => void file()}>{`File ${chosen.length} ${chosen.length === 1 ? 'asset' : 'assets'}`}</Btn>
      </PageHead>
      <Note tone="warn">Until filed, these are left out of every company's register, dashboard and accounts.</Note>
      <Card>
        <Table head={['Asset', ['Cost', 'r'], 'Bought', 'File to']}>
          {rows.map((a) => (
            <tr key={a.id}>
              <td className={td}><span className="font-mono text-[11px]">{a.asset_code}</span> <b>{a.name}</b></td>
              <td className={tdr}>{amt(a.purchase_price, a.currency)}</td>
              <td className={td}>{shortDate(a.purchase_date) || '—'}</td>
              <td className={td}>
                <select aria-label={`Company for ${a.asset_code}`} className={input} value={to[a.id] ?? 0} onChange={(e) => setTo((x) => ({ ...x, [a.id]: Number(e.target.value) }))}>
                  <option value={0}>Choose…</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </Table>
        {!rows.length ? <p className="m-0 px-3.5 py-4 text-[12.5px] text-ink-3">Every asset belongs to a company.</p> : null}
      </Card>
      <p className="m-0 text-[11.5px] text-ink-3">Filing shows the asset only in that company's register and reports, lets Finance capitalise and depreciate it there, and writes the change to its history.</p>
    </div>
  );
}
