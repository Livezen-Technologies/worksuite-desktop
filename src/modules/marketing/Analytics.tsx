import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../core/api';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { refreshMarketing, send, withOrg } from './api';
import { SAVE_REFUSED, saveServerFile, useMaySave } from './audience-files';
import { Tabs } from './email-kit';
import { Card, Cell, Empty, Field, Kpi, PageHeader, Sheet, THead, btn, btnPrimary, btnSmall, input, n, pct, row } from './parts';
import { companiesWhere, fieldErrors, refusal, type Options } from './types';
import { money, type Attribution, type FunnelStage, type Overview, type ReportSchedule, type TrackingSite, type UtmLink } from './wsd';

type Tab = 'overview' | 'funnel' | 'attribution' | 'utm' | 'tracking' | 'schedules';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Results' }, { id: 'funnel', label: 'Funnel' }, { id: 'attribution', label: 'Attribution' },
  { id: 'utm', label: 'UTM links' }, { id: 'tracking', label: 'Site tracking' }, { id: 'schedules', label: 'Scheduled' },
];

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Analytics across campaigns on the desktop (MKT-ANL-01..05): the same
 * endpoints and figures as the web's Insights › Analytics — results by
 * period, channel or topic across email, WhatsApp, SMS and calls; the funnel;
 * attribution; UTM links; the site tracking script; and scheduled reports.
 */
