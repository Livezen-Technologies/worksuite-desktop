import { useEffect, useState, type ReactNode } from 'react';
import type { Platform, UpdateStatus } from '@shared/types';
import { minutesSeconds } from '@shared/updates';
import { app, updatePrefs } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { bytes } from '../../core/time';
import { toast } from '../../core/toasts';
import { useNow } from '../../core/use-now';
import { Checkbox } from '../../components/Checkbox';
import { Icon } from '../../components/Icon';
import { Button, Chip, Modal } from '../../components/ui';
import { LaterMenu, ReleaseBadge, useRestartToUpdate } from '../overlays/UpdateControls';

/**
 * The update dialogs that come to the person (Updates & License design): Update available (when downloads wait for
 * them), the Critical Security Update modal with its grace period, and "What's New in X" once after updating.
 */

const PLATFORM_LABEL: Record<Platform, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };

/** "Windows x64 · EXE · 320 MB". */
export function packageLine(u: UpdateStatus, platform: Platform | undefined, arch: string | undefined): string {
  const r = u.release;
  return [platform ? `${PLATFORM_LABEL[platform]}${arch ? ` ${arch}` : ''}` : null, r?.packageType ? r.packageType.toUpperCase() : null, r?.packageSize ? bytes(r.packageSize) : null].filter(Boolean).join(' · ');
}

function channelWord(u: UpdateStatus): string {
  return (u.release?.channel ?? u.channel).toUpperCase();
}

