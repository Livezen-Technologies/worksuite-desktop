import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../../../core/api';
import { errorMessage } from '../../../core/bridge';
import { text } from '../../../core/i18n';
import { markdownLine } from '../../../core/markdown';
import { dateLabel, listStamp, parseTs, timeLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Avatar, Button, Chip, Empty, cx } from '../../../components/ui';
import { SidePanel } from '../../../components/SidePanel';
import { WEBSITE_CAPS } from '../kit/caps';
import { MessageList } from '../kit/MessageList';
import { byTime, dwell, eventsForThread, fromWebsiteMessage, fromWidgetEvent } from '../kit/model';
import { sharedFilesOf } from '../kit/SharedFiles';
import { fileLine, PRIORITIES, useWebsiteConversation, websiteAction, type WebsiteConversation, type WebsiteRow } from './api';
import { ThreadFailed, ThreadPlaceholder, type PaneHead } from './ThreadPlaceholder';
import { ordinal } from './live/liveMap';
import { firstName, FollowUpRow, missedStamp } from './Missed';
import { BlockDialog, ContactCard, SharedFilesCard, TagsCard } from './panelCards';
import { clock } from './Ringing';
import { PANEL_CARD, PANEL_HEADING, pathOf } from './rowParts';

/**
 * Closed chats (C-06, X-UI-04): the list in the order chats ended, each saying how it ended; the chat read back with
 * its rating, Star, Block visitor and Reopen, the composer replaced by a locked notice (UX-CLS-01); and beside it the
 * summary — first reply, duration, priority and rating tiles, who handled it and when it closed, the tags (still
 * editable), the contact and the files shared (UX-CLS-02).
 */

/** The stars a rating gives, ★★★★☆, said as words for a screen reader. */
export function Stars({ n, className }: { n: number; className?: string }) {
  const r = Math.max(0, Math.min(5, Math.round(n)));
  return (
    <span role="img" aria-label={text('Rated {n} out of 5', { n: r })} className={cx('text-[#B7791F] dark:text-warning', className)}>
      {'★'.repeat(r)}
      {'☆'.repeat(5 - r)}
    </span>
  );
}

/** "at 10:58" today; "on 3 Oct" before. */
function closedWhen(at: string | null | undefined): string {
  if (!at) return '';
  const d = parseTs(at);
  if (Number.isNaN(d.getTime())) return '';
  return d.toDateString() === new Date().toDateString() ? text('at {time}', { time: timeLabel(at) }) : text('on {date}', { date: dateLabel(at) });
}

/**
 * How it ended, as the header says it (IDL-03): "Closed by Nuwan at 10:58", "Ended by the visitor at 10:58", "Closed
 * automatically as inactive at 10:58"; a chat closed before the reason was kept is only "Closed at 10:58".
 */
export function closedHow(c: Pick<WebsiteConversation['conversation'], 'closed_at' | 'closed_reason' | 'closed_by'>): string {
  const when = closedWhen(c.closed_at);
  const how =
    c.closed_reason === 'idle' ? text('Closed automatically as inactive')
    : c.closed_reason === 'visitor' ? text('Ended by the visitor')
    : c.closed_by?.name ? text('Closed by {name}', { name: firstName(c.closed_by.name) })
    : text('Closed');
  return when ? `${how} ${when}` : how;
}

/**
 * A closed chat's line on the list (C-06): what it was about — its subject, else what was said last, in plain words on
 * one line, or the picture or file it was (#261) — and who closed it ("Activation fixed · Nuwan"); one that went quiet
 * is "Inactive · closed automatically"; one the visitor ended says so; one with nothing else to say, "Chat closed".
 */
export function closedLine(r: Pick<WebsiteRow, 'closed_reason' | 'closed_by' | 'subject' | 'last_message' | 'email'>): string {
  if (r.closed_reason === 'idle') return text('Inactive · closed automatically');
  const m = r.last_message;
  const about = markdownLine(r.subject ?? '') || markdownLine(m?.body ?? '') || (m?.file ? fileLine(m.file) : '') || r.email || '';
  const who = r.closed_reason === 'visitor' ? text('ended by the visitor') : r.closed_by ? firstName(r.closed_by) : null;
  return [about, who].filter(Boolean).join(' · ') || text('Chat closed');
}

