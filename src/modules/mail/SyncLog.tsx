import { useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { apiGet } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Button, ErrorNote, Spinner, cx } from '../../components/ui';
import { mailboxLetter } from './model';
import { AccountAvatar } from './parts';
import { accountName, syncAt } from './sync';
import type { Mailbox, SyncAccount, SyncRun, SyncRunFolder } from './types';

/**
 * The sync log (D18, DMO-SYN-10; worksuite-desktop#190): one row per run —
 * Started · Took · Result · folders done of total · added · updated ·
 * removed · bodies downloaded · errors — each expandable to what happened to
 * every folder, with its error in full. Nothing is cut off: the panel is
 * wide, the table scrolls sideways when it must, and the details wrap.
 * Copy log and Export give support the same text.
 */

export function resultWord(result: string): string {
  if (result === 'ok') return text('Success');
  if (result === 'failed') return text('Failed');
  if (result === 'running') return text('Running');
  return text('Partial');
}

function resultTone(result: string): string {
  return result === 'failed' ? 'text-danger' : result === 'ok' ? 'text-success' : result === 'running' ? 'text-primary' : 'text-warning';
}

export function took(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

/** A folder's state in words. */
export function folderWord(f: SyncRunFolder): string {
  if (f.status === 'error') return text('Failed');
  if (f.status === 'pending') return text('More to download');
  if (f.status === 'not_reached') return text('Not reached in this run');
  if (f.note === 'unchanged') return text('No changes');
  return text('Synced');
}

function errorsOf(r: SyncRun): number {
  return r.errors ?? (r.details ?? []).filter((d) => d.status === 'error').length;
}

/** The log as plain text, one run a line and its folders under it — for Copy log and Export. */
export function logText(email: string, runs: SyncRun[]): string {
  const lines = [`${email} — ${text('sync log')}`, ['Started', 'Took', 'Result', 'Folders', 'Added', 'Updated', 'Removed', 'Bodies', 'Errors', 'Details'].join('\t')];
  for (const r of runs) {
    lines.push([r.started_at ?? '', took(r.duration_ms), resultWord(r.result), `${r.folders}/${r.folders_total}`, r.added, r.changed, r.removed, r.bodies ?? 0, errorsOf(r), r.error ?? ''].join('\t'));
    for (const f of r.details ?? []) {
      lines.push(`\t${f.folder}${f.role ? ` (${f.role})` : ''}: ${folderWord(f)} · +${f.added} ~${f.changed} -${f.removed}${f.ms !== undefined ? ` · ${took(f.ms)}` : ''}${f.error ? ` — ${f.error}` : ''}`);
    }
  }
  return lines.join('\n');
}

export function SyncLog({ box, account, onClose, onRepair }: { box: Mailbox; account: SyncAccount | null; onClose: () => void; onRepair: () => void }) {
  const q = useQuery({
    queryKey: ['mail', 'sync-log', box.id],
    queryFn: () => apiGet<{ runs: SyncRun[]; account: SyncAccount }>(`/api/mail/mailboxes/${box.id}/sync-log`),
    // While a run is going its row fills in.
    refetchInterval: (query) => ((query.state.data?.runs ?? []).some((r) => r.result === 'running') ? 3_000 : false),
  });
  const runs = q.data?.runs ?? [];
  const a = q.data?.account ?? account;
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
          <span className="block truncate text-[12px] text-ink-3">{text('{email} · last {n} runs', { email: box.email, n: runs.length })}</span>
        </span>
        <button type="button" onClick={onClose} aria-label={text('Close')} className="h-8 w-8 rounded-[8px] text-ink-3 hover:bg-subtle hover:text-ink">
          ×
        </button>
      </header>
      {failed && a ? <p className="m-4 mb-0 rounded-[8px] border border-danger/40 bg-danger-bg p-3 text-[12.5px] text-danger">{text('Last attempt failed {time} — {why}. Last success {ok}.', { time: a.last_attempt_at ? timeLabel(a.last_attempt_at) : '', why: a.error ?? '', ok: a.last_ok_at ? syncAt(a.last_ok_at) : text('never') })}</p> : null}
      <div className="min-h-0 flex-1 overflow-auto p-4 scroll-thin">
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
                const errors = errorsOf(r);
                return (
                  <Fragment key={r.id}>
                    <tr className="border-t border-line align-top" aria-label={text('Run started {time}', { time: r.started_at ? syncAt(r.started_at) : '' })}>
                      <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-ink">{r.started_at ? syncAt(r.started_at) : ''}</td>
                      <td className="whitespace-nowrap py-1.5 pr-3 text-ink-2">{took(r.duration_ms)}</td>
                      <td className={cx('whitespace-nowrap py-1.5 pr-3 font-semibold', resultTone(r.result))}>{resultWord(r.result)}</td>
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
                          <ul role="list" aria-label={text('Folders in this run')} className="flex flex-col gap-0.5">
                            {details.map((f) => (
                              <li key={f.path} className="grid grid-cols-[minmax(120px,1.2fr)_minmax(110px,1fr)_auto] gap-x-3 rounded-[6px] px-2 py-1 even:bg-subtle/60">
                                <span className="min-w-0 break-words text-ink">
                                  {f.folder}
                                  {f.role ? <span className="text-ink-3"> · {f.role}</span> : null}
                                </span>
                                <span className={cx('font-semibold', f.status === 'error' ? 'text-danger' : f.status === 'ok' ? 'text-success' : 'text-warning')}>{folderWord(f)}</span>
                                <span className="whitespace-nowrap text-right tabular-nums text-ink-2">
                                  +{f.added} · {f.changed} · −{f.removed}
                                  {f.ms !== undefined ? ` · ${took(f.ms)}` : ''}
                                </span>
                                {f.error ? <span className="col-span-3 whitespace-normal break-words text-[12px] text-danger">{f.error}</span> : null}
                              </li>
                            ))}
                          </ul>
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
        <Button onClick={() => void copy()}>{text('Copy log for support')}</Button>
        <Button onClick={() => void save()}>{text('Export…')}</Button>
        <span className="flex-1" />
        <Button onClick={onClose}>{text('Close')}</Button>
      </footer>
    </div>
  );
}
