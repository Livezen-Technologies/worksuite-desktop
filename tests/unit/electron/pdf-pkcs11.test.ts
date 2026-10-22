import { execFileSync } from 'node:child_process';
import { createVerify, generateKeyPairSync, X509Certificate } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { TokenSigner } from '../../../electron/services/pdf/pkcs11';

/**
 * Signing with a smart card or USB token (PRO-SIG-002): the tokens and their
 * certificates are found through the token's PKCS#11 library; the PIN goes to
 * pkcs11-tool in its environment, never on its command line; a wrong PIN is
 * said plainly. Against a fake tool, and — where SoftHSM and OpenSC are
 * installed — against a real (software) token.
 */

describe('TokenSigner', () => {
  it('finds tokens and certificates, and keeps the PIN off the command line', async () => {
    const calls: Array<{ args: string[]; env?: Record<string, string> }> = [];
    const signer = new TokenSigner(async (_bin, args, env) => {
      calls.push({ args, env });
      if (args.includes('--list-token-slots')) return { code: 0, stdout: 'Slot 0 (0x1): Reader\n  token label        : Asha eToken\n  token manufacturer : SafeNet\n' };
      if (args.includes('--list-objects')) return { code: 0, stdout: 'Certificate Object; type = X.509 cert\n  label:      Asha Perera\n  ID:         01\n' };
      if (args.includes('--read-object')) {
        writeFileSync(args[args.indexOf('--output-file') + 1]!, Buffer.from([0x30, 0x03, 0x02, 0x01, 0x01]));
        return { code: 0, stdout: '' };
      }
      if (args.includes('--sign')) {
        writeFileSync(args[args.indexOf('--output-file') + 1]!, Buffer.from([1, 2, 3]));
        return { code: 0, stdout: 'Using signature algorithm SHA256-RSA-PKCS' };
      }
      return { code: 1, stdout: '' };
    }, 'linux', (p) => p === '/usr/bin/pkcs11-tool' || p === '/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so');

    const found = await signer.list();
    expect(found.available).toBe(true);
    expect(found.tokens[0]?.token).toBe('Asha eToken');
    expect(found.tokens[0]?.certs[0]).toMatchObject({ id: '01', label: 'Asha Perera', der: 'MAMCAQE=' });

    const sig = await signer.sign({ module: '/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so', token: 'Asha eToken', id: '01', pin: '4321', data: new Uint8Array([9]), ec: false });
    expect([...sig]).toEqual([1, 2, 3]);
    const signCall = calls.find((c) => c.args.includes('--sign'))!;
    expect(signCall.args.join(' ')).not.toContain('4321');
    expect(signCall.args).toContain('env:WS_TOKEN_PIN');
    expect(signCall.env?.WS_TOKEN_PIN).toBe('4321');
    expect(signCall.args).toContain('SHA256-RSA-PKCS');
  });

  it('says a wrong PIN plainly, and refuses a library that is not on the computer', async () => {
    const signer = new TokenSigner(async () => ({ code: 1, stdout: 'error: PKCS11 function C_Login failed: rv = CKR_PIN_INCORRECT (0xa0)' }), 'linux',
      (p) => p === '/usr/bin/pkcs11-tool' || p === '/usr/lib/opensc-pkcs11.so');
    await expect(signer.sign({ module: '/usr/lib/opensc-pkcs11.so', token: 'T', id: '01', pin: '0', data: new Uint8Array([1]), ec: false })).rejects.toThrow(/PIN is not right/);
    await expect(signer.sign({ module: '/tmp/evil.so', token: 'T', id: '01', pin: '0', data: new Uint8Array([1]), ec: false })).rejects.toThrow(/not on this computer/);
    expect((await new TokenSigner(async () => ({ code: 0, stdout: '' }), 'linux', () => false).list()).reason).toMatch(/Install OpenSC/);
  });

  const lib = '/usr/lib/softhsm/libsofthsm2.so';
  const real = existsSync(lib) && existsSync('/usr/bin/pkcs11-tool') && existsSync('/usr/bin/softhsm2-util');
  const dir = mkdtempSync(join(tmpdir(), 'ws-softhsm-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it.skipIf(!real)('signs with a real (software) token whose key never leaves it', async () => {
    writeFileSync(join(dir, 'softhsm2.conf'), `directories.tokendir = ${dir}\n`);
    const env = { ...process.env, SOFTHSM2_CONF: join(dir, 'softhsm2.conf') };
    execFileSync('softhsm2-util', ['--init-token', '--free', '--label', 'DeskToken', '--pin', '2468', '--so-pin', '1357'], { env });
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    writeFileSync(join(dir, 'key.der'), privateKey.export({ type: 'pkcs8', format: 'der' }));
    execFileSync('pkcs11-tool', ['--module', lib, '--token-label', 'DeskToken', '--login', '--pin', '2468', '--write-object', join(dir, 'key.der'), '--type', 'privkey', '--id', '0a', '--label', 'me'], { env });
    // A certificate for the key, so the token lists it.
    writeFileSync(join(dir, 'key.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
    execFileSync('openssl', ['req', '-x509', '-key', join(dir, 'key.pem'), '-subj', '/CN=Desk Signer', '-days', '2', '-out', join(dir, 'c.der'), '-outform', 'DER'], { env });
    execFileSync('pkcs11-tool', ['--module', lib, '--token-label', 'DeskToken', '--login', '--pin', '2468', '--write-object', join(dir, 'c.der'), '--type', 'cert', '--id', '0a', '--label', 'me'], { env });

    const signer = new TokenSigner(undefined, 'linux', existsSync, { SOFTHSM2_CONF: join(dir, 'softhsm2.conf') });
    const found = await signer.list(lib);
    const cert = found.tokens.find((t) => t.token === 'DeskToken')?.certs[0];
    expect(cert?.label).toBe('me');
    expect(new X509Certificate(Buffer.from(cert!.der, 'base64')).subject).toContain('Desk Signer');

    const data = Buffer.from('the signed attributes');
    const sig = await signer.sign({ module: lib, token: 'DeskToken', id: '0a', pin: '2468', data: new Uint8Array(data), ec: false });
    const v = createVerify('sha256');
    v.update(data);
    expect(v.verify(new X509Certificate(Buffer.from(cert!.der, 'base64')).publicKey, Buffer.from(sig))).toBe(true);

    await expect(signer.sign({ module: lib, token: 'DeskToken', id: '0a', pin: '0000', data: new Uint8Array(data), ec: false })).rejects.toThrow(/PIN is not right/);
  });
});
