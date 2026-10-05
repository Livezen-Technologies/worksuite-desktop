import type { IpcMainEvent, WebContents } from 'electron';
import type { Preferences } from '@shared/types';
import { appearanceOf, lookOf, resolveAppearance, type AppearancePrefs } from '@shared/theme-profiles';

/**
 * The colour profile in every window (worksuite-desktop#234).
 *
 *  - At startup, before the first paint: each page's preload asks `appearance:initial` synchronously and writes the
 *    profile onto the page before anything is drawn, and each window opens filled with the profile's background.
 *  - On a change — a profile picked in any window, the organisation's default arriving, another device's choice
 *    synced in — every page of the app gets `appearance:changed` at once, windows and views alike, and the windows
 *    take the new background and title bar colours.
 *  - The system's own drawing (menus, scrollbars, dialogs) follows the mode; under System, a change of the
 *    computer's appearance recolours the windows too (each page follows it by itself).
 */
export interface AppearanceDeps {
  settings: { effective(): Preferences; onChange(fn: (p: Preferences) => void): () => void };
  windows: {
    setLook(look: { ground: string; surface: string; chrome: string }): void;
    broadcastAppearance(payload: AppearancePrefs): void;
    isAppContents(wc: WebContents): boolean;
  };
  ipc: { on(channel: string, listener: (event: IpcMainEvent) => void): unknown };
  nativeTheme: { themeSource: 'system' | 'light' | 'dark'; readonly shouldUseDarkColors: boolean; on(event: 'updated', listener: () => void): unknown };
}

export function installAppearance(deps: AppearanceDeps): { refresh: () => void } {
  const current = () => appearanceOf(deps.settings.effective());
  deps.ipc.on('appearance:initial', (event) => {
    event.returnValue = deps.windows.isAppContents(event.sender) ? current() : null;
  });
  const recolour = (a: AppearancePrefs) => deps.windows.setLook(lookOf(resolveAppearance(a, deps.nativeTheme.shouldUseDarkColors)));
  let last = '';
  const refresh = () => {
    const a = current();
    if (deps.nativeTheme.themeSource !== a.mode) deps.nativeTheme.themeSource = a.mode;
    recolour(a);
    const key = JSON.stringify(a);
    if (key === last) return;
    const first = last === '';
    last = key;
    if (!first) deps.windows.broadcastAppearance(a);
  };
  refresh();
  deps.settings.onChange(refresh);
  deps.nativeTheme.on('updated', () => recolour(current()));
  return { refresh };
}
