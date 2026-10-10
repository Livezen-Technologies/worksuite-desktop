/**
 * The call window's UI state (CallUIState): one store for the whole call
 * surface — full screen, the layout, the side panel, the picture-in-picture
 * box, the controls, self view, the floating card — so no component keeps a
 * copy of its own. Media state (tracks, mute, sharing) stays in the session;
 * nothing here ever touches a track, so opening Chat or going full screen
 * only moves boxes around.
 *
 * What a person would expect to find again next call is kept in
 * localStorage: the panel's width (`call_side_panel_width`), where the PiP
 * sits and how big, the layout they chose, self view, mirroring and fit.
 */
import { call } from '../../../core/bridge';
export type LayoutMode = 'auto' | 'focus' | 'side' | 'grid';
export type PipCorner = 'tl' | 'tr' | 'bl' | 'br';
export type Fit = 'fill' | 'fit';

export interface CallUIState {
  fullscreen: boolean;
  layoutMode: LayoutMode;
  panelOpen: boolean;
  panelTab: string;
  panelWidth: number;
  pipEnabled: boolean;
  pipCorner: PipCorner;
  pipWidth: number;
  controlsVisible: boolean;
  selfView: boolean;
  mirror: boolean;
  fit: Fit;
  floating: boolean;
  /** The meeting's whiteboard on the main stage instead of in the panel. */
  boardOnStage: boolean;
  stripCollapsed: boolean;
  /** Reserved for remote control (Meet ENH-01): the layout keeps the camera visible while it runs. */
  remoteControl: 'off' | 'requested' | 'active';
}

export const PANEL_MIN = 320;
export const PANEL_MAX = 600;
export const PIP_MIN = 160;
export const PIP_MAX = 480;

const KEYS = {
  panelWidth: 'call_side_panel_width',
  pip: 'call_pip',
  layout: 'call_layout',
  selfView: 'call_self_view',
  mirror: 'call_mirror',
  fit: 'call_fit',
} as const;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* a private window, or storage off: the preference lasts this call */
  }
}

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function initial(): CallUIState {
  const pip = (() => {
    try {
      const p = JSON.parse(read(KEYS.pip) ?? 'null') as { corner?: PipCorner; width?: number } | null;
      return { corner: p?.corner && ['tl', 'tr', 'bl', 'br'].includes(p.corner) ? p.corner : ('tr' as PipCorner), width: clamp(Number(p?.width) || 240, PIP_MIN, PIP_MAX) };
    } catch {
      return { corner: 'tr' as PipCorner, width: 240 };
    }
  })();
  const layout = read(KEYS.layout);
  return {
    fullscreen: false,
    layoutMode: layout === 'focus' || layout === 'side' || layout === 'grid' ? layout : 'auto',
    panelOpen: false,
    panelTab: 'Chat',
    panelWidth: clamp(Number(read(KEYS.panelWidth)) || 360, PANEL_MIN, PANEL_MAX),
    pipEnabled: true,
    pipCorner: pip.corner,
    pipWidth: pip.width,
    controlsVisible: true,
    selfView: read(KEYS.selfView) !== '0',
    mirror: read(KEYS.mirror) !== '0',
    fit: read(KEYS.fit) === 'fit' ? 'fit' : 'fill',
    floating: false,
    boardOnStage: false,
    stripCollapsed: false,
    remoteControl: 'off',
  };
}

class CallUIStore {
  private state: CallUIState = initial();
  private listeners = new Set<() => void>();

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  get = (): CallUIState => this.state;

  set(patch: Partial<CallUIState>): void {
    const next = { ...this.state, ...patch };
    if (patch.panelWidth !== undefined) next.panelWidth = clamp(patch.panelWidth, PANEL_MIN, PANEL_MAX);
    if (patch.pipWidth !== undefined) next.pipWidth = clamp(patch.pipWidth, PIP_MIN, PIP_MAX);
    this.state = next;
    if (patch.panelWidth !== undefined) write(KEYS.panelWidth, String(next.panelWidth));
    if (patch.pipCorner !== undefined || patch.pipWidth !== undefined) write(KEYS.pip, JSON.stringify({ corner: next.pipCorner, width: next.pipWidth }));
    if (patch.layoutMode !== undefined) write(KEYS.layout, next.layoutMode);
    if (patch.selfView !== undefined) write(KEYS.selfView, next.selfView ? '1' : '0');
    if (patch.mirror !== undefined) write(KEYS.mirror, next.mirror ? '1' : '0');
    if (patch.fit !== undefined) write(KEYS.fit, next.fit);
    for (const fn of this.listeners) fn();
  }

  /**
   * Shrink the call to a card that floats over other apps, or put it back —
   * the design's "Pop out" (WS-MEET-ENH-01 D02), which the call header has had
   * as the floating card and D06 gave a key.
   *
   * One implementation, because the window and this store have to agree: the
   * main process decides whether the window could be shrunk and answers with
   * what it did, and that answer is what is stored. Full screen and a floating
   * card are mutually exclusive, so full screen goes first.
   */
  float(value: boolean): void {
    if (value && typeof document !== 'undefined' && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    void call('windows:setCompact', { value, shape: 'card' }).then(
      (v) => this.set({ floating: typeof v === 'boolean' ? v : value }),
      () => undefined,
    );
  }

  /** Open the panel on a tab, or close it when that tab is already showing. */
  togglePanel(tab: string): void {
    if (this.state.panelOpen && this.state.panelTab === tab) this.set({ panelOpen: false });
    else this.set({ panelOpen: true, panelTab: tab });
  }
}

/** The one store for this window's call surface. */
export const callUi = new CallUIStore();
