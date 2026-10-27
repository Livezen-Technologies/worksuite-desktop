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
    // Only the app's own scripts; WebAssembly may compile (the built-in Office editor), JavaScript eval may not.
    expect(directive(csp, 'script-src')).toBe("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it('lets a media server be reached over both wss and https, on its own host only', () => {
    const csp = contentSecurityPolicy({ media: ['wss://media.worksuite.lk'] });
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self' wss://media.worksuite.lk https://media.worksuite.lk");
  });

  it('allows no inline script, no plugins, no manifest, no base or form targets, and no framing of the app (D-G17)', () => {
    const csp = contentSecurityPolicy({ server: 'https://app.worksuite.lk', media: ['wss://media.worksuite.lk'] });
    expect(directive(csp, 'script-src-attr')).toBe("script-src-attr 'none'");
    for (const d of ['object-src', 'manifest-src', 'base-uri', 'form-action', 'frame-ancestors']) expect(directive(csp, d)).toBe(`${d} 'none'`);
    expect(directive(csp, 'script-src')).not.toMatch(/unsafe-inline|(?<!wasm-)unsafe-eval|\*|https?:/);
    expect(directive(csp, 'default-src')).toBe("default-src 'self'");
  });

  it("keeps inline styles, which mail and email previews need in their srcdoc frames (SECURITY.md; D-G17)", () => {
    // Removing it is a decision with its own tests: a mail body's <style> and style="" must still apply.
    expect(directive(contentSecurityPolicy(), 'style-src')).toBe("style-src 'self' 'unsafe-inline'");
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
