import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../core/api';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { send } from './api';
import { stamp } from './email-kit';
import type { WarmupPlan } from './email-governance';
import { Card, Empty, Field, Meter, PageHeader, Pill, Sheet, btn, btnPrimary, btnSmall, input, pct, type PillTone } from './parts';
import { companiesWhere, refusal, type Options } from './types';

interface DomainStats { sent: number; bounce_rate: number | null; complaint_rate: number | null; open_rate: number | null }
interface DomainHealth {
  domain: string; may_send: boolean; reason: string | null; spf: string; dkim: string; dmarc: string; checked_at: string | null;
  stats: DomainStats; health: 'good' | 'warning' | 'bad'; warmup: WarmupPlan | null; advice: string[];
}
interface DomainsAnswer {
  items: DomainHealth[]; org_id: number; seeds: string[];
  limits: { bounce_warn: number; bounce_fail: number; complaint_warn: number; complaint_fail: number };
  warmup_default: { start_cap: number; growth_percent: number; max_cap: number }; can: { manage: boolean };
}

const HEALTH: Record<DomainHealth['health'], [PillTone, string]> = { good: ['green', 'Healthy'], warning: ['amber', 'Needs attention'], bad: ['red', 'At risk'] };

/**
 * Deliverability (MKT-DLV-01/03), as on the web: each sending domain's SPF,
 * DKIM and DMARC, its bounce and complaint rates over 30 days against the
 * lines mailbox providers draw, and its warm-up — the daily cap the sender
 * keeps to.
 */
export default function Deliverability({ org, options }: { org: string; options: Options }) {
  const companies = companiesWhere(options, 'campaigns');
  const [chosen, setChosen] = useState(org || String(companies[0]?.id ?? ''));
  const [plan, setPlan] = useState<DomainHealth | null>(null);
  const orgId = org || chosen;
  const q = useQuery({
    queryKey: ['marketing', 'deliverability-domains', orgId],
    queryFn: ({ signal }) => apiGet<DomainsAnswer>('/api/marketing/deliverability/domains', { org_id: orgId }, signal),
    enabled: orgId !== '',
    retry: false,
  });
  const d = q.data;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader crumbs={['Email']} title="Deliverability" sub="Each sending domain’s authentication, its bounce and complaint rates, and its warm-up"
        actions={!org && companies.length > 1 ? <span className="w-[220px]"><Select aria-label="Company" value={chosen} onValueChange={setChosen} options={companies.map((c) => ({ value: String(c.id), label: c.name }))} /></span> : undefined} />

      {q.isLoading ? <Spinner label="Reading the domains…" /> : !d ? <ErrorNote error={new Error(refusal(q.error, 'Deliverability could not be read.'))} onRetry={() => void q.refetch()} />
        : d.items.length === 0 ? <Card><Empty text="No sending domains yet. Add one under Admin → Mail relay → Domains, and publish its SPF, DKIM and DMARC records." /></Card> : (
          <>
            {d.items.map((x) => (
              <Card key={x.domain} title={<span className="flex flex-wrap items-center gap-2">{x.domain}<Pill tone={HEALTH[x.health][0]}>{HEALTH[x.health][1]}</Pill>{!x.may_send ? <Pill tone="red">Cannot send</Pill> : null}</span>}
                action={d.can.manage ? <button type="button" className={btnSmall} onClick={() => setPlan(x)}>{x.warmup ? 'Warm-up plan' : 'Start a warm-up'}</button> : undefined}>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12.5px]">
                  {([['SPF', x.spf], ['DKIM', x.dkim], ['DMARC', x.dmarc]] as const).map(([k, s]) => (
                    <span key={k} className={cx('inline-flex items-center gap-1', s === 'valid' ? 'text-success' : s === 'failed' ? 'text-danger' : 'text-warning')}>
                      <Icon name={s === 'valid' ? 'check-circle' : s === 'failed' ? 'x-circle' : 'warning'} size={14} />{k} <span className="text-ink-3">{s}</span>
                    </span>
                  ))}
                  <span className="text-ink-3">Checked {stamp(x.checked_at)}</span>
                </div>
                {x.reason ? <p className="m-0 mt-2 text-[12.5px] text-danger">{x.reason}</p> : null}
                <div className="mt-3 grid gap-4 sm:grid-cols-3">
                  <Rate label="Bounces, 30 days" value={x.stats.bounce_rate} warn={d.limits.bounce_warn} fail={d.limits.bounce_fail} of={x.stats.sent} />
                  <Rate label="Complaints, 30 days" value={x.stats.complaint_rate} warn={d.limits.complaint_warn} fail={d.limits.complaint_fail} of={x.stats.sent} />
                  <div><span className="text-[12px] text-ink-3">Human opens, 30 days</span><b className="block text-[18px] text-ink">{pct(x.stats.open_rate)}</b><span className="text-[11.5px] text-ink-3">{x.stats.sent.toLocaleString()} sent</span></div>
                </div>
                {x.warmup ? (
                  <div className="mt-3 rounded-[10px] border border-line p-2.5 text-[12.5px]">
                    <b className="text-ink">Warm-up · {x.warmup.status === 'active' ? `${x.warmup.used_today.toLocaleString()} of ${x.warmup.cap_today.toLocaleString()} today` : x.warmup.status}</b>
                    <span className="ml-2 text-[11.5px] text-ink-3">{x.warmup.growth_percent}% more a day · full {x.warmup.max_cap.toLocaleString()} in {x.warmup.days_to_max} day(s)</span>
                    <div className="mt-2 flex h-16 items-end gap-1" role="img" aria-label="Daily cap for the next 14 days">
                      {x.warmup.schedule.map((s) => {
                        const top = Math.max(...(x.warmup?.schedule ?? []).map((y) => y.cap), 1);
                        return <div key={s.date} className="flex-1 rounded-t bg-primary/70" title={`${s.date}: ${s.cap.toLocaleString()}`} style={{ height: `${Math.max(4, (s.cap / top) * 60)}px` }} />;
                      })}
                    </div>
                  </div>
                ) : null}
                {x.advice.length ? <ul className="m-0 mt-3 list-disc pl-5 text-[12.5px] text-ink-2">{x.advice.map((a) => <li key={a}>{a}</li>)}</ul> : null}
              </Card>
            ))}
            <Card title="Seed inboxes">
              <p className="m-0 text-[12.5px] text-ink-2">{d.seeds.length === 0 ? 'None yet. Add addresses you can look into under Settings → Sending, then send a seed test from a campaign’s review.' : `${d.seeds.join(', ')}. A seed test from a campaign’s review sends it to these.`}</p>
            </Card>
          </>
        )}

      {plan && d ? <WarmupSheet orgId={d.org_id} domain={plan} defaults={d.warmup_default} onClose={() => setPlan(null)} /> : null}
    </div>
  );
}