/** WorkSuite Update Available: what's new, the package, and Download & Install or Later. */
export function UpdateAvailableDialog({ u, onClose, onInstalled, actions }: { u: UpdateStatus; onClose: () => void; onInstalled: (installOnRestart: boolean) => void; actions?: ReactNode }) {
  const info = useStore(app, (s) => s.info);
  const [background, setBackground] = useState(true);
  const notes = u.notes;
  const line = packageLine(u, info?.platform, info?.arch);
  return (
    <Modal
      labelledBy="update-available-title"
      onClose={onClose}
      width={540}
      footer={actions ?? (
        <>
          <LaterMenu onDone={onClose} />
          <span className="whitespace-nowrap text-[12px] text-ink-3">Remind: 1 hour · 4 hours · Tomorrow</span>
          <div className="flex-1" />
          <Button variant="primary" onClick={() => onInstalled(background)}>
            Download &amp; Install
          </Button>
        </>
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-selection text-primary">
          <Icon name="download" size={20} />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap gap-1.5">
            <ReleaseBadge type={u.release?.releaseType} />
            <Chip>{channelWord(u)}</Chip>
          </div>
          <h2 id="update-available-title" className="mt-1.5 text-[18px] font-bold text-ink">
            WorkSuite Update Available
          </h2>
          <p className="text-[13px] text-ink-2">
            Version <span className="font-mono font-semibold">{u.availableVersion}</span>
            {u.release?.buildNumber ? ` · build ${u.release.buildNumber}` : ''} · you have <span className="font-mono">{u.currentVersion}</span>
          </p>
        </div>
      </div>
      {notes?.highlights.length ? (
        <section className="mt-4" aria-label="What's new">
          <h3 className="text-[11.5px] font-semibold tracking-wide text-ink-3 uppercase">What&apos;s new</h3>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[13.5px] text-ink">
            {notes.highlights.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </section>
      ) : notes?.summary ? (
        <p className="mt-4 text-[13.5px] text-ink">{notes.summary}</p>
      ) : null}
      <div className="mt-4 flex items-center gap-3 rounded-[10px] border border-line bg-subtle px-3 py-2.5">
        <div className="min-w-0 flex-1 text-[12.5px]">
          {line ? <div className="font-semibold text-ink">{line}</div> : null}
          {u.release?.publisher ? <div className="text-ink-3">Signed by {u.release.publisher}</div> : u.signatureVerified ? <div className="text-ink-3">Signed release</div> : null}
        </div>
        {notes?.url ? (
          <button type="button" className="text-[12.5px] font-semibold text-primary underline" onClick={() => void call('app:openExternal', { url: notes.url! })}>
            View release notes
          </button>
        ) : null}
      </div>
      {!actions ? <label className="mt-3 flex items-center gap-2 text-[13px] text-ink">
        <Checkbox checked={background} onChange={(e) => setBackground(e.target.checked)} />
        Download in the background and install when I restart
      </label> : null}
    </Modal>
  );
}

/** Manual check result: explicit install, a reminder, or one of the supported installation schedules. */
export function ManualUpdateDialog({ u, onClose }: { u: UpdateStatus; onClose: () => void }) {
  const [scheduling, setScheduling] = useState(false);
  const [working, setWorking] = useState(false);
  const restart = useRestartToUpdate(onClose);
  const run = async (action: 'now' | 'later' | 'free' | 'quit') => {
    setWorking(true);
    try {
      if (action === 'later') {
        app.set({ update: await call('updates:later', { choice: 'hour' }) });
        toast('info', 'We’ll remind you in one hour. Your existing automatic installation preferences still apply.');
        onClose();
        return;
      }
      const ready = u.state === 'STAGED' ? u : await call('updates:download');
      if (ready) app.set({ update: ready });
      if (ready?.state !== 'STAGED') {
        toast('warning', ready?.error ?? 'The update is not ready yet. Check its download status in Settings.');
        return;
      }
      if (action === 'now') {
        await restart.start();
      } else if (action === 'free') {
        app.set({ update: await call('updates:installWhenFree') });
        toast('info', 'WorkSuite will restart to update when your work finishes.');
        onClose();
      } else {
        await updatePrefs({ updateInstallOnQuit: true });
        if (!app.get().prefs?.updateInstallOnQuit) throw new Error('Your organization does not allow installation on quit.');
        toast('info', 'WorkSuite will install this and future downloaded updates when you quit.');
        onClose();
      }
    } catch (error) {
      toast('error', errorMessage(error));
    } finally {
      setWorking(false);
    }
  };
  // While the busy-work confirmation is open, show only that dialog (one focus trap).
  if (restart.dialog) return restart.dialog;
  return <UpdateAvailableDialog u={u} onClose={() => { if (!working) onClose(); }} onInstalled={() => undefined} actions={
    <div className="w-full space-y-3">
      {scheduling ? <>
        <p className="text-[13px] text-ink-2">Your work is saved before restarting. “When work finishes” restarts immediately if nothing is active. Installation on quit also applies to future updates.</p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={working} onClick={() => setScheduling(false)}>Back</Button>
          <Button disabled={working} onClick={() => void run('quit')}>When I quit WorkSuite</Button>
          <Button variant="primary" loading={working} onClick={() => void run('free')}>When work finishes</Button>
        </div>
      </> : <>
        <p className="text-[12px] text-ink-3">Update now installs and restarts WorkSuite. Update later reminds you in one hour.</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button disabled={working} onClick={() => void run('later')}>Update later</Button>
          <Button disabled={working} onClick={() => setScheduling(true)}>Schedule</Button>
          <Button variant="primary" loading={working || restart.busy} onClick={() => void run('now')}>Update now</Button>
        </div>
      </>}
    </div>
  } />;
}

/** The update dialog opens by itself once per version and run, when downloads wait for the person. */
export function shouldOfferUpdate(u: UpdateStatus | null, autoUpdate: boolean): boolean {
  return !!u && u.state === 'AVAILABLE' && !autoUpdate && !!u.availableVersion && u.installSupported && !u.installBlockedReason && !u.snoozedUntil && !u.quietReason && !u.required && !u.downgrade && !u.critical;
}

/**
 * Critical Security Update: everything was saved, and WorkSuite installs when the grace period ends (the release's
 * `grace_minutes`). A call or meeting ends then too, which it says with the time left.
 */
export function CriticalUpdateModal({ u, onInstall, installing }: { u: UpdateStatus; onInstall: () => void; installing: boolean }) {
  const now = useNow(1000);
  const im = u.immediate!;
  const left = Math.max(0, Date.parse(im.graceEndsAt) - now.getTime());
  const s = im.saved;
  const ends = u.quietReason ? `${u.quietReason.charAt(0).toUpperCase()}${u.quietReason.slice(1)} will end in` : 'WorkSuite restarts in';
  return (
    <Modal labelledBy="critical-update-title" width={440} footer={<Button variant="danger" loading={installing} onClick={onInstall}>Update &amp; Restart</Button>}>
      <div className="-mx-5 -mt-4 mb-4 flex items-center gap-2.5 rounded-t-[14px] bg-danger px-5 py-3.5 text-white">
        <Icon name="shield-alert" size={20} />
        <h2 id="critical-update-title" className="text-[17px] font-bold">
          Critical Security Update
        </h2>
      </div>
      <p className="text-[14px] text-ink">
        WorkSuite Desktop must be updated immediately to <span className="font-mono font-semibold">{im.version}</span>.
      </p>
      <ul className="mt-3 space-y-1 rounded-[10px] bg-subtle px-3.5 py-3 text-[13px] text-ink-2" aria-label="Saved before the update">
        {s ? (
          <>
            {s.flushed ? <li>✓ Drafts and open tabs saved</li> : null}
            {s.pendingMutations ? <li>✓ {s.pendingMutations} offline change{s.pendingMutations === 1 ? '' : 's'} kept in the offline queue</li> : null}
            {s.drafts ? <li>✓ {s.drafts} draft{s.drafts === 1 ? '' : 's'} saved</li> : null}
          </>
        ) : (
          <li>Saving your work…</li>
        )}
        <li className={u.quietReason ? 'font-semibold text-warning' : undefined}>
          <span aria-hidden>● </span>
          {ends} <span className="font-mono">{minutesSeconds(left)}</span>
        </li>
      </ul>
      <p className="mt-3 text-[12px] text-ink-3">
        Grace: {im.graceMinutes} minute{im.graceMinutes === 1 ? '' : 's'} (release policy)
      </p>
    </Modal>
  );
}

/** ✓ Update completed successfully · What's New in X — once after updating, unless turned off in Settings › Updates. */
export function WhatsNewCard({ u, onClose }: { u: UpdateStatus; onClose: () => void }) {
  const j = u.justUpdated!;
  const n = u.justUpdatedNotes!;
  return (
    <Modal
      labelledBy="whats-new-title"
      onClose={onClose}
      width={460}
      footer={
        <>
          {j.notesUrl ? <Button onClick={() => void call('app:openExternal', { url: j.notesUrl! })}>View Release Notes</Button> : null}
          <div className="flex-1" />
          <Button variant="primary" onClick={onClose}>
            Got It
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-1.5 text-[11.5px] font-semibold tracking-wide text-success uppercase">
        <Icon name="check" size={13} /> Update completed successfully
      </div>
      <h2 id="whats-new-title" className="mt-1 text-[18px] font-bold text-ink">
        What&apos;s New in WorkSuite {j.version}
      </h2>
      <p className="text-[12.5px] text-ink-3">Shown once.</p>
      {n.summary && n.summary !== n.highlights[0] ? <p className="mt-3 text-[13.5px] text-ink">{n.summary}</p> : null}
      <ul className="mt-3 space-y-2">
        {n.highlights.map((h) => (
          <li key={h} className="flex items-center gap-3 rounded-[10px] bg-subtle px-3 py-2.5 text-[13.5px] text-ink">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-selection text-primary">
              <Icon name="sparkles" size={14} />
            </span>
            {h}
          </li>
        ))}
      </ul>
      <ul className="mt-3 space-y-0.5 text-[12px] text-ink-3" aria-label="After the update">
        {n.schema ? (
          <li>
            ✓ Local database updated (schema {n.schema.from} → {n.schema.to})
          </li>
        ) : null}
        <li>✓ Health check passed: WorkSuite started normally</li>
      </ul>
    </Modal>
  );
}

/** Whether the What's New card shows: just updated, with something to say, and not turned off. */
export function whatsNewShown(u: UpdateStatus | null, showPref: boolean | undefined): boolean {
  return !!u?.justUpdated && !!u.justUpdatedNotes && (u.justUpdatedNotes.highlights.length > 0 || !!u.justUpdatedNotes.summary) && showPref !== false;
}

/** The host for all three, in the main window's shell. */
export function UpdateDialogs() {
  const u = useStore(app, (s) => s.update);
  const prefs = useStore(app, (s) => s.prefs);
  const manual = useStore(app, (s) => s.manualUpdateCheck);
  const auto = prefs?.autoUpdate !== false;
  const [closed, setClosed] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const restart = useRestartToUpdate();
  const offer = !manual && shouldOfferUpdate(u, auto) && closed !== u?.availableVersion;

  const dismissNotice = () => void call('updates:dismissNotice').then((s) => app.set({ update: s }), () => undefined);
  // Turned off: the notice is still dismissed, so it is not waiting for the next time it is turned on.
  useEffect(() => {
    if (u?.justUpdated && u.justUpdatedNotes && prefs && prefs.updateShowWhatsNew === false) dismissNotice();
  }, [u?.justUpdated, u?.justUpdatedNotes, prefs]);

  const installNow = async () => {
    setInstalling(true);
    try {
      const r = await call('updates:installNow', { force: true });
      if (!r.started && r.message) toast('warning', r.message);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setInstalling(false);
    }
  };

  if (u?.immediate && (u.state === 'STAGED' || u.state === 'INSTALLING')) return <CriticalUpdateModal u={u} installing={installing || u.state === 'INSTALLING'} onInstall={() => void installNow()} />;
  if (u && whatsNewShown(u, prefs?.updateShowWhatsNew)) return <WhatsNewCard u={u} onClose={dismissNotice} />;
  if (manual === 'offer' && u && !u.required && !u.critical && !u.immediate) return <ManualUpdateDialog u={u} onClose={() => {
    setClosed(u.availableVersion);
    app.set({ manualUpdateCheck: null });
  }} />;
  return (
    <>
      {offer && u ? (
        <UpdateAvailableDialog
          u={u}
          onClose={() => setClosed(u.availableVersion)}
          onInstalled={(background) => {
            setClosed(u.availableVersion);
            if (background && prefs?.updateInstallOnQuit === false) void updatePrefs({ updateInstallOnQuit: true }).catch(() => undefined);
            void call('updates:download')
              .then((s) => {
                if (!s) return;
                app.set({ update: s });
                // Without "install when I restart": once it is ready, restart (asking over work in progress).
                if (!background && s.state === 'STAGED') void restart.start();
              })
              .catch((e) => toast('error', errorMessage(e)));
          }}
        />
      ) : null}
      {restart.dialog}
    </>
  );
}
