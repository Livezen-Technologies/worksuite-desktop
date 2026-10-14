import { safeStorage } from 'electron';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { SecureStorageStatus } from '@shared/types';
import { logger } from '../main/log';

const log = logger('secure-store');

/**
 * Secrets — refresh token, device token and key, database key — are held
 * only through the OS credential store (FR-AUTH-02, FR-SEC-03):
 *
 *   Windows  DPAPI            macOS  Keychain       Linux  Secret Service / KWallet
 *
 * Electron's safeStorage encrypts with a key that the OS store protects; the
 * ciphertext on disk is useless without that key.
 *
 * On Linux without a keyring, safeStorage silently falls back to a
 * hard-coded key ("basic_text"), which is obfuscation, not protection. In
 * that case nothing is written to disk at all: secrets stay in memory and the
 * user signs in again next launch. The UI says so rather than pretending.
 */
export class SecureStore {
  private memory = new Map<string, string>();
  private status: SecureStorageStatus = { available: false, backend: 'unknown', persistent: false };

  constructor(private file: string) {}

  /**
   * Another account's secrets file (Connection & Startup §1.3): what was read into memory is dropped, and the
   * next read comes from `file`. The OS store's status is the computer's, so it stays.
   */
  rebind(file: string): void {
    this.memory.clear();
    this.file = file;
  }

  /** The secrets file this store reads and writes. */
  get path(): string {
    return this.file;
  }

  init(): SecureStorageStatus {
    let backend = process.platform === 'darwin' ? 'keychain' : process.platform === 'win32' ? 'dpapi' : 'unknown';
    let available = false;
    try {
      available = safeStorage.isEncryptionAvailable();
      if (process.platform === 'linux') {
        backend = safeStorage.getSelectedStorageBackend();
        if (backend === 'basic_text' || backend === 'unknown') available = false;
      }
    } catch (e) {
      log.warn('secure storage probe failed', e);
      available = false;
    }
    this.status = { available, backend, persistent: available };
    if (!available) log.warn('OS secure storage unavailable; secrets will be kept in memory only', { backend });
    return this.status;
  }

  getStatus(): SecureStorageStatus {
    return this.status;
  }

  private readAll(): Record<string, string> {
    if (!this.status.persistent || !existsSync(this.file)) return {};
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
    } catch (e) {
      log.error('secrets file unreadable; ignoring it', e);
      return {};
    }
  }

  private writeAll(all: Record<string, string>): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(all), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  get(name: string): string | null {
    if (this.memory.has(name)) return this.memory.get(name) ?? null;
    if (!this.status.persistent) return null;
    const enc = this.readAll()[name];
    if (!enc) return null;
    try {
      const value = safeStorage.decryptString(Buffer.from(enc, 'base64'));
      this.memory.set(name, value);
      return value;
    } catch (e) {
      // The OS key changed (profile moved to another machine, keychain reset).
      log.warn('secret could not be decrypted; discarding', { name, error: String(e) });
      this.delete(name);
      return null;
    }
  }

  set(name: string, value: string): void {
    this.memory.set(name, value);
    if (!this.status.persistent) return;
    const all = this.readAll();
    all[name] = safeStorage.encryptString(value).toString('base64');
    this.writeAll(all);
  }

  delete(name: string): void {
    this.memory.delete(name);
    if (!this.status.persistent) return;
    const all = this.readAll();
    if (name in all) {
      delete all[name];
      this.writeAll(all);
    }
  }

  /** Removes every secret whose name starts with the prefix (wipe, sign-out). */
  deletePrefix(prefix: string): number {
    let n = 0;
    for (const key of [...this.memory.keys()]) {
      if (key.startsWith(prefix)) {
        this.memory.delete(key);
        n++;
      }
    }
    if (this.status.persistent) {
      const all = this.readAll();
      for (const key of Object.keys(all)) {
        if (key.startsWith(prefix)) {
          delete all[key];
          n++;
        }
      }
      this.writeAll(all);
    }
    return n;
  }
}
