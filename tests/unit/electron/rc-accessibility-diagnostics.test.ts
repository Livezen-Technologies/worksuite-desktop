import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), execFile: vi.fn(), existsSync: vi.fn(), realpathSync: vi.fn() }));
vi.mock('../../../electron/services/remote-control/host', () => ({ accessibility: { refresh: mocks.refresh } }));
vi.mock('node:child_process', () => ({ execFile: mocks.execFile }));
vi.mock('node:fs', () => ({ existsSync: mocks.existsSync, realpathSync: mocks.realpathSync }));
vi.mock('electron', () => ({ app: { isPackaged: true }, systemPreferences: { getMediaAccessStatus: () => 'granted' } }));
vi.mock('node:os', () => ({ homedir: () => '/Users/alice' }));
import { accessibilityDiagnostics } from '../../../electron/services/remote-control/accessibility-diagnostics';
describe('Accessibility diagnostics', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    mocks.refresh.mockResolvedValue({ status: 'denied', appTrusted: true, helperTrusted: false });
    mocks.existsSync.mockReturnValue(true);
    mocks.realpathSync.mockImplementation((path: string) => path === process.execPath ? '/Users/alice/Downloads/WorkSuite.app/Contents/MacOS/WorkSuite' : path);
    mocks.execFile.mockImplementation((_file, _args, _options, done) => done(null, '', 'Identifier=com.worksuite.desktop\nTeamIdentifier=TEAM\nCDHash=abc\nAuthority=private detail\n'));
  });
  it('reports the running copy and helper while redacting user paths and raw signing output', async () => {
    const result = await accessibilityDiagnostics();
    expect(result).toMatchObject({ screenRecording: 'granted', signingVerification: 'valid', otherInstalledCopy: true, app: { bundle: '~/Downloads/WorkSuite.app', signing: { Identifier: 'com.worksuite.desktop', TeamIdentifier: 'TEAM', CDHash: 'abc' } }, helper: { ownerPid: process.pid } });
    expect(JSON.stringify(result)).not.toContain('alice');
    expect(JSON.stringify(result)).not.toContain('private detail');
  });
  it('records unavailable signing verification without misreporting permission', async () => {
    mocks.execFile.mockImplementation((_file, _args, _options, done) => done(new Error('failed'), '', 'private error'));
    expect(await accessibilityDiagnostics()).toMatchObject({ signingVerification: 'unable_to_verify', permission: { status: 'denied' } });
  });

it('shows the bundle ID, Team ID and Developer ID of the app, and the helper’s own signature (worksuite-desktop#147)', async () => {
  mocks.execFile.mockImplementation((_file, args: string[], _options, done) => done(null, '', args.includes('/usr/bin/osascript')
    ? 'Identifier=com.apple.osascript\nAuthority=Software Signing\nCodeDirectory v=20400 size=1 flags=0x0(none) hashes=1\n'
    : 'Identifier=lk.worksuite.desktop\nCodeDirectory v=20500 size=1 flags=0x10000(runtime) hashes=1\nAuthority=Developer ID Application: Livezen Technologies LLC (ABCDE12345)\nTeamIdentifier=ABCDE12345\n'));
  const result = await accessibilityDiagnostics();
  expect(result).toMatchObject({
    app: { signing: { Identifier: 'lk.worksuite.desktop', TeamIdentifier: 'ABCDE12345', Authority: 'Developer ID Application: Livezen Technologies LLC (ABCDE12345)', adhoc: false, hardenedRuntime: true } },
    helper: { executable: '/usr/bin/osascript', signing: { Identifier: 'com.apple.osascript', Authority: 'Software Signing' }, launch: expect.stringContaining('responsible') },
  });
  for (const [file, , options] of mocks.execFile.mock.calls) {
    expect(file).toBe('/usr/bin/codesign');
    expect(options).toMatchObject({ timeout: 4_000 });
  }
});

it('reports a translocated copy', async () => {
  mocks.realpathSync.mockImplementation((path: string) => path === process.execPath ? '/private/var/folders/x/T/AppTranslocation/AB/d/WorkSuite.app/Contents/MacOS/WorkSuite' : path);
  expect(await accessibilityDiagnostics()).toMatchObject({ translocated: true, app: { bundle: '/private/var/folders/x/T/AppTranslocation/AB/d/WorkSuite.app' } });
});

it('separates invalid signatures from an unavailable signing checker', async () => {
  mocks.execFile.mockImplementation((_file, args, _options, done) => done(args.includes('--verify') ? Object.assign(new Error('invalid'), { code: 1 }) : null, '', 'Identifier=com.worksuite.desktop'));
  expect(await accessibilityDiagnostics()).toMatchObject({ signingVerification: 'invalid' });
});

});
