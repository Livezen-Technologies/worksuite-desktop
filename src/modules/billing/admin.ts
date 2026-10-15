import { apiDelete, apiGet, apiPost, apiPut, request } from '../../core/api';

/**
 * Billing's settings that used to open in the browser (G-37): payment
 * gateways (W14), the Perfex CRM connector, WooCommerce stores and company
 * members — plus payment reminders (dunning, W13) and message templates.
 * Every write is `billing.settings`; members also need `admin` on the company,
 * which the server checks.
 *
 * CREDENTIALS ARE WRITE-ONLY. The server never sends a secret back — only a
 * masked hint ("••••4242") — and these screens never put a hint, or anything
 * else the server said, into a secret's box: a secret box starts empty, and
 * an empty box (or one still holding a hint) leaves the stored secret alone.
 */

const withOrg = (org: string, rest: Record<string, string | number | undefined> = {}) => ({ ...(org ? { org } : {}), ...rest });

export const KA = {
  catalogue: ['billing', 'gateways', 'catalogue'] as const,
  gateways: (org: string) => ['billing', 'gateways', org] as const,
  crm: ['billing', 'crm'] as const,
  woo: ['billing', 'woo'] as const,
  members: (org: string) => ['billing', 'members', org] as const,
  reminders: (org: string) => ['billing', 'reminders', org] as const,
  reminderLog: (org: string) => ['billing', 'reminders', 'log', org] as const,
  templates: (org: string) => ['billing', 'templates', org] as const,
};

// ── gateways (G-02, W14) ────────────────────────────────────────────────

export interface CredentialField {
  key: string;
  label: string;
  /** `secret` is write-only: never shown, never prefilled. */
  type: 'text' | 'secret' | 'select' | 'boolean' | 'url';
  required?: boolean;
  options?: Array<{ value: string; label: string }> | string[];
  hint?: string | null;
}

export interface GatewayCapabilities {
  checkout: boolean;
  webhook: boolean;
  refund: boolean;
  tokens: boolean;
  surcharge: boolean;
}

export interface GatewayKind {
  key: string;
  name: string;
  countries: string[];
  currencies: string[];
  capabilities: GatewayCapabilities;
  credentials_spec: CredentialField[];
}

export interface GatewayAccount {
  id: number;
  gateway: string;
  name: string;
  org_id: number | null;
  enabled: boolean;
  mode: 'test' | 'live';
  /** The fields that are not secret, as saved. */
  credentials: Record<string, string | boolean | null>;
  /** Each secret's masked hint ("••••4242"), or null when none is stored. Never the secret. */
  secrets: Record<string, string | null>;
  webhook_url?: string | null;
  last_test_at?: string | null;
  last_test_ok?: boolean | null;
  capabilities?: Partial<GatewayCapabilities>;
}

/** One catalogue entry, whatever the server calls its field list. */
function kindOf(raw: Record<string, unknown>): GatewayKind {
  const spec = (raw.credentials_spec ?? raw.credentialsSpec ?? raw.credentials ?? raw.fields ?? []) as CredentialField[];
  const caps = (raw.capabilities ?? {}) as Partial<GatewayCapabilities>;
  return {
    key: String(raw.key ?? ''),
    name: String(raw.name ?? raw.key ?? ''),
    countries: (raw.countries as string[]) ?? [],
    currencies: (raw.currencies as string[]) ?? [],
    capabilities: { checkout: !!caps.checkout, webhook: !!caps.webhook, refund: !!caps.refund, tokens: !!caps.tokens, surcharge: !!caps.surcharge },
    credentials_spec: Array.isArray(spec) ? spec.map((f) => ({ ...f, type: f.type ?? 'text' })) : [],
  };
}

