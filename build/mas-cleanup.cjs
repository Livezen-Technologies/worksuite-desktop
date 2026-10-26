/**
 * Mac App Store build clean-up (docs/TESTFLIGHT.md).
 *
 * `npm run dist:mas` leaves the signed WorkSuite.app next to the .pkg, and the per-architecture copies in
 * mas-universal-*-temp. macOS registers every one of them as a handler for worksuite:// and mailto:. An App Store
 * signed app only runs when the App Store or TestFlight installed it, so a browser sign-in on the build Mac then
 * opens one of these copies and fails with "The application can't be opened".
 *
 *   afterAllArtifactBuild  once the .pkg is written, each leftover .app is unregistered from Launch Services and
 *                          deleted. Only the .pkg, the file that is uploaded, stays. WS_MAS_KEEP_APP=1 keeps them.
 */
const { spawnSync } = require('node:child_process');
const { existsSync, readdirSync, rmSync } = require('node:fs');
const path = require('node:path');

const LSREGISTER =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

/** Every mas-universal* output folder: the universal app and the per-architecture copies it was merged from. */
function masDirs(outDir) {
  if (!existsSync(outDir)) return [];
  return readdirSync(outDir)
    .filter((name) => name === 'mas' || name.startsWith('mas-'))
    .map((name) => path.join(outDir, name));
}

async function afterAllArtifactBuild(result) {
  if (process.env.WS_MAS_KEEP_APP === '1') return [];
  for (const dir of masDirs(result.outDir)) {
    const temp = /-temp$/.test(dir);
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.app'))) {
      const app = path.join(dir, name);
      if (existsSync(LSREGISTER)) spawnSync(LSREGISTER, ['-u', app]);
      rmSync(app, { recursive: true, force: true });
      console.log(`  • removed leftover App Store app  path=${path.relative(process.cwd(), app)}`);
    }
    if (temp) rmSync(dir, { recursive: true, force: true });
  }
  return [];
}

module.exports = { afterAllArtifactBuild, masDirs };
