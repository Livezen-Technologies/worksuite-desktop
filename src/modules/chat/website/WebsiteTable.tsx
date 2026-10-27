import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import type { WebchatRingChat } from '@shared/types';
import { text } from '../../../core/i18n';
import { Checkbox } from '../../../components/Checkbox';
import { RowLead } from '../../../components/RowLead';
import { ContextMenu } from '../../../components/ContextMenu';
import { Icon } from '../../../components/Icon';
import { Menu, type MenuSection } from '../../../components/Menu';
import { Avatar, cx } from '../../../components/ui';
import { BulkBar, BulkButton } from '../BulkBar';
import { websiteBulkMenu } from '../menus';
import { useMultiSelect } from '../selection';
import { BULK_LIMIT, PRIORITIES, useAgents, useWebsiteBulk, waitingSince, type WebsiteBulkAction, type WebsiteBulkExtra, type WebsiteRow } from './api';
import { CallLine, ReopenedTag, ROW_PICKED, ROW_SILENCED, RingBell, rowPreview, SilencedStatus, Tag, TABLE_FRAME, TABLE_HEAD, WaitClock } from './rowParts';

/**
 * The list views as one table (C-03, UX-LIST-01/02): Live chats, Unassigned, Assigned to me, Awaiting reply and
 * Starred, full width while no conversation is open. Each row is the visitor with what was said last, the site, a
 * status chip, the priority, who has it and how long the visitor has waited.
 *
 * Rows are picked as in Chat's own list (`useMultiSelect`): the checkboxes, Ctrl/⌘-click, Shift-click, Space on
 * the focused row; Esc or Clear ends it. Picked rows get the bulk bar (INB-08): Assign to…, Priority, Star and
 * Close on up to 200 at a time, assigned one by one on the server so each assignee is alerted. A plain click opens
 * the chat; J and K still move through the list.
 */
const GRID = 'grid grid-cols-[34px_3fr_1.3fr_1.3fr_1fr_1fr_0.8fr] items-center gap-x-2';

export interface WebsiteTableProps {
  title: string;
  subtitle: string;
  /** The search, site, priority and sort controls. */
  filters: ReactNode;
  rows: WebsiteRow[];
  /** Shown in place of the rows: a spinner, an error, or the section's empty text. */
  placeholder?: ReactNode;
  footnote?: string;
  me: number | null;
  myName: string | null;
  ringing: Map<number, WebchatRingChat>;
  typing: Set<number>;
  /** This tab is in front: Esc anywhere ends the selection. */
  active: boolean;
  onOpen: (r: WebsiteRow) => void;
  /** The single conversation's menu at the mouse. */
  onMenu: (e: ReactMouseEvent, r: WebsiteRow) => void;
}

