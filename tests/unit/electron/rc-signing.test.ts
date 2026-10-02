import { describe, expect, it, vi } from 'vitest';
import { bundleOf, isTranslocated, parseCodesign, publicAuthority, readSigning, redactPath, runningIdentity } from '../../../electron/services/remote-control/signing';

const DEVELOPER_ID = `Executable=/Applications/WorkSuite.app/Contents/MacOS/WorkSuite
Identifier=lk.worksuite.desktop
Format=app bundle with Mach-O universal (x86_64 arm64)
CodeDirectory v=20500 size=1234 flags=0x10000(runtime) hashes=28+7 location=embedded
CDHash=0123456789abcdef
Signature size=9000
Authority=Developer ID Application: Livezen Technologies LLC (ABCDE12345)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
TeamIdentifier=ABCDE12345
Runtime Version=14.0.0
`;
const ADHOC = `Executable=/Users/alice/Downloads/WorkSuite.app/Contents/MacOS/WorkSuite
Identifier=lk.worksuite.desktop
CodeDirectory v=20400 size=1234 flags=0x2(adhoc) hashes=28+7 location=embedded
CDHash=feedface
Signature=adhoc
TeamIdentifier=not set
`;

describe('signing identity of the running copy (worksuite-desktop#147)', () => {
  it('reads bundle ID, Team ID and the Developer ID authority', () => {
    expect(parseCodesign(DEVELOPER_ID)).toEqual({ identifier: 'lk.worksuite.desktop', teamId: 'ABCDE12345', authority: 'Developer ID Application: Livezen Technologies LLC (ABCDE12345)', adhoc: false, cdhash: '0123456789abcdef', hardenedRuntime: true });
  });

  it('recognises ad-hoc and linker-signed builds, whose permission is tied to one exact binary', () => {
    expect(parseCodesign(ADHOC)).toMatchObject({ adhoc: true, teamId: null, authority: null });
    expect(parseCodesign('Identifier=Electron\nCodeDirectory v=20400 size=1 flags=0x20002(adhoc,linker-signed) hashes=1\nTeamIdentifier=not set\n').adhoc).toBe(true);
  });

  it('keeps an organization’s or Apple’s signing identity, never a person’s name', () => {
    expect(publicAuthority('Developer ID Application: Livezen Technologies LLC (ABCDE12345)')).toContain('Livezen');
    expect(publicAuthority('Software Signing')).toBe('Software Signing');
    expect(publicAuthority('Apple Development: Jane Doe (XYZ)')).toBe('Apple Development: (name withheld)');
  });

  it('detects app translocation and the bundle of the running executable', () => {
    const translocated = '/private/var/folders/xy/T/AppTranslocation/0A1B/d/WorkSuite.app/Contents/MacOS/WorkSuite';
    expect(isTranslocated(translocated)).toBe(true);
    expect(isTranslocated('/Applications/WorkSuite.app/Contents/MacOS/WorkSuite')).toBe(false);
    expect(bundleOf(translocated)).toBe('/private/var/folders/xy/T/AppTranslocation/0A1B/d/WorkSuite.app');
    expect(redactPath('/Users/alice/Downloads/WorkSuite.app', '/Users/alice')).toBe('~/Downloads/WorkSuite.app');
  });

  it('runs codesign without a shell and with a timeout; an unreadable answer is unknown', async () => {
    const run = vi.fn((_f: string, _a: string[], _o: unknown, done: (e: Error | null, out: string, err: string) => void) => done(new Error('timeout'), '', ''));
    expect(await readSigning('/Applications/WorkSuite.app', run as never)).toBeNull();
    expect(run).toHaveBeenCalledWith('/usr/bin/codesign', ['-d', '--verbose=4', '/Applications/WorkSuite.app'], expect.objectContaining({ shell: false, timeout: 4_000 }), expect.any(Function));
    const unsigned = vi.fn((_f: string, _a: string[], _o: unknown, done: (e: Error | null, out: string, err: string) => void) => done(new Error('1'), '', 'code object is not signed at all'));
    expect(await readSigning('/x.app', unsigned as never)).toMatchObject({ adhoc: true });
  });

  it('describes a translocated, ad-hoc copy beside another installed copy', async () => {
    const exe = '/private/var/folders/xy/T/AppTranslocation/0A1B/d/WorkSuite.app/Contents/MacOS/WorkSuite';
    const run = vi.fn((_f: string, _a: string[], _o: unknown, done: (e: Error | null, out: string, err: string) => void) => done(null, '', ADHOC));
    const id = await runningIdentity({ platform: 'darwin', execPath: exe, packaged: true, exists: () => true, realpath: (p) => p, run: run as never, home: '/Users/alice' });
    expect(id).toMatchObject({ bundleId: 'lk.worksuite.desktop', teamId: null, adhoc: true, translocated: true, otherInstalledCopy: true, development: false, signingUnavailable: false });
    expect(await runningIdentity({ platform: 'linux', execPath: exe, packaged: true })).toBeNull();
  });

  it('does not flag the installed copy itself as another copy', async () => {
    const run = vi.fn((_f: string, _a: string[], _o: unknown, done: (e: Error | null, out: string, err: string) => void) => done(null, '', DEVELOPER_ID));
    const id = await runningIdentity({ platform: 'darwin', execPath: '/Applications/WorkSuite.app/Contents/MacOS/WorkSuite', packaged: true, exists: () => true, realpath: (p) => p, run: run as never });
    expect(id).toMatchObject({ otherInstalledCopy: false, translocated: false, adhoc: false, teamId: 'ABCDE12345', bundle: '/Applications/WorkSuite.app' });
  });
});
