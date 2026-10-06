/**
 * W02 / D02 Create post — under the caption (SMM-CMP-005/008, WF-13): the first comment every network that has one
 * gets, the campaign (its UTM tags fill in), labels, and the tracked link with its UTM source and medium.
 */
import { useState } from 'react';
import { Switch } from '../../../components/ui';
import type { Campaign } from '../api';
import { Field, INPUT, NativeSelect, TEXTAREA } from '../parts';
import { DEFAULT_UTM_MEDIUM, DEFAULT_UTM_SOURCE, taggedLink, type ComposerDraft } from './state';

export const LABELS_INPUT_ID = 'social-composer-labels';
export const LINK_INPUT_ID = 'social-composer-link';

export function Details({ draft, campaigns, campaignsOffered, readOnly, previewNetwork, onChange }: { draft: ComposerDraft; campaigns: Campaign[]; campaignsOffered: boolean; readOnly?: boolean; previewNetwork: string; onChange: (patch: Partial<ComposerDraft>) => void }) {
  const [labels, setLabels] = useState(draft.labels.join(', '));
  const [utm, setUtm] = useState(`${draft.link.utm_source || DEFAULT_UTM_SOURCE} / ${draft.link.utm_medium || DEFAULT_UTM_MEDIUM}`);
  const campaign = campaigns.find((c) => c.id === draft.campaign_id) ?? null;
  const tagged = taggedLink(draft, previewNetwork, campaign);
  return (
    <fieldset disabled={readOnly} className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <Field label="First comment" className="md:col-span-2" hint="Posted right after the post on networks that allow it; a network tab can set its own.">
        <textarea className={TEXTAREA} rows={2} value={draft.first_comment} onChange={(e) => onChange({ first_comment: e.target.value })} />
      </Field>
      <Field label="Campaign" hint={campaignsOffered ? undefined : 'Campaigns aren’t offered by this server yet.'}>
        <NativeSelect
          label="Campaign"
          value={draft.campaign_id ? String(draft.campaign_id) : ''}
          disabled={!campaignsOffered}
          onChange={(v) => {
            const c = campaigns.find((x) => x.id === Number(v)) ?? null;
            onChange({
              campaign_id: c?.id ?? null,
              link: { ...draft.link, utm_campaign: c?.utm.campaign ?? '', utm_medium: c?.utm.medium ?? draft.link.utm_medium, utm_source: c?.utm.source ?? draft.link.utm_source },
            });
            if (c) setUtm(`${c.utm.source ?? draft.link.utm_source} / ${c.utm.medium ?? draft.link.utm_medium}`);
          }}
        >
          <option value="">No campaign</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Labels" hint="Separate with commas.">
        <input
          id={LABELS_INPUT_ID}
          className={INPUT}
          value={labels}
          onChange={(e) => {
            setLabels(e.target.value);
            onChange({ labels: [...new Set(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))] });
          }}
          placeholder="launch, product"
        />
      </Field>
      <Field label="Tracked link">
        <input id={LINK_INPUT_ID} className={INPUT} value={draft.link.url} onChange={(e) => onChange({ link: { ...draft.link, url: e.target.value } })} placeholder="worksuitecloud.com/webinar" />
      </Field>
      <Field label="UTM source / medium">
        <input
          className={INPUT}
          value={utm}
          disabled={!draft.link.tracking}
          onChange={(e) => {
            setUtm(e.target.value);
            const [s = '', m = ''] = e.target.value.split('/').map((x) => x.trim());
            onChange({ link: { ...draft.link, utm_source: s, utm_medium: m } });
          }}
        />
      </Field>
      <div className="flex min-w-0 items-center gap-3 md:col-span-2">
        <Switch checked={draft.link.tracking} onChange={(v) => onChange({ link: { ...draft.link, tracking: v } })} label="Track clicks on the link" />
        <span className="text-[12.5px] text-ink-2">Track clicks</span>
        {tagged ? (
          <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-3" title={tagged}>
            {tagged}
          </span>
        ) : null}
      </div>
    </fieldset>
  );
}
