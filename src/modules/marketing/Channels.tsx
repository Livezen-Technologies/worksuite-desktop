import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../core/api';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { refreshMarketing, send, withOrg } from './api';
import { Confirm } from './email-kit';
import { Card, Cell, Empty, Field, Kpi, PageHeader, Pill, Sheet, THead, btn, btnPrimary, btnSmall, input, n, row, type PillTone } from './parts';
import { companiesWhere, fieldErrors, refusal, type MarketingList, type Options, type Segment } from './types';
import {
  CHANNEL_STATUS_WORD, CHANNEL_WORD, money,
  type ChannelCampaign, type ChannelEstimate, type ChannelKind, type ChannelMessage, type ChannelSetup, type ChannelStatus, type SmsCount,
} from './wsd';
import { StatGrid } from '../../components/StatCard';

const STATUS_TONE: Record<ChannelStatus, PillTone> = { draft: 'slate', scheduled: 'violet', sending: 'blue', sent: 'green', cancelled: 'amber', failed: 'red' };

/**
 * WhatsApp and SMS campaigns on the desktop (MKT-WAP-01..03, MKT-SMS-01..03),
 * on the same endpoints as the web: the server decides who may be messaged on
 * each channel, counts the parts and the cost, sends, and reads back
 * delivered, read, replied and STOP.
 */
export default function Channels({ org, options }: { org: string; options: Options }) {
  const [kind, setKind] = useState<'' | ChannelKind>('');
  const [open, setOpen] = useState<number | 'new' | null>(null);
  const q = useQuery({
    queryKey: ['marketing', 'channels', org, kind],
    queryFn: ({ signal }) => apiGet<{ items: ChannelCampaign[] }>('/api/marketing/channels', withOrg(org, { channel: kind }), signal),
  });
  const may = companiesWhere(options, 'channels').length > 0;
  const items = q.data?.items ?? [];

  if (typeof open === 'number') return <ChannelView id={open} onBack={() => setOpen(null)} />;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader crumbs={['Channels']} title="WhatsApp & SMS" sub="Campaigns to the people who agreed to hear from you on each channel."
        actions={may ? <button type="button" className={btnPrimary} onClick={() => setOpen('new')}><Icon name="plus" size={15} /> New campaign</button> : null} />
      <div className="flex gap-1.5" role="group" aria-label="Channel">
        {(['', 'whatsapp', 'sms'] as const).map((k) => (
          <button key={k || 'all'} type="button" aria-pressed={kind === k} className={cx(btnSmall, kind === k && 'border-primary bg-selection text-primary')} onClick={() => setKind(k)}>
            {k === '' ? 'All' : CHANNEL_WORD[k]}
          </button>
        ))}
      </div>
      <Card padded={false}>
        {q.isLoading ? <Spinner label="Loading campaigns…" /> : q.error ? (
          <div className="p-4"><ErrorNote error={new Error(refusal(q.error, 'The campaigns could not be loaded.'))} onRetry={() => void q.refetch()} /></div>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <div className="min-w-[760px]">
              <THead cols={[['Campaign', null], ['Status', 120], ['Sent', 80], ['Delivered', 90], ['Read', 70], ['Replied', 80], ['Opted out', 90]]} />
              {items.map((c) => (
                <button key={c.id} type="button" onClick={() => setOpen(c.id)} className={cx(row, 'w-full text-left hover:bg-subtle')}>
                  <Cell w={null}><b>{c.name}</b> <span className="text-ink-3">· {CHANNEL_WORD[c.channel]}</span></Cell>
                  <Cell w={120} className="!overflow-visible"><Pill tone={STATUS_TONE[c.status]}>{CHANNEL_STATUS_WORD[c.status]}</Pill></Cell>
                  <Cell w={80} className="text-right tabular-nums">{n(c.stats?.sent ?? 0)}</Cell>
                  <Cell w={90} className="text-right tabular-nums">{n(c.stats?.delivered ?? 0)}</Cell>
                  <Cell w={70} className="text-right tabular-nums">{c.channel === 'sms' ? '—' : n(c.stats?.read ?? 0)}</Cell>
                  <Cell w={80} className="text-right tabular-nums">{n(c.stats?.replied ?? 0)}</Cell>
                  <Cell w={90} className="text-right tabular-nums">{n(c.stats?.opted_out ?? 0)}</Cell>
                </button>
              ))}
              {items.length === 0 ? <Empty text="No WhatsApp or SMS campaigns yet." /> : null}
            </div>
          </div>
        )}
      </Card>
      {open === 'new' ? <ChannelForm org={org} options={options} onClose={() => setOpen(null)} onSaved={(id) => setOpen(id)} /> : null}
    </div>
  );
}

