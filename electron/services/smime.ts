import { createHash, webcrypto } from 'node:crypto';
import { rootCertificates } from 'node:tls';
import * as pkijs from 'pkijs';
import type { SmimeVerdict } from '@shared/smime';

/**
 * S/MIME signatures, checked on this computer (ENH-MAIL-03 DMO-SEC-05,
 * AC-DMO-14 in part).
 *
 * The check is made on the message's own bytes, never on what a header
 * claims: the signed part exactly as it arrived, the signature over it, the
 * signer's certificate chained to a root this computer's WorkSuite trusts
 * (Node's bundled Mozilla list), in date now, and naming the address the
 * message is From. Only when every one holds is the message "verified";
 * otherwise the reader says which one failed.
 *
 * WorkSuite does not sign, encrypt or decrypt S/MIME: those need a private
 * key, and no private key is kept by WorkSuite (§10.1).
 */

let engineReady = false;
function engine(): void {
  if (engineReady) return;
  pkijs.setEngine('node', new pkijs.CryptoEngine({ name: 'node', crypto: webcrypto as unknown as Crypto }));
  engineReady = true;
}

const toAb = (b: Buffer | Uint8Array): ArrayBuffer => {
  const out = new ArrayBuffer(b.byteLength);
  new Uint8Array(out).set(b);
  return out;
};

let rootCache: pkijs.Certificate[] | null = null;
/** The roots this computer trusts for S/MIME: Node's bundled Mozilla list. */
export function trustedRoots(): pkijs.Certificate[] {
  if (rootCache) return rootCache;
  rootCache = [];
  for (const pem of rootCertificates) {
    try {
      const der = Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');
      rootCache.push(pkijs.Certificate.fromBER(toAb(der)));
    } catch {
      // A root this parser cannot read is simply not trusted.
    }
  }
  return rootCache;
}

/** Top-level header block and body of a message, as bytes (latin1 keeps them as they are). */
function split(raw: string): { head: string; body: string } {
  const m = /\r?\n\r?\n/.exec(raw);
  return m ? { head: raw.slice(0, m.index), body: raw.slice(m.index + m[0].length) } : { head: raw, body: '' };
}

function header(head: string, name: string): string {
  const unfolded = head.replace(/\r?\n[ \t]+/g, ' ');
  return new RegExp(`^${name}:\\s*(.*)$`, 'im').exec(unfolded)?.[1]?.trim() ?? '';
}

/**
 * The parts of a multipart/signed message: the signed part exactly as it
 * arrived (with its own headers), and the signature's bytes.
 */
