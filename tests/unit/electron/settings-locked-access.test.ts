import { expect, it, vi } from 'vitest';
import type { Database } from '../../../electron/services/db';
import { normalizePolicy } from '../../../electron/services/policy';
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));
const { SettingsService } = await import('../../../electron/services/settings');
it('keeps private defaults, persists choices and enforces normalized organization restrictions', () => {
  let stored: unknown;
  const db = { getConfig: () => stored, setConfig: (_: string, value: unknown) => { stored = value; } } as unknown as Database;
  const settings = new SettingsService(db);
  expect(settings.effective()).toMatchObject({ lockedAnswerCalls: true, lockedShowCallerDetails: false, lockedAllowChat: false });
  settings.update({ lockedShowCallerDetails: true, lockedAllowChat: true });
  expect(new SettingsService(db).effective().lockedAllowChat).toBe(true);
  settings.setPolicy(normalizePolicy({ locked_answer_calls: false, locked_show_caller_details: false, locked_allow_chat: false }, true));
  expect(settings.effective()).toMatchObject({ lockedAnswerCalls: false, lockedShowCallerDetails: false, lockedAllowChat: false });
  expect(settings.locks().map(x => x.key)).toEqual(expect.arrayContaining(['lockedAnswerCalls', 'lockedShowCallerDetails', 'lockedAllowChat']));
  settings.update({ lockedAnswerCalls: true, lockedShowCallerDetails: true, lockedAllowChat: true });
  expect(settings.effective().lockedAllowChat).toBe(false);
});
