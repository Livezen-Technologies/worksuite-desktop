#!/usr/bin/env node
/**
 * Each desktop module's own version and changelog (docs/MODULES.md), as on the server.
 *
 *   src/modules/<module>/module.json    {"module", "version", "paths"}
 *   src/modules/<module>/CHANGELOG.md   "## <version> — <date>" sections, newest first
 *
 *   npm run module -- list
 *   npm run module -- init
 *   npm run module -- branch pos "drawer rules" [--dry]      → module/pos/drawer-rules from origin/main
 *   npm run module -- release pos minor "Added: …" "Fixed: …"
 *   npm run module -- check [base=origin/main] [--skip ai,chat]
 *   npm run module -- tag [--create]                          → pos/v1.4.0 …
 *
 * `paths` are files outside the module's folder that are still its own — its main-process services — so a change
 * there asks for the module's version too. The app's own version (package.json) is unchanged by any of this.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const MODULES_DIR = 'src/modules';

/** Main-process files whose names do not start with their module's. */
const EXTRA_PATHS = {
  ai: ['electron/services/local-ai', 'electron/services/ai-pending.ts', 'electron/services/quick-ask.ts'],
  calls: ['electron/services/screen-share.ts'],
  chat: ['electron/services/webchat-ring.ts'],
  events: ['electron/services/event-desk.ts', 'electron/services/event-desk-print.ts'],
};

export function modules(root) {
  const dir = join(root, MODULES_DIR);
  return readdirSync(dir)
    .filter((d) => !d.startsWith('.') && statSync(join(dir, d)).isDirectory())
    .sort();
}

export const manifestPath = (m) => `${MODULES_DIR}/${m}/module.json`;
export const changelogPath = (m) => `${MODULES_DIR}/${m}/CHANGELOG.md`;

export function parse(json) {
  try {
    const j = JSON.parse(json);
    if (!j || typeof j.version !== 'string') return null;
    return { module: String(j.module ?? ''), version: j.version, paths: Array.isArray(j.paths) ? j.paths.map(String).filter(Boolean) : [] };
  } catch {
    return null;
  }
}

export function read(root, m) {
  const f = join(root, manifestPath(m));
  return existsSync(f) ? parse(readFileSync(f, 'utf8')) : null;
}

export const changelogVersion = (md) => /^## (\d+\.\d+\.\d+)\b/m.exec(md)?.[1] ?? null;
export const changelogHas = (md, v) => new RegExp(`^## ${v.replace(/\./g, '\\.')}\\b`, 'm').test(md);

export function bump(version, level) {
  const m = SEMVER.exec(version);
  if (!m) throw new Error(`Not a version: ${version}`);
  const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (level === 'major') return `${maj + 1}.0.0`;
  if (level === 'minor') return `${maj}.${min + 1}.0`;
  if (level === 'patch') return `${maj}.${min}.${pat + 1}`;
  throw new Error('Say patch, minor or major.');
}

export function compare(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  return 0;
}

export const tag = (m, v) => `${m.toLowerCase()}/v${v}`;

export function branch(m, topic) {
  const t = String(topic).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!t) throw new Error('Name the work: a few words for the branch.');
  return `module/${m.toLowerCase()}/${t.slice(0, 48)}`;
}

const GROUPS = ['', 'Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'];

export function section(version, notes, date) {
  const groups = {};
  for (const n of notes) {
    const m = /^(Added|Changed|Deprecated|Removed|Fixed|Security):\s*(.+)$/i.exec(n);
    const g = m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : '';
    (groups[g] ??= []).push(m ? m[2] : n);
  }
  let out = `## ${version} — ${date}\n`;
  for (const g of GROUPS) {
    if (!groups[g]) continue;
    // Notes with no Added:/Fixed:… prefix are listed as they are, first.
    out += g === '' ? '\n' : `\n**${g}**\n\n`;
    for (const line of groups[g]) out += `- ${line}\n`;
  }
  return out;
}

export function changelogHeader(m) {
  return (
    `# ${m} — changelog\n\n` +
    "This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or\n" +
    "a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in\n" +
    'the root CHANGELOG.md.\n'
  );
}

