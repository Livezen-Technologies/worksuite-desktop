import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ shell: {}, app: { getPath: () => tmpdir() } }));

import { contract, uploadTargetSchema } from '../../../shared/ipc/contract';
import { fileOnTender } from '../../../electron/services/transfers';

const http = () => ({ post: vi.fn(async () => ({})), request: vi.fn(async () => ({})) });

describe('a file uploaded for a tender is filed where it was asked', () => {
  it('as a new document, titled by its name and of the kind chosen', async () => {
    const h = http();
    await fileOnTender(h as never, { kind: 'tender', tenderId: 7, into: 'document', docKind: 'specification' }, 91, 'Spec.pdf');
    expect(h.post).toHaveBeenCalledWith('/api/tenders/7/documents', { file_id: 91, kind: 'specification', title: 'Spec.pdf' });
  });

  it("as a checklist line's next version, a document's replacement, or a bond's copy", async () => {
    const h = http();
    await fileOnTender(h as never, { kind: 'tender', tenderId: 7, into: 'line', id: 12 }, 91, 'VAT.pdf');
    expect(h.post).toHaveBeenCalledWith('/api/tenders/checklist/12/file', { file_id: 91, name: 'VAT.pdf' });
    await fileOnTender(h as never, { kind: 'tender', tenderId: 7, into: 'replace', id: 4 }, 92, 'Spec v2.pdf');
    expect(h.request).toHaveBeenCalledWith('PUT', '/api/tenders/documents/4', { body: { file_id: 92 } });
    await fileOnTender(h as never, { kind: 'tender', tenderId: 7, into: 'security', id: 3 }, 93, 'Guarantee.pdf');
    expect(h.request).toHaveBeenLastCalledWith('PUT', '/api/tenders/securities/3', { body: { file_id: 93 } });
  });

  it('refuses to guess which line, document or bond it was for', async () => {
    await expect(fileOnTender(http() as never, { kind: 'tender', tenderId: 7, into: 'line' }, 91, 'x.pdf')).rejects.toThrow(/Which line/);
  });

  it('takes only the known ways of filing, and a plain kind of document', () => {
    expect(uploadTargetSchema.safeParse({ kind: 'tender', tenderId: 7, into: 'document', docKind: 'award_letter' }).success).toBe(true);
    expect(uploadTargetSchema.safeParse({ kind: 'tender', tenderId: 7, into: 'somewhere' }).success).toBe(false);
    expect(uploadTargetSchema.safeParse({ kind: 'tender', tenderId: 7, into: 'document', docKind: '../x' }).success).toBe(false);
  });
});

describe("a tender's files are downloaded by what they are, never by a path", () => {
  const input = contract['transfers:download'].input;
  it('takes a document, a checklist file or an earlier version of it, or a letter — one at a time', () => {
    expect(input.safeParse({ tenderDocument: 4, name: 'Spec.pdf' }).success).toBe(true);
    expect(input.safeParse({ tenderLine: { line: 12, version: 3 }, name: 'VAT.pdf' }).success).toBe(true);
    expect(input.safeParse({ tenderLetter: { tender: 7, letter: 2 }, name: 'Letter.pdf' }).success).toBe(true);
    expect(input.safeParse({ tenderDocument: 4, tenderLetter: { tender: 7, letter: 2 }, name: 'x.pdf' }).success).toBe(false);
    expect(input.safeParse({ tenderLine: { line: -1 }, name: 'x.pdf' }).success).toBe(false);
  });
});
