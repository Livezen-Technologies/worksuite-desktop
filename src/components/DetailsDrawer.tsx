import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { app } from '../core/app-state';
import { isMac } from '../core/bridge';
import { text } from '../core/i18n';
import { useStore } from '../core/store';
import { recallSection, rememberSection } from './Collapsible';
import { Icon } from './Icon';
import { ResizeDivider, useResizableWidth } from './ResizeDivider';
import { cx } from './ui';

/**
 * The details drawer on the right of a record (worksuite-desktop#334): a ticket's details, a website chat's visitor.
 * One component, so every place that has one behaves the same:
 *
 *  - its width is set by dragging its inner edge, or with ← → (Shift for more), Home and End on that edge; it is kept
 *    between a minimum and a maximum that leaves the content beside it room, and remembered for the signed-in person
 *    on this computer;
 *  - it is shown and hidden by its handle, its strip, a header button (`DrawerToggle`) and ⌘⇧I / Ctrl+Shift+I while
 *    its tab is in front, and remembers which for that person; on a window narrower than `wideAt` it opens over the
 *    content instead, only when asked, and Esc or a click beside it closes it;
 *  - its sections (`DrawerSection`) open and close one by one, remembered the same way.
 *
 * Only view preferences are kept, never data; storage that cannot be read gives the defaults.
 */

/** The card and heading look of the drawer's sections (Website chats' visitor panel first had it). */
export const DRAWER_CARD = 'flex flex-col gap-[7px] rounded-[12px] border border-line bg-surface px-3 py-2.5';
export const DRAWER_HEADING = 'text-[10.5px] font-bold tracking-[0.6px] text-ink-3 uppercase';

export const DRAWER_MIN = 280;
export const DRAWER_MAX = 520;
export const DRAWER_DEFAULT = 320;
/** The content beside the drawer keeps at least this much of the window. */
const ROOM = 560;

export const DRAWER_SHORTCUT_LABEL = isMac ? '⌘⇧I' : 'Ctrl+Shift+I';
export const DRAWER_SHORTCUT_ARIA = isMac ? 'Meta+Shift+I' : 'Control+Shift+I';

/** ⌘⇧I on a Mac, Ctrl+Shift+I elsewhere — and nothing else held. */
export function isDrawerShortcut(e: Pick<KeyboardEvent, 'key' | 'code' | 'shiftKey' | 'altKey' | 'metaKey' | 'ctrlKey'>, mac = isMac): boolean {
  if (!e.shiftKey || e.altKey) return false;
  if (mac ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey) return false;
  return e.key.toLowerCase() === 'i' || e.code === 'KeyI';
}

/** What the person last chose where the drawer sits beside the content: kept, so a drawer they closed stays closed. */
export type DrawerChoice = 'open' | 'closed' | null;

/**
 * Whether the drawer shows, and how: beside the content from `wideAt` (open unless the person closed it), over it on
 * a narrower window (only once asked for, this time).
 */
export function drawerState(width: number, wideAt: number, choice: DrawerChoice, askedNarrow: boolean): { open: boolean; overlay: boolean } {
  if (width >= wideAt) return { open: choice !== 'closed', overlay: false };
  return { open: askedNarrow, overlay: true };
}

/** The most the drawer may take in a window this wide: its maximum, or less, so the content keeps its room. */
export function drawerMax(windowWidth: number, min = DRAWER_MIN, max = DRAWER_MAX): number {
  return Math.max(min, Math.min(max, windowWidth - ROOM));
}

/** A width kept between the drawer's limits, for a window this wide. */
export function clampDrawerWidth(w: number, windowWidth: number, min = DRAWER_MIN, max = DRAWER_MAX): number {
  return Math.round(Math.min(drawerMax(windowWidth, min, max), Math.max(min, w)));
}

const who = (uid: string) => uid || 'anyone';
export const drawerChoiceKey = (id: string, uid: string) => `ws.drawer.${id}.${who(uid)}`;
export const drawerWidthKey = (id: string, uid: string) => `ws.width.drawer.${id}.${who(uid)}`;

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, v: string | null): void {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    // A view preference: the default comes back next time.
  }
}

/** The person's choice, or the one kept before choices were per person (`legacy`: 'open'/'closed' or '1'/'0'). */
export function readDrawerChoice(id: string, uid: string, legacy?: string): DrawerChoice {
  const v = readStored(drawerChoiceKey(id, uid)) ?? (legacy ? readStored(legacy) : null);
  return v === 'open' || v === '1' ? 'open' : v === 'closed' || v === '0' ? 'closed' : null;
}

