import { app } from 'electron';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Start with the OS (FR-TRAY-03): a login item on Windows and macOS, an XDG
 * autostart entry on Linux. `--hidden` starts straight to the tray when the
 * user chose Start minimized.
 */
export function applyAutostart(enabled: boolean, minimized: boolean): void {
  if (!app.isPackaged) return; // never register a development build
  const args = minimized ? ['--hidden'] : [];
  if (process.platform === 'linux') {
    const dir = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'autostart');
    const file = join(dir, 'worksuite.desktop');
    if (!enabled) {
      if (existsSync(file)) unlinkSync(file);
      return;
    }
    const exec = process.env.APPIMAGE || process.execPath;
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      file,
      ['[Desktop Entry]', 'Type=Application', 'Name=WorkSuite', `Exec="${exec}" ${args.join(' ')}`.trim(), 'X-GNOME-Autostart-enabled=true', 'NoDisplay=false', 'Terminal=false', ''].join('\n'),
    );
    return;
  }
  app.setLoginItemSettings({ openAtLogin: enabled, args });
}

export function startedHidden(): boolean {
  return process.argv.includes('--hidden');
}
