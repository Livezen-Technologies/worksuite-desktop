import type { AiDisplay } from '@shared/types';
import { app } from './app-state';
import { createStore, useStore } from './store';

export type Overlay = 'search' | 'palette' | 'launcher' | 'notifications' | 'transfers' | 'org' | 'profile' | 'network' | 'clock' | null;
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

export function openOverlay(o: Overlay, seed = ''): void {
  ui.set((s) => ({ overlay: s.overlay === o ? null : o, searchSeed: seed }));
}

export function closeOverlay(): void {
  ui.set({ overlay: null });
}

export function toggleDock(d: Exclude<Dock, null>): void {
  ui.set((s) => ({ dock: s.dock === d ? null : d }));
}

/** Open the chat drawer, on a conversation or on the list. */
export function openChatDrawer(room: string | null = null): void {
  ui.set((s) => ({ dock: 'chat', chatRoom: room, chatMinimised: room ? s.chatMinimised.filter((r) => r !== room) : s.chatMinimised }));
}

/** Close the drawer; a conversation it was showing waits in the corner. */
export function minimiseChatDrawer(): void {
  ui.set((s) => ({ dock: null, chatRoom: null, chatMinimised: s.chatRoom && !s.chatMinimised.includes(s.chatRoom) ? [...s.chatMinimised, s.chatRoom].slice(-4) : s.chatMinimised }));
}

/** Settings › AI Assistant › Display mode: the header button and its drawer, the floating widget, or neither. */
export function aiDisplay(): AiDisplay {
  return app.get().prefs?.ai?.display ?? 'drawer';
}

export function useAiDisplay(): AiDisplay {
  return useStore(app, (s) => s.prefs?.ai?.display ?? 'drawer');
}

/** The floating widget (#61): open or down to its launcher, and whether it fills the workspace. */
export const aiWidget = createStore<{ open: boolean; maximized: boolean }>({ open: false, maximized: false });

/**
 * Show the assistant where the person keeps it: the widget in widget mode, else the drawer — also when it is
 * hidden, since whatever asked for it (the shortcut, Quick Ask's hand-over) was asked for.
 */
export function openAssistant(): void {
  if (aiDisplay() === 'widget') aiWidget.set({ open: true });
  else ui.set({ dock: 'ai' });
}

/** The shortcut, the command and the header button: open it, or put it away. */
export function toggleAssistant(): void {
  if (aiDisplay() === 'widget') aiWidget.set((s) => ({ open: !s.open }));
  else toggleDock('ai');
}