export const fetchCatalogue = (signal?: AbortSignal) =>
  apiGet<{ gateways?: Array<Record<string, unknown>>; catalogue?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>>('/api/billing/gateways/catalogue', undefined, signal).then((r) =>
    (Array.isArray(r) ? r : (r.gateways ?? r.catalogue ?? [])).map(kindOf),
  );

/** The accounts: secrets arrive as hints only, and are kept apart from the plain fields here too. */
export const fetchGateways = (org: string, signal?: AbortSignal) =>
  apiGet<{ accounts?: GatewayAccount[]; gateways?: GatewayAccount[] }>('/api/billing/gateways', withOrg(org), signal).then((r) => (r.accounts ?? r.gateways ?? []).filter((a) => a && typeof a === 'object' && 'id' in a));

export const createGateway = (body: GatewayWrite) => apiPost<{ account: GatewayAccount }>('/api/billing/gateways', body);
export const updateGateway = (id: number, body: Partial<GatewayWrite>) => apiPut<{ account: GatewayAccount }>(`/api/billing/gateways/${id}`, body);
export const removeGateway = (id: number) => apiDelete(`/api/billing/gateways/${id}`);
export const testGateway = (id: number) => request<{ ok: boolean; message?: string | null }>('POST', `/api/billing/gateways/${id}/test`, { body: {} });

export interface GatewayWrite {
  gateway: string;
  name: string;
  org_id: number | null;
  enabled: boolean;
  mode: 'test' | 'live';
  credentials: Record<string, string | boolean>;
}

/** A masked hint the server sent, which must never be saved back as if it were the secret. */
export const isMasked = (v: unknown) => typeof v === 'string' && /^(•|\*){3,}/.test(v.trim());

/**
 * What a gateway form sends: every plain field as typed, and a secret only
 * when something new was typed into its box. A blank secret box — or one
 * holding a masked hint — is left out, so the stored secret stays as it is.
 */
export function credentialsPayload(spec: CredentialField[], values: Record<string, string | boolean | undefined>): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const f of spec) {
    const v = values[f.key];
    if (f.type === 'boolean') {
      out[f.key] = !!v;
      continue;
    }
    const s = typeof v === 'string' ? v.trim() : '';
    if (f.type === 'secret') {
      if (s && !isMasked(s)) out[f.key] = s;
      continue;
    }
    if (v !== undefined) out[f.key] = s;
  }
  return out;
}

/**
 * The form's starting values for an account: its plain fields as saved, and
 * every secret EMPTY — whatever the server sent for it. The hint is shown
 * beside the box, never in it.
 */
export function initialCredentials(spec: CredentialField[], account: Pick<GatewayAccount, 'credentials'> | null): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const f of spec) {
    if (f.type === 'secret') {
      out[f.key] = '';
      continue;
    }
    const v = account?.credentials?.[f.key];
    out[f.key] = f.type === 'boolean' ? !!v : typeof v === 'string' && !isMasked(v) ? v : '';
  }
  return out;
}

/** Required fields still missing: a secret counts as present when one is stored (its hint) or typed. */
export function missingFields(spec: CredentialField[], values: Record<string, string | boolean | undefined>, account: Pick<GatewayAccount, 'secrets'> | null): string[] {
  return spec
    .filter((f) => f.required && f.type !== 'boolean')
    .filter((f) => {
      const typed = typeof values[f.key] === 'string' && (values[f.key] as string).trim() !== '' && !isMasked(values[f.key]);
      return !typed && !(f.type === 'secret' && account?.secrets?.[f.key]);
    })
    .map((f) => f.label);
}

export const CAPABILITY_LABEL: Record<keyof GatewayCapabilities, string> = { checkout: 'Pay page', webhook: 'Confirms by webhook', refund: 'Refunds', tokens: 'Saved cards', surcharge: 'Card surcharge' };

// ── CRM connector (Perfex) ──────────────────────────────────────────────

