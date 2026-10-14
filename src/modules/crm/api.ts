import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../core/api';
import type { PageMeta } from './logic';

/**
 * The CRM's server side — the shapes the CRM API returns, copied from the
 * web client's `pages/crm/types.ts` (itself written from the controllers), so
 * a field that is null on the server is null here too. `*_at` stamps are UTC
 * except a follow-up's `due_local`, which is on the clock it was agreed in.
 */
export interface Stage {
  id: number;
  name: string;
  kind: 'open' | 'won' | 'lost';
  colour: string;
  probability: number;
  sort_order?: number;
}

export interface Pipeline {
  id: number;
  name: string;
  is_default: boolean;
  stages: Stage[];
}

export interface Owner { id: number; name: string }

export interface Lead {
  id: number;
  name: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  source: string | null;
  status: string;
  score: number;
  rating: 'hot' | 'warm' | 'cold';
  industry: string | null;
  employees: number | null;
  est_value: number | null;
  currency: string | null;
  city: string | null;
  country: string | null;
  description: string | null;
  tags: string | null;
  unqualified_reason: string | null;
  /** Per company, so two companies both count from LD-00001. */
  lead_no: string | null;
  org_id: number | null;
  /** How the row arrived — typed, a web form, a spreadsheet — not where the
   *  enquiry came from, which is `source`. */
  channel: string | null;
  channel_label: string | null;
  priority: string;
  first_contacted_at: string | null;
  last_contacted_at: string | null;
  next_followup_at: string | null;
  next_followup_id: number | null;
  /** Computed against the clock on every read, never stored. */
  follow_up: 'overdue' | 'due' | 'upcoming' | 'none';
  owner_id: number | null;
  owner_name: string | null;
  converted: boolean;
  converted_account_id: number | null;
  converted_contact_id: number | null;
  converted_deal_id: number | null;
  last_activity_at: string | null;
  created_at: string | null;
}

export interface TimelineEntry {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  author: string | null;
  at: string;
  link_type?: string | null;
  link_id?: number | null;
}

export interface Duplicate {
  id: number;
  name: string;
  company: string | null;
  email: string | null;
  confidence: 'certain' | 'likely' | 'possible';
  why: string;
}

/** The score is returned with its workings, and the UI shows them. */
export interface Score {
  score: number;
  rating: string;
  reasons: Record<string, number>;
}

export interface LeadDetail {
  lead: Lead;
  score: Score;
  duplicates: Duplicate[];
  timeline: TimelineEntry[];
}

export interface Deal {
  id: number;
  name: string;
  account_id: number | null;
  account_name: string | null;
  contact_id: number | null;
  contact_name: string | null;
  owner_id: number | null;
  owner_name: string | null;
  pipeline_id: number;
  stage_id: number;
  amount: number;
  currency: string;
  close_date: string | null;
  source: string | null;
  tags: string | null;
  won_at: string | null;
  lost_at: string | null;
  lost_reason: string | null;
  days_in_stage: number;
  last_activity_at: string | null;
  overdue: boolean;
}

export interface BoardColumn extends Stage {
  count: number;
  total: number;
  weighted: number;
  deals: Deal[];
}

export interface Board {
  pipeline: { id: number } | null;
  columns: BoardColumn[];
  /** The board's StatusBar, from servers that send it; else worked out from the open columns. */
  meta?: { deals?: number; open_value?: number; weighted?: number } | null;
}

export interface Account {
  id: number;
  name: string;
  account_type: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  industry: string | null;
  employees: number | null;
  annual_revenue: number | null;
  currency: string;
  health: 'good' | 'watch' | 'at_risk' | null;
  tags: string | null;
  status: string;
  owner_id: number | null;
  owner_name: string | null;
  parent_id: number | null;
  parent_name?: string | null;
  notes?: string | null;
  deal_count: number | null;
  open_value: number | null;
  contact_count: number | null;
  last_activity_at: string | null;
  created_at: string | null;
  billing?: { street: string | null; city: string | null; country: string | null };
  shipping?: { street: string | null; city: string | null; country: string | null };
}

