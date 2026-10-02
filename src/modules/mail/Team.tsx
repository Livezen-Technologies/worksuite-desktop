import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiDelete, apiGet, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { addDays, timeLabel, todayInZone, wallToUtc } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Menu } from '../../components/Menu';
import { Avatar, Button, ErrorNote, cx } from '../../components/ui';
import { sendMessage } from './api';
import { rowStamp } from './model';
import { sendAfterUndoWindow } from './outgoing';
import { textToHtml } from './sanitize';
import type { Mailbox, MessageDetail, MessageRef, TeamNote } from './types';

/**
 * A shared mailbox worked as a team (Mail SRS v2.2 UI-W4, MAIL-TEAM-01…04,
 * design D06): who has the conversation and where it stands, snoozing it,
 * who else is looking at it right now, the team's internal notes, and a
 * reply box that answers as the shared address — or adds a note instead.
 */

/** The moments Snooze offers, on the reader's clock: later today, tomorrow and Monday morning. */
export function snoozeChoices(now = new Date(), today = todayInZone()): Array<{ id: string; label: string; at: string }> {
  const out: Array<{ id: string; label: string; at: string }> = [];
  const inThree = new Date(now.getTime() + 3 * 3600_000);
  out.push({ id: 'later', label: text('Later today'), at: inThree.toISOString() });
  out.push({ id: 'tomorrow', label: text('Tomorrow morning'), at: wallToUtc(addDays(today, 1), 8 * 60) });
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  out.push({ id: 'monday', label: text('Monday morning'), at: wallToUtc(addDays(today, (8 - dow) % 7 || 7), 8 * 60) });
  return out;
}

/** "Kasun is viewing this conversation", "Kasun and Samali are viewing…". */
export function viewersWords(names: string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return text('{name} is viewing this conversation', { name: names[0]! });
  if (names.length === 2) return text('{a} and {b} are viewing this conversation', { a: names[0]!, b: names[1]! });
  return text('{a} and {n} others are viewing this conversation', { a: names[0]!, n: names.length - 1 });
}

const re = (s: string) => (/^re:/i.test(s) ? s : `Re: ${s}`);

