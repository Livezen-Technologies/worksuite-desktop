import { isRestaurantPath, RESTAURANT_API, type RestaurantPairing } from '@shared/restaurant';
import { DesktopError } from '../../main/errors';
import type { HttpClient } from '../http';
import type { SecureStore } from '../secure-store';

/**
 * Which Restaurant terminal this computer is, and the key that proves it
 * (the server's `restaurant_terminals.key_hash`).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE KEY IS A CREDENTIAL, SO IT LIVES WHERE THE OTHER CREDENTIALS LIVE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `POST terminals/{id}/pair` hands the key over once ("shown only now") to a
 * person with `restaurant.device.manage`. It is kept in the OS credential
 * store (secure-store.ts), filed under the server it was issued by, and never
 * reaches a renderer: pairing is done here — the API proxy refuses the route —
 * and the key is added as `X-Terminal-Key` to the Restaurant API's requests on
 * the way out. With it the server knows which till sent an order, which
 * station a kitchen screen is, and which printers this computer hosts.
 *
 * The terminal belongs to the computer, not to whoever is signed in: a till
 * stays paired while the staff take turns at it. Signing out keeps it; a
 * remote wipe, or signing out with "remove WorkSuite's data", forgets it.
 */
const PREFIX = 'restaurant-terminal:';

type Secrets = Pick<SecureStore, 'get' | 'set' | 'delete' | 'deletePrefix'>;

interface Stored extends RestaurantPairing {
  key: string;
}

/** A terminal as the server's structure lists it (`Structure::shapeTerminal`). */
interface ServerTerminal {
  id: number;
  branch_id: number;
  name?: string;
  code?: string;
  mode?: string;
  station_id?: number | null;
  area_id?: number | null;
  counter_id?: number | null;
  pos_register_id?: number | null;
  active?: boolean;
}

const KEY = /^rt_[0-9a-f]{48}$/;

export class RestaurantTerminal {
  constructor(
    private readonly secrets: Secrets,
    private readonly http: Pick<HttpClient, 'request'>,
    /** The WorkSuite server this computer is signed in to. */
    private readonly origin: () => string | null,
    private readonly now: () => number = Date.now,
  ) {}

  private slot(): string | null {
    const o = this.origin();
    return o ? `${PREFIX}${o}` : null;
  }

  private read(): Stored | null {
    const slot = this.slot();
    const raw = slot ? this.secrets.get(slot) : null;
    if (!raw) return null;
    try {
      const v = JSON.parse(raw) as Partial<Stored>;
      if (typeof v.terminal_id !== 'number' || typeof v.org_id !== 'number' || typeof v.branch_id !== 'number' || typeof v.key !== 'string' || !KEY.test(v.key)) return null;
      return v as Stored;
    } catch {
      return null;
    }
  }

  /** Which terminal this computer is on this server — never the key. */
  pairing(): RestaurantPairing | null {
    const s = this.read();
    if (!s) return null;
    const { key: _key, ...rest } = s;
    return rest;
  }

  /** The key to send with a request, for the Restaurant API only. */
  keyFor(apiPath: string): string | null {
    return isRestaurantPath(apiPath) ? (this.read()?.key ?? null) : null;
  }

  /** The key, for the main process's own calls (sync, heartbeat, print agent). */
  key(): string | null {
    return this.read()?.key ?? null;
  }

  /**
   * Pair this computer as one of the branch's terminals. The terminal is read
   * back from the server's structure first, so what is kept beside the key —
   * its branch, mode and station — is the server's, not what a page said.
   */
  async pair(input: { org_id: number; branch_id: number; terminal_id: number }): Promise<{ pairing: RestaurantPairing; message: string }> {
    const slot = this.slot();
    if (!slot) throw new DesktopError('NOT_SIGNED_IN', 'No WorkSuite server is configured.');

    const tree = await this.http.request<{ terminals?: ServerTerminal[] }>('GET', `${RESTAURANT_API}/structure`, { query: { org: input.org_id, branch_id: input.branch_id } });
    const t = (tree?.terminals ?? []).find((x) => x.id === input.terminal_id);
    if (!t || t.branch_id !== input.branch_id) throw new DesktopError('NOT_FOUND', 'That terminal is not one of this branch’s. Choose it again.');
    if (t.active === false) throw new DesktopError('CONFLICT', 'That terminal is switched off on the server. Switch it on in the back office first.');

    const data = await this.http.request<{ device_key?: unknown }>('POST', `${RESTAURANT_API}/terminals/${t.id}/pair`, { query: { org: input.org_id }, body: {} });
    const key = data?.device_key;
    if (typeof key !== 'string' || !KEY.test(key)) {
      throw new DesktopError('SERVER_ERROR', 'The server paired the terminal but did not hand over its key. Pair it again.');
    }

    const pairing: RestaurantPairing = {
      terminal_id: t.id,
      org_id: input.org_id,
      branch_id: t.branch_id,
      name: t.name ?? `Terminal ${t.id}`,
      code: t.code ?? '',
      mode: t.mode ?? 'pos',
      station_id: t.station_id ?? null,
      area_id: t.area_id ?? null,
      counter_id: t.counter_id ?? null,
      pos_register_id: t.pos_register_id ?? null,
      paired_at: new Date(this.now()).toISOString(),
    };
    this.secrets.set(slot, JSON.stringify({ ...pairing, key } satisfies Stored));
    return { pairing, message: `This computer is ${pairing.name}.` };
  }

  /**
   * Stop being the terminal. With `revoke`, the key is also revoked on the
   * server (for someone with `restaurant.device.manage`), so a copy of it
   * elsewhere stops working at once; the local key goes either way.
   */
  async unpair(revoke: boolean): Promise<{ revoked: boolean; message: string | null }> {
    const s = this.read();
    let revoked = false;
    let message: string | null = null;
    if (s && revoke) {
      try {
        await this.http.request('POST', `${RESTAURANT_API}/terminals/${s.terminal_id}/revoke`, { query: { org: s.org_id }, body: {} });
        revoked = true;
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
    }
    const slot = this.slot();
    if (slot) this.secrets.delete(slot);
    return { revoked, message };
  }

  /** Forget every terminal this computer was (remote wipe). */
  forgetAll(): number {
    return this.secrets.deletePrefix(PREFIX);
  }
}
