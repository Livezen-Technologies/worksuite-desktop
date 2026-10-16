import { describe, expect, it } from 'vitest';
import { parseDeepLink } from '@shared/deeplink';
import { LAUNCH_MODULES, OS_RELEASE_PATH, isOsMode, moduleInArgv, moduleLink, moduleLinkInArgv } from '@shared/os-mode';

describe('WorkSuite OS mode detection', () => {
  const none = () => false;
  it('is on when /etc/worksuite/os-release exists', () => {
    expect(isOsMode([], {}, (p) => p === OS_RELEASE_PATH)).toBe(true);
    expect(isOsMode([], {}, none)).toBe(false);
  });
  it('is on with --worksuite-os or WORKSUITE_OS=1', () => {
    expect(isOsMode(['/usr/bin/worksuite', '--worksuite-os'], {}, none)).toBe(true);
    expect(isOsMode([], { WORKSUITE_OS: '1' }, none)).toBe(true);
    expect(isOsMode([], { WORKSUITE_OS: 'yes' }, none)).toBe(false);
  });
  it('WORKSUITE_OS=0 turns it off on a WorkSuite OS machine', () => {
    expect(isOsMode([], { WORKSUITE_OS: '0' }, () => true)).toBe(false);
  });
  it('a failing file check is not OS mode', () => {
    expect(
      isOsMode([], {}, () => {
        throw new Error('EACCES');
      }),
    ).toBe(false);
  });
});

describe('--module=<id>', () => {
  it('reads both spellings', () => {
    expect(moduleInArgv(['app', '--module=mail'])).toBe('mail');
    expect(moduleInArgv(['app', '--module', 'crm'])).toBe('crm');
    expect(moduleInArgv(['app', '--module=HR'])).toBe('hr');
  });
  it('ignores unknown modules and anything that is not a module id', () => {
    expect(moduleInArgv(['app', '--module=drive'])).toBeNull();
    expect(moduleInArgv(['app', '--module=../../etc'])).toBeNull();
    expect(moduleInArgv(['app', '--module=mail/123'])).toBeNull();
    expect(moduleInArgv(['app', '--module'])).toBeNull();
    expect(moduleInArgv(['app'])).toBeNull();
  });
  it('every launch module opens through an accepted worksuite:// link', () => {
    for (const m of LAUNCH_MODULES) {
      const r = parseDeepLink(moduleLink(m));
      expect(r.ok, m).toBe(true);
      if (r.ok) expect(r.link.route).toBe(`/${m}`);
    }
    expect(moduleLinkInArgv(['x', '--module=calendar'])).toBe('worksuite://calendar');
    expect(moduleLinkInArgv(['x'])).toBeNull();
  });
});
