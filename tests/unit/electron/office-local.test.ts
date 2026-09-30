import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OfficeLocalFiles, officeBytesFit, officePathsInArgv } from '../../../electron/services/office-local';

const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6]);
const write = async (path: string, bytes: Uint8Array) => writeFileSync(path, bytes);

describe('Office files from this computer (WorkSuite DOC / Sheet / Slides)', () => {
  it('opens only .docx, .xlsx and .pptx that are what their names say, outside WorkSuite’s data', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-office-local-'));
    const data = join(dir, 'userData');
    mkdirSync(data);
    writeFileSync(join(dir, 'Plan.docx'), ZIP);
    writeFileSync(join(dir, 'Fake.xlsx'), Buffer.from('not a zip at all'));
    writeFileSync(join(dir, 'Old.doc'), Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    writeFileSync(join(data, 'Secret.pptx'), ZIP);
    const files = new OfficeLocalFiles({ forbidden: () => [data] });
    const { files: ok, rejected } = await files.register([join(dir, 'Plan.docx'), join(dir, 'Fake.xlsx'), join(dir, 'Old.doc'), join(data, 'Secret.pptx'), 'relative.docx']);
    expect(ok.map((f) => f.name)).toEqual(['Plan.docx']);
    expect(rejected.map((r) => r.reason)).toEqual([
      'Fake.xlsx is not what its name says: it cannot be opened as an Office file.',
      'Old.doc is not a .docx, .xlsx or .pptx file.',
      "Secret.pptx is inside WorkSuite's own data and cannot be opened here.",
      'relative.docx is not a file on this computer.',
    ]);
    // The same file again: the same handle, so its tab is found again.
    expect((await files.register([join(dir, 'Plan.docx')])).files[0]!.handle).toBe(ok[0]!.handle);
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads the file, and saves over it only through its handle', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-office-local-'));
    writeFileSync(join(dir, 'Budget.xlsx'), ZIP);
    const files = new OfficeLocalFiles({ forbidden: () => [] });
    const [f] = (await files.register([join(dir, 'Budget.xlsx')])).files;
    expect(Buffer.from(await files.read(f!.handle))).toEqual(ZIP);
    const next = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9, 9]);
    expect(await files.write(f!.handle, next, write)).toEqual({ size: 7 });
    expect(new Uint8Array(readFileSync(join(dir, 'Budget.xlsx')))).toEqual(next);
    await expect(files.read('0e9c3a2e-5b1f-4c7e-9a41-2f1d7c9b8e10')).rejects.toThrow(/no longer holds it/);
    await expect(files.write('0e9c3a2e-5b1f-4c7e-9a41-2f1d7c9b8e10', next, write)).rejects.toThrow(/no longer holds it/);
    files.forget();
    await expect(files.read(f!.handle)).rejects.toThrow(/no longer holds it/);
    rmSync(dir, { recursive: true, force: true });
  });

  it('checks the first bytes by type, and takes files the OS hands over', () => {
    expect(officeBytesFit('a.docx', ZIP)).toBe(true);
    expect(officeBytesFit('a.pptx', Buffer.from('%PDF-1.7'))).toBe(false);
    expect(officeBytesFit('a.rtf', Buffer.from('{\\rtf1 hello'))).toBe(true);
    expect(officePathsInArgv(['/app', '--flag', '/home/me/Plan.docx', '/home/me/a.pdf', 'Deck.pptx', '/x/Deck.PPTX'])).toEqual(['/home/me/Plan.docx', '/x/Deck.PPTX']);
  });
});
