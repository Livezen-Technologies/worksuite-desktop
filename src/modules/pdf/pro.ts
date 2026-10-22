import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { ApiError, apiDelete, apiGet, apiPost } from '../../core/api';
import { text } from '../../core/i18n';

/**
 * PDF Studio Pro from the desktop (WS-SRS-PDFPRO-001): the server's Pro API for
 * a Drive PDF — the same contract the web editor uses — and the desktop's own
 * part of signing: a PKCS#12 file is opened here, its key signs the bytes the
 * server prepared, and only the signature goes back (PRO-SIG-002, PRO-NFR-010).
 */

export type Rect = [number, number, number, number];

export interface ProMe {
  entitled: boolean;
  features: Record<string, boolean>;
  settings: { min_signature_level: string; ai_enabled: boolean };
  redaction_codes: Array<{ id: number; code: string; label: string }>;
  patterns: Record<string, string>;
  certificates: Array<{ id: number; label: string; purpose: string; kind: string }>;
}

export interface SignatureCheck {
  field: string; status: 'valid' | 'valid_with_warnings' | 'invalid' | 'unknown'; signer: string | null; signed_at: string | null; level: string | null;
  tsa_time: string | null; problems: string[]; trusted: boolean;
}

export interface Thread { uid: string; type: string; page: number; author: string | null; text: string | null; status: string | null; replies: Thread[] }

/** The server's words for a refusal. */
export function proError(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : text('That did not work.');
}

const f = (id: number) => `/api/files/${id}/pdf`;

export const pro = {
  me: () => apiGet<ProMe>('/api/pdfpro/me'),
  signatures: (id: number) => apiGet<{ summary: string; signatures: SignatureCheck[] }>(`${f(id)}/signatures`),
  sign: (id: number, body: Record<string, unknown>) => apiPost<{ version: number; level: string; token?: string; to_sign_b64?: string }>(`${f(id)}/sign`, body),
  redactSearch: (id: number, body: Record<string, unknown>) => apiPost<{ matches: Array<{ page: number; text: string; kind: string; rects: Rect[] }>; count: number }>(`${f(id)}/redact/search`, body),
  redact: (id: number, body: Record<string, unknown>) => apiPost<{ mode: string; file_id: number; version: number; areas: number }>(`${f(id)}/redact`, body),
  sanitise: (id: number, body: Record<string, unknown>) => apiPost<{ mode: string; file_id: number; removed: Record<string, number> }>(`${f(id)}/sanitise`, body),
  edit: (id: number, body: Record<string, unknown>) => apiPost<{ version?: number; changes: Array<{ page: number; before: string; after: string; mode: string }>; font_substitutions: string[] }>(`${f(id)}/edit`, body),
  a11yCheck: (id: number) => apiPost<{ passed: boolean; failures: number; issues: Array<{ rule: string; status: string; page: number | null; message: string; fix: string }> }>(`${f(id)}/a11y/check`),
  a11yFix: (id: number, body: Record<string, unknown>) => apiPost<{ version: number }>(`${f(id)}/a11y/fix`, body),
  ai: (id: number, op: string, body: Record<string, unknown>) => apiPost<{ answer?: string; result?: unknown; suggestions?: Array<{ page: number; text: string; kind: string }>; file_id?: number }>(`${f(id)}/ai/${op}`, body),
  annotations: (id: number) => apiGet<{ threads: Thread[]; web_comments_not_in_file: number }>(`${f(id)}/annotations`),
  reply: (id: number, uid: string, body: Record<string, unknown>) => apiPost<{ version: number }>(`${f(id)}/annotations/${encodeURIComponent(uid)}/replies`, body),
  formsDetect: (id: number) => apiPost<{ proposals: Array<{ name: string; type: string; page: number; rect: Rect; label: string }> }>(`${f(id)}/forms/detect`),
  formsAuthor: (id: number, body: Record<string, unknown>) => apiPost<{ version: number }>(`${f(id)}/forms/author`, body),
  compare: (body: Record<string, unknown>) => apiPost<{ id: number; stats: Record<string, number>; differences: Array<{ type: string; left: { page: number; text: string } | null; right: { page: number; text: string } | null }> }>('/api/pdfpro/compare', body),
  compareExport: (id: number, kind: 'report' | 'annotated') => apiPost<{ file_id: number }>(`/api/pdfpro/compare/${id}/export`, { kind }),
  envelopeCreate: (body: Record<string, unknown>) => apiPost<{ id: number; status: string }>('/api/pdfpro/envelopes', body),
  envelopeSend: (id: number) => apiPost<{ id: number; status: string }>(`/api/pdfpro/envelopes/${id}/send`),
  actions: () => apiGet<{ actions: Array<{ id: number; name: string; version: number }> }>('/api/pdfpro/actions'),
  runStart: (body: Record<string, unknown>) => apiPost<{ id: number; status: string; total: number }>('/api/pdfpro/runs', body),
  run: (id: number) => apiGet<{ id: number; status: string; done: number; failed: number; total: number; items: Array<{ name: string | null; status: string; error: string | null }> }>(`/api/pdfpro/runs/${id}`),
  stamp: (id: number, body: Record<string, unknown>) => apiPost<{ version: number }>(`${f(id)}/stamp`, body),
  forget: (id: number) => apiDelete(`/api/pdfpro/envelopes/${id}`),
};

