import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ApiError, apiGet, apiPost, withMailbox } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { currentZone, dayKey, dayWords, parseTs, timeLabel, todayInZone, wallToUtc } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Menu } from '../../components/Menu';
import { Button, Chip, Modal, TextField, cx } from '../../components/ui';
import type { MessageDetail, MessageRef } from './types';

/**
 * A meeting invite in the reading pane (ENH-MAIL-03 DMO-CAL-01…04, WF-DO06):
 * when, where, the meeting link, who asked and who else is coming, what
 * clashes and the rest of that day — and Accept / Tentative / Decline (send
 * now, edit first, or send nothing), Propose a new time, or Remove from
 * calendar for a cancelled one. The server reads the invite from the message
 * and keeps the WorkSuite calendar in step.
 */

export interface Invite {
  method: string;
  uid: string;
  sequence: number;
  status: string;
  summary: string;
  location: string | null;
  description: string | null;
  start: string;
  end: string;
  all_day: boolean;
  recurring: boolean;
  organizer: { email: string; name: string | null } | null;
  attendees: Array<{ email: string; name: string | null; status: string; role: string }>;
  meet_url: string | null;
  comment: string | null;
  warning: string | null;
}

export interface InviteView {
  invite: Invite;
  me: string;
  event_id: number | null;
  state: 'new' | 'answered' | 'updated' | 'cancelled' | 'cancelled_gone' | 'reply';
  response: 'accepted' | 'tentative' | 'declined' | null;
  applied: boolean;
  can_respond: boolean;
  conflicts: Array<{ title: string; start: string; end: string; all_day: boolean }>;
  day: Array<{ title: string; start: string; end: string; all_day: boolean }>;
}

type Response = 'accepted' | 'tentative' | 'declined';

/** Does the message carry a calendar invite? */
export function hasInvite(m: Pick<MessageDetail, 'attachments'>): boolean {
  return m.attachments.some((a) => /^(text\/calendar|application\/ics)$/i.test(a.mime ?? '') || /\.ics$/i.test(a.name));
}

/** "Mon 12 Oct, 10:00 – 11:00", on the reader's clock. */
export function inviteWhen(i: Pick<Invite, 'start' | 'end' | 'all_day'>): string {
  const day = dayKey(parseTs(i.start));
  const words = dayWords(day, { weekday: true, long: true });
  if (i.all_day) return text('{day}, all day', { day: words });
  const endDay = dayKey(parseTs(i.end));
  return endDay === day ? `${words}, ${timeLabel(i.start)} – ${timeLabel(i.end)}` : `${words}, ${timeLabel(i.start)} – ${dayWords(endDay, { weekday: true })} ${timeLabel(i.end)}`;
}

const RESPONSE_WORDS: Record<Response, string> = { accepted: 'Accepted', tentative: 'Tentative', declined: 'Declined' };

