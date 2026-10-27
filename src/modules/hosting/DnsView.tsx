import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Spinner, cx } from '../../components/ui';
import { fetchDomain, fetchDomains, K, type Org } from './api';
import DnsEditor from './DnsEditor';
import type { Nav } from './HostingShell';
import { PageHead, input } from './parts';

/** DNS (the rail's): pick a domain on the left, edit its zone on the right — the same editor as a domain's DNS tab. */
export default function DnsView({ org, nav, active, picked, onPick }: { org: number; nav: Nav; active: boolean; companies?: Org[]; picked: number | null; onPick: (id: number) => void }) {
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: K.domains({ q: q.trim() || undefined, org, per_page: 200, sort: 'name' }), queryFn: ({ signal }) => fetchDomains({ q: q.trim() || undefined, org: org || undefined, per_page: 200, sort: 'name' }, signal) });
  const id = picked ?? list.data?.items[0]?.id ?? null;
  const one = useQuery({ queryKey: K.domain(id ?? 0), queryFn: ({ signal }) => fetchDomain(id!, signal), enabled: id !== null });
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <PageHead title="DNS" />
      <div className="flex min-h-0 flex-1 gap-4">
        <div className="flex w-[240px] shrink-0 flex-col gap-2">
          <input aria-label="Find a domain" placeholder="Find a domain" value={q} onChange={(e) => setQ(e.target.value)} className={input} />
          <div role="listbox" aria-label="Domains" className="min-h-0 flex-1 overflow-y-auto rounded-[10px] border border-line bg-surface scroll-thin">
            {list.isPending ? <Spinner /> : null}
            {(list.data?.items ?? []).map((d) => (
              <button key={d.id} type="button" role="option" aria-selected={d.id === id} onClick={() => onPick(d.id)} onDoubleClick={() => nav.openDomain(d.id, 'tab', d.name, 'dns')} className={cx('block w-full truncate border-b border-line/60 px-3 py-2 text-left text-[12.5px]', d.id === id ? 'bg-selection font-semibold shadow-[inset_3px_0_0_var(--color-primary)] dark:bg-selection' : 'hover:bg-subtle')}>
                {d.name}
              </button>
            ))}
          </div>
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto scroll-thin">{one.data ? <DnsEditor key={one.data.id} domain={one.data} active={active} /> : one.isFetching ? <Spinner /> : null}</div>
      </div>
    </div>
  );
}
