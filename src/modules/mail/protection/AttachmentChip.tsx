import { text } from '../../../core/i18n';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/ui';
import { STATE_CHIP, type AttachmentAccess } from './verdicts';

/**
 * An attachment's scan, as a chip beside its name (P-UI-11, MPR-UX-02): Scanned (shield), Checking (spinner),
 * Blocked (lock, with the reason) and Not scanned (lock, with Scan now). Words and an icon on every state; never
 * "Scanned" for a file nobody checked.
 */
export function ScanChip({ access }: { access: AttachmentAccess }) {
  const [label, icon, tone] =
    access.status === 'scanned'
      ? [text('Scanned'), 'shield-check', STATE_CHIP.ok]
      : access.status === 'checking'
        ? [access.waitingOnline ? text('Checking when online') : text('Checking'), 'spinner', STATE_CHIP.muted]
        : access.status === 'blocked'
          ? [text('Blocked'), 'lock', STATE_CHIP.bad]
          : [text('Not scanned'), 'lock', STATE_CHIP.muted];
  return (
    <span data-scan={access.status} className={cx('inline-flex h-[20px] shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-bold whitespace-nowrap', tone)}>
      <Icon name={icon} size={11} className={access.status === 'checking' ? 'animate-spin-slow motion-reduce:animate-none' : undefined} />
      {label}
    </span>
  );
}

/**
 * A locked attachment (P-UI-11): its name and chip, why it is locked, and Scan now for one not scanned. There is
 * nothing to click to open, preview, download, save or drag — the row is not a button.
 */
export function LockedAttachment({ name, size, access, onScan, scanning, offline }: { name: string; size: string; access: AttachmentAccess; onScan?: () => void; scanning?: boolean; offline: boolean }) {
  return (
    <div data-locked-attachment={access.status} className="flex w-full max-w-[600px] items-center gap-3 rounded-[10px] border border-dashed border-line bg-subtle px-3 py-2 text-[13px]">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-surface text-ink-3">
        <Icon name="lock" size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-semibold text-ink-2">{name}</span>
          <ScanChip access={access} />
        </span>
        <span className={cx('block truncate text-[11.5px]', access.status === 'blocked' ? 'text-danger' : 'text-ink-3')}>
          {size} · {access.reason}
        </span>
      </span>
      {access.status === 'unscanned' && onScan ? (
        <button
          type="button"
          onClick={onScan}
          disabled={offline || scanning}
          title={offline ? text('Available when you are back online.') : undefined}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2.5 text-[12px] font-semibold text-ink hover:bg-ground disabled:opacity-50"
        >
          <Icon name={scanning ? 'spinner' : 'scan'} size={14} className={scanning ? 'animate-spin-slow' : undefined} />
          {text('Scan now')}
        </button>
      ) : null}
    </div>
  );
}
