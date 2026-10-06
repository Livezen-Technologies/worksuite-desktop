import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiGet } from '../../core/api';
import { useTab } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { refreshMarketing, send, withOrg } from './api';
import { audienceWords, bounceGuarded, delivered, rateWords, stamp, Tabs, useHumanOpens, useLists, useSegmentNames, useTemplates, wallWords } from './email-kit';
import { CAMPAIGN_PILL, Cell, Empty, Field, PageHeader, Pill, Sheet, THead, btn, btnPrimary, input, n, row } from './parts';
import { companiesWhere, refusal, type Campaign, type CampaignStatus, type Options, type StatusCounts } from './types';

/**
 * Email campaigns (DK06 — W06 in the desktop window): what has gone out, what
 * is going, what is waiting, by status with the server's counts.
 *
 * The figures beside a campaign are its copies' — who it went to when it was
 * sent, not who is on its lists now. "Delivered" is sent and not bounced.
 * "Human opens" counts people, never image proxies or scanners, out of the
 * copies delivered: the list's own figure, or the campaign report's from a
 * server that does not send it with the list yet.
 */
type Tab = CampaignStatus | 'all';

interface CampaignList {
  items: Campaign[];
  total: number;
  tags?: string[];
  /** Per status, ignoring the status asked for. Absent from a server a part behind. */
  counts?: StatusCounts;
}

const TABS: Array<[Tab, string]> = [
  ['all', 'All'], ['draft', 'Drafts'], ['scheduled', 'Scheduled'], ['sending', 'Sending'], ['paused', 'Paused'], ['sent', 'Sent'], ['cancelled', 'Cancelled'],
];

