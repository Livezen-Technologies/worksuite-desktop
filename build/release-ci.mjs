#!/usr/bin/env node
/**
 * The release steps of .github/workflows/build.yml (audit D-G01, D-G02), kept here so they are tested
 * (tests/unit/build/release-ci.test.ts) rather than buried in YAML. docs/RELEASING.md describes the flow.
 *
 *   node build/release-ci.mjs tag <ref name>             the pushed tag must be v<package.json version>
 *   node build/release-ci.mjs signing <macOS|Windows|Linux>
 *                                                         a release (WS_RELEASE=1: a v* tag, or the STABLE channel)
 *                                                         fails without its platform's signing secrets; any other
 *                                                         build warns and goes on unsigned
 *   node build/release-ci.mjs publish <artifact dir> <notes file>
 *                                                         prints the publish-release.mjs arguments (one per line)
 *                                                         and writes the release notes from CHANGELOG.md
 *
 * Messages go out as GitHub workflow commands (::error / ::warning / ::notice).
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

export const appVersion = (dir = root) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;

/** The tag that releases `version`; null when `refName` is it, otherwise why not. */
export function tagProblem(refName, version) {
  if (refName === `v${version}`) return null;
  return `the tag ${refName} is not v${version}, the version in package.json. Bump package.json (and CHANGELOG.md) to the tag's version and tag that commit, or delete the tag.`;
}

/**
 * The Update Center's build number: the patch number, which rises with every release on one line (0.2.282 → 282).
 * A pre-release (0.2.283-beta.1) takes its patch number too.
 */
export function buildNumber(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(version));
  if (!m) throw new Error(`${version} is not a version (major.minor.patch)`);
  const n = Number(m[3]);
  if (!(n > 0)) throw new Error(`${version}: the build number is the patch number, and the Update Center needs it above 0`);
  return n;
}

const set = (env, ...names) => names.every((n) => !!env[n]);

/**
 * What a platform's signing is missing, or [] when it is complete. macOS: a Developer ID Application certificate and
 * its password, and the App Store Connect API key that notarizes. Windows: an Authenticode certificate and its
 * password, or the whole Azure Trusted Signing set. Linux: the GPG key, which only STABLE needs (the Update Center
 * accepts unsigned packages on BETA, DEV and INTERNAL).
 */
