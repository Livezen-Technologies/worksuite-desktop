import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { canonicalJson } from '@shared/canonical-json';
import { parseSetupLink } from '@shared/trusted-config';
import { parseDetachedJws, verifyDetachedJws } from '../../../../electron/services/discovery/jws';
import { discoveryKeyring, sameKey, sanitizeRotatedKeys } from '../../../../electron/services/discovery/keys';
import {
  fileIsProtected,
  managedJsonPath,
  parsePins,
  parseRegQuery,
  readManagedSource,
  readTrustedConfig,
  setupLinkRevoked,
  trustedFromRaw,
  trustedFromSetupLink,
  verifySetupLink,
  type SourceEnv,
} from '../../../../electron/services/discovery/trusted-config';
import { readEnterpriseConfig } from '../../../../electron/services/enterprise';
import { acceptUpdateResponse, setDiscoveryKeysSink } from '../../../../electron/updater/update-center';

const F = join(__dirname, '../../../fixtures/discovery');
const read = (f: string) => readFileSync(join(F, f));
const text = (f: string) => readFileSync(join(F, f), 'utf8');
const keys = JSON.parse(text('keys.json')) as { kid: string; discovery_key: string; raw: string };

describe('JWS: the shared server vectors (WP5) and the WP0 fixtures', () => {
  it('verifies Core’s detached JWS over the exact bytes with its ed25519:<SPKI> key', () => {
    const v = verifyDetachedJws(text('discovery-v1.jws'), read('discovery-v1.json'), text('discovery-v1.key').trim());
    expect(v).toEqual({ ok: true, kid: '5647:5AA7:5463:474C:0285:DF5D:BF2B:CAB7' });
    // The document names the same key it is signed with.
    expect(sameKey(JSON.parse(text('discovery-v1.json')).keys.discovery, text('discovery-v1.key'))).toBe(true);
  });

  it('refuses one changed byte, a changed signature and another key', () => {
    const raw = Buffer.from(read('discovery-v1.json'));
    raw.writeUInt8(raw.readUInt8(raw.length - 3) ^ 1, raw.length - 3);
    expect(verifyDetachedJws(text('discovery-v1.jws'), raw, text('discovery-v1.key').trim())).toEqual({ ok: false, reason: 'signature' });
    const jws = text('discovery-v1.jws').trim();
    const tampered = jws.slice(0, -4) + (jws.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
    expect(verifyDetachedJws(tampered, read('discovery-v1.json'), text('discovery-v1.key').trim()).ok).toBe(false);
    expect(verifyDetachedJws(jws, read('discovery-v1.json'), keys.discovery_key)).toEqual({ ok: false, reason: 'signature' });
  });

  it('verifies the Cloud and Enterprise fixtures, by kid from a keyring and with the raw base64url key', () => {
    expect(verifyDetachedJws(text('cloud.jws'), read('cloud.json'), { [keys.kid]: keys.raw }).ok).toBe(true);
    expect(verifyDetachedJws(text('enterprise.jws'), read('enterprise.json'), keys.raw).ok).toBe(true);
    expect(verifyDetachedJws(text('cloud.jws'), read('cloud.json'), { other: keys.raw })).toEqual({ ok: false, reason: 'no-key' });
  });

  it('the Cloud keyring trusts the test key only in unpackaged builds', () => {
    expect(verifyDetachedJws(text('cloud.jws'), read('cloud.json'), discoveryKeyring({}, false)).ok).toBe(true);
    expect(verifyDetachedJws(text('cloud.jws'), read('cloud.json'), discoveryKeyring({}, true)).ok).toBe(false);
    expect(verifyDetachedJws(text('cloud.jws'), read('cloud.json'), discoveryKeyring({ [keys.kid]: keys.raw }, true)).ok).toBe(true);
  });

  it('refuses a non-EdDSA header, an attached payload and unknown critical extensions', () => {
    const h = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const sig = Buffer.alloc(64).toString('base64url');
    expect(verifyDetachedJws(`${h({ alg: 'HS256' })}..${sig}`, read('cloud.json'), keys.raw)).toEqual({ ok: false, reason: 'alg' });
    expect(verifyDetachedJws(`${h({ alg: 'none' })}..`, read('cloud.json'), keys.raw)).toEqual({ ok: false, reason: 'malformed' });
    expect(parseDetachedJws(`${h({ alg: 'EdDSA' })}.eyJ9.${sig}`)).toBeNull();
    expect(parseDetachedJws(`${h({ alg: 'EdDSA', crit: ['exp'] })}..${sig}`)).toBeNull();
    expect(parseDetachedJws(`${h({ alg: 'EdDSA', b64: false })}..${sig}`)).toBeNull();
  });

  it('supports b64:false (RFC 7797) when it is critical', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const raw = Buffer.from('{"a":1}');
    const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', b64: false, crit: ['b64'] })).toString('base64url');
    const s = sign(null, Buffer.concat([Buffer.from(`${header}.`), raw]), privateKey).toString('base64url');
    const key = 'ed25519:' + publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    expect(verifyDetachedJws(`${header}..${s}`, raw, key).ok).toBe(true);
  });
});

