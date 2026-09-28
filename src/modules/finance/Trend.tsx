import { cx } from '../../components/ui';
import { axisShort, chartScale, monthShort, num, shareOf } from './insight';

/**
 * A monthly chart, drawn by hand in SVG.
 *
 * There is no chart library in this app and this does not add one: the whole
 * requirement is grouped bars with a zero line, which is a few dozen lines.
 * What it gives up is zoom and animation. What it keeps is a title, a
 * description, `role="img"` and a `<title>` on every bar, so a screen reader
 * gets the figures rather than "chart".
 *
 * THE ZERO LINE IS COMPUTED, NOT ASSUMED. Profit goes negative, and a chart
 * whose baseline is the bottom of the box draws a loss as a short bar pointing
 * up. The scale spans the true minimum and maximum across every series, so a
 * loss hangs below the line. Bar heights are the one place figures go through
 * Number(); the labels are the server's strings.
 */
export type SeriesTone = 'primary' | 'danger' | 'success';

export interface TrendSeries {
  key: string;
  label: string;
  /** One value per month, as the server's decimal string. */
  values: string[];
  tone: SeriesTone;
}

const FILL: Record<SeriesTone, string> = { primary: 'fill-primary', danger: 'fill-danger', success: 'fill-success' };
const SWATCH: Record<SeriesTone, string> = { primary: 'bg-primary', danger: 'bg-danger', success: 'bg-success' };

export function TrendChart({ labels, series, height = 220, title, description, format }: { labels: string[]; series: TrendSeries[]; height?: number; title: string; description?: string; format: (v: string) => string }) {
  if (labels.length === 0 || series.length === 0) return <p className="m-0 py-8 text-center text-[12.5px] text-ink-3">Nothing to chart for this period.</p>;

  const { max, min, span } = chartScale(series.map((s) => s.values));
  const W = Math.max(320, labels.length * Math.max(44, series.length * 18) + 56);
  const padL = 48;
  const padB = 26;
  const padT = 8;
  const plotH = height - padB - padT;
  const plotW = W - padL - 8;
  const y = (v: number) => padT + ((max - v) / span) * plotH;
  const zeroY = y(0);
  const groupW = plotW / labels.length;
  const barW = Math.max(3, (groupW * 0.7) / series.length);
  // The top, zero, and the bottom when anything is below zero.
  const guides = [max, 0, min].filter((v, i, a) => a.indexOf(v) === i);
  const years = new Set(labels.map((l) => l.slice(0, 4))).size > 1;

  return (
    <figure className="m-0">
      <div className="overflow-x-auto scroll-thin">
        <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} role="img" aria-label={title} className="min-w-[320px] overflow-visible" preserveAspectRatio="xMinYMid meet">
          <title>{title}</title>
          {description ? <desc>{description}</desc> : null}
          {guides.map((g) => (
            <g key={g}>
              <line x1={padL} x2={W - 8} y1={y(g)} y2={y(g)} className={g === 0 ? 'stroke-ink-3' : 'stroke-line'} strokeWidth="1" />
              <text x={padL - 6} y={y(g) + 3} textAnchor="end" className="fill-ink-3 text-[10px] tabular-nums">
                {axisShort(g)}
              </text>
            </g>
          ))}
          {labels.map((label, i) => {
            const gx = padL + i * groupW + (groupW - barW * series.length) / 2;
            return (
              <g key={label}>
                {series.map((s, si) => {
                  const v = num(s.values[i]);
                  const h = Math.abs(y(v) - zeroY);
                  return (
                    // A zero bar still gets a hairline, so "posted nothing" differs from "no column drawn".
                    <rect key={s.key} x={gx + si * barW} y={Math.min(y(v), zeroY)} width={Math.max(2, barW - 2)} height={Math.max(h, v === 0 ? 1 : 0.5)} rx="1" className={FILL[s.tone]}>
                      <title>{`${monthShort(label, true)} · ${s.label}: ${format(s.values[i] ?? '0')}`}</title>
                    </rect>
                  );
                })}
                <text x={padL + i * groupW + groupW / 2} y={height - 8} textAnchor="middle" className="fill-ink-3 text-[10px]">
                  {monthShort(label, years)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-[12px] text-ink-2">
            <span className={cx('h-2.5 w-2.5 rounded-[3px]', SWATCH[s.tone])} aria-hidden="true" />
            {s.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

export type ShareTone = 'primary' | 'danger' | 'success' | 'teal' | 'muted';

const BAR: Record<ShareTone, string> = { primary: 'bg-primary', danger: 'bg-danger', success: 'bg-success', teal: 'bg-teal', muted: 'bg-ink-3' };

/**
 * One category against a total — "how much of the whole is this", where a
 * whole chart would be more furniture than answer.
 */
export function ShareBar({ value, total, tone, className }: { value: string | number; total: string | number; tone: ShareTone; className?: string }) {
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-subtle', className)}>
      <div className={cx('h-full rounded-full', BAR[tone])} style={{ width: `${shareOf(value, total)}%` }} />
    </div>
  );
}