export function insertSection(md, sec) {
  const at = md.search(/^## /m);
  return at >= 0 ? md.slice(0, at) + sec + '\n' + md.slice(at) : md.trimEnd() + '\n\n' + sec;
}

function writeManifest(root, m, data) {
  writeFileSync(join(root, manifestPath(m)), JSON.stringify({ module: m, version: data.version, paths: data.paths }, null, 4) + '\n');
}

const today = () => new Date().toISOString().slice(0, 10);

export function release(root, m, level, notes, date = today()) {
  const clean = notes.map((n) => n.trim()).filter(Boolean);
  if (!clean.length) throw new Error('Say what changed: at least one note for the changelog.');
  const j = read(root, m);
  if (!j) throw new Error(`${m} has no module.json. Run: npm run module -- init`);
  const to = bump(j.version, level);
  writeManifest(root, m, { ...j, version: to });
  const f = join(root, changelogPath(m));
  const old = existsSync(f) ? readFileSync(f, 'utf8') : changelogHeader(m);
  writeFileSync(f, insertSection(old, section(to, clean, date)));
  return { from: j.version, to };
}

/** The main-process files a module owns by name: electron/services/<m>, <m>.ts, <m>-*.ts, and EXTRA_PATHS. */
export function defaultPaths(root, m) {
  const svc = 'electron/services';
  const found = [];
  for (const f of existsSync(join(root, svc)) ? readdirSync(join(root, svc)).sort() : []) {
    if (f === m || f === `${m}.ts` || f.startsWith(`${m}-`)) found.push(`${svc}/${f}`);
  }
  for (const p of EXTRA_PATHS[m] ?? []) if (existsSync(join(root, p)) && !found.includes(p)) found.push(p);
  return found;
}

export function init(root, date = today()) {
  const done = [];
  for (const m of modules(root)) {
    if (read(root, m)) continue;
    writeManifest(root, m, { version: '1.0.0', paths: defaultPaths(root, m) });
    const f = join(root, changelogPath(m));
    if (!existsSync(f)) {
      writeFileSync(
        f,
        insertSection(
          changelogHeader(m),
          section('1.0.0', ["The baseline: the module as it stood when each module began to carry its own version. Its history before this is in the app's CHANGELOG.md."], date),
        ),
      );
    }
    done.push(m);
  }
  return done;
}

/** Which modules these repository paths belong to: a module's folder, or a path its module.json lists. */
export function owners(root, files) {
  const prefixes = [];
  for (const m of modules(root)) {
    prefixes.push([`${MODULES_DIR}/${m}/`, m]);
    for (const p of read(root, m)?.paths ?? []) prefixes.push([basename(p).includes('.') ? p : p.replace(/\/?$/, '/'), m]);
  }
  // Longest first, so a module's own path wins over a folder that contains it.
  prefixes.sort((a, b) => b[0].length - a[0].length);
  const out = {};
  for (const f of files) {
    const hit = prefixes.find(([p]) => f === p.replace(/\/$/, '') || f.startsWith(p));
    if (hit) (out[hit[1]] ??= []).push(f);
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** What a branch still owes: module → what is missing, in words. `atBase(path)` is its contents on the base, or null. */
export function owed(root, files, atBase, skip = []) {
  const out = {};
  for (const m of Object.keys(owners(root, files))) {
    if (skip.includes(m)) continue;
    const now = read(root, m);
    if (!now || !SEMVER.test(now.version)) {
      out[m] = 'module.json is missing or has no valid version.';
      continue;
    }
    const was = parse(atBase(manifestPath(m)) ?? '');
    const f = join(root, changelogPath(m));
    const log = existsSync(f) ? readFileSync(f, 'utf8') : '';
    const problems = [];
    if (was && compare(now.version, was.version) <= 0) problems.push(`the version is still ${now.version} — run \`npm run module -- release ${m} patch|minor|major "what changed"\``);
    if (!changelogHas(log, now.version)) problems.push(`CHANGELOG.md has no "## ${now.version}" section`);
    if (problems.length) out[m] = problems.join('; ').replace(/^./, (c) => c.toUpperCase()) + '.';
  }
  return out;
}

// ── the command line ───────────────────────────────────────────────────

function git(root, args) {
  try {
    return { ok: true, out: execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
  } catch (e) {
    return { ok: false, out: String(e.stderr ?? e.message).trim() };
  }
}

function resolve(root, name) {
  const m = modules(root).find((x) => x.toLowerCase() === String(name ?? '').toLowerCase());
  if (!m) {
    console.error(name ? `There is no module "${name}". \`npm run module -- list\` shows them.` : 'Name the module (e.g. pos).');
    process.exit(2);
  }
  return m;
}

function main(argv) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const flags = new Set(argv.filter((a) => a.startsWith('--') && !a.includes('=')));
  const opt = (k) => argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : undefined);
  const args = argv.filter((a, i) => !a.startsWith('--') && !(argv[i - 1] === '--skip'));
  const [cmd, ...rest] = args;

  switch (cmd) {
    case 'list': {
      for (const m of modules(root)) {
        const j = read(root, m);
        const f = join(root, changelogPath(m));
        const log = existsSync(f) ? readFileSync(f, 'utf8') : '';
        console.log(`${m.padEnd(16)} ${(j?.version ?? '—').padEnd(9)} changelog ${(changelogVersion(log) ?? '—').padEnd(9)} ${tag(m, j?.version ?? '0.0.0')}`);
      }
      return;
    }
    case 'init': {
      const done = init(root);
      console.log(done.length ? `Started at 1.0.0: ${done.join(', ')}` : 'Every module already has a module.json.');
      return;
    }
    case 'branch': {
      const m = resolve(root, rest[0]);
      const b = branch(m, rest.slice(1).join(' '));
      if (flags.has('--dry')) return void console.log(b);
      const f = git(root, ['fetch', 'origin', 'main']);
      const r = f.ok ? git(root, ['checkout', '-b', b, 'origin/main']) : f;
      if (!r.ok) {
        console.error(r.out);
        process.exit(1);
      }
      return void console.log(`On ${b}, from origin/main.`);
    }
    case 'release': {
      const m = resolve(root, rest[0]);
      const level = String(rest[1] ?? '').toLowerCase();
      if (!['patch', 'minor', 'major'].includes(level) || rest.length < 3) {
        console.error('Usage: npm run module -- release <module> <patch|minor|major> "note" ["note" …]');
        process.exit(2);
      }
      const r = release(root, m, level, rest.slice(2));
      console.log(`${m} ${r.from} → ${r.to}`);
      return void console.log(`Commit module.json and CHANGELOG.md with the change. After the merge: npm run module -- tag --create (${tag(m, r.to)}).`);
    }
    case 'check': {
      const base = rest[0] ?? 'origin/main';
      const skip = (opt('skip') ?? process.env.MODULE_SKIP ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => modules(root).find((x) => x.toLowerCase() === s.toLowerCase()) ?? s);
      const fork = git(root, ['merge-base', base, 'HEAD']);
      if (!fork.ok || !fork.out) {
        console.error(`Could not find where this branch left ${base}: ${fork.out}`);
        process.exit(2);
      }
      const diff = git(root, ['diff', '--name-only', fork.out, 'HEAD']);
      const files = diff.out.split('\n').filter(Boolean);
      const own = owners(root, files);
      const due = owed(root, files, (p) => {
        const r = git(root, ['show', `${fork.out}:${p}`]);
        return r.ok ? r.out : null;
      }, skip);
      if (!Object.keys(own).length) return void console.log('No module changed on this branch.');
      for (const m of Object.keys(own)) console.log(`  ${m.padEnd(16)} ${(read(root, m)?.version ?? '—').padEnd(9)} ${due[m] ? `✗ ${due[m]}` : '✓'}`);
      const n = Object.keys(due).length;
      if (n) {
        console.error(`\n${n} module${n === 1 ? '' : 's'} changed without a new version. See docs/MODULES.md.`);
        process.exit(1);
      }
      return;
    }
    case 'tag': {
      const missing = [];
      for (const m of modules(root)) {
        const j = read(root, m);
        if (!j) continue;
        const t = tag(m, j.version);
        if (!git(root, ['rev-parse', '-q', '--verify', `refs/tags/${t}`]).ok) missing.push([m, t, j.version]);
      }
      if (!missing.length) return void console.log('Every module version is tagged.');
      for (const [m, t, v] of missing) {
        if (flags.has('--create')) {
          const r = git(root, ['tag', '-a', t, '-m', `${m} ${v}`]);
          console.log(`  ${r.ok ? 'created' : 'failed '} ${t}${r.ok ? '' : `: ${r.out}`}`);
        } else console.log(`  ${t}`);
      }
      if (flags.has('--create')) console.log(`Push them: git push origin ${missing.map(([, t]) => t).join(' ')}`);
      return;
    }
    default:
      console.error('Usage: npm run module -- <list|init|branch|release|check|tag> … (docs/MODULES.md)');
      process.exit(2);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