/* ─────────────────────────── signing with a PKCS#12 file ─────────────────────────── */

const BAG_KEY = '1.2.840.113549.1.12.10.1.2';
const BAG_PLAIN_KEY = '1.2.840.113549.1.12.10.1.1';
const BAG_CERT = '1.2.840.113549.1.12.10.1.3';

export interface LocalId { keyDer: ArrayBuffer; certsDer: ArrayBuffer[]; subject: string; ec: boolean }

const pem = (der: ArrayBuffer, label: string) => {
  const b = new Uint8Array(der);
  let s = '';
  b.forEach((x) => { s += String.fromCharCode(x); });
  return `-----BEGIN ${label}-----\n${(btoa(s).match(/.{1,64}/g) ?? []).join('\n')}\n-----END ${label}-----\n`;
};

/** A PKCS#12 file opened on this computer: its private key and certificates. Nothing is sent anywhere. */
export async function openPkcs12(file: ArrayBuffer, password: string): Promise<LocalId> {
  const pw = new TextEncoder().encode(password).buffer as ArrayBuffer;
  const pfx = pkijs.PFX.fromBER(file);
  await pfx.parseInternalValues({ password: pw, checkIntegrity: true });
  const safe = pfx.parsedValue?.authenticatedSafe;

  if (!safe) throw new Error(text('That is not a PKCS#12 file.'));

  await safe.parseInternalValues({ safeContents: safe.safeContents.map(() => ({ password: pw })) });
  let keyDer: ArrayBuffer | null = null;
  const certsDer: ArrayBuffer[] = [];
  let subject = '';

  for (const sc of (safe.parsedValue?.safeContents ?? []) as Array<{ value: { safeBags: pkijs.SafeBag[] } }>) {
    for (const bag of sc.value.safeBags) {
      if (bag.bagId === BAG_KEY) {
        const v = bag.bagValue as unknown as { parseInternalValues(p: { password: ArrayBuffer }): Promise<void>; parsedValue?: pkijs.PrivateKeyInfo };
        await v.parseInternalValues({ password: pw });
        keyDer = v.parsedValue?.toSchema().toBER(false) ?? null;
      } else if (bag.bagId === BAG_PLAIN_KEY) {
        keyDer = (bag.bagValue as unknown as pkijs.PrivateKeyInfo).toSchema().toBER(false);
      } else if (bag.bagId === BAG_CERT) {
        const cert = (bag.bagValue as unknown as pkijs.CertBag).parsedValue as pkijs.Certificate;
        certsDer.push(cert.toSchema().toBER(false));
        if (!subject) subject = cert.subject.typesAndValues.find((t) => t.type === '2.5.4.3')?.value.valueBlock.value ?? '';
      }
    }
  }

  if (!keyDer || !certsDer.length) throw new Error(text('The file has no signing key and certificate, or the password is wrong.'));
  const alg = pkijs.PrivateKeyInfo.fromBER(keyDer).privateKeyAlgorithm.algorithmId;

  return { keyDer, certsDer, subject, ec: alg === '1.2.840.10045.2.1' };
}

/** Signs the server's prepared bytes with the local key (SHA-256). */
export async function signLocally(id: LocalId, toSign: ArrayBuffer): Promise<ArrayBuffer> {
  const algo = id.ec ? { name: 'ECDSA', namedCurve: 'P-256' } : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
  const key = await crypto.subtle.importKey('pkcs8', id.keyDer, algo, false, ['sign']);
  const sig = await crypto.subtle.sign(id.ec ? { name: 'ECDSA', hash: 'SHA-256' } : 'RSASSA-PKCS1-v1_5', key, toSign);

  if (!id.ec) return sig;

  // WebCrypto's ECDSA is r||s; CMS wants the DER SEQUENCE of two INTEGERs.
  const raw = new Uint8Array(sig);
  const half = raw.length / 2;
  const int = (b: Uint8Array) => new asn1js.Integer({ valueHex: (b[0]! & 0x80 ? new Uint8Array([0, ...b]) : b).buffer as ArrayBuffer });
  return new asn1js.Sequence({ value: [int(raw.slice(0, half)), int(raw.slice(half))] }).toBER(false);
}

/** The whole desktop signing step: prepare on the server, sign here, complete on the server. */
export async function signWithLocalId(fileId: number, id: LocalId, opts: { level: string; reason?: string; page?: number; rect?: Rect | null }): Promise<{ version: number; level: string }> {
  const chain = id.certsDer.map((c) => pem(c, 'CERTIFICATE')).join('');
  const p = await pro.sign(fileId, { step: 'prepare', certificate_chain_pem: chain, level: opts.level, reason: opts.reason, ...(opts.rect ? { page: opts.page ?? 1, rect: opts.rect } : {}) });
  const bytes = Uint8Array.from(atob(p.to_sign_b64 ?? ''), (c) => c.charCodeAt(0));
  const sig = new Uint8Array(await signLocally(id, bytes.buffer as ArrayBuffer));
  let s = '';
  sig.forEach((x) => { s += String.fromCharCode(x); });
  return pro.sign(fileId, { step: 'complete', token: p.token, signature_b64: btoa(s) });
}
