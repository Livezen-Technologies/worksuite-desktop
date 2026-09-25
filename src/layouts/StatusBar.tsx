import { app } from '../core/app-state';
import { call } from '../core/bridge';
import { t } from '../core/i18n';
import { useStore } from '../core/store';
import { openOverlay } from '../core/ui';
import { cx } from '../components/ui';

/** Status bar, 26 px (§4.12, FR-RT-01, FR-UPD-02): realtime, files, pending changes, version and channel. */
export function StatusBar() {
  const status = useStore(app, (s) => s.status);
  const info = useStore(app, (s) => s.info);
  const channel = useStore(app, (s) => s.prefs?.updateChannel ?? 'stable');
  const rt = status?.realtime;
  const rtText = rt === 'connected' ? t('status.realtime') : rt === 'disabled' ? t('status.realtimeOff') : status?.network === 'OFFLINE' ? t('shell.offline') : t('status.realtimeDown');
  const rtDot = rt === 'connected' || rt === 'disabled' ? 'bg-success' : status?.network === 'OFFLINE' ? 'bg-ink-3' : 'bg-warning';
  const pending = status?.pendingChanges ?? 0;
  return (
    <footer className="flex h-[26px] shrink-0 items-center gap-5 border-t border-line bg-subtle px-4 text-[12px] text-ink-2">
      <span className="flex items-center gap-1.5">
        <span className={cx('h-2 w-2 rounded-full', rtDot)} />
        {rtText}
      </span>
      <span>Files: online</span>
      <button type="button" className="hover:text-ink hover:underline" onClick={() => openOverlay('network')}>
        {pending > 0 ? t('status.pending', { n: pending }) : t('status.noPending')}
      </button>
      {status?.safeMode ? (
        <button type="button" className="font-semibold text-warning hover:underline" onClick={() => void call('diagnostics:restartSafeMode', { safe: false })}>
          Safe Mode — restart normally
        </button>
      ) : null}
      <div className="flex-1" />
      <span className="font-mono text-[11.5px]">
        v{info?.version ?? ''} · {channel.charAt(0).toUpperCase() + channel.slice(1)}
      </span>
    </footer>
  );
}
