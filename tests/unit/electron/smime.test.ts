import { webcrypto } from 'node:crypto';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { beforeAll, describe, expect, it } from 'vitest';
import { signedParts, trustedRoots, verifySmime } from '../../../electron/services/smime';

/**
 * S/MIME signatures checked on this computer (ENH-MAIL-03 DMO-SEC-05):
 * "verified" only when the signature, the chain, the dates and the address
 * all hold — and each failure said for what it is.
 */

pkijs.setEngine('test', new pkijs.CryptoEngine({ name: 'test', crypto: webcrypto as unknown as Crypto }));
const subtle = webcrypto.subtle;
const ALG = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };

const cn = (name: string) => new pkijs.AttributeTypeAndValue({ type: '2.5.4.3', value: new asn1js.Utf8String({ value: name }) });

async function makeCert(opts: { name: string; issuer?: { cert: pkijs.Certificate; key: CryptoKey }; email?: string; ca?: boolean; from?: Date; to?: Date; serial: number }) {
  const keys = (await subtle.generateKey(ALG, true, ['sign', 'verify'])) as CryptoKeyPair;
  const cert = new pkijs.Certificate();
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({ value: opts.serial });
  cert.subject.typesAndValues.push(cn(opts.name));
  if (opts.issuer) cert.issuer = opts.issuer.cert.subject;
  else cert.issuer.typesAndValues.push(cn(opts.name));
  cert.notBefore.value = opts.from ?? new Date(Date.now() - 86_400_000);
  cert.notAfter.value = opts.to ?? new Date(Date.now() + 365 * 86_400_000);
  const ext: pkijs.Extension[] = [];
  const bc = new pkijs.BasicConstraints({ cA: !!opts.ca });
  ext.push(new pkijs.Extension({ extnID: '2.5.29.19', critical: true, extnValue: bc.toSchema().toBER(false), parsedValue: bc }));
  if (opts.ca) {
    const ku = new asn1js.BitString({ valueHex: new Uint8Array([0x06]).buffer });
    ext.push(new pkijs.Extension({ extnID: '2.5.29.15', critical: true, extnValue: ku.toBER(false) }));
  }
  if (opts.email) {
    const san = new pkijs.GeneralNames({ names: [new pkijs.GeneralName({ type: 1, value: opts.email })] });
    ext.push(new pkijs.Extension({ extnID: '2.5.29.17', critical: false, extnValue: san.toSchema().toBER(false), parsedValue: san }));
  }
  cert.extensions = ext;
  await cert.subjectPublicKeyInfo.importKey(keys.publicKey);
  await cert.sign(opts.issuer?.key ?? keys.privateKey, 'SHA-256');
  return { cert, key: keys.privateKey };
}

async function signedMessage(content: string, signer: { cert: pkijs.Certificate; key: CryptoKey }, chain: pkijs.Certificate[], from = 'asha@livezen.lk', tamper?: (c: string) => string): Promise<Buffer> {
  const data = Buffer.from(content, 'latin1');
  const sd = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: '1.2.840.113549.1.7.1' }),
    signerInfos: [new pkijs.SignerInfo({ version: 1, sid: new pkijs.IssuerAndSerialNumber({ issuer: signer.cert.issuer, serialNumber: signer.cert.serialNumber }) })],
    certificates: [signer.cert, ...chain],
  });
  await sd.sign(signer.key, 0, 'SHA-256', data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  const der = Buffer.from(new pkijs.ContentInfo({ contentType: '1.2.840.113549.1.7.2', content: sd.toSchema(true) }).toSchema().toBER(false));
  const b = 'sig-boundary-1';
  const body = tamper ? tamper(content) : content;
  return Buffer.from(
    [
      `From: Asha <${from}>`,
      'To: omar@livezen.lk',
      'Subject: Budget',
      'MIME-Version: 1.0',
      `Content-Type: multipart/signed; protocol="application/pkcs7-signature";`,
      ` micalg=sha-256; boundary="${b}"`,
      '',
      `--${b}`,
      body,
      `--${b}`,
      'Content-Type: application/pkcs7-signature; name=smime.p7s',
      'Content-Transfer-Encoding: base64',
      '',
      ...(der.toString('base64').match(/.{1,76}/g) ?? []),
      `--${b}--`,
      '',
    ].join('\r\n'),
    'latin1',
  );
}

