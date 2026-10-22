import { execFile } from 'node:child_process';
import { DEFAULT_BUTTON_LAYOUT, parseButtonLayout, type ButtonLayout } from '@shared/window-controls';

let layout: Promise<ButtonLayout> | null = null;

/**
 * Where GNOME puts the window buttons (#409), asked once: gsettings is missing on some desktops (KDE, a minimal
 * install), and any failure gives the usual right-side minimise, maximise, close.
 */
export function buttonLayout(): Promise<ButtonLayout> {
  if (process.platform !== 'linux') return Promise.resolve(DEFAULT_BUTTON_LAYOUT);
  layout ??= new Promise<ButtonLayout>((resolve) => {
    execFile('gsettings', ['get', 'org.gnome.desktop.wm.preferences', 'button-layout'], { timeout: 2000 }, (err, stdout) => {
      resolve(err ? DEFAULT_BUTTON_LAYOUT : parseButtonLayout(String(stdout)));
    });
  });
  return layout;
}
