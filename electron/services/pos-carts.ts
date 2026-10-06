import { heldWithin, POS_MAX_OPEN, posCartsSchema, type PosCarts } from '@shared/pos';
import type { Vault } from './vault';

/**
 * POS: the sales open at the counter and the held ones (shared/pos.ts `PosCarts`), kept for the till so a restart,
 * a crash or a cashier change keeps them. They hold customers' names and contact details, so they are sealed
 * (AES-256-GCM, the database's vault) in the config table, per server and till — and only where the desktop policy
 * lets this computer keep data offline; otherwise in memory until the app closes. A held sale older than a day is
 * dropped whenever they are read. A wipe, or forgetting the till, removes them.
 */
const KEY = 'pos-carts';

export interface PosCartsDeps {
  config: { getConfig<T>(key: string): T | undefined; setConfig(key: string, value: unknown): void; deleteConfig(key: string): void };
  vault: () => Vault;
  /** `${origin}|${terminal}` of the till paired now, or null. */
  scope: () => string | null;
  /** Whether the policy lets this computer keep data on disk. */
  keep: () => boolean;
  now?: () => number;
}

export class PosCartsStore {
  private readonly memory = new Map<string, PosCarts>();

  constructor(private readonly d: PosCartsDeps) {}

  private all(): Record<string, string> {
    const v = this.d.config.getConfig<Record<string, string>>(KEY);
    return v && typeof v === 'object' ? v : {};
  }

  read(): PosCarts | null {
    const scope = this.d.scope();
    if (!scope) return null;
    const raw = this.memory.get(scope) ?? (this.d.keep() ? this.d.vault().decrypt<unknown>(this.all()[scope]) : undefined);
    const parsed = posCartsSchema.safeParse(raw);
    if (!parsed.success) return null;
    const c = parsed.data;
    const held = heldWithin(c.held, (this.d.now ?? Date.now)());
    return { sales: c.sales.slice(0, POS_MAX_OPEN), active: c.sales.some((s) => s.id === c.active) ? c.active : c.sales[0]!.id, held };
  }

  save(c: PosCarts): boolean {
    const scope = this.d.scope();
    if (!scope) return false;
    const all = this.all();
    if (this.d.keep()) {
      this.memory.delete(scope);
      this.d.config.setConfig(KEY, { ...all, [scope]: this.d.vault().encrypt(c) });
    } else {
      this.memory.set(scope, c);
      if (scope in all) {
        delete all[scope];
        this.d.config.setConfig(KEY, all);
      }
    }
    return true;
  }

  /** The till is forgotten (or paired with another): its open and held sales go with it. */
  forget(scope: string): void {
    this.memory.delete(scope);
    const all = this.all();
    if (scope in all) {
      delete all[scope];
      this.d.config.setConfig(KEY, all);
    }
  }

  forgetAll(): void {
    this.memory.clear();
    this.d.config.deleteConfig(KEY);
  }
}
