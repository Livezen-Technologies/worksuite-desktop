import { BrowserWindow, desktopCapturer, systemPreferences, webContents, type Session } from 'electron';
import type { ScreenSources } from '@shared/types';
import { logger } from '../main/log';

const log = logger('screen-share');

/** A choice is good for one request, made within this long of picking. */
const PICK_TTL = 60_000;

/**
 * Screen sharing (FR-COM-05). The page never gets a capture of its own
 * choosing: it lists the screens and windows, the person picks one in our
 * picker, and only then does a display-media request from that same page
 * receive exactly that source — once.
 */
/** What a page was actually given to capture: the source, and the display a screen is. */
export interface GrantedSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  displayId: string | null;
  /** The window's id in the system's terms (an HWND, a CGWindowID, an X window). */
  windowId: string | null;
  at: number;
}

export class ScreenShare {
  private picks = new Map<number, { id: string; at: number; audio: boolean }>();
  private granted = new Map<number, GrantedSource>();
  /** A source picked by this process rather than the person (a controller switching screens). */
  private chosenHere = new Map<number, string>();

  constructor(
    private readonly trusted: (url: string) => boolean,
    /** The capturer (a test gives its own), and this app's own windows' media ids, which are never offered. */
    private readonly capturer: Pick<typeof desktopCapturer, 'getSources'> = desktopCapturer,
    private readonly ownSources: () => string[] = () => BrowserWindow.getAllWindows().map((w) => { try { return w.getMediaSourceId(); } catch { return ''; } }).filter(Boolean),
  ) {}

  /**
   * The screens and windows to choose from, and — when there are none — why (worksuite-desktop#70). Screens and
   * windows are asked for separately, so a window list the system refuses does not take the screens with it; a
   * Screen Recording permission that is off is said as that, not as an error. Only this process's own windows are
   * left out. What is logged is counts and the system's error, never names or pictures.
   */
  async sources(): Promise<ScreenSources> {
    const platform = process.platform;
    const permission = platform === 'darwin' ? this.permission() : 'granted';
    if (permission === 'denied' || permission === 'restricted') {
      log.info('screen sources: permission off', { permission });
      return { permission, sources: [], state: 'denied', problem: null, restartMayHelp: true, platform };
    }
    const ask = (types: Array<'screen' | 'window'>) => this.capturer.getSources({ types, thumbnailSize: { width: 320, height: 200 }, fetchWindowIcons: false });
    const [screens, windows] = await Promise.allSettled([ask(['screen']), ask(['window'])]);
    const own = new Set(this.ownSources());
    const shape = (list: Electron.DesktopCapturerSource[], kind: 'screen' | 'window') =>
      list
        .filter((s) => s.name && !own.has(s.id) && !(kind === 'window' && s.name === 'WorkSuite'))
        .map((s) => ({ id: s.id, name: s.name, kind, thumbnail: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : null }));
    const sources = [...(screens.status === 'fulfilled' ? shape(screens.value, 'screen') : []), ...(windows.status === 'fulfilled' ? shape(windows.value, 'window') : [])];
    const why = (r: PromiseSettledResult<unknown>) => (r.status === 'rejected' ? (r.reason instanceof Error ? r.reason.message : String(r.reason)) : null);
    const failed = [why(screens), why(windows)].filter(Boolean) as string[];
    const state: ScreenSources['state'] = failed.length === 2 ? 'failed' : failed.length ? 'partial' : 'ok';
    // No screen at all on a Mac is the permission not yet in effect: macOS applies it to a newly started app.
    const restartMayHelp = platform === 'darwin' && (state === 'failed' || !sources.some((x) => x.kind === 'screen'));
    log.info('screen sources', {
      platform,
      permission,
      state,
      screens: screens.status === 'fulfilled' ? screens.value.length : -1,
      windows: windows.status === 'fulfilled' ? windows.value.length : -1,
      error: failed[0] ?? null,
    });
    return { permission, sources, state, problem: failed[0] ?? null, restartMayHelp, platform };
  }

  private permission(): string {
    try {
      return systemPreferences.getMediaAccessStatus('screen');
    } catch {
      return 'unknown';
    }
  }

  /**
   * `audio`: the computer's sound goes with the picture. Only Windows can
   * capture it (Chromium's "loopback"); elsewhere it is ignored, and the
   * picker does not offer it.
   */
  pick(webContentsId: number, id: string, audio = false): void {
    this.picks.set(webContentsId, { id, at: Date.now(), audio });
    this.chosenHere.delete(webContentsId);
  }

  /** Remote control's monitor switch: this process picks the next screen for the page, not the person. */
  pickForController(webContentsId: number, id: string): void {
    this.picks.set(webContentsId, { id, at: Date.now(), audio: false });
    this.chosenHere.set(webContentsId, id);
  }

  /** What the page was last given to capture, and whether this process (not the person) chose it. */
  lastGranted(webContentsId: number): { source: GrantedSource; byController: boolean } | null {
    const source = this.granted.get(webContentsId);
    return source ? { source, byController: this.chosenHere.get(webContentsId) === source.id } : null;
  }

  forget(webContentsId: number): void {
    this.picks.delete(webContentsId);
    this.granted.delete(webContentsId);
    this.chosenHere.delete(webContentsId);
  }

  /** The screens, in the order the system lists them, for "Screen 2" when a controller switches. */
  async screens(): Promise<Array<{ id: string; name: string }>> {
    const list = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    return list.map((s) => ({ id: s.id, name: s.name }));
  }

  install(ses: Session): void {
    ses.setDisplayMediaRequestHandler((request, callback) => {
      const wc = request.frame ? webContents.fromFrame(request.frame) : undefined;
      const pick = wc ? this.picks.get(wc.id) : undefined;
      if (wc) this.picks.delete(wc.id);
      const url = request.frame?.url ?? wc?.getURL() ?? '';
      if (!wc || !pick || Date.now() - pick.at > PICK_TTL || !this.trusted(url)) {
        log.info('display capture refused', { picked: !!pick, url });
        callback({});
        return;
      }
      void desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } }).then(
        (all) => {
          const source = all.find((s) => s.id === pick.id);
          if (!source) log.info('picked source is gone', { id: pick.id });
          else {
            const kind = source.id.startsWith('screen:') ? ('screen' as const) : ('window' as const);
            this.granted.set(wc.id, {
              id: source.id,
              name: source.name,
              kind,
              displayId: kind === 'screen' ? source.display_id || null : null,
              windowId: kind === 'window' ? (/^window:(\d+):/.exec(source.id)?.[1] ?? null) : null,
              at: Date.now(),
            });
          }
          callback(source ? { video: source, ...(pick.audio && process.platform === 'win32' ? { audio: 'loopback' as const } : {}) } : {});
        },
        () => callback({}),
      );
    });
  }
}
