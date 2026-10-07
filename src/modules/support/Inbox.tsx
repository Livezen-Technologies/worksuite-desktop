import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { VIEW_LABEL, isView, parseSupportRoute, ticketRoute, type SavedView, type SupportSort, type Ticket, type TicketShow } from '@shared/support';
import { app } from '../../core/app-state';
import { useOrgSelection } from '../../core/org-prefs';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { useNow } from '../../core/use-now';
import { ResizeDivider, useResizableWidth } from '../../components/ResizeDivider';
import { SidePanel } from '../../components/SidePanel';
import { Empty } from '../../components/ui';
import { K, listTickets, meta, views } from './api';
import { Availability } from './Availability';
import type { ComposerMode } from './Composer';
import { usePollInterval, useRealtimeLive, useSupportLive } from './live';
import { NewTicketSheet } from './NewTicket';
import { showCreated } from './newTicketForm';
import { mayCreateTicket } from './palette';
import { Rail } from './Rail';
import { ReadingPane } from './ReadingPane';
import { OutboxBar } from './Outbox';
import { ResolveDialog } from './ResolveDialog';
import { NO_FILTERS, TicketList, channelChoices, type ListFilters } from './TicketList';
import { WallboardChooser, mayReadReports } from './Wallboard';
import { isMac } from '../../core/bridge';
import { Button } from '../../components/ui';

/**
 * The support inbox (D-01): three panes — the views rail with live counts, the view's tickets, and the reading pane —
 * kept current by the realtime gateway (live.ts), with the keyboard of FR-WSP-06: j/k move, Enter opens the ticket's
 * tab, R replies, N writes a note, E resolves, / searches, ⌘↵ sends from the reading pane — and C raises a new ticket
 * (#298).
 *
 * The view and its search live in the route (`/support?view=unassigned&q=…`), so the quick actions, a deep link and a
 * restored tab open on them; the filters, the sort and the ticket being read are this tab's own. `?new=1` (⌘K's Create
 * ticket, ⌘N here) opens the New ticket form and is taken off the route again.
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
  const qc = useQueryClient();
  const me = Number(useStore(app, (s) => s.auth?.user?.id ?? 0)) || null;
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
    source: filters.source.length ? filters.source : undefined,
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
  // New ticket (#298): for whoever may raise one, once the desk has said (or could not be asked).
  const [creating, setCreating] = useState(false);
  const metaKnown = metaQ.isSuccess || metaQ.isError;
  const canCreate = metaKnown && mayCreateTicket(metaQ.data);
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
      } else if ((k === 'c' || k === 'C') && canCreate) {
        e.preventDefault();
        setCreating(true);
      }
    };
  });

  // `?new=1` (⌘K's Create ticket, ⌘N): the form, once the desk has said whether I may — and the route without it.
  const askedNew = new URLSearchParams(route.split('?')[1] ?? '').get('new') === '1';
  const [seenNew, setSeenNew] = useState(false);
  if (metaKnown && askedNew !== seenNew) {
    setSeenNew(askedNew);
    if (askedNew && canCreate) setCreating(true);
  }
  useEffect(() => {
    if (!askedNew || !metaKnown) return;
    if (!canCreate) toast('error', text('You do not have permission to create tickets.'));
    const rest = new URLSearchParams(route.split('?')[1] ?? '');
    rest.delete('new');
    go(rest.size ? `/support?${rest.toString()}` : '/support');
    // Once per ask: the route changing back must not ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askedNew, metaKnown]);
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  // The wallboard on a display (D-12), for whoever reads the desk's reports: ⌘⇧F / Ctrl+Shift+F, or the rail's button.
  const [wallOpen, setWallOpen] = useState(false);
  const wallAllowed = mayReadReports(metaQ.data);
  useEffect(() => {
    if (!active || !wallAllowed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'f' || !e.shiftKey || e.altKey || !(isMac ? e.metaKey : e.ctrlKey)) return;
      e.preventDefault();
      e.stopPropagation();
      setWallOpen(true);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, wallAllowed]);

  const title = saved ? saved.name : text(rail.data?.views.find((v) => v.key === view)?.label ?? VIEW_LABEL[view as keyof typeof VIEW_LABEL] ?? view);
  const count = saved ? saved.count : (rail.data?.views.find((v) => v.key === view)?.count ?? null);
  const single = orgs.length === 1 ? Number(orgs[0]) : orgOptions.length === 1 ? Number(orgOptions[0]!.id) : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-ground">
      <OutboxBar />
      <div className="flex min-h-0 flex-1">
        <SidePanel id="support" label={text('the views')}>
          <Rail
            views={rail.data?.views ?? []}
            saved={rail.data?.saved ?? []}
            view={saved ? null : view}
            savedId={savedId}
            onView={(key) => pick({ view: key })}
            onSaved={(s) => pick({ saved: s.id })}
            orgs={orgOptions.length > 1 ? { options: orgOptions, value: orgs, onChange: setOrgs } : null}
            footer={
              <>
                {wallAllowed ? (
                  <div className="px-2 pb-1">
                    <Button size="sm" variant="ghost" icon="tv" className="w-full justify-start" aria-keyshortcuts={isMac ? 'Meta+Shift+F' : 'Control+Shift+F'} onClick={() => setWallOpen(true)}>
                      {text('Wallboard')}
                    </Button>
                  </div>
                ) : null}
                <Availability organization={single} active={active} />
              </>
            }
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
              channels={channelChoices(metaQ.data?.sources)}
              onNew={canCreate ? () => setCreating(true) : null}
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
            <Empty
              icon="life-buoy"
              title={text('Choose a ticket to read it here')}
              hint={canCreate ? text('j and k move down and up the list; Enter opens the ticket in a tab of its own; c raises a new one.') : text('j and k move down and up the list; Enter opens the ticket in a tab of its own.')}
            />
          )}
        </div>
      </div>
      {resolving ? <ResolveDialog ticket={resolving} onClose={() => setResolving(null)} /> : null}
      {creating ? (
        <NewTicketSheet
          meta={metaQ.data}
          selectedOrganization={orgs.length === 1 ? Number(orgs[0]) : null}
          onClose={() => setCreating(false)}
          onCreated={(t) => {
            // In the lists it belongs in at once, and in the reading pane (#298).
            showCreated(qc, t, me);
            select(t.id);
          }}
        />
      ) : null}
      {wallOpen ? <WallboardChooser onClose={() => setWallOpen(false)} /> : null}
    </div>
  );
}
