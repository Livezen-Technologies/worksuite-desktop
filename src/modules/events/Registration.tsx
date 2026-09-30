import { useQuery } from '@tanstack/react-query';
import { Icon } from '../../components/Icon';
import { Button, Card, ErrorNote, Spinner } from '../../components/ui';
import { at, eGet, money, type Registration as Reg, type When } from './api';
import { useBadge } from './badge';
import { useDeskStatus } from './desk';
import { Facts, Header, useEvent } from './parts';

/**
 * One registration, read at the desk: who, which ticket, where it stands,
 * the payment as the server has it, the answers, and every print of its
 * badge — with the badge printed (or reprinted, with a reason) here.
 */
interface Detail extends Reg {
  answers: Record<string, unknown>;
  waitlist: { position: number | null; status: string; confirm_by: When | null } | null;
  cancel_reason: string | null;
  reject_reason: string | null;
  notes: Array<{ id: number; body: string; by: string | null; at: When | null }> | null;
  discount?: string | null;
  due?: string | null;
}

interface Print {
  id: number;
  status_label: string;
  reprint: boolean;
  reason: string | null;
  printer: string | null;
  by: string | null;
  at: When | null;
  printed_at: When | null;
  template: { name: string } | null;
}

export default function Registration({ id }: { id: number }) {
  const { event, may, online, open } = useEvent();
  const status = useDeskStatus(event.id);
  const r = useQuery({ queryKey: ['events', 'registration', id], queryFn: ({ signal }) => eGet<Detail>(`/registrations/${id}`, undefined, signal), enabled: online });
  const prints = useQuery({ queryKey: ['events', 'registration', id, 'prints'], queryFn: ({ signal }) => eGet<{ items: Print[] }>(`/registrations/${id}/badge/prints`, undefined, signal), enabled: online, retry: false });
  const badge = useBadge(event.id, status.data?.registration?.device_id ?? null);
  const x = r.data;
  return (
    <div className="flex flex-col gap-4 pb-6">
      <Header
        title={x?.attendee?.name ?? 'Registration'}
        sub={x ? `${x.number} · ${x.status_label}` : undefined}
        actions={
          <>
            <Button size="sm" icon="back" onClick={() => open({ kind: 'event', id: event.id, view: 'registrations', list: null })}>
              Registrations
            </Button>
            {x && may('events.badge.print') && x.status === 'CONFIRMED' ? (
              <Button size="sm" variant="primary" icon="printer" loading={badge.busy} onClick={() => badge.print(x.id, x.attendee?.name ?? x.number)}>
                Print badge
              </Button>
            ) : null}
          </>
        }
      />
      <div className="flex max-w-[900px] flex-col gap-4 px-6">
        {r.isLoading ? <Spinner /> : null}
        {r.error ? <ErrorNote error={r.error} onRetry={() => void r.refetch()} /> : null}
        {x ? (
          <>
            <Card title="Registration">
              <Facts
                rows={[
                  ['Attendee', x.attendee ? `${x.attendee.name}${x.attendee.company ? ` · ${x.attendee.company}` : ''}` : '—'],
                  ['Email', x.attendee?.email ?? '—'],
                  ['Phone', x.attendee?.phone ?? '—'],
                  ['Ticket', x.ticket?.name ?? '—'],
                  ['Status', x.status_label],
                  ['Source', x.source],
                  ['Payment', x.payment_status ? `${x.payment_status.toLowerCase().replace(/_/g, ' ')} · ${money(x.price, x.currency)}${x.due ? ` · ${money(x.due, x.currency)} owed` : ''}` : 'Free'],
                  ['Registered', at(x.registered_at)],
                  ...(x.waitlist ? ([['Waitlist', `${x.waitlist.status}${x.waitlist.position ? ` #${x.waitlist.position}` : ''}`]] as Array<[string, string]>) : []),
                  ...(x.cancel_reason ? ([['Cancelled because', x.cancel_reason]] as Array<[string, string]>) : []),
                  ...(x.reject_reason ? ([['Rejected because', x.reject_reason]] as Array<[string, string]>) : []),
                ]}
              />
              {x.attendee ? (
                <button type="button" onClick={() => open({ kind: 'attendee', id: x.attendee!.id, event: event.id })} className="mt-3 flex items-center gap-1 text-[12.5px] font-semibold text-primary hover:underline">
                  <Icon name="user" size={14} /> The attendee’s profile
                </button>
              ) : null}
            </Card>
            {x.answers && Object.keys(x.answers).length > 0 ? (
              <Card title="Answers">
                <Facts rows={Object.entries(x.answers).map(([k, v]) => [k.replace(/_/g, ' '), Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v ?? '—')])} />
              </Card>
            ) : null}
            <Card title="Badge prints">
              {prints.data && prints.data.items.length === 0 ? <p className="m-0 text-[13px] text-ink-3">No badge printed yet.</p> : null}
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px]">
                {prints.data?.items.map((p) => (
                  <li key={p.id} className="flex gap-2 border-t border-line py-1 first:border-t-0">
                    <span className="flex-1">
                      {p.reprint ? 'Reprint' : 'First print'}
                      {p.template ? ` · ${p.template.name}` : ''}
                      {p.reason ? ` · ${p.reason}` : ''}
                      {p.printer ? ` · ${p.printer}` : ''}
                      {p.by ? ` · ${p.by}` : ''}
                    </span>
                    <span className="text-ink-2">{p.status_label}</span>
                    <span className="w-[110px] text-right text-ink-3">{at(p.printed_at ?? p.at)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </>
        ) : null}
      </div>
      {badge.dialog}
    </div>
  );
}
