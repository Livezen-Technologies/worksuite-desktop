import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { logger } from '../../main/log';
import { keyOf } from './keys';

const log = logger('remote-input');

/**
 * Injecting the controller's input (WS-MEET-ENH-01 §E.3), with the helpers
 * the operating system already has — no native module in the app:
 *
 *   Windows  PowerShell hosting a few lines of C# that call SendInput
 *   macOS    osascript (JavaScript for Automation) posting CGEvents
 *   X11      xdotool, if it is installed
 *   Wayland  none: a Wayland session does not let one app drive another,
 *            so the screen can be shared but not controlled
 *
 * Every helper is started with a fixed script and takes a line protocol of
 * numbers and key names from this process. Nothing the controller sends is
 * ever put into a command line or a script: coordinates are numbers this
 * process computed, keys are names from `KEYS`, text travels base64-encoded.
 */

export type Button = 'left' | 'middle' | 'right';

/** One thing to do, in the helper's own screen space (physical pixels on Windows and X11, points on a Mac). */
export type InputAction =
  | { t: 'move'; x: number; y: number }
  | { t: 'button'; button: Button; down: boolean }
  | { t: 'wheel'; dx: number; dy: number }
  | { t: 'key'; code: string; down: boolean }
  | { t: 'text'; text: string };

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What is in front: its window id (as the capture source names it), its app, its title. */
export interface Foreground {
  window: string | null;
  app: string;
  title: string;
}

export interface Injector {
  readonly method: 'sendinput' | 'cgevent' | 'xdotool';
  /** Starts the helper; false when it cannot run here (blocked PowerShell, no permission, no xdotool). */
  start(): Promise<boolean>;
  /** Queue actions. Moves waiting behind a running batch collapse to the last; long text is cut into pieces. */
  send(actions: InputAction[]): void;
  /** Forget everything not yet handed to the system: a pause, a stop, the person here taking over. */
  drop(): void;
  /** Nothing is queued and nothing is being carried out. */
  idle(): boolean;
  /** When the system last finished carrying out a batch (ms): the helper said so, not when it was written. */
  lastDone(): number;
  /** A captured window's place on screen, in the helper's space. */
  windowBounds(windowId: string): Promise<Rect | null>;
  /** Whether that window is what the pointer is over at a point (the helper's space); null when it cannot tell. */
  isUnder(x: number, y: number, windowId: string): Promise<boolean | null>;
  foreground(): Promise<Foreground | null>;
  /**
   * Where the pointer is now (the helper's space), or null to use Electron's
   * reading. On X11 Electron only learns it from events on its own windows,
   * so out on the desktop its reading stands still.
   */
  pointer(): Promise<{ x: number; y: number } | null>;
  /** Let what is queued (the releases) finish, then end. */
  stop(): void;
  /** The helper went away without being asked to. */
  onExit: (() => void) | null;
}

export type DisplayServer = 'win32' | 'quartz' | 'x11' | 'wayland';

export interface InputSupport {
  displayServer: DisplayServer;
  /** A helper that can inject exists on this computer. */
  available: boolean;
  method: Injector['method'] | null;
  /** Why control cannot work here, in a sentence, when it cannot. */
  reason: string | null;
}

// ── line protocol ─────────────────────────────────────────────────────────

const int = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number.isFinite(n) ? n : 0)));
const BUTTON_CODE: Record<Button, string> = { left: 'l', middle: 'm', right: 'r' };

/** A readable-text-only copy of what the controller typed: no control characters, at most 1,000. */
export function cleanText(text: string): string {
  return Array.from(text.replace(/\r\n?/g, '\n'))
    .filter((c) => c === '\n' || c === '\t' || c >= ' ')
    .slice(0, 1000)
    .join('');
}

/**
 * The lines the Windows and macOS helpers read. A key not in `KEYS` produces
 * nothing; so does anything malformed.
 */
