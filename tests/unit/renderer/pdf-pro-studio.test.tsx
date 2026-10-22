// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * PDF Studio Pro on the desktop, second release: a smart card or USB token
 * signs the server's prepared bytes through the main process — the PIN goes
 * there once and is cleared from the window (PRO-SIG-002); OCR goes to the
 * server with the options chosen (PRO-CNV-003..005); presence lists who else
 * is on the PDF and drops them when the file's topic says they left
 * (PRO-REV-006).
 */
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn(async (_p: string) => undefined) }));
const bridge = vi.hoisted(() => ({ calls: [] as Array<{ channel: string; input: unknown }>, listeners: new Map<string, (p: unknown) => void>() }));
vi.mock('../../../src/core/api', () => ({
  ApiError: class ApiError extends Error { code = null; },
  apiGet: (p: string) => api.get(p),
  apiPost: (p: string, b: unknown) => api.post(p, b),
  apiDelete: (p: string) => api.del(p),
}));
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(async (channel: string, input: unknown) => {
    bridge.calls.push({ channel, input });
    if (channel === 'pdf:tokens') {
      // The test signer's certificate, as a token would hold it (from the PKCS#12 fixture: no key file in the repository).
      const { openPkcs12 } = await import('../../../src/modules/pdf/pro');
      const p12 = readFileSync(join(__dirname, '../../fixtures/pdf/pro-signer.p12'));
      const id = await openPkcs12(p12.buffer.slice(p12.byteOffset, p12.byteOffset + p12.byteLength) as ArrayBuffer, 'secret');
      const der = new X509Certificate(Buffer.from(id.certsDer[0]!)).raw.toString('base64');
      return { available: true, reason: null, tokens: [{ module: '/usr/lib/opensc-pkcs11.so', token: 'Asha eToken', manufacturer: 'SafeNet', certs: [{ module: '/usr/lib/opensc-pkcs11.so', token: 'Asha eToken', id: '01', label: 'Asha Perera', der }] }] };
    }
    if (channel === 'pdf:tokenSign') return new Uint8Array([7, 7, 7]);
    return undefined;
  }),
  on: (channel: string, cb: (p: unknown) => void) => { bridge.listeners.set(channel, cb); return () => bridge.listeners.delete(channel); },
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

const { TokenSign, ConvertOcr, PresenceLine } = await import('../../../src/modules/pdf/ProStudio');

afterEach(() => { cleanup(); api.get.mockReset(); api.post.mockReset(); bridge.calls.length = 0; });

describe('the desktop Pro sections', () => {
  it('signs with a token: prepare with its certificate, sign through the main process, complete', async () => {
    api.post.mockImplementation(async (_p: string, b: { step?: string }) => (b.step === 'prepare' ? { token: 'tok-1', to_sign_b64: btoa('attrs'), level: 'B-T' } : { version: 3, level: 'B-T' }));
    const changed = vi.fn();
    render(<TokenSign fileId={4} level="B-T" reason="Approved" rect={null} onChanged={changed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Find tokens' }));
    expect(await screen.findByRole('option', { name: /Asha Perera — Asha eToken/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Token PIN'), { target: { value: '4321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign with the token' }));
    await waitFor(() => expect(changed).toHaveBeenCalledWith(3));
    expect(api.post.mock.calls[0]![1]).toMatchObject({ step: 'prepare', level: 'B-T', reason: 'Approved' });
    expect(String((api.post.mock.calls[0]![1] as { certificate_chain_pem: string }).certificate_chain_pem)).toContain('BEGIN CERTIFICATE');
    const sign = bridge.calls.find((c) => c.channel === 'pdf:tokenSign')!.input as { pin: string; id: string; data: Uint8Array; ec: boolean };
    expect([sign.pin, sign.id, new TextDecoder().decode(sign.data), sign.ec]).toEqual(['4321', '01', 'attrs', false]);
    expect(api.post.mock.calls[1]![1]).toEqual({ step: 'complete', token: 'tok-1', signature_b64: btoa('\x07\x07\x07') });
    // The PIN does not stay in the window.
    expect((screen.getByLabelText('Token PIN') as HTMLInputElement).value).toBe('');
  });

  it('runs OCR with the language and cleaning chosen', async () => {
    api.get.mockResolvedValue({ from_pdf: [{ format: 'docx', engine: 'builtin' }], to_pdf: [], url: false, ocr: { available: true, languages: ['eng', 'sin', 'tam'], detail: '' } });
    api.post.mockResolvedValue({ mode: 'version', file_id: 4, version: 5, recognised: 1, pages: [{ page: 1, language: 'tam', rotated: 180, words: 9, confidence: 95 }] });
    const changed = vi.fn();
    render(<ConvertOcr fileId={4} version={4} canConvert canOcr onChanged={changed} />);
    await screen.findByRole('option', { name: 'தமிழ்' });
    fireEvent.change(screen.getAllByLabelText('Language')[0]!, { target: { value: 'tam' } });
    fireEvent.click(screen.getByRole('button', { name: 'Recognise text' }));
    await waitFor(() => expect(changed).toHaveBeenCalledWith(5));
    expect(api.post).toHaveBeenCalledWith('/api/files/4/pdf/ocr', expect.objectContaining({ mode: 'searchable', languages: ['tam'], despeckle: 'auto', background: 'auto', base_version: 4 }));
    expect(await screen.findByText(/p\.1: tam · 9 · 95% · ↻180°/)).toBeTruthy();
  });

  it('lists who else is on the PDF and drops them when they leave', async () => {
    api.post.mockResolvedValue({ topic: 'pdf.file.4', interval: 20, others: [{ user_id: 3, name: 'Ben', page: 2, client: 'web' }] });
    render(<PresenceLine fileId={4} page={1} />);
    expect(await screen.findByText(/Ben \(page 2\)/)).toBeTruthy();
    bridge.listeners.get('realtime:event')?.({ type: 'pdf.presence', topic: 'pdf.file.4', actor: 3, left: true });
    await waitFor(() => expect(screen.queryByText(/Ben/)).toBeNull());
  });
});
