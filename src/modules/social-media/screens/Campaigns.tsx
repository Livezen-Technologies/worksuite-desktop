import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../../core/bridge';
import { useTab } from '../../../core/tab-context';
import { toast } from '../../../core/toasts';
import { Button, cx, Modal } from '../../../components/ui';
import { dataOf, rowsOf, SK, socialApi, useBrands, useCampaigns, useInvalidate, useModuleStatus, type Campaign } from '../api';
import { useSocialAccess } from '../access';
import { CAMPAIGN_STATUS } from '../lib/status';
import { Check, Field, full, INPUT, NativeSelect, OptionalView, PageBody, PageHeader, Panel, Pill, Table, TD, TR, useBrandScope } from '../parts';
import { CampaignDetail } from './measure/CampaignDetail';
import { dayLabel } from './measure/TrendChart';

/**
 * W09 — Campaigns (WS-SMM-SRS-001 SMM-CPG-001…004, WF-13): posts grouped toward a goal with default UTM tags and a
 * short-link domain, and results followed end to end — reach, clicks, Forms sign-ups and CRM leads attributed through
 * the tagged links. Budget is a note only; paid promotion is out of this release.
 */

const dayMonth = (ymd: string) => dayLabel(ymd, true);

export function campaignDates(c: Pick<Campaign, 'starts_on' | 'ends_on'>): string {
  if (!c.starts_on && !c.ends_on) return 'Ongoing';
  if (c.starts_on && !c.ends_on) return `From ${dayMonth(c.starts_on)}`;
  if (!c.starts_on && c.ends_on) return `Until ${dayMonth(c.ends_on)}`;
  return `${dayMonth(c.starts_on!)} – ${dayMonth(c.ends_on!)}`;
}

export default function Campaigns({ campaignId }: { campaignId: number | null }) {
  const { go } = useTab();
  const access = useSocialAccess(dataOf(useModuleStatus().data)?.permissions);
  const [brandId] = useBrandScope();
  const q = useCampaigns();
  const [creating, setCreating] = useState(false);
  const rows = rowsOf(q.data).filter((c) => !brandId || c.brand_id === brandId || c.id === campaignId);

  return (
    <>
      <PageHeader
        crumb="Plan"
        title="Campaigns"
        actions={
          access.campaigns ? (
            <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
              New campaign
            </Button>
          ) : null
        }
      />
      <PageBody>
        <div className="flex flex-col gap-4">
          <Panel bodyClassName="px-2 pb-2 pt-1">
            <OptionalView q={q} what="Campaigns" compact>
              {() =>
                rows.length ? (
                  <Table head={['Campaign', 'Brand', 'Dates', 'Posts', 'Clicks', 'CRM', 'Status']} minWidth={720}>
                    {rows.map((c) => {
                      const s = CAMPAIGN_STATUS[c.status] ?? { label: c.status, tone: 'muted' as const };
                      const on = c.id === campaignId;
                      return (
                        <tr key={c.id} className={cx(TR, 'cursor-pointer', on ? 'bg-selection' : 'hover:bg-subtle')} onClick={() => go(`/social-media/campaigns/${c.id}`)}>
                          <td className={TD}>
                            {/* The row takes the click; this button is how a keyboard reaches it. */}
                            <button type="button" aria-current={on ? 'true' : undefined} className="text-left font-bold text-ink">
                              {c.name}
                            </button>
                          </td>
                          <td className={cx(TD, 'text-ink-2')}>{c.brand ?? '—'}</td>
                          <td className={cx(TD, 'whitespace-nowrap text-ink-2')}>{campaignDates(c)}</td>
                          <td className={cx(TD, 'whitespace-nowrap text-ink-2')}>
                            {c.posts_planned} · {c.posts_published} published
                          </td>
                          <td className={cx(TD, 'tabular-nums')}>{c.clicks === null ? <span className="text-ink-3">—</span> : full(c.clicks)}</td>
                          <td className={cx(TD, 'whitespace-nowrap')}>{c.crm_leads === null ? <span className="text-ink-3">—</span> : `${full(c.crm_leads)} leads`}</td>
                          <td className={TD}>
                            <Pill tone={s.tone}>{s.label}</Pill>
                          </td>
                        </tr>
                      );
                    })}
                  </Table>
                ) : (
                  <p className="py-8 text-center text-[12.5px] text-ink-3">No campaigns yet{access.campaigns ? '. Create one to group posts toward a goal.' : '.'}</p>
                )
              }
            </OptionalView>
          </Panel>
          {campaignId ? <CampaignDetail id={campaignId} canEdit={access.campaigns} /> : rows.length ? <p className="text-center text-[12.5px] text-ink-3">Choose a campaign to see its UTM tags, results and posts.</p> : null}
        </div>
      </PageBody>
      {creating ? (
        <NewCampaign
          defaultBrand={brandId}
          onClose={() => setCreating(false)}
          onCreated={(c) => {
            setCreating(false);
            go(`/social-media/campaigns/${c.id}`);
          }}
        />
      ) : null}
    </>
  );
}

