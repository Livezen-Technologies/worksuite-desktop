import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../../core/api';
import { errorMessage } from '../../../core/bridge';
import { text } from '../../../core/i18n';
import { conversationStamp, parseTs, timeLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { Avatar, Button, Chip, ErrorNote, Spinner, cx } from '../../../components/ui';
import { WEBSITE_CAPS } from '../kit/caps';
import { MessageList } from '../kit/MessageList';
import { byTime, fromWebsiteMessage } from '../kit/model';
import { team, useAgents, useWebsiteConversation, websiteAction, WEBSITE } from './api';
import { firstName, FollowUpRow, ReplyByEmail, visitFacts } from './Missed';
import { PANEL_CARD, PANEL_HEADING, pathOf, Tag } from './rowParts';

/**
 * Offline enquiries (C-05, X-UI-03): messages left while nobody was available or outside business hours. Each row has
 * why it was left — the reason chip — and whether it was answered (UX-OFF-01); the detail has their message, email,
 * phone and page, a staff-only note, Assign, Close and Reply by email (UX-MISS-02), read without arriving in the chat
 * (`review`) so looking at one neither claims it nor stops a returning visitor's chat from ringing (MIS-02).
 */

export type OfflineReason = 'hours' | 'no_agents' | 'maintenance';

export interface OfflineEnquiry {
  id: number;
  widget_id: number;
  widget: string;
  visitor: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  place: string | null;
  /** The page they wrote from. */
  url: string | null;
  status: string;
  received_at: string | null;
  last_visitor_at: string | null;
  preview: string | null;
  /** Null when it was not recorded (an enquiry from before the server kept it). */
  reason: OfflineReason | null;
  /** The widget's hours, "Mon–Fri, 8:30 AM–5:30 PM", when the reason is the hours. */
  hours: string | null;
  online: boolean;
  left_at: string | null;
  replied: { how: 'email' | 'chat'; at: string | null; by: string | null } | null;
  assigned_to: number | null;
  agent: string | null;
}

export interface OfflineList {
  offline: OfflineEnquiry[];
  /** Not yet answered. */
  count: number;
}

/** The enquiries, polled like Missed chats; an older server answers 404 and the section keeps its rows from the inbox. */
export function useOffline() {
  return useQuery({
    queryKey: ['website', 'offline'],
    queryFn: ({ signal }) => apiGet<OfflineList>(`${WEBSITE}/offline`, undefined, signal),
    refetchInterval: 60_000,
    retry: false,
  });
}

/** The reason chip on a row (C-05): "Outside hours", "Nobody online". */
export const REASON_CHIP: Record<OfflineReason, string> = { hours: 'Outside hours', no_agents: 'Nobody online', maintenance: 'Chat switched off' };

/** The detail's WHY OFFLINE: "Outside business hours (Mon–Fri, 8:30 AM–5:30 PM)". */
export function whyOffline(e: Pick<OfflineEnquiry, 'reason' | 'hours'>): string | null {
  if (e.reason === 'hours') return e.hours ? text('Outside business hours ({hours})', { hours: e.hours }) : text('Outside business hours');
  if (e.reason === 'no_agents') return text('Nobody was online to answer');
  if (e.reason === 'maintenance') return text('The chat was switched off');
  return null;
}

/** "Sat 22:41", "Yesterday 19:05", "09:14" today: when it was left, to the minute, since enquiries are worked through by time. */
export function enquiryStamp(at: string | null | undefined): string {
  if (!at) return '';
  const day = conversationStamp(at);
  const time = timeLabel(at);
  return !day || day === time ? time : `${day} ${time}`;
}

/** "Emailed by Dilini", "Replied by Samali": how it was answered and who by. */
export function repliedLine(r: OfflineEnquiry['replied']): string | null {
  if (!r) return null;
  const by = r.by ? firstName(r.by) : null;
  if (r.how === 'email') return by ? text('Emailed by {name}', { name: by }) : text('Replied by email');
  return by ? text('Replied by {name}', { name: by }) : text('Replied');
}

/** An enquiry in the list (C-05): who, when, their first words, why it was left and whether it was answered. */
export function OfflineRow({ e, active, onOpen }: { e: OfflineEnquiry; active: boolean; onOpen: () => void }) {
  const replied = repliedLine(e.replied);
  const line = e.preview ? `“${e.preview}”` : (e.email ?? e.phone ?? '');
  return (
    <FollowUpRow id={e.id} name={e.visitor} online={e.online} stamp={enquiryStamp(e.received_at)} line={line} active={active} onOpen={onOpen}>
      <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
        {e.reason ? <Tag tone="muted">{text(REASON_CHIP[e.reason])}</Tag> : null}
        {/* Back on the site matters most: the chat is in Live chats and rings (MIS-02); then whether anybody answered. */}
        {e.online ? <Tag tone="success">{text('Back on the site')}</Tag> : replied ? <Tag tone="indigo">{replied}</Tag> : <Tag tone="warning">{text('Not replied')}</Tag>}
      </span>
    </FollowUpRow>
  );
}

/**
 * One enquiry (C-05 detail): their message with the email, phone and page they left; a note for the team that only
 * staff see; and, beside it, what is known about the visitor and why nobody answered. The chat itself is opened only
 * from Open chat, while they are back on the site.
 */
export function OfflineDetail({ id, e, me, onOpenChat, onClosed }: { id: string; e: OfflineEnquiry | undefined; me: number | null; onOpenChat: () => void; onClosed: () => void }) {
  const qc = useQueryClient();
  const q = useWebsiteConversation(id, { review: true });
  const canReply = q.data?.can?.reply !== false;
  const agents = useAgents(!!q.data && canReply);
  const [busy, setBusy] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [note, setNote] = useState('');
  const [noting, setNoting] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['website'] });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <div className="p-6"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div>;
  const data = q.data;
  if (!data) return null;
  const c = data.conversation;
  const v = data.visitor;
  const name = v?.name || e?.visitor || v?.label || text('Visitor');
  const first = firstName(name);
  const company = v?.company ?? e?.company ?? null;
  const email = v?.email ?? e?.email ?? null;
  const phone = v?.phone ?? e?.phone ?? null;
  const online = e?.online ?? false;
  const page = e?.url ?? v?.current_url ?? null;
  const assigned = c.assigned_to ?? e?.assigned_to ?? null;
  const replied = repliedLine(e?.replied ?? null);
  const why = e ? whyOffline(e) : null;
  const { placeLine, visitLine } = visitFacts(data, e?.place);

  // Their words: what they wrote before anybody answered; the rest of the chat is shown under it once there is one.
  const publicMessages = data.messages.filter((m) => m.visibility !== 'internal' && !m.deleted);
  const firstReply = publicMessages.findIndex((m) => m.from === 'agent');
  const theirs = (firstReply < 0 ? publicMessages : publicMessages.slice(0, firstReply)).filter((m) => m.from === 'visitor' && m.body).map((m) => m.body).join('\n\n') || e?.preview || '';
  const after = firstReply < 0 ? [] : byTime(publicMessages.slice(firstReply).filter((m) => m.from !== 'system').map((x) => fromWebsiteMessage(x, { me: null, visitor: name, canReply: false })));
  const notes = data.messages.filter((m) => m.visibility === 'internal' && !m.deleted);
  const when = e?.received_at ?? c.started_at;
  const today = when ? parseTs(when).toDateString() === new Date().toDateString() : false;

  const act = (fn: () => Promise<unknown>, done: string, then?: () => void) => {
    setBusy(true);
    void fn().then(
      () => {
        toast('success', done);
        setBusy(false);
        refresh();
        then?.();
      },
      (err) => {
        toast('error', errorMessage(err));
        setBusy(false);
      },
    );
  };
  const others = (agents.data?.agents ?? []).filter((a) => a.id !== me);
  const assignOptions = [
    ...(me !== null ? [{ value: String(me), label: text('Assign to me') }] : []),
    ...others.map((a) => ({ value: String(a.id), label: a.name })),
    ...(assigned !== null && assigned !== me && !others.some((a) => a.id === assigned) ? [{ value: String(assigned), label: e?.agent ?? text('Someone else') }] : []),
    ...(assigned !== null ? [{ value: '', label: text('Unassign') }] : []),
  ];
  const assign = (to: string) => {
    const who = to === '' ? null : Number(to);
    const label = who === null ? text('Unassigned') : who === me ? text('Assigned to you') : text('Assigned to {name}', { name: assignOptions.find((o) => o.value === to)?.label ?? '' });
    act(() => websiteAction(c.id, 'assign', { user_id: who }), label);
  };
  const saveNote = () => {
    if (!note.trim()) return;
    setNoting(true);
    void team.note(c.id, note.trim(), []).then(
      () => {
        toast('success', text('Note added'));
        setNote('');
        setNoting(false);
        void q.refetch();
      },
      (err) => {
        toast('error', errorMessage(err));
        setNoting(false);
      },
    );
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-ground">
      <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b border-line bg-surface px-5 py-2.5">
        <Avatar name={name} size={38} presence={online ? 'online' : null} />
        <span className="flex min-w-[160px] flex-1 flex-col">
          <b className="truncate text-[15px] text-ink">{company ? `${name} · ${company}` : name}</b>
          <span className={cx('truncate text-[12px]', online ? 'font-semibold text-success' : 'text-ink-3')}>
            {[
              when ? (today ? text('Left a message today at {time}', { time: timeLabel(when) }) : text('Left a message on {when}', { when: enquiryStamp(when) })) : text('Left a message'),
              online ? text('back on the site now') : text('not on the site now'),
            ].join(' · ')}
          </span>
        </span>
        {replied ? <Chip tone="success">{replied}</Chip> : null}
        {online ? <Button size="sm" onClick={onOpenChat}>{text('Open chat')}</Button> : null}
        {canReply ? (
          <>
            <Select aria-label={text('Assign')} placeholder={text('Assign')} disabled={busy} value={assigned === null ? '' : String(assigned)} onValueChange={assign} options={assignOptions}
              className="h-[34px] rounded-[8px] border border-line bg-surface px-3 text-[13px] font-semibold text-ink" />
            <Button size="sm" disabled={busy} onClick={() => act(() => websiteAction(c.id, 'close'), text('Enquiry closed'), onClosed)}>{text('Close')}</Button>
            <Button size="sm" variant="primary" disabled={!email} title={email ? text('Write to {email}', { email }) : text('They left no email address')} onClick={() => setEmailing(true)}>
              {text('Reply by email')}
            </Button>
          </>
        ) : null}
      </header>
      <div className="flex min-h-0 flex-1 gap-4 overflow-y-auto p-5 scroll-thin">
        <div className="flex min-w-0 flex-1 flex-col gap-3.5">
          <section aria-label={text('Their message')} className="flex flex-col gap-2.5 rounded-[12px] border border-line bg-surface p-[18px]">
            <h3 className={PANEL_HEADING}>{text('Their message')}</h3>
            <p className="text-[14.5px] leading-[1.55] whitespace-pre-wrap text-ink select-text">{theirs || text('No message')}</p>
            <dl className="grid grid-cols-3 gap-2.5 border-t border-line pt-2.5 text-[12.5px]">
              <div className="min-w-0"><dt className="text-ink-3">{text('Email')}</dt><dd className={cx('truncate font-semibold select-text', email ? 'text-ink' : 'text-ink-3')}>{email ?? text('None left')}</dd></div>
              <div className="min-w-0"><dt className="text-ink-3">{text('Phone')}</dt><dd className={cx('truncate font-semibold select-text', phone ? 'text-ink' : 'text-ink-3')}>{phone ?? text('None left')}</dd></div>
              <div className="min-w-0"><dt className="text-ink-3">{text('Page')}</dt><dd className="truncate font-semibold text-ink" title={page ?? undefined}>{page ? pathOf(page) : '—'}</dd></div>
            </dl>
          </section>
          {after.length ? (
            <section aria-label={text('Since then')} className="flex flex-col gap-2.5 rounded-[12px] border border-line bg-surface p-4">
              <h3 className={PANEL_HEADING}>{text('Since then')}</h3>
              {/* The shared chat kit (C-02), read-only: answers go by email, or in the chat once they are back. */}
              <MessageList items={after} caps={WEBSITE_CAPS} look="page" handlers={{}} />
            </section>
          ) : null}
          <section aria-label={text('Note for the team')} className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface px-4 py-3.5">
            <div className="text-[12.5px] font-semibold text-ink">
              {text('Note for the team')} <span className="font-normal text-ink-3">· {text('staff only')}</span>
            </div>
            {notes.map((n) => (
              <div key={n.id} className="rounded-[8px] bg-warning-bg px-2.5 py-1.5 text-[12.5px] text-ink">
                <span className="text-[11.5px] font-semibold text-ink-2">{[n.agent, n.at ? enquiryStamp(n.at) : null].filter(Boolean).join(' · ')}</span>
                <div className="whitespace-pre-wrap select-text">{n.body}</div>
              </div>
            ))}
            {canReply ? (
              <>
                <textarea
                  aria-label={text('Note for the team')}
                  placeholder={text('Add a note…')}
                  value={note}
                  onChange={(ev) => setNote(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) saveNote();
                  }}
                  rows={2}
                  maxLength={4000}
                  className="min-h-[60px] w-full resize-y rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] text-ink outline-none focus:border-primary"
                />
                {note.trim() ? (
                  <span className="flex justify-end">
                    <Button size="sm" loading={noting} onClick={saveNote}>{text('Save note')}</Button>
                  </span>
                ) : null}
              </>
            ) : null}
          </section>
          {/* MIS-02 / RING-08: a returning visitor's enquiry is live again and rings once for whoever is free. */}
          <div role="note" className="flex items-center gap-2.5 rounded-[10px] bg-selection px-3.5 py-3 text-[12.5px] text-primary">
            <Icon name="bell" size={16} className="shrink-0" />
            {online
              ? text('{name} is back on the site — the chat is in Live chats and rings once.', { name: first })
              : text('If {name} returns while staff are online, the chat moves to Live chats and rings once.', { name: first })}
          </div>
        </div>
        <aside aria-label={text('Visitor')} className={cx(PANEL_CARD, 'w-[250px] shrink-0 self-start p-3.5 text-[12.5px]')}>
          <h3 className={PANEL_HEADING}>{text('Visitor')}</h3>
          {placeLine ? <span className="text-ink">{placeLine}</span> : null}
          {visitLine ? <span className="text-ink">{visitLine}</span> : null}
          {!placeLine && !visitLine ? <span className="text-ink-3">{text('Nothing known about the visit')}</span> : null}
          {why ? (
            <>
              <h3 className={cx(PANEL_HEADING, 'mt-2')}>{text('Why offline')}</h3>
              <span className="text-ink">{why}</span>
            </>
          ) : null}
        </aside>
      </div>
      {emailing && email ? <ReplyByEmail id={c.id} to={email} name={first} path={`${WEBSITE}/conversations/${c.id}/email`} onClose={() => setEmailing(false)} onSent={refresh} /> : null}
    </div>
  );
}
