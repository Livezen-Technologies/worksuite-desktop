import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { app } from '../../core/app-state';
import { apiGet, apiGetMeta } from '../../core/api';
import { call } from '../../core/bridge';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { dateLabel, relative } from '../../core/time';
import { Icon } from '../../components/Icon';
import { Avatar, Button, Chip, Empty, ErrorNote, IconButton, OfflineNote, Spinner, cx } from '../../components/ui';
import { VirtualList } from '../../components/VirtualList';
import type { ModuleProps } from '../registry';

/**
 * CRM (READ_CACHE, assigned leads; §14): the lead list with views and
 * search, and a lead record that opens in a tab or its own window. Editing
 * and conversion stay in WorkSuite CRM on the web until the CRM desktop
 * module gains write support.
 */
interface Lead {
  id: number;
  lead_no: string | null;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  status: 'new' | 'contacted' | 'qualified' | 'unqualified' | 'converted';
  score: number;
  rating: string | null;
  est_value: number | null;
  currency: string | null;
  owner_name: string | null;
  follow_up: 'none' | 'overdue' | 'due' | 'upcoming';
  next_followup_at: string | null;
  last_activity_at: string | null;
  created_at: string;
  source: string | null;
  city: string | null;
  country: string | null;
  job_title: string | null;
  description: string | null;
}

const STATUS_TONE: Record<Lead['status'], 'indigo' | 'teal' | 'success' | 'muted' | 'warning'> = { new: 'indigo', contacted: 'teal', qualified: 'success', unqualified: 'muted', converted: 'warning' };
const VIEWS = [
  { id: '', label: 'All' },
  { id: 'today', label: 'Follow up today' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'unassigned', label: 'Unassigned' },
];

export default function CrmPage(_props: ModuleProps) {
  const { path, query, go, openInWindow, openLink } = useTab();
  const leadId = path[1] === 'leads' ? path[2] : null;
  const orgId = useStore(app, (s) => s.organizationId);
  const view = query.get('view') ?? '';
  const mine = query.get('mine') === '1';
  const [q, setQ] = useState('');
  useTabTitle(leadId ? `CRM · Lead #${leadId}` : 'CRM');

  const leads = useInfiniteQuery({
    queryKey: ['crm', 'leads', view, mine, q, orgId],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => apiGetMeta<{ leads: Lead[]; has_more: boolean; total: number; views: Record<string, number> }>('/api/crm/leads', { page: pageParam, per_page: 100, view: view || undefined, mine: mine ? 1 : undefined, q: q || undefined, org: orgId, sort: 'activity', dir: 'desc' }, signal),
    getNextPageParam: (last, pages) => (last.data.has_more ? pages.length + 1 : undefined),
  });
  const rows = (leads.data?.pages ?? []).flatMap((p) => p.data.leads);
  const counts = leads.data?.pages[0]?.data.views ?? {};

  useEffect(() => {
    if (query.get('new') === '1') {
      openLink('/crm/leads?new=1');
      go('/crm');
    }
  }, [query, openLink, go]);

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-line bg-surface px-6 py-3">
          <h1 className="text-[20px] font-bold text-ink">Leads</h1>
          <div className="ml-2 flex gap-1">
            {VIEWS.map((v) => (
              <button key={v.id} type="button" onClick={() => go(`/crm${v.id ? `?view=${v.id}` : ''}`)} className={cx('flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold', view === v.id ? 'bg-ink text-surface' : 'text-ink-2 hover:bg-subtle')}>
                {v.label}
                {v.id && counts[v.id] ? <span className="opacity-70">{counts[v.id]}</span> : null}
              </button>
            ))}
            <button type="button" onClick={() => go(`/crm?${new URLSearchParams({ ...(view ? { view } : {}), ...(mine ? {} : { mine: '1' }) })}`)} className={cx('rounded-full px-3 py-1.5 text-[12.5px] font-semibold', mine ? 'bg-selection text-primary' : 'text-ink-2 hover:bg-subtle')}>
              Mine
            </button>
          </div>
          <div className="flex-1" />
          {leads.data?.pages[0]?.offline ? <OfflineNote cachedAt={leads.data.pages[0].cachedAt} /> : null}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search leads" aria-label="Search leads" className="h-8 w-[220px] rounded-[8px] border border-line bg-ground px-3 text-[13px] outline-none focus:border-primary" />
          <Button icon="plus" variant="primary" onClick={() => openLink('/crm/leads?new=1')}>
            New lead
          </Button>
        </div>
        <div className="grid grid-cols-[1fr_140px_110px_120px_110px] gap-3 border-b border-line bg-subtle px-6 py-2 text-[12px] font-bold uppercase tracking-wide text-ink-3">
          <span>Lead</span>
          <span>Owner</span>
          <span>Status</span>
          <span>Follow-up</span>
          <span className="text-right">Value</span>
        </div>
        <div className="min-h-0 flex-1">
          {leads.isLoading ? <Spinner /> : leads.error ? <div className="p-6"><ErrorNote error={leads.error} onRetry={() => void leads.refetch()} /></div> : rows.length === 0 ? <Empty icon="users" title="No leads here" /> : null}
          {rows.length ? (
            <VirtualList
              items={rows}
              estimate={56}
              getKey={(l) => l.id}
              onEndReached={() => leads.hasNextPage && !leads.isFetchingNextPage && void leads.fetchNextPage()}
              render={(l) => (
                <button type="button" onClick={() => go(`/crm/leads/${l.id}`)} className={cx('grid w-full grid-cols-[1fr_140px_110px_120px_110px] items-center gap-3 border-b border-line px-6 py-2.5 text-left', String(l.id) === leadId ? 'bg-selection' : 'bg-surface hover:bg-subtle')}>
                  <span className="flex min-w-0 items-center gap-3">
                    <Avatar name={l.name} size={30} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-semibold text-ink">{l.name}</span>
                      <span className="block truncate text-[12px] text-ink-3">{[l.company, l.lead_no].filter(Boolean).join(' · ')}</span>
                    </span>
                  </span>
                  <span className="truncate text-[12.5px] text-ink-2">{l.owner_name ?? 'Unassigned'}</span>
                  <span>
                    <Chip tone={STATUS_TONE[l.status]}>{l.status}</Chip>
                  </span>
                  <span className={cx('text-[12.5px]', l.follow_up === 'overdue' ? 'font-semibold text-danger' : l.follow_up === 'due' ? 'font-semibold text-warning' : 'text-ink-3')}>{l.next_followup_at ? relative(l.next_followup_at) : '—'}</span>
                  <span className="text-right font-mono text-[12.5px] text-ink-2">{l.est_value ? `${l.currency ?? ''} ${Number(l.est_value).toLocaleString()}` : ''}</span>
                </button>
              )}
            />
          ) : null}
        </div>
      </div>
      {leadId ? <LeadDetail id={leadId} onClose={() => go('/crm')} onWindow={() => openInWindow(`/crm/leads/${leadId}`, `Lead #${leadId}`)} onWeb={() => openLink(`/crm/leads/${leadId}`)} /> : null}
    </div>
  );
}

