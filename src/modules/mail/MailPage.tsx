import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGetMeta, apiPost, apiPut, setDefaultMailbox, withMailbox } from '../../core/api';
import { canOpen } from '../../core/access';
import { dayWords, todayInZone } from '../../core/time';
import { app } from '../../core/app-state';
import { errorMessage, isMac } from '../../core/bridge';
import { text } from '../../core/i18n';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { searchFold } from '@shared/localization';
import { Icon } from '../../components/Icon';
import { SidePanel } from '../../components/SidePanel';
import { Button, Empty, cx } from '../../components/ui';
import { useVips } from './PeopleCard';
import { TodoPane, nextSlot } from './TodoPane';
import type { ModuleProps } from '../registry';
import { AddMailbox } from './AddMailbox';
import { messageAction, moveMessage, useLocalStore, useMailPrefs, useMailboxes, usePendingMail, useViewCounts, type MessageActionName } from './api';
import { registerCommand, runCommand } from '../../core/commands';
import { MAIL_COMMANDS, bindings, commandFor, isPlain, keyLabel, keyOf, type MailCommandId } from './keymap';
import { GoToFolder, ShortcutSheet } from './Shortcuts';
import { allAccountsPage, allFolderLabel, isAllRole, queuedSends, useAllCounts, useLocalDrafts } from './allAccounts';
import { ArchivePicker } from './ArchivePicker';
import { Compose } from './Compose';
import { LocalDraftRows, OutboxView } from './Outbox';
import { includedIds, runSync, syncSummary, useSharedSync } from './sync';
import { CategoriesDialog, ContextMenu, DatesDialog, stateSections, useStateActions, type Target } from './MessageMenus';
import { SelectionPane } from './SelectionPane';
import { SweepDialog } from './SweepDialog';
import { FirstRun, FirstRunOffers } from './FirstRun';
import { classifyFocus, flagChoices, otherBanner, pinnedFirst, stateKey, useCategories, useFocusContext, useMessageStates, withStates } from './states';
import { MessageList, type ListRow } from './MessageList';
import { MessageView, windowRoute, type ViewControls } from './MessageView';
import { applyFilters, filtersFor, serverFilters, folderName, folderViewPatch, groupRows, queueKey, queuedByMessage, rowMailbox, smartView, sortRows, step, withFolderView, type ChipId } from './model';
import { sendAfterUndoWindow, useOutgoing, undoSend } from './outgoing';
import { needsAsking, removesMessages, runQuickStep, saveAnswers, useQuickSteps, type QuickStep } from './quickSteps';
import { QuickStepAsk } from './QuickStepsUi';
import { alertFor, chime, deviceId, freshRows, markSeen, myRules, ruleTakes } from './clientRules';
import { CreateRule, useRules } from './MailRules';
import { CatchUp } from './CatchUp';
import { IgnoreDialog, conversationKeyOf, ignoreConversation, ignoredKeys, stopIgnoring } from './Conversations';
import { ReadingPane, afterClose, withTab, type OpenTab } from './ReadingPane';
import { ScheduledList } from './Scheduled';
import { SearchView } from './SearchView';
import { MailFileViewer } from './FileViewer';
import { ExportDialog } from './DataFiles';
import { MailSidebar, unreadOf, type Place } from './Sidebar';
import { StatusBar, WaitingPanel } from './StatusBar';
import type { ComposeSeed, Label, MailPrefs, Mailbox, MessagePage, MessageRef, MessageRow } from './types';


export { joinQuote, splitQuote, unquote } from './quote';

/**
 * Desktop Mail (UI-07, FR-COM-01, §4.14): the sidebar — mailboxes, smart
 * views, folders, labels and the sync card — the message list, and the
 * reading pane with a tab per open message. READ_CACHE + DRAFTS + the offline
 * queue: recent mail reads offline within the cache window, drafts are kept as
 * they are typed, and archiving, deleting, starring, moving and sending made
 * offline wait in the queue — with Undo — until the connection returns.
 *
 * Keyboard (when no field has focus): j/k or ↓/↑ next and previous, Enter
 * open, Esc back, e archive, # delete, ! spam, s star, u unread, r reply,
 * a reply all, f forward, n new email, / search.
 */
export default function MailPage(props: ModuleProps) {
  const { query } = useTab();
  // An .eml or .msg opened from the system or Import (ENH-MAIL-03 DMO-DAT-04): read-only, in a tab of its own.
  const file = query.get('file');
  return file ? <MailFileViewer handle={file} /> : <MailWorkspace {...props} />;
}