/** The window's width, as it changes. */
function useWindowWidth(): number {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth));
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

export interface DrawerOptions {
  /** From this window width it sits beside the content and opens by itself; below it, over the content on request. */
  wideAt?: number;
  /** Whether its tab is in front: only then does ⌘⇧I answer. */
  active?: boolean;
  /** Where the choice was kept before it was kept per person, read when this person has none yet. */
  legacyKey?: string;
}

/** Whether a drawer shows and how, remembered for the signed-in person, and toggled with ⌘⇧I while `active`. */
export function useDrawer(id: string, { wideAt = 0, active = true, legacyKey }: DrawerOptions = {}) {
  const uid = useStore(app, (s) => s.auth?.user?.id ?? '');
  const width = useWindowWidth();
  const [choice, setChoice] = useState<DrawerChoice>(() => readDrawerChoice(id, uid, legacyKey));
  // Another person signed in on this computer: their own choice.
  const [forUid, setForUid] = useState(uid);
  if (forUid !== uid) {
    setForUid(uid);
    setChoice(readDrawerChoice(id, uid, legacyKey));
  }
  const [askedNarrow, setAskedNarrow] = useState(false);
  const { open, overlay } = drawerState(width, wideAt, choice, askedNarrow);
  const setOpen = useCallback(
    (next: boolean) => {
      if (overlay) return setAskedNarrow(next);
      const v: DrawerChoice = next ? 'open' : 'closed';
      writeStored(drawerChoiceKey(id, uid), v);
      setChoice(v);
    },
    [id, overlay, uid],
  );
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !isDrawerShortcut(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(!open);
    };
    // Captured, before the shell's own keys: only the drawer of the tab in front answers.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, open, setOpen]);
  const panelId = `drawer-${id.replace(/\W+/g, '-')}`;
  return { id, panelId, uid, open, overlay, setOpen, toggle: () => setOpen(!open) };
}

export type Drawer = ReturnType<typeof useDrawer>;

/** The header's panel button: shows and hides the drawer, and says the shortcut. */
export function DrawerToggle({ drawer, label, className }: { drawer: Drawer; /** "the ticket details" */ label: string; className?: string }) {
  const words = drawer.open ? text('Hide {what}', { what: label }) : text('Show {what}', { what: label });
  return (
    <button
      type="button"
      aria-label={words}
      title={`${words} (${DRAWER_SHORTCUT_LABEL})`}
      aria-expanded={drawer.open}
      aria-controls={drawer.open ? drawer.panelId : undefined}
      aria-keyshortcuts={DRAWER_SHORTCUT_ARIA}
      onClick={drawer.toggle}
      className={cx('inline-flex h-8 w-8 items-center justify-center rounded-[8px] transition-colors', drawer.open ? 'bg-selection text-primary' : 'text-ink-2 hover:bg-subtle hover:text-ink', className)}
    >
      <Icon name={drawer.open ? 'panel-right-close' : 'panel-right-open'} size={17} />
    </button>
  );
}

/** Moves a width kept before widths were per person (`ws.width.<old>`) to this person's key, once. */
function adoptWidth(key: string, legacy: string | undefined): void {
  if (!legacy || readStored(key) !== null) return;
  const old = readStored(legacy);
  if (old !== null) writeStored(key, old);
}

