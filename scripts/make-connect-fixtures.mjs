// Writes the Connection & Startup test fixtures (tests/fixtures/discovery, tests/fixtures/cloud): discovery documents
// with their detached JWS, setup links, and WorkSuite Cloud answers with a signed entitlement document — all signed
// with a TEST-ONLY Ed25519 key kept beside them (tests/fixtures/discovery/test-ed25519.key). It is never trusted by a
// packaged build.
//
//   node scripts/make-connect-fixtures.mjs           keeps the existing key (Ed25519 signatures are deterministic,
//                                                    so the output is byte-for-byte the same)
//   node scripts/make-connect-fixtures.mjs --new-key makes a new key first
//
// The documents are written exactly as signed (compact JSON, no trailing newline): the JWS is over those bytes.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const discoveryDir = join(root, 'tests', 'fixtures', 'discovery');
const cloudDir = join(root, 'tests', 'fixtures', 'cloud');
mkdirSync(discoveryDir, { recursive: true });
mkdirSync(cloudDir, { recursive: true });

const keyPath = join(discoveryDir, 'test-ed25519.key');
if (!existsSync(keyPath) || process.argv.includes('--new-key')) {
  const { privateKey } = generateKeyPairSync('ed25519');
  writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
}
const privateKey = createPrivateKey(readFileSync(keyPath));
const spki = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
const raw = spki.subarray(12);

const b64url = (buf) => Buffer.from(buf).toString('base64url');
/** Core's `keyFingerprint`: SHA-256 of the raw key, the first 32 hex digits, upper case, in groups of four. */
const kid = createHash('sha256').update(raw).digest('hex').slice(0, 32).toUpperCase().match(/.{4}/g).join(':');
const discoveryKey = `ed25519:${spki.toString('base64')}`;

/** RFC 7515 Appendix F detached JWS, as Core's `Discovery::jws`: `<header>..<signature>`. */
function detachedJws(bytes) {
  const header = b64url(JSON.stringify({ alg: 'EdDSA', kid, b64: true }));
  const sig = sign(null, Buffer.from(`${header}.${b64url(bytes)}`), privateKey);
  return `${header}..${b64url(sig)}`;
}

/** A compact JWS (the entitlement document). */
function compactJws(claims, headerExtra = {}) {
  const header = b64url(JSON.stringify({ alg: 'EdDSA', kid, typ: 'JWT', ...headerExtra }));
  const payload = b64url(JSON.stringify(claims));
  const sig = sign(null, Buffer.from(`${header}.${payload}`), privateKey);
  return `${header}.${payload}.${b64url(sig)}`;
}

/** Canonical JSON (shared/canonical-json.ts, Core's Signer::canonical): keys sorted, no whitespace. */
function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  return `{${Object.keys(v)
    .filter((k) => v[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
    .join(',')}}`;
}

/** Core's `Discovery::setupLink`: `worksuite://setup?d=<b64url canonical JSON>&s=<rawurlencoded base64 sig>`. */
function setupLink(payload) {
  const text = canonical(payload);
  const sig = sign(null, Buffer.from(text), privateKey).toString('base64');
  return `worksuite://setup?d=${b64url(text)}&s=${encodeURIComponent(sig)}`;
}

const write = (dir, name, content) => writeFileSync(join(dir, name), content);
const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

// ── discovery ──────────────────────────────────────────────────────────────

