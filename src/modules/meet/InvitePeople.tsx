import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { apiDelete, apiGet, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { UserAvatar } from '../../components/UserAvatar';
import { Icon } from '../../components/Icon';
import { Button, Modal, Spinner, cx } from '../../components/ui';
import { useNow } from '../calls/parts';
import { openChatWindow } from '../chat/window';
import { INVITE_TONE, inviteActions, inviteLabel, inviteStateOf, nextRead, type InviteAction, type Ring } from './invites';
import { meet } from './session';

/**
 * Inviting people into a meeting that is on (worksuite-desktop#79): Add people
 * in the People panel picks them from everyone in WorkSuite — with their
 * picture and whether they are available — and Invite & Ring rings each of
 * them. The panel shows how each invitation stands, with Cancel while it
 * rings and Ring again after a short wait. Who may invite is the room's
 * setting; the server checks it again.
 *
 * How each stands is the server's (worksuite-desktop#347): Ringing until it is
 * answered or runs out, Joining… only after Accept, then In the meeting or
 * Couldn't join — see `invites.ts`.
 */

export interface Invitable {
  id: number;
  name: string;
  email: string | null;
  avatar: string | null;
  status: 'online' | 'away' | 'busy' | 'dnd' | 'offline' | string;
  in_call: boolean;
  /** A ring to them is still ringing, was just answered, or they were rung three times lately: not again yet. */
  pending: 'ringing' | 'cooldown' | 'too_many' | null;
}

export type { InviteState, Ring, RingState } from './invites';

const STATUS: Record<string, [string, string]> = {
  online: ['Available', 'bg-success'],
  away: ['Away', 'bg-warning'],
  busy: ['Busy', 'bg-danger'],
  dnd: ['Do not disturb', 'bg-danger'],
  offline: ['Offline', 'bg-ink-3'],
};

/**
 * The invitations, read from the server — never kept from before: it is read
 * again after a reconnect (`realtime:resync`, which bumps `ringsVersion`) and
 * on every change the server announces, and just after its own clock settles
 * the next one (worksuite-desktop#347).
 */
export function useRings() {
  const uuid = meet.uuid;
  return useQuery({
    queryKey: ['meet', uuid, 'rings', meet.ringsVersion],
    queryFn: ({ signal }) => apiGet<{ rings: Ring[] }>(`/api/meet/${uuid}/rings`, undefined, signal),
    // Read again under a new version: the list stays on screen meanwhile.
    placeholderData: keepPreviousData,
    refetchInterval: (q) => nextRead(q.state.data?.rings ?? [], q.state.dataUpdatedAt || Date.now(), Date.now()),
  });
}

/** Ring these people; the server says who was rung, who could not be and why. */
async function ringPeople(userIds: number[]): Promise<void> {
  const r = await apiPost<{ rings: Array<{ user_id: number; state: string; invite_state?: string; why?: string; message?: string }> }>(`/api/meet/${meet.uuid}/ring`, { user_ids: userIds });
  const rung = r.rings.filter((x) => x.state === 'ringing').length;
  const busy = r.rings.filter((x) => x.invite_state === 'busy').length;
  const away = r.rings.filter((x) => x.state === 'unavailable').length - busy;
  const limited = r.rings.find((x) => x.why === 'too_many');
  const skipped = r.rings.filter((x) => x.state === 'skipped' && x.why !== 'too_many').length;
  const parts = [
    rung ? `Ringing ${rung}` : null,
    busy ? `${busy} busy in another call — they get a missed invitation` : null,
    away ? `${away} unavailable — they get a missed invitation` : null,
    skipped ? `${skipped} already in the meeting or just invited` : null,
    limited?.message ?? null,
  ].filter(Boolean);
  toast(rung || away || busy ? 'success' : 'info', parts.join(' · ') || 'No one was invited.');
}

/** A conversation with them, beside the meeting. */
async function message(r: Ring): Promise<void> {
  const room = await apiPost<{ room_id: number }>('/api/chat/rooms/direct', { user_id: r.user_id });
  await openChatWindow(room.room_id, r.name, { onTop: true });
}

const ACTION_LABEL: Record<InviteAction, string> = { cancel: 'Cancel', ring_again: 'Ring again', remove: 'Remove', copy_link: 'Copy link', message: 'Message' };

/** The invitations in this meeting, in the People panel: each as it stands, with what can be done about it. */
export function Invitations() {
  const q = useRings();
  const qc = useQueryClient();
  const now = useNow();
  // Somebody in the call is in "In the meeting", whatever their invitation last said.
  const here = new Set(meet.people.map((p) => p.id));
  const rings = (q.data?.rings ?? []).filter((r) => inviteStateOf(r) !== 'joined' && !here.has(r.user_id));
  if (!rings.length) return null;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['meet', meet.uuid, 'rings'] });
  const act = async (r: Ring, a: InviteAction) => {
    try {
      if (a === 'cancel') await apiDelete(`/api/meet/${meet.uuid}/rings/${r.id}`);
      else if (a === 'ring_again') await ringPeople([r.user_id]);
      else if (a === 'remove') await apiDelete(`/api/meet/${meet.uuid}/invitees/${r.user_id}`);
      else if (a === 'message') await message(r);
      else if (a === 'copy_link') {
        await navigator.clipboard.writeText(meet.info?.join_url ?? '');
        toast('success', 'Join link copied.');
      }
    } catch (e) {
      toast('error', errorMessage(e));
    }
    if (a !== 'copy_link' && a !== 'message') refresh();
  };
  return (
    <div className="flex flex-col gap-1.5">
      <b className="text-ink">Invited · {rings.length}</b>
      {rings.map((r) => {
        const state = inviteStateOf(r);
        const actions = inviteActions(state).filter((a) => a === 'copy_link' || a === 'message' || a === 'cancel' || meet.mayInvite);
        return (
          <div key={r.id} className="flex items-center gap-2.5">
            <UserAvatar userId={r.user_id} name={r.name} size={26} />
            <span className="flex min-w-0 flex-1 flex-col">
              <b className="truncate text-ink">{r.name}</b>
              <span className={cx('flex items-center gap-1 truncate text-[11px] font-semibold', INVITE_TONE[state])} aria-live="polite" data-state={state}>
                {state === 'ringing' ? (
                  <span aria-hidden className="motion-safe:animate-pulse">
                    <Icon name="bell" size={11} />
                  </span>
                ) : null}
                {inviteLabel(r, now)}
              </span>
            </span>
            {actions.map((a) => {
              const wait = a === 'ring_again' && r.retry_in > 0;
              return (
                <button
                  key={a}
                  type="button"
                  disabled={wait}
                  title={wait ? `You can ring again in ${r.retry_in} s` : undefined}
                  onClick={() => void act(r, a)}
                  className={cx('text-[12px] font-semibold hover:underline disabled:text-ink-3 disabled:no-underline', a === 'cancel' || a === 'remove' ? 'text-danger' : 'text-primary')}
                >
                  {ACTION_LABEL[a]}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** Add people: a searchable picker, several at once, then Invite & Ring. */
export function AddPeopleDialog({ onClose }: { onClose: () => void }) {
  const uuid = meet.uuid;
  const qc = useQueryClient();
  const people = useQuery({ queryKey: ['meet', uuid, 'invitable'], queryFn: ({ signal }) => apiGet<{ users: Invitable[] }>(`/api/meet/${uuid}/invitable`, undefined, signal), staleTime: 10_000 });
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<number>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () => (people.data?.users ?? []).filter((u) => !needle || u.name.toLowerCase().includes(needle) || (u.email ?? '').toLowerCase().includes(needle)).slice(0, 200),
    [people.data, needle],
  );
  const toggle = (id: number) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const invite = async () => {
    if (!picked.size) return;
    setBusy(true);
    try {
      await ringPeople([...picked]);
      void qc.invalidateQueries({ queryKey: ['meet', uuid, 'rings'] });
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };

  // Up and down move between people; Enter in the search rings whoever is chosen.
  const move = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const boxes = Array.from(list.current?.querySelectorAll<HTMLInputElement>('input:not(:disabled)') ?? []);
    if (!boxes.length) return;
    e.preventDefault();
    const at = boxes.indexOf(document.activeElement as HTMLInputElement);
    const next = e.key === 'ArrowDown' ? (at < 0 ? 0 : Math.min(boxes.length - 1, at + 1)) : at <= 0 ? -1 : at - 1;
    if (next < 0) (e.currentTarget.closest('[role="dialog"]')?.querySelector('input[type="search"]') as HTMLInputElement | null)?.focus();
    else boxes[next]!.focus();
  };

  return (
    <Modal
      title="Add people"
      onClose={onClose}
      width={460}
      footer={
        <>
          <span className="mr-auto text-[12px] text-ink-3">{picked.size ? `${picked.size} chosen` : 'Choose who to ring in'}</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="phone" loading={busy} disabled={!picked.size} onClick={() => void invite()}>
            {busy ? 'Inviting…' : 'Invite & Ring'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2" onKeyDown={move}>
        <input
          type="search"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && picked.size && void invite()}
          placeholder="Search people…"
          aria-label="Search people"
          className="h-9 rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-primary"
        />
        <div ref={list} role="group" aria-label="People" className="flex max-h-[46vh] flex-col overflow-y-auto scroll-thin">
          {people.isLoading ? <Spinner /> : null}
          {people.error ? <p className="p-2 text-[12.5px] text-danger">{errorMessage(people.error)}</p> : null}
          {!people.isLoading && !shown.length && !people.error ? <p className="p-2 text-[12.5px] text-ink-3">No one matches “{q}”.</p> : null}
          {shown.map((u) => {
            const [word, dot] = STATUS[u.status] ?? STATUS.offline!;
            const off = u.in_call || u.pending === 'ringing';
            return (
              <label key={u.id} className={cx('flex items-center gap-2.5 rounded-[8px] px-2 py-1.5', off ? 'opacity-60' : 'cursor-pointer hover:bg-subtle')}>
                <Checkbox checked={picked.has(u.id)} disabled={off} onChange={() => toggle(u.id)} aria-label={`${u.name}, ${word}`} />
                <UserAvatar userId={u.id} name={u.name} size={28} src={u.avatar} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="truncate text-[13px] text-ink">{u.name}</b>
                  <span className="flex items-center gap-1.5 text-[11.5px] text-ink-3">
                    <span className={cx('h-2 w-2 rounded-full', dot)} aria-hidden />
                    {word}
                  </span>
                </span>
                {u.in_call ? <span className="text-[11.5px] font-semibold text-success">In the meeting</span> : u.pending === 'ringing' ? <span className="text-[11.5px] font-semibold text-primary">Ringing…</span> : u.pending === 'cooldown' ? <span className="text-[11.5px] text-ink-3">Just invited</span> : u.pending === 'too_many' ? <span className="text-[11.5px] text-ink-3">Rung 3 times lately</span> : null}
              </label>
            );
          })}
        </div>
        <p className="text-[11.5px] text-ink-3">People who are offline or not taking calls are not rung: they get a missed invitation to come back to.</p>
      </div>
    </Modal>
  );
}
