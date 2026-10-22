import { useEffect, useRef, useState, type RefObject } from 'react';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Button, Modal, cx } from '../../../components/ui';
import type { ChannelCaps } from './caps';
import type { KitMessage } from './model';

/**
 * A message's actions (Chat · message actions; C-02, RDC-12; worksuite-desktop#229). Which ones a message offers is
 * the channel's caps, the server's per-message `can`, and whether the surface handles it — so a website chat offers
 * Reply and Copy where Team Chat offers the full set, from the same menu.
 */

export interface MenuItem {
  icon: string;
  label: string;
  danger?: boolean;
  run: () => void;
}

/** What the surface does when an action is chosen. One it leaves out is not offered. */
export interface MessageHandlers {
  onReply?: (m: KitMessage) => void;
  onReact?: (m: KitMessage, emoji: string) => void;
  onStar?: (m: KitMessage) => void;
  onPin?: (m: KitMessage) => void;
  onForward?: (m: KitMessage) => void;
  onEdit?: (m: KitMessage) => void;
  onDelete?: (m: KitMessage, scope: 'everyone' | 'me') => void;
  onCopyLink?: (m: KitMessage) => void;
  onCreateTask?: (m: KitMessage) => void;
  onSaveToDrive?: (m: KitMessage) => void;
}

export const REACTION_BAR = ['👍', '❤️', '😂', '😮', '😢', '🎉', '👏'];
export const DRAWER_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

const copyText = (m: KitMessage) => void navigator.clipboard.writeText(m.body ?? '').then(() => toast('success', 'Copied.'));

/** Whether this person may react to the message here. */
export const canReact = (m: KitMessage, caps: ChannelCaps, h: MessageHandlers) => caps.reactions && !!h.onReact && m.can?.react !== false;
/** Whether Reply is offered. */
export const canReply = (m: KitMessage, h: MessageHandlers) => !!h.onReply && m.can?.reply !== false;

/**
 * The menu's items, in the order each look has always had them: the page's (Reply, Forward, Copy link, Star, Pin,
 * Edit, Copy text, Save to Drive, Delete) and the drawer's (Reply, Copy message, Copy link, Pin, Forward, Create task,
 * Edit, Save to Drive, Delete — star and react are on its bar).
 */
export function messageActionItems(m: KitMessage, caps: ChannelCaps, h: MessageHandlers, look: 'page' | 'drawer', openDelete: (scope: 'everyone' | 'me') => void): MenuItem[] {
  const can = m.can ?? {};
  const reply = canReply(m, h) ? { icon: 'reply', label: 'Reply', run: () => h.onReply!(m) } : null;
  const forward = caps.forward && can.forward && h.onForward ? { icon: 'forward', label: 'Forward…', run: () => h.onForward!(m) } : null;
  const link = caps.copyLink && h.onCopyLink ? { icon: 'link', label: 'Copy link', run: () => h.onCopyLink!(m) } : null;
  const star = caps.star && h.onStar ? { icon: 'star', label: m.starred ? 'Unstar message' : 'Star message', run: () => h.onStar!(m) } : null;
  const pin = caps.pin && h.onPin ? { icon: m.pinned ? 'pin-off' : 'pin', label: m.pinned ? 'Unpin message' : 'Pin message', run: () => h.onPin!(m) } : null;
  const edit = caps.edit && can.edit && h.onEdit ? { icon: 'compose', label: 'Edit', run: () => h.onEdit!(m) } : null;
  const copy = caps.copy && can.copy !== false && m.body ? { icon: 'copy', label: look === 'drawer' ? 'Copy message' : 'Copy text', run: () => copyText(m) } : null;
  const task = caps.createTask && h.onCreateTask ? { icon: 'tasks', label: 'Create task', run: () => h.onCreateTask!(m) } : null;
  const drive = caps.saveToDrive && h.onSaveToDrive && m.files?.length ? { icon: 'folder-input', label: 'Save to Drive', run: () => h.onSaveToDrive!(m) } : null;
  // A website chat's delete reaches the visitor too, within the server's window; until it offers one (null), none.
  const del = h.onDelete && caps.deleteForVisitorMinutes !== null && (can.delete_me || can.delete_everyone) ? { icon: 'trash', label: 'Delete…', danger: true, run: () => openDelete(can.delete_everyone ? 'everyone' : 'me') } : null;
  const items = look === 'drawer' ? [reply, copy, link, pin, forward, task, edit, drive, del] : [reply, forward, link, star, pin, edit, copy, drive, del];
  return items.filter((x): x is MenuItem => !!x);
}