const cloudDoc = {
  product: 'WorkSuite',
  schema_version: 1,
  server_id: '7b1d6a55-3f0e-5c1a-9a4e-0c2f8d9e1a01',
  server_name: 'WorkSuite Cloud',
  server_version: '2026.10',
  deployment: 'CLOUD',
  api_versions: ['v1'],
  base_path: '/',
  endpoints: {
    api: 'https://api.worksuitecloud.com/api',
    auth: 'https://auth.worksuitecloud.com',
    realtime: 'wss://rt.worksuitecloud.com',
    files: null,
    office: null,
    ai: null,
    policy: null,
    entitlements: 'https://api.worksuitecloud.com/api/v1/entitlements',
    health: 'https://api.worksuitecloud.com/api/health',
  },
  auth: {
    mode: 'oidc',
    signup: true,
    recovery_url: 'https://auth.worksuitecloud.com/forgot-password',
    issuer: 'https://auth.worksuitecloud.com',
    client_id: 'worksuite-desktop',
    idp_hints: ['email', 'google', 'microsoft', 'apple', 'passkey'],
  },
  desktop: { min_version: { windows: '0.2.0', macos: '0.2.0', linux: '0.2.0' }, allowed_channels: ['stable', 'beta'] },
  branding: { logo: null, accent: '#23349E' },
  link_hosts: ['worksuitecloud.com', 'app.worksuitecloud.com'],
  plans: { free: { storage_bytes: 2147483648 } },
  keys: { discovery: discoveryKey, policy: null },
};

// As WorkSuite Core 1.8.0 serves it (app/Modules/Desktop/Libraries/Discovery.php), with the §6 additions.
const enterpriseDoc = {
  product: 'WorkSuite',
  schema_version: 1,
  server_id: '0f6c1b2a-9d3e-5a47-8b21-5e4d3c2b1a00',
  server_name: 'Livezen Technologies',
  server_version: '2026.10',
  deployment: 'ENTERPRISE',
  api_versions: ['v1'],
  base_path: '/',
  endpoints: {
    api: 'https://worksuite.livezentech.example/api',
    auth: 'https://worksuite.livezentech.example/api/auth',
    realtime: null,
    files: null,
    office: null,
    ai: null,
    policy: 'https://worksuite.livezentech.example/desktop/v1/policies',
    entitlements: null,
    health: 'https://worksuite.livezentech.example/api/health',
  },
  auth: {
    mode: 'legacy',
    signup: false,
    recovery_url: 'https://worksuite.livezentech.example/forgot-password',
    browser_sign_in: { url: '/desktop/sign-in', exchange: '/api/auth/apps/exchange', client: 'worksuite-desktop' },
  },
  desktop: { min_version: { windows: '0.2.0' }, allowed_channels: ['stable'] },
  branding: { logo: 'https://worksuite.livezentech.example/desktop/brand/logo', accent: '#0E7C86' },
  link_hosts: ['worksuite.livezentech.example'],
  plans: null,
  keys: { discovery: discoveryKey, policy: discoveryKey },
  setup: { revoked_before: 1767225600 },
  legacy: { desktop_api: 'desktop-v1', desktop: '/.well-known/worksuite-desktop', mobile: '/.well-known/worksuite-mobile' },
};

// /.well-known/worksuite-desktop, as servers before the unified document serve it (the current probeServer).
const legacyDesktop = {
  api: 'desktop-v1',
  name: 'ABC Company',
  minimum_versions: { windows: '0.2.0', macos: '0.2.0', linux: '0.2.0' },
  passkey_sign_in: { url: '/desktop/passkey', exchange: '/api/auth/passkeys/desktop/exchange' },
};

for (const [name, doc] of [
  ['cloud', cloudDoc],
  ['enterprise', enterpriseDoc],
]) {
  const bytes = JSON.stringify(doc);
  write(discoveryDir, `${name}.json`, bytes);
  write(discoveryDir, `${name}.jws`, detachedJws(Buffer.from(bytes)));
}
write(discoveryDir, 'legacy-desktop.json', json(legacyDesktop));
write(discoveryDir, 'keys.json', json({ kid, discovery_key: discoveryKey, raw: b64url(raw) }));

const FAR = 4102444800; // 2100-01-01
const setupV1 = { v: 1, server_url: 'https://worksuite.livezentech.example', server_id: enterpriseDoc.server_id, name: 'Livezen Technologies', exp: FAR };
const setupV2 = {
  ...setupV1,
  v: 2,
  org_id: 'livezen',
  update_channel: 'stable',
  spki_pins: [`sha256/${createHash('sha256').update('test-pin').digest('base64')}`],
  discovery_key: discoveryKey,
  require_signed: true,
  allow_personal: false,
  iat: 1767312000,
  jti: 'setup-test-0001',
};
write(discoveryDir, 'setup-links.json', json({ v1: setupLink(setupV1), v2: setupLink(setupV2), expired: setupLink({ ...setupV1, exp: 1700000000 }) }));

