import { useEffect, useRef, useState, type ReactNode } from 'react';
import { text } from '../core/i18n';
import { Icon } from './Icon';
import { cx } from './ui';

/**
 * Every "Sync now" / "Sync all" button (worksuite-desktop#165): one component with four states.
 *
 * Ready ↻ "Sync all now" → Syncing ↻ spinning "Syncing…" (disabled; a second click does nothing) → Done ✓ green
 * "Synced just now" for two seconds, back to Ready → or Failed ⚠ red "Sync failed · Retry" (clickable). The icon
 * spins from the click, before the server answers. Every label sits in the same grid cell, so the button keeps
 * one width in every state. Screen readers hear "Syncing" and "Sync complete" (aria-busy and a polite live
 * region); with reduced motion the icon stays still and the label alone says it is syncing.
 *
 * The sync is either `onSync`'s promise, or — when something else runs it (Mail's runner, Drive's sync engine) —
 * `running`, with `failed` saying how the run ended.
 */
export type SyncState = 'ready' | 'syncing' | 'done' | 'failed';

export interface SyncButtonProps {
  onSync: () => unknown;
  /** Something else is syncing this now. */
  running?: boolean;
  /** How the last outside run ended: true shows the failed state when `running` goes false. */
  failed?: boolean;
  label?: string;
  syncingLabel?: string;
  doneLabel?: string;
  failedLabel?: string;
  disabled?: boolean;
  /** Why it cannot be used, as its tooltip. */
  reason?: string;
  /** A square icon button (sidebars, rows); the words go to its tooltip and accessible name. */
  iconOnly?: boolean;
  size?: 'sm' | 'md';
  variant?: 'secondary' | 'primary' | 'ghost';
  title?: string;
  className?: string;
  /** Shown beside it, e.g. "Last synced 2 min ago". */
  after?: ReactNode;
  'aria-keyshortcuts'?: string;
}

const DONE_MS = 2000;

/** Done (then back to Ready after two seconds) or Failed, said to screen readers too. */
function settleSync(ok: boolean, timer: { current: ReturnType<typeof setTimeout> | null }, setState: (s: SyncState) => void, setSaid: (s: string) => void) {
  if (timer.current) clearTimeout(timer.current);
  setState(ok ? 'done' : 'failed');
  setSaid(ok ? text('Sync complete') : text('Sync failed'));
  if (ok) timer.current = setTimeout(() => setState('ready'), DONE_MS);
}

export function SyncButton({
  onSync,
  running,
  failed,
  label = text('Sync now'),
  syncingLabel = text('Syncing…'),
  doneLabel = text('Synced just now'),
  failedLabel = text('Sync failed · Retry'),
  disabled,
  reason,
  iconOnly,
  size = 'md',
  variant = 'secondary',
  title,
  className,
  after,
  ...rest
}: SyncButtonProps) {
  const [state, setState] = useState<SyncState>(running ? 'syncing' : 'ready');
  const [said, setSaid] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const was = useRef(!!running);
  const mine = useRef(false);

  const settle = (ok: boolean) => settleSync(ok, timer, setState, setSaid);

  // Someone else's run: spin while it runs, then say how it ended.
  useEffect(() => {
    if (running && !was.current) {
      if (timer.current) clearTimeout(timer.current);
      setState('syncing');
      setSaid(text('Syncing'));
    } else if (!running && was.current && !mine.current) settleSync(!failed, timer, setState, setSaid);
    was.current = !!running;
  }, [running, failed]);

  useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);

  const busy = state === 'syncing' || !!running;
  const click = async () => {
    if (busy || disabled) return;
    if (timer.current) clearTimeout(timer.current);
    mine.current = true;
    setState('syncing');
    setSaid(text('Syncing'));
    try {
      await onSync();
      // An outside runner that is still going keeps the spinner; it settles when `running` ends.
      mine.current = false;
      if (!was.current) settle(true);
    } catch {
      mine.current = false;
      settle(false);
    }
  };

  const shown = busy ? 'syncing' : state;
  const words = { ready: label, syncing: syncingLabel, done: doneLabel, failed: failedLabel } as const;
  const icon = shown === 'done' ? 'check' : shown === 'failed' ? 'warning' : 'refresh';
  const tone = shown === 'done' ? 'text-success' : shown === 'failed' ? 'text-danger' : undefined;
  const base = cx(
    'ws-sync-button relative inline-flex shrink-0 items-center justify-center gap-1.5 font-semibold whitespace-nowrap transition-colors',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ws-focus)]',
    'disabled:opacity-50 aria-busy:cursor-progress',
    size === 'sm' ? 'h-7 rounded-[8px] text-[12px]' : 'h-8 rounded-[8px] text-[13px]',
    iconOnly ? (size === 'sm' ? 'w-7' : 'w-8') : 'px-3',
    variant === 'primary' ? 'border border-transparent bg-primary text-white hover:bg-primary-hover' : variant === 'ghost' ? 'border border-transparent text-ink-2 hover:bg-subtle hover:text-ink' : 'border border-line bg-surface text-ink hover:bg-subtle',
    shown === 'failed' && variant !== 'primary' && 'border-danger/40',
    className,
  );
  return (
    <>
      <button
        type="button"
        data-state={shown}
        aria-busy={busy || undefined}
        aria-label={iconOnly ? words[shown] : undefined}
        aria-keyshortcuts={rest['aria-keyshortcuts']}
        title={reason ?? title ?? (iconOnly ? words[shown] : undefined)}
        disabled={disabled}
        // Busy stays focusable and clickable — the click just does nothing — so focus is not lost mid-sync.
        onClick={() => void click()}
        className={base}
      >
        <Icon name={icon} size={size === 'sm' ? 14 : 16} className={cx('shrink-0', shown === 'syncing' && 'motion-safe:animate-spin', variant !== 'primary' && tone)} />
        {iconOnly ? null : (
          <span className="inline-grid text-left">
            {(['ready', 'syncing', 'done', 'failed'] as const).map((k) => (
              <span key={k} aria-hidden={k !== shown || undefined} className={cx('col-start-1 row-start-1', k !== shown && 'invisible', k === shown && variant !== 'primary' && tone)}>
                {words[k]}
              </span>
            ))}
          </span>
        )}
      </button>
      {after}
      <span role="status" aria-live="polite" className="sr-only">
        {said}
      </span>
    </>
  );
}

/**
 * The same states for a compact sync icon that keeps its own button (Mail's ↻ in the folder pane): spinning while
 * `running`, a green check for two seconds after a good run, red after a failed one (worksuite-desktop#165).
 */
export function useSyncFeedback(running: boolean, failed: boolean): { state: SyncState; icon: string; iconClass: string } {
  const [state, setState] = useState<SyncState>(running ? 'syncing' : 'ready');
  const [, setSaid] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const was = useRef(running);
  useEffect(() => {
    if (running && !was.current) {
      if (timer.current) clearTimeout(timer.current);
      setState('syncing');
    } else if (!running && was.current) settleSync(!failed, timer, setState, setSaid);
    was.current = running;
  }, [running, failed]);
  useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);
  const shown = running ? 'syncing' : state;
  return {
    state: shown,
    icon: shown === 'done' ? 'check' : shown === 'failed' ? 'warning' : 'refresh',
    iconClass: shown === 'syncing' ? 'motion-safe:animate-spin' : shown === 'done' ? 'text-success' : shown === 'failed' ? 'text-danger' : '',
  };
}