function NewCampaign({ defaultBrand, onClose, onCreated }: { defaultBrand: number | null; onClose: () => void; onCreated: (c: Campaign) => void }) {
  const brands = rowsOf(useBrands().data);
  const invalidate = useInvalidate();
  const [name, setName] = useState('');
  const [brand, setBrand] = useState(defaultBrand ? String(defaultBrand) : '');
  const [ongoing, setOngoing] = useState(false);
  const [starts, setStarts] = useState('');
  const [ends, setEnds] = useState('');
  const [goal, setGoal] = useState('');
  const [utmCampaign, setUtmCampaign] = useState('');
  const [utmMedium, setUtmMedium] = useState('social');
  const [domain, setDomain] = useState('');
  const badDates = !ongoing && !!starts && !!ends && ends < starts;
  const save = useMutation({
    mutationFn: () =>
      socialApi.saveCampaign(null, {
        name: name.trim(),
        brand_id: brand ? Number(brand) : null,
        starts_on: ongoing ? null : starts || null,
        ends_on: ongoing ? null : ends || null,
        goal: goal.trim() || null,
        short_domain: domain.trim() || null,
        utm: { campaign: utmCampaign.trim() || null, medium: utmMedium.trim() || null },
      }),
    onSuccess: (r) => {
      invalidate(SK.campaigns);
      toast('success', `Created “${r.campaign.name}”.`);
      onCreated(r.campaign);
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <Modal
      title="New campaign"
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim() || badDates} loading={save.isPending} onClick={() => save.mutate()}>
            Create campaign
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">
          <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder="WorkSuite 3.2 launch" />
        </Field>
        <Field label="Brand">
          <NativeSelect label="Brand" value={brand} onChange={setBrand}>
            <option value="">No brand</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Goal">
          <input className={INPUT} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Webinar sign-ups" />
        </Field>
        <div className="sm:col-span-2">
          <Check checked={ongoing} onChange={setOngoing}>
            Ongoing (no dates)
          </Check>
        </div>
        {!ongoing ? (
          <>
            <Field label="Starts">
              <input type="date" className={INPUT} value={starts} onChange={(e) => setStarts(e.target.value)} />
            </Field>
            <Field label="Ends" hint={badDates ? <span className="text-danger">Ends before it starts.</span> : undefined}>
              <input type="date" className={INPUT} value={ends} onChange={(e) => setEnds(e.target.value)} />
            </Field>
          </>
        ) : null}
        <Field label="utm_campaign">
          <input className={`${INPUT} font-mono`} value={utmCampaign} onChange={(e) => setUtmCampaign(e.target.value)} placeholder="ws32-launch" />
        </Field>
        <Field label="utm_medium">
          <input className={`${INPUT} font-mono`} value={utmMedium} onChange={(e) => setUtmMedium(e.target.value)} />
        </Field>
        <Field label="Short link domain" className="sm:col-span-2" hint="Links in the campaign's posts are shortened on this domain to count clicks per post.">
          <input className={`${INPUT} font-mono`} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="wks.lk" />
        </Field>
      </div>
    </Modal>
  );
}
