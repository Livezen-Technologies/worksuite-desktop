import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import type { ApiResult } from '../../core/api';
import { apiGet, apiPost, apiPut } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Button, Modal, TextField, cx } from '../../components/ui';
import { startCall } from '../calls/start';
import { MAX_PINNED, MUTE_MINUTES, roomKind, type BulkAction, type RoomAction, type WaAction, type WebsiteAction } from './menus';
import { WA, readWa, type WaChat } from './channels/whatsapp';
import type { Room } from './types';
import { websiteAction, type WebsiteRow } from './website/api';
import { openChatWindow } from './window';

/**
 * What the conversation menu's actions do (worksuite-desktop#183).
 *
 * Pin, archive, favourite, mute and read state are this person's, kept on the
 * server so every device shows the same: the list changes at once, and the
 * change goes through the offline queue, so one made offline is sent when the
 * connection is back. If the server says no, the list is read again and the
 * reason shown.
 *
 * Clearing, deleting, blocking, leaving and exporting ask first. A deleted
 * chat leaves the list at once with an Undo for five seconds; only then is
 * the server told.
 */

/** How long Undo is offered after deleting a chat. */
export const UNDO_MS = 5000;

const ROOMS = ['chat', 'rooms'] as const;
type RoomsData = ApiResult<{ rooms: Room[] }>;

type Flags = Partial<{ pinned: boolean; archived: boolean; favorite: boolean; muted: boolean; muted_minutes: number; read: boolean; unread: boolean }>;

/** The list as it should look after these flags, before the server answers. */
export function withFlags(r: Room, f: Flags): Room {
  const next: Room = { ...r };
  if (f.pinned !== undefined) next.pinned = f.pinned;
  if (f.archived !== undefined) next.archived = f.archived;
  if (f.favorite !== undefined) next.favorite = f.favorite;
  if (f.muted !== undefined) {
    next.muted = f.muted;
    next.muted_until = f.muted && f.muted_minutes ? new Date(Date.now() + f.muted_minutes * 60_000).toISOString() : null;
  }
  if (f.read) Object.assign(next, { unread: 0, mentions: 0, marked_unread: false });
  if (f.unread) Object.assign(next, { unread: Math.max(1, r.unread), marked_unread: true });
  return next;
}

function patchRooms(qc: QueryClient, f: (rooms: Room[]) => Room[]): void {
  qc.setQueryData<RoomsData>(ROOMS, (old) => (old?.data ? { ...old, data: { ...old.data, rooms: f(old.data.rooms) } } : old));
}

/** One change through the offline queue: sent now, or when the connection is back. */
async function submit(label: string, path: string, body: unknown, entityId: string | null): Promise<void> {
  const r = await call('offline:submit', { module: 'chat', entity: 'room', entityId, label: label.slice(0, 200), method: 'POST', path, body, queueIfOffline: true });
  if (r && !r.delivered && !r.queued) throw new Error(r.error ?? 'The change was not saved.');
  if (r?.queued) toast('info', 'Offline — the change saves when you reconnect.');
}

interface Ask {
  what: 'clear' | 'delete' | 'delete-group' | 'block' | 'leave' | 'export' | 'rename';
  rooms: Room[];
}

export interface RoomActionsOptions {
  /** Show the conversation's details (Contact info, Group info, Add members, meeting details). */
  onInfo?: (r: Room) => void;
  /** The conversation that is open now: deleting or leaving it goes back to the list. */
  openId?: string | null;
  onGone?: () => void;
}

