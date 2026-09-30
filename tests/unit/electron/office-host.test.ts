import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.1.0', isPackaged: false, enableSandbox: () => undefined, on: () => undefined },
  session: { defaultSession: {} },
  shell: {},
  dialog: {},
}));

import { HOST_SCRIPT, hostPage, hostPolicy } from '../../../electron/services/office/host-page';
import { allowFrameOrigin, frameOriginAllowed } from '../../../electron/security/hardening';

const directive = (csp: string, name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';

/**
 * WorkSuite Office's editor view (OO-DSK): its page runs one script of its
 * own and the Document Server's, frames the Document Server and nothing else.
 */
describe('the editor view’s page', () => {
  const csp = hostPolicy('https://docs.example.com');

  it('allows its own script by hash, and the Document Server — nothing else runs', () => {
    const hash = createHash('sha256').update(HOST_SCRIPT, 'utf8').digest('base64');
    expect(directive(csp, 'script-src')).toBe(`script-src 'sha256-${hash}' https://docs.example.com`);
    expect(csp).not.toContain('unsafe-eval');
    expect(directive(csp, 'script-src')).not.toContain('unsafe-inline');
    expect(directive(csp, 'default-src')).toBe("default-src 'none'");
  });

  it('frames and connects to the Document Server only; no forms, plug-ins or framing of itself', () => {
    expect(directive(csp, 'frame-src')).toBe('frame-src https://docs.example.com');
    expect(directive(csp, 'connect-src')).toBe('connect-src https://docs.example.com');
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('carries the script exactly as hashed', () => {
    expect(hostPage()).toContain(`<script>${HOST_SCRIPT}</script>`);
  });

  it('hands the editor the configuration as it came, adding only its events', () => {
    // The signed configuration's keys are copied as they are; `events` is the only one set here.
    expect(HOST_SCRIPT).toContain('config[k] = cmd.config[k]');
    expect(HOST_SCRIPT).toContain('config.events = events');
    expect(HOST_SCRIPT).not.toMatch(/token|localStorage|document\.cookie|fetch\(/);
  });
});

describe('frames the editor view may load', () => {
  it('only the Document Server it was given, for that view only', () => {
    const listeners: Record<string, () => void> = {};
    const view = { id: 9001, once: (ev: string, cb: () => void) => (listeners[ev] = cb) } as unknown as Electron.WebContents;
    const other = { id: 9002 };
    allowFrameOrigin(view, 'https://docs.example.com');
    expect(frameOriginAllowed(view, 'https://docs.example.com/web-apps/apps/documenteditor/main/index.html')).toBe(true);
    expect(frameOriginAllowed(view, 'blob:https://docs.example.com/abc')).toBe(true);
    expect(frameOriginAllowed(view, 'https://evil.example.net/')).toBe(false);
    expect(frameOriginAllowed(other, 'https://docs.example.com/')).toBe(false);
    listeners.destroyed?.();
    expect(frameOriginAllowed(view, 'https://docs.example.com/')).toBe(false);
  });
});

describe('the editor view’s preload', () => {
  it('exposes only the editor bridge — never the shell’s window.worksuite or invoke', () => {
    const src = readFileSync(resolve(__dirname, '../../../electron/preload/office-host.ts'), 'utf8');
    expect(src).toContain("exposeInMainWorld('officeHost'");
    expect(src).not.toContain("'worksuite'");
    expect(src).not.toContain('invoke(');
    expect(src).not.toMatch(/from '@shared\/ipc/);
  });
});
