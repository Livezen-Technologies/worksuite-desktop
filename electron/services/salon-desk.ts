import type { SalonDeskInfo, SalonDeskPairInput, SalonDeskPairing } from '@shared/types';
import { DesktopError } from '../main/errors';
import type { HttpClient } from './http';
import type { SecureStore } from './secure-store';

/**
 * SalonMate's front desk: which desk this computer is, and the key that
 * proves it (WorkSuite's `salon_desks.key_hash`).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE KEY IS A CREDENTIAL, SO IT LIVES WHERE THE OTHER CREDENTIALS LIVE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Pairing hands the computer a key once. Every desk call — the day's copy,
 * the register, the outbox, a payment that names the desk — must carry it,
 * or the server answers as for a desk that was never approved. So it is kept
 * in the OS credential store (secure-store.ts), filed under the server it was
 * issued by, and it never reaches the renderer: pairing happens here, not
 * through the API proxy (which refuses `/desk/pair`), and the proxy adds the
 * key to SalonMate's own requests on the way out.
 *
 * The desk belongs to the computer, not to whoever is signed in: a counter PC
 * stays paired while the staff take turns at it. Signing out keeps it; a
 * remote wipe, or signing out with "remove WorkSuite's data", forgets it.
 */
const PREFIX = 'salon-desk:';
const SALON_API = '/api/salon/v1/';

type Secrets = Pick<SecureStore, 'get' | 'set' | 'delete' | 'deletePrefix'>;

interface Stored {
  desk_id: number;
  name: string;
  key: string;
}

export class SalonDesk {
  constructor(
    private readonly secrets: Secrets,
    private readonly http: Pick<HttpClient, 'request'>,
    /** The WorkSuite server this computer is signed in to. */
    private readonly origin: () => string | null,
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
      return typeof v.desk_id === 'number' && v.desk_id > 0 && typeof v.key === 'string' && v.key !== ''
        ? { desk_id: v.desk_id, name: typeof v.name === 'string' ? v.name : '', key: v.key }
        : null;
    } catch {
      return null;
    }
  }

  /** Which desk this computer is on this server — never the key. */
  pairing(): SalonDeskPairing | null {
    const s = this.read();
    return s ? { desk_id: s.desk_id, name: s.name } : null;
  }

  /** The key to send with a request, for SalonMate's own API only. */
  keyFor(apiPath: string): string | null {
    return apiPath.startsWith(SALON_API) ? (this.read()?.key ?? null) : null;
  }

  /**
   * Pair this computer (D01, DSK-02). The server answers with the desk and,
   * once, its key: the key is kept here and the desk alone goes back.
   */
  async pair(input: SalonDeskPairInput, deviceId: string, appVersion: string): Promise<{ desk: SalonDeskInfo; message: string | null }> {
    const slot = this.slot();
    if (!slot) throw new DesktopError('NOT_SIGNED_IN', 'No WorkSuite server is configured.');

    const data = await this.http.request<{ desk?: SalonDeskInfo; key?: unknown }>('POST', `${SALON_API}desk/pair`, {
      body: {
        location_id: input.location_id,
        name: input.name,
        device_id: deviceId,
        pos_register_id: input.pos_register_id ?? null,
        warehouse_id: input.warehouse_id ?? null,
        receipt_template: input.receipt_template ?? null,
        app_version: `desktop ${appVersion}`,
      },
    });

    const desk = data?.desk;
    if (!desk || typeof desk.id !== 'number' || typeof data.key !== 'string' || data.key === '') {
      throw new DesktopError('SERVER_ERROR', 'The server paired the desk but did not hand over its key. Pair it again.');
    }

    this.secrets.set(slot, JSON.stringify({ desk_id: desk.id, name: desk.name ?? input.name, key: data.key } satisfies Stored));

    return { desk, message: desk.status === 'active' ? `${desk.name} is paired.` : `${desk.name} is waiting for an owner to approve it.` };
  }

  /** Forget this computer's desk on this server ("Pair this computer again"). */
  forget(): void {
    const slot = this.slot();
    if (slot) this.secrets.delete(slot);
  }

  /** Forget every desk this computer holds (remote wipe). */
  forgetAll(): number {
    return this.secrets.deletePrefix(PREFIX);
  }
}
