// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { createVerify, X509Certificate } from 'node:crypto';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * PDF Studio Pro on the desktop (WS-SRS-PDFPRO-001): a Drive PDF's Pro panel
 * shows the upgrade prompt without a seat and only the sections the
 * permissions allow; and a PKCS#12 file opened here signs the server's
 * prepared bytes with a key that never leaves this computer (PRO-SIG-002).
 */
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../../src/core/api', () => ({
  ApiError: class ApiError extends Error { code = null; },
  apiGet: (p: string) => api.get(p),
  apiPost: (p: string, b: unknown) => api.post(p, b),
  apiDelete: vi.fn(),
}));

const { openPkcs12, signLocally, signWithLocalId } = await import('../../../src/modules/pdf/pro');
const { default: ProPanel } = await import('../../../src/modules/pdf/ProPanel');

const P12 = readFileSync(join(__dirname, '../../fixtures/pdf/pro-signer.p12'));
const buf = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

const me = (features: Record<string, boolean>, entitled = true) => ({
  entitled, features, settings: { min_signature_level: 'B-B', ai_enabled: true }, redaction_codes: [], patterns: { email: 'Email addresses' }, certificates: [],
});

afterEach(() => { cleanup(); api.get.mockReset(); api.post.mockReset(); });

describe('Pro panel', () => {
  it('tells a person without a seat how to get one', async () => {
    api.get.mockResolvedValue(me({}, false));
    render(<ProPanel fileId={4} version={2} page={0} onChanged={() => {}} />);
    expect(await screen.findByText(/Ask your PDF administrator for a Pro seat/)).toBeTruthy();
  });

  it('shows only what the permissions allow', async () => {
    api.get.mockImplementation(async (p: string) => (p === '/api/pdfpro/me' ? me({ redact: true, sign: false, compare: false }) : { signatures: [] }));
    render(<ProPanel fileId={4} version={2} page={0} onChanged={() => {}} />);
    expect(await screen.findByText('Redact and sanitise')).toBeTruthy();
    expect(screen.queryByText('Compare versions')).toBeNull();
    expect(screen.queryByText('Send for signature')).toBeNull();
  });
});

describe('signing with a PKCS#12 file on this computer', () => {
  it('opens the file, signs with its key, and the signature verifies against its certificate', async () => {
    const id = await openPkcs12(buf(P12), 'secret');
    expect(id.subject).toBe('Desk Signer');
    const data = new TextEncoder().encode('signed attributes').buffer as ArrayBuffer;
    const sig = Buffer.from(await signLocally(id, data));
    const cert = new X509Certificate(Buffer.from(id.certsDer[0]!));
    expect(createVerify('sha256').update(Buffer.from(data)).verify(cert.publicKey, sig)).toBe(true);
  });

  it('refuses a wrong password', async () => {
    await expect(openPkcs12(buf(P12), 'wrong')).rejects.toBeTruthy();
  });

  it('sends the server only the certificate and the signature', async () => {
    const id = await openPkcs12(buf(P12), 'secret');
    api.post.mockImplementation(async (_p: string, b: Record<string, unknown>) => (b.step === 'prepare' ? { token: 't', to_sign_b64: btoa('abc') } : { version: 3, level: 'B-B' }));
    const r = await signWithLocalId(9, id, { level: 'B-B' });
    expect(r).toEqual({ version: 3, level: 'B-B' });
    const [prep, done] = api.post.mock.calls.map((c) => c[1] as Record<string, string>);
    expect(prep!.certificate_chain_pem).toContain('BEGIN CERTIFICATE');
    expect(JSON.stringify(api.post.mock.calls)).not.toContain('PRIVATE KEY');
    expect(done!.signature_b64.length).toBeGreaterThan(100);
  });
});