export function useRoomActions(opts: RoomActionsOptions = {}) {
  const qc = useQueryClient();
  const [ask, setAsk] = useState<Ask | null>(null);
  const rooms = () => qc.getQueryData<RoomsData>(ROOMS)?.data?.rooms ?? [];
  const refresh = () => void qc.invalidateQueries({ queryKey: ROOMS });

  const flags = async (targets: Room[], f: Flags, label: string) => {
    if (!targets.length) return;
    if (f.pinned) {
      const pinned = rooms().filter((r) => r.pinned).length;
      const adding = targets.filter((r) => !r.pinned).length;
      if (pinned + adding > MAX_PINNED) {
        toast('error', `You can pin up to ${MAX_PINNED} conversations. Unpin one first.`);
        return;
      }
    }
    const ids = new Set(targets.map((r) => r.id));
    patchRooms(qc, (all) => all.map((r) => (ids.has(r.id) ? withFlags(r, f) : r)));
    try {
      if (targets.length === 1) await submit(label, `/api/chat/rooms/${targets[0]!.id}/flags`, f, String(targets[0]!.id));
      else await submit(label, '/api/chat/rooms/flags', { room_ids: [...ids], ...f }, null);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      refresh();
    }
  };

  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  /** Gone from the list now; the server is told after the Undo window. */
  const deleteChats = (targets: Room[]) => {
    if (!targets.length) return;
    const gone = new Set(targets.map((r) => r.id));
    const before = rooms();
    patchRooms(qc, (all) => all.filter((r) => !gone.has(r.id)));
    if (opts.openId && gone.has(Number(opts.openId))) opts.onGone?.();
    let undone = false;
    const key = targets[0]!.id;
    const timer = setTimeout(() => {
      timers.current.delete(key);
      if (undone) return;
      void Promise.all(targets.map((r) => apiPost(`/api/chat/rooms/${r.id}/delete`)))
        .catch((e) => toast('error', errorMessage(e)))
        .finally(refresh);
    }, UNDO_MS);
    timers.current.set(key, timer);
    toast(
      'info',
      targets.length === 1 ? `Chat with ${targets[0]!.name} deleted.` : `${targets.length} chats deleted.`,
      {
        label: 'Undo',
        run: () => {
          undone = true;
          clearTimeout(timer);
          timers.current.delete(key);
          const back = before.filter((r) => gone.has(r.id));
          patchRooms(qc, (all) => [...all.filter((r) => !gone.has(r.id)), ...back]);
        },
      },
      UNDO_MS,
    );
  };

  const run = (r: Room, a: RoomAction) => {
    switch (a) {
      case 'open-window':
        return void openChatWindow(r.id, r.name).catch((e) => toast('error', errorMessage(e)));
      case 'read':
        return void flags([r], { read: true }, `Mark ${r.name} as read`);
      case 'unread':
        return void flags([r], { unread: true }, `Mark ${r.name} as unread`);
      case 'pin':
      case 'unpin':
        return void flags([r], { pinned: a === 'pin' }, `${a === 'pin' ? 'Pin' : 'Unpin'} ${r.name}`);
      case 'archive':
      case 'unarchive':
        return void flags([r], { archived: a === 'archive' }, `${a === 'archive' ? 'Archive' : 'Unarchive'} ${r.name}`);
      case 'favorite':
      case 'unfavorite':
        return void flags([r], { favorite: a === 'favorite' }, `${a === 'favorite' ? 'Favourite' : 'Unfavourite'} ${r.name}`);
      case 'mute-8h':
      case 'mute-week':
      case 'mute-always':
        return void flags([r], { muted: true, muted_minutes: MUTE_MINUTES[a] }, `Mute ${r.name}`);
      case 'unmute':
        return void flags([r], { muted: false }, `Unmute ${r.name}`);
      case 'info':
      case 'add-members':
        return opts.onInfo?.(r);
      case 'call':
      case 'video':
        return void startCall(r.id, a === 'call' ? 'audio' : 'video', r.name).catch((e) => toast('error', errorMessage(e)));
      case 'unblock':
        return void apiPost(`/api/chat/rooms/${r.id}/unblock`).then(() => toast('success', `${r.name} is unblocked.`), (e) => toast('error', errorMessage(e))).finally(refresh);
      case 'block':
      case 'export':
      case 'clear':
      case 'leave':
      case 'delete':
      case 'delete-group':
      case 'rename':
        return setAsk({ what: a, rooms: [r] });
    }
  };

  const bulk = (targets: Room[], a: BulkAction) => {
    const n = `${targets.length} conversations`;
    if (a === 'read' || a === 'unread') return void flags(targets, { [a]: true }, `Mark ${n} as ${a}`);
    if (a === 'archive' || a === 'unarchive') return void flags(targets, { archived: a === 'archive' }, `${a === 'archive' ? 'Archive' : 'Unarchive'} ${n}`);
    if (a === 'mute' || a === 'unmute') return void flags(targets, { muted: a === 'mute' }, `${a === 'mute' ? 'Mute' : 'Unmute'} ${n}`);
    const deletable = targets.filter((r) => roomKind(r) !== 'system' && roomKind(r) !== 'meeting');
    if (deletable.length) setAsk({ what: 'delete', rooms: deletable });
  };

  const close = () => setAsk(null);
  const dialogs: ReactNode = ask ? (
    <ConfirmDialog
      ask={ask}
      onClose={close}
      onDelete={() => (close(), deleteChats(ask.rooms))}
      onDone={(gone) => {
        close();
        refresh();
        if (gone && opts.openId && ask.rooms.some((r) => String(r.id) === opts.openId)) opts.onGone?.();
      }}
    />
  ) : null;

  return { run, bulk, dialogs, ask: (what: Ask['what'], targets: Room[]) => setAsk({ what, rooms: targets }) };
}

