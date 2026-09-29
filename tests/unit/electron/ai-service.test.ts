import { describe, expect, it, vi } from 'vitest';
import { AiService, MAX_UPLOAD_BYTES, type AiServiceDeps } from '../../../electron/services/ai';
import { DesktopError } from '../../../electron/main/errors';
import { DEFAULT_POLICY, normalizePolicy } from '../../../electron/services/policy';
import { isProxyPathAllowed } from '../../../electron/services/api-proxy';
import type { DesktopPolicy } from '../../../shared/types';

/**
 * The assistant's desktop service (WS-AI-SRS-001 DSK-2, DSK-5…7): what this
 * computer may do is the stricter of the device policy and the company's;
 * confirming and local files happen in the main process, never through a
 * page's proxy; a synced Drive file is asked about by its id, not sent.
 */

const ALL_ON = { enabled: true, quick_ask: true, insert: true, local_files: true };

function service(over: Partial<AiServiceDeps> = {}, policy: Partial<DesktopPolicy> = {}) {
  const deps: AiServiceDeps = {
    get: vi.fn(async () => ALL_ON) as AiServiceDeps['get'],
    post: vi.fn(async () => ({ ref: 'upload:7', name: 'notes.txt' })) as AiServiceDeps['post'],
    policy: () => ({ ...DEFAULT_POLICY, ...policy }),
    driveIdAt: () => null,
    realpath: async (p) => p,
    size: async () => 120,
    read: async () => Buffer.from('Minutes of the meeting.'),
    ...over,
  };
  return { ai: new AiService(deps), deps };
}

describe('what this computer may do with the assistant', () => {
  it('allows nothing before the company has been asked', () => {
    const { ai } = service();
    expect(ai.rules()).toMatchObject({ enabled: false, quickAsk: false, insert: false, localFiles: false });
  });

  it('is the stricter of the device policy and the company', async () => {
    const { ai } = service({}, { ai_insert: false });
    await ai.refresh();
    expect(ai.rules()).toMatchObject({ enabled: true, quickAsk: true, insert: false, localFiles: true });
    expect(ai.rules().note).toMatch(/switched off Insert/);

    const company = service({ get: vi.fn(async () => ({ ...ALL_ON, quick_ask: false, local_files: false })) as AiServiceDeps['get'] });
    await company.ai.refresh();
    expect(company.ai.rules()).toMatchObject({ quickAsk: false, insert: true, localFiles: false, note: null });
  });

  it('keeps Quick Ask working against a server from before the desktop service, with no uploads', async () => {
    const { ai } = service({ get: vi.fn(async () => { throw new DesktopError('NOT_FOUND', 'Not found', 404); }) as AiServiceDeps['get'] });
    await ai.refresh();
    expect(ai.rules()).toMatchObject({ enabled: true, quickAsk: true, insert: true, localFiles: false });
  });

  it('keeps the last answer when the server cannot be reached', async () => {
    const get = vi.fn(async () => ALL_ON) as AiServiceDeps['get'];
    const { ai } = service({ get });
    await ai.refresh();
    (get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new DesktopError('NETWORK_UNREACHABLE', 'offline'));
    await ai.refresh();
    expect(ai.rules().quickAsk).toBe(true);
    ai.forget();
    expect(ai.rules().enabled).toBe(false);
  });

  it('reads the policy keys flat or nested, and only false switches off', () => {
    expect(normalizePolicy({ ai: { quick_ask: false } }, true).ai_quick_ask).toBe(false);
    expect(normalizePolicy({ ai_insert: false }, true).ai_insert).toBe(false);
    expect(normalizePolicy({ ai_local_files: 'no' }, true).ai_local_files).toBe(true);
    expect(normalizePolicy({}, false)).toMatchObject({ ai_quick_ask: true, ai_insert: true, ai_local_files: true });
  });
});

describe('a file from this computer', () => {
  it('is asked about by its Drive id when it is a synced Drive file, and nothing is sent', async () => {
    const { ai, deps } = service({ driveIdAt: (p) => (p === '/home/k/WorkSuite/Quote.pdf' ? 42 : null) });
    await ai.refresh();
    expect(await ai.upload('/home/k/WorkSuite/Quote.pdf')).toEqual({ ref: 'file:42', name: 'Quote.pdf', via: 'drive' });
    expect(deps.post).not.toHaveBeenCalled();
  });

  it('otherwise sends its words for a day', async () => {
    const { ai, deps } = service();
    await ai.refresh();
    expect(await ai.upload('/tmp/notes.txt')).toEqual({ ref: 'upload:7', name: 'notes.txt', via: 'upload' });
    expect(deps.post).toHaveBeenCalledWith('/api/ai/context/uploads', { name: 'notes.txt', content: Buffer.from('Minutes of the meeting.').toString('base64') });
  });

  it('is refused when either policy says no, before anything is read', async () => {
    const read = vi.fn();
    const { ai } = service({ read }, { ai_local_files: false });
    await ai.refresh();
    await expect(ai.upload('/tmp/notes.txt')).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(read).not.toHaveBeenCalled();
  });

  it('is refused when too large or empty', async () => {
    const big = service({ size: async () => MAX_UPLOAD_BYTES + 1 });
    await big.ai.refresh();
    await expect(big.ai.upload('/tmp/huge.pdf')).rejects.toThrow(/larger than 10 MB/);

    const empty = service({ size: async () => 0 });
    await empty.ai.refresh();
    await expect(empty.ai.upload('/tmp/empty.txt')).rejects.toThrow(/empty/);
  });
});

describe('confirming', () => {
  it('posts the nonce the card was shown to the proposal it belongs to', async () => {
    const { ai, deps } = service();
    await ai.confirm(12, 'abcdef0123456789');
    expect(deps.post).toHaveBeenCalledWith('/api/ai/pending/12/confirm', { nonce: 'abcdef0123456789' });
  });

  it('is never done through a page, nor is a file sent from one', () => {
    expect(isProxyPathAllowed('/api/ai/pending/12/confirm', 'POST')).toBe(false);
    expect(isProxyPathAllowed('/api/ai/context/uploads', 'POST')).toBe(false);
    // Everything else a card does, a page may: cancel, undo, edit, and reading its own proposals.
    expect(isProxyPathAllowed('/api/ai/pending/12/cancel', 'POST')).toBe(true);
    expect(isProxyPathAllowed('/api/ai/pending/12/undo', 'POST')).toBe(true);
    expect(isProxyPathAllowed('/api/ai/pending?which=open', 'GET')).toBe(true);
    expect(isProxyPathAllowed('/api/ai/context/uploads/3', 'GET')).toBe(true);
  });
});
