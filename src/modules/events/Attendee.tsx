import { useQuery } from '@tanstack/react-query';
import { Card, ErrorNote, Spinner } from '../../components/ui';
import { useTab } from '../../core/tab-context';
import { at, eGet, useOnline, type Attendee as Person, type When } from './api';
import { Facts, Header, Refusal } from './parts';

/**
 * An attendee's profile (§7, `GET attendees/{id}`): who they are, their
 * registrations at the events this person reaches — with where they stand at
 * the gate and in sessions — and their consents as given. Read only here.
 */
interface Profile extends Person {
  registrations: Array<{
    id: number;
    event_id: number;
    event?: { id: number; name: string } | null;
    number: string;
    status_label: string;
    ticket: { name: string } | null;
    checkin?: { state: string; first_in: When | null; last_in: When | null; last_out: When | null } | null;
    sessions?: { registered: number; attended: number } | null;
  }>;
  consents: Array<{ type: string; key?: string; accepted: boolean; source?: string; at?: When | null; event_id?: number | null }> | null;
}

export default function Attendee({ id }: { id: number }) {
  const online = useOnline();
  const { go } = useTab();
  const r = useQuery({ queryKey: ['events', 'attendee', id], queryFn: ({ signal }) => eGet<Profile>(`/attendees/${id}`, undefined, signal), enabled: online });
  const a = r.data;
  return (
    <div className="flex flex-col gap-4 pb-6">
      <Header title={a ? (a.anonymized ? 'Erased attendee' : a.name) : 'Attendee'} sub={a?.company ?? undefined} />
      <div className="flex max-w-[900px] flex-col gap-4 px-6">
        {!online ? <Refusal text="Attendees are WorkSuite’s: they come back with the line." /> : null}
        {r.isLoading ? <Spinner /> : null}
        {r.error ? <ErrorNote error={r.error} onRetry={() => void r.refetch()} /> : null}
        {a ? (
          <>
            <Card title="Contact">
              <Facts
                rows={[
                  ['Email', a.email ?? '—'],
                  ['Phone', a.phone ?? '—'],
                  ['Company', a.company ?? '—'],
                  ['Position', a.job_title ?? '—'],
                  ['Country', a.country ?? '—'],
                ]}
              />
            </Card>
            <Card title="Registrations">
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px]">
                {a.registrations.map((x) => (
                  <li key={x.id} className="flex items-center gap-3 border-t border-line py-1.5 first:border-t-0">
                    <button type="button" className="min-w-0 flex-1 text-left hover:underline" onClick={() => go(`/events/${x.event_id}/registrations/${x.id}`)}>
                      <b>{x.event?.name ?? `Event ${x.event_id}`}</b>
                      <span className="text-ink-3">
                        {' '}
                        · {x.number} · {x.ticket?.name ?? ''}
                      </span>
                    </button>
                    <span className="text-ink-2">{x.status_label}</span>
                    <span className="w-[200px] text-right text-ink-3">
                      {x.checkin && x.checkin.state !== 'NOT_ARRIVED' ? `${x.checkin.state === 'INSIDE' ? 'Inside' : 'Checked out'} · first in ${at(x.checkin.first_in)}` : 'Not arrived'}
                      {x.sessions ? ` · ${x.sessions.attended}/${x.sessions.registered} sessions` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
            {a.consents && a.consents.length > 0 ? (
              <Card title="Consents">
                <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px]">
                  {a.consents.map((c, i) => (
                    <li key={`${c.type}-${c.key ?? ''}-${i}`} className="flex gap-3">
                      <span className="flex-1">{(c.key ?? c.type).replace(/_/g, ' ').toLowerCase()}</span>
                      <span className={c.accepted ? 'text-success' : 'text-ink-2'}>{c.accepted ? 'Given' : 'Withdrawn'}</span>
                      <span className="w-[110px] text-right text-ink-3">{at(c.at ?? null)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
