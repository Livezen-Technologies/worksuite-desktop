import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { apiGet, apiPost } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Button, ErrorNote, Spinner, cx } from '../../components/ui';
import { mailboxLetter } from './model';
import { AccountAvatar } from './parts';
import { accountName, firstSyncLine, syncAt } from './sync';
import type { FetchErrorGroup, FolderSyncState, Mailbox, SyncAccount, SyncRun, SyncRunFolder } from './types';

/**
 * The sync log (D18, DMO-SYN-10; worksuite-desktop#190): one row per run —
 * Started · Took · Result · folders done of total · added · updated ·
 * removed · bodies downloaded · errors — each expandable to what happened to
 * every folder, with its error in full. Nothing is cut off: the panel is
 * wide, the table scrolls sideways when it must, and the details wrap.
 * Copy log and Export give support the same text.
 *
 * From a server that says each folder's state (#286) a run's folders come in
 * groups — errors, downloading, waiting, then up to date and skipped folded
 * away — rather than 27 rows of "More to download"; a batch of the first
 * sync reads "First sync", not "Partial". An older server's runs show as
 * before.
 */

/** A run's result in a word: a first sync's batch without an error is "First sync", not "Partial" (#286). */
export function resultWord(result: string, phase?: string | null, errors = 0): string {
  if (result === 'ok') return text('Success');
  if (result === 'failed') return text('Failed');
  if (result === 'running') return text('Running');
  if (phase === 'first_sync' && errors === 0) return text('First sync');
  return text('Partial');
}

function resultTone(result: string, phase?: string | null, errors = 0): string {
  if (result === 'partial' && phase === 'first_sync' && errors === 0) return 'text-primary';
  return result === 'failed' ? 'text-danger' : result === 'ok' ? 'text-success' : result === 'running' ? 'text-primary' : 'text-warning';
}

