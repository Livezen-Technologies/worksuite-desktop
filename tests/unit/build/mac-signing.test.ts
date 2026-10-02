import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const signing = require('../../../build/mac-signing.cjs') as {
  isRelease(env: Record<string, string | undefined>): boolean;
  parseCodesign(out: string): { identifier: string | null; teamId: string | null; authorities: string[]; adhoc: boolean; runtime: boolean };
  signingProblems(sig: ReturnType<typeof signing.parseCodesign>, env: Record<string, string | undefined>): string[];
  beforePack(ctx: { electronPlatformName: string }, env: Record<string, string | undefined>): Promise<void>;
  afterSign(ctx: unknown, env: Record<string, string | undefined>, run: (...a: unknown[]) => unknown): Promise<void>;
};

const DEVELOPER_ID = 'Identifier=lk.worksuite.desktop\nCodeDirectory v=20500 size=1 flags=0x10000(runtime) hashes=1\nAuthority=Developer ID Application: Livezen Technologies LLC (ABCDE12345)\nAuthority=Developer ID Certification Authority\nTeamIdentifier=ABCDE12345\n';
const ADHOC = 'Identifier=lk.worksuite.desktop\nCodeDirectory v=20400 size=1 flags=0x2(adhoc) hashes=1\nSignature=adhoc\nTeamIdentifier=not set\n';
const ctx = (dir = '/build/release/mac-universal') => ({ electronPlatformName: 'darwin', appOutDir: dir, packager: { appInfo: { productFilename: 'WorkSuite', id: 'lk.worksuite.desktop' } } });
const answer = (stderr: string, status = 0) => vi.fn(() => ({ status, stdout: '', stderr }));
const RELEASE = { GITHUB_REF: 'refs/tags/v0.3.0' };

afterEach(() => vi.restoreAllMocks());

describe('electron-builder configuration: macOS signing (worksuite-desktop#147)', () => {
  it('signs with the hardened runtime and entitlements for the app and everything inside it, and checks the result', () => {
    const config = require('../../../build/electron-builder.config.cjs');
    expect(config.appId).toBe('lk.worksuite.desktop');
    expect(config.mac).toMatchObject({ hardenedRuntime: true, entitlements: 'build/entitlements.mac.plist', entitlementsInherit: 'build/entitlements.mac.plist' });
    expect(config.beforePack).toBe(signing.beforePack);
    expect(config.afterSign).toBe(signing.afterSign);
  });

  it('uses CSC_NAME as the Developer ID identity when given', () => {
    const path = require.resolve('../../../build/electron-builder.config.cjs');
    const before = process.env.CSC_NAME;
    try {
      process.env.CSC_NAME = 'Developer ID Application: Livezen Technologies LLC (ABCDE12345)';
      delete require.cache[path];
      expect(require(path).mac.identity).toBe(process.env.CSC_NAME);
    } finally {
      if (before === undefined) delete process.env.CSC_NAME; else process.env.CSC_NAME = before;
      delete require.cache[path];
    }
  });

  it('treats tagged builds and WS_RELEASE_BUILD=1 as releases', () => {
    expect(signing.isRelease(RELEASE)).toBe(true);
    expect(signing.isRelease({ WS_RELEASE_BUILD: '1' })).toBe(true);
    expect(signing.isRelease({ GITHUB_REF: 'refs/heads/main' })).toBe(false);
  });

  it('refuses to start a macOS release without a Developer ID certificate, and warns for other builds', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(signing.beforePack({ electronPlatformName: 'darwin' }, RELEASE)).rejects.toThrow(/Refusing to build a macOS release.*CSC_LINK/);
    await expect(signing.beforePack({ electronPlatformName: 'darwin' }, { ...RELEASE, CSC_LINK: 'cert.p12' })).resolves.toBeUndefined();
    await expect(signing.beforePack({ electronPlatformName: 'darwin' }, { ...RELEASE, CSC_NAME: 'Developer ID Application: X (T)' })).resolves.toBeUndefined();
    await signing.beforePack({ electronPlatformName: 'darwin' }, {});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ad-hoc'));
    await expect(signing.beforePack({ electronPlatformName: 'linux' }, RELEASE)).resolves.toBeUndefined();
  });

  it('accepts a release signed with the Developer ID, Team ID and hardened runtime', async () => {
    const run = answer(DEVELOPER_ID);
    await expect(signing.afterSign(ctx(), { ...RELEASE, APPLE_TEAM_ID: 'ABCDE12345' }, run)).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledWith('/usr/bin/codesign', ['-dv', '--verbose=4', '/build/release/mac-universal/WorkSuite.app'], expect.any(Object));
  });

  it('fails an ad-hoc, unsigned or wrong-team release, and only warns outside a release', async () => {
    await expect(signing.afterSign(ctx(), RELEASE, answer(ADHOC))).rejects.toThrow(/ad-hoc signed.*Developer ID Application.*Team ID/);
    await expect(signing.afterSign(ctx(), RELEASE, answer('code object is not signed at all', 1))).rejects.toThrow(/not signed at all/);
    await expect(signing.afterSign(ctx(), { ...RELEASE, APPLE_TEAM_ID: 'OTHER' }, answer(DEVELOPER_ID))).rejects.toThrow(/APPLE_TEAM_ID OTHER/);
    await expect(signing.afterSign(ctx(), RELEASE, answer(DEVELOPER_ID.replace('flags=0x10000(runtime)', 'flags=0x0(none)')))).rejects.toThrow(/hardened runtime/);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(signing.afterSign(ctx(), {}, answer(ADHOC))).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ad-hoc'));
  });

  it('skips the single-architecture halves of a universal build and other platforms', async () => {
    const run = answer(ADHOC);
    await signing.afterSign(ctx('/build/release/mac-universal-x64-temp'), RELEASE, run);
    await signing.afterSign({ ...ctx(), electronPlatformName: 'win32' }, RELEASE, run);
    expect(run).not.toHaveBeenCalled();
  });
});
