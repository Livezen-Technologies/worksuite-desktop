import { describe, expect, it, vi } from 'vitest';
import { installPackage, linuxInstallKind, packageInstallCommand } from '../../../electron/updater/linux';

/** How a Linux copy was installed, and the one-prompt install command for a .deb or .rpm (worksuite-desktop#345). */
describe('Linux install type', () => {
  it('is an AppImage when $APPIMAGE is set, else what electron-builder wrote in resources/package-type', () => {
    expect(linuxInstallKind({ APPIMAGE: '/home/a/WorkSuite.AppImage' }, '/opt/WorkSuite/resources', () => 'deb')).toBe('appimage');
    expect(linuxInstallKind({}, '/opt/WorkSuite/resources', (p) => (p === '/opt/WorkSuite/resources/package-type' ? 'deb\n' : ''))).toBe('deb');
    expect(linuxInstallKind({}, '/r', () => 'rpm')).toBe('rpm');
    expect(linuxInstallKind({}, '/r', () => 'pacman')).toBeNull();
    expect(linuxInstallKind({}, '/r', () => { throw new Error('ENOENT'); })).toBeNull();
  });

  it('installs a .deb with apt-get (its dependencies too) and an .rpm with dnf, behind pkexec', () => {
    const have = (...p: string[]) => (f: string) => p.includes(f);
    expect(packageInstallCommand('deb', '/tmp/u/WorkSuite.deb', have('/usr/bin/pkexec', '/usr/bin/apt-get'))).toEqual({ cmd: '/usr/bin/pkexec', args: ['/usr/bin/apt-get', 'install', '-y', '--allow-downgrades', '/tmp/u/WorkSuite.deb'] });
    expect(packageInstallCommand('rpm', '/tmp/u/WorkSuite.rpm', have('/usr/bin/pkexec', '/usr/bin/dnf'))).toEqual({ cmd: '/usr/bin/pkexec', args: ['/usr/bin/dnf', 'install', '-y', '/tmp/u/WorkSuite.rpm'] });
    expect(packageInstallCommand('deb', '/tmp/u/WorkSuite.deb', have('/usr/bin/apt-get'))).toBeNull();
  });

  it('reads a closed password prompt as cancelled, and a package manager error as failed', async () => {
    const exists = (f: string) => ['/usr/bin/pkexec', '/usr/bin/apt-get'].includes(f);
    const failWith = (code: number, stderr = '') => vi.fn((_c: string, _a: string[], _o: unknown, cb: (e: unknown, out: string, err: string) => void) => cb(Object.assign(new Error('x'), { code }), '', stderr)) as never;
    expect(await installPackage('deb', '/f.deb', failWith(126), exists)).toMatchObject({ ok: false, reason: 'cancelled' });
    expect(await installPackage('deb', '/f.deb', failWith(100, 'E: Unable to lock\nE: dpkg was interrupted'), exists)).toMatchObject({ ok: false, reason: 'failed', detail: expect.stringContaining('dpkg was interrupted') });
    expect(await installPackage('deb', '/f.deb', vi.fn((_c, _a, _o, cb: (e: null) => void) => cb(null)) as never, exists)).toEqual({ ok: true });
    expect(await installPackage('deb', '/f.deb', vi.fn() as never, () => false)).toMatchObject({ ok: false, reason: 'no-pkexec' });
  });
});
