import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { apiGet, apiPost } from '../../../core/api';
import { errorMessage } from '../../../core/bridge';
import { text } from '../../../core/i18n';
import { markdownLine } from '../../../core/markdown';
import { listStamp, parseTs, timeLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Avatar, Button, Chip, Empty, Modal, cx } from '../../../components/ui';
import { WEBSITE_CAPS } from '../kit/caps';
import { MessageList } from '../kit/MessageList';
import { byTime, eventsForThread, fromWebsiteMessage, fromWidgetEvent } from '../kit/model';
import { useSavedCopy, useWebsiteConversation, WEBSITE, type WebsiteConversation } from './api';
import { timed } from './timings';
import { ordinal } from './live/liveMap';
import { clock } from './Ringing';
import { hostOf, PANEL_CARD, PANEL_HEADING, pathOf, siteAndPath, Tag } from './rowParts';
import { ThreadFailed, ThreadPlaceholder, type PaneHead } from './ThreadPlaceholder';

/**
 * Missed chats (C-04, X-UI-02): visitors who wrote and left before anyone replied. To follow up and Handled
 * (UX-MISS-01); each row has their first words, how long they waited before leaving and whether they left a way back;
 * the detail reads the chat back without arriving in it, with Reply by email (UX-MISS-02) and Mark handled, and says
 * that a returning visitor reopens the chat and rings again (UX-MISS-03).
 */

export type MissedTab = 'todo' | 'handled';

export interface Missed {
  id: number;
  widget_id?: number;
  widget: string;
  visitor: string;
  email: string | null;
  phone: string | null;
  place: string | null;
  url?: string | null;
  status?: string;
  missed_at: string | null;
  started_at?: string | null;
  last_visitor_at: string | null;
  /** The rest is a C-04 server's; an older one sends none of it. */
  preview?: string | null;
  online?: boolean;
  left_at?: string | null;
  waited_seconds?: number | null;
  handled?: { how: 'replied' | 'marked'; at: string | null; by: string | null } | null;
}

export interface MissedList {
  missed: Missed[];
  count: number;
  /** The Handled tab's count; absent on a server without the tabs. */
  handled?: number;
}

export function useMissed(tab: MissedTab, enabled: boolean) {
  // From the copy saved on this computer at once, then from the server (worksuite-desktop#252).
  useSavedCopy(['website', 'missed', 'list', tab], `${WEBSITE}/missed`, tab === 'handled' ? { status: 'handled' } : undefined, (hit) => Array.isArray((hit as MissedList | null)?.missed), enabled);
  return useQuery({
    queryKey: ['website', 'missed', 'list', tab],
    queryFn: ({ signal }) => timed('missed', () => apiGet<MissedList>(`${WEBSITE}/missed`, tab === 'handled' ? { status: 'handled' } : undefined, signal), (d) => d?.missed?.length ?? null),
    enabled,
    refetchInterval: 60_000,
    retry: false,
  });
}

/** "Today 09:14", "Yesterday", "3 Oct" — the list's and the transcript's stamp. */
export function missedStamp(at: string | null | undefined): string {
  if (!at) return '';
  const d = parseTs(at);
  if (Number.isNaN(d.getTime())) return '';
  return d.toDateString() === new Date().toDateString() ? text('Today {time}', { time: timeLabel(at) }) : listStamp(at);
}

export const firstName = (name: string) => (/^visitor\b/i.test(name) ? name : name.split(/\s+/)[0] ?? name);

/** "Handled by Dilini · no contact left" (C-04): who dealt with it, how, and whether there was ever a way back. */
export function handledLine(m: Pick<Missed, 'handled' | 'email' | 'phone'>): string | null {
  if (!m.handled) return null;
  const by = m.handled.by ? firstName(m.handled.by) : null;
  const who = m.handled.how === 'replied' ? (by ? text('Replied by {name}', { name: by }) : text('Replied')) : by ? text('Handled by {name}', { name: by }) : text('Handled');
  return m.email || m.phone ? who : `${who} · ${text('no contact left')}`;
}

