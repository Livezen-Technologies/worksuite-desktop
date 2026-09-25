import { describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.1.0', isPackaged: false, enableSandbox: () => undefined, on: () => undefined },
  session: { defaultSession: {} },
  shell: {},
  dialog: {},
}));

import { contentSecurityPolicy, cspOrigin, mediaTypesAllowed } from '../../../electron/security/hardening';

const directive = (csp: string, name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';

/**
 * The shell's Content-Security-Policy (§3.3). It names, besides the app
 * itself, only the configured server (its signed /media links, for images and
 * voice notes) and the media servers it announced (calls and meetings).
 */
describe('content security policy', () => {
  it('with no server, nothing outside the app', () => {
    const csp = contentSecurityPolicy();
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self'");
    expect(directive(csp, 'img-src')).toBe("img-src 'self' data: blob:");
  });

  it('lets the server\'s media links show as images and play as audio, and nothing more', () => {
    const csp = contentSecurityPolicy({ server: 'https://app.worksuite.lk' });
    expect(directive(csp, 'img-src')).toContain('https://app.worksuite.lk');
    expect(directive(csp, 'media-src')).toContain('https://app.worksuite.lk');
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self'");
    expect(directive(csp, 'script-src')).toBe("script-src 'self'");
  });

  it('lets a media server be reached over both wss and https, on its own host only', () => {
    const csp = contentSecurityPolicy({ media: ['wss://media.worksuite.lk'] });
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self' wss://media.worksuite.lk https://media.worksuite.lk");
  });

  it('refuses anything that is not a bare origin', () => {
    expect(cspOrigin('https://x.example/path', ['https:'])).toBeNull();
    expect(cspOrigin('javascript:alert(1)', ['https:'])).toBeNull();
    expect(cspOrigin('https://u:p@x.example', ['https:'])).toBeNull();
    expect(cspOrigin("https://x.example'; script-src *", ['https:'])).toBeNull();
    expect(cspOrigin('http://localhost:8920', ['https:', 'http:'])).toBe('http://localhost:8920');
    expect(contentSecurityPolicy({ media: ['ftp://x.example', 'https://ok.example/a'] })).not.toMatch(/x\.example|ok\.example/);
  });
});

describe('media permissions', () => {
  it('the microphone and camera may be asked for; screen capture never through here (FR-COM-05)', () => {
    expect(mediaTypesAllowed(['audio'])).toBe(true);
    expect(mediaTypesAllowed(['audio', 'video'])).toBe(true);
    expect(mediaTypesAllowed(['video', 'display'] as string[])).toBe(false);
  });
});
