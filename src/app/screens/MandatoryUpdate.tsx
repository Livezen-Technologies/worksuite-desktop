import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { BusyReport, UpdateStatus } from '@shared/types';
import { countdown, durationLeft, mandatoryView, remindOptions, type LaterChoice } from '@shared/updates';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { bytes } from '../../core/time';
import { toast } from '../../core/toasts';
import { useNow } from '../../core/use-now';
import { Icon } from '../../components/Icon';
import { Menu } from '../../components/Menu';
import { Button, cx } from '../../components/ui';
import { useRestartToUpdate } from '../overlays/UpdateControls';
import { UpdatesPage, UpdateDiagnosticsPage } from '../../modules/settings/UpdatesPage';
import { LicensePage } from '../../modules/settings/LicensePage';

/**
 * A mandatory update (Updates & License design): the running version is below the policy's minimum, the release says
 * it is required, or the server refuses this version. Until the deadline (first known + the policy's
 * forced_update_deadline_hours) a banner says so with Remind Me Later and Update Now, and a countdown card shows in
 * the final hours. After the deadline — or at once when the server refuses this version — modules are locked.
 */

export function formatDeadline(d: Date): string {
  return d.toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

function targetVersion(u: UpdateStatus): string {
  return u.availableVersion ?? (u.minimumVersion ? `${u.minimumVersion} or newer` : 'a newer version');
}

/** Update Now: restart when it is ready, download when it is on offer, else check. */
function useUpdateNow(): { run: () => void; busy: boolean; dialog: ReactNode } {
  const u = useStore(app, (s) => s.update);
  const restart = useRestartToUpdate();
  const [working, setWorking] = useState(false);
  const run = () => {
    if (u?.state === 'STAGED') {
      void restart.start();
      return;
    }
    setWorking(true);
    const job = u?.availableVersion && (u.state === 'AVAILABLE' || u.state === 'FAILED') ? call('updates:download') : call('updates:check');
    void job
      .then((s) => s && app.set({ update: s }))
      .catch((e) => toast('error', errorMessage(e)))
      .finally(() => setWorking(false));
  };
  return { run, busy: working || restart.busy || u?.state === 'DOWNLOADING' || u?.state === 'CHECKING', dialog: restart.dialog };
}

/** Remind Me Later ▾: 1 hour, 4 hours, Tomorrow — greyed out past the deadline — and the deferrals left. */
function RemindMenu({ u, now }: { u: UpdateStatus; now: Date }) {
  const v = mandatoryView(u, now);
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const pick = (choice: LaterChoice) => {
    setOpen(false);
    void call('updates:later', { choice })
      .then((s) => app.set({ update: s }))
      .catch((e) => toast('error', errorMessage(e)));
  };
  const none = v.deferralsLeft <= 0;
  return (
    <>
      <span ref={anchor} className="inline-flex">
        <Button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          Remind Me Later <Icon name="chevron-down" size={14} />
        </Button>
      </span>
      {open ? (
        <Menu
          label="Remind me in"
          anchor={anchor}
          prefer="bottom"
          align="end"
          width={240}
          onClose={() => setOpen(false)}
          sections={[
            {
              id: 'when',
              label: 'Remind me in',
              items: remindOptions(now, v.deadline).map((o) => ({
                id: o.choice,
                label: o.label,
                disabled: o.pastDeadline || none,
                meta: o.pastDeadline ? 'past deadline' : undefined,
                onSelect: () => pick(o.choice),
              })),
            },
            { id: 'left', items: [{ id: 'deferrals', label: `${v.deferralsLeft} of ${v.maxDeferrals} deferrals left`, disabled: true }] },
          ]}
        />
      ) : null}
    </>
  );
}

/** The banner across the top while a required update's deadline has not passed. */
export function MandatoryBanner() {
  const u = useStore(app, (s) => s.update);
  const now = useNow(1000);
  const action = useUpdateNow();
  const v = mandatoryView(u, now);
  if (!u || !v.required || v.locked || !v.deadline || v.msLeft === null) return null;
  const snoozed = !!u.snoozedUntil;
  return (
    <>
      {snoozed ? null : (
        <div role="alert" className="flex items-center gap-3 border-b border-warning/30 bg-warning-bg px-4 py-2.5 text-[13px] text-ink">
          <Icon name="warning" size={18} className="shrink-0 text-warning" />
          <span className="min-w-0 flex-1">
            <strong>Update required within {durationLeft(v.msLeft)}.</strong> WorkSuite <span className="font-mono">{targetVersion(u)}</span> must be installed by{' '}
            <strong>{formatDeadline(v.deadline)}</strong>. After that, modules are locked until you update.
          </span>
          <RemindMenu u={u} now={now} />
          <Button variant="primary" loading={action.busy} onClick={action.run}>
            Update Now
          </Button>
        </div>
      )}
      {v.finalHours ? <CountdownCard u={u} msLeft={v.msLeft} onUpdate={action.run} busy={action.busy} /> : null}
      {action.dialog}
    </>
  );
}

function CountdownCard({ u, msLeft, onUpdate, busy }: { u: UpdateStatus; msLeft: number; onUpdate: () => void; busy: boolean }) {
  const notes = u.notes?.url ?? u.notesUrl;
  const size = u.release?.packageSize;
  return (
    <section aria-label="Mandatory update countdown" className="fixed right-5 bottom-5 z-40 w-[330px] rounded-[14px] bg-[var(--ws-navy)] p-4 text-white shadow-2xl">
      <div className="text-[11px] font-semibold tracking-wide text-[var(--ws-navy-ink)] uppercase">Mandatory update · final hours</div>
      <div className="mt-1 text-[13.5px]">WorkSuite must update in:</div>
      <div className="mt-1 font-mono text-[34px] font-bold tracking-wider" role="timer">
        {countdown(msLeft)}
      </div>
      <div className="text-[12px] text-[var(--ws-navy-ink)]">
        {u.state === 'STAGED' ? `Package downloaded and verified${size ? ` · ${bytes(size)}` : ''}` : u.state === 'DOWNLOADING' ? `Downloading… ${u.progress}%` : 'Not downloaded yet'}
      </div>
      <div className="mt-3 flex gap-2">
        {notes ? (
          <Button variant="ghost" size="sm" className="border-white/20 bg-white/10 text-white hover:bg-white/20" onClick={() => void call('app:openExternal', { url: notes })}>
            View release notes
          </Button>
        ) : null}
        <Button variant="primary" size="sm" loading={busy} onClick={onUpdate}>
          Update Now
        </Button>
      </div>
    </section>
  );
}

/** The title-bar chip while an update is required. */
export function MandatoryChip() {
  const u = useStore(app, (s) => s.update);
  const now = useNow(30_000);
  const v = mandatoryView(u, now);
  if (!v.required || v.locked) return null;
  return (
    <button type="button" onClick={() => navigate('/settings/updates')} className="no-drag flex h-7 items-center gap-1 rounded-full bg-amber px-3 text-[12px] font-semibold text-ink" title={v.msLeft !== null ? `Install within ${durationLeft(v.msLeft)}` : undefined}>
      <Icon name="warning" size={13} /> Update Required
    </button>
  );
}

/** Whether modules are locked by a required update right now. */
export function useModulesLocked(): boolean {
  const u = useStore(app, (s) => s.update);
  const now = useNow(u?.required ? 1000 : 60_000);
  return mandatoryView(u, now).locked;
}

type LockedView = 'main' | 'updates' | 'diagnostics' | 'license';

function savedLine(b: BusyReport | null): string | null {
  if (!b) return null;
  const drafts = b.drafts ? `${b.drafts} draft${b.drafts === 1 ? '' : 's'}` : null;
  const queued = b.pendingMutations ? `${b.pendingMutations} offline change${b.pendingMutations === 1 ? '' : 's'}` : null;
  const both = [drafts, queued].filter(Boolean).join(' and ');
  return both ? `Your ${both} ${b.drafts + b.pendingMutations === 1 ? 'is' : 'are'} saved and will sync after the update.` : 'Nothing is waiting to sync.';
}

/**
 * Modules locked: the deadline passed (or the server refuses this version). Only updating and what helps with it
 * stay available: Settings › Updates, its Diagnostics, License and Sign Out. Drafts and offline changes are kept.
 */
export function ModulesLocked() {
  const u = useStore(app, (s) => s.update);
  const [view, setView] = useState<LockedView>('main');
  const [busy, setBusy] = useState<BusyReport | null>(null);
  const [working, setWorking] = useState(false);
  const now = useNow(30_000);
  useEffect(() => {
    void call('updates:busy').then(setBusy, () => undefined);
    if (u && (u.state === 'IDLE' || u.state === 'FAILED')) void call('updates:check');
  }, [u?.state]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!u) return null;
  const v = mandatoryView(u, now);
  const m = u.mandatory;
  const install = async () => {
    setWorking(true);
    try {
      if (u.state === 'STAGED') {
        const r = await call('updates:installNow', { force: true });
        if (!r.started && r.message) toast('warning', r.message);
      } else {
        const s = await call(u.availableVersion && (u.state === 'AVAILABLE' || u.state === 'FAILED') ? 'updates:download' : 'updates:check');
        if (s) app.set({ update: s });
      }
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setWorking(false);
    }
  };
  const notes = u.notes?.url ?? u.notesUrl;
  const saved = savedLine(busy);
  const still: Array<{ id: LockedView | 'signout'; label: string; icon: string }> = [
    { id: 'updates', label: 'Update Center', icon: 'download' },
    { id: 'diagnostics', label: 'Diagnostics', icon: 'stethoscope' },
    { id: 'license', label: 'License', icon: 'lock' },
    { id: 'signout', label: 'Sign Out', icon: 'logout' },
  ];
  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-ground">
      <div className="flex h-11 shrink-0 items-center gap-2 bg-[var(--ws-navy)] px-4 text-white">
        <span className="text-[14px] font-bold">WorkSuite</span>
        <div className="flex-1" />
        <span className="rounded-full bg-danger px-3 py-0.5 text-[12px] font-semibold">Modules locked</span>
      </div>
      {view !== 'main' ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-10 py-6 scroll-thin">
          <Button icon="back" onClick={() => setView('main')}>
            Back
          </Button>
          <div className="mt-4 max-w-[980px]">
            {view === 'updates' ? <UpdatesPage /> : view === 'diagnostics' ? <UpdateDiagnosticsPage /> : <LicensePage />}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-6 overflow-y-auto p-6">
          <div className="w-[480px] rounded-[16px] border border-line bg-surface p-7 shadow-xl">
            <span className="flex h-12 w-12 items-center justify-center rounded-[12px] bg-warning-bg text-warning">
              <Icon name="warning" size={24} />
            </span>
            <h1 className="mt-4 text-[22px] font-bold text-ink">WorkSuite Update Required</h1>
            <p className="mt-1 text-[14px] text-ink-2">
              Version <span className="font-mono font-semibold">{targetVersion(u)}</span> must be installed to continue using WorkSuite Desktop.
              {m?.serverRejected ? ' The server no longer accepts this version.' : v.deadline ? ` The mandatory deadline passed on ${formatDeadline(v.deadline)}.` : ''}
            </p>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-[10px] bg-danger-bg p-3">
                <div className="text-[11px] font-semibold text-danger uppercase">Current</div>
                <div className="font-mono text-[16px] font-semibold text-ink">{u.currentVersion}</div>
              </div>
              <div className="rounded-[10px] bg-subtle p-3">
                <div className="text-[11px] font-semibold text-ink-3 uppercase">Required</div>
                <div className="font-mono text-[16px] font-semibold text-ink">{u.minimumVersion ? `≥ ${u.minimumVersion}` : '—'}</div>
              </div>
              <div className="rounded-[10px] bg-selection p-3">
                <div className="text-[11px] font-semibold text-primary uppercase">Latest</div>
                <div className="font-mono text-[16px] font-semibold text-ink">{u.availableVersion ?? (u.state === 'CHECKING' ? '…' : '—')}</div>
              </div>
            </div>
            {saved ? <div className="mt-4 rounded-[10px] bg-success/10 px-3 py-2.5 text-[13px] text-success">✓ {saved}</div> : null}
            {u.state === 'DOWNLOADING' ? <p className="mt-3 text-[12.5px] text-ink-3">Downloading… {u.progress}%</p> : null}
            {u.installBlockedReason ? <p className="mt-3 text-[12.5px] text-warning">{u.installBlockedReason}</p> : null}
            {u.error ? <p className="mt-3 text-[12.5px] text-danger">{u.error}</p> : null}
            <div className="mt-6 flex items-center gap-2">
              {notes ? <Button onClick={() => void call('app:openExternal', { url: notes })}>View Release Notes</Button> : null}
              <div className="flex-1" />
              <Button variant="primary" loading={working || u.state === 'DOWNLOADING' || u.state === 'CHECKING'} disabled={!!u.installBlockedReason} onClick={() => void install()}>
                {u.state === 'STAGED' ? 'Update & Restart' : u.availableVersion ? 'Download update' : 'Check for updates'}
              </Button>
            </div>
          </div>
          <aside className="w-[250px] rounded-[14px] border border-line bg-surface p-4" aria-label="Still available">
            <div className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Still available</div>
            <ul className="mt-2">
              {still.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[13.5px] text-ink hover:bg-subtle"
                    onClick={() => (s.id === 'signout' ? void call('auth:signOut', {}).catch((e) => toast('error', errorMessage(e))) : setView(s.id))}
                  >
                    <Icon name={s.icon} size={15} className="text-ink-3" /> {s.label}
                  </button>
                </li>
              ))}
            </ul>
            <p className={cx('mt-3 border-t border-line pt-3 text-[12px] text-ink-3')}>
              Mail, Chat, Files and other modules open again after the update.
              {m?.serverRejected ? (
                <>
                  {' '}
                  The server rejects this version on business APIs (<span className="font-mono">UPDATE_REQUIRED</span>).
                </>
              ) : null}
            </p>
          </aside>
        </div>
      )}
    </div>
  );
}
