import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LinuxRepo, REPO_HEADER, REPO_PATHS, debSources, packageVersion, parseAptPolicy, parseRepoSuite, readRepoMarker, repoChecks, repoOffers, repoSuite, yumRepo, type RepoState } from '../../../electron/updater/linux-repo';

/**
 * The WorkSuite APT and DNF repositories (worksuite-desktop#351): the files WorkSuite writes, the channel → suite
 * mapping, the Diagnostics checks, the pkexec commands, and that all of it stays off unless the build turned it on.
 */

const URL = 'https://download.worksuitecloud.com';
const HELPER = resolve(__dirname, '../../../build/linux/worksuite-repo.sh');
const MARKER = `# marker\nurl=${URL}\nchannel=beta\n`;

let dirs: string[] = [];
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), 'ws-repo-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

/** A LinuxRepo over an in-memory filesystem. */
function fakeRepo(files: Record<string, string>, exec?: unknown) {
  const read = (p: string) => {
    if (p in files) return files[p]!;
    throw new Error(`ENOENT ${p}`);
  };
  const exists = (p: string) => p in files || ['/usr/bin/pkexec', '/usr/bin/apt-get', '/usr/bin/apt-cache', '/usr/bin/dnf'].includes(p);
  return new LinuxRepo({ resources: '/opt/WorkSuite/resources', read, exists, exec: exec as never });
}
const ON = { '/opt/WorkSuite/resources/linux-repo': MARKER, '/opt/WorkSuite/resources/worksuite-repo': '#!/bin/sh' };

describe('the files WorkSuite writes', () => {
  it('maps each update channel to a suite; the organisation channel follows Stable', () => {
    expect(['stable', 'beta', 'dev', 'org', 'nonsense'].map(repoSuite)).toEqual(['stable', 'beta', 'dev', 'stable', 'stable']);
  });

  it('writes a deb822 source: Types deb, the /apt URI, Suites = the channel, Components main, Signed-By the keyring', () => {
    expect(debSources(URL, 'beta')).toBe(
      `${REPO_HEADER}\nTypes: deb\nURIs: https://download.worksuitecloud.com/apt\nSuites: beta\nComponents: main\nSigned-By: /usr/share/keyrings/worksuite.gpg\n`,
    );
    expect(parseRepoSuite('deb', debSources(URL, 'dev'))).toBe('dev');
  });

  it('writes a yum .repo whose baseurl names the channel, with signed repository metadata', () => {
    const text = yumRepo(URL, 'stable');
    expect(text).toContain('[worksuite]\n');
    expect(text).toContain('baseurl=https://download.worksuitecloud.com/rpm/stable\n');
    expect(text).toContain('repo_gpgcheck=1\n');
    expect(text).toContain(`gpgkey=file://${REPO_PATHS.rpmKey}\n`);
    expect(parseRepoSuite('rpm', yumRepo(URL, 'beta'))).toBe('beta');
    expect(parseRepoSuite('rpm', '[x]\nbaseurl=https://example.com/other\n')).toBeNull();
  });

  it('reads the build marker, and nothing without it or with a URL that is not https', () => {
    expect(readRepoMarker('/r', (p) => (p === '/r/linux-repo' ? MARKER : ''))).toEqual({ url: URL, channel: 'beta' });
    expect(readRepoMarker('/r', () => 'url=https://download.worksuitecloud.com/\nchannel=x\n')).toEqual({ url: URL, channel: 'stable' });
    expect(readRepoMarker('/r', () => { throw new Error('ENOENT'); })).toBeNull();
    expect(readRepoMarker('/r', () => 'url=http://download.worksuitecloud.com\n')).toBeNull();
    expect(readRepoMarker('/r', () => "url=https://x.test/apt'; rm -rf /\n")).toBeNull();
  });

  it('reads package versions the way electron-builder writes them (~ for -, a package revision)', () => {
    expect(packageVersion('0.2.249~beta.1')).toBe('0.2.249-beta.1');
    expect(packageVersion('1:0.2.249-1')).toBe('0.2.249');
    expect(packageVersion('0.2.249')).toBe('0.2.249');
  });

  it('reads apt-cache policy, and whether the candidate comes from the WorkSuite repository', () => {
    const out = `worksuite:\n  Installed: 0.2.248\n  Candidate: 0.2.249\n  Version table:\n     0.2.249 500\n        500 ${URL}/apt beta/main amd64 Packages\n *** 0.2.248 100\n        100 /var/lib/dpkg/status\n`;
    expect(parseAptPolicy(out, URL)).toEqual({ installed: '0.2.248', candidate: '0.2.249', fromRepo: true });
    expect(parseAptPolicy('worksuite:\n  Installed: 0.2.248\n  Candidate: 0.2.248\n  Version table:\n *** 0.2.248 100\n        100 /var/lib/dpkg/status\n', URL)).toMatchObject({ fromRepo: false });
    expect(parseAptPolicy('worksuite:\n  Installed: (none)\n  Candidate: (none)\n', URL)).toEqual({ installed: null, candidate: null, fromRepo: false });
  });
});

