import { useEffect, useState } from 'react';
import type { BusyReport } from '@shared/types';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui';

function busyLine(b: BusyReport | null): string {
  if (!b) return 'Checking…';
  const parts: string[] = [];
  if (b.uploads) parts.push(`${b.uploads} upload${b.uploads === 1 ? '' : 's'} finishing`);
  if (b.downloads) parts.push(`${b.downloads} download${b.downloads === 1 ? '' : 's'} in progress`);
  if (b.pendingMutations) parts.push(`${b.pendingMutations} change${b.pendingMutations === 1 ? '' : 's'} waiting to sync`);
  parts.push(b.drafts ? `${b.drafts} draft${b.drafts === 1 ? '' : 's'} saved` : 'no unsaved drafts');
  parts.push(b.activeCall ? 'a call in progress' : 'no active call');
  return parts.join(' · ');
}

/**
 * Update required (UI-19, FR-UPD-03/04, WF-26): a blocking window when this
 * version is below the organization's minimum. Only Update, Diagnostics and
 * Quit are available; drafts and offline changes are kept.
 */
export function UpdateRequired() {
  const u = useStore(app, (s) => s.update);
  const org = useStore(app, (s) => s.auth?.user?.organizationName);
  const [busy, setBusy] = useState<BusyReport | null>(null);
  const [working, setWorking] = useState(false);
  useEffect(() => {
    void call('updates:busy').then(setBusy, () => undefined);
    if (u && (u.state === 'IDLE' || u.state === 'FAILED')) void call('updates:check');
  }, [u]);
  if (!u) return null;
  const staged = u.state === 'STAGED';
  const install = async () => {
    setWorking(true);
    try {
      const r = await call('updates:installNow', { force: true });
      if (!r.started && r.message) toast('warning', r.message);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setWorking(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ground p-6">
      <div className="w-[560px] rounded-[16px] border border-line bg-surface p-8 shadow-xl">
        <div className="flex items-start gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[12px] bg-warning-bg text-warning">
            <Icon name="download" size={26} />
          </span>
          <div>
            <h1 className="text-[22px] font-bold text-ink">Update required</h1>
            <p className="text-[13.5px] text-ink-3">Security update · required by {org ?? 'your organization'}</p>
          </div>
        </div>
        <p className="mt-5 text-[14px] leading-relaxed text-ink-2">Your WorkSuite Desktop version is no longer supported. Update to keep using WorkSuite — your drafts and offline changes are kept.</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-[10px] bg-subtle p-3.5">
            <div className="text-[12.5px] text-ink-3">Installed</div>
            <div className="font-mono text-[17px] font-semibold text-ink">{u.currentVersion}</div>
          </div>
          <div className="rounded-[10px] bg-selection p-3.5">
            <div className="text-[12.5px] text-primary">New{u.minimumVersion ? ` · minimum ${u.minimumVersion}` : ''}</div>
            <div className="font-mono text-[17px] font-semibold text-primary">{u.availableVersion ?? (u.state === 'CHECKING' ? 'checking…' : '—')}</div>
          </div>
        </div>
        <div className="mt-4 rounded-[10px] border border-warning/30 bg-warning-bg p-3.5">
          <div className="text-[13px] font-semibold text-warning">Before restarting</div>
          <div className="mt-0.5 text-[13px] text-ink-2">{busyLine(busy)}</div>
        </div>
        {u.signatureVerified ? (
          <div className="mt-4 flex items-center gap-2 text-[13px] text-ink-2">
            <Icon name="shield-check" size={16} className="text-success" /> Signed release · SHA-256 verified
          </div>
        ) : null}
        {u.installBlockedReason ? <p className="mt-3 text-[12.5px] text-warning">{u.installBlockedReason}</p> : null}
        {u.error ? <p className="mt-3 text-[12.5px] text-danger">{u.error}</p> : null}
        {u.state === 'DOWNLOADING' ? <p className="mt-3 text-[12.5px] text-ink-3">Downloading… {u.progress}%</p> : null}
        <div className="mt-7 flex items-center gap-2">
          {u.notesUrl ? (
            <button type="button" className="text-[13px] font-semibold text-primary underline" onClick={() => void call('app:openExternal', { url: u.notesUrl! })}>
              What's new
            </button>
          ) : null}
          <div className="flex-1" />
          <Button onClick={() => navigate('/diagnostics')}>Diagnostics</Button>
          <Button onClick={() => void call('app:quit')}>Quit</Button>
          <Button variant="primary" loading={working} disabled={!staged} onClick={() => void install()}>
            Update &amp; restart
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Non-blocking banner for an update that is ready (FR-UPD-04). */
export function UpdateBanner() {
  const u = useStore(app, (s) => s.update);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyReport | null>(null);
  if (!u || u.state !== 'STAGED' || u.required || dismissed === u.availableVersion) return null;
  const install = async (force: boolean) => {
    const r = await call('updates:installNow', { force });
    if (!r.started && r.busy) setBusy(r.busy);
  };
  return (
    <div className="flex items-center gap-3 border-b border-line bg-selection px-4 py-2 text-[13px] text-ink">
      <Icon name="download" size={16} className="text-primary" />
      <span className="flex-1">
        WorkSuite {u.availableVersion} is ready.{u.deadline ? ` It installs automatically by ${new Date(u.deadline).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.` : ''}
        {busy ? <span className="ml-1 text-warning">WorkSuite is busy: {busyLine(busy)}.</span> : null}
      </span>
      {busy ? (
        <>
          <Button size="sm" onClick={() => navigate('/notifications')}>
            Review activity
          </Button>
          <Button size="sm" variant="primary" onClick={() => void install(true)}>
            Restart anyway
          </Button>
        </>
      ) : (
        <Button size="sm" variant="primary" onClick={() => void install(false)}>
          Restart to update
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          void call('updates:restartLater');
          setDismissed(u.availableVersion);
        }}
      >
        Later
      </Button>
    </div>
  );
}
