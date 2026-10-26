import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../core/api';
import { dateLabel, timeLabel } from '../../core/time';
import { Spinner } from '../../components/ui';
import { Refused } from './audience-parts';
import { btnPrimary, Card, Kpi, Line, n, PageHeader, Pill } from './parts';
import type { CompanyDetail } from './types';
import { StatGrid } from '../../components/StatCard';

/**
 * One organisation whole (DK04, the web's W04; MKT-AUD-03): its details, the
 * people Marketing has there, how many each channel may reach, and one
 * timeline merged from all of theirs, newest first.
 */
export default function CompanyPage({ id, onBack, onEdit, onOpenContact, onContacts }: {
  id: number;
  onBack: () => void;
  onEdit?: () => void;
  onOpenContact: (id: number) => void;
  onContacts: (companyId: number) => void;
}) {
  const q = useQuery({
    queryKey: ['marketing', 'company', id],
    queryFn: ({ signal }) => apiGet<CompanyDetail>(`/api/marketing/companies/${id}`, undefined, signal),
    retry: false,
  });
  const c = q.data;

  if (q.isLoading) return <Spinner label="Loading the organisation…" />;
  if (!c) {
    return (
      <div className="flex flex-col gap-3">
        <PageHeader crumbs={['Organisations']} onCrumb={onBack} title="Organisation" />
        <Refused error={q.error} fallback="That organisation could not be loaded." onRetry={() => void q.refetch()} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        crumbs={['Organisations']}
        onCrumb={onBack}
        title={c.name}
        sub={[c.industry, [c.city, c.country_name].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || undefined}
        actions={onEdit ? <button type="button" className={btnPrimary} onClick={onEdit}>Edit</button> : null}
      />
      <StatGrid min={200}>
        <Kpi icon="users" tone="blue" label="Contacts" value={n(c.contacts_count)} onClick={() => onContacts(c.id)} />
        <Kpi icon="mail" tone="green" label="May be emailed" value={n(c.reachable.email)} />
        <Kpi icon="phone" tone="violet" label="May be called" value={n(c.reachable.call)} />
        <Kpi icon="chat" tone="cyan" label="May get WhatsApp" value={n(c.reachable.whatsapp)} />
      </StatGrid>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Details">
            <Line label="Domain">{c.domain ?? '—'}</Line>
            <Line label="Website">{c.website ?? '—'}</Line>
            <Line label="Phone">{c.phone ?? '—'}</Line>
            <Line label="Owner">{c.owner?.name ?? 'Nobody'}</Line>
            {c.client_id ? <Line label="CRM account">#{c.client_id}</Line> : null}
            <Line label="Added">{dateLabel(c.created_at) || '—'}</Line>
          </Card>
          <Card title={`People (${n(c.contacts_count)})`}>
            {c.contacts.length === 0 ? <p className="m-0 text-[12.5px] text-ink-3">Nobody here yet.</p> : (
              <ul className="m-0 flex list-none flex-col p-0">
                {c.contacts.map((p) => (
                  <li key={p.id} className="border-b border-line/70 last:border-b-0">
                    <button type="button" onClick={() => onOpenContact(p.id)} className="flex w-full items-center gap-2 py-2 text-left hover:bg-subtle">
                      <span className="min-w-0 flex-1">
                        <b className="block truncate text-[13px] text-ink">{p.name}</b>
                        <span className="block truncate text-[11.5px] text-ink-3">{[p.job_title, p.email ?? p.phone].filter(Boolean).join(' · ') || '—'}</span>
                      </span>
                      <Pill tone="slate" dot={false}>{p.status_label}</Pill>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card title="Timeline" className="min-w-0">
          {c.timeline.length === 0 ? <p className="m-0 text-[12.5px] text-ink-3">Nothing has happened here yet.</p> : (
            <ol className="m-0 flex list-none flex-col p-0">
              {c.timeline.map((t) => (
                <li key={t.id} className="flex flex-wrap items-baseline gap-x-2 border-b border-line/70 py-2 text-[13px] last:border-b-0">
                  <span className="text-[11.5px] text-ink-3 tabular-nums">{dateLabel(t.at)} {timeLabel(t.at)}</span>
                  <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onOpenContact(t.contact.id)}>{t.contact.name}</button>
                  <span className="text-ink">{t.title}</span>
                  {t.actor ? <span className="text-[11.5px] text-ink-3">· {t.actor}</span> : null}
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
