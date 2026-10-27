import { useConnection } from '../core/connection';
import { Icon } from './Icon';
import { cx } from './ui';

/**
 * A small line where a weak connection matters (worksuite-desktop#254): over the website chat composer and in the
 * Meet call bar, while connection strength is Poor or Offline. Nothing otherwise.
 */
export function ConnectionWarning({ className, tone = 'light' }: { className?: string; tone?: 'light' | 'dark' }) {
  const s = useConnection();
  if (s.level !== 'poor' && s.level !== 'offline') return null;
  const words = s.level === 'offline' ? 'Offline — messages send when you are back online' : 'Weak connection — messages may be delayed';
  return (
    <div
      role="status"
      data-testid="connection-warning"
      data-level={s.level}
      className={cx(
        'flex items-center gap-1.5 text-[12px] font-medium',
        tone === 'dark' ? 'rounded-full bg-stage-gray-2 px-2 py-0.5 text-[11.5px] font-semibold text-stage-warning' : 'border-t border-line bg-warning-bg px-3.5 py-1 text-warning-ink',
        className,
      )}
    >
      <Icon name="warning" size={13} className="shrink-0" />
      {words}
    </div>
  );
}
