import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiPut } from '../../core/api';
import { app } from '../../core/app-state';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { useStore } from '../../core/store';
import { timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Select } from '../../components/Select';
import { Button, Chip, ErrorNote, Spinner, cx } from '../../components/ui';
import { mailboxLetter } from './model';
import { AccountAvatar } from './parts';
import { accountName, accountState, includedIds, modeWords, runSync, syncAgo, syncAt, syncSummary, useSharedSync, type SyncSummary } from './sync';
import type { MailPrefs, Mailbox, SyncAccount, SyncRun } from './types';
import { SyncButton } from '../../components/SyncButton';

/**
 * Settings › Mail › Accounts & sync (design D04 v1.1, D18; DMO-SYN-09…11):
 * each account's last successful sync, last attempt and result, frequency,
 * Sync now, View sync log and Include in All Accounts — under the same one
 * status the folder pane and the status bar show.
 */

const FREQUENCIES: Array<{ value: string; label: string; every: number }> = [
  { value: 'push', label: 'Push', every: 5 },
  { value: '5', label: 'Every 5 min', every: 5 },
  { value: '15', label: 'Every 15 min', every: 15 },
  { value: '60', label: 'Hourly', every: 60 },
  { value: '0', label: 'Manual', every: 0 },
];

/** The frequency select's value for an account. */
export function frequencyValue(a: Pick<SyncAccount, 'mode' | 'interval_min'>): string {
  if (a.mode === 'push') return 'push';
  if (a.interval_min === 0 || a.mode === 'manual') return '0';
  if (a.interval_min >= 60) return '60';
  if (a.interval_min >= 15) return '15';
  return '5';
}

export const STALE_CHOICES: Array<{ value: number; label: string }> = [
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 180, label: '3 hours' },
  { value: 720, label: '12 hours' },
  { value: 1440, label: '24 hours' },
];

/** "Today 08:42 (6 min ago)". */
function okWords(stamp: string | null): string {
  if (!stamp) return text('Never');
  return `${syncAt(stamp)} (${syncAgo(stamp)})`;
}

/** "08:47 · Success", "In progress · 2 of 9 folders", "08:40 · Failed — Google sign-in expired". */
export function attemptWords(a: SyncAccount): { label: string; tone: 'success' | 'danger' | 'muted' } {
  if (a.running) return { label: a.folders ? text('In progress · {done} of {n} folders', { done: a.folders_done, n: a.folders }) : text('In progress'), tone: 'muted' };
  const at = a.last_attempt_at ? timeLabel(a.last_attempt_at) : '';
  if (a.last_result === 'failed') return { label: `${at} · ${text('Failed — {why}', { why: a.error ?? text('the sync did not finish') })}`, tone: 'danger' };
  if (a.last_result === 'partial') return { label: `${at} · ${text('Partly synced')}`, tone: 'muted' };
  if (a.last_result === 'never' || !a.last_attempt_at) return { label: text('Not tried yet'), tone: 'muted' };
  return { label: `${at} · ${text('Success')}`, tone: 'success' };
}

