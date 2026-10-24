/**
 * The WorkSuite loading mark.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SAME ANIMATION AS THE LOTTIE, WITHOUT THE LOTTIE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The brand animation ships as `assets/brand/worksuite-loader.json` for
 * bodymovin: a 200 × 200 canvas, 60 fps, 72 frames — four solid squares, each
 * dimming to 28% and back, one after another, 12 frames (0.2 s) apart.
 *
 * It is drawn here as four `<rect>`s with CSS keyframes instead, because that
 * animation needs nothing Lottie provides. There are no paths to interpolate,
 * no masks, no embedded images: just opacity against time. A player would add
 * ~250 KB of JavaScript and a runtime canvas to every surface that shows a
 * spinner — in an app with a hardened CSP and a sandboxed renderer — to animate
 * four rectangles. The timings live in `styles.css` and are read off the JSON,
 * which remains the source of truth and is what the designers edit;
 * `brand-loader.test.tsx` reads that JSON and fails if the two drift apart.
 *
 * Geometry, from the JSON (centres converted to top-left corners):
 *
 *   blue        #0A6CFF  100 × 100 at (75, 25)   dims at 0.167 s
 *   cyan left   #00DAF2   50 × 50  at (25, 75)   dims at 0.367 s
 *   navy        #001842   50 × 50  at (75, 75)   dims at 0.567 s
 *   cyan bottom #00DAF2   50 × 50  at (75, 125)  dims at 0.767 s
 *
 * The rectangles are emitted BACK TO FRONT. Lottie draws its first layer on
 * top; SVG draws its last element on top, so the order here is the reverse of
 * the JSON's — the navy core sits over the big blue square it overlaps, as
 * designed. Get it backwards and the core disappears.
 */
export function WorkSuiteLoader({
  size = 18,
  label = 'Loading',
  className,
}: {
  /** Rendered edge, in pixels. The mark is square. */
  size?: number;
  /** What a screen reader says. `null` for a mark that is purely decorative
   *  because something beside it already announces the wait — a button's own
   *  label, or the text the block spinner puts next to it. */
  label?: string | null;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      className={className}
      role={label === null ? undefined : 'img'}
      aria-label={label ?? undefined}
      aria-hidden={label === null ? true : undefined}
      focusable="false"
    >
      {label !== null && <title>{label}</title>}
      <rect className="ws-load-blue" x="75" y="25" width="100" height="100" fill="#0A6CFF" />
      <rect className="ws-load-cyan-left" x="25" y="75" width="50" height="50" fill="#00DAF2" />
      <rect className="ws-load-cyan-bottom" x="75" y="125" width="50" height="50" fill="#00DAF2" />
      <rect className="ws-load-navy" x="75" y="75" width="50" height="50" fill="#001842" />
    </svg>
  );
}
