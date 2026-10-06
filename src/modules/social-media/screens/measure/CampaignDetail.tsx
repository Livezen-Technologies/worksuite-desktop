import { useMutation } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { errorMessage } from '../../../../core/bridge';
import { useTab } from '../../../../core/tab-context';
import { toast } from '../../../../core/toasts';
import { Button } from '../../../../components/ui';
import { postNetworks, postWhen, SK, socialApi, useCampaign, useInvalidate, type Campaign, type Post } from '../../api';
import { CAMPAIGN_STATUS } from '../../lib/status';
import { excerpt } from '../../lib/text';
import { whenLabel } from '../../lib/time';
import { Field, full, INPUT, NetChips, OptionalView, Panel, Pill, PostStatusPill } from '../../parts';

/**
 * W09's selected campaign (SMM-CPG-001…004): its UTM defaults and notes, results attributed to it end to end, and
 * the posts planned and published in it.
 */

export function CampaignDetail({ id, canEdit }: { id: number; canEdit: boolean }) {
  const q = useCampaign(id);
  return (
    <OptionalView q={q} what="This campaign">
      {(d) => (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <CampaignForm key={d.campaign.id} campaign={d.campaign} canEdit={canEdit} />
            <Results campaign={d.campaign} />
          </div>
          <CampaignPosts campaign={d.campaign} posts={d.posts ?? null} />
        </div>
      )}
    </OptionalView>
  );
}

function CampaignForm({ campaign, canEdit }: { campaign: Campaign; canEdit: boolean }) {
  const { go } = useTab();
  const invalidate = useInvalidate();
  const [goal, setGoal] = useState(campaign.goal ?? '');
  const [budget, setBudget] = useState(campaign.budget_note ?? '');
  const [utmCampaign, setUtmCampaign] = useState(campaign.utm.campaign ?? '');
  const [utmMedium, setUtmMedium] = useState(campaign.utm.medium ?? 'social');
  const [domain, setDomain] = useState(campaign.short_domain ?? '');
  const status = CAMPAIGN_STATUS[campaign.status] ?? { label: campaign.status, tone: 'muted' as const };
  const save = useMutation({
    mutationFn: () => socialApi.saveCampaign(campaign.id, { goal: goal.trim() || null, budget_note: budget.trim() || null, short_domain: domain.trim() || null, utm: { campaign: utmCampaign.trim() || null, medium: utmMedium.trim() || null } }),
    onSuccess: () => {
      invalidate(SK.campaigns, SK.campaign(campaign.id));
      toast('success', 'Campaign saved.');
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <Panel title={campaign.name} action={<Pill tone={status.tone}>{status.label}</Pill>}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Goal">
            <input className={INPUT} value={goal} disabled={!canEdit} onChange={(e) => setGoal(e.target.value)} placeholder="Webinar sign-ups" />
          </Field>
          <Field label="Owner">
            <input className={INPUT} value={campaign.owner?.name ?? '—'} readOnly disabled />
          </Field>
          <Field label="Budget note" hint="Notes only; paid promotion is not managed in this release">
            <input className={INPUT} value={budget} disabled={!canEdit} onChange={(e) => setBudget(e.target.value)} />
          </Field>
          <Field label="utm_campaign">
            <input className={`${INPUT} font-mono`} value={utmCampaign} disabled={!canEdit} onChange={(e) => setUtmCampaign(e.target.value)} />
          </Field>
          <Field label="utm_medium">
            <input className={`${INPUT} font-mono`} value={utmMedium} disabled={!canEdit} onChange={(e) => setUtmMedium(e.target.value)} />
          </Field>
          <Field label="Short link domain">
            <input className={`${INPUT} font-mono`} value={domain} disabled={!canEdit} onChange={(e) => setDomain(e.target.value)} placeholder="wks.lk" />
          </Field>
        </div>
        <p className="text-[12px] text-ink-3">Every link in this campaign&apos;s posts gets these UTM tags; the network name fills utm_source. Leads arriving through tagged links are attributed in CRM.</p>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit ? (
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
              Save
            </Button>
          ) : null}
          <Button icon="compose" onClick={() => go(`/social-media/compose?campaign=${campaign.id}`)}>
            Create post in campaign
          </Button>
          <Button icon="calendar" onClick={() => go(`/social-media/calendar?campaign=${campaign.id}`)}>
            Open in calendar
          </Button>
          {/* SMM-CPG-004: the API has review links per post only, not for a whole campaign. */}
          <Button icon="link" disabled title="Needs a newer Social Media module on the server">
            Share campaign for review
          </Button>
        </div>
      </div>
    </Panel>
  );
}

/** Bars on a log scale against the largest value, so 41 leads stay visible next to 214,600 reached. */
function Results({ campaign }: { campaign: Campaign }) {
  const r = campaign.results ?? null;
  const rows: Array<{ label: ReactNode; value: number | null }> = [
    { label: 'Reach', value: r?.reach ?? null },
    { label: 'Engagements', value: r?.engagements ?? null },
    { label: campaign.short_domain ? `Link clicks (${campaign.short_domain})` : 'Link clicks', value: r?.clicks ?? campaign.clicks },
    { label: 'Webinar sign-ups (Forms)', value: r?.form_submissions ?? null },
    { label: 'CRM leads created', value: r?.crm_leads ?? campaign.crm_leads },
  ];
  const top = Math.max(1, ...rows.map((x) => x.value ?? 0));
  const scale = (v: number) => (v <= 0 ? 0 : Math.max(2, (Math.log10(v + 1) / Math.log10(top + 1)) * 100));
  return (
    <Panel title="Results so far" sub="Bar lengths are on a logarithmic scale against the largest figure, so small counts stay visible.">
      <ul className="flex flex-col gap-3" title="Bar lengths use a logarithmic scale against the largest figure">
        {rows.map((x, i) => (
          <li key={i} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
              <span className="text-ink-2">{x.label}</span>
              {x.value === null ? <span className="text-ink-3">Not measured</span> : <span className="font-bold text-ink tabular-nums">{full(x.value)}</span>}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-subtle" aria-hidden>
              {x.value !== null ? <div className="h-full rounded-full bg-primary" style={{ width: `${scale(x.value)}%` }} /> : null}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function CampaignPosts({ campaign, posts }: { campaign: Campaign; posts: Post[] | null }) {
  const { go } = useTab();
  return (
    <Panel title="Posts in this campaign" sub={`${campaign.posts_planned} planned · ${campaign.posts_published} published`}>
      {posts === null ? (
        <p className="text-[12.5px] text-ink-3">This server does not list a campaign’s posts yet.</p>
      ) : posts.length ? (
        <ul className="flex flex-col divide-y divide-line">
          {posts.map((p) => {
            const when = postWhen(p);
            return (
              <li key={p.id}>
                <button type="button" onClick={() => go(`/social-media/posts/${p.id}`)} className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-subtle">
                  <NetChips networks={postNetworks(p)} size={20} />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{p.internal_title || excerpt(p.base_text, 90)}</span>
                  <span className="shrink-0 text-[12px] text-ink-3">{when ? whenLabel(when) : 'Not scheduled'}</span>
                  <PostStatusPill status={p.status} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[12.5px] text-ink-3">No posts in this campaign yet. Create one to start.</p>
      )}
    </Panel>
  );
}
