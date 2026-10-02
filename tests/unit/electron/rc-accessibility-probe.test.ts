import { beforeEach, expect, it, vi } from 'vitest';
const exec = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: exec }));
import { askHelper, askRunningHelper, parsePermission, stopProbes } from '../../../electron/services/remote-control/accessibility';
beforeEach(() => { exec.mockReset(); });
it('records Accessibility and event posting independently without injecting input', async () => {
  exec.mockImplementation((_file, args, _options, done) => {
    expect(args.join(' ')).not.toContain('CGEventPost(');
    done(null, '{"trusted":false,"accessibility":true}');
  });
  expect(await askHelper()).toEqual({ trusted: false, accessibility: true, error: null, source: 'probe' });
});
it('starts the helper directly — Apple’s osascript, no shell — so macOS attributes it to WorkSuite', async () => {
  exec.mockImplementation((_file, _args, _options, done) => done(null, '{"trusted":true,"accessibility":true}'));
  await askHelper();
  const [file, args, options] = exec.mock.calls[0]!;
  expect(file).toBe('/usr/bin/osascript');
  expect(args.slice(0, 2)).toEqual(['-l', 'JavaScript']);
  expect(options).toMatchObject({ shell: false, timeout: 4_000, env: expect.objectContaining({ WS_OWNER_PID: String(process.pid) }) });
  expect(options.detached).toBeUndefined();
});
it('asks a new helper process on every check', async () => {
  exec.mockImplementation((_file, _args, _options, done) => done(null, '{"trusted":true,"accessibility":true}'));
  await askHelper();
  await askHelper();
  expect(exec).toHaveBeenCalledTimes(2);
});
it('records malformed native output as unknown', async () => {
  exec.mockImplementation((_file, _args, _options, done) => done(null, 'unexpected'));
  expect(await askHelper()).toMatchObject({ trusted: null, accessibility: null, error: expect.stringContaining('invalid response') });
});
it('records a timed-out native check as unknown', async () => {
  exec.mockImplementation((_file, _args, _options, done) => done({ killed: true }, 'false'));
  expect(await askHelper()).toMatchObject({ trusted: null, error: expect.stringContaining('timed out') });
});
it('ends helper processes still answering when WorkSuite restarts', () => {
  const kill = vi.fn();
  exec.mockImplementation(() => ({ kill }));
  void askHelper();
  stopProbes();
  expect(kill).toHaveBeenCalled();
});

it('asks the running input helper over its pipe when control is live', async () => {
  const probe = vi.fn();
  const permission = vi.fn(async () => ({ trusted: true, accessibility: true, error: null, source: 'injector' as const }));
  expect(await askRunningHelper(() => ({ permission }), probe)).toMatchObject({ trusted: true, source: 'injector' });
  expect(permission).toHaveBeenCalledTimes(1);
  expect(probe).not.toHaveBeenCalled();
});
it('starts a new helper to ask when none is running, or the running one does not answer', async () => {
  const probe = vi.fn(async () => ({ trusted: false, accessibility: false, error: null, source: 'probe' as const }));
  expect(await askRunningHelper(() => null, probe)).toMatchObject({ source: 'probe' });
  expect(await askRunningHelper(() => ({ permission: async () => null }), probe)).toMatchObject({ source: 'probe' });
  expect(await askRunningHelper(() => ({ permission: () => Promise.reject(new Error('gone')) }), probe)).toMatchObject({ source: 'probe' });
  expect(probe).toHaveBeenCalledTimes(3);
});
it('parses the helper’s answer strictly', () => {
  expect(parsePermission('{"trusted":true,"accessibility":false}', 'injector')).toEqual({ trusted: true, accessibility: false, error: null, source: 'injector' });
  expect(parsePermission('{"trusted":"yes"}', 'injector')).toMatchObject({ trusted: null, accessibility: null });
});
