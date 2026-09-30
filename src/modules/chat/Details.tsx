import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { useTab } from '../../core/tab-context';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Button, Empty, FileBadge, Spinner, cx } from '../../components/ui';
import { UserAvatar } from '../../components/UserAvatar';
import { GroupDetails, NotifySettings, type RoomDetail } from './NewChat';
import { mediaUrl, openAttachment, roomPerson, type ChatFile, type ChatMessage, type Room } from './types';

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

/** The conversation's details panel (ChatMain, right): who is in it and what was shared. */
export function Details({ room, onClose }: { room: Room; onClose: () => void }) {
  const qc = useQueryClient();
  const { openLink, go } = useTab();
  const [tab, setTab] = useState<Tab>('Members');
  const [dialog, setDialog] = useState<'group' | 'notify' | null>(null);
  const detail = useQuery({ queryKey: ['chat', 'room', String(room.id)], queryFn: ({ signal }) => apiGet<RoomDetail>(`/api/chat/rooms/${room.id}`, undefined, signal) });
  const ids = (detail.data?.members ?? []).map((m) => m.id).join(',');
  const presence = useQuery({ queryKey: ['chat', 'presence', ids], queryFn: ({ signal }) => apiGet<{ presence: Record<string, string> }>('/api/chat/presence', { ids }, signal), enabled: ids !== '', refetchInterval: 60_000 });
  const shared = useQuery({ queryKey: ['chat', 'shared', String(room.id)], queryFn: ({ signal }) => apiGet<Shared>(`/api/chat/rooms/${room.id}/shared`, undefined, signal), enabled: tab !== 'Members' && tab !== 'Pinned' && tab !== 'Notifications' });
  const pins = useQuery({ queryKey: ['chat', 'pins', String(room.id)], queryFn: ({ signal }) => apiGet<{ messages: ChatMessage[] }>(`/api/chat/rooms/${room.id}/pins`, undefined, signal), enabled: tab === 'Pinned' });
  const group = room.type !== 'direct';
  const members = detail.data?.members ?? [];
  const online = members.filter((m) => presence.data?.presence[String(m.id)] === 'online').length;

  const mute = async () => {
    try {
      await apiPost(`/api/chat/rooms/${room.id}/flags`, { muted: !room.muted });
      void qc.invalidateQueries({ queryKey: ['chat', 'rooms'] });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  return (
    <aside aria-label="Conversation details" className="flex w-[300px] shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex flex-col items-center gap-1.5 border-b border-line px-4 py-4">
        <UserAvatar userId={roomPerson(room)} name={room.avatar_name || room.name} size={56} className={group ? '!rounded-[14px]' : ''} />
        <b className="text-center text-[14.5px] text-ink">{room.name}</b>
        <span className="text-[12px] text-ink-3">{group ? `Group · ${members.length} members${online ? ` · ${online} online` : ''}` : 'Direct message'}</span>
        <div className="mt-1 flex gap-1.5">
          {group && detail.data?.can?.add ? <Button size="sm" onClick={() => setDialog('group')}>Add members</Button> : null}
          <Button size="sm" onClick={() => void mute()}>{room.muted ? 'Unmute' : 'Mute'}</Button>
          {group ? <Button size="sm" onClick={() => setDialog('group')} aria-label="Group details">⋯</Button> : null}
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close details">×</Button>
        </div>
      </div>
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-line px-3 py-2.5">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => (t === 'Notifications' ? setDialog('notify') : setTab(t))} className={cx('h-[26px] rounded-full px-2.5 text-[11.5px] font-semibold', tab === t ? 'bg-primary text-white' : 'border border-line bg-surface text-ink')}>
            {t}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3 text-[12.5px] scroll-thin">
        {tab === 'Members' ? (
          detail.isLoading ? <Spinner /> : (
            <div className="flex flex-col gap-2.5">
              {members.map((m) => {
                const st = PRESENCE[presence.data?.presence[String(m.id)] ?? ''];
                return (
                  <div key={m.id} className="flex items-center gap-2.5">
                    <span className="relative">
                      <UserAvatar userId={m.id} name={m.name} size={30} />
                      {st ? <span className={cx('absolute -right-0.5 -bottom-0.5 h-[10px] w-[10px] rounded-full border-2 border-surface', st.dot)} title={st.label} /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-ink">{m.name}</b>
                      <span className="block text-[11px] text-ink-3">{st?.label ?? ''}</span>
                    </span>
                    <span className="text-[11px] font-bold text-ink-2 capitalize">{m.role === 'member' ? '' : m.role}</span>
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
                  <button key={x.message_id} type="button" onClick={() => x.file && openAttachment(x.file, openLink)} className="h-[78px] overflow-hidden rounded-[8px] bg-subtle" aria-label={x.file?.filename ?? 'Media'}>
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
              <button key={x.message_id} type="button" onClick={() => x.file && openAttachment(x.file, openLink)} className="flex w-full items-center gap-2.5 border-b border-line py-2 text-left">
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