export function signedParts(raw: string): { content: string; signature: Buffer } | null {
  const { head, body } = split(raw);
  const type = header(head, 'Content-Type');
  if (!/^multipart\/signed/i.test(type) || !/protocol="?application\/(x-)?pkcs7-signature/i.test(type)) return null;
  const boundary = /boundary="?([^";]+)"?/i.exec(type)?.[1];
  if (!boundary) return null;
  const delim = `--${boundary}`;
  const first = body.indexOf(delim);
  if (first < 0) return null;
  const start = body.indexOf('\n', first) + 1;
  const second = body.indexOf(`\n${delim}`, start);
  if (start <= 0 || second < 0) return null;
  // The line break before the delimiter belongs to the delimiter (RFC 2046).
  const content = body.slice(start, body[second - 1] === '\r' ? second - 1 : second);
  const sigStart = body.indexOf('\n', second + 1) + 1;
  const sigEnd = body.indexOf(`\n${delim}`, sigStart);
  const sigPart = body.slice(sigStart, sigEnd < 0 ? undefined : sigEnd);
  const sig = split(sigPart);
  return { content, signature: Buffer.from(sig.body.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64') };
}

const EMAIL_OID = '1.2.840.113549.1.9.1';

function certEmails(cert: pkijs.Certificate): string[] {
  const out: string[] = [];
  for (const ext of cert.extensions ?? []) {
    if (ext.extnID === '2.5.29.17') {
      // Parsed as AltName (altNames) from a certificate read off the wire; GeneralNames (names) when built here.
      const names: pkijs.GeneralName[] = ext.parsedValue instanceof pkijs.AltName ? ext.parsedValue.altNames : ext.parsedValue instanceof pkijs.GeneralNames ? ext.parsedValue.names : [];
      for (const n of names) if (n.type === 1 && typeof n.value === 'string') out.push(n.value.toLowerCase());
    }
  }
  for (const tv of cert.subject.typesAndValues) {
    if (tv.type === EMAIL_OID) out.push(String(tv.value.valueBlock.value).toLowerCase());
  }
  return [...new Set(out)];
}

function nameOf(rdn: pkijs.RelativeDistinguishedNames, oid: string): string | null {
  const tv = rdn.typesAndValues.find((t) => t.type === oid);
  return tv ? String(tv.value.valueBlock.value) : null;
}

function signerOf(cert: pkijs.Certificate | null | undefined): SmimeVerdict['signer'] {
  if (!cert) return null;
  const der = Buffer.from(cert.toSchema().toBER(false));
  return {
    name: nameOf(cert.subject, '2.5.4.3'),
    email: certEmails(cert)[0] ?? null,
    issuer: nameOf(cert.issuer, '2.5.4.3') ?? nameOf(cert.issuer, '2.5.4.10'),
    notAfter: cert.notAfter.value.toISOString(),
    fingerprint: createHash('sha256').update(der).digest('hex'),
  };
}

const none = (detail: string): SmimeVerdict => ({ state: 'none', signer: null, detail, certificate: null });

/**
 * The verdict on one message.
 *
 * @param raw   the whole message as the server holds it
 * @param from  the address it is From
 * @param roots the certificates to trust (tests pass their own)
 */
export async function verifySmime(raw: Buffer, from: string | null, roots: pkijs.Certificate[] = trustedRoots(), now = new Date()): Promise<SmimeVerdict> {
  engine();
  const text = raw.toString('latin1');
  const { head, body } = split(text);
  const type = header(head, 'Content-Type');
  if (/^application\/(x-)?pkcs7-mime/i.test(type) && !/smime-type="?signed-data/i.test(type)) {
    return { state: 'encrypted', signer: null, detail: 'This message is encrypted with S/MIME. WorkSuite does not keep private keys, so it cannot be opened here.', certificate: null };
  }

  let signed: pkijs.SignedData;
  let content: string | null = null;
  try {
    let sigBytes: Buffer;
    const parts = signedParts(text);
    if (parts) {
      content = parts.content;
      sigBytes = parts.signature;
    } else if (/^application\/(x-)?pkcs7-mime/i.test(type)) {
      sigBytes = Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
    } else return none('Not signed with S/MIME.');
    const info = pkijs.ContentInfo.fromBER(toAb(sigBytes));
    if (info.contentType !== pkijs.ContentInfo.SIGNED_DATA) return none('The signature is not in a form WorkSuite can check.');
    signed = new pkijs.SignedData({ schema: info.content });
  } catch {
    return { state: 'invalid', signer: null, detail: 'The signature is damaged and cannot be read.', certificate: null };
  }

  const attempt = async (data: string | null) => {
    try {
      return await signed.verify({ signer: 0, data: data === null ? undefined : toAb(Buffer.from(data, 'latin1')), extendedMode: true, checkChain: false });
    } catch (e) {
      return e as pkijs.SignedDataVerifyResult;
    }
  };
  let r = await attempt(content);
  // A message stored with bare line feeds was signed with CRLF.
  if (!r.signatureVerified && content !== null && /[^\r]\n/.test(content)) r = await attempt(content.replace(/\r?\n/g, '\r\n'));
  const cert = (r.signerCertificate ?? null) as pkijs.Certificate | null;
  const signer = signerOf(cert);
  const certificate = cert ? Buffer.from(cert.toSchema().toBER(false)).toString('base64') : null;
  if (!cert) return { state: 'invalid', signer: null, detail: 'The signer’s certificate is not in the message, so the signature cannot be checked.', certificate: null };
  if (!r.signatureVerified) return { state: 'invalid', signer, detail: 'The message was changed after it was signed, or the signature does not match it.', certificate };

  if (cert.notBefore.value > now || cert.notAfter.value < now) {
    return { state: 'expired', signer, detail: `The signer’s certificate ${cert.notAfter.value < now ? 'expired' : 'is not valid yet'} (${(cert.notAfter.value < now ? cert.notAfter.value : cert.notBefore.value).toISOString().slice(0, 10)}).`, certificate };
  }

  const chain = new pkijs.CertificateChainValidationEngine({ trustedCerts: roots, certs: [...((signed.certificates ?? []).filter((c) => c instanceof pkijs.Certificate) as pkijs.Certificate[])], checkDate: now });
  let trusted = false;
  try {
    trusted = (await chain.verify()).result;
  } catch {
    trusted = false;
  }
  if (!trusted) return { state: 'untrusted', signer, detail: 'The signature matches the message, but the certificate was not issued by an authority this computer trusts.', certificate };

  const emails = certEmails(cert);
  if (!from || !emails.includes(from.toLowerCase())) {
    return { state: 'mismatch', signer, detail: `The certificate is for ${emails.join(', ') || 'no address'}, not for ${from ?? 'the sender'}.`, certificate };
  }
  return { state: 'verified', signer, detail: `Signed by ${signer?.name ?? from} — the signature, the certificate and the address all check.`, certificate };
}