function useSmsCount(text: string): SmsCount | undefined {
  const [debounced, setDebounced] = useState(text);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(text), 300);
    return () => window.clearTimeout(t);
  }, [text]);

  const q = useQuery({
    queryKey: ['marketing', 'sms-count', debounced],
    queryFn: async () => (await send<SmsCount>('POST', '/api/marketing/channels/sms/count', { text: debounced })).data,
    enabled: debounced !== '',
    staleTime: Infinity,
  });

  return debounced === '' ? undefined : q.data;
}

function ChannelForm({ org, options, onClose, onSaved }: { org: string; options: Options; onClose: () => void; onSaved: (id: number) => void }) {
  const companies = companiesWhere(options, 'channels');
  const [orgId, setOrgId] = useState(String(companies[0]?.id ?? ''));
  const [channel, setChannel] = useState<ChannelKind>('sms');
  const [name, setName] = useState('');
  const [list, setList] = useState('');
  const [segment, setSegment] = useState('');
  const [body, setBody] = useState('');
  const [account, setAccount] = useState('');
  const [template, setTemplate] = useState('');
  const [vars, setVars] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const scope = orgId || org;
  const lists = useQuery({ queryKey: ['marketing', 'lists', scope, 'pick'], queryFn: ({ signal }) => apiGet<{ items: MarketingList[] }>('/api/marketing/lists', withOrg(scope), signal) });
  const segments = useQuery({ queryKey: ['marketing', 'segments', scope, 'brief'], queryFn: ({ signal }) => apiGet<{ items: Segment[] }>('/api/marketing/segments', withOrg(scope, { brief: 1 }), signal) });
  const setup = useQuery({ queryKey: ['marketing', 'channel-setup'], queryFn: ({ signal }) => apiGet<ChannelSetup>('/api/marketing/channels/setup', {}, signal) });
  const count = useSmsCount(channel === 'sms' ? body : '');
  const accounts = setup.data?.whatsapp ?? [];
  const tpl = accounts.find((a) => String(a.id) === account)?.templates.find((t) => String(t.id) === template);

  /* A template's numbered variables, each starting as the first name for {{1}} and empty after. */
  const pickTemplate = (v: string) => {
    setTemplate(v);
    const t = accounts.find((a) => String(a.id) === account)?.templates.find((x) => String(x.id) === v);
    setVars(Array.from({ length: t?.variables ?? 0 }, (_, i) => (i === 0 ? '{{first_name}}' : '')));
  };

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      const r = await send<{ id: number }>('POST', '/api/marketing/channels', {
        org_id: Number(orgId), channel, name, audience: { lists: list ? [Number(list)] : [], segments: segment ? [Number(segment)] : [] },
        ...(channel === 'sms' ? { body } : { wa_account_id: Number(account), wa_template_id: Number(template), variables: vars }),
      });
      toast('success', 'Saved as a draft. Check the estimate, then send.');
      void refreshMarketing();
      onSaved(Number(r.data?.id));
    } catch (e) {
      setErrors(fieldErrors(e));
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="New WhatsApp or SMS campaign" width={560} onClose={onClose}
      footer={<><button type="button" className={btn} onClick={onClose}>Cancel</button><button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()}>Save draft</button></>}>
      {companies.length > 1 ? <Field label="Company"><Select aria-label="Company" value={orgId} onValueChange={setOrgId} options={companies.map((c) => ({ value: String(c.id), label: c.name }))} /></Field> : null}
      <Field label="Channel"><Select aria-label="Channel" value={channel} onValueChange={(v) => setChannel(v as ChannelKind)} options={[{ value: 'sms', label: 'SMS' }, { value: 'whatsapp', label: 'WhatsApp' }]} /></Field>
      <Field label="Name" hint={errors.name}><input className={input} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="List"><Select aria-label="List" value={list} onValueChange={setList} options={[{ value: '', label: 'No list' }, ...(lists.data?.items ?? []).map((l) => ({ value: String(l.id), label: l.name }))]} /></Field>
        <Field label="Segment"><Select aria-label="Segment" value={segment} onValueChange={setSegment} options={[{ value: '', label: 'No segment' }, ...(segments.data?.items ?? []).map((s) => ({ value: String(s.id), label: s.name }))]} /></Field>
      </div>
      {channel === 'sms' ? (
        <Field label="Message" hint={errors.body ?? 'Merge tags such as {{first_name}} are filled in for each person. Say how to opt out: Reply STOP.'}>
          <textarea className={cx(input, 'h-28 py-2')} value={body} onChange={(e) => setBody(e.target.value)} />
          {count ? <span className={cx('text-[11.5px] font-medium', count.segments > 1 ? 'text-warning' : 'text-ink-3')} aria-live="polite">{count.encoding} · {count.characters} characters · {count.segments} {count.segments === 1 ? 'part' : 'parts'}</span> : null}
        </Field>
      ) : setup.isLoading ? <Spinner label="Loading WhatsApp numbers…" /> : accounts.length === 0 ? (
        <p className="m-0 text-[12.5px] text-warning">No WhatsApp number you may broadcast from. Connect one in WhatsApp, or ask its owner for broadcast access.</p>
      ) : (
        <>
          <Field label="WhatsApp number"><Select aria-label="WhatsApp number" value={account} onValueChange={(v) => { setAccount(v); setTemplate(''); setVars([]); }} options={accounts.map((a) => ({ value: String(a.id), label: `${a.name}${a.phone ? ` (${a.phone})` : ''}` }))} /></Field>
          <Field label="Approved template" hint={errors.wa_template_id}><Select aria-label="Template" value={template} onValueChange={pickTemplate} options={(accounts.find((a) => String(a.id) === account)?.templates ?? []).map((t) => ({ value: String(t.id), label: `${t.name} (${t.language})` }))} /></Field>
          {tpl ? <p className="m-0 rounded-[8px] bg-selection p-2.5 text-[12.5px] whitespace-pre-line text-ink">{tpl.body}</p> : null}
          {vars.map((v, i) => (
            <Field key={i} label={`Variable {{${i + 1}}}`}><input className={input} value={v} onChange={(e) => setVars(vars.map((x, k) => (k === i ? e.target.value : x)))} /></Field>
          ))}
        </>
      )}
    </Sheet>
  );
}

