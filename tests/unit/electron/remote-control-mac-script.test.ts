import { describe, expect, it } from 'vitest';
import { MAC_SCRIPT, protocolLines, type InputAction } from '../../../electron/services/remote-control/input';

/**
 * The macOS input helper's own script (JXA), run here with a stand-in for
 * the Objective-C bridge: the CGEvents it would post are recorded, and the
 * lines it answers are read back. What macOS then does with those events is
 * only known on a Mac; this holds the script to what macOS needs of them.
 */

interface Posted {
  kind: string;
  type?: number;
  x?: number;
  y?: number;
  button?: number;
  code?: number;
  down?: boolean;
  flags?: number;
  fields: Record<number, number>;
  units?: number;
  w1?: number;
  w2?: number;
}

function runScript(lines: string[], opts: { trusted?: boolean | (() => boolean); ax?: () => boolean; clock?: number[]; scroll2?: boolean; ownPid?: number; windows?: Array<Record<string, unknown>> } = {}) {
  const posted: Posted[] = [];
  const said: string[] = [];
  const typed: string[] = [];
  const data = (b: Buffer) => ({ bytes: b, length: b.length, base64EncodedStringWithOptions: () => ({ js: b.toString('base64') }) });
  let stdin: Buffer | null = Buffer.from(lines.map((l) => `${l}\n`).join(''), 'utf8');
  const bridge = Object.assign((s: string) => ({ js: String(s), dataUsingEncoding: () => data(Buffer.from(String(s), 'utf8')) }), {
    CGPreflightPostEventAccess: () => (typeof opts.trusted === 'function' ? opts.trusted() : opts.trusted !== false),
    AXIsProcessTrusted: () => (opts.ax ? opts.ax() : true),
    NSUTF8StringEncoding: 4,
    NSFileHandle: {
      fileHandleWithStandardOutput: { writeData: (d: { bytes: Buffer }) => said.push(d.bytes.toString('utf8').trimEnd()) },
      fileHandleWithStandardInput: {
        get availableData() {
          const d = stdin ?? Buffer.alloc(0);
          stdin = null;
          return data(d);
        },
      },
    },
    NSString: { alloc: { initWithDataEncoding: (d: { bytes: Buffer }) => ({ js: d.bytes.toString('utf8') }) } },
    NSData: { alloc: { initWithBase64EncodedStringOptions: (s: string) => data(Buffer.from(s, 'base64')) } },
    NSEvent: { doubleClickInterval: 0.5 },
    NSProcessInfo: { processInfo: { environment: { objectForKey: (k: string) => ({ js: k === 'WS_OWNER_PID' && opts.ownPid ? String(opts.ownPid) : undefined }) } } },
    NSWorkspace: { sharedWorkspace: { frontmostApplication: { localizedName: { js: 'Microsoft Excel' }, processIdentifier: 42 } } },
    CGPointMake: (x: number, y: number) => ({ x, y }),
    CGEventCreate: () => ({ kind: 'null', fields: {} }),
    CGEventGetLocation: () => ({ x: 500, y: 400 }),
    CGEventCreateMouseEvent: (_s: null, type: number, at: { x: number; y: number }, button: number) => ({ kind: 'mouse', type, x: at.x, y: at.y, button, fields: {} }),
    CGEventCreateKeyboardEvent: (_s: null, code: number, down: boolean) => ({ kind: 'key', code, down, fields: {} }),
    CGEventSetType: (e: Posted, t: number) => (e.type = t),
    CGEventSetIntegerValueField: (e: Posted, f: number, v: number) => (e.fields[f] = v),
    CGEventSetLocation: (e: Posted, p: { x: number; y: number }) => ((e.x = p.x), (e.y = p.y)),
    CGEventSetFlags: (e: Posted, f: number) => (e.flags = f),
    CGEventPost: (_tap: number, e: Posted) => posted.push(e),
    CGWindowListCopyWindowInfo: (opt: number, id: number) => {
      const all = opts.windows ?? [
        { kCGWindowNumber: 7, kCGWindowLayer: 25, kCGWindowOwnerPID: 1, kCGWindowAlpha: 1, kCGWindowBounds: { X: 0, Y: 0, Width: 1440, Height: 25 } },
        { kCGWindowNumber: 88, kCGWindowLayer: 0, kCGWindowOwnerPID: 9, kCGWindowAlpha: 0, kCGWindowBounds: { X: 0, Y: 0, Width: 1440, Height: 900 } },
        { kCGWindowNumber: 51, kCGWindowLayer: 0, kCGWindowOwnerPID: 42, kCGWindowAlpha: 1, kCGWindowBounds: { X: 100.4, Y: 80.6, Width: 800, Height: 600 }, kCGWindowName: 'Budget — Q3' },
      ];
      return opt === 8 ? all.filter((w) => w.kCGWindowNumber === id) : all;
    },
    ...(opts.scroll2 ? { CGEventCreateScrollWheelEvent2: (_s: null, units: number, _n: number, w1: number, w2: number) => ({ kind: 'scroll2', type: 22, units, w1, w2, fields: {} }) } : {}),
  });
  const ObjC = { import: () => undefined, castRefToObject: (r: unknown) => r, deepUnwrap: (r: unknown) => r };
  const Application = () => ({ keystroke: (s: string) => typed.push(s) });
  const times = [...(opts.clock ?? [])];
  const FakeDate = { now: () => (times.length > 1 ? times.shift()! : (times[0] ?? 0)) };
  new Function('ObjC', '$', 'Application', 'Date', `${MAC_SCRIPT}\nrun();`)(ObjC, bridge, Application, FakeDate);
  return { posted, said, typed };
}