function ConfirmDialog({ ask, onClose, onDelete, onDone }: { ask: Ask; onClose: () => void; onDelete: () => void; onDone: (gone: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [keepStarred, setKeepStarred] = useState(true);
  const [format, setFormat] = useState<'txt' | 'zip'>('txt');
  const [media, setMedia] = useState(false);
  const r = ask.rooms[0]!;
  const [name, setName] = useState(r.name);
  const act = async (fn: () => Promise<unknown>, done: string | null, gone = false) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast('success', done);
      onDone(gone);
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };
  const many = ask.rooms.length > 1;
  const footer = (label: string, go: () => void, danger = true, disabled = false) => (
    <>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant={danger ? 'danger' : 'primary'} loading={busy} disabled={disabled} onClick={go}>
        {label}
      </Button>
    </>
  );

  switch (ask.what) {
    case 'delete':
      return (
        <Modal title={many ? `Delete ${ask.rooms.length} chats?` : 'Delete this chat?'} onClose={onClose} width={420} footer={footer('Delete', onDelete)}>
          <p className="text-[13px] text-ink-2">{many ? 'They are deleted for you only.' : `The chat with ${r.name} is deleted for you only.`} Everybody else keeps their messages. If somebody writes again, it comes back.</p>
        </Modal>
      );
    case 'clear':
      return (
        <Modal title="Clear this chat?" onClose={onClose} width={420} footer={footer('Clear chat', () => void act(() => apiPost(`/api/chat/rooms/${r.id}/clear`, { keep_starred: keepStarred }), 'Chat cleared.'))}>
          <p className="mb-3 text-[13px] text-ink-2">Every message in {r.name} is removed for you only. Everybody else keeps theirs.</p>
          <label className="flex items-center gap-2 text-[13px] text-ink">
            <Checkbox checked={keepStarred} onChange={(e) => setKeepStarred(e.target.checked)} /> Keep starred messages
          </label>
        </Modal>
      );
    case 'delete-group':
      return (
        <Modal title="Delete this group for everyone?" onClose={onClose} width={440} footer={footer('Delete for everyone', () => void act(() => apiPost(`/api/chat/rooms/${r.id}/delete-for-everyone`), `${r.name} was deleted.`, true))}>
          <p className="text-[13px] text-ink-2">
            <b className="text-ink">{r.name}</b> and all its messages are deleted for every member. This can&apos;t be undone.
          </p>
        </Modal>
      );
    case 'leave':
      return (
        <Modal title={`Leave ${r.name}?`} onClose={onClose} width={420} footer={footer('Leave', () => void act(() => apiPost(`/api/chat/rooms/${r.id}/leave`), `You left ${r.name}.`, true))}>
          <p className="text-[13px] text-ink-2">You stop getting its messages. Somebody in it can add you again.</p>
        </Modal>
      );
    case 'block':
      return (
        <Modal title={`Block ${r.name}?`} onClose={onClose} width={420} footer={footer('Block', () => void act(() => apiPost(`/api/chat/rooms/${r.id}/block`), `${r.name} is blocked.`))}>
          <p className="text-[13px] text-ink-2">{r.name} can no longer message you. They aren&apos;t told. You can unblock them from this chat at any time.</p>
        </Modal>
      );
    case 'rename':
      return (
        <Modal title="Rename" onClose={onClose} width={420} footer={footer('Save', () => void act(() => apiPut(`/api/chat/rooms/${r.id}`, { name: name.trim() }), null), false, !name.trim())}>
          <TextField label="Name" value={name} autoFocus maxLength={190} onChange={(e) => setName(e.target.value)} />
        </Modal>
      );
    case 'export':
      return (
        <Modal
          title="Export chat"
          onClose={onClose}
          width={440}
          footer={footer(
            'Export',
            () =>
              void act(
                () => call('transfers:download', { chatExport: { room: r.id, format, media: format === 'zip' && media }, name: `${`Chat - ${r.name}`.replace(/[\\/:*?"<>|]/g, '-').slice(0, 180)}.${format}` }),
                null,
              ),
            false,
          )}
        >
          <p className="mb-3 text-[13px] text-ink-2">The conversation as you see it. Your organisation&apos;s export policy applies, and the export is recorded in the audit log.</p>
          <div role="radiogroup" aria-label="Format" className="flex flex-col gap-2 text-[13px] text-ink">
            {(
              [
                ['txt', 'Text file (.txt)'],
                ['zip', 'Zip file (.zip)'],
              ] as const
            ).map(([id, label]) => (
              <label key={id} className="flex items-center gap-2">
                <input type="radio" name="chat-export-format" checked={format === id} onChange={() => setFormat(id)} /> {label}
              </label>
            ))}
            <label className={cx('ml-6 flex items-center gap-2', format !== 'zip' && 'opacity-50')}>
              <Checkbox checked={media} disabled={format !== 'zip'} onChange={(e) => setMedia(e.target.checked)} /> Include media
            </label>
          </div>
        </Modal>
      );
  }
}

/* ------------------------------------------------------------------ WhatsApp */

/** WhatsApp's menu actions: the inbox's own endpoints (pin, mute, assign, status), and Contacts. */
export function useWhatsappActions(me: number | null) {
  const qc = useQueryClient();
  const [picking, setPicking] = useState<WaChat | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['whatsapp'] });
  const update = (c: WaChat, body: Record<string, unknown>, done?: string) =>
    void apiPut(`${WA}/chats/${c.id}`, body).then(
      () => (done ? toast('success', done) : undefined, refresh()),
      (e) => toast('error', errorMessage(e)),
    );
  const run = (c: WaChat, a: WaAction) => {
    switch (a) {
      case 'read':
        return void readWa(c.id).then(refresh, (e) => toast('error', errorMessage(e)));
      case 'pin':
      case 'unpin':
        return update(c, { is_pinned: a === 'pin' });
      case 'mute':
      case 'unmute':
        return update(c, { is_muted: a === 'mute' });
      case 'waiting':
        return update(c, { status: 'pending' }, 'Marked as waiting.');
      case 'done':
        return update(c, { status: 'resolved' }, 'Marked as done.');
      case 'reopen':
        return update(c, { status: 'open' });
      case 'assign-me':
        return update(c, { assigned_to: me }, 'Assigned to you.');
      case 'unassign':
        return update(c, { assigned_to: null }, 'Unassigned.');
      case 'assign':
        return setPicking(c);
      case 'contacts':
        return void apiPost('/api/contacts', { display_name: c.name, mobile: c.phone && /^\d+$/.test(c.phone) ? `+${c.phone}` : (c.phone ?? '') }).then(
          () => toast('success', `${c.name} is in your contacts.`),
          (e) => toast('error', errorMessage(e)),
        );
      case 'open-web':
        return void call('app:openInBrowser', { path: `/whatsapp?chat=${c.id}` });
    }
  };
  const dialogs = picking ? <PersonPicker title={`Assign ${picking.name} to…`} onClose={() => setPicking(null)} onPick={(p) => (setPicking(null), update(picking, { assigned_to: p.id }, `Assigned to ${p.name}.`))} /> : null;
  return { run, dialogs, busy: picking !== null };
}

