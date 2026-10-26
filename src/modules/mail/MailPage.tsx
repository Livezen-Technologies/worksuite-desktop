import { useInfiniteQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGetMeta, apiPost, apiPut, setDefaultMailbox, withMailbox } from '../../core/api';
import { useResizableWidth } from '../../components/ResizeDivider';
import { canOpen } from '../../core/access';
import { dayWords, parseTs, todayInZone } from '../../core/time';
import { app } from '../../core/app-state';
import { call, errorMessage, isMac } from '../../core/bridge';
import { text } from '../../core/i18n';
import type { MenuSection } from '../../components/Menu';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { searchFold } from '@shared/localization';
import { ticketRoute } from '@shared/support';
import { Icon } from '../../components/Icon';
import { SidePanel } from '../../components/SidePanel';
import { Button, Empty, cx } from '../../components/ui';
import { refreshWords, useListRefresh } from '../../components/PullToRefresh';
import { useListSelection, type PickHow } from '../../components/useListSelection';
import { useVips } from './PeopleCard';
import { TodoPane, nextSlot } from './TodoPane';
import type { ModuleProps } from '../registry';
import { AddMailbox } from './AddMailbox';
import { PREFETCH_AHEAD, messageKey, prefetchMessages, useForgetRemovedMailboxes, useLocalFirst, useServerStateOnRefusal } from './localFirst';
import { AccountAttention } from './AccountAttention';
import { MailBoundary } from './MailBoundary';
import { safeListData } from './safety';
import { diagnosticsRoute, noteAccount } from '../../core/screen-errors';
import { messageAction, moveMessage, useTemplates, useLocalStore, useMailPrefs, useMailboxes, usePendingMail, useViewCounts } from './api';
import { registerCommand, runCommand } from '../../core/commands';
import { MAIL_COMMANDS, bindings, commandFor, isPlain, keyLabel, keyOf, type MailCommandId } from './keymap';
import { GoToFolder, ShortcutSheet } from './Shortcuts';
import { allAccountsPage, allFolderLabel, isAllRole, queuedSends, roleSlug, useAllCounts, useLocalDrafts } from './allAccounts';
import { ArchivePicker } from './ArchivePicker';
import { Compose } from './Compose';
import { LocalDraftRows, OutboxView } from './Outbox';
import { includedIds, runSync, syncSummary, useSharedSync } from './sync';
import { CategoriesDialog, ContextMenu, DatesDialog, stateSections, useStateActions, type Target } from './MessageMenus';
import { SelectionPane } from './SelectionPane';
import { SweepDialog } from './SweepDialog';
import { FirstRun, FirstRunOffers } from './FirstRun';
import { classifyFocus, flagChoices, otherBanner, pinnedFirst, stateItem, stateKey, useCategories, useFocusContext, useMessageStates, withStates } from './states';
import { LinkRecordDialog } from './recordLinks';
import { MessageList, type ListRow, type RowAction } from './MessageList';
import { MessageView, SourceDialog, windowRoute, type ViewControls } from './MessageView';
import { LIST_ACTIONS, MoveDialog, SelectionBar, actionLabel, hoverIds, listMenuSections, placeOf, useListActions, type ListActionId } from './listActions';
import { TaskFromMessage, messageLink } from './MessageTask';
import { ConvertEmailSheet } from '../support/ConvertEmailSheet';
import { useConversionOffer } from '../support/ConvertSheet';
import { emailToConvert, markTicket } from './ticketLinks';
import { applyFilters, filtersFor, serverFilters, folderName, folderViewPatch, groupRows, queueKey, queuedByMessage, rowMailbox, smartView, sortRows, step, withFolderView, type ChipId } from './model';
import { sendAfterUndoWindow, useOutgoing, undoSend } from './outgoing';
import { needsAsking, removesMessages, runQuickStep, saveAnswers, useQuickSteps, type QuickStep } from './quickSteps';
import { QuickStepAsk } from './QuickStepsUi';
import { alertFor, chime, deviceId, freshRows, markSeen, myRules, ruleTakes } from './clientRules';
import { CreateRule, useRules } from './MailRules';
import { CatchUp } from './CatchUp';
import { CleanupDialog, IgnoreDialog, conversationKeyOf, ignoreConversation, ignoredKeys, redundantInThread, stopIgnoring } from './Conversations';
import { FilterChips } from './FilterChips';
import { ReadingPane, afterClose, loadTabs, saveTabs, withTab, type OpenTab } from './ReadingPane';
import { ScheduledList } from './Scheduled';
import { SearchView } from './SearchView';
import { MailFileViewer } from './FileViewer';
import { ExportDialog } from './DataFiles';
import { MailSidebar, unreadOf, type Place } from './Sidebar';
import { fetchProtection, protectionKeys, useQuarantineCount } from './protection/api';
import { QUARANTINE_ROUTE, QuarantinePage } from './protection/QuarantinePage';
import { attachmentGate } from './protection/verdicts';
import { StatusBar, WaitingPanel } from './StatusBar';
import type { AllRole, ComposeSeed, Label, MailPrefs, Mailbox, MessageDetail, MessagePage, MessageRef, MessageRow } from './types';
import { FIRST_PAGE, LIST_PAGE, emptyReason, needsFill, nextListParam, readFolder, seedListFromLocal, showFocusedHint, syncingLine, type ListPageParam } from './listLoading';


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
  const { query, path } = useTab();
  // An .eml or .msg opened from the system or Import (ENH-MAIL-03 DMO-DAT-04): read-only, in a tab of its own.
  const file = query.get('file');
  // Mail › Quarantine (ENH-MAIL-04 D20): what was held for the person, across every account.
  if (path[1] === 'quarantine') return <QuarantinePage />;
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
  const msgFolder = query.get('mf') ?? readFolder({}, place.folder);
  const status = useStore(app, (s) => s.status);
  const cacheDays = useStore(app, (s) => s.prefs?.mailCacheDays ?? 30);
  const networkOffline = status?.network === 'OFFLINE';
  // Mail › Quarantine in the rail (ENH-MAIL-04 D20): how many are held, or no entry where the server holds none.
  const quarantineHeld = useQuarantineCount(active);

  const [chips, setChips] = useState<ChipId[]>([]);
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState<string | null>(null);
  const [tabs, setTabs] = useState<OpenTab[]>(loadTabs);
  useEffect(() => saveTabs(tabs), [tabs]);
  const [compose, setCompose] = useState<{ seed: ComposeSeed; shown: boolean; n: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const [focus, setFocus] = useState(false);
  const [team, setTeam] = useState<'open' | 'answered' | 'closed' | 'all'>('open');
  const [teamWho, setTeamWho] = useState<'all' | 'mine' | 'nobody' | 'snoozed'>('all');
  const controls = useRef<ViewControls | null>(null);
  const [composeRoute, setComposeRoute] = useState<string | null>(null);
  const openCompose = (seed: ComposeSeed) => setCompose((c) => ({ seed, shown: true, n: (c?.n ?? 0) + 1 }));
  const templates = useTemplates(true);
  const templateItems = (templates.data?.templates ?? []).map((t) => ({ id: `t${t.id}`, label: t.name, icon: 'file-text', onSelect: () => openCompose({ mode: 'new', templateId: t.id }) }));
  const newMenu: MenuSection[] = [
    {
      id: 'mail',
      items: [
        { id: 'new', label: text('New email'), icon: 'compose', shortcut: 'N', onSelect: () => openCompose({ mode: 'new' }) },
        templateItems.length
          ? { id: 'template', label: text('New email from template…'), icon: 'file-text', submenu: [{ id: 'templates', items: templateItems }] }
          : { id: 'template', label: text('New email from template…'), icon: 'file-text', disabled: true, reason: templates.isLoading ? text('Loading templates…') : text('No templates yet: add them in Settings › Mail.') },
        { id: 'window', label: text('New email in a new window'), icon: 'app-window', onSelect: () => openInWindow('/mail?compose=1', text('New email')) },
      ],
    },
    {
      id: 'other',
      items: [
        { id: 'event', label: text('New event invite'), icon: 'calendar-plus', onSelect: () => navigate('/calendar?new=1') },
        { id: 'contact', label: text('New contact'), icon: 'user-plus', onSelect: () => navigate('/contacts?new=1') },
      ],
    },
  ];
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
  // Only the server's own list (not one read from this computer) says a mailbox has gone.
  useForgetRemovedMailboxes(mailboxes.isSuccess && !mailboxes.isPlaceholderData && mailboxes.dataUpdatedAt > 0 ? (mailboxes.data?.mailboxes ?? []).map((m) => m.id) : null);
  const defaultBox = boxes.find((m) => m.is_default) ?? boxes[0];
  useEffect(() => setDefaultMailbox(defaultBox ? String(defaultBox.id) : null), [defaultBox]);
  const localStore = mailboxes.isSuccess && boxes.length === 0;
  const counts = useViewCounts(active && (mailboxes.isSuccess || mailboxes.isError));
  const shared = useSharedSync(active && boxes.length > 0);
  const allCounts = useAllCounts(active && boxes.length > 1);
  const pending = usePendingMail();
  useServerStateOnRefusal(pending.data);
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

  const listKey = ['mail', 'messages', unified ? 'unified' : effectiveBox, folder, serverFilters(filters).join(','), threaded];
  // The latest 100 at once, newest first, and 100 more at a time (worksuite-desktop#208): by the server's
  // cursor where it gives one (a mirrored folder; All Accounts' place in each account), else by page.
  const listQuery = ({ page, cursor }: ListPageParam) =>
    unified
      ? { unified: 1, folder, page, per_page: LIST_PAGE, ...(cursor ? { cursor } : {}), ...(serverFilters(filters).length ? { filters: serverFilters(filters).join(',') } : {}) }
      : place.label !== null
        ? { folder, page, per_page: LIST_PAGE }
        : withMailbox({ folder, page, per_page: LIST_PAGE, ...(cursor ? { cursor } : {}), ...(serverFilters(filters).length ? { filters: serverFilters(filters).join(',') } : {}), ...(threaded ? { threaded: 1 } : {}), sort: prefs.sort ?? 'date', dir: prefs.dir ?? 'desc' }, effectiveBox);
  const list = useInfiniteQuery({
    queryKey: listKey,
    initialPageParam: FIRST_PAGE,
    queryFn: ({ pageParam, signal }) => {
      const combined = { page: pageParam.page, per_page: LIST_PAGE, ...(pageParam.cursor ? { cursor: pageParam.cursor } : {}), ...(serverFilters(filters).length ? { filters: serverFilters(filters).join(',') } : {}) };
      const byName = () => apiGetMeta<MessagePage>('/api/mail/messages', listQuery(pageParam), signal);
      return allRole ? allAccountsPage(allRole, combined, signal, byName) : byName();
    },
    getNextPageParam: nextListParam,
    enabled: (mailboxes.isSuccess || mailboxes.isError) && folder !== 'outbox',
    // Each page and row read on its own (#338): one bad answer never takes the list — or Mail — down.
    select: safeListData,
  });
  // The list from this computer at once — every saved page of this folder, the latest 100 — then the server's
  // (worksuite-desktop#162, #208). All Accounts reads every account's saved pages for the role.
  const localWhere = folder === 'outbox' || place.label !== null || view || (!unified && !effectiveBox) ? null : { mailbox: unified ? null : effectiveBox, folder, role: allRole };
  const localWhereKey = localWhere ? JSON.stringify(localWhere) : null;
  const listKeyId = JSON.stringify(listKey);
  useEffect(() => {
    if (!localWhereKey || filters.length || threaded) return;
    void seedListFromLocal(qc, JSON.parse(listKeyId) as QueryKey, JSON.parse(localWhereKey) as { mailbox: string | null; folder: string; role: AllRole | null });
    // The key and the place decide when to read again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, listKeyId, localWhereKey]);
  useLocalFirst<MessagePage>(listKey, folder !== 'outbox' && !allRole && (unified || place.label !== null || !!effectiveBox) ? { path: '/api/mail/messages', query: listQuery(FIRST_PAGE) } : null, (r) => ({ pages: [r], pageParams: [FIRST_PAGE] }));
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
    // Any view, not only a combined one: an account with no Archive folder is asked the same once (worksuite-desktop#161).
    if (!ref.mailbox) return 'default';
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
  const rowKey = (m: MessageRow) => queueKey(rowMailbox(m, effectiveBox), readFolder(m, folder), m.id);
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
  // Fewer than 100 to show because this computer narrowed what came — the Focused tab, a filter the server could not
  // apply, the instant search, a team queue: more pages are asked for until there are 100 or the folder ends (#208).
  const narrowed = focusOn || isTeam || !!search.trim() || !!firstPage?.data.quick_failed || filters.some((f) => !(firstPage?.data.quick ?? serverFilters(filters)).includes(f));
  const pagesLoaded = list.data?.pages.length ?? 0;
  const fill = active && needsFill({ shown: rows.length, hasMore: !!list.hasNextPage, fetching: list.isFetching, pages: pagesLoaded, narrowed });
  const fetchNext = list.fetchNextPage;
  useEffect(() => {
    // Never restarts a page already on its way.
    if (fill) void fetchNext({ cancelRefetch: false });
  }, [fill, pagesLoaded, fetchNext]);
  // Focused Inbox: how the loaded mail divides, for the hint when Focused holds almost nothing (#208).
  // Check for new mail (worksuite-desktop#236): pull down at the top, ⌘R/F5, or "Checked…". The folder on screen —
  // or, in All Accounts, each account's own folder for the role — is synced first, on the slot kept for what a person
  // asks for (#228); then the list and the counts are asked again.
  const checkTargets = (): Array<{ id: number; folder: string }> => {
    if (effectiveBox && !unified && place.label === null) return [{ id: Number(effectiveBox), folder }];
    const known = allRole ? (allCounts.data?.roles[allRole]?.mailboxes ?? []) : [];
    return includedIds(shared.status, boxes).map((id) => ({ id, folder: known.find((m) => m.id === id)?.folder ?? (allRole ? roleSlug(allRole) : folder) }));
  };
  const checkMail = async () => {
    if (networkOffline) throw new Error(text("You're offline: mail is checked when you reconnect"));
    const targets = checkTargets();
    const r = await runSync(
      targets.map((t) => t.id),
      { folders: Object.fromEntries(targets.map((t) => [t.id, t.folder])), onDone: () => void shared.refetch() },
    );
    await qc.invalidateQueries({ queryKey: listKey });
    void qc.invalidateQueries({ queryKey: ['mail'], predicate: (q) => q.queryKey[1] !== 'messages' });
    if (r.failed.length) throw new MailCheckError(r.failed.map((id) => boxes.find((b) => b.id === id)?.email ?? String(id)));
  };
  // When the accounts on screen last synced, by anyone: "Checked 2 min ago".
  const shownIds = new Set(checkTargets().map((t) => t.id));
  const syncedAt = (shared.status?.accounts ?? []).filter((a) => shownIds.has(a.mailbox) && a.last_ok_at).map((a) => parseTs(a.last_ok_at!).getTime()).filter((t) => Number.isFinite(t));
  const lastSynced = syncedAt.length ? Math.max(...syncedAt) : null;
  const refresh = useListRefresh({
    list: 'mail',
    check: checkMail,
    items: flat,
    view: JSON.stringify([listKey, search.trim(), chips, focusOn && focusTab, isTeam && `${team}:${teamWho}`]),
    ready: list.isSuccess && !list.isPlaceholderData,
    words: refreshWords('mail'),
    errorText: (e) => (e instanceof MailCheckError ? (e.who.length === 1 ? text('Couldn’t check {who}', { who: e.who[0]! }) : text('Couldn’t check {n} accounts', { n: e.who.length })) : errorMessage(e)),
    lastChecked: lastSynced,
  });
  const focusSplit = focusOn ? decorated.reduce((n, m) => (classifyFocus(m, focusCtx.data).focus === 'focused' ? { ...n, focused: n.focused + 1 } : { ...n, other: n.other + 1 }), { focused: 0, other: 0 }) : null;

  // Several selected (Ctrl/Shift-click, Ctrl+A): every action applies to each, in its own account (DMO-INB-15).
  // The list's shared gestures (#290): a range runs from the last row ticked, else from the open message; Esc clears.
  const sel = useListSelection(flat.map((r) => r.key));
  const { selected: selection, setSelected: setSelection } = sel;
  const selectRow = (r: ListRow, how: PickHow) => sel.pick(r.key, how, currentKey);
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
  const targetOf = (r: ListRow): Target => ({ row: r.row, mailbox: rowMailbox(r.row, effectiveBox), folder: readFolder(r.row, folder) });
  const selectedTargets = (fallback?: ListRow): Target[] => {
    const picked = flat.filter((r) => selection.has(r.key));
    return (picked.length ? picked : fallback ? [fallback] : []).map(targetOf);
  };
  const [rowMenu, setRowMenu] = useState<{ targets: Target[]; x: number; y: number } | null>(null);
  // The list's actions (worksuite-desktop#161): hover buttons, the right-click menu, the selection's toolbar and the keys.
  const listActs = useListActions({
    keyOf: (t) => queueKey(t.mailbox, t.folder, t.row.id),
    setHidden,
    archiveTo,
    onRemoved: (keys) => {
      setSelection((s) => (keys.some((k) => s.has(k)) ? new Set([...s].filter((k) => !keys.includes(k))) : s));
      if (currentKey && keys.includes(currentKey)) goneFrom(keys);
    },
  });
  const [moving, setMoving] = useState<Target[] | null>(null);
  const [snoozeAt, setSnoozeAt] = useState<{ targets: Target[]; x: number; y: number } | null>(null);
  const [taskFor, setTaskFor] = useState<Target | null>(null);
  const [linkFor, setLinkFor] = useState<Target[] | null>(null);
  // Link to tender, customer or deal: offered to people who can open Tenders or the CRM; the server says which kinds.
  const canLinkRecords = canOpen('tenders') || canOpen('crm');
  // Convert to ticket (#298): for somebody with Support, where the server converts email and lets them.
  const [ticketFor, setTicketFor] = useState<Target | null>(null);
  const supportApp = canOpen('support');
  const ticketOffer = useConversionOffer('email', supportApp);
  const [sourceOf, setSourceOf] = useState<MessageRef | null>(null);
  const keyFor = (command: string) => {
    const k = keyMap[command]?.[0];
    return k ? keyLabel(k, isMac) : undefined;
  };
  const selectFolder = sel.selectAll;
  const rowActions = (r: ListRow): RowAction[] => {
    const t = targetOf(r);
    return hoverIds(t).map((id) =>
      id === 'snooze'
        ? {
            id,
            label: text('Snooze'),
            icon: 'snooze',
            onSelect: (el: HTMLElement) => {
              const b = el.getBoundingClientRect();
              setSnoozeAt({ targets: [t], x: b.left, y: b.bottom });
            },
          }
        : { id, label: actionLabel(id), icon: LIST_ACTIONS[id].icon, pressed: id === 'unstar', onSelect: () => void listActs.run(id, [t]) },
    );
  };
  const [custom, setCustom] = useState<{ what: 'snooze' | 'flag' | 'categories' | 'sweep'; targets: Target[] } | null>(null);
  // Export a folder (ENH-MAIL-03 DMO-DAT-03).
  const [exporting, setExporting] = useState<{ mailbox: string; folder: string; name: string } | null>(null);

  // The open message: the URL names it; its tab joins the strip.
  const current: MessageRef | null = msg ? { uid: msg, folder: msgFolder, mailbox: msgBox ?? effectiveBox, mid: query.get('mid'), midHash: query.get('mih'), uidvalidity: query.get('uv') ? Number(query.get('uv')) : null } : null;
  const currentKey = current ? queueKey(current.mailbox, current.folder, current.uid) : null;
  // The account on screen, for the log line of an error Mail cannot draw past (#338).
  const accountOnScreen = current?.mailbox ?? effectiveBox ?? null;
  useEffect(() => noteAccount('mail', accountOnScreen), [accountOnScreen]);
  const known = current ? flat.find((r) => r.key === currentKey)?.row : undefined;
  if (current && currentKey && !tabs.some((t) => t.key === currentKey)) {
    setTabs(withTab(tabs, { key: currentKey, ref: current, subject: known?.subject ?? '', from: known ? known.from_name || known.from_email : '' }, currentKey));
  } else if (known && currentKey) {
    const t = tabs.find((x) => x.key === currentKey);
    if (t && !t.subject && known.subject) setTabs(withTab(tabs, { ...t, subject: known.subject, from: known.from_name || known.from_email }, currentKey));
  }

  // New-mail alerts (ENH-MAIL-05 §3.1): where Mail is, so mail arriving in the folder in front is the row's "New"
  // and not a card; and a message opened here has had its alert (MNA-EVT-06).
  const viewBox = place.view || place.label !== null ? null : /^(unified|\d{1,12})$/.test(place.box) ? place.box : null;
  useEffect(() => {
    if (!active) return;
    void call('mailAlert:view', { module: 'mail', box: viewBox, folder: viewBox ? place.folder : null }).catch(() => undefined);
  }, [active, viewBox, place.folder]);
  const opened = current && /^\d{1,15}$/.test(current.uid) && current.mailbox && /^\d{1,12}$/.test(current.mailbox) ? JSON.stringify({ mailbox: Number(current.mailbox), folder: current.folder, uid: Number(current.uid) }) : null;
  useEffect(() => {
    if (opened) void call('mailAlert:clear', JSON.parse(opened) as { mailbox: number; folder: string; uid: number }).catch(() => undefined);
  }, [opened]);
  // Mail alerts paused on this computer (MNA-TRY-02): the footer says so, with Resume.
  const pausedLabel = status?.mailAlertsPaused ?? null;
  const alertsPaused = pausedLabel ? { label: pausedLabel, onResume: () => void call('mailAlert:pause', { mode: null }).catch((e) => toast('error', errorMessage(e))) } : null;

  const placeQuery = (p: Partial<Place> = {}) => {
    const next = { ...place, ...p };
    const q = new URLSearchParams();
    if (next.box !== 'unified') q.set('box', next.box);
    if (next.view) q.set('view', next.view);
    if (next.folder !== 'inbox') q.set('folder', next.folder);
    if (next.label !== null) q.set('label', String(next.label));
    return q;
  };
  // A listed message's whole identity (#209): its own account and folder — never a view's name — with its
  // Message-ID and UIDVALIDITY, so the server can find it again when it has moved or been renumbered.
  const refOfRow = (m: MessageRow): MessageRef => ({ uid: String(m.id), folder: readFolder(m, folder), mailbox: rowMailbox(m, effectiveBox), mid: m.message_id ?? null, midHash: m.message_id_hash ?? null, uidvalidity: m.uidvalidity ?? null });
  const openRef = (ref: MessageRef, reply?: 'reply' | 'reply_all' | 'forward') => {
    const q = placeQuery();
    q.set('msg', ref.uid);
    if (ref.mid) q.set('mid', ref.mid);
    else if (ref.midHash) q.set('mih', ref.midHash);
    if (ref.uidvalidity) q.set('uv', String(ref.uidvalidity));
    if (reply) q.set('reply', reply === 'reply' ? '1' : reply === 'reply_all' ? 'all' : 'fwd');
    if (ref.mailbox) q.set('mbx', ref.mailbox);
    if (ref.folder !== place.folder) q.set('mf', ref.folder);
    go(`/mail?${q}`);
  };
  const openRow = (r: ListRow) => {
    setSearching(null);
    setCompose((c) => (c ? { ...c, shown: false } : c));
    const ref = refOfRow(r.row);
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
  // The next few messages are fetched ahead (unread stays unread), so moving down the list opens each at once (#162).
  const ahead = at >= 0 && !offline && active ? flat.slice(at + 1, at + 1 + PREFETCH_AHEAD).map((r) => refOfRow(r.row)) : [];
  const aheadKey = ahead.map((r) => `${r.mailbox ?? ''}:${r.folder}:${r.uid}`).join(',');
  useEffect(() => {
    if (!aheadKey) return;
    const t = setTimeout(() => prefetchMessages(qc, ahead), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the messages ahead are named by aheadKey
  }, [aheadKey, qc]);
  const move = (by: number) => {
    const i = step(flat, at, by);
    if (i >= 0 && flat[i]) openRow(flat[i]);
  };
  const star = async (r: ListRow) => {
    try {
      await messageAction(refOfRow(r.row), r.row.is_starred ? 'unstar' : 'star', r.row.subject);
      void qc.invalidateQueries({ queryKey: ['mail'] });
      void qc.invalidateQueries({ queryKey: ['offline'] });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  // After archive or delete: the next message in the list, as a mail app does.
  const gone = () => goneFrom(currentKey ? [currentKey] : []);
  const goneFrom = (keys: string[]) => {
    const next = flat.slice(at + 1).find((r) => !keys.includes(r.key)) ?? flat.slice(0, Math.max(at, 0)).reverse().find((r) => !keys.includes(r.key)) ?? null;
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
    // A row's selection checkbox is not a field: E, Delete and the rest still act on what is selected.
    const typing = !!t && typeof t.closest === 'function' && (!!t.closest('input:not([type=checkbox]), textarea, select, [contenteditable="true"]') || t.isContentEditable);
    const inLayer = !!t && typeof t.closest === 'function' && !!t.closest('[role="dialog"], [role="menu"]');
    if (key === 'Escape') {
      if (inLayer || typing) return;
      if (sel.escape(e)) return e.preventDefault();
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
    // Ctrl+A in the search box selects its text, not the list.
    if (typing && hit.id === 'selectAll') return;
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
      case 'checkMail':
        // Only where the list is: the Outbox, a search and an empty Mail have nothing to check this way.
        if (virtualOutbox || folder === 'outbox' || searching !== null || !boxes.length) return false;
        refresh.checkNow();
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
    // Archive, delete, junk, star and move: the list's actions, on the selection or the open message — with Undo (worksuite-desktop#161).
    const listTargets = many.length ? many : currentRow ? [targetOf(currentRow)] : [];
    const listAct = listTargets.length ? listCommand(id, listTargets, many.length > 0) : null;
    if (listAct === 'none') return false;
    if (listAct) {
      if (listAct === 'move') setMoving(listTargets);
      else void listActs.run(listAct, listTargets);
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
  // New mail, said aloud to a screen reader (DMO-ACC-02): only a rise in unread inbox mail, never the first count.
  const [heard, setHeard] = useState<{ last: number | null; say: string }>({ last: null, say: '' });
  if (active && heard.last !== unifiedUnread) setHeard({ last: unifiedUnread, say: heard.last !== null && unifiedUnread > heard.last ? text('{n} new message(s) in the inbox', { n: unifiedUnread - heard.last }) : heard.say });
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
  // The message list's width beside the reading pane, dragged by its edge and remembered on this computer (#304).
  const listSize = useResizableWidth('mail.list', { defaultWidth: 420, min: 300, max: () => Math.max(300, Math.min(760, window.innerWidth - 620)) });
  const mailPending = (pending.data ?? []).filter((m) => m.state !== 'DONE');
  const account = current?.mailbox ? (boxes.find((b) => String(b.id) === current.mailbox) ?? null) : null;

  const teamTabs = isTeam ? (
    <div className="mt-2">
      <div role="tablist" aria-label="Conversations" className="flex rounded-[10px] bg-subtle p-0.5">
        {(['open', 'answered', 'closed', 'all'] as const).map((s) => {
          const n = s === 'all' ? null : (list.data?.pages ?? []).flatMap((p) => p.data.messages).filter((m) => (m.team?.status ?? 'open') === s).length;
          return (
            <button key={s} type="button" role="tab" aria-selected={team === s} onClick={() => setTeam(s)} className={cx('flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[8px] px-1 text-[13px] font-semibold', team === s ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink')}>
              <span className="min-w-0 truncate">{s === 'open' ? text('Open') : s === 'answered' ? text('Pending') : s === 'closed' ? text('Done') : text('All')}</span>
              {n ? <span className="shrink-0 text-[12px] text-ink-3">{n}</span> : null}
            </button>
          );
        })}
      </div>
      {/* The same never-wrapping chip row as the quick filters (#428): what does not fit goes into More filters. */}
      <div className="mt-2 flex min-w-0">
        <FilterChips
          label={text('Assignment')}
          tone="ink"
          chips={[{ id: 'mine', label: text('Assigned to me') }, { id: 'nobody', label: text('Unassigned') }, { id: 'snoozed', label: text('Snoozed') }]}
          isOn={(id) => teamWho === id}
          onToggle={(id) => setTeamWho(teamWho === id ? 'all' : (id as 'mine' | 'nobody' | 'snoozed'))}
        />
      </div>
    </div>
  ) : null;

  // Why a short or empty list is so, in words (#208): headers still arriving, filters, or all caught up.
  const syncing = syncingLine(shared.status?.accounts, unified ? included.map((b) => b.id) : effectiveBox ? [effectiveBox] : null, firstPage?.data.total ?? null);
  const empty = emptyReason({ syncing, filtered: chips.length > 0, search: search.trim(), focusedTab: focusOn && focusTab === 'focused', otherCount: focusSplit?.other ?? 0 });
  const focusHint = focusOn && focusTab === 'focused' && focusSplit && showFocusedHint(focusSplit.focused, focusSplit.other, !list.isLoading && !fill)
    ? { onTurnOff: () => setPrefs({ focused: false }), onTeach: () => setFocusTab('other') }
    : null;
  const listInner = virtualOutbox ? (
    <OutboxView active={active} pending={pending.data ?? []} onEdit={openCompose} />
  ) : folder === 'outbox' ? (
      <ScheduledList active={active} />
    ) : (
      <MessageList
        resize={listSize}
        refresh={refresh}
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
        mailboxId={effectiveBox ? Number(effectiveBox) : null}
        boxes={boxes}
        offline={offline}
        offlineDays={cacheDays}
        refreshing={list.isFetching && !list.isLoading}
        onRefresh={() => {
          void qc.invalidateQueries({ queryKey: ['mail'] });
        }}
        hasMore={!!list.hasNextPage}
        loadingMore={list.isFetchingNextPage}
        onMore={() => void list.fetchNextPage({ cancelRefetch: false })}
        notice={notice ?? (flat.length > 0 ? syncing : null)}
        empty={empty}
        onClearFilters={chips.length ? () => setChips([]) : undefined}
        team={allRole === 'drafts' ? <LocalDraftRows drafts={localDrafts.data ?? []} onOpen={(d) => openCompose(d.seed)} /> : teamTabs}
        fill={pane === 'hidden' || pane === 'bottom'}
        focusTabs={focusOn ? { value: focusTab, onChange: setFocusTab, banner: otherBanner(decorated, focusCtx.data), unread: focusUnread, hint: focusHint } : null}
        onViewSettings={() => navigate('/settings/mail?tab=layout')}
        onRowMenu={(r, x, y) => {
          // A row outside the selection: the menu is for that row alone, as in other mail apps.
          const inSelection = selection.has(r.key);
          if (selection.size && !inSelection) setSelection(new Set());
          setRowMenu({ targets: inSelection ? selectedTargets() : [targetOf(r)], x, y });
        }}
        selection={selection}
        onSelect={selectRow}
        selectAll={{ state: sel.state, onToggle: sel.toggleAll }}
        rowActions={rowActions}
        toolbar={
          selection.size ? (
            <SelectionBar
              targets={selectedTargets()}
              run={(id, ts) => (id === 'move' ? setMoving(ts) : void listActs.run(id, ts))}
              more={(x, y) => setRowMenu({ targets: selectedTargets(), x, y })}
              onClear={sel.clear}
            />
          ) : null
        }
      />
    );
  // A list that cannot be drawn says so in its place (#338); the folders and the reading pane go on working.
  const listEl = (
    <MailBoundary part="list" className="max-w-[420px] border-r border-line" resetKey={listKeyId} account={effectiveBox} onRetry={() => void qc.resetQueries({ queryKey: listKey })} onDiagnostics={(ref) => navigate(diagnosticsRoute(ref))}>
      {listInner}
    </MailBoundary>
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
    await addToCalendar(t);
  };
  /** An event at the next free-ish slot with the message's text (My Day's drop, and the list's Add to calendar). */
  const addToCalendar = async ({ row }: Target) => {
    const slot = nextSlot();
    try {
      await apiPost('/api/calendar/events', {
        title: (row.subject || text('(no subject)')).slice(0, 250),
        description: `${text('From {sender} <{email}>', { sender: row.from_name || row.from_email, email: row.from_email })}\n\n${row.preview ?? ''}`.slice(0, 4000),
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
  /** Every attachment into the person's Files, server side (the reader's Save to Files, for all of them). */
  const saveAttachments = async (t: Target) => {
    try {
      const r = await apiGetMeta<MessageDetail>(`/api/mail/messages/${t.row.id}`, withMailbox({ folder: t.folder, peek: 1 }, t.mailbox));
      const listed = r.data.attachments ?? [];
      if (!listed.length) return void toast('info', text('This message has no attachments to save.'));
      // Only scanned files go to Files (ENH-MAIL-04 MPR-UX-02): blocked, unchecked and not-yet-scanned ones stay where they are.
      const gate = attachmentGate(await fetchProtection(refOfTarget(t)), listed, false);
      const all = gate ? listed.filter((a) => gate.get(a.ref)?.open) : listed;
      if (all.length < listed.length) toast('info', listed.length - all.length === 1 ? text('1 attachment was not saved: it is blocked or has not been checked for viruses yet.') : text('{n} attachments were not saved: they are blocked or have not been checked for viruses yet.', { n: listed.length - all.length }));
      if (!all.length) return;
      const box = t.mailbox ? { mailbox: t.mailbox } : {};
      const done = await Promise.allSettled(all.map((a) => apiPost(`/api/mail/messages/${t.row.id}/attachments/${encodeURIComponent(a.ref)}/save`, box, { folder: t.folder, mime: a.mime || 'application/octet-stream', ...box })));
      const saved = done.filter((d) => d.status === 'fulfilled').length;
      if (saved === all.length) toast('success', all.length === 1 ? text('{name} is in your Files.', { name: all[0]!.name }) : text('{n} attachments are in your Files.', { n: saved }));
      else toast('error', text('{n} of {total} attachments were saved to your Files.', { n: saved, total: all.length }), { label: text('Retry'), run: () => void saveAttachments(t) });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const blockSender = async (t: Target) => {
    try {
      await apiPost('/api/mail/rules/sender', { email: t.row.from_email, action: 'block', ...(t.mailbox ? { mailbox: t.mailbox } : {}) });
      void qc.invalidateQueries({ queryKey: ['mail', 'rules'] });
      toast('success', text('Mail from {email} now goes to Spam.', { email: t.row.from_email }));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const refOfTarget = (t: Target): MessageRef => ({ uid: String(t.row.id), folder: t.folder, mailbox: t.mailbox, mid: t.row.message_id ?? null, midHash: t.row.message_id_hash ?? null, uidvalidity: t.row.uidvalidity ?? null });
  const copyLink = (t: Target) => {
    const link = messageLink(refOfTarget(t));
    if (!link) return void toast('error', text('Could not copy.'));
    void navigator.clipboard.writeText(link).then(() => toast('success', text('Link copied.')), () => toast('error', text('Could not copy.')));
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
    return [
      { id: 'ignore', label: text('Ignore conversation'), icon: 'trash', onSelect: () => setIgnoring({ key, target: t, here: flat.filter((r) => conversationKeyOf(r.row) === key).map(targetOf) }) },
      { id: 'cleanup', label: text('Clean up conversation'), icon: 'eraser', onSelect: () => void cleanUp(t) },
    ];
  };
  // Clean up conversation (DMO-INB-11): the thread as the server has it, read without marking anything read.
  const [cleaning, setCleaning] = useState<{ target: Target; redundant: MessageDetail[] } | null>(null);
  const cleanUp = async (t: Target) => {
    try {
      const r = await apiGetMeta<{ messages: MessageDetail[] }>(`/api/mail/messages/${t.row.id}/thread`, withMailbox({ folder: t.folder, peek: 1 }, t.mailbox));
      const flagged = states.data?.flags ?? {};
      const redundant = redundantInThread(r.data.messages ?? [], (m) => !!flagged[stateKey(t.mailbox, t.folder, m.id)] && !flagged[stateKey(t.mailbox, t.folder, m.id)]!.completed_at);
      if (!redundant.length) toast('info', text('Nothing to clean up: every message in this conversation says something new.'));
      else setCleaning({ target: t, redundant });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const quickStepSections = (targets: Target[]): MenuSection[] => (quickSteps.data?.length ? [{ id: 'qs', label: text('Quick Steps'), items: quickSteps.data.slice(0, 12).map((q) => ({ id: `qs${q.id}`, label: q.name, icon: q.icon, shortcut: q.shortcut ? `Ctrl+Shift+${q.shortcut}` : undefined, onSelect: () => runStep(q, targets) })) }] : []);
  const statesFor = (targets: Target[]) => stateSections(targets, stateActs, cats.data ?? null, { focusTabs: focusOn ? focusTab : null, onCustom: (what) => setCustom({ what, targets }) });
  // The list's right-click menu, and the selection's More (worksuite-desktop#161).
  const rowSections = (targets: Target[]) =>
    listMenuSections(targets, {
      run: (id, ts) => void listActs.run(id, ts),
      keyFor,
      offline: networkOffline,
      respond: (t, mode) => openRef(refOfTarget(t), mode),
      move: (ts) => setMoving(ts),
      state: statesFor(targets),
      quickSteps: quickStepSections(targets),
      rule: (t) => setRuleFor(t.row),
      block: (t) => void blockSender(t),
      conversation: targets.length === 1 ? conversationItems(targets[0]!) : [],
      task: canOpen('tasks') ? (t) => setTaskFor(t) : undefined,
      calendar: canOpen('calendar') ? (t) => void addToCalendar(t) : undefined,
      saveAttachments: canOpen('files') ? (t) => void saveAttachments(t) : undefined,
      linkRecord: canLinkRecords ? (ts) => setLinkFor(ts) : undefined,
      ticket: ticketOffer === 'yes' ? (t) => setTicketFor(t) : undefined,
      viewTicket: supportApp ? (id) => navigate(ticketRoute(id)) : undefined,
      window: (t) => openInWindow(windowRoute(refOfTarget(t)), t.row.subject),
      copyLink,
      source: (t) => setSourceOf(refOfTarget(t)),
      selectFolder,
      selectSender: (t) => setSelection(new Set(flat.filter((r) => r.row.from_email.toLowerCase() === t.row.from_email.toLowerCase()).map((r) => r.key))),
    });
  // The reader's own menu of WorkSuite states.
  const menuSections = (targets: Target[]) => [
    ...quickStepSections(targets),
    ...statesFor(targets),
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
    <SelectionPane
      targets={multi.map(targetOf)}
      sections={rowSections(multi.map(targetOf))}
      onAction={(cmd) => {
        const ts = multi.map(targetOf);
        const id = listCommand(cmd, ts, true);
        if (id && id !== 'none' && id !== 'move') void listActs.run(id, ts);
      }}
      onClear={() => setSelection(new Set())}
    />
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
        // One message that cannot be drawn says so here (#338): "This message couldn't be shown · Try again · Details".
        <MailBoundary
          part="message"
          resetKey={currentKey}
          account={current.mailbox}
          onRetry={() => {
            void qc.resetQueries({ queryKey: messageKey(current) });
            void qc.resetQueries({ queryKey: protectionKeys.message(current) });
          }}
          onDiagnostics={(ref) => navigate(diagnosticsRoute(ref))}
        >
        <MessageView
          key={currentKey}
          msgRef={current}
          backLabel={title}
          onBack={closeMessage}
          onReply={openCompose}
          onGone={gone}
          onDelete={currentRow ? () => void listActs.run(placeOf([targetOf(currentRow)]) === 'trash' ? 'deleteForever' : 'delete', [targetOf(currentRow)]) : undefined}
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
          combined={unified}
          onOpenFolder={(r) => pick({ box: r.mailbox ?? place.box, folder: r.folder })}
          onControls={(c) => {
            controls.current = c;
          }}
          autoReply={query.get('reply') === 'all' ? 'reply_all' : query.get('reply') === 'fwd' ? 'forward' : query.get('reply') === '1'}
          onLoaded={nameTab}
          archiveTo={archiveTo}
          marks={currentRow?.row ?? null}
          onRelocated={(to, where) => {
            // Found in another folder, or under a new UID (#209): the list drops the old row and the tab follows it.
            const toKey = queueKey(to.mailbox, to.folder, to.uid);
            if (currentKey) setHidden((h) => new Set([...h, currentKey]));
            setTabs((ts) => ts.map((t) => (t.key === currentKey ? { ...t, key: toKey, ref: to } : t)));
            if (to.folder !== current.folder) toast('info', where ? text('This email was moved to {folder}.', { folder: where }) : text('This email was moved to another folder.'));
            void qc.invalidateQueries({ queryKey: ['mail', 'messages'] });
            openRef(to);
          }}
          onMissing={() => {
            if (currentKey) setHidden((h) => new Set([...h, currentKey]));
          }}
          onFixAccount={() => navigate('/settings/mail?tab=accounts')}
          onRefreshFolder={() => {
            void qc.invalidateQueries({ queryKey: ['mail', 'messages'] });
            closeMessage();
          }}
          quickStepButtons={(quickSteps.data ?? []).map((q) => ({ id: q.id, name: q.name, icon: q.icon, run: () => runStep(q, currentRow ? [targetOf(currentRow)] : []) }))}
          stateMenu={() => menuSections(currentRow ? [targetOf(currentRow)] : current ? [{ row: { id: Number(current.uid) || 0, subject: tabs.find((t) => t.key === currentKey)?.subject ?? '', from_name: '', from_email: '', preview: '', is_read: true, is_starred: false, has_attachment: false, created_at: '' }, mailbox: current.mailbox, folder: current.folder }] : [])}
        />
        </MailBoundary>
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
      {/* Under the list's layer (its divider overlaps by 4 px) and never squeezed below a readable width (#428). */}
      <div data-mail-reading-wrap className="relative z-0 flex min-w-[280px] flex-1 flex-col overflow-hidden">
        {reader}
        <WaitingPanel pending={mailPending} />
      </div>
    </>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {!focus ? (
          <SidePanel id="mail" label="the folders">
            <MailBoundary part="sidebar" onRetry={() => void qc.resetQueries({ queryKey: ['mail', 'mailboxes'] })} onDiagnostics={(ref) => navigate(diagnosticsRoute(ref))}>
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
              newMenu={newMenu}
              onSearch={() => setSearching(search)}
              onAddMailbox={() => setAdding(true)}
              onPick={pick}
              onSettings={() => navigate('/settings/mail')}
              favorites={globalPrefs.favorites ?? []}
              onFavorites={(next) => setGlobalPrefs({ favorites: next })}
              quarantine={quarantineHeld}
              onQuarantine={() => go(QUARANTINE_ROUTE)}
            />
            </MailBoundary>
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
          {/* An account that cannot work (#338): named here with Reconnect and Remove; the others load as usual. */}
          <AccountAttention boxes={boxes} />
          {prefsLoaded && boxes.length > 0 && !globalPrefs.firstRun ? <FirstRun onPrefs={(patch) => setGlobalPrefs(patch)} /> : null}
          {globalPrefs.firstRun === 'outlook' ? <FirstRunOffers outlook={globalPrefs.keyScheme === 'outlook'} onImport={() => navigate('/settings/mail?tab=import')} onSignatures={() => navigate('/settings/mail?tab=signatures')} onDone={() => setGlobalPrefs({ firstRun: 'done' })} onRestore={() => setGlobalPrefs({ firstRun: 'outlook' })} /> : null}
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
              <Compose key={compose.n} seed={compose.seed} boxes={boxes} defaultBox={current?.mailbox ?? effectiveBox ?? (defaultBox ? String(defaultBox.id) : null)} offline={offline} onClose={() => setCompose(null)} onReopen={openCompose} onMinimise={() => setCompose((c) => (c ? { ...c, shown: false } : c))} onPopOut={(route, title) => void openInWindow(route, title)} />
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
      <div aria-live="polite" className="sr-only">{heard.say}</div>
      <StatusBar alertsPaused={alertsPaused} summary={summary} sync={shared.status} waiting={mailPending.length} zoom={prefs.zoom ?? 100} localBytes={localBytes.data ?? null} items={virtualOutbox || folder === 'outbox' || firstPage?.data.local ? null : (firstPage?.data.total ?? null)} notice={brokenRules ? { text: brokenRules === 1 ? text('1 rule was switched off') : text('{n} rules were switched off', { n: brokenRules }), onClick: () => navigate('/settings/mail?tab=rules') } : null} unread={allRole === 'inbox' ? unifiedUnread : null} onOpenSync={() => navigate('/settings/mail?tab=accounts')} />
      {outgoing.length ? (
        <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-14 left-1/2 z-40 flex -translate-x-1/2 flex-col gap-2">
          {outgoing.map((o) => (
            <div key={o.id} className="pointer-events-auto flex items-center gap-3 rounded-[10px] bg-navy px-4 py-2.5 text-[13.5px] text-white shadow-lg">
              {o.plain ? <span>{o.label}</span> : <SendingLabel subject={o.subject} at={o.at} label={o.label} />}
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
      {cleaning ? (
        <CleanupDialog
          subject={cleaning.target.row.subject}
          count={cleaning.redundant.length}
          onClose={() => setCleaning(null)}
          onConfirm={async () => {
            let moved = 0;
            for (const m of cleaning.redundant) {
              try {
                await messageAction({ uid: String(m.id), folder: cleaning.target.folder, mailbox: cleaning.target.mailbox }, 'trash', m.subject);
                moved++;
              } catch {
                // Left where it is; the count says how many went.
              }
            }
            setCleaning(null);
            void qc.invalidateQueries({ queryKey: ['mail'] });
            toast('success', text('{n} message(s) moved to Deleted Items.', { n: moved }));
          }}
        />
      ) : null}
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
          sections={rowSections(rowMenu.targets)}
          onClose={() => setRowMenu(null)}
        />
      ) : null}
      {snoozeAt ? <ContextMenu x={snoozeAt.x} y={snoozeAt.y} label={text('Snooze')} sections={statesFor(snoozeAt.targets)[0]?.items.find((i) => i.id === 'snooze')?.submenu ?? []} onClose={() => setSnoozeAt(null)} /> : null}
      {moving && moving[0]?.mailbox ? (
        <MoveDialog
          mailbox={moving[0].mailbox}
          from={moving[0].folder}
          onClose={() => setMoving(null)}
          onPick={(to) => {
            const ts = moving;
            setMoving(null);
            void listActs.run('move', ts, to);
          }}
        />
      ) : null}
      {linkFor ? <LinkRecordDialog items={linkFor.map((t) => stateItem(t.row, t.mailbox, t.folder))} onClose={() => setLinkFor(null)} /> : null}
      {taskFor ? <TaskFromMessage message={taskFor.row} msgRef={refOfTarget(taskFor)} onClose={() => setTaskFor(null)} /> : null}
      {ticketFor ? <ConvertEmailSheet email={emailToConvert(refOfTarget(ticketFor), ticketFor.row)} onClose={() => setTicketFor(null)} onDone={(t) => markTicket(qc, refOfTarget(ticketFor), t)} /> : null}
      {sourceOf ? <SourceDialog msgRef={sourceOf} onClose={() => setSourceOf(null)} /> : null}
      {listActs.dialog}
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

/**
 * A key's command as one of the list's actions (worksuite-desktop#161), for
 * the selection (`selected`) or the open message: Delete in Deleted Items is
 * Delete permanently, ! in Junk is Not junk. Null leaves the command to the
 * reader (read and unread on the open message keep its mark-as-read rules);
 * 'none' is a key that does nothing here.
 */
export function listCommand(id: string, targets: Array<{ folder: string; row: { is_starred: boolean } }>, selected: boolean): ListActionId | 'none' | null {
  const place = placeOf(targets);
  switch (id) {
    case 'archive':
      return place === 'trash' || place === 'junk' || place === 'archive' ? 'none' : 'archive';
    case 'delete':
      return place === 'trash' ? 'deleteForever' : 'delete';
    case 'deleteForever':
      return place === 'trash' ? 'deleteForever' : null;
    case 'spam':
      return place === 'junk' ? 'notJunk' : place === 'trash' ? 'none' : 'junk';
    case 'flag':
      return targets.every((t) => t.row.is_starred) ? 'unstar' : 'star';
    case 'read':
    case 'unread':
      return selected ? id : null;
    case 'move':
      return selected ? 'move' : null;
    default:
      return null;
  }
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

/** Some accounts on screen could not be checked: their addresses, for "Couldn't check hasarinda@…". */
class MailCheckError extends Error {
  readonly who: string[];
  constructor(who: string[]) {
    super(`Could not check ${who.join(', ')}`);
    this.who = who;
  }
}
