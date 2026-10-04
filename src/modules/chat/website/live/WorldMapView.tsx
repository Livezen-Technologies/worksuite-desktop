import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../../../../components/Icon';
import { cx } from '../../../../components/ui';
import { text } from '../../../../core/i18n';
import { findCountry } from './countries';
import { clusterPlaces, countriesIn, DETAIL_BELOW, fitBox, LEGEND, outsideOf, padded, panned, STATE, STATES, WORLD_BOX, zoomAt, zoomed, type Box, type Place, type VisitorState } from './liveMap';
import { useDetail } from './mapDetail';
import { WORLD_SHAPES } from './worldMap';

/**
 * The live map (worksuite-desktop C-00, ported from the web's LiveMap, WS-WCHAT MAP-UI-01…03): countries shaded by how
 * many visitors are there, a white marker with its count for each city somebody was located in — its ring split into
 * one arc per state, so a place with somebody waiting shows amber beside the blue of those browsing — a dashed grey ring,
 * marked ≈, on a country for visitors placed only by their browser's timezone, and a red halo with a callout where
 * somebody is at risk. Zooms by a box the caller holds, so its presets and buttons agree; markers and labels keep their
 * size on screen at every zoom.
 *
 * Drawn from pre-projected Natural Earth outlines: nothing fetched, no key, nothing to fail offline.
 */

/** No visitors, then darker for more (C-00). */
const NONE = '#e6e8ef';
const SHADE = ['#dfe4fb', '#c3ccf6', '#9aa9ee', '#6f84e4', '#4a63e8'];

/** The design's artboard: a 732 × 400 frame, so the first paint (and a test, with no layout) matches it. */
const FRAME = { w: 732, h: 400 };

/** A point on a circle, clockwise from the top. */
const at = (cx: number, cy: number, r: number, a: number) => `${(cx + r * Math.sin(a)).toFixed(2)} ${(cy - r * Math.cos(a)).toFixed(2)}`;

/** In pixels: a marker's white disc grows with its count, and its ring sits just outside it. */
const disc = (n: number) => 10 + Math.min(9, (Math.sqrt(n) - 1) * 4.5);
const ring = (n: number) => disc(n) + 2.4;

/** A marker's ring as one arc per state there, worst first from the top, clockwise, with a hair of a gap between. */
function arcs(p: Place, R: number): Array<{ state: VisitorState; d: string }> {
  const gap = 0.07;
  const out: Array<{ state: VisitorState; d: string }> = [];
  let a = 0;
  for (const s of STATES) {
    const n = p.states[s] ?? 0;
    if (!n) continue;
    const sweep = (n / p.count) * Math.PI * 2;
    const a0 = a + gap / 2, a1 = a + sweep - gap / 2;
    a += sweep;
    out.push({ state: s, d: `M${at(p.x, p.y, R, a0)}A${R} ${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${at(p.x, p.y, R, a1)}` });
  }
  return out;
}

interface Rect { x0: number; x1: number; y0: number; y1: number }

/**
 * Names for the busiest places first ("London 1", "Sri Lanka ≈ 1"): right of the marker or else left, never over
 * another label or marker and never off the frame — a place that has no room goes unlabelled, as in the design.
 */
function placeLabels(places: Place[], box: Box, u: number, inside: (p: Place) => boolean, wordsOf: (p: Place) => string): Map<string, { x: number; y: number; anchor: 'start' | 'end'; text: string; approx: boolean }> {
  const taken: Rect[] = places.map((p) => {
    const r = (p.approx ? disc(p.count) * 1.05 : ring(p.count) + 2) * u;
    return { x0: p.x - r, x1: p.x + r, y0: p.y - r, y1: p.y + r };
  });
  const hit = (b: Rect, skip: number) => taken.some((t, i) => i !== skip && b.x0 < t.x1 && b.x1 > t.x0 && b.y0 < t.y1 && b.y1 > t.y0);
  const out = new Map<string, { x: number; y: number; anchor: 'start' | 'end'; text: string; approx: boolean }>();
  places.forEach((p, i) => {
    if (!inside(p)) return;
    const words = wordsOf(p);
    const w = words.length * 6.4 * u;
    const h = 14 * u;
    const r = (p.approx ? disc(p.count) * 1.05 : ring(p.count)) * u + 5 * u;
    for (const side of ['start', 'end'] as const) {
      const x = side === 'start' ? p.x + r : p.x - r;
      const b = side === 'start' ? { x0: x, x1: x + w, y0: p.y - h / 2, y1: p.y + h / 2 } : { x0: x - w, x1: x, y0: p.y - h / 2, y1: p.y + h / 2 };
      if (b.x0 < box.x || b.x1 > box.x + box.w || hit(b, i)) continue;
      taken.push(b);
      out.set(p.key, { x, y: p.y + 4 * u, anchor: side, text: words, approx: p.approx });
      return;
    }
  });
  return out;
}

