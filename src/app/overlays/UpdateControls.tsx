import { useState, type ReactElement } from 'react';
import type { UpdateStatus } from '@shared/types';
import { LATER_LABELS, restartCheck, type LaterChoice } from '@shared/updates';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { restartToUpdate } from '../../core/update-restart';
import { Icon } from '../../components/Icon';
import { Button, Modal } from '../../components/ui';

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

/**
 * Restart to update, with the checks before it: the main process refuses while something would be interrupted and
 * says what; changes still to sync or a call in progress are then asked about ("3 changes waiting to sync. Restart
 * anyway?"). Drafts and tabs are saved by main before it restarts.
 */
export function useRestartToUpdate(onDone?: () => void): { start: () => Promise<void>; busy: boolean; dialog: ReactElement | null } {
  const [question, setQuestion] = useState<{ text: string; call: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const install = async (force: boolean) => {
    setQuestion(null);
    setBusy(true);
    try {
      const r = await restartToUpdate(force);
      if (r.started) {
        onDone?.();
        return;
      }
      const c = r.busy ? restartCheck(r.busy) : null;
      if (c?.question) setQuestion({ text: c.question, call: c.waiting.length ? c.callWarning : null });
      else if (r.message) toast('warning', r.message);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const go = () => install(true);
  const start = () => install(false);
  const dialog = question ? (
    <Modal
      title="Restart to update?"
      labelledBy="update-restart-confirm"
      onClose={() => setQuestion(null)}
      width={440}
      footer={
        <>
          <Button onClick={() => setQuestion(null)}>Not now</Button>
          <Button variant="primary" onClick={() => void go()}>
            Restart anyway
          </Button>
        </>
      }
    >
      <p className="text-[13.5px] text-ink">{question.text}</p>
      {question.call ? <p className="mt-2 text-[13px] font-semibold text-warning">{question.call}</p> : null}
      <p className="mt-3 text-[12.5px] text-ink-3">Your drafts and open tabs are saved and come back after the restart.</p>
    </Modal>
  ) : null;
  return { start, busy, dialog };
}

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
          {(Object.keys(LATER_LABELS) as LaterChoice[]).map((c) => (
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