/** Customer 360 — everything the product already knows, in one response. */
export interface AccountDetail {
  account: Account;
  summary: {
    open_deals: number; open_value: number; won_value: number; lost_count: number;
    contacts: number; projects: number; meetings: number; open_tasks: number; quotes: number;
  };
  contacts: { id: number; name: string; job_title: string | null; email: string | null; phone: string | null; is_primary: boolean }[];
  deals: { id: number; name: string; amount: number; currency: string; stage: string; stage_kind: string; colour: string; close_date: string | null; owner: string | null }[];
  quotes: { id: number; quote_no: string; status: string; total: number; currency: string; issued_on: string | null; file_id: number | null }[];
  meetings: { id: number; title: string; type: string | null; status: string; start_at: string; end_at: string | null }[];
  projects: { id: number; name: string; status: string | null; start_date: string | null; end_date: string | null }[];
  timeline: TimelineEntry[];
}

export interface QuoteLine {
  id?: number;
  product_id: number | null;
  description: string;
  quantity: number;
  unit_price: number;
  discount_pct: number;
  tax_rate: number;
  line_total?: number;
}

export interface Quote {
  id: number;
  quote_no: string;
  status: 'draft' | 'sent' | 'accepted' | 'declined' | 'expired';
  account_id: number | null;
  account: string | null;
  deal_id: number | null;
  deal: string | null;
  owner: string | null;
  owner_id: number | null;
  currency: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  issued_on: string | null;
  valid_until: string | null;
  sent_at: string | null;
  file_id: number | null;
  expired: boolean;
  contact_id?: number | null;
  contact?: string | null;
  contact_email?: string | null;
  billing_address?: string | null;
  decline_reason?: string | null;
  /** The Billing invoice made from it, once one is. */
  invoice_id?: number | null;
  invoice_no?: string | null;
  /** What the server offers on it; `invoice` false where Billing cannot make one. */
  can?: { accept?: boolean; decline?: boolean; invoice?: boolean } | null;
  notes?: string | null;
  terms?: string | null;
  lines?: QuoteLine[];
}

export interface Product {
  id: number;
  code: string | null;
  name: string;
  description: string | null;
  kind: 'product' | 'service' | 'subscription' | 'bundle';
  unit_price: number;
  currency: string;
  tax_rate: number;
  unit: string | null;
  active: boolean;
}

export interface DashboardData {
  scope: 'mine' | 'team';
  pipeline: { id: number; name: string } | null;
  stages: (Stage & { deals: number; total: number; weighted: number })[];
  kpi: {
    open_deals: number; open_value: number; forecast: number;
    won_month: number; won_month_count: number; lost_month_count: number;
    win_rate: number | null; won_total: number; lost_count: number;
    leads_new: number; leads_open: number; tasks_today: number; meetings_today: number;
  };
  lead_status: Record<string, number>;
  lead_sources: { source: string; count: number }[];
  stalled: { id: number; name: string; amount: number; currency: string; stage: string; account: string | null; days: number }[];
  recent: { subject_type: string; subject_id: number; kind: string; title: string; author: string | null; at: string }[];
  /** How many days without a stage change counted as stalled, as configured. */
  stale_days?: number;
}

/**
 * The second half of the dashboard, asked for separately.
 *
 * A month of intake deliveries, the quote book, every open follow-up and a
 * group-by over the whole deal table — enough that waiting for it would leave
 * the screen blank on arrival.
 */
export interface DashboardDetail {
  followups: {
    overdue: number; today: number; upcoming: number;
    next: { id: number; lead_id: number; who: string; kind: string; note: string | null; assignee: string | null; due_at: string; late: boolean }[];
  };
  intake: {
    from: string;
    sources: { id: number; name: string; kind: string; active: boolean; received: number; last_received_at: string | null; created: number; duplicate: number; refused: number }[];
  };
  quotes: {
    open: number; open_value: number; accepted: number;
    expiring: { id: number; number: string; total: number; currency: string; account: string | null; valid_until: string }[];
  };
  owners: { name: string; deals: number; value: number }[];
  stale_days: number;
}

