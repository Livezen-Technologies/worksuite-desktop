import { describe, expect, it } from 'vitest';
import { compareVersions, isBelowMinimum, parseVersion } from '@shared/version';
import { findDeepLinkInArgv, parseDeepLink } from '@shared/deeplink';
import { redact, redactString, redactUrl } from '@shared/redact';
import { backoffDelay, WindowLimiter } from '@shared/backoff';
import { canonicalJson } from '@shared/canonical-json';
import { attentionCount, connectionLabel, networkStatus, trayState, trayTooltip } from '@shared/network';
import { conflictedCopyName, numberedName, safeFileName } from '@shared/filename';
import { resolveWebLink } from '@shared/links';

describe('versions (FR-UPD-03)', () => {
  it('compares numerically, not as strings', () => {
    expect(compareVersions('2.0.10', '2.0.9')).toBe(1);
    expect(compareVersions('2.2.0', '2.10.0')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });
  it('ranks a release above its pre-releases', () => {
    expect(compareVersions('2.2.0', '2.2.0-beta.3')).toBe(1);
    expect(compareVersions('2.2.0-beta.10', '2.2.0-beta.9')).toBe(1);
    expect(compareVersions('2.2.0-alpha', '2.2.0-beta')).toBe(-1);
  });
  it('enforces a minimum version', () => {
    expect(isBelowMinimum('2.1.4', '2.2.0')).toBe(true);
    expect(isBelowMinimum('2.2.0', '2.2.0')).toBe(false);
    expect(isBelowMinimum('2.1.4', null)).toBe(false);
    expect(isBelowMinimum('2.1.4', 'garbage')).toBe(false);
  });
  it('rejects malformed versions', () => {
    expect(parseVersion('2.1')).toBeNull();
    expect(parseVersion('v2.1.3')?.minor).toBe(1);
  });
});

describe('deep links (FR-DL-01/02, WF-04)', () => {
  it('parses allow-listed routes', () => {
    const r = parseDeepLink('worksuite://crm/leads/128');
    expect(r.ok && r.link.route).toBe('/crm/leads/128');
    const inv = parseDeepLink('worksuite://invoice/INV-1002');
    expect(inv.ok && inv.link.module).toBe('billing');
    const home = parseDeepLink('worksuite://');
    expect(home.ok && home.link.route).toBe('/home');
  });
  it('carries window and organization hints', () => {
    const r = parseDeepLink('worksuite://chat/42?window=1&org=7');
    expect(r.ok && r.link.newWindow).toBe(true);
    expect(r.ok && r.link.organizationId).toBe('7');
  });
  it('refuses traversal, encodings, unknown routes and other schemes', () => {
    for (const bad of [
      'worksuite://crm/leads/../../etc/passwd',
      'worksuite://crm/leads/%2e%2e',
      'worksuite://crm/leads/1.txt',
      'worksuite://files/C:\\Windows',
      'worksuite://admin/delete-everything',
      'worksuite://crm/leads/1?action=delete',
      'https://crm/leads/1',
      'worksuite://user:pass@crm/leads/1',
      `worksuite://crm/leads/${'a'.repeat(3000)}`,
      'worksuite://crm/leads/<script>',
    ]) {
      expect(parseDeepLink(bad).ok, bad).toBe(false);
    }
  });
  it('finds the link in a second instance argv', () => {
    expect(findDeepLinkInArgv(['/app', '--flag', 'worksuite://mail'])).toBe('worksuite://mail');
    expect(findDeepLinkInArgv(['/app'])).toBeNull();
  });
});

describe('redaction (FR-DIAG-02, NFR-PRV-02)', () => {
  it('removes bearer tokens, JWTs, query secrets and email addresses', () => {
    const s = redactString('Authorization: Bearer abcdefghijklmnop12345 url=https://x/y?token=secret&x=1 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U mail hasarinda@livezen.lk');
    expect(s).not.toContain('abcdefghijklmnop12345');
    expect(s).not.toContain('secret');
    expect(s).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(s).not.toContain('hasarinda@');
    expect(s).toContain('livezen.lk');
  });
  it('removes secret-named fields and bodies from structures', () => {
    const r = redact({ password: 'hunter2', nested: { refresh_token: 'r', body: '<p>private</p>', ok: 'fine' }, list: [{ access_token: 'a' }] }) as Record<string, unknown>;
    expect(JSON.stringify(r)).not.toMatch(/hunter2|private|"r"|"a"/);
    expect((r.nested as Record<string, unknown>).ok).toBe('fine');
  });
  it('logs links without their query', () => {
    expect(redactUrl('worksuite://crm/leads/1?org=5')).toBe('worksuite://crm/leads/1?[…]');
  });
});

describe('backoff (FR-RT-02, §3.2)', () => {
  it('grows exponentially to a cap', () => {
    const o = { baseMs: 1000, maxMs: 60_000, jitter: 0 };
    expect(backoffDelay(0, o)).toBe(1000);
    expect(backoffDelay(3, o)).toBe(8000);
    expect(backoffDelay(20, o)).toBe(60_000);
  });
  it('jitters within the window', () => {
    for (let i = 0; i < 50; i++) {
      const d = backoffDelay(4, { baseMs: 1000, maxMs: 60_000, jitter: 0.5 });
      expect(d).toBeGreaterThanOrEqual(8000);
      expect(d).toBeLessThanOrEqual(16_000);
    }
  });
  it('limits restarts inside a window', () => {
    const l = new WindowLimiter(5, 600_000);
    for (let i = 0; i < 5; i++) expect(l.hit(1000 + i)).toBe(true);
    expect(l.hit(2000)).toBe(false);
    expect(l.hit(1000 + 700_000)).toBe(true);
  });
});

describe('canonical JSON', () => {
  it('sorts keys recursively and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[1,{"y":2,"z":1}]},"b":1}');
  });
});

