import { useState } from 'react';
import { errorMessage } from '../../../../core/bridge';
import { text } from '../../../../core/i18n';
import { useTab } from '../../../../core/tab-context';
import { dateLabel, timeLabel } from '../../../../core/time';
import { toast } from '../../../../core/toasts';
import { Button, ErrorNote, Spinner, cx } from '../../../../components/ui';
import { VerdictChip } from '../QuarantinePage';
import { runSelfTest, useOverview } from './api';
import { Card, Dot, NO_MANAGE, PROTECTION_BASE, ProtTop, Segmented, num, useAdminPerms } from './parts';
import { SearchRemoveDialog } from './SearchRemove';
import { SelfTestResult } from './Engines';
import type { ProtectionOverview, SelfTest } from '../types';

/**
 * Admin Center › Protection › Overview (D21, P-UI-01, MPR-ADM-02): verdict counts for 24 h / 7 days / 30 days as tiles
 * and a stacked daily chart, the engines, the most targeted people, recent malware and what needs attention. The chart
 * keeps the design's four colours (clean, junk, quarantined, refused) with a legend, a 2px gap between segments, a
 * tooltip per day and a table view, so no count depends on telling colours apart.
 */

const SERIES = [
  { key: 'clean', label: 'Clean', colour: '#7FA3E8' },
  { key: 'junk', label: 'Junk', colour: '#E0A030' },
  { key: 'quarantined', label: 'Quarantined', colour: '#D25B4B' },
  { key: 'refused', label: 'Refused', colour: '#8C2F24' },
] as const;

const pct = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '—');

export function Overview() {
  const [period, setPeriod] = useState<'24h' | '7d' | '30d'>('7d');
  const q = useOverview(period);
  const perms = useAdminPerms();
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<SelfTest | null>(null);
  const [removing, setRemoving] = useState(false);
  const selfTest = async () => {
    setTesting(true);
    try {
      setTest(await runSelfTest('all'));
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setTesting(false);
    }
  };
  return (
    <div className="flex flex-col gap-3.5">
      <ProtTop
        tab="overview"
        held={q.data?.tiles.held_now ?? null}
        actions={
          <>
            <Segmented label={text('Period')} value={period} options={[['24h', text('24 h')], ['7d', text('7 days')], ['30d', text('30 days')]]} onChange={setPeriod} />
            <Button loading={testing} disabled={!perms.manage} title={perms.manage ? undefined : text(NO_MANAGE)} onClick={() => void selfTest()}>
              {text('Run self-test')}
            </Button>
            <Button variant="primary" disabled={!perms.purge} title={perms.purge ? undefined : text('Needs the Search and remove permission.')} onClick={() => setRemoving(true)}>
              {text('Search and remove…')}
            </Button>
          </>
        }
      />
      {test ? <SelfTestResult test={test} onClose={() => setTest(null)} /> : null}
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : q.data ? <OverviewBody o={q.data} /> : null}
      {removing ? <SearchRemoveDialog onClose={() => setRemoving(false)} /> : null}
    </div>
  );
}

