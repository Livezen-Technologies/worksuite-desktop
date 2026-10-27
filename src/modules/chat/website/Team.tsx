import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../../../core/api';
import { errorMessage, on } from '../../../core/bridge';
import { text } from '../../../core/i18n';
import { dateLabel, parseTs, timeLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Checkbox } from '../../../components/Checkbox';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { Avatar, Button, Chip, Modal, cx, initials } from '../../../components/ui';
import { useNow } from '../../../components/CallKit';
import { PRESENCE } from '../Details';
import { usePresence } from '../presence';
import { ROLE_LABEL, team, useAgents, type Colleague, type WebsiteConversation, type WebsitePending, type WebsitePerson, type WebsiteTeam } from './api';
import { PANEL_CARD, PANEL_HEADING } from './rowParts';

/**
 * Several staff in one website chat (WS-WCHAT ENH-WCHAT-03, TEAM-UI-01 and TEAM-UI-02): the faces in the thread's
 * header, the "In this chat" panel, the invite and transfer dialogs, a note only staff see, and the notice when an
 * invitation or a transfer was declined. Every rule is the server's; these say it and pass on what was chosen.
 */

const STATUS: Record<NonNullable<Colleague['status']>, { label: string; dot: string }> = {
  available: { label: 'Available', dot: 'bg-success' },
  busy: { label: 'Busy', dot: 'bg-warning' },
  away: { label: 'Away', dot: 'bg-ink-3' },
  offline: { label: 'Offline', dot: 'bg-line' },
};

/** The server's refusal, in its own words. */
function refusal(e: unknown): string {
  return e instanceof ApiError ? e.message : errorMessage(e);
}

/** Who is in the chat, owner first, as overlapping faces in the thread's header (TEAM-04; C-08: 28 px, as designed). */
export function TeamFaces({ people }: { people: WebsitePerson[] }) {
  // The server sends the owner first; kept so here too, whatever an older one sends.
  const shown = people.filter((p) => p.role !== 'observer').sort((a, b) => Number(b.role === 'owner') - Number(a.role === 'owner'));
  if (shown.length < 2) return null;
  return (
    <span className="flex shrink-0 items-center" aria-label={text('In this chat: {names}', { names: shown.map((p) => `${p.name}${p.role === 'owner' ? ' (owner)' : ''}`).join(', ') })}>
      {shown.slice(0, 4).map((p, i) => (
        <span key={p.user_id} title={`${p.name} · ${ROLE_LABEL[p.role]}`} className={cx('rounded-full ring-2 ring-surface', i > 0 && '-ml-2')}>
          <Avatar name={p.name} src={p.avatar} size={28} />
        </span>
      ))}
      {shown.length > 4 ? <span className="ml-1 text-[11px] font-semibold text-ink-3">+{shown.length - 4}</span> : null}
    </span>
  );
}

/** One team action at a time, its refusal in the server's words, the chat read again after. */
function useTeamRun(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast('success', done);
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
      onDone();
    }
  };
  return { busy, run };
}

/** "1:30": what is left of an invitation or transfer's ring. */
export function countdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Seconds left on a pending invitation or transfer: by the server's own count when it gave one (C-08), so a computer
 * whose clock is off still shows the true countdown; else by its expiry time. Null when it waits until answered.
 */
export function secondsLeft(h: Pick<WebsitePending, 'expires_at' | 'expires_in'>, fetchedAt: number, now: number): number | null {
  if (h.expires_in !== undefined && h.expires_in !== null) return h.expires_in - (now - fetchedAt) / 1000;
  return h.expires_at ? (parseTs(h.expires_at).getTime() - now) / 1000 : null;
}

const ROW_AVATAR = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold';

/**
 * "In this chat" (C-08, X-UI-07; TEAM-04, TEAM-07, UX-DRW-03): a card of everybody in it — presence, role pill and when
 * they joined — the invitations and transfers still ringing with a dashed face, a countdown and Cancel, Invite someone,
 * Remove for the owner, and a supervisor's Monitor, Join and Take over. Leaving is the panel's foot (`LeaveChat`).
 */