export function signingGaps(os, env = process.env) {
  if (os === 'macOS') {
    const gaps = [];
    if (!set(env, 'MAC_CSC_LINK', 'MAC_CSC_KEY_PASSWORD')) gaps.push('MAC_CSC_LINK and MAC_CSC_KEY_PASSWORD (the Developer ID Application certificate)');
    if (!set(env, 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER')) gaps.push('APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER (notarization)');
    return gaps;
  }
  if (os === 'Windows') {
    const azure = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_TRUSTED_SIGNING_ACCOUNT', 'AZURE_TRUSTED_SIGNING_PROFILE', 'AZURE_TRUSTED_SIGNING_ENDPOINT'];
    if (set(env, 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD') || set(env, ...azure)) return [];
    return [`WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD (an Authenticode certificate), or all of ${azure.join(', ')} (Azure Trusted Signing)`];
  }
  if (os === 'Linux') return env.WS_CHANNEL === 'STABLE' && !env.LINUX_GPG_PRIVATE_KEY ? ['LINUX_GPG_PRIVATE_KEY (STABLE needs GPG-signed Linux packages)'] : [];
  throw new Error(`unknown runner OS ${os}`);
}

/** The signing verdict for one platform: { level: 'ok' | 'warning' | 'error', text }. */
export function signingVerdict(os, env = process.env) {
  const gaps = signingGaps(os, env);
  if (!gaps.length) return { level: 'ok', text: `${os}: signing secrets are set.` };
  const release = env.WS_RELEASE === '1';
  const what = release ? `This is a release build (a v* tag or the STABLE channel) and must be signed` : `This build is not a release, so it goes on unsigned`;
  return { level: release ? 'error' : 'warning', text: `${os}: missing ${gaps.join('; ')}. ${what} (docs/RELEASING.md §2).` };
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/**
 * The installers the Update Center gets, as publish-release.mjs `--file platform:arch:type:path` values: Windows x64,
 * the one universal DMG as both macos:arm64 and macos:x64 (the app asks for its own architecture and the Update
 * Center matches it exactly; a package published only as universal is offered to no Mac), and every Linux x64 format
 * (each install asks for the type it was installed as). Missing one is an error: a release without it leaves those
 * computers where they are.
 */
export function publishFiles(dir, version) {
  const files = walk(dir);
  const find = (name) => files.find((f) => f.endsWith(`/${name}`) || f === name);
  const wanted = [
    ['windows:x64:exe', `WorkSuite-Setup-${version}-x64.exe`],
    ['macos:arm64:dmg', `WorkSuite-${version}-universal.dmg`],
    ['macos:x64:dmg', `WorkSuite-${version}-universal.dmg`],
    ['linux:x64:appimage', `WorkSuite-${version}-x86_64.AppImage`],
    ['linux:x64:deb', `WorkSuite-${version}-amd64.deb`],
    ['linux:x64:rpm', `WorkSuite-${version}-x86_64.rpm`],
  ];
  const missing = wanted.filter(([, name]) => !find(name)).map(([, name]) => name);
  if (missing.length) throw new Error(`not in the build's artifacts: ${[...new Set(missing)].join(', ')}`);
  return wanted.map(([spec, name]) => `${spec}:${find(name)}`);
}

/** The CHANGELOG.md section for `version` (its body, without the heading), or null when there is none. */
export function changelogSection(changelog, version) {
  const lines = changelog.split('\n');
  const esc = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const start = lines.findIndex((l) => new RegExp(`^## \\[?${esc}\\]?(\\s|$)`).test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end).join('\n').replace(/\n---\s*$/, '').trim();
  return body || null;
}

/** Everything publish-release.mjs is given, in order. */
export function publishArgs({ version, channel, commit, files, notes }) {
  const args = ['--app', 'desktop', '--app-id', 'lk.worksuite.desktop', '--channel', channel, '--version', version, '--build', String(buildNumber(version))];
  args.push('--commit', commit, '--pipeline', 'github-actions build.yml', '--summary', `WorkSuite Desktop ${version}`, '--notes', notes);
  for (const f of files) args.push('--file', f);
  return args;
}

const CHANNELS = new Set(['STABLE', 'BETA', 'DEV', 'INTERNAL']);

function main([cmd, ...rest]) {
  const fail = (title, text) => {
    console.log(`::error title=${title}::${text}`);
    process.exit(1);
  };
  if (cmd === 'tag') {
    const version = appVersion();
    const problem = tagProblem(rest[0] ?? '', version);
    if (problem) fail('Tag is not the version', problem);
    try {
      buildNumber(version);
    } catch (e) {
      fail('No build number', e.message);
    }
    console.log(`The tag ${rest[0]} releases ${version} (build ${buildNumber(version)}).`);
    return;
  }
  if (cmd === 'signing') {
    const v = signingVerdict(rest[0] ?? '');
    if (v.level === 'error') fail('Release builds must be signed', v.text);
    if (v.level === 'warning') console.log(`::warning title=Unsigned build::${v.text}`);
    else console.log(v.text);
    return;
  }
  if (cmd === 'publish') {
    const [dir, notesFile] = rest;
    if (!dir || !notesFile) fail('Publish', 'usage: publish <artifact dir> <notes file>');
    const version = appVersion();
    const channel = process.env.WS_CHANNEL || 'BETA';
    if (!CHANNELS.has(channel)) fail('Unknown channel', `${channel} is not one of ${[...CHANNELS].join(', ')}`);
    let files;
    try {
      files = publishFiles(dir, version);
    } catch (e) {
      fail('Installers missing', e.message);
    }
    const section = changelogSection(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), version);
    if (!section) console.log(`::warning title=No changelog section::CHANGELOG.md has no "## ${version}" section; the release notes say only the version.`);
    writeFileSync(notesFile, section ?? `## Improvements\n- WorkSuite Desktop ${version}\n`);
    const args = publishArgs({ version, channel, commit: process.env.GITHUB_SHA || 'unknown', files, notes: notesFile });
    process.stdout.write(`${args.join('\n')}\n`);
    return;
  }
  fail('release-ci', 'usage: release-ci.mjs <tag|signing|publish> …');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