export function WebsiteTable({ title, subtitle, filters, rows, placeholder, footnote, me, myName, ringing, typing, active, onOpen, onMenu }: WebsiteTableProps) {
  const order = rows.map((r) => r.id);
  const sel = useMultiSelect(order, { globalEscape: active });
  const picked = rows.filter((r) => sel.isPicked(r.id));
  const count = picked.length;
  const over = count > BULK_LIMIT;
  const agents = useAgents(count > 0);
  const bulk = useWebsiteBulk();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<'assign' | 'priority' | null>(null);
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number } | null>(null);
  const assignBtn = useRef<HTMLButtonElement>(null);
  const priorityBtn = useRef<HTMLButtonElement>(null);
  const bar = useRef<HTMLDivElement>(null);

  const run = (a: WebsiteBulkAction, extra?: WebsiteBulkExtra) => {
    if (!count || over || busy) return;
    setBusy(true);
    void bulk(picked.map((r) => r.id), a, extra).then((ok) => {
      setBusy(false);
      if (ok) sel.clear();
    });
  };
  const sections = websiteBulkMenu(picked, me, agents.data?.agents ?? [], run);
  const submenu = (id: string): MenuSection[] => sections.flatMap((s) => s.items).find((i) => i.id === id)?.submenu ?? [];
  const allStarred = count > 0 && picked.every((r) => r.is_starred);
  const allClosed = count > 0 && picked.every((r) => r.status === 'closed');

  const click = (e: ReactMouseEvent, r: WebsiteRow) => {
    if (sel.onRowClick(e, r.id)) return;
    onOpen(r);
  };
  const context = (e: ReactMouseEvent, r: WebsiteRow) => {
    e.preventDefault();
    if (count > 1 && sel.isPicked(r.id)) setRowMenu({ x: e.clientX, y: e.clientY });
    else onMenu(e, r);
  };
  /** Space picks the focused row, Enter opens it, the arrows move between rows. */
  const keys = (e: ReactKeyboardEvent<HTMLDivElement>, r: WebsiteRow) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === ' ') {
      e.preventDefault();
      sel.toggle(r.id);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onOpen(r);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling;
      if (next instanceof HTMLElement && next.dataset.websiteRow) next.focus();
    }
  };

  return (
    <section aria-label={title} className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto bg-ground px-[22px] py-4 scroll-thin">
      <div>
        <h1 className="text-[21px] font-bold text-ink">{text(title)}</h1>
        <p className="text-[12.5px] text-ink-3">{text(subtitle)}</p>
      </div>
      {filters}
      {count > 0 ? (
        <div ref={bar}>
          <BulkBar count={count} onClear={sel.clear} note={text('Up to {max} at a time · each assignee is alerted', { max: BULK_LIMIT })}>
            <BulkButton ref={assignBtn} menu disabled={over || busy} aria-expanded={open === 'assign'} onClick={() => setOpen('assign')}>{text('Assign to…')}</BulkButton>
            <BulkButton ref={priorityBtn} menu disabled={over || busy} aria-expanded={open === 'priority'} onClick={() => setOpen('priority')}>{text('Priority')}</BulkButton>
            <BulkButton disabled={over || busy} onClick={() => run(allStarred ? 'unstar' : 'star')}>{allStarred ? text('Unstar') : text('Star')}</BulkButton>
            <BulkButton disabled={over || busy} onClick={() => run(allClosed ? 'reopen' : 'close')}>{allClosed ? text('Reopen') : text('Close')}</BulkButton>
          </BulkBar>
          {over ? (
            <p role="status" className="mt-1.5 flex items-center gap-1.5 rounded-[8px] bg-warning-bg px-3 py-1.5 text-[12.5px] font-semibold text-warning-ink dark:text-warning">
              <Icon name="alert" size={14} />
              {text('{n} are selected. Bulk actions take up to {max} at a time — clear some to go on.', { n: count, max: BULK_LIMIT })}
            </p>
          ) : null}
          {open === 'assign' ? <Menu label={text('Assign to')} anchor={assignBtn} avoid={bar} prefer="bottom" align="start" sections={submenu('assign')} onClose={() => setOpen(null)} /> : null}
          {open === 'priority' ? <Menu label={text('Priority')} anchor={priorityBtn} avoid={bar} prefer="bottom" align="start" width={200} sections={submenu('priority')} onClose={() => setOpen(null)} /> : null}
        </div>
      ) : null}
      <div role="grid" aria-label={text(title)} aria-rowcount={rows.length + 1} className={TABLE_FRAME}>
        <div role="row" className={cx(GRID, TABLE_HEAD)}>
          <span role="columnheader" className="flex w-7 justify-center">
            <Checkbox aria-label={text('Select all')} checked={sel.state === 'all'} indeterminate={sel.state === 'some'} disabled={!rows.length} onChange={sel.toggleAll} />
          </span>
          {['Visitor', 'Site', 'Status', 'Priority', 'Owner', 'Waiting'].map((h) => <span key={h} role="columnheader">{text(h)}</span>)}
        </div>
        {placeholder ?? rows.map((r) => (
          <TableRow key={r.id} r={r} me={me} myName={myName} ring={ringing.get(r.id)} typing={typing.has(r.id)} picked={sel.isPicked(r.id)}
            onPick={() => sel.toggle(r.id)} onClick={(e) => click(e, r)} onMenu={(e) => context(e, r)} onKeyDown={(e) => keys(e, r)} />
        ))}
      </div>
      {footnote ? (
        <p className="flex items-center gap-2.5 rounded-[10px] border border-dashed border-line px-3.5 py-2.5 text-[12.5px] text-ink-2">
          <Icon name="info" size={16} className="shrink-0 text-ink-3" />
          {text(footnote)}
        </p>
      ) : null}
      {rowMenu ? <ContextMenu x={rowMenu.x} y={rowMenu.y} label={text('Conversation actions')} sections={sections} onClose={() => setRowMenu(null)} /> : null}
    </section>
  );
}

