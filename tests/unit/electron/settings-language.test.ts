import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../../../electron/services/db';
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));
import { SettingsService } from '../../../electron/services/settings';
function database() {
  const values = new Map<string, unknown>();
  return { getConfig: (key: string) => values.get(key), setConfig: (key: string, value: unknown) => values.set(key, structuredClone(value)) } as unknown as Database;
}
describe('per-user language preferences', () => {
  it('remembers first-time setup, isolates users and servers, and restores the choice across sessions', () => {
    const db = database();
    const service = new SettingsService(db);
    service.update({ language: 'si' });
    service.setUserLanguageScope('https://a.example', '1');
    expect(service.effective().language).toBe('si');
    service.update({ language: 'ta' });
    service.setUserLanguageScope('https://a.example', '2');
    expect(service.effective().language).toBe('si');
    service.update({ language: 'en' });
    service.setUserLanguageScope('https://a.example', '1');
    expect(service.effective().language).toBe('ta');
    service.setUserLanguageScope('https://b.example', '1');
    expect(service.effective().language).toBe('si');
    const restored = new SettingsService(db);
    restored.setUserLanguageScope('https://a.example', '1');
    expect(restored.effective().language).toBe('ta');
    restored.setUserLanguageScope(null, null);
    expect(restored.effective().language).toBe('si');
  });
  it('keeps device currency, theme and notification settings when changing language', () => {
    const service = new SettingsService(database());
    const before = service.effective();
    service.setUserLanguageScope('https://a.example', '1');
    service.update({ language: 'ta' });
    expect(service.effective()).toEqual({ ...before, language: 'ta' });
  });
});
