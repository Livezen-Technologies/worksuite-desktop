import { screen, type BrowserWindow, type Rectangle } from 'electron';
import type { GrantedSource } from './screen-share';
import { logger } from '../main/log';
import type { ShareBarState } from '@shared/share-bar';

export type { ShareBarState };

const log = logger('share-bar');

/**
 * The sharing bar (WS-MEET-ENH-01 D03): a strip at the top of the screen you
 * are sharing, saying what is being shared and for how long, with the controls
 * you reach for while presenting — mute, the camera, the chat, pause, stop.
 *
 * It exists because the call window is behind whatever you are showing. Until
 * now, stopping a share meant finding that window again, and people solved
 * that by not sharing.
 *
 * Three things it must get right:
 *
 *  - **Never appear in the capture.** The window is content-protected, like
 *    the share outline beside it. A bar drawn over the thing somebody is
 *    presenting would be worse than no bar.
 *  - **Follow the screen being shared**, not the main display: sharing the
 *    external monitor puts the bar on the external monitor.
 *  - **Say nothing it does not know.** No state until the meeting has sent
 *    some, so the bar never shows a microphone as live that is muted.
 */

export interface ShareBarDeps {
  /** Opens the bar's own window; the manager's `openRemote`. */
  open: (hash: string, bounds: Rectangle) => BrowserWindow;
  /** Pushes state into the bar's window. */
  send: (win: BrowserWindow, state: ShareBarState | null) => void;
  /** Where the bar should sit, given the screen being shared. */
  place?: (source: GrantedSource) => Rectangle;
}

const WIDTH = 620;
const HEIGHT = 56;
/** Clear of a Mac's menu bar and a Windows taskbar at the top. */
const TOP_GAP = 14;

/** The bar's place: centred at the top of the display being shared, else the primary one. */
export function barBounds(source: GrantedSource | null, displays: Electron.Display[], primary: Electron.Display): Rectangle {
  const target = (source?.displayId && displays.find((d) => String(d.id) === source.displayId)) || primary;
  const area = target.workArea;

  return {
    x: Math.round(area.x + (area.width - WIDTH) / 2),
    y: Math.round(area.y + TOP_GAP),
    width: WIDTH,
    height: HEIGHT,
  };
}

export class ShareBar {
  private win: BrowserWindow | null = null;
  private owner: number | null = null;
  private state: ShareBarState | null = null;

  constructor(private readonly deps: ShareBarDeps) {}

  /**
   * A share began in the page `owner`. One bar at a time: a second share from
   * another window replaces it, because there is one screen to show it on.
   */
  start(owner: number, source: GrantedSource): void {
    if (this.owner === owner && this.win && !this.win.isDestroyed()) {
      // The same page shared something else: the bar stays, its place follows.
      this.move(source);

      return;
    }
    this.stop();
    this.owner = owner;

    try {
      const win = this.deps.open('/share/bar', this.bounds(source));

      this.win = win;
      win.on('closed', () => {
        if (this.win === win) {
          this.win = null;
          this.owner = null;
          this.state = null;
        }
      });
    } catch (e) {
      // A bar that cannot open must never stop a share: the call window still
      // has every one of these controls.
      log.warn('sharing bar did not open', { error: String(e) });
      this.win = null;
      this.owner = null;
    }
  }

  /** The share ended, the window closed, or the person signed out. */
  stop(owner?: number): void {
    if (owner !== undefined && this.owner !== owner) return;

    const win = this.win;

    this.win = null;
    this.owner = null;
    this.state = null;

    try {
      if (win && !win.isDestroyed()) win.close();
    } catch {
      /* already gone */
    }
  }

  /** What the meeting says about itself; ignored from a window that is not sharing. */
  update(owner: number, state: ShareBarState): void {
    if (this.owner !== owner || !this.win || this.win.isDestroyed()) return;

    this.state = state;

    try {
      this.deps.send(this.win, state);
    } catch (e) {
      log.debug('sharing bar state not delivered', { error: String(e) });
    }
  }

  /** The bar's window asking what it should show, once it is ready. */
  current(): ShareBarState | null {
    return this.state;
  }

  /** The page the bar belongs to: whose meeting its buttons act on. */
  sharer(): number | null {
    return this.owner;
  }

  private move(source: GrantedSource): void {
    if (!this.win || this.win.isDestroyed()) return;

    try {
      this.win.setBounds(this.bounds(source));
    } catch {
      /* a display that went away; the bar stays where it is */
    }
  }

  private bounds(source: GrantedSource): Rectangle {
    if (this.deps.place) return this.deps.place(source);

    return barBounds(source, screen.getAllDisplays(), screen.getPrimaryDisplay());
  }
}