export default function Campaigns({ org, options, onOpen, creating, onCreating }: { org: string; options: Options; onOpen: (id: number) => void; creating: boolean; onCreating: (open: boolean) => void }) {
  const { go } = useTab();
  const [tab, setTab] = useState<Tab>('all');
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const makers = companiesWhere(options, 'campaign_create');
  const lists = useLists(org);
  const segments = useSegmentNames(org);

  useEffect(() => {
    const t = setTimeout(() => setQ(typed.trim()), 300);
    return () => clearTimeout(t);
  }, [typed]);

  const list = useInfiniteQuery({
    queryKey: ['marketing', 'campaigns', org, tab, q],
    queryFn: ({ pageParam, signal }) => apiGet<CampaignList>('/api/marketing/campaigns', withOrg(org, { status: tab === 'all' ? '' : tab, q, page: pageParam, per_page: 50 }), signal),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (all.reduce((s, p) => s + p.items.length, 0) < last.total && last.items.length > 0 ? all.length + 1 : undefined),
  });
  const pages = list.data?.pages ?? [];
  const items = pages.flatMap((p) => p.items);
  const counts = pages[0]?.counts;
  const human = useHumanOpens(items);

  return (
    <div className="flex flex-col">
      <PageHeader
        crumbs={['Email']}
        title="Email campaigns"
        sub="Draft → scheduled → sending ⇄ paused → sent, or cancelled"
        actions={
          <>
            <button type="button" className={btn} onClick={() => go('/marketing?view=templates')}>
              <Icon name="file-text" size={15} /> Templates
            </button>
            {makers.length > 0 ? (
              <button type="button" className={btnPrimary} onClick={() => onCreating(true)}>
                <Icon name="plus" size={15} /> New campaign
              </button>
            ) : null}
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-line">
        <Tabs
          label="Campaigns by status"
          value={tab}
          onChange={setTab}
          items={TABS.map(([id, word]) => ({ id, label: typeof counts?.[id] === 'number' ? `${word} (${counts[id]!.toLocaleString()})` : word }))}
        />
        <input type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Name or subject" aria-label="Search campaigns" className={cx(input, 'mb-2 w-full sm:w-60')} />
      </div>

      {list.isLoading ? (
        <Spinner label="Loading campaigns…" />
      ) : list.error ? (
        <ErrorNote error={new Error(refusal(list.error, 'The campaigns could not be loaded.'))} onRetry={() => void list.refetch()} />
      ) : (
        <div className="overflow-x-auto rounded-[12px] border border-line bg-surface scroll-thin">
          <div className="min-w-[880px]">
            <THead cols={[['Campaign', null], ['Status', 180], ['Audience', 190], ['Send', 210], ['Delivered', 110], ['Human opens', 100]]} />
            {items.map((c) => (
              <button key={c.id} type="button" onClick={() => onOpen(c.id)} className={cx(row, 'w-full text-left hover:bg-subtle focus-visible:bg-subtle')}>
                <Cell w={null}>
                  <span className="flex items-center gap-1.5 font-bold">
                    <span className="truncate">{c.name}</span>
                    {c.ab ? <Pill tone="violet" dot={false} title="Testing two versions">A/B</Pill> : null}
                  </span>
                  <span className="block truncate text-[11.5px] text-ink-3">
                    {[c.type_label, c.topic?.name, ...(c.tags ?? []).map((t) => `#${t}`)].filter(Boolean).join(' · ') || c.subject || 'No subject yet'}
                  </span>
                </Cell>
                <Cell w={180} className="!overflow-visible">
                  <Pill tone={CAMPAIGN_PILL[c.status] ?? 'slate'} title={c.status_note ?? undefined}>{statusWords(c)}</Pill>
                </Cell>
                <Cell w={190} className="text-ink-2">{audienceWords(c.audience, lists.data?.items, segments.data?.items)}</Cell>
                <Cell w={210} className="text-ink-2">{sendWords(c, options)}</Cell>
                <Cell w={110} className="text-right tabular-nums">{deliveredWords(c)}</Cell>
                <Cell w={100} className="text-right tabular-nums text-ink-2">{rateWords(human.get(c.id), delivered(c))}</Cell>
              </button>
            ))}
            {items.length === 0 ? (
              <Empty text={tab !== 'all' || q ? 'No campaign matches.' : 'No campaigns yet. Write an email, choose who it goes to, check it, and send it — now or at a time you choose.'} />
            ) : null}
          </div>
        </div>
      )}
      {list.hasNextPage ? (
        <button type="button" className={cx(btn, 'mt-3 self-center')} disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
          {list.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </button>
      ) : null}

      {creating ? <NewCampaign options={options} org={org} onClose={() => onCreating(false)} onMade={(id) => { onCreating(false); onOpen(id); }} /> : null}
    </div>
  );
}

/** "Sending · 62%", "Paused · bounce guard", or the status as the server words it. */
function statusWords(c: Campaign): string {
  const total = c.stats?.recipients || c.recipients;
  if (c.status === 'sending' && c.stats && total > 0) return `Sending · ${Math.min(100, Math.round((c.stats.sent / total) * 100))}%`;
  if (bounceGuarded(c)) return 'Paused · bounce guard';
  return c.status_label;
}

function sendWords(c: Campaign, options: Options): string {
  switch (c.status) {
    case 'scheduled':
      return c.local_time && c.local_at ? `${wallWords(c.local_at)} · recipient local time` : stamp(c.scheduled_at);
    case 'sending': {
      const pace = c.pace_per_hour ?? options.sending?.pace;
      return pace ? `Now · paced ${n(pace)}/h` : 'Now';
    }
    case 'paused': {
      const at = bounceGuarded(c) ? /\(([\d.]+)%/.exec(c.status_note ?? '')?.[1] : null;
      return at ? `Paused at ${at}% bounce` : c.status_note || 'Paused';
    }
    case 'sent':
      return `${stamp(c.finished_at ?? c.started_at)}${c.ab?.winner ? ` · winner ${c.ab.winner.toUpperCase()} after ${c.ab.hours} h` : ''}`;
    default:
      return '—';
  }
}

function deliveredWords(c: Campaign): string {
  const d = delivered(c);
  if (d === null || c.status === 'draft' || c.status === 'scheduled') return '—';
  return c.status === 'sending' || c.status === 'paused' ? `${n(d)} / ${n(c.stats?.recipients || c.recipients)}` : n(d);
}

/**
 * A name, a company, and what to start from: a starter that comes with
 * Marketing, one of the company's saved templates, or nothing. The rest is
 * written in the editor.
 */
function NewCampaign({ options, org, onClose, onMade }: { options: Options; org: string; onClose: () => void; onMade: (id: number) => void }) {
  const makers = companiesWhere(options, 'campaign_create');
  const scoped = org.split(',').filter(Boolean).map(Number);
  const [orgId, setOrgId] = useState(String(scoped.length === 1 && makers.some((m) => m.id === scoped[0]) ? scoped[0] : makers.length === 1 ? makers[0]!.id : ''));
  const [name, setName] = useState('');
  const [start, setStart] = useState('s:letter');
  const [busy, setBusy] = useState(false);
  const templates = useTemplates();
  const choices = [
    ...(templates.data?.starters ?? []).map((s) => ({ key: `s:${s.key}`, label: s.name, hint: 'Starter', subject: s.subject, preheader: s.preheader, body_html: s.body_html, template: null as number | null })),
    ...(templates.data?.items ?? []).filter((t) => String(t.org_id) === orgId).map((t) => ({ key: `t:${t.id}`, label: t.name, hint: t.category_label, subject: t.subject ?? '', preheader: t.preheader ?? '', body_html: t.body_html, template: t.id })),
  ];

  if (makers.length === 0) {
    return (
      <Sheet title="New campaign" onClose={onClose} footer={<button type="button" className={btn} onClick={onClose}>Close</button>}>
        <p className="m-0 text-[13px] text-ink-2">Creating a campaign needs permission to create campaigns in one of your companies. An administrator can give it.</p>
      </Sheet>
    );
  }

  const make = async () => {
    const from = choices.find((c) => c.key === start);
    setBusy(true);
    try {
      const r = await send<{ id: number }>('POST', '/api/marketing/campaigns', {
        org_id: Number(orgId),
        name: name.trim(),
        ...(from ? { subject: from.subject, preheader: from.preheader, body_html: from.body_html } : {}),
        ...(from?.template ? { template_id: from.template } : {}),
      });
      toast('success', r.message ?? 'Saved.');
      void refreshMarketing();
      onMade(Number(r.data?.id ?? 0));
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="New campaign"
      width={520}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || name.trim() === '' || orgId === ''} onClick={() => void make()}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </>
      }
    >
      {makers.length > 1 ? (
        <Field label="Company">
          <Select aria-label="Company" value={orgId} onValueChange={setOrgId} placeholder="Choose a company" options={makers.map((c) => ({ value: String(c.id), label: c.name }))} />
        </Field>
      ) : null}
      <Field label="Name" hint="For you and your colleagues; recipients never see it.">
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="October service update" autoFocus maxLength={150} />
      </Field>
      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className="mb-1 text-[12.5px] font-semibold text-ink">Start from</legend>
        {templates.isLoading ? <Spinner label="Loading templates…" /> : null}
        {templates.error ? <p className="m-0 text-[12px] text-danger">{refusal(templates.error, 'The templates could not be loaded; you can still start from nothing.')}</p> : null}
        <div className="grid gap-2 sm:grid-cols-2">
          {[...choices, { key: 'blank', label: 'Nothing', hint: 'An empty email' }].map((o) => (
            <label key={o.key} className={cx('flex cursor-pointer flex-col rounded-[9px] border px-3 py-2 text-[13px]', start === o.key ? 'border-primary bg-selection text-primary' : 'border-line text-ink hover:bg-subtle')}>
              <span className="flex items-center gap-2 font-semibold">
                <input type="radio" name="start-from" value={o.key} checked={start === o.key} onChange={() => setStart(o.key)} className="accent-primary" />
                <span className="truncate">{o.label}</span>
              </span>
              <span className="pl-5 text-[11.5px] text-ink-3">{o.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </Sheet>
  );
}
