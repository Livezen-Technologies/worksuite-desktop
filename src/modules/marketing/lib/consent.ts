import type { Basis, Campaign, CampaignStatus, EmailConsent, PhoneConsent, SuppressionReason } from '../api';

/**
 * Consent, suppression and campaign states as Marketing shows them (SRS §6.1, §6.3; design status colours: green
 * sent/subscribed, amber paused/warning, red blocked/suppressed, violet scheduled/planned).
 */
export type Tone = 'muted' | 'indigo' | 'success' | 'warning' | 'danger' | 'violet';

export const EMAIL_CONSENT: Record<EmailConsent, { label: string; tone: Tone }> = {
  subscribed: { label: 'Subscribed', tone: 'success' },
  pending: { label: 'Pending', tone: 'violet' },
  unknown: { label: 'No consent', tone: 'warning' },
  unsubscribed: { label: 'Unsubscribed', tone: 'danger' },
  bounced: { label: 'Bounced', tone: 'danger' },
};

export const PHONE_CONSENT: Record<PhoneConsent, { label: string; tone: Tone }> = {
  consented: { label: 'Consented', tone: 'success' },
  unknown: { label: 'No consent', tone: 'warning' },
  withdrawn: { label: 'Withdrawn', tone: 'danger' },
};

export function emailConsent(s: string | null | undefined): { label: string; tone: Tone } {
  return EMAIL_CONSENT[(s ?? 'unknown') as EmailConsent] ?? { label: s ?? '—', tone: 'muted' };
}

export function phoneConsent(s: string | null | undefined): { label: string; tone: Tone } {
  return PHONE_CONSENT[(s ?? 'unknown') as PhoneConsent] ?? { label: s ?? '—', tone: 'muted' };
}

/** Whether a contact may receive marketing mail: subscribed and not suppressed (constraint C3). */
export function mailable(c: { email: string | null; email_consent: EmailConsent; email_suppressed: boolean }): boolean {
  return !!c.email && c.email_consent === 'subscribed' && !c.email_suppressed;
}

/**
 * Whether a contact may enter a call queue: a phone, not on do-not-call, and — when the company requires it —
 * phone consent (MKT-CON-03, AC-12).
 */
export function callable(c: { phone: string | null; phone_consent: PhoneConsent; do_not_call: boolean }, requirePhoneConsent: boolean): boolean {
  return !!c.phone && !c.do_not_call && (!requirePhoneConsent || c.phone_consent === 'consented');
}

export const BASIS: Array<{ value: Basis; label: string }> = [
  { value: 'consent', label: 'Consent (opt-in)' },
  { value: 'legitimate_interest', label: 'Legitimate interest' },
  { value: 'existing_customer', label: 'Existing customer or vendor' },
  { value: 'contract', label: 'Contract' },
  { value: 'verbal', label: 'Verbal, on a call' },
  { value: 'web_form', label: 'Web form' },
  { value: 'unknown', label: 'Unknown — excluded from sends and calls' },
];

export function basisLabel(b: string | null | undefined): string {
  if (!b) return '—';
  return BASIS.find((x) => x.value === b)?.label ?? b.replace(/_/g, ' ');
}

export const SUPPRESSION: Record<SuppressionReason, { label: string; tone: Tone }> = {
  unsubscribe: { label: 'Unsubscribed', tone: 'indigo' },
  hard_bounce: { label: 'Hard bounce', tone: 'danger' },
  complaint: { label: 'Complaint', tone: 'danger' },
  manual: { label: 'Manual', tone: 'muted' },
  do_not_call: { label: 'Do not call', tone: 'warning' },
};

export function suppressionReason(r: string | null | undefined): { label: string; tone: Tone } {
  return SUPPRESSION[(r ?? '') as SuppressionReason] ?? { label: r ?? '—', tone: 'muted' };
}

/** Campaign states (SRS §6.1): draft → scheduled → sending ⇄ paused → sent, or cancelled. */
export const CAMPAIGN_STATUS: Record<CampaignStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'muted' },
  scheduled: { label: 'Scheduled', tone: 'violet' },
  sending: { label: 'Sending', tone: 'indigo' },
  paused: { label: 'Paused', tone: 'warning' },
  sent: { label: 'Sent', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
};

export function campaignStatus(s: string | null | undefined): { label: string; tone: Tone } {
  return CAMPAIGN_STATUS[(s ?? 'draft') as CampaignStatus] ?? { label: s ?? '—', tone: 'muted' };
}

/** What may be done to a campaign in each state (SRS §6.1). Cancel from draft, scheduled and paused only. */
export function campaignActions(s: CampaignStatus): { edit: boolean; schedule: boolean; unschedule: boolean; pause: boolean; resume: boolean; cancel: boolean; report: boolean } {
  return {
    edit: s === 'draft',
    schedule: s === 'draft',
    unschedule: s === 'scheduled',
    pause: s === 'sending',
    resume: s === 'paused',
    cancel: s === 'draft' || s === 'scheduled' || s === 'paused',
    report: s === 'sending' || s === 'paused' || s === 'sent',
  };
}

/** Where a campaign opens by its state (§6.1): a draft in the editor, a scheduled one in Review & send, else its report. */
export function campaignRoute(c: Pick<Campaign, 'id' | 'status'>): string {
  const base = `/marketing/campaigns/${c.id}`;
  return c.status === 'draft' ? `${base}/content` : c.status === 'scheduled' ? `${base}/review` : `${base}/report`;
}
