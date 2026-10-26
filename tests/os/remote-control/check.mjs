// The remote-control input helper on this computer, for real (WS-MEET-ENH-01):
// a test window reports what arrives — clicks and their count, drags, the
// wheel, keys and their modifiers, typed text — and each is compared with
// what the helper was asked to do. CI runs it on GitHub's Windows and macOS
// machines, and on Linux under Xvfb. `node tests/os/remote-control/check.mjs`
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const work = mkdtempSync(join(tmpdir(), 'rc-os-'));
const platform = process.platform;
const mac = platform === 'darwin';
const verbose = !!process.env.RC_VERBOSE;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

// macOS: whether this machine lets a process it starts post input at all (Privacy & Security › Accessibility), asked
// the way the helper asks. A hosted runner without it cannot pass the mouse and keyboard checks, and says so on each
// failure instead of leaving a bare FAIL: the cause is the machine, not the helper.
const macPermission = () => {
  if (!mac) return null;
  const r = spawnSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', 'ObjC.import("ApplicationServices"); ObjC.import("CoreGraphics"); JSON.stringify({ trusted: typeof $.CGPreflightPostEventAccess === "function" ? !!$.CGPreflightPostEventAccess() : !!$.AXIsProcessTrusted(), accessibility: !!$.AXIsProcessTrusted() })'], { encoding: 'utf8', timeout: 20_000 });
  try {
    return JSON.parse(r.stdout.trim());
  } catch {
    return { trusted: null, accessibility: null, error: (r.stderr || '').trim().slice(0, 200) };
  }
};
const permission = macPermission();
if (permission) console.log(`  this Mac lets the helper post input: ${JSON.stringify(permission)}`);
const noPermission = permission && permission.trusted === false;
const check = (what, ok, detail = '') => {
  results.push(!!ok);
  const why = !ok && noPermission ? ' — this Mac has not given the helper Accessibility (Privacy & Security › Accessibility), so posted input is dropped; grant it to the runner, the helper is not at fault' : '';
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}${why}`);
  return !!ok;
};

// The helper exactly as the app has it.
await build({
  entryPoints: [join(root, 'electron', 'services', 'remote-control', 'input.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: join(work, 'input.cjs'),
  alias: { '@shared': join(root, 'shared') },
  external: ['electron'],
  logLevel: 'warning',
});
const { createInjector, inputSupport } = createRequire(import.meta.url)(join(work, 'input.cjs'));

// The test window.
let target;
if (platform === 'win32') {
  target = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', join(here, 'target-windows.ps1')], { stdio: ['ignore', 'pipe', 'inherit'] });
} else if (mac) {
  const bin = join(work, 'rc-target');
  if (spawnSync('swiftc', ['-O', '-o', bin, join(here, 'target-macos.swift')], { stdio: 'inherit' }).status !== 0) {
    check('the test window builds', false);
    process.exit(1);
  }
  target = spawn(bin, [], { stdio: ['ignore', 'pipe', 'inherit'] });
} else {
  target = spawn(process.env.RC_PYTHON ?? 'python3', [join(here, 'target-linux.py')], { stdio: ['ignore', 'pipe', 'inherit'] });
}
const events = [];
const seen = [];
let ready = null;
createInterface({ input: target.stdout }).on('line', (line) => {
  let o;
  try {
    o = JSON.parse(line);
  } catch {
    console.log(`  target: ${line}`);
    return;
  }
  seen.push(line);
  if (verbose) console.log(`  <- ${line}`);
  if (o.ready) ready = o;
  else events.push(o);
});
const waitFor = async (pred, ms = 3_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const hit = events.find(pred);
    if (hit) return hit;
    await sleep(20);
  }
  return null;
};
const forget = () => void events.splice(0);
const finish = (code) => {
  const failed = results.filter((r) => !r).length;
  if (failed && !verbose) console.log(`\nWhat the test window reported:\n${seen.map((l) => `  ${l}`).join('\n')}`);
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  target.kill();
  process.exit(code ?? (failed ? 1 : 0));
};

const t0 = Date.now();
while (!ready && Date.now() - t0 < 90_000 && target.exitCode === null) await sleep(50);
if (!check('the test window is up', ready, ready ? `window ${ready.window}, pad ${JSON.stringify(ready.pad)}` : 'it never said ready')) finish(1);

console.log(`  support here: ${JSON.stringify(inputSupport({ platform }))}`);
const inj = createInjector(platform);
if (!check('the helper starts', inj && (await inj.start()))) finish(1);
const idle = async () => {
  const end = Date.now() + 10_000;
  while (!inj.idle() && Date.now() < end) await sleep(10);
};
const run = async (actions) => {
  inj.send(actions);
  await idle();
};

const { pad, box } = ready;
const mid = (r) => ({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
const c = mid(pad);
const near = (e, p) => e && Math.abs(e.x - p.x) <= 3 && Math.abs(e.y - p.y) <= 3;

// What the helper sees of the window.
const fg = await inj.foreground();
check('the window in front is the test window', fg?.window === ready.window, JSON.stringify(fg));
const rect = await inj.windowBounds(ready.window);
check('its place on screen holds the pad', rect && rect.x <= pad.x + 2 && rect.y <= pad.y + 2 && rect.x + rect.width >= pad.x + pad.width - 2 && rect.y + rect.height >= pad.y + pad.height - 2, JSON.stringify(rect));
// On a failure, the helper's own answer (the window it says a click there reaches) is shown; `query` is the helper's.
const under = await inj.isUnder(c.x, c.y, ready.window);
check('it is under the pointer over the pad', under === true, under === true || typeof inj.query !== 'function' ? '' : `the helper names window ${JSON.stringify(await inj.query(`at ${c.x} ${c.y}`))}, not ${ready.window}`);
check('  and not beside it', (await inj.isUnder(Math.max(2, pad.x - 100), c.y, ready.window)) === false);

// The mouse.
forget();
await run([{ t: 'move', x: c.x, y: c.y }, { t: 'button', button: 'left', down: true }, { t: 'button', button: 'left', down: false }]);
const click = await waitFor((e) => e.e === 'down');
check('a click lands where it was sent, as one click', click?.button === 'left' && click.clicks === 1 && near(click, c), JSON.stringify(click));
await sleep(900);

forget();
await run([{ t: 'button', button: 'left', down: true }, { t: 'button', button: 'left', down: false }, { t: 'button', button: 'left', down: true }, { t: 'button', button: 'left', down: false }]);
const double = await waitFor((e) => e.e === 'down' && e.clicks === 2);
check('two quick clicks there are a double-click', double, JSON.stringify(events.filter((e) => e.e === 'down')));
await sleep(900);

forget();
await run([{ t: 'button', button: 'right', down: true }, { t: 'button', button: 'right', down: false }]);
check('a right click is one', await waitFor((e) => e.e === 'down' && e.button === 'right'));
await sleep(900);

forget();
await run([{ t: 'button', button: 'left', down: true }, { t: 'move', x: c.x + 40, y: c.y + 10 }, { t: 'move', x: c.x + 60, y: c.y + 20 }, { t: 'button', button: 'left', down: false }]);
const drag = await waitFor((e) => e.e === 'drag' && near(e, { x: c.x + 60, y: c.y + 20 }));
check('a move with the button held drags', drag, JSON.stringify(events.filter((e) => e.e === 'drag').slice(-1)));
await run([{ t: 'move', x: c.x, y: c.y }]);

forget();
await run([{ t: 'wheel', dx: 0, dy: 240 }]);
const down = await waitFor((e) => e.e === 'wheel');
check('the wheel scrolls down', down?.dir === 'down', JSON.stringify(down));
forget();
await run([{ t: 'wheel', dx: 0, dy: -120 }]);
const up = await waitFor((e) => e.e === 'wheel');
check('  and up', up?.dir === 'up', JSON.stringify(up));
forget();
await run([{ t: 'wheel', dx: -120, dy: 0 }]);
const left = await waitFor((e) => e.e === 'wheel');
check('  and sideways', left?.dir === 'left', JSON.stringify(left));

// The keyboard, in the text box.
const b = mid(box);
await run([{ t: 'move', x: b.x, y: b.y }, { t: 'button', button: 'left', down: true }, { t: 'button', button: 'left', down: false }]);
await sleep(500);
forget();
await run([{ t: 'key', code: 'ShiftLeft', down: true }, { t: 'key', code: 'KeyA', down: true }, { t: 'key', code: 'KeyA', down: false }, { t: 'key', code: 'ShiftLeft', down: false }]);
const shiftA = await waitFor((e) => e.e === 'key' && e.key === 'a');
check('Shift+A arrives with Shift held', shiftA?.shift === true, JSON.stringify(shiftA));
check('  and types a capital A', await waitFor((e) => e.e === 'text' && e.value === 'A'), JSON.stringify(events.filter((e) => e.e === 'text').slice(-1)));

const mod = mac ? 'MetaLeft' : 'ControlLeft';
const flag = mac ? 'meta' : 'ctrl';
forget();
await run([{ t: 'key', code: mod, down: true }, { t: 'key', code: 'KeyU', down: true }, { t: 'key', code: 'KeyU', down: false }, { t: 'key', code: mod, down: false }]);
const chord = await waitFor((e) => e.e === 'key' && e.key === 'u');
check(`${mac ? 'Command' : 'Ctrl'}+U arrives with it held`, chord?.[flag] === true, JSON.stringify(chord));
forget();
await run([{ t: 'key', code: 'KeyB', down: true }, { t: 'key', code: 'KeyB', down: false }]);
const plain = await waitFor((e) => e.e === 'key' && e.key === 'b');
check(`  and once it is let go, B arrives without it`, plain && !plain.shift && !plain.ctrl && !plain.meta && !plain.alt, JSON.stringify(plain));
check('  and types b', await waitFor((e) => e.e === 'text' && e.value === 'Ab'), JSON.stringify(events.filter((e) => e.e === 'text').slice(-1)));

forget();
const text = process.env.RC_TEXT ?? 'Olá 😀';
await run([{ t: 'text', text }]);
const typed = await waitFor((e) => e.e === 'text' && e.value === `Ab${text}`, 6_000);
check('text is typed as it was written, accents and emoji too', typed, JSON.stringify(events.filter((e) => e.e === 'text').slice(-1)));

// Stopping.
inj.send([{ t: 'key', code: 'KeyC', down: true }, { t: 'key', code: 'KeyC', down: false }]);
inj.stop();
await sleep(1_500);
check('stopping lets the last keys finish', await waitFor((e) => e.e === 'key' && e.key === 'c', 500));

finish();