/** The team's controls over the message: assign, status, snooze, done (D06's toolbar). */
export function TeamBar({ msgRef, m, me }: { msgRef: MessageRef; m: MessageDetail; me: number | null }) {
  const qc = useQueryClient();
  const team = m.team!;
  const people = useQuery({ queryKey: ['mail', 'team', 'assignees', msgRef.mailbox], queryFn: () => apiGet<{ users: Array<{ id: number; name: string }> }>('/api/mail/messages/team/assignees', { mailbox: msgRef.mailbox }), staleTime: 5 * 60_000, retry: false });
  const [menu, setMenu] = useState<'assign' | 'status' | 'snooze' | null>(null);
  const assignBtn = useRef<HTMLButtonElement>(null);
  const statusBtn = useRef<HTMLButtonElement>(null);
  const snoozeBtn = useRef<HTMLButtonElement>(null);
  const base = { mailbox: msgRef.mailbox, conversation_key: m.conversation_key, subject: m.subject, from_email: m.from_email, created_at: m.created_at };
  const run = async (path: string, body: Record<string, unknown>, done?: string) => {
    try {
      await apiPost(`/api/mail/messages/team/${path}`, { ...base, ...body });
      void qc.invalidateQueries({ queryKey: ['mail'] });
      if (done) toast('success', done);
    } catch (e) {
      toast('error', e instanceof ApiError && e.status === 409 ? e.message : errorMessage(e));
    }
  };
  const statusName = team.status === 'closed' ? text('Done') : team.status === 'answered' ? text('Pending') : text('Open');
  const mine = me !== null && team.assignee_id === me;
  // The server sends a snooze only while it lasts.
  const snoozed = team.snoozed_until ?? null;
  return (
    <div role="toolbar" aria-label={text('Team actions')} className="flex flex-wrap items-center gap-1.5 border-b border-line px-6 py-2.5 text-[12.5px]">
      <button ref={assignBtn} type="button" onClick={() => setMenu('assign')} aria-haspopup="menu" className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line px-2.5 font-semibold text-ink hover:bg-subtle">
        {team.assignee_name ? <Avatar name={team.assignee_name} size={20} /> : <Icon name="user" size={15} />}
        {mine ? text('Assigned to me') : team.assignee_name ? text('Assigned to {name}', { name: team.assignee_name }) : text('Unassigned')}
        <Icon name="chevron-down" size={12} />
      </button>
      <button ref={statusBtn} type="button" onClick={() => setMenu('status')} aria-haspopup="menu" className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line px-2.5 font-semibold text-ink hover:bg-subtle">
        {text('Status: {status}', { status: statusName })}
        <Icon name="chevron-down" size={12} />
      </button>
      <button ref={snoozeBtn} type="button" onClick={() => setMenu('snooze')} aria-haspopup="menu" className={cx('inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 font-semibold hover:bg-subtle', snoozed ? 'bg-selection text-primary' : 'text-ink')}>
        <Icon name="clock" size={14} />
        {snoozed ? text('Snoozed until {time}', { time: `${rowStamp(snoozed)} ${timeLabel(snoozed)}` }) : text('Snooze')}
      </button>
      <span className="flex-1" />
      {team.status !== 'closed' ? (
        <Button variant="success" size="sm" onClick={() => void run('status', { status: 'closed' }, text('Marked done.'))}>
          Mark done
        </Button>
      ) : null}
      {menu === 'assign' ? (
        <Menu
          label={text('Assign')}
          anchor={assignBtn}
          prefer="bottom"
          align="start"
          onClose={() => setMenu(null)}
          sections={[
            {
              id: 'me',
              items: [
                { id: 'claim', label: text('Assign to me'), icon: 'user', disabled: mine, onSelect: () => void run('claim', {}) },
                { id: 'release', label: text('Unassign'), icon: 'x', disabled: !team.assignee_id, onSelect: () => void run('release', { force: !mine }) },
              ],
            },
            { id: 'people', label: text('Assign to'), items: (people.data?.users ?? []).filter((u) => u.id !== me).map((u) => ({ id: String(u.id), label: u.name, checked: team.assignee_id === u.id, onSelect: () => void run('assign', { assignee_id: u.id }) })) },
          ]}
        />
      ) : null}
      {menu === 'status' ? (
        <Menu
          label={text('Status')}
          anchor={statusBtn}
          prefer="bottom"
          align="start"
          onClose={() => setMenu(null)}
          sections={[
            {
              id: 'status',
              items: [
                { id: 'open', label: text('Open'), radio: true, checked: team.status === 'open', onSelect: () => void run('status', { status: 'open' }) },
                { id: 'answered', label: text('Pending'), description: text('Waiting on the customer'), radio: true, checked: team.status === 'answered', onSelect: () => void run('status', { status: 'answered' }) },
                { id: 'closed', label: text('Done'), radio: true, checked: team.status === 'closed', onSelect: () => void run('status', { status: 'closed' }) },
              ],
            },
          ]}
        />
      ) : null}
      {menu === 'snooze' ? (
        <Menu
          label={text('Snooze')}
          anchor={snoozeBtn}
          prefer="bottom"
          align="start"
          onClose={() => setMenu(null)}
          sections={[
            { id: 'when', label: text('Back in the queue'), items: snoozeChoices().map((c) => ({ id: c.id, label: c.label, description: `${rowStamp(c.at)} ${timeLabel(c.at)}`, icon: 'clock', onSelect: () => void run('snooze', { until: c.at }, text('Snoozed. It comes back by itself, or when the customer writes again.')) })) },
            ...(snoozed ? [{ id: 'wake', items: [{ id: 'wake', label: text('Back in the queue now'), icon: 'inbox', onSelect: () => void run('snooze', { until: null }, text('Back in the queue.')) }] }] : []),
          ]}
        />
      ) : null}
    </div>
  );
}

