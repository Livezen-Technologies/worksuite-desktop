import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appVersion, buildNumber, changelogSection, publishArgs, publishFiles, signingGaps, signingVerdict, tagProblem } from '../../../build/release-ci.mjs';

/** The release steps of build.yml (audit D-G01, D-G02): the tag guard, the signing gate and what goes to the Update Center. */

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('the tag guard', () => {
  it('takes only v<package.json version>', () => {
    expect(tagProblem('v0.2.283', '0.2.283')).toBeNull();
    expect(tagProblem('v0.2.284', '0.2.283')).toMatch(/not v0\.2\.283/);
    expect(tagProblem('0.2.283', '0.2.283')).not.toBeNull();
    expect(tagProblem('v0.2.283-beta.1', '0.2.283')).not.toBeNull();
  });

  it('reads the version from package.json', () => {
    expect(appVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('the build number', () => {
  it('is the patch number, pre-releases too', () => {
    expect(buildNumber('0.2.283')).toBe(283);
    expect(buildNumber('1.4.12-beta.2')).toBe(12);
  });
  it('refuses what the Update Center would', () => {
    expect(() => buildNumber('1.0.0')).toThrow(/above 0/);
    expect(() => buildNumber('v1.2.3')).toThrow(/not a version/);
  });
});

describe('the signing gate', () => {
  const mac = { MAC_CSC_LINK: 'p12', MAC_CSC_KEY_PASSWORD: 'pw', APPLE_API_KEY: 'k', APPLE_API_KEY_ID: 'id', APPLE_API_ISSUER: 'iss' };
  const azure = { AZURE_TENANT_ID: 't', AZURE_CLIENT_ID: 'c', AZURE_CLIENT_SECRET: 's', AZURE_TRUSTED_SIGNING_ACCOUNT: 'a', AZURE_TRUSTED_SIGNING_PROFILE: 'p', AZURE_TRUSTED_SIGNING_ENDPOINT: 'e' };

  it('macOS needs the Developer ID certificate and the notarization key', () => {
    expect(signingGaps('macOS', mac)).toEqual([]);
    expect(signingGaps('macOS', { ...mac, MAC_CSC_KEY_PASSWORD: '' })).toEqual([expect.stringMatching(/MAC_CSC_LINK/)]);
    expect(signingGaps('macOS', { ...mac, APPLE_API_ISSUER: '' })).toEqual([expect.stringMatching(/notarization/)]);
  });

  it('Windows takes an Authenticode certificate or the whole Azure Trusted Signing set', () => {
    expect(signingGaps('Windows', { WIN_CSC_LINK: 'p12', WIN_CSC_KEY_PASSWORD: 'pw' })).toEqual([]);
    expect(signingGaps('Windows', azure)).toEqual([]);
    expect(signingGaps('Windows', { ...azure, AZURE_CLIENT_SECRET: '' })).toHaveLength(1);
    expect(signingGaps('Windows', { WIN_CSC_LINK: 'p12' })).toHaveLength(1);
  });

  it('Linux needs GPG only on STABLE', () => {
    expect(signingGaps('Linux', { WS_CHANNEL: 'BETA' })).toEqual([]);
    expect(signingGaps('Linux', { WS_CHANNEL: 'STABLE' })).toHaveLength(1);
    expect(signingGaps('Linux', { WS_CHANNEL: 'STABLE', LINUX_GPG_PRIVATE_KEY: 'k' })).toEqual([]);
  });

  it('fails a release without its secrets, and only warns for any other build', () => {
    expect(signingVerdict('macOS', { WS_RELEASE: '1' }).level).toBe('error');
    expect(signingVerdict('Windows', { WS_RELEASE: '1' }).level).toBe('error');
    expect(signingVerdict('macOS', { WS_RELEASE: '0' }).level).toBe('warning');
    expect(signingVerdict('Windows', {}).level).toBe('warning');
    expect(signingVerdict('macOS', { WS_RELEASE: '1', ...mac }).level).toBe('ok');
  });
});

describe('what goes to the Update Center', () => {
  const v = '0.2.283';
  const artifacts = (names: string[]) => {
    const d = mkdtempSync(join(tmpdir(), 'uc-files-'));
    dirs.push(d);
    mkdirSync(join(d, v));
    for (const n of names) writeFileSync(join(d, v, n), 'x');
    return d;
  };
  const all = [`WorkSuite-Setup-${v}-x64.exe`, `WorkSuite-Setup-${v}-arm64.exe`, `WorkSuite-Setup-${v}.exe`, `WorkSuite-${v}-universal.dmg`, `WorkSuite-${v}-universal.zip`, `WorkSuite-${v}-x86_64.AppImage`, `WorkSuite-${v}-amd64.deb`, `WorkSuite-${v}-x86_64.rpm`, `WorkSuite-${v}-arm64.deb`];

  it('is the Windows x64 installer, the universal DMG for both Macs, and every Linux x64 format', () => {
    const d = artifacts(all);
    expect(publishFiles(d, v)).toEqual([
      `windows:x64:exe:${join(d, v, `WorkSuite-Setup-${v}-x64.exe`)}`,
      `macos:arm64:dmg:${join(d, v, `WorkSuite-${v}-universal.dmg`)}`,
      `macos:x64:dmg:${join(d, v, `WorkSuite-${v}-universal.dmg`)}`,
      `linux:x64:appimage:${join(d, v, `WorkSuite-${v}-x86_64.AppImage`)}`,
      `linux:x64:deb:${join(d, v, `WorkSuite-${v}-amd64.deb`)}`,
      `linux:x64:rpm:${join(d, v, `WorkSuite-${v}-x86_64.rpm`)}`,
    ]);
  });

  it('stops when one is missing, naming it', () => {
    const d = artifacts(all.filter((n) => !n.endsWith('.dmg')));
    expect(() => publishFiles(d, v)).toThrow(`WorkSuite-${v}-universal.dmg`);
  });

  it('carries the version, the patch as the build, the channel and the commit', () => {
    const args = publishArgs({ version: v, channel: 'BETA', commit: 'abc', files: ['windows:x64:exe:a.exe'], notes: 'n.md' });
    const at = (k: string) => args[args.indexOf(k) + 1];
    expect([at('--app'), at('--app-id'), at('--channel'), at('--version'), at('--build'), at('--commit'), at('--notes'), at('--file')]).toEqual(['desktop', 'lk.worksuite.desktop', 'BETA', v, '283', 'abc', 'n.md', 'windows:x64:exe:a.exe']);
  });

  it('takes the release notes from the version’s CHANGELOG section', () => {
    const log = `# Changelog\n\n## Unreleased\n\n- next\n\n## 0.2.283 — 2026-10-27\n\n### Fixed\n\n- a fix\n\n## 0.2.282 — 2026-10-26\n\n- older\n`;
    expect(changelogSection(log, '0.2.283')).toBe('### Fixed\n\n- a fix');
    expect(changelogSection(log, '0.2.28')).toBeNull();
    expect(changelogSection(log, '0.2.284')).toBeNull();
  });
});
