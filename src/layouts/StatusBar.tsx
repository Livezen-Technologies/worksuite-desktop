import { app } from '../core/app-state';
import { call } from '../core/bridge';
import { t } from '../core/i18n';
import { useStore } from '../core/store';
import { openOverlay } from '../core/ui';
import { navigate } from '../core/tabs';
import { cx } from '../components/ui';
import type { SyncStatus } from '@shared/types';
import { useGuest } from '../core/session';
import { text } from '../core/i18n';

/** Status bar, 26 px (§4.12, FR-RT-01, FR-UPD-02): realtime, files, pending changes, version and channel. */
export function StatusBar() {
  const status = useStore(app, (s) => s.status);
  const info = useStore(app, (s) => s.info);
  const channel = useStore(app, (s) => s.prefs?.updateChannel ?? 'stable');
  const rt = status?.realtime;
  const rtText = rt === 'connected' ? t('status.realtime') : rt === 'disabled' ? t('status.realtimeOff') : status?.network === 'OFFLINE' ? t('shell.offline') : t('status.realtimeDown');
  const rtDot = rt === 'connected' || rt === 'disabled' ? 'bg-success' : status?.network === 'OFFLINE' ? 'bg-ink-3' : 'bg-warning';
  const pending = status?.pendingChanges ?? 0;
  const sync = useStore(app, (s) => s.sync);
  const files = filesLabel(sync);
  // Guest mode (#149): nothing syncs or waits for a server; everything is on this device.
  const guest = useGuest();
  if (guest)
    return (
      <footer className="flex h-[26px] shrink-0 items-center gap-5 border-t border-line bg-subtle px-4 text-[12px] text-ink-2">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-primary" />
          {text('Local profile')} · {text('Saved on this device')}
        </span>
        <div className="flex-1" />
        <span className="font-mono text-[11.5px]">
          v{info?.version ?? ''} · {channel.charAt(0).toUpperCase() + channel.slice(1)}
        </span>
      </footer>
    );
  return (
    <footer className="flex h-[26px] shrink-0 items-center gap-5 border-t border-line bg-subtle px-4 text-[12px] text-ink-2">
      <span className="flex items-center gap-1.5">
        <span className={cx('h-2 w-2 rounded-full', rtDot)} />
        {rtText}
      </span>
      {files.syncing ? (
        <button type="button" className="flex items-center gap-1.5 hover:text-ink hover:underline" onClick={() => navigate('/files?view=devices')}>
          {files.dot ? <span className={cx('h-2 w-2 rounded-full', files.dot)} /> : null}
          {files.text}
        </button>
      ) : (
        <span>{files.text}</span>
      )}
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

/** "Files:" in the status bar — online only, or what Drive sync on this computer is doing. */
function filesLabel(s: SyncStatus | null): { text: string; syncing: boolean; dot: string | null } {
  if (!s || !s.available || !s.folders.length) return { text: 'Files: online', syncing: false, dot: null };
  const pending = s.folders.reduce((n, f) => n + f.pending.up + f.pending.down, 0);
  switch (s.state) {
    case 'syncing':
      return { text: pending ? `Files: syncing ${pending.toLocaleString()}` : 'Files: syncing', syncing: true, dot: 'bg-primary' };
    case 'paused':
      return { text: 'Files: sync paused', syncing: true, dot: 'bg-ink-3' };
    case 'offline':
      return { text: 'Files: waiting for the server', syncing: true, dot: 'bg-ink-3' };
    case 'error':
    case 'disconnected':
    case 'blocked':
      return { text: 'Files: sync needs attention', syncing: true, dot: 'bg-warning' };
    default:
      return { text: s.folders.some((f) => f.heldDeletions) ? 'Files: sync needs attention' : 'Files: up to date', syncing: true, dot: s.folders.some((f) => f.heldDeletions) ? 'bg-warning' : 'bg-success' };
  }
}
