import type { AiPrefs, QuickAskContext } from '@shared/types';
import { logger } from '../main/log';
import type { InputAction, Injector } from './remote-control/input';

const log = logger('quick-ask');

/** What Quick Ask needs of the clipboard: Electron's (asynchronous since 44), or a stand-in in tests. */
export interface Clip {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
  /** Everything on it, every format, to put back as it was. */
  read(): Promise<unknown[]>;
  write(items: never[]): Promise<void>;
  /** X11's selection: the text selected now, without copying. */
  readonly selection: { readText(): Promise<string> };
}

export interface QuickAskDeps {
  clipboard: Clip;
  platform: NodeJS.Platform;
  /** The keyboard helper remote control uses, when this computer has one (and, on a Mac, Accessibility). */
  injector: () => Promise<Injector | null>;
  prefs: () => AiPrefs;
  /** Signed in, not locked, and allowed the writing assistant (`ai.write`). */
  allowed: () => boolean;
  register: (accelerator: string, fn: () => void) => boolean;
  unregister: (accelerator: string) => void;
  /** Open (or bring forward) the Quick Ask window. */
  show: () => void;
  hide: () => void;
  sleep?: (ms: number) => Promise<void>;
}

const MAX_TEXT = 8000;

/** The copy or paste chord for this system, pressed and released. */
export function chord(platform: NodeJS.Platform, letter: 'C' | 'V'): InputAction[] {
  const mod = platform === 'darwin' ? 'MetaLeft' : 'ControlLeft';
  return [
    // The Quick Ask shortcut's own modifiers may still be held: let them go first, so the app sees Ctrl+C and not Ctrl+Alt+C.
    { t: 'key', code: 'AltLeft', down: false },
    { t: 'key', code: 'ShiftLeft', down: false },
    { t: 'key', code: mod, down: true },
    { t: 'key', code: `Key${letter}`, down: true },
    { t: 'key', code: `Key${letter}`, down: false },
    { t: 'key', code: mod, down: false },
  ];
}

/**
 * Quick Ask (AI Assistant — Web + Desktop UIs, page 2): the shortcut opens a
 * small window over whatever app is in front, with the text selected there.
 *
 * The selection is read once, when the shortcut is pressed, and nothing else
 * on the screen is. On Linux (X11) the selection is read as it is; elsewhere
 * the app in front is asked to copy it (the keyboard helper presses the copy
 * shortcut) and the clipboard is put back as it was straight after. Without
 * the helper, Quick Ask offers what was copied last and says so.
 *
 * Insert is the reverse, and only ever on a click: the result goes onto the
 * clipboard, the paste shortcut is pressed in the app Quick Ask was opened
 * over, and the clipboard is put back.
 */
export class QuickAsk {
  private held: string | null = null;
  private ctx: QuickAskContext = { text: '', source: 'none', app: null, canInsert: false, note: null };
  private busy = false;

  constructor(private readonly deps: QuickAskDeps) {}

  /** Register the shortcut the settings name, or none when Quick Ask is off or not allowed. */
  sync(): void {
    const p = this.deps.prefs();
    const want = p.quickAsk && this.deps.allowed() ? p.shortcut : null;
    if (want === this.held) return;
    if (this.held) this.deps.unregister(this.held);
    this.held = null;
    if (want) {
      try {
        if (this.deps.register(want, () => void this.open())) this.held = want;
        else log.warn('shortcut taken', { accelerator: want });
      } catch (e) {
        log.warn('shortcut not registered', { error: String(e) });
      }
    }
  }

  /** The shortcut registered now, or null (taken by another app, off, or not allowed). */
  shortcut(): string | null {
    return this.held;
  }

  release(): void {
    if (this.held) this.deps.unregister(this.held);
    this.held = null;
  }

  context(): QuickAskContext {
    return this.ctx;
  }

  /** The shortcut, or the tray: read the selection, then show the window with it. */
  async open(): Promise<void> {
    if (this.busy || !this.deps.allowed()) return;
    this.busy = true;
    try {
      this.ctx = await this.capture();
    } catch (e) {
      log.warn('selection not read', { error: String(e) });
      this.ctx = { text: '', source: 'none', app: null, canInsert: false, note: 'The selection could not be read. Type or paste the text instead.' };
    } finally {
      this.busy = false;
    }
    this.deps.show();
  }

  private async capture(): Promise<QuickAskContext> {
    const { clipboard, platform } = this.deps;
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const insert = this.deps.prefs().insert;
    if (platform === 'linux') {
      // X11 keeps the selection as it is: nothing is pressed and the clipboard is not touched.
      const text = (await clipboard.selection.readText().catch(() => '')).slice(0, MAX_TEXT);
      const helper = insert ? await this.deps.injector() : null;
      const app = helper ? ((await helper.foreground().catch(() => null))?.app ?? null) : null;
      return { text, source: text ? 'selection' : 'none', app, canInsert: !!helper, note: text ? null : 'Nothing was selected. Type or paste the text instead.' };
    }
    const helper = await this.deps.injector();
    if (!helper) {
      const copied = (await clipboard.readText().catch(() => '')).slice(0, MAX_TEXT);
      return {
        text: copied,
        source: copied ? 'clipboard' : 'none',
        app: null,
        canInsert: false,
        note: platform === 'darwin' ? 'To read your selection, allow WorkSuite in System Settings › Privacy & Security › Accessibility. Using what you copied last.' : 'Your selection could not be read here. Using what you copied last.',
      };
    }
    const app = (await helper.foreground().catch(() => null))?.app ?? null;
    const before = await this.save();
    // A marker, so a copy that did nothing is not mistaken for the old clipboard.
    const marker = `\u2063ws-quick-ask-${Math.random().toString(36).slice(2)}`;
    await clipboard.writeText(marker);
    await sleep(120);
    helper.send(chord(platform, 'C'));
    let text = '';
    for (let i = 0; i < 12; i++) {
      await sleep(40);
      const now = await clipboard.readText().catch(() => marker);
      if (now !== marker) {
        text = now;
        break;
      }
    }
    await this.restore(before);
    text = text.slice(0, MAX_TEXT);
    return { text, source: text ? 'selection' : 'none', app, canInsert: insert, note: text ? null : 'Nothing was selected. Type or paste the text instead.' };
  }

  private async save(): Promise<{ items: unknown[] | null; text: string }> {
    const { clipboard } = this.deps;
    return { items: await clipboard.read().catch(() => null), text: await clipboard.readText().catch(() => '') };
  }

  /** The clipboard as it was before Quick Ask touched it: every format, or its text when the system gives no more. */
  private async restore(before: { items: unknown[] | null; text: string }): Promise<void> {
    const { clipboard } = this.deps;
    try {
      if (before.items && before.items.length) await clipboard.write(before.items as never[]);
      else await clipboard.writeText(before.text);
    } catch {
      await clipboard.writeText(before.text).catch(() => undefined);
    }
  }

  /** Insert: paste the result into the app Quick Ask was opened over, then put the clipboard back. */
  async insert(text: string): Promise<boolean> {
    if (!this.ctx.canInsert || !this.deps.prefs().insert) return false;
    const helper = await this.deps.injector();
    if (!helper) return false;
    const { clipboard, platform } = this.deps;
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const before = await this.save();
    await clipboard.writeText(text.slice(0, 20_000));
    this.deps.hide();
    // Give the app underneath the keyboard back before pressing paste in it.
    await sleep(180);
    helper.send(chord(platform, 'V'));
    await sleep(400);
    await this.restore(before);
    return true;
  }
}
