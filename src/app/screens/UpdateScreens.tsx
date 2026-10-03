import { useEffect, useState } from 'react';
import type { BusyReport, UpdateStatus } from '@shared/types';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { closeOverlay, openOverlay, ui } from '../../core/ui';
import { Icon } from '../../components/Icon';
import { Button, cx } from '../../components/ui';
import { Popover, PopoverHeader } from '../overlays/Popover';

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

/** A newer version this person is told about: on offer, on its way, ready, or one whose download failed. */
export function updateShown(u: UpdateStatus | null): u is UpdateStatus & { availableVersion: string } {
  return !!u && !!u.availableVersion && !u.required && ['AVAILABLE', 'DOWNLOADING', 'VERIFIED', 'STAGED', 'FAILED'].includes(u.state);
}

/** One line on where updates stand (Settings › Desktop and About). */
export function updateHint(u: UpdateStatus | null, auto: boolean): string | undefined {
  if (!u) return undefined;
  const v = u.availableVersion;
  if (u.state === 'STAGED') return `Version ${v} is ready. Restart WorkSuite to install it.`;
  if (u.state === 'DOWNLOADING') return `Downloading ${v}… ${u.progress}%`;
  if (u.state === 'VERIFIED') return `Checking the download of ${v}…`;
  if (u.state === 'CHECKING') return 'Checking for updates…';
  if (u.state === 'AVAILABLE') return u.installBlockedReason ? `Version ${v} is available. ${u.installBlockedReason}` : auto ? `Version ${v} is available and downloads shortly.` : `Version ${v} is available. Download it when you are ready.`;
  return u.error ?? (u.lastCheckedAt ? `Up to date · checked ${relative(u.lastCheckedAt)}` : 'Not checked yet');
}

/**
 * The one thing to do next about updates: Restart to update a downloaded version (or Restart anyway over work in
 * progress), Download one on offer, Try again after a failed download, or Check for updates.
 */
export function UpdateActions({ size = 'md', onDone }: { size?: 'sm' | 'md'; onDone?: () => void }) {
  const u = useStore(app, (s) => s.update);
  const [working, setWorking] = useState(false);
  const [busy, setBusy] = useState<BusyReport | null>(null);
  const run = async (job: () => Promise<unknown>) => {
    setWorking(true);
    try {
      await job();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setWorking(false);
    }
  };
  const install = (force: boolean) =>
    run(async () => {
      const r = await call('updates:installNow', { force });
      if (r.started) return onDone?.();
      if (r.busy) {
        setBusy(r.busy);
        toast('warning', `WorkSuite is busy: ${busyLine(r.busy)}.`);
      } else if (r.message) toast('warning', r.message);
    });
  if (u?.state === 'STAGED') {
    return busy ? (
      <Button size={size} variant="primary" loading={working} onClick={() => void install(true)}>
        Restart anyway
      </Button>
    ) : (
      <Button size={size} variant="primary" loading={working} onClick={() => void install(false)}>
        Restart to update
      </Button>
    );
  }
  if (u && (u.state === 'DOWNLOADING' || u.state === 'VERIFIED')) {
    return (
      <Button size={size} loading>
        Downloading…
      </Button>
    );
  }
  if (u?.availableVersion && !u.installBlockedReason && (u.state === 'AVAILABLE' || u.state === 'FAILED')) {
    return (
      <Button size={size} variant="primary" icon="download" loading={working} onClick={() => void run(() => call('updates:download'))}>
        {u.state === 'FAILED' ? 'Try again' : 'Download'}
      </Button>
    );
  }
  return (
    <Button size={size} loading={working || u?.state === 'CHECKING'} onClick={() => void run(() => call('updates:check'))}>
      Check for updates
    </Button>
  );
}

