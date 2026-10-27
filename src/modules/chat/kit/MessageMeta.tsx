import { timeLabel } from '../../../core/time';
import { text } from '../../../core/i18n';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/ui';
import type { KitMessage } from './model';

/**
 * Sent, delivered or read (C-02, LIVE-08, LIVE-12): one tick, two, two in blue. The same ticks in Team Chat and in a
 * website chat; what they mean is in their label ("Read by 3", "Read by the visitor").
 */
export function MessageStatus({ receipt, label, size = 13, className }: { receipt: 'sent' | 'delivered' | 'read'; label?: string; size?: number; className?: string }) {
  return (
    <Icon
      name={receipt === 'sent' ? 'check' : 'check-check'}
      size={size}
      className={cx('shrink-0', receipt === 'read' ? 'text-blue dark:text-indigo-bright' : 'text-ink-3', className)}
      label={label ?? (receipt === 'read' ? text('Read') : receipt === 'delivered' ? text('Delivered') : text('Sent'))}
    />
  );
}

/**
 * A message's time, edited, starred and ticks. `inline` sits inside a bubble at its end (the chat drawer, a record
 * card's footer); otherwise it is the small line under the bubble.
 */
export function MessageMeta({ m, inline = false, showTime = true }: { m: KitMessage; inline?: boolean; showTime?: boolean }) {
  const r = m.receipt;
  if (inline) {
    return (
      <span className="ml-auto inline-flex shrink-0 items-center gap-1 self-end pt-1 pl-1 text-[10.5px] leading-none whitespace-nowrap text-ink-3">
        {m.starred ? <Icon name="star" size={10} className="text-amber-strong" label="Starred" /> : null}
        {m.edited ? 'edited · ' : ''}
        {timeLabel(m.at)}
        {r ? <MessageStatus receipt={r} label={m.receiptLabel} /> : null}
      </span>
    );
  }
  const words = [showTime ? timeLabel(m.at) : null, m.edited ? 'edited' : null, m.starred ? '★ starred' : null].filter(Boolean).join(' · ');
  if (!words && !r) return null;
  return (
    <span data-meta className="inline-flex items-center gap-1 text-[11.5px] text-ink-3">
      {words}
      {r ? <MessageStatus receipt={r} label={m.receiptLabel} /> : null}
    </span>
  );
}