describe('the root-side helper writes exactly those files (build/linux/worksuite-repo.sh)', () => {
  const run = (args: string[], env: Record<string, string>) => spawnSync('sh', [HELPER, ...args], { env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ...env }, encoding: 'utf8' });

  it('prints the same deb822 and .repo text as the app generates', () => {
    for (const s of ['stable', 'beta', 'dev'] as const) {
      expect(run(['print', 'deb', s, URL], {}).stdout).toBe(debSources(URL, s));
      expect(run(['print', 'rpm', s, URL], {}).stdout).toBe(yumRepo(URL, s));
    }
    expect(run(['print', 'deb', 'nightly', URL], {}).status).toBe(2);
  });

  it('changes nothing in a build without the marker (the switch off): exit 3', () => {
    const root = scratch();
    const res = scratch();
    const r = run(['setup', 'deb', 'beta'], { WORKSUITE_REPO_ROOT: root, WORKSUITE_REPO_RESOURCES: res });
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/does not use the WorkSuite package repository/);
    expect(existsSync(join(root, 'etc'))).toBe(false);
    expect(existsSync(join(root, 'usr'))).toBe(false);
  });

  it('installs the key and source, keeps the suite on upgrade, rewrites it on a channel change, and removes only its own files', () => {
    const root = scratch();
    const res = scratch();
    writeFileSync(join(res, 'linux-repo'), MARKER);
    writeFileSync(join(res, 'worksuite-repo.gpg'), Buffer.from([0x99, 0x01, 0x02]));
    writeFileSync(join(res, 'worksuite-repo.asc'), '-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nAAAA\n-----END PGP PUBLIC KEY BLOCK-----\n');
    const env = { WORKSUITE_REPO_ROOT: root, WORKSUITE_REPO_RESOURCES: res };
    const sources = join(root, REPO_PATHS.aptSources);

    // A fresh install starts on the build's channel (the marker's channel=beta).
    expect(run(['setup', 'deb'], env).status).toBe(0);
    expect(readFileSync(sources, 'utf8')).toBe(debSources(URL, 'beta'));
    expect(readFileSync(join(root, REPO_PATHS.aptKeyring))).toEqual(Buffer.from([0x99, 0x01, 0x02]));
    // The channel switch.
    expect(run(['setup', 'deb', 'dev'], env).status).toBe(0);
    expect(readFileSync(sources, 'utf8')).toBe(debSources(URL, 'dev'));
    // An upgrade's after-install (no channel) keeps what the person chose.
    expect(run(['setup', 'deb'], env).status).toBe(0);
    expect(parseRepoSuite('deb', readFileSync(sources, 'utf8'))).toBe('dev');
    // rpm, the same way.
    expect(run(['setup', 'rpm', 'stable'], env).status).toBe(0);
    expect(readFileSync(join(root, REPO_PATHS.yumRepo), 'utf8')).toBe(yumRepo(URL, 'stable'));
    expect(readFileSync(join(root, REPO_PATHS.rpmKey), 'utf8')).toContain('BEGIN PGP PUBLIC KEY BLOCK');
    expect(run(['setup', 'deb', 'nightly'], env).status).toBe(2);

    // Removal: WorkSuite's own source and key go; a source the administrator wrote stays, with its key.
    writeFileSync(join(root, REPO_PATHS.yumRepo), '[worksuite]\nbaseurl=https://mirror.example/rpm/stable\n');
    expect(run(['remove'], env).status).toBe(0);
    expect(existsSync(sources)).toBe(false);
    expect(existsSync(join(root, REPO_PATHS.aptKeyring))).toBe(false);
    expect(existsSync(join(root, REPO_PATHS.yumRepo))).toBe(true);
    expect(existsSync(join(root, REPO_PATHS.rpmKey))).toBe(true);
  });
});

