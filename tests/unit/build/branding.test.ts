import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Installer branding (0.2.291): people read "WorkSuite Desktop"; what decides paths and identity does not change. */

const root = join(__dirname, '../../..');
const config = createRequire(import.meta.url)(join(root, 'build/electron-builder.config.cjs'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

describe('installer branding', () => {
  it('keeps the names that decide install paths, app data and update identity', () => {
    expect(config.productName).toBe('WorkSuite');
    expect(pkg.productName).toBe('WorkSuite');
    expect(config.appId).toBe('lk.worksuite.desktop');
    expect(config.linux.executableName).toBe('worksuite');
    expect(config.linux.desktop.entry.StartupWMClass).toBe('WorkSuite');
    expect(config.mac.extendInfo.CFBundleName).toBeUndefined();
  });

  it('shows WorkSuite Desktop on every platform', () => {
    expect(config.nsis.shortcutName).toBe('WorkSuite Desktop');
    expect(config.nsis.uninstallDisplayName).toBe('WorkSuite Desktop ${version}');
    expect(config.mac.extendInfo.CFBundleDisplayName).toBe('WorkSuite Desktop');
    expect(config.dmg.title).toBe('WorkSuite Desktop ${version}');
    expect(config.linux.desktop.entry.Name).toBe('WorkSuite Desktop');
    expect(JSON.stringify(config)).not.toMatch(/Electron/);
  });

  it('ships the generated artwork at the sizes NSIS wants', () => {
    const size = (f: string) => {
      const b = readFileSync(join(root, f));
      expect(b.subarray(0, 2).toString()).toBe('BM');
      return [b.readInt32LE(18), b.readInt32LE(22)];
    };
    expect(size(config.nsis.installerSidebar)).toEqual([164, 314]);
    expect(size(config.nsis.installerHeader)).toEqual([150, 57]);
  });

  it('shows the repository licence, as UTF-8 NSIS can read', () => {
    const page = readFileSync(join(root, config.nsis.license));
    expect([...page.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const norm = (t: string) => t.replace(/\r\n/g, '\n');
    expect(norm(page.subarray(3).toString('utf8'))).toBe(norm(readFileSync(join(root, 'LICENSE'), 'utf8')));
  });
});