describe('network and tray state (FR-OFF-05, FR-TRAY-06)', () => {
  it('derives the network status', () => {
    expect(networkStatus(false, 'connected', null)).toBe('OFFLINE');
    expect(networkStatus(true, 'connected', null)).toBe('ONLINE');
    expect(networkStatus(true, 'disabled', null)).toBe('ONLINE');
    expect(networkStatus(true, 'connecting', null)).toBe('RECONNECTING');
    expect(networkStatus(true, 'down', Date.now() - 120_000)).toBe('LIMITED');
  });
  it('orders tray states Error > Offline > Monitoring > Syncing > Unread > Normal', () => {
    expect(trayState({ error: true, offline: true, monitoring: true, syncing: true, unread: 3 })).toBe('error');
    expect(trayState({ error: false, offline: true, monitoring: true, syncing: true, unread: 3 })).toBe('offline');
    expect(trayState({ error: false, offline: false, monitoring: false, syncing: false, unread: 3 })).toBe('unread');
    expect(trayState({ error: false, offline: false, monitoring: false, syncing: false, unread: 0 })).toBe('normal');
  });
  it('lists every active state in the tooltip', () => {
    const t = trayTooltip({ error: null, offline: true, pending: 7, monitoring: null, syncing: 0, unreadChat: 8, unreadMail: 4, unreadOther: 0 });
    expect(t).toContain('Offline — 7 changes waiting');
    expect(t).toContain('12 unread (8 chat, 4 mail)');
  });
});

describe('file names', () => {
  it('makes server names safe on every platform', () => {
    expect(safeFileName('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(safeFileName('CON.txt')).toBe('_CON.txt');
    expect(safeFileName('a:b*c?.pdf')).toBe('a_b_c_.pdf');
    expect(safeFileName('   ')).toBe('download');
    expect(safeFileName('.hidden')).toBe('hidden');
  });
  it('numbers duplicates and names conflicted copies (FR-CNF-02)', () => {
    expect(numberedName('Report.pdf', 2)).toBe('Report (2).pdf');
    expect(conflictedCopyName('Report.docx', 'Hasarinda', new Date('2026-09-25T10:00:00Z'))).toBe("Report (Hasarinda's conflicted copy 2026-09-25).docx");
  });
});

describe('web links', () => {
  it('opens native apps in a tab and others in the browser', () => {
    expect(resolveWebLink('/tasks?task=12')).toEqual({ kind: 'tab', route: '/tasks?task=12', app: 'tasks' });
    expect(resolveWebLink('/crm/leads/5')).toEqual({ kind: 'tab', route: '/crm/leads/5', app: 'crm' });
    expect(resolveWebLink('/payroll/runs/3')).toEqual({ kind: 'browser', path: '/payroll/runs/3', app: 'payroll' });
    // An Expenses notification's link opens the claim here.
    expect(resolveWebLink('/expenses?claim=12')).toEqual({ kind: 'tab', route: '/expenses?claim=12', app: 'expenses' });
    expect(resolveWebLink('/finance?tab=journals')).toEqual({ kind: 'tab', route: '/finance?tab=journals', app: 'finance' });
    // Finance's printable report and public shared link are the web's own pages.
    expect(resolveWebLink('/finance/print/pl?company=2')).toEqual({ kind: 'browser', path: '/finance/print/pl?company=2', app: 'finance' });
    expect(resolveWebLink('/finance/shared/abc123')).toEqual({ kind: 'browser', path: '/finance/shared/abc123', app: 'finance' });
    expect(resolveWebLink('https://evil.example/x').kind).toBe('none');
    expect(resolveWebLink('//evil.example/x').kind).toBe('none');
  });
});

describe('the icon badge', () => {
  it('counts unread chat and notifications, not every unread email in every inbox', () => {
    expect(attentionCount(3, 5)).toBe(8);
    expect(attentionCount(0, 0)).toBe(0);
    expect(attentionCount(-1, Number.NaN)).toBe(0);
  });
});

it('distinguishes offline networking, server failure and verified realtime without inventing connected state (#123)', () => {
  expect(connectionLabel(null)).toBe('Checking connection…');
  expect(connectionLabel({ network: 'OFFLINE', realtime: 'down', internetOnline: false })).toBe('Internet Offline');
  expect(connectionLabel({ network: 'OFFLINE', realtime: 'down', internetOnline: true })).toBe('Server Unavailable');
  expect(connectionLabel({ network: 'RECONNECTING', realtime: 'connecting', internetOnline: true })).toBe('Reconnecting…');
  expect(connectionLabel({ network: 'ONLINE', realtime: 'idle', internetOnline: true })).toBe('Server reachable — live updates off');
  expect(connectionLabel({ network: 'ONLINE', realtime: 'connected', internetOnline: true })).toBe('Connected');
});
