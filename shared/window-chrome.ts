/**
 * The macOS title bars' geometry (#424), shared by the main process (where the traffic lights are placed) and the
 * renderer (which leaves them room). The main window's bar is 52 px tall, every other window's 40 px; the traffic
 * lights are centred in the bar they sit in, and the bar's own content starts a fixed gap after the last of them.
 */
export const MAC_TRAFFIC_LIGHTS = {
  /** The three buttons as macOS draws them: 12 px each with 8 px between them, so 52 px from the first to the last. */
  height: 14,
  width: 52,
  /** From the window's left edge to the first button. */
  inset: 14,
  /** From the last button to the bar's content. */
  gap: 16,
} as const;

export const BAR_HEIGHT = { main: 52, secondary: 40 } as const;

/** The height of a window's own title bar. */
export function barHeightFor(kind: string): number {
  return kind === 'main' ? BAR_HEIGHT.main : BAR_HEIGHT.secondary;
}

/** Where the traffic lights go in a window of this kind: vertically centred in its bar. */
export function trafficLightPositionFor(kind: string): { x: number; y: number } {
  const bar = barHeightFor(kind);
  const inset = kind === 'main' ? 20 : MAC_TRAFFIC_LIGHTS.inset;
  return { x: inset, y: Math.round((bar - MAC_TRAFFIC_LIGHTS.height) / 2) };
}

/** The room a bar leaves on its left for the traffic lights; none in full screen, where macOS hides them. */
export function macBarInsetFor(kind: string, fullScreen = false): number {
  if (fullScreen) return kind === 'main' ? 14 : 12;
  return trafficLightPositionFor(kind).x + MAC_TRAFFIC_LIGHTS.width + MAC_TRAFFIC_LIGHTS.gap;
}
