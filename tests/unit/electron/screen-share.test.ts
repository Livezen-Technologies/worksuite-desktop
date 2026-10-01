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
  webContents: { fromFrame: () => undefined },
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
    expect(r).toMatchObject({ state: 'denied', permission: 'denied', restartMayHelp: true });
    expect(get).not.toHaveBeenCalled();
  });

  it('on a Mac, no screen at all after allowing it suggests a restart', async () => {
    onPlatform('darwin');
    const r = await share(async (t) => (t[0] === 'screen' ? [] : [src('window:10:0', 'Notes')])).sources();
    expect(r.state).toBe('ok');
    expect(r.restartMayHelp).toBe(true);
  });
});