describe('the install scripts (build/linux/*.tpl)', () => {
  const tpl = (name: string) => readFileSync(resolve(__dirname, '../../../build/linux', name), 'utf8');
  const stock = (name: string) => readFileSync(resolve(__dirname, '../../../node_modules/app-builder-lib/templates/linux', name), 'utf8');

  it("start with electron-builder's own script and use only the macros it defines", () => {
    for (const [mine, theirs] of [['after-install-deb.tpl', 'after-install.tpl'], ['after-install-rpm.tpl', 'after-install.tpl'], ['after-remove-deb.tpl', 'after-remove.tpl'], ['after-remove-rpm.tpl', 'after-remove.tpl']] as const) {
      expect(tpl(mine).startsWith(stock(theirs))).toBe(true);
      expect(new Set(tpl(mine).match(/\$\{[a-zA-Z]+\}/g))).toEqual(new Set(['${executable}', '${sanitizedProductName}']));
    }
  });

  it('add a package source only through the helper, and only when the build carries the marker', () => {
    for (const kind of ['deb', 'rpm']) {
      const t = tpl(`after-install-${kind}.tpl`);
      expect(t).toContain(`if [ -f '/opt/\${sanitizedProductName}/resources/linux-repo' ] && [ -x '/opt/\${sanitizedProductName}/resources/worksuite-repo' ]; then`);
      expect(t).toContain(`'/opt/\${sanitizedProductName}/resources/worksuite-repo' setup ${kind} ||`);
      expect(t).not.toMatch(/sources\.list\.d|yum\.repos\.d/);
      expect(t).toContain(`echo ${kind} > '/opt/\${sanitizedProductName}/resources/package-type'`);
    }
  });

  /** Runs a script with its absolute paths moved under a scratch root. */
  const runUnder = (script: string, root: string, arg: string) => {
    const moved = script
      .replace(/\$\{executable\}/g, 'worksuite')
      .replace(/\$\{sanitizedProductName\}/g, 'WorkSuite')
      .replace(/'\/(etc|opt|usr\/share\/keyrings)\//g, `'${root}/$1/`);
    const block = moved.slice(moved.indexOf('# Uninstall or purge') >= 0 ? moved.indexOf('# Uninstall or purge') : moved.indexOf('# Erase'));
    const file = join(root, 'script.sh');
    writeFileSync(file, `#!/bin/bash\nset -- ${arg}\n${block}`);
    chmodSync(file, 0o755);
    return spawnSync('bash', [file], { encoding: 'utf8' });
  };
  const seed = (root: string, apt: boolean) => {
    mkdirSync(join(root, 'opt/WorkSuite/resources'), { recursive: true });
    writeFileSync(join(root, 'opt/WorkSuite/resources/package-type'), 'deb\n');
    mkdirSync(join(root, 'etc/apt/sources.list.d'), { recursive: true });
    mkdirSync(join(root, 'usr/share/keyrings'), { recursive: true });
    mkdirSync(join(root, 'etc/yum.repos.d'), { recursive: true });
    mkdirSync(join(root, 'etc/pki/rpm-gpg'), { recursive: true });
    if (apt) writeFileSync(join(root, 'etc/apt/sources.list.d/worksuite.sources'), debSources(URL, 'stable'));
    else writeFileSync(join(root, 'etc/yum.repos.d/worksuite.repo'), yumRepo(URL, 'stable'));
    writeFileSync(join(root, apt ? 'usr/share/keyrings/worksuite.gpg' : 'etc/pki/rpm-gpg/RPM-GPG-KEY-worksuite'), 'key');
  };

  it('remove the source and key on uninstall or purge of the .deb, and keep them on an upgrade', () => {
    for (const [arg, kept] of [['upgrade', true], ['remove', false], ['purge', false]] as const) {
      const root = scratch();
      seed(root, true);
      expect(runUnder(tpl('after-remove-deb.tpl'), root, arg).status).toBe(0);
      expect(existsSync(join(root, 'etc/apt/sources.list.d/worksuite.sources'))).toBe(kept);
      expect(existsSync(join(root, 'usr/share/keyrings/worksuite.gpg'))).toBe(kept);
      expect(existsSync(join(root, 'opt/WorkSuite'))).toBe(kept);
    }
  });

  it('remove the .repo and key when the .rpm is erased (0), and keep them on an upgrade (1)', () => {
    for (const [arg, kept] of [['1', true], ['0', false]] as const) {
      const root = scratch();
      seed(root, false);
      expect(runUnder(tpl('after-remove-rpm.tpl'), root, arg).status).toBe(0);
      expect(existsSync(join(root, 'etc/yum.repos.d/worksuite.repo'))).toBe(kept);
      expect(existsSync(join(root, 'etc/pki/rpm-gpg/RPM-GPG-KEY-worksuite'))).toBe(kept);
    }
  });
});

describe('the app side, with the switch off and on', () => {
  it('is off without the marker or without the helper: no state, no pkexec', async () => {
    const exec = vi.fn();
    const off = fakeRepo({ [REPO_PATHS.aptSources]: debSources(URL, 'stable') }, exec);
    expect(off.enabled()).toBe(false);
    expect(off.state('deb', 'beta').marker).toBeNull();
    expect(await off.setup('deb', 'beta')).toMatchObject({ ok: false });
    expect(await off.policy('deb')).toBeNull();
    expect(fakeRepo({ '/opt/WorkSuite/resources/linux-repo': MARKER }).enabled()).toBe(false);
    expect(exec).not.toHaveBeenCalled();
  });

  it('rewrites the source through pkexec and the helper, and reads fresh lists on Fix', async () => {
    const exec = vi.fn((_c: string, _a: string[], _o: unknown, cb: (e: null, out: string, err: string) => void) => cb(null, '', ''));
    const repo = fakeRepo(ON, exec);
    expect(await repo.setup('deb', 'org')).toEqual({ ok: true });
    expect(exec.mock.calls[0]!.slice(0, 2)).toEqual(['/usr/bin/pkexec', ['/opt/WorkSuite/resources/worksuite-repo', 'setup', 'deb', 'stable']]);
    await repo.setup('rpm', 'dev', true);
    expect(exec.mock.calls[1]![1]).toEqual(['/opt/WorkSuite/resources/worksuite-repo', 'setup', 'rpm', 'dev', '--refresh']);
    await repo.aptUpgrade();
    expect(exec.mock.calls[2]!.slice(0, 2)).toEqual(['/usr/bin/pkexec', ['/usr/bin/apt-get', 'install', '--only-upgrade', '-y', 'worksuite']]);
  });

  it('asks apt-cache policy without a password', async () => {
    const out = `worksuite:\n  Installed: 0.2.248\n  Candidate: 0.2.249\n  Version table:\n     0.2.249 500\n        500 ${URL}/apt stable/main amd64 Packages\n`;
    const exec = vi.fn((_c: string, _a: string[], _o: unknown, cb: (e: null, out: string) => void) => cb(null, out));
    expect(await fakeRepo(ON, exec).policy('deb')).toEqual({ installed: '0.2.248', candidate: '0.2.249', fromRepo: true });
    expect(exec.mock.calls[0]!.slice(0, 2)).toEqual(['/usr/bin/apt-cache', ['policy', 'worksuite']]);
  });
});

describe('Diagnostics: the package repository checks', () => {
  const marker = { url: URL, channel: 'stable' as const };
  const state = (over: Partial<RepoState> = {}, file: Partial<RepoState['file']> = {}): RepoState => ({
    kind: 'deb',
    marker,
    expected: 'beta',
    file: { path: REPO_PATHS.aptSources, exists: true, suite: 'beta', url: true, ...file },
    key: { path: REPO_PATHS.aptKeyring, present: true },
    ...over,
  });
  const policy = { installed: '0.2.248', candidate: '0.2.249', fromRepo: true };

  it('says "Not set up yet" and skips, never fails, while the switch is off', () => {
    const r = repoChecks(state({ marker: null }, { exists: false }), null, '0.2.249');
    expect(r.map((c) => [c.id, c.status])).toEqual([
      ['repo-file', 'skip'],
      ['repo-key', 'skip'],
      ['repo-version', 'skip'],
    ]);
    expect(r[0]!.detail).toMatch(/^Not set up yet/);
    expect(r.some((c) => c.action)).toBe(false);
  });

  it('passes a source on the channel, the key, and apt seeing the newest version', () => {
    const r = repoChecks(state(), policy, '0.2.249');
    expect(r.map((c) => [c.id, c.status])).toEqual([
      ['repo-file', 'pass'],
      ['repo-key', 'pass'],
      ['repo-version', 'pass'],
    ]);
    expect(r[0]!.detail).toBe('/etc/apt/sources.list.d/worksuite.sources · beta');
    expect(r[2]!.detail).toBe('apt-cache policy: 0.2.249 · installed 0.2.248');
  });

  it('fails a missing file, another suite, a missing key, and apt not listing WorkSuite — each with Fix', () => {
    expect(repoChecks(state({}, { exists: false, suite: null }), null, null)[0]).toMatchObject({ status: 'fail', action: 'fix-repo', detail: '/etc/apt/sources.list.d/worksuite.sources is missing' });
    expect(repoChecks(state({}, { suite: 'stable' }), policy, null)[0]).toMatchObject({ status: 'fail', action: 'fix-repo', detail: expect.stringContaining('follows stable, the channel is Beta') });
    expect(repoChecks(state({}, { url: false }), policy, null)[0]).toMatchObject({ status: 'fail', action: 'fix-repo' });
    expect(repoChecks(state({ key: { path: REPO_PATHS.aptKeyring, present: false } }), policy, null)[1]).toMatchObject({ status: 'fail', action: 'fix-repo' });
    expect(repoChecks(state(), { installed: '0.2.248', candidate: '0.2.248', fromRepo: false }, null)[2]).toMatchObject({ status: 'fail', action: 'fix-repo' });
    expect(repoChecks(state(), policy, '0.2.250')[2]).toMatchObject({ status: 'low', action: 'fix-repo', detail: 'apt-cache policy: 0.2.249, the newest is 0.2.250' });
    expect(repoChecks(state(), null, null)[2]).toMatchObject({ status: 'skip' });
  });

  it('lets Update now use apt only for exactly the offered version from a source on this channel', () => {
    expect(repoOffers(state(), policy, '0.2.249')).toBe(true);
    expect(repoOffers(state(), policy, '0.2.250')).toBe(false);
    expect(repoOffers(state({}, { suite: 'stable' }), policy, '0.2.249')).toBe(false);
    expect(repoOffers(state({ marker: null }), policy, '0.2.249')).toBe(false);
    expect(repoOffers(state(), { ...policy, fromRepo: false }, '0.2.249')).toBe(false);
  });
});

describe('the build-time switch (build/linux-repo.cjs)', () => {
  const lr = createRequire(import.meta.url)('../../../build/linux-repo.cjs') as {
    enabled(env: Record<string, string | undefined>): boolean;
    defaultSuite(v: string): string;
    dearmor(t: string): Buffer;
    settings(env: Record<string, string | undefined>, read?: (p: string) => string): { url: string; armored: string; binary: Buffer } | null;
    afterPack(ctx: unknown, env: Record<string, string | undefined>): Promise<void>;
  };
  const hasGpg = spawnSync('gpg', ['--version']).status === 0;

  /** A throwaway key, made in a scratch GNUPGHOME for this test only and deleted afterwards. */
  const throwawayKey = () => {
    const home = scratch();
    chmodSync(home, 0o700);
    const env = { ...process.env, GNUPGHOME: home };
    execFileSync('gpg', ['--batch', '--passphrase', '', '--quick-generate-key', 'WorkSuite Test Repository <repo-test@example.invalid>', 'ed25519', 'sign', 'never'], { env, stdio: 'ignore' });
    const key = { armored: execFileSync('gpg', ['--armor', '--export'], { env, encoding: 'utf8' }), binary: execFileSync('gpg', ['--export'], { env }), privateArmored: execFileSync('gpg', ['--batch', '--pinentry-mode', 'loopback', '--passphrase', '', '--armor', '--export-secret-keys'], { env, encoding: 'utf8' }) };
    spawnSync('gpgconf', ['--kill', 'gpg-agent'], { env }); // the agent this throwaway keyring started
    return key;
  };

  it('is off by default, and on only when asked', () => {
    expect(lr.enabled({})).toBe(false);
    expect(lr.enabled({ WORKSUITE_LINUX_REPO: '0' })).toBe(false);
    expect(lr.enabled({ WORKSUITE_LINUX_REPO: '1' })).toBe(true);
    expect(lr.settings({})).toBeNull();
  });

  it('refuses to turn on without the public key, or with a private key', () => {
    expect(() => lr.settings({ WORKSUITE_LINUX_REPO: '1' })).toThrow(/needs WORKSUITE_REPO_GPG_PUBLIC_KEY/);
    expect(() => lr.settings({ WORKSUITE_LINUX_REPO: '1', WORKSUITE_REPO_GPG_PUBLIC_KEY: '-----BEGIN PGP PRIVATE KEY BLOCK-----\n\nAAAA\n-----END PGP PRIVATE KEY BLOCK-----' })).toThrow(/PRIVATE key/);
    expect(() => lr.settings({ WORKSUITE_LINUX_REPO: '1', WORKSUITE_REPO_GPG_PUBLIC_KEY: '-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nAAAA\n-----END PGP PUBLIC KEY BLOCK-----', WORKSUITE_LINUX_REPO_URL: 'http://plain.example' })).toThrow();
  });

  it('starts a fresh install on the channel the version was built for', () => {
    expect(['0.2.249', '0.2.249-beta.1', '0.2.249-rc.2', '0.2.249-dev.20261013'].map(lr.defaultSuite)).toEqual(['stable', 'beta', 'beta', 'dev']);
  });

  it.skipIf(!hasGpg)('dearmours the public key exactly as gpg --export writes it, and refuses the private half', () => {
    const k = throwawayKey();
    expect(lr.dearmor(k.armored).equals(k.binary)).toBe(true);
    expect(() => lr.dearmor(k.privateArmored)).toThrow(/PRIVATE key/);
  });

  it.skipIf(!hasGpg)('afterPack writes the marker, the keys and the helper into a Linux build only when on', async () => {
    const k = throwawayKey();
    const ctx = (dir: string, platform = 'linux') => ({ electronPlatformName: platform, appOutDir: dir, packager: { appInfo: { version: '0.2.249-beta.1' } } });
    const off = scratch();
    await lr.afterPack(ctx(off), {});
    expect(existsSync(join(off, 'resources'))).toBe(false);
    const mac = scratch();
    await lr.afterPack(ctx(mac, 'darwin'), { WORKSUITE_LINUX_REPO: '1', WORKSUITE_REPO_GPG_PUBLIC_KEY: k.armored });
    expect(existsSync(join(mac, 'resources'))).toBe(false);

    const on = scratch();
    const keyFile = join(scratch(), 'repo.asc');
    writeFileSync(keyFile, k.armored);
    await lr.afterPack(ctx(on), { WORKSUITE_LINUX_REPO: '1', WORKSUITE_REPO_GPG_PUBLIC_KEY: keyFile });
    const res = join(on, 'resources');
    expect(readRepoMarker(res)).toEqual({ url: URL, channel: 'beta' });
    expect(readFileSync(join(res, 'worksuite-repo.gpg')).equals(k.binary)).toBe(true);
    expect(readFileSync(join(res, 'worksuite-repo.asc'), 'utf8')).toBe(k.armored);
    expect(readFileSync(join(res, 'worksuite-repo'), 'utf8')).toBe(readFileSync(HELPER, 'utf8'));
    // The helper, from that build, sets up a source the throwaway key's keyring verifies against.
    const root = scratch();
    const r = spawnSync('sh', [join(res, 'worksuite-repo'), 'setup', 'deb'], { env: { PATH: process.env.PATH ?? '', WORKSUITE_REPO_ROOT: root }, encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(readFileSync(join(root, REPO_PATHS.aptSources), 'utf8')).toBe(debSources(URL, 'beta'));
    expect(readFileSync(join(root, REPO_PATHS.aptKeyring)).equals(k.binary)).toBe(true);
  });
});