export function took(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

/** "Downloading 250 of 1,200" — the headers of its window held, and the messages in it. */
function downloadingWord(f: Pick<SyncRunFolder, 'have' | 'want'>): string {
  return typeof f.want === 'number' && typeof f.have === 'number' ? text('Downloading {n} of {total}', { n: f.have.toLocaleString(), total: f.want.toLocaleString() }) : text('Downloading');
}

/** Why a folder is not synced, in words. */
export function skippedWord(f: Pick<SyncRunFolder, 'reason'>): string {
  return f.reason === 'off' ? text('Skipped (turned off)') : text('Skipped (not a mail folder)');
}

/**
 * A folder's state in words: Up to date · Downloading N of M · Waiting · Error · Skipped from a server that says
 * (#286); otherwise from what the run did, as before.
 */
export function folderWord(f: SyncRunFolder): string {
  if (f.state === 'up_to_date') return text('Up to date');
  if (f.state === 'downloading') return downloadingWord(f);
  if (f.state === 'waiting') return text('Waiting for its turn');
  if (f.state === 'error') return text('Error');
  if (f.state === 'skipped' || f.status === 'skipped') return skippedWord(f);
  if (f.status === 'error') return text('Failed');
  if (f.status === 'pending') return text('More to download');
  if (f.status === 'not_reached') return text('Not reached in this run');
  if (f.note === 'unchanged') return text('No changes');
  return text('Synced');
}

/** The groups a run's folders come in (#286), in the order shown; up to date and skipped start folded away. */
export const FOLDER_GROUPS: ReadonlyArray<{ state: FolderSyncState; label: string; open: boolean; tone: string }> = [
  { state: 'error', label: 'Errors', open: true, tone: 'text-danger' },
  { state: 'downloading', label: 'Downloading', open: true, tone: 'text-primary' },
  { state: 'waiting', label: 'Waiting', open: true, tone: 'text-ink-2' },
  { state: 'up_to_date', label: 'Up to date', open: false, tone: 'text-success' },
  { state: 'skipped', label: 'Skipped', open: false, tone: 'text-ink-3' },
];

/** A run's folders by state, when the server says each one's (#286); null for a run from an older server. */
export function folderGroups(details: SyncRunFolder[]): Array<{ state: FolderSyncState; label: string; open: boolean; tone: string; folders: SyncRunFolder[] }> | null {
  if (!details.length || !details.every((d) => typeof d.state === 'string')) return null;
  return FOLDER_GROUPS.map((g) => ({ ...g, folders: details.filter((d) => d.state === g.state) })).filter((g) => g.folders.length > 0);
}

function errorsOf(r: SyncRun): number {
  return r.errors ?? (r.details ?? []).filter((d) => d.status === 'error').length;
}

/** The log as plain text, one run a line and its folders under it — for Copy log and Export. */
export function logText(email: string, runs: SyncRun[]): string {
  const lines = [`${email} — ${text('sync log')}`, ['Started', 'Took', 'Result', 'Folders', 'Added', 'Updated', 'Removed', 'Bodies', 'Errors', 'Details'].join('\t')];
  for (const r of runs) {
    lines.push([r.started_at ?? '', took(r.duration_ms), resultWord(r.result, r.phase, errorsOf(r)), `${r.folders}/${r.folders_total}`, r.added, r.changed, r.removed, r.bodies ?? 0, errorsOf(r), r.error ?? ''].join('\t'));
    for (const f of r.details ?? []) {
      lines.push(`\t${f.folder}${f.role ? ` (${f.role})` : ''}: ${folderWord(f)} · +${f.added} ~${f.changed} -${f.removed}${f.ms !== undefined ? ` · ${took(f.ms)}` : ''}${f.error ? ` — ${f.error}` : ''}`);
    }
  }
  return lines.join('\n');
}

/**
 * "Syncing · headers 2 of 27 folders · started 11:20" (#228), while a pass is going — or, on a first sync,
 * "First sync · headers 12 of 21 folders · started 1:20 · about 4 min left" (#286).
 */
export function syncingLine(a: SyncAccount): string | null {
  if (!a.running) return null;
  const first = firstSyncLine(a);
  if (first) return first;
  const parts = [text('Syncing')];
  if (a.folders && a.complete === false) parts.push(text('headers {done} of {n} folders', { done: a.folders_done, n: a.folders }));
  if (a.running_since) parts.push(text('started {time}', { time: timeLabel(a.running_since) }));
  return parts.join(' · ');
}

/** "Waiting for a free connection × 23 · last 11:32" (#228). */
export function errorLine(g: FetchErrorGroup): string {
  return `${g.label} × ${g.hits}${g.last_at ? ` · ${text('last {time}', { time: timeLabel(g.last_at) })}` : ''}`;
}

export function SyncLog({ box, account, onClose, onRepair }: { box: Mailbox; account: SyncAccount | null; onClose: () => void; onRepair: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['mail', 'sync-log', box.id],
    queryFn: () => apiGet<{ runs: SyncRun[]; account: SyncAccount; fetch_errors?: FetchErrorGroup[] }>(`/api/mail/mailboxes/${box.id}/sync-log`),
    // While a run is going its row fills in.
    refetchInterval: (query) => ((query.state.data?.runs ?? []).some((r) => r.result === 'running') ? 3_000 : false),
  });
  const runs = q.data?.runs ?? [];
  const a = q.data?.account ?? account;
  // Messages that could not be opened, apart from the runs (#228).
  const errorGroups = q.data?.fetch_errors ?? [];
  const errorCount = errorGroups.reduce((n, g) => n + g.messages, 0);
  const [tab, setTab] = useState<'runs' | 'errors'>('runs');
  const [busy, setBusy] = useState(false);
  const retryAll = async () => {
    setBusy(true);
    try {
      await apiPost(`/api/mail/mailboxes/${box.id}/fetch-errors/retry`, {});
      toast('success', text('Cleared. They will be fetched again when opened.'));
      void qc.invalidateQueries({ queryKey: ['mail', 'sync-log', box.id] });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const failed = a?.last_result === 'failed';
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const toggle = (id: number) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(logText(box.email, runs));
      toast('success', text('Sync log copied.'));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const save = async () => {
    try {
      const where = await call('files:saveText', { name: `WorkSuite sync log ${box.id}.txt`, text: logText(box.email, runs).slice(0, 64_000) });
      if (where) toast('success', text('Sync log saved.'));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const head = 'whitespace-nowrap py-1.5 pr-3 font-semibold';
  const num = 'whitespace-nowrap py-1.5 pr-3 text-right tabular-nums text-ink-2';
  return (
    <div role="dialog" aria-modal="true" aria-label={text('Sync log · {email}', { email: box.email })} className="fixed inset-y-0 right-0 z-50 flex w-[780px] max-w-full flex-col border-l border-line bg-surface shadow-2xl">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <AccountAvatar letter={mailboxLetter(box)} colour={box.colour} size={24} />
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[14px] text-ink">{text('Sync log · {name}', { name: a ? accountName(a, box) : box.email })}</b>
          <span className="block truncate text-[12px] text-ink-3">{(a ? syncingLine(a) : null) ?? text('{email} · last {n} runs', { email: box.email, n: runs.length })}</span>
        </span>
        <button type="button" onClick={onClose} aria-label={text('Close')} className="h-8 w-8 rounded-[8px] text-ink-3 hover:bg-subtle hover:text-ink">
          ×
        </button>
      </header>
      {failed && a ? <p className="m-4 mb-0 rounded-[8px] border border-danger/40 bg-danger-bg p-3 text-[12.5px] text-danger">{text('Last attempt failed {time} — {why}. Last success {ok}.', { time: a.last_attempt_at ? timeLabel(a.last_attempt_at) : '', why: a.error ?? '', ok: a.last_ok_at ? syncAt(a.last_ok_at) : text('never') })}</p> : null}
      {q.data?.fetch_errors ? (
        <div role="tablist" aria-label={text('Sync log')} className="flex gap-1 border-b border-line px-4 pt-2 text-[12.5px] font-semibold">
          {(['runs', 'errors'] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx('rounded-t-[6px] px-3 py-1.5', tab === t ? 'border-b-2 border-primary text-primary' : 'text-ink-2 hover:text-ink')}>
              {t === 'runs' ? text('Sync runs') : errorCount ? text('Fetch errors · {n}', { n: errorCount }) : text('Fetch errors')}
            </button>
          ))}
        </div>
      ) : null}
      {tab === 'errors' ? (
        <div className="min-h-0 flex-1 overflow-auto p-4 scroll-thin" role="tabpanel" aria-label={text('Fetch errors')}>
          {errorGroups.length === 0 ? <p className="text-[13px] text-ink-3">{text('Every email that was opened could be read.')}</p> : null}
          <ul className="flex flex-col gap-2">
            {errorGroups.map((g) => (
              <li key={g.kind} className="rounded-[8px] border border-line p-2.5">
                <b className="block text-[12.5px] text-ink">{errorLine(g)}</b>
                <span className="block text-[11.5px] text-ink-3">{text('{n} emails', { n: g.messages })}</span>
                <ul className="mt-1.5 flex flex-col gap-0.5 font-mono text-[11.5px] text-ink-2" aria-label={text('Emails')}>
                  {g.items.map((i) => (
                    <li key={`${i.folder}:${i.uid}`} className="break-words">
                      {i.folder} · UID {i.uid} · UIDVALIDITY {i.uidvalidity ?? '-'} · Message-ID {i.message_id ?? '-'}{i.hits > 1 ? ` · ×${i.hits}` : ''}
                      {/* A failed action (Delete, Undo — worksuite-desktop#235): what the server answered. */}
                      {g.kind.startsWith('act_') && i.response ? ` · ${text('Server')}: ${i.response}` : ''}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className={cx('min-h-0 flex-1 overflow-auto p-4 scroll-thin', tab === 'errors' && 'hidden')}>
        {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : runs.length === 0 ? <p className="text-[13px] text-ink-3">{text('No runs recorded yet.')}</p> : null}
        {runs.length ? (
          <table className="w-full min-w-[700px] text-left text-[12px]">
            <thead className="text-ink-3">
              <tr>
                <th className={head}>{text('Started')}</th>
                <th className={head}>{text('Took')}</th>
                <th className={head}>{text('Result')}</th>
                <th className={cx(head, 'text-right')}>{text('Folders')}</th>
                <th className={cx(head, 'text-right')}>{text('Added')}</th>
                <th className={cx(head, 'text-right')}>{text('Updated')}</th>
                <th className={cx(head, 'text-right')}>{text('Removed')}</th>
                <th className={cx(head, 'text-right')}>{text('Bodies')}</th>
                <th className={cx(head, 'text-right')}>{text('Errors')}</th>
                <th className={head}>
                  <span className="sr-only">{text('Details')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const expanded = open.has(r.id);
                const details = r.details ?? [];
                const groups = expanded ? folderGroups(details) : null;
                const errors = errorsOf(r);
                return (
                  <Fragment key={r.id}>
                    <tr className="border-t border-line align-top" aria-label={text('Run started {time}', { time: r.started_at ? syncAt(r.started_at) : '' })}>
                      <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-ink">{r.started_at ? syncAt(r.started_at) : ''}</td>
                      <td className="whitespace-nowrap py-1.5 pr-3 text-ink-2">{took(r.duration_ms)}</td>
                      <td className={cx('whitespace-nowrap py-1.5 pr-3 font-semibold', resultTone(r.result, r.phase, errors))}>{resultWord(r.result, r.phase, errors)}</td>
                      <td className={num}>{text('{done} of {n}', { done: r.folders, n: r.folders_total })}</td>
                      <td className={num}>+{r.added}</td>
                      <td className={num}>{r.changed}</td>
                      <td className={num}>{r.removed}</td>
                      <td className={num}>{r.bodies ?? 0}</td>
                      <td className={cx(num, errors ? 'font-semibold text-danger' : '')}>{errors}</td>
                      <td className="py-1.5 text-right">
                        {details.length || r.error ? (
                          <button type="button" aria-expanded={expanded} onClick={() => toggle(r.id)} className="whitespace-nowrap rounded-[6px] px-1.5 text-[12px] font-semibold text-primary hover:bg-subtle">
                            {expanded ? text('Hide') : text('Details')}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                    {r.error && !expanded ? (
                      <tr>
                        <td colSpan={10} className="whitespace-normal break-words pb-1.5 text-[12px] text-ink-2">
                          {r.error}
                        </td>
                      </tr>
                    ) : null}
                    {expanded ? (
                      <tr>
                        <td colSpan={10} className="pb-2">
                          {r.error ? <p className="mb-1.5 whitespace-normal break-words rounded-[6px] bg-subtle p-2 text-[12px] text-ink">{r.error}</p> : null}
                          {groups ? (
                            <FolderGroups groups={groups} />
                          ) : (
                            <ul role="list" aria-label={text('Folders in this run')} className="flex flex-col gap-0.5">
                              {details.map((f) => (
                                <FolderRow key={f.path} f={f} tone={f.status === 'error' ? 'text-danger' : f.status === 'ok' ? 'text-success' : 'text-warning'} />
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </div>
      <footer className="flex flex-wrap gap-2 border-t border-line p-3">
        {failed && box.auth_state === 'problem' ? (
          <Button variant="primary" onClick={onRepair}>
            {text('Sign in again')}
          </Button>
        ) : null}
        {tab === 'errors' && errorGroups.length ? (
          <Button variant="primary" disabled={busy} onClick={() => void retryAll()}>
            {text('Retry all')}
          </Button>
        ) : null}
        <Button onClick={() => void copy()}>{text('Copy log for support')}</Button>
        <Button onClick={() => void save()}>{text('Export…')}</Button>
        <span className="flex-1" />
        <Button onClick={onClose}>{text('Close')}</Button>
      </footer>
    </div>
  );
}

/** One folder's line in a run: its name and role, its state, what it added, changed and removed, and its error in full. */
function FolderRow({ f, tone }: { f: SyncRunFolder; tone: string }) {
  return (
    <li className="grid grid-cols-[minmax(120px,1.2fr)_minmax(110px,1fr)_auto] gap-x-3 rounded-[6px] px-2 py-1 even:bg-subtle/60">
      <span className="min-w-0 break-words text-ink">
        {f.folder}
        {f.role ? <span className="text-ink-3"> · {f.role}</span> : null}
      </span>
      <span className={cx('font-semibold', tone)}>{folderWord(f)}</span>
      <span className="whitespace-nowrap text-right tabular-nums text-ink-2">
        +{f.added} · {f.changed} · −{f.removed}
        {f.ms !== undefined ? ` · ${took(f.ms)}` : ''}
      </span>
      {f.error ? <span className="col-span-3 whitespace-normal break-words text-[12px] text-danger">{f.error}</span> : null}
    </li>
  );
}

/**
 * A run's folders in groups (#286): errors, downloading and waiting open, each folder with its state in words;
 * up to date and skipped folded to a count that opens on a click.
 */
function FolderGroups({ groups }: { groups: NonNullable<ReturnType<typeof folderGroups>> }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(groups.filter((g) => g.open).map((g) => g.state)));
  const toggle = (state: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(state)) n.delete(state);
      else n.add(state);
      return n;
    });
  return (
    <div className="flex flex-col gap-1.5">
      {groups.map((g) => {
        const shown = open.has(g.state);
        const label = text(g.label);
        return (
          <section key={g.state} aria-label={label}>
            <button type="button" aria-expanded={shown} onClick={() => toggle(g.state)} className="flex w-full items-center gap-1.5 rounded-[6px] px-1 py-0.5 text-left text-[12px] font-semibold hover:bg-subtle">
              <span aria-hidden className="w-3 text-ink-3">
                {shown ? '▾' : '▸'}
              </span>
              <span className={g.tone}>{text('{group} · {n}', { group: label, n: g.folders.length })}</span>
            </button>
            {shown ? (
              <ul role="list" aria-label={text('Folders · {group}', { group: label })} className="mt-0.5 flex flex-col gap-0.5">
                {g.folders.map((f) => (
                  <FolderRow key={f.path} f={f} tone={g.tone} />
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
