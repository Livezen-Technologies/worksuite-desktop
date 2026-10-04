import { useState, type ReactElement } from 'react';
import type { BusyReport, UpdateStatus } from '@shared/types';
import { LATER_LABELS, REMIND_CHOICES, restartImpact, restartWaits, type LaterChoice, type RestartImpactRow } from '@shared/updates';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { restartToUpdate } from '../../core/update-restart';
import { navigate } from '../../core/tabs';
import { openOverlay } from '../../core/ui';
import { Icon } from '../../components/Icon';
import { Button, Chip, Modal, cx } from '../../components/ui';

/**
 * The update controls shared by the title-bar indicator, its panel, the security banner and the updates card
 * (worksuite-desktop#205): Restart to update with the question asked over work in progress, Later, and the
 * "Updated to X · What's new" notice shown once after the restart.
 */

/** Whether the "Update ready" pill shows: downloaded, not put off with Later, and nothing that must not be interrupted. */
export function pillVisible(u: UpdateStatus | null): boolean {
  return !!u && u.state === 'STAGED' && !u.required && !u.snoozedUntil && !u.quietReason;
}

/** One short line about the update: its summary, else its first highlight. */
export function summaryOf(u: UpdateStatus): string | null {
  return u.notes?.summary ?? u.notes?.highlights[0] ?? null;
}

const VERDICT: Record<RestartImpactRow['verdict'], { label: string; tone: 'danger' | 'warning' | 'success' }> = {
  blocks: { label: 'BLOCKS', tone: 'danger' },
  waits: { label: 'WAITS', tone: 'warning' },
  safe: { label: 'SAFE', tone: 'success' },
};
const ROW_ICON: Record<RestartImpactRow['id'], string> = { meeting: 'video', call: 'phone', share: 'screen-share', remote: 'screen-share', uploads: 'upload', downloads: 'download', drafts: 'mail', queue: 'refresh' };

/** A release type as a badge: RECOMMENDED, SECURITY, CRITICAL … (the Update Center's words). */
export function ReleaseBadge({ type }: { type: string | null | undefined }) {
  if (!type) return null;
  const tone = type === 'CRITICAL' || type === 'SECURITY' ? 'danger' : type === 'RECOMMENDED' ? 'teal' : 'muted';
  return <Chip tone={tone}>{type.toUpperCase()}</Chip>;
}

/**
 * WorkSuite Update Ready, with active work: what restarting now would affect, each marked BLOCKS (a call or meeting
 * would end), WAITS (a transfer still running) or SAFE (drafts and queued offline changes are kept). Only what the
 * app actually tracks is listed.
 */
