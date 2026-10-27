import { emptyView, featureOn, type DesktopSettingsView, type SettingValue } from '@shared/desktop-settings';
import { app } from './app-state';
import { call, errorMessage } from './bridge';
import { useStore } from './store';
import { toast } from './toasts';

/**
 * Desktop settings in the window (shared/desktop-settings.ts): what takes effect, from the desktop
 * (`desktopSettings:get` / `desktopSettings:changed`, kept in `app.desktopSettings`), and the person's changes.
 * The desktop enforces; this reads the same answer for the screens and the overlays.
 */

const EMPTY = emptyView();

/** The view to draw from: the desktop's, or this desktop's defaults while there is none. */
export function desktopSettings(): DesktopSettingsView {
  return app.get().desktopSettings ?? EMPTY;
}

export function useDesktopSettings(): DesktopSettingsView {
  return useStore(app, (s) => s.desktopSettings) ?? EMPTY;
}

/** Whether a feature is on now. */
export function featureEnabled(id: string): boolean {
  return featureOn(app.get().desktopSettings?.effective, id);
}

/** Whether a feature is on; re-renders when it changes. */
export function useFeature(id: string): boolean {
  return useStore(app, (s) => featureOn(s.desktopSettings?.effective, id));
}

/**
 * Changes the person's choices (null: back to the default). A managed key is refused by the desktop, and the
 * refusal is said; anything else that fails is said too. Returns whether it was taken.
 */
export async function setDesktopSettings(values: Record<string, SettingValue | null>): Promise<boolean> {
  try {
    const v = await call('desktopSettings:set', { values });
    app.set({ desktopSettings: v });
    return true;
  } catch (e) {
    toast('error', errorMessage(e));
    return false;
  }
}

/** Asks the server again (Settings' "Sync now"). */
export async function refreshDesktopSettings(): Promise<void> {
  try {
    app.set({ desktopSettings: await call('desktopSettings:refresh') });
  } catch (e) {
    toast('error', errorMessage(e));
  }
}
