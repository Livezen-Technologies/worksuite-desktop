import { BrowserWindow, screen, type Rectangle } from 'electron';
import { execFile } from 'node:child_process';
import type { GrantedSource } from './screen-share';

/** Read only: never starts an input injector or asks for Accessibility. */
export function windowRectangle(id: string): Promise<Rectangle | null> {
  if (!/^\d{1,20}$/.test(id)) return Promise.resolve(null);
  let file: string;
  let args: string[];
  if (process.platform === 'darwin') {
    file = '/usr/bin/osascript';
    args = [
      '-l',
      'JavaScript',
      '-e',
      `ObjC.import('CoreGraphics'); var a=ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(8, ${id}))) || []; var w=a.find(function(w){return w.kCGWindowNumber===${id}}); w && w.kCGWindowIsOnscreen ? JSON.stringify(w.kCGWindowBounds) : '';`,
    ];
  } else if (process.platform === 'win32') {
    file = 'powershell.exe';
    args = [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class WsShareRect { [StructLayout(LayoutKind.Sequential)] public struct R { public int X,Y,Right,Bottom; } [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out R r); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h); [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'; [WsShareRect]::SetProcessDPIAware() | Out-Null; $r=New-Object WsShareRect+R; if (-not [WsShareRect]::IsIconic([IntPtr]${id}) -and [WsShareRect]::GetWindowRect([IntPtr]${id},[ref]$r)) { @{X=$r.X;Y=$r.Y;Width=($r.Right-$r.X);Height=($r.Bottom-$r.Y)} | ConvertTo-Json -Compress }`,
    ];
  } else if (process.platform === 'linux' && process.env.XDG_SESSION_TYPE !== 'wayland') {
    file = 'xwininfo';
    args = ['-id', `0x${BigInt(id).toString(16)}`];
  } else return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 2000, maxBuffer: 64 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) return resolve(null);
      try {
        let r: Rectangle;
        if (process.platform === 'linux') {
          if (!/Map State:\s+IsViewable/.test(stdout)) return resolve(null);
          const value = (key: string) => Number([...stdout.matchAll(new RegExp(`^\\s*${key}:\\s+(-?\\d+)$`, 'gm'))].pop()?.[1]);
          r = { x: value('Absolute upper-left X'), y: value('Absolute upper-left Y'), width: value('Width'), height: value('Height') };
        } else {
          const b = JSON.parse(stdout) as { X: number; Y: number; Width: number; Height: number };
          r = { x: b.X, y: b.Y, width: b.Width, height: b.Height };
          if (process.platform === 'win32') {
            const start = screen.screenToDipPoint({ x: r.x, y: r.y });
            const end = screen.screenToDipPoint({ x: r.x + r.width, y: r.y + r.height });
            r = { ...start, width: end.x - start.x, height: end.y - start.y };
          }
        }
        resolve(Object.values(r).every(Number.isFinite) && r.width > 0 && r.height > 0 ? r : null);
      } catch {
        resolve(null);
      }
    });
  });
}

/** One click-through outline per capturing page; stale native replies cannot resurrect it. */
export class ShareOutline {
  private entries = new Map<number, { window: BrowserWindow; timer: ReturnType<typeof setTimeout> | null }>();
  constructor(private readonly boundsOf = windowRectangle) {}

  start(owner: number, source: GrantedSource): void {
    this.stop(owner);
    // Wayland does not permit arbitrary global window positioning.
    if (process.platform === 'linux' && process.env.XDG_SESSION_TYPE === 'wayland') return;
    const win = new BrowserWindow({
      show: false,
      frame: false,
      transparent: true,
      focusable: false,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    win.setIgnoreMouseEvents(true);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setContentProtection(true);
    const entry = { window: win, timer: null as ReturnType<typeof setTimeout> | null };
    this.entries.set(owner, entry);
    const update = async () => {
      const bounds =
        source.kind === 'screen'
          ? (screen.getAllDisplays().find((d) => String(d.id) === source.displayId)?.bounds ?? null)
          : source.windowId
            ? await this.boundsOf(source.windowId)
            : null;
      if (this.entries.get(owner) !== entry || win.isDestroyed()) return;
      if (bounds) {
        win.setBounds(bounds);
        win.showInactive();
      } else win.hide();
      entry.timer = setTimeout(() => void update(), 1000);
      entry.timer.unref?.();
    };
    const html =
      '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}body{box-sizing:border-box;border:3px solid #E5484D}</style></head><body></body></html>';
    void win
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      .then(() => update())
      .catch(() => {
        if (this.entries.get(owner) === entry) this.stop(owner);
      });
  }

  stop(owner: number): void {
    const entry = this.entries.get(owner);
    this.entries.delete(owner);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    if (!entry.window.isDestroyed()) entry.window.destroy();
  }
}
