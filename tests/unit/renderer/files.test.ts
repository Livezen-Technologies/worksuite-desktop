// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/app-state', () => ({ app: { get: () => ({ auth: { server: { origin: 'https://ws.example' } } }) } }));
import { mimeFor } from '../../../shared/mime';
import { can, extOf, flatten, kindOf, openWay, pathTo, splitKeys, subtree, tagOf, type TreeNode } from '../../../src/modules/files/api';
import { fileMenu, folderMenu, type Drive } from '../../../src/modules/files/ctx';
import { ADJUSTMENTS, BLANK, adjustPixels, outputSize, outputType, summary, turned } from '../../../src/modules/files/imaging';
import { formatText, indentOf } from '../../../src/modules/files/CodeEditor';
import { clock } from '../../../src/modules/files/MediaViewer';

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

  it('opens each kind the right way: pictures preview, sound and video play, text edits, PDFs and Office on the web, archives inside', () => {
    expect(openWay({ name: 'a.png', extension: 'png' })).toBe('preview');
    expect(openWay({ name: 'a.mp4', extension: 'mp4' })).toBe('media');
    expect(openWay({ name: 'a.mp3', extension: 'mp3' })).toBe('media');
    expect(openWay({ name: 'BLOCKERS.md', extension: 'md' })).toBe('code');
    expect(openWay({ name: 'ipc.ts', extension: 'ts' })).toBe('code');
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


describe('the image editor', () => {
  it('knows the size a recipe makes: turned, cropped, resized', () => {
    expect(turned(1920, 1200, 90)).toEqual({ w: 1200, h: 1920 });
    expect(outputSize(1920, 1200, BLANK)).toEqual({ w: 1920, h: 1200 });
    expect(outputSize(1920, 1200, { ...BLANK, crop: { x: 0.25, y: 0, w: 0.5, h: 0.5 } })).toEqual({ w: 960, h: 600 });
    expect(outputSize(1920, 1200, { ...BLANK, rotate: 90, crop: { x: 0, y: 0, w: 1, h: 0.5 } })).toEqual({ w: 1200, h: 960 });
    expect(outputSize(1920, 1200, { ...BLANK, resize: { w: 640, h: 400 } })).toEqual({ w: 640, h: 400 });
  });

  it('leaves pixels alone with nothing set, and changes them as asked', () => {
    const px = () => new Uint8ClampedArray([200, 100, 50, 255, 30, 60, 90, 255]);
    const same = px();
    adjustPixels(same, BLANK.adjust, 'none');
    expect([...same]).toEqual([...px()]);
    const mono = px();
    adjustPixels(mono, BLANK.adjust, 'mono');
    expect(mono[0]).toBe(mono[1]);
    expect(mono[1]).toBe(mono[2]);
    const bright = px();
    adjustPixels(bright, { ...BLANK.adjust, brightness: 50 }, 'none');
    expect(bright[4]!).toBeGreaterThan(30);
    const warm = px();
    adjustPixels(warm, { ...BLANK.adjust, temperature: 50 }, 'none');
    expect(warm[0]!).toBeGreaterThan(200);
    expect(warm[2]!).toBeLessThan(50);
    expect(warm[3]).toBe(255);
    expect(ADJUSTMENTS).toHaveLength(11);
  });

  it('says what was done, and keeps the file type where it can', () => {
    expect(summary({ ...BLANK, rotate: 90, adjust: { ...BLANK.adjust, contrast: 10 }, look: 'warm' })).toBe('Edited: turned 90°; adjusted contrast; warm look');
    expect(outputType('jpg').mime).toBe('image/jpeg');
    expect(outputType('gif')).toEqual({ mime: 'image/png', ext: 'png' });
  });
});

describe('the code editor', () => {
  it('reads how a file indents', () => {
    expect(indentOf('a\n    b\n        c')).toEqual({ tabs: false, size: 4 });
    expect(indentOf('a\n\tb\n\t\tc')).toEqual({ tabs: true, size: 1 });
    expect(indentOf('flat\ntext')).toEqual({ tabs: false, size: 2 });
  });

  it('formats JSON again, and tidies other text', () => {
    expect(formatText('{"a":1,"b":[1,2]}', 'json', { tabs: false, size: 2 })).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}\n');
    expect(formatText('one  \ntwo\t\n\n\n', 'md', { tabs: false, size: 2 })).toBe('one\ntwo\n');
    expect(formatText('{broken', 'json', { tabs: false, size: 2 })).toBe('{broken\n');
  });
});

describe('the media player', () => {
  it('shows times as minutes and seconds, and hours past an hour', () => {
    expect(clock(0)).toBe('00:00');
    expect(clock(134_000)).toBe('02:14');
    expect(clock(3_723_000)).toBe('1:02:03');
  });
});