export function UpdateReadyDialog({
  u,
  busy,
  onClose,
  onRestartNow,
  onLater,
  onWhenFree,
  onReview,
}: {
  u: UpdateStatus | null;
  busy: BusyReport;
  onClose: () => void;
  onRestartNow: () => void;
  onLater: () => void;
  onWhenFree: () => void;
  onReview: () => void;
}) {
  const rows = restartImpact(busy);
  const waits = restartWaits(rows);
  const blocksCall = rows.some((r) => r.id === 'meeting' || r.id === 'call');
  return (
    <Modal
      labelledBy="update-ready-title"
      onClose={onClose}
      width={520}
      footer={
        <>
          <Button onClick={onReview}>Review</Button>
          <div className="flex-1" />
          <Button onClick={onLater}>Restart Later</Button>
          {waits ? (
            <Button variant="primary" onClick={onWhenFree}>
              Restart when work finishes
            </Button>
          ) : (
            <Button variant="primary" onClick={onRestartNow}>
              Restart now
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-wrap gap-1.5">
        {u?.signatureVerified ? (
          <Chip tone="success">
            <Icon name="check" size={11} /> VERIFIED
          </Chip>
        ) : null}
        <ReleaseBadge type={u?.release?.releaseType} />
      </div>
      <h2 id="update-ready-title" className="mt-2 text-[18px] font-bold text-ink">
        WorkSuite Update Ready
      </h2>
      <p className="mt-1 text-[13.5px] text-ink-2">
        WorkSuite <span className="font-mono">{u?.availableVersion}</span> has been downloaded and verified.{' '}
        {waits ? 'You currently have active work — restarting now would interrupt it.' : 'Nothing will be lost by restarting now.'}
      </p>
      <ul className="mt-4 space-y-2" aria-label="What restarting affects">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 rounded-[10px] border border-line px-3 py-2.5">
            <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]', r.verdict === 'blocks' ? 'bg-danger-bg text-danger' : r.verdict === 'waits' ? 'bg-selection text-primary' : 'bg-subtle text-ink-2')}>
              <Icon name={ROW_ICON[r.id]} size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold text-ink">{r.title}</span>
              <span className="block truncate text-[12.5px] text-ink-3">{r.detail}</span>
            </span>
            <Chip tone={VERDICT[r.verdict].tone}>{VERDICT[r.verdict].label}</Chip>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12px] text-ink-3">
        {blocksCall ? 'WorkSuite reminds you again when the call ends. ' : ''}Nothing you are working on is deleted by an update.
      </p>
    </Modal>
  );
}

/**
 * Restart to update, with the checks before it: the main process refuses while something would be interrupted and
 * says what; the Update Ready dialog then lists it (BLOCKS / WAITS / SAFE) and offers Restart when work finishes,
 * Restart Later or Review. Drafts and tabs are saved by main before it restarts.
 */
export function useRestartToUpdate(onDone?: () => void): { start: () => Promise<void>; busy: boolean; dialog: ReactElement | null } {
  const u = useStore(app, (s) => s.update);
  const [report, setReport] = useState<BusyReport | null>(null);
  const [busy, setBusy] = useState(false);
  const install = async (force: boolean) => {
    setReport(null);
    setBusy(true);
    try {
      const r = await restartToUpdate(force);
      if (r.started) {
        onDone?.();
        return;
      }
      if (r.busy && restartImpact(r.busy).length) setReport(r.busy);
      else if (r.message) toast('warning', r.message);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const after = (p: Promise<UpdateStatus>, done?: string) => {
    setReport(null);
    void p
      .then((s) => {
        app.set({ update: s });
        if (done) toast('info', done);
        onDone?.();
      })
      .catch((e) => toast('error', errorMessage(e)));
  };
  const review = () => {
    const rows = report ? restartImpact(report) : [];
    setReport(null);
    onDone?.();
    if (rows.some((r) => r.id === 'meeting')) navigate('/meet');
    else if (rows.some((r) => r.id === 'uploads' || r.id === 'downloads')) openOverlay('transfers');
    else navigate('/settings/updates');
  };
  const dialog = report ? (
    <UpdateReadyDialog
      u={u}
      busy={report}
      onClose={() => setReport(null)}
      onRestartNow={() => void install(true)}
      onLater={() => after(call('updates:later', { choice: 'hour' }))}
      onWhenFree={() => after(call('updates:installWhenFree'), 'WorkSuite will restart to update when your work finishes.')}
      onReview={review}
    />
  ) : null;
  return { start: () => install(false), busy, dialog };
}

/** Later ▾: Remind me in 1 hour, 4 hours or tomorrow. */
export function LaterMenu({ onDone, compact }: { onDone?: () => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const later = (choice: LaterChoice) => {
    setOpen(false);
    void call('updates:later', { choice })
      .then((u) => {
        app.set({ update: u });
        if (u.installOnNextLaunch) toast('info', 'This security update will install the next time WorkSuite starts.');
      })
      .catch((e) => toast('error', errorMessage(e)));
    onDone?.();
  };
  return (
    <div className="relative">
      <Button size={compact ? 'sm' : undefined} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        Later <Icon name="chevron-down" size={14} />
      </Button>
      {open ? (
        <div role="menu" aria-label="Remind me" className="absolute right-0 z-50 mt-1 w-[190px] overflow-hidden rounded-[10px] border border-line bg-surface py-1 shadow-xl">
          <div className="px-3 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Remind me in</div>
          {REMIND_CHOICES.map((c) => (
            <button key={c} type="button" role="menuitem" onClick={() => later(c)} className="block w-full px-3 py-2 text-left text-[13px] text-ink hover:bg-subtle">
              {LATER_LABELS[c]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** "Updated to X · What's new", once after the restart; and a failed update that was rolled back. */
export function UpdateNotices() {
  const u = useStore(app, (s) => s.update);
  if (!u) return null;
  const dismiss = () => void call('updates:dismissNotice').then((s) => app.set({ update: s }), () => undefined);
  if (u.rollback) {
    return (
      <div role="alert" className="flex items-center gap-3 border-b border-line bg-warning-bg px-4 py-2 text-[13px] text-ink">
        <Icon name="warning" size={16} className="text-warning" />
        <span className="flex-1">{u.rollback.message}</span>
        <Button size="sm" variant="ghost" onClick={dismiss}>
          Dismiss
        </Button>
      </div>
    );
  }
  if (!u.justUpdated) return null;
  // With highlights to show, the What's New card says it (app/screens/UpdateDialogs) — or nothing, when turned off.
  if (u.justUpdatedNotes && (u.justUpdatedNotes.highlights.length || u.justUpdatedNotes.summary)) return null;
  const notes = u.justUpdated.notesUrl;
  return (
    <div role="status" className="flex items-center gap-3 border-b border-line bg-selection px-4 py-2 text-[13px] text-ink">
      <Icon name="check-circle" size={16} className="text-success" />
      <span className="flex-1">
        Updated to {u.justUpdated.version}
        {notes ? (
          <>
            {' · '}
            <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void call('app:openExternal', { url: notes })}>
              What&apos;s new
            </button>
          </>
        ) : null}
      </span>
      <Button size="sm" variant="ghost" aria-label="Dismiss" onClick={dismiss}>
        <Icon name="x" size={14} />
      </Button>
    </div>
  );
}