describe('Update Center discovery_keys rotation', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const ucKeys = { 'test-uc': (publicKey.export({ type: 'spki', format: 'der' }) as Buffer).subarray(12).toString('base64url') };
  const doc = (over: Record<string, unknown> = {}) => {
    const body: Record<string, unknown> = {
      status: 'CURRENT',
      app_id: 'lk.worksuite.desktop',
      channel: 'stable',
      current_version: '0.3.0',
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      key_id: 'test-uc',
      discovery_keys: { 'lz-2027': keys.raw, 'bad kid!': keys.raw, junk: 'abc' },
      ...over,
    };
    return { ...body, signature: sign(null, Buffer.from(canonicalJson(body)), privateKey).toString('base64url') };
  };

  it('stores only well-formed keys, and only from a verified response', () => {
    const sink = vi.fn();
    setDiscoveryKeysSink(sink);
    try {
      expect(acceptUpdateResponse(doc(), ucKeys, '0.3.0').ok).toBe(true);
      expect(sink).toHaveBeenCalledWith({ 'lz-2027': keys.raw });
      sink.mockClear();
      const forged = { ...doc(), discovery_keys: { evil: keys.raw } };
      expect(acceptUpdateResponse(forged, ucKeys, '0.3.0')).toEqual({ ok: false, reason: 'signature' });
      expect(sink).not.toHaveBeenCalled();
    } finally {
      setDiscoveryKeysSink(null);
    }
  });

  it('sanitizes rotated keys', () => {
    expect(sanitizeRotatedKeys({ a: keys.discovery_key, b: 'x', 'c d': keys.raw })).toEqual({ a: keys.discovery_key });
    expect(sanitizeRotatedKeys(null)).toEqual({});
    expect(sanitizeRotatedKeys([keys.raw])).toEqual({});
  });
});

/** A fake computer for the managed sources. */
function env(files: Record<string, { body: string; uid?: number; gid?: number; mode?: number }>, over: Partial<SourceEnv> = {}): SourceEnv {
  return {
    platform: 'linux',
    resourcesPath: '/opt/WorkSuite/resources',
    programData: 'C:\\ProgramData',
    exists: (p) => p in files,
    readFile: (p) => files[p]!.body,
    stat: (p) => ({ uid: files[p]!.uid ?? 0, gid: files[p]!.gid ?? 0, mode: files[p]!.mode ?? 0o100644 }),
    exec: () => {
      throw new Error('no such command');
    },
    ...over,
  };
}

