/**
 * macOS release signing (worksuite-desktop#147).
 *
 * macOS keeps Privacy & Security permissions (Accessibility, Screen Recording)
 * against an app's code requirement. A Developer ID build's requirement is
 * "bundle ID lk.worksuite.desktop, signed by our Team ID", which every update
 * keeps, so a permission granted once survives updates. An ad-hoc build's
 * requirement is the hash of that exact binary: after the next update System
 * Settings still shows WorkSuite switched on, but the entry no longer matches
 * and every check reads Denied. So a release must never be ad-hoc signed.
 *
 *   beforePack  a macOS release with no Developer ID certificate (CSC_LINK or
 *               CSC_NAME) stops before anything is built.
 *   afterSign   the signed .app is read back with codesign: a release must
 *               carry a Developer ID Application authority and a Team ID
 *               (APPLE_TEAM_ID when set), with the hardened runtime; anything
 *               else fails the build. Other builds only warn, loudly.
 *
 * A release is a tagged CI build (GITHUB_REF refs/tags/v*) or WS_RELEASE_BUILD=1.
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function isRelease(env = process.env) {
  return env.WS_RELEASE_BUILD === '1' || /^refs\/tags\/v/.test(env.GITHUB_REF || '');
}

function hasIdentity(env = process.env) {
  return !!(env.CSC_LINK || env.CSC_NAME);
}

/** Parses `codesign -dv --verbose=4` output (stderr). */
function parseCodesign(output) {
  const out = { identifier: null, teamId: null, authorities: [], adhoc: false, runtime: false };
  for (const raw of String(output).split('\n')) {
    const line = raw.trim();
    // "CodeDirectory v=20500 size=… flags=0x10000(runtime) …" has no '=' right after its name.
    const m = line.startsWith('CodeDirectory ') ? ['', 'CodeDirectory', line.slice(14)] : /^([A-Za-z]+)=(.*)$/.exec(line);
    if (!m) continue;
    const [, key, value] = m;
    if (key === 'Identifier') out.identifier = value;
    else if (key === 'TeamIdentifier') out.teamId = value === 'not set' ? null : value;
    else if (key === 'Authority') out.authorities.push(value);
    else if (key === 'Signature' && value === 'adhoc') out.adhoc = true;
    else if (key === 'CodeDirectory') {
      const flags = (/flags=0x[0-9a-f]+\(([^)]*)\)/i.exec(value) || [])[1];
      const list = flags ? flags.split(',') : [];
      if (list.includes('adhoc') || list.includes('linker-signed')) out.adhoc = true;
      if (list.includes('runtime')) out.runtime = true;
    }
  }
  return out;
}

/** What is wrong with a signature for a release; an empty list when it is a stable Developer ID signature. */
function signingProblems(sig, env = process.env, appId = 'lk.worksuite.desktop') {
  const problems = [];
  if (sig.adhoc) problems.push('it is ad-hoc signed, so macOS ties permissions to this exact build and they are lost on every update');
  if (!sig.authorities.some((a) => a.startsWith('Developer ID Application:'))) problems.push('it is not signed with a Developer ID Application certificate');
  if (!sig.teamId) problems.push('it has no Team ID');
  else if (env.APPLE_TEAM_ID && sig.teamId !== env.APPLE_TEAM_ID) problems.push(`its Team ID ${sig.teamId} is not APPLE_TEAM_ID ${env.APPLE_TEAM_ID}`);
  if (sig.identifier && sig.identifier !== appId) problems.push(`its identifier ${sig.identifier} is not ${appId}`);
  if (!sig.runtime) problems.push('the hardened runtime is off');
  return problems;
}

const WARN = (text) => console.warn(`\n\u001b[33m⚠ macOS signing: ${text}\u001b[0m\n`);

/** beforePack hook. */
async function beforePack(context, env = process.env) {
  if (context.electronPlatformName !== 'darwin') return;
  if (hasIdentity(env)) return;
  const text = 'no Developer ID Application certificate (set CSC_LINK + CSC_KEY_PASSWORD, or CSC_NAME). This build will be ad-hoc signed: Accessibility and Screen Recording granted to it will not survive an update (worksuite-desktop#147).';
  if (isRelease(env)) throw new Error(`Refusing to build a macOS release: ${text}`);
  WARN(text);
}

/** afterSign hook: reads the signature back from the built app (no shell; codesign reports on stderr). */
async function afterSign(context, env = process.env, run = spawnSync) {
  if (context.electronPlatformName !== 'darwin') return;
  // The single-architecture halves of a universal build are not the shipped app.
  if (/-(x64|arm64)-temp$/.test(context.appOutDir)) return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const r = run('/usr/bin/codesign', ['-dv', '--verbose=4', app], { encoding: 'utf8', timeout: 60_000 });
  const output = `${(r && r.stderr) || ''}${(r && r.stdout) || ''}`;
  const sig = parseCodesign(output);
  const problems = !r || r.status !== 0 || !sig.identifier ? [/not signed at all/.test(output) ? 'it is not signed at all' : 'codesign could not read its signature'] : signingProblems(sig, env, context.packager.appInfo.id || 'lk.worksuite.desktop');
  if (problems.length === 0) return;
  const text = `${path.basename(app)}: ${problems.join('; ')}.`;
  if (isRelease(env)) throw new Error(`Refusing to ship a macOS release: ${text}`);
  WARN(text);
}

module.exports = { isRelease, hasIdentity, parseCodesign, signingProblems, beforePack, afterSign };
