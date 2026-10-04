import { useState } from 'react';
import type { UpdateStatus } from '@shared/types';
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
import { LaterMenu, pillVisible, summaryOf, useRestartToUpdate } from '../overlays/UpdateControls';

/**
 * A critical or security update that is ready (FR-UPD-04, worksuite-desktop#205): a stronger banner than the
 * "Update ready" pill, which ordinary updates use. Put off more than once, it installs when WorkSuite next starts.
 * It waits, like every update notice, while a meeting, call, screen share or remote control is going on.
 */
export function UpdateBanner() {
  const u = useStore(app, (s) => s.update);
  const restart = useRestartToUpdate();
  if (!u || u.state !== 'STAGED' || u.required || !u.security || u.snoozedUntil || u.quietReason) return restart.dialog;
  const when = u.deadline ? new Date(u.deadline).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : null;
  return (
    <div role="alert" className="flex items-center gap-3 border-b border-danger/30 bg-danger-bg px-4 py-2.5 text-[13px] text-ink">
      <Icon name="shield-alert" size={18} className="text-danger" />
      <span className="flex-1">
        <strong>Security update: WorkSuite {u.availableVersion} is ready.</strong> Restart to install it now.
        {u.installOnNextLaunch || (u.postponed ?? 0) >= 1 ? ' If you put it off again, it installs the next time WorkSuite starts.' : ''}
        {when ? ` It installs automatically by ${when}.` : ''}
      </span>
      <LaterMenu compact />
      <Button size="sm" variant="danger" loading={restart.busy} onClick={() => void restart.start()}>
        Restart to update
      </Button>
      {restart.dialog}
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
 * The one thing to do next about updates: Restart to update a downloaded version (asking first over work in
 * progress or a call, worksuite-desktop#205), Download one on offer, Try again after a failed download, or Check for
 * updates.
 */
export function UpdateActions({ size = 'md', onDone }: { size?: 'sm' | 'md'; onDone?: () => void }) {
  const u = useStore(app, (s) => s.update);
  const [working, setWorking] = useState(false);
  const restart = useRestartToUpdate(onDone);
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
  if (u?.state === 'STAGED') {
    return (
      <>
        <Button size={size} variant="primary" loading={restart.busy} onClick={() => void restart.start()}>
          Restart to update
        </Button>
        {restart.dialog}
      </>
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
      <Button size={size} variant="primary" icon="download" loading={working} onClick={() => void run(() => call('updates:download').then((s) => s && app.set({ update: s })))}>
        {u.state === 'FAILED' ? 'Try again' : 'Download'}
      </Button>
    );
  }
  return (
    <Button size={size} loading={working || u?.state === 'CHECKING'} onClick={() => void run(() => call('updates:check').then((s) => s && app.set({ update: s })))}>
      {u?.state === 'FAILED' ? 'Try again' : 'Check for updates'}
    </Button>
  );
}

/**
 * The one title-bar update indicator: a newer version on offer, on its way or ready. Ready, it becomes the
 * "Update ready" pill — unless it was put off with Later or a meeting, call, screen share or remote control is
 * going on, when it stays a quiet icon (worksuite-desktop#205).
 */
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
  if (ready && pillVisible(u)) {
    return (
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        onClick={() => openOverlay('update')}
        className={cx('no-drag flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold', u.security ? 'bg-[#F0A04B]/20 text-[#F7C68A] hover:bg-[#F0A04B]/30' : 'bg-[#43B581]/15 text-[#7EE2B0] hover:bg-[#43B581]/25', open && 'ring-1 ring-white/30')}
      >
        <Icon name={u.security ? 'shield-alert' : 'download'} size={14} /> Update ready
      </button>
    );
  }
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => openOverlay('update')}
      className={cx('no-drag relative flex h-8 w-8 items-center justify-center rounded-[8px] hover:bg-white/10', ready ? 'text-[#7EE2B0]' : 'text-navy-ink hover:text-white', open && 'bg-white/12 text-white')}
    >
      <Icon name="download" size={18} className={cx(moving && 'motion-safe:animate-pulse')} />
      {ready ? null : <span aria-hidden className={cx('absolute top-1 right-1 h-2 w-2 rounded-full ring-2 ring-navy', failed ? 'bg-[#F0A04B]' : 'bg-[#5B7CFA]')} />}
    </button>
  );
}

/** What the update indicator opens: the versions, where the new one stands, a short summary and its next step. */
export function UpdatePopover() {
  const u = useStore(app, (s) => s.update);
  const auto = useStore(app, (s) => s.prefs?.autoUpdate !== false);
  if (!updateShown(u)) return null;
  const title = u.state === 'STAGED' ? 'Update ready' : u.state === 'FAILED' ? 'Update did not download' : 'Update available';
  const summary = summaryOf(u);
  const notes = u.notes?.url ?? u.notesUrl;
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
            <div className="text-[12px] text-primary">New{u.critical || u.security ? ' · security update' : ''}</div>
            <div className="font-mono text-[15px] font-semibold text-primary">{u.availableVersion}</div>
          </div>
        </div>
        {u.state === 'DOWNLOADING' ? (
          <div role="progressbar" aria-label="Download" aria-valuenow={u.progress} aria-valuemin={0} aria-valuemax={100} className="h-1.5 overflow-hidden rounded-full bg-subtle">
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${u.progress}%` }} />
          </div>
        ) : null}
        <p className="text-[12.5px] text-ink-2">{u.state === 'FAILED' ? (u.error ?? 'The download did not finish.') : updateHint(u, auto)}</p>
        {summary ? <p className="text-[13px] text-ink">{summary}</p> : null}
        {u.quietReason && u.state === 'STAGED' ? <p className="text-[12.5px] text-ink-3">Reminders wait until {u.quietReason} ends.</p> : null}
        {u.deadline ? <p className="text-[12.5px] text-warning">It installs by itself by {new Date(u.deadline).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.</p> : null}
        {u.signatureVerified ? (
          <p className="flex items-center gap-1.5 text-[12px] text-ink-3">
            <Icon name="shield-check" size={14} className="text-success" /> Signed release
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-2 border-t border-line px-4 py-3">
        {notes ? (
          <button type="button" className="text-[13px] font-semibold text-primary hover:underline" onClick={() => void call('app:openExternal', { url: notes })}>
            What&apos;s new
          </button>
        ) : null}
        <button
          type="button"
          className="text-[13px] font-semibold text-ink-2 hover:underline"
          onClick={() => {
            closeOverlay();
            navigate('/settings/updates');
          }}
        >
          Update settings
        </button>
        <div className="flex-1" />
        {u.state === 'STAGED' ? <LaterMenu compact onDone={closeOverlay} /> : null}
        <UpdateActions size="sm" onDone={closeOverlay} />
      </div>
    </Popover>
  );
}
