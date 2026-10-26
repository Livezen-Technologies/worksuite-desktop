// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, within } from '@testing-library/react';
import { Spinner } from '../../../src/components/ui';
import { Icon } from '../../../src/components/Icon';
import { WorkSuiteLoader } from '../../../src/components/WorkSuiteLoader';
import loader from '../../../src/assets/brand/worksuite-loader.json';

/**
 * The loading mark, against the Lottie it was drawn from.
 *
 * `worksuite-loader.json` is the source of truth — the designers edit that, and
 * the mark is four `<rect>`s and some CSS because that animation needs nothing
 * a Lottie player provides. The risk in doing it that way is the two drifting
 * apart without anybody noticing: the JSON gets a new colour, or a square
 * moves, and the app quietly goes on showing the old mark. So these read the
 * JSON and compare against it — both the component and the CSS that animates
 * it, since the timings live in `styles.css` where no renderer test would
 * otherwise look. A change in the JSON fails here rather than shipping.
 */

interface Layer {
  nm: string;
  ks: { p: { k: number[] }; o: { k: { t: number; s: number[] }[] } };
  shapes: { it: ({ ty: string } & Record<string, unknown>)[] }[];
}

const lottie = loader as unknown as { fr: number; op: number; w: number; h: number; layers: Layer[] };
const { fr, op: frames, layers } = lottie;

