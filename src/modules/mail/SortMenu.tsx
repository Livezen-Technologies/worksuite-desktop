import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { text } from '../../core/i18n';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import type { GroupKey, MailPrefs, SortKey } from './types';

/**
 * Sort & Group (worksuite-desktop#168): every choice with its icon, the direction as a two-way switch whose
 * words follow the field (Newest/Oldest, A → Z/Z → A, Largest/Smallest), conversations as a switch, Apply
 * to all folders and Reset to default. It opens under its button, right edges lined up, never over the
 * toolbar; arrows move, Enter picks, Esc closes, and Tab stays inside until it closes.
 */

export const SORTS: Array<{ id: SortKey; label: string; icon: string }> = [
  { id: 'date', label: 'Date', icon: 'calendar' },
  { id: 'sender', label: 'Sender', icon: 'user' },
  { id: 'subject', label: 'Subject', icon: 'type' },
  { id: 'size', label: 'Size', icon: 'disk' },
  { id: 'read', label: 'Read status', icon: 'mail-open' },
  { id: 'attachment', label: 'Attachments', icon: 'paperclip' },
  { id: 'flag', label: 'Importance', icon: 'flag' },
  { id: 'star', label: 'Starred', icon: 'star' },
];

export const GROUPS: Array<{ id: GroupKey; label: string; icon: string }> = [
  { id: 'none', label: 'No grouping', icon: 'list' },
  { id: 'date', label: 'Date', icon: 'calendar' },
  { id: 'sender', label: 'Sender', icon: 'users' },
  { id: 'folder', label: 'Folder', icon: 'folder' },
  { id: 'label', label: 'Label', icon: 'tag' },
  { id: 'priority', label: 'Importance', icon: 'flag' },
  { id: 'conversation', label: 'Conversation', icon: 'chat' },
];

/** The default a Reset goes back to: Date · Newest · grouped by date. */
export const SORT_DEFAULT = {
  sort: 'date' as SortKey,
  dir: 'desc' as const,
  group: 'date' as GroupKey,
};

/** The two directions in the field's own words: [descending, ascending]. */
export function directionWords(sort: SortKey): [string, string] {
  if (sort === 'date') return [text('Newest'), text('Oldest')];
  if (sort === 'sender' || sort === 'subject') return [text('Z → A'), text('A → Z')];
  if (sort === 'size') return [text('Largest'), text('Smallest')];
  if (sort === 'read') return [text('Unread first'), text('Read first')];
  return [text('Marked first'), text('Unmarked first')];
}

/** What the toolbar says: "Date · Newest", "Sender · A → Z". */
export function sortLabel(prefs: Pick<MailPrefs, 'sort' | 'dir'>): string {
  const sort = prefs.sort ?? 'date';
  const [down, up] = directionWords(sort);
  const name = SORTS.find((s) => s.id === sort)?.label ?? sort;
  return `${text(name)} · ${(prefs.dir ?? 'desc') === 'desc' ? down : up}`;
}

const WIDTH = 260;

