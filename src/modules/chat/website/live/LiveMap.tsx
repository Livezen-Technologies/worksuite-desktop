import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../../../../components/Icon';
import { cx } from '../../../../components/ui';
import { text } from '../../../../core/i18n';
import { findCountry } from './countries';
import { clusterPlaces, fitBox, LEGEND, STATE, STATES, zoomed, type Box, type Place, type VisitorState } from './liveMap';
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
function placeLabels(places: Place[], box: Box, u: number, inside: (p: Place) => boolean): Map<string, { x: number; y: number; anchor: 'start' | 'end'; text: string; approx: boolean }> {
  const taken: Rect[] = places.map((p) => {
    const r = (p.approx ? disc(p.count) * 1.05 : ring(p.count) + 2) * u;
    return { x0: p.x - r, x1: p.x + r, y0: p.y - r, y1: p.y + r };
  });
  const hit = (b: Rect, skip: number) => taken.some((t, i) => i !== skip && b.x0 < t.x1 && b.x1 > t.x0 && b.y0 < t.y1 && b.y1 > t.y0);
  const out = new Map<string, { x: number; y: number; anchor: 'start' | 'end'; text: string; approx: boolean }>();
  places.forEach((p, i) => {
    if (!inside(p)) return;
    const words = `${p.city ?? p.country}${p.approx ? ' ≈' : ''} ${p.count}`;
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

export function LiveMap({ places, box: asked, onBox, selected = null, onSelect, callout, caption, className, label = 'Map of visitors' }: {
  places: Place[];
  box: Box;
  onBox?: (b: Box) => void;
  selected?: string | null;
  onSelect?: (p: Place) => void;
  /** The red callout beside an at-risk place ("Anne · at risk 3:12"); none when it returns null. */
  callout?: (p: Place) => string | null;
  /** The note at the bottom left, e.g. "Shaded by visitors now · darker = more". */
  caption?: string;
  className?: string;
  label?: string;
}) {
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
      const step = counts.length <= 1 ? SHADE.length - 1 : Math.round((rank / (counts.length - 1)) * (SHADE.length - 1));
      out.set(code, SHADE[step]!);
    }
    return out;
  }, [places]);

  const inside = (p: Place) => p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;
  const hidden = places.filter((p) => !inside(p)).reduce((n, p) => n + p.count, 0);
  const total = places.reduce((n, p) => n + p.count, 0);
  // Markers that would sit on each other at this zoom are one marker; zooming in parts them again.
  const marks = clusterPlaces(places, (a, b) => (ring(a.count) + ring(b.count)) * u * 0.85);
  // Worst state on top: an at-risk marker is never hidden under a browsing one.
  const drawn = [...marks].sort((a, b) => STATES.indexOf(b.state) - STATES.indexOf(a.state));
  // In pixels: the disc grows with the count, the ring sits just outside it.

  const labels = placeLabels(marks, box, u, inside);

  return (
    <div ref={frame} className={cx('relative overflow-hidden bg-[#f8f9fc] dark:bg-subtle', className)}>
      <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} className="block h-full w-full" role="img" preserveAspectRatio="xMidYMid meet"
        aria-label={`${text(label)}: ${total} ${total === 1 ? text('visitor') : text('visitors')}, ${places.length} ${places.length === 1 ? text('place') : text('places')}`}>
        {/* Antarctica has never had a visitor, and a tall frame would otherwise show it. */}
        {WORLD_SHAPES.filter((s) => s.code !== 'AQ').map((s) => (
          <path key={s.code} d={s.d} fill={shade.get(s.code) ?? NONE} stroke="#ffffff" strokeWidth={0.7 * u} />
        ))}
        {drawn.map((p) => {
          const name = `${p.city ?? p.country}${p.approx ? ` (${text('country only')})` : ''}: ${p.count} · ${text(STATE[p.state].label)}`;
          const on = selected === p.key;
          const act = onSelect
            ? {
                role: 'button',
                tabIndex: 0,
                'aria-label': name,
                'aria-pressed': on,
                onClick: () => onSelect(p),
                onKeyDown: (e: KeyboardEvent) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  onSelect(p);
                },
                className: 'cursor-pointer outline-none',
              }
            : {};
          if (p.approx) {
            const r = disc(p.count) * 1.05 * u;
            return (
              <g key={p.key} {...act} data-place={p.key}>
                <circle cx={p.x} cy={p.y} r={r} fill="rgba(255,255,255,0.75)" stroke="#6b7083" strokeWidth={1.2 * u} strokeDasharray={`${3 * u} ${2.2 * u}`} />
                <text x={p.x} y={p.y + 3.6 * u} textAnchor="middle" fontSize={10 * u} fontWeight={700} fill="#4e5469">{p.count}</text>
                {on ? <circle cx={p.x} cy={p.y} r={r + 4 * u} fill="none" stroke="#161a2c" strokeWidth={1.4 * u} /> : null}
                <title>{name}</title>
              </g>
            );
          }
          const d = disc(p.count) * u;
          const R = ring(p.count) * u;
          const parts = STATES.filter((s) => (p.states[s] ?? 0) > 0);
          const risky = p.state === 'at_risk';
          return (
            <g key={p.key} {...act} data-place={p.key}>
              {risky ? (
                <>
                  <circle cx={p.x} cy={p.y} r={R + 15 * u} fill={STATE.at_risk.colour} opacity={0.16} />
                  <circle cx={p.x} cy={p.y} r={R + 6.5 * u} fill="none" stroke={STATE.at_risk.colour} strokeWidth={1.4 * u} opacity={0.6} />
                </>
              ) : null}
              {parts.length <= 1 ? (
                <circle cx={p.x} cy={p.y} r={R} fill="none" stroke={STATE[parts[0] ?? p.state].colour} strokeWidth={3.2 * u} data-arc={parts[0] ?? p.state} />
              ) : (
                arcs(p, R).map((a) => <path key={a.state} d={a.d} fill="none" stroke={STATE[a.state].colour} strokeWidth={3.2 * u} strokeLinecap="round" data-arc={a.state} />)
              )}
              <circle cx={p.x} cy={p.y} r={d} fill="#ffffff" stroke="#273498" strokeWidth={0.8 * u} />
              <text x={p.x} y={p.y + 3.6 * u} textAnchor="middle" fontSize={(p.count >= 5 ? 12 : 10.5) * u} fontWeight={700} fill="#111b3b">{p.count}</text>
              {on ? <circle cx={p.x} cy={p.y} r={R + 4 * u} fill="none" stroke="#161a2c" strokeWidth={1.4 * u} /> : null}
              <title>{name}</title>
            </g>
          );
        })}
        {[...labels.entries()].map(([key, l]) => (
          <text key={`l-${key}`} x={l.x} y={l.y} textAnchor={l.anchor} fontSize={11 * u} fontWeight={l.approx ? 400 : 600} fill={l.approx ? '#6b7083' : '#303444'} paintOrder="stroke" stroke="#ffffff" strokeWidth={3 * u} pointerEvents="none">
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

      {onBox ? (
        <div className="absolute top-2.5 right-2.5 flex flex-col overflow-hidden rounded-[8px] border border-line bg-surface shadow-[0_2px_6px_rgba(17,27,59,0.08)]">
          <button type="button" aria-label={text('Zoom in')} onClick={() => onBox(zoomed(asked, 0.6))} className="flex h-7 w-7 items-center justify-center border-b border-line text-ink-2 hover:bg-subtle">
            <Icon name="plus" size={14} />
          </button>
          <button type="button" aria-label={text('Zoom out')} onClick={() => onBox(zoomed(asked, 1 / 0.6))} className="flex h-7 w-7 items-center justify-center text-ink-2 hover:bg-subtle">
            <Icon name="minus" size={14} />
          </button>
        </div>
      ) : null}

      {hidden > 0 ? (
        <p className="absolute top-2.5 left-2.5 rounded-[8px] border border-line bg-surface/90 px-2 py-1 text-[11px] font-semibold text-ink-2">
          {text('{n} outside this view', { n: hidden })}
        </p>
      ) : null}

      {caption ? <p className="absolute bottom-2.5 left-2.5 rounded-[8px] border border-line bg-surface/90 px-[9px] py-[5px] text-[11px] text-ink-2">{caption}</p> : null}
    </div>
  );
}

/** What the colours and shapes mean (C-00): the five states as rings, then a city marker and a country-only ring. */
export function MapLegend({ className }: { className?: string }) {
  return (
    <div className={cx('flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11.5px] text-ink-2', className)} aria-label={text('Map legend')} role="list">
      {LEGEND.map((s) => (
        <span key={s} role="listitem" className="flex items-center gap-1.5 whitespace-nowrap">
          <span className="box-border h-2.5 w-2.5 rounded-full border-[2.5px]" style={{ borderColor: STATE[s].colour }} aria-hidden />
          {text(STATE[s].label)}
        </span>
      ))}
      <span className="h-3.5 w-px bg-line" aria-hidden />
      <span role="listitem" className="flex items-center gap-1.5 whitespace-nowrap">
        <span className="box-border h-2.5 w-2.5 rounded-full border-[1.5px] border-[#273498] bg-white" aria-hidden />
        {text('City')}
      </span>
      <span role="listitem" className="flex items-center gap-1.5 whitespace-nowrap">
        <span className="box-border h-[11px] w-[11px] rounded-full border-[1.5px] border-dashed border-[#6b7083]" aria-hidden />
        {text('Country only ≈')}
      </span>
    </div>
  );
}
