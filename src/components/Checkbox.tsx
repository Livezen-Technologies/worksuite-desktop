import { forwardRef, useCallback, useEffect, useRef, type CSSProperties, type InputHTMLAttributes, type KeyboardEvent, type MouseEvent } from 'react';
import { cx } from './ui';

/**
 * The one checkbox of WorkSuite: file lists, tables, forms, settings and
 * dialogs all use it (issue #58). It is a native `<input type="checkbox">`
 * underneath, so keyboard focus, Space to toggle, labels, form values and
 * screen-reader state ("checked", "not checked", "mixed") all come from the
 * platform; only the look is ours (`.ws-checkbox` in styles.css).
 *
 * - `indeterminate`: the "some rows are chosen" state of a Select-all box.
 * - `invalid`: a validation error (red border, `aria-invalid`).
 * - `size`: `md` (16px, everywhere) or `lg` (20px, touch-first screens).
 * - `color`: an accent other than the brand's, e.g. a calendar category.
 *
 * A click (or Space) on the box does not reach the row around it, so ticking
 * a row never opens the file, order or record the row stands for.
 */
export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> & {
  indeterminate?: boolean;
  invalid?: boolean;
  size?: 'md' | 'lg';
  color?: string;
};

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { indeterminate = false, invalid = false, size = 'md', color, className, style, onClick, onDoubleClick, onKeyDown, ...rest },
  ref,
) {
  const own = useRef<HTMLInputElement | null>(null);
  const setRef = useCallback(
    (el: HTMLInputElement | null) => {
      own.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );

  // Every render: the browser clears the flag on a click, and the prop may not have changed.
  useEffect(() => {
    if (own.current) own.current.indeterminate = indeterminate;
  });

  return (
    <input
      {...rest}
      ref={setRef}
      type="checkbox"
      aria-invalid={invalid || rest['aria-invalid'] || undefined}
      data-size={size === 'lg' ? 'lg' : undefined}
      className={cx('ws-checkbox', className)}
      style={color ? ({ ...style, '--ws-cb-accent': color } as CSSProperties) : style}
      onClick={(e: MouseEvent<HTMLInputElement>) => {
        onClick?.(e);
        e.stopPropagation();
      }}
      onDoubleClick={(e: MouseEvent<HTMLInputElement>) => {
        onDoubleClick?.(e);
        e.stopPropagation();
      }}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        onKeyDown?.(e);
        if (e.key === ' ') e.stopPropagation();
      }}
    />
  );
});

/**
 * The checkbox's look with no control behind it (worksuite-desktop#290): for a row that is itself a button and picks
 * on its own click (Chat's Select mode), where a real checkbox would be a control inside a control. It is hidden from
 * screen readers; the row says whether it is picked (`aria-pressed`, `aria-selected`).
 */
export function CheckboxMark({ checked = false, indeterminate = false, className }: { checked?: boolean; indeterminate?: boolean; className?: string }) {
  return <span aria-hidden data-state={indeterminate ? 'mixed' : checked ? 'checked' : 'unchecked'} className={cx('ws-checkbox pointer-events-none', className)} />;
}
