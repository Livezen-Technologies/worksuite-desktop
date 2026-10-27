import type { OfflineReadModule } from '@shared/offline-reads';
import { OFFLINE_READ_MODULES } from '@shared/offline-reads';
import { useOfflineReadOnly } from '../core/offline-read';
import { stampDayLabel, timeLabel } from '../core/time';
import { Icon } from './Icon';

/**
 * The read-only banner of a module that reads offline from this computer's copy (audit D-G14): offline, what is
 * shown and as of when, and that changes wait for the connection. Nothing while online.
 */
export function OfflineReadOnlyBanner({ module, className }: { module: OfflineReadModule['module']; className?: string }) {
  const { readOnly, asOf } = useOfflineReadOnly(module);
  if (!readOnly) return null;
  const label = OFFLINE_READ_MODULES.find((m) => m.module === module)?.label ?? module;
  return (
    <div role="status" data-offline-readonly={module} className={`flex shrink-0 items-center gap-2 border-b border-warning-line bg-warning-bg px-5 py-1.5 text-[12px] font-semibold text-warning-ink ${className ?? ''}`}>
      <Icon name="cloud-off" size={14} className="shrink-0" />
      <span>
        {asOf ? `Offline · read-only. ${label} as of ${stampDayLabel(asOf, 'short')} ${timeLabel(asOf)}, from this computer's copy.` : `Offline · read-only. ${label} shows what this computer last read.`} Changes come back when WorkSuite is reachable.
      </span>
    </div>
  );
}