export interface CrmSettings {
  quote_prefix: string;
  number_pad: number;
  default_currency: string;
  quote_valid_days: number;
  stale_deal_days: number;
  company_name: string;
  company_address: string;
  company_phone: string;
  company_email: string;
  company_tax_no: string;
  quote_terms: string;
  letterhead_configured: boolean;
}

/**
 * A follow-up, as the server shapes it.
 *
 * `standing` is computed against the clock on every read rather than stored,
 * so a late follow-up says so whether or not any sweep has run — see
 * `FollowUps::standing()`.
 */
export interface FollowUp {
  id: number;
  org_id: number;
  lead_id: number | null;
  lead: string | null;
  company: string | null;
  kind: string;
  kind_label: string;
  /**
   * What it is for ("Confirm the seat count"); on servers with follow-ups on
   * deals and accounts, what it is about instead — `{type, id, label}` — with
   * what it is for in `title`. `subjectOf()` and `whatFor()` read either.
   */
  subject: string | { type: 'lead' | 'deal' | 'account'; id: number; label: string | null } | null;
  title?: string | null;
  notes: string | null;
  assigned_to: number | null;
  assignee: string | null;
  /** The instant it falls at, in UTC. */
  due_at: string;
  /** The zone it was agreed in, which is the zone it is shown in. */
  timezone: string;
  due_local: string;
  priority: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  standing: 'overdue' | 'due' | 'upcoming' | 'completed' | 'cancelled';
  late_minutes: number | null;
  outcome: string | null;
  outcome_label: string | null;
  result_notes: string | null;
  cancel_reason: string | null;
  completed_at: string | null;
  next_id: number | null;
  previous_id: number | null;
}

export interface FollowUpList {
  items: FollowUp[];
  meta?: PageMeta | null;
  counts: { overdue: number; today: number; upcoming: number };
  can: { create: boolean; complete: boolean; view_all: boolean };
}

export interface FollowUpOptions {
  kinds: Record<string, string>;
  outcomes: Record<string, string>;
  /** The outcomes that end the lead, so the form stops offering a next one. */
  closing: string[];
  priorities: Record<string, string>;
  reminders: Record<string, string>;
  statuses: Record<string, string>;
}

/** Reports (W5): won against forecast by month, wins and losses, sources, the sales cycle and each owner. */
export interface CrmReports {
  won_vs_forecast: Array<{ month: string; won: number; forecast: number }>;
  win_loss: { won: number; lost: number; reasons: Array<{ reason: string; count: number }> };
  sources: Array<{ source: string; leads: number; converted: number; rate: number | null }>;
  cycle: { avg_days: number | null; by_stage: Array<{ stage: string; avg_days: number | null }> };
  owners: Array<{ owner_id: number | null; name: string; open: number; won: number; won_value: number; win_rate: number | null }>;
  currency?: string | null;
}

type Scope = { org_id?: number; org?: number };

/** The dashboard's first half; `mine` narrows it to the caller's own work, `scope` to one company. */
export function useDashboard(mine: boolean, scope: Scope = {}) {
  return useQuery({ queryKey: ['crm', 'dashboard', mine, scope.org_id ?? 0], queryFn: ({ signal }) => apiGet<DashboardData>('/api/crm/dashboard', { ...(mine ? { mine: 1 } : {}), ...scope }, signal) });
}

/** Today's follow-ups and the late count — the rail's red badge. */
export function useFollowUpCounts(scope: Scope = {}) {
  return useQuery({ queryKey: ['crm', 'followups', 'today', false, scope.org_id ?? 0], queryFn: ({ signal }) => apiGet<FollowUpList>('/api/crm/followups', { view: 'today', ...scope }, signal), refetchInterval: 120_000 });
}