export function DetailsDrawer({
  drawer,
  title,
  label,
  defaultWidth = DRAWER_DEFAULT,
  min = DRAWER_MIN,
  max = DRAWER_MAX,
  legacyWidthKey,
  className,
  children,
}: {
  drawer: Drawer;
  /** The landmark's name: "Ticket details". */
  title: string;
  /** What it is, for Show, Hide and Resize: "the ticket details". */
  label: string;
  defaultWidth?: number;
  min?: number;
  max?: number;
  /** Where the width was kept before it was kept per person. */
  legacyWidthKey?: string;
  className?: string;
  children: ReactNode;
}) {
  const key = drawerWidthKey(drawer.id, drawer.uid);
  // Before the width is read: a width kept before widths were per person is this person's to start with.
  useState(() => adoptWidth(key, legacyWidthKey));
  const limit = useCallback(() => drawerMax(window.innerWidth, min, max), [min, max]);
  const size = useResizableWidth(`drawer.${drawer.id}`, { key, defaultWidth, min, max: limit });
  const showLabel = text('Show {what}', { what: label });
  const hideLabel = text('Hide {what}', { what: label });

  if (!drawer.open) {
    // Beside the content, its strip brings it back; over it, the header's button does.
    if (drawer.overlay) return null;
    return (
      <div data-side-panel={drawer.id} data-drawer={drawer.id} className="flex w-9 shrink-0 flex-col items-center border-l border-line bg-rail pt-2.5">
        <button type="button" aria-label={showLabel} title={`${showLabel} (${DRAWER_SHORTCUT_LABEL})`} aria-expanded={false} aria-keyshortcuts={DRAWER_SHORTCUT_ARIA} onClick={drawer.toggle} className="flex h-7 w-7 items-center justify-center rounded-[7px] text-ink-2 hover:bg-subtle hover:text-ink">
          <Icon name="panel-right-open" size={16} />
        </button>
      </div>
    );
  }

  const body = (
    <aside id={drawer.panelId} aria-label={title} className={cx('flex h-full min-h-0 min-w-0 flex-col gap-2.5 overflow-y-auto border-l border-line bg-ground px-3 py-3.5 text-[12px] scroll-thin', className)} style={{ width: size.width }}>
      {children}
    </aside>
  );
  const divider = <ResizeDivider state={size} side="left" label={text('Resize {what}', { what: label })} />;

  if (drawer.overlay) {
    return (
      <>
        <div aria-hidden data-drawer-scrim data-support-scrim onMouseDown={() => drawer.setOpen(false)} className="absolute inset-0 z-30 bg-scrim/40" />
        <div
          data-drawer={drawer.id}
          className="absolute inset-y-0 right-0 z-30 flex shadow-[-12px_0_32px_-16px_rgb(0_0_0/.45)]"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              drawer.setOpen(false);
            }
          }}
        >
          <div className="relative flex h-full min-h-0">
            {divider}
            {body}
          </div>
        </div>
      </>
    );
  }
  return (
    <div data-side-panel={drawer.id} data-drawer={drawer.id} className="group/panel relative flex h-full min-h-0 shrink-0">
      {divider}
      {body}
      <button
        type="button"
        aria-label={hideLabel}
        title={`${hideLabel} (${DRAWER_SHORTCUT_LABEL})`}
        aria-expanded
        aria-controls={drawer.panelId}
        aria-keyshortcuts={DRAWER_SHORTCUT_ARIA}
        onClick={drawer.toggle}
        className="absolute top-1/2 -left-2 z-20 flex h-10 w-4 -translate-y-1/2 items-center justify-center rounded-[6px] border border-line bg-surface text-ink-3 opacity-0 shadow-sm transition-opacity group-hover/panel:opacity-100 hover:text-ink hover:opacity-100 focus-visible:opacity-100"
      >
        <Icon name="chevron-right" size={12} />
      </button>
    </div>
  );
}

/**
 * One of the drawer's sections, in its card look: a heading button that opens and closes it (`aria-expanded`,
 * `aria-controls`), an optional count and an action beside it, and the body. Whether it is open is remembered for the
 * signed-in person (`<drawer>.<id>`). A section with nothing to show is simply not rendered by its caller.
 */
export function DrawerSection({ drawer, id, title, count, action, defaultOpen = true, children }: { drawer: string; id: string; title: string; count?: number; action?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const uid = useStore(app, (s) => s.auth?.user?.id ?? '');
  const key = `${drawer}.${id}`;
  const [open, setOpen] = useState(() => recallSection(uid, key) ?? defaultOpen);
  const bodyId = `${useId()}-body`;
  return (
    <section aria-label={title} data-section={id} className={cx(DRAWER_CARD, 'shrink-0 gap-2')}>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => {
            rememberSection(uid, key, !open);
            setOpen(!open);
          }}
          className={cx(DRAWER_HEADING, 'flex min-w-0 flex-1 items-center gap-1 rounded-[6px] text-left outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/40')}
        >
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
          <span className="min-w-0 truncate">{title}</span>
          {count !== undefined ? <span className="rounded-full bg-subtle px-1.5 text-[10px] tracking-normal text-ink-3 tabular-nums">{count}</span> : null}
        </button>
        {open ? action : null}
      </div>
      <div id={bodyId} hidden={!open} className="flex flex-col gap-2">
        {open ? children : null}
      </div>
    </section>
  );
}
