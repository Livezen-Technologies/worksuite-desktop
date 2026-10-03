import { BrowserWindow, desktopCapturer, systemPreferences, webContents, type Session } from 'electron';
import type { ScreenSources } from '@shared/types';
import { logger } from '../main/log';
import { ShareOutline } from './share-outline';
import { DesktopError } from '../main/errors';

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
  private readonly outline = new ShareOutline();

  /** The pages sharing their screen now: update notices wait until they stop (worksuite-desktop#205). */
  private sharing = new Set<number>();
  onSharingChanged: (sharing: boolean) => void = () => undefined;

  indicate(webContentsId: number, active: boolean): void {
    const source = this.granted.get(webContentsId);
    if (active && source) this.outline.start(webContentsId, source);
    else this.outline.stop(webContentsId);
    const before = this.sharing.size > 0;
    if (active && !this.sharing.has(webContentsId)) {
      this.sharing.add(webContentsId);
      // A window that closes mid-share ends its share.
      try {
        webContents.fromId(webContentsId)?.once('destroyed', () => this.indicate(webContentsId, false));
      } catch {
        /* not a live page (tests) */
      }
    } else if (!active) this.sharing.delete(webContentsId);
    if (before !== this.sharing.size > 0) this.onSharingChanged(this.sharing.size > 0);
  }

  isSharing(): boolean {
    return this.sharing.size > 0;
  }

  private previousPermission: string | null = null;
  private permissionProblem: string | null = null;
  private generations = new Map<number, number>();
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
    const changedToGranted = this.previousPermission === 'denied' && permission === 'granted';
    this.previousPermission = permission;
    const permissionStatus = platform !== 'darwin' ? 'not_required' as const : permission === 'granted' ? 'granted' as const : permission === 'denied' || permission === 'restricted' ? 'denied' as const : 'unknown' as const;
    const permissionProblem = this.permissionProblem;
    if (permission === 'denied' || permission === 'restricted') {
      log.info('screen sources: permission off', { permission });
      return { permission, sources: [], state: 'denied', problem: null, restartMayHelp: false, platform, permissionStatus, permissionProblem };
    }
    const ask = (types: Array<'screen' | 'window'>) => this.getSources(types, true);
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
    // A failed or empty list alone is not evidence for restart. Require an observed permission transition.
    const restartMayHelp = platform === 'darwin' && changedToGranted && (state === 'failed' || !sources.some((x) => x.kind === 'screen'));
    log.info('screen sources', {
      platform,
      permission,
      state,
      screens: screens.status === 'fulfilled' ? screens.value.length : -1,
      windows: windows.status === 'fulfilled' ? windows.value.length : -1,
      error: failed[0] ?? null,
    });
    return { permission, sources, state, problem: failed[0] ?? null, restartMayHelp, platform, permissionStatus, permissionProblem };
  }

  private permission(): string {
    this.permissionProblem = null;
    try {
      return systemPreferences.getMediaAccessStatus('screen');
    } catch {
      this.permissionProblem = 'The running app could not verify Screen Recording access.';
      return 'unknown';
    }
  }

  /** Bound native discovery so a hung OS callback cannot leave the picker or capture waiting forever. */
  private getSources(types: Array<'screen' | 'window'>, thumbnails = false): Promise<Electron.DesktopCapturerSource[]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Screen source discovery timed out. Check again.')), 10_000);
      timer.unref?.();
      try {
        this.capturer.getSources({ types, thumbnailSize: { width: thumbnails ? 320 : 0, height: thumbnails ? 200 : 0 }, fetchWindowIcons: false }).then(resolve, reject).finally(() => clearTimeout(timer));
      } catch (error) { clearTimeout(timer); reject(error); }
    });
  }

  /** Revalidate the selected kind before requesting media, yielding a specific IPC error instead of Chromium's generic rejection. */
  async preparePick(webContentsId: number, id: string, audio = false): Promise<void> {
    this.forget(webContentsId);
    const generation = this.generations.get(webContentsId);
    const kind = id.startsWith('screen:') ? 'screen' : id.startsWith('window:') ? 'window' : null;
    if (!kind) throw new DesktopError('IPC_VALIDATION_FAILED', 'Choose a screen or window from the sharing picker.');
    const permission = process.platform === 'darwin' ? this.permission() : 'granted';
    if (permission === 'denied' || permission === 'restricted') throw new DesktopError('PERMISSION_DENIED', 'Screen Recording access is denied for the running WorkSuite app. Open Privacy & Security → Screen Recording / Screen & System Audio Recording, then check again. Accessibility is separate.');
    let sources: Electron.DesktopCapturerSource[];
    try { sources = await this.getSources([kind]); }
    catch (e) { throw new DesktopError('INTERNAL', `The selected ${kind} could not be discovered: ${e instanceof Error ? e.message : String(e)}`); }
    if (this.generations.get(webContentsId) !== generation) throw new DesktopError('CANCELLED', 'Screen selection changed. Choose again.');
    if (!sources.some((source) => source.id === id) || this.ownSources().includes(id)) throw new DesktopError('NOT_FOUND', 'The selected screen or window is no longer available. Refresh the sharing picker and choose again.');
    this.pick(webContentsId, id, audio);
  }

  /**
   * `audio`: the computer's sound goes with the picture. Only Windows can
   * capture it (Chromium's "loopback"); elsewhere it is ignored, and the
   * picker does not offer it.
   */
  pick(webContentsId: number, id: string, audio = false): void {
    this.generations.set(webContentsId, (this.generations.get(webContentsId) ?? 0) + 1);
    this.picks.set(webContentsId, { id, at: Date.now(), audio });
    this.chosenHere.delete(webContentsId);
  }

  /** Remote control's monitor switch: this process picks the next screen for the page, not the person. */
  pickForController(webContentsId: number, id: string): void {
    this.pick(webContentsId, id, false);
    this.chosenHere.set(webContentsId, id);
  }

  /** What the page was last given to capture, and whether this process (not the person) chose it. */
  lastGranted(webContentsId: number): { source: GrantedSource; byController: boolean } | null {
    const source = this.granted.get(webContentsId);
    return source ? { source, byController: this.chosenHere.get(webContentsId) === source.id } : null;
  }

  forget(webContentsId: number): void {
    this.outline.stop(webContentsId);
    this.generations.set(webContentsId, (this.generations.get(webContentsId) ?? 0) + 1);
    this.picks.delete(webContentsId);
    this.granted.delete(webContentsId);
    this.chosenHere.delete(webContentsId);
  }

  /** The screens, in the order the system lists them, for "Screen 2" when a controller switches. */
  async screens(): Promise<Array<{ id: string; name: string }>> {
    const list = await this.getSources(['screen']);
    return list.map((s) => ({ id: s.id, name: s.name }));
  }

  install(ses: Session): void {
    ses.setDisplayMediaRequestHandler((request, callback) => {
      const wc = request.frame ? webContents.fromFrame(request.frame) : undefined;
      const generation = wc ? this.generations.get(wc.id) : undefined;
      const pick = wc ? this.picks.get(wc.id) : undefined;
      if (wc) { this.picks.delete(wc.id); this.granted.delete(wc.id); }
      const url = request.frame?.url ?? wc?.getURL() ?? '';
      if (!wc || !pick || Date.now() - pick.at > PICK_TTL || !this.trusted(url)) {
        log.info('display capture refused', { picked: !!pick, url });
        callback({});
        return;
      }
      void this.getSources([pick.id.startsWith('screen:') ? 'screen' : 'window']).then(
        (all) => {
          if (this.generations.get(wc.id) !== generation || wc.isDestroyed?.() || !this.trusted(wc.getURL()) || wc.getURL() !== url) { callback({}); return; }
          const permission = process.platform === 'darwin' ? this.permission() : 'granted';
          const source = permission === 'denied' || permission === 'restricted' ? undefined : all.find((s) => s.id === pick.id && !this.ownSources().includes(s.id));
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
        (error) => { log.warn('capture source discovery failed', { error: error instanceof Error ? error.message : String(error) }); callback({}); },
      );
    });
  }
}
