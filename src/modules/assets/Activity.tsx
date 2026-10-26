import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../core/api';
import { call } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner } from '../../components/ui';
import { refusal } from '../finance/api';
import { BASE, statusLabel, toCsv, type Activity as Row } from './api';
import { Btn, Card, PageHead, Table, td } from './parts';

/**
 * The activity log (D25): who did what to which asset, newest first, only for the companies I belong to (the server's
 * scope), 50 to a page, with Export to CSV.
 */
const stamp = (s: string) => s.replace('T', ' ').slice(0, 16);

export default function Activity({ org }: { org: number; onAsset: (id: number) => void }) {
  const [page, setPage] = useState(1);
  const [since, setSince] = useState('30');
  const [now] = useState(() => Date.now());
  const from = new Date(now - Number(since) * 86_400_000).toISOString().slice(0, 10);
  const q = useQuery({
    queryKey: ['assets', 'activity', org, page, since],
    queryFn: ({ signal }) => apiGet<{ activity: Row[]; total?: number; per_page?: number }>(`${BASE}/activity`, { org: org || undefined, page, per_page: 50, since: from }, signal),
    placeholderData: keepPreviousData,
  });
  const rows = q.data?.activity ?? [];
  const total = q.data?.total ?? rows.length;
  const pages = Math.max(1, Math.ceil(total / (q.data?.per_page ?? 50)));
  const exportCsv = () =>
    void call('files:saveText', { name: `asset-activity-${from}.csv`, text: toCsv(['When', 'Who', 'Action', 'Asset', 'Code', 'Detail'], rows.map((r) => [r.at, r.actor, r.action, r.asset, r.asset_code, r.detail])) }).catch((e) => toast('error', refusal(e)));

  return (
    <div className="flex flex-col gap-3">
      <PageHead title="Activity log" sub="Only companies you belong to are shown">
        <select aria-label="Period" className="h-8 rounded-[7px] border border-line bg-surface px-2 text-[12px]" value={since} onChange={(e) => (setSince(e.target.value), setPage(1))}>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="365">Last year</option>
        </select>
        <Btn disabled={!rows.length} onClick={exportCsv}>Export</Btn>
      </PageHead>
      <Card>
        {q.isLoading ? <Spinner /> : q.error ? <div className="p-3"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div> : null}
        <Table head={['When', 'Who', 'Action', 'Asset', 'Detail']}>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className={td}>{stamp(r.at)}</td>
              <td className={td}>{r.actor ?? 'System'}</td>
              <td className={td}>{statusLabel(r.action)}</td>
              <td className={td}><span className="font-mono text-[11px]">{r.asset_code}</span> {r.asset}</td>
              <td className="border-b border-line/70 px-2.5 py-2 text-ink-2">{r.detail}</td>
            </tr>
          ))}
        </Table>
      </Card>
      <div className="flex items-center gap-2 text-[11.5px] text-ink-2">
        <span>{`${(page - 1) * 50 + (rows.length ? 1 : 0)}–${(page - 1) * 50 + rows.length} of ${total}`}</span>
        <span className="flex-1" />
        <Btn disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Btn>
        <Btn disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Btn>
      </div>
    </div>
  );
}
