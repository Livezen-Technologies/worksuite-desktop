import { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { errorMessage, isMac } from '../core/bridge';
import { text } from '../core/i18n';
import { useStore } from '../core/store';
import { useNow } from '../core/use-now';
import { Icon } from './Icon';
import { cx } from './ui';
import { ListRefreshController, PULL_THRESHOLD, checkedLabel, pullPrefs, type PullList, type RefreshItem, type RefreshSnapshot } from './listRefresh';

/**
 * Pull to refresh, the "↑ 3 new" pill and "Checked 2 min ago" for a list (worksuite-desktop#236): Mail, Team Chat,
 * WhatsApp and Website chats share it. Each list wires its own check and its own words.
 *
 *   const r = useListRefresh({ list: 'chat', check, items, view, words });
 *   <header>… {r.checked}</header>
 *   <div className="relative …">{r.indicator}{r.pill}<div ref={r.attach} …>{rows with {...r.rowProps(key)}}</div></div>
 *
 * The indicator sits above the scroller and grows with the pull, so the rows move down with it; with reduced motion
 * it is a fixed line whose words change, and new rows do not slide in. The status is announced politely.
 */

export interface ListRefreshWords {
  /** "Pull to check for new mail" */
  pull: string;
  /** "Release to check" */
  release: string;
  /** "Checking for new mail…" */
  checking: string;
  /** "3 new" */
  added: (n: number) => string;
  /** "Up to date · checked just now" */
  current: string;
  /** "3 new emails", on the pill. */
  pill: (n: number) => string;
}

export function refreshWords(what: 'mail' | 'messages'): ListRefreshWords {
  const mail = what === 'mail';
  return {
    pull: mail ? text('Pull to check for new mail') : text('Pull to check for new messages'),
    release: text('Release to check'),
    checking: mail ? text('Checking for new mail…') : text('Checking for new messages…'),
    added: (n) => text('{n} new', { n }),
    current: text('Up to date · checked just now'),
    pill: (n) => (mail ? (n === 1 ? text('1 new email') : text('{n} new emails', { n })) : n === 1 ? text('1 new conversation') : text('{n} new conversations', { n })),
  };
}

export interface ListRefreshOptions {
  /** Whose pull-to-refresh setting applies. */
  list: PullList;
  /** Check now: resolves when the new rows are on their way, throws to say it failed. */
  check: () => Promise<unknown> | unknown;
  /** The rows in the order shown, each with its key (and a stamp that moves when it changes). */
  items: readonly RefreshItem[];
  /** Which list this is: a different folder or filter starts over. */
  view: string;
  /** The rows have loaded (the first rows are not new). */
  ready?: boolean;
  words: ListRefreshWords;
  /** The words for a failure: "Couldn't check hasarinda@… ". */
  errorText?: (e: unknown) => string;
  /** When the list was last checked by anyone (a sync, a poll), ms: "Checked 2 min ago". */
  lastChecked?: number | null;
}

export interface ListRefresh {
  snap: RefreshSnapshot;
  /** The scroller's ref callback: listens to it for the pull and keeps the place in it. */
  attach: (el: HTMLElement | null) => (() => void) | undefined;
  checkNow: () => void;
  /** ⌘R / Ctrl+R or F5 on the list. */
  onKeyDown: (e: ReactKeyboardEvent) => void;
  /** Each row's attributes: its key, and whether it is new. */
  rowProps: (key: string) => { 'data-refresh-key': string; 'data-fresh'?: '' };
  /** A new row's highlight (and slide, with motion). */
  freshClass: (key: string) => string | undefined;
  indicator: ReactNode;
  pill: ReactNode;
  checked: ReactNode;
}

/** Is this F5, or ⌘R / Ctrl+R (no Shift, no Alt)? */
export function isCheckKey(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>, mac = isMac): boolean {
  if (e.key === 'F5') return !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  return mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'r';
}

const REDUCED = '(prefers-reduced-motion: reduce)';

function subscribeMotion(fn: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener?.('change', fn);
  return () => mq.removeEventListener?.('change', fn);
}

/** Reduced motion, kept current. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(REDUCED)?.matches === true);
}

export function useListRefresh(o: ListRefreshOptions): ListRefresh {
  const [c] = useState(() => new ListRefreshController());
  const snap = useSyncExternalStore(c.subscribe, c.get);
  const pullOn = useStore(pullPrefs, (s) => !s.off[o.list]);
  const reduced = useReducedMotion();
  const errorText = o.errorText ?? ((e: unknown) => errorMessage(e));
  const check = o.check;
  useEffect(() => {
    c.configure({ check, pull: pullOn, errorText });
  });
  // After every render, before paint: which rows are new, and the scroll position kept.
  const ready = o.ready ?? true;
  useLayoutEffect(() => {
    c.sync(o.items, o.view, ready);
  });
  useEffect(() => () => c.destroy(), [c]);
  const attach = useCallback((el: HTMLElement | null) => (el ? c.attach(el) : undefined), [c]);
  const checkNow = useCallback(() => void c.checkNow(), [c]);
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.defaultPrevented || !isCheckKey(e)) return;
    e.preventDefault();
    checkNow();
  };
  const rowProps = (key: string) => (snap.fresh.has(key) ? { 'data-refresh-key': key, 'data-fresh': '' as const } : { 'data-refresh-key': key });
  const freshClass = (key: string) => (snap.fresh.has(key) ? FRESH_CLASS : undefined);
  return {
    snap,
    attach,
    checkNow,
    onKeyDown,
    rowProps,
    freshClass,
    indicator: <PullIndicator snap={snap} words={o.words} reduced={reduced} onRetry={checkNow} onDismiss={() => c.dismiss()} />,
    pill: <NewItemsPill count={snap.atTop ? 0 : snap.unseen} label={o.words.pill} onClick={() => c.showNew(!reduced)} />,
    checked: <CheckedLine snap={snap} lastChecked={o.lastChecked ?? null} onCheck={checkNow} />,
  };
}

/** A new row: an accent edge while it is new, sliding in where motion is welcome. */
export const FRESH_CLASS = 'shadow-[inset_3px_0_0_var(--color-primary)] motion-safe:animate-[ws-fade-in_260ms_ease-out]';

/** The words the indicator shows in each state. */
export function indicatorText(snap: Pick<RefreshSnapshot, 'phase' | 'added' | 'error'>, words: ListRefreshWords): string {
  switch (snap.phase) {
    case 'pulling':
      return words.pull;
    case 'armed':
      return words.release;
    case 'checking':
      return words.checking;
    case 'new':
      return words.added(snap.added);
    case 'current':
      return words.current;
    case 'error':
      return snap.error ?? text('Couldn’t check');
    default:
      return '';
  }
}

/** The line that opens above the rows: ↓ Pull…, ↑ Release…, the spinner, "3 new", "Up to date", or the error. */
export function PullIndicator({ snap, words, reduced, onRetry, onDismiss }: { snap: RefreshSnapshot; words: ListRefreshWords; reduced: boolean; onRetry: () => void; onDismiss: () => void }) {
  const { phase } = snap;
  const open = phase !== 'idle';
  const pulling = phase === 'pulling' || phase === 'armed';
  // With motion, the line is as tall as the pull (the rows follow it down); without, a fixed line appears.
  const height = !open ? 0 : pulling && !reduced ? Math.min(snap.pull, PULL_THRESHOLD * 1.4) : 36;
  const said = phase === 'checking' || phase === 'new' || phase === 'current' || phase === 'error' ? indicatorText(snap, words) : '';
  const icon = phase === 'checking' ? 'spinner' : phase === 'new' || phase === 'current' ? 'check' : phase === 'error' ? 'warning' : 'arrow-down';
  return (
    <>
      <div
        data-pull-indicator={phase}
        aria-hidden={!open || undefined}
        style={{ height }}
        className={cx('flex shrink-0 items-end justify-center overflow-hidden text-[12.5px]', !pulling && !reduced && 'transition-[height] duration-200 ease-out', phase === 'error' ? 'text-danger' : phase === 'new' ? 'text-primary' : 'text-ink-3')}
      >
        {open ? (
          <span className="flex h-9 min-w-0 max-w-full items-center gap-1.5 px-3">
            <Icon
              name={icon}
              size={14}
              className={cx('shrink-0', phase === 'checking' && 'motion-safe:animate-spin', phase === 'armed' && 'rotate-180', pulling && !reduced && 'transition-transform duration-150')}
            />
            <span className="min-w-0 truncate font-semibold" data-pull-text>
              {indicatorText(snap, words)}
            </span>
            {phase === 'error' ? (
              <>
                <span aria-hidden>·</span>
                <button type="button" onClick={onRetry} className="shrink-0 font-semibold text-primary hover:underline">
                  {text('Retry')}
                </button>
                <button type="button" onClick={onDismiss} aria-label={text('Close')} className="shrink-0 rounded p-0.5 text-ink-3 hover:bg-subtle hover:text-ink">
                  <Icon name="x" size={12} />
                </button>
              </>
            ) : null}
          </span>
        ) : null}
      </div>
      {/* Polite, and no role="status": the lists have their own status lines, and this one only speaks on a check. */}
      <span aria-live="polite" aria-atomic="true" className="sr-only" data-pull-status>
        {said}
      </span>
    </>
  );
}

/** "↑ 3 new emails": over the rows while new ones came above the view. */
export function NewItemsPill({ count, label, onClick }: { count: number; label: (n: number) => string; onClick: () => void }) {
  if (count <= 0) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-[2] flex justify-center">
      <button
        type="button"
        data-new-pill
        onClick={onClick}
        aria-label={text('{label}: go to the top', { label: label(count) })}
        className="pointer-events-auto inline-flex h-7 items-center gap-1 rounded-full bg-primary px-3 text-[12.5px] font-semibold text-white shadow-md hover:bg-primary-hover motion-safe:animate-[ws-fade-in_160ms_ease-out]"
      >
        <Icon name="arrow-up" size={13} />
        {label(count)}
      </button>
    </div>
  );
}

/** "Checked 2 min ago" under the list's header, kept current; "Checking…" during a check. A click checks. */
export function CheckedLine({ snap, lastChecked, onCheck, className }: { snap: RefreshSnapshot; lastChecked: number | null; onCheck: () => void; className?: string }) {
  const now = useNow(15_000).getTime();
  const at = Math.max(snap.checkedAt ?? 0, lastChecked ?? 0) || null;
  const busy = snap.phase === 'checking';
  return (
    <button
      type="button"
      data-checked-line
      onClick={onCheck}
      aria-busy={busy || undefined}
      title={text('Check for new items now')}
      className={cx('inline-flex max-w-full items-center gap-1 truncate rounded-[6px] text-left text-[11.5px] text-ink-3 hover:text-ink', className)}
    >
      {busy ? text('Checking…') : checkedLabel(at, Math.max(now, at ?? 0))}
    </button>
  );
}