function MailWorkspace({ active }: ModuleProps) {
  const qc = useQueryClient();
  const { query, go, route, openInWindow, navigate, path } = useTab();
  const place: Place = {
    box: query.get('box') ?? 'unified',
    view: smartView(query.get('view'))?.id ?? null,
    folder: query.get('folder') ?? 'inbox',
    label: query.get('label') ? Number(query.get('label')) : null,
  };
  const msg = query.get('msg');
  const msgBox = query.get('mbx');
  const msgFolder = query.get('mf') ?? place.folder;
  const status = useStore(app, (s) => s.status);
  const cacheDays = useStore(app, (s) => s.prefs?.mailCacheDays ?? 30);
  const networkOffline = status?.network === 'OFFLINE';

  const [chips, setChips] = useState<ChipId[]>([]);
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState<string | null>(null);
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [compose, setCompose] = useState<{ seed: ComposeSeed; shown: boolean; n: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const [focus, setFocus] = useState(false);
  const [team, setTeam] = useState<'open' | 'answered' | 'closed' | 'all'>('open');
  const [teamWho, setTeamWho] = useState<'all' | 'mine' | 'nobody' | 'snoozed'>('all');
  const controls = useRef<ViewControls | null>(null);
  const [composeRoute, setComposeRoute] = useState<string | null>(null);
  const openCompose = (seed: ComposeSeed) => setCompose((c) => ({ seed, shown: true, n: (c?.n ?? 0) + 1 }));
  if (query.get('compose') === '1' && composeRoute !== route) {
    setComposeRoute(route);
    // `?compose=1&to=a@b` — a new message to somebody (Contacts' Email), or a mailto: link with cc, subject and body.
    setCompose((c) => ({ seed: composeSeedFromQuery(query), shown: true, n: (c?.n ?? 0) + 1 }));
  }
  // An import's notification links to /mail/imports: the import screen lives in Settings › Mail.
  const importsRoute = path[1] === 'imports';
  useEffect(() => {
    if (!importsRoute) return;
    const id = query.get('id');
    navigate(`/settings/mail?tab=import${id && /^\d+$/.test(id) ? `&id=${id}` : ''}`);
    go('/mail');
  }, [importsRoute, query, navigate, go]);
  useTabTitle(msg ? 'Mail · Message' : 'Mail');

  const mailboxes = useMailboxes();
  const boxes = useMemo(() => (mailboxes.data?.mailboxes ?? []).filter((m) => !m.archived), [mailboxes.data]);
  const defaultBox = boxes.find((m) => m.is_default) ?? boxes[0];
  useEffect(() => setDefaultMailbox(defaultBox ? String(defaultBox.id) : null), [defaultBox]);
  const localStore = mailboxes.isSuccess && boxes.length === 0;
  const counts = useViewCounts(active && (mailboxes.isSuccess || mailboxes.isError));
  const shared = useSharedSync(active && boxes.length > 0);
  const allCounts = useAllCounts(active && boxes.length > 1);
  const pending = usePendingMail();
  const localBytes = useLocalStore();
  const { prefs: globalPrefs, set: setGlobalPrefs, loaded: prefsLoaded } = useMailPrefs();
  const outgoing = useOutgoing();

  const view = smartView(place.view);
  const folder = view?.folder ?? place.folder;
  const unified = place.box === 'unified' && boxes.length > 1 && place.label === null;
  const effectiveBox = place.label !== null ? null : unified ? null : place.box === 'unified' ? (defaultBox ? String(defaultBox.id) : null) : place.box;
  const filters = filtersFor(view, chips);
  const folderKey = `${effectiveBox ?? 'unified'}:${folder}`;
  // Density, reading pane, action bar, sort and grouping are remembered for each folder (DMO-INB-16).
  const prefs = withFolderView(globalPrefs, folderKey);
  const setPrefs = (patch: Partial<MailPrefs> & { applyToAll?: boolean }) => setGlobalPrefs(folderViewPatch(globalPrefs, folderKey, patch));
  const canThread = !unified && filters.length === 0 && folder !== 'outbox';
  const threaded = canThread && !!prefs.conversations?.[folderKey];
  // All Accounts (DMO-ALL): the combined view of a folder role, not a smart view.
  const allRole = unified && !view ? (folder === 'spam' ? 'junk' : isAllRole(folder) ? folder : null) : null;
  const virtualOutbox = allRole === 'outbox';

  const list = useInfiniteQuery({
    queryKey: ['mail', 'messages', unified ? 'unified' : effectiveBox, folder, serverFilters(filters).join(','), threaded],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => {
      const combined = { page: pageParam, per_page: 50, ...(serverFilters(filters).length ? { filters: serverFilters(filters).join(',') } : {}) };
      const byName = () =>
        apiGetMeta<MessagePage>(
          '/api/mail/messages',
          unified
            ? { unified: 1, folder, ...combined }
            : place.label !== null
              ? { folder, page: pageParam, per_page: 50 }
              : withMailbox({ folder, page: pageParam, per_page: 50, ...(serverFilters(filters).length ? { filters: serverFilters(filters).join(',') } : {}), ...(threaded ? { threaded: 1 } : {}), sort: prefs.sort ?? 'date', dir: prefs.dir ?? 'desc' }, effectiveBox),
          signal,
        );
      return allRole ? allAccountsPage(allRole, combined, signal, byName) : byName();
    },
    getNextPageParam: (last, pages) => (last.data.has_more ? pages.length + 1 : undefined),
    enabled: (mailboxes.isSuccess || mailboxes.isError) && folder !== 'outbox',
  });
  const localDrafts = useLocalDrafts(active && (allRole === 'drafts' || boxes.length > 1));
  const sending = queuedSends(pending.data ?? []);
  const running = shared.running;
  const summary = syncSummary(shared.status, { offline: networkOffline, running, boxes, staleMinutes: prefs.staleMinutes });
  const syncAll = () => {
    if (networkOffline) return;
    void runSync(includedIds(shared.status, boxes), { all: true, onDone: () => void shared.refetch() }).then((r) => {
      if (r.failed.length) toast('error', text('{n} accounts could not be synced — see the Sync all tooltip.', { n: r.failed.length }));
      void qc.invalidateQueries({ queryKey: ['mail'] });
    });
  };
  const syncAccount = (id: number) => {
    if (networkOffline) return;
    void runSync([id], { onDone: () => void shared.refetch() }).then(() => void qc.invalidateQueries({ queryKey: ['mail'] }));
  };
  // Archive from a combined view: the account's own Archive, or — where it has none — a folder chosen once (DMO-ALL-11).
  const [archiveAsk, setArchiveAsk] = useState<{ box: Mailbox; resolve: (v: { slug: string; name: string } | 'default' | null) => void } | null>(null);
  const archiveTo = (ref: MessageRef): Promise<{ slug: string; name: string } | 'default' | null> | 'default' => {
    if (!unified || !ref.mailbox) return 'default';
    const box = boxes.find((b) => String(b.id) === ref.mailbox);
    const known = allCounts.data?.roles.archive.mailboxes.find((m) => String(m.id) === ref.mailbox);
    if (!box || !known || /gmail|google/i.test(`${box.provider ?? ''} ${box.oauth_provider ?? ''}`)) return 'default';
    if (known.folder) return known.folder === 'archive' ? 'default' : Promise.resolve({ slug: known.folder, name: text('Archive') });
    return new Promise((resolve) => setArchiveAsk({ box, resolve }));
  };
  const firstPage = list.data?.pages[0];
  const cachedOffline = !!list.data?.pages.some((p) => p.offline);
  const offline = networkOffline || cachedOffline;
  const isTeam = !!firstPage?.data.team;

  const queued = useMemo(() => queuedByMessage(pending.data ?? []), [pending.data]);
  const rowKey = (m: MessageRow) => queueKey(rowMailbox(m, effectiveBox), m.folder_slug ?? folder, m.id);
  // WorkSuite's states for what is listed: pins, snoozes, flags, categories, Focused moves.
  const statesScope = unified || place.label !== null ? null : effectiveBox;
  const states = useMessageStates(active && (mailboxes.isSuccess || mailboxes.isError) && folder !== 'outbox', statesScope, statesScope ? folder : null);
  const cats = useCategories(active);
  const vips = useVips(active);
  const vipSet = new Set((vips.data ?? []).map((v) => v.address.toLowerCase()));
  const focusOn = prefs.focused !== false && !view && place.label === null && folder === 'inbox' && states.data !== null && states.data !== undefined && !isTeam && !(effectiveBox && prefs.focusedOff?.includes(Number(effectiveBox)));
  const focusCtx = useFocusContext(active && focusOn);
  const [focusTab, setFocusTab] = useState<'focused' | 'other'>('focused');
  const stateKeyOf = (m: MessageRow) => stateKey(rowMailbox(m, effectiveBox), m.folder_slug ?? folder, m.id);
  // Messages a Quick Step is about to move away: gone from the list at once, back on Undo.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const decorated = (() => {
    let all = (list.data?.pages ?? []).flatMap((p) => p.data.messages);
    all = applyFilters(all, filters, undefined, vipSet);
    if (hidden.size) all = all.filter((m) => !hidden.has(rowKey(m)));
    if (isTeam) {
      const me = Number(app.get().bootstrap?.user.id ?? 0);
      all = all.filter((m) => teamRowShown(m, team, teamWho, me));
    }
    const term = searchFold(search.trim());
    if (term) all = all.filter((m) => searchFold(`${m.from_name} ${m.from_email} ${m.subject} ${m.preview}`).includes(term));
    // The Snoozed view lists exactly what the others hide.
    return allRole === 'snoozed' ? all : withStates(all, states.data, stateKeyOf, cats.data);
  })();
  const focusUnread = focusOn ? { focused: decorated.filter((m) => !m.is_read && classifyFocus(m, focusCtx.data).focus === 'focused').length, other: decorated.filter((m) => !m.is_read && classifyFocus(m, focusCtx.data).focus === 'other').length } : { focused: 0, other: 0 };
  const rows = pinnedFirst(sortRows(focusOn ? decorated.filter((m) => classifyFocus(m, focusCtx.data).focus === focusTab) : decorated, prefs.sort ?? 'date', prefs.dir ?? 'desc'));
  const toItem = (r: MessageRow): ListRow => ({ row: r, key: rowKey(r), queued: queued.get(rowKey(r)) ?? null });
  const top = rows.filter((m) => m.pinned || m.returned);
  const groups = [...(top.length ? [{ key: 'pinned', label: text('Pinned'), rows: top, items: top.map(toItem) }] : []), ...groupRows(rows.filter((m) => !m.pinned && !m.returned), prefs.group ?? 'date').map((g) => ({ ...g, items: g.rows.map(toItem) }))];
  const flat = groups.flatMap((g) => g.items);

  // Several selected (Ctrl/Shift-click, Ctrl+A): every action applies to each, in its own account (DMO-INB-15).
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [anchorKey, setAnchorKey] = useState<string | null>(null);
  const selectRow = (r: ListRow, how: 'toggle' | 'range') => {
    setSelection((s) => {
      const next = new Set(s);
      if (how === 'range' && anchorKey) {
        const a = flat.findIndex((x) => x.key === anchorKey);
        const b = flat.findIndex((x) => x.key === r.key);
        if (a >= 0 && b >= 0) for (const x of flat.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(x.key);
      } else if (next.has(r.key)) next.delete(r.key);
      else next.add(r.key);
      return next;
    });
    setAnchorKey(r.key);
  };
  const stateActs = useStateActions();
  // Quick Steps (DMO-QS, WF-DO03): run on the selection with one Undo; asked values asked once.
  const quickSteps = useQuickSteps(active);
  const [asking, setAsking] = useState<{ step: QuickStep; targets: Target[] } | null>(null);
  const runStep = (step: QuickStep, targets: Target[]) => {
    if (targets.length === 0) return;
    if (needsAsking(step).length) return setAsking({ step, targets });
    const keys = targets.map((t) => queueKey(t.mailbox, t.folder, t.row.id));
    if (removesMessages(step)) setHidden((h) => new Set([...h, ...keys]));
    setSelection(new Set());
    const label = targets.length === 1 ? text('“{step}” on “{subject}”', { step: step.name, subject: targets[0]!.row.subject || text('(no subject)') }) : text('“{step}” on {n} messages', { step: step.name, n: targets.length });
    sendAfterUndoWindow(
      step.name,
      async () => {
        const r = await runQuickStep(step, targets);
        setHidden((h) => new Set([...h].filter((k) => !keys.includes(k))));
        void qc.invalidateQueries({ queryKey: ['mail'] });
        void qc.invalidateQueries({ queryKey: ['offline'] });
        if (r.failed) toast('error', text('{n} of {total} failed — {why}', { n: r.failed, total: targets.length, why: r.errors[0] ?? '' }));
        else toast('success', text('Done: {what}.', { what: label }));
        if (r.compose[0]) openCompose(r.compose[0]);
      },
      () => setHidden((h) => new Set([...h].filter((k) => !keys.includes(k)))),
      10,
      label,
    );
  };
  const runQuickStepKey = (n: number): boolean => {
    const step = (quickSteps.data ?? []).find((q) => q.shortcut === n);
    const ts = selectedTargets(currentRow ?? undefined);
    if (!step || ts.length === 0) return false;
    runStep(step, ts);
    return true;
  };
  const targetOf = (r: ListRow): Target => ({ row: r.row, mailbox: rowMailbox(r.row, effectiveBox), folder: r.row.folder_slug ?? folder });
  const selectedTargets = (fallback?: ListRow): Target[] => {
    const picked = flat.filter((r) => selection.has(r.key));
    return (picked.length ? picked : fallback ? [fallback] : []).map(targetOf);
  };
  const [rowMenu, setRowMenu] = useState<{ r: ListRow; x: number; y: number } | null>(null);
  const [custom, setCustom] = useState<{ what: 'snooze' | 'flag' | 'categories' | 'sweep'; targets: Target[] } | null>(null);
  // Export a folder (ENH-MAIL-03 DMO-DAT-03).
  const [exporting, setExporting] = useState<{ mailbox: string; folder: string; name: string } | null>(null);

  // The open message: the URL names it; its tab joins the strip.
  const current: MessageRef | null = msg ? { uid: msg, folder: msgFolder, mailbox: msgBox ?? effectiveBox } : null;
  const currentKey = current ? queueKey(current.mailbox, current.folder, current.uid) : null;
  const known = current ? flat.find((r) => r.key === currentKey)?.row : undefined;
  if (current && currentKey && !tabs.some((t) => t.key === currentKey)) {
    setTabs(withTab(tabs, { key: currentKey, ref: current, subject: known?.subject ?? '', from: known ? known.from_name || known.from_email : '' }, currentKey));
  } else if (known && currentKey) {
    const t = tabs.find((x) => x.key === currentKey);
    if (t && !t.subject && known.subject) setTabs(withTab(tabs, { ...t, subject: known.subject, from: known.from_name || known.from_email }, currentKey));
  }

  const placeQuery = (p: Partial<Place> = {}) => {
    const next = { ...place, ...p };
    const q = new URLSearchParams();
    if (next.box !== 'unified') q.set('box', next.box);
    if (next.view) q.set('view', next.view);
    if (next.folder !== 'inbox') q.set('folder', next.folder);
    if (next.label !== null) q.set('label', String(next.label));
    return q;
  };
  const openRef = (ref: MessageRef) => {
    const q = placeQuery();
    q.set('msg', ref.uid);
    if (ref.mailbox) q.set('mbx', ref.mailbox);
    if (ref.folder !== place.folder) q.set('mf', ref.folder);
    go(`/mail?${q}`);
  };
  const openRow = (r: ListRow) => {
    setSearching(null);
    setCompose((c) => (c ? { ...c, shown: false } : c));
    const ref = { uid: String(r.row.id), folder: r.row.folder_slug ?? folder, mailbox: rowMailbox(r.row, effectiveBox) };
    setSelection(new Set());
    // Open messages in windows (DMO-SHL-06): each in its own window, which reopens where it was.
    if (prefs.openIn === 'windows') return void openInWindow(windowRoute(ref), r.row.subject);
    openRef(ref);
  };
  const routeOf = (q: URLSearchParams) => (q.size ? `/mail?${q}` : '/mail');
  const closeMessage = () => go(routeOf(placeQuery()));
  const pick = (p: Partial<Place>) => {
    setSearching(null);
    setChips([]);
    setSearch('');
    setSelection(new Set());
    setFocusTab('focused');
    setCompose((c) => (c ? { ...c, shown: false } : c));
    go(routeOf(placeQuery({ view: null, label: null, ...p })));
  };
  const closeTab = (key: string) => {
    const r = afterClose(tabs, key, currentKey);
    setTabs(r.tabs);
    if (r.active !== currentKey) {
      const t = r.tabs.find((x) => x.key === r.active);
      if (t) openRef(t.ref);
      else closeMessage();
    }
  };
  // A message opened from a link (a notification, another window) names its tab once it has arrived.
  // (The update returns the same list when there is nothing to name, so React does not render again.)
  const nameTab = (subject: string, from: string) => setTabs((ts) => (ts.some((t) => t.key === currentKey && (!t.subject || !t.from)) ? ts.map((t) => (t.key === currentKey ? { ...t, subject: t.subject || subject, from: t.from || from } : t)) : ts));
  const at = flat.findIndex((r) => r.key === currentKey);
  const move = (by: number) => {
    const i = step(flat, at, by);
    if (i >= 0 && flat[i]) openRow(flat[i]);
  };
  const star = async (r: ListRow) => {
    try {
      await messageAction({ uid: String(r.row.id), folder: r.row.folder_slug ?? folder, mailbox: rowMailbox(r.row, effectiveBox) }, r.row.is_starred ? 'unstar' : 'star', r.row.subject);
      void qc.invalidateQueries({ queryKey: ['mail'] });
      void qc.invalidateQueries({ queryKey: ['offline'] });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  // After archive or delete: the next message in the list, as a mail app does.
  const gone = () => {
    const next = flat[at + 1] ?? flat[at - 1] ?? null;
    if (currentKey) setTabs((ts) => ts.filter((t) => t.key !== currentKey));
    if (next && next.key !== currentKey) openRow(next);
    else closeMessage();
  };

  // Keyboard.
  const keys = useRef<(e: KeyboardEvent) => void>(() => undefined);
  // The keyboard scheme (DMO-KEY-01): WorkSuite, Outlook or Gmail, with the person's own keys on top.
  const keyMap = bindings(prefs.keyScheme, prefs.keyBindings);
  const pendingKey = useRef<{ key: string; at: number } | null>(null);
  const [sheet, setSheet] = useState(false);
  const [gotoOpen, setGotoOpen] = useState(false);
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    const key = keyOf(e);
    if (!key) return;
    const t = e.target as HTMLElement | null;
    const typing = !!t && typeof t.closest === 'function' && (!!t.closest('input, textarea, select, [contenteditable="true"]') || t.isContentEditable);
    const inLayer = !!t && typeof t.closest === 'function' && !!t.closest('[role="dialog"], [role="menu"]');
    if (key === 'Escape') {
      if (inLayer || typing) return;
      if (selection.size) return e.preventDefault(), setSelection(new Set());
      if (focus) return e.preventDefault(), setFocus(false);
      if (current) return e.preventDefault(), closeMessage();
      return;
    }
    if ((typing || inLayer) && isPlain(key)) return;
    if (compose?.shown || searching !== null) return;
    const now = e.timeStamp;
    const waiting = pendingKey.current && now - pendingKey.current.at < 1500 ? pendingKey.current.key : null;
    const hit = commandFor(keyMap, key, waiting);
    pendingKey.current = hit.pending ? { key: hit.pending, at: now } : null;
    if (hit.pending) return e.preventDefault();
    if (!hit.id) return;
    const ran = runMailCommand(hit.id as MailCommandId);
    if (ran) e.preventDefault();
  };
  /** One command, from a key or the command search. Returns whether it did anything. */
  const runMailCommand = (id: MailCommandId): boolean => {
    const c = controls.current;
    const many = selectedTargets();
    const onSelection = (fn: (ts: Target[]) => void) => {
      const ts = many.length ? many : currentRow ? [targetOf(currentRow)] : [];
      if (!ts.length) return false;
      fn(ts);
      return true;
    };
    switch (id) {
      case 'next':
        move(1);
        return true;
      case 'prev':
        move(-1);
        return true;
      case 'open':
        if (current || !flat[0]) return false;
        openRow(flat[0]);
        return true;
      case 'openWindow':
        if (!current) return false;
        openInWindow(windowRoute(current), known?.subject);
        return true;
      case 'search': {
        const box = document.querySelector<HTMLInputElement>('[data-mail-search]');
        if (!box) return false;
        box.focus();
        return true;
      }
      case 'new':
        openCompose({ mode: 'new' });
        return true;
      case 'syncAll':
        syncAll();
        return true;
      case 'syncFolder':
        if (effectiveBox) syncAccount(Number(effectiveBox));
        else syncAll();
        return true;
      case 'shortcuts':
        setSheet(true);
        return true;
      case 'goto':
        setGotoOpen(true);
        return true;
      case 'commandSearch':
        return runCommand('palette');
      case 'goMail':
        pick({ box: 'unified', folder: 'inbox' });
        return true;
      case 'goCalendar':
        navigate('/calendar');
        return true;
      case 'goPeople':
        navigate('/contacts');
        return true;
      case 'goTasks':
        navigate('/tasks');
        return true;
      case 'selectAll':
        setSelection(new Set(flat.map((r) => r.key)));
        return true;
      case 'pin':
        return onSelection((ts) => void stateActs.pin(ts, !ts.every((x) => x.row.pinned)));
      case 'snooze':
        return onSelection((ts) => setCustom({ what: 'snooze', targets: ts }));
      default:
        break;
    }
    if (id.startsWith('quickStep')) return runQuickStepKey(Number(id.slice(9)));
    if (many.length > 1) {
      const bulk: Partial<Record<MailCommandId, MessageActionName>> = { archive: 'archive', delete: 'trash', read: 'read', unread: 'unread', spam: 'spam' };
      const action = bulk[id];
      if (!action) return false;
      void Promise.all(many.map((x) => messageAction({ uid: String(x.row.id), folder: x.folder, mailbox: x.mailbox }, action, x.row.subject).catch(() => undefined))).then(() => {
        void qc.invalidateQueries({ queryKey: ['mail'] });
        if (action === 'archive' || action === 'trash' || action === 'spam') setSelection(new Set());
      });
      return true;
    }
    if (!current || !c) return false;
    const map: Partial<Record<MailCommandId, () => void>> = {
      archive: () => c.act('archive'),
      delete: () => c.act('trash'),
      spam: () => c.act('spam'),
      flag: () => c.act('star'),
      read: () => c.act('read'),
      unread: () => c.act('unread'),
      reply: () => c.reply('reply'),
      replyAll: () => c.reply('reply_all'),
      forward: () => c.reply('forward'),
      move: () => c.menu('move'),
      findInMessage: () => c.menu('find'),
    };
    const run = map[id];
    if (!run) return false;
    run();
    return true;
  };
  const runner = useRef<(id: MailCommandId) => boolean>(() => false);
  const stepRunner = useRef<(n: number) => void>(() => undefined);
  useEffect(() => {
    keys.current = onKey;
    runner.current = runMailCommand;
  });
  // Command search (DMO-SHL-04): Mail's commands, Quick Steps and settings in the palette while Mail is in front, with their keys.
  const paletteKeys = MAIL_COMMANDS.filter((c) => !c.id.startsWith('quickStep') && c.id !== 'commandSearch').map((c) => `${c.id}=${keyMap[c.id]?.[0] ?? ''}`).join('|');
  const paletteSteps = (quickSteps.data ?? []).map((q) => `${q.id}:${q.name}:${q.shortcut ?? ''}`).join('|');
  useEffect(() => {
    if (!active) return;
    const mac = isMac;
    const key = (id: string) => {
      const k = paletteKeys.split('|').find((p) => p.startsWith(`${id}=`))?.slice(id.length + 1);
      return k ? keyLabel(k, mac) : undefined;
    };
    const offs = [
      ...MAIL_COMMANDS.filter((c) => !c.id.startsWith('quickStep') && c.id !== 'commandSearch').map((c) =>
        registerCommand({ id: `mail-${c.id}`, label: text(c.label), group: 'Module', source: 'module', keywords: `mail ${c.id.toLowerCase()} ${c.label.toLowerCase()}`, hint: key(c.id), run: () => void runner.current(c.id) }),
      ),
      ...(paletteSteps ? paletteSteps.split('|') : []).map((p) => {
        const [id, name, n] = p.split(':');
        return registerCommand({ id: `mail-qs-${id}`, label: text('Quick Step: {name}', { name: name ?? '' }), group: 'Module', source: 'module', keywords: 'mail quick step', hint: n ? keyLabel(`Mod+Shift+${n}`, mac) : undefined, run: () => stepRunner.current(Number(id)) });
      }),
      registerCommand({ id: 'mail-out-of-office', label: text('Automatic replies (out of office)'), group: 'Module', source: 'module', keywords: 'mail out of office vacation away automatic reply', run: () => navigate('/settings/mail?tab=rules') }),
      registerCommand({ id: 'mail-new-rule', label: text('New rule'), group: 'Module', source: 'module', keywords: 'mail rule filter create', run: () => navigate('/settings/mail?tab=rules') }),
      registerCommand({ id: 'mail-quick-steps', label: text('Manage Quick Steps'), group: 'Module', source: 'module', keywords: 'mail quick steps', run: () => navigate('/settings/mail?tab=quicksteps') }),
      registerCommand({ id: 'mail-signatures', label: text('Signatures'), group: 'Module', source: 'module', keywords: 'mail signature', run: () => navigate('/settings/mail?tab=signatures') }),
    ];
    return () => offs.forEach((off) => off());
    // Re-registered when the keys or the Quick Steps change; the runners are read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, paletteKeys, paletteSteps]);
  useEffect(() => {
    if (!active) return;
    const on = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [active]);

  const placeBox = place.box !== 'unified' ? boxes.find((b) => String(b.id) === place.box) : undefined;
  const label = place.label !== null ? (qc.getQueryData<{ labels: Label[] }>(['mail', 'labels'])?.labels.find((l) => l.id === place.label) ?? null) : null;
  const title = view
    ? text(view.label)
    : label
      ? label.name
      : allRole
        ? text('All Accounts · {folder}', { folder: allFolderLabel(allRole) })
        : placeBox && folder === 'inbox'
          ? placeBox.email
          : folder === 'inbox'
            ? text('Inbox')
            : folderName(folder.startsWith('label:') ? folder.slice(6) : folder.charAt(0).toUpperCase() + folder.slice(1));
  const included = boxes.filter((b) => b.in_unified !== false);
  const unifiedUnread = allCounts.data?.roles.inbox.count ?? included.reduce((n, b) => n + (unreadOf(b, counts.data ?? null) ?? 0), 0);
  const aside = allRole === 'inbox' ? text('{n} unread · {m} accounts', { n: unifiedUnread, m: included.length }) : allRole ? text('{m} accounts', { m: included.length }) : placeBox ? (placeBox.account_type === 'local_mailbox' ? text('WorkSuite Local') : placeBox.shared ? text('Shared') : (placeBox.provider_label ?? null)) : null;
  const unavailable = (firstPage?.data as (MessagePage & { unavailable?: Array<{ email: string; reason: string | null }> }) | undefined)?.unavailable ?? [];
  const notice = firstPage?.data.unsearched?.length
    ? text('Not searched: {list}.', { list: firstPage.data.unsearched.join(', ') })
    : firstPage?.data.offline?.length
      ? text('Could not reach {list} — showing the others.', { list: firstPage.data.offline.join(', ') })
      : firstPage?.data.quick_failed
        ? text('This mailbox could not apply that filter on the server; it is applied to what is loaded.')
        : unavailable.length
          ? text('No {folder} folder in {list}.', { folder: allRole ? allFolderLabel(allRole) : folder, list: unavailable.map((u) => u.email).join(', ') })
          : null;
  const pane = prefs.pane ?? 'right';
  const mailPending = (pending.data ?? []).filter((m) => m.state !== 'DONE');
  const account = current?.mailbox ? (boxes.find((b) => String(b.id) === current.mailbox) ?? null) : null;

  const teamTabs = isTeam ? (
    <div className="mt-2">
      <div role="tablist" aria-label="Conversations" className="flex rounded-[10px] bg-subtle p-0.5">
        {(['open', 'answered', 'closed', 'all'] as const).map((s) => {
          const n = s === 'all' ? null : (list.data?.pages ?? []).flatMap((p) => p.data.messages).filter((m) => (m.team?.status ?? 'open') === s).length;
          return (
            <button key={s} type="button" role="tab" aria-selected={team === s} onClick={() => setTeam(s)} className={cx('flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[8px] text-[13px] font-semibold', team === s ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink')}>
              {s === 'open' ? text('Open') : s === 'answered' ? text('Pending') : s === 'closed' ? text('Done') : text('All')}
              {n ? <span className="text-[12px] text-ink-3">{n}</span> : null}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex gap-1.5">
        {(['mine', 'nobody', 'snoozed'] as const).map((w) => (
          <button key={w} type="button" aria-pressed={teamWho === w} onClick={() => setTeamWho(teamWho === w ? 'all' : w)} className={cx('h-[26px] rounded-full border px-2.5 text-[12.5px] font-semibold', teamWho === w ? 'border-ink bg-ink text-surface' : 'border-line text-ink hover:bg-subtle')}>
            {w === 'mine' ? text('Assigned to me') : w === 'nobody' ? text('Unassigned') : text('Snoozed')}
          </button>
        ))}
      </div>
    </div>
  ) : null;

  const listEl = virtualOutbox ? (
    <OutboxView active={active} pending={pending.data ?? []} onEdit={openCompose} />
  ) : folder === 'outbox' ? (
      <ScheduledList active={active} />
    ) : (
      <MessageList
        title={title}
        aside={aside}
        groups={groups}
        total={firstPage?.data.total ?? 0}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        selectedKey={currentKey}
        onOpen={openRow}
        onStar={(r) => void star(r)}
        prefs={prefs}
        onPrefs={setPrefs}
        conversations={canThread ? threaded : null}
        onConversations={(on) => setPrefs({ conversations: { ...(prefs.conversations ?? {}), [folderKey]: on } })}
        chips={chips}
        onChips={setChips}
        search={search}
        onSearch={setSearch}
        onSearchAll={(q) => setSearching(q)}
        unified={unified}
        boxes={boxes}
        offline={offline}
        offlineDays={cacheDays}
        refreshing={list.isFetching && !list.isLoading}
        onRefresh={() => {
          void qc.invalidateQueries({ queryKey: ['mail'] });
        }}
        hasMore={!!list.hasNextPage}
        loadingMore={list.isFetchingNextPage}
        onMore={() => void list.fetchNextPage()}
        notice={notice}
        team={allRole === 'drafts' ? <LocalDraftRows drafts={localDrafts.data ?? []} onOpen={(d) => openCompose(d.seed)} /> : teamTabs}
        fill={pane === 'hidden' || pane === 'bottom'}
        focusTabs={focusOn ? { value: focusTab, onChange: setFocusTab, banner: otherBanner(decorated, focusCtx.data), unread: focusUnread } : null}
        onRowMenu={(r, x, y) => setRowMenu({ r, x, y })}
        selection={selection}
        onSelect={selectRow}
      />
    );

  // Rules that run on this computer only (DMO-RUL-04): applied to new inbox mail as it shows up here.
  const rules = useRules(active && boxes.length > 0);
  const brokenRules = (rules.data?.filters ?? []).filter((f) => f.last_error).length;
  // Automatic replies on now: a banner with Turn off (DMO-OOF-02).
  const vac = rules.data?.vacation;
  const todayWall = todayInZone();
  const away = !!vac?.enabled && (!vac.start_date || vac.start_date <= todayWall) && (!vac.end_date || vac.end_date >= todayWall);
  const turnOffAway = async () => {
    if (!vac) return;
    try {
      await apiPut('/api/mail/rules/vacation', { ...vac, enabled: false });
      void qc.invalidateQueries({ queryKey: ['mail', 'rules'] });
      toast('success', text('Automatic replies are off.'));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  /** A message dropped on My Day: an event now-ish with its text, or a flag — which is a task linked back to it. */
  const dropMail = async (key: string, to: 'event' | 'task') => {
    const r = flat.find((x) => x.key === key);
    if (!r) return;
    const t = targetOf(r);
    if (to === 'task') {
      await stateActs.flag([t], flagChoices().find((c) => c.id === 'today')!.dates);
      toast('success', text('“{subject}” is a task due today, linked to the message.', { subject: r.row.subject || text('(no subject)') }));
      return;
    }
    const slot = nextSlot();
    try {
      await apiPost('/api/calendar/events', {
        title: (r.row.subject || text('(no subject)')).slice(0, 250),
        description: `${text('From {sender} <{email}>', { sender: r.row.from_name || r.row.from_email, email: r.row.from_email })}\n\n${r.row.preview ?? ''}`.slice(0, 4000),
        start: `${slot.date}T${slot.start}`,
        end: `${slot.date}T${slot.end}`,
        all_day: false,
      });
      void qc.invalidateQueries({ queryKey: ['calendar'] });
      toast('success', text('Added to your calendar at {time}. Open Calendar to move it.', { time: slot.start }));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const clientRuleRows = folder === 'inbox' && !view ? decorated : null;
  useEffect(() => {
    const mine = myRules(rules.data?.filters ?? []);
    if (!clientRuleRows || mine.length === 0 || networkOffline) return;
    const { rows: fresh, old } = freshRows(clientRuleRows, rowKey);
    if (fresh.length === 0) return;
    markSeen(fresh.map(rowKey));
    for (const m of fresh) {
      const rule = mine.find((r) => ruleTakes(r, m));
      if (!rule) continue;
      const ref = { uid: String(m.id), folder: m.folder_slug ?? 'inbox', mailbox: rowMailbox(m, effectiveBox) };
      const quiet = old.has(rowKey(m));
      if (!quiet && rule.client_actions?.includes('alert')) alertFor(m, rule.name || text('Rule'));
      if (!quiet && rule.client_actions?.includes('sound')) chime();
      const special = rule.action_arg?.toLowerCase() ?? '';
      if (rule.action === 'fileinto' && rule.action_arg) void moveMessage(ref, rule.action_arg.startsWith('label:') ? rule.action_arg : ['archive', 'trash', 'spam', 'sent', 'drafts'].includes(special) ? special : `label:${rule.action_arg}`, rule.action_arg, m.subject).catch(() => undefined);
      else if (rule.action === 'star' && !m.is_starred) void messageAction(ref, 'star', m.subject).catch(() => undefined);
      else if (rule.action === 'seen' && !m.is_read) void messageAction(ref, 'read', m.subject).catch(() => undefined);
      else if (rule.action === 'delete') void messageAction(ref, 'trash', m.subject).catch(() => undefined);
    }
    // Keyed on the rows that are listed; the rules and the account only matter when rows change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientRuleRows, rules.data]);
  const [ruleFor, setRuleFor] = useState<MessageRow | null>(null);
  // Ignore conversation (DMO-INB-10): offered on a message with a stable thread; Stop ignoring from Deleted Items.
  const ignored = ignoredKeys(rules.data?.filters);
  const [ignoring, setIgnoring] = useState<{ key: string; target: Target; here: Target[] } | null>(null);
  const conversationItems = (t: Target) => {
    const key = conversationKeyOf(t.row);
    if (!key || networkOffline) return [];
    if (t.folder === 'trash' && ignored.has(key)) {
      return [{ id: 'unignore', label: text('Stop ignoring conversation'), icon: 'undo', onSelect: () => void stopIgnoring(key, t).then(() => (void qc.invalidateQueries({ queryKey: ['mail'] }), toast('success', text('No longer ignored; the message is back in the Inbox.'))), (e: unknown) => toast('error', errorMessage(e))) }];
    }
    if (t.folder === 'trash' || ignored.has(key)) return [];
    return [{ id: 'ignore', label: text('Ignore conversation'), icon: 'trash', onSelect: () => setIgnoring({ key, target: t, here: flat.filter((r) => conversationKeyOf(r.row) === key).map(targetOf) }) }];
  };

  const menuSections = (targets: Target[]) => [
    ...(quickSteps.data?.length ? [{ id: 'qs', label: text('Quick Steps'), items: quickSteps.data.slice(0, 12).map((q) => ({ id: `qs${q.id}`, label: q.name, icon: q.icon, shortcut: q.shortcut ? `Ctrl+Shift+${q.shortcut}` : undefined, onSelect: () => runStep(q, targets) })) }] : []),
    ...stateSections(targets, stateActs, cats.data ?? null, { focusTabs: focusOn ? focusTab : null, onCustom: (what) => setCustom({ what, targets }) }),
    ...(targets.length === 1 ? [{ id: 'rule', items: [{ id: 'rule', label: text('Create rule…'), icon: 'filter', description: targets[0]!.row.from_email, onSelect: () => setRuleFor(targets[0]!.row) }, ...conversationItems(targets[0]!)] }] : []),
  ];
  const multi = flat.filter((r) => selection.has(r.key));
  const currentRow = flat.find((r) => r.key === currentKey) ?? null;
  useEffect(() => {
    stepRunner.current = (id) => {
      const s = (quickSteps.data ?? []).find((q) => q.id === id);
      const ts = selectedTargets(currentRow ?? undefined);
      if (s && ts.length) runStep(s, ts);
      else if (s) toast('info', text('Select a message first.'));
    };
  });

  const reader = multi.length > 1 ? (
    <SelectionPane targets={multi.map(targetOf)} sections={menuSections(multi.map(targetOf))} onClear={() => setSelection(new Set())} onDone={() => setSelection(new Set())} />
  ) : (
    <ReadingPane
      tabs={prefs.tabs === false ? tabs.filter((t) => t.key === currentKey) : tabs}
      strip={prefs.tabs !== false}
      activeKey={currentKey}
      onActivate={(t) => openRef(t.ref)}
      onClose={closeTab}
      empty={<Empty icon="mail" title={text('Select a message')} hint={text('Choose a message from the list to read it here. j and k move through the list.')} />}
    >
      {current ? (
        <MessageView
          key={currentKey}
          msgRef={current}
          backLabel={title}
          onBack={closeMessage}
          onReply={openCompose}
          onGone={gone}
          onPrev={at > 0 ? () => move(-1) : null}
          onNext={at >= 0 && at < flat.length - 1 ? () => move(1) : null}
          prefs={prefs}
          onPrefs={setPrefs}
          focus={focus}
          onFocus={() => setFocus(!focus)}
          boxes={boxes}
          localStore={localStore}
          offline={offline}
          account={account}
          onControls={(c) => {
            controls.current = c;
          }}
          autoReply={query.get('reply') === '1'}
          onLoaded={nameTab}
          archiveTo={archiveTo}
          marks={currentRow?.row ?? null}
          quickStepButtons={(quickSteps.data ?? []).map((q) => ({ id: q.id, name: q.name, icon: q.icon, run: () => runStep(q, currentRow ? [targetOf(currentRow)] : []) }))}
          stateMenu={() => menuSections(currentRow ? [targetOf(currentRow)] : current ? [{ row: { id: Number(current.uid) || 0, subject: tabs.find((t) => t.key === currentKey)?.subject ?? '', from_name: '', from_email: '', preview: '', is_read: true, is_starred: false, has_attachment: false, created_at: '' }, mailbox: current.mailbox, folder: current.folder }] : [])}
        />
      ) : null}
    </ReadingPane>
  );

  const main = searching !== null ? (
    <SearchView
      initial={searching}
      boxes={boxes}
      current={place.box}
      onClose={() => setSearching(null)}
      onOpen={(m) => {
        setSearching(null);
        openRef({ uid: String(m.id), folder: m.folder_slug ?? 'inbox', mailbox: m.mailbox ? String(m.mailbox.id) : effectiveBox });
      }}
    />
  ) : focus && current ? (
    <div className="flex min-w-0 flex-1 flex-col">
      {reader}
      <WaitingPanel pending={mailPending} />
    </div>
  ) : pane === 'bottom' ? (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-[42%] min-h-[180px] shrink-0 border-b border-line">{listEl}</div>
      <div className="flex min-h-0 flex-1 flex-col">
        {reader}
        <WaitingPanel pending={mailPending} />
      </div>
    </div>
  ) : pane === 'hidden' ? (
    current ? (
      <div className="flex min-w-0 flex-1 flex-col">
        {reader}
        <WaitingPanel pending={mailPending} />
      </div>
    ) : (
      <div className="flex min-w-0 flex-1 flex-col">
        {listEl}
        <WaitingPanel pending={mailPending} />
      </div>
    )
  ) : (
    <>
      {listEl}
      <div className="flex min-w-0 flex-1 flex-col">
        {reader}
        <WaitingPanel pending={mailPending} />
      </div>
    </>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        {!focus ? (
          <SidePanel id="mail" label="the folders">
            <MailSidebar
              boxes={boxes}
              loading={mailboxes.isLoading}
              counts={counts.data ?? null}
              allCounts={allCounts.data ?? null}
              local={{ drafts: localDrafts.data?.length ?? 0, outbox: sending.length }}
              place={place}
              showLabels={localStore}
              active={active}
              summary={summary}
              accounts={shared.status?.accounts ?? []}
              running={running}
              syncingAll={shared.all}
              onSyncAll={syncAll}
              onSyncAccount={syncAccount}
              onExport={(b, slug, label) => setExporting({ mailbox: String(b.id), folder: slug, name: label })}
              offline={networkOffline}
              pending={mailPending.length}
              cacheDays={cacheDays}
              onCompose={() => openCompose({ mode: 'new' })}
              onSearch={() => setSearching(search)}
              onAddMailbox={() => setAdding(true)}
              onPick={pick}
              onSettings={() => navigate('/settings/mail')}
              favorites={globalPrefs.favorites ?? []}
              onFavorites={(next) => setGlobalPrefs({ favorites: next })}
            />
          </SidePanel>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          {compose ? (
            <div role="tablist" aria-label="Mail and the message you are writing" className="flex h-10 shrink-0 items-end gap-1 border-b border-line bg-subtle px-2 pt-1.5">
              <button type="button" role="tab" aria-selected={!compose.shown} onClick={() => setCompose({ ...compose, shown: false })} className={cx('flex h-full max-w-[220px] items-center rounded-t-[8px] border border-b-0 px-3 text-[12.5px]', !compose.shown ? 'border-line bg-surface font-bold text-ink' : 'border-transparent text-ink-2 hover:bg-surface/60')}>
                <span className="truncate">{title}</span>
              </button>
              <div role="tab" aria-selected={compose.shown} tabIndex={0} onClick={() => setCompose({ ...compose, shown: true })} onKeyDown={(e) => (e.key === 'Enter' ? setCompose({ ...compose, shown: true }) : undefined)} className={cx('flex h-full max-w-[260px] cursor-default items-center gap-1.5 rounded-t-[8px] border border-b-0 px-3 text-[12.5px]', compose.shown ? 'border-line bg-surface font-bold text-ink' : 'border-transparent text-ink-2 hover:bg-surface/60')}>
                <Icon name="pen" size={13} />
                <span className="truncate">{compose.seed.subject || (compose.seed.mode === 'new' ? text('New email') : text('Reply'))}</span>
              </div>
            </div>
          ) : null}
          {prefsLoaded && boxes.length > 0 && !globalPrefs.firstRun ? <FirstRun onPrefs={(patch) => setGlobalPrefs(patch)} /> : null}
          {globalPrefs.firstRun === 'outlook' ? <FirstRunOffers onImport={() => navigate('/settings/mail?tab=import')} onSignatures={() => navigate('/settings/mail?tab=signatures')} onDone={() => setGlobalPrefs({ firstRun: 'done' })} /> : null}
          {away ? (
            <div role="status" className="flex shrink-0 items-center gap-3 border-b border-line bg-warning-bg px-4 py-2 text-[13px] text-warning">
              <Icon name="bell-off" size={15} />
              <span className="min-w-0 flex-1">{rules.data?.vacation.end_date ? text('Automatic replies are on until {day}.', { day: dayWords(rules.data.vacation.end_date, { weekday: true }) }) : text('Automatic replies are on.')}</span>
              <Button size="sm" onClick={() => void turnOffAway()}>
                {text('Turn off')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => navigate('/settings/mail?tab=rules')}>
                {text('Change')}
              </Button>
            </div>
          ) : null}
          <CatchUp enabled={active && boxes.length > 0 && globalPrefs.catchUp !== false && !networkOffline} rows={folder === 'inbox' ? decorated : []} vips={(vips.data ?? []).map((v) => v.address)} states={states.data} onOpen={openRef} />
          <div className="flex min-h-0 flex-1">
            {compose?.shown ? (
              <Compose key={compose.n} seed={compose.seed} boxes={boxes} defaultBox={current?.mailbox ?? effectiveBox ?? (defaultBox ? String(defaultBox.id) : null)} offline={offline} onClose={() => setCompose(null)} onReopen={openCompose} />
            ) : (
              main
            )}
            {globalPrefs.todoPane && !focus ? (
              <TodoPane canCalendar={canOpen('calendar')} canTasks={canOpen('tasks')} onClose={() => setGlobalPrefs({ todoPane: false })} onOpenFlag={(f) => openRef({ uid: f.uid, folder: f.folder, mailbox: f.mailbox ? String(f.mailbox) : null })} onDropMail={(k, to) => void dropMail(k, to)} />
            ) : !focus ? (
              <button type="button" aria-label={text('Open My Day')} title={text('My Day: events, flagged mail and tasks')} onClick={() => setGlobalPrefs({ todoPane: true })} className="flex w-7 shrink-0 flex-col items-center gap-2 border-l border-line bg-surface pt-3 text-ink-3 hover:bg-subtle hover:text-ink">
                <Icon name="panel-right-open" size={15} />
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <StatusBar summary={summary} sync={shared.status} waiting={mailPending.length} zoom={prefs.zoom ?? 100} localBytes={localBytes.data ?? null} items={virtualOutbox || folder === 'outbox' ? null : (firstPage?.data.total ?? null)} notice={brokenRules ? { text: brokenRules === 1 ? text('1 rule was switched off') : text('{n} rules were switched off', { n: brokenRules }), onClick: () => navigate('/settings/mail?tab=rules') } : null} unread={allRole === 'inbox' ? unifiedUnread : null} onOpenSync={() => navigate('/settings/mail?tab=accounts')} />
      {outgoing.length ? (
        <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-14 left-1/2 z-40 flex -translate-x-1/2 flex-col gap-2">
          {outgoing.map((o) => (
            <div key={o.id} className="pointer-events-auto flex items-center gap-3 rounded-[10px] bg-navy px-4 py-2.5 text-[13.5px] text-white shadow-lg">
              <SendingLabel subject={o.subject} at={o.at} label={o.label} />
              <button type="button" onClick={() => undoSend(o.id)} className="rounded-[6px] bg-primary px-3 py-1 text-[13px] font-bold text-[var(--ws-on-primary)] hover:bg-primary-hover">
                {text('Undo')}
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {adding ? <AddMailbox onClose={() => setAdding(false)} /> : null}
      {sheet ? <ShortcutSheet prefs={prefs} onPrefs={setPrefs} onClose={() => setSheet(false)} /> : null}
      {gotoOpen ? <GoToFolder boxes={boxes} onPick={pick} onClose={() => setGotoOpen(false)} /> : null}
      {ignoring ? (
        <IgnoreDialog
          subject={ignoring.target.row.subject}
          count={Math.max(1, ignoring.here.length)}
          onClose={() => setIgnoring(null)}
          onConfirm={async () => {
            try {
              const r = await ignoreConversation(ignoring.key, ignoring.target.row.subject, ignoring.target.mailbox, ignoring.here.length ? ignoring.here : [ignoring.target]);
              setIgnoring(null);
              setSelection(new Set());
              void qc.invalidateQueries({ queryKey: ['mail'] });
              toast('success', r.where === 'server' ? text('Conversation ignored. Later messages go to Deleted Items on every device.') : text('Conversation ignored. This mailbox cannot keep the rule on its server, so this computer moves later messages while WorkSuite runs.'));
            } catch (e) {
              toast('error', errorMessage(e));
            }
          }}
        />
      ) : null}
      {ruleFor ? (
        <CreateRule
          row={ruleFor}
          onClose={() => setRuleFor(null)}
          onSave={(rule) => {
            setRuleFor(null);
            const all = [...(rules.data?.filters ?? []), rule.run_location === 'client' ? { ...rule, device_id: deviceId() } : rule];
            void apiPut('/api/mail/rules/filters', { filters: all, ...(effectiveBox ? { mailbox: effectiveBox } : {}) })
              .then(() => {
                void qc.invalidateQueries({ queryKey: ['mail', 'rules'] });
                toast('success', text('Rule added.'));
              })
              .catch((e) => toast('error', errorMessage(e)));
          }}
        />
      ) : null}
      {asking ? (
        <QuickStepAsk
          step={asking.step}
          mailbox={asking.targets[0]?.mailbox ?? null}
          onCancel={() => setAsking(null)}
          onAnswer={(values) => {
            const { step, targets } = asking;
            setAsking(null);
            void saveAnswers(step, values).then(() => qc.invalidateQueries({ queryKey: ['mail', 'quick-steps'] })).catch(() => undefined);
            runStep({ ...step, actions: step.actions.map((a) => (a.ask ? { ...a, ask: false, ...(a.type === 'move' || a.type === 'copy' ? { folder: values.folder } : { to: values.to }) } : a)) }, targets);
          }}
        />
      ) : null}
      {rowMenu ? (
        <ContextMenu
          x={rowMenu.x}
          y={rowMenu.y}
          label={text('Message actions')}
          sections={menuSections(selectedTargets(rowMenu.r))}
          onClose={() => setRowMenu(null)}
        />
      ) : null}
      {custom?.what === 'categories' ? <CategoriesDialog cats={cats.data ?? []} onClose={() => setCustom(null)} /> : null}
      {exporting ? <ExportDialog mailbox={exporting.mailbox} folder={exporting.folder} folderName={exporting.name} onClose={() => setExporting(null)} /> : null}
      {custom?.what === 'sweep' && custom.targets[0]?.mailbox ? <SweepDialog mailbox={custom.targets[0].mailbox} folder={custom.targets[0].folder} sender={custom.targets[0].row.from_email} name={custom.targets[0].row.from_name} onClose={() => setCustom(null)} /> : null}
      {custom && (custom.what === 'snooze' || custom.what === 'flag') ? (
        <DatesDialog
          kind={custom.what}
          onClose={() => setCustom(null)}
          onSave={(v) => {
            if (custom.what === 'snooze' && v.at) void stateActs.snooze(custom.targets, v.at);
            if (custom.what === 'flag') void stateActs.flag(custom.targets, { start_at: v.start_at ?? null, due_at: v.due_at ?? null, reminder_at: v.reminder_at ?? null });
            setCustom(null);
          }}
        />
      ) : null}
      {archiveAsk ? (
        <ArchivePicker
          box={archiveAsk.box}
          onPick={(slug, name) => {
            archiveAsk.resolve({ slug, name });
            setArchiveAsk(null);
            void qc.invalidateQueries({ queryKey: ['mail', 'all'] });
          }}
          onCancel={() => {
            archiveAsk.resolve(null);
            setArchiveAsk(null);
          }}
        />
      ) : null}
    </div>
  );
}

const ADDRESS = /^[^\s@<>,;]+@[^\s@<>,;]+$/;

/**
 * A shared mailbox's row in the queue (D06): its status tab, and Assigned to
 * me, Unassigned or Snoozed. A snoozed conversation stays out of the queue
 * until it wakes — except under Snoozed, which lists exactly those.
 */
export function teamRowShown(m: MessageRow, tab: 'open' | 'answered' | 'closed' | 'all', who: 'all' | 'mine' | 'nobody' | 'snoozed', me: number, now = Date.now()): boolean {
  const until = m.team?.snoozed_until ?? null;
  const snoozed = !!until && Date.parse(`${until.replace(' ', 'T')}${/[zZ]|[+-]\d\d:?\d\d$/.test(until) ? '' : 'Z'}`) > now;
  if (who === 'snoozed') return snoozed;
  if (snoozed && tab !== 'all') return false;
  if (tab !== 'all' && (m.team?.status ?? 'open') !== tab) return false;
  if (who === 'mine') return m.team?.assignee_id === me;
  if (who === 'nobody') return !m.team?.assignee_id;
  return true;
}

/**
 * A new message from the route's query (`?compose=1&to=…&cc=…&subject=…&body=…`):
 * Contacts' Email, and mailto: links from other apps. Only addresses that are
 * addresses are kept; the body is prefilled text the person edits and sends.
 */
export function composeSeedFromQuery(query: URLSearchParams): ComposeSeed {
  const list = (key: string) =>
    (query.get(key) ?? '')
      .split(/[,;]/)
      .map((a) => a.trim())
      .filter((a) => ADDRESS.test(a))
      .join(', ');
  const to = list('to');
  const cc = list('cc');
  const bcc = list('bcc');
  const subject = (query.get('subject') ?? '').replace(/[\r\n]+/g, ' ').slice(0, 500);
  const body = (query.get('body') ?? '').slice(0, 20_000);
  // A reply or forward to a message opened from a file (DMO-DAT-04): quoted, and threaded when it had a Message-ID.
  const quote = (query.get('quote') ?? '').slice(0, 20_000);
  const asked = query.get('mode');
  const mode: ComposeSeed['mode'] = asked === 'reply' || asked === 'reply_all' || asked === 'forward' ? asked : 'new';
  const irt = query.get('irt') ?? '';
  return { mode, ...(to ? { to } : {}), ...(cc ? { cc } : {}), ...(bcc ? { bcc } : {}), ...(subject ? { subject } : {}), ...(body ? { body } : {}), ...(quote ? { quote } : {}), ...(/^<[^<>\s]+>$/.test(irt) ? { inReplyTo: irt } : {}) };
}

/** "Sending “Re: Payroll export” in 8 s", counting down. */
function SendingLabel({ subject, at, label }: { subject: string; at: number; label?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const n = Math.max(0, Math.ceil((at - now) / 1000));
  return <span>{label ? text('{what} in {n} s', { what: label, n }) : text('Sending “{subject}” in {n} s', { subject, n })}</span>;
}