function ChannelView({ id, onBack }: { id: number; onBack: () => void }) {
  const [filter, setFilter] = useState('');
  const [asking, setAsking] = useState<'launch' | 'cancel' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ['marketing', 'channel', id],
    queryFn: ({ signal }) => apiGet<{ campaign: ChannelCampaign; estimate: ChannelEstimate | null; can: { manage: boolean } }>(`/api/marketing/channels/${id}`, {}, signal),
    refetchInterval: (query) => (query.state.data?.campaign.status === 'sending' ? 10_000 : false),
  });
  const msgs = useQuery({
    queryKey: ['marketing', 'channel-messages', id, filter],
    queryFn: ({ signal }) => apiGet<{ items: ChannelMessage[] }>(`/api/marketing/channels/${id}/messages`, filter ? { status: filter } : {}, signal),
    enabled: Boolean(q.data && q.data.campaign.status !== 'draft'),
  });

  if (q.isLoading) return <Spinner label="Loading the campaign…" />;
  if (q.error || !q.data) return <ErrorNote error={new Error(refusal(q.error, 'That campaign could not be loaded.'))} onRetry={() => void q.refetch()} />;

  const { campaign: c, estimate: e, can } = q.data;
  const s = c.stats;

  const act = async (what: 'launch' | 'cancel' | 'delete') => {
    setBusy(true);
    try {
      const r = what === 'delete' ? await send('DELETE', `/api/marketing/channels/${id}`) : await send('POST', `/api/marketing/channels/${id}/${what}`);
      toast('success', r.message ?? 'Done.');
      void refreshMarketing();
      if (what === 'delete') onBack();
      else void q.refetch();
    } catch (err) {
      toast('error', refusal(err));
    } finally {
      setBusy(false);
      setAsking(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader crumbs={['Channels', 'WhatsApp & SMS']} onCrumb={onBack} title={c.name}
        sub={`${CHANNEL_WORD[c.channel]} · ${CHANNEL_STATUS_WORD[c.status]}${c.status_note ? ` — ${c.status_note}` : ''}`}
        actions={can.manage ? (
          <>
            {c.status === 'draft' ? <button type="button" className={btn} onClick={() => setAsking('delete')}>Delete</button> : null}
            {['scheduled', 'sending'].includes(c.status) ? <button type="button" className={btn} onClick={() => setAsking('cancel')}>Cancel</button> : null}
            {c.status === 'draft' ? <button type="button" className={btnPrimary} disabled={!e || e.final === 0 || Boolean(e.gateway?.problem)} onClick={() => setAsking('launch')}>Send</button> : null}
          </>
        ) : null} />

      {c.status === 'draft' && e ? (
        <Card title="Before it goes">
          {e.gateway?.problem ? <p role="alert" className="m-0 mb-2.5 rounded-[8px] bg-danger-bg p-2.5 text-[12.5px] text-danger">{e.gateway.problem}</p> : null}
          {e.gateway?.test ? <p className="m-0 mb-2.5 rounded-[8px] bg-warning-bg p-2.5 text-[12.5px] text-ink">The SMS gateway is the test one: messages are written to the log, not sent. Choose a gateway under Settings › SMS.</p> : null}
          <StatGrid min={180}>
            <Kpi icon="messages" tone="blue" label="May be messaged" value={n(e.final)} sub={`${n(e.left_out)} of ${n(e.named)} left out`} />
            <Kpi icon="hash" label="Parts per message" value={String(e.text.segments)} sub={`${e.text.encoding}, ${e.text.characters} characters`} />
            {c.channel === 'sms' ? <Kpi icon="calculator" tone="violet" label="Estimated cost" value={money(e.cost, e.currency)} sub={`${money(e.price, e.currency)} a part`} /> : null}
          </StatGrid>
          <p className="m-0 mt-3 text-[11.5px] font-semibold text-ink-3">What the first person gets</p>
          <p className="m-0 mt-1 rounded-[8px] bg-ground p-2.5 text-[12.5px] whitespace-pre-line text-ink">{e.preview}</p>
        </Card>
      ) : null}

      {c.status !== 'draft' && s ? (
        <>
          <StatGrid min={180}>
            <Kpi icon="send" tone="blue" label="Sent" value={n(s.sent)} sub={`${n(s.pending)} waiting`} />
            <Kpi icon="check-check" tone="green" label="Delivered" value={n(s.delivered)} />
            {c.channel === 'whatsapp' ? <Kpi icon="eye" tone="violet" label="Read" value={n(s.read)} /> : <Kpi icon="coins" tone="cyan" label="Cost" value={money(s.cost)} sub={`${n(s.segments)} parts`} />}
            <Kpi icon="reply" tone="green" label="Replied" value={n(s.replied)} />
            <Kpi icon="user-minus" label="Opted out" value={n(s.opted_out)} tone={s.opted_out > 0 ? 'amber' : undefined} />
            <Kpi icon="x-circle" label="Failed" value={n(s.failed)} tone={s.failed > 0 ? 'red' : undefined} sub={`${n(s.skipped)} left out at send`} />
          </StatGrid>
          <Card title="Messages" padded={false} action={(
            <Select aria-label="Show" value={filter} onValueChange={setFilter} className="w-36"
              options={[{ value: '', label: 'All' }, ...['delivered', 'read', 'replied', 'failed', 'skipped', 'pending'].map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) }))]} />
          )}>
            <THead cols={[['Contact', null], ['Number', 140], ['Status', 120], ['Note', 220]]} />
            {(msgs.data?.items ?? []).map((m) => (
              <div key={m.id} className={row}>
                <Cell w={null}>{m.name || `#${m.contact_id}`}</Cell>
                <Cell w={140} className="tabular-nums text-ink-2">{m.to}</Cell>
                <Cell w={120}>{m.status}{m.opted_out_at ? ' · opted out' : m.replied_at ? ' · replied' : ''}</Cell>
                <Cell w={220} className="text-ink-3">{m.error ?? ''}</Cell>
              </div>
            ))}
            {msgs.isLoading ? <Spinner label="Loading…" /> : (msgs.data?.items ?? []).length === 0 ? <Empty text="No messages here." /> : null}
          </Card>
        </>
      ) : null}

      {asking ? (
        <Confirm title={asking === 'launch' ? `Send to ${n(e?.final ?? 0)} people?` : asking === 'cancel' ? 'Cancel the rest?' : 'Delete this draft?'}
          yes={asking === 'launch' ? 'Send now' : asking === 'cancel' ? 'Cancel campaign' : 'Delete'} danger={asking !== 'launch'} busy={busy}
          onYes={() => void act(asking)} onClose={() => setAsking(null)}>
          {asking === 'launch' && c.channel === 'sms' && e ? `About ${money(e.cost, e.currency)} at ${e.text.segments} part(s) each.` : asking === 'cancel' ? 'Messages already sent stay sent.' : 'Nothing has been sent.'}
        </Confirm>
      ) : null}
    </div>
  );
}
