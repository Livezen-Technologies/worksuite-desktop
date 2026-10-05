import type { MouseEvent as ReactMouseEvent } from 'react';
import type { WebchatRingChat } from '@shared/types';
import { text } from '../../../core/i18n';
import { listStamp } from '../../../core/time';
import { Icon } from '../../../components/Icon';
import { Avatar, cx } from '../../../components/ui';
import type { WebsiteRow } from './api';
import { AssigneeFaces, CallLine, PRIORITY_TAG, ROW_SILENCED, RingBell, rowPreview, StatusPill } from './rowParts';
import { returningBadge } from './identity';

/**
 * A conversation in the card list beside an open chat (CHAT-UI-00; worksuite-desktop#239), three lines in a row 72px
 * high:
 *
 * 1. the visitor, with the time on the right;
 * 2. what was said last — "Typing…" in the accent while they type, the call while one is on — and the unread count;
 * 3. small and muted, the site and ONE status pill (Waiting, else Unread), "Returning · 3rd visit" for somebody who has
 *    been here before (#222), and who has the chat on the right.
 *
 * Whether they are on the site is the avatar's dot alone: green while there, grey once gone. A chat ringing here shows
 * a bell; one silenced for me (on all my devices) is amber, with the bell struck through (R-04, RING-UI-04). Priority,
 * a callback asked for and a star are small marks after the name.
 */
export function ConversationRow({ r, me, myName, ring, typing = false, active, onOpen, onMenu }: {
  r: WebsiteRow; me: number | null; myName: string | null; ring?: WebchatRingChat; typing?: boolean; active: boolean; onOpen: () => void; onMenu: (e: ReactMouseEvent) => void;
}) {
  const name = r.visitor_name || r.label;
  const closed = r.status === 'closed';
  const unread = closed ? 0 : (r.unread ?? 0);
  const line = rowPreview(r, { me, myName, ring });
  const priority = PRIORITY_TAG[r.priority];
  // "Returning · 3rd visit" (#222): somebody who has been here before, on the third line.
  const returning = returningBadge(r);
  return (
    <button
      type="button"
      data-website-row={r.id}
      aria-current={active ? 'true' : undefined}
      onClick={onOpen}
      onContextMenu={onMenu}
      className={cx(
        'group relative flex h-[72px] w-full items-center gap-2.5 border-b border-line py-2 pr-3 pl-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset',
        active ? 'bg-selection' : ring?.silenced ? ROW_SILENCED : 'hover:bg-subtle hover:shadow-[inset_3px_0_0_var(--color-line)]',
      )}
    >
      {active ? <span aria-hidden className="absolute top-0 bottom-0 left-0 w-[3px] bg-primary" /> : null}
      <Avatar name={name} size={40} presence={closed ? null : r.online ? 'online' : 'offline'} />
      {closed ? null : <span className="sr-only">{r.online ? text('On the site now') : text('Left the site')}</span>}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex h-[18px] min-w-0 items-center gap-1.5">
          <b className={cx('min-w-0 truncate text-[13.5px] text-ink', r.awaiting_reply || unread ? 'font-bold' : 'font-semibold')} title={name}>{name}</b>
          {ring ? <RingBell ring={ring} /> : null}
          {priority ? <Icon name="flag" size={11} className={cx('shrink-0', r.priority === 'urgent' ? 'text-danger' : 'text-warning')} label={text(priority)} /> : null}
          {r.callback && !closed ? <Icon name="phone" size={11} className={cx('shrink-0', r.callback.overdue ? 'text-danger' : 'text-primary')} label={r.callback.overdue ? text('Callback overdue') : text('Callback requested')} /> : null}
          {r.is_starred ? <Icon name="star" size={11} className="shrink-0 text-warning" label={text('Starred')} /> : null}
          <span className="ml-auto shrink-0 pl-1 text-[11px] text-ink-3 tabular-nums">{listStamp(r.last_message?.at ?? r.last_visitor_at ?? r.updated_at)}</span>
        </span>
        <span className="flex h-[18px] min-w-0 items-center gap-1.5">
          {r.call && !closed ? (
            <CallLine call={r.call} />
          ) : typing && !closed ? (
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-primary">{text('Typing…')}</span>
          ) : (
            <span className={cx('min-w-0 flex-1 truncate text-[12.5px]', unread ? 'font-semibold text-ink' : r.last_message?.from === 'agent' ? 'text-ink-3' : 'text-ink-2')} title={line || undefined}>{line}</span>
          )}
          {unread ? (
            <span className="min-w-[18px] shrink-0 rounded-full bg-primary px-1.5 text-center text-[10.5px] leading-[18px] font-bold text-white tabular-nums" aria-label={text('{n} unread', { n: unread })}>
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </span>
        <span className="flex h-4 min-w-0 items-center gap-1.5 text-[11px]">
          <span className="min-w-0 truncate text-ink-3">{r.site ?? r.widget ?? text('Website')}</span>
          <StatusPill r={r} unread={unread} />
          {returning ? <span className="shrink-0 truncate rounded-[5px] bg-subtle px-1.5 font-semibold text-ink-2" title={text(returning)}>{text(returning)}</span> : null}
          <span className="ml-auto flex shrink-0 pl-1">
            <AssigneeFaces r={r} me={me} />
          </span>
        </span>
      </span>
    </button>
  );
}