function LeadDetail({ id, onClose, onWindow, onWeb }: { id: string; onClose: () => void; onWindow: () => void; onWeb: () => void }) {
  const q = useQuery({
    queryKey: ['crm', 'lead', id],
    queryFn: () => apiGet<{ lead: Lead; score: { score: number; rating: string }; timeline: Array<{ id: number; kind: string; title: string; body: string | null; author: string | null; at: string }> }>(`/api/crm/leads/${id}`),
    retry: false,
  });
  const l = q.data?.lead;
  return (
    <aside className="flex w-[420px] shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <span className="font-mono text-[12px] text-ink-3">{l?.lead_no ?? `Lead #${id}`}</span>
        <div className="flex gap-1">
          <IconButton icon="external" label="Open in new window" onClick={onWindow} />
          <IconButton icon="globe" label="Edit on the web" onClick={onWeb} />
          <IconButton icon="x" label="Close" onClick={onClose} />
        </div>
      </div>
      {q.isLoading ? <Spinner /> : q.error ? <div className="p-5"><ErrorNote error={q.error} /></div> : l ? (
        <div className="flex-1 overflow-y-auto p-5 scroll-thin">
          <div className="flex items-center gap-3">
            <Avatar name={l.name} size={48} />
            <div className="min-w-0">
              <h2 className="truncate text-[18px] font-bold text-ink selectable">{l.name}</h2>
              <div className="truncate text-[13px] text-ink-3">{[l.job_title, l.company].filter(Boolean).join(' · ')}</div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Chip tone={STATUS_TONE[l.status]}>{l.status}</Chip>
            {q.data?.score ? <Chip tone="indigo">Score {q.data.score.score}</Chip> : null}
            {l.source ? <Chip>{l.source}</Chip> : null}
          </div>
          <dl className="mt-5 grid grid-cols-[100px_1fr] gap-y-2.5 text-[13px]">
            <dt className="text-ink-3">Email</dt>
            <dd className="truncate text-ink selectable">{l.email ? <button type="button" className="text-primary hover:underline" onClick={() => void call('app:openExternal', { url: `mailto:${l.email}` })}>{l.email}</button> : '—'}</dd>
            <dt className="text-ink-3">Phone</dt>
            <dd className="text-ink selectable">{l.phone ?? '—'}</dd>
            <dt className="text-ink-3">Owner</dt>
            <dd className="text-ink">{l.owner_name ?? 'Unassigned'}</dd>
            <dt className="text-ink-3">Location</dt>
            <dd className="text-ink">{[l.city, l.country].filter(Boolean).join(', ') || '—'}</dd>
            <dt className="text-ink-3">Value</dt>
            <dd className="text-ink">{l.est_value ? `${l.currency ?? ''} ${Number(l.est_value).toLocaleString()}` : '—'}</dd>
            <dt className="text-ink-3">Created</dt>
            <dd className="text-ink">{dateLabel(l.created_at)}</dd>
          </dl>
          {l.description ? <p className="mt-4 whitespace-pre-wrap text-[13px] text-ink-2 selectable">{l.description}</p> : null}
          <h3 className="mt-6 mb-2 text-[13px] font-bold text-ink">Timeline</h3>
          <ul className="flex flex-col gap-3">
            {(q.data?.timeline ?? []).slice(0, 25).map((t) => (
              <li key={`${t.kind}:${t.id}`} className="flex gap-3">
                <Icon name="history" size={15} className="mt-0.5 shrink-0 text-ink-3" />
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-ink">{t.title}</div>
                  {t.body ? <div className="line-clamp-3 text-[12.5px] text-ink-2">{t.body}</div> : null}
                  <div className="text-[11.5px] text-ink-3">
                    {t.author ? `${t.author} · ` : ''}
                    {relative(t.at)}
                  </div>
                </div>
              </li>
            ))}
            {(q.data?.timeline ?? []).length === 0 ? <li className="text-[12.5px] text-ink-3">No activity yet.</li> : null}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}