export function protocolLines(actions: InputAction[], platform: 'win32' | 'darwin'): string[] {
  const out: string[] = [];
  for (const a of actions) {
    if (a.t === 'move') out.push(`m ${int(a.x, -100_000, 100_000)} ${int(a.y, -100_000, 100_000)}`);
    else if (a.t === 'button') out.push(`b ${BUTTON_CODE[a.button]} ${a.down ? 1 : 0}`);
    else if (a.t === 'wheel') {
      const dx = int(a.dx, -2400, 2400);
      const dy = int(a.dy, -2400, 2400);
      if (dx || dy) out.push(`w ${dx} ${dy}`);
    } else if (a.t === 'key') {
      const k = keyOf(a.code);
      if (!k) continue;
      out.push(platform === 'win32' ? `k ${k.win} ${k.ext ? 1 : 0} ${a.down ? 1 : 0}` : `k ${k.mac} ${a.down ? 1 : 0}`);
    } else if (a.t === 'text') {
      const text = cleanText(a.text);
      if (text) out.push(`u ${Buffer.from(text, 'utf8').toString('base64')}`);
    }
  }
  return out;
}

/** xdotool arguments for a batch: one invocation runs them all, in order. */
export function xdotoolArgs(actions: InputAction[]): string[] {
  const args: string[] = [];
  const button: Record<Button, string> = { left: '1', middle: '2', right: '3' };
  for (const a of actions) {
    if (a.t === 'move') args.push('mousemove', String(int(a.x, 0, 100_000)), String(int(a.y, 0, 100_000)));
    else if (a.t === 'button') args.push(a.down ? 'mousedown' : 'mouseup', button[a.button]);
    else if (a.t === 'wheel') {
      // X has no smooth wheel: a notch is a click of buttons 4–7.
      const notches = (d: number) => Math.min(10, Math.max(Math.abs(d) >= 1 ? 1 : 0, Math.round(Math.abs(d) / 120)));
      const ny = notches(a.dy);
      const nx = notches(a.dx);
      if (ny) args.push('click', '--repeat', String(ny), a.dy > 0 ? '5' : '4');
      if (nx) args.push('click', '--repeat', String(nx), a.dx > 0 ? '7' : '6');
    } else if (a.t === 'key') {
      const k = keyOf(a.code);
      if (k) args.push(a.down ? 'keydown' : 'keyup', k.x11);
    } else if (a.t === 'text') {
      const text = cleanText(a.text);
      // `--` so text starting with a dash is typed, not read as an option.
      if (text) args.push('type', '--delay', '0', '--', text);
    }
  }
  return args;
}

// ── the queue every helper shares ─────────────────────────────────────────

/** Text goes in pieces this long, each its own batch, so a pause cuts it short. */
const TEXT_CHUNK = 64;
const BATCH = 64;

/** Add actions to a queue: a move replaces a move still waiting; text is cut into pieces. */
export function enqueue(queue: InputAction[], actions: InputAction[]): void {
  for (const a of actions) {
    if (a.t === 'text') {
      const chars = Array.from(cleanText(a.text));
      for (let i = 0; i < chars.length; i += TEXT_CHUNK) queue.push({ t: 'text', text: chars.slice(i, i + TEXT_CHUNK).join('') });
      continue;
    }
    const last = queue[queue.length - 1];
    if (a.t === 'move' && last?.t === 'move') queue[queue.length - 1] = a;
    else queue.push(a);
  }
}

/** The next batch: up to 64 actions, ending at the first text (xdotool types every word that follows `type`). */
export function nextBatch(queue: InputAction[]): InputAction[] {
  const out: InputAction[] = [];
  while (queue.length && out.length < BATCH) {
    const a = queue.shift()!;
    out.push(a);
    if (a.t === 'text') break;
  }
  return out;
}

/**
 * One batch at a time, each confirmed by the helper before the next goes.
 * Nothing piles up inside a helper where a pause could not reach it: what
 * waits, waits here, and `drop()` forgets it.
 */
abstract class Batched {
  onExit: (() => void) | null = null;
  private queue: InputAction[] = [];
  private running = false;
  private done = 0;
  protected stopping = false;

  protected abstract runBatch(batch: InputAction[]): Promise<void>;
  protected abstract close(): void;

  send(actions: InputAction[]): void {
    if (this.stopping) return;
    enqueue(this.queue, actions);
    void this.drain();
  }