/** A closed chat in the list (C-06): the visitor and their company, when it closed, how it ended, and the stars it got. */
export function ClosedRow({ r, active, onOpen }: { r: WebsiteRow; active: boolean; onOpen: () => void }) {
  const name = r.visitor_name || r.label;
  return (
    <FollowUpRow id={r.id} name={r.company ? `${name} · ${r.company}` : name} online={false} stamp={listStamp(r.closed_at ?? r.updated_at)} line={closedLine(r)} active={active} onOpen={onOpen}>
      {r.rating ? <Stars n={r.rating} className="text-[12px]" /> : null}
    </FollowUpRow>
  );
}

/** "Rated 5 by the visitor · “Fast and clear”", after the last message (VX-12, UX-CLS-01). */
export function RatingCard({ rating, comment }: { rating: number; comment: string | null }) {
  return (
    <div className="flex items-center gap-2 self-center rounded-[12px] border border-line bg-surface px-3.5 py-2 text-[12.5px] text-ink">
      <Stars n={rating} className="text-[14px]" />
      <span>
        {text('Rated {n} by the visitor', { n: rating })}
        {comment ? ` · “${comment}”` : ''}
      </span>
    </div>
  );
}

/**
 * In place of the composer on a closed chat (UX-CLS-01): it is locked, and why reopening matters. `onReopen`, where the
 * screen has no Reopen of its own (the open thread's header has none).
 */
export function ClosedNotice({ onReopen, className }: { onReopen?: () => void; className?: string }) {
  return (
    <div role="note" className={cx('flex items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3.5 py-3 text-[12.5px] text-ink-2', className)}>
      <Icon name="lock" size={16} className="shrink-0 text-ink-3" />
      <span className="min-w-0 flex-1">{text('This chat is closed. Reopen it to reply; the visitor sees your message if they are still on the site.')}</span>
      {onReopen ? <Button size="sm" onClick={onReopen}>{text('Reopen')}</Button> : null}
    </div>
  );
}

/** Seconds between two stamps, or null when either is missing. */
function between(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!from || !to) return null;
  const s = (parseTs(to).getTime() - parseTs(from).getTime()) / 1000;
  return Number.isNaN(s) ? null : Math.max(0, s);
}

/** A closed chat's header from its row, while the chat itself loads (#261): who, how it ended and on which site. */
function closedHead(r: WebsiteRow): PaneHead {
  const name = r.visitor_name || r.label;
  const how = r.status === 'closed' ? closedHow({ closed_at: r.closed_at ?? null, closed_reason: r.closed_reason ?? null, closed_by: r.closed_by ? { id: 0, name: r.closed_by } : null }) : text('Open again');
  return { name: r.company ? `${name} · ${r.company}` : name, line: [how, r.site ?? r.widget].filter(Boolean).join(' · ') };
}

/**
 * One closed chat (C-06): read back without arriving in it (`review` — a closed chat has nobody to join, and a missed
 * one must not be handled by a look), with Star, Block visitor and Reopen; Reopen opens the chat to reply in.
 */
