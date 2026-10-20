import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ Menu: { buildFromTemplate: () => ({}) }, Tray: class {}, nativeImage: { createFromPath: () => ({}) }, app: { getPath: () => '' } }));

import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/ipc/channels';
import { contract } from '@shared/ipc/contract';
import { SINHALA_EVENT_CHANNELS, SINHALA_INVOKE_CHANNELS } from '@shared/ipc/sinhala-channels';
import { officeCommandSchema } from '@shared/office';
import { SINHALA_MAX_TEXT, SINHALA_PLUGIN_GUID, sinhalaContract } from '@shared/sinhala';
import { OFFICE_HOST_JS } from '../../../electron/services/office-host-page';
import { OFFICE_PAGE, officeHostCsp, officeNavigationAllowed, officeRequestAllowed } from '../../../electron/security/office-policy';

/** Sinhala Tools' IPC (blueprint §6.2) and the Office tab it drives (§6.1, AC-SI-08). */
describe('the Sinhala IPC contract', () => {
  it('lists every channel in the allow-list and the contract, and nothing else', () => {
    for (const c of SINHALA_INVOKE_CHANNELS) {
      expect(INVOKE_CHANNELS).toContain(c);
      expect(contract).toHaveProperty(c);
    }
    expect(Object.keys(sinhalaContract).sort()).toEqual([...SINHALA_INVOKE_CHANNELS].sort());
    for (const e of SINHALA_EVENT_CHANNELS) expect(EVENT_CHANNELS).toContain(e);
  });

  it('needs a session on every channel, at the blueprint’s rates', () => {
    const rates: Record<string, number> = {
      'sinhala:detect': 30,
      'sinhala:convert': 30,
      'sinhala:convertFile': 2,
      'sinhala:job': 5,
      'sinhala:profiles': 2,
      'sinhala:fontsStatus': 1,
      'sinhala:fontsInstall': 1,
      'sinhala:clipboard': 5,
      'sinhala:jobAccept': 2,
      'sinhala:jobReject': 2,
    };
    for (const c of SINHALA_INVOKE_CHANNELS) {
      const spec = contract[c] as { session?: boolean; rate?: number };
      expect(spec.session, c).toBe(true);
      expect(typeof spec.rate, c).toBe('number');
      if (c in rates) expect(spec.rate, c).toBe(rates[c]);
    }
  });

  it('validates what a window sends', () => {
    const convert = contract['sinhala:convert'].input;
    expect(convert.parse({ text: 'abc' })).toEqual({ text: 'abc', direction: 'toUnicode' });
    expect(convert.safeParse({ text: 'x'.repeat(SINHALA_MAX_TEXT + 1) }).success).toBe(false);
    expect(convert.safeParse({ text: 'a', profile: '../etc' }).success).toBe(false);
    expect(convert.safeParse({ text: 'a', direction: 'sideways' }).success).toBe(false);
    expect(convert.safeParse({ text: 'a', extra: 1 }).success).toBe(false);
    const file = contract['sinhala:convertFile'].input;
    expect(file.safeParse({ source: { kind: 'drive', fileId: 3 } }).success).toBe(true);
    // A window never names a path: only handles the main process issued.
    expect(file.safeParse({ source: { kind: 'local', path: '/etc/passwd' } }).success).toBe(false);
    expect(file.safeParse({ source: { kind: 'local', handle: 'not-a-uuid' } }).success).toBe(false);
    const set = contract['sinhala:settingsSet'].input;
    expect(set.safeParse({ shortcut: 'CommandOrControl+Shift+U' }).success).toBe(true);
    expect(set.safeParse({ shortcut: 'U' }).success).toBe(false);
    expect(set.safeParse({ shortcut: null }).success).toBe(true);
  });

  it('marks converting a whole file as audited', () => {
    expect((contract['sinhala:convertFile'] as { sensitive?: boolean }).sensitive).toBe(true);
    expect((contract['sinhala:fontsInstall'] as { sensitive?: boolean }).sensitive).toBe(true);
    expect((contract['sinhala:jobAccept'] as { sensitive?: boolean }).sensitive).toBe(true);
    expect(contract['sinhala:jobAccept'].input.safeParse({ jobId: 'l-abc' }).success).toBe(false);
    expect(contract['sinhala:jobAccept'].input.safeParse({ jobId: 's-7' }).success).toBe(true);
  });
});