/** The two looks of the map: the app's, and the wall's dark one for a TV across a room (MAP-UI-03). */
export type MapTheme = 'light' | 'dark';

const LOOK: Record<MapTheme, {
  frame: string; none: string; shade: string[]; border: string; detailBorder: string;
  disc: string; discEdge: string; count: string; approxFill: string; approxEdge: string; approxCount: string;
  label: string; approxLabel: string; halo: string; picked: string;
}> = {
  light: {
    frame: 'bg-[#f8f9fc] dark:bg-subtle', none: NONE, shade: SHADE, border: '#ffffff', detailBorder: '#9aa9ee',
    disc: '#ffffff', discEdge: '#273498', count: '#111b3b', approxFill: 'rgba(255,255,255,0.75)', approxEdge: '#6b7083', approxCount: '#4e5469',
    label: '#303444', approxLabel: '#6b7083', halo: '#ffffff', picked: '#273498',
  },
  // The wall (MAP-UI-03): navy ground, countries lighter the more visitors there are.
  dark: {
    frame: 'bg-[#0b1430]', none: '#1a2550', shade: ['#24337a', '#2d40a0', '#3a52c4', '#4a63e8', '#7088f2'], border: '#0b1430', detailBorder: '#2a3870',
    disc: '#e9edff', discEdge: '#111b3b', count: '#111b3b', approxFill: 'rgba(255,255,255,0.08)', approxEdge: '#9aa3c4', approxCount: '#dfe3f0',
    label: '#dfe3f0', approxLabel: '#aab2c9', halo: '#0b1430', picked: '#e9edff',
  },
};

/**
 * How a place is named beside its marker: `count` "Colombo 5" (C-00), `detail` adds what a dashed ring means — "Sri
 * Lanka ≈ 1 · timezone only" (the full map, MAP-UI-02) — and `name` is the place alone, the count being in its disc
 * (the wall, MAP-UI-03).
 */
export type MapLabels = 'count' | 'detail' | 'name';

const labelOf = (p: Place, style: MapLabels): string => {
  const name = p.city ?? p.country;
  if (style === 'name') return name;
  if (p.approx) return style === 'detail' ? text('{country} ≈ {n} · timezone only', { country: p.country, n: p.count }) : `${name} ≈ ${p.count}`;
  return `${name} ${p.count}`;
};