  drop(): void {
    this.queue = [];
  }

  idle(): boolean {
    return !this.running && this.queue.length === 0;
  }

  lastDone(): number {
    return this.done;
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const batch = nextBatch(this.queue);
        try {
          await this.runBatch(batch);
        } catch (e) {
          log.warn('input batch failed', { error: String((e as Error).message ?? e) });
        }
        this.done = Date.now();
      }
    } finally {
      this.running = false;
      if (this.stopping) this.close();
    }
  }

  stop(): void {
    this.stopping = true;
    if (!this.running) this.close();
  }
}

// ── helpers speaking the line protocol (Windows, macOS) ──────────────────

/**
 * A long-lived helper process: actions are written as lines, queries
 * (`?<n> …`) are answered with a line starting `<n> `.
 */
abstract class LineHelper extends Batched implements Injector {
  abstract readonly method: Injector['method'];
  private proc: ChildProcessWithoutNullStreams | null = null;
  private starting: Promise<boolean> | null = null;
  private waiters = new Map<number, (line: string | null) => void>();
  private nextQuery = 1;
  private closing = false;

  protected abstract command(): { file: string; args: string[] };
  protected abstract platform(): 'win32' | 'darwin';

  start(): Promise<boolean> {
    if (this.proc) return Promise.resolve(true);
    if (this.starting) return this.starting;
    this.stopping = false;
    this.closing = false;
    this.starting = new Promise<boolean>((resolve) => {
      const { file, args } = this.command();
      let proc: ChildProcessWithoutNullStreams;
      try {
        proc = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      } catch (e) {
        log.warn('input helper did not start', { error: String(e) });
        resolve(false);
        return;
      }
      const timer = setTimeout(() => {
        log.warn('input helper did not say ready');
        proc.kill();
        resolve(false);
      }, 20_000);
      const lines = createInterface({ input: proc.stdout });
      lines.on('line', (line) => {
        if (line === 'ready') {
          clearTimeout(timer);
          this.proc = proc;
          resolve(true);
          return;
        }
        const m = /^(\d+) ?(.*)$/.exec(line);
        const w = m ? this.waiters.get(Number(m[1])) : undefined;
        if (m && w) {
          this.waiters.delete(Number(m[1]));
          w(m[2] ?? '');
        }
      });
      proc.stderr.on('data', (d: Buffer) => log.warn('input helper', { stderr: d.toString('utf8').slice(0, 400) }));
      proc.on('exit', (code) => {
        clearTimeout(timer);
        const mine = this.proc === proc;
        if (mine) this.proc = null;
        for (const w of this.waiters.values()) w(null);
        this.waiters.clear();
        log.info('input helper exited', { code });
        resolve(false);
        if (mine && !this.closing) this.onExit?.();
      });
      proc.on('error', () => resolve(false));
    }).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  /** Write the batch, then wait for the helper to say it has carried it out (lines run in order). */
  protected async runBatch(batch: InputAction[]): Promise<void> {
    const lines = protocolLines(batch, this.platform());
    if (!this.proc || lines.length === 0) return;
    this.proc.stdin.write(`${lines.join('\n')}\n`);
    await this.query('ack', 10_000);
  }

  protected query(what: string, timeoutMs = 2_000): Promise<string | null> {
    const proc = this.proc;
    if (!proc) return Promise.resolve(null);
    const n = this.nextQuery++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(n);
        resolve(null);
      }, timeoutMs);
      this.waiters.set(n, (line) => {
        clearTimeout(timer);
        resolve(line);
      });
      proc.stdin.write(`?${n} ${what}\n`);
    });
  }

  async windowBounds(windowId: string): Promise<Rect | null> {
    if (!/^\d{1,20}$/.test(windowId)) return null;
    const r = await this.query(`rect ${windowId}`);
    const m = r ? /^(-?\d+) (-?\d+) (\d+) (\d+)$/.exec(r) : null;
    return m ? { x: +m[1]!, y: +m[2]!, width: +m[3]!, height: +m[4]! } : null;
  }

  /** Windows: the top-level window at the point; macOS: the frontmost window there. Both are the capture's id. */
  async isUnder(x: number, y: number, windowId: string): Promise<boolean | null> {
    const r = await this.query(`at ${int(x, -100_000, 100_000)} ${int(y, -100_000, 100_000)}`);
    // The helper answers this itself: no answer, no press.
    return !!r && /^\d{1,20}$/.test(r) && r === windowId;
  }

  async foreground(): Promise<Foreground | null> {
    const r = await this.query('fg');
    if (r === null) return null;
    // "<window id or 0> <app, base64> <title, base64>"
    const [id, app, title] = r.split(' ');
    const text = (s: string | undefined) => (s ? Buffer.from(s, 'base64').toString('utf8').slice(0, 200) : '');
    return { window: id && id !== '0' ? id : null, app: text(app), title: text(title) };
  }

  /** Windows and macOS: Electron's own reading follows the pointer everywhere. */
  async pointer(): Promise<null> {
    return null;
  }

  /** After the last batch (the releases) has been carried out: stdin closes, and the helper ends. */
  protected close(): void {
    const p = this.proc;
    this.proc = null;
    this.closing = true;
    if (p) {
      try {
        p.stdin.end();
      } catch {
        /* already gone */
      }
      setTimeout(() => p.kill(), 2_000).unref?.();
    }
  }
}