function Rate({ label, value, warn, fail, of }: { label: string; value: number | null; warn: number; fail: number; of: number }) {
  const tone = value === null ? 'blue' : value >= fail ? 'red' : value >= warn ? 'amber' : 'green';
  return (
    <div>
      <span className="text-[12px] text-ink-3">{label}</span>
      <b className="block text-[18px] text-ink">{value === null ? '—' : `${value}%`}</b>
      <Meter value={value ?? 0} max={Math.max(fail * 1.5, value ?? 0)} tone={tone} label={label} />
      <span className="text-[11.5px] text-ink-3">{of === 0 ? 'Nothing sent in 30 days' : `of ${of.toLocaleString()} · warning at ${warn}%`}</span>
    </div>
  );
}

function WarmupSheet({ orgId, domain, defaults, onClose }: { orgId: number; domain: DomainHealth; defaults: DomainsAnswer['warmup_default']; onClose: () => void }) {
  const qc = useQueryClient();
  const p = domain.warmup;
  const [start, setStart] = useState(String(p?.start_cap ?? defaults.start_cap));
  const [growth, setGrowth] = useState(String(p?.growth_percent ?? defaults.growth_percent));
  const [max, setMax] = useState(String(p?.max_cap ?? defaults.max_cap));
  const [status, setStatus] = useState<string>(p?.status ?? 'active');
  const [restart, setRestart] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const r = await send('POST', '/api/marketing/deliverability/warmup', { org_id: orgId, domain: domain.domain, start_cap: Number(start), growth_percent: Number(growth), max_cap: Number(max), status, restart });
      toast('success', r.message ?? 'Saved.');
      await qc.invalidateQueries({ queryKey: ['marketing', 'deliverability-domains'] });
      onClose();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={`Warm-up · ${domain.domain}`} onClose={onClose}
      footer={<><button type="button" className={btn} onClick={onClose}>Cancel</button><button type="button" className={btnPrimary} disabled={busy} onClick={() => void go()}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <p className="m-0 text-[12px] text-ink-3">The sender hands over no more a day than this allows.</p>
      <div className="grid gap-2.5 sm:grid-cols-3">
        <Field label="First day"><input className={input} type="number" min={10} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="More each day (%)"><input className={input} type="number" min={5} max={200} value={growth} onChange={(e) => setGrowth(e.target.value)} /></Field>
        <Field label="Until a day of"><input className={input} type="number" value={max} onChange={(e) => setMax(e.target.value)} /></Field>
      </div>
      <Field label="Status"><Select aria-label="Status" value={status} onValueChange={setStatus} options={[{ value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused: no cap' }, { value: 'done', label: 'Done' }]} /></Field>
      {p ? <label className="flex items-center gap-2 text-[12.5px] text-ink"><input type="checkbox" checked={restart} onChange={(e) => setRestart(e.target.checked)} />Start again from the first day</label> : null}
    </Sheet>
  );
}
