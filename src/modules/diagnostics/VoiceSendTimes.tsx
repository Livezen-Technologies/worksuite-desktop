import { useStore } from '../../core/store';
import { bytes } from '../../core/time';
import { Button } from '../../components/ui';
import { clearVoiceMetrics, summarize, summarizeByNetwork, voiceMetrics, type VoiceSummary } from '../chat/kit/voiceMetrics';

const ms = (v: number | null) => (v === null ? '–' : v >= 10_000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);

function Row({ label, s }: { label: string; s: VoiceSummary }) {
  return (
    <tr className="border-t border-line">
      <td className="py-1.5 pr-3 font-medium text-ink">{label}</td>
      <td className="py-1.5 pr-3 tabular-nums">{s.count}</td>
      <td className="py-1.5 pr-3 tabular-nums">{ms(s.bubble.median)} / {ms(s.bubble.p95)}</td>
      <td className="py-1.5 pr-3 tabular-nums">{ms(s.confirm.median)} / {ms(s.confirm.p95)}</td>
      <td className="py-1.5 pr-3 tabular-nums">{s.bytesPerMinute === null ? '–' : bytes(s.bytesPerMinute)}</td>
      <td className="py-1.5 pr-3 tabular-nums">{Math.round(s.failureRate * 100)}%</td>
      <td className="py-1.5 tabular-nums">{s.retries}</td>
    </tr>
  );
}

/**
 * Voice messages sent from this computer, timed (worksuite-desktop#300): Send → bubble and Send → "Sent" at median and
 * 95th percentile, size per minute of sound, failures and retries — overall and per connection type. Kept here only.
 */
export function VoiceSendTimes() {
  const samples = useStore(voiceMetrics, (s) => s.samples);
  const all = summarize(samples);
  return (
    <section aria-label="Voice message send times" className="mt-8 rounded-[12px] border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-bold text-ink">Voice message send times</h2>
          <p className="mt-1 text-[12.5px] text-ink-3">The last {samples.length || 'few'} voice messages sent from this computer. Median / 95th percentile. Kept on this computer only.</p>
        </div>
        <Button size="sm" disabled={!samples.length} onClick={clearVoiceMetrics}>Clear</Button>
      </div>
      {samples.length ? (
        <table className="mt-3 w-full text-left text-[12.5px] text-ink-2">
          <thead>
            <tr className="text-[11px] tracking-[0.4px] text-ink-3 uppercase">
              <th className="pb-1 font-semibold">Connection</th>
              <th className="pb-1 font-semibold">Sent</th>
              <th className="pb-1 font-semibold">Send → bubble</th>
              <th className="pb-1 font-semibold">Send → Sent</th>
              <th className="pb-1 font-semibold">Size / minute</th>
              <th className="pb-1 font-semibold">Failed</th>
              <th className="pb-1 font-semibold">Retries</th>
            </tr>
          </thead>
          <tbody>
            <Row label="All" s={all} />
            {summarizeByNetwork(samples).map((g) => <Row key={g.network} label={g.network} s={g.summary} />)}
          </tbody>
        </table>
      ) : (
        <p className="mt-3 text-[12.5px] text-ink-3">No voice messages sent since the times were last cleared.</p>
      )}
    </section>
  );
}
