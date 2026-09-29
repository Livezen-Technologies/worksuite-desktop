import { useQuery } from '@tanstack/react-query';
import { dateLabel, timeLabel } from '../../../core/time';
import { ErrorNote, Spinner } from '../../../components/ui';
import { Panel } from '../../hr/parts';
import { fetchTimeline } from '../api';
import type { JobTabProps } from '../registry';

/**
 * The job's timeline (FR-JOB-08, Figure C-3): every status change, note, file
 * and — as stage B writes them — approval, part, labour entry and invoice,
 * oldest first, as the server recorded them.
 */
export default function Activity({ job }: JobTabProps) {
  const q = useQuery({ queryKey: ['garage', 'timeline', job.id, job.version], queryFn: ({ signal }) => fetchTimeline(job.id, signal), placeholderData: (p) => p });
  const rows = q.data?.items ?? job.timeline;
  return (
    <Panel title="Activity" sub={`${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`}>
      {q.error ? (
        <div className="p-3">
          <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
        </div>
      ) : null}
      {q.isLoading && !rows.length ? <Spinner /> : null}
      <ol className="m-0 p-0" aria-label="Timeline">
        {rows.map((r) => (
          <li key={r.id} className="flex list-none gap-3 border-b border-line/70 px-3.5 py-2 text-[12.5px] last:border-b-0">
            <span className="w-[120px] shrink-0 text-ink-3 tabular-nums">{r.at ? `${dateLabel(r.at)} ${timeLabel(r.at)}` : ''}</span>
            <span className="min-w-0 flex-1 text-ink">{r.summary}</span>
            <span className="shrink-0 text-ink-3">{r.by?.name ?? ''}</span>
          </li>
        ))}
        {!rows.length && !q.isLoading ? <li className="list-none px-3.5 py-4 text-ink-3">Nothing recorded yet.</li> : null}
      </ol>
    </Panel>
  );
}
