import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../core/api';
import { Icon } from '../../components/Icon';
import { StatCard } from '../../components/StatCard';
import { Spinner } from '../../components/ui';
import { send, withOrg } from './api';
import { act, ConfirmSheet, may, Refused } from './audience-parts';
import { describe } from './audience-rules';
import { btnPrimary, btnSmall, n, PageHeader } from './parts';
import type { Options, Segment } from './types';

/**
 * Segments (MKT-SEG-01 – MKT-SEG-04): people described rather than chosen —
 * "in Sri Lanka, tagged vendor, opened in the last 90 days" — and so always up
 * to date. The count beside each is taken when the screen asks, as the reader
 * may see; nothing is stored that could go stale. A segment's rules are
 * written on a page of their own (the builder), with the live count beside
 * them.
 */
export default function Segments({ org, options, onContacts, onEdit }: { org: string; options: Options; onContacts: (segmentId: number) => void; onEdit: (id: number | 'new') => void }) {
  const [removing, setRemoving] = useState<Segment | null>(null);
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ['marketing', 'segments', org, 'counted'],
    queryFn: ({ signal }) => apiGet<{ items: Segment[] }>('/api/marketing/segments', withOrg(org), signal),
  });
  const items = q.data?.items ?? [];

  const remove = async (s: Segment) => {
    setBusy(true);
    if (await act(() => send('DELETE', `/api/marketing/segments/${s.id}`), 'Deleted.')) setRemoving(null);
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        crumbs={['Audience']}
        title="Segments"
        sub="Saved rules, counted again every time they are used — so they always reflect today's contacts"
        actions={
          may(options, 'segments') ? (
            <button type="button" className={btnPrimary} onClick={() => onEdit('new')}>
              <Icon name="plus" size={15} /> New segment
            </button>
          ) : null
        }
      />

      {q.isLoading ? <Spinner label="Counting…" /> : null}
      {q.error ? <Refused error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data && items.length === 0 ? (
        <div className="rounded-[12px] border border-line bg-surface px-4 py-10 text-center">
          <p className="m-0 text-[14px] font-semibold text-ink">No segments yet.</p>
          <p className="m-0 mt-1 text-[12.5px] text-ink-3">Describe who you mean — a country, a tag, whether they may be emailed — and the segment keeps itself up to date.</p>
        </div>
      ) : null}
      <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 lg:grid-cols-2">
        {items.map((s) => (
          <li key={s.id} className="flex min-w-0 flex-col gap-2 rounded-[12px] border border-line bg-surface p-4">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="m-0 truncate text-[14px] font-bold text-ink">{s.name}</p>
                {s.description ? <p className="m-0 line-clamp-2 text-[12px] text-ink-3">{s.description}</p> : null}
              </div>
              <StatCard
                size="sm"
                className="w-[150px] shrink-0"
                label="Contacts"
                value={n(s.members)}
                sub="see them"
                icon="filter"
                tone="cyan"
                ariaLabel={`${s.name}: see the ${s.members ?? 'matching'} contacts`}
                onClick={() => onContacts(s.id)}
              />
            </div>
            <p className="m-0 text-[12.5px] text-ink-2">
              <b>{s.match === 'any' ? 'Any of: ' : 'All of: '}</b>
              {s.rules.map((r) => describe(r, options, s.org_id)).join(s.match === 'any' ? '; or ' : '; and ') || 'no rules'}
            </p>
            {may(options, 'segments', s.org_id) ? (
              <div className="flex gap-2">
                <button type="button" className={btnSmall} onClick={() => onEdit(s.id)}>
                  Edit
                </button>
                <button type="button" className={`${btnSmall} text-danger`} onClick={() => setRemoving(s)}>
                  Delete
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {removing ? (
        <ConfirmSheet title={`Delete ${removing.name}?`} action="Delete" danger busy={busy} onClose={() => setRemoving(null)} onYes={() => void remove(removing)}>
          Only the description goes. No contact is changed, and no list loses anybody.
        </ConfirmSheet>
      ) : null}
    </div>
  );
}
