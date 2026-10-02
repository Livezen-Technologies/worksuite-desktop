import { useQueryClient } from '@tanstack/react-query';
import { apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { dateLabel, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Chip, Empty, ErrorNote, Spinner } from '../../components/ui';
import { useOutbox } from './api';

/** Scheduled: messages the server will send later (Send later), each with Cancel while it waits. */
export function ScheduledList({ active }: { active: boolean }) {
  const qc = useQueryClient();
  const q = useOutbox(active);
  const rows = q.data?.messages ?? [];
  const cancel = async (id: number) => {
    try {
      await apiPost(`/api/mail/outbox/${id}/cancel`);
      void qc.invalidateQueries({ queryKey: ['mail'] });
      toast('success', text('Cancelled — it will not be sent.'));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const retry = async (id: number) => {
    try {
      await apiPost(`/api/mail/outbox/${id}/retry`);
      void qc.invalidateQueries({ queryKey: ['mail', 'outbox'] });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <section aria-label="Scheduled" className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
      <div className="border-b border-line px-4 py-3">
        <h1 className="text-[19px] font-bold text-ink">Scheduled</h1>
        <p className="text-[12.5px] text-ink-3">Sent by the WorkSuite server at the time chosen, so this computer can be off.</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        {q.isLoading ? <Spinner /> : q.error ? <div className="p-4"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div> : rows.length === 0 ? <Empty icon="clock" title={text('Nothing scheduled')} hint={text('Choose Send later when you write an email.')} /> : null}
        <ul role="list">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 border-b border-line px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold text-ink">{r.subject || text('(no subject)')}</span>
                <span className="block truncate text-[12.5px] text-ink-3">{text('To {list}', { list: r.to.join(', ') })}</span>
                {r.error ? <span className="block truncate text-[12px] text-danger">{r.error}</span> : null}
              </span>
              <span className="shrink-0 text-[12.5px] text-ink-2">{`${dateLabel(r.send_at)} · ${timeLabel(r.send_at)}`}</span>
              <Chip tone={r.status === 'failed' ? 'danger' : r.status === 'sent' ? 'success' : r.status === 'cancelled' ? 'muted' : 'indigo'}>{r.status === 'queued' ? text('Waiting') : r.status === 'sending' ? text('Sending') : r.status === 'sent' ? text('Sent') : r.status === 'failed' ? text('Failed') : text('Cancelled')}</Chip>
              {r.status === 'queued' ? (
                <button type="button" onClick={() => void cancel(r.id)} className="h-8 rounded-[8px] border border-line px-3 text-[12.5px] font-semibold text-ink hover:bg-subtle">
                  Cancel
                </button>
              ) : r.status === 'failed' ? (
                <button type="button" onClick={() => void retry(r.id)} className="h-8 rounded-[8px] border border-line px-3 text-[12.5px] font-semibold text-ink hover:bg-subtle">
                  Retry
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
