import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type * as ChildProcessModule from 'node:child_process';

const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async (orig) => ({ ...(await orig<typeof ChildProcessModule>()), spawn }));
import { MacInjector } from '../../../electron/services/remote-control/input';

function fakeProc() {
  const proc = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  return proc;
}

describe('the macOS input helper launch (worksuite-desktop#147)', () => {
  it('is Apple’s osascript started directly by WorkSuite — not detached, no shell — so WorkSuite is responsible for it', async () => {
    const proc = fakeProc();
    spawn.mockReturnValue(proc);
    const inj = new MacInjector();
    const started = inj.start();
    proc.stdout.write('ready\n');
    expect(await started).toBe(true);
    const [file, args, options] = spawn.mock.calls[0]!;
    expect(file).toBe('/usr/bin/osascript');
    expect(args.slice(0, 2)).toEqual(['-l', 'JavaScript']);
    expect(options.detached).toBeUndefined();
    expect(options.shell).toBeUndefined();
    expect(options.env.WS_OWNER_PID).toBe(String(process.pid));
  });

  it('asks the running helper to check its permission again over its pipe', async () => {
    const proc = fakeProc();
    spawn.mockReturnValue(proc);
    const inj = new MacInjector();
    const started = inj.start();
    proc.stdout.write('ready\n');
    await started;
    const written: string[] = [];
    proc.stdin.on('data', (d: Buffer) => written.push(d.toString()));
    const answer = inj.permission();
    await vi.waitFor(() => expect(written.join('')).toMatch(/^\?(\d+) perm\n$/));
    const n = /^\?(\d+)/.exec(written.join(''))![1];
    proc.stdout.write(`${n} {"trusted":true,"accessibility":true}\n`);
    expect(await answer).toEqual({ trusted: true, accessibility: true, error: null, source: 'injector' });
  });

  it('has no answer when the helper is not running', async () => {
    expect(await new MacInjector().permission()).toBeNull();
  });
});
