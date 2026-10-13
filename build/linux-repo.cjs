/**
 * The WorkSuite APT and DNF repositories (worksuite-desktop#351): the build-time switch.
 *
 * OFF BY DEFAULT. Adding a package source before https://download.worksuitecloud.com/apt and /rpm are live would
 * break `apt update` (and `dnf`) on every computer that installs the package, so a build only turns it on when asked:
 *
 *   WORKSUITE_LINUX_REPO=1                  turn it on
 *   WORKSUITE_REPO_GPG_PUBLIC_KEY=<file>    the repository's PUBLIC key, ASCII-armoured (gpg --armor --export), as a
 *                                           file path or the armoured text itself; required when on
 *   WORKSUITE_LINUX_REPO_URL=<https url>    optional, default https://download.worksuitecloud.com
 *
 * On, afterPack puts four files in the Linux build's resources/: `linux-repo` (url= and channel=, the marker the
 * install scripts and the app read), `worksuite-repo.gpg` (the key for apt's Signed-By), `worksuite-repo.asc` (the
 * key for rpm) and the root-side helper `worksuite-repo` (build/linux/worksuite-repo.sh). The .deb/.rpm
 * after-install scripts (build/linux/after-install-*.tpl) call the helper only when the marker is there. Off, none
 * of them is written and the package adds no package source; the app's channel→suite rewrite, the apt-based
 * Update now and the Diagnostics Fix buttons stay off too ("Not set up yet").
 *
 * No private key is ever read here: an armoured private key block is refused.
 */
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_URL = 'https://download.worksuitecloud.com';
const HELPER = path.join(__dirname, 'linux', 'worksuite-repo.sh');

function enabled(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String(env.WORKSUITE_LINUX_REPO ?? '').trim());
}

/** The channel a version was built for, as the repository's suite: no pre-release tag → stable, beta/rc → beta. */
function defaultSuite(version) {
  const pre = /^\d+\.\d+\.\d+-([0-9A-Za-z]+)/.exec(String(version))?.[1]?.toLowerCase();
  if (!pre) return 'stable';
  return pre === 'beta' || pre === 'rc' ? 'beta' : 'dev';
}

/** An ASCII-armoured OpenPGP public key → the binary key (what `gpg --dearmor` writes, for apt's Signed-By). */
function dearmor(text) {
  const s = String(text);
  if (/-----BEGIN PGP PRIVATE KEY BLOCK-----/.test(s)) throw new Error('WORKSUITE_REPO_GPG_PUBLIC_KEY holds a PRIVATE key. Give the public key only (gpg --armor --export <id>).');
  const m = /-----BEGIN PGP PUBLIC KEY BLOCK-----\r?\n([\s\S]*?)-----END PGP PUBLIC KEY BLOCK-----/.exec(s);
  if (!m) throw new Error('WORKSUITE_REPO_GPG_PUBLIC_KEY is not an ASCII-armoured public key (gpg --armor --export <id>).');
  const lines = m[1].split(/\r?\n/);
  const blank = lines.findIndex((l) => l.trim() === '');
  const body = lines
    .slice(blank + 1)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('='));
  const bin = Buffer.from(body.join(''), 'base64');
  // The first packet must be a public key (tag 6), in either packet format.
  const tag = bin.length ? (bin[0] & 0x40 ? bin[0] & 0x3f : (bin[0] >> 2) & 0x0f) : -1;
  if (!(bin[0] & 0x80) || tag !== 6) throw new Error('WORKSUITE_REPO_GPG_PUBLIC_KEY does not start with an OpenPGP public key.');
  return bin;
}

/** The switch, read and checked: null when off; throws when on but incomplete, so a release cannot ship half of it. */
function settings(env = process.env, read = (p) => fs.readFileSync(p, 'utf8')) {
  if (!enabled(env)) return null;
  const given = String(env.WORKSUITE_REPO_GPG_PUBLIC_KEY ?? '').trim();
  if (!given) throw new Error('WORKSUITE_LINUX_REPO=1 needs WORKSUITE_REPO_GPG_PUBLIC_KEY: the repository public key (a file, or the armoured text). See docs/RELEASING.md.');
  const armored = given.includes('-----BEGIN PGP') ? `${given}\n` : read(given);
  const binary = dearmor(armored);
  const url = String(env.WORKSUITE_LINUX_REPO_URL || DEFAULT_URL).trim().replace(/\/+$/, '');
  if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~/-]*)?$/.test(url)) throw new Error(`WORKSUITE_LINUX_REPO_URL must be an https URL, not ${url}`);
  return { url, armored: armored.replace(/\r\n/g, '\n'), binary };
}

/** resources/linux-repo. */
function markerText(url, suite) {
  return `# WorkSuite package repository (worksuite-desktop#351): written by build/linux-repo.cjs at build time.\nurl=${url}\nchannel=${suite}\n`;
}

/** electron-builder afterPack: on Linux, with the switch on, the marker, the key and the helper go into resources/. */
async function afterPack(context, env = process.env) {
  if (context.electronPlatformName !== 'linux') return;
  const s = settings(env);
  if (!s) return;
  const res = path.join(context.appOutDir, 'resources');
  fs.mkdirSync(res, { recursive: true });
  fs.writeFileSync(path.join(res, 'linux-repo'), markerText(s.url, defaultSuite(context.packager.appInfo.version)), { mode: 0o644 });
  fs.writeFileSync(path.join(res, 'worksuite-repo.gpg'), s.binary, { mode: 0o644 });
  fs.writeFileSync(path.join(res, 'worksuite-repo.asc'), s.armored, { mode: 0o644 });
  fs.copyFileSync(HELPER, path.join(res, 'worksuite-repo'));
  fs.chmodSync(path.join(res, 'worksuite-repo'), 0o755);
  console.log(`  • WorkSuite package repository: on (${s.url}, ${defaultSuite(context.packager.appInfo.version)})`);
}

module.exports = { DEFAULT_URL, HELPER, enabled, defaultSuite, dearmor, settings, markerText, afterPack };
