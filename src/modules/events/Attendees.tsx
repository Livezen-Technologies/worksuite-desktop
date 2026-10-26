import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button, Empty, ErrorNote, Spinner } from '../../components/ui';
import { eGet, type Attendee, type Paged } from './api';
import { Header, useEvent } from './parts';
import { clickOnKey } from '../../components/press';

/**
 * The attendees of the events this person reaches in the event's company
 * (§7, `GET attendees?org=`), read at the desk; a profile shows their
 * registrations, check-ins and consents. Merging, erasure and consent
 * changes are the web's.
 */
export default function Attendees() {
  const { event, online, open } = useEvent();
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
    queryKey: ['events', 'attendees', event.org_id, typed, page],
    queryFn: ({ signal }) => eGet<Paged<Attendee>>('/attendees', { org: event.org_id, q: typed || undefined, page, per_page: 50 }, signal),
    enabled: online,
  });
  const meta = r.data?.meta;
  return (
    <div className="flex flex-col gap-3 pb-6">
      <Header title="Attendees" sub="Everyone registered at the events you reach in this company" actions={<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email, phone, company…" aria-label="Search attendees" className="h-8 w-[260px] rounded-[8px] border border-line bg-surface px-2.5 text-[12.5px] text-ink outline-none focus:border-primary" />} />
      <div className="flex flex-col gap-3 px-6">
        {!online ? <p className="m-0 text-[13px] text-ink-3">Attendees are WorkSuite’s: they come back with the line.</p> : null}
        {r.isLoading ? <Spinner /> : null}
        {r.error ? <ErrorNote error={r.error} onRetry={() => void r.refetch()} /> : null}
        {r.data && r.data.items.length === 0 ? <Empty icon="users" title="Nobody found" /> : null}
        {r.data && r.data.items.length > 0 ? (
          <table className="w-full rounded-[12px] border border-line bg-surface text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] text-ink-3">
                <th className="px-3 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 font-semibold">Company</th>
                <th className="px-3 py-2 font-semibold">Email</th>
                <th className="px-3 py-2 font-semibold">Phone</th>
                <th className="px-3 py-2 font-semibold">Type</th>
              </tr>
            </thead>
            <tbody>
              {r.data.items.map((a) => (
                <tr tabIndex={0} onKeyDown={clickOnKey} key={a.id} onClick={() => open({ kind: 'attendee', id: a.id, event: event.id })} className="cursor-pointer border-t border-line hover:bg-subtle">
                  <td className="px-3 py-1.5 font-semibold">{a.anonymized ? 'Erased' : a.name}</td>
                  <td className="px-3 py-1.5">{a.company ?? '—'}</td>
                  <td className="px-3 py-1.5">{a.email ?? '—'}</td>
                  <td className="px-3 py-1.5">{a.phone ?? '—'}</td>
                  <td className="px-3 py-1.5 text-ink-2">{a.type.toLowerCase()}</td>
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