describe('the Office tab and the plugin (blueprint §6.1, WF-SI-01)', () => {
  it('takes sinhala.convertSelection and sinhala.convertDocument as OfficeCommands', () => {
    expect(officeCommandSchema.safeParse({ type: 'sinhala.convertSelection' }).success).toBe(true);
    expect(officeCommandSchema.safeParse({ type: 'sinhala.convertDocument' }).success).toBe(true);
    expect(officeCommandSchema.safeParse({ type: 'sinhala.runScript' }).success).toBe(false);
  });

  it('passes them to the editor frame on the Document Server’s origin only, naming the plugin', () => {
    expect(OFFICE_HOST_JS).toContain("case 'sinhala.convertSelection':");
    expect(OFFICE_HOST_JS).toContain("case 'sinhala.convertDocument':");
    expect(OFFICE_HOST_JS).toContain('new URL(apiUrl).origin');
    expect(OFFICE_HOST_JS).not.toMatch(/postMessage\([^)]*'\*'\)/);
    expect(OFFICE_HOST_JS).toContain(SINHALA_PLUGIN_GUID);
  });
});

describe('the Office CSP is unchanged in the default setup (AC-SI-08)', () => {
  const DS = 'https://docs.example.com';
  const WS = 'https://ws.example.com';
  const o = { documentServer: DS, worksuite: WS };

  it('is exactly what it was before Sinhala Tools: the plugin is served by the Document Server, same origin', () => {
    expect(officeHostCsp(o)).toBe(
      [
        "default-src 'none'",
        `script-src 'self' ${DS}`,
        "style-src 'self' 'unsafe-inline'",
        `img-src 'self' data: blob: ${DS} ${WS}`,
        `font-src ${DS} data:`,
        `connect-src ${DS} wss://docs.example.com`,
        `frame-src ${DS} blob:`,
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join('; '),
    );
  });

  it('lets the plugin load from the Document Server and nothing from elsewhere', () => {
    expect(officeRequestAllowed(`${DS}/sdkjs-plugins/${encodeURIComponent(SINHALA_PLUGIN_GUID)}/index.html`, o)).toBe(true);
    expect(officeNavigationAllowed(`${DS}/sdkjs-plugins/x/index.html`, false, o)).toBe(true);
    expect(officeRequestAllowed('https://plugins.example.org/sinhala/index.html', o)).toBe(false);
    expect(officeNavigationAllowed('https://plugins.example.org/sinhala/index.html', false, o)).toBe(false);
    expect(OFFICE_PAGE).toBe('wsoffice://editor/index.html');
  });

  it('office-policy.ts has no Sinhala origin of its own', () => {
    const src = readFileSync(join(__dirname, '../../../electron/security/office-policy.ts'), 'utf8');
    expect(src).not.toMatch(/sinhala|plugin/i);
  });
});

describe('the tray’s clipboard line (WF-SI-04)', () => {
  const model = {
    signedIn: true, userName: 'Nuwan', organization: 'Livezen', offline: false, pending: 0, error: null, unreadChat: 0, unreadMail: 0, unreadOther: 0,
    badge: true, notificationsPausedUntil: null, attendance: null, updateReady: false, remoteControl: null, webchatRinging: [], quickAsk: null, aiChanges: 0, apps: [],
  };
  const fn = () => undefined;
  const actions = { open: fn, openRoute: fn, clockIn: fn, clockOut: fn, pauseNotifications: fn, openSettings: fn, checkUpdates: fn, quit: fn, lock: fn, pauseRemoteControl: fn, stopRemoteControl: fn, joinWebchat: fn, quickAsk: fn, aiChanges: fn, ringingSettings: fn };

  it('is there, with its key, only while the organisation has the tools', async () => {
    const { trayMenu } = await import('../../../electron/tray/tray');
    const click = vi.fn();
    const on = trayMenu({ ...model, sinhala: { shortcut: 'CommandOrControl+Shift+U' } }, { ...actions, sinhalaClipboard: click });
    const line = on.find((i) => i.label === 'Convert clipboard to Unicode');
    expect(line).toBeDefined();
    // Linux trays show no keys (forPlatform); elsewhere the key is shown, never registered by the menu.
    if (process.platform !== 'linux') {
      expect(line?.accelerator).toBe('CommandOrControl+Shift+U');
      expect(line?.registerAccelerator).toBe(false);
    }
    (line?.click as () => void)();
    expect(click).toHaveBeenCalled();
    expect(trayMenu({ ...model, sinhala: null }, { ...actions, sinhalaClipboard: click }).some((i) => i.label === 'Convert clipboard to Unicode')).toBe(false);
    expect(trayMenu({ ...model, signedIn: false, sinhala: { shortcut: null } }, { ...actions, sinhalaClipboard: click }).some((i) => i.label === 'Convert clipboard to Unicode')).toBe(false);
  });
});
