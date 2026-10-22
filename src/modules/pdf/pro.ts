import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { ApiError, apiDelete, apiGet, apiPost } from '../../core/api';
import { call } from '../../core/bridge';
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

  // Conversion and OCR (PRO-CNV-001..006).
  formats: () => apiGet<ConvertFormats>('/api/pdfpro/convert/formats'),
  convert: (id: number, format: string) => apiPost<{ file_id: number; name: string; engine: string }>(`${f(id)}/convert`, { format }),
  convertToPdf: (body: Record<string, unknown>) => apiPost<{ file_id: number; name: string; pages: number }>('/api/pdfpro/convert', body),
  ocr: (id: number, body: Record<string, unknown>) => apiPost<OcrResult>(`${f(id)}/ocr`, body),
  ocrDetect: (id: number, pages = '1-3') => apiPost<{ pages: Array<{ page: number; rotate: number; language: string | null }> }>(`${f(id)}/ocr/detect`, { pages }),
  ocrTemplates: () => apiGet<{ templates: Array<{ id: number; name: string; zones: unknown[] }> }>('/api/pdfpro/ocr-templates'),
  ocrZonal: (id: number, templateId: number) => apiPost<{ values: Array<{ name: string; value: string; valid: boolean; confidence: number }> }>(`${f(id)}/ocr/zonal`, { template_id: templateId }),
  // Print production (PRO-PRT-001..005).
  preflight: (id: number, body: Record<string, unknown>) => apiPost<{ passed: boolean; fixed?: string[]; version?: number; results: Array<{ rule: string; status: string; page: number | null; message: string }> }>(`${f(id)}/preflight`, body),
  separations: (id: number, page: number, preview?: string) => apiGet<{ pages: Array<{ page: number; channels: string[]; overprint: boolean }>; output_intent: { condition: string | null }; preview?: { png_b64: string } }>(
    `${f(id)}/separations?page=${page}${preview ? `&preview=${encodeURIComponent(preview)}` : ''}`),
  impose: (id: number, body: Record<string, unknown>) => apiPost<{ file_id: number; sheets: number }>(`${f(id)}/impose`, body),
  layers: (id: number) => apiGet<{ layers: Array<{ name: string; on: boolean }> }>(`${f(id)}/layers`),
  layersSet: (id: number, body: Record<string, unknown>) => apiPost<{ version: number }>(`${f(id)}/layers`, body),
  measure: (id: number, body: Record<string, unknown>) => apiPost<{ value: number; unit: string; version?: number }>(`${f(id)}/measure`, body),
  // Forms by link (PRO-FRM-006).
  formLinks: (id: number) => apiGet<{ links: FormLink[] }>(`${f(id)}/forms/links`),
  formLinkCreate: (id: number, body: Record<string, unknown>) => apiPost<FormLink & { token: string; path: string }>(`${f(id)}/forms/links`, body),
  formLinkUpdate: (id: number, lid: number, body: Record<string, unknown>) => apiPost<FormLink>(`${f(id)}/forms/links/${lid}`, body),
  formResponses: (id: number, lid: number) => apiGet<{ columns: string[]; rows: Array<{ id: number; cells: string[] }> }>(`${f(id)}/forms/links/${lid}/responses`),
  // Live presence (PRO-REV-006).
  presence: (id: number, page: number) => apiPost<{ topic: string; others: PresenceRow[]; interval: number }>(`${f(id)}/presence`, { page, client: 'desktop' }),
  presenceLeave: (id: number) => apiDelete(`${f(id)}/presence`),
};

export interface ConvertFormats { from_pdf: Array<{ format: string; engine: string }>; to_pdf: string[]; url: boolean; ocr: { available: boolean; languages: string[]; detail: string } }
export interface OcrResult {
  mode: 'version' | 'copy' | 'none'; file_id: number; version: number; recognised: number; message?: string;
  pages: Array<{ page: number; language: string; rotated: number; words: number; confidence: number; skipped?: string }>;
}
export interface FormLink { id: number; title: string; status: string; responses: number; max_responses: number; fields: string[] }
export interface PresenceRow { user_id: number; name: string; page: number; client: string }

/* ─────────────────────────── signing with a smart card or USB token ─────────────────────────── */

export interface TokenCert { module: string; token: string; id: string; label: string; der: string }

/** The tokens plugged in and their certificates (main process, through the token's PKCS#11 library). */
export function listTokens(module?: string | null): Promise<{ available: boolean; reason: string | null; tokens: Array<{ module: string; token: string; manufacturer: string; certs: TokenCert[] }> }> {
  return call('pdf:tokens', { module: module ?? null });
}

/** Whether a certificate's key is an elliptic-curve one (it signs ECDSA). */
export function isEcCert(derB64: string): boolean {
  const der = Uint8Array.from(atob(derB64), (c) => c.charCodeAt(0));
  const cert = pkijs.Certificate.fromBER(der);

  return cert.subjectPublicKeyInfo.algorithm.algorithmId === '1.2.840.10045.2.1';
}

/**
 * Prepare on the server with the token's certificate, sign on the token with
 * the PIN (handed to the token library, never kept), complete on the server.
 */
export async function signWithToken(fileId: number, cert: TokenCert, pin: string, opts: { level: string; reason?: string; page?: number; rect?: Rect | null }): Promise<{ version: number; level: string }> {
  const der = Uint8Array.from(atob(cert.der), (c) => c.charCodeAt(0));
  const p = await pro.sign(fileId, { step: 'prepare', certificate_chain_pem: pem(der.buffer as ArrayBuffer, 'CERTIFICATE'), level: opts.level, reason: opts.reason,
    ...(opts.rect ? { page: opts.page ?? 1, rect: opts.rect } : {}) });
  const data = Uint8Array.from(atob(p.to_sign_b64 ?? ''), (c) => c.charCodeAt(0));
  const sig = await call('pdf:tokenSign', { module: cert.module, token: cert.token, id: cert.id, pin, data, ec: isEcCert(cert.der) });
  let s = '';
  new Uint8Array(sig).forEach((x) => { s += String.fromCharCode(x); });

  return pro.sign(fileId, { step: 'complete', token: p.token, signature_b64: btoa(s) });
}

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
