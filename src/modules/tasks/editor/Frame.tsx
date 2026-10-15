import { useEffect, useState, type ReactNode } from 'react';
import { ApiError } from '../../../core/api';
import { errorMessage } from '../../../core/bridge';
import { toast } from '../../../core/toasts';
import { ErrorNote, Spinner, cx } from '../../../components/ui';

/**
 * The task editor's frame (Projects SRS v1.2 §14.2): a centred modal over a dimmed backdrop, its header — where the
 * task is, Saving…/Saved, the composition's actions and × — and two columns, the task on the left and its settings
 * on the right. Esc closes it unless a dialog of its own is open over it; a click on the backdrop closes it too.
 *
 * The Tasks app fills it with its own parts (TaskDetail); Projects with the same parts and the project's fields
 * (ProjectTaskModal). What goes in the header and the columns is theirs.
 */
export function TaskEditorFrame({
  label = 'Task details',
  maxWidth = 1100,
  crumb,
  saving,
  saved,
  idle = 'Changes save as you make them',
  actions,
  banner,
  loading,
  error,
  onRetry,
  onClose,
  main,
  side,
  children,
}: {
  label?: string;
  /** The modal's widest, in px (max 860 tall). */
  maxWidth?: number;
  /** Where the task is: "Tasks › TASK-12", "PRJ-0003 · Video › TSK-0064" and its chips. */
  crumb: ReactNode;
  /** Whether a change is on its way, and whether one has been saved since it opened. Null hides the indicator. */
  saving: boolean | null;
  saved: boolean;
  idle?: string;
  /** Header buttons between the indicator and ×. */
  actions?: ReactNode;
  /** A line under the header (offline, a queued change). */
  banner?: ReactNode;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onClose: () => void;
  /** The left column and the right one (null while there is nothing to show). */
  main: ReactNode;
  side: ReactNode;
  /** Dialogs over the editor. */
  children?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="no-drag fixed inset-0 z-40 flex items-center justify-center bg-[#0B1020]/45 p-5" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label={label} className="flex h-full max-h-[860px] w-full flex-col overflow-hidden rounded-[14px] border border-line bg-surface text-[13px] shadow-2xl" style={{ maxWidth }}>
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-3">
          {crumb}
          <span className="flex-1" />
          {saving !== null ? (
            <span role="status" className={cx('text-[12px] font-semibold', saving ? 'text-ink-3' : 'text-success')}>
              {saving ? 'Saving…' : saved ? 'Saved' : idle}
            </span>
          ) : null}
          {actions}
          <button type="button" aria-label="Close" title="Close (Esc)" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[16px] text-ink-2 hover:bg-subtle">
            ×
          </button>
        </div>
        {banner}
        {loading ? <Spinner /> : null}
        {error ? (
          <div className="p-6">
            {error instanceof ApiError && error.status === 404 ? <p className="text-ink-2">This task is not there, or it is not yours to open.</p> : <ErrorNote error={error} onRetry={onRetry} />}
          </div>
        ) : null}
        {main ? (
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_330px]">
            <div className="flex min-h-0 flex-col gap-3.5 overflow-y-auto px-[22px] py-[18px] scroll-thin">{main}</div>
            <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-l border-line bg-ground px-[18px] py-[18px] scroll-thin" aria-label="Task settings">
              {side}
            </aside>
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/**
 * Saving…/Saved for the frame: `run` wraps one change; a refusal is said in a toast, and `after` (the refresh) runs
 * either way.
 */
export function useSaving(after: () => void): { saving: boolean; saved: boolean; run: (fn: () => Promise<unknown>) => Promise<boolean> } {
  const [count, setCount] = useState(0);
  const [saved, setSaved] = useState(false);
  const run = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setCount((n) => n + 1);
    try {
      await fn();
      setSaved(true);
      return true;
    } catch (e) {
      toast('error', errorMessage(e));
      return false;
    } finally {
      setCount((n) => n - 1);
      after();
    }
  };
  return { saving: count > 0, saved, run };
}
