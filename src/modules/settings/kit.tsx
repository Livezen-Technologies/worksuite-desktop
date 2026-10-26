import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from 'react';
import { MANAGED_LABEL } from '@shared/desktop-settings';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';

/**
 * The Settings kit: one look for every settings screen (WorkSuite Desktop design system, Tailwind v4 tokens, light and
 * dark from the same classes). A screen is a `SectionHeader` and `SettingsGroup` cards of `SettingRow`s — label and
 * description on the start side, the control on the end side — with a `LockBadge` where the organisation decides and a
 * `ResetButton` where a choice can go back to its default. `RadioCards` are for a choice of a few that each need a line.
 *
 * Rows written before the kit (a run of `SettingRow`s straight under a header) are drawn as a card too: consecutive
 * loose rows join into one (styles.css, `[data-setting-row][data-loose]`).
 */

/** What the settings search is looking for; rows whose words match are marked and the first is brought into view. */
export const SettingsQuery = createContext('');

/** Whether a row's words match the settings search. */
export function matches(query: string, ...words: Array<ReactNode | undefined>): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return words.some((w) => typeof w === 'string' && w.toLowerCase().includes(q));
}

const InGroup = createContext(false);

export function SectionHeader({ title, hint, actions }: { title: string; hint?: ReactNode; actions?: ReactNode }) {
  return (
    <header data-settings-header className="mb-4 flex items-start gap-4 first:mt-0 [&:not(:first-child)]:mt-8">
      <div className="min-w-0 flex-1">
        <h2 className="text-[20px] leading-tight font-bold text-ink">{title}</h2>
        {hint ? <p className="mt-1 max-w-[640px] text-[13px] text-ink-3">{hint}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** A card of rows, with an optional title, description and actions at its top. */
export function SettingsGroup({ title, description, actions, children, className }: { title?: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section data-settings-group aria-label={title} className={cx('mb-5 overflow-hidden rounded-[14px] border border-line bg-surface shadow-[0_1px_2px_rgb(var(--ws-shadow-rgb)/0.04)]', className)}>
      {title || actions ? (
        <div className="flex items-start gap-3 border-b border-line px-[18px] pt-3.5 pb-3">
          <div className="min-w-0 flex-1">
            {title ? <h3 className="text-[14.5px] font-bold text-ink">{title}</h3> : null}
            {description ? <p className="mt-0.5 text-[12.5px] text-ink-3">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className="divide-y divide-line">
        <InGroup.Provider value>{children}</InGroup.Provider>
      </div>
    </section>
  );
}

/**
 * "Managed by your organization": a lock and the words, with why as its tooltip (the app's own tooltips draw `title`)
 * and as its accessible description.
 */
export function LockBadge({ reason, compact, describedBy }: { reason: string; compact?: boolean; describedBy?: string }) {
  const own = useId();
  const id = describedBy ?? own;
  return (
    <span
      data-lock-badge
      title={reason}
      aria-describedby={id}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-warning/25 bg-warning-bg px-2 py-px text-[11px] font-semibold text-warning-ink"
    >
      <Icon name="lock" size={11} />
      {compact ? <span className="sr-only">{MANAGED_LABEL}</span> : MANAGED_LABEL}
      {/* In a row the reason is written under the label already, and that line describes the badge. */}
      {describedBy ? null : (
        <span id={id} className="sr-only">
          {reason}
        </span>
      )}
    </span>
  );
}

/** Back to the default: shown only when there is something to reset. */
export function ResetButton({ onClick, disabled, label = 'Reset to default' }: { onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-ink-3 hover:bg-subtle hover:text-ink disabled:opacity-40"
    >
      <Icon name="undo" size={14} />
    </button>
  );
}

/** A small note of where a value comes from, when it is not the person's own choice. */
export function SourceNote({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center rounded-full bg-subtle px-2 py-px text-[11px] font-medium text-ink-3">{children}</span>;
}

/**
 * One setting: label, description and the control. `lock`: decided by the organisation — the badge, and the reason
 * under the description. `onReset`: offered beside the control. `keywords`: more words the search finds it by.
 */
export function SettingRow({
  label,
  hint,
  children,
  lock,
  onReset,
  badge,
  keywords,
  stacked,
}: {
  label: string;
  hint?: ReactNode;
  children?: ReactNode;
  lock?: { reason: string } | null;
  onReset?: (() => void) | null;
  badge?: ReactNode;
  keywords?: string;
  /** The control under the words rather than beside them (a wide control: radio cards, a list). */
  stacked?: boolean;
}) {
  const grouped = useContext(InGroup);
  const query = useContext(SettingsQuery);
  const hit = matches(query, label, typeof hint === 'string' ? hint : undefined, keywords);
  const ref = useRef<HTMLDivElement>(null);
  const reasonId = useId();
  useEffect(() => {
    if (!hit || !ref.current) return;
    // The first row the search found comes into view.
    const first = ref.current.closest('[data-settings-body]')?.querySelector('[data-setting-match]');
    if (first === ref.current) ref.current.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [hit]);
  return (
    <div
      ref={ref}
      data-setting-row
      data-loose={grouped ? undefined : ''}
      data-setting-match={hit ? '' : undefined}
      className={cx('px-[18px] py-3.5 transition-colors', stacked ? 'flex flex-col gap-3' : 'flex items-center gap-6', hit && 'bg-selection/60 ring-2 ring-primary/40 ring-inset')}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-ink">
          {label}
          {lock ? <LockBadge reason={lock.reason} describedBy={reasonId} /> : null}
          {badge}
        </div>
        {hint ? <div className="mt-0.5 text-[12.5px] text-ink-3">{hint}</div> : null}
        {lock ? (
          <div id={reasonId} className="mt-0.5 text-[12px] text-warning">
            {lock.reason}
          </div>
        ) : null}
      </div>
      {children !== undefined || onReset ? (
        // Never wider than 60%: a long value wraps instead of running over the label.
        <div className={cx('flex min-w-0 items-center gap-2 break-words', stacked ? 'w-full' : 'max-w-[60%] shrink-0')}>
          {children}
          {onReset && !lock ? <ResetButton onClick={onReset} /> : null}
        </div>
      ) : null}
    </div>
  );
}

export interface RadioCardOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  icon?: string;
}

/** A choice of a few, each a card with its icon and a line: a radio group, with arrow keys between the cards. */
export function RadioCards<T extends string>({ label, value, options, onChange, disabled, columns = 3 }: { label: string; value: T; options: ReadonlyArray<RadioCardOption<T>>; onChange: (v: T) => void; disabled?: boolean; columns?: 2 | 3 | 4 }) {
  const move = (from: number, by: number) => {
    const next = options[(from + by + options.length) % options.length];
    if (next) onChange(next.value);
  };
  return (
    <div role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} className={cx('grid w-full gap-2.5', columns === 2 ? 'sm:grid-cols-2' : columns === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3')}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            tabIndex={on || (!options.some((x) => x.value === value) && i === 0) ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                move(i, 1);
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                move(i, -1);
              }
            }}
            className={cx(
              'flex min-w-0 items-start gap-3 rounded-[12px] border p-3 text-start transition-colors disabled:cursor-not-allowed disabled:opacity-60',
              on ? 'border-primary bg-selection shadow-[0_0_0_1px_var(--ws-indigo)]' : 'border-line bg-surface hover:border-ink-3/40 hover:bg-subtle',
            )}
          >
            {o.icon ? (
              <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]', on ? 'bg-primary text-[color:var(--ws-on-primary)]' : 'bg-subtle text-ink-2')}>
                <Icon name={o.icon} size={16} />
              </span>
            ) : null}
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold text-ink">{o.label}</span>
              {o.description ? <span className="mt-0.5 block text-[12px] text-ink-3">{o.description}</span> : null}
            </span>
            <span aria-hidden className={cx('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', on ? 'border-primary bg-primary' : 'border-line bg-surface')}>
              {on ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The search box at the top of the Settings sections. */
export function SettingsSearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="relative mb-2 flex items-center">
      <span className="pointer-events-none absolute start-2.5 text-ink-3">
        <Icon name="search" size={14} />
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onChange('');
        }}
        placeholder="Search settings"
        aria-label="Search settings"
        className="h-8 w-full rounded-[8px] border border-line bg-ground ps-8 pe-2.5 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-primary focus:bg-surface"
      />
    </label>
  );
}
