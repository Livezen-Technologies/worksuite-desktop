import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../../core/api';
import { cx } from '../../components/ui';
import { Seg } from '../hr/parts';
import { fetchScorecard, KP, type Scorecard as Card } from './api';

/**
 * A vendor's weighted scorecard (SRS-PUR-001 G-25; the Vendor design's "Scorecard · last 12 months"): on time, lead
 * time, rejected at the door, price against the market and how fast they answer, each with the weight Purchasing's
 * settings give it, and the score out of 100. The server works it out; a server without it shows nothing here.
 */
const PERIODS = [
  { id: '3m', label: '3 months' },
  { id: '12m', label: '12 months' },
] as const;

const pct = (v: number | null, digits = 0) => (v === null || v === undefined ? '—' : `${Number(v).toFixed(digits)}%`);

export function scoreTone(score: number | null): 'good' | 'fair' | 'poor' | null {
  if (score === null || score === undefined) return null;
  return score >= 80 ? 'good' : score >= 60 ? 'fair' : 'poor';
}

export function Scorecard({ vendorId }: { vendorId: number }) {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['id']>('12m');
  const q = useQuery({ queryKey: KP.scorecard(vendorId, period), queryFn: ({ signal }) => fetchScorecard(vendorId, period, signal), retry: (n, e) => !(e instanceof ApiError && (e.status === 404 || e.status === 403)) && n < 2 });
  if (q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 403)) return null;
  const c: Card | undefined = q.data;
  const tone = scoreTone(c?.score ?? null);
  const w = (k: string) => (c?.weights?.[k] ? ` · weight ${c.weights[k]}` : '');
  const row = (label: string, value: string, key: string) => (
    <span className="flex items-center gap-2 border-b border-line/60 py-1 text-[12.5px] last:border-b-0">
      <span className="flex-1 text-ink">{label}</span>
      <b className="text-ink tabular-nums">{value}</b>
      <span className="w-[80px] text-right text-[11px] text-ink-3">{w(key).replace(' · ', '')}</span>
    </span>
  );
  return (
    <section className="flex flex-col gap-1" aria-label="Scorecard">
      <div className="flex items-center gap-2">
        <b className="text-[13px] text-ink">Scorecard</b>
        {c ? (
          <span className={cx('rounded-[10px] px-2 text-[12px] font-bold tabular-nums', tone === 'good' ? 'bg-success-bg text-success-ink' : tone === 'fair' ? 'bg-warning-bg text-warning-ink' : 'bg-danger-bg text-danger-ink')}>
            {c.score === null ? '—' : Math.round(c.score)} / 100
          </span>
        ) : null}
        <span className="ml-auto">
          <Seg label="Scorecard period" value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ id: p.id, label: p.label }))} />
        </span>
      </div>
      {q.isLoading ? <span className="text-[12px] text-ink-3">Working it out…</span> : null}
      {c ? (
        <div className="flex flex-col">
          {row('On time', pct(c.on_time), 'on_time')}
          {row('Lead time', c.lead_time === null ? '—' : `${Number(c.lead_time).toFixed(1)} days`, 'lead_time')}
          {row('Rejected at the door', pct(c.rejection_rate, 1), 'rejection_rate')}
          {row('Price against the market', c.price_variance === null ? '—' : `${c.price_variance > 0 ? '+' : ''}${Number(c.price_variance).toFixed(1)}%`, 'price_variance')}
          {row('Answers within', c.response_time === null ? '—' : `${Number(c.response_time).toFixed(1)} days`, 'response_time')}
        </div>
      ) : null}
    </section>
  );
}
