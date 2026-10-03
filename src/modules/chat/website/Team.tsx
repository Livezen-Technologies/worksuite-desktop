import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, apiPost } from '../../../core/api';
import { errorMessage, on } from '../../../core/bridge';
import { text } from '../../../core/i18n';
import { dateLabel, parseTs, timeLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Checkbox } from '../../../components/Checkbox';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { Avatar, Button, Chip, Modal, cx } from '../../../components/ui';
import { ROLE_LABEL, team, useAgents, WEBSITE, type Colleague, type WebsiteConversation, type WebsitePerson, type WebsiteTeam } from './api';

/**
 * Several staff in one website chat (WS-WCHAT ENH-WCHAT-03, TEAM-UI-01 and TEAM-UI-02): the faces in the thread's
 * header, the "In this chat" panel, the invite and transfer dialogs, a note only staff see, and the notice when an
 * invitation or a transfer was declined. Every rule is the server's; these say it and pass on what was chosen.
 */

const HEADING = 'text-[10.5px] font-bold tracking-[0.6px] text-ink-3 uppercase';

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

/** Who is in the chat, owner first, as small faces in the thread's header (TEAM-04). */
export function TeamFaces({ people }: { people: WebsitePerson[] }) {
  const shown = people.filter((p) => p.role !== 'observer');
  if (shown.length < 2) return null;
  return (
    <span className="flex shrink-0 items-center" aria-label={text('In this chat: {names}', { names: shown.map((p) => `${p.name}${p.role === 'owner' ? ' (owner)' : ''}`).join(', ') })}>
      {shown.slice(0, 4).map((p, i) => (
        <span key={p.user_id} title={`${p.name} · ${ROLE_LABEL[p.role]}`} className={cx('rounded-full ring-2 ring-surface', i > 0 && '-ml-1.5')}>
          <Avatar name={p.name} src={p.avatar} size={24} />
        </span>
      ))}
      {shown.length > 4 ? <span className="ml-1 text-[11px] font-semibold text-ink-3">+{shown.length - 4}</span> : null}
    </span>
  );
}

/**
 * "In this chat" (TEAM-04, TEAM-06, TEAM-07): everybody in it with their role and when they joined, the invitations and
 * transfers still waiting with Cancel, Leave chat, Remove for the owner, and a supervisor's Monitor, Join and Take over.
 */