export function SortMenu({
  anchor,
  prefs,
  conversations,
  onPrefs,
  onConversations,
  onClose,
}: {
  anchor: RefObject<HTMLElement | null>;
  prefs: MailPrefs;
  conversations: boolean | null;
  onPrefs: (p: Partial<MailPrefs> & { applyToAll?: boolean }) => void;
  onConversations: (on: boolean) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    maxHeight: number;
  } | null>(null);
  const sort = prefs.sort ?? 'date';
  const dir = prefs.dir ?? 'desc';
  const group = prefs.group ?? 'date';
  const [down, up] = directionWords(sort);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  // Under the button, right edges lined up, inside the window; it scrolls when the window is short.
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const left = Math.max(8, Math.min(r.right - WIDTH, window.innerWidth - WIDTH - 8));
      const top = r.bottom + 6;
      setPos({
        left,
        top,
        maxHeight: Math.max(160, window.innerHeight - top - 8),
      });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor]);

  // Once placed, the chosen sort takes focus — once, not on every move.
  const focused = useRef(false);
  useEffect(() => {
    if (!pos || focused.current) return;
    focused.current = true;
    ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }, [pos]);

  // A press anywhere else closes it; the button toggles it itself.
  useEffect(() => {
    const away = (e: Event) => {
      const t = e.target as Node | null;
      if (!t || ref.current?.contains(t) || anchor.current?.contains(t)) return;
      closeRef.current();
    };
    document.addEventListener('mousedown', away, true);
    return () => document.removeEventListener('mousedown', away, true);
  }, [anchor]);

  const items = () => [...(ref.current?.querySelectorAll<HTMLElement>('[data-sort-item]:not([disabled])') ?? [])];
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      anchor.current?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      (e.key === 'Home' ? list[0] : list[list.length - 1])?.focus();
    } else if (e.key === 'Tab') {
      // Focus stays in the menu until it closes.
      e.preventDefault();
      list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length]?.focus();
    }
  };

  const pickSort = (id: SortKey) =>
    onPrefs(
      id === sort
        ? { dir: dir === 'desc' ? 'asc' : 'desc' }
        : {
            sort: id,
            dir: id === 'sender' || id === 'subject' ? 'asc' : 'desc',
          },
    );
  const row = (on: boolean) =>
    cx(
      'flex h-9 w-full shrink-0 items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[13.5px] outline-none',
      'focus-visible:shadow-[inset_0_0_0_2px_var(--ws-focus)]',
      on ? 'bg-selection font-semibold text-primary' : 'text-ink hover:bg-subtle focus:bg-subtle',
    );
  const head = (label: string, id: string) => (
    <div id={id} className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
      {label}
    </div>
  );

  const host = typeof document !== 'undefined' ? (document.fullscreenElement ?? document.body) : null;
  if (!host) return null;
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={text('Sort and group')}
      onKeyDown={onKey}
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        width: WIDTH,
        maxHeight: pos?.maxHeight,
      }}
      className="ws-sort-menu no-drag fixed z-50 flex flex-col overflow-y-auto rounded-[12px] border border-line bg-surface p-2 text-ink shadow-[0_12px_32px_-8px_rgb(var(--ws-shadow-rgb)/.25)] scroll-thin motion-safe:animate-[ws-menu-in_120ms_ease-out]"
    >
      <div role="group" aria-labelledby="ws-sort-by" className="flex flex-col">
        {head(text('Sort by'), 'ws-sort-by')}
        {SORTS.map((s) => {
          const on = s.id === sort;
          return (
            <button
              key={s.id}
              type="button"
              role="menuitemradio"
              aria-checked={on}
              data-sort-item
              onClick={() => pickSort(s.id)}
              title={on ? text('Click again to reverse') : undefined}
              className={row(on)}
            >
              <Icon name={s.icon} size={16} className={cx('shrink-0', on ? 'text-primary' : 'text-ink-3')} />
              <span className="min-w-0 flex-1 truncate">{text(s.label)}</span>
              {on ? <Icon name="check" size={15} className="shrink-0 text-primary" /> : null}
            </button>
          );
        })}
      </div>
      <div role="group" aria-label={text('Direction')} className="mx-1 mt-1.5 mb-1 flex rounded-[9px] bg-subtle p-0.5">
        {(sort === 'sender' || sort === 'subject' ? (['asc', 'desc'] as const) : (['desc', 'asc'] as const)).map((d) => (
          <button
            key={d}
            type="button"
            role="menuitemradio"
            aria-checked={dir === d}
            data-sort-item
            onClick={() => onPrefs({ dir: d })}
            className={cx(
              'flex h-7 flex-1 items-center justify-center gap-1 rounded-[7px] text-[12.5px] font-semibold outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ws-focus)]',
              dir === d ? 'bg-surface text-primary shadow-[0_1px_2px_rgb(var(--ws-shadow-rgb)/.15)]' : 'text-ink-2 hover:text-ink',
            )}
          >
            <Icon name={d === 'desc' ? 'arrow-down' : 'arrow-up'} size={13} />
            {d === 'desc' ? down : up}
          </button>
        ))}
      </div>
      <div className="mx-1 my-1.5 h-px shrink-0 bg-line" />
      <div role="group" aria-labelledby="ws-group-by" className="flex flex-col">
        {head(text('Group by'), 'ws-group-by')}
        {GROUPS.map((g) => {
          const on = g.id === group;
          return (
            <button key={g.id} type="button" role="menuitemradio" aria-checked={on} data-sort-item onClick={() => onPrefs({ group: g.id })} className={row(on)}>
              <Icon name={g.icon} size={16} className={cx('shrink-0', on ? 'text-primary' : 'text-ink-3')} />
              <span className="min-w-0 flex-1 truncate">{text(g.label)}</span>
              {on ? <Icon name="check" size={15} className="shrink-0 text-primary" /> : null}
            </button>
          );
        })}
      </div>
      <div className="mx-1 my-1.5 h-px shrink-0 bg-line" />
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={!!conversations}
        data-sort-item
        disabled={conversations === null}
        title={conversations === null ? text('A combined list or a filtered one is not grouped into conversations.') : undefined}
        onClick={() => onConversations(!conversations)}
        className={cx(row(false), 'disabled:opacity-50')}
      >
        <Icon name="message-circle" size={16} className="shrink-0 text-ink-3" />
        <span className="min-w-0 flex-1 truncate">{text('Show conversations')}</span>
        <span aria-hidden className={cx('relative h-[18px] w-8 shrink-0 rounded-full transition-colors', conversations ? 'bg-primary' : 'bg-line')}>
          <span className={cx('absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-[left]', conversations ? 'left-[16px]' : 'left-[2px]')} />
        </span>
      </button>
      <div className="mt-1 flex items-center justify-between gap-2 px-2.5 pt-1 pb-0.5 text-[12.5px]">
        <button
          type="button"
          data-sort-item
          onClick={() => onPrefs({ applyToAll: true })}
          className="rounded-[6px] font-semibold text-primary outline-none hover:underline focus-visible:shadow-[0_0_0_2px_var(--ws-focus)]"
        >
          {text('Apply to all folders')}
        </button>
        <button
          type="button"
          data-sort-item
          onClick={() => onPrefs({ ...SORT_DEFAULT })}
          className="rounded-[6px] text-ink-3 outline-none hover:text-ink hover:underline focus-visible:shadow-[0_0_0_2px_var(--ws-focus)]"
        >
          {text('Reset to default')}
        </button>
      </div>
    </div>,
    host,
  );
}
