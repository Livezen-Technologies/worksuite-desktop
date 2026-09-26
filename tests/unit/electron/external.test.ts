import { beforeEach, describe, expect, it, vi } from 'vitest';

const opened: string[] = [];
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', getVersion: () => '0.1.0', isPackaged: false },
  shell: { openExternal: async (u: string) => void opened.push(u) },
  dialog: { showMessageBox: async () => ({ response: 1 }) },
  session: {},
  BrowserWindow: { getAllWindows: () => [] },
}));

import { openExternalSafely } from '../../../electron/security/hardening';

describe('opening a link outside the app', () => {
  beforeEach(() => {
    opened.length = 0;
  });

  it('hands a phone number to the system to call, and nothing else dressed as one', async () => {
    expect(await openExternalSafely('tel:+94771234567')).toBe(true);
    expect(opened).toEqual(['tel:+94771234567']);
    for (const bad of ['tel:+9477;rm', 'tel:12', 'tel:+94 77 123', 'tel:javascript:alert(1)', 'tel:+94771234567?x=1']) {
      expect(await openExternalSafely(bad)).toBe(false);
    }
    expect(opened).toEqual(['tel:+94771234567']);
  });

  it('still refuses what is neither https, mail nor a call', async () => {
    for (const bad of ['http://example.com', 'file:///etc/passwd', 'sms:+94771234567', 'javascript:alert(1)']) {
      expect(await openExternalSafely(bad)).toBe(false);
    }
    expect(opened).toEqual([]);
  });
});