export function InThisChat({ data, me, onInvite, onTransfer, onClose, onDone }: { data: WebsiteConversation; me: number | null; onInvite: () => void; onTransfer: () => void; onClose: () => void; onDone: () => void }) {
  const t = data.team;
  const [busy, setBusy] = useState(false);
  const [owning, setOwning] = useState(false);
  if (!t) return null;
  const id = data.conversation.id;
  const closed = data.conversation.status === 'closed';
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
  const leave = () => {
    // The owner cannot leave it alone: they are offered Transfer or Close (AC-T07).
    if (t.my_role === 'owner') {
      setOwning(true);
      return;
    }
    void run(() => team.leave(id), 'You left the chat.');
  };
  return (
    <section aria-label="In this chat" className="flex flex-col gap-1.5 border-t border-line pt-2.5">
      <span className="flex items-center gap-2">
        <h3 className={cx(HEADING, 'flex-1')}>In this chat · {t.people.filter((p) => p.role !== 'observer').length}/{t.max}</h3>
        {t.can.invite && !closed ? (
          <button type="button" onClick={onInvite} className="text-[12px] font-semibold text-primary hover:underline">Invite</button>
        ) : null}
      </span>
      {t.people.length === 0 ? <span className="text-[12px] text-ink-3">Nobody has joined yet.</span> : null}
      <ul className="flex flex-col gap-1.5">
        {t.people.map((p) => (
          <li key={p.user_id} className="flex items-center gap-2">
            <Avatar name={p.name} src={p.avatar} size={26} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-1.5">
                <b className="truncate text-ink">{p.name}{p.user_id === me ? ' (you)' : ''}</b>
                <Chip tone={p.role === 'owner' ? 'indigo' : p.role === 'observer' ? 'warning' : 'muted'}>{ROLE_LABEL[p.role]}</Chip>
              </span>
              <span className="truncate text-[11px] text-ink-3">
                {p.joined_at ? `Joined ${timeLabel(p.joined_at)}` : 'In the chat'}
                {p.invited_by_name ? ` · invited by ${p.invited_by_name}` : ''}
                {p.role === 'observer' ? ' · the visitor does not see them' : ''}
              </span>
            </span>
            {t.can.remove && p.role !== 'owner' && p.user_id !== me && !closed ? (
              <button type="button" disabled={busy} aria-label={`Remove ${p.name} from the chat`} title="Remove from the chat" onClick={() => void run(() => team.remove(id, p.user_id), `${p.name} was removed.`)} className="flex h-7 w-7 items-center justify-center rounded-full text-ink-3 hover:bg-subtle hover:text-danger">
                <Icon name="user-x" size={14} />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {t.pending.length ? (
        <ul className="flex flex-col gap-1" aria-label="Waiting for an answer">
          {t.pending.map((h) => (
            <li key={h.id} className="flex items-center gap-2 rounded-[8px] border border-dashed border-line px-2 py-1.5 text-[12px]">
              <Icon name={h.kind === 'invite' ? 'user-plus' : 'transfers'} size={14} className="shrink-0 text-ink-3" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ink">{h.kind === 'invite' ? `Invited ${h.to}` : `${h.mode === 'cold' ? 'Handed over to' : 'Transfer to'} ${h.to}`}</span>
                <span className="block truncate text-[11px] text-ink-3">{h.expires_at ? `Waiting · expires ${timeLabel(h.expires_at)}` : 'Waiting until somebody takes it'}{h.from_name ? ` · by ${h.from_name}` : ''}</span>
              </span>
              {(h.from === me || t.my_role === 'owner' || t.can.take_over) && !closed ? (
                <button type="button" disabled={busy} onClick={() => void run(() => team.cancel(h.id), 'Cancelled.')} className="shrink-0 font-semibold text-primary hover:underline">Cancel</button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <span className="flex flex-wrap gap-1.5 pt-0.5">
        {t.can.transfer && !closed ? <Button size="sm" icon="transfers" disabled={busy} onClick={onTransfer}>Transfer</Button> : null}
        {t.can.leave || t.my_role === 'owner' ? <Button size="sm" disabled={busy} onClick={leave}>{t.my_role === 'observer' ? 'Stop monitoring' : 'Leave chat'}</Button> : null}
        {t.can.monitor ? <Button size="sm" icon="eye" disabled={busy} onClick={() => void run(() => team.monitor(id), 'Monitoring: the visitor does not see you.')}>Monitor</Button> : null}
        {t.can.join ? <Button size="sm" disabled={busy} onClick={() => void run(() => team.join(id), 'You joined the chat.')}>Join</Button> : null}
        {t.can.take_over ? <Button size="sm" disabled={busy} onClick={() => void run(() => team.takeOver(id), 'The chat is yours.')}>Take over</Button> : null}
      </span>
      {t.transfer_count > 0 ? <span className="text-[11px] text-ink-3">Transferred {t.transfer_count === 1 ? 'once' : `${t.transfer_count} times`}</span> : null}
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
    </section>
  );
}

/** The colleague picker's rows: availability, open chats and department, offline people not pickable (TEAM-20, TEAM-21). */
function ColleagueRow({ a, picked, disabled, why, onPick, multi }: { a: Colleague; picked: boolean; disabled: boolean; why: string | null; onPick: () => void; multi: boolean }) {
  const st = STATUS[a.status ?? 'available'];
  return (
    <label className={cx('flex items-center gap-2.5 rounded-[8px] px-2 py-1.5', disabled ? 'opacity-55' : 'cursor-pointer hover:bg-subtle', picked && 'bg-selection')}>
      {multi ? <Checkbox checked={picked} disabled={disabled} onChange={onPick} /> : <input type="radio" name="colleague" checked={picked} disabled={disabled} onChange={onPick} className="accent-primary" />}
      <span className="relative shrink-0">
        <Avatar name={a.name} size={28} />
        <span aria-hidden className={cx('absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface', st.dot)} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="truncate text-[13px] text-ink">{a.name}</b>
        <span className="truncate text-[11.5px] text-ink-3">
          {why ?? st.label}
          {a.open_chats !== undefined ? ` · ${a.open_chats} open chat${a.open_chats === 1 ? '' : 's'}` : ''}
          {a.department ? ` · ${a.department}` : ''}
          {a.on_staff === false ? " · not on this site's staff" : ''}
        </span>
      </span>
    </label>
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

/**
 * Invite (TEAM-UI-02, TEAM-20…22): one or more colleagues, or a department, with a note only staff see. Each invitation
 * rings for two minutes unless the organisation set otherwise.
 */
export function InviteDialog({ conversationId, me, onClose, onDone }: { conversationId: number; me: number | null; onClose: () => void; onDone: () => void }) {
  const agents = useAgents(true, conversationId);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const [dept, setDept] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useMemo(() => (agents.data?.agents ?? []).filter((a) => !q.trim() || `${a.name} ${a.department ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())), [agents.data, q]);
  const departments = agents.data?.departments ?? [];
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
  return (
    <Modal title="Invite to this chat" labelledBy="website-invite" onClose={onClose} width={480} footer={
      <>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={!dept && !picked.length} onClick={() => void send()}>{dept ? 'Invite the department' : picked.length > 1 ? `Invite ${picked.length}` : 'Invite'}</Button>
      </>
    }>
      <div className="flex flex-col gap-2.5">
        <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a colleague" placeholder="Find a colleague…" className="h-8 rounded-[8px] border border-line bg-surface px-2.5 text-[13px] outline-none focus:border-primary" autoFocus />
        <div role="group" aria-label="Colleagues" className="flex max-h-[260px] flex-col overflow-y-auto scroll-thin">
          {agents.isLoading ? <span className="p-2 text-[12px] text-ink-3">Loading…</span> : null}
          {list.map((a) => {
            const why = unpickable(a, me, false);
            return <ColleagueRow key={a.id} a={a} multi picked={picked.includes(a.id)} disabled={!!why || !!dept} why={why} onPick={() => setPicked((p) => (p.includes(a.id) ? p.filter((x) => x !== a.id) : [...p, a.id]))} />;
          })}
          {!agents.isLoading && !list.length ? <span className="p-2 text-[12px] text-ink-3">Nobody matches.</span> : null}
        </div>
        {departments.length ? (
          <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
            Or a department
            <Select aria-label="Department" value={dept} onChange={(e) => setDept(Number(e.target.value))} className="h-8 flex-1 rounded-[7px] border border-line bg-surface px-1.5 text-[12.5px] text-ink">
              <option value={0}>None — the people ticked above</option>
              {departments.map((d) => <option key={d.id} value={d.id} disabled={!d.available}>{d.name} · {d.available} available</option>)}
            </Select>
          </label>
        ) : null}
        <label className="flex flex-col gap-1 text-[12.5px] text-ink-2">
          Note for them (only staff see it)
          <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} rows={2} placeholder="What do you need help with?" className="rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-primary" />
        </label>
      </div>
    </Modal>
  );
}

/**
 * Transfer (TEAM-UI-02, TEAM-40…43): to a colleague, a department or the next available agent; warm — you keep the chat
 * until they accept — or hand over now; with a handover note only staff see.
 */
export function TransferDialog({ conversationId, me, onClose, onDone }: { conversationId: number; me: number | null; onClose: () => void; onDone: () => void }) {
  const agents = useAgents(true, conversationId);
  const [to, setTo] = useState<'person' | 'department' | 'any'>('person');
  const [person, setPerson] = useState(0);
  const [dept, setDept] = useState(0);
  const [mode, setMode] = useState<'warm' | 'cold'>('warm');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const departments = agents.data?.departments ?? [];
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
  return (
    <Modal title="Transfer this chat" labelledBy="website-transfer" onClose={onClose} width={480} footer={
      <>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={!ready} onClick={() => void send()}>{mode === 'cold' ? 'Hand over now' : 'Transfer'}</Button>
      </>
    }>
      <div className="flex flex-col gap-3">
        <div role="radiogroup" aria-label="Transfer to" className="flex gap-1 text-[12px] font-semibold">
          {([['person', 'A colleague'], ['department', 'A department'], ['any', 'Next available']] as const).map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={to === k} onClick={() => setTo(k)} className={cx('rounded-[10px] px-2.5 py-1', to === k ? 'bg-ink text-surface' : 'border border-line text-ink hover:bg-subtle')}>{label}</button>
          ))}
        </div>
        {to === 'person' ? (
          <div role="group" aria-label="Colleagues" className="flex max-h-[220px] flex-col overflow-y-auto scroll-thin">
            {(agents.data?.agents ?? []).map((a) => {
              const why = unpickable(a, me, true);
              return <ColleagueRow key={a.id} a={a} multi={false} picked={person === a.id} disabled={!!why} why={why} onPick={() => setPerson(a.id)} />;
            })}
          </div>
        ) : to === 'department' ? (
          <Select aria-label="Department" value={dept} onChange={(e) => setDept(Number(e.target.value))} className="h-8 rounded-[7px] border border-line bg-surface px-1.5 text-[12.5px] text-ink">
            <option value={0}>Choose a department</option>
            {departments.map((d) => <option key={d.id} value={d.id} disabled={!d.available}>{d.name} · {d.available} available</option>)}
          </Select>
        ) : (
          <p className="text-[12.5px] text-ink-2">Everybody available on this website is asked; the first to accept takes it.</p>
        )}
        <div role="radiogroup" aria-label="How" className="flex flex-col gap-1.5 text-[12.5px]">
          {([
            ['warm', 'Transfer when they accept', 'You keep answering until they do; then you stay in as a participant and can leave.'],
            ['cold', 'Hand over now', 'You leave the chat at once. If nobody takes it, it rings everybody covering the website.'],
          ] as const).map(([k, label, hint]) => (
            <label key={k} className={cx('flex cursor-pointer items-start gap-2 rounded-[8px] border px-2.5 py-1.5', mode === k ? 'border-primary bg-selection' : 'border-line hover:bg-subtle')}>
              <input type="radio" name="mode" checked={mode === k} onChange={() => setMode(k)} className="mt-0.5 accent-primary" />
              <span className="flex flex-col"><b className="text-ink">{label}</b><span className="text-[11.5px] text-ink-3">{hint}</span></span>
            </label>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-[12.5px] text-ink-2">
          Handover note (only staff see it)
          <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} rows={2} placeholder="What should they know?" className="rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-primary" />
        </label>
      </div>
    </Modal>
  );
}

/** The @word being typed at the caret, for the mention list. */
export function mentionQuery(value: string, caret: number): { start: number; word: string } | null {
  const before = value.slice(0, caret);
  const m = /(^|\s)@([\p{L}\p{N}._-]{0,40})$/u.exec(before);
  return m ? { start: before.length - m[2]!.length - 1, word: m[2]!.toLowerCase() } : null;
}

/**
 * The composer's Internal note tab (TEAM-60, TEAM-61): amber, "Only staff see this", never sent to the visitor; @ names
 * a colleague, who is notified. Enter sends; Shift+Enter is a new line.
 */
export function NoteBox({ conversationId, onSent, compact = false }: { conversationId: number; onSent: () => void; compact?: boolean }) {
  const agents = useAgents(true, conversationId);
  const [value, setValue] = useState('');
  const [named, setNamed] = useState<Array<{ id: number; name: string }>>([]);
  const [at, setAt] = useState<{ start: number; word: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  // Colleagues see "Nimal (a note)" typing; the visitor never sees a note being written (LIVE-03).
  const typingAt = useRef(0);
  const typing = (state: 'start' | 'stop') => {
    if (state === 'start') {
      if (Date.now() - typingAt.current < 3_000) return;
      typingAt.current = Date.now();
    } else {
      if (!typingAt.current) return;
      typingAt.current = 0;
    }
    void apiPost(`${WEBSITE}/conversations/${conversationId}/typing`, { state, internal: true }).catch(() => undefined);
  };
  const matches = at ? (agents.data?.agents ?? []).filter((a) => a.name.toLowerCase().includes(at.word)).slice(0, 5) : [];
  const pick = (a: Colleague) => {
    if (!at) return;
    const first = a.name.split(' ')[0] ?? a.name;
    const next = `${value.slice(0, at.start)}@${first} ${value.slice(at.start + 1 + at.word.length)}`;
    setValue(next);
    setNamed((n) => (n.some((x) => x.id === a.id) ? n : [...n, { id: a.id, name: first }]));
    setAt(null);
    box.current?.focus();
  };
  const send = async () => {
    const words = value.trim();
    if (!words || busy) return;
    setBusy(true);
    try {
      // Only the colleagues still named in the words are mentioned.
      const mentions = named.filter((n) => words.includes(`@${n.name}`)).map((n) => n.id);
      typing('stop');
      await team.note(conversationId, words, mentions);
      setValue('');
      setNamed([]);
      onSent();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={cx('relative border-t border-dashed border-[#E2B04A] bg-[#FFF6E0] dark:bg-warning-bg', compact ? 'px-2.5 py-2' : 'px-3.5 py-2.5')}>
      {matches.length ? (
        <ul role="listbox" aria-label="Mention a colleague" className="absolute bottom-full left-3 z-10 mb-1 w-[240px] overflow-hidden rounded-[8px] border border-line bg-surface shadow-lg">
          {matches.map((a) => (
            <li key={a.id} role="option" aria-selected={false}>
              <button type="button" onMouseDown={(e) => (e.preventDefault(), pick(a))} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px] hover:bg-subtle">
                <Avatar name={a.name} size={20} /> <span className="truncate">{a.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <span className="mb-1 flex items-center gap-1.5 text-[11px] font-bold text-[#7A4308] dark:text-warning">
        <Icon name="lock" size={12} /> Only staff see this · the visitor never does
      </span>
      <span className="flex items-end gap-2">
        <textarea
          ref={box}
          value={value}
          aria-label="Internal note"
          placeholder="Write a note for your colleagues — @ to mention someone"
          rows={compact ? 1 : 2}
          onChange={(e) => {
            setValue(e.target.value.slice(0, 4000));
            setAt(mentionQuery(e.target.value, e.target.selectionStart ?? e.target.value.length));
            typing(e.target.value ? 'start' : 'stop');
          }}
          onBlur={() => typing('stop')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (matches[0]) pick(matches[0]);
              else void send();
            } else if (e.key === 'Escape' && at) setAt(null);
          }}
          className="min-h-[36px] flex-1 resize-none rounded-[8px] border border-[#E2B04A] bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-[#C88A12]"
        />
        <Button variant="primary" loading={busy} disabled={!value.trim()} onClick={() => void send()}>Add note</Button>
      </span>
    </div>
  );
}

/**
 * An invitation or transfer this person sent came back declined, unanswered or with nobody taking it (TEAM-24, WF-T2):
 * said in the thread, with Try someone else.
 */
export function useDeclined(conversationId: number, me: number | null, t: WebsiteTeam | null | undefined): { text: string; retry: 'invite' | 'transfer' | null } | null {
  const [notice, setNotice] = useState<{ cid: number; text: string; retry: 'invite' | 'transfer' | null } | null>(null);
  const mine = useRef(new Map<number, { kind: 'invite' | 'transfer'; to: string }>());
  useEffect(() => {
    for (const h of t?.pending ?? []) if (h.from === me) mine.current.set(h.id, { kind: h.kind, to: h.to });
  }, [t, me]);
  useEffect(() => {
    return on<{ type: string; conversation_id?: number; handoff_id?: number; status?: string; by_name?: string | null; visitor?: string | null; released?: boolean }>('realtime:event', (e) => {
      if (e.type !== 'chat.widget.handoff.resolved' || e.conversation_id !== conversationId || e.handoff_id === undefined) return;
      const h = mine.current.get(e.handoff_id);
      if (!h || (e.status !== 'declined' && e.status !== 'expired')) return;
      const who = e.status === 'declined' ? `${e.by_name ?? h.to} declined` : `${h.to} didn't answer`;
      const visitor = e.visitor ?? 'The visitor';
      setNotice(e.released
        ? { cid: conversationId, text: `${who} — nobody took the chat, so it now rings everybody covering the website.`, retry: null }
        : { cid: conversationId, text: `${who} — ${visitor} is still ${h.kind === 'invite' ? 'in your chat' : 'yours'}.`, retry: h.kind });
    });
  }, [conversationId]);
  return notice && notice.cid === conversationId ? { text: notice.text, retry: notice.retry } : null;
}

/** When somebody joined, said briefly for the panel. */
export function joinedLabel(at: string | null | undefined): string {
  if (!at) return '';
  const d = parseTs(at);
  return d.toDateString() === new Date().toDateString() ? timeLabel(at) : dateLabel(at);
}
