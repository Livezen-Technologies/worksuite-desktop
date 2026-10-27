import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { AccountView, ConnectionHealth as Health, HealthComponent, HealthState } from '@shared/accounts';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Button, cx } from '../../components/ui';
import { accountName } from '../../app/accounts/labels';
import { SettingsGroup } from '../../components/SettingsKit';

export const HEALTH_ROWS: ReadonlyArray<{ id: HealthComponent; label: string }> = [
  { id: 'api', label: 'API' },
  { id: 'auth', label: 'Authentication' },
  { id: 'realtime', label: 'Realtime' },
  { id: 'files', label: 'Files' },
  { id: 'office', label: 'Office' },
  { id: 'sync', label: 'Sync' },
];

const STATE_WORD: Record<HealthState, string> = { healthy: 'Healthy', degraded: 'Degraded', down: 'Down', unknown: 'Not checked' };
const STATE_TONE: Record<HealthState, string> = { healthy: 'text-success', degraded: 'text-warning', down: 'text-danger', unknown: 'text-ink-3' };

/** "Degraded · polling 60 s": the state's word, and the desktop's detail when it adds one. */
export function healthText(c: { state: HealthState; detail: string } | undefined): string {
  if (!c) return STATE_WORD.unknown;
  const word = STATE_WORD[c.state] ?? STATE_WORD.unknown;
  const detail = c.detail?.trim();
  return detail && detail.toLowerCase() !== word.toLowerCase() ? `${word} · ${detail}` : word;
}

/**
 * Settings › Accounts & Servers › Connection health (screen 15): the account's API, sign-in, realtime, files, Office
 * and sync, the same panel for Personal and Enterprise. Re-run discovery checks the server again (never signs anyone
 * out); Export diagnostics saves the support bundle as Help & diagnostics does.
 */
export function ConnectionHealth({ account }: { account: AccountView }) {
  const [rerunning, setRerunning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const q = useQuery({ queryKey: ['accounts', 'health', account.id], queryFn: () => call('accounts:health', { accountId: account.id }), refetchInterval: 60_000, retry: false });
  const health: Health | undefined = q.data;
  const rerun = async () => {
    setRerunning(true);
    try {
      const r = await call('accounts:rediscover', { accountId: account.id });
      if (r.state === 'ok') toast('success', `${accountName(account)}: every check passed.`);
      else if (r.failure) toast('error', r.failure.message);
      void q.refetch();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setRerunning(false);
    }
  };
  const exportDiagnostics = async () => {
    setExporting(true);
    try {
      const path = await call('diagnostics:saveBundle');
      if (path) toast('success', `Diagnostics saved to ${path}`);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setExporting(false);
    }
  };
  return (
    <div data-testid="connection-health">
    <SettingsGroup title="Connection health" actions={<span className="truncate text-[12px] text-ink-3">{accountName(account)}</span>} className="!mb-0 w-full">
      {q.isError ? <p className="m-0 px-[18px] pt-3 text-[12.5px] text-ink-3">Connection health isn’t available: {errorMessage(q.error)}</p> : null}
      <dl className="m-0 px-[18px] py-1.5">
        {HEALTH_ROWS.map((r, i) => {
          const c = health?.components[r.id];
          return (
            <div key={r.id} className={cx('flex items-center justify-between gap-3 py-2 text-[13.5px]', i < HEALTH_ROWS.length - 1 && 'border-b border-line')}>
              <dt className="text-ink">{r.label}</dt>
              <dd className={cx('m-0 text-right text-[12.5px] font-semibold', STATE_TONE[c?.state ?? 'unknown'])}>{q.isLoading ? 'Checking…' : healthText(c)}</dd>
            </div>
          );
        })}
      </dl>
      <div className="flex flex-wrap gap-2 px-[18px] py-3">
        <Button loading={rerunning} onClick={() => void rerun()}>
          Re-run discovery
        </Button>
        <Button loading={exporting} onClick={() => void exportDiagnostics()}>
          Export diagnostics
        </Button>
      </div>
    </SettingsGroup>
    </div>
  );
}