export default function Analytics({ org, options }: { org: string; options: Options }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [from, setFrom] = useState(() => day(new Date(Date.now() - 90 * 86_400_000)));
  const [to, setTo] = useState(() => day(new Date()));
  const maySave = useMaySave();
  const params = withOrg(org, { from, to });
  const dated = tab === 'overview' || tab === 'funnel' || tab === 'attribution';

  const exportAs = async (format: 'csv' | 'pdf') => {
    const report = tab === 'funnel' || tab === 'attribution' ? tab : 'overview';
    try {
      const name = await saveServerFile({ method: 'GET', path: '/api/marketing/reports/export', query: { ...params, report, format } }, `marketing-${report}.${format}`);
      if (name) toast('success', `Saved ${name}.`);
    } catch (e) {
      toast('error', refusal(e, 'The report could not be exported.'));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader crumbs={['Insights']} title="Analytics" sub="Every channel, every campaign, counted by the server."
        actions={dated ? (
          <>
            <input type="date" aria-label="From" className={cx(input, 'w-36')} value={from} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" aria-label="To" className={cx(input, 'w-36')} value={to} onChange={(e) => setTo(e.target.value)} />
            <button type="button" className={btn} disabled={!maySave} title={maySave ? undefined : SAVE_REFUSED} onClick={() => void exportAs('csv')}><Icon name="download" size={15} /> CSV</button>
            <button type="button" className={btn} disabled={!maySave} title={maySave ? undefined : SAVE_REFUSED} onClick={() => void exportAs('pdf')}><Icon name="download" size={15} /> PDF</button>
          </>
        ) : null} />
      <Tabs items={TABS} value={tab} onChange={setTab} label="Analytics" />
      {tab === 'overview' ? <OverviewTab params={params} /> : null}
      {tab === 'funnel' ? <FunnelTab params={params} /> : null}
      {tab === 'attribution' ? <AttributionTab params={params} /> : null}
      {tab === 'utm' ? <UtmTab org={org} options={options} /> : null}
      {tab === 'tracking' ? <TrackingTab org={org} options={options} /> : null}
      {tab === 'schedules' ? <SchedulesTab org={org} options={options} /> : null}
    </div>
  );
}

type Params = Record<string, string | number | boolean>;

function OverviewTab({ params }: { params: Params }) {
  const [group, setGroup] = useState('period');
  const [bucket, setBucket] = useState('week');
  const q = useQuery({
    queryKey: ['marketing', 'analytics', 'overview', params, group, bucket],
    queryFn: ({ signal }) => apiGet<Overview>('/api/marketing/reports/overview', { ...params, group, bucket }, signal),
  });
  const t = q.data?.totals;

  return (
    <>
      {t ? (
        <div className="grid grid-cols-3 gap-2.5 xl:grid-cols-6">
          <Kpi label="Sent" value={n(t.sent)} />
          <Kpi label="Delivered" value={n(t.delivered)} sub={t.sent ? pct((t.delivered / t.sent) * 100) : undefined} />
          <Kpi label="Opened by a person" value={t.opened === null ? '—' : n(t.opened)} sub="email and WhatsApp" />
          <Kpi label="Clicked or replied" value={n(t.clicked)} />
          <Kpi label="Unsubscribed" value={n(t.unsubscribed)} tone={t.unsubscribed > 0 ? 'amber' : undefined} />
          <Kpi label="Calls connected" value={n(t.connected)} sub={`of ${n(t.calls)} calls`} />
        </div>
      ) : null}
      <Card padded={false} title="By" action={(
        <div className="flex gap-2">
          <Select aria-label="Group by" value={group} onValueChange={setGroup} className="w-32" options={[{ value: 'period', label: 'Period' }, { value: 'channel', label: 'Channel' }, { value: 'topic', label: 'Topic' }]} />
          {group === 'period' ? <Select aria-label="Period" value={bucket} onValueChange={setBucket} className="w-28" options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} /> : null}
        </div>
      )}>
        {q.isLoading ? <Spinner label="Loading results…" /> : q.error ? <div className="p-4"><ErrorNote error={new Error(refusal(q.error, 'The results could not be loaded.'))} onRetry={() => void q.refetch()} /></div> : (
          <div className="overflow-x-auto scroll-thin">
            <div className="min-w-[900px]">
              <THead cols={[['', null], ['Sent', 80], ['Delivered', 90], ['Opened', 80], ['Clicked / replied', 120], ['Unsubscribed', 110], ['Bounced / failed', 120], ['Calls', 70], ['Connected', 90]]} />
              {(q.data?.rows ?? []).map((r) => (
                <div key={r.key} className={row}>
                  <Cell w={null} className="font-bold">{r.key}</Cell>
                  {([[r.sent, 80], [r.delivered, 90], [r.opened, 80], [r.clicked, 120], [r.unsubscribed, 110], [r.bounced, 120], [r.calls, 70], [r.connected, 90]] as Array<[number | null, number]>).map(([v, w], i) => (
                    <Cell key={i} w={w} className="text-right tabular-nums">{v === null ? '—' : n(v)}</Cell>
                  ))}
                </div>
              ))}
              {(q.data?.rows ?? []).length === 0 ? <Empty text="Nothing was sent in this period." /> : null}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}

function FunnelTab({ params }: { params: Params }) {
  const q = useQuery({ queryKey: ['marketing', 'analytics', 'funnel', params], queryFn: ({ signal }) => apiGet<{ stages: FunnelStage[] }>('/api/marketing/reports/funnel', params, signal) });
  const stages = q.data?.stages ?? [];
  const top = Math.max(1, stages[0]?.count ?? 1);

  return (
    <Card title="Contacts added in the period, and how far they got">
      {q.isLoading ? <Spinner label="Loading the funnel…" /> : q.error ? <ErrorNote error={new Error(refusal(q.error, 'The funnel could not be loaded.'))} onRetry={() => void q.refetch()} /> : (
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {stages.map((s) => (
            <li key={s.key} className="grid grid-cols-[10rem_1fr_7rem] items-center gap-3 text-[13px]">
              <b className="text-ink">{s.label}</b>
              <span className="h-5 rounded bg-ground" aria-hidden><span className="block h-5 rounded bg-primary" style={{ width: `${Math.max(1, (s.count / top) * 100)}%` }} /></span>
              <span className="text-right tabular-nums">{n(s.count)}{s.rate !== null ? <span className="ml-1 text-[11.5px] text-ink-3">({s.rate}%)</span> : null}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function AttributionTab({ params }: { params: Params }) {
  const [model, setModel] = useState('linear');
  const q = useQuery({ queryKey: ['marketing', 'analytics', 'attribution', params, model], queryFn: ({ signal }) => apiGet<Attribution>('/api/marketing/reports/attribution', { ...params, model }, signal) });
  const a = q.data;

  return (
    <>
      {a ? (
        <div className="grid grid-cols-3 gap-2.5">
          <Kpi label="Won revenue" value={money(a.revenue)} sub={`${n(a.deals)} deals won in CRM`} />
          <Kpi label="Credited to campaigns" value={money(a.revenue - a.unattributed)} />
          <Kpi label="Not touched by marketing" value={money(a.unattributed)} />
        </div>
      ) : null}
      <Card padded={false} title="Revenue by campaign" action={<Select aria-label="Model" value={model} onValueChange={setModel} className="w-36" options={[{ value: 'first', label: 'First touch' }, { value: 'last', label: 'Last touch' }, { value: 'linear', label: 'Linear' }]} />}>
        <THead cols={[['Campaign', null], ['Channel', 100], ['Revenue', 120], ['Deals', 70], ['Touches', 80]]} />
        {(a?.rows ?? []).map((r) => (
          <div key={r.key} className={row}>
            <Cell w={null} className="font-bold">{r.label}</Cell><Cell w={100} className="text-ink-2">{r.channel}</Cell>
            <Cell w={120} className="text-right tabular-nums">{money(r.revenue)}</Cell><Cell w={70} className="text-right tabular-nums">{r.deals}</Cell>
            <Cell w={80} className="text-right tabular-nums">{r.touches}</Cell>
          </div>
        ))}
        {q.isLoading ? <Spinner label="Loading…" /> : (a?.rows ?? []).length === 0 ? <Empty text="No won deal in this period was touched by a campaign." /> : null}
      </Card>
    </>
  );
}

function UtmTab({ org, options }: { org: string; options: Options }) {
  const companies = companiesWhere(options, 'analytics');
  const [f, setF] = useState({ org_id: String(companies[0]?.id ?? ''), base_url: '', utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', utm_term: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const q = useQuery({ queryKey: ['marketing', 'utm', org], queryFn: ({ signal }) => apiGet<{ items: UtmLink[] }>('/api/marketing/utm-links', withOrg(org), signal) });

  const make = async () => {
    setErrors({});
    try {
      const r = await send<{ url: string }>('POST', '/api/marketing/utm-links', { ...f, org_id: Number(f.org_id) });
      void navigator.clipboard?.writeText(r.data?.url ?? '').catch(() => undefined);
      toast('success', 'Link made and copied.');
      void refreshMarketing();
    } catch (e) {
      setErrors(fieldErrors(e));
      toast('error', refusal(e));
    }
  };

  const box = (k: keyof typeof f, label: string, hint?: string) => (
    <Field label={label} hint={errors[k] ?? hint}><input className={input} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
  );

  return (
    <>
      <Card title="Build a link">
        <div className="grid grid-cols-3 gap-2.5">
          {companies.length > 1 ? <Field label="Company"><Select aria-label="Company" value={f.org_id} onValueChange={(v) => setF({ ...f, org_id: v })} options={companies.map((c) => ({ value: String(c.id), label: c.name }))} /></Field> : null}
          <div className="col-span-2">{box('base_url', 'Page address', 'https://…')}</div>
          {box('utm_source', 'Source', 'facebook, newsletter')}
          {box('utm_medium', 'Medium', 'paid-social, email')}
          {box('utm_campaign', 'Campaign', 'spring-sale')}
          {box('utm_content', 'Content (optional)')}
          {box('utm_term', 'Term (optional)')}
        </div>
        <button type="button" className={cx(btnPrimary, 'mt-3')} onClick={() => void make()}><Icon name="plus" size={15} /> Make link</button>
      </Card>
      <Card padded={false} title="Links">
        <THead cols={[['Link', null], ['Campaign', 260], ['Visits', 70], ['', 60]]} />
        {(q.data?.items ?? []).map((l) => (
          <div key={l.id} className={row}>
            <Cell w={null}><b>{l.name}</b> <span className="text-ink-3">{l.url}</span></Cell>
            <Cell w={260} className="text-ink-2">{l.utm_source} / {l.utm_medium} / {l.utm_campaign}</Cell>
            <Cell w={70} className="text-right tabular-nums">{n(l.visits)}</Cell>
            <Cell w={60}><button type="button" className={btnSmall} aria-label={`Copy ${l.name}`} onClick={() => { void navigator.clipboard?.writeText(l.url); toast('success', 'Copied.'); }}><Icon name="copy" size={14} /></button></Cell>
          </div>
        ))}
        {(q.data?.items ?? []).length === 0 && !q.isLoading ? <Empty text="No links yet." /> : null}
      </Card>
    </>
  );
}

function TrackingTab({ org, options }: { org: string; options: Options }) {
  const q = useQuery({ queryKey: ['marketing', 'tracking', org], queryFn: ({ signal }) => apiGet<{ items: TrackingSite[] }>('/api/marketing/tracking', withOrg(org), signal) });

  return (
    <>
      {q.isLoading ? <Spinner label="Loading…" /> : (q.data?.items ?? []).map((s) => (
        <Card key={s.org_id} title={options.companies.find((c) => c.id === s.org_id)?.name ?? 'Your site'}>
          <p className="m-0 text-[12.5px] text-ink-2">Put this on every page of the company’s website. It sets a first-party cookie on your site and reports page views with their UTM values; call <code>wsTrack.identify(email)</code> after a sign-in or a form to link the visits to the contact.</p>
          <pre className="mt-2.5 overflow-x-auto rounded-[8px] bg-ground p-2.5 text-[11.5px] text-ink">{s.snippet}</pre>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11.5px] text-ink-3">Last 30 days: {n(s.views)} page views · {n(s.visitors)} visitors · {n(s.known)} known contacts</span>
            <button type="button" className={btnSmall} onClick={() => { void navigator.clipboard?.writeText(s.snippet); toast('success', 'Copied.'); }}>Copy</button>
          </div>
        </Card>
      ))}
    </>
  );
}

function SchedulesTab({ org, options }: { org: string; options: Options }) {
  const [adding, setAdding] = useState(false);
  const q = useQuery({
    queryKey: ['marketing', 'report-schedules', org],
    queryFn: ({ signal }) => apiGet<{ items: ReportSchedule[]; reports: Array<{ value: string; label: string }>; frequencies: Array<{ value: string; label: string }>; formats: Array<{ value: string; label: string }> }>('/api/marketing/reports/schedules', withOrg(org), signal),
  });
  const companies = companiesWhere(options, 'analytics');
  const [f, setF] = useState({ org_id: String(companies[0]?.id ?? ''), name: 'Weekly marketing results', report: 'overview', frequency: 'weekly', format: 'csv', period_days: '30', recipients: '' });

  const stop = async (s: ReportSchedule) => {
    try {
      await send('DELETE', `/api/marketing/reports/schedules/${s.id}`);
      void q.refetch();
    } catch (e) {
      toast('error', refusal(e));
    }
  };

  const save = async () => {
    try {
      const r = await send('POST', '/api/marketing/reports/schedules', { ...f, org_id: Number(f.org_id), period_days: Number(f.period_days) });
      toast('success', r.message ?? 'Scheduled.');
      setAdding(false);
      void q.refetch();
    } catch (e) {
      toast('error', refusal(e));
    }
  };

  return (
    <Card padded={false} title="Reports emailed on a schedule" action={<button type="button" className={btnSmall} onClick={() => setAdding(true)}>Schedule</button>}>
      <THead cols={[['Name', null], ['Report', 220], ['To', 220], ['Next (UTC)', 150], ['', 70]]} />
      {(q.data?.items ?? []).map((s) => (
        <div key={s.id} className={row}>
          <Cell w={null} className="font-bold">{s.name}</Cell>
          <Cell w={220}>{s.report} · {s.format.toUpperCase()} · {s.frequency}</Cell>
          <Cell w={220} className="text-ink-2">{s.recipients}</Cell>
          <Cell w={150} className="text-ink-2">{s.next_at ?? '—'}</Cell>
          <Cell w={70}><button type="button" className={btnSmall} onClick={() => void stop(s)}>Stop</button></Cell>
        </div>
      ))}
      {(q.data?.items ?? []).length === 0 && !q.isLoading ? <Empty text="No scheduled reports." /> : null}
      {adding ? (
        <Sheet title="Schedule a report" onClose={() => setAdding(false)}
          footer={<><button type="button" className={btn} onClick={() => setAdding(false)}>Cancel</button><button type="button" className={btnPrimary} onClick={() => void save()}>Schedule</button></>}>
          {companies.length > 1 ? <Field label="Company"><Select aria-label="Company" value={f.org_id} onValueChange={(v) => setF({ ...f, org_id: v })} options={companies.map((c) => ({ value: String(c.id), label: c.name }))} /></Field> : null}
          <Field label="Name"><input className={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Report"><Select aria-label="Report" value={f.report} onValueChange={(v) => setF({ ...f, report: v })} options={q.data?.reports ?? []} /></Field>
          <Field label="How often"><Select aria-label="How often" value={f.frequency} onValueChange={(v) => setF({ ...f, frequency: v })} options={q.data?.frequencies ?? []} /></Field>
          <Field label="Format"><Select aria-label="Format" value={f.format} onValueChange={(v) => setF({ ...f, format: v })} options={q.data?.formats ?? []} /></Field>
          <Field label="Covering the last (days)"><input type="number" min={1} max={366} className={input} value={f.period_days} onChange={(e) => setF({ ...f, period_days: e.target.value })} /></Field>
          <Field label="Send to" hint="Email addresses, separated by commas"><input className={input} value={f.recipients} onChange={(e) => setF({ ...f, recipients: e.target.value })} /></Field>
        </Sheet>
      ) : null}
    </Card>
  );
}