/**
 * Windows: SendInput from a PowerShell-hosted class. The process is made
 * per-monitor DPI aware, so every coordinate is a physical pixel on the
 * virtual desktop. A window running as administrator does not take input
 * from a program that is not (Windows' UIPI), and the secure desktop (UAC,
 * Ctrl+Alt+Delete, the sign-in screen) takes none at all.
 */
export const WINDOWS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
public static class WsInput {
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk; public ushort scan; public uint dwFlags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] static extern IntPtr SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  const uint MOVE = 0x1, LDOWN = 0x2, LUP = 0x4, RDOWN = 0x8, RUP = 0x10, MDOWN = 0x20, MUP = 0x40, WHEEL = 0x800, HWHEEL = 0x1000, VIRTUALDESK = 0x4000, ABSOLUTE = 0x8000;
  const uint KEYUP = 0x2, EXTENDED = 0x1, UNICODE = 0x4;
  static readonly IntPtr MARK = new IntPtr(0x5753524D);
  public static void Init() {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { SetProcessDPIAware(); }
  }
  static void Send(INPUT[] i) { SendInput((uint)i.Length, i, Marshal.SizeOf(typeof(INPUT))); }
  static INPUT Mouse(int dx, int dy, uint data, uint flags) {
    INPUT i = new INPUT(); i.type = 0; i.u.mi.dx = dx; i.u.mi.dy = dy; i.u.mi.mouseData = data; i.u.mi.dwFlags = flags; i.u.mi.extra = MARK; return i;
  }
  public static void Move(int x, int y) {
    int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
    if (vw < 2 || vh < 2) return;
    int nx = (int)Math.Round((x - vx) * 65535.0 / (vw - 1)), ny = (int)Math.Round((y - vy) * 65535.0 / (vh - 1));
    Send(new INPUT[] { Mouse(nx, ny, 0, MOVE | ABSOLUTE | VIRTUALDESK) });
  }
  public static void Button(string b, bool down) {
    uint f = b == "l" ? (down ? LDOWN : LUP) : b == "r" ? (down ? RDOWN : RUP) : (down ? MDOWN : MUP);
    Send(new INPUT[] { Mouse(0, 0, 0, f) });
  }
  public static void Wheel(int dx, int dy) {
    if (dy != 0) Send(new INPUT[] { Mouse(0, 0, unchecked((uint)(-dy)), WHEEL) });
    if (dx != 0) Send(new INPUT[] { Mouse(0, 0, unchecked((uint)dx), HWHEEL) });
  }
  public static void Key(ushort vk, bool ext, bool down) {
    INPUT i = new INPUT(); i.type = 1; i.u.ki.vk = vk; i.u.ki.dwFlags = (ext ? EXTENDED : 0) | (down ? 0 : KEYUP); i.u.ki.extra = MARK;
    Send(new INPUT[] { i });
  }
  public static void Text(string s) {
    foreach (char c in s) {
      if (c == '\n') { Key(0x0D, false, true); Key(0x0D, false, false); continue; }
      INPUT d = new INPUT(); d.type = 1; d.u.ki.scan = c; d.u.ki.dwFlags = UNICODE; d.u.ki.extra = MARK;
      INPUT u = d; u.u.ki.dwFlags = UNICODE | KEYUP;
      Send(new INPUT[] { d, u });
    }
  }
  public static string Rect(long id) {
    IntPtr h = new IntPtr(id);
    if (!IsWindow(h) || IsIconic(h)) return "-";
    RECT r;
    if (DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT))) != 0 && !GetWindowRect(h, out r)) return "-";
    return r.Left + " " + r.Top + " " + (r.Right - r.Left) + " " + (r.Bottom - r.Top);
  }
  public static string At(int x, int y) {
    POINT p; p.X = x; p.Y = y;
    IntPtr h = WindowFromPoint(p);
    if (h == IntPtr.Zero) return "0";
    IntPtr r = GetAncestor(h, 2);
    return (r == IntPtr.Zero ? h : r).ToInt64().ToString();
  }
  static string B64(string s) { return Convert.ToBase64String(Encoding.UTF8.GetBytes(s ?? "")); }
  public static string Foreground() {
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero) return "0 " + B64("") + " " + B64("");
    uint pid; GetWindowThreadProcessId(h, out pid);
    string app = "";
    try { app = Process.GetProcessById((int)pid).ProcessName; } catch { }
    StringBuilder t = new StringBuilder(256); GetWindowText(h, t, 256);
    return h.ToInt64() + " " + B64(app) + " " + B64(t.ToString());
  }
}
'@
[WsInput]::Init()
[Console]::Out.WriteLine('ready')
[Console]::Out.Flush()
$in = [Console]::In
while ($true) {
  $line = $in.ReadLine()
  if ($line -eq $null) { break }
  $p = $line.Split(' ')
  try {
    switch ($p[0]) {
      'm' { [WsInput]::Move([int]$p[1], [int]$p[2]) }
      'b' { [WsInput]::Button($p[1], $p[2] -eq '1') }
      'w' { [WsInput]::Wheel([int]$p[1], [int]$p[2]) }
      'k' { [WsInput]::Key([uint16]$p[1], $p[2] -eq '1', $p[3] -eq '1') }
      'u' { [WsInput]::Text([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p[1]))) }
      default {
        if ($p[0].StartsWith('?')) {
          $n = $p[0].Substring(1)
          $a = if ($p[1] -eq 'rect') { [WsInput]::Rect([long]$p[2]) } elseif ($p[1] -eq 'fg') { [WsInput]::Foreground() } elseif ($p[1] -eq 'at') { [WsInput]::At([int]$p[2], [int]$p[3]) } elseif ($p[1] -eq 'ack') { 'ok' } else { '-' }
          [Console]::Out.WriteLine("$n $a")
          [Console]::Out.Flush()
        }
      }
    }
  } catch { [Console]::Error.WriteLine($_.Exception.Message) }
}
`;

class WindowsInjector extends LineHelper {
  readonly method = 'sendinput' as const;
  protected platform(): 'win32' {
    return 'win32';
  }
  protected command() {
    const root = process.env.SystemRoot ?? 'C:\\Windows';
    // The script goes in as -EncodedCommand (UTF-16LE, base64): stdin stays free for the actions.
    return {
      file: join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(WINDOWS_SCRIPT, 'utf16le').toString('base64')],
    };
  }
}

/**
 * macOS: CGEvents posted from osascript's JavaScript. Needs WorkSuite in
 * Privacy & Security › Accessibility (macOS asks WorkSuite, the app that
 * started it). Moves while a button is held are sent as drags, and the
 * modifiers held are set on every key and click, as the system expects.
 */
export const MAC_SCRIPT = String.raw`
ObjC.import('Foundation'); ObjC.import('CoreGraphics'); ObjC.import('AppKit');
function run() {
  var out = $.NSFileHandle.fileHandleWithStandardOutput;
  function say(s) { out.writeData($(s + '\n').dataUsingEncoding($.NSUTF8StringEncoding)); }
  var input = $.NSFileHandle.fileHandleWithStandardInput;
  var buf = '';
  function line() {
    for (;;) {
      var i = buf.indexOf('\n');
      if (i >= 0) { var l = buf.slice(0, i); buf = buf.slice(i + 1); return l; }
      var d = input.availableData;
      if (d.length === 0) return null;
      buf += $.NSString.alloc.initWithDataEncoding(d, $.NSUTF8StringEncoding).js;
    }
  }
  var x = 0, y = 0, held = { l: false, r: false, m: false }, flags = 0;
  var FLAG = { 56: 0x20000, 60: 0x20000, 59: 0x40000, 62: 0x40000, 58: 0x80000, 61: 0x80000, 55: 0x100000, 54: 0x100000 };
  var cur = $.CGEventGetLocation($.CGEventCreate(null));
  x = cur.x; y = cur.y;
  function post(e) { if (flags) $.CGEventSetFlags(e, flags); $.CGEventPost(0, e); }
  function mouse(type, button) { post($.CGEventCreateMouseEvent(null, type, $.CGPointMake(x, y), button)); }
  function b64(s) { return $(s).dataUsingEncoding($.NSUTF8StringEncoding).base64EncodedStringWithOptions(0).js; }
  function text(s) {
    var se = Application('System Events');
    se.keystroke(s);
  }
  say('ready');
  for (;;) {
    var l = line();
    if (l === null) break;
    var p = l.split(' ');
    try {
      if (p[0] === 'm') {
        x = +p[1]; y = +p[2];
        if (held.l) mouse(6, 0); else if (held.r) mouse(7, 1); else if (held.m) mouse(27, 2); else mouse(5, 0);
      } else if (p[0] === 'b') {
        var down = p[2] === '1'; held[p[1]] = down;
        if (p[1] === 'l') mouse(down ? 1 : 2, 0); else if (p[1] === 'r') mouse(down ? 3 : 4, 1); else mouse(down ? 25 : 26, 2);
      } else if (p[0] === 'w') {
        var e = $.CGEventCreate(null);
        $.CGEventSetType(e, 22);
        $.CGEventSetIntegerValueField(e, 11, Math.round(-(+p[2]) / 40) || (+p[2] ? (+p[2] > 0 ? -1 : 1) : 0));
        $.CGEventSetIntegerValueField(e, 12, Math.round(-(+p[1]) / 40));
        $.CGEventSetLocation(e, $.CGPointMake(x, y));
        post(e);
      } else if (p[0] === 'k') {
        var code = +p[1], kd = p[2] === '1';
        if (FLAG[code]) flags = kd ? (flags | FLAG[code]) : (flags & ~FLAG[code]);
        post($.CGEventCreateKeyboardEvent(null, code, kd));
      } else if (p[0] === 'u') {
        text($.NSString.alloc.initWithDataEncoding($.NSData.alloc.initWithBase64EncodedStringOptions(p[1], 0), $.NSUTF8StringEncoding).js);
      } else if (p[0].charAt(0) === '?') {
        var n = p[0].slice(1), a = '-';
        if (p[1] === 'rect') {
          var list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(8, +p[2])));
          var w = list && list[0];
          if (w && w.kCGWindowBounds) a = Math.round(w.kCGWindowBounds.X) + ' ' + Math.round(w.kCGWindowBounds.Y) + ' ' + Math.round(w.kCGWindowBounds.Width) + ' ' + Math.round(w.kCGWindowBounds.Height);
        } else if (p[1] === 'ack') {
          a = 'ok';
        } else if (p[1] === 'at') {
          // Front to back: the first window with something on screen at the point is the one a click reaches.
          var px = +p[2], py = +p[3], all = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(17, 0))) || [];
          a = '0';
          for (var j = 0; j < all.length; j++) {
            var b = all[j].kCGWindowBounds;
            if (b && all[j].kCGWindowAlpha > 0 && px >= b.X && px < b.X + b.Width && py >= b.Y && py < b.Y + b.Height) { a = String(all[j].kCGWindowNumber); break; }
          }
        } else if (p[1] === 'fg') {
          var app = $.NSWorkspace.sharedWorkspace.frontmostApplication;
          var name = app ? app.localizedName.js : '';
          var pid = app ? app.processIdentifier : -1;
          var wins = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(17, 0))) || [];
          var front = null;
          for (var i = 0; i < wins.length; i++) { if (wins[i].kCGWindowLayer === 0 && wins[i].kCGWindowOwnerPID === pid) { front = wins[i]; break; } }
          a = (front ? front.kCGWindowNumber : 0) + ' ' + b64(name) + ' ' + b64(front && front.kCGWindowName ? front.kCGWindowName : '');
        }
        say(n + ' ' + a);
      }
    } catch (err) { }
  }
}
`;

class MacInjector extends LineHelper {
  readonly method = 'cgevent' as const;
  protected platform(): 'darwin' {
    return 'darwin';
  }
  protected command() {
    return { file: '/usr/bin/osascript', args: ['-l', 'JavaScript', '-e', MAC_SCRIPT] };
  }
}

/**
 * X11: xdotool, run once per batch of actions (one invocation chains them),
 * never more than one at a time. Moves waiting behind a running batch are
 * collapsed to the last one, so a fast mouse never builds a backlog.
 */
class X11Injector extends Batched implements Injector {
  readonly method = 'xdotool' as const;

  private readonly xwininfo = ['/usr/bin/xwininfo', '/usr/local/bin/xwininfo', '/run/current-system/sw/bin/xwininfo'].find((p) => existsSync(p)) ?? null;

  constructor(private readonly bin: string) {
    super();
  }

  async start(): Promise<boolean> {
    this.stopping = false;
    return (await this.run(['version'])) !== null;
  }

  protected async runBatch(batch: InputAction[]): Promise<void> {
    const args = xdotoolArgs(batch);
    if (args.length) await this.run(args);
  }

  protected close(): void {
    /* nothing runs between batches */
  }

  private run(args: string[]): Promise<string | null> {
    return this.runFile(this.bin, args);
  }

  private runFile(file: string, args: string[]): Promise<string | null> {
    return new Promise((resolve) => {
      let out = '';
      let p;
      try {
        p = spawn(file, args, { stdio: ['ignore', 'pipe', 'ignore'] });
      } catch {
        resolve(null);
        return;
      }
      const timer = setTimeout(() => p.kill(), 3_000);
      p.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
      p.on('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
      p.on('exit', (code) => {
        clearTimeout(timer);
        resolve(code === 0 ? out : null);
      });
    });
  }

  async windowBounds(windowId: string): Promise<Rect | null> {
    if (!/^\d{1,20}$/.test(windowId)) return null;
    const out = await this.run(['getwindowgeometry', '--shell', windowId]);
    if (!out) return null;
    const v = (k: string) => Number(new RegExp(`^${k}=(-?\\d+)$`, 'm').exec(out)?.[1]);
    const r = { x: v('X'), y: v('Y'), width: v('WIDTH'), height: v('HEIGHT') };
    return Object.values(r).every(Number.isFinite) ? r : null;
  }

  /**
   * X11: the pointer goes to the point (the click that follows would take it
   * there), and xdotool names the top-level window under it — with a window
   * manager, the frame it put around the app's window, not the app's own
   * (tried on openbox). So the shared window is under the pointer when it is
   * that window or inside that frame: `xwininfo` walks up from the shared
   * window to the root. Only the names of the shared window and its frames
   * are read on the way, never those of an app covering it. Without xwininfo
   * it cannot tell.
   */
  async isUnder(x: number, y: number, windowId: string): Promise<boolean | null> {
    let id = /^\d{1,10}$/.test(windowId) ? Number(windowId) : 0;
    if (!id) return false;
    const out = await this.run(['mousemove', String(int(x, 0, 100_000)), String(int(y, 0, 100_000)), 'getmouselocation', '--shell']);
    const top = out ? /^WINDOW=(\d{1,20})$/m.exec(out)?.[1] : undefined;
    if (!top) return null;
    if (top === windowId) return true;
    if (!this.xwininfo) return null;
    for (let depth = 0; depth < 8; depth++) {
      const info = await this.runFile(this.xwininfo, ['-children', '-id', `0x${id.toString(16)}`]);
      const root = info ? /^\s*Root window id: 0x([0-9a-f]{1,8})\b/m.exec(info)?.[1] : undefined;
      const parent = info ? /^\s*Parent window id: 0x([0-9a-f]{1,8})\b/m.exec(info)?.[1] : undefined;
      if (!root || !parent) return null;
      if (parent === root) return false;
      id = parseInt(parent, 16);
      if (String(id) === top) return true;
    }
    return false;
  }

  async foreground(): Promise<Foreground | null> {
    const id = (await this.run(['getactivewindow']))?.trim();
    if (!id || !/^\d+$/.test(id)) return id === undefined ? null : { window: null, app: '', title: '' };
    const [title, cls] = await Promise.all([this.run(['getwindowname', id]), this.run(['getwindowclassname', id])]);
    return { window: id, app: (cls ?? '').trim().slice(0, 200), title: (title ?? '').trim().slice(0, 200) };
  }

  async pointer(): Promise<{ x: number; y: number } | null> {
    const out = await this.run(['getmouselocation', '--shell']);
    const x = Number(out ? /^X=(-?\d{1,6})$/m.exec(out)?.[1] : NaN);
    const y = Number(out ? /^Y=(-?\d{1,6})$/m.exec(out)?.[1] : NaN);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }
}

// ── which helper, and whether it can work here ───────────────────────────

function findXdotool(): string | null {
  for (const p of ['/usr/bin/xdotool', '/usr/local/bin/xdotool', '/bin/xdotool', '/run/current-system/sw/bin/xdotool']) if (existsSync(p)) return p;
  return null;
}

export function displayServer(platform: string = process.platform, env: NodeJS.ProcessEnv = process.env): DisplayServer {
  if (platform === 'win32') return 'win32';
  if (platform === 'darwin') return 'quartz';
  if (env.XDG_SESSION_TYPE === 'wayland' || (env.WAYLAND_DISPLAY && env.XDG_SESSION_TYPE !== 'x11')) return 'wayland';
  return 'x11';
}

export function inputSupport(opts: { platform?: string; env?: NodeJS.ProcessEnv; accessibility?: boolean; exists?: (p: string) => boolean } = {}): InputSupport {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const exists = opts.exists ?? existsSync;
  const ds = displayServer(platform, env);
  if (ds === 'win32') {
    const ps = join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    return exists(ps) ? { displayServer: ds, available: true, method: 'sendinput', reason: null } : { displayServer: ds, available: false, method: null, reason: 'Windows PowerShell is missing on this computer, so it can be shared but not controlled.' };
  }
  if (ds === 'quartz') {
    if (!exists('/usr/bin/osascript')) return { displayServer: ds, available: false, method: null, reason: 'This Mac has no osascript, so it can be shared but not controlled.' };
    if (opts.accessibility === false) return { displayServer: ds, available: false, method: 'cgevent', reason: 'Allow WorkSuite under Privacy & Security › Accessibility to let others control this Mac.' };
    return { displayServer: ds, available: true, method: 'cgevent', reason: null };
  }
  if (ds === 'wayland') return { displayServer: ds, available: false, method: null, reason: 'This is a Wayland session, which does not let apps control the mouse and keyboard. Your screen can be shared but not controlled.' };
  const x = opts.exists ? ['/usr/bin/xdotool', '/usr/local/bin/xdotool'].some(exists) : findXdotool() !== null;
  return x ? { displayServer: ds, available: true, method: 'xdotool', reason: null } : { displayServer: ds, available: false, method: null, reason: 'Install xdotool (for example `sudo apt install xdotool`) to let others control this computer.' };
}

export function createInjector(platform: string = process.platform): Injector | null {
  if (platform === 'win32') return new WindowsInjector();
  if (platform === 'darwin') return new MacInjector();
  if (displayServer(platform) === 'x11') {
    const bin = findXdotool();
    return bin ? new X11Injector(bin) : null;
  }
  return null;
}
