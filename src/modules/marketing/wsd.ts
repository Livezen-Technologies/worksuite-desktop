/**
 * What the server says about WhatsApp and SMS campaigns, analytics across
 * campaigns, the calendar and budgets, webhooks and the telephone side of a
 * call (WS-MKT-SRS-002 stream D). Every rule — who may be messaged, what a
 * message costs, what a campaign earned — is the server's; these are its
 * answers, as shapes.
 */

export type ChannelKind = 'whatsapp' | 'sms';
export type ChannelStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'failed';

export interface AudienceRef { lists: number[]; segments: number[]; exclude_lists: number[]; exclude_segments: number[] }

export interface ChannelStats {
  total: number; pending: number; sent: number; delivered: number; read: number; failed: number; skipped: number;
  replied: number; opted_out: number; segments: number; cost: number;
}

export interface ChannelCampaign {
  id: number; org_id: number; channel: ChannelKind; name: string; status: ChannelStatus; status_note: string | null;
  audience: AudienceRef; body: string | null; sender_id: string | null; wa_account_id: number | null; wa_template_id: number | null;
  variables: string[]; recipients: number; cost_estimate: number; scheduled_at: string | null; started_at: string | null;
  finished_at: string | null; created_at: string | null; owner_id: number | null; stats: ChannelStats | null;
}

export interface SmsCount { encoding: 'GSM-7' | 'Unicode'; characters: number; segments: number; per_segment: number }

export interface ChannelEstimate {
  named: number; final: number; left_out: number; text: SmsCount; preview: string; price: number; currency: string; cost: number;
  gateway: { driver: string; label: string; problem: string | null; test: boolean } | null;
}

export interface ChannelMessage {
  id: number; contact_id: number; name: string; to: string; status: string; segments: number; cost: number; error: string | null;
  sent_at: string | null; delivered_at: string | null; read_at: string | null; replied_at: string | null; opted_out_at: string | null;
}

export interface WaTemplate { id: number; name: string; language: string; body: string; category: string | null; variables: number }
export interface WaAccount { id: number; name: string; phone: string | null; status: string; templates: WaTemplate[] }
export interface SmsSetup { org_id: number; driver: string; label: string; sender_id: string; price: number; currency: string; problem: string | null; test: boolean; inbound_url: string }
export interface ChannelSetup { whatsapp: WaAccount[]; sms: SmsSetup[]; drivers: { value: string; label: string }[] }

export const CHANNEL_WORD: Record<ChannelKind, string> = { whatsapp: 'WhatsApp', sms: 'SMS' };
export const CHANNEL_STATUS_WORD: Record<ChannelStatus, string> = {
  draft: 'Draft', scheduled: 'Scheduled', sending: 'Sending', sent: 'Sent', cancelled: 'Cancelled', failed: 'Failed',
};

/* ---------------- Analytics ---------------- */

export interface OverviewRow { key: string; sent: number; delivered: number; opened: number | null; clicked: number; unsubscribed: number; bounced: number; calls: number; connected: number }
export interface Overview { group: 'period' | 'channel' | 'topic'; rows: OverviewRow[]; totals: Omit<OverviewRow, 'key'>; from: string; until: string }
export interface FunnelStage { key: string; label: string; count: number; rate: number | null }
export interface AttributionRow { key: string; label: string; channel: string; revenue: number; deals: number; touches: number }
export interface Attribution { model: 'first' | 'last' | 'linear'; revenue: number; deals: number; unattributed: number; rows: AttributionRow[] }
export interface UtmLink {
  id: number; org_id: number; name: string; url: string; base_url: string; utm_source: string; utm_medium: string; utm_campaign: string;
  utm_term: string | null; utm_content: string | null; visits: number; created_at: string | null;
}
export interface TrackingSite { org_id: number; key: string; snippet: string; views: number; visitors: number; known: number }
export interface ReportSchedule {
  id: number; org_id: number; name: string; report: string; frequency: string; period_days: number; format: string; recipients: string;
  next_at: string | null; last_sent_at: string | null;
}

/* ---------------- Planning ---------------- */

export interface CalendarItem { type: 'email' | 'channel' | 'call' | 'journey' | 'event'; id: number; org_id: number; title: string; channel: string; status: string; start: string; end: string | null }
export interface Budget {
  id: number; org_id: number; name: string; ref_type: string; ref_id: number | null; ref_name: string | null; channel: string | null;
  period_start: string | null; period_end: string | null; currency: string | null; planned: number; actual_manual: number;
  actual_expense: number; actual_sends: number; expense_id: number | null; notes: string | null; cost: number; remaining: number;
  leads: number | null; revenue: number | null; cost_per_lead: number | null; roi: number | null;
}
export interface BudgetTotals { planned: number; cost: number; leads: number | null; revenue: number | null; cost_per_lead: number | null; roi: number | null }

/* ---------------- Webhooks ---------------- */

export interface Webhook {
  id: number; org_id: number; name: string; url: string; events: string[]; active: boolean; failures: number;
  last_status: number | null; last_at: string | null; created_at: string | null; week: { delivered: number; failed: number; pending: number };
}
export interface WebhookDelivery { id: number; event: string; status: 'pending' | 'delivered' | 'failed'; attempts: number; response_code: number | null; response: string | null; next_at: string | null; delivered_at: string | null; created_at: string | null }

/* ---------------- Calls ---------------- */

export interface CallCdr {
  linked: boolean; voip_call_id: number | null; talk_seconds: number | null; disposition: string | null; started_at: string | null;
  recording: string | null; recording_note: string | null; voip: boolean;
}

/** "1:35" for 95 seconds. */
export function talk(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  const m = Math.floor(seconds / 60);

  return `${m}:${String(seconds % 60).padStart(2, '0')}`;
}

/** A money figure as the server gave it, with its currency when it has one. */
export function money(v: number | null | undefined, currency?: string | null): string {
  if (v === null || v === undefined) return '—';

  return `${currency ? `${currency} ` : ''}${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