/** Closes a floating panel on a click elsewhere, Escape, or a scroll behind it. */
export function useDismiss(open: boolean, box: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) => !!box.current && box.current.contains(t as Node);
    const down = (e: MouseEvent) => !inside(e.target) && close();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const scroll = (e: Event) => !inside(e.target) && close();
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    window.addEventListener('scroll', scroll, true);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [open, box, close]);
}

const toolBtn = 'flex h-7 w-7 items-center justify-center rounded-[7px] text-ink-2 hover:bg-subtle hover:text-ink';

/**
 * A message's actions (ChatDrawer · message actions; worksuite-desktop#266): on hover or focus, a compact bar on the
 * bubble's top edge — react, reply, star, more. The drawer keeps it at the corner on the message's own side; a
 * conversation in its tab or window puts it in the top-right corner, inside the message's column, rather than a
 * round button floating beside the bubble. The reactions pill and the menu float, stay inside the thread, and the
 * menu opens upward when the message is down by the message box.
 */
export function MessageToolbar({ m, own, caps, handlers: h, items, onMoreReactions, look = 'drawer' }: { m: KitMessage; own: boolean; caps: ChannelCaps; handlers: MessageHandlers; items: MenuItem[]; onMoreReactions: () => void; look?: 'page' | 'drawer' }) {
  const [pop, setPop] = useState<{ kind: 'react' | 'more'; left: number; top: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(!!pop, box, () => setPop(null));
  const react = canReact(m, caps, h);
  const reply = canReply(m, h);
  const star = caps.star && !!h.onStar;
  const reactions = look === 'page' ? REACTION_BAR : DRAWER_REACTIONS;

  // Placed when opened: inside the drawer, above the bar for the reactions, under the ⋯ for the menu unless that
  // would run into the message box.
  const open = (kind: 'react' | 'more', button: HTMLElement) => {
    if (pop?.kind === kind) return setPop(null);
    const area = (button.closest('[data-thread]') ?? document.body).getBoundingClientRect();
    const b = button.getBoundingClientRect();
    const bar = (button.closest('[role="toolbar"]') ?? button).getBoundingClientRect();
    const w = kind === 'react' ? 44 + reactions.length * 36 : 214;
    const hgt = kind === 'react' ? 46 : items.length * 32 + 12 + (items.some((x) => x.danger) ? 9 : 0);
    const left = Math.max(area.left + 8, Math.min(area.right - w - 8, kind === 'react' ? (own ? bar.right - w : bar.left) : own ? b.right - w : b.left));
    const top =
      kind === 'react'
        ? bar.top - hgt - 6 >= area.top + 8
          ? bar.top - hgt - 6
          : bar.bottom + 6
        : b.bottom + 4 + hgt <= area.bottom - 8
          ? b.bottom + 4
          : Math.max(area.top + 8, b.top - hgt - 4);
    setPop({ kind, left, top });
  };

  if (!react && !reply && !star && !items.length) return null;
  const bar = (
    <div
      role="toolbar"
      aria-label="Message actions"
      className={cx(
        'z-20 flex items-center gap-0.5 rounded-[10px] bg-surface p-[3px] shadow-[0_4px_14px_rgb(var(--ws-shadow-rgb)/.16),0_0_0_1px_var(--ws-edge)]',
        look === 'page' ? 'pointer-events-auto shrink-0' : cx('absolute bottom-full -mb-1', own ? 'right-1.5' : 'left-1.5'),
        pop ? 'visible' : 'invisible group-hover:visible group-focus-within:visible',
      )}
    >
      {react ? (
        <button type="button" aria-label="React" title="React" aria-expanded={pop?.kind === 'react'} onClick={(e) => open('react', e.currentTarget)} className={cx(toolBtn, pop?.kind === 'react' && '!bg-selection !text-primary')}>
          <Icon name="smile" size={15} />
        </button>
      ) : null}
      {reply ? (
        <button type="button" aria-label="Reply" title="Reply" onClick={() => h.onReply!(m)} className={toolBtn}>
          <Icon name="reply" size={15} />
        </button>
      ) : null}
      {star ? (
        <button
          type="button"
          aria-label={m.starred ? 'Unstar message' : 'Star message'}
          title={m.starred ? 'Unstar' : 'Star'}
          aria-pressed={!!m.starred}
          onClick={() => h.onStar!(m)}
          className={cx(toolBtn, m.starred && '!text-[#CA8A04]')}
        >
          <Icon name="star" size={15} />
        </button>
      ) : null}
      {items.length ? (
        <button type="button" aria-label="More actions" title="More" aria-haspopup="menu" aria-expanded={pop?.kind === 'more'} onClick={(e) => open('more', e.currentTarget)} className={cx(toolBtn, pop?.kind === 'more' && '!bg-selection !text-primary')}>
          <Icon name="more" size={15} />
        </button>
      ) : null}
    </div>
  );
  return (
    <div ref={box} className="contents">
      {look === 'page' ? (
        // The top-right corner; a bar wider than a short message from the other side runs right, never off the left edge.
        <div data-message-toolbar className={cx('pointer-events-none absolute inset-x-1.5 bottom-full -mb-1 z-20 flex', own ? 'justify-end' : 'justify-end-safe')}>
          {bar}
        </div>
      ) : (
        bar
      )}
      {pop?.kind === 'react' ? (
        <div role="toolbar" aria-label="React" className="fixed z-40 flex items-center gap-0.5 rounded-full bg-surface p-1 shadow-[0_8px_24px_rgb(var(--ws-shadow-rgb)/.18),0_0_0_1px_var(--ws-edge)]" style={{ left: pop.left, top: pop.top }}>
          {reactions.map((e) => (
            <button key={e} type="button" aria-label={`React ${e}`} onClick={() => (setPop(null), h.onReact!(m, e))} className="flex h-[34px] w-[34px] items-center justify-center rounded-full text-[21px] leading-none transition-transform hover:scale-110 hover:bg-selection">
              {e}
            </button>
          ))}
          <button type="button" aria-label="More reactions" title="More reactions" onClick={() => (setPop(null), onMoreReactions())} className="ml-0.5 flex h-[34px] w-[34px] items-center justify-center rounded-full bg-subtle text-ink-2 hover:text-ink">
            <Icon name="plus" size={16} />
          </button>
        </div>
      ) : null}
      {pop?.kind === 'more' ? (
        <div role="menu" aria-label="Message actions" className="fixed z-40 w-[214px] rounded-[12px] bg-surface p-1.5 shadow-[0_16px_40px_rgb(var(--ws-shadow-rgb)/.2),0_0_0_1px_var(--ws-edge)]" style={{ left: pop.left, top: pop.top }}>
          {items.map((it, i) => (
            <div key={it.label}>
              {it.danger && i > 0 ? <span className="mx-1.5 my-1 block h-px bg-line" /> : null}
              <button type="button" role="menuitem" onClick={() => (setPop(null), it.run())} className={cx('flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[13px] hover:bg-subtle', it.danger ? 'text-danger' : 'text-ink')}>
                <Icon name={it.icon} size={15} className={it.danger ? '' : 'text-ink-2'} />
                {it.label}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** "Delete message?" — for everyone or for me, as the server allows. */
export function DeleteDialog({ m, scope, setScope, onDelete }: { m: KitMessage; scope: 'everyone' | 'me'; setScope: (v: 'everyone' | 'me' | null) => void; onDelete: (scope: 'everyone' | 'me') => void }) {
  const can = m.can ?? {};
  return (
    <Modal
      title="Delete message?"
      onClose={() => setScope(null)}
      width={420}
      footer={
        <>
          <Button onClick={() => setScope(null)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => {
              setScope(null);
              onDelete(scope);
            }}
          >
            Delete
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px]">
        <div className="rounded-[9px] bg-subtle px-3 py-2.5 text-ink-2">“{(m.body ?? m.files?.[0]?.filename ?? '').slice(0, 120)}”</div>
        {can.delete_everyone ? (
          <label className="flex items-start gap-2.5">
            <input type="radio" name={`del-${m.id}`} checked={scope === 'everyone'} onChange={() => setScope('everyone')} className="mt-0.5 accent-[var(--color-primary)]" />
            <span className="flex flex-col"><b className="text-ink">Delete for everyone</b><span className="text-[12px] text-ink-3">Shows “Message deleted” in the conversation</span></span>
          </label>
        ) : null}
        {can.delete_me ? (
          <label className="flex items-start gap-2.5">
            <input type="radio" name={`del-${m.id}`} checked={scope === 'me'} onChange={() => setScope('me')} className="mt-0.5 accent-[var(--color-primary)]" />
            <span className="flex flex-col"><b className="text-ink">Delete for me</b><span className="text-[12px] text-ink-3">Others still see it</span></span>
          </label>
        ) : null}
      </div>
    </Modal>
  );
}