export function ClosedDetail({ id, row, onReopened }: { id: string; row?: WebsiteRow; onReopened: () => void }) {
  const qc = useQueryClient();
  const q = useWebsiteConversation(id, { review: true });
  const [busy, setBusy] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['website'] });

  const gone = q.error instanceof ApiError && (q.error.status === 404 || q.error.forbidden);
  if (gone) return <Empty icon="globe" title="This website chat is not available" hint="It may have been removed, or you no longer staff this website." />;
  const data = q.data;
  // Not read here before (#261): the transcript's place in grey under the header the list row gives it, filling the
  // pane — never a spinner at its edge — with "Still loading… · Retry" and "Couldn't load · Retry" in the middle.
  if (!data) {
    const head = row ? closedHead(row) : undefined;
    return q.error ? <ThreadFailed head={head} look="detail" onRetry={() => void q.refetch()} /> : <ThreadPlaceholder head={head} look="detail" onRetry={() => void qc.cancelQueries({ queryKey: ['website', 'conversation', id, 'review'] }).then(() => q.refetch())} />;
  }
  const c = data.conversation;
  const v = data.visitor;
  const name = v?.name || row?.visitor_name || v?.label || text('Visitor');
  const company = v?.company ?? row?.company ?? null;
  const canReply = data.can?.reply !== false;
  const closed = c.status === 'closed';
  const visit = eventsForThread(data.events, c.started_at);
  const startPage = data.journey?.[0]?.url ? pathOf(data.journey[0].url) : null;
  const items = byTime([
    ...data.messages.map((x) => fromWebsiteMessage(x, { me: null, visitor: name, canReply: false })),
    ...visit.map((e, i) => fromWidgetEvent(e, i)),
  ]);
  const lasted = between(c.started_at, c.closed_at);
  const site = c.website ?? c.widget;

  const run = (fn: () => Promise<unknown>, done: string | null, then?: () => void) => {
    setBusy(true);
    void fn().then(
      () => {
        if (done) toast('success', done);
        refresh();
        setBusy(false);
        then?.();
      },
      (e) => {
        toast('error', errorMessage(e));
        setBusy(false);
      },
    );
  };
  const reopen = () => run(() => websiteAction(c.id, 'reopen'), text('Chat reopened.'), onReopened);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-ground">
      <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b border-line bg-surface px-5 py-2.5">
        <Avatar name={name} size={38} />
        <span className="flex min-w-[160px] flex-1 flex-col">
          <b className="truncate text-[15px] text-ink">{company ? `${name} · ${company}` : name}</b>
          <span className="truncate text-[12px] text-ink-3">{[closed ? closedHow(c) : text('Open again'), lasted !== null && closed ? dwell(lasted) : null, site].filter(Boolean).join(' · ')}</span>
        </span>
        {canReply ? (
          <Button size="sm" aria-pressed={c.is_starred} disabled={busy} onClick={() => run(() => websiteAction(c.id, 'star', { on: !c.is_starred }), null)} className={c.is_starred ? '!border-warning !bg-warning-bg !text-[#9A4A06] dark:!text-warning' : ''}>
            {c.is_starred ? text('★ Starred') : text('Star')}
          </Button>
        ) : null}
        {data.can?.manage && v && !v.is_blocked ? <Button size="sm" onClick={() => setBlocking(true)}>{text('Block visitor')}</Button> : null}
        {v?.is_blocked ? <Chip tone="danger">{text('Blocked')}</Chip> : null}
        {canReply && closed ? <Button size="sm" variant="primary" loading={busy} onClick={reopen}>{text('Reopen')}</Button> : null}
        {/* Open again while it is read here — the visitor came back and wrote (#291): to the open thread, to answer. */}
        {!closed ? <Button size="sm" variant="primary" onClick={onReopened}>{text('Open chat')}</Button> : null}
      </header>
      <div className="flex min-h-0 flex-1">
        <section aria-label={text('Transcript')} className="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 overflow-y-auto px-[22px] py-[18px] scroll-thin">
          {c.started_at ? (
            <div className="self-center text-[11.5px] text-ink-3">
              {[missedStamp(c.started_at), startPage ? text('started from {page}', { page: startPage }) : null].filter(Boolean).join(' · ')}
            </div>
          ) : null}
          {data.messages.length === 0 ? <Empty icon="chat" title={text('No messages')} /> : null}
          {/* The shared chat kit (C-02), read-only: a closed chat is answered by reopening it. */}
          <MessageList items={items} caps={WEBSITE_CAPS} look="page" handlers={{}} />
          {c.rating ? <RatingCard rating={c.rating} comment={c.rating_comment} /> : null}
          {closed ? <ClosedNotice className="mt-auto" /> : null}
        </section>
        <ClosedSummary data={data} row={row} files={sharedFilesOf(items)} canReply={canReply} onDone={refresh} />
      </div>
      {blocking ? <BlockDialog conversationId={c.id} name={name} onClose={() => setBlocking(false)} onDone={refresh} /> : null}
    </div>
  );
}

