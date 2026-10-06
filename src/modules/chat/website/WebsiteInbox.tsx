import { useEffect, useState } from 'react';
import { app } from '../../../core/app-state';
import { useStore } from '../../../core/store';
import { useTab } from '../../../core/tab-context';
import { duration, listStamp, parseTs } from '../../../core/time';
import { Icon } from '../../../components/Icon';
import { Avatar, Empty, ErrorNote, Spinner, cx } from '../../../components/ui';
import { filterRows, sortRows, useWebsiteClosed, useWebsiteInbox, WEBSITE_FILTERS, type WebsiteFilter, type WebsiteRow } from './api';

/** The website-chat list in the Chat rail: waiting first, then mine, all open, closed. */
export function WebsiteInbox({ selected, q }: { selected: string | null; q: string }) {
  const { go } = useTab();
  const me = useStore(app, (s) => (s.auth?.user?.id ? Number(s.auth.user.id) : null));
  const [filter, setFilter] = useState<WebsiteFilter>('waiting');
  const open = useWebsiteInbox(false);
  // The latest closed chats, a page of list fields (#252).
  const closed = useWebsiteClosed(filter === 'closed');
  const source = filter === 'closed' ? closed : open;
  const openRows = open.data?.conversations ?? [];
  const counts: Record<WebsiteFilter, number> = {
    waiting: filterRows(openRows, 'waiting', me).length,
    mine: filterRows(openRows, 'mine', me).length,
    open: openRows.length,
    closed: 0,
  };
  const now = useMinuteClock();
  const needle = q.trim().toLowerCase();
  const rows = sortRows(filterRows(source.data?.conversations ?? [], filter, me), filter).filter(
    (r) => !needle || [r.label, r.visitor_name, r.email, r.site, r.current_url].some((v) => v?.toLowerCase().includes(needle)),
  );

  return (
    <>
      <div className="flex gap-1 px-3 pb-2" role="tablist" aria-label="Website chats">
        {WEBSITE_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={cx('flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold', filter === f.id ? 'bg-ink text-surface' : 'text-ink-2 hover:bg-subtle')}
          >
            {f.label}
            {f.id !== 'closed' && counts[f.id] ? <span className={cx('rounded-full px-1.5 text-[11px]', f.id === 'waiting' ? 'bg-danger text-white' : 'bg-subtle text-ink-2')}>{counts[f.id]}</span> : null}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        {source.isLoading ? <Spinner /> : source.error ? <div className="p-4"><ErrorNote error={source.error} onRetry={() => void source.refetch()} /></div> : null}
        {!source.isLoading && !source.error && rows.length === 0 ? (
          <Empty icon="globe" title={filter === 'waiting' ? 'Nobody is waiting' : filter === 'mine' ? 'No chats assigned to you' : 'No website chats'} />
        ) : null}
        {rows.map((r) => (
          <Row key={r.id} r={r} now={now} active={String(r.id) === selected} onClick={() => go(`/chat?website=${r.id}`)} />
        ))}
      </div>
    </>
  );
}

/** Re-renders once a minute, so "waiting 4 min" keeps counting. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(h);
  }, []);
  return now;
}

function Row({ r, now, active, onClick }: { r: WebsiteRow; now: number; active: boolean; onClick: () => void }) {
  const name = r.visitor_name || r.label;
  return (
    <button type="button" onClick={onClick} className={cx('flex w-full items-center gap-3 px-4 py-3 text-left', active ? 'bg-selection' : 'hover:bg-subtle')}>
      <span className="relative">
        <Avatar name={name} size={40} />
        <span className={cx('absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-surface', r.online ? 'bg-success' : 'bg-line')} aria-label={r.online ? 'On the site now' : 'Left the site'} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={cx('flex-1 truncate text-[14px]', r.awaiting_reply ? 'font-bold text-ink' : 'font-semibold text-ink')}>{name}</span>
          <span className="shrink-0 text-[12px] text-ink-3">{listStamp(r.last_visitor_at ?? r.updated_at)}</span>
        </span>
        <span className="flex items-center gap-1.5 text-[12.5px] text-ink-3">
          <Icon name="globe" size={12} />
          <span className="truncate">{r.site ?? r.widget ?? 'Website'}</span>
          {r.is_starred ? <Icon name="star" size={12} className="text-warning" /> : null}
        </span>
        <span className="flex items-center gap-1.5 text-[12px]">
          {r.awaiting_reply ? (
            <span className={cx('font-semibold', r.at_risk ? 'text-danger' : 'text-warning')}>
              {r.assigned_to === null ? 'Unassigned · ' : ''}waiting{r.waiting_since ? ` ${duration(Math.max(60, (now - parseTs(r.waiting_since).getTime()) / 1000))}` : ''}
            </span>
          ) : r.status === 'closed' ? (
            <span className="text-ink-3">Closed</span>
          ) : (
            <span className="truncate text-ink-3">{r.agent ? `With ${r.agent}` : 'Open'}</span>
          )}
        </span>
      </span>
    </button>
  );
}
