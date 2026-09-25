import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Column encryption for the local database (§7.2, NFR-SEC-03): AES-256-GCM
 * with a random 96-bit nonce per value. The key lives in OS secure storage
 * (see secure-store.ts); the database file on its own is unreadable.
 *
 * Format: "v1:" + base64(nonce ‖ tag ‖ ciphertext).
 */
const PREFIX = 'v1:';

export class Vault {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('vault key must be 32 bytes');
  }

  static generateKey(): Buffer {
    return randomBytes(32);
  }

  encrypt(value: unknown): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    const plain = Buffer.from(JSON.stringify(value ?? null), 'utf8');
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    return PREFIX + Buffer.concat([nonce, tag, body]).toString('base64');
  }

  /** Returns undefined when the value cannot be decrypted (wrong key, tampered). */
  decrypt<T = unknown>(stored: string | null | undefined): T | undefined {
    if (!stored || !stored.startsWith(PREFIX)) return undefined;
    try {
      const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
      const nonce = raw.subarray(0, 12);
      const tag = raw.subarray(12, 28);
      const body = raw.subarray(28);
      const decipher = createDecipheriv('aes-256-gcm', this.key, nonce);
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(body), decipher.final()]);
      return JSON.parse(plain.toString('utf8')) as T;
    } catch {
      return undefined;
    }
  }
}