/** Who else has the conversation open: this page says so every 30 s while it is open, and goodbye when it closes. */
function useViewers(msgRef: MessageRef, key: string | undefined): string[] {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    if (!key || !msgRef.mailbox) return;
    let stop = false;
    const tell = (open: boolean) =>
      apiPost<{ viewers: Array<{ id: number; name: string }> }>('/api/mail/messages/team/viewing', { mailbox: msgRef.mailbox, conversation_key: key, open })
        .then((r) => {
          if (!stop && open) setNames(r.viewers.map((v) => v.name));
        })
        .catch(() => undefined);
    void tell(true);
    const t = setInterval(() => void tell(true), 30_000);
    return () => {
      stop = true;
      clearInterval(t);
      void tell(false);
    };
  }, [msgRef.mailbox, key]);
  return names;
}

/** The team's notes on the conversation, and the reply box: Reply as the shared address, or Internal note (D06). */
export function TeamWork({ msgRef, m, account, offline }: { msgRef: MessageRef; m: MessageDetail; account: Mailbox | null; offline: boolean }) {
  const qc = useQueryClient();
  const key = m.conversation_key;
  const notes = useQuery({
    queryKey: ['mail', 'team', 'notes', msgRef.mailbox, key],
    queryFn: () => apiGet<{ notes: TeamNote[] }>('/api/mail/messages/team/notes', { mailbox: msgRef.mailbox, conversation_key: key }),
    enabled: !!key && !!msgRef.mailbox && !offline,
    retry: false,
    refetchInterval: 60_000,
  });
  const viewers = useViewers(msgRef, offline ? undefined : key);
  const [mode, setMode] = useState<'reply' | 'note'>('reply');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const short = account ? `${account.email.split('@')[0]}@` : text('the shared address');
  const list = notes.data?.notes ?? [];
  const refresh = () => void qc.invalidateQueries({ queryKey: ['mail', 'team'] });

  const addNote = async () => {
    setBusy(true);
    try {
      await apiPost('/api/mail/messages/team/notes', { mailbox: msgRef.mailbox, conversation_key: key, body: draft, subject: m.subject, from_email: m.from_email, created_at: m.created_at });
      setDraft('');
      refresh();
      void qc.invalidateQueries({ queryKey: ['mail', 'messages'] });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const removeNote = async (id: number) => {
    try {
      await apiDelete(`/api/mail/messages/team/notes/${id}`, { mailbox: msgRef.mailbox });
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const reply = (close: boolean) => {
    const body = draft.trim();
    if (!body) return;
    const subject = re(m.subject);
    const payload = { to: [m.from_email], cc: [], bcc: [], subject, body_html: textToHtml(body), in_reply_to: m.message_id, reply_mode: 'reply', mailbox: msgRef.mailbox ?? undefined, attachments: [] };
    const kept = draft;
    setDraft('');
    sendAfterUndoWindow(
      subject,
      async () => {
        try {
          const outcome = await sendMessage(payload, text('Send “{subject}” to {to}', { subject, to: m.from_email }));
          if (close && key) await apiPost('/api/mail/messages/team/status', { mailbox: msgRef.mailbox, conversation_key: key, status: 'closed', subject: m.subject, from_email: m.from_email, created_at: m.created_at });
          void qc.invalidateQueries({ queryKey: ['mail'] });
          toast(outcome === 'queued' ? 'info' : 'success', outcome === 'queued' ? text('Offline — “{subject}” sends when you reconnect.', { subject }) : close ? text('Sent, and marked done.') : text('Sent.'));
        } catch (e) {
          setDraft(kept);
          toast('error', text('“{subject}” was not sent: {reason}', { subject, reason: errorMessage(e) }));
        }
      },
      () => setDraft(kept),
    );
  };
  const who = viewersWords(viewers);

  return (
    <div className="flex max-h-[45%] shrink-0 flex-col gap-3 overflow-y-auto px-5 pb-3 pt-3 scroll-thin">
      {list.length || notes.error ? (
        <section aria-label={text('Internal notes')} className="flex flex-col gap-2 rounded-[12px] border border-line bg-warning-bg px-3.5 py-3">
          <b className="text-[12px] text-warning">Internal notes · only the team sees these</b>
          {notes.error ? <ErrorNote error={notes.error} onRetry={() => void notes.refetch()} /> : null}
          {list.map((n) => (
            <div key={n.id} className="group flex gap-2.5">
              <Avatar name={n.name} size={24} />
              <span className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-ink">
                <b>{n.mine ? text('You') : n.name}</b> <span className="text-ink-3">{`${rowStamp(n.created_at)} ${timeLabel(n.created_at)}`}</span>
                <br />
                <span className="whitespace-pre-line selectable">{n.body}</span>
              </span>
              {n.mine ? (
                <button type="button" onClick={() => void removeNote(n.id)} aria-label={text('Remove this note')} title={text('Remove this note')} className="h-6 w-6 shrink-0 rounded-[6px] text-ink-3 opacity-0 hover:bg-surface hover:text-danger focus:opacity-100 group-hover:opacity-100">
                  <Icon name="x" size={13} />
                </button>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}
      <div className="flex flex-col overflow-hidden rounded-[12px] border border-line">
        <div className="flex items-center gap-2 border-b border-line bg-subtle px-3 py-2 text-[12px]">
          <span role="radiogroup" aria-label={text('Reply or note')} className="flex rounded-[8px] bg-ground p-0.5 font-semibold">
            <button type="button" role="radio" aria-checked={mode === 'reply'} onClick={() => setMode('reply')} className={cx('rounded-[6px] px-2.5 py-1', mode === 'reply' ? 'bg-surface text-ink shadow-sm' : 'text-ink-2')}>
              {text('Reply as {address}', { address: short })}
            </button>
            <button type="button" role="radio" aria-checked={mode === 'note'} onClick={() => setMode('note')} className={cx('rounded-[6px] px-2.5 py-1', mode === 'note' ? 'bg-surface text-ink shadow-sm' : 'text-ink-2')}>
              Internal note
            </button>
          </span>
          <span className="flex-1" />
          {who ? (
            <span role="status" className="flex items-center gap-1.5 font-semibold text-warning">
              <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-warning" />
              {who}
            </span>
          ) : null}
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label={mode === 'reply' ? text('Reply to {email}', { email: m.from_email }) : text('Internal note for the team')}
          placeholder={mode === 'reply' ? text('Write a reply…') : text('Write a note only the team sees…')}
          rows={3}
          className={cx('min-h-[64px] resize-y px-3.5 py-2.5 text-[13px] text-ink outline-none placeholder:text-ink-3', mode === 'note' ? 'bg-warning-bg' : 'bg-surface')}
        />
        <div className="flex items-center gap-2 border-t border-line px-3 py-2">
          {mode === 'reply' ? (
            <>
              <Button variant="primary" size="sm" onClick={() => reply(false)} disabled={!draft.trim()}>
                Send
              </Button>
              <Button size="sm" onClick={() => reply(true)} disabled={!draft.trim()}>
                Send and close
              </Button>
            </>
          ) : (
            <Button variant="primary" size="sm" loading={busy} onClick={() => void addNote()} disabled={!draft.trim() || offline}>
              Add note
            </Button>
          )}
          <span className="flex-1" />
          <span className="text-[11.5px] text-ink-3">{mode === 'reply' ? text('From {email} · you can undo for a few seconds', { email: account?.email ?? '' }) : text('Never sent to the customer')}</span>
        </div>
      </div>
    </div>
  );
}
