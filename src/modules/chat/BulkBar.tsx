import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { text } from '../../core/i18n';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';

/**
 * The bar that stands over a list while conversations are picked (worksuite-desktop#183, UX-LIST-02): how many, what
 * can be done to all of them, a note, and a way out. One bar for every chat list:
 *
 * - `rail` — Chat's narrow conversation list: a light strip with icon buttons and an ✕ ("Stop selecting").
 * - `table` — a full-width list (Website chats): navy, outline buttons, the note on the right and "Clear".
 */
export function BulkBar({ count, children, note, onClear, label = 'Bulk actions', tone = 'table' }: { count: number; children?: ReactNode; note?: ReactNode; onClear: () => void; label?: string; tone?: 'rail' | 'table' }) {
  if (tone === 'rail') {
    return (
      <div role="toolbar" aria-label={label} className="flex items-center gap-1 rounded-[8px] bg-selection px-2 py-1 text-[12px] text-ink">
        <b className="mr-auto">{text('{n} selected', { n: count })}</b>
        {children}
        <button type="button" aria-label={text('Stop selecting')} title={text('Stop selecting')} onClick={onClear} className="flex h-7 w-7 items-center justify-center rounded-[7px] text-ink-2 hover:bg-surface">
          <Icon name="x" size={14} />
        </button>
      </div>
    );
  }
  return (
    <div role="toolbar" aria-label={label} className="flex flex-wrap items-center gap-2 rounded-[10px] bg-navy px-3 py-2 text-white">
      <b className="mr-1.5 text-[13px]">{text('{n} selected', { n: count })}</b>
      {children}
      <span className="flex-1" />
      {note ? <span className="text-[12px] text-navy-ink">{note}</span> : null}
      <button type="button" onClick={onClear} className="h-[30px] rounded-[8px] px-3 text-[12.5px] font-bold text-stage-accent hover:bg-navy-2">
        {text('Clear')}
      </button>
    </div>
  );
}

/** An action on the navy bar: an outline button, with ▾ when it opens a menu. */
export const BulkButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { menu?: boolean }>(function BulkButton({ menu = false, className, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-haspopup={menu ? 'menu' : undefined}
      {...rest}
      className={cx('inline-flex h-[30px] items-center gap-1 rounded-[8px] border border-navy-3 bg-transparent px-3 text-[12.5px] font-semibold text-white hover:bg-navy-2 disabled:opacity-50', className)}
    >
      {children}
      {menu ? <span aria-hidden>▾</span> : null}
    </button>
  );
});

/** An action on the rail's strip: an icon button named by its label. */
export function BulkIconButton({ label, icon, disabled, onClick }: { label: string; icon: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="flex h-7 w-7 items-center justify-center rounded-[7px] text-ink-2 hover:bg-surface disabled:opacity-40">
      <Icon name={icon} size={14} />
    </button>
  );
}