export function AccountsSync({ boxes, prefs, onPrefs, onRepair, onManage }: { boxes: Mailbox[]; prefs: MailPrefs; onPrefs: (p: Partial<MailPrefs>) => void; onRepair: (b: Mailbox) => void; onManage?: (b: Mailbox) => void }) {
  const qc = useQueryClient();
  const status = useStore(app, (s) => s.status);
  const offline = status?.network === 'OFFLINE';
  const shared = useSharedSync(true);
  const [log, setLog] = useState<Mailbox | null>(null);
  const summary = syncSummary(shared.status, { offline, running: shared.running, boxes, staleMinutes: prefs.staleMinutes });
  const accounts = shared.status?.accounts ?? null;
  const done = () => {
    void shared.refetch();
    void qc.invalidateQueries({ queryKey: ['mail'] });
  };
  const saveBox = async (b: Mailbox, patch: Record<string, unknown>) => {
    try {
      await apiPut(`/api/mail/mailboxes/${b.id}`, patch);
      done();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <section aria-label={text('Accounts & sync')}>
      <SummaryBanner summary={summary} onSyncAll={() => void runSync(includedIds(shared.status, boxes), { all: true, offline, onDone: done })} offline={offline} running={shared.all} />
      {shared.status === null ? <Spinner /> : null}
      {accounts === null && shared.status ? <p className="mb-3 text-[12.5px] text-ink-3">{text('This WorkSuite server does not report sync details yet.')}</p> : null}
      <ul role="list" className="flex flex-col gap-3">
        {boxes.map((b) => {
          const a = accounts?.find((x) => x.mailbox === b.id) ?? null;
          const running = shared.running.has(b.id) || !!a?.running;
          const failed = !running && (a?.last_result === 'failed' || b.auth_state === 'problem');
          const att = a ? attemptWords(running ? { ...a, running: true } : a) : null;
          return (
            <li key={b.id} aria-label={b.email} className={cx('rounded-[12px] border bg-surface p-4', failed ? 'border-danger/40 bg-danger-bg/30' : 'border-line')}>
              <div className="flex items-center gap-3">
                <AccountAvatar letter={mailboxLetter(b)} colour={b.colour} size={32} className="rounded-[8px]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-bold text-ink">{a ? accountName(a, b) : b.email}</span>
                  <span className="block truncate text-[12.5px] text-ink-3">{b.email}</span>
                </span>
                <Chip tone={failed ? 'danger' : running ? 'indigo' : a?.paused ? 'warning' : 'success'}>{failed ? text('Sync failed') : running ? text('Syncing…') : a?.paused ? text('Paused') : text('Up to date')}</Chip>
                {failed && b.auth_state === 'problem' ? (
                  <Button variant="danger" onClick={() => onRepair(b)}>
                    {text('Sign in again')}
                  </Button>
                ) : null}
                <SyncButton
                  running={running}
                  failed={failed}
                  disabled={offline}
                  reason={offline ? text('You’re offline — mail will sync when you reconnect') : undefined}
                  onSync={async () => {
                    const r = await runSync([b.id], { offline, onDone: done });
                    if (r.failed.length) throw new Error('sync failed');
                  }}
                />
                <Button onClick={() => setLog(b)}>{text('View sync log')}</Button>
                {onManage ? <Button onClick={() => onManage(b)}>{text('Manage')}</Button> : null}
              </div>
              {a ? (
                <div className="mt-3 grid grid-cols-[1fr_1fr_1fr_auto] items-start gap-4 text-[12.5px]">
                  <div>
                    <div className="text-ink-3">{text('Last successful sync')}</div>
                    <div className="font-semibold text-ink">{okWords(a.last_ok_at)}</div>
                  </div>
                  <div>
                    <div className="text-ink-3">{text('Last attempt')}</div>
                    <div className={cx('font-semibold', att?.tone === 'danger' ? 'text-danger' : att?.tone === 'success' ? 'text-success' : 'text-ink')}>{att?.label}</div>
                  </div>
                  <div className="max-w-[180px]">
                    <Select
                      label={text('Sync frequency')}
                      value={frequencyValue(a)}
                      options={FREQUENCIES.filter((f) => f.value !== 'push' || a.mirror).map((f) => ({ value: f.value, label: text(f.label) }))}
                      onValueChange={(v) => {
                        const f = FREQUENCIES.find((x) => x.value === v);
                        if (f) void saveBox(b, { sync_every: f.every });
                      }}
                    />
                  </div>
                  <label className="flex items-center gap-2 pt-5 text-[13px] text-ink">
                    <Checkbox checked={a.included} onChange={(e) => void saveBox(b, { in_unified: e.target.checked })} />
                    {text('Include in All Accounts')}
                  </label>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <section aria-label={text('Sync warnings')} className="mt-4 rounded-[12px] border border-line bg-surface p-4">
        <h3 className="text-[15px] font-bold text-ink">{text('Sync warnings')}</h3>
        <div className="mt-3 flex flex-wrap items-end gap-4 text-[13.5px]">
          <div className="w-[260px]">
            <Select label={text('Warn when an account hasn’t synced for')} value={prefs.staleMinutes ?? shared.status?.overall?.stale_minutes ?? 60} options={STALE_CHOICES.map((c) => ({ value: c.value, label: text(c.label) }))} onValueChange={(v) => onPrefs({ staleMinutes: Number(v) })} />
          </div>
          <label className="flex items-center gap-2.5 pb-2 text-ink">
            <Checkbox checked={prefs.notifySyncFailure !== false} onChange={(e) => onPrefs({ notifySyncFailure: e.target.checked })} />
            {text('Show a desktop notification when an account fails')}
          </label>
        </div>
      </section>
      {log ? <SyncLog box={log} account={accounts?.find((x) => x.mailbox === log.id) ?? null} onClose={() => setLog(null)} onRepair={() => onRepair(log)} /> : null}
    </section>
  );
}

function SummaryBanner({ summary, onSyncAll, offline, running }: { summary: SyncSummary; onSyncAll: () => void; offline: boolean; running: boolean }) {
  return (
    <div role="status" className={cx('mb-4 flex items-center gap-3 rounded-[10px] border px-3 py-2 text-[13px]', summary.tone === 'danger' ? 'border-danger/40 bg-danger-bg text-danger' : summary.tone === 'warning' ? 'border-warning/40 bg-warning-bg text-warning' : 'border-line bg-subtle text-ink')}>
      <span className="min-w-0 flex-1">
        <b>{summary.headline}</b>
        {summary.detail ? <span className="text-ink-2"> · {summary.detail}</span> : null}
      </span>
      <span className="text-[12px] text-ink-3">{text('Same status as the folder pane and status bar')}</span>
      <SyncButton label={text('Sync all')} running={running} failed={summary.failed.length > 0} disabled={offline} title={text('Sync all (Ctrl+Shift+R)')} onSync={onSyncAll} />
    </div>
  );
}

/** The last 50 runs, with Copy log for support (D18, DMO-SYN-10). */
function SyncLog({ box, account, onClose, onRepair }: { box: Mailbox; account: SyncAccount | null; onClose: () => void; onRepair: () => void }) {
  const q = useQuery({ queryKey: ['mail', 'sync-log', box.id], queryFn: () => apiGet<{ runs: SyncRun[]; account: SyncAccount }>(`/api/mail/mailboxes/${box.id}/sync-log`) });
  const runs = q.data?.runs ?? [];
  const a = q.data?.account ?? account;
  const failed = a?.last_result === 'failed';
  const copy = async () => {
    const lines = [`${box.email} — ${text('sync log')}`, ...runs.map((r) => [r.started_at ?? '', r.duration_ms !== null ? `${(r.duration_ms / 1000).toFixed(1)} s` : '', r.result, `${r.folders}/${r.folders_total} folders`, `+${r.added} ~${r.changed} -${r.removed}`, r.error ?? ''].join('\t'))];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast('success', text('Sync log copied.'));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label={text('Sync log · {email}', { email: box.email })} className="fixed inset-y-0 right-0 z-50 flex w-[460px] max-w-full flex-col border-l border-line bg-surface shadow-2xl">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <AccountAvatar letter={mailboxLetter(box)} colour={box.colour} size={24} />
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[14px] text-ink">{text('Sync log · {name}', { name: a ? accountName(a, box) : box.email })}</b>
          <span className="block truncate text-[12px] text-ink-3">{text('{email} · last {n} runs', { email: box.email, n: runs.length })}</span>
        </span>
        <button type="button" onClick={onClose} aria-label={text('Close')} className="h-8 w-8 rounded-[8px] text-ink-3 hover:bg-subtle hover:text-ink">
          ×
        </button>
      </header>
      {failed && a ? <p className="m-4 mb-0 rounded-[8px] border border-danger/40 bg-danger-bg p-3 text-[12.5px] text-danger">{text('Last attempt failed {time} — {why}. Last success {ok}.', { time: a.last_attempt_at ? timeLabel(a.last_attempt_at) : '', why: a.error ?? '', ok: a.last_ok_at ? syncAt(a.last_ok_at) : text('never') })}</p> : null}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 scroll-thin">
        {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : runs.length === 0 ? <p className="text-[13px] text-ink-3">{text('No runs recorded yet.')}</p> : null}
        {runs.length ? (
          <table className="w-full text-left text-[12px]">
            <thead className="text-ink-3">
              <tr>
                <th className="py-1 font-semibold">{text('Started')}</th>
                <th className="py-1 font-semibold">{text('Took')}</th>
                <th className="py-1 font-semibold">{text('Result')}</th>
                <th className="py-1 font-semibold">{text('Details')}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="py-1.5 pr-2 font-mono text-ink">{r.started_at ? syncAt(r.started_at) : ''}</td>
                  <td className="py-1.5 pr-2 text-ink-2">{r.duration_ms !== null ? `${(r.duration_ms / 1000).toFixed(1)} s` : '—'}</td>
                  <td className={cx('py-1.5 pr-2 font-semibold', r.result === 'failed' ? 'text-danger' : r.result === 'ok' ? 'text-success' : 'text-warning')}>{r.result === 'failed' ? text('Failed') : r.result === 'ok' ? text('Success') : r.result === 'running' ? text('Running') : text('Partial')}</td>
                  <td className="py-1.5 text-ink-2">{r.error ?? text('{done} of {n} folders · +{added} added · {changed} changed · {removed} removed', { done: r.folders, n: r.folders_total, added: r.added, changed: r.changed, removed: r.removed })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
      <footer className="flex gap-2 border-t border-line p-3">
        {failed && box.auth_state === 'problem' ? (
          <Button variant="primary" onClick={onRepair}>
            {text('Sign in again')}
          </Button>
        ) : null}
        <Button onClick={() => void copy()}>{text('Copy log for support')}</Button>
        <span className="flex-1" />
        <Button onClick={onClose}>{text('Close')}</Button>
      </footer>
    </div>
  );
}

/** For other screens: an account's state in a word. */
export { accountState, modeWords };