/** The status chip (UX-LIST-01): at risk, then awaiting a reply, then chatting; silenced for me, "Ringing · silenced" (R-04). */
function Status({ r, ring }: { r: WebsiteRow; ring?: WebchatRingChat }) {
  if (r.status === 'closed') return <Tag tone="muted" size="chip">{text('Closed')}</Tag>;
  if (ring?.silenced) return <SilencedStatus />;
  if (r.at_risk) return <Tag tone="danger" size="chip">{text('At risk')}</Tag>;
  if (r.awaiting_reply) return <Tag tone="warning" size="chip">{text('Awaiting reply')}</Tag>;
  return <Tag tone="indigo" size="chip">{text('Chatting')}</Tag>;
}

function TableRow({ r, me, myName, ring, typing, picked, onPick, onClick, onMenu, onKeyDown }: {
  r: WebsiteRow; me: number | null; myName: string | null; ring?: WebchatRingChat; typing: boolean; picked: boolean;
  onPick: () => void; onClick: (e: ReactMouseEvent) => void; onMenu: (e: ReactMouseEvent) => void; onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
}) {
  const name = r.visitor_name || r.label;
  const closed = r.status === 'closed';
  const since = waitingSince(r);
  const priority = PRIORITIES.find((p) => p.id === r.priority)?.label ?? r.priority;
  const line = rowPreview(r, { me, myName, ring, quote: true });
  return (
    <div
      role="row"
      tabIndex={0}
      aria-selected={picked}
      data-website-row={r.id}
      onClick={onClick}
      onContextMenu={onMenu}
      onKeyDown={onKeyDown}
      className={cx(GRID, 'cursor-default border-b border-line px-4 py-3 outline-none last:border-b-0 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset', picked ? ROW_PICKED : ring?.silenced ? ROW_SILENCED : 'hover:bg-subtle')}
    >
      {/* The lead column every list shares (worksuite-desktop#290); a table shows its boxes all the time. */}
      <span role="gridcell" className="flex">
        <RowLead checked={picked} selecting onPick={onPick} label={text('Select {name}', { name })} />
      </span>
      <span role="gridcell" className="flex min-w-0 items-center gap-2.5">
        <Avatar name={name} size={32} presence={closed ? null : r.online ? 'online' : 'away'} />
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-1.5 text-[13.5px]">
            <b className="truncate font-bold text-ink">{name}{r.email && r.visitor_name ? <span className="font-normal text-ink-3"> · {r.email}</span> : null}</b>
            {ring ? <RingBell ring={ring} /> : null}
            {r.is_starred ? <Icon name="star" size={11} className="shrink-0 text-warning" label={text('Starred')} /> : null}
            <ReopenedTag r={r} />
          </span>
          {r.call && !closed ? <CallLine call={r.call} /> : typing && !closed ? (
            <span className="truncate text-[12px] font-semibold text-primary">{text('Typing…')}</span>
          ) : (
            <span className="truncate text-[12px] text-ink-2">{line}</span>
          )}
        </span>
      </span>
      <span role="gridcell" className="truncate text-[13px] text-ink">{r.site ?? r.widget ?? text('Website')}</span>
      <span role="gridcell"><Status r={r} ring={ring} /></span>
      <span role="gridcell" className={cx('text-[13px]', r.priority === 'urgent' ? 'font-semibold text-danger' : r.priority === 'vip' ? 'font-semibold text-ink' : 'text-ink')}>{text(priority)}</span>
      {/* Still ringing, nobody has it — yet (R-04). */}
      <span role="gridcell" className={cx('truncate text-[13px]', r.agent ? 'text-ink' : 'text-ink-3')}>{r.agent ?? (ring ? text('Nobody yet') : text('Nobody'))}</span>
      <span role="gridcell">
        {r.awaiting_reply && since && !closed ? <WaitClock since={since} amber={r.wait_amber} red={r.wait_red} size="md" silenced={!!ring?.silenced} /> : <span className="text-[13px] text-ink-3" aria-label={text('Not waiting')}>—</span>}
      </span>
    </div>
  );
}
