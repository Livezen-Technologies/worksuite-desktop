import type { ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { accountTone } from './model';

/** Each account tone as whole class names, so the stylesheet keeps them (theme tokens, light and dark). */
const BG: Record<string, string> = {
  blue: 'bg-[var(--ws-acct-blue)]',
  sky: 'bg-[var(--ws-acct-sky)]',
  indigo: 'bg-[var(--ws-acct-indigo)]',
  teal: 'bg-[var(--ws-acct-teal)]',
  emerald: 'bg-[var(--ws-acct-emerald)]',
  amber: 'bg-[var(--ws-acct-amber)]',
  red: 'bg-[var(--ws-acct-red)]',
  violet: 'bg-[var(--ws-acct-violet)]',
  slate: 'bg-[var(--ws-acct-slate)]',
};

export function accountBg(colour: string | null | undefined): string {
  return BG[accountTone(colour)] ?? BG.slate!;
}

/** An account's round letter (the sidebar, the composer's From, the add-a-mailbox list). */
export function AccountAvatar({ letter, colour, size = 18, className }: { letter: string; colour: string | null | undefined; size?: number; className?: string }) {
  return (
    <span aria-hidden className={cx('inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white', accountBg(colour), className)} style={{ width: size, height: size, fontSize: Math.max(9, size * 0.5) }}>
      {letter}
    </span>
  );
}

/** An account's tag on a row of the combined list. */
export function AccountBadge({ text, colour, title }: { text: string; colour: string | null | undefined; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex h-[17px] shrink-0 items-center rounded-[4px] px-1.5 text-[10.5px] font-bold tracking-wide text-white', accountBg(colour))}>
      {text}
    </span>
  );
}

/** A category's colour: a theme tone by name, or the hex an older label kept. */
export function CategoryDot({ colour, size = 10 }: { colour: string; size?: number }) {
  const hex = /^#[0-9a-f]{6}$/i.test(colour);
  return <span aria-hidden className={cx('inline-block shrink-0 rounded-full', hex ? '' : accountBg(colour))} style={{ width: size, height: size, ...(hex ? { background: colour } : {}) }} />;
}

/** A category on a row: its colour and its name — never colour alone (DMO-ACC-03). */
export function CategoryChip({ name, colour }: { name: string; colour: string }) {
  return (
    <span title={name} className="inline-flex max-w-[120px] shrink-0 items-center gap-1 rounded-[5px] border border-line px-1.5 py-px text-[11px] font-semibold text-ink-2">
      <CategoryDot colour={colour} size={8} />
      <span className="truncate">{name}</span>
    </span>
  );
}

/** A count beside a sidebar entry: filled when it is the selected one or unread mail, quiet otherwise. */
export function Count({ n, strong, active }: { n: number | null | undefined; strong?: boolean; active?: boolean }) {
  if (n === null || n === undefined || n <= 0) return null;
  return (
    <span className={cx('inline-flex h-[18px] min-w-[20px] shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular', active ? 'bg-primary text-[var(--ws-on-primary)]' : strong ? 'bg-selection text-primary' : 'text-ink-3')}>
      {n > 999 ? '999+' : n}
    </span>
  );
}

/** A collapsible sidebar section's heading, with its + button where there is something to add. */
export function SectionHeading({ label, open, onToggle, onAdd, addLabel, children }: { label: string; open: boolean; onToggle: () => void; onAdd?: () => void; addLabel?: string; children?: ReactNode }) {
  return (
    <div className="group mt-3 flex h-7 items-center gap-1 pl-2 pr-1">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 items-center text-left text-[12px] font-semibold text-ink-3 hover:text-ink">
        <span className="truncate">{label}</span>
      </button>
      {children}
      <button type="button" onClick={onToggle} aria-label={open ? `Collapse ${label}` : `Expand ${label}`} className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-ink">
        <Icon name="chevron-down" size={13} className={cx('transition-transform', open ? '' : '-rotate-90')} />
      </button>
      {onAdd ? (
        <button type="button" onClick={onAdd} aria-label={addLabel ?? `Add to ${label}`} title={addLabel} className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-ink">
          <Icon name="plus" size={14} />
        </button>
      ) : null}
    </div>
  );
}
