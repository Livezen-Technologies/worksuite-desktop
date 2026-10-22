import type { Audience, TimelineEntry } from './types';

/** Call marketing (phase 3): the shapes the server sends, and the words for them. Copied from the web client's `pages/marketing/calls.ts`. */

export type CallStatus = 'draft' | 'active' | 'paused' | 'completed' | 'cancelled';

export interface CallCampaign {
  id: number; org_id: number; name: string; objective: string | null;
  status: CallStatus; status_label: string; audience: Audience; script_id: number | null;
  priority: 'low' | 'normal' | 'high'; starts_on: string | null; ends_on: string | null;
  calling_from: string | null; calling_until: string | null; max_attempts: number; retry_hours: number;
  owner_id: number | null; agents: number[]; queued: number; launched_at: string | null; completed_at: string | null;
  created_at: string; updated_at: string;
  /* On the list only. */
  calls?: number; connected?: number; waiting?: number; mine?: boolean;
}

export interface Reach { total: number; callable: number; no_phone: number; do_not_call: number; no_consent: number }

export interface CallResults {
  queued: number; waiting: number; done: number; removed: number; ready_now: number; callbacks: number;
  attempted: number; calls: number; connected: number; leads: number;
  outcomes: Record<Outcome, number>; per_contact: number | null;
  agents: { user_id: number; name: string | null; calls: number; connected: number; leads: number }[];
  /* The supervisor's live view. Absent from a server a part behind. */
  claimed_now?: number;
  /** Handed to CRM from a wrap-up, by the old outcome or the switch beside "Interested". */
  handed_over?: number;
  callbacks_due?: number;
  live?: AgentLive[];
}

/** An agent on a campaign, as of now: holding a contact, wrapping up, or idle since their last call. */
export interface AgentLive {
  user_id: number; name: string; state: 'on_call' | 'wrap_up' | 'idle'; since: string | null; idle_minutes: number | null;
  calls_today: number; reached_today: number; interested: number; holding: string | null;
}

/** A contact waiting in my queue, without taking them. */
export interface QueueItem {
  queue_id: number; contact_id: number; name: string; company: string | null; campaign_id: number; campaign: string;
  attempts: number; max_attempts: number; reason: 'new' | 'retry' | 'callback'; last_outcome: string | null;
  last_outcome_label: string | null; note: string | null; due_at: string | null;
}

export interface QueueList { items: QueueItem[]; waiting: number; callbacks_today: number; held: number | null }

export interface CallCampaignDetail {
  campaign: CallCampaign; results: CallResults | null; reach: Reach | null; closed: string | null;
  consent_required: boolean; can: { manage: boolean; call: boolean };
}

export type Section = 'introduction' | 'qualification' | 'pitch' | 'objections' | 'closing' | 'next_action';

export const SECTIONS: [Section, string][] = [
  ['introduction', 'Introduction'], ['qualification', 'Qualification questions'], ['pitch', 'Product pitch'],
  ['objections', 'Objection handling'], ['closing', 'Closing'], ['next_action', 'Next action'],
];

export interface CallScript { id: number; org_id: number; name: string; language: string; sections: Record<Section, string>; archived: boolean; updated_at: string | null; /** Its version number (MKT-CAL-07); absent from a server a part behind. */ version?: number }

export type Outcome = 'interested' | 'qualified' | 'call_back' | 'no_answer' | 'busy' | 'voicemail'
  | 'not_interested' | 'wrong_number' | 'not_decision_maker' | 'bad_number' | 'do_not_call' | 'converted_to_lead';

/** In the order an agent reaches for them: a conversation first, then nobody there, then the end of the road. */
export const OUTCOMES: { key: Outcome; label: string }[] = [
  { key: 'interested', label: 'Interested' }, { key: 'call_back', label: 'Callback' },
  { key: 'not_interested', label: 'Not interested' }, { key: 'no_answer', label: 'No answer' },
  { key: 'busy', label: 'Busy' }, { key: 'voicemail', label: 'Voicemail' },
  { key: 'wrong_number', label: 'Wrong number' }, { key: 'not_decision_maker', label: 'Not decision maker' },
  { key: 'bad_number', label: 'Bad number' }, { key: 'do_not_call', label: 'Do not call' },
];

export const OUTCOME_WORD: Record<string, string> = { ...Object.fromEntries(OUTCOMES.map((o) => [o.key, o.label])), qualified: 'Qualified', converted_to_lead: 'Converted to lead' };


export interface PastCall { id: number; outcome: Outcome; outcome_label: string; notes: string | null; by: string | null; campaign: string | null; at: string; follow_up_at: string | null }

export interface QueueCard {
  queue_id: number; attempts: number; callback: { at: string } | null;
  /** When the agent took them (ISO): the 20-minute release counts from it. Absent from a server a part behind. */
  claimed_at?: string | null;
  campaign: { id: number; org_id: number; name: string; objective: string | null; max_attempts: number };
  script: CallScript | null;
  contact: {
    id: number; name: string; job_title: string | null; company: string | null; website: string | null; industry: string | null;
    phone: string | null; whatsapp: string | null; email: string | null; city: string | null; country: string | null;
    status: string | null; crm_lead_id: number | null;
  };
  calls: PastCall[];
  timeline: TimelineEntry[];
}

export interface QueueAnswer { card: QueueCard | null; why: string | null; closed: { campaign: string; why: string }[]; next_at?: string | null }

export interface Callback {
  queue_id: number; at: string; contact_id: number; name: string; phone: string | null;
  campaign_id: number; campaign: string; assignee: { id: number; name: string | null } | null; notes: string | null;
}