const lines = (actions: InputAction[]) => protocolLines(actions, 'darwin');
const click = (down: boolean): InputAction => ({ t: 'button', button: 'left', down });

describe('the macOS helper script', () => {
  it('re-checks its own Accessibility and event posting each time the app asks over its pipe (worksuite-desktop#147)', () => {
    const answers = [true, true, false];
    let calls = 0;
    const { said, posted } = runScript(['?1 perm', '?2 perm'], { trusted: () => answers[calls++] ?? false, ax: () => true });
    // The first answer is the start-up check; each query asks macOS again.
    expect(calls).toBe(3);
    expect(said).toEqual(['ready', '1 {"trusted":true,"accessibility":true}', '2 {"trusted":false,"accessibility":true}']);
    expect(posted).toEqual([]);
  });
  it('does not become ready or post input after permission is revoked', () => {
    const result = runScript(['m 300 200', 'k 0 1'], { trusted: false });
    expect(result.said).toEqual(['permission-denied']);
    expect(result.posted).toEqual([]);
  });
  it('says ready, and answers the app’s questions', () => {
    const { said } = runScript(['?1 ack', '?2 rect 51', '?3 rect 99', '?4 at 500 400', '?5 at 500 10', '?6 at 1200 400', '?7 fg']);
    expect(said[0]).toBe('ready');
    expect(said.slice(1, 7)).toEqual(['1 ok', '2 100 81 800 600', '3 -', '4 51', '5 7', '6 0']);
    const [n, id, app, title] = said[7]!.split(' ');
    expect([n, id, Buffer.from(app!, 'base64').toString(), Buffer.from(title!, 'base64').toString()]).toEqual(['7', '51', 'Microsoft Excel', 'Budget — Q3']);
  });

  it('moves, and drags while a button is held', () => {
    const { posted } = runScript(lines([{ t: 'move', x: 300, y: 200 }, click(true), { t: 'move', x: 320, y: 210 }, click(false), { t: 'button', button: 'right', down: true }, { t: 'button', button: 'right', down: false }]));
    expect(posted.map((e) => `${e.type}/${e.button}@${e.x},${e.y}`)).toEqual(['5/0@300,200', '1/0@300,200', '6/0@320,210', '2/0@320,210', '3/1@320,210', '4/1@320,210']);
  });

  it('numbers the clicks of a double-click, as macOS needs to open a file with it', () => {
    const { posted } = runScript(lines([click(true), click(false), click(true), click(false), click(true), click(false)]), { clock: [1_000, 1_200, 1_400] });
    expect(posted.map((e) => e.fields[1])).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it('starts again after the double-click time, somewhere else, or with another button', () => {
    const slow = runScript(lines([click(true), click(false), click(true), click(false)]), { clock: [1_000, 1_600] });
    expect(slow.posted.map((e) => e.fields[1])).toEqual([1, 1, 1, 1]);
    const apart = runScript(lines([click(true), click(false), { t: 'move', x: 560, y: 400 }, click(true), click(false)]), { clock: [1_000, 1_100] });
    expect(apart.posted.filter((e) => e.type !== 5).map((e) => e.fields[1])).toEqual([1, 1, 1, 1]);
    const other = runScript(lines([click(true), click(false), { t: 'button', button: 'right', down: true }, { t: 'button', button: 'right', down: false }]), { clock: [1_000, 1_100] });
    expect(other.posted.map((e) => e.fields[1])).toEqual([1, 1, 1, 1]);
  });

  it('puts exactly the modifiers held on keys, and none once they are let go', () => {
    const { posted } = runScript(lines([{ t: 'key', code: 'MetaLeft', down: true }, { t: 'key', code: 'KeyC', down: true }, { t: 'key', code: 'KeyC', down: false }, { t: 'key', code: 'MetaLeft', down: false }, { t: 'key', code: 'KeyV', down: true }]));
    expect(posted.map((e) => [e.code, e.down, e.flags])).toEqual([[55, true, 0x100000], [8, true, 0x100000], [8, false, 0x100000], [55, false, 0], [9, true, 0]]);
  });

  it('scrolls in lines, down as negative, a small scroll still one line — the system’s own event where there is one', () => {
    const wheel = lines([{ t: 'wheel', dx: 0, dy: 240 }, { t: 'wheel', dx: -120, dy: 0 }, { t: 'wheel', dx: 10, dy: 0 }]);
    const made = runScript(wheel, { scroll2: true }).posted;
    expect(made.map((e) => [e.kind, e.units, e.w1, e.w2, e.x, e.y])).toEqual([['scroll2', 1, -6, 0, 500, 400], ['scroll2', 1, 0, 3, 500, 400], ['scroll2', 1, 0, -1, 500, 400]]);
    const built = runScript(wheel).posted;
    expect(built.map((e) => [e.type, e.fields[11], e.fields[12]])).toEqual([[22, -6, 0], [22, 0, 3], [22, 0, -1]]);
  });

  it('looks past WorkSuite’s own capture-proof windows (the name tag) for what a click is aimed at, not past its others', () => {
    const win = (n: number, pid: number, sharing: number) => ({ kCGWindowNumber: n, kCGWindowLayer: 0, kCGWindowOwnerPID: pid, kCGWindowAlpha: 1, kCGWindowSharingState: sharing, kCGWindowBounds: { X: 0, Y: 0, Width: 1000, Height: 800 } });
    const tagOverShared = [win(90, 700, 0), win(51, 42, 1)];
    expect(runScript(['?1 at 500 400'], { ownPid: 700, windows: tagOverShared }).said[1]).toBe('1 51');
    // Another app's protected window is never looked past; nor WorkSuite's meeting window, which is captured.
    expect(runScript(['?1 at 500 400'], { ownPid: 700, windows: [win(90, 333, 0), win(51, 42, 1)] }).said[1]).toBe('1 90');
    expect(runScript(['?1 at 500 400'], { ownPid: 700, windows: [win(91, 700, 1), win(51, 42, 1)] }).said[1]).toBe('1 91');
    expect(runScript(['?1 at 500 400'], { windows: tagOverShared }).said[1]).toBe('1 90');
  });

  it('types text through System Events as it was written', () => {
    expect(runScript(lines([{ t: 'text', text: 'Olá 😀' }])).typed).toEqual(['Olá 😀']);
  });
});