export function LiveMap({ places, box: asked, onBox, selected = null, onSelect, callout, caption, className, label = 'Map of visitors', theme = 'light', labels: labelStyle = 'count', fit = false, edges = true, zoomButtons = true }: {
  places: Place[];
  box: Box;
  /** Zoomed or panned: by the buttons, a scroll, a pinch or a drag (MAP-08). Without it the map stays where it is. */
  onBox?: (b: Box) => void;
  selected?: string | null;
  onSelect?: (p: Place) => void;
  /** The red callout beside an at-risk place ("Anne · at risk 3:12"); none when it returns null. */
  callout?: (p: Place) => string | null;
  /** The note at the bottom left, e.g. "Shaded by visitors now · darker = more". */
  caption?: string;
  className?: string;
  label?: string;
  theme?: MapTheme;
  labels?: MapLabels;
  /** A third button under + and −, ⤢, that brings everybody into view (the full map's, MAP-UI-02). */
  fit?: boolean;
  /** Chips for who is outside the view ("↖ India · 3 outside this view"). */
  edges?: boolean;
  /** + and − over the map; off where the region presets sit in their place (the Live map window, MAP-UI-04). */
  zoomButtons?: boolean;
}) {
  const look = LOOK[theme];
  // The frame's size, so the box fits it and a marker can be sized in pixels.
  const frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(FRAME);
  useEffect(() => {
    const el = frame.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => {
      const r = e?.contentRect;
      if (r && r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const box = fitBox(asked, size.w / size.h);
  // Map units per screen pixel.
  const u = box.w / size.w;

  // Past a region's zoom, the countries in view are drawn from their detailed outlines as those arrive (MAP-09).
  const detailed = box.w < DETAIL_BELOW;
  const detail = useDetail(detailed ? countriesIn(box) : []);

  // Shaded by rank of how many are there, so every visited country reads as visited and the busiest darkest.
  const shade = useMemo(() => {
    const per = new Map<string, number>();
    for (const p of places) {
      const code = findCountry(p.country)?.code;
      if (code) per.set(code, (per.get(code) ?? 0) + p.count);
    }
    const counts = [...new Set(per.values())].sort((a, b) => a - b);
    const out = new Map<string, string>();
    for (const [code, n] of per) {
      const rank = counts.indexOf(n);
      const step = counts.length <= 1 ? look.shade.length - 1 : Math.round((rank / (counts.length - 1)) * (look.shade.length - 1));
      out.set(code, look.shade[step]!);
    }
    return out;
  }, [places, look]);

  const inside = (p: Place) => p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;
  const total = places.reduce((n, p) => n + p.count, 0);
  const away = edges ? outsideOf(places, box).slice(0, 3) : [];
  // Markers that would sit on each other at this zoom are one marker; zooming in parts them again.
  const marks = clusterPlaces(places, (a, b) => (ring(a.count) + ring(b.count)) * u * 0.85);
  // Worst state on top: an at-risk marker is never hidden under a browsing one.
  const drawn = [...marks].sort((a, b) => STATES.indexOf(b.state) - STATES.indexOf(a.state));

  const labels = placeLabels(marks, box, u, inside, (p) => labelOf(p, labelStyle));

  // Scroll, pinch and drag (MAP-08). The latest view in a ref, so the listeners need not be added again on each change.
  const view = useRef({ asked, box, u });
  useEffect(() => {
    view.current = { asked, box, u };
  });
  const moved = useRef(false);
  useEffect(() => {
    const el = frame.current;
    if (!el || !onBox) return undefined;
    const pointAt = (clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect();
      const { box: b, u: k } = view.current;
      return { x: b.x + (clientX - r.left) * k, y: b.y + (clientY - r.top) * k };
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      // A trackpad's pinch arrives as a scroll with Ctrl held, and moves in smaller steps.
      const factor = Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      onBox(zoomAt(view.current.box, factor, pointAt(e.clientX, e.clientY)));
    };
    const down = new Map<number, { x: number; y: number }>();
    let start: { box: Box; x: number; y: number; dist: number; mid: { x: number; y: number } } | null = null;
    const begin = () => {
      const pts = [...down.values()];
      const [a, b] = pts;
      if (!a) return void (start = null);
      const mid = b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a;
      start = { box: view.current.box, x: mid.x, y: mid.y, dist: b ? Math.hypot(a.x - b.x, a.y - b.y) : 0, mid: pointAt(mid.x, mid.y) };
    };
    const pointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || (e.target as Element).closest('button')) return;
      down.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved.current = false;
      begin();
    };
    const pointerMove = (e: PointerEvent) => {
      if (!down.has(e.pointerId) || !start) return;
      down.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pts = [...down.values()];
      const [a, b] = pts;
      if (!a) return;
      const mid = b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a;
      if (Math.hypot(mid.x - start.x, mid.y - start.y) > 4 || b) moved.current = true;
      if (!moved.current) return;
      const k = view.current.u;
      let next = start.box;
      if (b && start.dist > 0) next = zoomAt(next, start.dist / Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), start.mid);
      onBox(panned(next, -(mid.x - start.x) * k, -(mid.y - start.y) * k));
    };
    const pointerUp = (e: PointerEvent) => {
      if (!down.delete(e.pointerId)) return;
      begin();
    };
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('pointerdown', pointerDown);
    window.addEventListener('pointermove', pointerMove);
    window.addEventListener('pointerup', pointerUp);
    window.addEventListener('pointercancel', pointerUp);
    return () => {
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('pointerdown', pointerDown);
      window.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerup', pointerUp);
      window.removeEventListener('pointercancel', pointerUp);
    };
  }, [onBox]);

  const everyone = () => {
    if (!onBox) return;
    if (!places.length) return onBox(WORLD_BOX);
    const x0 = Math.min(...places.map((p) => p.x)), x1 = Math.max(...places.map((p) => p.x));
    const y0 = Math.min(...places.map((p) => p.y)), y1 = Math.max(...places.map((p) => p.y));
    onBox(padded({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, 0.15));
  };

  const shapes = WORLD_SHAPES.filter((s) => s.code !== 'AQ');
  const extra = [...detail.keys()].filter((c) => !shapes.some((s) => s.code === c));

  return (
    <div ref={frame} className={cx('relative touch-none overflow-hidden select-none', onBox && 'cursor-grab active:cursor-grabbing', look.frame, className)}>
      <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} className="block h-full w-full" role="img" preserveAspectRatio="xMidYMid meet"
        aria-label={`${text(label)}: ${total} ${total === 1 ? text('visitor') : text('visitors')}, ${places.length} ${places.length === 1 ? text('place') : text('places')}`}>
        {/* Antarctica has never had a visitor, and a tall frame would otherwise show it. */}
        {shapes.map((s) => (
          <path key={s.code} d={detail.get(s.code) ?? s.d} data-detail={detail.has(s.code) ? s.code : undefined} fill={shade.get(s.code) ?? look.none} stroke={detail.size ? look.detailBorder : look.border} strokeWidth={(detail.size ? 0.6 : 0.7) * u} />
        ))}
        {extra.map((c) => <path key={c} d={detail.get(c)} data-detail={c} fill={shade.get(c) ?? look.none} stroke={look.detailBorder} strokeWidth={0.6 * u} />)}
        {drawn.map((p) => {
          const name = `${p.city ?? p.country}${p.approx ? ` (${text('country only')})` : ''}: ${p.count} · ${text(STATE[p.state].label)}`;
          const on = selected === p.key;
          const pick = () => {
            if (!moved.current) onSelect?.(p);
          };
          const act = onSelect
            ? {
                role: 'button',
                tabIndex: 0,
                'aria-label': name,
                'aria-pressed': on,
                onClick: pick,
                onKeyDown: (e: KeyboardEvent) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  onSelect(p);
                },
                className: 'cursor-pointer outline-none',
              }
            : {};
          // The picked place: a dashed ring around it (MAP-UI-02).
          const picked = (r: number) => (on ? <circle cx={p.x} cy={p.y} r={r + 6 * u} fill="none" stroke={look.picked} strokeWidth={1.4 * u} strokeDasharray={`${3.5 * u} ${2 * u}`} data-picked /> : null);
          if (p.approx) {
            const r = disc(p.count) * 1.05 * u;
            return (
              <g key={p.key} {...act} data-place={p.key}>
                <circle cx={p.x} cy={p.y} r={r} fill={look.approxFill} stroke={look.approxEdge} strokeWidth={1.2 * u} strokeDasharray={`${3 * u} ${2.2 * u}`} />
                <text x={p.x} y={p.y + 3.6 * u} textAnchor="middle" fontSize={10 * u} fontWeight={700} fill={look.approxCount}>{p.count}</text>
                {picked(r)}
                <title>{name}</title>
              </g>
            );
          }
          const d = disc(p.count) * u;
          const R = ring(p.count) * u;
          const parts = STATES.filter((s) => (p.states[s] ?? 0) > 0);
          // A halo where somebody needs us: red when at risk, amber when waiting (MAP-04).
          const halo = p.state === 'at_risk' || p.state === 'waiting' ? STATE[p.state].colour : null;
          return (
            <g key={p.key} {...act} data-place={p.key}>
              {halo ? (
                <>
                  <circle cx={p.x} cy={p.y} r={R + 15 * u} fill={halo} opacity={0.16} />
                  <circle cx={p.x} cy={p.y} r={R + 6.5 * u} fill="none" stroke={halo} strokeWidth={1.4 * u} opacity={0.6} />
                </>
              ) : null}
              {parts.length <= 1 ? (
                <circle cx={p.x} cy={p.y} r={R} fill="none" stroke={STATE[parts[0] ?? p.state].colour} strokeWidth={3.2 * u} data-arc={parts[0] ?? p.state} />
              ) : (
                arcs(p, R).map((a) => <path key={a.state} d={a.d} fill="none" stroke={STATE[a.state].colour} strokeWidth={3.2 * u} strokeLinecap="round" data-arc={a.state} />)
              )}
              <circle cx={p.x} cy={p.y} r={d} fill={look.disc} stroke={look.discEdge} strokeWidth={0.8 * u} />
              <text x={p.x} y={p.y + 3.6 * u} textAnchor="middle" fontSize={(p.count >= 5 ? 12 : 10.5) * u} fontWeight={700} fill={look.count}>{p.count}</text>
              {picked(halo ? R + 9 * u : R)}
              <title>{name}</title>
            </g>
          );
        })}
        {[...labels.entries()].map(([key, l]) => (
          <text key={`l-${key}`} x={l.x} y={l.y} textAnchor={l.anchor} fontSize={11 * u} fontWeight={l.approx ? 400 : 600} fill={l.approx ? look.approxLabel : look.label} paintOrder="stroke" stroke={look.halo} strokeWidth={3 * u} pointerEvents="none">
            {l.text}
          </text>
        ))}
        {callout
          ? marks.filter((p) => !p.approx && p.state === 'at_risk' && inside(p)).map((p) => {
              const words = callout(p);
              if (!words) return null;
              const w = words.length * 6.6 + 16;
              // Down and to the left of the place, kept inside the frame.
              const x = Math.max(box.x + 8 * u, Math.min(box.x + box.w - (w + 8) * u, p.x - 175 * u));
              const y = Math.max(box.y + 20 * u, Math.min(box.y + box.h - 14 * u, p.y + 62 * u));
              return (
                <g key={`c-${p.key}`} pointerEvents="none" data-callout={p.key}>
                  <line x1={p.x} y1={p.y} x2={x} y2={y} stroke={STATE.at_risk.colour} strokeWidth={1 * u} />
                  <g transform={`translate(${x} ${y}) scale(${u})`}>
                    <rect x={0} y={-13} rx={6} width={w} height={22} fill={STATE.at_risk.colour} />
                    <text x={8} y={2} fontSize={11} fontWeight={700} fill="#ffffff">{words}</text>
                  </g>
                </g>
              );
            })
          : null}
      </svg>

      {onBox && zoomButtons ? (
        <div className="absolute top-2.5 right-2.5 flex flex-col overflow-hidden rounded-[8px] border border-line bg-surface shadow-[0_2px_6px_rgba(17,27,59,0.08)]">
          <button type="button" aria-label={text('Zoom in')} onClick={() => onBox(zoomed(asked, 0.6))} className={cx(ZOOM, 'border-b border-line')}>
            <Icon name="plus" size={14} />
          </button>
          <button type="button" aria-label={text('Zoom out')} onClick={() => onBox(zoomed(asked, 1 / 0.6))} className={cx(ZOOM, fit && 'border-b border-line')}>
            <Icon name="minus" size={14} />
          </button>
          {fit ? (
            <button type="button" aria-label={text('Show everyone')} onClick={everyone} className={cx(ZOOM, 'text-[12px]')}>
              ⤢
            </button>
          ) : null}
        </div>
      ) : null}

      {away.length ? (
        <ul aria-label={text('Outside this view')} className="absolute top-2.5 left-2.5 flex flex-col items-start gap-1.5">
          {away.map((a) => (
            <li key={a.country} className="flex items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-[12px] whitespace-nowrap text-ink shadow-[0_2px_6px_rgba(17,27,59,0.08)]">
              {a.arrow} {findCountry(a.country)?.name ?? a.country} · {a.count} <span className="text-ink-3">{text('outside this view')}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {caption ? <p className="absolute bottom-2.5 left-2.5 rounded-[8px] border border-line bg-surface/95 px-2.5 py-[7px] text-[11.5px] text-ink-2">{caption}</p> : null}
    </div>
  );
}

const ZOOM = 'flex h-[30px] w-[30px] items-center justify-center text-ink-2 hover:bg-subtle';

/** What the colours and shapes mean (C-00): the five states as rings, then a city marker and a country-only ring. */
export function MapLegend({ className, theme = 'light' }: { className?: string; theme?: MapTheme }) {
  const dark = theme === 'dark';
  return (
    <div className={cx('flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11.5px]', dark ? 'text-[#c9cfe3]' : 'text-ink-2', className)} aria-label={text('Map legend')} role="list">
      {LEGEND.map((s) => (
        <span key={s} role="listitem" className="flex items-center gap-1.5 whitespace-nowrap">
          <span className="box-border h-2.5 w-2.5 rounded-full border-[2.5px]" style={{ borderColor: STATE[s].colour }} aria-hidden />
          {text(STATE[s].label)}
        </span>
      ))}
      <span className={cx('h-3.5 w-px', dark ? 'bg-[#2a3870]' : 'bg-line')} aria-hidden />
      <span role="listitem" className="flex items-center gap-1.5 whitespace-nowrap">
        <span className={cx('box-border h-2.5 w-2.5 rounded-full border-[1.5px]', dark ? 'border-[#e9edff] bg-[#e9edff]' : 'border-[#273498] bg-white')} aria-hidden />
        {text('City')}
      </span>
      <span role="listitem" className="flex items-center gap-1.5 whitespace-nowrap">
        <span className={cx('box-border h-[11px] w-[11px] rounded-full border-[1.5px] border-dashed', dark ? 'border-[#9aa3c4]' : 'border-[#6b7083]')} aria-hidden />
        {text('Country only ≈')}
      </span>
    </div>
  );
}
