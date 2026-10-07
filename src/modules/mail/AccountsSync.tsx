import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiPut } from '../../core/api';
import { app } from '../../core/app-state';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { useStore } from '../../core/store';
import { timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Select } from '../../components/Select';
import { Button, Chip, Spinner, cx } from '../../components/ui';
import { mailboxLetter } from './model';
import { AccountAvatar } from './parts';
import { accountName, accountState, firstSyncLine, includedIds, modeWords, runSync, syncAgo, syncAt, syncSummary, useSharedSync, type SyncSummary } from './sync';
import type { MailPrefs, Mailbox, SyncAccount } from './types';
import type { MailBodiesProgress, MailStoreStats } from '@shared/types';
import { SyncButton } from '../../components/SyncButton';
import { SyncLog } from './SyncLog';
import { SyncFolders } from './SyncFolders';
import { useMailStats } from './api';

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

/** "1.4 MB". */
export function sizeWords(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/**
 * An account's progress in one line (#190): "Headers 12 of 27 folders ·
 * Bodies 340 of 1,200 · 18.2 MB on this computer". Headers come from the
 * server's sync; bodies and size are what this computer has downloaded for
 * reading offline. Folders the server leaves alone — not mail, or turned off
 * — are counted apart (#286): "Headers: all 16 folders · 11 not synced".
 */
export function progressWords(a: Pick<SyncAccount, 'folders' | 'folders_done' | 'mirror' | 'folders_skipped'> | null, bodies: MailBodiesProgress | undefined, bytes: number | undefined): string {
  const parts: string[] = [];
  if (a?.mirror && a.folders > 0) parts.push(a.folders_done >= a.folders ? text('Headers: all {n} folders', { n: a.folders.toLocaleString() }) : text('Headers {done} of {n} folders', { done: a.folders_done.toLocaleString(), n: a.folders.toLocaleString() }));
  if (a?.mirror && a.folders_skipped) parts.push(text('{n} not synced', { n: a.folders_skipped.toLocaleString() }));
  if (bodies && bodies.wanted > 0) parts.push(text('Bodies {done} of {n}', { done: Math.min(bodies.stored, bodies.wanted).toLocaleString(), n: bodies.wanted.toLocaleString() }));
  else if (bodies && bodies.running) parts.push(text('Bodies: looking for new mail…'));
  if (bytes !== undefined) parts.push(text('{size} on this computer', { size: sizeWords(bytes) }));
  return parts.join(' · ');
}

/** Any body download going on: Settings then refreshes the numbers every few seconds. */
export function downloading(stats: MailStoreStats | null | undefined): boolean {
  return Object.values(stats?.bodies ?? {}).some((b) => b.running);
}

/** "Today 08:42 (6 min ago)". */
function okWords(stamp: string | null): string {
  if (!stamp) return text('Never');
  return `${syncAt(stamp)} (${syncAgo(stamp)})`;
}

/**
 * "08:47 · Success", "In progress · 2 of 9 folders", "08:40 · Failed — Google sign-in expired" — and while the
 * first sync runs, "First sync · headers 12 of 21 folders · started 1:20 · about 4 min left" (#286).
 */
export function attemptWords(a: SyncAccount): { label: string; tone: 'success' | 'danger' | 'muted' } {
  if (a.running) return { label: firstSyncLine(a) ?? (a.folders ? text('In progress · {done} of {n} folders', { done: a.folders_done, n: a.folders }) : text('In progress')), tone: 'muted' };
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
  // What this computer keeps, per account, kept current while it downloads (#190).
  const stats = useMailStats(true, true);
  const [log, setLog] = useState<Mailbox | null>(null);
  const [folders, setFolders] = useState<Mailbox | null>(null);
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
          const progress = progressWords(a, stats.data?.bodies?.[String(b.id)], stats.data ? (stats.data.byMailbox[String(b.id)]?.bytes ?? 0) : undefined);
          const behind = !running && !failed && (a?.last_result === 'partial' || (a?.mirror && a.folders > 0 && a.folders_done < a.folders));
          return (
            <li key={b.id} aria-label={b.email} className={cx('rounded-[12px] border bg-surface p-4', failed ? 'border-danger/40 bg-danger-bg/30' : 'border-line')}>
              <div className="flex items-center gap-3">
                <AccountAvatar letter={mailboxLetter(b)} colour={b.colour} size={32} className="rounded-[8px]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-bold text-ink">{a ? accountName(a, b) : b.email}</span>
                  <span className="block truncate text-[12.5px] text-ink-3">{b.email}</span>
                </span>
                <Chip tone={failed ? 'danger' : running ? 'indigo' : a?.paused || behind ? 'warning' : 'success'}>{failed ? text('Sync failed') : running ? (a?.first_sync ? text('First sync') : text('Syncing…')) : a?.paused ? text('Paused') : behind ? text('Partly synced') : text('Up to date')}</Chip>
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
                {/* Which folders are synced, and how far each has got — from a server that says (#286). */}
                {a?.mirror && a.first_sync !== undefined ? <Button onClick={() => setFolders(b)}>{text('Folders')}</Button> : null}
                {onManage ? <Button onClick={() => onManage(b)}>{text('Manage')}</Button> : null}
              </div>
              {progress ? (
                <p aria-label={text('Progress')} className="mt-2 text-[12.5px] text-ink-2">
                  {progress}
                </p>
              ) : null}
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
      {folders ? <SyncFolders box={folders} onClose={() => setFolders(null)} /> : null}
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

/** For other screens: an account's state in a word. */
export { accountState, modeWords };