/** The square each Lottie layer describes, in the terms SVG wants. */
function squareOf(l: Layer) {
  const items = l.shapes[0]!.it;
  const rc = items.find((i) => i.ty === 'rc') as unknown as { s: { k: [number, number] } };
  const fl = items.find((i) => i.ty === 'fl') as unknown as { c: { k: number[] } };
  const [w, h] = rc.s.k;
  const [cx = 0, cy = 0] = l.ks.p.k;
  const hex = `#${fl.c.k
    .slice(0, 3)
    .map((v) => Math.round(v * 255).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
  /* Its turn in the loop: holds at full, ramps down to the dim keyframe, then
     back up to the next keyframe at full again. */
  const kf = l.ks.o.k;
  const dropsAt = kf.find((k) => k.s[0]! < 100)!;
  const holdsTo = [...kf].reverse().find((k) => k.t < dropsAt.t && k.s[0] === 100)!;
  const recoversAt = kf.find((k) => k.t > dropsAt.t && k.s[0] === 100)!;
  return {
    hex,
    w,
    h,
    x: cx - w / 2,
    y: cy - h / 2,
    dim: dropsAt.s[0]! / 100,
    holdFrame: holdsTo.t,
    dimFrame: dropsAt.t,
    recoverFrame: recoversAt.t,
  };
}

const squares = layers.map(squareOf);
const css = readFileSync(resolve(__dirname, '../../../src/styles.css'), 'utf8');
const html = readFileSync(resolve(__dirname, '../../../src/index.html'), 'utf8');

/** The `ws-load-dim` keyframes block, and the rule bodies that use it. */
const keyframes = /@keyframes ws-load-dim\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
/* The one rule that drives all four squares: easing, and the transform box
   the squash needs. */
const driver = /\.ws-load-navy\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';

/**
 * The bodies of every at-rule with this prelude, brace-matched.
 *
 * A regex cannot do this: the nested rule bodies mean the first `}` is not the
 * end of the block, and a stylesheet has several reduced-motion blocks.
 */
function atRules(sheet: string, prelude: string): string[] {
  const out: string[] = [];
  for (let i = sheet.indexOf(prelude); i !== -1; i = sheet.indexOf(prelude, i + 1)) {
    const open = sheet.indexOf('{', i + prelude.length);
    if (open === -1) continue;
    let depth = 0;
    for (let j = open; j < sheet.length; j++) {
      if (sheet[j] === '{') depth++;
      else if (sheet[j] === '}' && --depth === 0) {
        out.push(sheet.slice(open + 1, j));
        break;
      }
    }
  }
  return out;
}

function drawn(container: HTMLElement) {
  return [...container.querySelectorAll('rect')].map((r) => ({
    hex: (r.getAttribute('fill') ?? '').toUpperCase(),
    x: Number(r.getAttribute('x')),
    y: Number(r.getAttribute('y')),
    w: Number(r.getAttribute('width')),
    h: Number(r.getAttribute('height')),
  }));
}

describe('the WorkSuite loading mark, against worksuite-loader.json', () => {
  it('draws one square per Lottie layer, on the Lottie’s canvas', () => {
    const { container } = render(<WorkSuiteLoader />);

    expect(layers).toHaveLength(4);
    expect(container.querySelectorAll('rect')).toHaveLength(layers.length);
    expect(container.querySelector('svg')!.getAttribute('viewBox')).toBe(`0 0 ${lottie.w} ${lottie.h}`);
  });

  it('puts every square where the Lottie puts it, at the size and colour it gives', () => {
    const { container } = render(<WorkSuiteLoader />);
    const rects = drawn(container);

    /* Lottie positions are centres; SVG takes a top-left corner. Each square
       the JSON names must appear at centre − size / 2, in its own colour. */
    for (const s of squares) {
      expect(rects).toEqual(expect.arrayContaining([{ hex: s.hex, x: s.x, y: s.y, w: s.w, h: s.h }]));
    }
    /* And nothing beyond them — no stray rectangle of our own invention. */
    expect(rects).toHaveLength(squares.length);
  });

  it('uses only the brand’s colours, cyan twice', () => {
    const { container } = render(<WorkSuiteLoader />);
    const fills = drawn(container).map((r) => r.hex);

    expect(new Set(fills)).toEqual(new Set(squares.map((s) => s.hex)));
    const cyan = squares.filter((s) => s.hex === '#00DAF2');
    expect(fills.filter((f) => f === '#00DAF2')).toHaveLength(cyan.length);
  });

  it('paints back to front, so the navy core sits over the blue square', () => {
    const { container } = render(<WorkSuiteLoader />);
    const fills = drawn(container).map((r) => r.hex);

    /* Lottie draws its FIRST layer on top; SVG draws its LAST on top. The navy
       core overlaps the big blue square, so getting this backwards hides it. */
    expect(fills[0]).toBe(squares[squares.length - 1]!.hex);
    expect(fills[fills.length - 1]).toBe(squares[0]!.hex);
    expect(layers[0]!.nm).toContain('navy');
  });

  it('loops for exactly as long as the Lottie does', () => {
    /* 72 frames at 60 fps is 1.2s. A different duration and the mark would be
       out of step with the same animation everywhere else in the suite. */
    const seconds = frames / fr;
    expect(seconds).toBeCloseTo(1.2, 5);
    expect(css).toMatch(new RegExp(`animation:\\s*ws-load-dim\\s+${seconds}s`));
  });

  it('dims to the Lottie’s own 28%, on the Lottie’s own frames', () => {
    /* Every square dims to the same depth, and the CSS says so once. */
    expect(new Set(squares.map((s) => s.dim))).toEqual(new Set([0.28]));
    expect(keyframes).toMatch(/opacity:\s*0\.28/);

    /* One `@keyframes` serves all four squares, each offset by its own delay,
       so it is written on the timeline of the square whose delay is 0 — the
       left-hand cyan. Its dim and its recovery are frames of the JSON, and
       each CSS percentage is that frame over 72. Restimed in the JSON, these
       stop matching and the build fails rather than shipping the old timing. */
    const base = squares.find((s) => s.hex === '#00DAF2' && s.x < 75)!;
    const pct = (f: number) => Number(((f / frames) * 100).toFixed(2));
    expect([base.dimFrame, base.recoverFrame]).toEqual([22, 36]);

    const stops = [...keyframes.matchAll(/([\d.]+)%/g)].map((m) => Number(m[1]));
    expect(stops).toContain(pct(base.dimFrame)); // 22/72 -> 30.56%
    expect(stops).toContain(pct(base.recoverFrame)); // 36/72 -> 50%

    /* It holds at full until its turn, then ramps. This must be the frame the
       hold ENDS on, not the length of the descent that follows it: the ten
       frames from f12 to f22 once got written here as 13.89%, which started
       every square dimming early and steepened the ramp. An inequality let
       that through for a while, so this is an equality now. */
    const hold = stops.filter((s) => s > 0 && s < pct(base.dimFrame));
    expect(hold).toHaveLength(1);
    expect(base.holdFrame).toBe(12);
    expect(hold[0]).toBe(pct(base.holdFrame)); // 12/72 -> 16.67%
    expect(hold[0]).not.toBe(pct(base.dimFrame - base.holdFrame)); // not 13.89%

    /* The JSON squashes each square as it dims — `ks.s` 100 -> 84 -> 100, in
       lockstep with the opacity — and an SVG rect scales about the user-space
       origin, so it needs its own box as the origin or it slides instead. */
    for (const l of lottie.layers) {
      const scale = (l.ks as unknown as { s: { k: Array<{ s: number[] }> } }).s.k.map((k) => k.s[0] ?? 0);
      expect(Math.min(...scale)).toBe(84);
    }
    expect(keyframes).toMatch(/transform:\s*scale\(0\.84\)/);
    expect(keyframes).toMatch(/transform:\s*scale\(1\)/);
    expect(driver).toMatch(/transform-box:\s*fill-box/);
    expect(driver).toMatch(/transform-origin:\s*center/);

    /* The easing is the JSON's own tangents, not a curve borrowed from
       somewhere else: `o.x .45 / o.y 0 / i.x .55 / i.y 1`. */
    const k0 = (lottie.layers.find((l) => l.nm === 'cyan left')!.ks.o.k as unknown as Array<{ o: { x: number[]; y: number[] }; i: { x: number[]; y: number[] } }>)[0]!;
    expect(driver).toContain(
      `cubic-bezier(${k0.o.x[0]}, ${k0.o.y[0]}, ${k0.i.x[0]}, ${k0.i.y[0]})`,
    );
  });

  it('staggers the four squares by the Lottie’s 12 frames, in the Lottie’s order', () => {
    /* The JSON's layers dim one after another; the CSS reproduces that with a
       delay per square. Both the spacing and the running order are checked:
       a delay on the wrong square would animate the mark inside out. */
    const order = [...squares].sort((a, b) => a.dimFrame - b.dimFrame);
    const step = (12 / fr) * 1000;
    expect(order.map((s) => s.dimFrame)).toEqual([10, 22, 34, 46]);

    const classFor: Record<string, string> = { '#0A6CFF': 'ws-load-blue', '#001842': 'ws-load-navy' };
    const delays = order.map((s, i) => {
      /* Both cyans are the same colour, so they are told apart by position:
         the one on the left, then the one at the bottom. */
      const cls = classFor[s.hex] ?? (s.x < 75 ? 'ws-load-cyan-left' : 'ws-load-cyan-bottom');
      const found = new RegExp(`\\.${cls}\\s*\\{\\s*animation-delay:\\s*(-?[\\d.]+)s`).exec(css);
      expect(found, `${cls} needs an animation-delay in styles.css`).toBeTruthy();
      return { cls, ms: Number(found![1]) * 1000, expected: (i - 1) * step };
    });

    /* Square one starts a step early (a negative delay), so all four are in
       step from the first frame rather than easing in one by one. */
    for (const d of delays) expect(d.ms).toBeCloseTo(d.expected, 6);
    expect(delays.map((d) => d.cls)).toEqual(['ws-load-blue', 'ws-load-cyan-left', 'ws-load-navy', 'ws-load-cyan-bottom']);
  });

  it('stops moving, at full opacity, when reduced motion is asked for', () => {
    const ours = atRules(css, '@media (prefers-reduced-motion: reduce)').find((b) => b.includes('ws-load-'));

    expect(ours, 'the mark needs a prefers-reduced-motion rule').toBeTruthy();
    expect(ours).toMatch(/animation:\s*none/);
    expect(ours).toMatch(/opacity:\s*1/);
    for (const cls of ['ws-load-blue', 'ws-load-cyan-left', 'ws-load-cyan-bottom', 'ws-load-navy']) {
      expect(ours).toContain(cls);
    }
  });
});

describe('where the mark is shown', () => {
  it('names itself for a screen reader, and goes quiet where something else speaks', () => {
    /* Scoped to each render's own container: these tests mount several marks
       and nothing cleans the document up between them. */
    const loud = render(<WorkSuiteLoader />);
    /* `getByRole` throws if it is not there, which is the assertion. */
    expect(within(loud.container).getByRole('img', { name: 'Loading' }).tagName.toLowerCase()).toBe('svg');
    expect(loud.container.querySelector('title')!.textContent).toBe('Loading');
    loud.unmount();

    const quiet = render(<WorkSuiteLoader label={null} />);
    expect(quiet.container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(quiet.container.querySelector('svg')!.getAttribute('role')).toBeNull();
    expect(quiet.container.querySelector('title')).toBeNull();
  });

  it('is square at whatever size it is asked for', () => {
    const { container } = render(<WorkSuiteLoader size={64} />);
    const svg = container.querySelector('svg')!;

    expect(svg.getAttribute('width')).toBe('64');
    expect(svg.getAttribute('height')).toBe('64');
  });

  it('is what the block Spinner shows, said once', () => {
    const { container } = render(<Spinner label="Loading orders…" />);

    expect(container.querySelectorAll('rect')).toHaveLength(4);
    /* The `role="status"` wrapper reads the label beside the mark, so the mark
       itself must stay silent — otherwise it is announced twice. */
    expect(container.querySelector('[role="status"]')).toBeTruthy();
    expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(container.textContent).toContain('Loading orders…');
  });

  it('is what `Icon name="spinner"` draws, and it does not rotate', () => {
    /* ~50 call sites ask for the spinner glyph with a rotation class. They get
       the mark, and the rotation comes off: the brand mark dims, it never
       turns. Keeping this at the Icon means those call sites did not have to
       change, and cannot drift back to a different spinner. */
    const { container } = render(<Icon name="spinner" size={16} className="animate-spin-slow shrink-0" />);
    const svg = container.querySelector('svg')!;

    expect(container.querySelectorAll('rect')).toHaveLength(4);
    expect(svg.getAttribute('class')).toBe('shrink-0');
    expect(svg.getAttribute('class')).not.toContain('animate-spin');
    expect(svg.getAttribute('width')).toBe('16');
  });

  it('leaves a turning refresh icon turning', () => {
    /* A `refresh` icon that spins is the button you pressed, not the app
       saying it is busy. The brand mark is the wrong thing to put there. */
    const { container } = render(<Icon name="refresh" className="animate-spin" />);

    expect(container.querySelectorAll('rect')).toHaveLength(0);
    expect(container.querySelector('svg')!.getAttribute('class')).toContain('animate-spin');
  });

  it('is on screen before React is, with the same geometry', () => {
    /* The boot mark in index.html is the most visible wait in a desktop app:
       the window is shown on `ready-to-show`, before any bundle has run. It is
       hand-written there, so it is checked against the JSON too. */
    const boot = /<div id="ws-boot">[\s\S]*?<\/div>/.exec(html)?.[0] ?? '';
    expect(boot, 'index.html needs the boot mark').toBeTruthy();

    for (const s of squares) {
      const rect = new RegExp(`<rect[^>]*x="${s.x}"[^>]*y="${s.y}"[^>]*width="${s.w}"[^>]*height="${s.h}"[^>]*fill="${s.hex}"`, 'i');
      expect(boot, `the boot mark is missing ${s.hex} at ${s.x},${s.y}`).toMatch(rect);
    }

    /* Same loop, same dim, and it still stops for reduced motion. */
    expect(html).toMatch(new RegExp(`ws-boot-dim\\s+${frames / fr}s`));
    expect(html).toMatch(/opacity:\s*0\.28/);
    expect(html).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation:\s*none/);
    /* Navy drawn last, over the blue square, exactly as in the component. */
    const order = [...boot.matchAll(/fill="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1]!.toUpperCase());
    expect(order[order.length - 1]).toBe('#001842');
    expect(order[0]).toBe('#0A6CFF');
  });
});
