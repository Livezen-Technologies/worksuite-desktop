import { describe, expect, it } from 'vitest';
import { OFFICE_KIND_LABELS, officeDocRoute, officeKind, parseOfficeDocRoute } from '../../../shared/office';
import { contract } from '../../../shared/ipc/contract';

describe('WorkSuite DOC / Sheet / Slides', () => {
  it('routes each Office type to its tab, and PDFs elsewhere', () => {
    for (const n of ['a.doc', 'a.docx', 'a.odt', 'a.rtf']) expect(officeKind(n)).toBe('doc');
    for (const n of ['a.xls', 'a.xlsx', 'a.ods', 'a.csv']) expect(officeKind(n)).toBe('sheet');
    for (const n of ['a.ppt', 'a.pptx', 'a.odp']) expect(officeKind(n)).toBe('slides');
    expect(officeKind('a.pdf')).toBeNull();
    expect(OFFICE_KIND_LABELS[officeKind('Budget.XLSX')!]).toBe('WorkSuite Sheet');
  });

  it('opens a document that is not a Drive file by where this server serves it, or by a local handle', () => {
    const mail = { kind: 'api' as const, path: '/api/mail/messages/9/attachments/a%2Fb?folder=INBOX&dl=1', name: 'Proposal.docx' };
    expect(parseOfficeDocRoute(officeDocRoute(mail))).toEqual(mail);
    const local = { kind: 'local' as const, handle: '0e9c3a2e-5b1f-4c7e-9a41-2f1d7c9b8e10', name: 'Budget.xlsx' };
    expect(parseOfficeDocRoute(officeDocRoute(local))).toEqual(local);
    // Only this server's API or signed media, never another address or a climb out of it.
    expect(parseOfficeDocRoute('/office/doc?src=api&path=https%3A%2F%2Fevil.example%2Fx&name=a.docx')).toBeNull();
    expect(parseOfficeDocRoute('/office/doc?src=api&path=%2Fapi%2F..%2Fsecrets&name=a.docx')).toBeNull();
    expect(parseOfficeDocRoute('/office/doc?src=local&h=..%2Fetc&name=a.docx')).toBeNull();
    expect(parseOfficeDocRoute('/office/42')).toBeNull();
  });

  it('takes a document’s bytes over IPC only as bytes, within the limit', () => {
    const h = '0e9c3a2e-5b1f-4c7e-9a41-2f1d7c9b8e10';
    expect(contract['office:writeFile'].input.safeParse({ handle: h, bytes: new Uint8Array([0x50, 0x4b]) }).success).toBe(true);
    expect(contract['office:writeFile'].input.safeParse({ handle: h, bytes: new Uint8Array(0) }).success).toBe(false);
    expect(contract['office:writeFile'].input.safeParse({ handle: h, bytes: 'PK' }).success).toBe(false);
    expect(contract['office:writeFile'].input.safeParse({ handle: h, bytes: new Uint8Array([1]), path: '/etc/passwd' }).success).toBe(false);
    expect(contract['office:saveCopy'].input.safeParse({ name: '../x.docx', bytes: new Uint8Array([1]) }).success).toBe(false);
    expect(contract['office:readFile'].input.safeParse({ handle: 'not-a-handle' }).success).toBe(false);
  });
});
