import { createStore } from './store';

export type Overlay = 'search' | 'palette' | 'launcher' | 'notifications' | 'transfers' | 'org' | 'profile' | 'network' | 'clock' | null;
export type Dock = 'ai' | 'activity' | null;

export const ui = createStore<{ overlay: Overlay; dock: Dock; sidebarCollapsed: boolean; searchSeed: string }>({
  overlay: null,
  dock: null,
  sidebarCollapsed: false,
  searchSeed: '',
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
