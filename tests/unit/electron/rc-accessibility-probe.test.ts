import { beforeEach, expect, it, vi } from 'vitest';
const exec = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: exec }));
import { askHelper } from '../../../electron/services/remote-control/accessibility';
beforeEach(() => { exec.mockReset(); });
it('records Accessibility and event posting independently without injecting input', async () => {
  exec.mockImplementation((_file, args, _options, done) => {
    expect(args.join(' ')).not.toContain('CGEventPost(');
    done(null, '{"trusted":false,"accessibility":true}');
  });
  expect(await askHelper()).toEqual({ trusted: false, accessibility: true, error: null });
});
it('records malformed native output as unknown', async () => {
  exec.mockImplementation((_file, _args, _options, done) => done(null, 'unexpected'));
  expect(await askHelper()).toMatchObject({ trusted: null, accessibility: null, error: expect.stringContaining('invalid response') });
});
it('records a timed-out native check as unknown', async () => {
  exec.mockImplementation((_file, _args, _options, done) => done({ killed: true }, 'false'));
  expect(await askHelper()).toMatchObject({ trusted: null, error: expect.stringContaining('timed out') });
});
