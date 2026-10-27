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
 * Provider accounts and sync history (D-07, HDM-PRV-07/08/09) from `GET accounts` and `GET sync-runs`. Keys never
 * leave the server and this app never stores them: an account shows the mask the server sends. Test and Sync per
 * account — both answer `{ok, why}`, a failure included — its schedule (off, nightly, every 6 h) and Pause, and the
 * sync runs with added / updated / failed and the reason.
 */
const today = () => new Date().toISOString().slice(0, 10);
export const runOk = (r: Pick<SyncRun, 'ok'>) => r.ok === true || (r.ok as unknown) === 1;

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
      if (what === 'test') {
        const r = await testAccount(a.id);
        if (r?.ok === false) toast('error', text('{name}: {why}', { name: a.name, why: r.why || text('the provider refused the key.') }));
        else toast('success', text('{name} answered.', { name: a.name }));
      } else {
        const r = await syncAccount(a.id);
        if (r?.ok === false) toast('error', text('{name}: {why}', { name: a.name, why: r.why || text('the sync failed.') }));
        else toast('success', text('{name} synced: {added} added, {updated} updated.', { name: a.name, added: r?.added ?? 0, updated: r?.updated ?? 0 }));
      }
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: K.accounts });
      void qc.invalidateQueries({ queryKey: ['hosting', 'runs'] });
    }
  };
  const schedule = async (a: Account, change: { schedule?: 'off' | 'nightly' | '6h'; paused?: boolean }) => {
    try {
      const r = await setSchedule(a.id, change);
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
  const shown = history ? list : list.filter((r) => (r.at ?? '').slice(0, 10) === today());
  const pages = runs.data ? Math.max(1, Math.ceil(runs.data.total / Math.max(1, runs.data.per_page))) : 1;
  return (
    <div className="flex flex-col gap-4">
      {!history ? (
        <>
          <PageHead title="Provider accounts" sub="Keys never leave the server; this app never stores them" />
          {accounts.isPending ? <Spinner /> : accounts.isError ? <ErrorNote error={accounts.error} onRetry={() => void accounts.refetch()} /> : null}
          <div className="flex flex-col gap-2">
            {(accounts.data ?? []).map((a) => (
              <div key={a.id} className={cx('flex flex-wrap items-center gap-3 rounded-[10px] border bg-surface px-3.5 py-3', a.last_error ? 'border-danger-line' : 'border-line')}>
                <span className="flex size-[34px] shrink-0 items-center justify-center rounded-[9px] bg-teal text-[12px] font-bold text-white">{a.provider.slice(0, 2).toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-ink">{a.name}</div>
                  <div className="text-[11.5px] text-ink-3">{[a.label ?? a.provider, a.environment && a.environment !== 'live' ? a.environment : null, a.connectable === false ? text('no integration yet') : null, a.supports?.length ? a.supports.join(', ') : null].filter(Boolean).join(' · ')}</div>
                  <div className="text-[11.5px]">
                    <span className={a.last_error ? 'text-danger' : 'text-success'}>{a.last_error ? text('{why} · {time}', { why: a.last_error, time: when(a.last_error_at) }) : a.last_ok_at ? text('OK at {time}', { time: when(a.last_ok_at) }) : ''}</span>
                    {a.last_sync_at ? <span className="text-ink-3">{` · ${text('last synced {time}', { time: when(a.last_sync_at) })}`}</span> : null}
                    {a.paused ? <span className="text-warning-ink">{` · ${text('paused')}`}</span> : null}
                  </div>
                </div>
                <span className="font-mono text-[11.5px] text-ink-3">{a.key || '••••'}</span>
                {!noSchedule && a.sync_schedule !== undefined ? (
                  <>
                    <Select aria-label={text('Sync schedule for {name}', { name: a.name })} disabled={ro} value={a.sync_schedule ?? 'nightly'} onChange={(e) => void schedule(a, { schedule: e.target.value as 'off' | 'nightly' | '6h' })} className="h-8 rounded-[7px] border border-line bg-surface px-2 text-[12px]">
                      <option value="off">Sync off</option>
                      <option value="nightly">Nightly</option>
                      <option value="6h">Every 6 h</option>
                    </Select>
                    <Btn disabled={ro} title={off} onClick={() => void schedule(a, { paused: !a.paused })}>
                      {a.paused ? 'Resume' : 'Pause'}
                    </Btn>
                  </>
                ) : null}
                <Btn disabled={ro || !!busy || a.connectable === false} title={off} onClick={() => void act(a, 'test')}>
                  {busy === `test:${a.id}` ? 'Testing…' : 'Test'}
                </Btn>
                <Btn disabled={ro || !!busy || a.connectable === false} title={off} onClick={() => void act(a, 'sync')}>
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
                <td className={cx(td, 'tabular-nums')}>{when(r.at)}</td>
                <td className={td}>{[r.provider, r.account_name, r.kind, r.started_by ?? text('scheduled')].filter(Boolean).join(' · ')}</td>
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
