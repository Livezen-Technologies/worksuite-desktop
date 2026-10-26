import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@shared/canonical-json';
import { checkCommand, checkUpdate } from '../../../electron/services/label/envelope';
import { releasePlatform } from '../../../electron/services/label/gateway';

/** Label 1.1: heartbeat printer commands and the gateway update manifest are signed like jobs. */
const NOW = Date.parse('2026-10-25T05:00:00Z');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PUB = Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url').toString('base64');
const KEYS = { 'lbl-1': PUB };
const hex = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function signed(fields: Record<string, unknown>, key: KeyObject = privateKey) {
  const e = { ...fields, key_id: 'lbl-1' };
  return { ...e, sig: `ed25519:${sign(null, Buffer.from(canonicalJson(e)), key).toString('base64')}` };
}

describe('printer commands (status, calibrate, cancel)', () => {
  const bytes = Buffer.from('~JC');
  const cmd = (over: Record<string, unknown> = {}, env: Record<string, unknown> = {}) => ({
    type: 'calibrate',
    printer_id: 7,
    bytes_base64: bytes.toString('base64'),
    envelope: signed({ type: 'printer_command', command: 'calibrate', printer_id: 7, bytes_sha256: hex(bytes), issued_at: '2026-10-25T04:58:00Z', nonce: 'a1b2c3d4e5f60718', ...env }),
    ...over,
  });

  it('sends the bytes of a command whose envelope verifies, once', () => {
    const seen = new Set<string>();
    const r = checkCommand(cmd(), KEYS, seen, NOW);
    expect(r.ok).toBe(true);
    expect(r.ok && r.bytes?.toString()).toBe('~JC');
    expect(checkCommand(cmd(), KEYS, seen, NOW)).toMatchObject({ ok: false, reason: expect.stringMatching(/already used/) });
  });

  it('refuses a command without an envelope, signed by another key, for another printer or command, with other bytes, or old', () => {
    const other = generateKeyPairSync('ed25519').privateKey;
    expect(checkCommand({ type: 'status', printer_id: 7, bytes_base64: 'fn5IUw==' }, KEYS, new Set(), NOW).ok).toBe(false);
    const forged = cmd();
    forged.envelope = signed({ type: 'printer_command', command: 'calibrate', printer_id: 7, bytes_sha256: hex(bytes), issued_at: '2026-10-25T04:58:00Z', nonce: 'zzzzzzzzzzzz' }, other);
    expect(checkCommand(forged, KEYS, new Set(), NOW).ok).toBe(false);
    expect(checkCommand(cmd({ printer_id: 8 }), KEYS, new Set(), NOW).ok).toBe(false);
    expect(checkCommand(cmd({ type: 'cancel' }), KEYS, new Set(), NOW).ok).toBe(false);
    expect(checkCommand(cmd({ bytes_base64: Buffer.from('^XA^XZ').toString('base64') }), KEYS, new Set(), NOW)).toMatchObject({ ok: false, reason: expect.stringMatching(/not what was signed/) });
    expect(checkCommand(cmd({}, { issued_at: '2026-10-25T04:00:00Z' }), KEYS, new Set(), NOW)).toMatchObject({ ok: false, reason: expect.stringMatching(/too old/) });
  });
});

describe('the gateway update manifest', () => {
  const env = (over: Record<string, unknown> = {}) => signed({ type: 'gateway_update', gateway_id: 3, version: '0.3.0', channel: 'stable', platform: 'linux-x64', url: 'https://dl.example/gw-0.3.0.AppImage', sha256: 'b'.repeat(64), notes: null, issued_at: '2026-10-25T04:00:00Z', ...over });
  it('offers a signed build for this gateway', () => {
    expect(checkUpdate(env(), KEYS, 3)).toMatchObject({ ok: true, update: { version: '0.3.0', sha256: 'b'.repeat(64) } });
  });
  it('refuses another gateway, plain http, a missing hash or a forged signature', () => {
    expect(checkUpdate(env(), KEYS, 4).ok).toBe(false);
    expect(checkUpdate(env({ url: 'http://dl.example/x' }), KEYS, 3).ok).toBe(false);
    expect(checkUpdate(env({ sha256: 'nope' }), KEYS, 3).ok).toBe(false);
    const bad = { ...env(), version: '9.9.9' };
    expect(checkUpdate(bad, KEYS, 3).ok).toBe(false);
  });
  it('names this build’s platform as the server does', () => {
    expect(releasePlatform('win32', 'x64')).toBe('windows-x64');
    expect(releasePlatform('linux', 'arm64')).toBe('linux-arm64');
    expect(releasePlatform('darwin', 'arm64')).toBe('macos');
    expect(releasePlatform('win32', 'arm64')).toBeNull();
  });
});
