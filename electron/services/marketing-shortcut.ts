/**
 * The global "Next contact" key (WS-MKT-SRS-001 MKT-DSK-01, the D01 design): Ctrl+Shift+N (⌘⇧N on a Mac) takes the
 * next contact in my call queue from whatever app is in front, and brings WorkSuite forward on the agent workspace.
 *
 * Inside WorkSuite the same keys already mean "Move tab to new window" (the shell's shortcut and the application
 * menu's), so the key is held only while no WorkSuite window is in front — as the Live map and dashboard keys are —
 * and given back the moment one is. It is held only for somebody signed in, unlocked, with Marketing among their apps;
 * and once the server has said this person has no call queue at all (the pulse's `queue` is null), not for them
 * either: the key is Chrome's private window and many apps' "new" elsewhere, and nobody gives it up for nothing.
 */

/** Electron's accelerator for the key, as `globalShortcut` takes it. */
export const NEXT_CONTACT_SHORTCUT = 'CommandOrControl+Shift+N';

/** The same key as a menu shows it (the tray's "Next contact" line; shown, never registered there). */
export const NEXT_CONTACT_LABEL = 'CmdOrCtrl+Shift+N';

export interface NextContactState {
  signedIn: boolean;
  locked: boolean;
  /** Marketing is among the apps this person may open. */
  marketing: boolean;
  /** Whether the server says this person has a call queue: null until it has answered (or on a server a part behind). */
  agent: boolean | null;
  /** A WorkSuite window is in front: then the keys are the shell's. */
  focused: boolean;
}

/** Whether the key should be held now. */
export function wantNextContactKey(s: NextContactState): boolean {
  return s.signedIn && !s.locked && s.marketing && s.agent !== false && !s.focused;
}

/**
 * Where the key, the tray's line and a callback's "Call now" lead: My call queue's workspace with a new `claim`, which
 * takes the next contact (or gives back the one already in hand). `campaign` narrows it to one call campaign — a
 * callback's, so the callback that is due comes first.
 */
export function nextContactRoute(o: { nonce?: number; campaign?: number | null } = {}): string {
  const campaign = o.campaign && Number.isSafeInteger(o.campaign) && o.campaign > 0 ? `&call=${o.campaign}` : '';
  return `/marketing?view=queue&tab=work&claim=${o.nonce ?? Date.now()}${campaign}`;
}

export interface NextContactKeyDeps {
  /** `globalShortcut.register`: false when another app holds the key. */
  register: (accelerator: string, fn: () => void) => boolean;
  unregister: (accelerator: string) => void;
  state: () => NextContactState;
  /** The key was pressed: bring WorkSuite forward on the next contact. */
  press: () => void;
}

/** Holds the key while `wantNextContactKey` says so, and lets go of it otherwise. Never throws. */
export class NextContactKey {
  private held = false;

  constructor(private readonly deps: NextContactKeyDeps) {}

  /** Takes or gives back the key as things are now; whether it is held. */
  sync(): boolean {
    let want = false;
    try {
      want = wantNextContactKey(this.deps.state());
    } catch {
      want = false;
    }
    if (want === this.held) return this.held;
    if (!want) {
      this.release();
      return false;
    }
    try {
      // Another app holding it is not an error: WorkSuite simply does without it, and asks again at the next change.
      this.held = this.deps.register(NEXT_CONTACT_SHORTCUT, () => this.deps.press());
    } catch {
      this.held = false;
    }
    return this.held;
  }

  /** Gives the key back (focus, lock, sign-out, quit). */
  release(): void {
    if (!this.held) return;
    try {
      this.deps.unregister(NEXT_CONTACT_SHORTCUT);
    } catch {
      /* already gone */
    }
    this.held = false;
  }

  isHeld(): boolean {
    return this.held;
  }
}
