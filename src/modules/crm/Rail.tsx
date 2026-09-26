import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../core/api';
import { call } from '../../core/bridge';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';

/**
 * The CRM rail (CrmRail): New lead, Search the CRM, and the sections — Sales
 * and Catalogue — with the counts that matter (open deals, new leads, late
 * follow-ups in red), what is due today from Tasks and Meetings, and My
 * access. Screens the desktop does not draw yet open in the browser, marked.
 */
export type CrmView = 'dash' | 'pipe' | 'leads' | 'fu' | 'acc' | 'quotes' | 'price' | 'intake' | 'set' | 'access';

/** Drawn here; the rest opens WorkSuite CRM in the browser for now. */
export const NATIVE = new Set<CrmView>(['dash', 'pipe', 'leads', 'fu', 'acc', 'quotes', 'price', 'intake', 'set', 'access']);

interface Item {
  id: CrmView;
  label: string;
  icon: string;
  badge?: number;
  tone?: 'red';
}

export interface RailCounts {
  openDeals: number;
  newLeads: number;
  late: number;
  tasksToday: number;
  meetingsToday: number;
}

interface SearchHit {
  type: string;
  id: number;
  title: string;
  subtitle: string | null;
  meta: string | null;
}

export function CrmRail({ view, onPick, onNewLead, onOpenHit, counts }: { view: CrmView; onPick: (v: CrmView) => void; onNewLead: () => void; onOpenHit: (hit: SearchHit) => void; counts: RailCounts }) {
  const sections: Array<{ label: string | null; items: Item[] }> = [
    {
      label: null,
      items: [
        { id: 'dash', label: 'Dashboard', icon: 'grid' },
        { id: 'pipe', label: 'Pipeline', icon: 'kanban', badge: counts.openDeals },
      ],
    },
    {
      label: 'Sales',
      items: [
        { id: 'leads', label: 'Leads', icon: 'user-plus', badge: counts.newLeads },
        { id: 'fu', label: 'Follow-ups', icon: 'phone', badge: counts.late, tone: 'red' },
        { id: 'acc', label: 'Accounts', icon: 'building' },
        { id: 'quotes', label: 'Quotes', icon: 'file-text' },
      ],
    },
    {
      label: 'Catalogue',
      items: [
        { id: 'price', label: 'Price list', icon: 'list' },
        { id: 'intake', label: 'Lead intake', icon: 'inbox' },
        { id: 'set', label: 'Settings', icon: 'settings' },
      ],
    },
  ];

  const item = (i: Item) => {
    const on = i.id === view;
    const web = !NATIVE.has(i.id);
    return (
      <button
        key={i.id}
        type="button"
        title={web ? `${i.label} — opens in your browser` : i.label}
        aria-current={on ? 'page' : undefined}
        onClick={() => (web ? void call('app:openInBrowser', { path: '/crm' }) : onPick(i.id))}
        className={cx('relative flex h-[30px] shrink-0 items-center gap-[9px] rounded-[8px] pr-2 pl-2.5 text-left', on ? 'bg-[#EAEDFB] font-bold text-[#1B2A85] dark:bg-selection dark:text-primary' : 'font-medium text-ink hover:bg-subtle')}
      >
        <span className={cx('absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r-[3px]', on ? 'bg-primary' : 'bg-transparent')} />
        <Icon name={i.icon} size={16} className={cx('shrink-0', on ? 'text-primary' : 'text-ink-3')} />
        <span className="min-w-0 flex-1 truncate">{i.label}</span>
        {i.badge ? (
          <span className={cx('flex h-[18px] min-w-5 shrink-0 items-center justify-center rounded-[9px] px-1.5 text-[11px] font-bold tabular-nums', i.tone === 'red' ? 'bg-badge text-white' : on ? 'bg-surface text-primary' : 'bg-selection text-primary')}>{i.badge}</span>
        ) : web ? (
          <Icon name="external" size={12} className="shrink-0 text-ink-3" />
        ) : null}
      </button>
    );
  };

  return (
    <nav aria-label="CRM" className="flex w-[220px] shrink-0 flex-col overflow-hidden border-r border-line bg-[#FBFBFD] text-[13px] text-ink dark:bg-surface">
      <div className="flex flex-col gap-2 px-2.5 pt-3.5 pb-1">
        <button type="button" onClick={onNewLead} className="flex h-[38px] items-center justify-center gap-1.5 rounded-[9px] bg-primary font-bold text-white hover:bg-primary-hover">
          <Icon name="plus" size={16} /> New lead
        </button>
        <CrmSearch onOpen={onOpenHit} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pb-2.5 scroll-thin">
        {sections.map((s) => (
          <div key={s.label ?? 'top'} className="flex flex-col">
            {s.label ? <div className="mt-3 mb-0.5 px-2 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">{s.label}</div> : null}
            {s.items.map(item)}
          </div>
        ))}
        {counts.tasksToday + counts.meetingsToday > 0 ? (
          <>
            <div className="mt-3 mb-0.5 px-2 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">Today</div>
            {counts.tasksToday > 0 ? (
              <span className="flex items-center gap-2 px-2 py-[3px] text-[12.5px] text-ink-2">
                <Icon name="tasks" size={14} className="text-ink-3" /> {counts.tasksToday} {counts.tasksToday === 1 ? 'task' : 'tasks'} due
              </span>
            ) : null}
            {counts.meetingsToday > 0 ? (
              <span className="flex items-center gap-2 px-2 py-[3px] text-[12.5px] text-ink-2">
                <Icon name="calendar" size={14} className="text-ink-3" /> {counts.meetingsToday} {counts.meetingsToday === 1 ? 'meeting' : 'meetings'}
              </span>
            ) : null}
          </>
        ) : null}
        <div className="mt-3 mb-0.5 px-2 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">Administration</div>
        {item({ id: 'access', label: 'My access', icon: 'key' })}
      </div>
    </nav>
  );
}

