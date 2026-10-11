import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { Button, cx } from '../../../components/ui';
import { CompanySelect, useOrgParam } from '../company';
import { openWeb } from '../parts';
import { HEALTH_CHIP, PRIORITY, daysLeftText, fmtDay, pk, preads, projectPath, shortMoney, usedTone, type FullProject } from '../portfolio';
import type { ProjectStatus } from '../api';
import { Failed, HealthChip, Loading, Mono, Nothing, PageHead, Panel, Progress, ProjectStatusChip, TD, TH, needsConnection } from './kit';

/**
 * W02 · All projects (PRJ-REG), natively (D01's density and tokens). The Templates view is TemplateLibrary.tsx.
 *
 * Every filter lives in the address — `/projects/all?status=active&health=at_risk` — so the dashboard's figures link
 * straight to the rows behind them and a filtered list is a route like any other (a tab, a window, a link). "Company ▾"
 * is the shared company selector: the register, its tab counts and the client and manager filters are that company's.
 * Health is a word on a chip, never a colour alone (NFR-08).
 */

type TabKey = 'all' | ProjectStatus;
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'planning', label: 'Planning' },
  { key: 'pending_approval', label: 'Pending approval' },
  { key: 'on_hold', label: 'On hold' },
  { key: 'completed', label: 'Completed' },
  { key: 'archived', label: 'Archived' },
];

const PER_PAGE = 30;

export function NewProjectButton({ may, offline, onNew }: { may: boolean; offline: boolean; onNew: () => void }) {
  if (!may) return null;
  return (
    <Button size="sm" variant="primary" icon="plus" disabled={offline} title={offline ? needsConnection('New project') : undefined} onClick={onNew}>
      New project
    </Button>
  );
}

/** "Client: any ▾" — a filter as the design draws it. */
function FilterSelect({ label, value, onChange, options, anyLabel = 'any' }: { label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>; anyLabel?: string }) {
  return (
    <Select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      options={[{ value: '', label: `${label}: ${anyLabel}` }, ...options.map((o) => ({ ...o, label: `${label}: ${o.label}` }))]}
      className="h-7 min-w-[130px] rounded-[8px] border border-line bg-surface px-2.5 text-[12px]"
    />
  );
}

