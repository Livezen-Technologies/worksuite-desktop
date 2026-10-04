import type { ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { accountTone } from './model';
import { tagVars, type AccountTagInfo, type AccountTagMode } from './accountTags';

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

/**
 * An account's tag (#227): a soft pill — a tint of the account's colour with its first name in the darker shade, and
 * a dot before it — quieter than the sender beside it. `dot` draws the dot alone; so does a list narrower than 340px
 * (the list is the container). The address and kind of account are in the tooltip.
 */
export function AccountTag({ tag, mode = 'name', className }: { tag: AccountTagInfo; mode?: AccountTagMode; className?: string }) {
  if (mode === 'off') return null;
  const dot = <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--tag-fg)] dark:bg-[var(--tag-dk)]" />;
  if (mode === 'dot') {
    return (
      <span role="img" aria-label={tag.label} title={tag.title} style={tagVars(tag.palette)} className={cx('inline-flex h-5 shrink-0 items-center px-0.5', className)}>
        {dot}
      </span>
    );
  }
  return (
    <span
      title={tag.title}
      style={tagVars(tag.palette)}
      className={cx(
        'inline-flex h-5 max-w-[118px] shrink-0 items-center gap-1 rounded-[6px] bg-[var(--tag-bg)] px-[7px] text-[11px] font-semibold text-[var(--tag-fg)] dark:bg-[color-mix(in_srgb,var(--tag-dk)_16%,transparent)] dark:text-[var(--tag-dk)]',
        '@max-[340px]:bg-transparent @max-[340px]:px-0.5 dark:@max-[340px]:bg-transparent',
        className,
      )}
    >
      {dot}
      <span className="truncate @max-[340px]:sr-only">{tag.label}</span>
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
