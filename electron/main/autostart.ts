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
  // A Print Gateway (WS-LABEL-SRS-001 FR-GWY-01) starts with the OS, as the gateway, whatever the person chose.
  const gateway = gatewayAutostart();
  enabled = enabled || gateway;
  const args = gateway ? ['--print-gateway'] : minimized ? ['--hidden'] : [];
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
  return process.argv.includes('--hidden') || startedAsGateway();
}

/** `--print-gateway`: WorkSuite Desktop as the Label Studio Print Gateway — tray only, no window until one is asked for (SRS Q-03). */
export function startedAsGateway(argv: string[] = process.argv): boolean {
  return argv.includes('--print-gateway');
}

/** `--pair-url=… --pair-code=…` with `--print-gateway`: pair a headless box from its command line (D06 without a screen). */
export function gatewayPairingArgs(argv: string[] = process.argv): { url: string; code: string; name: string | null } | null {
  const v = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? null;
  const url = v('pair-url');
  const code = v('pair-code');
  return url && code ? { url, code, name: v('pair-name') } : null;
}

const gatewayMarker = () => join(app.getPath('userData'), 'print-gateway-autostart');

export function gatewayAutostart(): boolean {
  try {
    return existsSync(gatewayMarker());
  } catch {
    return false;
  }
}

/** Start with the OS as the Print Gateway, or stop doing so; the login item is written again either way. */
export function setGatewayAutostart(on: boolean, prefs: { startWithOs: boolean; startMinimized: boolean }): void {
  if (on) writeFileSync(gatewayMarker(), '1');
  else if (existsSync(gatewayMarker())) unlinkSync(gatewayMarker());
  applyAutostart(prefs.startWithOs, prefs.startMinimized);
}
