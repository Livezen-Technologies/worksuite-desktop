// Builds and signs the release manifest the updater verifies (WF-25).
//
//   node scripts/release-manifest.mjs --dir <artifacts dir> --channel stable \
//        --base-url https://app.example.com/desktop/releases/stable/ \
//        [--critical] [--minimum 0.1.0] [--notes https://…] [--out manifest.json]
//
// The private key comes from WS_RELEASE_PRIVATE_KEY (PEM text, as a CI
// secret) or WS_RELEASE_KEY_FILE (default ~/.worksuite-desktop-release/
// release-ed25519.pem). The manifest is signed over its canonical JSON with
// Ed25519; the app pins the public key (electron/updater/keys.ts).
//
// Host the manifest and the installers side by side, e.g. on the WorkSuite
// server at /desktop/releases/<channel>/ — where the app looks for them.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  const entries = Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

function classify(name) {
  const n = name.toLowerCase();
  const arch = /arm64|aarch64/.test(n) ? 'arm64' : /universal/.test(n) ? 'universal' : 'x64';
  if (n.endsWith('.exe')) return { platform: 'windows', arch, kind: 'nsis' };
  if (n.endsWith('.msi')) return { platform: 'windows', arch, kind: 'msi' };
  if (n.endsWith('.dmg')) return { platform: 'macos', arch: /arm64|x64/.test(n) ? arch : 'universal', kind: 'dmg' };
  if (n.endsWith('.pkg')) return { platform: 'macos', arch: /arm64|x64/.test(n) ? arch : 'universal', kind: 'pkg' };
  if (n.endsWith('-mac.zip') || (n.endsWith('.zip') && n.includes('mac'))) return { platform: 'macos', arch: /arm64|x64/.test(n) ? arch : 'universal', kind: 'zip' };
  if (n.endsWith('.appimage')) return { platform: 'linux', arch, kind: 'appimage' };
  if (n.endsWith('.deb')) return { platform: 'linux', arch, kind: 'deb' };
  if (n.endsWith('.rpm')) return { platform: 'linux', arch, kind: 'rpm' };
  return null;
}

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const dir = arg('dir');
const channel = arg('channel', 'stable');
const baseUrl = arg('base-url', '');
if (!dir || !existsSync(dir)) {
  console.error('Give --dir with the built installers.');
  process.exit(2);
}
if (!['stable', 'beta', 'dev', 'org'].includes(channel)) {
  console.error('Channel must be stable, beta, dev or org.');
  process.exit(2);
}
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = arg('version', pkg.version);

const keyPem = process.env.WS_RELEASE_PRIVATE_KEY ?? readFileSync(process.env.WS_RELEASE_KEY_FILE ?? join(homedir(), '.worksuite-desktop-release', 'release-ed25519.pem'), 'utf8');
const privateKey = createPrivateKey(keyPem);

// Refuse to sign with a key the app does not pin: such a release could never install.
const pinned = readFileSync(join(root, 'electron', 'updater', 'keys.ts'), 'utf8').match(/RELEASE_PUBLIC_KEY = `([\s\S]*?)`/)?.[1];
const ourPublic = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString().trim();
if (!pinned || pinned.trim() !== ourPublic) {
  console.error('This private key does not match the public key pinned in electron/updater/keys.ts.');
  process.exit(3);
}

const artifacts = [];
for (const name of readdirSync(dir)) {
  const full = join(dir, name);
  if (!statSync(full).isFile()) continue;
  const c = classify(name);
  if (!c) continue;
  artifacts.push({ ...c, url: `${baseUrl}${encodeURIComponent(basename(name))}`, sha256: await sha256(full), size: statSync(full).size });
}
if (artifacts.length === 0) {
  console.error('No installers found in', dir);
  process.exit(4);
}

const manifest = {
  schema: 1,
  product: 'worksuite-desktop',
  version,
  channel,
  released_at: new Date().toISOString(),
  critical: arg('critical') === true,
  minimum_version: typeof arg('minimum') === 'string' ? arg('minimum') : null,
  min_server_api: null,
  notes_url: typeof arg('notes') === 'string' ? arg('notes') : null,
  artifacts,
};
const signature = sign(null, Buffer.from(canonicalJson(manifest)), privateKey).toString('base64');
if (!verify(null, Buffer.from(canonicalJson(manifest)), createPublicKey(privateKey), Buffer.from(signature, 'base64'))) {
  console.error('Signature self-check failed.');
  process.exit(5);
}
const out = typeof arg('out') === 'string' ? arg('out') : join(dir, 'manifest.json');
writeFileSync(out, JSON.stringify({ ...manifest, signature }, null, 2));
console.log(`Signed manifest for ${version} (${channel}) with ${artifacts.length} artifacts → ${out}`);
