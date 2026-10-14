import type { AccountRecord } from '@shared/accounts';
import type { RequestScope } from '../http';
import { allPartitions, partitionsFor, profilePaths, type AccountPartitions, type ProfilePaths } from './profile';

/**
 * The account the process is bound to now (Connection & Startup §1.3): its profile paths, partitions, and the leak
 * guard — an `AbortController` every request carries, and an `epoch` that moves on with every switch, so an answer
 * for the account that was open before is never written into the next one's database (`HttpClient.raw`).
 */
export class AccountScope implements RequestScope {
  private controller = new AbortController();
  readonly paths: ProfilePaths;
  readonly partitions: AccountPartitions;

  constructor(
    readonly account: AccountRecord,
    userData: string,
    readonly epoch: number,
  ) {
    this.paths = profilePaths(userData, account.profileDir);
    this.partitions = partitionsFor(account);
  }

  get id(): string {
    return this.account.id;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get aborted(): boolean {
    return this.controller.signal.aborted;
  }

  /** Every request under way for this account stops now. */
  abort(): void {
    if (!this.controller.signal.aborted) this.controller.abort(new Error('account switched'));
  }

  /** Every partition this account uses, the windows' first. */
  allPartitions(): string[] {
    return allPartitions(this.account);
  }
}

/**
 * Which account is bound, and the epoch. `bind` aborts the scope it replaces before the new one is visible, so a
 * request that started for the old account sees both the abort and the epoch change.
 */
export class ScopeHolder {
  private scope: AccountScope | null = null;
  private epochCounter = 0;

  constructor(private readonly userData: string) {}

  current(): AccountScope | null {
    return this.scope;
  }

  epoch(): number {
    return this.epochCounter;
  }

  /** The request guard for HttpClient: the current scope, or a never-aborted one before any account is bound. */
  requestScope(): RequestScope | null {
    return this.scope;
  }

  /** Ends the current scope (its requests are aborted) without binding another: `suspend`. */
  release(): AccountScope | null {
    const old = this.scope;
    old?.abort();
    this.epochCounter++;
    this.scope = null;
    return old;
  }

  bind(account: AccountRecord): AccountScope {
    this.scope?.abort();
    this.epochCounter++;
    this.scope = new AccountScope(account, this.userData, this.epochCounter);
    return this.scope;
  }

  /** The bound account's record changed (a name, a user): same scope, same epoch. */
  refresh(account: AccountRecord): void {
    if (!this.scope || this.scope.id !== account.id) return;
    const s = this.scope;
    (s as { account: AccountRecord }).account = account;
  }
}

/**
 * Everything every account partition gets, once (§7.2 `installShellSession`, risk 2): hardening, the app:// protocol,
 * the `__api` request hook, screen sharing, the permission handler, the proxy, and certificate pinning. A partition
 * is never used before it went through here — `ensure` is the only way the app gets one — and `installed()` lists
 * them so a test can check none was missed.
 */
export class ShellSessions<S> {
  private readonly done = new Map<string, S>();

  constructor(
    private readonly fromPartition: (partition: string) => S,
    private readonly install: (ses: S, partition: string) => void,
  ) {}

  /** The session for `partition`, set up on first use. */
  ensure(partition: string): S {
    const had = this.done.get(partition);
    if (had) return had;
    const ses = this.fromPartition(partition);
    this.install(ses, partition);
    this.done.set(partition, ses);
    return ses;
  }

  /** Every partition of an account, set up. */
  ensureAll(partitions: AccountPartitions | string[]): S[] {
    const list = Array.isArray(partitions) ? partitions : [partitions.shell, partitions.net, partitions.bulk];
    return list.map((p) => this.ensure(p));
  }

  installed(): string[] {
    return [...this.done.keys()];
  }

  has(partition: string): boolean {
    return this.done.has(partition);
  }

  /** A partition removed from this computer: set up again if it is ever used again. */
  forget(partition: string): void {
    this.done.delete(partition);
  }
}
