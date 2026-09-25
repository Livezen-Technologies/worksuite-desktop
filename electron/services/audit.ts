import { randomUUID } from 'node:crypto';
import { logger } from '../main/log';
import type { Database } from './db';
import type { HttpClient } from './http';
import type { Vault } from './vault';

const log = logger('audit');

/**
 * Audit of important desktop actions (§9.1, AC-29). Actions the server
 * already audits when its API is called — sign-in, file download, device
 * registration — are audited there. Actions that happen only on the device
 * (organization switch, local wipe, diagnostic export, sign-out with wipe)
 * are written to a local outbox and delivered to /desktop/v1/audit when the
 * server offers it. Harmless UI clicks are never recorded.
 */
export class AuditService {
  constructor(
    private readonly db: Database,
    private readonly vault: () => Vault,
    private readonly http: HttpClient,
    private readonly serverHasDesktopApi: () => boolean,
  ) {}

  record(userId: string | null, action: string, details: Record<string, unknown>): void {
    try {
      this.db.run(
        'INSERT INTO audit_outbox (id, user_id, action, details, created_at, sent_at) VALUES (?, ?, ?, ?, ?, NULL)',
        randomUUID(),
        userId,
        action,
        this.vault().encrypt(details),
        new Date().toISOString(),
      );
      log.info('audit', { action });
    } catch (e) {
      log.warn('audit write failed', { error: String(e) });
    }
  }

  async flush(): Promise<number> {
    if (!this.serverHasDesktopApi()) return 0;
    const rows = this.db.all<{ id: string; action: string; details: string; created_at: string }>('SELECT id, action, details, created_at FROM audit_outbox WHERE sent_at IS NULL ORDER BY created_at LIMIT 100');
    if (rows.length === 0) return 0;
    const events = rows.map((r) => ({ id: r.id, action: r.action, at: r.created_at, details: this.vault().decrypt(r.details) ?? {} }));
    try {
      await this.http.post('/desktop/v1/audit', { events });
      const now = new Date().toISOString();
      for (const r of rows) this.db.run('UPDATE audit_outbox SET sent_at = ? WHERE id = ?', now, r.id);
      return rows.length;
    } catch {
      return 0;
    }
  }

  recent(limit = 50): Array<{ action: string; at: string }> {
    return this.db.all<{ action: string; created_at: string }>('SELECT action, created_at FROM audit_outbox ORDER BY created_at DESC LIMIT ?', limit).map((r) => ({ action: r.action, at: r.created_at }));
  }
}