/** Search the CRM: accounts, leads, deals and contacts as you type. */
function CrmSearch({ onOpen }: { onOpen: (hit: SearchHit) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const needle = q.trim();
  const res = useQuery({
    queryKey: ['crm', 'search', needle],
    queryFn: ({ signal }) => apiGet<{ results: SearchHit[] }>('/api/crm/search', { q: needle }, signal),
    enabled: needle.length >= 2,
    staleTime: 30_000,
  });
  const hits = res.data?.results ?? [];
  return (
    <div className="relative">
      <label className="flex h-8 items-center gap-2 rounded-[8px] border border-line bg-surface px-2.5 focus-within:border-primary">
        <Icon name="search" size={14} className="text-ink-3" />
        <input
          value={q}
          onChange={(e) => (setQ(e.target.value), setOpen(true))}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => e.key === 'Escape' && (setQ(''), setOpen(false))}
          placeholder="Search the CRM"
          aria-label="Search the CRM"
          className="bare-focus min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-3"
        />
      </label>
      {open && needle.length >= 2 ? (
        <div role="listbox" aria-label="CRM results" className="absolute top-full right-0 left-0 z-30 mt-1 max-h-80 overflow-y-auto rounded-[10px] border border-line bg-surface py-1 shadow-[0_12px_32px_rgb(var(--ws-shadow-rgb)/.18)] scroll-thin">
          {hits.length === 0 ? (
            <p className="m-0 px-3 py-2 text-[12px] text-ink-3">{res.isLoading ? 'Searching…' : 'Nothing found'}</p>
          ) : (
            hits.map((h) => (
              <button
                key={`${h.type}-${h.id}`}
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => (setQ(''), setOpen(false), onOpen(h))}
                className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-subtle"
              >
                <span className="mt-0.5 w-12 shrink-0 text-[10px] font-semibold tracking-wide text-ink-3 uppercase">{h.type}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-ink">{h.title}</span>
                  {h.subtitle || h.meta ? <span className="block truncate text-[11.5px] text-ink-3">{[h.subtitle, h.meta].filter(Boolean).join(' · ')}</span> : null}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
