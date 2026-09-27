import { call } from '../../core/bridge';
import { cx } from '../../components/ui';
import { Pill } from '../inventory/parts';
import { bandFor, type Band, type Outcome, type Priority, type Remaining } from './api';

/** The screens that stay in the browser for now: the library, reports, settings, and a tender's working tabs. */
export function openWeb(path = '/tenders') {
  void call('app:openInBrowser', { path });
}

/** How long is left, in the server's words, coloured by how soon. */
export function Left({ r, className }: { r: Remaining; className?: string }) {
  const c = r.tone === 'critical' || r.tone === 'closed' ? 'text-danger' : r.tone === 'warning' ? 'text-[#9A4A06] dark:text-warning' : r.tone === 'ok' ? 'text-ink-2' : 'text-ink-3';
  return <span className={cx('whitespace-nowrap', r.tone === 'critical' && 'font-bold', c, className)}>{r.text}</span>;
}

const BAND_TONE: Record<string, 'green' | 'blue' | 'grey' | 'amber' | 'red'> = { green: 'green', blue: 'blue', slate: 'grey', amber: 'amber', red: 'red' };

/** A score with its band's words on hover; "Not scored" rather than a zero. */
export function Score({ score, bands }: { score: number | null; bands: Band[] | undefined }) {
  if (score === null) return <span className="text-[12px] text-ink-3">Not scored</span>;
  const b = bandFor(score, bands);
  return (
    <span title={b ? `${score} — ${b.label}` : String(score)}>
      <Pill tone={b ? (BAND_TONE[b.tone] ?? 'grey') : 'grey'}>{score}</Pill>
    </span>
  );
}

export function PriorityPill({ p }: { p: Priority }) {
  if (p === 'normal') return null;
  return <Pill tone={p === 'critical' ? 'red' : p === 'high' ? 'amber' : 'grey'}>{p === 'critical' ? 'Critical' : p === 'high' ? 'High' : 'Low'}</Pill>;
}

export function OutcomePill({ o }: { o: Outcome }) {
  return <Pill tone={o === 'won' ? 'green' : o === 'open' ? 'blue' : 'grey'}>{o === 'open' ? 'Open' : o === 'won' ? 'Won' : o === 'lost' ? 'Lost' : 'Cancelled'}</Pill>;
}

export function StagePill({ label, outcome }: { label: string; outcome: Outcome }) {
  return <Pill tone={outcome === 'won' ? 'green' : outcome === 'lost' || outcome === 'cancelled' ? 'grey' : 'blue'}>{label}</Pill>;
}

/** "PRB-001 · Ministry of Health", leaving out what is not recorded. */
export const subline = (reference: string | null, organization: string | null) => [reference, organization].filter(Boolean).join(' · ');
