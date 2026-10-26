import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { Select } from '../../components/Select';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { fetchAccounts, fetchRuns, K, setSchedule, syncAccount, testAccount, type Account, type SyncRun } from './api';
import { Btn, Card, Chip, PageHead, Table, td, useReadOnly, when } from './parts';

/**
 * Provider accounts and sync history (D-07, HDM-PRV-07/08/09). Keys never leave the server and this app never stores
 * them: an account shows its last four characters as the server masks them. Test and Sync per account, its schedule
 * (off, nightly, every 6 h) where the server has it, and the sync runs with added / updated / failed and the reason.
 */
const today = () => new Date().toISOString().slice(0, 10);
export const runOk = (r: Pick<SyncRun, 'ok'>) => r.ok === true || r.ok === 1;

export default function Accounts({ history }: { history: boolean }) {
  const ro = useReadOnly();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const accounts = useQuery({ queryKey: K.accounts, queryFn: ({ signal }) => fetchAccounts(signal) });
  const runs = useQuery({ queryKey: K.runs({ page }), queryFn: ({ signal }) => fetchRuns({ page, per_page: 50, sort: '-created_at' }, signal), placeholderData: keepPreviousData });
  const [busy, setBusy] = useState<string | null>(null);
  const [noSchedule, setNoSchedule] = useState(false);
  const act = async (a: Account, what: 'test' | 'sync') => {
    setBusy(`${what}:${a.id}`);
    try {
      const r = what === 'test' ? await testAccount(a.id) : await syncAccount(a.id);
      toast('success', r?.message ?? (what === 'test' ? text('{name} answered.', { name: a.name }) : text('{name} synced.', { name: a.name })));
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: K.accounts });
      void qc.invalidateQueries({ queryKey: ['hosting', 'runs'] });
    }
  };
  const schedule = async (a: Account, v: 'off' | 'nightly' | '6h') => {
    try {
      const r = await setSchedule(a.id, v);
      if (r === null) {
        setNoSchedule(true);
        toast('info', text('Sync schedules need a server update.'));
      } else void qc.invalidateQueries({ queryKey: K.accounts });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const off = ro ? 'Needs a connection' : undefined;
  const list = runs.data?.items ?? [];
  const shown = history ? list : list.filter((r) => (r.created_at ?? '').slice(0, 10) === today());
  const pages = runs.data ? Math.max(1, Math.ceil(runs.data.total / Math.max(1, runs.data.per_page))) : 1;
  return (
    <div className="flex flex-col gap-4">
      {!history ? (
        <>
          <PageHead title="Provider accounts" sub="Keys never leave the server; this app never stores them" />
          {accounts.isPending ? <Spinner /> : accounts.isError ? <ErrorNote error={accounts.error} onRetry={() => void accounts.refetch()} /> : null}
          <div className="flex flex-col gap-2">
            {(accounts.data ?? []).map((a) => (
              <div key={a.id} className={cx('flex flex-wrap items-center gap-3 rounded-[10px] border bg-surface px-3.5 py-3', a.last_error ? 'border-[#F5C2BD]' : 'border-line')}>
                <span className="flex size-[34px] shrink-0 items-center justify-center rounded-[9px] bg-[#0891B2] text-[12px] font-bold text-white">{a.provider.slice(0, 2).toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-ink">{a.name}</div>
                  <div className="text-[11.5px] text-ink-3">{[a.provider, a.company].filter(Boolean).join(' · ')}</div>
                  <div className="text-[11.5px]">
                    <span className="text-ink-2">{[a.domains_count ? text('{n} domains', { n: a.domains_count }) : null, a.servers_count ? text('{n} servers', { n: a.servers_count }) : null, a.dns_editable ? text('DNS editable') : null].filter(Boolean).join(' · ')}</span>{' '}
                    <span className={a.last_error ? 'text-[#B42318]' : 'text-[#1F7A4D]'}>{a.last_error ?? (a.last_ok_at ? text('OK at {time}', { time: when(a.last_ok_at) }) : '')}</span>
                  </div>
                </div>
                <span className="font-mono text-[11.5px] text-ink-3">{a.key_hint ? `••••${a.key_hint.slice(-4)}` : '••••'}</span>
                {!noSchedule && a.sync_schedule !== undefined ? (
                  <Select aria-label={text('Sync schedule for {name}', { name: a.name })} disabled={ro} value={a.sync_schedule ?? 'nightly'} onChange={(e) => void schedule(a, e.target.value as 'off' | 'nightly' | '6h')} className="h-8 rounded-[7px] border border-line bg-surface px-2 text-[12px]">
                    <option value="off">Sync off</option>
                    <option value="nightly">Nightly</option>
                    <option value="6h">Every 6 h</option>
                  </Select>
                ) : null}
                <Btn disabled={ro || !!busy} title={off} onClick={() => void act(a, 'test')}>
                  {busy === `test:${a.id}` ? 'Testing…' : 'Test'}
                </Btn>
                <Btn disabled={ro || !!busy} title={off} onClick={() => void act(a, 'sync')}>
                  {busy === `sync:${a.id}` ? 'Syncing…' : 'Sync'}
                </Btn>
              </div>
            ))}
            {accounts.isSuccess && !(accounts.data ?? []).length ? <p className="m-0 text-[12.5px] text-ink-3">No provider accounts are connected. An administrator connects them on the web.</p> : null}
          </div>
        </>
      ) : (
        <PageHead title="Sync history" />
      )}
      <Card title={history ? undefined : 'Sync history · today'}>
        {runs.isPending ? <Spinner /> : runs.isError ? <ErrorNote error={runs.error} /> : shown.length ? (
          <Table head={['Time', 'Account', 'Result', 'What changed']} label="Sync history">
            {shown.map((r) => (
              <tr key={r.id}>
                <td className={cx(td, 'tabular-nums')}>{when(r.created_at)}</td>
                <td className={td}>{[r.provider, r.account, r.kind].filter(Boolean).join(' · ')}</td>
                <td className={td}>
                  <Chip tone={runOk(r) ? 'green' : 'red'}>{runOk(r) ? 'OK' : 'Failed'}</Chip>
                </td>
                <td className={cx(td, 'whitespace-normal text-ink-2')}>{runOk(r) ? [r.added ? text('{n} added', { n: r.added }) : null, r.updated ? text('{n} updated', { n: r.updated }) : null, r.failed ? text('{n} failed', { n: r.failed }) : null].filter(Boolean).join(' · ') || (r.message ?? text('No changes')) : (r.message ?? text('Failed'))}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="m-0 px-3.5 py-3 text-[12.5px] text-ink-3">{history ? 'No sync runs yet.' : 'Nothing synced today yet.'}</p>
        )}
        {history && pages > 1 ? (
          <div className="flex items-center justify-end gap-2 px-3 py-2 text-[12px] text-ink-2">
            <Btn disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Btn>
            <span className="tabular-nums">{`${page} / ${pages}`}</span>
            <Btn disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Btn>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