export function AllProjects({ query, offline, mayCreate, onGo, onNew, onOffline }: {
  query: URLSearchParams;
  offline: boolean;
  mayCreate: boolean;
  onGo: (route: string) => void;
  onNew: () => void;
  onOffline: (o: boolean) => void;
}) {
  const org = useOrgParam();
  const status = (query.get('status') ?? 'all') as TabKey;
  const view = query.get('view') === 'cards' ? 'cards' : 'table';
  const page = Math.max(1, Number(query.get('page')) || 1);
  const filters = { client_id: query.get('client_id') ?? '', manager_id: query.get('manager_id') ?? '', health: query.get('health') ?? '', priority: query.get('priority') ?? '' };
  const qParam = query.get('q') ?? '';
  const [search, setSearch] = useState(qParam);

  /** Sets (or clears) address parameters; any filter change returns to page 1. */
  const patch = (next: Record<string, string | null>, keepPage = false) => {
    const p = new URLSearchParams(query);
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === '' || (k === 'status' && v === 'all') || (k === 'view' && v === 'table')) p.delete(k);
      else p.set(k, v);
    }
    if (!keepPage) p.delete('page');
    onGo(`/projects/all${p.toString() ? `?${p}` : ''}`);
  };

  // Typing does not send a request per key: the search settles for 250 ms first.
  useEffect(() => {
    if (search === qParam) return;
    const t = setTimeout(() => patch({ q: search.trim() || null }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `patch` reads the current address; re-running on it would loop
  }, [search]);

  const listParams = { q: qParam, status: status === 'all' ? null : status, ...filters, page, per_page: PER_PAGE };
  const list = useQuery({ queryKey: pk.register(listParams), queryFn: ({ signal }) => preads.register(listParams, { signal }), placeholderData: (prev) => prev });
  const clients = useQuery({ queryKey: pk.clients({}), queryFn: ({ signal }) => preads.clients({}, { signal }), staleTime: 300_000 });
  const people = useQuery({ queryKey: pk.people(org), queryFn: ({ signal }) => preads.people(null, { signal }), staleTime: 300_000 });
  const fromCache = !!list.data?.offline;
  useEffect(() => onOffline(fromCache), [fromCache, onOffline]);

  const d = list.data?.data;
  const counts = d?.status_counts ?? {};
  const allCount = counts.all ?? Object.entries(counts).filter(([k]) => k !== 'all').reduce((s, [, n]) => s + n, 0);
  const tabs = TABS.filter((t) => t.key !== 'pending_approval' || (counts.pending_approval ?? 0) > 0 || status === 'pending_approval');
  const filtered = Boolean(qParam || filters.client_id || filters.manager_id || filters.health || filters.priority || status !== 'all');
  const rows = d?.projects ?? [];
  const total = d?.total ?? 0;
  const per = d?.per_page || PER_PAGE;
  const open = (p: FullProject) => onGo(projectPath(p.id));
  const may = (d?.can?.manage ?? mayCreate) && mayCreate;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead title="All projects" actions={<NewProjectButton may={may} offline={offline} onNew={onNew} />}>
        <nav aria-label="Status" className="flex gap-0.5 overflow-x-auto">
          {tabs.map((t) => {
            const on = t.key === status;
            const n = d ? (t.key === 'all' ? allCount : (counts[t.key] ?? 0)) : null;
            return (
              <button key={t.key} type="button" aria-current={on ? 'page' : undefined} onClick={() => patch({ status: t.key })} className={cx('-mb-px flex h-8 items-center gap-1.5 border-b-2 px-2.5 text-[12.5px] whitespace-nowrap', on ? 'border-primary font-bold text-primary' : 'border-transparent font-semibold text-ink-2 hover:text-ink')}>
                {t.label}
                {n !== null ? <Mono className="text-[11px] text-ink-3">{n}</Mono> : null}
              </button>
            );
          })}
        </nav>
      </PageHead>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-3.5 scroll-thin">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-7 w-[260px] items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2 text-ink-3 focus-within:border-primary">
            <Icon name="search" size={13} />
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or code" aria-label="Search name or code" className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none" />
          </label>
          <CompanySelect />
          <FilterSelect label="Client" value={filters.client_id} onChange={(v) => patch({ client_id: v })} options={(clients.data?.data.clients ?? []).map((c) => ({ value: String(c.id), label: c.name }))} />
          <FilterSelect label="Manager" anyLabel="anyone" value={filters.manager_id} onChange={(v) => patch({ manager_id: v })} options={(people.data?.data.people ?? []).map((p) => ({ value: String(p.id), label: p.name }))} />
          <FilterSelect label="Health" value={filters.health} onChange={(v) => patch({ health: v })} options={(['on_track', 'watch', 'at_risk'] as const).map((h) => ({ value: h, label: HEALTH_CHIP[h].label }))} />
          <FilterSelect label="Priority" value={filters.priority} onChange={(v) => patch({ priority: v })} options={Object.entries(PRIORITY).map(([value, p]) => ({ value, label: p.label }))} />
          <div role="group" aria-label="View" className="ms-auto flex rounded-[8px] border border-line bg-ground p-0.5">
            {(['table', 'cards'] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => patch({ view: v }, true)} className={cx('h-6 rounded-[6px] px-2.5 text-[12px] font-semibold', view === v ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink')}>
                {v === 'table' ? 'Table' : 'Cards'}
              </button>
            ))}
          </div>
        </div>

        {list.isLoading ? (
          <Loading label="Loading projects" />
        ) : list.error && !d ? (
          <Failed error={list.error} onRetry={() => void list.refetch()} />
        ) : rows.length === 0 ? (
          <Panel>
            {filtered ? (
              <Nothing
                text="No projects match these filters."
                action={
                  <Button size="sm" onClick={() => (setSearch(''), onGo(`/projects/all${view === 'cards' ? '?view=cards' : ''}`))}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <Nothing text="No projects yet." action={<NewProjectButton may={may} offline={offline} onNew={onNew} />} />
            )}
          </Panel>
        ) : view === 'cards' ? (
          <ul aria-label="Projects" className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2.5">
            {rows.map((p) => (
              <li key={p.id}>
                <ProjectCard p={p} onOpen={() => open(p)} />
              </li>
            ))}
          </ul>
        ) : (
          <Panel className="overflow-hidden">
            <div className="overflow-x-auto scroll-thin">
              <table className="w-full min-w-[960px] border-collapse">
                <caption className="sr-only">Projects</caption>
                <thead className="bg-ground">
                  <tr>
                    <th scope="col" className={TH}>Project</th>
                    <th scope="col" className={TH}>Client</th>
                    <th scope="col" className={TH}>Manager</th>
                    <th scope="col" className={TH}>Status</th>
                    <th scope="col" className={TH}>Health</th>
                    <th scope="col" className={cx(TH, 'w-[130px]')}>Progress</th>
                    <th scope="col" className={TH}>Ends</th>
                    <th scope="col" className={cx(TH, 'text-end')}>Budget</th>
                    <th scope="col" className={cx(TH, 'text-end')}>Used</th>
                    <th scope="col" className={cx(TH, 'text-end')}>Team</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} onClick={() => open(p)} className="cursor-pointer border-t border-line/70 hover:bg-subtle">
                      <td className={TD}>
                        <button type="button" onClick={(e) => (e.stopPropagation(), open(p))} className="text-start font-semibold text-ink hover:text-primary hover:underline">
                          {p.name}
                        </button>
                        <div className="font-mono text-[11px] text-ink-3">
                          {p.code}
                          {p.category ? ` · ${p.category}` : ''}
                        </div>
                      </td>
                      <td className={cx(TD, 'text-ink-2')}>{p.client ?? 'Internal'}</td>
                      <td className={cx(TD, 'text-ink-2')}>{p.manager ?? '—'}</td>
                      <td className={TD}>
                        <ProjectStatusChip status={p.status} />
                      </td>
                      <td className={TD}>
                        <HealthChip health={p.health} />
                      </td>
                      <td className={TD}>
                        <Progress value={p.progress ?? 0} label={`${p.name} progress`} fill={p.status === 'completed' ? 'bg-success' : 'bg-primary'} />
                      </td>
                      <td className={cx(TD, 'text-ink-2')}>
                        <Ends p={p} />
                      </td>
                      <td className={cx(TD, 'text-end')}>
                        <Mono className="text-ink-2">{shortMoney(p.budget, p.currency)}</Mono>
                      </td>
                      <td className={cx(TD, 'text-end')}>
                        <Mono className={usedTone(p.budget_used_percent)}>{p.budget_used_percent ?? 0}%</Mono>
                      </td>
                      <td className={cx(TD, 'text-end text-ink-2')}>
                        <Mono>{p.members ?? 0}</Mono>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        {total > per ? (
          <nav aria-label="Pages" className="flex flex-wrap items-center gap-3 text-[12.5px] text-ink-2">
            <span>
              Showing <Mono>{`${(page - 1) * per + 1}–${Math.min(total, page * per)}`}</Mono> of <Mono>{total}</Mono>
            </span>
            <div className="ms-auto flex gap-2">
              <Button size="sm" disabled={page <= 1} onClick={() => patch({ page: String(page - 1) }, true)}>
                Previous
              </Button>
              <Button size="sm" disabled={page * per >= total} onClick={() => patch({ page: String(page + 1) }, true)}>
                Next
              </Button>
            </div>
          </nav>
        ) : null}
        <button type="button" onClick={() => openWeb('/projects/all')} className="self-start text-[12px] text-ink-3 hover:text-primary hover:underline">
          Open on the web
        </button>
      </div>
    </div>
  );
}

/** End date, with "21 days left" / "4 days late" / "Done 28 Sep" under it. */
function Ends({ p }: { p: FullProject }) {
  let line: ReactNode = null;
  if (p.status === 'completed') line = <span className="text-ink-3">Done {fmtDay(p.completed_at)}</span>;
  else if (p.status !== 'cancelled' && p.status !== 'archived') {
    const d = daysLeftText(p.days_left);
    if (d.text) line = <span className={d.late ? 'font-semibold text-danger' : 'text-ink-3'}>{d.text}</span>;
  }
  return (
    <>
      <span>{fmtDay(p.end_date)}</span>
      {line ? <div className="text-[11px]">{line}</div> : null}
    </>
  );
}

function ProjectCard({ p, onOpen }: { p: FullProject; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex h-full w-full flex-col gap-2 rounded-[12px] border border-line bg-surface p-3.5 text-start hover:border-primary/50">
      <span className="flex w-full items-start gap-2">
        <span className="min-w-0 flex-1">
          <b className="block text-[13px] text-ink">{p.name}</b>
          <span className="font-mono text-[11px] text-ink-3">
            {p.code}
            {p.category ? ` · ${p.category}` : ''}
          </span>
        </span>
        <ProjectStatusChip status={p.status} />
      </span>
      <span className="text-[12px] text-ink-2">
        {p.client ?? 'Internal'} · {p.manager ?? 'No manager'}
      </span>
      <span className="w-full">
        <Progress value={p.progress ?? 0} label={`${p.name} progress`} fill={p.status === 'completed' ? 'bg-success' : 'bg-primary'} />
      </span>
      <span className="mt-auto flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-2">
        <HealthChip health={p.health} />
        <span>
          <Ends p={p} />
        </span>
        <span className="ms-auto text-end">
          <Mono>{shortMoney(p.budget, p.currency)}</Mono> · <Mono className={usedTone(p.budget_used_percent)}>{p.budget_used_percent ?? 0}% used</Mono>
        </span>
        <span>
          Team <Mono>{p.members ?? 0}</Mono>
        </span>
      </span>
    </button>
  );
}
