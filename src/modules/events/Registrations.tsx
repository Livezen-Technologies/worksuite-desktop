import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button, Empty, ErrorNote, Spinner, cx } from '../../components/ui';
import { at, eGet, money, type Paged, type Registration } from './api';
import { Header, useEvent } from './parts';
import { clickOnKey } from '../../components/press';

/**
 * The event's registrations, read at the desk (§5.4–5.9, §15.1's lists):
 * attendees, pending, confirmed, cancelled, waitlist and walk-ins, searched
 * by the server. Approving, moving and cancelling are the web's; a
 * registration opens to its detail, its ticket and its badge.
 */
const LISTS: Array<[string, string]> = [
  ['attendees', 'Attendees'],
  ['pending', 'Pending'],
  ['confirmed', 'Confirmed'],
  ['waitlist', 'Waitlist'],
  ['walkins', 'Walk-ins'],
  ['cancelled', 'Cancelled'],
  ['all', 'All'],
];

export default function Registrations({ list }: { list: string | null }) {
  const { event, may, online, open, go } = useEvent();
  const which = LISTS.some(([k]) => k === list) ? list! : 'attendees';
  const [q, setQ] = useState('');
  const [typed, setTyped] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => {
      setTyped(q.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const r = useQuery({
    queryKey: ['events', 'registrations', event.id, which, typed, page],
    queryFn: ({ signal }) => eGet<Paged<Registration>>(`/events/${event.id}/registrations`, { list: which, q: typed || undefined, page, per_page: 50, sort: 'name' }, signal),
    enabled: online && may('events.registration.view'),
  });
  const meta = r.data?.meta;

  return (
    <div className="flex flex-col gap-3 pb-6">
      <Header title="Registrations" sub={meta ? `${meta.total} in this list` : undefined} />
      <div className="flex flex-col gap-3 px-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            {LISTS.map(([k, label]) => (
              <button key={k} type="button" aria-pressed={which === k} onClick={() => go('registrations', k)} className={cx('h-7 rounded-[7px] px-2.5 text-[12px] font-semibold', which === k ? 'bg-selection text-primary' : 'text-ink-2 hover:bg-subtle')}>
                {label}
              </button>
            ))}
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email, number…" aria-label="Search registrations" className="ml-auto h-8 w-[260px] rounded-[8px] border border-line bg-surface px-2.5 text-[12.5px] text-ink outline-none focus:border-primary" />
        </div>
        {!online ? <p className="m-0 text-[13px] text-ink-3">Registrations are WorkSuite’s: they come back with the line.</p> : null}
        {r.isLoading ? <Spinner /> : null}
        {r.error ? <ErrorNote error={r.error} onRetry={() => void r.refetch()} /> : null}
        {r.data && r.data.items.length === 0 ? <Empty icon="list" title="Nobody in this list" /> : null}
        {r.data && r.data.items.length > 0 ? (
          <table className="w-full rounded-[12px] border border-line bg-surface text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] text-ink-3">
                <th className="px-3 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 font-semibold">Number</th>
                <th className="px-3 py-2 font-semibold">Ticket</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Payment</th>
                <th className="px-3 py-2 font-semibold">Registered</th>
              </tr>
            </thead>
            <tbody>
              {r.data.items.map((x) => (
                <tr tabIndex={0} onKeyDown={clickOnKey} key={x.id} onClick={() => open({ kind: 'registration', event: event.id, id: x.id })} className="cursor-pointer border-t border-line hover:bg-subtle">
                  <td className="px-3 py-1.5">
                    <b>{x.attendee?.name ?? '—'}</b>
                    {x.attendee?.company ? <span className="text-ink-3"> · {x.attendee.company}</span> : null}
                  </td>
                  <td className="px-3 py-1.5 font-mono">{x.number}</td>
                  <td className="px-3 py-1.5">{x.ticket?.name ?? '—'}</td>
                  <td className="px-3 py-1.5">{x.status_label}</td>
                  <td className="px-3 py-1.5">{x.payment_status ? `${x.payment_status.toLowerCase().replace(/_/g, ' ')}${x.price ? ` · ${money(x.price, x.currency)}` : ''}` : '—'}</td>
                  <td className="px-3 py-1.5 text-ink-2">{at(x.registered_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {meta && meta.pages > 1 ? (
          <div className="flex items-center justify-end gap-2 text-[12.5px] text-ink-2">
            <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span>
              Page {meta.page} of {meta.pages}
            </span>
            <Button size="sm" disabled={page >= meta.pages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
