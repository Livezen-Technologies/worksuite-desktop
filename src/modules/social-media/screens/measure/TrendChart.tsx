import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { full } from '../../parts';

/**
 * W07's "Reach and engagements" trend (SMM-ANL-002): reach as a solid line, engagements ×10 dashed on the same axis
 * so both read on one scale. A gap in the data (a day not measured) breaks the line instead of drawing a zero
 * (WF-12). The SVG is a picture for sighted readers; the same series is in a visually hidden table.
 */

export interface TrendPoint {
  date: string;
  reach: number | null;
  engagements: number | null;
}

const H = 220;
const PAD = { left: 44, right: 12, top: 14, bottom: 26 };
const ENG_SCALE = 10;

/** "45k", "1.2M": the axis's short labels. */
export function axisLabel(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${+(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Three equal steps up to a round number above the highest value (0, 45k, 90k, 135k). */
export function axisSteps(max: number): number[] {
  if (!(max > 0)) return [0, 1, 2, 3];
  const raw = max / 3;
  const unit = 5 * 10 ** (Math.floor(Math.log10(raw)) - 1);
  const step = Math.max(1, Math.ceil(raw / unit) * unit);
  return [0, step, step * 2, step * 3];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "4 Sep" (or "04 Sep" padded) from a plain date — written out, since locales disagree ("Sept"). */
export function dayLabel(ymd: string, pad = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return ymd;
  const day = pad ? m[3]! : String(Number(m[3]));
  return `${day} ${MONTHS[Number(m[2]) - 1] ?? m[2]}`;
}

function linePath(values: Array<number | null>, x: (i: number) => number, y: (v: number) => number): string {
  let d = '';
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

export function TrendChart({ series }: { series: TrendPoint[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    // jsdom (tests) and very old shells have no ResizeObserver: the chart keeps its default width and still scales.
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (w > 120) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const reach = series.map((p) => p.reach);
  const eng = series.map((p) => (p.engagements === null ? null : p.engagements * ENG_SCALE));
  const max = Math.max(0, ...reach.filter((v): v is number => v !== null), ...eng.filter((v): v is number => v !== null));
  const steps = axisSteps(max);
  const top = steps[steps.length - 1]!;
  const innerW = width - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (series.length > 1 ? (i / (series.length - 1)) * innerW : innerW / 2);
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width || !series.length) return;
    const px = ((e.clientX - r.left) / r.width) * width;
    const i = series.length > 1 ? Math.round(((px - PAD.left) / innerW) * (series.length - 1)) : 0;
    setHover(Math.min(series.length - 1, Math.max(0, i)));
  };

  if (!series.length) return <p className="py-8 text-center text-[12.5px] text-ink-3">No days in this range yet.</p>;

  const first = series[0]!;
  const last = series[series.length - 1]!;
  const summary = `Reach and engagements per day from ${dayLabel(first.date)} to ${dayLabel(last.date)}. On the last day: reach ${last.reach === null ? 'not measured' : full(last.reach)}, engagements ${last.engagements === null ? 'not measured' : full(last.engagements)}.`;
  const h = hover === null ? null : series[hover]!;
  const hx = hover === null ? 0 : x(hover);

  return (
    <div ref={box} className="relative w-full">
      <svg role="img" aria-label={summary} viewBox={`0 0 ${width} ${H}`} width="100%" height={H} preserveAspectRatio="none" onMouseMove={onMove} onMouseLeave={() => setHover(null)} className="block overflow-visible">
        {steps.map((s) => (
          <g key={s}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(s)} y2={y(s)} className="stroke-line" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(s) + 4} textAnchor="end" className="fill-ink-3 text-[10.5px] tabular-nums">
              {axisLabel(s)}
            </text>
          </g>
        ))}
        <text x={PAD.left} y={H - 6} className="fill-ink-3 text-[10.5px]">
          {dayLabel(first.date)}
        </text>
        <text x={width - PAD.right} y={H - 6} textAnchor="end" className="fill-ink-3 text-[10.5px]">
          {dayLabel(last.date)}
        </text>
        <path d={linePath(eng, x, y)} fill="none" className="stroke-warning" strokeWidth={1.8} strokeDasharray="5 4" strokeLinejoin="round" />
        <path d={linePath(reach, x, y)} fill="none" className="stroke-primary" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
        {h ? (
          <g>
            <line x1={hx} x2={hx} y1={PAD.top} y2={PAD.top + innerH} className="stroke-ink-3" strokeWidth={1} strokeDasharray="2 3" />
            {h.reach !== null ? <circle cx={hx} cy={y(h.reach)} r={4} className="fill-primary stroke-surface" strokeWidth={2} /> : null}
            {h.engagements !== null ? <circle cx={hx} cy={y(h.engagements * ENG_SCALE)} r={3.5} className="fill-warning stroke-surface" strokeWidth={2} /> : null}
          </g>
        ) : null}
      </svg>
      {h ? (
        <div
          aria-hidden
          className="pointer-events-none absolute top-1 z-10 min-w-[150px] rounded-[8px] border border-line bg-surface px-3 py-2 text-[12px] shadow-lg"
          style={{ left: `${(hx / width) * 100}%`, transform: hx > width * 0.65 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)' }}
        >
          <div className="font-semibold text-ink">{dayLabel(h.date)}</div>
          <div className="flex justify-between gap-3 text-ink-2">
            <span>Reach</span>
            <span className="font-semibold tabular-nums">{h.reach === null ? 'Not measured' : full(h.reach)}</span>
          </div>
          <div className="flex justify-between gap-3 text-ink-2">
            <span>Engagements</span>
            <span className="font-semibold tabular-nums">{h.engagements === null ? 'Not measured' : full(h.engagements)}</span>
          </div>
        </div>
      ) : null}
      <table className="sr-only">
        <caption>Reach and engagements per day</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Reach</th>
            <th scope="col">Engagements</th>
          </tr>
        </thead>
        <tbody>
          {series.map((p) => (
            <tr key={p.date}>
              <th scope="row">{dayLabel(p.date)}</th>
              <td>{p.reach === null ? 'Not measured' : full(p.reach)}</td>
              <td>{p.engagements === null ? 'Not measured' : full(p.engagements)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The legend in the panel's corner. */
export function TrendLegend() {
  return (
    <div className="flex items-center gap-4 text-[12px] text-ink-2" aria-hidden>
      <span className="inline-flex items-center gap-1.5">
        <svg width="18" height="6">
          <line x1="0" x2="18" y1="3" y2="3" className="stroke-primary" strokeWidth={2.2} />
        </svg>
        Reach
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg width="18" height="6">
          <line x1="0" x2="18" y1="3" y2="3" className="stroke-warning" strokeWidth={1.8} strokeDasharray="4 3" />
        </svg>
        Engagements ×10 (dashed)
      </span>
    </div>
  );
}
