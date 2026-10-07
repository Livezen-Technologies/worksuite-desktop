import type { MouseEvent } from 'react';
import { Checkbox, CheckboxMark } from './Checkbox';
import { cx } from './ui';
import type { PickHow } from './useListSelection';

/**
 * A list row's lead (worksuite-desktop#290): one 28px column at the row's left — the same in Mail, Chat, Website
 * chats and Files — that holds the unread dot or the row's checkbox, in the same spot and never both.
 *
 * - Normally: the 8px accent dot while the row is unread; nothing once it is read.
 * - Under the mouse, or with keyboard focus inside the row: the checkbox takes the dot's place. The row needs the
 *   `group` class for this.
 * - `selecting` (anything in the list is picked, or the list always shows its boxes): every row shows its checkbox and
 *   no dot. Unread still shows in the row's bold text.
 * - `onPick` ticks the row, with how: Shift held picks the range from the last row picked, anything else toggles.
 *   The click stops here, so ticking a row never opens it. Without `onPick` the box is a mark only — for a row that
 *   is itself a button and picks on its own click (Chat's Select mode).
 *
 * The box is the app's 16px checkbox; the 32px square around it takes the click too. The column is a line high and
 * centred on whatever it sits beside: put it in the row's first line, or give it `self-start` in a taller row so it
 * lines up with the first line.
 */
export interface RowLeadProps {
  unread?: boolean;
  /** This row is picked. */
  checked?: boolean;
  /** Something in the list is picked (or the list always shows its checkboxes): the box shows on every row. */
  selecting?: boolean;
  onPick?: (how: PickHow) => void;
  /** The checkbox's name, e.g. "Select “Lunch?”". */
  label?: string;
  /** The dot's name where nothing else on the row says it is unread ("Marked unread"); otherwise it is not read out. */
  dotLabel?: string;
  className?: string;
}

export function RowLead({ unread = false, checked = false, selecting = false, onPick, label, dotLabel, className }: RowLeadProps) {
  const boxed = selecting || checked;
  // The square around the box: a click beside the 16px box picks too, and never reaches the row.
  const around = (e: MouseEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    if (e.target === e.currentTarget) onPick?.(e.shiftKey ? 'range' : 'toggle');
  };
  return (
    <span data-row-lead className={cx('relative flex h-5 w-7 shrink-0 items-center justify-center', className)}>
      {unread && !boxed ? (
        <span
          data-unread-dot
          role={dotLabel ? 'img' : undefined}
          aria-label={dotLabel}
          aria-hidden={dotLabel ? undefined : true}
          title={dotLabel}
          className={cx('h-2 w-2 rounded-full bg-primary', onPick && 'group-hover:invisible group-focus-within:invisible')}
        />
      ) : null}
      {onPick ? (
        <span
          data-row-check
          onClick={around}
          onDoubleClick={(e) => e.stopPropagation()}
          className={cx('absolute top-1/2 left-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center', !boxed && 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100')}
        >
          <Checkbox checked={checked} aria-label={label} onChange={(e) => onPick((e.nativeEvent as Event & { shiftKey?: boolean }).shiftKey ? 'range' : 'toggle')} />
        </span>
      ) : boxed ? (
        <CheckboxMark checked={checked} />
      ) : null}
    </span>
  );
}
