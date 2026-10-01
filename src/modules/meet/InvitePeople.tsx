import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { apiDelete, apiGet, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { UserAvatar } from '../../components/UserAvatar';
import { Button, Modal, Spinner, cx } from '../../components/ui';
import { meet } from './session';

/**
 * Inviting people into a meeting that is on (worksuite-desktop#79): Add people
 * in the People panel picks them from everyone in WorkSuite — with their
 * picture and whether they are available — and Invite & Ring rings each of
 * them. The panel shows how each invitation stands, with Cancel while it
 * rings and Ring again after a short wait. Who may invite is the room's
 * setting; the server checks it again.
 */

export interface Invitable {
  id: number;
  name: string;
  email: string | null;
  avatar: string | null;
  status: 'online' | 'away' | 'busy' | 'dnd' | 'offline' | string;
  in_call: boolean;
  /** A ring to them is still ringing, or was just answered: not again yet. */
  pending: 'ringing' | 'cooldown' | null;
}

export type RingState = 'ringing' | 'accepted' | 'joined' | 'declined' | 'no_answer' | 'cancelled' | 'unavailable';

export interface Ring {
  id: number;
  user_id: number;
  name: string;
  state: RingState;
  invited_by: { id: number; name: string };
  rang_at: string;
  retry_in: number;
}

/** An invitation's state, in words. */
export const RING_LABEL: Record<RingState, string> = {
  ringing: 'Ringing…',
  accepted: 'Accepted · joining',
  joined: 'Joined',
  declined: 'Declined',
  no_answer: 'No answer',
  cancelled: 'Cancelled',
  unavailable: 'Unavailable · sent as a missed invitation',
};

const RING_TONE: Record<RingState, string> = {
  ringing: 'text-primary',
  accepted: 'text-success',
  joined: 'text-success',
  declined: 'text-danger',
  no_answer: 'text-ink-3',
  cancelled: 'text-ink-3',
  unavailable: 'text-ink-3',
};

const STATUS: Record<string, [string, string]> = {
  online: ['Available', 'bg-success'],
  away: ['Away', 'bg-warning'],
  busy: ['Busy', 'bg-danger'],
  dnd: ['Do not disturb', 'bg-danger'],
  offline: ['Offline', 'bg-ink-3'],
};

export function useRings() {
  const uuid = meet.uuid;
  return useQuery({
    queryKey: ['meet', uuid, 'rings', meet.ringsVersion],
    queryFn: ({ signal }) => apiGet<{ rings: Ring[] }>(`/api/meet/${uuid}/rings`, undefined, signal),
    // Fast while something rings (it may run out); the server's push brings the rest.
    refetchInterval: (q) => (q.state.data?.rings.some((r) => r.state === 'ringing') ? 3_000 : 20_000),
  });
}

/** Ring these people; the server says who was rung, who could not be and why. */
async function ringPeople(userIds: number[]): Promise<void> {
  const r = await apiPost<{ rings: Array<{ user_id: number; state: string; why?: string }> }>(`/api/meet/${meet.uuid}/ring`, { user_ids: userIds });
  const rung = r.rings.filter((x) => x.state === 'ringing').length;
  const away = r.rings.filter((x) => x.state === 'unavailable').length;
  const skipped = r.rings.filter((x) => x.state === 'skipped').length;
  const parts = [rung ? `Ringing ${rung}` : null, away ? `${away} unavailable — they get a missed invitation` : null, skipped ? `${skipped} already in the meeting or just invited` : null].filter(Boolean);
  toast(rung || away ? 'success' : 'info', parts.join(' · ') || 'No one was invited.');
}

/** The invitations in this meeting, in the People panel. */
export function Invitations() {
  const q = useRings();
  const qc = useQueryClient();
  const rings = (q.data?.rings ?? []).filter((r) => r.state !== 'joined');
  if (!rings.length) return null;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['meet', meet.uuid, 'rings'] });
  const cancel = async (r: Ring) => {
    try {
      await apiDelete(`/api/meet/${meet.uuid}/rings/${r.id}`);
    } catch (e) {
      toast('error', errorMessage(e));
    }
    refresh();
  };
  const again = async (r: Ring) => {
    try {
      await ringPeople([r.user_id]);
    } catch (e) {
      toast('error', errorMessage(e));
    }
    refresh();
  };
  return (
    <div className="flex flex-col gap-1.5">
      <b className="text-ink">Invited · {rings.length}</b>
      {rings.map((r) => (
        <div key={r.id} className="flex items-center gap-2.5">
          <UserAvatar userId={r.user_id} name={r.name} size={26} />
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="truncate text-ink">{r.name}</b>
            <span className={cx('text-[11px] font-semibold', RING_TONE[r.state])} aria-live="polite">
              {RING_LABEL[r.state]}
            </span>
          </span>
          {r.state === 'ringing' ? (
            <button type="button" onClick={() => void cancel(r)} className="text-[12px] font-semibold text-danger hover:underline">
              Cancel
            </button>
          ) : r.state !== 'accepted' && meet.mayInvite ? (
            <button type="button" disabled={r.retry_in > 0} title={r.retry_in > 0 ? `You can ring again in ${r.retry_in} s` : undefined} onClick={() => void again(r)} className="text-[12px] font-semibold text-primary hover:underline disabled:text-ink-3 disabled:no-underline">
              Ring again
            </button>
          ) : null}
        </div>
      ))}
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
                {u.in_call ? <span className="text-[11.5px] font-semibold text-success">In the meeting</span> : u.pending === 'ringing' ? <span className="text-[11.5px] font-semibold text-primary">Ringing…</span> : u.pending === 'cooldown' ? <span className="text-[11.5px] text-ink-3">Just invited</span> : null}
              </label>
            );
          })}
        </div>
        <p className="text-[11.5px] text-ink-3">People who are offline or not taking calls are not rung: they get a missed invitation to come back to.</p>
      </div>
    </Modal>
  );
}
