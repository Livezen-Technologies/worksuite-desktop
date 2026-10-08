import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { app } from '../../core/app-state';
import { apiGet, apiGetMeta } from '../../core/api';
import { isMac } from '../../core/bridge';
import { text } from '../../core/i18n';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { listStamp, parseTs } from '../../core/time';
import { toast } from '../../core/toasts';
import { ContextMenu } from '../../components/ContextMenu';
import { Icon } from '../../components/Icon';
import { RowLead } from '../../components/RowLead';
import { Avatar, Empty, ErrorNote, OfflineNote, Spinner, cx } from '../../components/ui';
import { UserAvatar } from '../../components/UserAvatar';
import type { ModuleProps } from '../registry';
import { useNow } from '../calls/parts';
import { CALL_FILTERS, CallLogList, useCallLog, type CallFilter } from './CallLog';
import { Details, PRESENCE } from './Details';
import { NewChat, StarredDialog } from './NewChat';
import { lastOrRecent, roomFromRoute } from './routes';
import { Thread } from './Thread';
import { roomPerson, type Room } from './types';
import { bulkMenu, roomMenu, shortcutAction, websiteMenu, type BulkAction } from './menus';
import { usePresence } from './presence';
import { useRoomActions, useWebsiteActions } from './RoomActions';
import { useAgents, useWebsiteAccess, useWebsiteInbox, type WebsiteRow } from './website/api';
import { WebsiteThread } from './website/WebsiteThread';
import { WebsiteWorkspace } from './website/WebsiteWorkspace';
import { MyStatus } from './MyStatus';
import { BulkBar, BulkIconButton } from './BulkBar';
import { useMultiSelect } from './selection';
import { SidePanel } from '../../components/SidePanel';
import { refreshWords, useListRefresh } from '../../components/PullToRefresh';
import { ResizeDivider, useResizableWidth } from '../../components/ResizeDivider';
import { canOpenWeb, useCanOpen } from '../../core/access';
import { AddChannel, type AddStep } from './channels/AddChannel';
import { ChannelBar } from './channels/ChannelBar';
import { buildChannels, channelOf, channelRoute, isMetaChannel, LIST_WIDTH } from './channels/channels';
import { MetaChannel } from './channels/MetaChannel';
import { MetaConnect } from './channels/MetaConnect';
import { MetaSettings } from './channels/MetaSettings';
import { PLATFORM_LABEL, useMetaAccounts, type MetaAccount, type MetaPlatform } from './channels/meta';
import { WhatsappChannel } from './channels/WhatsappChannel';
import { WhatsappSettings } from './channels/WhatsappSettings';
import { useWaAccounts, waNumber } from './channels/whatsapp';

/**
 * Chat (UI-08, FR-COM-02/03, §4.15; the "Chat · conversations, thread,
 * message actions, composer, details" design): conversations grouped as
 * Pinned, Direct, Groups & channels and Website, the thread, and the
 * conversation's details. A message sent offline waits in the queue and shows
 * as pending (WF-17). Website staff get the website-chat workspace under the
 * Website filter, and their open visitors in the list.
 *
 * Down the far left, the channel toolbar (worksuite-desktop#33): Chat, Web Chat and WhatsApp, each with its unread
 * count, and "Add a channel". Picking one shows its conversations in the list; drafts are kept per conversation.
 * WhatsApp is only here now (#35): its old links open its channel, and someone with WhatsApp but not Chat gets
 * Chat with only that channel. Messenger and Instagram (#36) are channels too, for whoever has them.
 */
type Filter = 'all' | 'unread' | 'mentions' | 'archived' | 'calls';


