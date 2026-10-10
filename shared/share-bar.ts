/**
 * What the sharing bar shows (WS-MEET-ENH-01 D03).
 *
 * Here rather than beside the service because three places read it: the
 * meeting's window, which reports it; the main process, which keeps the
 * latest; and the bar's own window, which draws it.
 */
export interface ShareBarState {
  /** The window or screen being shared, by the name the picker gave it. */
  label: string;
  /** Sharing is paused: the others see "Screen sharing paused". */
  paused: boolean;
  micOn: boolean;
  cameraOn: boolean;
  /** Messages in the meeting's chat nobody in that window has read. */
  unreadChat: number;
  /** When the share started, for the bar's clock. */
  since: number;
}

/** The bar's buttons, as the meeting's window answers them. */
export type ShareBarAction = 'meet-mute' | 'meet-camera' | 'meet-chat' | 'meet-pause-share' | 'meet-stop-share';
