import { useRef, useState } from 'react';
import { text } from '../../core/i18n';
import { Icon } from '../../components/Icon';
import { Menu } from '../../components/Menu';
import { cx } from '../../components/ui';
import { useOverflow } from './editor/overflow';

/**
 * A row of filter chips that never wraps into overlapping rows or past its panel's edge (worksuite-desktop#428).
 * The row is measured (a ResizeObserver, through `useOverflow`): chips that do not fit go, from the end, into a
 * "More filters" menu, which says how many of them are on. Used by every folder's quick filters and the shared
 * mailbox's assignment filters.
 */

export interface FilterChip {
  id: string;
  label: string;
}

/** The chips that show and those that go into More filters, given how many fit; and how many hidden ones are on. */
export function splitChips<T extends FilterChip>(chips: T[], fit: number, on: (id: string) => boolean): { shown: T[]; hidden: T[]; hiddenOn: number } {
  const n = Math.max(0, Math.min(fit, chips.length));
  const hidden = chips.slice(n);
  return { shown: chips.slice(0, n), hidden, hiddenOn: hidden.filter((c) => on(c.id)).length };
}

/** "More filters", with the number of its filters that are on. */
export function moreLabel(hiddenOn: number): string {
  return hiddenOn ? text('More filters ({n})', { n: hiddenOn }) : text('More filters');
}

export function FilterChips<T extends FilterChip>({ chips, isOn, onToggle, label, tone = 'primary', className }: { chips: T[]; isOn: (id: string) => boolean; onToggle: (id: string) => void; label: string; tone?: 'primary' | 'ink'; className?: string }) {
  const row = useRef<HTMLDivElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // Room for the More filters button (≈ 112 px) once something does not fit; 6 px between chips.
  const fit = useOverflow(row, chips.map((c) => c.id), { moreWidth: 112, gap: 6 });
  const { shown, hidden, hiddenOn } = splitChips(chips, fit, isOn);
  const chipClass = (on: boolean) =>
    cx(
      'inline-flex h-[26px] shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-[12.5px] font-semibold',
      on ? (tone === 'ink' ? 'border-ink bg-ink text-surface' : 'border-primary bg-primary text-white') : 'border-line text-ink hover:bg-subtle',
    );
  return (
    <div ref={row} role="group" aria-label={label} data-filter-row className={cx('flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-hidden', className)}>
      {shown.map((c) => {
        const on = isOn(c.id);
        return (
          <button key={c.id} type="button" data-ov={c.id} data-chip={c.id} aria-pressed={on} onClick={() => onToggle(c.id)} className={chipClass(on)}>
            {on ? <Icon name="check" size={12} /> : null}
            {c.label}
          </button>
        );
      })}
      {hidden.length ? (
        <button ref={moreBtn} type="button" data-more-filters aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} className={cx(chipClass(hiddenOn > 0), open && 'bg-subtle')}>
          {moreLabel(hiddenOn)}
          <Icon name="chevron-down" size={12} />
        </button>
      ) : null}
      {open && hidden.length ? (
        <Menu
          label={text('More filters')}
          anchor={moreBtn}
          align="start"
          width={220}
          onClose={() => setOpen(false)}
          sections={[{ id: 'more', items: hidden.map((c) => ({ id: c.id, label: c.label, checked: isOn(c.id), onSelect: () => onToggle(c.id), onToggle: () => onToggle(c.id) })) }]}
        />
      ) : null}
    </div>
  );
}
