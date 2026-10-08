import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { useTab } from '../../core/tab-context';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Empty, FileBadge, Spinner, cx } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { startCall } from '../calls/start';
import { UserAvatar } from '../../components/UserAvatar';
import { GroupDetails, NotifySettings, type RoomDetail } from './NewChat';
import { openChatAttachment } from './AttachmentViewer';
import { mediaUrl, roomPerson, type ChatFile, type ChatMessage, type Room } from './types';
import { usePresence } from './presence';

type Shared = Record<'media' | 'files' | 'links' | 'audio', Array<{ message_id: number; sender_name: string; created_at: string; file?: ChatFile; url?: string }>>;

const TABS = ['Members', 'Media', 'Files', 'Links', 'Audio', 'Pinned', 'Notifications'] as const;
type Tab = (typeof TABS)[number];

export const PRESENCE: Record<string, { dot: string; label: string }> = {
  online: { dot: 'bg-success', label: 'Online' },
  busy: { dot: 'bg-danger', label: 'Busy' },
  dnd: { dot: 'bg-danger', label: 'Do not disturb' },
  away: { dot: 'bg-warning', label: 'Away' },
  offline: { dot: 'bg-line', label: 'Offline' },
};

/** A round action under the conversation's name: Call, Video, Mute, Add, More — the web chat's details, on the desktop. */
function QuickAction({ icon, label, onClick, on = false }: { icon: string; label: string; onClick: () => void; on?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on || undefined} className="group flex w-[58px] flex-col items-center gap-1 rounded-[10px] py-1 text-[11px] font-medium text-ink-2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-primary">
      <span className={cx('flex h-9 w-9 items-center justify-center rounded-full border transition-colors', on ? 'border-primary bg-selection text-primary' : 'border-line bg-surface group-hover:bg-subtle')}>
        <Icon name={icon} size={16} />
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

/**
 * The conversation's details panel (ChatMain, right), laid out as the web chat's details: a header with the
 * conversation's kind and Close, who it is (with their presence) and the quick actions, then one row of tabs with
 * counts — Members, Media, Files, Links, Audio, Pinned, Notifications.
 */
export function Details({ room, onClose }: { room: Room; onClose: () => void }) {
  const qc = useQueryClient();
  const { openLink, go } = useTab();
  const me = useStore(app, (s) => (s.auth?.user?.id ? Number(s.auth.user.id) : null));
  const [tab, setTab] = useState<Tab>('Members');
  const [dialog, setDialog] = useState<'group' | 'notify' | null>(null);
  const detail = useQuery({ queryKey: ['chat', 'room', String(room.id)], queryFn: ({ signal }) => apiGet<RoomDetail>(`/api/chat/rooms/${room.id}`, undefined, signal) });
  const person = roomPerson(room);
  const presenceOf = usePresence([...(detail.data?.members ?? []).map((m) => m.id), person]);
  const shared = useQuery({ queryKey: ['chat', 'shared', String(room.id)], queryFn: ({ signal }) => apiGet<Shared>(`/api/chat/rooms/${room.id}/shared`, undefined, signal), enabled: tab !== 'Members' && tab !== 'Pinned' && tab !== 'Notifications' });
  const pins = useQuery({ queryKey: ['chat', 'pins', String(room.id)], queryFn: ({ signal }) => apiGet<{ messages: ChatMessage[] }>(`/api/chat/rooms/${room.id}/pins`, undefined, signal), enabled: tab === 'Pinned' });
  const group = room.type !== 'direct';
  const callable = room.type === 'direct' || room.type === 'group';
  const members = detail.data?.members ?? [];
  const online = members.filter((m) => presenceOf(m.id) === 'online').length;
  const status = !group && person ? PRESENCE[presenceOf(person) ?? ''] : undefined;
  const counts: Partial<Record<Tab, number>> = {
    Members: detail.data ? members.length : undefined,
    Media: shared.data?.media.length,
    Files: shared.data?.files.length,
    Links: shared.data?.links.length,
    Audio: shared.data?.audio.length,
    Pinned: pins.data?.messages.length,
  };

  const mute = async () => {
    try {
      await apiPost(`/api/chat/rooms/${room.id}/flags`, { muted: !room.muted });
      void qc.invalidateQueries({ queryKey: ['chat', 'rooms'] });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const call = (kind: 'audio' | 'video') => void startCall(room.id, kind, room.name).catch((e) => toast('error', errorMessage(e)));

  return (
    <aside aria-label="Conversation details" className="flex w-[320px] shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3.5">
        <Icon name="info" size={16} className="shrink-0 text-ink-3" />
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{group ? 'Group info' : 'Contact info'}</h2>
        <button type="button" onClick={onClose} aria-label="Close details" title="Close details" className="flex h-7 w-7 items-center justify-center rounded-[7px] text-ink-3 hover:bg-subtle hover:text-ink">
          <Icon name="x" size={15} />
        </button>
      </div>
      <div className="flex shrink-0 flex-col items-center gap-1 border-b border-line px-4 pt-5 pb-3.5">
        <span className="relative">
          <UserAvatar userId={person} name={room.avatar_name || room.name} size={64} className={group ? '!rounded-[16px]' : ''} />
          {status ? <span className={cx('absolute right-0.5 bottom-0.5 h-3.5 w-3.5 rounded-full border-[2.5px] border-surface', status.dot)} title={status.label} /> : null}
        </span>
        <b className="mt-1.5 max-w-full truncate text-center text-[15px] text-ink">{room.name}</b>
        <span className="text-[12px] text-ink-3">
          {group ? `${room.type === 'meeting' ? 'Meeting chat' : 'Group'} · ${members.length} member${members.length === 1 ? '' : 's'}${online ? ` · ${online} online` : ''}` : status ? `${status.label} · Direct message` : 'Direct message'}
        </span>
        {room.muted ? <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-subtle px-2 py-0.5 text-[11px] font-semibold text-ink-2"><Icon name="bell-off" size={11} /> Muted</span> : null}
        <div className="mt-2.5 flex justify-center gap-1">
          {callable ? <QuickAction icon="phone" label="Call" onClick={() => call('audio')} /> : null}
          {callable ? <QuickAction icon="video" label="Video" onClick={() => call('video')} /> : null}
          <QuickAction icon={room.muted ? 'bell' : 'bell-off'} label={room.muted ? 'Unmute' : 'Mute'} on={!!room.muted} onClick={() => void mute()} />
          {group && detail.data?.can?.add ? <QuickAction icon="user-plus" label="Add" onClick={() => setDialog('group')} /> : null}
          {group ? <QuickAction icon="more" label="More" onClick={() => setDialog('group')} /> : null}
        </div>
      </div>
      <div role="tablist" aria-label="Conversation details" className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-3 py-2 scroll-thin">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => (t === 'Notifications' ? setDialog('notify') : setTab(t))} className={cx('flex h-[26px] shrink-0 items-center gap-1 rounded-full px-2.5 text-[11.5px] font-semibold transition-colors', tab === t ? 'bg-ink text-surface' : 'text-ink-2 hover:bg-subtle hover:text-ink')}>
            {t}
            {counts[t] !== undefined ? <span className={cx('tabular-nums', tab === t ? 'opacity-70' : 'text-ink-3')}>{counts[t]}</span> : null}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3 text-[12.5px] scroll-thin">
        {tab === 'Members' ? (
          detail.isLoading ? <Spinner /> : (
            <div className="-mx-1.5 flex flex-col">
              {members.map((m) => {
                const st = PRESENCE[presenceOf(m.id) ?? ''];
                return (
                  <div key={m.id} className="flex items-center gap-2.5 rounded-[8px] px-1.5 py-1.5 hover:bg-subtle">
                    <span className="relative">
                      <UserAvatar userId={m.id} name={m.name} size={32} />
                      {st ? <span className={cx('absolute -right-0.5 -bottom-0.5 h-[10px] w-[10px] rounded-full border-2 border-surface', st.dot)} title={st.label} /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-ink">{m.name}{m.id === me ? <span className="font-normal text-ink-3"> (you)</span> : null}</b>
                      <span className="block text-[11px] text-ink-3">{st?.label ?? ''}</span>
                    </span>
                    {m.role && m.role !== 'member' ? <span className="rounded-full bg-subtle px-2 py-0.5 text-[10.5px] font-bold text-ink-2 capitalize">{m.role}</span> : null}
                  </div>
                );
              })}
            </div>
          )
        ) : null}
        {tab === 'Media' ? (
          shared.isLoading ? <Spinner /> : shared.data?.media.length ? (
            <div className="grid grid-cols-3 gap-1.5">
              {shared.data.media.map((x) => {
                const src = mediaUrl(x.file?.thumb_url ?? x.file?.url);
                return src ? (
                  <button key={x.message_id} type="button" onClick={() => x.file && openChatAttachment(x.file, openLink, shared.data?.media.flatMap((y) => (y.file ? [y.file] : [])))} className="h-[78px] overflow-hidden rounded-[8px] bg-subtle" aria-label={x.file?.filename ?? 'Media'}>
                    <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
                  </button>
                ) : null;
              })}
            </div>
          ) : <Empty icon="img" title="No photos or videos" />
        ) : null}
        {tab === 'Files' || tab === 'Audio' ? (
          shared.isLoading ? <Spinner /> : (shared.data?.[tab === 'Files' ? 'files' : 'audio'] ?? []).length ? (
            (shared.data?.[tab === 'Files' ? 'files' : 'audio'] ?? []).map((x) => (
              <button key={x.message_id} type="button" onClick={() => x.file && openChatAttachment(x.file, openLink)} className="flex w-full items-center gap-2.5 border-b border-line py-2 text-left">
                <FileBadge name={x.file?.filename ?? 'file'} size={30} />
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-ink">{x.file?.filename}</b>
                  <span className="text-[11px] text-ink-3">{x.sender_name} · {dateLabel(x.created_at)}</span>
                </span>
              </button>
            ))
          ) : <Empty icon={tab === 'Files' ? 'file' : 'mic'} title={tab === 'Files' ? 'No files shared' : 'No voice messages'} />
        ) : null}
        {tab === 'Links' ? (
          shared.isLoading ? <Spinner /> : shared.data?.links.length ? (
            shared.data.links.map((x) => (
              <button key={`${x.message_id}-${x.url}`} type="button" onClick={() => x.url && openLink(x.url)} className="block w-full border-b border-line py-2 text-left">
                <span className="block truncate font-semibold text-primary">{x.url}</span>
                <span className="text-[11px] text-ink-3">{x.sender_name} · {dateLabel(x.created_at)}</span>
              </button>
            ))
          ) : <Empty icon="link" title="No links shared" />
        ) : null}
        {tab === 'Pinned' ? (
          pins.isLoading ? <Spinner /> : pins.data?.messages.length ? (
            pins.data.messages.map((m) => (
              <div key={m.id} className="mb-2 rounded-[9px] border border-line px-3 py-2">
                <span className="text-[11px] text-ink-3"><b className="text-ink">{m.sender_name}</b> · {dateLabel(m.created_at)}</span>
                <p className="mt-0.5 text-ink">{m.message ?? m.file?.filename}</p>
              </div>
            ))
          ) : <Empty icon="pin" title="Nothing pinned" hint="Pin a message from its actions to keep it at the top." />
        ) : null}
      </div>
      {dialog === 'group' ? <GroupDetails roomId={room.id} onClose={() => setDialog(null)} onLeft={() => go('/chat')} /> : null}
      {dialog === 'notify' ? <NotifySettings room={room} onClose={() => setDialog(null)} /> : null}
    </aside>
  );
}
