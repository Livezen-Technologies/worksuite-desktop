import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Empty, Spinner, cx } from '../../components/ui';
import { at, eGet, errorText, K, type Recent as Row } from './api';
import { useDeskStatus } from './desk';
import { Header, Refusal, toneOf, useEvent } from './parts';

/**
 * The latest scans (EV-POR-021 "Recent", EV-CHK-021): what, when, where, by
 * whom and whether online or offline — refused attempts included, flagged
 * ones marked. At this desk, or everywhere at the event.
 */
export default function Recent() {
  const { event, online } = useEvent();
  const status = useDeskStatus(event.id);
  const device = status.data?.registration?.device_id ?? null;
  const [here, setHere] = useState(true);
  const q = useQuery({
    queryKey: [...K.live(event.id), 'recent', here ? device : null],
    queryFn: ({ signal }) => eGet<{ items: Row[] }>(`/events/${event.id}/checkin/recent`, { device_id: here && device ? device : undefined, limit: 100 }, signal),
    enabled: online,
    refetchInterval: 15_000,
  });
  return (
    <div className="flex flex-col gap-3 pb-6">
      <Header
        title="Recent scans"
        sub="Newest first, refused attempts included"
        actions={
          device ? (
            <div className="flex gap-1">
              {[true, false].map((h) => (
                <button key={String(h)} type="button" aria-pressed={here === h} onClick={() => setHere(h)} className={cx('h-7 rounded-[7px] px-2.5 text-[12px] font-semibold', here === h ? 'bg-selection text-primary' : 'text-ink-2 hover:bg-subtle')}>
                  {h ? 'This desk' : 'Everywhere'}
                </button>
              ))}
            </div>
          ) : null
        }
      />
      <div className="px-6">
        {!online ? <p className="m-0 text-[13px] text-ink-3">The scans are WorkSuite’s record: they come back with the line. This desk’s offline scans are under To review.</p> : null}
        {q.isLoading ? <Spinner /> : null}
        {q.error ? <Refusal text={errorText(q.error)} /> : null}
        {q.data && q.data.items.length === 0 ? <Empty icon="history" title="No scans yet" /> : null}
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {q.data?.items.map((r) => {
            const tone = toneOf(r.colour);
            return (
              <li key={r.id} className="flex items-center gap-3 rounded-[10px] border border-line bg-surface px-3 py-2 text-[13px]">
                <Icon name={tone === 'success' ? (r.action === 'CHECK_OUT' ? 'logout' : 'log-in') : tone === 'warning' ? 'warning' : 'x-circle'} size={16} className={cx(tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-danger')} />
                <span className="w-[120px] shrink-0 font-semibold">{r.label}</span>
                <span className="min-w-0 flex-1 truncate">
                  {r.name ?? r.number ?? (r.provisional_number ? `Walk-in ${r.provisional_number}` : 'Unknown code')}
                  {r.number && r.name ? <span className="text-ink-3"> · {r.number}</span> : null}
                  {r.note ? <span className="text-ink-3"> — {r.note}</span> : null}
                </span>
                {r.flag ? <span className="shrink-0 rounded-[6px] bg-warning-bg px-1.5 text-[11px] font-semibold text-warning">{r.flag.replace(/_/g, ' ').toLowerCase()}</span> : null}
                <span className="shrink-0 text-[12px] text-ink-2">{r.gate?.name ?? 'no gate'}</span>
                <span className="shrink-0 text-[12px] text-ink-3">{r.source === 'OFFLINE' ? 'offline' : 'online'}</span>
                <span className="w-[110px] shrink-0 text-right text-[12px] text-ink-2">{at(r.at)}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