const CONTENT = 'Content-Type: text/plain; charset=UTF-8\r\n\r\nThe budget is approved.';

describe('S/MIME signatures', () => {
  let ca: { cert: pkijs.Certificate; key: CryptoKey };
  let asha: { cert: pkijs.Certificate; key: CryptoKey };
  beforeAll(async () => {
    ca = await makeCert({ name: 'Livezen Test CA', ca: true, serial: 1 });
    asha = await makeCert({ name: 'Asha Perera', issuer: ca, email: 'asha@livezen.lk', serial: 2 });
  });

  it('are verified only when the signature, the chain, the dates and the address all check', async () => {
    const raw = await signedMessage(CONTENT, asha, [ca.cert]);
    const v = await verifySmime(raw, 'asha@livezen.lk', [ca.cert]);
    expect(v.state).toBe('verified');
    expect(v.signer).toMatchObject({ name: 'Asha Perera', email: 'asha@livezen.lk', issuer: 'Livezen Test CA' });
    expect(v.signer!.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(v.certificate).toBeTruthy();
    expect(signedParts(raw.toString('latin1'))!.content).toBe(CONTENT);
  });

  it('say the message was changed after signing', async () => {
    const raw = await signedMessage(CONTENT, asha, [ca.cert], undefined, (c) => c.replace('approved', 'rejected'));
    expect((await verifySmime(raw, 'asha@livezen.lk', [ca.cert])).state).toBe('invalid');
  });

  it('say a certificate from an authority this computer does not trust is untrusted, never verified', async () => {
    const raw = await signedMessage(CONTENT, asha, [ca.cert]);
    expect((await verifySmime(raw, 'asha@livezen.lk', [])).state).toBe('untrusted');
    // The real list of roots does not know a test CA either.
    expect(trustedRoots().length).toBeGreaterThan(50);
    expect((await verifySmime(raw, 'asha@livezen.lk')).state).toBe('untrusted');
  });

  it('say when the certificate is for somebody else or out of date', async () => {
    const raw = await signedMessage(CONTENT, asha, [ca.cert], 'mallory@bad.example');
    const v = await verifySmime(raw, 'mallory@bad.example', [ca.cert]);
    expect(v.state).toBe('mismatch');
    expect(v.detail).toContain('asha@livezen.lk');

    const old = await makeCert({ name: 'Asha Perera', issuer: ca, email: 'asha@livezen.lk', serial: 3, from: new Date('2020-01-01'), to: new Date('2021-01-01') });
    expect((await verifySmime(await signedMessage(CONTENT, old, [ca.cert]), 'asha@livezen.lk', [ca.cert])).state).toBe('expired');
  });

  it('check a message stored with bare line feeds against the CRLF it was signed with', async () => {
    const raw = (await signedMessage(CONTENT, asha, [ca.cert])).toString('latin1').replace(/\r\n/g, '\n');
    expect((await verifySmime(Buffer.from(raw, 'latin1'), 'asha@livezen.lk', [ca.cert])).state).toBe('verified');
  });

  it('do not claim anything about unsigned or encrypted mail', async () => {
    expect((await verifySmime(Buffer.from('Subject: x\r\n\r\nhello'), 'a@b.org', [ca.cert])).state).toBe('none');
    expect((await verifySmime(Buffer.from('Content-Type: application/pkcs7-mime; smime-type=enveloped-data\r\n\r\nMIAG'), 'a@b.org', [ca.cert])).state).toBe('encrypted');
    expect((await verifySmime(Buffer.from('Content-Type: multipart/signed; protocol="application/pkcs7-signature"; boundary="b"\r\n\r\n--b\r\nx\r\n--b\r\n\r\nnot base64 cms\r\n--b--'), 'a@b.org', [ca.cert])).state).toBe('invalid');
  });
});
