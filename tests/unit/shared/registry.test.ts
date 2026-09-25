import { describe, expect, it } from 'vitest';
import { APP_CATALOGUE, isAppVisible, visibleApps } from '@shared/apps';
import { CONTRACT_VERSION, validateManifest } from '@shared/manifest';
import { channelAccepts, installableKinds, isNewer, selectArtifact, type ReleaseManifest } from '@shared/release';

const def = (id: string) => APP_CATALOGUE.find((a) => a.id === id)!;

describe('app visibility gates (FR-REG-01/05, WF-02)', () => {
  it('needs both app access and the module permission', () => {
    expect(isAppVisible(def('crm'), { apps: ['crm'], permissions: ['crm.view'] })).toBe(true);
    expect(isAppVisible(def('crm'), { apps: ['crm'], permissions: [] })).toBe(false);
    expect(isAppVisible(def('crm'), { apps: ['mail'], permissions: ['crm.view'] })).toBe(false);
  });
  it('treats "*" and an ungated installation as full access', () => {
    expect(isAppVisible(def('finance'), { apps: '*', permissions: ['*'] })).toBe(true);
    expect(isAppVisible(def('mail'), { apps: null, permissions: [] })).toBe(true);
  });
  it('keeps HR visible without an app row (self-service)', () => {
    expect(isAppVisible(def('hr'), { apps: ['mail'], permissions: [] })).toBe(true);
  });
  it('lets a desktop-API server decide the first gates', () => {
    expect(isAppVisible(def('mail'), { apps: '*', permissions: ['*'], serverApps: ['chat'] })).toBe(false);
  });
  it('never returns unavailable apps', () => {
    const list = visibleApps({ apps: ['mail'], permissions: [] });
    expect(list.map((a) => a.id)).not.toContain('crm');
    expect(list.map((a) => a.id)).toContain('mail');
  });
});

describe('module manifests (§15, FR-REG-07)', () => {
  const base = { id: 'worksuite.garage', name: 'Garage', icon: 'garage', contractVersion: CONTRACT_VERSION, desktop: { enabled: true }, offline: { mode: 'PARTIAL_WRITE' as const, entities: ['job_card'] } };
  it('accepts the documented example', () => {
    const r = validateManifest({ ...base, native: ['printing', 'camera', 'file-drop', 'barcode'], windows: [{ id: 'job-card', route: '/garage/jobs/:id' }] });
    expect(r.ok).toBe(true);
  });
  it('rejects capabilities outside the allow-list', () => {
    const r = validateManifest({ ...base, native: ['printing', 'filesystem'] });
    expect(r.ok).toBe(false);
    expect(r.dropped).toEqual(['filesystem']);
  });
  it('rejects incompatible contract versions and malformed input', () => {
    expect(validateManifest({ ...base, contractVersion: 99 }).ok).toBe(false);
    expect(validateManifest({ id: 'x' }).ok).toBe(false);
    expect(validateManifest({ ...base, offline: { mode: 'READ_CACHE', cache: ['/etc/passwd'] } }).ok).toBe(false);
  });
});

describe('release selection (WF-25)', () => {
  const m = {
    schema: 1,
    product: 'worksuite-desktop',
    version: '0.3.0',
    channel: 'beta',
    released_at: '2026-09-25T00:00:00Z',
    critical: false,
    artifacts: [
      { platform: 'macos', arch: 'universal', kind: 'zip', url: 'a.zip', sha256: 'a'.repeat(64), size: 1 },
      { platform: 'windows', arch: 'x64', kind: 'nsis', url: 'a.exe', sha256: 'b'.repeat(64), size: 1 },
      { platform: 'linux', arch: 'x64', kind: 'appimage', url: 'a.AppImage', sha256: 'c'.repeat(64), size: 1 },
    ],
    signature: 'x'.repeat(88),
  } as ReleaseManifest;
  it('picks the installer this build can install', () => {
    expect(selectArtifact(m, 'macos', 'arm64', installableKinds('macos', false))?.url).toBe('a.zip');
    expect(selectArtifact(m, 'windows', 'x64', installableKinds('windows', false))?.url).toBe('a.exe');
    expect(selectArtifact(m, 'linux', 'x64', installableKinds('linux', true))?.url).toBe('a.AppImage');
    expect(selectArtifact(m, 'linux', 'x64', installableKinds('linux', false))).toBeNull();
  });
  it('respects channels', () => {
    expect(channelAccepts('stable', 'beta')).toBe(false);
    expect(channelAccepts('beta', 'stable')).toBe(true);
    expect(channelAccepts('dev', 'beta')).toBe(true);
    expect(channelAccepts('org', 'stable')).toBe(false);
  });
  it('only offers newer versions', () => {
    expect(isNewer('0.3.0', '0.2.9')).toBe(true);
    expect(isNewer('0.3.0', '0.3.0')).toBe(false);
  });
});