function OverviewBody({ o }: { o: ProtectionOverview }) {
  const { go } = useTab();
  const t = o.tiles;
  const tiles = [
    { k: text('Messages checked'), v: num(t.checked), d: text('incoming and outgoing'), tone: 'text-ink' },
    { k: text('Delivered clean'), v: num(t.clean), d: pct(t.clean, t.checked), tone: 'text-success dark:text-success-ink' },
    { k: text('Junk Email'), v: num(t.junk), d: text('{pct} · {n} marked Not junk', { pct: pct(t.junk, t.checked), n: num(t.junk_not_junk) }), tone: 'text-warning-ink dark:text-orange-ink' },
    { k: text('Quarantined'), v: num(t.quarantined), d: text('{held} held now · {n} requests', { held: num(t.held_now), n: num(t.requests) }), tone: 'text-warning-ink dark:text-orange-ink' },
    { k: text('Refused at gateway'), v: num(t.refused), d: text('never accepted'), tone: 'text-ink-2' },
    { k: text('Malware stopped'), v: num(t.malware), d: text('{in} inbound · {out} outgoing', { in: num(t.malware_in), out: num(t.malware_out) }), tone: 'text-danger dark:text-danger-ink' },
  ];
  return (
    <>
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3 2xl:grid-cols-6">
        {tiles.map((x) => (
          <div key={x.k} className="flex flex-col gap-0.5 rounded-[12px] border border-line bg-surface px-3.5 py-3">
            <span className="text-[12px] text-ink-3">{x.k}</span>
            <span className={cx('text-[21px] font-bold tabular-nums', x.tone)}>{x.v}</span>
            <span className="text-[11.5px] text-ink-3">{x.d}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3 xl:flex-row">
        <VerdictChart daily={o.daily} />
        <Card title={text('Engines')} className="xl:w-[372px] xl:shrink-0" extra={<button type="button" onClick={() => go(`${PROTECTION_BASE}/engines`)} className="text-[12px] font-semibold text-primary hover:underline">{text('Open Engines')}</button>}>
          {o.engines.length === 0 ? <p className="text-[12.5px] text-ink-3">{text('No engine has reported yet.')}</p> : null}
          {o.engines.map((e) => (
            <div key={e.key} className="flex items-center gap-2.5">
              <Dot tone={e.state === 'ok' ? 'ok' : e.state === 'warn' ? 'warn' : e.state === 'down' ? 'down' : 'off'} />
              <span className="flex flex-1 flex-col">
                <b className="text-[12.5px] text-ink">
                  {e.name}
                  {e.version ? ` ${e.version}` : ''} <span className="font-normal text-ink-3">· {engineState(e.state)}</span>
                </b>
                <span className="text-[11.5px] text-ink-3">{e.detail}</span>
              </span>
            </div>
          ))}
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_1.3fr_1fr]">
        <Card title={text('Most targeted people')}>
          {o.targets.length === 0 ? <p className="text-[12.5px] text-ink-3">{text('Nobody stands out.')}</p> : null}
          {o.targets.map((p) => (
            <div key={`${p.name}-${p.verdict}`} className="flex h-7 items-center gap-2.5">
              <span className="flex-1 truncate text-[12.5px] font-semibold text-ink">{p.name}</span>
              <VerdictChip verdict={p.verdict} />
              <span className="w-[34px] text-right text-[12.5px] font-bold text-ink tabular-nums">{num(p.count)}</span>
            </div>
          ))}
        </Card>
        <Card title={text('Recent malware')}>
          {o.malware.length === 0 ? <p className="text-[12.5px] text-ink-3">{text('No malware in this period.')}</p> : null}
          {o.malware.map((m, i) => (
            <div key={`${m.threat}-${i}`} className="flex flex-col gap-px border-b border-line pb-1.5">
              <div className="flex gap-2">
                <b className="flex-1 truncate font-mono text-[12.5px] text-ink">{m.threat}</b>
                <span className="text-[11.5px] text-ink-3">{`${dateLabel(m.at)} ${timeLabel(m.at)}`}</span>
              </div>
              <span className="text-[11.5px] text-ink-2">{[m.file, text('to {who}', { who: m.recipient }), m.outcome].filter(Boolean).join(' · ')}</span>
            </div>
          ))}
        </Card>
        <Card title={text('Needs attention')}>
          {o.alerts.length === 0 ? <p className="text-[12.5px] text-ink-3">{text('Nothing needs attention.')}</p> : null}
          {o.alerts.map((a, i) => (
            <div key={`${a.title}-${i}`} className="flex gap-2.5 text-[12.5px] leading-[1.4]">
              <span className="mt-[5px]">
                <Dot tone={a.tone === 'danger' ? 'danger' : a.tone === 'warn' ? 'warn' : 'neutral'} />
              </span>
              <span>
                <b className="font-semibold text-ink">{a.title}</b>
                <br />
                <span className="text-[11.5px] text-ink-3">{a.text}</span>
              </span>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}

export function engineState(s: 'ok' | 'warn' | 'down' | 'off'): string {
  return s === 'ok' ? text('running') : s === 'warn' ? text('needs attention') : s === 'down' ? text('down') : text('off');
}

/** Inbound mail by verdict, a stacked bar a day; hover or focus a day for its numbers; Show as table for all of them. */
export function VerdictChart({ daily }: { daily: ProtectionOverview['daily'] }) {
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...daily.map((d) => d.clean + d.junk + d.quarantined + d.refused));
  const words = (d: ProtectionOverview['daily'][number]) => SERIES.map((s) => `${text(s.label)} ${num(d[s.key])}`).join(' · ');
  return (
    <Card
      className="min-w-0 flex-1"
      title={text('Inbound mail by verdict')}
      extra={
        <span className="flex flex-wrap items-center gap-3.5">
          {SERIES.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 text-[11.5px] text-ink-2">
              <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.colour }} />
              {text(s.label)}
            </span>
          ))}
          <button type="button" aria-pressed={table} onClick={() => setTable(!table)} className="text-[12px] font-semibold text-primary hover:underline">
            {table ? text('Show as chart') : text('Show as table')}
          </button>
        </span>
      }
    >
      {daily.length === 0 ? <p className="text-[12.5px] text-ink-3">{text('No mail in this period.')}</p> : table ? (
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-ink-3">
              <th className="py-1 font-semibold">{text('Day')}</th>
              {SERIES.map((s) => (
                <th key={s.key} className="py-1 text-right font-semibold">{text(s.label)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {daily.map((d) => (
              <tr key={d.date} className="border-t border-line text-ink">
                <td className="py-1">{dateLabel(d.date)}</td>
                {SERIES.map((s) => (
                  <td key={s.key} className="py-1 text-right tabular-nums">{num(d[s.key])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <>
          <div role="img" aria-label={text('Inbound mail by verdict, a bar a day')} className="flex h-[168px] items-end gap-2 border-b border-line pt-1">
            {daily.map((d) => (
              <div key={d.date} tabIndex={0} title={`${dateLabel(d.date)}: ${words(d)}`} aria-label={`${dateLabel(d.date)}: ${words(d)}`} className="flex h-full flex-1 basis-0 flex-col justify-end gap-[2px] outline-none focus-visible:ring-2 focus-visible:ring-primary">
                {[...SERIES].reverse().map((s, i) =>
                  d[s.key] > 0 ? <span key={s.key} className={i === 0 ? 'rounded-t-[4px]' : undefined} style={{ height: `${(d[s.key] / max) * 150}px`, background: s.colour }} /> : null,
                )}
              </div>
            ))}
          </div>
          <div aria-hidden className="flex gap-2 text-[10.5px] text-ink-3">
            {daily.map((d) => (
              <span key={d.date} className="flex-1 basis-0 text-center">{d.date.slice(8, 10)}</span>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
