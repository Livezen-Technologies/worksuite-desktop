import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('electron', () => ({ shell: {}, app: { getPath: () => tmpdir() } }));

import { walkFolder } from '../../../electron/services/transfers';

describe('uploading a folder', () => {
  it('lists every file with its place inside the folder, leaving out hidden files and links', async () => {
    const base = mkdtempSync(join(tmpdir(), 'ws-walk-'));
    const root = join(base, 'Site photos');
    mkdirSync(join(root, 'Day 1'), { recursive: true });
    writeFileSync(join(root, 'handover.pdf'), 'pdf');
    writeFileSync(join(root, 'Day 1', 'IMG_0412.jpg'), 'jpg!');
    writeFileSync(join(root, '.DS_Store'), 'x');
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, '.git', 'HEAD'), 'ref');
    symlinkSync(join(root, 'handover.pdf'), join(root, 'link.pdf'));
    const found = await walkFolder(root);
    expect(found.map((f) => f.relativePath)).toEqual(['Site photos/Day 1/IMG_0412.jpg', 'Site photos/handover.pdf']);
    expect(found[0]!.size).toBe(4);
  });
});
