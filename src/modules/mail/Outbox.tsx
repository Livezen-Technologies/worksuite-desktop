import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiPost } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { parseTs, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Chip, Empty, ErrorNote, Spinner } from '../../components/ui';
import type { OfflineMutation } from '@shared/types';
import { useOutbox, undoQueued } from './api';
import { queuedSends, type LocalDraft } from './allAccounts';
import type { ComposeSeed, OutboxRow } from './types';

/**
 * All Accounts › Outbox (DMO-ALL-08): what is waiting to go or failed —
 * sends in this computer's queue, and the server's outbox — but not the
 * scheduled ones, which stay in Scheduled. A failed item says why, with
 * Retry, Edit and Delete.
 */
export function OutboxView({ active, pending, onEdit }: { active: boolean; pending: OfflineMutation[]; onEdit: (seed: ComposeSeed) => void }) {
  const qc = useQueryClient();
  const q = useOutbox(active);
  const [now] = useState(() => Date.now());
  const server = (q.data?.messages ?? []).filter((r) => r.status === 'failed' || ((r.status === 'queued' || r.status === 'sending') && parseTs(r.send_at).getTime() <= now + 60_000));
  const local = queuedSends(pending);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['mail'] });
    void qc.invalidateQueries({ queryKey: ['offline'] });
  };
  const run = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      refresh();
      toast('success', done);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const editServer = (r: OutboxRow) => onEdit({ mode: 'new', to: r.to.join(', '), subject: r.subject });
  return (
    <section aria-label={text('Outbox')} className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
      <div className="border-b border-line px-4 py-3">
        <h1 className="text-[19px] font-bold text-ink">{text('All Accounts · Outbox')}</h1>
        <p className="text-[12.5px] text-ink-3">{text('Waiting to go or failed, from every account. Scheduled sends stay in Scheduled.')}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        {q.isLoading ? <Spinner /> : q.error ? <div className="p-4"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div> : null}
        {!q.isLoading && server.length === 0 && local.length === 0 ? <Empty icon="upload" title={text('Nothing waiting to send')} hint={text('Mail you send offline waits here until the connection returns.')} /> : null}
        <ul role="list" aria-label={text('Outbox')}>
          {local.map((m) => {
            const failed = m.state === 'FAILED' || m.state === 'CONFLICT';
            return (
              <li key={m.id} className="flex items-center gap-3 border-b border-line px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-ink">{m.label}</span>
                  <span className="block truncate text-[12.5px] text-ink-3">{text('On this computer · queued {time}', { time: timeLabel(m.createdAt) })}</span>
                  {failed ? <span className="block truncate text-[12px] text-danger">{m.error ?? text('The server refused it.')}</span> : null}
                </span>
                <Chip tone={failed ? 'danger' : 'indigo'}>{failed ? text('Failed') : m.state === 'SYNCING' ? text('Sending') : text('Waiting')}</Chip>
                {failed ? (
                  <button type="button" onClick={() => void run(() => call('offline:retry', { id: m.id }), text('Trying again.'))} className="h-8 rounded-[8px] border border-line px-3 text-[12.5px] font-semibold text-ink hover:bg-subtle">
                    {text('Retry')}
                  </button>
                ) : null}
                <button type="button" disabled={m.state === 'SYNCING'} onClick={() => void run(() => undoQueued(m.id), text('Deleted — it will not be sent.'))} className="h-8 rounded-[8px] border border-line px-3 text-[12.5px] font-semibold text-ink hover:bg-subtle disabled:opacity-40">
                  {text('Delete')}
                </button>
              </li>
            );
          })}
          {server.map((r) => (
            <li key={r.id} className="flex items-center gap-3 border-b border-line px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold text-ink">{r.subject || text('(no subject)')}</span>
                <span className="block truncate text-[12.5px] text-ink-3">{text('To {list}', { list: r.to.join(', ') })}</span>
                {r.error ? <span className="block truncate text-[12px] text-danger">{r.error}</span> : null}
              </span>
              <Chip tone={r.status === 'failed' ? 'danger' : 'indigo'}>{r.status === 'failed' ? text('Failed') : r.status === 'sending' ? text('Sending') : text('Waiting')}</Chip>
              {r.status === 'failed' ? (
                <>
                  <button type="button" onClick={() => void run(() => apiPost(`/api/mail/outbox/${r.id}/retry`), text('Trying again.'))} className="h-8 rounded-[8px] border border-line px-3 text-[12.5px] font-semibold text-ink hover:bg-subtle">
                    {text('Retry')}
                  </button>
                  <button type="button" onClick={() => editServer(r)} className="h-8 rounded-[8px] border border-line px-3 text-[12.5px] font-semibold text-ink hover:bg-subtle">
                    {text('Edit')}
                  </button>
                </>
              ) : null}
              {r.status !== 'sending' ? (
                <button type="button" onClick={() => void run(() => apiPost(`/api/mail/outbox/${r.id}/cancel`), text('Deleted — it will not be sent.'))} className="h-8 rounded-[8px] border border-line px-3 text-[12.5px] font-semibold text-ink hover:bg-subtle">
                  {text('Delete')}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Drafts kept only on this computer, above the server's drafts in All Accounts › Drafts (DMO-ALL-07). */
export function LocalDraftRows({ drafts, onOpen }: { drafts: LocalDraft[]; onOpen: (d: LocalDraft) => void }) {
  if (drafts.length === 0) return null;
  return (
    <ul role="list" aria-label={text('Drafts on this computer')} className="border-b border-line">
      {drafts.map((d) => (
        <li key={d.context}>
          <button type="button" onClick={() => onOpen(d)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-subtle">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-semibold text-ink">{d.subject || text('(no subject)')}</span>
              <span className="block truncate text-[12.5px] text-ink-3">{d.to ? text('To {list}', { list: d.to }) : text('No recipients yet')}</span>
            </span>
            <Chip tone="warning">{text('On this computer')}</Chip>
            <span className="shrink-0 text-[12px] text-ink-3">{timeLabel(d.updatedAt)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