export default function ChatPage({ tabId }: ModuleProps) {
  const { query, go, path } = useTab();
  const mini = tabId.startsWith('window-chat-mini');
  const room = roomFromRoute(query, path);
  const chatAccess = useCanOpen('chat');
  const asked = channelOf(query);
  const whatsappAccess = useCanOpen('whatsapp');
  // Messenger and Instagram are one application on the server (`meta`): having one is having both.
  const metaAccess = useCanOpen('messenger');
  // Someone with WhatsApp (or Messenger and Instagram) and not Chat has Chat for those channels alone.
  const channel = asked === 'chat' && !chatAccess ? (whatsappAccess || !metaAccess ? 'whatsapp' : 'messenger') : asked;
  const websiteAccess = useWebsiteAccess();
  const websiteOpen = useWebsiteInbox(false, websiteAccess && !mini);
  const wa = useWaAccounts(whatsappAccess && !mini);
  const waAccounts = wa.data?.accounts ?? [];
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const canConnect = !!perms && (perms.includes('*') || perms.includes('whatsapp.connect'));
  const meta = useMetaAccounts(metaAccess && !mini);
  const metaAccounts = meta.data?.accounts ?? [];
  // The WhatsApp number the rail and the list show (#155).
  const waPicked = useStore(waNumber, (s) => s.id);
  const metaCanConnect = !!meta.data?.can_connect;
  const [connecting, setConnecting] = useState<{ platform: MetaPlatform; reconnect?: MetaAccount } | null>(null);
  const [metaSettings, setMetaSettings] = useState<MetaPlatform | null>(null);
  const [adding, setAdding] = useState<AddStep | null>(null);
  const [settings, setSettings] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [starting, setStarting] = useState(false);
  const [starred, setStarred] = useState(false);
  const [details, setDetails] = useState(true);
  const rooms = useQuery({ queryKey: ['chat', 'rooms'], queryFn: ({ signal }) => apiGetMeta<{ rooms: Room[] }>('/api/chat/rooms', undefined, signal), enabled: chatAccess });
  const all = (rooms.data?.data.rooms ?? []).filter((r) => r.type !== 'widget');
  const current = all.find((r) => String(r.id) === room);
  useTabTitle(channel !== 'chat' ? null : current ? `Chat · ${current.name}` : 'Chat');
  const me = useStore(app, (s) => s.auth?.user?.id);
  const lastKey = me ? `ws.chat.lastRoom.${me}` : null;

  // The conversation open now is the one Chat comes back to.
  useEffect(() => {
    if (!room || !current || !lastKey) return;
    try {
      localStorage.setItem(lastKey, room);
    } catch {
      // Remembering is a convenience; without it Chat opens the most recent conversation.
    }
  }, [room, current, lastKey]);

  // ⌘N / Ctrl+N (the shell's "New") in Chat starts a conversation (`?new=1`); closing it leaves the route as it was
  // (#155). WhatsApp answers its own.
  const fresh = query.get('new') === '1' && channel === 'chat' && chatAccess && !mini;
  const withoutNew = () => {
    const rest = new URLSearchParams(query);
    rest.delete('new');
    const qs = rest.toString();
    return qs ? `/chat?${qs}` : '/chat';
  };

  // Chat opens on a conversation, never on an empty pane: the last one you had
  // open, or else the most recent.
  const reopen = !mini && !room && channel === 'chat' && rooms.isSuccess ? lastOrRecent(all, lastKey) : null;
  useEffect(() => {
    if (reopen) go(`/chat?room=${reopen}`);
  }, [reopen, go]);

  // Pull to check for new messages, ⌘R/F5 and "Checked…" (worksuite-desktop#236): the conversations asked again.
  const checkRooms = async () => {
    const r = await rooms.refetch({ throwOnError: true });
    if (r.data?.offline) throw new Error(text('You’re offline: showing the conversations saved on this computer'));
  };

  const channels = buildChannels({ active: channel, chat: chatAccess, rooms: all, website: { access: websiteAccess, rows: websiteOpen.data?.conversations ?? [] }, whatsapp: { access: whatsappAccess, accounts: waAccounts, canConnect }, meta: { access: metaAccess, accounts: metaAccounts } });
  const connect = whatsappAccess && canConnect ? () => setAdding({ at: 'whatsapp' }) : null;
  const connectMeta = (platform: MetaPlatform) => (metaAccess && metaCanConnect && meta.data?.ready ? () => setConnecting({ platform }) : null);

  const chat = (
    <div className="flex h-full min-w-0 flex-1">
      {!mini ? (
        <SidePanel id="chat" label="the conversations">
          <Rail
            rooms={all}
            loading={rooms.isLoading}
            error={rooms.error}
            offline={rooms.data?.offline ? rooms.data.cachedAt : null}
            retry={() => void rooms.refetch()}
            check={checkRooms}
            checkedAt={rooms.dataUpdatedAt || null}
            selected={room}
            q={q}
            setQ={setQ}
            filter={filter}
            setFilter={setFilter}
            websiteAccess={websiteAccess}
            onNew={() => setStarting(true)}
            onStarred={() => setStarred(true)}
            onInfo={(r) => {
              go(`/chat?room=${r.id}`);
              setDetails(true);
            }}
          />
        </SidePanel>
      ) : null}
      <div className="flex min-w-0 flex-1 bg-ground">
        {room ? (
          <>
            <div className="flex min-w-0 flex-1 flex-col">
              <Thread key={room} roomId={room} room={current} mini={mini} rooms={all} detailsOpen={details} onToggleDetails={() => setDetails(!details)} />
            </div>
            {details && current && !mini ? <Details room={current} onClose={() => setDetails(false)} /> : null}
          </>
        ) : rooms.isLoading || reopen ? (
          <Spinner />
        ) : (
          <Empty icon="chat" title="No conversations yet" hint="Start one with +." />
        )}
      </div>
      {starting || fresh ? (
        <NewChat
          onClose={() => {
            setStarting(false);
            if (fresh) go(withoutNew());
          }}
          onOpened={(id) => {
            setStarting(false);
            go(`/chat?room=${id}`);
          }}
        />
      ) : null}
      {starred ? (
        <StarredDialog
          onClose={() => setStarred(false)}
          onShow={(id) => {
            setStarred(false);
            go(`/chat?room=${id}`);
          }}
        />
      ) : null}
    </div>
  );

  return (
    <div className="flex h-full">
      {!mini ? <ChannelBar channels={channels} active={channel} onPick={(id) => go(channelRoute(id))} onAdd={() => setAdding({ at: 'list' })} numbers={{ accounts: waAccounts, selected: waPicked, onPick: (id) => waNumber.set({ id }) }} /> : null}
      {/* Every website chat opens in its workspace, wherever the link came from; in a window of its own, just the conversation (RDC-16). */}
      {channel === 'website' && mini ? (
        <WebsiteMini id={query.get('website')} />
      ) : channel === 'website' ? (
        <WebsiteWorkspace />
      ) : channel === 'whatsapp' ? (
        whatsappAccess ? (
          <WhatsappChannel accounts={waAccounts} loading={wa.isLoading} error={wa.error} retry={() => void wa.refetch()} onConnect={connect} onSettings={() => setSettings(true)} />
        ) : (
          <div className="flex min-w-0 flex-1 bg-ground">
            <Empty icon="lock" title="WhatsApp is not available to you" hint="Ask an administrator for access to WhatsApp." />
          </div>
        )
      ) : isMetaChannel(channel) ? (
        metaAccess ? (
          <MetaChannel
            key={channel}
            platform={channel}
            accounts={metaAccounts.filter((a) => a.platform === channel)}
            loading={meta.isLoading}
            error={meta.error}
            retry={() => void meta.refetch()}
            onConnect={connectMeta(channel)}
            onReconnect={(a) => setConnecting({ platform: a.platform, reconnect: a })}
            onSettings={() => setMetaSettings(channel)}
          />
        ) : (
          <div className="flex min-w-0 flex-1 bg-ground">
            <Empty icon="lock" title={`${PLATFORM_LABEL[channel]} is not available to you`} hint="Ask an administrator for access to Messenger and Instagram." />
          </div>
        )
      ) : (
        chat
      )}
      {metaSettings && metaAccess ? (
        <MetaSettings
          platform={metaSettings}
          accounts={metaAccounts.filter((a) => a.platform === metaSettings)}
          loading={meta.isLoading}
          onConnect={connectMeta(metaSettings) ? () => (setMetaSettings(null), setConnecting({ platform: metaSettings })) : null}
          onReconnect={(a) => (setMetaSettings(null), setConnecting({ platform: a.platform, reconnect: a }))}
          onClose={() => setMetaSettings(null)}
        />
      ) : null}
      {connecting && metaAccess ? (
        <MetaConnect
          platform={connecting.platform}
          reconnect={connecting.reconnect}
          onClose={() => setConnecting(null)}
          onConnected={(accounts) => {
            const platform = connecting.platform;
            setConnecting(null);
            const ok = accounts.filter((a) => a.status === 'connected');
            if (ok.length === accounts.length) toast('success', `${accounts.map((a) => a.name).join(', ')} ${accounts.length === 1 ? 'is' : 'are'} connected to ${PLATFORM_LABEL[platform]}.`);
            else toast('error', accounts.filter((a) => a.status !== 'connected').map((a) => `${a.name}: ${a.status_note ?? 'not connected'}`).join(' '));
            go(`/chat?channel=${platform}`);
          }}
        />
      ) : null}
      {settings && whatsappAccess ? (
        <WhatsappSettings
          accounts={waAccounts}
          loading={wa.isLoading}
          onConnect={connect ? () => (setSettings(false), connect()) : null}
          onClose={() => setSettings(false)}
        />
      ) : null}
      {adding ? (
        <AddChannel
          initial={adding}
          website={{ access: websiteAccess, canSetUp: canOpenWeb('/website-chats') }}
          whatsapp={{ access: whatsappAccess, canConnect, accounts: waAccounts }}
          meta={{ access: metaAccess, canConnect: metaCanConnect, ready: !!meta.data?.ready, accounts: metaAccounts }}
          onMeta={(platform) => (setAdding(null), setConnecting({ platform }))}
          onMetaSettings={(platform) => (setAdding(null), setMetaSettings(platform))}
          onSettings={whatsappAccess ? () => (setAdding(null), setSettings(true)) : undefined}
          onClose={() => setAdding(null)}
          onConnected={() => {
            setAdding(null);
            toast('success', 'WhatsApp is connected.');
            go('/chat?channel=whatsapp');
          }}
        />
      ) : null}
    </div>
  );
}