/**
 * A visitor to follow up, as a row: the shell Missed chats (C-04) and Offline enquiries (C-05) share — the visitor
 * with their on-site dot, when, one line of what they said, and the chips underneath — so the two lists read alike.
 */
export function FollowUpRow({ id, name, online, stamp, line, active, dim = false, onOpen, children }: { id: number; name: string; online: boolean; stamp: string; line: string; active: boolean; dim?: boolean; onOpen: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      data-website-row={id}
      aria-current={active ? 'true' : undefined}
      onClick={onOpen}
      className={cx('relative flex w-full items-start gap-2.5 border-b border-line py-3 pr-3 pl-3.5 text-left', active ? 'bg-selection' : 'hover:bg-subtle', dim && !active && 'opacity-60')}
    >
      {active ? <span aria-hidden className="absolute top-0 bottom-0 left-0 w-[3px] bg-primary" /> : null}
      <Avatar name={name} size={34} presence={online ? 'online' : null} />
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="flex items-center gap-[7px]">
          <b className="flex-1 truncate text-[13.5px] text-ink">{name}</b>
          <span className="shrink-0 text-[11.5px] text-ink-3">{stamp}</span>
        </span>
        <span className="truncate text-[12px] text-ink-2">{line}</span>
        {children}
      </span>
    </button>
  );
}

/** A missed chat in the list: the visitor, when, what they asked, how long they waited, and the contact they left. */
export function MissedRow({ m, active, onOpen }: { m: Missed; active: boolean; onOpen: () => void }) {
  const handled = handledLine(m);
  // Their words on one line, without Markdown's marks (#261).
  const said = m.preview ? markdownLine(m.preview) : '';
  const line = said ? `“${said}”` : (m.email ?? m.phone ?? text('No way to reach them')) + (m.place ? ` · ${m.place}` : '');
  return (
    <FollowUpRow id={m.id} name={m.visitor} online={!!m.online} stamp={missedStamp(m.started_at ?? m.missed_at)} line={line} active={active} dim={!!handled} onOpen={onOpen}>
      {handled ? (
        <span className="mt-0.5 truncate text-[11.5px] font-semibold text-success">{handled}</span>
      ) : (
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
          {m.online ? <Tag tone="indigo">{text('Back on the site')}</Tag> : m.waited_seconds != null ? <Tag tone="danger">{text('Left after {time}', { time: clock(m.waited_seconds) })}</Tag> : null}
          {m.email ? <Tag tone="muted">{text('Email left')}</Tag> : null}
          {m.phone ? <Tag tone="muted">{text('Phone left')}</Tag> : null}
          {!m.email && !m.phone ? <Tag tone="muted">{text('No contact left')}</Tag> : null}
          {m.preview === undefined ? <span className="truncate text-[11px] text-ink-3">{m.widget}</span> : null}
        </span>
      )}
    </FollowUpRow>
  );
}

/**
 * What is known about the visit, in the two lines both details show (C-04, C-05): "Kandy, LK · Safari · macOS" and
 * "1st visit · 5 pages · from facebook.com".
 */
export function visitFacts(data: WebsiteConversation, place?: string | null): { placeLine: string; visitLine: string } {
  const v = data.visitor;
  const visit = eventsForThread(data.events, data.conversation.started_at);
  const pages = visit.filter((e) => e.kind === 'page_view').length || (data.journey?.length ?? 0);
  const placeLine = [[v?.city, v?.country].filter(Boolean).join(', ') || place, v?.browser, v?.os].filter(Boolean).join(' · ');
  const visitLine = [
    v?.visits ? text('{n} visit', { n: ordinal(v.visits) }) : null,
    pages ? (pages === 1 ? text('1 page') : text('{n} pages', { n: pages })) : null,
    v?.referrer ? text('from {site}', { site: hostOf(v.referrer) }) : null,
  ].filter(Boolean).join(' · ');
  return { placeLine, visitLine };
}

/**
 * One missed chat (C-04 detail): the transcript read back without joining it (`review`), how it ended, who they are
 * and what they did on the site; Reply by email when they left an address, and Mark handled. "Open chat" goes to the
 * conversation itself, to answer a visitor who has come back or to reply there.
 */
