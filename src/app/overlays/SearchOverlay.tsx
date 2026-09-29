import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { canOpenApp, canOpenLink, canOpenRoute } from '@shared/access';
import { resolveWebLink } from '@shared/links';
import { idsOf } from '../../core/access';
import { app } from '../../core/app-state';
import { ApiError, apiGet } from '../../core/api';
import { appColour, groupLook } from '../../core/app-look';
import { call } from '../../core/bridge';
import { allCommands, effectiveShortcuts, prettyAccelerator } from '../../core/commands';
import { appLabel } from '../../core/i18n';
import { noteRecentApp } from '../../core/recent-apps';
import { useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { openWebLink } from '../../core/tab-context';
import { relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { closeOverlay, ui } from '../../core/ui';
import { AppTile } from '../../components/AppTile';
import { Icon } from '../../components/Icon';
import { cx, DATA_TEXT } from '../../components/ui';

/**
 * Global search (GlobalSearch; Ctrl/Cmd+K, FR-SRCH-01/02) and the command
 * palette (Ctrl/Cmd+Shift+P, FR-SRCH-03) in one box. Idle, it offers recent
 * searches, the apps to jump to and things to create. Typing searches the
 * person's apps and the server's permission-aware global search, grouped, with
 * a filter per group (Tab steps through them) and a preview of the selected
 * result. `>` switches to commands. Offline it falls back to what is saved on
 * this computer, and says so.
 */
export interface Item {
  key: string;
  group: string;
  title: string;
  subtitle?: string;
  at?: string;
  colour: string;
  icon: string;
  /** Opens in the browser. */
  ext?: boolean;
  /** A command rather than a record. */
  action?: boolean;
  hint?: string;
  kv: Array<[string, string]>;
  /** The button in the preview. */
  verb: string;
  run: () => void;
  /** Open in a new window, when the result has a desktop screen. */
  window?: () => void;
  /** A web link to copy. */
  link?: string;
}

/** The title cut round the first match, for the highlight. */
export function splitMatch(text: string, q: string): { a: string; m: string; b: string } {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  return i < 0 ? { a: text, m: '', b: '' } : { a: text.slice(0, i), m: text.slice(i, i + q.length), b: text.slice(i + q.length) };
}

/** The scope a Tab press moves to. */
export function nextScope(scopes: string[], current: string, back = false): string {
  if (!scopes.length) return 'All';
  const i = scopes.indexOf(current);
  return scopes[(i + (back ? scopes.length - 1 : 1) + scopes.length) % scopes.length] ?? 'All';
}

const RECENT_MAX = 6;
const recentKey = (user: string | number) => `ws.search.recent.${user}`;

export function readRecentSearches(user: string | number | null | undefined): string[] {
  if (user == null) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(recentKey(user)) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function noteRecentSearch(user: string | number | null | undefined, q: string): void {
  const t = q.trim();
  if (user == null || t.length < 2) return;
  try {
    const list = [t, ...readRecentSearches(user).filter((s) => s.toLowerCase() !== t.toLowerCase())].slice(0, RECENT_MAX);
    localStorage.setItem(recentKey(user), JSON.stringify(list));
  } catch {
    // Recent searches are a convenience.
  }
}

/** What "New…" can make here, as routes the modules open their new-item screen on. */
const CREATE: Array<{ id: string; label: string; app: string; route: string; icon: string }> = [
  { id: 'new-email', label: 'New mail', app: 'mail', route: '/mail?compose=1', icon: 'mail' },
  { id: 'new-task', label: 'New task', app: 'tasks', route: '/tasks?new=1', icon: 'tasks' },
  { id: 'new-event', label: 'New event', app: 'calendar', route: '/calendar?new=1', icon: 'calendar' },
  { id: 'new-note', label: 'New note', app: 'notes', route: '/notes?new=1', icon: 'notebook' },
  { id: 'upload', label: 'Upload file', app: 'files', route: '/files?upload=1', icon: 'upload' },
  { id: 'new-contact', label: 'New contact', app: 'contacts', route: '/contacts?new=1', icon: 'contact' },
  { id: 'new-lead', label: 'New lead', app: 'crm', route: '/crm?new=1', icon: 'users' },
];

interface ServerGroup {
  group: string;
  items: Array<{ id: number | string; title: string; subtitle: string | null; route: string; at: string | null }>;
}

export function SearchOverlay({ mode }: { mode: 'search' | 'palette' }) {
  const seed = useStore(ui, (s) => s.searchSeed);
  const [q, setQ] = useState(mode === 'palette' ? '>' : seed);
  const [scope, setScope] = useState('All');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const apps = useStore(app, (s) => s.apps);
  const shortcuts = effectiveShortcuts(useStore(app, (s) => s.prefs?.shortcuts));
  const network = useStore(app, (s) => s.status?.network);
  const user = useStore(app, (s) => s.auth?.user?.id ?? null);
  const origin = useStore(app, (s) => s.auth?.server?.origin ?? '');
  const [recent, setRecent] = useState(() => readRecentSearches(user));
  const commandMode = q.startsWith('>');
  const term = (commandMode ? q.slice(1) : q).trim();
  const [debounced, setDebounced] = useState(term);
  const idle = !commandMode && term === '';

  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(term), 180);
    return () => clearTimeout(h);
  }, [term]);

  const online = network !== 'OFFLINE';
  const server = useQuery({
    queryKey: ['search', debounced],
    queryFn: ({ signal }) => apiGet<{ results: ServerGroup[] }>('/api/search/global', { q: debounced }, signal),
    enabled: !commandMode && online && debounced.length >= 2,
    staleTime: 15_000,
    retry: false,
  });
  const offline = useQuery({
    queryKey: ['search-offline', debounced],
    queryFn: () => call('offline:search', { q: debounced }),
    enabled: !commandMode && debounced.length >= 2 && (!online || (server.error instanceof ApiError && server.error.offline)),
  });

  const allowed = idsOf(apps);
  const create = CREATE.filter((c) => allowed.has(c.app));

  const openApp = (a: (typeof apps)[number]) => {
    noteRecentApp(user, a.id);
    if (a.surface === 'native') navigate(`/${a.id}`);
    else void call('app:openInBrowser', { path: a.webPath });
  };

  const openRoute = (route: string, how: 'tab' | 'window' = 'tab') => {
    const t = resolveWebLink(route);
    if (how === 'window' && t.kind === 'tab') void call('windows:open', { kind: 'record', route: t.route, title: 'WorkSuite' });
    else openWebLink(route);
  };

  const items = useMemo<Item[]>(() => {
    const lower = term.toLowerCase();
    const out: Item[] = [];
    const appItem = (a: (typeof apps)[number], group: string): Item => ({
      key: `app:${a.id}`,
      group,
      title: appLabel(a),
      subtitle: a.surface === 'browser' ? 'Opens in your browser' : group === 'Apps' ? 'Desktop app' : undefined,
      colour: appColour(a.id),
      icon: a.icon,
      ext: a.surface === 'browser',
      kv: [['Opens', a.surface === 'browser' ? 'In your browser' : 'In the desktop app']],
      verb: `Open ${appLabel(a)}`,
      run: () => openApp(a),
      window: a.surface === 'native' ? () => void call('windows:open', { kind: 'record', route: `/${a.id}`, title: a.label }) : undefined,
      link: origin ? `${origin}${a.webPath}` : undefined,
    });
    if (commandMode) {
      for (const a of apps) if (!lower || appLabel(a).toLowerCase().includes(lower) || (a.keywords ?? '').includes(lower)) out.push(appItem(a, 'Go to'));
      for (const c of create) {
        if (lower && !c.label.toLowerCase().includes(lower)) continue;
        out.push({ key: `new:${c.id}`, group: 'Actions', title: c.label, colour: appColour(c.app), icon: c.icon, action: true, hint: shortcuts[c.id] ? prettyAccelerator(shortcuts[c.id]!) : undefined, kv: [['Creates', c.label.replace(/^New |^Upload /, '')]], verb: `Run “${c.label}”`, run: () => navigate(c.route) });
      }
      const made = new Set(create.map((c) => c.id));
      for (const c of allCommands()) {
        if (made.has(c.id) || /^tab-\d$/.test(c.id)) continue;
        if (lower && !c.label.toLowerCase().includes(lower) && !(c.keywords ?? '').includes(lower)) continue;
        out.push({ key: `cmd:${c.id}`, group: 'Commands', title: c.label, colour: '#23349E', icon: 'zap', action: true, hint: shortcuts[c.id] ? prettyAccelerator(shortcuts[c.id]!) : undefined, kv: [['Command', c.group]], verb: `Run “${c.label}”`, run: c.run });
      }
      return out;
    }
    if (!lower) return out;
    if (scope === 'All') for (const a of apps) if (appLabel(a).toLowerCase().includes(lower) || (a.keywords ?? '').includes(lower)) out.push(appItem(a, 'Apps'));
    for (const g of server.data?.results ?? []) {
      const look = groupLook(g.group);
      for (const it of g.items) {
        // A hit in an app the person was not given is not shown (the server should not send one).
        if (!canOpenLink(it.route, allowed)) continue;
        const target = resolveWebLink(it.route);
        const native = target.kind === 'tab' && canOpenApp(target.app, allowed);
        out.push({
          key: `srv:${g.group}:${it.id}:${it.route}`,
          group: g.group,
          title: it.title,
          subtitle: it.subtitle ?? undefined,
          at: relative(it.at),
          colour: look.colour,
          icon: look.icon,
          ext: !native,
          kv: [
            ['In', g.group],
            ...(it.at ? ([['When', relative(it.at)]] as Array<[string, string]>) : []),
            ['Opens', native ? 'In the desktop app' : 'In your browser'],
          ],
          verb: 'Open',
          run: () => openRoute(it.route),
          window: native ? () => openRoute(it.route, 'window') : undefined,
          link: origin ? `${origin}${it.route}` : undefined,
        });
      }
    }
    for (const it of offline.data ?? []) {
      // Saved on this computer while the app was the person's; not shown once it is not.
      if (!canOpenApp(it.module, allowed) || !canOpenRoute(it.route, allowed)) continue;
      const look = groupLook('offline results');
      out.push({ key: `off:${it.route}`, group: 'Offline results', title: it.title, subtitle: it.subtitle, at: `saved ${relative(it.cachedAt)}`, colour: look.colour, icon: look.icon, kv: [['Saved', relative(it.cachedAt)]], verb: 'Open', run: () => navigate(it.route) });
    }
    return out;
  }, [commandMode, term, apps, create, server.data, offline.data, shortcuts, scope, allowed, origin, user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filters: All, then each group that found something (and the one chosen, even when empty).
  const groups = [...new Set(items.filter((i) => i.group !== 'Apps').map((i) => i.group))];
  const scopes = ['All', ...groups, ...(scope !== 'All' && !groups.includes(scope) ? [scope] : [])];
  const shown = commandMode || scope === 'All' ? items : items.filter((i) => i.group === scope);
  const selected = Math.min(sel, Math.max(0, shown.length - 1));
  const cur = idle ? undefined : shown[selected];
  const fetching = server.isFetching || offline.isFetching;
  const waiting = !commandMode && term.length >= 2 && (debounced !== term || fetching) && shown.length === 0;

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const run = (it: Item | undefined, how: 'open' | 'window' = 'open') => {
    if (!it) return;
    if (!commandMode) noteRecentSearch(user, term);
    closeOverlay();
    if (how === 'window' && it.window) it.window();
    else it.run();
  };
  const setQuery = (v: string) => {
    setQ(v);
    setSel(0);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeOverlay();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel(Math.min(shown.length - 1, selected + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel(Math.max(0, selected - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(cur, e.metaKey || e.ctrlKey ? 'window' : 'open');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (!idle && !commandMode) {
        setScope(nextScope(scopes, scope, e.shiftKey));
        setSel(0);
      }
    } else if (e.key === 'Backspace' && q === '' && scope !== 'All') {
      setScope('All');
    }
  };

  const copy = (it: Item) => {
    if (!it.link) return;
    void navigator.clipboard.writeText(it.link).then(() => toast('success', 'Link copied.'));
  };

  let lastGroup = '';
  return (
    <div className="no-drag fixed inset-0 z-50 bg-[rgba(15,27,61,.42)] backdrop-blur-[3px]" onMouseDown={(e) => e.target === e.currentTarget && closeOverlay()}>
      <div
        role="dialog"
        aria-label={commandMode ? 'Command palette' : 'Search'}
        className="animate-in absolute top-[96px] left-1/2 flex h-[640px] max-h-[calc(100vh-120px)] w-[980px] max-w-[calc(100vw-32px)] -translate-x-1/2 flex-col overflow-hidden rounded-[18px] bg-surface shadow-[0_40px_100px_rgb(var(--ws-shadow-rgb)/.35),0_0_0_1px_var(--ws-edge)]"
      >
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-line pr-4 pl-5">
          <span className={cx('flex', q ? 'text-primary' : 'text-ink-3')}>
            {fetching ? <Icon name="spinner" size={20} className="animate-spin-slow" /> : <Icon name="search" size={20} />}
          </span>
          {commandMode ? (
            <span className="flex items-center gap-[5px] rounded-[7px] bg-selection px-2 py-[3px] text-[12px] font-bold text-primary">
              <Icon name="zap" size={12} />
              Commands
            </span>
          ) : null}
          {scope !== 'All' && !commandMode ? (
            <button type="button" aria-label="Remove filter" onClick={() => (setScope('All'), setSel(0))} className="flex items-center gap-1 rounded-[7px] bg-selection py-[3px] pr-1.5 pl-2 text-[12px] font-bold text-primary">
              in {scope}
              <Icon name="x" size={12} />
            </button>
          ) : null}
          <input
            ref={input}
            value={q}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder={commandMode ? 'Type a command…' : 'Search people, records, files, mail…'}
            className="bare-focus h-full min-w-0 flex-1 bg-transparent text-[17px] font-medium text-ink outline-none placeholder:text-ink-3"
            aria-label="Search WorkSuite"
            role="combobox"
            aria-expanded="true"
            aria-controls="search-results"
          />
          {q ? (
            <button type="button" aria-label="Clear search" onClick={() => (setQuery(''), input.current?.focus())} className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-subtle text-ink-3 hover:text-ink">
              <Icon name="x" size={14} />
            </button>
          ) : null}
          <span className="h-6 w-px bg-line" />
          <Kbd>Esc</Kbd>
        </div>
        {!idle && !commandMode ? (
          <div role="tablist" aria-label="Filter results" className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-line px-[18px] py-2.5 scroll-thin">
            {scopes.map((s) => {
              const n = s === 'All' ? items.filter((i) => i.group !== 'Apps').length : items.filter((i) => i.group === s).length;
              const on = s === scope;
              return (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => (setScope(s), setSel(0), input.current?.focus())}
                  className={cx('flex h-[30px] shrink-0 items-center gap-1.5 rounded-full border pr-2.5 pl-3 text-[12.5px] font-semibold', on ? 'border-primary bg-primary text-white' : cx('border-line bg-surface', n ? 'text-ink-2' : 'text-ink-3'))}
                >
                  {s}
                  <span className={cx('flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-[5px] text-[10.5px]', on ? 'bg-white/20 text-white' : 'bg-subtle text-ink-3')}>{n}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1">
          <div ref={list} id="search-results" role="listbox" aria-label="Results" className="min-w-0 flex-1 overflow-y-auto px-2 pt-1 pb-2 scroll-thin">
            {idle ? (
              <div className="flex flex-col gap-1.5 px-3 pb-3">
                {recent.length ? (
                  <>
                    <Heading>Recent searches</Heading>
                    <div className="flex flex-wrap gap-2 px-1.5">
                      {recent.map((t) => (
                        <button key={t} type="button" onClick={() => (setQuery(t), input.current?.focus())} className="flex h-8 items-center gap-[7px] rounded-full border border-line bg-surface pr-3 pl-2.5 text-[12.5px] font-semibold text-ink-2 hover:text-ink">
                          <Icon name="history" size={14} className="text-ink-3" />
                          {t}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          setRecent([]);
                          try {
                            if (user != null) localStorage.removeItem(recentKey(user));
                          } catch {
                            // Nothing to forget.
                          }
                        }}
                        className="h-8 px-1.5 text-[12px] font-semibold text-ink-3 hover:text-ink"
                      >
                        Clear
                      </button>
                    </div>
                  </>
                ) : null}
                <Heading>Jump to</Heading>
                <div className="grid grid-cols-8 gap-1.5">
                  {[...apps]
                    .sort((a, b) => a.order - b.order)
                    .slice(0, 8)
                    .map((a) => (
                      <button key={a.id} type="button" title={a.surface === 'browser' ? 'Opens in your browser' : undefined} onClick={() => (closeOverlay(), openApp(a))} className="flex flex-col items-center gap-[7px] rounded-[12px] px-1 pt-2.5 pb-2 text-[12px] font-semibold text-ink-2 hover:bg-subtle hover:text-ink">
                        <AppTile icon={a.icon} colour={appColour(a.id)} size={44} />
                        <span className="max-w-full truncate">{appLabel(a)}</span>
                      </button>
                    ))}
                </div>
                {create.length ? (
                  <>
                    <Heading className="pt-3.5">Create</Heading>
                    <div className="grid grid-cols-3 gap-1.5">
                      {create.slice(0, 6).map((c) => (
                        <button key={c.id} type="button" onClick={() => (closeOverlay(), navigate(c.route))} className="flex h-10 items-center gap-[9px] rounded-[10px] border border-line bg-well px-3 text-[12.5px] font-semibold text-ink-2 hover:border-primary/40 hover:text-ink">
                          <AppTile icon={c.icon} colour={appColour(c.app)} size={26} radius={8} iconSize={14} />
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
                <div className="mx-1.5 mt-3.5 flex items-center gap-2 rounded-[10px] bg-well px-3 py-2.5 text-[12px] text-ink-3">
                  <Icon name="info" size={15} className="text-primary" />
                  <span>
                    Tip: type <b className="text-primary">&gt;</b> to run a command, or press <b className="text-primary">Tab</b> to filter by app.
                  </span>
                </div>
              </div>
            ) : null}
            {shown.map((it, i) => {
              const header = it.group !== lastGroup ? it.group : null;
              lastGroup = it.group;
              const on = i === selected;
              const sp = splitMatch(it.title, commandMode ? '' : term);
              return (
                <div key={it.key}>
                  {header ? (
                    <div className="flex items-center justify-between px-3 pt-3 pb-1.5 text-[11px] font-bold tracking-[.6px] text-ink-3 uppercase">
                      <span>{header}</span>
                      <span className="font-semibold tracking-normal normal-case">{shown.filter((x) => x.group === header).length}</span>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    role="option"
                    data-index={i}
                    aria-selected={on}
                    onClick={() => setSel(i)}
                    onDoubleClick={() => run(it)}
                    className={cx('flex w-full items-center gap-3 rounded-[10px] px-3 text-left', it.subtitle ? 'h-[54px]' : 'h-11', on ? 'bg-selection shadow-[inset_3px_0_0_var(--color-primary)]' : 'hover:bg-subtle')}
                  >
                    <AppTile icon={it.icon} colour={it.colour} size={32} iconSize={16} />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-[13.5px] font-semibold text-ink">
                        {sp.a}
                        {sp.m ? <mark className="rounded-[3px] bg-[#FFF1B8] px-px text-[#151A2D] dark:bg-[#5A4712] dark:text-[#FFE9A8]">{sp.m}</mark> : null}
                        {sp.b}
                      </span>
                      {it.subtitle ? <span className="truncate text-[12px] text-ink-3">{it.subtitle}</span> : null}
                    </span>
                    {it.at ? <span className="shrink-0 text-[11.5px] whitespace-nowrap text-ink-3">{it.at}</span> : null}
                    {it.hint ? <Kbd>{it.hint}</Kbd> : null}
                    {it.ext ? (
                      <span title="Opens in your browser" className="flex text-ink-3">
                        <Icon name="external" size={14} />
                      </span>
                    ) : null}
                    {it.action ? (
                      <span className="flex text-ink-3">
                        <Icon name="zap" size={14} />
                      </span>
                    ) : null}
                    <span className={cx('flex text-primary', on ? 'opacity-100' : 'opacity-0')}>
                      <Icon name="chevron-right" size={16} />
                    </span>
                  </button>
                </div>
              );
            })}
            {!idle && shown.length === 0 && !waiting ? (
              <div className="flex flex-col items-center gap-2.5 px-[30px] py-[70px] text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-subtle text-ink-3">
                  <Icon name="search" size={24} />
                </span>
                <b className="text-[15px] text-ink">{term.length < 2 && !commandMode ? 'Keep typing…' : `No results for “${term}”`}</b>
                <span className="max-w-[300px] text-[12.5px] leading-normal text-ink-3">
                  {term.length < 2 && !commandMode
                    ? 'Search starts at two characters.'
                    : commandMode
                      ? 'No command matches. Try “new” or an app name.'
                      : scope !== 'All'
                        ? `Nothing in ${scope}. Try searching all apps.`
                        : 'Check the spelling, or try a name, subject or file type.'}
                </span>
                {scope !== 'All' && !commandMode ? (
                  <button type="button" onClick={() => (setScope('All'), setSel(0))} className="mt-1.5 h-[34px] rounded-[9px] border border-line bg-surface px-3.5 text-[12.5px] font-semibold text-primary">
                    Search all apps
                  </button>
                ) : null}
              </div>
            ) : null}
            {waiting ? (
              <div className="flex items-center justify-center gap-2 py-16 text-[12.5px] text-ink-3">
                <Icon name="spinner" size={16} className="animate-spin-slow" /> Searching…
              </div>
            ) : null}
          </div>
          {cur ? (
            <aside aria-label="Preview" className="flex w-[340px] shrink-0 flex-col gap-3.5 overflow-hidden border-l border-line bg-well p-5">
              <div className="flex items-center gap-2.5">
                <AppTile icon={cur.icon} colour={cur.colour} size={40} iconSize={19} />
                <span className="flex flex-col">
                  <span className={cx('text-[11px] font-bold tracking-[.5px] uppercase', DATA_TEXT)} style={{ ['--c' as string]: cur.colour }}>
                    {cur.group}
                  </span>
                  {cur.at ? <span className="text-[11.5px] text-ink-3">{cur.at}</span> : null}
                </span>
              </div>
              <b className="text-[16px] leading-[1.35] text-ink selectable">{cur.title}</b>
              {cur.subtitle && !cur.ext && !cur.subtitle.startsWith('Opens') && cur.subtitle !== 'Desktop app' ? (
                <p className="m-0 rounded-[10px] border border-line bg-surface p-3 text-[12.5px] leading-[1.55] text-ink-2 selectable">{cur.subtitle}</p>
              ) : null}
              <div className="flex flex-col gap-2">
                {cur.kv.map(([k, v]) => (
                  <div key={k} className="flex gap-2.5 text-[12px]">
                    <span className="w-[78px] shrink-0 text-ink-3">{k}</span>
                    <span className="font-semibold text-ink-2">{v}</span>
                  </div>
                ))}
              </div>
              <div className="mt-auto flex flex-col gap-2">
                <button type="button" onClick={() => run(cur)} className="flex h-[38px] items-center justify-center gap-2 rounded-[10px] bg-primary text-[13px] font-bold text-white hover:bg-primary-hover">
                  {cur.verb}
                  <Kbd>↵</Kbd>
                </button>
                {!cur.action ? (
                  <div className="flex gap-2">
                    <button type="button" disabled={!cur.window} onClick={() => run(cur, 'window')} className="flex h-[34px] flex-1 items-center justify-center gap-1.5 rounded-[9px] border border-line bg-surface text-[12px] font-semibold text-ink-2 hover:text-ink disabled:opacity-50">
                      <Icon name="maximize" size={13} />
                      New window
                    </button>
                    <button type="button" disabled={!cur.link} onClick={() => copy(cur)} className="flex h-[34px] flex-1 items-center justify-center gap-1.5 rounded-[9px] border border-line bg-surface text-[12px] font-semibold text-ink-2 hover:text-ink disabled:opacity-50">
                      <Icon name="link" size={13} />
                      Copy link
                    </button>
                  </div>
                ) : null}
              </div>
            </aside>
          ) : null}
        </div>
        {!online && !commandMode ? <div className="shrink-0 border-t border-line bg-warning-bg px-[18px] py-2 text-[12px] font-semibold text-warning">Offline — showing results saved on this computer.</div> : null}
        <div className="flex h-[42px] shrink-0 items-center gap-4 border-t border-line px-[18px] text-[11.5px] text-ink-3">
          <span className="flex items-center gap-[5px]">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>navigate
          </span>
          <span className="flex items-center gap-[5px]">
            <Kbd>↵</Kbd>open
          </span>
          <span className="flex items-center gap-[5px]">
            <Kbd>{prettyAccelerator('Mod+Enter').replace('Enter', '↵')}</Kbd>new window
          </span>
          <span className="flex items-center gap-[5px]">
            <Kbd>Tab</Kbd>filter
          </span>
          <span className="flex items-center gap-[5px]">
            <Kbd>&gt;</Kbd>commands
          </span>
          <span className="ml-auto flex items-center gap-[5px]">
            <Kbd>{prettyAccelerator(shortcuts.search ?? 'Mod+K')}</Kbd>anywhere
          </span>
        </div>
      </div>
    </div>
  );
}

function Heading({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx('px-1.5 pt-2.5 pb-1 text-[11px] font-bold tracking-[.6px] text-ink-3 uppercase', className)}>{children}</div>;
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-[18px] items-center justify-center rounded-[5px] border border-b-2 border-line bg-surface px-[5px] font-sans text-[10.5px] font-semibold text-ink-3">{children}</kbd>;
}
