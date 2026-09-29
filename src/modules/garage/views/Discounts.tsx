import { useQuery } from '@tanstack/react-query';
import { dateLabel, timeLabel } from '../../../core/time';
import { ErrorNote, Spinner } from '../../../components/ui';
import { PageHead, Panel } from '../../hr/parts';
import { amount } from '../api';
import { fetchDiscountQueue, KB1 } from '../api-b1';
import type { GarageViewProps } from '../registry';

/**
 * Discounts waiting for me (stage B1): estimates held back because a line's
 * discount is above the sender's limit, where WorkSuite's approval chain asks
 * the reader. Each opens its job's estimate, where it is approved, returned
 * or rejected.
 */
export default function Discounts({ org, onJob }: GarageViewProps) {
  const q = useQuery({ queryKey: KB1.discounts(org), queryFn: ({ signal }) => fetchDiscountQueue(org, signal), refetchInterval: 60_000 });
  const items = q.data?.items ?? [];
  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      <PageHead title="Discounts to approve" sub={`${items.length} waiting for you`} />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      <Panel title="Waiting">
        {items.map((d) => (
          <button key={d.version_id} type="button" onClick={() => onJob(d.job_id, 'estimate')} className="flex w-full items-center gap-2.5 border-b border-line/70 px-3.5 py-2 text-left text-[12.5px] last:border-b-0 hover:bg-subtle">
            <b className="w-[120px] shrink-0 text-ink">{d.job_number}</b>
            <span className="min-w-0 flex-1 truncate text-ink-2">
              {d.label} · discount {amount(d.discount, d.currency)} (up to {Number(d.max_discount_pct)}%) of {amount(d.total, d.currency)}
            </span>
            <span className="text-ink-3">{[d.asked_by, d.asked_at ? `${dateLabel(d.asked_at)} ${timeLabel(d.asked_at)}` : null].filter(Boolean).join(' · ')}</span>
          </button>
        ))}
        {q.data && !items.length ? <div className="px-3.5 py-5 text-center text-[12.5px] text-ink-3">Nothing waits for you.</div> : null}
      </Panel>
    </div>
  );
}
