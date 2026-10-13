import type { MouseEvent } from 'react';
import { text } from '../../core/i18n';
import { BulkBar as Bar, BulkButton } from '../chat/BulkBar';
import { ticketCount, type BarCaps, type BulkProgress } from './bulk';

/** The bar's buttons that open one part of the right-click menu. */
export type BarPart = 'status' | 'priority' | 'assign' | 'more';

/**
 * The ticket list's bulk bar (worksuite-desktop#333, FR-WSP-04): over the list while any ticket is picked — how many,
 * then Status, Assign, Priority (each the right-click menu's part on its own), Tag, Merge for two or more, Snooze, and
 * ⋯ for the rest of the menu (Follow, Copy, Delete…). Only what the person may do to every ticket picked is there
 * (`barCaps`, the menu's own rule).
 *
 * Under it: with every loaded ticket picked and more matching, "Select all 128 tickets in Resolved" (the server's ids,
 * `matchingIds`); with only some picked, "Select all 50 tickets loaded"; and a batched change's progress.
 */
export function BulkBar({
  count,
  may,
  loaded,
  all,
  more,
  matching,
  matchingLabel,
  progress,
  onMenu,
  onTag,
  onMerge,
  onSnooze,
  onSelectAll,
  onSelectAllMatching,
  onClear,
}: {
  /** How many are picked. */
  count: number;
  may: BarCaps;
  /** How many tickets the list has loaded. */
  loaded: number;
  /** Every loaded ticket is picked. */
  all: boolean;
  /** More tickets match the view than are loaded. */
  more: boolean;
  /** How many match, once "Select all matching" has picked them; else null. */
  matching: number | null;
  /** "Select all 128 tickets in Resolved", or "Select all matching tickets" under a search. */
  matchingLabel: string;
  progress: BulkProgress | null;
  onMenu: (part: BarPart, e: MouseEvent<HTMLButtonElement>) => void;
  onTag: () => void;
  onMerge: () => void;
  onSnooze: () => void;
  onSelectAll: () => void;
  onSelectAllMatching: () => void;
  onClear: () => void;
}) {
  const at = (part: BarPart) => (e: MouseEvent<HTMLButtonElement>) => onMenu(part, e);
  return (
    <div className="flex flex-col gap-1.5">
      <Bar count={count} onClear={onClear} label={text('Bulk actions')}>
        {may.status ? (
          <BulkButton menu onClick={at('status')}>
            {text('Status')}
          </BulkButton>
        ) : null}
        {may.assign ? (
          <BulkButton menu aria-keyshortcuts="A" onClick={at('assign')}>
            {text('Assign')}
          </BulkButton>
        ) : null}
        {may.priority ? (
          <BulkButton menu aria-keyshortcuts="P" onClick={at('priority')}>
            {text('Priority')}
          </BulkButton>
        ) : null}
        {may.tag ? (
          <BulkButton menu onClick={onTag}>
            {text('Tag')}
          </BulkButton>
        ) : null}
        {may.merge ? <BulkButton onClick={onMerge}>{text('Merge')}</BulkButton> : null}
        {may.snooze ? <BulkButton onClick={onSnooze}>{text('Snooze')}</BulkButton> : null}
        <BulkButton aria-label={text('More actions')} title={text('More actions')} onClick={at('more')}>
          ⋯
        </BulkButton>
      </Bar>
      {all && more && matching === null ? (
        <p className="text-[12px] text-ink-2">
          {text('All {n} on this page selected.', { n: loaded })}{' '}
          <button type="button" className="font-semibold text-primary hover:underline" onClick={onSelectAllMatching}>
            {matchingLabel}
          </button>
        </p>
      ) : matching !== null ? (
        <p className="text-[12px] text-ink-2">{text('All {count} matching selected.', { count: ticketCount(count) })}</p>
      ) : !all && count > 0 && loaded > count ? (
        <p className="text-[12px] text-ink-2">
          <button type="button" aria-keyshortcuts="Control+A Meta+A" className="font-semibold text-primary hover:underline" onClick={onSelectAll}>
            {text('Select all {count} loaded', { count: ticketCount(loaded) })}
          </button>
        </p>
      ) : null}
      {progress ? (
        <div role="progressbar" aria-label={text('Changing tickets')} aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} className="h-1 overflow-hidden rounded-full bg-subtle">
          <div className="h-full bg-primary transition-[width]" style={{ width: `${(100 * progress.done) / Math.max(1, progress.total)}%` }} />
        </div>
      ) : null}
    </div>
  );
}
