import type { AiDisplay } from '@shared/types';
import { app, type AppState } from './app-state';
import { createStore, useStore } from './store';

export type Overlay = 'search' | 'palette' | 'launcher' | 'notifications' | 'transfers' | 'org' | 'profile' | 'network' | 'clock' | 'update' | null;
export type Dock = 'ai' | 'activity' | 'chat' | null;

export const ui = createStore<{ overlay: Overlay; dock: Dock; sidebarCollapsed: boolean; searchSeed: string; chatRoom: string | null; chatMinimised: string[] }>({
  overlay: null,
  dock: null,
  sidebarCollapsed: false,
  searchSeed: '',
  // The chat drawer (ChatDrawer): the conversation it shows, and the ones minimised to the corner.
  chatRoom: null,
  chatMinimised: [],
});

/**
 * Menus and panels that float over the work (worksuite-desktop#150): a title-bar menu or popover (`overlay`), the
 * AI Assistant (its widget or its drawer) and the chat drawer. Only one is open at a time — opening one puts the others
 * away, and nothing in them is lost: the assistant goes down to its launcher with its conversation, a conversation in
 * the chat drawer waits in the corner. Stacking, for the moment one is closing as another opens: a menu (z-40, fixed)
 * above the chat drawer (z-30) above the AI widget (z-20, inside the workspace).
 */
type Floating = 'overlay' | 'assistant' | 'chat';

function putAwayAllBut(keep: Floating): void {
  if (keep !== 'overlay' && ui.get().overlay) ui.set({ overlay: null });
  if (keep !== 'assistant') putAssistantAway();
  if (keep !== 'chat' && ui.get().dock === 'chat') minimiseChatDrawer();
}

/** The assistant down to its launcher (or, with the drawer, its floating button while something is on its way). */
export function putAssistantAway(): void {
  if (aiWidget.get().open) aiWidget.set({ open: false });
  if (ui.get().dock === 'ai') {
    ui.set({ dock: null });
    aiMinimized.set({ on: true });
  }
}

export function openOverlay(o: Overlay, seed = ''): void {
  if (o !== null && ui.get().overlay !== o) putAwayAllBut('overlay');
  ui.set((s) => ({ overlay: s.overlay === o ? null : o, searchSeed: seed }));
}

export function closeOverlay(): void {
  ui.set({ overlay: null });
}

export function toggleDock(d: Exclude<Dock, null>): void {
  if (ui.get().dock !== d) putAwayAllBut(d === 'chat' ? 'chat' : 'assistant');
  ui.set((s) => ({ dock: s.dock === d ? null : d }));
}

/** Open the chat drawer, on a conversation or on the list. */
export function openChatDrawer(room: string | null = null): void {
  putAwayAllBut('chat');
  ui.set((s) => ({ dock: 'chat', chatRoom: room, chatMinimised: room ? s.chatMinimised.filter((r) => r !== room) : s.chatMinimised }));
}

/** Close the drawer; a conversation it was showing waits in the corner. */
export function minimiseChatDrawer(): void {
  ui.set((s) => ({ dock: null, chatRoom: null, chatMinimised: s.chatRoom && !s.chatMinimised.includes(s.chatRoom) ? [...s.chatMinimised, s.chatRoom].slice(-4) : s.chatMinimised }));
}

/** Settings › AI Assistant › Display mode: the header button and its drawer, the floating widget, or neither. */
export function aiDisplay(): AiDisplay {
  return app.get().prefs?.ai?.display ?? 'widget';
}

export function useAiDisplay(): AiDisplay {
  return useStore(app, (s) => s.prefs?.ai?.display ?? 'widget');
}

/** The floating widget (#61): open or down to its launcher, and whether it fills the workspace. */
export const aiWidget = createStore<{ open: boolean; maximized: boolean }>({ open: false, maximized: false });

/**
 * Minimised, not closed (worksuite-desktop#126): with the drawer, the floating button that stands in for it while
 * something is on its way or waits to be seen. See app/overlays/aiMinimize.
 */
export const aiMinimized = createStore<{ on: boolean }>({ on: false });

/**
 * Show the assistant where the person keeps it: the widget in widget mode, else the drawer — also when it is
 * hidden, since whatever asked for it (the shortcut, Quick Ask's hand-over) was asked for.
 */
export function openAssistant(): void {
  putAwayAllBut('assistant');
  if (aiDisplay() === 'widget') aiWidget.set({ open: true });
  else ui.set({ dock: 'ai' });
}

/** The shortcut, the command and the header button: open it, or put it away. */
export function toggleAssistant(): void {
  if (aiDisplay() !== 'widget') return toggleDock('ai');
  if (aiWidget.get().open) aiWidget.set({ open: false });
  else openAssistant();
}

/**
 * Escape, when nothing nearer took it: the open menu closes, else the assistant goes down to its launcher.
 * Whether anything was closed.
 */
export function closeTopPanel(): boolean {
  if (ui.get().overlay) {
    closeOverlay();
    return true;
  }
  if (aiWidget.get().open || ui.get().dock === 'ai') {
    putAssistantAway();
    return true;
  }
  return false;
}

/**
 * A new session on the screen — signed in (from sign-in, the lock screen or a Local Profile), unlocked, or signed out
 * or locked (worksuite-desktop#150): every menu and floating panel closed, so the dashboard is clean and nothing open
 * before is shown again. Only where they are kept stays (the sidebar folded or not); nothing of a panel's open state is
 * ever saved, so a restart starts closed too.
 */
export function resetFloatingPanels(): void {
  ui.set({ overlay: null, dock: null, searchSeed: '', chatRoom: null, chatMinimised: [] });
  aiWidget.set({ open: false, maximized: false });
  aiMinimized.set({ on: false });
}


/** Who the workspace is on the screen for: a person signed in and not locked out, guest mode (#149), or nobody. */
export function onScreenFor(s: AppState): string | null {
  if (s.auth?.stage === 'ready') return s.lock?.locked ? null : `in:${s.auth.user?.id ?? ''}`;
  return s.session.mode === 'guest' && !s.session.signingIn ? 'guest' : null;
}

/**
 * Closes every menu and floating panel whenever that changes (worksuite-desktop#150): at sign-in from the sign-in
 * screen or a Local Profile, at sign-out, when WorkSuite locks and when it is unlocked. Returns the unsubscribe.
 */
export function closePanelsOnSessionChange(): () => void {
  let last = onScreenFor(app.get());
  return app.subscribe(() => {
    const now = onScreenFor(app.get());
    if (now === last) return;
    last = now;
    resetFloatingPanels();
  });
}
