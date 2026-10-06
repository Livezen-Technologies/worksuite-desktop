import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { VIEW_LABEL, isView, parseSupportRoute, ticketRoute, type SavedView, type SupportSort, type Ticket, type TicketShow } from '@shared/support';
import { useOrgSelection } from '../../core/org-prefs';
import { useTab, useTabTitle } from '../../core/tab-context';
import { text } from '../../core/i18n';
import { useNow } from '../../core/use-now';
import { ResizeDivider, useResizableWidth } from '../../components/ResizeDivider';
import { SidePanel } from '../../components/SidePanel';
import { Empty } from '../../components/ui';
import { K, listTickets, meta, views } from './api';
import { Availability } from './Availability';
import type { ComposerMode } from './Composer';
import { usePollInterval, useRealtimeLive, useSupportLive } from './live';
import { Rail } from './Rail';
import { ReadingPane } from './ReadingPane';
import { ResolveDialog } from './ResolveDialog';
import { NO_FILTERS, TicketList, type ListFilters } from './TicketList';

/**
 * The support inbox (D-01): three panes — the views rail with live counts, the view's tickets, and the reading pane —
 * kept current by the realtime gateway (live.ts), with the keyboard of FR-WSP-06: j/k move, Enter opens the ticket's
 * tab, R replies, N writes a note, E resolves, / searches, ⌘↵ sends from the reading pane.
 *
 * The view and its search live in the route (`/support?view=unassigned&q=…`), so the quick actions, a deep link and a
 * restored tab open on them; the filters, the sort and the ticket being read are this tab's own.
 */
const PAGE = 50;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** A key typed with no editor in front of it (a list's single-letter keys). */
function isTyping(e: KeyboardEvent): boolean {
  const t = e.target;
  return t instanceof Element && !!t.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]');
}

/** A saved view's filters as the list's parameters: the keys the server keeps for one (`ViewsController::FILTERS`). */
function savedParams(s: SavedView): { view: string; extra: Record<string, string>; status: string[]; priority: string[]; q: string } {
  const f = s.filters ?? {};
  const str = (v: unknown) => (Array.isArray(v) ? v.join(',') : v === null || v === undefined ? '' : String(v));
  const extra: Record<string, string> = {};
  for (const k of ['type', 'source', 'assignee', 'team', 'department', 'category', 'tag', 'sla', 'organization', 'created_from', 'created_to', 'updated_from', 'updated_to']) {
    const v = str(f[k]);
    if (v) extra[k] = v;
  }
  const list = (v: unknown) => str(v).split(',').map((x) => x.trim()).filter(Boolean);
  return { view: str(f.view) || 'all', extra, status: list(f.status), priority: list(f.priority), q: str(f.q) };
}

