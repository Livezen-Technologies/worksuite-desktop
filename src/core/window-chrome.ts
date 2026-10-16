import { isMac } from './bridge';

/**
 * Room at the top right for the window's own buttons. On Windows and Linux the main process draws minimise,
 * maximise and close over the page (`titleBarOverlay`, windows/manager.ts), so anything laid out across the top of
 * the window — the title bar, and a viewer over the whole page — keeps this much clear on the right or the buttons
 * cover it. macOS puts its buttons on the left (the title bar's own left padding), so nothing here.
 */
export const WINDOW_CONTROLS_INSET = isMac ? 0 : 150;

/** Right padding for a bar along the top of the window: the window's buttons' room, else `own`. */
export function topBarPaddingRight(own: number, fullScreen = false): number {
  return WINDOW_CONTROLS_INSET && !fullScreen ? WINDOW_CONTROLS_INSET : own;
}