/** The title-bar update icon: a newer version on offer, on its way or ready, with a dot until it is installed. */
export function UpdateIndicator() {
  const u = useStore(app, (s) => s.update);
  const open = useStore(ui, (s) => s.overlay === 'update');
  if (!updateShown(u)) return null;
  const ready = u.state === 'STAGED';
  const failed = u.state === 'FAILED';
  const moving = u.state === 'DOWNLOADING' || u.state === 'VERIFIED';
  const label = ready
    ? `Update ready: WorkSuite ${u.availableVersion}. Restart to install it.`
    : failed
      ? `The update to WorkSuite ${u.availableVersion} did not download.`
      : moving
        ? `Downloading WorkSuite ${u.availableVersion}… ${u.progress}%`
        : `Update available: WorkSuite ${u.availableVersion}`;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => openOverlay('update')}
      className={cx('no-drag relative flex h-8 w-8 items-center justify-center rounded-[8px] hover:bg-white/10', ready ? 'text-[#7EE2B0]' : 'text-navy-ink hover:text-white', open && 'bg-white/12 text-white')}
    >
      <Icon name="download" size={18} className={cx(moving && 'motion-safe:animate-pulse')} />
      <span aria-hidden className={cx('absolute top-1 right-1 h-2 w-2 rounded-full ring-2 ring-navy', ready ? 'bg-[#43B581]' : failed ? 'bg-[#F0A04B]' : 'bg-[#5B7CFA]')} />
    </button>
  );
}

/** What the update icon opens: the versions, where the new one stands, and its next step. */
export function UpdatePopover() {
  const u = useStore(app, (s) => s.update);
  const auto = useStore(app, (s) => s.prefs?.autoUpdate !== false);
  if (!updateShown(u)) return null;
  const title = u.state === 'STAGED' ? 'Update ready' : u.state === 'FAILED' ? 'Update did not download' : 'Update available';
  return (
    <Popover label={title} width={360} offset={150}>
      <PopoverHeader title={title} />
      <div className="space-y-3 px-4 py-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-[10px] bg-subtle p-3">
            <div className="text-[12px] text-ink-3">Installed</div>
            <div className="font-mono text-[15px] font-semibold text-ink">{u.currentVersion}</div>
          </div>
          <div className="rounded-[10px] bg-selection p-3">
            <div className="text-[12px] text-primary">New{u.critical ? ' · security update' : ''}</div>
            <div className="font-mono text-[15px] font-semibold text-primary">{u.availableVersion}</div>
          </div>
        </div>
        {u.state === 'DOWNLOADING' ? (
          <div role="progressbar" aria-label="Download" aria-valuenow={u.progress} aria-valuemin={0} aria-valuemax={100} className="h-1.5 overflow-hidden rounded-full bg-subtle">
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${u.progress}%` }} />
          </div>
        ) : null}
        <p className="text-[12.5px] text-ink-2">{u.state === 'FAILED' ? (u.error ?? 'The download did not finish.') : updateHint(u, auto)}</p>
        {u.deadline ? <p className="text-[12.5px] text-warning">It installs by itself by {new Date(u.deadline).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.</p> : null}
        {u.signatureVerified ? (
          <p className="flex items-center gap-1.5 text-[12px] text-ink-3">
            <Icon name="shield-check" size={14} className="text-success" /> Signed release
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-2 border-t border-line px-4 py-3">
        {u.notesUrl ? (
          <button type="button" className="text-[13px] font-semibold text-primary hover:underline" onClick={() => void call('app:openExternal', { url: u.notesUrl! })}>
            What's new
          </button>
        ) : null}
        <button
          type="button"
          className="text-[13px] font-semibold text-ink-2 hover:underline"
          onClick={() => {
            closeOverlay();
            navigate('/settings/desktop');
          }}
        >
          Update settings
        </button>
        <div className="flex-1" />
        {u.state === 'STAGED' ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void call('updates:restartLater');
              closeOverlay();
            }}
          >
            Later
          </Button>
        ) : null}
        <UpdateActions size="sm" onDone={closeOverlay} />
      </div>
    </Popover>
  );
}