function PersonPicker({ title, onClose, onPick }: { title: string; onClose: () => void; onPick: (p: { id: number; name: string }) => void }) {
  const [q, setQ] = useState('');
  const people = useQuery({ queryKey: ['chat', 'directory'], queryFn: ({ signal }) => apiGet<{ users: Array<{ id: number; name: string; email?: string | null }> }>('/api/chat/directory', undefined, signal), staleTime: 5 * 60_000 });
  const needle = q.trim().toLowerCase();
  const shown = (people.data?.users ?? []).filter((p) => !needle || p.name.toLowerCase().includes(needle) || (p.email ?? '').toLowerCase().includes(needle)).slice(0, 50);
  return (
    <Modal title={title} onClose={onClose} width={420}>
      <TextField label="Search people" value={q} autoFocus onChange={(e) => setQ(e.target.value)} />
      <ul className="mt-2 max-h-72 overflow-y-auto">
        {shown.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => onPick(p)} className="flex w-full flex-col rounded-[8px] px-2.5 py-1.5 text-left hover:bg-subtle">
              <b className="text-[13px] text-ink">{p.name}</b>
              {p.email ? <span className="text-[12px] text-ink-3">{p.email}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/* ------------------------------------------------------------------ Website */

/** Website chats' menu actions: the workspace's own assign, transfer and close. */
export function useWebsiteActions(me: number | null, open: (c: WebsiteRow) => void) {
  const qc = useQueryClient();
  const act = (c: WebsiteRow, action: string, extra: Record<string, unknown>, done: string) =>
    void websiteAction(c.id, action, extra).then(
      () => (toast('success', done), void qc.invalidateQueries({ queryKey: ['website'] })),
      (e) => toast('error', errorMessage(e)),
    );
  return (c: WebsiteRow, a: WebsiteAction, userId?: number) => {
    switch (a) {
      case 'open':
        return open(c);
      case 'assign-me':
        return act(c, 'assign', { user_id: me }, 'Assigned to you.');
      case 'transfer':
        return act(c, 'assign', { user_id: userId }, c.assigned_to === null ? 'Assigned.' : 'Transferred.');
      case 'unassign':
        return act(c, 'assign', { user_id: null }, 'Unassigned.');
      case 'close':
        return act(c, 'close', {}, 'Conversation closed.');
      case 'reopen':
        return act(c, 'reopen', {}, 'Conversation reopened.');
      case 'star':
        return act(c, 'star', {}, 'Starred.');
    }
  };
}
