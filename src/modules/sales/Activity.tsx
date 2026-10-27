import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { timeLabel, todayInZone } from '../../core/time';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, Empty, input, PageHead } from '../../components/PageKit';
import { byDay, eventName, eventTone, fetchActivity, KM } from './manage';

/**
 * Activity (OmsActivity): every change to every order, newest first, a
 * section per day on the reader's own clock. The filters' counts are over
 * everything, not the filtered set, so the value you want to switch to is
 * still there to pick. It refreshes itself every minute.
 */
export default function Activity({ org, onOpen }: { org: string; onOpen: (id: number) => void }) {
  const [type, setType] = useState('');
  const [actor, setActor] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  // A company change narrows the feed; the page you were on may be past its end.
  const [seenOrg, setSeenOrg] = useState(org);
  if (seenOrg !== org) {
    setSeenOrg(org);
    setPage(1);
  }
  const f = { type, actor, q: q.trim(), page };
  const feed = useQuery({ queryKey: KM.activity(org, f), queryFn: ({ signal }) => fetchActivity(org, f, signal), refetchInterval: 60_000, placeholderData: keepPreviousData });
  const d = feed.data;
  const days = byDay(d?.rows ?? [], todayInZone());
  const narrowed = !!(type || actor || q);
  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Activity" sub={<>Every change to every order, newest first{d ? <> · <span className="tabular-nums">{d.total.toLocaleString()}</span> in all</> : null}</>}>
        <button type="button" className={btn} onClick={() => void feed.refetch()} disabled={feed.isFetching}>
          <Icon name="refresh" size={14} className={cx(feed.isFetching && 'animate-spin')} /> Refresh
        </button>
      </PageHead>
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => reset(() => setQ(e.target.value))} placeholder="Order number, customer or wording" aria-label="Search activity" className={input + ' !w-[280px]'} />
        <Select<string>
          aria-label="Kind of event"
          searchable
          value={type}
          onValueChange={(v) => reset(() => setType(v))}
          options={[{ value: '', label: 'Anything' }, ...(d?.types ?? []).map((t) => ({ value: t.value, label: eventName(t.value), hint: `${t.count.toLocaleString()} recorded` }))]}
          className={input + ' !w-[220px]'}
        />
        <Select<string>
          aria-label="Who did it"
          searchable
          value={actor}
          onValueChange={(v) => reset(() => setActor(v))}
          options={[{ value: '', label: 'Anyone' }, ...(d?.actors ?? []).map((a) => ({ value: a.id, label: a.name, hint: `${a.count.toLocaleString()} ${a.count === 1 ? 'action' : 'actions'}` }))]}
          className={input + ' !w-[220px]'}
        />
        {narrowed ? (
          <button type="button" className={btn} onClick={() => reset(() => (setType(''), setActor(''), setQ('')))}>
            Clear
          </button>
        ) : null}
      </div>

      {feed.isLoading ? (
        <Spinner />
      ) : feed.error ? (
        <ErrorNote error={feed.error} onRetry={() => void feed.refetch()} />
      ) : !days.length ? (
        <div className="rounded-[12px] border border-line bg-surface">
          <Empty text={narrowed ? 'Nothing matches those filters.' : 'Nothing has happened to any order yet.'} />
        </div>
      ) : (
        <>
          {days.map((day) => (
            <section key={day.key} aria-label={day.label} className="overflow-hidden rounded-[12px] border border-line bg-surface">
              <div className="border-b border-line/70 px-3.5 py-[9px] font-bold text-ink">{day.label}</div>
              {day.rows.map((e) => (
                <div key={e.id} data-event={e.type} className="flex items-center gap-3 border-b border-line/50 px-3.5 py-2 text-[12.5px] last:border-b-0">
                  <span className="w-[54px] shrink-0 text-[12px] text-ink-3 tabular-nums">{e.at ? timeLabel(e.at) : '—'}</span>
                  {e.order_id && e.number ? (
                    <button type="button" className="w-[118px] shrink-0 truncate text-left font-bold text-primary hover:underline" onClick={() => onOpen(e.order_id!)}>
                      {e.number}
                    </button>
                  ) : (
                    <span className="w-[118px] shrink-0 truncate font-bold text-ink-3">{e.number ?? '—'}</span>
                  )}
                  <span className={cx('shrink-0 rounded-[10px] px-2 py-0.5 text-[11.5px] font-bold whitespace-nowrap', eventTone(e.type))}>{eventName(e.type)}</span>
                  <span className="min-w-0 flex-1 truncate text-ink" title={e.description ?? undefined}>
                    {e.description}
                    {e.client ? <span className="text-ink-3"> · {e.client}</span> : null}
                  </span>
                  <span className="max-w-[160px] shrink-0 truncate text-[12px] text-ink-3">{e.user ?? 'System'}</span>
                </div>
              ))}
            </section>
          ))}
          {(d?.pages ?? 1) > 1 ? (
            <div className="flex items-center justify-center gap-2.5">
              <button type="button" className={btn} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Newer
              </button>
              <span className="text-[12.5px] text-ink-2 tabular-nums">
                Page {page} of {d?.pages}
              </span>
              <button type="button" className={btn} disabled={page >= (d?.pages ?? 1)} onClick={() => setPage((p) => p + 1)}>
                Older
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