describe('trusted configuration', () => {
  const managed = {
    server_url: 'https://ws.corp.example/login',
    org_id: 17,
    disable_server_change: true,
    spki_pins: ['sha256/n5EWH0NDPkmm3m22gNefYBWfLkrJFyYhoShGQoFYRAs=', 'not-a-pin'],
    discovery_key: keys.discovery_key,
    require_signed: true,
    disable_personal: true,
    update_channel: 'beta',
  };

  it('reads managed.json at each OS path', () => {
    expect(managedJsonPath({ platform: 'linux', programData: '' })).toBe('/etc/worksuite/managed.json');
    expect(managedJsonPath({ platform: 'darwin', programData: '' })).toBe('/Library/Application Support/WorkSuite/managed.json');
    expect(managedJsonPath({ platform: 'win32', programData: 'C:\\ProgramData' })).toBe('C:\\ProgramData\\WorkSuite\\managed.json');
    const t = readTrustedConfig(env({ '/etc/worksuite/managed.json': { body: JSON.stringify(managed) } }));
    expect(t).toEqual({
      source: 'managed.json',
      serverUrl: 'https://ws.corp.example',
      organizationId: '17',
      updateChannel: 'beta',
      spkiPins: ['sha256/n5EWH0NDPkmm3m22gNefYBWfLkrJFyYhoShGQoFYRAs='],
      discoveryKey: keys.discovery_key,
      requireSigned: true,
      allowPersonal: false,
      lockServer: true,
      expiresAt: null,
    });
  });

  it('ignores a file not owned by root, or writable by everyone', () => {
    const body = JSON.stringify(managed);
    expect(readTrustedConfig(env({ '/etc/worksuite/managed.json': { body, uid: 1000 } })).source).toBeNull();
    expect(readTrustedConfig(env({ '/etc/worksuite/managed.json': { body, mode: 0o100666 } })).source).toBeNull();
    // A custom build's enterprise.json is inside the app (a per-user install owns it): only world-writable is refused.
    const custom = '/opt/WorkSuite/resources/enterprise.json';
    expect(readTrustedConfig(env({ [custom]: { body, uid: 1000 } })).source).toBe('enterprise.json');
    expect(readTrustedConfig(env({ [custom]: { body, uid: 1000, mode: 0o100666 } })).source).toBeNull();
  });

  it('macOS admin group ownership, Windows ACLs', () => {
    const e = env({ '/x': { body: '', uid: 0, gid: 80, mode: 0o100644 } }, { platform: 'darwin' });
    expect(fileIsProtected('/x', e)).toBe(true);
    expect(fileIsProtected('/x', env({ '/x': { body: '', uid: 501, gid: 80 } }, { platform: 'darwin' }))).toBe(false);
    const acl = (out: string) => env({}, { platform: 'win32', exec: () => out });
    expect(fileIsProtected('C:\\x', acl('C:\\x NT AUTHORITY\\SYSTEM:(F)\n BUILTIN\\Administrators:(F)\n BUILTIN\\Users:(RX)\n'))).toBe(true);
    expect(fileIsProtected('C:\\x', acl('C:\\x Everyone:(F)\n'))).toBe(false);
    expect(fileIsProtected('C:\\x', acl('C:\\x BUILTIN\\Users:(I)(M)\n'))).toBe(false);
  });

  it('the first source wins: policy.json before managed.json on Linux', () => {
    const t = readTrustedConfig(
      env({ '/etc/worksuite/policy.json': { body: JSON.stringify({ server_url: 'https://a.example' }) }, '/etc/worksuite/managed.json': { body: JSON.stringify(managed) } }),
    );
    expect(t).toMatchObject({ source: 'policy.json', serverUrl: 'https://a.example', allowPersonal: true, requireSigned: false, spkiPins: [] });
  });

  it('reads the registry: DWORD flags and comma-separated pins', () => {
    const out = [
      'HKEY_LOCAL_MACHINE\\Software\\Policies\\WorkSuite',
      '    server_url    REG_SZ    https://ws.corp.example',
      '    require_signed    REG_DWORD    0x1',
      '    allow_personal    REG_DWORD    0x0',
      '    spki_pins    REG_SZ    sha256/n5EWH0NDPkmm3m22gNefYBWfLkrJFyYhoShGQoFYRAs=,sha256/VNANhndYzvgWvEaF9Y4ye5SXErB+vRfDSF8//J6fUTM=',
      '    proxy_mode    REG_SZ    manual',
      '    proxy_rules    REG_SZ    http=proxy:8080',
    ].join('\r\n');
    expect(parseRegQuery(out)).toMatchObject({ require_signed: 1, allow_personal: 0 });
    const e = env({}, { platform: 'win32', exec: (f) => (f === 'reg' ? out : '') });
    const t = readTrustedConfig(e);
    expect(t).toMatchObject({ source: 'registry', requireSigned: true, allowPersonal: false, spkiPins: [expect.stringMatching(/^sha256\/n5/), expect.stringMatching(/^sha256\/VN/)] });
    // The wrapper keeps what enterprise.ts read before.
    expect(readEnterpriseConfig(e)).toMatchObject({ source: 'registry', server_url: 'https://ws.corp.example', proxy: { mode: 'manual', rules: 'http=proxy:8080' } });
  });

  it('allow_personal wins over the legacy disable_personal; the default allows', () => {
    expect(trustedFromRaw({ allow_personal: true, disable_personal: true }, 'managed.json').allowPersonal).toBe(true);
    expect(trustedFromRaw({ disable_personal: 1 }, 'managed.json').allowPersonal).toBe(false);
    expect(trustedFromRaw({}, 'managed.json').allowPersonal).toBe(true);
    expect(trustedFromRaw({ server_url: 'http://insecure.example', discovery_key: 'nope' }, 'managed.json')).toMatchObject({ serverUrl: null, discoveryKey: null });
    expect(parsePins('a, sha256/n5EWH0NDPkmm3m22gNefYBWfLkrJFyYhoShGQoFYRAs=')).toEqual(['sha256/n5EWH0NDPkmm3m22gNefYBWfLkrJFyYhoShGQoFYRAs=']);
  });

  it('nothing configured: the unmanaged defaults, and enterprise.ts says source null as before', () => {
    expect(readTrustedConfig(env({}))).toMatchObject({ source: null, allowPersonal: true, lockServer: false, spkiPins: [] });
    expect(readEnterpriseConfig(env({}))).toEqual({ source: null });
    expect(readManagedSource(env({}, { platform: 'darwin', exec: () => '{}' }))).toBeNull();
  });
});

