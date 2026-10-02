import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Listing what can be shared (worksuite-desktop#70): screens and windows asked for separately, a permission that is
 * off said as that, a failure said as that with the system's words, this app's own windows left out.
 */
const access = { status: 'granted' };
vi.mock('electron', () => ({
  desktopCapturer: { getSources: vi.fn() },
  systemPreferences: { getMediaAccessStatus: () => access.status },
  BrowserWindow: { getAllWindows: () => [] },
  webContents: { fromFrame: vi.fn() },
}));
vi.mock('../../../electron/main/log', () => ({ logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

const { ScreenShare } = await import('../../../electron/services/screen-share');

const thumb = (empty = false) => ({ isEmpty: () => empty, toDataURL: () => 'data:image/png;base64,AAAA' });
const src = (id: string, name: string) => ({ id, name, thumbnail: thumb(), display_id: '', appIcon: null });
const realPlatform = process.platform;
const onPlatform = (p: string) => Object.defineProperty(process, 'platform', { value: p });
afterEach(() => {
  onPlatform(realPlatform);
  access.status = 'granted';
});

function share(get: (types: string[]) => Promise<unknown[]>, own: string[] = []) {
  return new ScreenShare(() => true, { getSources: (o: { types: string[] }) => get(o.types) } as never, () => own);
}

describe('what there is to share', () => {
  it('lists screens and windows, with pictures, leaving out this app’s own windows', async () => {
    const s = share(async (t) => (t[0] === 'screen' ? [src('screen:1:0', 'Screen 1'), src('screen:2:0', 'Screen 2')] : [src('window:10:0', 'Report.docx — Word'), src('window:11:0', 'WorkSuite Meet'), src('window:12:0', '')]), ['window:11:0']);
    const r = await s.sources();
    expect(r.state).toBe('ok');
    expect(r.sources.map((x) => [x.kind, x.name])).toEqual([['screen', 'Screen 1'], ['screen', 'Screen 2'], ['window', 'Report.docx — Word']]);
    expect(r.sources[0]!.thumbnail).toMatch(/^data:image\/png/);
  });

  it('a window list the system refuses does not take the screens with it', async () => {
    const r = await share(async (t) => {
      if (t[0] === 'window') throw new Error('Failed to get sources.');
      return [src('screen:1:0', 'Screen 1')];
    }).sources();
    expect(r.state).toBe('partial');
    expect(r.problem).toBe('Failed to get sources.');
    expect(r.sources.map((x) => x.name)).toEqual(['Screen 1']);
  });

  it('says it failed, and why, when nothing can be listed', async () => {
    const r = await share(async () => {
      throw new Error('Failed to get sources.');
    }).sources();
    expect(r).toMatchObject({ state: 'failed', problem: 'Failed to get sources.', sources: [] });
  });

  it('on a Mac, Screen Recording that is off is said as that, without asking the system for sources', async () => {
    onPlatform('darwin');
    access.status = 'denied';
    const get = vi.fn(async () => []);
    const r = await share(get).sources();
    expect(r).toMatchObject({ state: 'denied', permission: 'denied', restartMayHelp: false });
    expect(get).not.toHaveBeenCalled();
  });

  it('does not infer a restart requirement just from an empty screen list', async () => {
    onPlatform('darwin');
    const r = await share(async (t) => (t[0] === 'screen' ? [] : [src('window:10:0', 'Notes')])).sources();
    expect(r.state).toBe('ok');
    expect(r.restartMayHelp).toBe(false);
  });
});

it('refuses a previously picked screen if the app locks while sources are being resolved (#112)', async () => {
  const { desktopCapturer, webContents } = await import('electron');
  const wc = { id: 42, getURL: () => 'app://bundle/#/window/call' };
  vi.mocked(webContents.fromFrame).mockReturnValue(wc as never);
  let locked = false;
  let resolve!: (sources: never[]) => void;
  vi.mocked(desktopCapturer.getSources).mockImplementation(() => new Promise(r => { resolve = r; }));
  const s = new ScreenShare(() => !locked);
  let handle!: (request: never, callback: (value: unknown) => void) => void;
  s.install({ setDisplayMediaRequestHandler: (handler: typeof handle) => { handle = handler; } } as never);
  s.pick(42, 'screen:1:0');
  const reply = vi.fn();
  handle({ frame: { url: wc.getURL() } } as never, reply);
  locked = true;
  resolve([src('screen:1:0', 'Screen 1')] as never[]);
  await vi.waitFor(() => expect(reply).toHaveBeenCalledWith({}));
  expect(s.lastGranted(42)).toBeNull();
});


it('suggests restart only when denied permission becomes granted but capture stays unavailable', async () => {
  onPlatform('darwin'); access.status = 'denied';
  const s = share(async () => []);
  expect((await s.sources()).restartMayHelp).toBe(false);
  access.status = 'granted';
  expect((await s.sources()).restartMayHelp).toBe(true);
});

it('validates and grants the selected screen even when window discovery fails (#132)', async () => {
  const { webContents } = await import('electron');
  const wc = { id: 61, getURL: () => 'app://bundle/#/window/meet' };
  vi.mocked(webContents.fromFrame).mockReturnValue(wc as never);
  const asked: string[][] = [];
  const s = share(async (types) => { asked.push(types); if (types.includes('window')) throw new Error('Window discovery failed'); return [src('screen:1:0', 'Screen 1')]; });
  expect((await s.sources()).state).toBe('partial');
  await s.preparePick(wc.id, 'screen:1:0');
  let handler!: (request: never, callback: (value: unknown) => void) => void;
  s.install({ setDisplayMediaRequestHandler: (h: typeof handler) => { handler = h; } } as never);
  const reply = vi.fn(); handler({ frame: { url: wc.getURL() } } as never, reply);
  await vi.waitFor(() => expect(reply).toHaveBeenCalledWith({ video: expect.objectContaining({ id: 'screen:1:0' }) }));
  expect(asked.slice(-2)).toEqual([['screen'], ['screen']]);
  expect(s.lastGranted(wc.id)?.source.id).toBe('screen:1:0');
});

it('separates permission denial, discovery failure and a disappeared selection', async () => {
  onPlatform('darwin'); access.status = 'denied';
  const s = share(async () => []);
  await expect(s.preparePick(4, 'screen:1:0')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  access.status = 'granted';
  await expect(s.preparePick(4, 'screen:1:0')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(share(async () => { throw new Error('OS discovery failure'); }).preparePick(4, 'screen:1:0')).rejects.toThrow('OS discovery failure');
});

it('does not turn an unavailable native permission check into a denial', async () => {
  onPlatform('darwin'); access.status = 'unknown';
  const r = await share(async () => [src('screen:1:0', 'Screen 1')]).sources();
  expect(r).toMatchObject({ permissionStatus: 'unknown', state: 'ok', restartMayHelp: false });
  expect(r.sources.length).toBeGreaterThan(0);
});


it('refuses a retired capture after a new source is picked', async () => {
  const { webContents } = await import('electron');
  const wc = { id: 72, getURL: () => 'app://bundle/#/window/meet' };
  vi.mocked(webContents.fromFrame).mockReturnValue(wc as never);
  let finish!: (sources: unknown[]) => void;
  const s = share(() => new Promise((resolve) => { finish = resolve; }));
  let handler!: (request: never, callback: (value: unknown) => void) => void;
  s.install({ setDisplayMediaRequestHandler: (h: typeof handler) => { handler = h; } } as never);
  s.pick(wc.id, 'screen:1:0'); const reply = vi.fn();
  handler({ frame: { url: wc.getURL() } } as never, reply);
  s.pick(wc.id, 'screen:2:0'); finish([src('screen:1:0', 'Screen 1')]);
  await vi.waitFor(() => expect(reply).toHaveBeenCalledWith({}));
  expect(s.lastGranted(wc.id)).toBeNull();
});

it('bounds source discovery without granting capture', async () => {
  vi.useFakeTimers();
  try {
    const s = share(() => new Promise(() => {}));
    const result = s.preparePick(5, 'screen:1:0').catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toMatchObject({ code: 'INTERNAL', message: expect.stringContaining('timed out') });
    expect(s.lastGranted(5)).toBeNull();
  } finally { vi.useRealTimers(); }
});