export interface CrmConnection {
  id: number;
  name: string;
  url: string;
  org_id: number | null;
  enabled: boolean;
  auto_apply: boolean;
  configured: boolean;
  key_hint: string | null;
  secret_hint: string | null;
  signing_set: boolean;
  delivery_url: string;
  api_base: string;
  last_sync_at: string | null;
  last_seen_at: string | null;
  event_count?: number;
}
export const fetchCrm = (signal?: AbortSignal) => apiGet<{ connections: CrmConnection[] }>('/api/billing/crm/connections', undefined, signal).then((r) => r.connections ?? []);
export const addCrm = (body: { url: string; name?: string; org_id?: number | null }) => request<{ connection: CrmConnection }>('POST', '/api/billing/crm/connections', { body });
export const updateCrm = (id: number, body: Partial<{ name: string; org_id: number | null; enabled: boolean; auto_apply: boolean; api_key: string; signing_secret: string }>) =>
  request<{ connection: CrmConnection }>('PUT', `/api/billing/crm/connections/${id}`, { body });
export const removeCrm = (id: number) => apiDelete(`/api/billing/crm/connections/${id}`);
export const testCrm = (id: number) => request<{ ok: boolean; message: string }>('POST', `/api/billing/crm/connections/${id}/test`, { body: {} });

// ── WooCommerce stores ──────────────────────────────────────────────────

export interface WooStore {
  id: number;
  name: string;
  url: string;
  org_id: number | null;
  currency: string | null;
  enabled: boolean;
  auto_invoice: boolean;
  configured: boolean;
  key_hint: string | null;
  secret_hint: string | null;
  webhook_set: boolean;
  delivery_url: string;
  last_sync_at: string | null;
  last_seen_at: string | null;
}
export const fetchWoo = (signal?: AbortSignal) => apiGet<{ stores: WooStore[] }>('/api/billing/woo/stores', undefined, signal).then((r) => r.stores ?? []);
export const addWoo = (body: { url: string; name?: string; org_id?: number | null; currency?: string }) => request<{ store: WooStore }>('POST', '/api/billing/woo/stores', { body });
export const updateWoo = (id: number, body: Partial<{ name: string; org_id: number | null; currency: string; enabled: boolean; auto_invoice: boolean; consumer_key: string; consumer_secret: string }>) =>
  request<{ store: WooStore }>('PUT', `/api/billing/woo/stores/${id}`, { body });
export const removeWoo = (id: number) => apiDelete(`/api/billing/woo/stores/${id}`);
export const testWoo = (id: number) => request<{ ok: boolean; message: string }>('POST', `/api/billing/woo/stores/${id}/test`, { body: {} });
/** Mint the store's webhook secret: returned ONCE, to paste into WooCommerce, never readable again. */
export const mintWooSecret = (id: number) => request<{ secret: string; delivery_url: string; topics: string[] }>('POST', `/api/billing/woo/stores/${id}/secret`, { body: {} });

/** A connection's write: the secrets only when something new was typed. */
export function secretsPatch<K extends string>(typed: Record<K, string>): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  for (const [k, v] of Object.entries(typed) as Array<[K, string]>) if (v.trim() && !isMasked(v)) out[k] = v.trim();
  return out;
}

// ── members ─────────────────────────────────────────────────────────────

export interface Member {
  id: number;
  user_id: number;
  name: string;
  email: string | null;
  role: string;
  status: string | null;
  since: string | null;
}
export const fetchMembers = (org: number, signal?: AbortSignal) => apiGet<{ members: Member[]; can_manage: boolean; roles: string[]; shared_note?: string }>('/api/billing/members', { org }, signal);
export const addMember = (body: { org_id: number; user_id: number; role: string }) => request('POST', '/api/billing/members', { body });
export const removeMember = (org: number, userId: number) => request('DELETE', `/api/billing/members/${userId}`, { query: { org } });
export const findAssignable = (q: string, signal?: AbortSignal) => apiGet<{ users: Array<{ id: number; name: string; email: string | null }> }>('/api/billing/assignable', { q: q.trim() || undefined }, signal).then((r) => r.users ?? []);

export const ROLE_LABEL: Record<string, string> = { member: 'Member', approver: 'Approver', finance: 'Finance', admin: 'Administrator' };

// ── reminders (dunning, W13) ────────────────────────────────────────────

export type Channel = 'email' | 'whatsapp';

export interface ReminderStep {
  offset_days: number;
  channels: Channel[];
  template_id: number | null;
}