describe('setup links', () => {
  const links = JSON.parse(text('setup-links.json')) as { v1: string; v2: string; expired: string };
  const NOW = Date.parse('2026-10-13T00:00:00Z');

  it('v1 and v2 fixtures verify against the server key; the expired one is expired', () => {
    const v1 = parseSetupLink(links.v1, NOW);
    const v2 = parseSetupLink(links.v2, NOW);
    expect(v1.ok && verifySetupLink(v1, keys.discovery_key)).toBe(true);
    expect(v2.ok && verifySetupLink(v2, keys.raw)).toBe(true);
    expect(parseSetupLink(links.expired, NOW)).toEqual({ ok: false, reason: 'expired' });
  });

  it('the server’s v2 vector verifies with its key (checked at a time before it expires)', () => {
    const link = text('setup-link-v2.txt').trim();
    const parsed = parseSetupLink(link, 1790000200_000);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(verifySetupLink(parsed, text('discovery-v1.key').trim())).toBe(true);
    expect(verifySetupLink(parsed, keys.discovery_key)).toBe(false);
    const t = trustedFromSetupLink(parsed, text('discovery-v1.key').trim(), 1790000000);
    expect(t).toMatchObject({ source: 'setup-link', serverUrl: 'https://worksuite.example.com', organizationId: '17', updateChannel: 'beta', requireSigned: true, allowPersonal: false, lockServer: false });
    expect(t.spkiPins).toHaveLength(2);
    expect(t.expiresAt).toBe(new Date(parsed.payload.exp * 1000).toISOString());
    // Today it has expired.
    expect(parseSetupLink(link, NOW)).toEqual({ ok: false, reason: 'expired' });
  });

  it('revocation: iat before setup.revoked_before', () => {
    const parsed = parseSetupLink(links.v2, NOW);
    if (!parsed.ok) throw new Error('fixture');
    expect(setupLinkRevoked(parsed, null)).toBe(false);
    expect(setupLinkRevoked(parsed, parsed.payload.iat!)).toBe(false);
    expect(setupLinkRevoked(parsed, parsed.payload.iat! + 1)).toBe(true);
    expect(() => trustedFromSetupLink(parsed, keys.raw, parsed.payload.iat! + 1)).toThrow(/revoked/);
    const v1 = parseSetupLink(links.v1, NOW);
    if (!v1.ok) throw new Error('fixture');
    expect(setupLinkRevoked(v1, 1)).toBe(true);
  });

  it('a link signed by someone else does not verify', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const json = canonicalJson({ v: 1, server_url: 'https://ws.example.com', server_id: 'x', name: 'X', exp: 4102444800 });
    const s = sign(null, Buffer.from(json), privateKey).toString('base64');
    const parsed = parseSetupLink(`worksuite://setup?d=${Buffer.from(json).toString('base64url')}&s=${encodeURIComponent(s)}`, NOW);
    expect(parsed.ok && verifySetupLink(parsed, keys.discovery_key)).toBe(false);
    if (parsed.ok) expect(() => trustedFromSetupLink(parsed, keys.discovery_key)).toThrow();
  });
});