const TILE = 'flex flex-col rounded-[8px] bg-subtle p-2';

/** The priority tile's colour: red for Urgent and VIP, amber for High, plain otherwise. */
function priorityTone(p: string): string {
  return p === 'urgent' || p === 'vip' ? 'bg-danger-bg text-danger' : p === 'high' ? 'bg-warning-bg text-[#9A4A06] dark:text-warning' : 'bg-subtle text-ink';
}

/**
 * The closed chat's summary (UX-CLS-02): First reply, Duration, Priority and Rating; who handled it and when it closed;
 * the tags, still editable; the contact with how many chats they have had; the files shared.
 */
function ClosedSummary({ data, row, files, canReply, onDone }: { data: WebsiteConversation; row?: WebsiteRow; files: ReturnType<typeof sharedFilesOf>; canReply: boolean; onDone: () => void }) {
  const c = data.conversation;
  const first = between(c.started_at, c.first_response_at);
  const lasted = between(c.started_at, c.closed_at);
  const priority = c.priority ?? row?.priority ?? 'normal';
  // Who handled it: whoever closed it, else its owner; nobody when the team never answered.
  const owner = data.team?.people.find((p) => p.role === 'owner')?.name ?? row?.agent ?? null;
  const handler = c.closed_by?.name ?? (c.first_response_at ? owner : null);
  const chats = data.chats;
  return (
    <SidePanel id="website-closed-summary" label="the chat summary" side="right">
      <aside aria-label={text('Chat summary')} className="flex w-[260px] shrink-0 flex-col gap-2.5 overflow-y-auto border-l border-line bg-ground p-3 text-[12px] scroll-thin">
        <div className={PANEL_CARD}>
          <div className="flex items-center">
            <h3 className={cx(PANEL_HEADING, 'flex-1')}>{text('Summary')}</h3>
            {c.status === 'closed' ? <Chip>{text('Closed')}</Chip> : null}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className={TILE}>
              <span className="text-[10.5px] text-ink-3">{text('First reply')}</span>
              <b className="text-[16px] text-ink tabular-nums">{first !== null ? clock(first) : '—'}</b>
            </div>
            <div className={TILE}>
              <span className="text-[10.5px] text-ink-3">{text('Duration')}</span>
              <b className="text-[16px] text-ink">{lasted !== null ? dwell(lasted) : '—'}</b>
            </div>
            <div className={cx(TILE, priorityTone(priority))}>
              <span className="text-[10.5px] opacity-80">{text('Priority')}</span>
              <b className="text-[14px]">{PRIORITIES.find((p) => p.id === priority)?.label ?? priority}</b>
            </div>
            <div className={cx(TILE, 'bg-warning-bg')}>
              <span className="text-[10.5px] text-[#9A5B10] dark:text-warning">{text('Rating')}</span>
              <b className="text-[14px] text-[#B7791F] dark:text-warning">{c.rating ? `★ ${c.rating.toFixed(1)}` : text('Not rated')}</b>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-0.5 text-ink-2">
            {handler ? <Avatar name={handler} src={c.closed_by?.avatar ?? null} size={24} /> : null}
            <span className="min-w-0">
              {handler ? (
                <>
                  {text('Handled by')} <b className="text-ink">{firstName(handler)}</b>
                </>
              ) : (
                text('Nobody replied')
              )}
              {c.closed_at ? ` · ${text('closed {when}', { when: missedStamp(c.closed_at) })}` : ''}
            </span>
          </div>
        </div>
        <TagsCard conversationId={c.id} tags={c.tags} canEdit={canReply} onDone={onDone} />
        <ContactCard v={data.visitor} title={text('Contact')}>
          {chats ? (
            <div className="flex items-center gap-2">
              <Icon name="clock" size={14} className="shrink-0 text-ink-3" />
              <span className="min-w-0 truncate text-ink-2">
                {chats.count > 1 ? text('{nth} chat · first on {date}', { nth: ordinal(chats.count), date: dateLabel(chats.first_at) }) : text('First chat')}
              </span>
            </div>
          ) : null}
        </ContactCard>
        <SharedFilesCard files={files} />
      </aside>
    </SidePanel>
  );
}
