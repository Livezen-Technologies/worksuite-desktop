import { join } from 'node:path';
import type { PosLocalState } from '@shared/pos';
import { IDLE_LOCK_MS, ROLE_PERMISSIONS, type PosLocalUser } from '@shared/pos-local';
import { DesktopError } from '../../main/errors';
import type { IpcRouter } from '../../ipc/router';
import { PosLocalSales } from './sales';
import { PosLocalStore } from './store';

/**
 * The offline till's IPC (ENH-POS-01 §1, phase 1).
 *
 * Who is at the till is kept here, in the main process, and never in the renderer: a screen that asks to do
 * something is checked against the signed-in person's role every time, so a renderer that lies about its state
 * gets nowhere. Signing in is the only channel that answers before anybody is signed in.
 *
 * The till signs itself out after ten quiet minutes — a shop floor is not a desk — and the clock is restarted by
 * every call that does something, not merely by asking the state.
 */
export interface PosLocalDeps {
  /** Where the till's database lives: beside the app's data, never inside an account's profile. */
  dataDir: string;
  now?: () => number;
}

export class PosLocal {
  private store: PosLocalStore | null = null;
  private sales: PosLocalSales | null = null;
  private signedIn: PosLocalUser | null = null;
  private mustChange = false;
  private lastSeen = 0;
  private readonly now: () => number;

  constructor(private readonly deps: PosLocalDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Opened on first use, so a computer that never sells never makes the file. */
  private open(): PosLocalStore {
    if (!this.store) this.store = new PosLocalStore(join(this.deps.dataDir, 'pos-offline.sqlite'), this.now);
    return this.store;
  }

  /** The selling side of the same database, made beside it. */
  private till(): PosLocalSales {
    if (!this.sales) this.sales = new PosLocalSales(this.open(), this.now);
    return this.sales;
  }

  private idleOut(): void {
    if (this.signedIn && this.lastSeen && this.now() - this.lastSeen > IDLE_LOCK_MS) {
      this.signedIn = null;
      this.mustChange = false;
    }
  }

  private touch(): void {
    this.lastSeen = this.now();
  }

  state(): PosLocalState {
    this.idleOut();
    return {
      empty: this.open().empty,
      signedIn: this.signedIn,
      mustChangePassword: this.mustChange,
      permissions: this.signedIn ? [...ROLE_PERMISSIONS[this.signedIn.role]] : [],
    };
  }

  /** The signed-in person, refreshed from the database — a role changed by somebody else takes effect at once. */
  private who(): PosLocalUser {
    this.idleOut();
    if (!this.signedIn) throw new DesktopError('NOT_SIGNED_IN', 'Sign in to the till first.');
    const fresh = this.open().users().find((u) => u.id === this.signedIn!.id);
    if (!fresh || fresh.suspended) {
      this.signedIn = null;
      throw new DesktopError('NOT_SIGNED_IN', 'You are no longer signed in to this till.');
    }
    this.signedIn = fresh;
    this.touch();
    return fresh;
  }

  register(router: IpcRouter): void {
    router.handle('posLocal:state', () => this.state());

    router.handle('posLocal:addUser', ({ username, displayName, password, role }) => {
      const store = this.open();
      /* The first person needs nobody's permission; after that `who()` refuses anybody but an owner. */
      const by = store.empty ? null : this.who();
      const made = store.addUser({ username, displayName, password, role }, by);
      if (!by) {
        this.signedIn = made;
        this.mustChange = false;
        this.touch();
      }
      return this.state();
    });

    router.handle('posLocal:signIn', ({ username, password }) => {
      const out = this.open().signIn(username, password);
      if ('refused' in out) return out;
      this.signedIn = out.user;
      this.mustChange = out.mustChangePassword;
      this.touch();
      return this.state();
    });

    router.handle('posLocal:signOut', () => {
      this.signedIn = null;
      this.mustChange = false;
      return this.state();
    });

    router.handle('posLocal:users', () => {
      this.who();
      return this.open().users();
    });

    router.handle('posLocal:update', ({ userId, role, suspended }) => {
      const by = this.who();
      this.open().update(userId, { ...(role ? { role } : {}), ...(suspended === undefined ? {} : { suspended }) }, by);
      return this.open().users();
    });

    router.handle('posLocal:remove', ({ userId }) => {
      const by = this.who();
      this.open().remove(userId, by);
      return this.open().users();
    });

    router.handle('posLocal:changePassword', ({ oldPassword, newPassword }) => {
      const me = this.who();
      this.open().changePassword(me.id, oldPassword, newPassword);
      this.mustChange = false;
      return this.state();
    });

    router.handle('posLocal:resetPassword', ({ userId, newPassword }) => {
      const by = this.who();
      this.open().resetPassword(userId, newPassword, by);
      return this.open().users();
    });

    router.handle('posLocal:audits', (input) => {
      const me = this.who();
      if (me.role === 'cashier') throw new DesktopError('PERMISSION_DENIED', 'A cashier does not read the till’s log.');
      return this.open().audits(input?.limit);
    });

    /* ── Selling. Every one of these is somebody's doing, so `who()` runs first and the service checks the role. ── */
    router.handle('posLocal:settings', () => {
      this.who();
      return this.till().settings();
    });
    router.handle('posLocal:setSettings', (patch) => this.till().setSettings(patch, this.who()));
    router.handle('posLocal:products', (input) => {
      this.who();
      return this.till().products(input?.search ?? '');
    });
    router.handle('posLocal:barcode', ({ code }) => {
      this.who();
      return this.till().byBarcode(code);
    });
    router.handle('posLocal:saveProduct', (input) => this.till().saveProduct(input, this.who()));
    router.handle('posLocal:register', () => {
      this.who();
      return this.till().openRegister();
    });
    router.handle('posLocal:openRegister', ({ float }) => this.till().open(float, this.who()));
    router.handle('posLocal:closeRegister', ({ counted, note }) => this.till().close(counted, note ?? '', this.who()));
    router.handle('posLocal:cashMove', ({ direction, amount, reason }) => {
      this.till().cashMove(direction, amount, reason, this.who());
    });
    router.handle('posLocal:sell', (input) => {
      const me = this.who();
      if (this.mustChange) throw new DesktopError('PERMISSION_DENIED', 'Choose a new password before selling.');
      return this.till().sell(input, me);
    });
    router.handle('posLocal:void', ({ ref }) => {
      this.till().void(ref, this.who());
    });
    router.handle('posLocal:sale', ({ ref }) => {
      this.who();
      return this.till().sale(ref);
    });
    router.handle('posLocal:summary', () => {
      const me = this.who();
      if (!['owner', 'manager'].includes(me.role)) throw new DesktopError('PERMISSION_DENIED', 'A cashier does not read the day’s figures.');
      return this.till().summary();
    });
  }

  dispose(): void {
    this.store?.close();
    this.store = null;
    this.sales = null;
    this.signedIn = null;
  }
}
