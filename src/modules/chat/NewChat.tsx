import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiPost, apiPut, request } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Button, Modal, Spinner, cx } from '../../components/ui';
import { UserAvatar } from '../../components/UserAvatar';
import type { ChatMessage, Room } from './types';
import { Select } from '../../components/Select';
import { Checkbox } from '../../components/Checkbox';

interface Person {
  id: number;
  name: string;
  email: string | null;
}

const field = 'h-9 rounded-[8px] border border-line bg-surface px-3 text-[13px] outline-none focus:border-primary';

/** Direct / Group, as a segmented choice (ChatExtras "New conversation"). */
function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-[9px] bg-subtle p-[3px] text-[13px] font-semibold">
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={cx('h-[30px] flex-1 rounded-[7px]', value === v ? 'bg-surface text-ink shadow-sm' : 'text-ink-2')}>
          {l}
        </button>
      ))}
    </div>
  );
}

/**
 * Start a conversation: Direct opens (or reopens) a chat with one person;
 * Group makes a named group of the people ticked. The chat directory is
 * already the caller's own companies.
 */
export function NewChat({ onClose, onOpened }: { onClose: () => void; onOpened: (roomId: number) => void }) {
  const qc = useQueryClient();
  const people = useQuery({ queryKey: ['chat', 'directory'], queryFn: ({ signal }) => apiGet<{ users: Person[] }>('/api/chat/directory', undefined, signal), staleTime: 5 * 60_000 });
  const [kind, setKind] = useState<'direct' | 'group'>('direct');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const group = kind === 'group';
  const needle = q.trim().toLowerCase();
  const list = (people.data?.users ?? []).filter((p) => !needle || p.name.toLowerCase().includes(needle) || (p.email ?? '').toLowerCase().includes(needle)).slice(0, 80);

  const toggle = (id: number) => setPicked((cur) => (group ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : cur[0] === id ? [] : [id]));
  const ready = group ? picked.length > 0 && name.trim() !== '' : picked.length === 1;

  const start = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      const r = group
        ? await apiPost<{ room_id: number }>('/api/chat/rooms/group', { name: name.trim(), members: picked })
        : await apiPost<{ room_id: number }>('/api/chat/rooms/direct', { user_id: picked[0] });
      await qc.invalidateQueries({ queryKey: ['chat', 'rooms'] });
      onOpened(r.room_id);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New conversation"
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!ready} onClick={() => void start()}>
            {group ? 'Create group' : 'Start chat'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        <Segmented
          label="Kind of conversation"
          value={kind}
          options={[['direct', 'Direct'], ['group', 'Group']]}
          onChange={(k) => {
            setKind(k);
            setPicked((cur) => (k === 'direct' ? cur.slice(0, 1) : cur));
          }}
        />
        {group ? <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name the group" aria-label="Group name" maxLength={120} className={field} /> : null}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…" aria-label="Search people" autoFocus className={field} />
        <div className="max-h-72 overflow-y-auto scroll-thin" aria-label="People">
          {people.isLoading ? <Spinner /> : null}
          {list.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-2.5 rounded-[8px] px-1 py-1.5 hover:bg-subtle">
              {group ? <Checkbox name="new-chat-person" checked={picked.includes(p.id)} onChange={() => toggle(p.id)} aria-label={p.name} /> : <input type="radio" name="new-chat-person" checked={picked.includes(p.id)} onChange={() => toggle(p.id)} className="accent-[var(--color-primary)]" aria-label={p.name} />}
              <UserAvatar userId={p.id} name={p.name} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold text-ink">{p.name}</span>
                {p.email ? <span className="block truncate text-[11.5px] text-ink-3">{p.email}</span> : null}
              </span>
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/** Forward a message to conversations or people, with an optional note (ChatExtras "Forward…"). */
export function ForwardDialog({ m, rooms, onClose }: { m: ChatMessage; rooms: Room[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const needle = q.trim().toLowerCase();
  const list = rooms.filter((r) => r.id !== m.room_id && (!needle || r.name.toLowerCase().includes(needle))).slice(0, 60);
  const send = async () => {
    setBusy(true);
    try {
      await apiPost(`/api/chat/messages/${m.id}/forward`, { targets: picked.map((id) => ({ type: 'room', id })), note: note.trim() || undefined });
      toast('success', `Forwarded to ${picked.length}.`);
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Forward…"
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={picked.length === 0} onClick={() => void send()}>
            Forward to {picked.length || '…'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        <div className="rounded-[9px] bg-subtle px-3 py-2.5 text-[13px] text-ink-2">“{(m.message ?? m.file?.filename ?? '').slice(0, 160)}”</div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search conversations and people" aria-label="Search conversations" className={field} />
        <div className="max-h-60 overflow-y-auto scroll-thin">
          {list.map((r) => (
            <label key={r.id} className="flex cursor-pointer items-center gap-2.5 px-1 py-1.5">
              <Checkbox checked={picked.includes(r.id)} onChange={() => setPicked((c) => (c.includes(r.id) ? c.filter((x) => x !== r.id) : [...c, r.id]))} aria-label={r.name} />
              <b className="flex-1 truncate text-[13px] text-ink">{r.name}</b>
              <span className="text-[11.5px] text-ink-3">{r.type === 'direct' ? 'Direct' : 'Group'}</span>
            </label>
          ))}
        </div>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (optional)" aria-label="Add a note" className={field} />
      </div>
    </Modal>
  );
}

/** Starred messages, everywhere or in one conversation. */
export function StarredDialog({ roomId, onClose, onShow }: { roomId?: string; onClose: () => void; onShow: (roomId: number) => void }) {
  const q = useQuery({ queryKey: ['chat', 'starred', roomId ?? 'all'], queryFn: ({ signal }) => apiGet<{ messages: Array<ChatMessage & { room_name?: string | null }> }>('/api/chat/starred', roomId ? { room_id: roomId } : undefined, signal) });
  return (
    <Modal title="Starred messages" onClose={onClose} width={460}>
      <div className="flex max-h-[420px] flex-col gap-2 overflow-y-auto scroll-thin">
        {q.isLoading ? <Spinner /> : null}
        {!q.isLoading && !(q.data?.messages.length) ? <p className="text-[13px] text-ink-3">Nothing starred yet. Star a message from its actions to keep it here.</p> : null}
        {(q.data?.messages ?? []).map((s) => (
          <div key={s.id} className="flex flex-col gap-1 rounded-[9px] border border-line px-3 py-2.5">
            <span className="text-[11.5px] text-ink-3">
              <b className="text-ink">{s.sender_name}</b>
              {s.room_name ? ` · ${s.room_name}` : ''}
            </span>
            <span className="text-[13px] text-ink">{s.message ?? s.file?.filename}</span>
            <button type="button" className="self-start text-[12px] font-semibold text-primary hover:underline" onClick={() => onShow(s.room_id)}>
              Show in chat
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

interface Settings {
  sound: boolean;
  desktop: boolean;
  ringing: boolean;
}

/** Chat and calls notification switches, and this conversation's level (ChatExtras "Chat and calls"). */
export function NotifySettings({ room, onClose }: { room: Room | undefined; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['chat', 'notification-settings'], queryFn: ({ signal }) => apiGet<Settings>('/api/chat/notification-settings', undefined, signal) });
  const save = async (patch: Partial<Settings>) => {
    try {
      await apiPut('/api/chat/notification-settings', { ...q.data, ...patch });
      void qc.invalidateQueries({ queryKey: ['chat', 'notification-settings'] });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const level = async (v: string) => {
    if (!room) return;
    try {
      await apiPost(`/api/chat/rooms/${room.id}/flags`, v === 'muted' ? { muted: true } : { muted: false, notify_level: v });
      void qc.invalidateQueries({ queryKey: ['chat', 'rooms'] });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const row = (key: keyof Settings, title: string, hint?: string) => (
    <label className="flex items-center justify-between gap-4">
      <span className="flex flex-col">
        <b className="text-[13px] text-ink">{title}</b>
        {hint ? <span className="text-[12px] text-ink-3">{hint}</span> : null}
      </span>
      <Checkbox checked={!!q.data?.[key]} disabled={!q.data} onChange={(e) => void save({ [key]: e.target.checked })} />
    </label>
  );
  return (
    <Modal title="Chat and calls" onClose={onClose} width={420}>
      <div className="flex flex-col gap-3">
        {row('desktop', 'Desktop notifications', 'Shown by the system even when WorkSuite is in the background')}
        {row('sound', 'Message sound')}
        {row('ringing', 'Ring for incoming calls')}
        {room ? (
          <label className="flex flex-col gap-1.5">
            <b className="text-[13px] text-ink">This conversation</b>
            <Select value={room.muted ? 'muted' : ((room as Room & { notify_level?: string }).notify_level ?? 'all')} onChange={(e) => void level(e.target.value)} className={field}>
              <option value="all">All messages</option>
              <option value="mentions">Only mentions</option>
              <option value="muted">Muted</option>
            </Select>
          </label>
        ) : null}
      </div>
    </Modal>
  );
}

export function GroupDetails({ roomId, onClose, onLeft }: { roomId: number; onClose: () => void; onLeft: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['chat', 'room', String(roomId)], queryFn: ({ signal }) => apiGet<RoomDetail>(`/api/chat/rooms/${roomId}`, undefined, signal) });
  const [name, setName] = useState<string | null>(null);
  const [desc, setDesc] = useState<string | null>(null);
  const d = q.data;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['chat', 'room', String(roomId)] });
    void qc.invalidateQueries({ queryKey: ['chat', 'rooms'] });
  };
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <Modal
      title="About this group"
      onClose={onClose}
      width={480}
      footer={
        <>
          {d?.can?.leave ? (
            <Button variant="ghost" className="!text-danger" onClick={() => void act(() => apiPost(`/api/chat/rooms/${roomId}/leave`)).then(onLeft)}>
              Leave group
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button variant="primary" disabled={name === null && desc === null} onClick={() => void act(() => apiPut(`/api/chat/rooms/${roomId}`, { name: name ?? d?.room.name, description: desc ?? d?.room.description ?? '' })).then(onClose)}>
            Save
          </Button>
        </>
      }
    >
      {q.isLoading || !d ? (
        <Spinner />
      ) : (
        <div className="flex flex-col gap-2.5">
          <input value={name ?? d.room.name} onChange={(e) => setName(e.target.value)} aria-label="Name" disabled={!d.can?.rename} className={field} />
          <input value={desc ?? d.room.description ?? ''} onChange={(e) => setDesc(e.target.value)} aria-label="Description" placeholder="What is this group for?" disabled={!d.can?.rename} className={field} />
          <b className="mt-1 text-[13px] text-ink">Members · {d.members.length}</b>
          <div className="flex max-h-64 flex-col gap-2 overflow-y-auto scroll-thin">
            {d.members.map((m) => (
              <div key={m.id} className="flex items-center gap-2.5">
                <UserAvatar userId={m.id} name={m.name} size={28} />
                <b className="flex-1 truncate text-[13px] text-ink">{m.name}</b>
                <span className="text-[11px] font-bold text-ink-2 capitalize">{m.role === 'member' ? '' : m.role}</span>
                {m.can && (m.can.make_admin || m.can.remove_admin || m.can.make_owner || m.can.remove) ? (
                  <Select
                    aria-label={`Actions for ${m.name}`}
                    value=""
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === 'admin' || v === 'member') void act(() => apiPut(`/api/chat/rooms/${roomId}/members/${m.id}`, { role: v }));
                      if (v === 'owner') void act(() => apiPost(`/api/chat/rooms/${roomId}/owner`, { user_id: m.id }));
                      if (v === 'remove') void act(() => request('DELETE', `/api/chat/rooms/${roomId}/members/${m.id}`));
                    }}
                    className="h-7 rounded-[7px] border border-line bg-surface text-[11.5px]"
                  >
                    <option value="">⋯</option>
                    {m.can.make_admin ? <option value="admin">Make admin</option> : null}
                    {m.can.remove_admin ? <option value="member">Remove as admin</option> : null}
                    {m.can.make_owner ? <option value="owner">Make owner</option> : null}
                    {m.can.remove ? <option value="remove">Remove from group</option> : null}
                  </Select>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

export interface RoomDetail {
  room: { id: number; type: string; name: string; description?: string | null; created_by?: number | null; created_by_name?: string | null };
  members: Array<{ id: number; name: string; email: string | null; role: string; joined_at: string | null; can?: { remove?: boolean; make_admin?: boolean; remove_admin?: boolean; make_owner?: boolean } }>;
  my_role: string | null;
  can?: { rename?: boolean; add?: boolean; leave?: boolean };
}

