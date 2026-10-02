import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGetMeta, setDefaultMailbox, withMailbox } from '../../core/api';
import { app } from '../../core/app-state';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { searchFold } from '@shared/localization';
import { Icon } from '../../components/Icon';
import { SidePanel } from '../../components/SidePanel';
import { Empty, cx } from '../../components/ui';
import type { ModuleProps } from '../registry';
import { AddMailbox } from './AddMailbox';
import { messageAction, useLocalStore, useMailPrefs, useMailboxes, usePendingMail, useSyncStatus, useViewCounts } from './api';
import { Compose } from './Compose';
import { MessageList, type ListRow } from './MessageList';
import { MessageView, windowRoute, type ViewControls } from './MessageView';
import { applyFilters, filtersFor, folderName, groupRows, queueKey, queuedByMessage, rowMailbox, smartView, sortRows, step, type ChipId } from './model';
import { useOutgoing, undoSend } from './outgoing';
import { ReadingPane, afterClose, withTab, type OpenTab } from './ReadingPane';
import { ScheduledList } from './Scheduled';
import { SearchView } from './SearchView';
import { MailSidebar, unreadOf, type Place } from './Sidebar';
import { StatusBar, WaitingPanel } from './StatusBar';
import type { ComposeSeed, Label, MessagePage, MessageRef, MessageRow } from './types';

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
export default function MailPage({ active }: ModuleProps) {
  const qc = useQueryClient();
  const { query, go, route, openInWindow } = useTab();
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
  const [teamWho, setTeamWho] = useState<'all' | 'mine' | 'nobody'>('all');
  const controls = useRef<ViewControls | null>(null);
  const [composeRoute, setComposeRoute] = useState<string | null>(null);
  const openCompose = (seed: ComposeSeed) => setCompose((c) => ({ seed, shown: true, n: (c?.n ?? 0) + 1 }));
  if (query.get('compose') === '1' && composeRoute !== route) {
    setComposeRoute(route);
    // `?compose=1&to=a@b` — a new message to somebody (Contacts' Email).
    const to = query.get('to');
    setCompose((c) => ({ seed: { mode: 'new', ...(to && /^[^\s@<>]+@[^\s@<>]+$/.test(to) ? { to } : {}) }, shown: true, n: (c?.n ?? 0) + 1 }));
  }
  useTabTitle(msg ? 'Mail · Message' : 'Mail');

  const mailboxes = useMailboxes();
  const boxes = useMemo(() => (mailboxes.data?.mailboxes ?? []).filter((m) => !m.archived), [mailboxes.data]);
  const defaultBox = boxes.find((m) => m.is_default) ?? boxes[0];
  useEffect(() => setDefaultMailbox(defaultBox ? String(defaultBox.id) : null), [defaultBox]);
  const localStore = mailboxes.isSuccess && boxes.length === 0;
  const counts = useViewCounts(active && (mailboxes.isSuccess || mailboxes.isError));
  const sync = useSyncStatus(active && boxes.length > 0);
  const pending = usePendingMail();
  const localBytes = useLocalStore();
  const { prefs, set: setPrefs } = useMailPrefs();
  const outgoing = useOutgoing();

  const view = smartView(place.view);
  const folder = view?.folder ?? place.folder;
  const unified = place.box === 'unified' && boxes.length > 1 && place.label === null;
  const effectiveBox = place.label !== null ? null : unified ? null : place.box === 'unified' ? (defaultBox ? String(defaultBox.id) : null) : place.box;
  const filters = filtersFor(view, chips);
  const folderKey = `${effectiveBox ?? 'unified'}:${folder}`;
  const canThread = !unified && filters.length === 0 && folder !== 'outbox';
  const threaded = canThread && !!prefs.conversations?.[folderKey];

  const list = useInfiniteQuery({
    queryKey: ['mail', 'messages', unified ? 'unified' : effectiveBox, folder, filters.join(','), threaded],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      apiGetMeta<MessagePage>(
        '/api/mail/messages',
        unified
          ? { unified: 1, folder, page: pageParam, per_page: 50, ...(filters.length ? { filters: filters.join(',') } : {}) }
          : place.label !== null
            ? { folder, page: pageParam, per_page: 50 }
            : withMailbox({ folder, page: pageParam, per_page: 50, ...(filters.length ? { filters: filters.join(',') } : {}), ...(threaded ? { threaded: 1 } : {}), sort: prefs.sort ?? 'date', dir: prefs.dir ?? 'desc' }, effectiveBox),
        signal,
      ),
    getNextPageParam: (last, pages) => (last.data.has_more ? pages.length + 1 : undefined),
    enabled: (mailboxes.isSuccess || mailboxes.isError) && folder !== 'outbox',
  });
  const firstPage = list.data?.pages[0];
  const cachedOffline = !!list.data?.pages.some((p) => p.offline);
  const offline = networkOffline || cachedOffline;
  const isTeam = !!firstPage?.data.team;

  const queued = useMemo(() => queuedByMessage(pending.data ?? []), [pending.data]);
  const rowKey = (m: MessageRow) => queueKey(rowMailbox(m, effectiveBox), m.folder_slug ?? folder, m.id);
  const rows = (() => {
    let all = (list.data?.pages ?? []).flatMap((p) => p.data.messages);
    all = applyFilters(all, filters);
    if (isTeam) {
      const me = Number(app.get().bootstrap?.user.id ?? 0);
      all = all.filter((m) => (team === 'all' || (m.team?.status ?? 'open') === team) && (teamWho === 'all' || (teamWho === 'mine' ? m.team?.assignee_id === me : !m.team?.assignee_id)));
    }
    const term = searchFold(search.trim());
    if (term) all = all.filter((m) => searchFold(`${m.from_name} ${m.from_email} ${m.subject} ${m.preview}`).includes(term));
    return sortRows(all, prefs.sort ?? 'date', prefs.dir ?? 'desc');
  })();
  const groups = groupRows(rows, prefs.group ?? 'date').map((g) => ({ ...g, items: g.rows.map((r): ListRow => ({ row: r, key: rowKey(r), queued: queued.get(rowKey(r)) ?? null })) }));
  const flat = groups.flatMap((g) => g.items);

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
    openRef({ uid: String(r.row.id), folder: r.row.folder_slug ?? folder, mailbox: rowMailbox(r.row, effectiveBox) });
  };
  const closeMessage = () => go(`/mail?${placeQuery()}`);
  const pick = (p: Partial<Place>) => {
    setSearching(null);
    setChips([]);
    setSearch('');
    setCompose((c) => (c ? { ...c, shown: false } : c));
    go(`/mail?${placeQuery({ view: null, label: null, ...p })}`);
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
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]') || t.isContentEditable)) return;
    if (compose?.shown || searching !== null) return;
    const k = e.key;
    const handled = () => e.preventDefault();
    if (k === 'j' || k === 'ArrowDown') return handled(), move(1);
    if (k === 'k' || k === 'ArrowUp') return handled(), move(-1);
    if (k === 'Enter' && e.shiftKey && current) return handled(), openInWindow(windowRoute(current), known?.subject);
    if ((k === 'Enter' || k === 'o') && !current && flat[0]) return handled(), openRow(flat[0]);
    if (k === 'Escape') {
      if (focus) return handled(), setFocus(false);
      if (current) return handled(), closeMessage();
      return;
    }
    if (k === '/') {
      const box = document.querySelector<HTMLInputElement>('[data-mail-search]');
      if (box) return handled(), box.focus();
      return;
    }
    if (k === 'n' || k === 'c') return handled(), openCompose({ mode: 'new' });
    const c = controls.current;
    if (!current || !c) return;
    const map: Record<string, () => void> = {
      e: () => c.act('archive'),
      '#': () => c.act('trash'),
      Delete: () => c.act('trash'),
      '!': () => c.act('spam'),
      s: () => c.act('star'),
      u: () => c.act('unread'),
      r: () => c.reply('reply'),
      a: () => c.reply('reply_all'),
      f: () => c.reply('forward'),
    };
    const run = map[k];
    if (run) {
      handled();
      run();
    }
  };
  useEffect(() => {
    keys.current = onKey;
  });
  useEffect(() => {
    if (!active) return;
    const on = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [active]);

  const folderBox = place.box !== 'unified' ? (boxes.find((b) => String(b.id) === place.box) ?? defaultBox ?? null) : (defaultBox ?? null);
  const placeBox = place.box !== 'unified' ? boxes.find((b) => String(b.id) === place.box) : undefined;
  const label = place.label !== null ? (qc.getQueryData<{ labels: Label[] }>(['mail', 'labels'])?.labels.find((l) => l.id === place.label) ?? null) : null;
  const title = view
    ? view.label
    : label
      ? label.name
      : placeBox && folder === 'inbox'
        ? placeBox.email
        : folder === 'inbox'
          ? unified
            ? text('Unified inbox')
            : text('Inbox')
          : folderName(folder.startsWith('label:') ? folder.slice(6) : folder.charAt(0).toUpperCase() + folder.slice(1));
  const unifiedUnread = boxes.filter((b) => b.in_unified !== false).reduce((n, b) => n + (unreadOf(b, counts.data ?? null) ?? 0), 0);
  const aside = unified && !view ? text('{n} unread · {m} mailboxes', { n: unifiedUnread, m: boxes.length }) : placeBox ? (placeBox.account_type === 'local_mailbox' ? text('WorkSuite Local') : placeBox.shared ? text('Shared') : (placeBox.provider_label ?? null)) : null;
  const notice = firstPage?.data.unsearched?.length
    ? text('Not searched: {list}.', { list: firstPage.data.unsearched.join(', ') })
    : firstPage?.data.offline?.length
      ? text('Could not reach {list} — showing the others.', { list: firstPage.data.offline.join(', ') })
      : firstPage?.data.quick_failed
        ? text('This mailbox could not apply that filter on the server; it is applied to what is loaded.')
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
        {(['mine', 'nobody'] as const).map((w) => (
          <button key={w} type="button" aria-pressed={teamWho === w} onClick={() => setTeamWho(teamWho === w ? 'all' : w)} className={cx('h-[26px] rounded-full border px-2.5 text-[12.5px] font-semibold', teamWho === w ? 'border-ink bg-ink text-surface' : 'border-line text-ink hover:bg-subtle')}>
            {w === 'mine' ? text('Assigned to me') : text('Unassigned')}
          </button>
        ))}
      </div>
    </div>
  ) : null;

  const listEl =
    folder === 'outbox' ? (
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
        team={teamTabs}
        fill={pane === 'hidden' || pane === 'bottom'}
      />
    );

  const reader = (
    <ReadingPane
      tabs={tabs}
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
              place={place}
              folderBox={folderBox}
              showLabels={localStore}
              active={active}
              sync={sync.data ?? null}
              offline={offline}
              pending={mailPending.length}
              cacheDays={cacheDays}
              onCompose={() => openCompose({ mode: 'new' })}
              onSearch={() => setSearching(search)}
              onAddMailbox={() => setAdding(true)}
              onPick={pick}
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
          <div className="flex min-h-0 flex-1">
            {compose?.shown ? (
              <Compose key={compose.n} seed={compose.seed} boxes={boxes} defaultBox={current?.mailbox ?? effectiveBox ?? (defaultBox ? String(defaultBox.id) : null)} offline={offline} onClose={() => setCompose(null)} onReopen={openCompose} />
            ) : (
              main
            )}
          </div>
        </div>
      </div>
      <StatusBar sync={sync.data ?? null} mailboxes={boxes.length} offline={offline} waiting={mailPending.length} zoom={prefs.zoom ?? 100} localBytes={localBytes.data ?? null} />
      {outgoing.length ? (
        <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-14 left-1/2 z-40 flex -translate-x-1/2 flex-col gap-2">
          {outgoing.map((o) => (
            <div key={o.id} className="pointer-events-auto flex items-center gap-3 rounded-[10px] bg-navy px-4 py-2.5 text-[13.5px] text-white shadow-lg">
              <SendingLabel subject={o.subject} at={o.at} />
              <button type="button" onClick={() => undoSend(o.id)} className="rounded-[6px] bg-primary px-3 py-1 text-[13px] font-bold text-[var(--ws-on-primary)] hover:bg-primary-hover">
                Undo
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {adding ? <AddMailbox onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

/** "Sending “Re: Payroll export” in 8 s", counting down. */
function SendingLabel({ subject, at }: { subject: string; at: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  return <span>{text('Sending “{subject}” in {n} s', { subject, n: Math.max(0, Math.ceil((at - now) / 1000)) })}</span>;
}
