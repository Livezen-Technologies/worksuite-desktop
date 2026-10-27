import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { canOpenApp, canOpenLink, canOpenRoute } from '@shared/access';
import { GUEST_LOCKED_APPS, appRoute, navApps } from '@shared/apps';
import { resolveWebLink } from '@shared/links';
import { idsOf } from '../../core/access';
import { app } from '../../core/app-state';
import { ApiError, apiGet } from '../../core/api';
import { appColour, groupLook } from '../../core/app-look';
import { call, isMac } from '../../core/bridge';
import { allCommands, effectiveShortcuts, prettyAccelerator } from '../../core/commands';
import { appLabel, text, useLanguage } from '../../core/i18n';
import { noteRecentApp } from '../../core/recent-apps';
import { useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { openWebLink } from '../../core/tab-context';
import { bytes, relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { closeOverlay, ui } from '../../core/ui';
import { openSignInPanel, useGuest } from '../../core/session';
import { AppTile } from '../../components/AppTile';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { extOf, kindOf } from '../../modules/files/api';
import { NEW_TICKET_ROUTE, articleSubtitle, searchArticles, searchTickets, ticketDeepLink, ticketInFront, ticketSubtitle, useMayCreateTicket } from '../../modules/support/palette';
import { ticketIdOfLink, ticketRoute } from '@shared/support';
import { Button, cx, DATA_TEXT, Kbd as KeyChip } from '../../components/ui';

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
  fileId?: number;
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
  /** The words the server matched, to mark wherever they start a word; else the title is marked where the query is. */
  words?: string[];
  /** Why content matched: the text around it (#57). */
  snippet?: string;
}

/**
 * `text` cut into runs, each word that begins with one of `words` marked whole
 * (#57) — as the server matched them, `+word*`. Letters, signs and digits make a
 * word, so a Sinhala or Tamil vowel sign stays inside the one it belongs to.
 */
export function markWords(text: string, words: string[]): Array<{ text: string; match: boolean }> {
  const list = [...new Set(words.map((w) => w.trim().toLowerCase()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!text || !list.length) return text ? [{ text, match: false }] : [];
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(?:${list.map(esc).join('|')})[\\p{L}\\p{M}\\p{N}]*`, 'giu');
  const out: Array<{ text: string; match: boolean }> = [];
  let at = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > at) out.push({ text: text.slice(at, i), match: false });
    out.push({ text: m[0], match: true });
    at = i + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), match: false });
  return out;
}

const MARK = 'rounded-[3px] bg-yellow-bg px-px text-ink dark:bg-warning-soft dark:text-yellow-ink';

function Marked({ text, words }: { text: string; words: string[] }) {
  return (
    <>
      {markWords(text, words).map((p, i) =>
        p.match ? (
          <mark key={i} className={MARK}>
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

/** How far back "When" looks, in days; 0 is any time. */
const WHEN: Array<{ days: number; label: string }> = [
  { days: 0, label: 'Any time' },
  { days: 7, label: 'Past week' },
  { days: 30, label: 'Past month' },
  { days: 365, label: 'Past year' },
];

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

let searchAccessEpoch = 0;
const RECENT_MAX = 6;
/** The group Support's tickets are listed under (and the filter that keeps to them). */
export const SUPPORT_GROUP = 'Support tickets';
/** The knowledge base's articles (WS-SUPPORT-SRS-001 D-10): for the ticket in front, inserted into its composer. */
export const KB_GROUP = 'Knowledge base';
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
  // Support (worksuite-desktop#298): only for whoever may raise a ticket there (below).
  { id: 'new-ticket', label: 'Create ticket', app: 'support', route: NEW_TICKET_ROUTE, icon: 'life-buoy' },
  { id: 'new-event', label: 'New event', app: 'calendar', route: '/calendar?new=1', icon: 'calendar' },
  { id: 'new-note', label: 'New note', app: 'notes', route: '/notes?new=1', icon: 'notebook' },
  { id: 'upload', label: 'Upload file', app: 'files', route: '/files?upload=1', icon: 'upload' },
  { id: 'new-contact', label: 'New contact', app: 'contacts', route: '/contacts?new=1', icon: 'contact' },
  { id: 'new-lead', label: 'New lead', app: 'crm', route: '/crm?new=1', icon: 'users' },
];

interface ServerGroup {
  group: string;
  key?: string;
  items: Array<{ id: number | string; title: string; subtitle: string | null; route: string; at: string | null; snippet?: string | null }>;
}

/** `/api/search/global`; `terms`, `index` and `companies` come from servers with the search index (#57). */
interface ServerAnswer {
  results: ServerGroup[];
  terms?: string[];
  index?: { state: 'ready' | 'building'; progress: number; building: string[] } | null;
  companies?: Array<{ id: number; name: string }>;
}

export function SearchOverlay({ mode }: { mode: 'search' | 'palette' }) {
  useLanguage();
  const [width, setWidth] = useState(() => Math.min(980, window.innerWidth - 32));
  const narrow = width < 760;
  const compact = width < 920;
  const [moreFilters, setMoreFilters] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const details = useRef<HTMLElement>(null);
  useEffect(() => {
    const resize = () => setWidth(Math.min(980, window.innerWidth - 32));
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    if (narrow && detailsOpen) details.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [narrow, detailsOpen]);
  const seed = useStore(ui, (s) => s.searchSeed);
  const [q, setQ] = useState(mode === 'palette' ? '>' : seed);
  const [scope, setScope] = useState('All');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const apps = useStore(app, (s) => s.apps);
  const guest = useGuest();
  // The apps to go to: a channel is in its host (WhatsApp, in Chat: #35), not an app of its own.
  const listed = useMemo(() => navApps(apps), [apps]);
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

  // Filters the server applies (#57): the group in view, how recent, whose, which company.
  // The date is worked out when "When" is chosen, so the search does not move with the clock as it renders.
  const [when, setWhen] = useState<{ days: number; from: string | null }>({ days: 0, from: null });
  const days = when.days;
  const setDays = (d: number) => setWhen({ days: d, from: d ? new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10) : null });
  const [mine, setMine] = useState(false);
  const [company, setCompany] = useState(0);
  const params = useMemo(
    () => ({
      q: debounced,
      ...(scope !== 'All' && scope !== 'Apps' && scope !== 'Offline results' ? { types: scope } : {}),
      ...(when.from ? { from: when.from } : {}),
      ...(mine ? { owner: 'me' } : {}),
      ...(company ? { company } : {}),
    }),
    [debounced, scope, when.from, mine, company],
  );
  const filtered = days > 0 || mine || company > 0;

  // A new bootstrap must never reuse results checked under previous record permissions.
  const bootstrap = useStore(app, (s) => s.bootstrap);
  const accessEpoch = useMemo(() => ({ apps, bootstrap, revision: ++searchAccessEpoch }), [apps, bootstrap]).revision;
  const qc = useQueryClient();
  const currentQuery = !commandMode && term === debounced && debounced.length >= 2;
  useEffect(() => {
    if (!currentQuery) {
      void qc.cancelQueries({ queryKey: ['search', origin, user, accessEpoch] });
      void qc.cancelQueries({ queryKey: ['search-offline', origin, user, accessEpoch] });
    }
  }, [currentQuery, qc, origin, user, accessEpoch]);

  const online = network !== 'OFFLINE';
  const server = useQuery({
    queryKey: ['search', origin, user, accessEpoch, params],
    queryFn: ({ signal }) => apiGet<ServerAnswer>('/api/search/global', params, signal),
    enabled: currentQuery && online,
    staleTime: 15_000,
    retry: false,
  });
  const offline = useQuery({
    queryKey: ['search-offline', origin, user, accessEpoch, debounced],
    queryFn: () => call('offline:search', { q: debounced }),
    enabled: currentQuery && (!online || (server.error instanceof ApiError && server.error.offline)),
  });

  // The support desk's tickets (WS-SUPPORT-SRS-001 D-08, FR-SRC-01): "tkt 128" finds TKT-000128 by reference, and
  // the subject, requester, email and phone match too. Only for somebody with Support, only while online.
  const supportOn = idsOf(apps).has('support') && !guest;
  const tickets = useQuery({
    queryKey: ['search-support', origin, user, accessEpoch, debounced],
    queryFn: ({ signal }) => searchTickets(debounced, signal),
    enabled: currentQuery && online && supportOn && (scope === 'All' || scope === SUPPORT_GROUP),
    staleTime: 15_000,
    retry: false,
  });
  const ticketData = currentQuery && online && supportOn ? tickets.data : undefined;
  const articles = useQuery({
    queryKey: ['search-kb', origin, user, accessEpoch, ticketInFront()?.id ?? 0, debounced],
    queryFn: ({ signal }) => searchArticles(debounced, signal),
    enabled: currentQuery && online && supportOn && (scope === 'All' || scope === KB_GROUP),
    staleTime: 15_000,
    retry: false,
  });
  const articleData = currentQuery && online && supportOn ? articles.data : undefined;

  const companyIdentity = `${origin}:${user}:${accessEpoch}`;
  const [companyList, setCompanyList] = useState<{ identity: string; companies: NonNullable<ServerAnswer['companies']> }>({ identity: '', companies: [] });
  const serverData = currentQuery && online ? server.data : undefined;
  const offlineData = currentQuery && (!online || (server.error instanceof ApiError && server.error.offline)) ? offline.data : undefined;

  if (serverData?.companies && (companyList.identity !== companyIdentity || companyList.companies !== serverData.companies)) {
    setCompanyList({ identity: companyIdentity, companies: serverData.companies });
  }
  const companies = companyList.identity === companyIdentity ? companyList.companies : [];

  const allowed = idsOf(apps);
  // Create ticket needs the desk's create right too (`GET meta`'s `can.create`); an older server's silence allows it.
  const ticketsAllowed = useMayCreateTicket(supportOn);
  const create = CREATE.filter((c) => allowed.has(c.app) && (c.app !== 'support' || ticketsAllowed));

  const openApp = (a: (typeof apps)[number]) => {
    noteRecentApp(user, a.id);
    if (a.surface === 'native') navigate(appRoute(a));
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
    // Guest mode (#149): an app that needs an account is found, and opens the sign-in panel — never the app.
    const locked = (group: string) => {
      if (!guest) return;
      for (const a of GUEST_LOCKED_APPS) {
        const label = text(a.guestLabel ?? a.label);
        if (lower && !label.toLowerCase().includes(lower) && !(a.keywords ?? '').includes(lower)) continue;
        out.push({ key: `locked:${a.id}`, group, title: label, subtitle: text('Needs a WorkSuite account'), colour: '#8A90A2', icon: 'lock', kv: [[text('Needs'), text('A WorkSuite account')]], verb: text('Sign in to use {app}', { app: label }), run: () => { closeOverlay(); openSignInPanel(a.id); } });
      }
    };
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
      window: a.surface === 'native' ? () => void call('windows:open', { kind: 'record', route: appRoute(a), title: a.label }) : undefined,
      link: origin ? `${origin}${a.webPath}` : undefined,
    });
    if (commandMode) {
      for (const a of listed) if (!lower || appLabel(a).toLowerCase().includes(lower) || (a.keywords ?? '').includes(lower)) out.push(appItem(a, 'Go to'));
      locked('Go to');
      for (const c of create) {
        if (lower && !c.label.toLowerCase().includes(lower)) continue;
        out.push({
          key: `new:${c.id}`,
          group: 'Actions',
          title: text(c.label),
          colour: appColour(c.app),
          icon: c.icon,
          action: true,
          hint: shortcuts[c.id] ? prettyAccelerator(shortcuts[c.id]!) : undefined,
          kv: [['Creates', c.label.replace(/^New |^Upload |^Create /, '')]],
          verb: `Run “${c.label}”`,
          run: () => navigate(c.route),
        });
      }
      const made = new Set(create.map((c) => c.id));
      for (const c of allCommands()) {
        if (made.has(c.id) || /^tab-\d$/.test(c.id)) continue;
        if (lower && !c.label.toLowerCase().includes(lower) && !(c.keywords ?? '').includes(lower)) continue;
        out.push({
          key: `cmd:${c.id}`,
          group: 'Commands',
          title: c.label,
          colour: '#23349E',
          icon: 'zap',
          action: true,
          hint: c.hint ?? (shortcuts[c.id] ? prettyAccelerator(shortcuts[c.id]!) : undefined),
          kv: [['Command', c.group]],
          verb: `Run “${c.label}”`,
          run: c.run,
        });
      }
      return out;
    }
    if (!lower) return out;
    if (scope === 'All') for (const a of listed) if (appLabel(a).toLowerCase().includes(lower) || (a.keywords ?? '').includes(lower)) out.push(appItem(a, 'Apps'));
    if (scope === 'All') locked('Apps');
    const words = serverData?.terms ?? [];
    for (const g of serverData?.results ?? []) {
      const look = groupLook(g.group);
      for (const it of g.items) {
        // A hit in an app the person was not given is not shown (the server should not send one).
        if (!canOpenLink(it.route, allowed)) continue;
        // A ticket the desk's own search found too is listed once, there (with its status and deep link).
        const tid = ticketIdOfLink(it.route);
        if (tid !== null && ticketData?.some((tk) => tk.id === tid)) continue;
        const candidate = g.key === 'files' || g.group.toLowerCase() === 'files' ? Number(it.id) : 0;
        const fileId = Number.isSafeInteger(candidate) && candidate > 0 ? candidate : undefined;
        const route = fileId && Number.isSafeInteger(fileId) && fileId > 0 ? `${it.route}${it.route.includes('?') ? '&' : '?'}file=${fileId}` : it.route;
        const target = resolveWebLink(route);
        const native = target.kind === 'tab' && canOpenApp(target.app, allowed);
        out.push({
          key: `srv:${g.group}:${it.id}:${it.route}`,
          fileId,
          group: g.group,
          title: it.title,
          subtitle: it.subtitle ?? undefined,
          snippet: it.snippet ?? undefined,
          words: words.length ? words : undefined,
          at: relative(it.at),
          colour: look.colour,
          icon: fileId ? searchFileIcon(it.title) : look.icon,
          ext: !native,
          kv: [['In', g.group], ...(it.at ? ([['When', relative(it.at)]] as Array<[string, string]>) : []), ['Opens', native ? 'In the desktop app' : 'In your browser']],
          verb: 'Open',
          run: () => openRoute(route),
          window: native ? () => openRoute(route, 'window') : undefined,
          link: origin ? `${origin}${route}` : undefined,
        });
      }
    }
    // Support's tickets, with the ticket in front's actions beside it when it is among them (D-08).
    const front = ticketInFront();
    const me = user === null ? null : Number(user) || null;
    for (const tk of ticketData ?? []) {
      const look = groupLook('tickets');
      out.push({
        key: `support:${tk.id}`,
        group: SUPPORT_GROUP,
        title: `${tk.reference} · ${tk.subject}`,
        subtitle: ticketSubtitle(tk, me),
        at: tk.updated_at ? relative(tk.updated_at) : undefined,
        colour: look.colour,
        icon: 'life-buoy',
        kv: [['Ticket', tk.reference], ['Status', ticketSubtitle(tk, me).split(' · ')[0]!], ['Opens', 'In the desktop app']],
        verb: 'Open',
        run: () => navigate(ticketRoute(tk.id)),
        window: () => void call('windows:open', { kind: 'record', route: ticketRoute(tk.id), title: tk.reference }),
        link: ticketDeepLink(tk.id),
      });
    }
    if (front && (ticketData ?? []).some((tk) => tk.id === front.id)) {
      for (const c of front.actions) {
        out.push({ key: `support-action:${c.id}`, group: text('Actions on {ref}', { ref: front.reference }), title: c.label, colour: '#23349E', icon: 'zap', action: true, hint: c.hint ?? (shortcuts[c.id] ? prettyAccelerator(shortcuts[c.id]!) : undefined), kv: [['Command', 'Support']], verb: `Run “${c.label}”`, run: c.run });
      }
    }
    // Knowledge base articles (D-10): into the composer of the ticket in front, or opened on the web.
    for (const a of articleData?.articles ?? []) {
      const look = groupLook('knowledge base');
      const target = articleData?.ticket ?? null;
      const insert = target ? ticketInFront()?.insertArticle : null;
      const mode = a.visibility === 'public' ? 'link' : 'text';
      out.push({
        key: `kb:${target?.id ?? 0}:${a.id}`,
        group: KB_GROUP,
        title: a.title,
        subtitle: articleSubtitle(a, insert && target ? target.reference : null),
        snippet: a.excerpt ?? undefined,
        colour: look.colour,
        icon: 'book-open',
        ext: !insert,
        kv: [['Article', a.visibility === 'public' ? 'Public' : 'Internal'], ['Does', insert && target ? (mode === 'link' ? `Inserts its link into ${target.reference}` : `Inserts its text into ${target.reference}`) : 'Opens it on the web']],
        verb: insert ? (mode === 'link' ? 'Insert link' : 'Insert text') : 'Open',
        run: () => (insert ? insert(a, mode) : void call('app:openInBrowser', { path: `/support/kb/${a.id}` })),
        link: a.url ?? undefined,
      });
    }
    for (const it of offlineData ?? []) {
      // Saved on this computer while the app was the person's; not shown once it is not.
      if (!canOpenApp(it.module, allowed) || !canOpenRoute(it.route, allowed)) continue;
      const look = groupLook('offline results');
      out.push({
        key: `off:${it.route}`,
        group: 'Offline results',
        title: it.title,
        subtitle: it.subtitle,
        at: `saved ${relative(it.cachedAt)}`,
        colour: look.colour,
        icon: look.icon,
        kv: [['Saved', relative(it.cachedAt)]],
        verb: 'Open',
        run: () => navigate(it.route),
      });
    }
    return out;
  }, [commandMode, term, listed, create, serverData, offlineData, ticketData, articleData, shortcuts, scope, allowed, origin, user, guest]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filters: All, then each group that found something (and the one chosen, even when empty).
  const groups = [...new Set(items.filter((i) => i.group !== 'Apps').map((i) => i.group))];
  const scopes = ['All', ...groups, ...(scope !== 'All' && !groups.includes(scope) ? [scope] : [])];
  const shown = commandMode || scope === 'All' ? items : items.filter((i) => i.group === scope);
  const fetchingResults = server.isFetching || offline.isFetching || tickets.isFetching;
  const selected = Math.max(
    0,
    shown.findIndex((it) => it.key === selectedKey),
  );
  const setSel = (i: number) => setSelectedKey(shown[i]?.key ?? null);
  // A refresh may reorder rows; selection belongs to the record, never its old position.
  if (shown.length && !fetchingResults && !shown.some((it) => it.key === selectedKey)) setSelectedKey(shown[0]!.key);
  const cur = idle ? undefined : shown[selected];
  const fetching = server.isFetching || offline.isFetching;
  const index = serverData?.index ?? null;
  const building = index?.state === 'building';
  const waiting = !commandMode && term.length >= 2 && (debounced !== term || fetching) && shown.length === 0;

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const [copied, setCopied] = useState<string | null>(null);
  const copiedTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const run = (it: Item | undefined, how: 'open' | 'window' = 'open') => {
    if (!it) return;
    if (!commandMode) noteRecentSearch(user, term);
    closeOverlay();
    if (how === 'window' && it.window) it.window();
    else it.run();
  };
  const setQuery = (v: string) => {
    setQ(v);
    setSelectedKey(null);
    setDetailsOpen(false);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (copyKey(e)) return;
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
    } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      if (!idle && !commandMode) {
        setScope(nextScope(scopes, scope, e.key === 'ArrowLeft'));
        setSel(0);
      }
    } else if (e.key === 'Backspace' && q === '' && scope !== 'All') {
      setScope('All');
    }
  };

  const copy = (it: Item) => {
    if (!it.link) return;
    void navigator.clipboard
      .writeText(it.link)
      .then(() => {
        // The button says "Copied" for a moment (#148); the polite live region announces it.
        window.clearTimeout(copiedTimer.current);
        setCopied(it.key);
        copiedTimer.current = window.setTimeout(() => setCopied(null), COPIED_MS);
      })
      .catch(() => toast('error', text('Could not copy the link.')));
  };
  // Mod+C copies the selected result's link, but only when there is no text to copy instead; on a support ticket,
  // Mod+Shift+C copies its deep link whatever is selected (D-08).
  const copyKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (!cur?.link) return false;
    const deepLink = isLinkChord(e) && cur.key.startsWith('support:');
    if (!deepLink && (!isCopyChord(e) || hasTextSelection(e.target))) return false;
    e.preventDefault();
    copy(cur);
    return true;
  };

  let lastGroup = '';
  return (
    <div className="no-drag fixed inset-0 z-50 bg-[rgba(15,27,61,.42)] backdrop-blur-[3px]" onMouseDown={(e) => e.target === e.currentTarget && closeOverlay()}>
      <div
        role="dialog"
        onKeyDown={(e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); closeOverlay(); } }}
        aria-label={text(commandMode ? 'Command palette' : 'Search')}
        className="animate-in absolute top-[min(96px,5vh)] left-1/2 flex h-[640px] max-h-[90vh] w-[980px] max-w-[calc(100vw-32px)] -translate-x-1/2 flex-col overflow-hidden rounded-[18px] bg-surface shadow-[0_40px_100px_rgb(var(--ws-shadow-rgb)/.35),0_0_0_1px_var(--ws-edge)]"
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
            <button
              type="button"
              aria-label={text('Remove filter')}
              onClick={() => (setScope('All'), setSel(0))}
              className="flex items-center gap-1 rounded-[7px] bg-selection py-[3px] pr-1.5 pl-2 text-[12px] font-bold text-primary"
            >
              in {scope}
              <Icon name="x" size={12} />
            </button>
          ) : null}
          <input
            ref={input}
            value={q}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder={text(commandMode ? 'Type a command…' : 'Search people, records, files, mail…')}
            className="bare-focus h-full min-w-0 flex-1 bg-transparent text-[17px] font-medium text-ink outline-none placeholder:text-ink-3"
            aria-label={text('Search WorkSuite')}
            role="combobox"
            aria-expanded={!(narrow && detailsOpen)}
            aria-controls="search-results"
            aria-activedescendant={cur && !(narrow && detailsOpen) ? `search-result-${selected}` : undefined}
          />
          {q ? (
            <button
              type="button"
              aria-label={text('Clear search')}
              onClick={() => (setQuery(''), input.current?.focus())}
              className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-subtle text-ink-3 hover:text-ink"
            >
              <Icon name="x" size={14} />
            </button>
          ) : null}
          <span className="h-6 w-px bg-line" />
          <Kbd>Esc</Kbd>
        </div>
        {!idle && !commandMode ? (
          <div className="shrink-0 border-b border-line px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <div role="tablist" aria-label={text('Filter results')} className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto scroll-thin">
                {scopes.map((s) => {
                  const n = s === 'All' ? items.filter((i) => i.group !== 'Apps').length : items.filter((i) => i.group === s).length;
                  const on = s === scope;
                  return (
                    <button
                      key={s}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => (setScope(s), setSelectedKey(null), input.current?.focus())}
                      className={cx(
                        'flex h-[30px] shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold focus-visible:ring-2 focus-visible:ring-primary',
                        on ? 'border-primary bg-primary text-white' : 'border-line bg-surface text-ink-2',
                      )}
                    >
                      {text(s)} <span className="text-[10.5px] opacity-75">{n}</span>
                    </button>
                  );
                })}
              </div>
              {online && compact ? (
                <button
                  type="button"
                  aria-expanded={moreFilters}
                  aria-controls="search-filters"
                  onClick={() => setMoreFilters(!moreFilters)}
                  className="flex h-[30px] shrink-0 items-center gap-1.5 rounded-[7px] border border-line bg-surface px-2 text-[12px] font-semibold text-ink focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <Icon name="filter" size={14} />
                  {text('More Filters')}
                  {filtered ? <span className="text-primary">{Number(days > 0) + Number(mine) + Number(company > 0)}</span> : null}
                </button>
              ) : null}
              {online && !compact ? <SearchFilters {...{ days, setDays, company, setCompany, mine, setMine, companies }} /> : null}
            </div>
            {online && compact && moreFilters ? (
              <div id="search-filters" className="mt-2 flex flex-wrap gap-2">
                <SearchFilters {...{ days, setDays, company, setCompany, mine, setMine, companies }} />
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="relative flex min-h-0 flex-1">
          <div
            ref={list}
            id="search-results"
            role="listbox"
            aria-label={text('Results')}
            hidden={narrow && detailsOpen && !!cur}
            className="min-w-0 flex-1 overflow-y-auto px-2 pt-1 pb-2 scroll-thin"
          >
            {idle ? (
              <div className="flex flex-col gap-1.5 px-3 pb-3">
                {recent.length ? (
                  <>
                    <Heading>Recent searches</Heading>
                    <div className="flex flex-wrap gap-2 px-1.5">
                      {recent.map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => (setQuery(t), input.current?.focus())}
                          className="flex h-8 items-center gap-[7px] rounded-full border border-line bg-surface pr-3 pl-2.5 text-[12.5px] font-semibold text-ink-2 hover:text-ink"
                        >
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
                  {[...listed]
                    .sort((a, b) => a.order - b.order)
                    .slice(0, 8)
                    .map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        title={a.surface === 'browser' ? 'Opens in your browser' : undefined}
                        onClick={() => (closeOverlay(), openApp(a))}
                        className="flex flex-col items-center gap-[7px] rounded-[12px] px-1 pt-2.5 pb-2 text-[12px] font-semibold text-ink-2 hover:bg-subtle hover:text-ink"
                      >
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
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => (closeOverlay(), navigate(c.route))}
                          className="flex h-10 items-center gap-[9px] rounded-[10px] border border-line bg-well px-3 text-[12.5px] font-semibold text-ink-2 hover:border-primary/40 hover:text-ink"
                        >
                          <AppTile icon={c.icon} colour={appColour(c.app)} size={26} radius={8} iconSize={14} />
                          {text(c.label)}
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
                    id={`search-result-${i}`}
                    data-index={i}
                    aria-selected={on}
                    onClick={() => {
                      setSel(i);
                      if (narrow) setDetailsOpen(true);
                    }}
                    onKeyDown={(e) => {
                      if (copyKey(e)) return;
                      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
                        e.preventDefault();
                        const next = e.key === 'Home' ? 0 : e.key === 'End' ? shown.length - 1 : Math.max(0, Math.min(shown.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
                        setSel(next);
                        list.current?.querySelector<HTMLButtonElement>(`[data-index="${next}"]`)?.focus();
                      } else if (e.key === 'Enter') {
                        e.preventDefault();
                        run(it, e.ctrlKey || e.metaKey ? 'window' : 'open');
                      }
                    }}
                    onDoubleClick={() => run(it)}
                    className={cx(
                      'flex w-full items-center gap-3 rounded-[10px] px-3 text-left focus-visible:outline-2 focus-visible:outline-primary',
                      it.snippet ? 'min-h-[54px] py-2' : it.subtitle ? 'h-[54px]' : 'h-11',
                      on ? 'bg-selection shadow-[inset_3px_0_0_var(--color-primary)]' : 'hover:bg-subtle',
                    )}
                  >
                    <AppTile icon={it.icon} colour={it.colour} size={32} iconSize={16} />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-[13.5px] font-semibold text-ink">
                        {it.words ? (
                          <Marked text={it.title} words={it.words} />
                        ) : (
                          <>
                            {sp.a}
                            {sp.m ? <mark className={MARK}>{sp.m}</mark> : null}
                            {sp.b}
                          </>
                        )}
                      </span>
                      {it.subtitle ? <span className="truncate text-[12px] text-ink-3">{it.subtitle}</span> : null}
                      {it.snippet ? (
                        <span className="line-clamp-2 text-[12px] text-ink-2">
                          <Marked text={it.snippet} words={it.words ?? []} />
                        </span>
                      ) : null}
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
                      : building
                        ? 'The search index is still being built, so this may not be everything. Try again shortly.'
                        : scope !== 'All'
                          ? `Nothing in ${scope}. Try searching all apps.`
                          : filtered
                            ? 'Nothing matches with these filters. Try fewer.'
                            : 'Check the spelling, or try a name, subject or file type.'}
                </span>
                {scope !== 'All' && !commandMode ? (
                  <button
                    type="button"
                    onClick={() => (setScope('All'), setSel(0))}
                    className="mt-1.5 h-[34px] rounded-[9px] border border-line bg-surface px-3.5 text-[12.5px] font-semibold text-primary"
                  >
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
          {cur && (!narrow || detailsOpen) ? (
            <aside
              ref={details}
              aria-label={text('Preview')}
              onKeyDown={(e) => {
                if (copyKey(e)) return;
                if (narrow && e.key === 'Escape') {
                  e.preventDefault();
                  setDetailsOpen(false);
                  requestAnimationFrame(() => list.current?.querySelector<HTMLButtonElement>(`[data-index="${selected}"]`)?.focus());
                }
              }}
              className={cx('flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden border-l border-line bg-well', narrow ? 'absolute inset-0 z-10 w-full' : 'w-[340px]')}
            >
              {narrow ? (
                <button
                  type="button"
                  onClick={() => {
                    setDetailsOpen(false);
                    requestAnimationFrame(() => list.current?.querySelector<HTMLButtonElement>(`[data-index="${selected}"]`)?.focus());
                  }}
                  className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3 text-[13px] font-semibold text-primary focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <Icon name="chevron-left" size={16} />
                  {text('Back to Results')}
                </button>
              ) : null}
              <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-5 scroll-thin">
                <div className="flex items-center gap-2.5">
                  <AppTile icon={cur.icon} colour={cur.colour} size={40} iconSize={19} />
                  <span className="flex flex-col">
                    <span className={cx('text-[11px] font-bold tracking-[.5px] uppercase', DATA_TEXT)} style={{ ['--c' as string]: cur.colour }}>
                      {cur.group}
                    </span>
                    {cur.at ? <span className="text-[11.5px] text-ink-3">{cur.at}</span> : null}
                  </span>
                </div>
                <b title={cur.title} className="min-w-0 text-[16px] leading-[1.35] [overflow-wrap:anywhere] text-ink selectable">
                  {cur.title}
                </b>
                {cur.snippet ? (
                  <p className="m-0 rounded-[10px] border border-line bg-surface p-3 text-[12.5px] leading-[1.55] text-ink-2 selectable">
                    <Marked text={cur.snippet} words={cur.words ?? []} />
                  </p>
                ) : null}
                {cur.subtitle && !cur.ext && !cur.subtitle.startsWith('Opens') && cur.subtitle !== 'Desktop app' ? (
                  <p className="m-0 rounded-[10px] border border-line bg-surface p-3 text-[12.5px] leading-[1.55] text-ink-2 selectable">{cur.subtitle}</p>
                ) : null}
                <SearchFacts key={cur.key} item={cur} online={online} identity={companyIdentity} />
              </div>
              <div className="flex shrink-0 flex-col gap-2 border-t border-line bg-well p-4">
                <Button variant="accent" size="action-lg" onClick={() => run(cur)} aria-keyshortcuts="Enter" className="w-full">
                  {text(cur.verb)}
                  <KeyChip tone="accent" aria-hidden>
                    ↵
                  </KeyChip>
                </Button>
                {!cur.action ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="glass"
                      size="action"
                      icon="maximize"
                      disabled={!cur.window}
                      onClick={() => run(cur, 'window')}
                      aria-keyshortcuts={cur.window ? (isMac ? 'Meta+Enter' : 'Control+Enter') : undefined}
                      className="min-w-0"
                    >
                      <span className="min-w-0 truncate">{text('New window')}</span>
                      {cur.window ? (
                        <KeyChip tone="key" aria-hidden className="ml-auto shrink-0">
                          {prettyAccelerator('Mod+Enter').replace('Enter', '↵')}
                        </KeyChip>
                      ) : null}
                    </Button>
                    <Button
                      variant="glass"
                      size="action"
                      icon={copied === cur.key ? 'check' : 'link'}
                      disabled={!cur.link}
                      onClick={() => copy(cur)}
                      aria-keyshortcuts={cur.link ? (isMac ? 'Meta+C' : 'Control+C') : undefined}
                      className="min-w-0"
                    >
                      <span className="min-w-0 truncate">{text(copied === cur.key ? 'Copied' : 'Copy link')}</span>
                      {cur.link ? (
                        <KeyChip tone="key" aria-hidden className="ml-auto shrink-0">
                          {prettyAccelerator('Mod+C')}
                        </KeyChip>
                      ) : null}
                    </Button>
                  </div>
                ) : null}
                <span role="status" aria-live="polite" className="sr-only">
                  {copied === cur.key ? text('Copied.') : ''}
                </span>
              </div>
            </aside>
          ) : null}
        </div>
        {!online && !commandMode ? (
          <div className="shrink-0 border-t border-line bg-warning-bg px-[18px] py-2 text-[12px] font-semibold text-warning">Offline — showing results saved on this computer.</div>
        ) : null}
        {online && !commandMode && !idle && building ? (
          <details className="shrink-0 border-t border-line bg-well px-4 py-1.5 text-[12px] text-ink-2">
            <summary className="cursor-pointer rounded focus-visible:ring-2 focus-visible:ring-primary">
              <span role="status">{text('Search is still indexing ({progress}%).', { progress: Math.round((index?.progress ?? 0) * 100) })}</span> {text('Details')}
            </summary>
            <p className="m-0 max-h-20 overflow-y-auto pt-2 scroll-thin">
              {text('Some sources are searched the slower way meanwhile: {sources}.', { sources: index!.building.map((source) => text(source)).join(', ') })}
              {filtered ? ` ${text('Filters skip sources that are still indexing.')}` : ''}
            </p>
          </details>
        ) : null}
        <div className="flex h-[42px] shrink-0 items-center gap-3 overflow-x-auto border-t border-line px-[18px] whitespace-nowrap text-[11.5px] text-ink-3">
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
            <Kbd>Alt+←/→</Kbd>
            {text('filter')}
          </span>
          <span className="flex items-center gap-[5px]">
            <Kbd>&gt;</Kbd>commands
          </span>
          {narrow && cur && !detailsOpen ? (
            <button
              type="button"
              onClick={() => setDetailsOpen(true)}
              className="rounded border border-line px-2 py-1 font-semibold text-primary focus-visible:ring-2 focus-visible:ring-primary"
            >
              {text('Details')}
            </button>
          ) : null}
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
  return <KeyChip tone="key">{children}</KeyChip>;
}

/** How long Copy link says "Copied" (#148). */
export const COPIED_MS = 1500;

/** Cmd+C on macOS, Ctrl+C elsewhere — nothing else held. */
export function isCopyChord(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>, mac = isMac): boolean {
  return e.key.toLowerCase() === 'c' && (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey && !e.shiftKey;
}

/** Mod+Shift+C: copy the link, whatever is selected. */
export function isLinkChord(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>, mac = isMac): boolean {
  return e.key.toLowerCase() === 'c' && (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey && e.shiftKey;
}

/** Whether a copy would take text: a selection in the focused field or on the page. */
function hasTextSelection(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    try {
      if (target.selectionStart !== target.selectionEnd) return true;
    } catch {
      // Field types without a selection (email, number) fall through to the page.
    }
  }
  return Boolean(window.getSelection?.()?.toString());
}

/** Files use their actual kind, rather than the Files application's folder glyph. */
export function searchFileIcon(name: string): string {
  return (
    (
      {
        image: 'file-image',
        pdf: 'file-text',
        document: 'file-text',
        spreadsheet: 'file-sheet',
        presentation: 'board',
        video: 'film',
        audio: 'audio-lines',
        archive: 'archive',
        code: 'file-code',
        design: 'pen',
      } as Record<string, string>
    )[kindOf(name)] ?? 'file'
  );
}

function SearchFilters({
  days,
  setDays,
  company,
  setCompany,
  mine,
  setMine,
  companies,
}: {
  days: number;
  setDays: (days: number) => void;
  company: number;
  setCompany: (id: number) => void;
  mine: boolean;
  setMine: (mine: boolean) => void;
  companies: NonNullable<ServerAnswer['companies']>;
}) {
  return (
    <>
      <Select<number>
        aria-label={text('Date Range')}
        value={days}
        onValueChange={setDays}
        options={WHEN.map((w) => ({ value: w.days, label: text(w.label) }))}
        className={cx('h-[30px] w-[130px] shrink-0', days > 0 && 'bg-selection')}
      />
      {companies.length > 1 || company > 0 ? (
        <Select<number>
          aria-label={text('Company')}
          value={company}
          onValueChange={setCompany}
          searchable
          options={[{ value: 0, label: text('All companies') }, ...companies.map((c) => ({ value: c.id, label: c.name }))]}
          className={cx('h-[30px] w-[180px] shrink-0', company > 0 && 'bg-selection')}
        />
      ) : null}
      <button
        type="button"
        role="switch"
        aria-checked={mine}
        onClick={() => setMine(!mine)}
        className={cx(
          'flex h-[30px] shrink-0 items-center rounded-[7px] border px-3 text-[12.5px] font-semibold focus-visible:ring-2 focus-visible:ring-primary',
          mine ? 'border-primary bg-selection text-primary' : 'border-line bg-surface text-ink-2',
        )}
      >
        {text('Mine')}
      </button>
    </>
  );
}

interface SearchFileDetails {
  id: number;
  extension: string | null;
  size: number;
  company: { id: number; name: string } | null;
  location: Array<{ id: number; name: string }>;
  modified_at: string | null;
  updated_at: string | null;
}

/** Fetch the existing permission-checked endpoint; a new selection never displays the last file's metadata. */
function SearchFacts({ item, online, identity }: { item: Item; online: boolean; identity: string }) {
  const file = useQuery({
    queryKey: ['search-file-details', identity, item.fileId],
    queryFn: ({ signal }) => apiGet<SearchFileDetails>(`/api/files/${item.fileId}/details`, undefined, signal),
    enabled: !!item.fileId && online,
    staleTime: 15_000,
    retry: false,
  });
  const data = file.data?.id === item.fileId ? file.data : undefined;
  const fields: Array<[string, string]> = item.fileId
    ? [
        ['Type', extOf(item.title, data?.extension).toUpperCase() || text('File')],
        ['Size', data ? bytes(data.size) : (item.subtitle?.split(' · ')[1] ?? text('Not available'))],
        ['Company', data ? (data.company?.name ?? text('No company')) : text('Not available')],
        ['Location', data ? data.location.map((p) => p.name).join(' / ') || text('My files') : text('Not available')],
        ['Modified', data ? relative(data.modified_at ?? data.updated_at) || text('Not available') : text('Not available')],
      ]
    : item.kv;
  return (
    <>
      <dl className="m-0 grid grid-cols-[78px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[12px]">
        {fields.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-3">{text(k)}</dt>
            <dd className="m-0 font-semibold [overflow-wrap:anywhere] text-ink-2 selectable">{v}</dd>
          </div>
        ))}
      </dl>
      {item.fileId && file.isFetching ? (
        <span role="status" className="text-[12px] text-ink-3">
          {text('Loading details…')}
        </span>
      ) : null}
      {item.fileId && file.isError ? (
        <span role="status" className="text-[12px] text-ink-3">
          {text('Details could not be loaded. You can still open this result.')}
        </span>
      ) : null}
    </>
  );
}
