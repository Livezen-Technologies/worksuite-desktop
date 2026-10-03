import { useRef, type KeyboardEvent } from 'react';
import { Icon } from '../../../components/Icon';
import { Avatar, cx } from '../../../components/ui';
import { badgeText, channelTitle, type Channel, type ChannelId } from './channels';
import { numberName, numberState, type NumberTone, type WaAccount } from './whatsapp';

/** The rail's WhatsApp numbers (#155): each with its status dot and, apart from it, its unread count. */
export interface RailNumbers {
  accounts: WaAccount[];
  /** The number the list shows; 0 for all of them. */
  selected: number;
  onPick: (id: number) => void;
}

const TONE_DOT: Record<NumberTone, string> = { connected: 'bg-success', waiting: 'bg-warning', down: 'bg-danger' };

/**
 * The channel toolbar on the far left of Chat (worksuite-desktop#33): one icon per channel this person has, its
 * unread (or waiting) count, a warning when it is not connected, and "Add a channel" at the foot. It stays when the
 * conversation list is hidden, so a narrow window still switches channels; ↑ ↓ Home End move along it.
 *
 * While WhatsApp is open, its numbers sit under its icon (#155): initials, the name and number as the tooltip, a
 * status dot at the foot (green connected, orange waiting for a scan, red not connected) and the unread count at the
 * top — never the same mark. Picking one shows only its conversations; picking it again, all of them. The numbers'
 * own dots say what is wrong, so the WhatsApp icon carries no warning of its own meanwhile.
 */
export function ChannelBar({ channels, active, onPick, onAdd, numbers }: { channels: Channel[]; active: ChannelId; onPick: (id: ChannelId) => void; onAdd: () => void; numbers?: RailNumbers }) {
  const ref = useRef<HTMLElement>(null);
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const to = e.key === 'ArrowDown' ? (at + 1) % buttons.length : e.key === 'ArrowUp' ? (at - 1 + buttons.length) % buttons.length : e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    buttons[to]!.focus();
  };

  return (
    <nav ref={ref} aria-label="Channels" onKeyDown={onKeyDown} className="flex w-[56px] shrink-0 flex-col items-center gap-1.5 overflow-y-auto border-r border-line bg-rail py-2.5 scroll-thin">
      {channels.map((c) => {
        const on = c.id === active;
        const title = channelTitle(c);
        const rail = c.id === 'whatsapp' && on && numbers?.accounts.length ? numbers : null;
        return (
          <div key={c.id} className="flex shrink-0 flex-col items-center gap-1.5">
            <button
              type="button"
              aria-label={title}
              title={title}
              aria-current={on ? 'page' : undefined}
              onClick={() => onPick(c.id)}
              className={cx(
                'relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] outline-none focus-visible:ring-2 focus-visible:ring-primary',
                on ? 'bg-selection text-primary' : 'text-ink-2 hover:bg-subtle hover:text-ink',
              )}
            >
              {on ? <span aria-hidden className="absolute top-2 bottom-2 -left-2 w-[3px] rounded-full bg-primary" /> : null}
              <Icon name={c.icon} size={19} />
              {c.badge ? (
                <span aria-hidden className={cx('absolute -top-1 -right-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full border-2 border-rail px-1 text-[9.5px] leading-none font-bold text-white', c.id === 'website' ? 'bg-badge' : 'bg-primary')}>
                  {badgeText(c.badge)}
                </span>
              ) : null}
              {c.problem && !rail ? (
                <span aria-hidden className="absolute -right-0.5 -bottom-0.5 flex h-[14px] w-[14px] items-center justify-center rounded-full border-2 border-rail bg-warning text-white">
                  <Icon name="alert" size={8} />
                </span>
              ) : null}
            </button>
            {rail ? <NumberRail {...rail} /> : null}
          </div>
        );
      })}
      <span aria-hidden className="my-1 h-px w-7 shrink-0 bg-line" />
      <button
        type="button"
        aria-label="Add a channel"
        title="Add a channel"
        onClick={onAdd}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-dashed border-line text-ink-3 outline-none hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Icon name="plus" size={18} />
      </button>
    </nav>
  );
}

function NumberRail({ accounts, selected, onPick }: RailNumbers) {
  return (
    <div role="group" aria-label="WhatsApp numbers" className="flex flex-col items-center gap-1.5 pb-1">
      {accounts.map((a) => {
        const state = numberState(a);
        const unread = a.unread ?? 0;
        const on = selected === a.id;
        const label = [numberName(a), state.label, unread ? `${unread} unread` : null].filter(Boolean).join(' · ');
        return (
          <button
            key={a.id}
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={on}
            onClick={() => onPick(on ? 0 : a.id)}
            className={cx('relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary', on ? 'ring-2 ring-primary ring-offset-1 ring-offset-rail' : 'opacity-90 hover:opacity-100')}
          >
            <Avatar name={a.name} size={28} />
            <span data-status={state.tone} aria-hidden className={cx('absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-rail', TONE_DOT[state.tone])} />
            {unread ? (
              <span data-unread aria-hidden className="absolute -top-1.5 -right-2 flex h-[15px] min-w-[15px] items-center justify-center rounded-full border-2 border-rail bg-primary px-0.5 text-[9px] leading-none font-bold text-white">
                {badgeText(unread)}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