// ── cloud ──────────────────────────────────────────────────────────────────

const identity = { id: 'u_7f3a9c', email: 'hasarinda@email.example', name: 'Hasarinda Manjula', email_verified: true, avatar: null };
const org = { id: 'org_4b2e81', name: "Hasarinda's Workspace", plan: 'professional-free', state: 'ACTIVE' };
const me = (account_state, extra = {}) => ({
  identity: { ...identity, email_verified: account_state !== 'EMAIL_VERIFICATION_PENDING' },
  account_state,
  organizations: account_state === 'EMAIL_VERIFICATION_PENDING' ? [] : [org],
  active_organization_id: account_state === 'EMAIL_VERIFICATION_PENDING' ? null : org.id,
  onboarding: { complete: account_state === 'ACTIVE', step: account_state === 'ACTIVE' ? null : 'workspace' },
  ...extra,
});
write(cloudDir, 'me-pending.json', json(me('EMAIL_VERIFICATION_PENDING')));
write(cloudDir, 'me-provisioning.json', json(me('PROVISIONING')));
write(cloudDir, 'me-failed.json', json(me('PROVISIONING_FAILED')));
write(cloudDir, 'me-active.json', json(me('ACTIVE')));
write(cloudDir, 'me-suspended.json', json(me('SUSPENDED', { organizations: [{ ...org, state: 'RESTRICTED' }] })));
write(cloudDir, 'provisioning-running.json', json({ state: 'PROVISIONING', step: 'drive', attempts: 1, retry_at: null }));
write(cloudDir, 'provisioning-failed.json', json({ state: 'PROVISIONING_FAILED', step: 'apps', attempts: 3, retry_at: '2026-10-13T10:04:00Z' }));
write(cloudDir, 'provisioning-active.json', json({ state: 'ACTIVE', step: 'done', attempts: 1, retry_at: null }));
write(
  cloudDir,
  'storage.json',
  json({
    limit: 2147483648,
    used: 2093796557,
    reserved: 0,
    categories: [
      { key: 'files', bytes: 1245540515, label: 'Files' },
      { key: 'versions', bytes: 429916160, label: 'Versions', policy: 'keeps 20 versions or 30 days' },
      { key: 'attachments', bytes: 188743680, label: 'Attachments saved to Drive' },
      { key: 'trash', bytes: 178257920, label: 'Trash' },
      { key: 'other', bytes: 41943040, label: 'Other' },
    ],
    largest: [
      { id: 'f_1', name: 'Site survey.mp4', bytes: 412000000 },
      { id: 'f_2', name: 'Proposal.docx', bytes: 2100000 },
    ],
  }),
);
write(cloudDir, 'plans.json', json([
  { id: 'professional-free', name: 'WorkSuite Professional Free', storage_bytes: 2147483648, price: null },
  { id: 'professional-plus', name: 'WorkSuite Professional Plus', storage_bytes: 107374182400, price: 'USD 4 / month' },
]));
const claims = {
  iss: 'https://worksuitecloud.com',
  org: org.id,
  plan: 'professional-free',
  apps: { mail: true, chat: true, calendar: true, tasks: true, files: true, contacts: true, doc: true, sheet: true, slides: true, ai: true, crm: false, payroll: false },
  limits: { storage_bytes: 2147483648 },
  iat: 1767225600,
  exp: FAR,
};
const ent = compactJws(claims);
write(cloudDir, 'entitlements.jws', ent);
// The same token with one claim changed after signing: must be refused (and the last valid one kept).
const [h, , s] = ent.split('.');
write(cloudDir, 'entitlements-tampered.jws', `${h}.${b64url(JSON.stringify({ ...claims, apps: { ...claims.apps, crm: true } }))}.${s}`);
write(cloudDir, 'entitlements-claims.json', json(claims));

console.log(`Fixtures written (kid ${kid}).`);