export interface ReminderSettings {
  enabled: boolean;
  steps: ReminderStep[];
  stop_on_dispute: boolean;
  /** WhatsApp can be chosen only where the WhatsApp service is installed. */
  whatsapp_available?: boolean;
  [k: string]: unknown;
}

/** The defaults the server starts a company with: −3, 0, +7, +14 and +30 days, by email. */
export const DEFAULT_STEPS: ReminderStep[] = [-3, 0, 7, 14, 30].map((d) => ({ offset_days: d, channels: ['email'], template_id: null }));

export const fetchReminders = (org: string, signal?: AbortSignal) => apiGet<{ settings?: ReminderSettings } & Partial<ReminderSettings>>('/api/billing/reminders/settings', withOrg(org), signal).then((r) => normaliseReminders(r.settings ?? r));
export const saveReminders = (org: string, s: ReminderSettings) => request<{ settings?: ReminderSettings }>('PUT', '/api/billing/reminders/settings', { body: { ...s, steps: sortSteps(s.steps) }, query: org ? { org } : undefined });

export interface ReminderLogRow {
  id: number;
  invoice_id: number;
  number: string | null;
  client: string | null;
  offset_days: number | null;
  channel: string;
  status: string;
  at: string | null;
  error?: string | null;
}
export const fetchReminderLog = (org: string, signal?: AbortSignal) => apiGet<{ log?: ReminderLogRow[]; items?: ReminderLogRow[] }>('/api/billing/reminders/log', withOrg(org, { per_page: 50 }), signal).then((r) => r.log ?? r.items ?? []);

export function normaliseReminders(raw: Partial<ReminderSettings> | null | undefined): ReminderSettings {
  const steps = Array.isArray(raw?.steps) ? raw!.steps : DEFAULT_STEPS;
  return {
    ...(raw ?? {}),
    enabled: !!raw?.enabled,
    stop_on_dispute: raw?.stop_on_dispute === undefined ? true : !!raw.stop_on_dispute,
    steps: sortSteps(steps.map((s) => ({ offset_days: Math.round(Number(s.offset_days) || 0), channels: (s.channels?.length ? s.channels : ['email']) as Channel[], template_id: s.template_id ?? null }))),
  };
}

/** Steps in date order, one per day: a second step on the same day replaces the first. */
export function sortSteps(steps: ReminderStep[]): ReminderStep[] {
  const by = new Map<number, ReminderStep>();
  for (const s of steps) by.set(s.offset_days, s);
  return [...by.values()].sort((a, b) => a.offset_days - b.offset_days);
}

// ── message templates ───────────────────────────────────────────────────

export type TemplateKind = 'invoice' | 'reminder' | 'statement' | 'receipt';
export const TEMPLATE_KINDS: Array<{ id: TemplateKind; label: string }> = [
  { id: 'invoice', label: 'Invoice' },
  { id: 'reminder', label: 'Reminder' },
  { id: 'statement', label: 'Statement' },
  { id: 'receipt', label: 'Receipt' },
];

export interface MessageTemplate {
  id: number;
  kind: TemplateKind;
  name: string;
  subject: string;
  body: string;
  channel?: Channel | null;
  is_default?: boolean;
  org_id?: number | null;
}
export const fetchTemplates = (org: string, kind?: TemplateKind, signal?: AbortSignal) => apiGet<{ templates: MessageTemplate[] }>('/api/billing/message-templates', withOrg(org, { kind }), signal).then((r) => r.templates ?? []);
export const saveTemplate = (t: Partial<MessageTemplate>) => (t.id ? apiPut<{ template: MessageTemplate }>(`/api/billing/message-templates/${t.id}`, t) : apiPost<{ template: MessageTemplate }>('/api/billing/message-templates', t));
export const removeTemplate = (id: number) => apiDelete(`/api/billing/message-templates/${id}`);

/** The placeholders a template may use, filled by the server when it sends. */
export const PLACEHOLDERS = ['{customer}', '{number}', '{total}', '{due}', '{due_date}', '{pay_link}', '{company}'];
