import { type KeyPayload, type LockOutcome, type LockServer, type LockServerView, type LockVendor, lockServerProblem, lockServerSchema, VENDOR_LABEL } from '@shared/pms-locks';
import { DesktopError } from '../../main/errors';
import { logger } from '../../main/log';
import type { IpcRouter } from '../../ipc/router';
import type { SecureStore } from '../secure-store';
import { dormakaba } from './dormakaba';
import type { Runner } from './runner';
import { salto } from './salto';
import { vingcard } from './vingcard';

const log = logger('pms-locks');

/**
 * Hotel PMS door locks on this computer (PMS-DSK-002, PMS-KEY-002): the on-site lock server each property's front
 * desk talks to, and the `pmsLocks:*` channels.
 *
 *   config     per WorkSuite server and property, in the app's settings (`pmsLocks.servers`): vendor, connection,
 *              host, port, TLS and its pinned fingerprint, this desk's encoder, the interface user;
 *   secret     the interface password or API key, only in the OS keystore (`pmsLocks:<origin>#<property>`), never
 *              answered over IPC;
 *   run        WorkSuite's encoder payload, checked against this desk's settings (same property, vendor and
 *              connection, not expired), framed for the vendor's link and sent; the answer is ok / not and what
 *              the card says (rooms, validity, a serial), which the renderer reports to WorkSuite.
 *
 * Nothing here decides a key: the rooms, times, common areas and card count are the server's.
 */
export interface PmsLocksDeps {
  config: { getConfig<T>(key: string): T | undefined; setConfig(key: string, value: unknown): void; deleteConfig(key: string): void };
  secrets: Pick<SecureStore, 'get' | 'set' | 'delete' | 'deletePrefix' | 'getStatus'>;
  origin: () => string | null;
  /** Whether the signed-in person may open Hotel PMS. */
  allowed: () => boolean;
  now?: () => number;
}

const KEY = 'pmsLocks.servers';
const RUNNERS: Record<LockVendor, Runner> = { salto, vingcard, dormakaba };

type Stored = Record<string, LockServer>;

export class PmsLocks {
  constructor(private readonly d: PmsLocksDeps) {}

  private origin(): string {
    const o = this.d.origin();
    if (!o) throw new DesktopError('NOT_SIGNED_IN', 'Sign in to WorkSuite first.');
    return o;
  }

  private guard(): void {
    if (!this.d.allowed()) throw new DesktopError('APP_ACCESS_DENIED', "You don't have access to Hotel PMS.");
  }

  private all(): Stored {
    const v = this.d.config.getConfig<Stored>(KEY);
    return v && typeof v === 'object' ? v : {};
  }

  private slot(propertyId: number): string {
    return `${this.origin()}#${propertyId}`;
  }

  private secretName(propertyId: number): string {
    return `pmsLocks:${this.slot(propertyId)}`;
  }

  private server(propertyId: number): LockServer | null {
    const raw = this.all()[this.slot(propertyId)];
    if (!raw) return null;
    const parsed = lockServerSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  view(propertyId: number): LockServerView | null {
    this.guard();
    const s = this.server(propertyId);
    if (!s) return null;
    return { ...s, propertyId, hasSecret: this.d.secrets.get(this.secretName(propertyId)) !== null, persistent: this.d.secrets.getStatus().persistent };
  }

  set(input: { propertyId: number; server: LockServer; secret?: string; clearSecret?: boolean }): LockServerView {
    this.guard();
    const problem = lockServerProblem(input.server);
    if (problem) throw new DesktopError('CONFLICT', problem);
    const server: LockServer = { ...input.server, fingerprint: input.server.fingerprint || undefined };
    this.d.config.setConfig(KEY, { ...this.all(), [this.slot(input.propertyId)]: server });
    if (input.clearSecret) this.d.secrets.delete(this.secretName(input.propertyId));
    if (input.secret) this.d.secrets.set(this.secretName(input.propertyId), input.secret);
    log.info('lock server set', { propertyId: input.propertyId, vendor: server.vendor, connection: server.connection, tls: server.tls });
    return this.view(input.propertyId) as LockServerView;
  }

  forget(propertyId: number): void {
    this.guard();
    const all = this.all();
    delete all[this.slot(propertyId)];
    this.d.config.setConfig(KEY, all);
    this.d.secrets.delete(this.secretName(propertyId));
  }

  /** Every lock server and secret on this computer (a remote wipe). */
  wipe(): void {
    this.d.config.deleteConfig(KEY);
    this.d.secrets.deletePrefix('pmsLocks:');
  }

  status(): { properties: number[] } {
    const o = this.d.origin();
    if (!o || !this.d.allowed()) return { properties: [] };
    return {
      properties: Object.keys(this.all())
        .filter((k) => k.startsWith(`${o}#`))
        .map((k) => Number(k.slice(o.length + 1)))
        .filter((n) => Number.isInteger(n) && n > 0),
    };
  }

  async test(propertyId: number): Promise<LockOutcome> {
    this.guard();
    const s = this.server(propertyId);
    if (!s) return { ok: false, message: 'No lock server is set up on this computer for this property.' };
    try {
      return await RUNNERS[s.vendor].test(s, this.d.secrets.get(this.secretName(propertyId)));
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  /** Run WorkSuite's payload on this desk's lock server. Refuses one meant for another property, vendor or link, or too old. */
  async run(propertyId: number, payload: KeyPayload): Promise<LockOutcome> {
    this.guard();
    const s = this.server(propertyId);
    if (!s) return { ok: false, skipped: true, message: 'This computer has no door-lock server for this property. Set it up in Desk devices, or encode the card at a desk that has one.' };
    if (payload.property_id !== propertyId) throw new DesktopError('CONFLICT', 'This key is for another property.');
    if (payload.vendor !== s.vendor || payload.connection !== s.connection) {
      return { ok: false, skipped: true, message: `WorkSuite asks for ${VENDOR_LABEL[payload.vendor]} (${payload.connection}); this desk is set up for ${VENDOR_LABEL[s.vendor]} (${s.connection}).` };
    }
    const expires = Date.parse(payload.expires_at);
    if (Number.isFinite(expires) && expires < (this.d.now?.() ?? Date.now())) return { ok: false, message: 'This key request is too old. Issue the key again.' };
    const started = Date.now();
    try {
      const out = await RUNNERS[s.vendor].run(s, this.d.secrets.get(this.secretName(propertyId)), payload);
      log.info('key job', { vendor: s.vendor, operation: payload.operation, log: payload.log_id, ok: out.ok });
      return { ...out, encoder: `${s.encoder} on ${s.host}`, ms: Date.now() - started };
    } catch (e) {
      log.warn('key job failed', { vendor: s.vendor, operation: payload.operation, log: payload.log_id, error: (e as Error).message });
      return { ok: false, message: (e as Error).message, encoder: `${s.encoder} on ${s.host}` };
    }
  }

  register(router: IpcRouter): void {
    router.handle('pmsLocks:config', (input) => this.view(input.propertyId));
    router.handle('pmsLocks:configSet', (input) => this.set(input));
    router.handle('pmsLocks:forget', (input) => this.forget(input.propertyId));
    router.handle('pmsLocks:test', (input) => this.test(input.propertyId));
    router.handle('pmsLocks:run', (input) => this.run(input.propertyId, input.payload));
    router.handle('pmsLocks:status', () => this.status());
  }
}
