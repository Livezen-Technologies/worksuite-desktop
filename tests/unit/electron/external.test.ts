import { beforeEach, describe, expect, it, vi } from 'vitest';

const opened: string[] = [];
/** The next link the system has no application for. */
const missing = { next: false };
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', getVersion: () => '0.1.0', isPackaged: false },
  shell: {
    openExternal: async (u: string) => {
      if (missing.next) {
        missing.next = false;
        throw new Error('No application knows how to open this URL');
      }
      opened.push(u);
    },
  },
  dialog: { showMessageBox: async () => ({ response: 1 }) },
  session: {},
  BrowserWindow: { getAllWindows: () => [] },
}));

import { openExternalSafely, rustDeskId } from '../../../electron/security/hardening';

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

  it('hands a RustDesk connect link to RustDesk (FR-WSP-08): an ID and nothing else', async () => {
    expect(await openExternalSafely('rustdesk://connect/1482667019')).toBe(true);
    expect(await openExternalSafely('rustdesk://connect/acme-roshan')).toBe(true);
    expect(opened).toEqual(['rustdesk://connect/1482667019', 'rustdesk://connect/acme-roshan']);
    for (const bad of [
      'rustdesk://config/=0nIxRWZ0NWZ',
      'rustdesk://1482667019',
      'rustdesk://connect/12345',
      'rustdesk://connect/1482667019?password=hunter2',
      'rustdesk://connect/1482667019/extra',
      'rustdesk://connect/9acme',
      'rustdesk://connect/../../etc',
    ]) {
      expect(await openExternalSafely(bad)).toBe(false);
    }
    expect(opened).toHaveLength(2);
    expect(rustDeskId('rustdesk://connect/1482667019')).toBe('1482667019');
    expect(rustDeskId('rustdesk://connect/acme_roshan-mac')).toBe('acme_roshan-mac');
  });

  it('says false when there is no RustDesk on this computer to take the link', async () => {
    missing.next = true;
    expect(await openExternalSafely('rustdesk://connect/1482667019')).toBe(false);
  });

  it('still refuses what is neither https, mail nor a call', async () => {
    for (const bad of ['http://example.com', 'file:///etc/passwd', 'sms:+94771234567', 'javascript:alert(1)']) {
      expect(await openExternalSafely(bad)).toBe(false);
    }
    expect(opened).toEqual([]);
  });
});
