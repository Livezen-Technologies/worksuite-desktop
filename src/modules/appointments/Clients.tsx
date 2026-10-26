import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button, cx, initials } from '../../components/ui';
import { fetchClient, fetchClientList, K, money } from './api';
import { Chips, Head, input, Pill, Section, useDesk, useNow } from './parts';
import { StatCard, StatGrid, type StatTone } from '../../components/StatCard';

/**
 * D14 · Clients: the customers with appointments, most recent first, searched by name, phone or email, with quick
 * filters and a preview card (visits, no-shows, spend, the pinned note, what is coming up and the last visit).
 */
type Filter = 'recent' | 'noshows' | 'unseen' | 'today';
interface Row { id: number; name: string; phone: string | null; email: string | null; total: number; completed: number; upcoming: number; no_show: number; last_visit: string | null; latest: string | null }

export default function Clients() {
  const desk = useDesk();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filter, setFilter] = useState<Filter>('recent');
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 200);
    return () => window.clearTimeout(t);
  }, [q]);
  const list = useQuery({ queryKey: K.clients(`h:${debounced}`), queryFn: ({ signal }) => fetchClientList(debounced, signal) });
  const now = useNow(60_000);
  const day = new Date(now).toISOString().slice(0, 10);
  const rows = ((list.data?.items ?? []) as unknown as Row[]).filter((r) =>
    filter === 'noshows' ? r.no_show > 0 : filter === 'unseen' ? !r.last_visit || now - Date.parse(r.last_visit) > 60 * 86400_000 : filter === 'today' ? !!r.latest && r.latest.slice(0, 10) === day : true,
  );
  const pick = sel ?? rows[0]?.id ?? null;
  const card = useQuery({ queryKey: K.client(pick ?? 0), queryFn: ({ signal }) => fetchClient(pick!, signal), enabled: !!pick });
  const h = card.data;
  const pinned = (h?.notes ?? []).find((n) => n.pinned);
  const upcoming = (h?.timeline ?? []).filter((v) => v.status === 'pending' || v.status === 'confirmed').slice(0, 3);
  const last = (h?.timeline ?? []).find((v) => v.status === 'completed');

  return (
    <div>
      <Head title="Clients">
        <Button variant="primary" icon="plus" disabled={!desk.online} onClick={() => desk.book()}>Book a client</Button>
      </Head>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className={cx(input, 'w-[260px]')} placeholder="Name, phone or email" aria-label="Search clients" value={q} onChange={(e) => setQ(e.target.value)} />
        <Chips label="Filter" value={filter} onChange={setFilter} options={[{ id: 'recent', label: 'Recent' }, { id: 'noshows', label: 'Has no-shows' }, { id: 'unseen', label: 'Not seen 60 days' }, { id: 'today', label: 'Coming in today' }]} />
      </div>
      <div className="grid grid-cols-[1fr_360px] gap-4">
        <Section>
          <ul className="m-0 list-none p-0" aria-label="Clients">
            {rows.map((r) => (
              <li key={r.id}>
                <button type="button" aria-current={pick === r.id ? 'true' : undefined} onClick={() => setSel(r.id)} onDoubleClick={() => desk.client(r.id)} className={cx('flex w-full items-center gap-3 border-b border-line/70 px-3.5 py-2 text-left', pick === r.id ? 'bg-[#EEF1FD] dark:bg-selection' : 'hover:bg-subtle')}>
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#EAEDFB] text-[11px] font-bold text-[#23349E] dark:bg-primary/15 dark:text-primary">{initials(r.name)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold text-ink">{r.name}</span>
                    <span className="block truncate text-[12px] text-ink-3">{[r.phone, r.last_visit ? `last ${new Date(r.last_visit).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : null].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="text-[12px] text-ink-2 tabular-nums">{`${r.completed} visits`}</span>
                  {r.no_show ? <Pill tone="late">{`${r.no_show} no-show${r.no_show === 1 ? '' : 's'}`}</Pill> : null}
                </button>
              </li>
            ))}
            {!rows.length ? <li className="px-3.5 py-6 text-center text-[12.5px] text-ink-3">{list.isPending ? 'Reading…' : 'No clients.'}</li> : null}
          </ul>
        </Section>
        {h ? (
          <Section>
            <div className="p-4">
              <div className="text-[17px] font-extrabold text-ink">{h.customer.name}</div>
              <div className="text-[12.5px] text-ink-3">{[h.customer.phone, h.customer.email].filter(Boolean).join(' · ')}</div>
              <StatGrid min={110} className="mt-3 text-center">
                <Tile icon="calendar-check" tone="blue" k="Visits" v={h.tally.completed} />
                <Tile icon="user-x" tone="amber" k="No-shows" v={h.tally.no_show} />
                <Tile icon="coins" tone="green" k="Spend" v={h.revenue ? h.revenue.map((m) => money(m.amount, m.currency)).join(' · ') || '0' : '—'} />
              </StatGrid>
              {pinned ? <p className="mt-3 mb-0 rounded-[8px] bg-[#EEF1FD] px-3 py-2 text-[12.5px] text-[#23349E] dark:bg-selection dark:text-primary">{`Pinned · ${pinned.body}`}</p> : null}
              <div className="mt-3 text-[11px] font-bold tracking-[.06em] text-ink-3 uppercase">Coming up</div>
              {upcoming.map((v) => <div key={v.id} className="py-0.5 text-[12.5px] text-ink">{`${v.date} ${v.time} · ${v.service} · ${v.provider}`}</div>)}
              {!upcoming.length ? <div className="text-[12.5px] text-ink-3">Nothing booked.</div> : null}
              <div className="mt-3 text-[11px] font-bold tracking-[.06em] text-ink-3 uppercase">Last visit</div>
              <div className="text-[12.5px] text-ink">{last ? `${last.date} · ${last.service} · ${last.provider}${last.invoice ? ` · ${last.invoice.number ?? ''} · ${last.invoice.status}` : ''}` : '—'}</div>
              <div className="mt-4 flex gap-2">
                <Button variant="secondary" onClick={() => desk.client(h.customer.id)}>Open history</Button>
                <Button variant="primary" disabled={!desk.online} onClick={() => desk.book({ customer: { id: h.customer.id, name: h.customer.name } })}>Book</Button>
              </div>
            </div>
          </Section>
        ) : null}
      </div>
    </div>
  );
}

function Tile({ k, v, icon, tone }: { k: string; v: string | number; icon?: string; tone?: StatTone }) {
  return <StatCard size="sm" label={k} value={v} icon={icon} tone={tone} />;
}
