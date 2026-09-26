// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/app-state', () => ({ app: { get: () => ({ auth: { server: { origin: 'https://ws.example' } } }) } }));
import { mimeFor } from '../../../shared/mime';
import { can, extOf, flatten, kindOf, openWay, pathTo, splitKeys, subtree, tagOf, type TreeNode } from '../../../src/modules/files/api';
import { fileMenu, folderMenu, type Drive } from '../../../src/modules/files/ctx';

const node = (id: number, name: string, children: TreeNode[] = []): TreeNode => ({ id, parent_id: null, name, description: null, path: name, color: null, is_archived: false, is_locked: false, file_count: 0, total_size: 0, starred: false, children });
const tree = [node(1, 'Projects', [node(2, 'Desktop', [node(3, 'Design')]), node(4, 'Garage')]), node(5, 'HR')];

describe('what a file is', () => {
  it('knows the kind and the tag from the extension', () => {
    expect(kindOf('Desktop_SRS.docx')).toBe('document');
    expect(kindOf('Q3.XLSX')).toBe('spreadsheet');
    expect(kindOf('clip.mov')).toBe('video');
    expect(kindOf('ipc-contract.ts')).toBe('code');
    expect(kindOf('mystery')).toBe('other');
    expect(tagOf('Desktop_SRS.docx')).toBe('DOCX');
    expect(tagOf('archive.tar.gz')).toBe('GZ');
    expect(extOf('photo', 'PNG')).toBe('png');
  });

  it('opens each kind the right way: previews here, PDFs and Office on the web, archives inside', () => {
    expect(openWay({ name: 'a.png', extension: 'png' })).toBe('preview');
    expect(openWay({ name: 'a.mp4', extension: 'mp4' })).toBe('preview');
    expect(openWay({ name: 'BLOCKERS.md', extension: 'md' })).toBe('preview');
    expect(openWay({ name: 'a.pdf', extension: 'pdf' })).toBe('pdf');
    expect(openWay({ name: 'a.docx', extension: 'docx' })).toBe('office');
    expect(openWay({ name: 'a.csv', extension: 'csv' })).toBe('office');
    expect(openWay({ name: 'a.zip', extension: 'zip' })).toBe('archive');
    expect(openWay({ name: 'logo.svg', extension: 'svg' })).toBe('download');
    expect(openWay({ name: 'setup.dmg', extension: 'dmg' })).toBe('download');
  });
});

describe('the folder tree', () => {
  it('flattens with depth, finds the way down, and knows what is inside a folder', () => {
    expect(flatten(tree).map((n) => `${n.depth}:${n.name}`)).toEqual(['0:Projects', '1:Desktop', '2:Design', '1:Garage', '0:HR']);
    expect(pathTo(tree, 3)).toEqual([1, 2]);
    expect(pathTo(tree, 99)).toBeNull();
    expect(subtree(tree, 2).sort()).toEqual([2, 3]);
    expect(subtree(tree, 1).sort()).toEqual([1, 2, 3, 4]);
  });

  it('splits a selection into files and folders', () => {
    expect(splitKeys(['f:4', 'd:2', 'f:9'])).toEqual({ files: [4, 9], folders: [2] });
  });
});

describe('the menus follow what the server allows', () => {
  const d = new Proxy({}, { get: () => () => undefined }) as unknown as Drive;
  const labels = (items: Array<{ sep?: true; label?: string }>) => items.filter((m) => !('sep' in m)).map((m) => m.label);
  const file = (capabilities: string[], owner = false) => ({ id: 1, name: 'Report.docx', extension: 'docx', access: { level: 'view' as const, owner, via: null, can_download: true, capabilities } }) as never;

  it('a viewer who may download gets no sharing, renaming or trash', () => {
    const m = labels(fileMenu(file(['open', 'preview', 'download']), d));
    expect(m).toContain('Download');
    expect(m).toContain('Open locally');
    expect(m).not.toContain('Share…');
    expect(m).not.toContain('Rename');
    expect(m).not.toContain('Move to trash');
    expect(m).not.toContain('Edit in Office');
  });

  it('the owner gets everything, the public link included', () => {
    const m = labels(fileMenu(file(['open', 'preview', 'download', 'edit', 'rename', 'share', 'move', 'delete', 'chat_share'], true), d));
    for (const l of ['Edit in Office', 'Share…', 'Secure link…', 'Copy public link', 'Send to Chat…', 'Rename', 'Move…', 'Copy to…', 'Zip', 'Move to trash']) expect(m).toContain(l);
  });

  it('a folder offers the password lock to its owner only', () => {
    const f = (owner: boolean) => ({ id: 2, name: 'HR', is_locked: false, starred: false, access: { level: 'full', owner, via: null, can_download: true, capabilities: ['open', 'share', 'delete', 'rename', 'move', 'download'] } }) as never;
    expect(labels(folderMenu(f(true), d))).toContain('Password lock…');
    expect(labels(folderMenu(f(false), d))).not.toContain('Password lock…');
    expect(can(null, 'open')).toBe(false);
  });

  it('never starts, ends or doubles a separator', () => {
    const items = fileMenu(file(['open']), d);
    expect('sep' in items[0]!).toBe(false);
    expect('sep' in items[items.length - 1]!).toBe(false);
    expect(items.some((m, i) => 'sep' in m && i > 0 && 'sep' in items[i - 1]!)).toBe(false);
  });
});

describe('uploads say what they are', () => {
  it('names the media type from the extension, so the server can preview it', () => {
    expect(mimeFor('photo.PNG')).toBe('image/png');
    expect(mimeFor('clip.mov')).toBe('video/quicktime');
    expect(mimeFor('Report.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(mimeFor('README')).toBeNull();
    expect(mimeFor('weird.xyz')).toBeNull();
  });
});