export function InviteCard({ msgRef, offline }: { msgRef: MessageRef; offline: boolean }) {
  const qc = useQueryClient();
  const key = ['mail', 'invite', msgRef.mailbox ?? 0, msgRef.folder, msgRef.uid];
  const q = useQuery({
    queryKey: key,
    queryFn: async () => {
      try {
        return await apiGet<InviteView>(`/api/mail/messages/${msgRef.uid}/invite`, withMailbox({ folder: msgRef.folder }, msgRef.mailbox));
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return null;
        throw e;
      }
    },
    enabled: !offline,
    staleTime: 60_000,
    retry: false,
  });
  const [menu, setMenu] = useState<Response | null>(null);
  const [editing, setEditing] = useState<Response | null>(null);
  const [proposing, setProposing] = useState(false);
  const [people, setPeople] = useState(false);
  const [busy, setBusy] = useState(false);
  const anchors = { accepted: useRef<HTMLSpanElement>(null), tentative: useRef<HTMLSpanElement>(null), declined: useRef<HTMLSpanElement>(null) };

  if (offline) return <p className="mx-5 mt-3 rounded-[10px] border border-line bg-subtle px-3 py-2 text-[12.5px] text-ink-3">{text('This message has a meeting invite. Answer it when you are back online.')}</p>;
  const v = q.data;
  if (!v) return null;
  const i = v.invite;

  const respond = async (response: Response, send: boolean, comment = '', propose?: { start: string; end: string }) => {
    setBusy(true);
    try {
      const r = await apiPost<{ message?: string }>(`/api/mail/messages/${msgRef.uid}/invite`, { mailbox: msgRef.mailbox ?? null, folder: msgRef.folder, response, send, comment, ...(propose ? { propose } : {}) });
      toast('success', r?.message ?? text('Done.'));
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ['calendar'] });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await apiPost(`/api/mail/messages/${msgRef.uid}/invite/remove`, { mailbox: msgRef.mailbox ?? null, folder: msgRef.folder });
      toast('success', text('Removed from your calendar.'));
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ['calendar'] });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const cancelled = v.state === 'cancelled' || v.state === 'cancelled_gone';
  const answering = v.can_respond && !cancelled && v.state !== 'reply' && (i.method === 'REQUEST' || i.method === 'PUBLISH');
  const replier = i.attendees[0];
  const going = i.attendees.filter((a) => a.status === 'accepted').length;

  return (
    <section aria-label={text('Meeting invite')} className={cx('mx-5 mt-3 rounded-[12px] border bg-surface p-4 text-[13.5px]', cancelled ? 'border-danger/40' : 'border-line')}>
      <div className="flex items-start gap-3">
        <span className={cx('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px]', cancelled ? 'bg-danger-bg text-danger' : 'bg-selection text-primary')}>
          <Icon name="calendar" size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={cx('text-[15px] font-bold text-ink', cancelled && 'line-through')}>{i.summary}</h3>
            {cancelled ? <Chip tone="danger">{text('Cancelled')}</Chip> : null}
            {v.state === 'updated' ? <Chip tone="warning">{text('Changed by the organiser')}</Chip> : null}
            {v.response && v.state !== 'updated' ? <Chip tone={v.response === 'declined' ? 'muted' : 'success'}>{text(RESPONSE_WORDS[v.response])}</Chip> : null}
            {i.recurring ? <Chip tone="muted">{text('Repeats')}</Chip> : null}
          </div>
          <p className="mt-0.5 font-semibold text-ink-2">{inviteWhen(i)}</p>
          {i.location ? <p className="text-ink-2">{i.location}</p> : null}
          {i.organizer ? <p className="text-[12.5px] text-ink-3">{text('Organiser: {name}', { name: i.organizer.name ? `${i.organizer.name} <${i.organizer.email}>` : i.organizer.email })}</p> : null}
          {i.attendees.length && v.state !== 'reply' ? (
            <button type="button" aria-expanded={people} onClick={() => setPeople(!people)} className="mt-0.5 text-[12.5px] font-semibold text-primary hover:underline">
              {text('{n} invited · {going} going', { n: i.attendees.length, going })}
            </button>
          ) : null}
          {people ? (
            <ul className="mt-1 flex flex-col gap-0.5 text-[12.5px] text-ink-2">
              {i.attendees.map((a) => (
                <li key={a.email}>
                  {a.name || a.email} · <span className="text-ink-3">{text(a.status === 'accepted' ? 'Accepted' : a.status === 'declined' ? 'Declined' : a.status === 'tentative' ? 'Tentative' : 'No answer yet')}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {i.meet_url ? (
          <Button size="sm" icon="video" onClick={() => void call('app:openExternal', { url: i.meet_url! })}>
            {text('Join')}
          </Button>
        ) : null}
      </div>

      {v.state === 'reply' && replier ? (
        <p className="mt-3 text-ink-2">
          {text('{name} answered: {answer}.', { name: replier.name || replier.email, answer: text(replier.status === 'accepted' ? 'Accepted' : replier.status === 'declined' ? 'Declined' : 'Tentative') })} {v.applied ? text('Your calendar has been updated.') : ''}
          {i.comment ? <span className="block text-ink-3">“{i.comment}”</span> : null}
        </p>
      ) : null}
      {i.warning ? <p className="mt-2 rounded-[8px] bg-warning-bg px-2.5 py-1.5 text-[12.5px] text-warning">{i.warning}</p> : null}
      {v.conflicts.length && !cancelled ? (
        <p role="note" className="mt-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-warning">
          <Icon name="warning" size={13} />
          {text('Clashes with {list}', { list: v.conflicts.map((c) => `${c.title} (${timeLabel(c.start)}–${timeLabel(c.end)})`).join(', ') })}
        </p>
      ) : null}
      {v.day.length || !cancelled ? <DayStrip invite={i} day={v.day} /> : null}

      {answering ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {(['accepted', 'tentative', 'declined'] as const).map((r) => (
            <span key={r} ref={anchors[r]} className="inline-flex">
              <Button size="sm" variant={r === 'accepted' ? 'primary' : 'secondary'} icon={r === 'accepted' ? 'check' : r === 'declined' ? 'x' : 'help'} loading={busy && menu === r} aria-haspopup="menu" aria-expanded={menu === r} onClick={() => setMenu(menu === r ? null : r)}>
                {text(r === 'accepted' ? 'Accept' : r === 'tentative' ? 'Tentative' : 'Decline')}
              </Button>
            </span>
          ))}
          <Button size="sm" variant="ghost" icon="clock" onClick={() => setProposing(true)} disabled={!i.organizer}>
            {text('Propose new time')}
          </Button>
        </div>
      ) : null}
      {!v.can_respond && !cancelled && v.state !== 'reply' ? <p className="mt-3 text-[12.5px] text-ink-3">{text('This invite came to a shared mailbox. Answer it from that mailbox’s calendar.')}</p> : null}
      {v.state === 'cancelled' ? (
        <div className="mt-3">
          <Button size="sm" variant="danger" icon="trash" loading={busy} onClick={() => void remove()}>
            {text('Remove from calendar')}
          </Button>
        </div>
      ) : null}
      {v.state === 'cancelled_gone' ? <p className="mt-2 text-[12.5px] text-ink-3">{text('It is not in your calendar.')}</p> : null}

      {menu ? (
        <Menu
          label={text(RESPONSE_WORDS[menu])}
          anchor={anchors[menu]}
          prefer="bottom"
          align="start"
          onClose={() => setMenu(null)}
          sections={[
            {
              id: 'send',
              items: [
                { id: 'now', label: text('Send the response now'), icon: 'send', disabled: !i.organizer, reason: text('The invite names no organiser to answer.'), onSelect: () => void respond(menu, true) },
                { id: 'edit', label: text('Edit the response before sending'), icon: 'pen', disabled: !i.organizer, reason: text('The invite names no organiser to answer.'), onSelect: () => setEditing(menu) },
                { id: 'none', label: text('Do not send a response'), icon: 'bell-off', onSelect: () => void respond(menu, false) },
              ],
            },
          ]}
        />
      ) : null}
      {editing ? <EditResponse response={editing} onClose={() => setEditing(null)} onSend={(comment) => void respond(editing, true, comment).then(() => setEditing(null))} /> : null}
      {proposing ? (
        <ProposeTime
          invite={i}
          onClose={() => setProposing(false)}
          onSend={(start, end, comment) => void respond('tentative', true, comment, { start, end }).then(() => setProposing(false))}
        />
      ) : null}
    </section>
  );
}

/** The rest of that day, with the invite's slot marked: a mini day view. */
function DayStrip({ invite, day }: { invite: Invite; day: InviteView['day'] }) {
  const rows = [...day.map((d) => ({ ...d, mine: false })), ...(invite.all_day ? [] : [{ title: invite.summary, start: invite.start, end: invite.end, all_day: false, mine: true }])].sort((a, b) => a.start.localeCompare(b.start));
  if (!rows.length) return null;
  return (
    <div aria-label={text('Your day')} role="group" className="mt-3 rounded-[10px] border border-line bg-subtle/60 p-2">
      <p className="mb-1 text-[11.5px] font-bold uppercase tracking-wide text-ink-3">{text('Your day')}</p>
      <ul className="flex flex-col gap-1">
        {rows.map((r, n) => (
          <li key={`${r.start}-${n}`} className={cx('flex items-center gap-2 rounded-[6px] px-2 py-1 text-[12.5px]', r.mine ? 'bg-selection font-semibold text-primary' : 'text-ink-2')}>
            <span className="w-[92px] shrink-0 tabular-nums">{r.all_day ? text('All day') : `${timeLabel(r.start)}–${timeLabel(r.end)}`}</span>
            <span className="truncate">{r.mine ? text('{title} (this invite)', { title: r.title }) : r.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EditResponse({ response, onClose, onSend }: { response: Response; onClose: () => void; onSend: (comment: string) => void }) {
  const [comment, setComment] = useState('');
  return (
    <Modal
      title={text('{answer} — add a note', { answer: text(RESPONSE_WORDS[response]) })}
      labelledBy="mail-invite-edit"
      width={440}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{text('Cancel')}</Button>
          <Button variant="primary" onClick={() => onSend(comment)}>
            {text('Send')}
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-1 p-5">
        <span className="text-[12.5px] font-semibold text-ink-2">{text('Note to the organiser')}</span>
        <textarea autoFocus value={comment} onChange={(e) => setComment(e.target.value)} rows={4} maxLength={1000} className="rounded-[8px] border border-line bg-surface px-3 py-2 text-[13.5px] text-ink outline-none focus:border-primary" />
      </label>
    </Modal>
  );
}

/** "14:30" on the WorkSuite clock, for a time field. */
const hm = (stamp: string) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: currentZone() }).format(parseTs(stamp));
const toMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const utcStamp = (iso: string) => iso.replace('T', ' ').slice(0, 19);

/** Propose a new time (iTIP COUNTER): a day and a start and end on the reader's clock. */
function ProposeTime({ invite, onClose, onSend }: { invite: Invite; onClose: () => void; onSend: (startUtc: string, endUtc: string, comment: string) => void }) {
  const [date, setDate] = useState(() => (invite.all_day ? todayInZone() : dayKey(parseTs(invite.start))));
  const [start, setStart] = useState(() => (invite.all_day ? '09:00' : hm(invite.start)));
  const [end, setEnd] = useState(() => (invite.all_day ? '10:00' : hm(invite.end)));
  const [comment, setComment] = useState('');
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end) && toMinutes(end) > toMinutes(start);
  return (
    <Modal
      title={text('Propose a new time')}
      labelledBy="mail-invite-propose"
      width={440}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{text('Cancel')}</Button>
          <Button variant="primary" disabled={!ok} onClick={() => onSend(utcStamp(wallToUtc(date, toMinutes(start))), utcStamp(wallToUtc(date, toMinutes(end))), comment)}>
            {text('Send proposal')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 p-5">
        <p className="text-[12.5px] text-ink-3">{text('The organiser gets your proposal and decides. Your answer is sent as Tentative.')}</p>
        <TextField type="date" label={text('Day')} value={date} onChange={(e) => setDate(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <TextField type="time" label={text('Starts')} value={start} onChange={(e) => setStart(e.target.value)} />
          <TextField type="time" label={text('Ends')} value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        {!ok ? <p className="text-[12.5px] text-danger">{text('The end must be after the start.')}</p> : null}
        <label className="flex flex-col gap-1">
          <span className="text-[12.5px] font-semibold text-ink-2">{text('Note to the organiser')}</span>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={1000} className="rounded-[8px] border border-line bg-surface px-3 py-2 text-[13.5px] text-ink outline-none focus:border-primary" />
        </label>
      </div>
    </Modal>
  );
}

