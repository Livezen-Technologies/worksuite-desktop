#!/usr/bin/env node
/**
 * Brings in @worksuite/sinhala-core — the one Sinhala conversion engine (WorkSuite Desktop Sinhala Tools blueprint
 * §1 rule 2) — as a pinned, built copy in vendor/sinhala-core. It is never edited here: the engine lives in
 * worksuite-office `sinhala/core` (branch office-v10 until the worksuite-sinhala repo exists), and this script is
 * the only way it changes.
 *
 *   node scripts/sync-sinhala-core.mjs [--repo ../worksuite-office] [--ref origin/office-v10]
 *       Reads the engine's sources at that commit (git show, so the other checkout is not touched), builds them
 *       with this repo's TypeScript as ES modules, and writes vendor/sinhala-core with SOURCE.json: the source
 *       commit, every source file's sha256 and every built file's sha256.
 *   node scripts/sync-sinhala-core.mjs --check [--repo …] [--ref …]
 *       Exit 1 when a vendored file no longer matches SOURCE.json (a hand edit), or — when the repo is there — when
 *       the engine's sources at --ref differ from the pinned commit's (drift: run the sync and release).
 *
 * tests/unit/electron/sinhala-core-drift.test.ts runs the first half of --check on every test run.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'vendor', 'sinhala-core');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const repo = resolve(root, arg('--repo', '../worksuite-office'));
const ref = arg('--ref', 'origin/office-v10');
const SOURCE_DIR = 'sinhala/core';
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });

function sourceFiles(commit) {
  return git('ls-tree', '-r', '--name-only', commit, '--', SOURCE_DIR)
    .toString('utf8')
    .split('\n')
    .filter((f) => /^sinhala\/core\/(src\/[^/]+\.ts|profiles\/[^/]+\.json|package\.json|tsconfig\.json)$/.test(f))
    .sort();
}

function sourceHashes(commit) {
  const out = {};
  for (const f of sourceFiles(commit)) out[f.slice(SOURCE_DIR.length + 1)] = sha(git('show', `${commit}:${f}`));
  return out;
}

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files.push(...walk(p));
    else files.push(p);
  }
  return files;
}

/** Every vendored file but SOURCE.json, with its sha256. */
export function vendoredHashes(dir = out) {
  const res = {};
  for (const p of walk(dir)) {
    const rel = relative(dir, p).split('\\').join('/');
    if (rel !== 'SOURCE.json') res[rel] = sha(readFileSync(p));
  }
  return res;
}

function check() {
  const pinned = JSON.parse(readFileSync(join(out, 'SOURCE.json'), 'utf8'));
  const now = vendoredHashes();
  const problems = [];
  for (const [f, h] of Object.entries(pinned.files)) if (now[f] !== h) problems.push(`${f}: changed by hand (sha256 ${now[f] ?? 'missing'}, pinned ${h})`);
  for (const f of Object.keys(now)) if (!(f in pinned.files)) problems.push(`${f}: not part of the pinned build`);
  let upstream = null;
  try {
    const commit = git('rev-parse', ref).toString('utf8').trim();
    const hashes = sourceHashes(commit);
    const drift = [...new Set([...Object.keys(hashes), ...Object.keys(pinned.sources)])].filter((f) => hashes[f] !== pinned.sources[f]);
    upstream = { ref, commit, drift };
    if (drift.length) problems.push(`the engine at ${ref} (${commit.slice(0, 10)}) differs from the pinned ${pinned.commit.slice(0, 10)} in: ${drift.join(', ')} — run npm run sinhala:sync`);
  } catch {
    upstream = null;
  }
  console.log(JSON.stringify({ pinned: pinned.commit, version: pinned.version, upstream, problems }, null, 2));
  if (problems.length) process.exitCode = 1;
}

function sync() {
  const commit = git('rev-parse', ref).toString('utf8').trim();
  const tmp = mkdtempSync(join(tmpdir(), 'sinhala-core-'));
  try {
    for (const f of sourceFiles(commit)) {
      const dest = join(tmp, f.slice(SOURCE_DIR.length + 1));
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, git('show', `${commit}:${f}`));
    }
    const pkg = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8'));
    // The engine's own settings, as ES modules for this app's bundlers (the main process, the worker, the tests).
    const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
    execFileSync(process.execPath, [tsc, '-p', join(tmp, 'tsconfig.json'), '--module', 'ES2020', '--moduleResolution', 'node', '--outDir', join(tmp, 'dist')], { stdio: 'inherit' });
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    cpSync(join(tmp, 'dist'), join(out, 'dist'), { recursive: true });
    writeFileSync(
      join(out, 'package.json'),
      JSON.stringify(
        {
          name: pkg.name,
          version: pkg.version,
          description: `${pkg.description} — pinned build, do not edit (scripts/sync-sinhala-core.mjs)`,
          private: true,
          license: pkg.license,
          type: 'module',
          main: 'dist/src/index.js',
          types: 'dist/src/index.d.ts',
          sideEffects: false,
        },
        null,
        2,
      ) + '\n',
    );
    const source = {
      package: pkg.name,
      version: pkg.version,
      repository: 'Livezen-Technologies/worksuite-office',
      path: SOURCE_DIR,
      ref: ref.replace(/^origin\//, ''),
      commit,
      synced: new Date().toISOString().slice(0, 10),
      sources: sourceHashes(commit),
      files: vendoredHashes(),
    };
    writeFileSync(join(out, 'SOURCE.json'), JSON.stringify(source, null, 2) + '\n');
    console.log(`vendor/sinhala-core: ${pkg.name} ${pkg.version} from ${commit.slice(0, 10)} (${Object.keys(source.files).length} files)`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv.includes('--check')) check();
else sync();
