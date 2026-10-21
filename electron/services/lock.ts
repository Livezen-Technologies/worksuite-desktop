import { powerMonitor, systemPreferences } from 'electron';
import type { LockState } from '@shared/ipc/contract';
import { logger } from '../main/log';

const log = logger('lock');

/**
 * App lock (FR-SEC-04/05, WF-30).
 *
 * Locks after the configured minutes without interaction in any WorkSuite
 * window, when the user asks, and — by default — when the OS locks or
 * sleeps. While locked, every window shows the lock screen instead of its
 * content, IPC refuses everything not marked `whileLocked`, and notification
 * content is hidden; background services (notifications, transfers, realtime)
 * keep running.
 *
 * Unlock: the WorkSuite password (checked by the server), a PIN set on this
 * computer (lock-pin.ts, works offline), or Touch ID on
 * macOS where the hardware has it. Windows Hello needs a native module
 * (see BLOCKERS.md); the button is not offered where it cannot work.
 */
export class LockService {
  private locked = false;
  private reason: LockState['reason'] = null;
  private since: string | null = null;
  private lastActivity = Date.now();
  private timer: NodeJS.Timeout | null = null;
  private failureCount = 0;
  onChanged: (s: LockState) => void = () => undefined;
  minutes: () => number = () => 15;
  lockOnSystemLock: () => boolean = () => true;
  lockOnSleep: () => boolean = () => true;
  enabled: () => boolean = () => false;
  hasPin: () => boolean = () => false;
  pinLength: () => number | null = () => null;
  user: () => { name: string | null; email: string | null } = () => ({ name: null, email: null });
  /**
   * WorkSuite OS mode (os-mode.ts): the OS screen lock covers the app, so the app's own lock never engages — not on
   * a timer, not with the system, not when asked.
   */
  disabled = false;

  start(): void {
    this.lastActivity = Date.now();
    this.timer = setInterval(() => this.check(), 15_000);
    this.timer.unref?.();
    powerMonitor.on('lock-screen', () => {
      if (this.enabled() && this.lockOnSystemLock()) this.lock('system');
    });
    powerMonitor.on('suspend', () => {
      if (this.enabled() && this.lockOnSleep()) this.lock('system');
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  activity(): void {
    this.lastActivity = Date.now();
  }

  private check(): void {
    if (this.locked || !this.enabled()) return;
    const mins = this.minutes();
    // Immediate mode locks on loss of focus, not while the person is typing.
    if (mins <= 0) return;
    if (Date.now() - this.lastActivity >= mins * 60_000) this.lock('timeout');
  }

  biometric(): LockState['biometric'] {
    try {
      if (process.platform === 'darwin' && systemPreferences.canPromptTouchID()) return 'touch-id';
    } catch {
      /* not available */
    }
    return null;
  }

  state(): LockState {
    const u = this.user();
    const pin = this.hasPin();
    return {
      locked: this.locked,
      reason: this.reason,
      since: this.since,
      biometric: this.biometric(),
      pin,
      pinLength: pin ? this.pinLength() : null,
      userName: u.name,
      userEmail: u.email,
      lockMinutes: this.minutes(),
    };
  }

  isLocked(): boolean {
    return this.locked;
  }

  lock(reason: NonNullable<LockState['reason']>): LockState {
    if (this.disabled) return this.state();
    if (reason !== 'manual' && !this.enabled()) return this.state();
    if (!this.locked) {
      this.locked = true;
      this.reason = reason;
      this.since = new Date().toISOString();
      log.info('locked', { reason });
      this.onChanged(this.state());
    }
    return this.state();
  }

  unlock(): LockState {
    this.locked = false;
    this.reason = null;
    this.since = null;
    this.failureCount = 0;
    this.lastActivity = Date.now();
    this.onChanged(this.state());
    return this.state();
  }

  /** Counts failed password and PIN attempts; the caller signs out after too many. */
  recordFailure(): number {
    return ++this.failureCount;
  }

  failures(): number {
    return this.failureCount;
  }

  /** Something the lock screen shows changed (a PIN set or removed). */
  changed(): void {
    this.onChanged(this.state());
  }

  async unlockWithBiometric(): Promise<boolean> {
    if (this.biometric() !== 'touch-id') return false;
    try {
      await systemPreferences.promptTouchID('unlock WorkSuite');
      this.unlock();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Step-up before a signature (Board FR-SIG): the OS's own check where Electron can ask for it (Touch ID). Elsewhere
   * 'none' — the server then asks for its own step-up (password or MFA) with the signature.
   */
  async verifyPresence(reason: string): Promise<{ verified: boolean; method: 'touch-id' | 'none' }> {
    if (this.biometric() !== 'touch-id') return { verified: false, method: 'none' };
    try {
      await systemPreferences.promptTouchID(reason);
      return { verified: true, method: 'touch-id' };
    } catch {
      return { verified: false, method: 'touch-id' };
    }
  }

  /** Signed out or wiped: nothing left to protect. */
  reset(): void {
    if (this.locked) {
      this.locked = false;
      this.reason = null;
      this.since = null;
      this.onChanged(this.state());
    }
    this.failureCount = 0;
  }
}
