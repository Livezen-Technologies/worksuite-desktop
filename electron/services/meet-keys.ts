import { electronAccelerator, wantedMeetKeys, type MeetGlobalKey, type MeetKeyState } from '@shared/shortcuts';

/**
 * Meet's global keys (WS-MEET-ENH-01 D06): mute, camera, join the next
 * meeting, share a screen, start a meeting — held by the main process so they
 * work with WorkSuite behind whatever you are presenting, which is the only
 * reason a mute key is worth having.
 *
 * Three rules this follows, each learned from the keys that came before it
 * (`marketing-shortcut.ts`, the remote-control emergency chord):
 *
 *  - **Another app holding a key is not an error.** `globalShortcut.register`
 *    returns false; we do without that one key and ask again at the next
 *    change. Nothing here throws, because a key that cannot be taken must not
 *    stop a meeting starting.
 *  - **A key is held only while it can do something.** Mute and camera only
 *    while this computer is in a call; none of them while locked or signed
 *    out. A locked computer answering a key that turns a microphone on is a
 *    bug with a privacy cost.
 *  - **The accelerator is validated, not trusted.** It comes from a
 *    preference, so `electronAccelerator` refuses anything it does not
 *    recognise instead of handing the OS a string to guess at.
 */
export interface MeetKeysDeps {
  /** `globalShortcut.register`: false when another app holds the key. */
  register: (accelerator: string, fn: () => void) => boolean;
  unregister: (accelerator: string) => void;
  /** Whether anything holds this accelerator, ours or another app's. */
  isRegistered?: (accelerator: string) => boolean;
  state: () => MeetKeyState;
  /** The accelerator for each key, in `Mod+Shift+M` form, from preferences. */
  accelerators: () => Partial<Record<MeetGlobalKey, string>>;
  /** A key was pressed: tell the window that can act on it. */
  press: (id: MeetGlobalKey) => void;
  warn?: (message: string, detail: Record<string, unknown>) => void;
}

export class MeetKeys {
  /** The accelerator each key is currently held under. */
  private held = new Map<MeetGlobalKey, string>();

  constructor(private readonly deps: MeetKeysDeps) {}

  /**
   * Takes and gives back keys so that what is held matches what is wanted.
   * Returns the ids held afterwards. Called on every change worth reacting to
   * — a call starting or ending, signing in or out, locking, a preference
   * being saved — and is cheap when nothing has moved.
   */
  sync(): MeetGlobalKey[] {
    let want: MeetGlobalKey[] = [];
    let accelerators: Partial<Record<MeetGlobalKey, string>> = {};

    try {
      want = wantedMeetKeys(this.deps.state());
      accelerators = this.deps.accelerators();
    } catch (e) {
      // A state or preference read that fails means we do not know what is
      // wanted, and the safe answer to that is to hold nothing.
      this.deps.warn?.('meet keys: state unreadable', { error: String(e) });
      this.releaseAll();

      return [];
    }

    for (const [id, acc] of [...this.held.entries()]) {
      // Let go of a key that is no longer wanted, and of one whose accelerator
      // has been changed in Settings — the new one is taken below.
      if (!want.includes(id) || electronAccelerator(accelerators[id]) !== acc) this.release(id);
    }

    for (const id of want) {
      if (this.held.has(id)) continue;

      const acc = electronAccelerator(accelerators[id]);

      if (!acc) {
        this.deps.warn?.('meet keys: accelerator not usable', { id, value: accelerators[id] ?? null });
        continue;
      }

      // Two of our own keys set to the same accelerator: the first wins, and
      // the shortcuts page shows the clash. Registering the second would
      // silently steal the first one's key.
      if ([...this.held.values()].includes(acc)) continue;

      try {
        if (this.deps.register(acc, () => this.fire(id))) this.held.set(id, acc);
      } catch (e) {
        this.deps.warn?.('meet keys: register failed', { id, accelerator: acc, error: String(e) });
      }
    }

    return [...this.held.keys()];
  }

  private fire(id: MeetGlobalKey): void {
    try {
      this.deps.press(id);
    } catch (e) {
      this.deps.warn?.('meet keys: press failed', { id, error: String(e) });
    }
  }

  private release(id: MeetGlobalKey): void {
    const acc = this.held.get(id);

    if (acc === undefined) return;

    this.held.delete(id);

    try {
      this.deps.unregister(acc);
    } catch {
      /* already gone */
    }
  }

  /** Gives every key back: signing out, locking, quitting. */
  releaseAll(): void {
    for (const id of [...this.held.keys()]) this.release(id);
  }

  /** Which keys are held, for diagnostics and the shortcuts page. */
  holding(): MeetGlobalKey[] {
    return [...this.held.keys()];
  }
}
