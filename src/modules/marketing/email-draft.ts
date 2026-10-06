import type { Audience, CampaignDetail, Options } from './types';

/**
 * A campaign being written, as the editor's three steps hold it between
 * saves, and the body a save sends — the same fields, in the same words, as
 * the web client's editor sends them (`CampaignsController::update`).
 *
 * Numbers are kept as typed (strings) so a half-typed one is not rewritten
 * under the cursor; the server checks every one of them.
 */
export interface Draft {
  name: string;
  objective: string;
  subject: string;
  preheader: string;
  from_name: string;
  /** The From address before the @, and the sending domain after it. */
  from_local: string;
  from_domain: string;
  reply_to: string;
  body_html: string;
  audience: Audience;
  track_opens: boolean;
  track_clicks: boolean;
  pace_per_hour: string;
  type: string;
  tags: string;
  topic_id: string;
  /* The A/B test: off, or a share of the list, what makes a winner, and how long it runs. B's fields left empty are A's. */
  ab_on: boolean;
  ab_share: string;
  ab_metric: 'opens' | 'clicks';
  ab_hours: string;
  b_subject: string;
  b_preheader: string;
  b_from_name: string;
  b_own: boolean;
  b_body_html: string;
}

export type SetDraft = <K extends keyof Draft>(k: K, v: Draft[K]) => void;

export const AB_DEFAULTS = { share_min: 10, share_max: 50, share: 20, hours_max: 72, hours: 4 };

export function draftOf(c: CampaignDetail, options: Options | undefined): Draft {
  const at = (c.from_email ?? '').lastIndexOf('@');
  const limits = options?.ab_limits ?? AB_DEFAULTS;
  return {
    name: c.name,
    objective: c.objective ?? '',
    subject: c.subject ?? '',
    preheader: c.preheader ?? '',
    from_name: c.from_name ?? '',
    from_local: at > 0 ? (c.from_email ?? '').slice(0, at) : (c.from_email ?? ''),
    from_domain: at > 0 ? (c.from_email ?? '').slice(at + 1) : '',
    reply_to: c.reply_to ?? '',
    body_html: c.body_html ?? '',
    audience: c.audience ?? { lists: [], segments: [], exclude_lists: [], exclude_segments: [] },
    track_opens: c.track_opens,
    track_clicks: c.track_clicks,
    pace_per_hour: c.pace_per_hour ? String(c.pace_per_hour) : '',
    type: c.type ?? '',
    tags: (c.tags ?? []).join(', '),
    topic_id: c.topic ? String(c.topic.id) : '',
    ab_on: !!c.ab,
    ab_share: String(c.ab?.share ?? limits.share),
    ab_metric: c.ab?.metric ?? 'opens',
    ab_hours: String(c.ab?.hours ?? limits.hours),
    b_subject: c.b?.subject ?? '',
    b_preheader: c.b?.preheader ?? '',
    b_from_name: c.b?.from_name ?? '',
    b_own: !!c.b_body_html,
    b_body_html: c.b_body_html ?? '',
  };
}

/** What a save sends: the whole campaign as it is typed. */
export function bodyOf(d: Draft): Record<string, unknown> {
  return {
    name: d.name,
    objective: d.objective,
    subject: d.subject,
    preheader: d.preheader,
    from_name: d.from_name,
    from_email: d.from_local.trim() !== '' && d.from_domain !== '' ? `${d.from_local.trim()}@${d.from_domain}` : '',
    reply_to: d.reply_to,
    body_html: d.body_html,
    audience: d.audience,
    track_opens: d.track_opens,
    track_clicks: d.track_clicks,
    pace_per_hour: d.pace_per_hour === '' ? null : Number(d.pace_per_hour),
    type: d.type,
    tags: d.tags.split(',').map((t) => t.trim()).filter(Boolean),
    topic_id: d.topic_id === '' ? null : Number(d.topic_id),
    ab_share: d.ab_on ? Number(d.ab_share) : 0,
    ab_metric: d.ab_metric,
    ab_hours: Number(d.ab_hours) || AB_DEFAULTS.hours,
    b_subject: d.b_subject,
    b_preheader: d.b_preheader,
    b_from_name: d.b_from_name,
    b_body_html: d.b_own ? d.b_body_html : '',
  };
}
