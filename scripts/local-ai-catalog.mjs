#!/usr/bin/env node
/**
 * Local AI catalog tooling (WS-SRS-LAI LAI-MOD-002): the CDN serves `catalog.json` as a signed envelope
 * `{ body, signature, keyId }`, and the app accepts it only when the Ed25519 signature is by a key pinned in
 * `electron/services/local-ai/host.ts` (LOCAL_AI_CATALOG_KEYS) and it has not expired.
 *
 *   node scripts/local-ai-catalog.mjs keygen <key-id> <private-key-out.pem>
 *       Makes a key pair. Keep the private key out of this repository (a secrets manager / HSM); put the printed
 *       `'<key-id>': '<public key>'` line into LOCAL_AI_CATALOG_KEYS and ship it before the CDN signs with it.
 *   node scripts/local-ai-catalog.mjs hash <model.gguf>
 *       Prints `sha256` and `bytes` for the catalog entry.
 *   node scripts/local-ai-catalog.mjs fill <catalog-body.json> <models-dir> [out.json]
 *       Fills each model's `sha256` and `bytes` from `<models-dir>/<id>.gguf` (the files that go to the CDN).
 *       `docs/local-ai/catalog.qwen3.5.json` is the starting body (Qwen3.5 0.8B / 2B / 4B / 9B, Q4_K_M).
 *   node scripts/local-ai-catalog.mjs sign <catalog-body.json> <private-key.pem> <key-id> [envelope-out.json]
 *       Checks the body's shape, then writes the envelope to publish as catalog.json.
 *   node scripts/local-ai-catalog.mjs verify <envelope.json> <public-key-base64>
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';

const [cmd, ...args] = process.argv.slice(2);
const die = (msg) => {
  console.error(msg);
  process.exit(1);
};
const KEY_ID = /^[a-z0-9-]{1,40}$/;

function checkBody(body) {
  const c = JSON.parse(body);
  if (c.schema !== 1) die('schema must be 1');
  for (const k of ['issuedAt', 'expiresAt']) if (Number.isNaN(Date.parse(c[k]))) die(`${k} must be an ISO date`);
  if (Date.parse(c.expiresAt) <= Date.now()) die('expiresAt is in the past');
  if (!Array.isArray(c.models)) die('models must be a list');
  for (const m of c.models) {
    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(m.id ?? '')) die(`bad model id: ${m.id}`);
    if (!String(m.url).startsWith('https://')) die(`${m.id}: url must be https`);
    if (!/^[0-9a-f]{64}$/.test(m.sha256 ?? '')) die(`${m.id}: sha256 must be 64 hex digits`);
    if (!Number.isInteger(m.bytes) || m.bytes <= 0) die(`${m.id}: bytes must be a positive integer`);
  }
  return c;
}

if (cmd === 'keygen') {
  const [keyId, out] = args;
  if (!KEY_ID.test(keyId ?? '') || !out) die('usage: keygen <key-id> <private-key-out.pem>');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  await writeFile(out, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
  const spki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  console.log(`Private key written to ${out} (keep it out of the repository).`);
  console.log(`Pin in LOCAL_AI_CATALOG_KEYS:\n  '${keyId}': '${spki}',`);
} else if (cmd === 'hash') {
  const [file] = args;
  if (!file) die('usage: hash <model.gguf>');
  const h = createHash('sha256');
  for await (const chunk of createReadStream(file)) h.update(chunk);
  console.log(JSON.stringify({ sha256: h.digest('hex'), bytes: (await stat(file)).size }));
} else if (cmd === 'fill') {
  const [bodyFile, dir, out] = args;
  if (!bodyFile || !dir) die('usage: fill <catalog-body.json> <models-dir> [out.json]');
  const c = JSON.parse(await readFile(bodyFile, 'utf8'));
  for (const m of c.models) {
    const file = `${dir}/${m.id}.gguf`;
    const h = createHash('sha256');
    try {
      for await (const chunk of createReadStream(file)) h.update(chunk);
    } catch {
      die(`${m.id}: ${file} not found`);
    }
    m.sha256 = h.digest('hex');
    m.bytes = (await stat(file)).size;
    console.error(`${m.id}: ${m.bytes} bytes, sha256 ${m.sha256}`);
  }
  const text = JSON.stringify(c, null, 2) + '\n';
  if (out) await writeFile(out, text);
  else console.log(text);
} else if (cmd === 'sign') {
  const [bodyFile, keyFile, keyId, out] = args;
  if (!bodyFile || !keyFile || !KEY_ID.test(keyId ?? '')) die('usage: sign <catalog-body.json> <private-key.pem> <key-id> [envelope-out.json]');
  const body = JSON.stringify(checkBody(await readFile(bodyFile, 'utf8')));
  const signature = sign(null, Buffer.from(body, 'utf8'), createPrivateKey(await readFile(keyFile))).toString('base64');
  const envelope = JSON.stringify({ body, signature, keyId }, null, 2);
  if (out) await writeFile(out, envelope);
  else console.log(envelope);
} else if (cmd === 'verify') {
  const [envFile, pub] = args;
  if (!envFile || !pub) die('usage: verify <envelope.json> <public-key-base64>');
  const env = JSON.parse(await readFile(envFile, 'utf8'));
  const key = createPublicKey({ key: Buffer.from(pub, 'base64'), format: 'der', type: 'spki' });
  if (!verify(null, Buffer.from(env.body, 'utf8'), key, Buffer.from(env.signature, 'base64'))) die('signature does not verify');
  const c = checkBody(env.body);
  console.log(`OK: ${c.models.length} models, key ${env.keyId}, expires ${c.expiresAt}`);
} else {
  die('commands: keygen, hash, fill, sign, verify (see the top of this file)');
}
