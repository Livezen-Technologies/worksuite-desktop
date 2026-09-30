import { useRef, type KeyboardEvent } from 'react';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/ui';
import { badgeText, channelTitle, type Channel, type ChannelId } from './channels';

/**
 * The channel toolbar on the far left of Chat (worksuite-desktop#33): one icon per channel this person has, its
 * unread (or waiting) count, a warning when it is not connected, and "Add a channel" at the foot. It stays when the
 * conversation list is hidden, so a narrow window still switches channels; ↑ ↓ Home End move along it.
 */
export function ChannelBar({ channels, active, onPick, onAdd }: { channels: Channel[]; active: ChannelId; onPick: (id: ChannelId) => void; onAdd: () => void }) {
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
    <nav ref={ref} aria-label="Channels" onKeyDown={onKeyDown} className="flex w-[56px] shrink-0 flex-col items-center gap-1.5 overflow-y-auto border-r border-line bg-[#FBFBFD] py-2.5 scroll-thin dark:bg-surface">
      {channels.map((c) => {
        const on = c.id === active;
        const title = channelTitle(c);
        return (
          <button
            key={c.id}
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
              <span aria-hidden className={cx('absolute -top-1 -right-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full border-2 border-[#FBFBFD] px-1 text-[9.5px] leading-none font-bold text-white dark:border-surface', c.id === 'website' ? 'bg-badge' : 'bg-primary')}>
                {badgeText(c.badge)}
              </span>
            ) : null}
            {c.problem ? (
              <span aria-hidden className="absolute -right-0.5 -bottom-0.5 flex h-[14px] w-[14px] items-center justify-center rounded-full border-2 border-[#FBFBFD] bg-warning text-white dark:border-surface">
                <Icon name="alert" size={8} />
              </span>
            ) : null}
          </button>
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