export function Inbox({ route, active }: { route: string; active: boolean }) {
  useTabTitle(text('Support'));
  useSupportLive();
  const { go, navigate } = useTab();
  const r = parseSupportRoute(route);
  const routeView = r.kind === 'inbox' ? r.view : null;
  const savedId = r.kind === 'inbox' && r.saved && /^\d+$/.test(r.saved) ? Number(r.saved) : null;
  const live = useRealtimeLive();
  const poll = usePollInterval();
  const now = useNow(30_000).getTime();

  const metaQ = useQuery({ queryKey: K.meta, queryFn: ({ signal }) => meta(signal), staleTime: 5 * 60_000 });
  const orgOptions = (metaQ.data?.organizations ?? []).map((o) => ({ id: String(o.id), name: o.name }));
  const [orgs, setOrgs] = useOrgSelection('support', orgOptions.map((o) => o.id), []);
  const orgKey = orgs.join(',');
  const rail = useQuery({ queryKey: K.views(orgKey), queryFn: () => views(orgs), refetchInterval: poll });
  const saved = savedId !== null ? (rail.data?.saved.find((s) => s.id === savedId) ?? null) : null;

  const [typed, setTyped] = useState(r.kind === 'inbox' ? (r.q ?? '') : '');
  const q = useDebounced(typed.trim(), 300);
  const [sort, setSort] = useState<SupportSort>('updated');
  const [filters, setFilters] = useState<ListFilters>(NO_FILTERS);
  const base = saved ? savedParams(saved) : null;
  const view = base?.view ?? (isView(routeView) ? routeView : 'mine');
  const params = {
    view,
    sort: (saved?.sort as SupportSort | null) ?? sort,
    q: q || base?.q || undefined,
    status: filters.status.length ? filters.status : base?.status,
    priority: filters.priority.length ? filters.priority : base?.priority,
    organization: base?.extra.organization ? undefined : orgs,
    extra: base?.extra,
    limit: PAGE,
  };
  const list = useInfiniteQuery({
    queryKey: K.list({ ...params, saved: savedId }),
    queryFn: ({ pageParam, signal }) => listTickets({ ...params, cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.has_more ? (last.next_cursor ?? undefined) : undefined),
    refetchInterval: poll,
  });
  const rows: Ticket[] = [];
  const seen = new Set<number>();
  // A ticket moving between pages while the list is read shows once.
  for (const p of list.data?.pages ?? []) {
    for (const t of p.items) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      rows.push(t);
    }
  }

  const listKey = JSON.stringify(params) + String(savedId);
  const [sel, setSel] = useState<{ key: string; id: number } | null>(null);
  const selectedId = sel && sel.key === listKey ? sel.id : null;
  const select = (id: number | null) => setSel(id === null ? null : { key: listKey, id });
  const [focusRequest, setFocusRequest] = useState<{ mode: ComposerMode; n: number } | null>(null);
  const [resolving, setResolving] = useState<TicketShow['ticket'] | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const width = useResizableWidth('support.list', { defaultWidth: 380, min: 300, max: () => Math.max(300, window.innerWidth - 760) });

  const openTab = (id: number) => navigate(ticketRoute(id));
  const pick = (to: { view?: string; saved?: number }) => {
    const query = new URLSearchParams();
    if (to.saved !== undefined) query.set('saved', String(to.saved));
    else if (to.view) query.set('view', to.view);
    go(`/support?${query.toString()}`);
  };

  // The keys of FR-WSP-06, read through a ref so the listener is attached once per activation.
  const keys = useRef<(e: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    keys.current = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return;
      const at = selectedId === null ? -1 : rows.findIndex((t) => t.id === selectedId);
      const k = e.key;
      if (k === 'j' || k === 'k') {
        e.preventDefault();
        const next = k === 'j' ? Math.min(rows.length - 1, at + 1) : Math.max(0, at === -1 ? 0 : at - 1);
        if (rows[next]) select(rows[next]!.id);
        document.getElementById(`support-row-${rows[next]?.id}`)?.scrollIntoView?.({ block: 'nearest' });
      } else if ((k === 'Enter' || k === 'o') && selectedId !== null) {
        e.preventDefault();
        openTab(selectedId);
      } else if ((k === 'r' || k === 'R' || k === 'n' || k === 'N') && selectedId !== null) {
        e.preventDefault();
        setFocusRequest((f) => ({ mode: k.toLowerCase() === 'r' ? 'reply' : 'note', n: (f?.n ?? 0) + 1 }));
      } else if ((k === 'e' || k === 'E') && selectedId !== null) {
        const t = rows[at];
        if (!t) return;
        e.preventDefault();
        setResolving(t);
      } else if (k === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
  });
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  const title = saved ? saved.name : text(rail.data?.views.find((v) => v.key === view)?.label ?? VIEW_LABEL[view as keyof typeof VIEW_LABEL] ?? view);
  const count = saved ? saved.count : (rail.data?.views.find((v) => v.key === view)?.count ?? null);
  const single = orgs.length === 1 ? Number(orgs[0]) : orgOptions.length === 1 ? Number(orgOptions[0]!.id) : null;

  return (
    <div className="flex h-full min-h-0 bg-ground">
      <SidePanel id="support" label={text('the views')}>
        <Rail
          views={rail.data?.views ?? []}
          saved={rail.data?.saved ?? []}
          view={saved ? null : view}
          savedId={savedId}
          onView={(key) => pick({ view: key })}
          onSaved={(s) => pick({ saved: s.id })}
          orgs={orgOptions.length > 1 ? { options: orgOptions, value: orgs, onChange: setOrgs } : null}
          footer={<Availability organization={single} active={active} />}
        />
      </SidePanel>
      <div className="relative flex shrink-0 border-r border-line" style={{ width: width.width }}>
        <div className="min-w-0 flex-1">
          <TicketList
            title={title}
            count={count}
            live={live}
            offline={list.data?.pages[0]?.offline === true}
            rows={rows}
            selectedId={selectedId}
            onSelect={(id) => select(id)}
            onOpen={openTab}
            loading={list.isLoading}
            error={list.error}
            onRetry={() => void list.refetch()}
            hasMore={!!list.hasNextPage}
            loadingMore={list.isFetchingNextPage}
            onMore={() => void list.fetchNextPage()}
            q={typed}
            onQ={setTyped}
            sort={(saved?.sort as SupportSort | null) ?? sort}
            sorts={metaQ.data?.sorts ?? ['updated']}
            onSort={setSort}
            filters={filters}
            onFilters={setFilters}
            searchRef={searchRef}
            now={now}
          />
        </div>
        <ResizeDivider state={width} label={text('Resize the ticket list')} />
      </div>
      <div className="min-w-0 flex-1">
        {selectedId !== null ? (
          <ReadingPane key={selectedId} ticketId={selectedId} active={active} focusRequest={focusRequest} onOpenTab={openTab} onResolve={(s) => setResolving(s.ticket)} />
        ) : (
          <Empty icon="life-buoy" title={text('Choose a ticket to read it here')} hint={text('j and k move down and up the list; Enter opens the ticket in a tab of its own.')} />
        )}
      </div>
      {resolving ? <ResolveDialog ticket={resolving} onClose={() => setResolving(null)} /> : null}
    </div>
  );
}