export function MissedDetail({ id, m, onOpenChat }: { id: string; m: Missed | undefined; onOpenChat: () => void }) {
  const qc = useQueryClient();
  const q = useWebsiteConversation(id, { review: true });
  const [busy, setBusy] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['website'] });

  const data = q.data;
  // Not read here before (#261): the transcript's place in grey under the header the list row gives it, filling the
  // pane, with "Still loading… · Retry" and "Couldn't load · Retry" in the middle; a copy in hand stays on a failure.
  if (!data) {
    const head: PaneHead | undefined = m ? { name: m.visitor, line: m.online ? text('Back on the site now') : m.left_at ? text('Left the site at {time}', { time: timeLabel(m.left_at) }) : text('Left the site'), presence: m.online ? 'online' : null } : undefined;
    return q.error ? <ThreadFailed head={head} look="detail" onRetry={() => void q.refetch()} /> : <ThreadPlaceholder head={head} look="detail" onRetry={() => void qc.cancelQueries({ queryKey: ['website', 'conversation', id, 'review'] }).then(() => q.refetch())} />;
  }
  const c = data.conversation;
  const v = data.visitor;
  const name = v?.name || m?.visitor || v?.label || text('Visitor');
  const first = firstName(name);
  const email = v?.email ?? m?.email ?? null;
  const phone = v?.phone ?? m?.phone ?? null;
  const online = m?.online ?? false;
  const leftAt = m?.left_at ?? null;
  const handled = m ? handledLine(m) : null;
  const canReply = data.can?.reply !== false;
  const visit = eventsForThread(data.events, c.started_at);
  const startPage = data.journey?.[0]?.url ? pathOf(data.journey[0].url) : null;
  const where = v?.current_url ?? m?.url ?? null;
  const items = byTime([
    ...data.messages.map((x) => fromWebsiteMessage(x, { me: null, visitor: name, canReply: false })),
    ...visit.map((e, i) => fromWidgetEvent(e, i)),
  ]);

  const markHandled = () => {
    setBusy(true);
    void apiPost(`${WEBSITE}/missed/${c.id}/handle`).then(
      () => {
        toast('success', text('Marked as handled'));
        refresh();
        setBusy(false);
      },
      (e) => {
        toast('error', errorMessage(e));
        setBusy(false);
      },
    );
  };

  const { placeLine, visitLine } = visitFacts(data, m?.place);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-ground">
      <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b border-line bg-surface px-5 py-2.5">
        <Avatar name={name} size={38} presence={online ? 'online' : null} />
        <span className="flex min-w-[160px] flex-1 flex-col">
          <b className="truncate text-[15px] text-ink">{name}</b>
          <span className={cx('truncate text-[12px]', online ? 'font-semibold text-success' : 'text-ink-3')}>
            {online
              ? text('Back on the site now{page}', { page: where ? ` · ${siteAndPath(where)}` : '' })
              : [leftAt ? text('Left the site at {time}', { time: timeLabel(leftAt) }) : text('Left the site'), where ? siteAndPath(where) : null].filter(Boolean).join(' · ')}
          </span>
        </span>
        {handled ? <Chip tone="success">{handled}</Chip> : null}
        <Button size="sm" onClick={onOpenChat}>{text('Open chat')}</Button>
        {canReply ? (
          <Button size="sm" disabled={!email} title={email ? text('Write to {email}', { email }) : text('They left no email address')} onClick={() => setEmailing(true)}>
            {text('Reply by email')}
          </Button>
        ) : null}
        {m && !m.handled ? (
          <Button size="sm" variant="primary" loading={busy} onClick={markHandled}>
            {text('Mark handled')}
          </Button>
        ) : null}
      </header>
      <div className="flex min-h-0 flex-1 gap-4 px-5 py-[18px]">
        <section aria-label={text('Transcript')} className="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 overflow-y-auto scroll-thin">
          {c.started_at ? (
            <div className="self-center text-[11.5px] text-ink-3">
              {[missedStamp(c.started_at), startPage ? text('started from {page}', { page: startPage }) : null].filter(Boolean).join(' · ')}
            </div>
          ) : null}
          {data.messages.length === 0 ? <Empty icon="chat" title={text('No messages')} /> : null}
          {/* The shared chat kit (C-02), read-only: nothing here answers the visitor except Reply by email. */}
          <MessageList items={items} caps={WEBSITE_CAPS} look="page" handlers={{}} />
          {!online && !m?.handled ? (
            <div className="self-center text-[11.5px] font-semibold text-danger">
              {[leftAt ? text('Visitor left at {time}', { time: timeLabel(leftAt) }) : text('Visitor left'), text('nobody replied'), text('counted as missed')].join(' · ')}
            </div>
          ) : null}
        </section>
        <aside aria-label={text('Contact and visit')} className="flex w-[260px] shrink-0 flex-col gap-3 overflow-y-auto text-[12.5px] scroll-thin">
          <div className={cx(PANEL_CARD, 'p-3.5')}>
            <h3 className={PANEL_HEADING}>{text('Contact')}</h3>
            <b className="text-ink">{name}</b>
            <span className={cx('truncate select-text', email ? 'text-ink' : 'text-ink-3')}>{email ?? text('No email left')}</span>
            <span className={cx('select-text', phone ? 'text-ink' : 'text-ink-3')}>{phone ?? text('No phone left')}</span>
            <h3 className={cx(PANEL_HEADING, 'mt-2')}>{text('Visit')}</h3>
            {placeLine ? <span className="text-ink">{placeLine}</span> : null}
            {visitLine ? <span className="text-ink">{visitLine}</span> : null}
            {!placeLine && !visitLine ? <span className="text-ink-3">{text('Nothing known about the visit')}</span> : null}
          </div>
          {/* UX-MISS-03: the server reopens the chat and rings again when they come back and write. */}
          <div role="note" className="rounded-[12px] border border-warning/40 bg-warning-bg p-3 text-[12px] text-[#6B4A10] dark:text-warning">
            {online ? text('{name} is back on the site — the chat is open again and rings when they write.', { name: first }) : text('If {name} comes back to the site, this chat reopens and rings again.', { name: first })}
          </div>
        </aside>
      </div>
      {emailing && email ? <ReplyByEmail id={c.id} to={email} name={first} onClose={() => setEmailing(false)} onSent={refresh} /> : null}
    </div>
  );
}

