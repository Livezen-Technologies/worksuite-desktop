// Generates the Ed25519 release-signing key pair.
//
// The PRIVATE key is written OUTSIDE the repository (default
// ~/.worksuite-desktop-release/release-ed25519.pem, mode 600) and belongs in
// the release vault / CI secret WS_RELEASE_PRIVATE_KEY. The PUBLIC key is
// written into electron/updater/keys.ts, where the app pins it.
//
// Rotating the key means shipping one release signed with the OLD key whose
// app pins the NEW one; clients that skip that release must be reinstalled.
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.WS_RELEASE_KEY_DIR ?? join(homedir(), '.worksuite-desktop-release');
const privPath = join(outDir, 'release-ed25519.pem');

if (existsSync(privPath) && !process.argv.includes('--force')) {
  console.error(`A release key already exists at ${privPath}. Pass --force to replace it (existing clients will then reject new releases).`);
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
mkdirSync(outDir, { recursive: true, mode: 0o700 });
writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });

const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString().trim();
const keysPath = join(root, 'electron', 'updater', 'keys.ts');
const current = readFileSync(keysPath, 'utf8');
const next = current.replace(/export const RELEASE_PUBLIC_KEY = `[\s\S]*?`;/, `export const RELEASE_PUBLIC_KEY = \`${pub}\`;`);
writeFileSync(keysPath, next);

console.log(`Private key: ${privPath} (keep it secret; add it to CI as WS_RELEASE_PRIVATE_KEY)`);
console.log(`Public key pinned in electron/updater/keys.ts`);