/** A website conversation in a small window of its own (RDC-16): the thread alone, in the window look. */
function WebsiteMini({ id }: { id: string | null }) {
  return (
    <div className="flex min-w-0 flex-1 bg-ground">
      {id && /^\d+$/.test(id) ? <WebsiteThread key={id} id={id} mini /> : <Empty icon="globe" title="This website chat is not available" />}
    </div>
  );
}

interface RailProps {
  rooms: Room[];
  loading: boolean;
  error: unknown;
  offline: string | null;
  retry: () => void;
  /** Check for new messages now (#236). */
  check: () => Promise<unknown>;
  /** When the list last came from the server (ms). */
  checkedAt: number | null;
  selected: string | null;
  q: string;
  setQ: (q: string) => void;
  filter: Filter;
  setFilter: (f: Filter) => void;
  websiteAccess: boolean;
  onNew: () => void;
  onStarred: () => void;
  /** Contact info, Group info, Add members, meeting details: the conversation's details panel. */
  onInfo: (r: Room) => void;
}

function Rail({ rooms, loading, error, offline, retry, check, checkedAt, selected, q, setQ, filter, setFilter, websiteAccess, onNew, onStarred, onInfo }: RailProps) {
  const { go } = useTab();
  const me = useStore(app, (s) => (s.auth?.user?.id ? Number(s.auth.user.id) : null));
  // The list's presence is everybody's presence: the header and the details read the same store (worksuite-desktop#183).
  const presenceOf = usePresence(rooms.map((r) => r.other_user_id));
  const actions = useRoomActions({ onInfo, openId: selected, onGone: () => go('/chat') });
  const [menu, setMenu] = useState<{ x: number; y: number; ids: number[] } | null>(null);
  const [visitorMenu, setVisitorMenu] = useState<{ x: number; y: number; c: WebsiteRow } | null>(null);
  const agents = useAgents(websiteAccess && !!visitorMenu);
  const websiteRun = useWebsiteActions(me, (c) => go(`/chat?view=website&website=${c.id}`));
  const web = useWebsiteInbox(false, websiteAccess);
  const needle = q.trim().toLowerCase();
  // Chat › Calls: the call log, beside the conversations (worksuite-desktop#113).
  const calls = useCallLog(filter === 'calls');
  const [callFilter, setCallFilter] = useState<CallFilter>('All');
  const now = useNow(60_000);
  const missed = (calls.data ?? []).filter((c) => c.missed && now - parseTs(c.started_at).getTime() < 86_400_000).length;
  const search = useQuery({
    queryKey: ['chat', 'search', needle],
    queryFn: ({ signal }) => apiGet<{ results: Array<{ message_id: number; room_id: number; room_name: string; sender_name: string; snippet: string; created_at: string }> }>('/api/chat/search', { q: needle, kind: 'all' }, signal),
    enabled: needle.length >= 3,
    staleTime: 30_000,
  });

  const visible = rooms.filter((r) => {
    if (needle && !r.name.toLowerCase().includes(needle)) return false;
    if (filter === 'archived') return r.archived;
    if (r.archived) return false;
    if (filter === 'unread') return r.unread > 0;
    if (filter === 'mentions') return r.mentions > 0;
    return true;
  });
  const archived = rooms.filter((r) => r.archived).length;
  const sections: Array<[string, Room[]]> = [
    ['Pinned', visible.filter((r) => r.pinned)],
    ['Direct', visible.filter((r) => !r.pinned && r.type === 'direct')],
    ['Groups & channels', visible.filter((r) => !r.pinned && r.type !== 'direct')],
  ];
  const list = useResizableWidth('chat.list', LIST_WIDTH);
  const order = sections.flatMap(([, l]) => l);
  // The multi-select (worksuite-desktop#183): Ctrl/⌘-click, Shift-click, or Select mode — shared with Website chats.
  const sel = useMultiSelect(order.map((r) => r.id), { current: selected && rooms.some((x) => String(x.id) === selected) ? Number(selected) : null });
  const { picked, selecting } = sel;
  const byId = (ids: number[]) => rooms.filter((r) => ids.includes(r.id));
  const pickedRooms = byId(picked);
  const pinnedNow = rooms.filter((r) => r.pinned).length;
  const endSelect = sel.clear;
  const runBulk = (targets: Room[], a: BulkAction) => {
    actions.bulk(targets, a);
    if (a !== 'delete') endSelect();
  };
  const click = (r: Room, e: ReactMouseEvent) => {
    // The box in the row's lead picks it without opening it, as in Mail and Files; Shift picks the run to it.
    if ((e.target as HTMLElement).closest('[data-row-lead]')) {
      if (!(e.shiftKey && sel.onRowClick(e, r.id))) sel.toggle(r.id);
      return;
    }
    if (sel.onRowClick(e, r.id)) return;
    go(`/chat?room=${r.id}`);
  };
  const contextMenu = (r: Room, e: ReactMouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, ids: picked.length > 1 && picked.includes(r.id) ? picked : [r.id] });
  };
  /** Arrows move through the list, Enter opens (the row is a button); the shortcuts act on the picked or focused conversation. */
  const keys = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-room-row]');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const all = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-room-row]')];
      if (!all.length) return;
      e.preventDefault();
      const at = row ? all.indexOf(row) : -1;
      const next = all[Math.max(0, Math.min(all.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
      next?.focus();
      return;
    }
    if (sel.escape(e)) return;
    if (picked.length > 1) {
      const lead = pickedRooms[0];
      const a = lead ? shortcutAction(e, lead, isMac) : null;
      if (!a) return;
      e.preventDefault();
      const bulk: Partial<Record<string, BulkAction>> = { read: 'read', unread: 'unread', archive: 'archive', unarchive: 'unarchive', 'mute-always': 'mute', unmute: 'unmute', delete: 'delete' };
      const b = bulk[a];
      if (b) runBulk(pickedRooms, b);
      return;
    }
    const focused = row ? rooms.find((x) => String(x.id) === row.dataset.roomRow) : rooms.find((x) => String(x.id) === selected);
    if (!focused) return;
    const a = shortcutAction(e, focused, isMac);
    if (!a) return;
    e.preventDefault();
    actions.run(focused, a);
  };
  // Pull to check for new messages and "↑ 3 new conversations" (#236): a conversation is new again when a message comes.
  const { attach: listRef, ...refresh } = useListRefresh({
    list: 'chat',
    check,
    items: order.map((r) => ({ key: String(r.id), stamp: r.last_message?.created_at ?? r.updated_at })),
    view: `${filter}:${needle}`,
    ready: !loading && !error,
    words: refreshWords('messages'),
    errorText: () => text('Couldn’t check for new messages'),
    lastChecked: checkedAt,
  });
  const visitors = websiteAccess && filter === 'all' ? (web.data?.conversations ?? []).filter((c) => !needle || (c.visitor_name ?? c.label).toLowerCase().includes(needle)).slice(0, 6) : [];

  return (
    <aside aria-label="Conversations" className="relative flex shrink-0 flex-col border-r border-line bg-surface" style={{ width: list.width }}>
      <ResizeDivider state={list} label="Resize the conversation list" />
      <div className="flex flex-col gap-2 px-3 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <MyStatus />
          <button type="button" aria-label="Starred messages" title="Starred messages" onClick={onStarred} className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-line text-ink-2 hover:bg-subtle">
            <Icon name="star" size={15} />
          </button>
          <button type="button" aria-label="Select conversations" title="Select conversations" aria-pressed={selecting} onClick={() => (selecting ? endSelect() : sel.setSelecting(true))} className={cx('flex h-8 w-8 items-center justify-center rounded-[8px] border border-line text-ink-2 hover:bg-subtle', selecting && '!border-primary !bg-selection !text-primary')}>
            <Icon name="check-circle" size={15} />
          </button>
          <button type="button" data-guide="chat.new" aria-label="New conversation" title="New conversation" onClick={onNew} className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-primary text-white hover:bg-primary-hover">
            <Icon name="plus" size={17} />
          </button>
        </div>
        <label className="flex h-[34px] items-center gap-2 rounded-[8px] bg-ground px-2.5 text-ink-3">
          <Icon name="search" size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search messages, files and people…" aria-label="Search chat" className="flex-1 bg-transparent text-[13px] text-ink outline-none" />
        </label>
        <div role="tablist" className="flex gap-1 text-[12px] font-semibold">
          {(
            [
              ['all', 'All'],
              ['unread', 'Unread'],
              ['mentions', 'Mentions'],
              ['calls', 'Calls'],
            ] as Array<[Filter, string]>
          ).map(([f, l]) => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={cx('flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1', filter === f ? 'bg-ink text-surface' : 'border border-line text-ink hover:bg-subtle')}>
              {l}
              {f === 'calls' && missed ? <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-badge px-1 text-[10px] font-bold text-white" aria-label={`${missed} missed`}>{missed}</span> : null}
            </button>
          ))}
          {websiteAccess ? (
            <button type="button" role="tab" aria-selected={false} onClick={() => go('/chat?view=website')} className="shrink-0 rounded-full border border-line px-2.5 py-1 text-ink hover:bg-subtle">
              Website
            </button>
          ) : null}
        </div>
        {filter === 'calls' ? (
          <div className="flex gap-1 text-[12px] font-semibold">
            {CALL_FILTERS.map((f) => (
              <button key={f} type="button" aria-pressed={callFilter === f} onClick={() => setCallFilter(f)} className={cx('shrink-0 rounded-full px-2.5 py-0.5', callFilter === f ? 'bg-selection text-primary' : 'text-ink-2 hover:bg-subtle')}>
                {f}
              </button>
            ))}
          </div>
        ) : null}
        {filter !== 'calls' ? <div className="-mt-1 flex min-w-0">{refresh.checked}</div> : null}
        {offline ? <OfflineNote cachedAt={offline} /> : null}
        {picked.length || selecting ? (
          <BulkBar tone="rail" label="Selected conversations" count={picked.length} onClear={endSelect}>
            <BulkIconButton label={sel.state === 'all' ? 'Select none' : 'Select all'} icon={sel.state === 'all' ? 'minus' : 'check-check'} onClick={sel.toggleAll} />
            {bulkActions(pickedRooms).map(([a, label, icon]) => (
              <BulkIconButton key={a} label={label} icon={icon} disabled={!picked.length} onClick={() => runBulk(pickedRooms, a)} />
            ))}
          </BulkBar>
        ) : null}
      </div>
      {filter === 'calls' ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2 scroll-thin">
          <CallLogList log={calls} rooms={rooms} filter={callFilter} needle={needle} />
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col">
          {refresh.indicator}
          {refresh.pill}
          <div
            ref={listRef}
            className="min-h-0 flex-1 overflow-y-auto pb-2 scroll-thin"
            onKeyDown={(e) => {
              keys(e);
              refresh.onKeyDown(e);
            }}
          >
            {filter === 'archived' ? (
              <button type="button" onClick={() => setFilter('all')} className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[12.5px] font-bold text-ink hover:bg-subtle">
                <Icon name="chevron-left" size={15} className="text-ink-3" /> Archived conversations
              </button>
            ) : archived && !needle ? (
              <button type="button" onClick={() => setFilter('archived')} className="flex w-full items-center gap-2.5 px-3.5 py-[7px] text-left hover:bg-subtle">
                <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-subtle text-ink-2"><Icon name="archive" size={16} /></span>
                <b className="flex-1 text-[13px] font-semibold text-ink">Archived</b>
                <span className="text-[11.5px] font-semibold text-ink-3">{archived}</span>
              </button>
            ) : null}
            {loading ? <Spinner /> : error ? <div className="p-4"><ErrorNote error={error} onRetry={retry} /></div> : null}
            {!loading && !error && visible.length === 0 && visitors.length === 0 ? <Empty icon="chat" title={filter === 'archived' ? 'No archived conversations' : 'No conversations'} /> : null}
            {sections.map(([title, list]) =>
              list.length ? (
                <div key={title}>
                  <div className="px-3.5 pt-2 pb-1 text-[10.5px] font-bold tracking-[0.6px] text-ink-3 uppercase">{title}</div>
                  {list.map((r) => (
                    <RoomRow key={r.id} r={r} mark={refresh.rowProps(String(r.id))} markClass={refresh.freshClass(String(r.id))} active={String(r.id) === selected} picked={picked.includes(r.id)} selecting={selecting || picked.length > 0} status={r.other_user_id ? presenceOf(r.other_user_id) : undefined} onClick={(e) => click(r, e)} onMenu={(e) => contextMenu(r, e)} />
                  ))}
                </div>
              ) : null,
            )}
            {visitors.length ? (
              <div>
                <div className="px-3.5 pt-2 pb-1 text-[10.5px] font-bold tracking-[0.6px] text-ink-3 uppercase">Website</div>
                {visitors.map((c) => (
                  <VisitorRow key={c.id} c={c} active={selected === `w${c.id}`} onOpen={() => go(`/chat?view=website&website=${c.id}`)} onMenu={(e) => (e.preventDefault(), setVisitorMenu({ x: e.clientX, y: e.clientY, c }))} />
                ))}
              </div>
            ) : null}
            {needle.length >= 3 && search.data?.results.length ? (
              <div>
                <div className="px-3.5 pt-2 pb-1 text-[10.5px] font-bold tracking-[0.6px] text-ink-3 uppercase">Messages</div>
                {search.data.results.slice(0, 20).map((h) => (
                  <button key={h.message_id} type="button" onClick={() => go(`/chat?room=${h.room_id}`)} className="flex w-full flex-col px-3.5 py-2 text-left hover:bg-subtle">
                    <span className="flex gap-2 text-[12px]"><b className="flex-1 truncate text-ink">{h.room_name}</b><span className="text-ink-3">{listStamp(h.created_at)}</span></span>
                    <span className="truncate text-[12px] text-ink-3">{h.sender_name}: {h.snippet}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      )}
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={menu.ids.length > 1 ? 'Conversation actions' : `Actions — ${byId(menu.ids)[0]?.name ?? 'conversation'}`}
          sections={menu.ids.length > 1 ? bulkMenu(byId(menu.ids), (a) => runBulk(byId(menu.ids), a)) : byId(menu.ids)[0] ? roomMenu(byId(menu.ids)[0]!, { pinned: pinnedNow, mac: isMac }, (a) => actions.run(byId(menu.ids)[0]!, a)) : []}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {visitorMenu ? (
        <ContextMenu
          x={visitorMenu.x}
          y={visitorMenu.y}
          label={`Actions — ${visitorMenu.c.visitor_name || visitorMenu.c.label}`}
          sections={websiteMenu(visitorMenu.c, me, agents.data?.agents ?? [], (a, userId, priority) => websiteRun(visitorMenu.c, a, userId, priority))}
          onClose={() => setVisitorMenu(null)}
        />
      ) : null}
      {actions.dialogs}
    </aside>
  );
}

/**
 * The rail's toolbar while conversations are picked: what fits all of them, as the right-click menu decides it —
 * Mark read or unread, Archive or Unarchive, Mute or Unmute, and Delete when any of them can be deleted.
 */
function bulkActions(rooms: Room[]): Array<[BulkAction, string, string]> {
  const anyUnread = rooms.some((r) => r.unread > 0 || r.marked_unread);
  const allArchived = rooms.length > 0 && rooms.every((r) => r.archived);
  const allMuted = rooms.length > 0 && rooms.every((r) => r.muted);
  const deletable = rooms.length === 0 || rooms.some((r) => r.type !== 'system' && r.type !== 'meeting');
  return [
    anyUnread || rooms.length === 0 ? ['read', 'Mark read', 'check'] : ['unread', 'Mark unread', 'mail'],
    allArchived ? ['unarchive', 'Unarchive', 'archive'] : ['archive', 'Archive', 'archive'],
    allMuted ? ['unmute', 'Unmute', 'bell'] : ['mute', 'Mute', 'bell-off'],
    ...(deletable ? [['delete', 'Delete', 'trash'] as [BulkAction, string, string]] : []),
  ];
}

/**
 * A conversation in the list: pinned ones carry a pin, muted ones a struck bell and a grey count (they are not in
 * the total either), and one marked unread by hand a dot with nothing new in it (worksuite-desktop#183).
 * The dot and, while conversations are picked, the tick share the lead column every list has (worksuite-desktop#290);
 * the row is the button that picks, so the tick is a mark, not a second control.
 */
function RoomRow({ r, active, picked, selecting, status, onClick, onMenu, mark, markClass }: { r: Room; active: boolean; picked: boolean; selecting: boolean; status: string | undefined; onClick: (e: ReactMouseEvent) => void; onMenu: (e: ReactMouseEvent) => void; mark?: { 'data-refresh-key': string; 'data-fresh'?: '' }; markClass?: string }) {
  const st = status ? PRESENCE[status] : undefined;
  const group = r.type !== 'direct';
  const last = r.last_message?.type === 'voice' ? 'Voice message' : r.last_message?.type === 'file' ? 'Attachment' : (r.last_message?.text ?? '');
  const dot = !!r.marked_unread && r.unread <= 1 && !r.mentions;
  const badge = dot ? null : r.mentions ? { text: String(r.mentions), cls: 'bg-badge' } : r.unread ? { text: String(r.unread), cls: r.muted ? 'bg-ink-3' : 'bg-primary' } : null;
  return (
    <button
      type="button"
      data-room-row={r.id}
      {...mark}
      aria-current={active ? 'true' : undefined}
      aria-pressed={selecting || picked ? picked : undefined}
      onClick={onClick}
      onContextMenu={onMenu}
      className={cx('group flex w-full items-center gap-2.5 py-[7px] pr-3.5 pl-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset', picked ? 'bg-selection ring-1 ring-primary ring-inset' : active ? 'bg-selection' : 'hover:bg-subtle', markClass)}
    >
      <RowLead unread={dot} dotLabel="Marked unread" checked={picked} selecting={selecting} hoverBox className="-mr-2.5 self-start" />
      <span className="relative shrink-0">
        <UserAvatar userId={roomPerson(r)} name={r.avatar_name || r.name} size={34} className={group ? '!rounded-[9px]' : ''} />
        {st ? <span className={cx('absolute -right-px -bottom-px h-[10px] w-[10px] rounded-full border-2 border-surface', st.dot)} aria-label={st.label} title={st.label} /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <b className={cx('flex-1 truncate text-[13px] text-ink', !r.unread && 'font-semibold')}>{r.name}</b>
          <span className="shrink-0 text-[11px] text-ink-3">{listStamp(r.last_message?.created_at ?? r.updated_at)}</span>
        </span>
        <span className="flex items-center gap-1 text-[12px] text-ink-3">
          <span className="min-w-0 flex-1 truncate">{r.blocked ? 'Blocked' : r.muted ? `Muted · ${last}` : last}</span>
          {r.muted ? <span title="Muted" aria-label="Muted" className="flex shrink-0"><Icon name="bell-off" size={12} /></span> : null}
          {r.pinned ? <span title="Pinned" aria-label="Pinned" className="flex shrink-0"><Icon name="pin" size={12} /></span> : null}
        </span>
      </span>
      {badge ? <span className={cx('flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10.5px] font-bold text-white', badge.cls)} aria-label={r.muted && !r.mentions ? `${badge.text} unread, muted` : undefined}>{badge.text}</span> : null}
    </button>
  );
}

function VisitorRow({ c, active, onOpen, onMenu }: { c: WebsiteRow; active: boolean; onOpen: () => void; onMenu: (e: ReactMouseEvent) => void }) {
  const name = c.visitor_name || c.label;
  return (
    <button type="button" onClick={onOpen} onContextMenu={onMenu} className={cx('flex w-full items-center gap-2.5 px-3.5 py-[7px] text-left', active ? 'bg-selection' : 'hover:bg-subtle')}>
      <span className="relative shrink-0">
        <Avatar name={name} size={34} />
        <span className={cx('absolute -right-px -bottom-px h-[10px] w-[10px] rounded-full border-2 border-surface', c.online ? 'bg-success' : 'bg-line')} aria-label={c.online ? 'On the site now' : 'Left the site'} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex gap-1.5">
          <b className="flex-1 truncate text-[13px] text-ink">{name}</b>
          <span className="shrink-0 text-[11px] text-ink-3">{listStamp(c.last_visitor_at ?? c.updated_at)}</span>
        </span>
        <span className="block truncate text-[12px] text-ink-3">{c.online ? `On the site now${c.current_url ? ` · ${c.current_url.replace(/^https?:\/\/[^/]+/, '') || '/'}` : ''}` : (c.site ?? 'Website')}</span>
      </span>
      {c.awaiting_reply ? <span className={cx('rounded-full px-1.5 text-[10.5px] font-bold text-white', c.at_risk || c.priority === 'urgent' ? 'bg-danger' : 'bg-badge')}>{c.at_risk ? 'At risk' : 'Waiting'}</span> : null}
    </button>
  );
}