export function InThisChat({ data, me, fetchedAt, onInvite, onDone }: { data: WebsiteConversation; me: number | null; fetchedAt: number; onInvite: () => void; onDone: () => void }) {
  const t = data.team;
  const { busy, run } = useTeamRun(onDone);
  const now = useNow(1_000);
  // The server says each person's presence; an older one does not, and Team Chat's shared store is asked instead (#183).
  const ask = !!t && t.people.some((p) => !p.presence);
  const presenceOf = usePresence(ask ? t.people.map((p) => p.user_id) : [], ask);
  if (!t) return null;
  const id = data.conversation.id;
  const closed = data.conversation.status === 'closed';
  const staff = t.people.filter((p) => p.role !== 'observer').length;
  const full = staff >= t.max;
  const rows = t.people.length + t.pending.length;
  return (
    <section aria-label="In this chat" className={PANEL_CARD}>
      <span className="flex items-center">
        <h3 className={cx(PANEL_HEADING, 'flex-1')}>In this chat</h3>
        <span className="text-[11px] text-ink-3" title={text('{n} of at most {max} staff', { n: staff, max: t.max })}>{rows}</span>
      </span>
      {t.people.length === 0 && t.pending.length === 0 ? <span className="text-[12px] text-ink-3">Nobody has joined yet.</span> : null}
      <ul className="flex flex-col gap-2">
        {t.people.map((p) => {
          const st = PRESENCE[p.presence ?? presenceOf(p.user_id) ?? ''];
          return (
            <li key={p.user_id} className="flex items-center gap-2.5">
              <span className="relative shrink-0">
                <Avatar name={p.name} src={p.avatar} size={32} />
                {st ? <span className={cx('absolute -right-px -bottom-px h-2.5 w-2.5 rounded-full border-2 border-surface', st.dot)} title={st.label} aria-label={st.label} /> : null}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="truncate text-[13px] text-ink">{p.name}{p.user_id === me ? ' (you)' : ''}</b>
                <span className="flex min-w-0 items-center gap-1.5 text-[11.5px]">
                  <Chip tone={p.role === 'observer' ? 'warning' : 'indigo'} className="!px-1.5 !py-px !text-[10.5px] !font-bold">{ROLE_LABEL[p.role]}</Chip>
                  <span className="truncate text-ink-3">
                    {[p.joined_at ? joinedLabel(p.joined_at) : null, p.invited_by_name ? `invited by ${p.invited_by_name}` : null, p.role === 'observer' ? 'the visitor does not see them' : null].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </span>
              {t.can.remove && p.role !== 'owner' && p.user_id !== me && !closed ? (
                <button type="button" disabled={busy} aria-label={`Remove ${p.name} from the chat`} title="Remove from the chat" onClick={() => void run(() => team.remove(id, p.user_id), `${p.name} was removed.`)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-subtle hover:text-danger">
                  <Icon name="user-x" size={14} />
                </button>
              ) : null}
            </li>
          );
        })}
        {t.pending.map((h) => {
          const left = secondsLeft(h, fetchedAt, now);
          const what = h.kind === 'invite' ? 'Invited' : h.mode === 'cold' ? 'Handed over' : 'Transfer';
          return (
            <li key={`h${h.id}`} className="flex items-center gap-2.5" title={h.from_name ? `${what} by ${h.from_name}` : undefined}>
              <span aria-hidden className={cx(ROW_AVATAR, 'border-[1.5px] border-dashed border-line text-ink-3')}>{initials(h.to)}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="truncate text-[13px] text-ink">{h.to}</b>
                <span className="truncate text-[11.5px] font-semibold text-warning-ink dark:text-warning">{left === null ? `${what} · waiting` : `${what} · ${countdown(left)}`}</span>
              </span>
              {(h.from === me || t.my_role === 'owner' || t.can.take_over) && !closed ? (
                <button type="button" disabled={busy} aria-label={`Cancel ${h.kind === 'invite' ? 'the invitation to' : 'the transfer to'} ${h.to}`} onClick={() => void run(() => team.cancel(h.id), 'Cancelled.')} className="h-6 shrink-0 rounded-[6px] border border-line bg-surface px-2 text-[11px] font-semibold text-danger hover:bg-danger-bg">
                  Cancel
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {t.can.invite && !closed ? (
        // At the limit nobody more can come in (TEAM-03): said here rather than refused after picking.
        <button type="button" onClick={onInvite} disabled={full} title={full ? text('This chat has {max} staff in it, the most one chat can have.', { max: t.max }) : undefined} className="flex h-[30px] items-center justify-center gap-1.5 rounded-[8px] border border-dashed border-primary-soft bg-selection/50 text-[12px] font-bold text-primary hover:bg-selection disabled:cursor-not-allowed disabled:opacity-55 dark:border-primary/40">
          <Icon name="plus" size={12} /> Invite someone
        </button>
      ) : null}
      {t.can.monitor || t.can.join || t.can.take_over ? (
        <span className="flex flex-wrap gap-1.5">
          {t.can.monitor ? <Button size="sm" icon="eye" disabled={busy} onClick={() => void run(() => team.monitor(id), 'Monitoring: the visitor does not see you.')}>Monitor</Button> : null}
          {t.can.join ? <Button size="sm" disabled={busy} onClick={() => void run(() => team.join(id), 'You joined the chat.')}>Join</Button> : null}
          {t.can.take_over ? <Button size="sm" disabled={busy} onClick={() => void run(() => team.takeOver(id), 'The chat is yours.')}>Take over</Button> : null}
        </span>
      ) : null}
      {t.transfer_count > 0 ? <span className="text-[11px] text-ink-3">Transferred {t.transfer_count === 1 ? 'once' : `${t.transfer_count} times`}</span> : null}
    </section>
  );
}

/**
 * The people panel's foot (C-08, X-UI-07; TEAM-06): Leave chat, and for the owner the warning that they must transfer
 * it first. An owner who leaves anyway is offered Transfer or Close (AC-T07); an observer stops monitoring.
 */
export function LeaveChat({ data, onTransfer, onClose, onDone }: { data: WebsiteConversation; onTransfer: () => void; onClose: () => void; onDone: () => void }) {
  const t = data.team;
  const { busy, run } = useTeamRun(onDone);
  const [owning, setOwning] = useState(false);
  if (!t || !(t.can.leave || t.my_role === 'owner')) return null;
  const id = data.conversation.id;
  const open = data.conversation.status !== 'closed';
  const owner = t.my_role === 'owner' && open;
  const leave = () => {
    if (owner) setOwning(true);
    else void run(() => team.leave(id), t.my_role === 'observer' ? 'You stopped monitoring.' : 'You left the chat.');
  };
  return (
    <>
      {owner ? (
        <div role="note" className="rounded-[12px] border border-warning-line bg-warning-bg px-3 py-2.5 text-[12px] text-warning-strong dark:border-warning/40 dark:text-warning">
          You own this chat — transfer it before you leave.
        </div>
      ) : null}
      <button type="button" disabled={busy} onClick={leave} className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-[8px] border border-line bg-surface text-[13px] font-semibold text-ink hover:bg-subtle disabled:opacity-60">
        <Icon name="logout" size={14} className="text-ink-2" /> {t.my_role === 'observer' ? 'Stop monitoring' : 'Leave chat'}
      </button>
      {owning ? (
        <Modal title="You own this chat" labelledBy="website-owner-leave" onClose={() => setOwning(false)} width={420} footer={
          <>
            <Button onClick={() => setOwning(false)}>Stay</Button>
            <Button onClick={() => (setOwning(false), onClose())}>Close the chat</Button>
            <Button variant="primary" onClick={() => (setOwning(false), onTransfer())}>Transfer</Button>
          </>
        }>
          <p className="text-[13px] text-ink-2">The visitor would be left with nobody. Transfer the chat to a colleague first, or close it.</p>
        </Modal>
      ) : null}
    </>
  );
}

/**
 * Reply to visitor / Internal note, above the shared composer (C-08, TEAM-60): the one box writes to the visitor or a
 * note only staff see. Arrow keys move between the two, as tabs do.
 */
export function MessageTypeTabs({ value, onChange }: { value: 'reply' | 'note'; onChange: (v: 'reply' | 'note') => void }) {
  const tabs = [['reply', 'Reply to visitor'], ['note', 'Internal note']] as const;
  return (
    <div role="tablist" aria-label="Message type" className="flex gap-1" onKeyDown={(e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      onChange(value === 'reply' ? 'note' : 'reply');
    }}>
      {tabs.map(([k, label]) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={value === k}
          tabIndex={value === k ? 0 : -1}
          onClick={() => onChange(k)}
          className={cx(
            'h-7 rounded-[8px] px-3 text-[12px]',
            value === k ? (k === 'note' ? 'bg-warning-bg font-bold text-warning dark:text-warning' : 'bg-selection font-bold text-primary') : k === 'note' ? 'font-semibold text-warning hover:bg-subtle dark:text-warning' : 'font-semibold text-ink-3 hover:bg-subtle hover:text-ink',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** How each availability reads in the pickers (C-09): Available in green, Busy in amber, the rest quiet. */
const STATUS_TONE: Record<NonNullable<Colleague['status']>, string> = {
  available: 'text-success',
  busy: 'text-warning-ink dark:text-warning',
  away: 'text-ink-3',
  offline: 'text-ink-3',
};

/** A picker row's frame (C-09): ruled between rows, a picked one tinted with the primary bar down its left edge. */
function PickRow({ picked, disabled, children }: { picked: boolean; disabled: boolean; children: ReactNode }) {
  return (
    <label className={cx('relative flex items-center gap-2.5 border-t border-line px-3 py-2.5 first:border-t-0', disabled ? 'text-ink-3' : 'cursor-pointer hover:bg-subtle', picked && 'bg-selection/60')}>
      {picked ? <span aria-hidden className="absolute top-0 bottom-0 left-0 w-[3px] bg-primary" /> : null}
      {children}
    </label>
  );
}

/**
 * The colleague picker's rows (C-09, TEAM-20, TEAM-21): "Available · 1 chat · Education sales", coloured by
 * availability; offline people, and anybody already in it, not pickable; somebody who does not staff this website
 * marked so.
 */
function ColleagueRow({ a, picked, disabled, why, onPick, multi }: { a: Colleague; picked: boolean; disabled: boolean; why: string | null; onPick: () => void; multi: boolean }) {
  const st = STATUS[a.status ?? 'available'];
  // Offline says just that, as designed: nothing else about somebody who cannot be asked.
  const line = why === 'Offline' ? why : [
    why ?? st.label,
    a.open_chats !== undefined ? `${a.open_chats} chat${a.open_chats === 1 ? '' : 's'}` : null,
    a.department || null,
    a.on_staff === false ? "not on this site's staff" : null,
  ].filter(Boolean).join(' · ');
  return (
    <PickRow picked={picked} disabled={disabled}>
      {multi ? <Checkbox checked={picked} disabled={disabled} onChange={onPick} /> : <input type="radio" name="colleague" checked={picked} disabled={disabled} onChange={onPick} className="accent-primary" />}
      <span className={cx('shrink-0', disabled && 'opacity-55 grayscale')}><Avatar name={a.name} size={30} /></span>
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="truncate text-[13px] font-semibold">{a.name}</b>
        <span className={cx('truncate text-[12px]', disabled ? 'text-ink-3' : STATUS_TONE[a.status ?? 'available'])}>{line}</span>
      </span>
    </PickRow>
  );
}

/** Why a colleague cannot be picked, or null. */
function unpickable(a: Colleague, me: number | null, transfer: boolean): string | null {
  if (a.id === me) return 'You';
  if (a.in_chat === 'owner') return transfer ? 'Already owns this chat' : 'Owns this chat';
  if (a.in_chat && !transfer) return 'Already in this chat';
  if (a.status === 'offline') return 'Offline';
  return null;
}

type Department = { id: number; name: string; available: number };

/** Colleagues and departments whose name, or department, has what was typed (C-09: "Search people or departments"). */
function matching<T extends { name: string; department?: string | null }>(list: T[], q: string): T[] {
  const k = q.trim().toLowerCase();
  return k ? list.filter((x) => `${x.name} ${x.department ?? ''}`.toLowerCase().includes(k)) : list;
}

const FIELD = 'rounded-[8px] border border-line bg-surface px-3 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-primary';
const LIST = 'flex flex-col overflow-y-auto rounded-[10px] border border-line scroll-thin';

/** The dialogs' one line under the title (C-09). */
function Lede({ children }: { children: ReactNode }) {
  return <p className="-mt-1 text-[13px] text-ink-2">{children}</p>;
}

/**
 * Invite (C-09, TEAM-UI-02, TEAM-20…22, TEAM-25): one or more colleagues, or a department — found by one search —
 * with a note only staff see. Each invitation rings for two minutes unless the organisation set otherwise.
 */
export function InviteDialog({ conversationId, me, owner = true, onClose, onDone }: { conversationId: number; me: number | null; owner?: boolean; onClose: () => void; onDone: () => void }) {
  const agents = useAgents(true, conversationId);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const [dept, setDept] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const people = useMemo(() => matching(agents.data?.agents ?? [], q), [agents.data, q]);
  const departments = useMemo(() => matching<Department>(agents.data?.departments ?? [], q), [agents.data, q]);
  const deptName = (agents.data?.departments ?? []).find((d) => d.id === dept)?.name;
  const send = async () => {
    setBusy(true);
    try {
      await team.invite(conversationId, { ...(dept ? { department_id: dept } : { user_ids: picked }), ...(note.trim() ? { note: note.trim() } : {}) });
      toast('success', dept ? 'The department is being asked to join.' : picked.length === 1 ? 'Invitation sent.' : 'Invitations sent.');
      onDone();
      onClose();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  // "Invite 1 person", as designed; a department is asked as one (TEAM-25).
  const label = dept ? `Invite the ${deptName ?? 'department'} team` : picked.length === 1 ? 'Invite 1 person' : picked.length > 1 ? `Invite ${picked.length} people` : 'Invite';
  return (
    <Modal title="Invite to this chat" labelledBy="website-invite" onClose={onClose} width={480} footer={
      <>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={!dept && !picked.length} onClick={() => void send()}>{label}</Button>
      </>
    }>
      <div className="flex flex-col gap-3">
        <Lede>{owner ? 'They join alongside you. You stay the owner.' : 'They join alongside you.'}</Lede>
        <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people or departments" placeholder="Search people or departments" className={cx(FIELD, 'h-[38px]')} autoFocus />
        <div role="group" aria-label="Colleagues" className={cx(LIST, 'max-h-[260px]')}>
          {agents.isLoading ? <span className="p-3 text-[12px] text-ink-3">Loading…</span> : null}
          {people.map((a) => {
            const why = unpickable(a, me, false);
            return <ColleagueRow key={a.id} a={a} multi picked={picked.includes(a.id)} disabled={!!why} why={why} onPick={() => (setDept(0), setPicked((p) => (p.includes(a.id) ? p.filter((x) => x !== a.id) : [...p, a.id])))} />;
          })}
          {departments.map((d) => (
            // A department: its available members are rung in the widget's order, the first to accept joins (TEAM-25).
            <PickRow key={`d${d.id}`} picked={dept === d.id} disabled={!d.available}>
              <Checkbox checked={dept === d.id} disabled={!d.available} onChange={() => (setPicked([]), setDept((x) => (x === d.id ? 0 : d.id)))} aria-label={`The ${d.name} team`} />
              <span aria-hidden className={cx('flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-subtle text-ink-2', !d.available && 'opacity-55')}><Icon name="users" size={15} /></span>
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="truncate text-[13px] font-semibold">{d.name}</b>
                <span className={cx('truncate text-[12px]', d.available ? 'text-success' : 'text-ink-3')}>{d.available ? `Department · ${d.available} available · the first to accept joins` : 'Department · nobody available'}</span>
              </span>
            </PickRow>
          ))}
          {!agents.isLoading && !people.length && !departments.length ? <span className="p-3 text-[12px] text-ink-3">Nobody matches.</span> : null}
        </div>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink">
          Note for them (staff only)
          <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} rows={2} placeholder="What do you need help with?" className={cx(FIELD, 'resize-none py-2 font-normal')} />
        </label>
      </div>
    </Modal>
  );
}

/** Who a cold transfer rings, for "it rings for Dilini until they join" (C-09). */
function ringsFor(to: 'person' | 'department' | 'any', person: Colleague | undefined, dept: Department | undefined): string {
  if (to === 'person') return person ? person.name.split(' ')[0]! : 'them';
  if (to === 'department') return dept ? `the ${dept.name} team` : 'the department';
  return 'everybody available';
}

/**
 * Transfer (C-09, TEAM-UI-02, TEAM-40…43): to a person, a department (its next available member by the widget's rule)
 * or the next available agent; warm — you stay until they join, so the visitor is never left alone — or hand over now;
 * with a handover note only staff see.
 */
export function TransferDialog({ conversationId, me, onClose, onDone }: { conversationId: number; me: number | null; onClose: () => void; onDone: () => void }) {
  const agents = useAgents(true, conversationId);
  const [to, setTo] = useState<'person' | 'department' | 'any'>('person');
  const [person, setPerson] = useState(0);
  const [q, setQ] = useState('');
  const [choosing, setChoosing] = useState(true);
  const [dept, setDept] = useState(0);
  const [mode, setMode] = useState<'warm' | 'cold'>('warm');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const departments = agents.data?.departments ?? [];
  const chosen = (agents.data?.agents ?? []).find((a) => a.id === person);
  const people = useMemo(() => matching(agents.data?.agents ?? [], q), [agents.data, q]);
  const ready = to === 'any' || (to === 'person' ? person > 0 : dept > 0);
  const send = async () => {
    setBusy(true);
    try {
      await team.transfer(conversationId, {
        ...(to === 'person' ? { to_user_id: person } : to === 'department' ? { department_id: dept } : { any: true }),
        mode,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast('success', mode === 'cold' ? 'Handed over: it rings for them now.' : 'Asked: the chat stays yours until they accept.');
      onDone();
      onClose();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  const target = ringsFor(to, chosen, departments.find((d) => d.id === dept));
  return (
    <Modal title="Transfer this chat" labelledBy="website-transfer" onClose={onClose} width={480} footer={
      <>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={!ready} onClick={() => void send()}>Transfer</Button>
      </>
    }>
      <div className="flex flex-col gap-3">
        <Lede>The new owner answers for it from now on.</Lede>
        {/* A segmented control, as designed; radios to assistive technology. */}
        <div role="radiogroup" aria-label="Transfer to" className="flex gap-1 rounded-[10px] bg-subtle p-[3px]">
          {([['person', 'A person'], ['department', 'A department'], ['any', 'Next available']] as const).map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={to === k} onClick={() => setTo(k)} className={cx('flex-1 rounded-[8px] px-2 py-[7px] text-[13px]', to === k ? 'bg-surface font-bold text-primary shadow-[0_1px_3px_rgba(17,27,59,0.12)]' : 'text-ink-2 hover:text-ink')}>{label}</button>
          ))}
        </div>
        {to === 'person' ? (
          chosen && !choosing ? (
            // The one chosen, as a field: "Dilini Perera · Available". Clicking it chooses again.
            <button type="button" onClick={() => setChoosing(true)} aria-label={`Transfer to ${chosen.name}. Change`} className={cx(FIELD, 'flex h-10 items-center gap-2 px-2.5 text-left hover:bg-subtle')}>
              <Avatar name={chosen.name} size={26} />
              <span className="min-w-0 flex-1 truncate">{chosen.name} · <span className={STATUS_TONE[chosen.status ?? 'available']}>{STATUS[chosen.status ?? 'available'].label}</span></span>
              <Icon name="chevron-down" size={14} className="text-ink-3" />
            </button>
          ) : (
            <>
              <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" placeholder="Search people" className={cx(FIELD, 'h-10')} />
              <div role="group" aria-label="Colleagues" className={cx(LIST, 'max-h-[200px]')}>
                {people.map((a) => {
                  const why = unpickable(a, me, true);
                  return <ColleagueRow key={a.id} a={a} multi={false} picked={person === a.id} disabled={!!why} why={why} onPick={() => (setPerson(a.id), setChoosing(false), setQ(''))} />;
                })}
                {!agents.isLoading && !people.length ? <span className="p-3 text-[12px] text-ink-3">Nobody matches.</span> : null}
              </div>
            </>
          )
        ) : to === 'department' ? (
          <Select aria-label="Department" value={dept} onChange={(e) => setDept(Number(e.target.value))} className="h-10 rounded-[8px] border border-line bg-surface px-2 text-[13px] text-ink">
            <option value={0}>Choose a department</option>
            {departments.map((d) => <option key={d.id} value={d.id} disabled={!d.available}>{d.name} · {d.available} available</option>)}
          </Select>
        ) : (
          <p className="text-[13px] text-ink-2">Everybody available on this website is asked, the next by the website's rule first; the first to accept takes it.</p>
        )}
        <div role="radiogroup" aria-label="How" className="flex flex-col gap-2">
          {([
            ['warm', 'Warm — stay until they join', 'The visitor is never left alone.'],
            ['cold', 'Hand over now', `You leave at once; it rings for ${target} until ${to === 'person' ? 'they join' : 'someone joins'}.`],
          ] as const).map(([k, label, hint]) => (
            <label key={k} className={cx('flex cursor-pointer items-start gap-2.5 rounded-[10px] px-3 py-2.5', mode === k ? 'border-2 border-primary bg-selection/60' : 'border border-line hover:bg-subtle')}>
              <input type="radio" name="mode" checked={mode === k} onChange={() => setMode(k)} className="mt-[3px] accent-primary" />
              <span className="flex flex-col">
                <b className={cx('text-[13px] text-ink', mode === k ? 'font-bold' : 'font-semibold')}>{label}</b>
                <span className="text-[12px] text-ink-2">{hint}</span>
              </span>
            </label>
          ))}
        </div>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink">
          Handover note (staff only)
          <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} rows={2} placeholder="What should they know?" className={cx(FIELD, 'resize-none py-2 font-normal')} />
        </label>
      </div>
    </Modal>
  );
}

export interface Declined {
  /** "Dilini declined", "Dilini didn't answer". */
  who: string;
  /** The visitor, in bold in the notice. */
  visitor: string;
  /** What follows: " is still yours." — or the whole sentence when nobody took a chat handed over. */
  rest: string;
  retry: 'invite' | 'transfer' | null;
}

/**
 * An invitation or transfer this person sent came back declined, unanswered or with nobody taking it (TEAM-24, WF-T2):
 * "Dilini declined — Visitor 4F2A is still yours", with Try someone else (C-09).
 */
export function useDeclined(conversationId: number, me: number | null, t: WebsiteTeam | null | undefined): (Declined & { dismiss: () => void }) | null {
  const [notice, setNotice] = useState<(Declined & { cid: number }) | null>(null);
  const mine = useRef(new Map<number, { kind: 'invite' | 'transfer'; to: string }>());
  const owner = useRef(false);
  useEffect(() => {
    owner.current = t?.my_role === 'owner';
    for (const h of t?.pending ?? []) if (h.from === me) mine.current.set(h.id, { kind: h.kind, to: h.to });
  }, [t, me]);
  useEffect(() => {
    return on<{ type: string; conversation_id?: number; handoff_id?: number; status?: string; by_name?: string | null; visitor?: string | null; released?: boolean }>('realtime:event', (e) => {
      if (e.type !== 'chat.widget.handoff.resolved' || e.conversation_id !== conversationId || e.handoff_id === undefined) return;
      const h = mine.current.get(e.handoff_id);
      if (!h || (e.status !== 'declined' && e.status !== 'expired')) return;
      const who = e.status === 'declined' ? `${e.by_name ?? h.to} declined` : `${h.to} didn't answer`;
      const visitor = e.visitor ?? 'The visitor';
      // Yours when you own it — a transfer's sender still does (TEAM-41); a participant's invitation leaves it the owner's.
      setNotice(e.released
        ? { cid: conversationId, who, visitor: '', rest: 'nobody took the chat, so it now rings everybody covering the website.', retry: null }
        : { cid: conversationId, who, visitor, rest: h.kind === 'transfer' || owner.current ? ' is still yours.' : ' is still in your chat.', retry: h.kind });
    });
  }, [conversationId]);
  if (!notice || notice.cid !== conversationId) return null;
  const { cid: _cid, ...rest } = notice;
  return { ...rest, dismiss: () => setNotice(null) };
}

/**
 * The declined notice (C-09, TEAM-UI-02; TEAM-24): amber, as designed — "Dilini declined — **Visitor 4F2A** is still
 * yours. Try someone else" — over the composer of the chat it is about.
 */
export function DeclinedNotice({ d, onRetry }: { d: Declined & { dismiss: () => void }; onRetry: (() => void) | null }) {
  return (
    <div role="status" className="mx-3.5 mt-2 flex items-start gap-2 rounded-[14px] border border-warning-line bg-warning-bg px-3.5 py-3 text-[13px] text-warning-strong dark:border-warning/40 dark:text-warning">
      <span className="min-w-0 flex-1">
        {d.who} — {d.visitor ? <b>{d.visitor}</b> : null}{d.rest}
        {onRetry ? <> <button type="button" onClick={() => (d.dismiss(), onRetry())} className="font-semibold text-primary underline-offset-2 hover:underline">Try someone else</button></> : null}
      </span>
      <button type="button" aria-label="Dismiss" onClick={d.dismiss} className="-mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full hover:bg-black/5">
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}

/** When somebody joined, said briefly for the panel. */
export function joinedLabel(at: string | null | undefined): string {
  if (!at) return '';
  const d = parseTs(at);
  return d.toDateString() === new Date().toDateString() ? timeLabel(at) : dateLabel(at);
}
