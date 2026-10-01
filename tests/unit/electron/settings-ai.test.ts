import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../../../electron/services/db';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));

const { SettingsService } = await import('../../../electron/services/settings');

const dbWith = (preferences: unknown) => ({ getConfig: () => preferences, setConfig: () => undefined }) as unknown as Database;

describe('the AI Assistant settings (#61)', () => {
  it('start with the header button and its drawer, and no sound', () => {
    const ai = new SettingsService(dbWith(undefined)).effective().ai;
    expect(ai.display).toBe('drawer');
    expect(ai.sound).toBe(false);
  });

  it('give settings saved by an older version the new fields, keeping what was chosen', () => {
    const ai = new SettingsService(dbWith({ ai: { quickAsk: false, shortcut: 'Alt+Space', insert: false, dockAtStart: true, language: 'Tamil' } })).effective().ai;
    expect(ai).toEqual({ quickAsk: false, shortcut: 'Alt+Space', insert: false, dockAtStart: true, language: 'Tamil', display: 'drawer', sound: false, moduleAccess: { worksuite: {}, local: {} }, onlineFallback: true });
  });

  it('keep a chosen display mode and sound', () => {
    const ai = new SettingsService(dbWith({ ai: { quickAsk: true, shortcut: 'Alt+Space', insert: true, dockAtStart: false, language: 'Sinhala', display: 'widget', sound: true } })).effective().ai;
    expect(ai.display).toBe('widget');
    expect(ai.sound).toBe(true);
  });
});