/**
 * Reply by email (UX-MISS-02), from a missed chat (C-04) or an offline enquiry (C-05): the answer goes into the
 * conversation and to the address they left, with the way back to the chat; the server sends both or neither.
 * `path` is where it is posted — `missed/{id}/email` by default, `conversations/{id}/email` for an enquiry.
 */
export function ReplyByEmail({ id, to, name, path, onClose, onSent }: { id: number; to: string; name: string; path?: string; onClose: () => void; onSent: () => void }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const send = () => {
    if (!body.trim()) return;
    setBusy(true);
    void apiPost<{ to?: string }>(path ?? `${WEBSITE}/missed/${id}/email`, { message: body.trim() }).then(
      () => {
        toast('success', text('Emailed to {email}', { email: to }));
        onSent();
        onClose();
      },
      (e) => {
        toast('error', errorMessage(e));
        setBusy(false);
      },
    );
  };
  return (
    <Modal
      title={text('Reply by email')}
      labelledBy="missed-email-title"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{text('Cancel')}</Button>
          <Button variant="primary" loading={busy} disabled={!body.trim()} onClick={send}>{text('Send email')}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 text-[13px]">
        <span className="text-ink-2">{text('To {email}. It is added to the chat too, so {name} can carry on there.', { email: to, name })}</span>
        <textarea
          autoFocus
          aria-label={text('Your reply')}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send();
          }}
          rows={6}
          maxLength={4000}
          className="w-full resize-y rounded-[8px] border border-line bg-surface p-2.5 text-ink outline-none focus:border-primary"
        />
      </div>
    </Modal>
  );
}
