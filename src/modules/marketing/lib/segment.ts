import type { Rule } from '../api';
import { day } from './format';
import { OUTCOMES } from './outcomes';

/**
 * A segment's rules (MKT-SEG-01; design DK04 "Rules"): up to 20 rules over the 19 baseline fields, matched all or
 * any, evaluated by the server at preview, at scheduling and at send (MKT-SEG-02). The three Target fields of
 * MKT-SEG-06 — call outcome, callback due, CRM lead status — are listed and marked planned; the editor offers them
 * once the server evaluates them. Pure: the builder and its tests share it.
 */

export const MAX_RULES = 20;

export type FieldType = 'text' | 'enum' | 'date' | 'list' | 'tag' | 'topic' | 'campaign';

export interface FieldOption {
  value: string;
  label: string;
}

export interface SegmentField {
  key: string;
  label: string;
  /** The design's field group ("Tag · List · Source"). */
  group: string;
  type: FieldType;
  options?: FieldOption[];
  /** A Target field (MKT-SEG-06): listed, not offered. */
  planned?: boolean;
}

export interface Operator {
  value: string;
  label: string;
  /** Takes no value ("is empty"). */
  unary?: boolean;
  /** Said after the value ("within last 90 days"). */
  unit?: string;
}

/** The field groups in the design's words, in its order. */
export const GROUPS = [
  'Email · Name · Phone',
  'Tag · List · Source',
  'Email / phone consent',
  'Topic subscription',
  'Organisation · industry · country',
  'Created · last activity',
  'Last open / click · campaign received',
  'Call outcome · callback due',
  'CRM lead status',
] as const;

const [CONTACT, TAGGING, CONSENT, TOPIC, ORGANISATION, LIFECYCLE, ENGAGEMENT, CALLS, CRM] = GROUPS;

/** In group order, so the field picker heads each group once. */
export const FIELDS: readonly SegmentField[] = [
  { key: 'email', label: 'Email', group: CONTACT, type: 'text' },
  { key: 'name', label: 'Name', group: CONTACT, type: 'text' },
  { key: 'phone', label: 'Phone', group: CONTACT, type: 'text' },
  { key: 'tag', label: 'Tag', group: TAGGING, type: 'tag' },
  { key: 'list', label: 'List', group: TAGGING, type: 'list' },
  { key: 'source', label: 'Source', group: TAGGING, type: 'text' },
  { key: 'owner', label: 'Owner', group: TAGGING, type: 'text' },
  {
    key: 'email_consent',
    label: 'Email consent',
    group: CONSENT,
    type: 'enum',
    options: [
      { value: 'subscribed', label: 'Subscribed' },
      { value: 'unknown', label: 'Unknown — no consent recorded' },
      { value: 'pending', label: 'Pending confirmation' },
      { value: 'unsubscribed', label: 'Unsubscribed' },
      { value: 'bounced', label: 'Bounced' },
    ],
  },
  {
    key: 'phone_consent',
    label: 'Phone consent',
    group: CONSENT,
    type: 'enum',
    options: [
      { value: 'consented', label: 'Consented' },
      { value: 'unknown', label: 'Unknown — no consent recorded' },
      { value: 'withdrawn', label: 'Withdrawn' },
    ],
  },
  { key: 'topic', label: 'Topic', group: TOPIC, type: 'topic' },
  { key: 'organisation', label: 'Organisation', group: ORGANISATION, type: 'text' },
  { key: 'industry', label: 'Organisation · industry', group: ORGANISATION, type: 'text' },
  { key: 'country', label: 'Organisation · country', group: ORGANISATION, type: 'text' },
  { key: 'time_zone', label: 'Time zone', group: ORGANISATION, type: 'text' },
  { key: 'created_at', label: 'Created', group: LIFECYCLE, type: 'date' },
  { key: 'last_activity_at', label: 'Last activity', group: LIFECYCLE, type: 'date' },
  { key: 'last_open_at', label: 'Last email opened', group: ENGAGEMENT, type: 'date' },
  { key: 'last_click_at', label: 'Last email clicked', group: ENGAGEMENT, type: 'date' },
  { key: 'campaign_received', label: 'Campaign received', group: ENGAGEMENT, type: 'campaign' },
  { key: 'call_outcome', label: 'Call outcome', group: CALLS, type: 'enum', options: OUTCOMES.map((o) => ({ value: o.id, label: o.label })), planned: true },
  { key: 'callback_due', label: 'Callback due', group: CALLS, type: 'date', planned: true },
  { key: 'crm_lead_status', label: 'CRM lead status', group: CRM, type: 'text', planned: true },
];

/** "19 fields available". */
export const BASELINE_FIELDS = FIELDS.filter((f) => !f.planned).length;

const INCLUDES: Operator[] = [
  { value: 'includes', label: 'includes' },
  { value: 'not_includes', label: 'does not include' },
];

export const OPERATORS: Record<FieldType, Operator[]> = {
  text: [
    { value: 'is', label: 'is' },
    { value: 'is_not', label: 'is not' },
    { value: 'contains', label: 'contains' },
    { value: 'starts_with', label: 'starts with' },
    { value: 'is_empty', label: 'is empty', unary: true },
  ],
  enum: [
    { value: 'is', label: 'is' },
    { value: 'is_not', label: 'is not' },
  ],
  date: [
    { value: 'within_last', label: 'within last', unit: 'days' },
    { value: 'before', label: 'before' },
    { value: 'after', label: 'after' },
    { value: 'is_empty', label: 'is empty', unary: true },
  ],
  list: INCLUDES,
  tag: INCLUDES,
  topic: INCLUDES,
  campaign: INCLUDES,
};

/** Days for "within last N days". */
export const MAX_DAYS = 9999;

export function fieldOf(key: string): SegmentField | undefined {
  return FIELDS.find((f) => f.key === key);
}

export function operatorsFor(key: string): Operator[] {
  return OPERATORS[fieldOf(key)?.type ?? 'text'];
}

export function operatorOf(field: SegmentField, op: string): Operator | undefined {
  return OPERATORS[field.type].find((o) => o.value === op);
}

/** What the value of a rule is: nothing, a number of days, a date, one of the field's options, a record, or text. */
export type ValueKind = 'none' | 'days' | 'date' | 'option' | 'ref' | 'text';

export function valueKind(field: SegmentField, op: Operator | undefined): ValueKind {
  if (op?.unary) return 'none';
  if (field.type === 'date') return op?.value === 'within_last' ? 'days' : 'date';
  if (field.type === 'enum') return 'option';
  if (field.type === 'list' || field.type === 'topic' || field.type === 'campaign') return 'ref';
  return 'text';
}

export function emptyRule(fieldKey: string): Rule {
  return { field: fieldKey, op: operatorsFor(fieldKey)[0]?.value ?? 'is', value: '' };
}

/** Another field for a rule: the operator and value stay while they still make sense (email → name, created → last activity). */
export function withField(rule: Rule, key: string): Rule {
  const from = fieldOf(rule.field);
  const to = fieldOf(key);
  if (from && to && from.type === to.type && to.type !== 'enum' && operatorOf(to, rule.op)) return { field: key, op: rule.op, value: rule.value };
  return emptyRule(key);
}

/** Another operator: the value stays only while it is the same kind of value ("within last" days → "before" a date clears it). */
export function withOperator(rule: Rule, op: string): Rule {
  const f = fieldOf(rule.field);
  if (!f) return { ...rule, op };
  const keep = valueKind(f, operatorOf(f, rule.op)) === valueKind(f, operatorOf(f, op));
  return { field: rule.field, op, value: keep ? rule.value : '' };
}

function isDay(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.getUTCFullYear() === +m[1]! && d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]!;
}

/** Why a rule cannot be evaluated yet, or null when it can. */
export function ruleProblem(rule: Rule): string | null {
  const f = fieldOf(rule.field);
  if (!f) return 'Choose a field.';
  if (f.planned) return `${f.label} is planned: this server does not evaluate it yet.`;
  const op = operatorOf(f, rule.op);
  if (!op) return 'Choose how it compares.';
  const v = rule.value.trim();
  switch (valueKind(f, op)) {
    case 'none':
      return null;
    case 'days':
      return /^\d{1,4}$/.test(v) && Number(v) >= 1 && Number(v) <= MAX_DAYS ? null : `Days: a whole number from 1 to ${MAX_DAYS}.`;
    case 'date':
      return isDay(v) ? null : 'Choose a date.';
    case 'option':
      return f.options?.some((o) => o.value === v) ? null : 'Choose a value.';
    case 'ref':
      return v ? null : `Choose a ${f.type === 'list' ? 'list' : f.type === 'topic' ? 'topic' : 'campaign'}.`;
    default:
      return v ? null : 'Type a value.';
  }
}

export function validRule(rule: Rule): boolean {
  return ruleProblem(rule) === null;
}

/** The editor refuses a 21st rule (WF-04 step 3). */
export function canAddRule(rules: readonly unknown[]): boolean {
  return rules.length < MAX_RULES;
}

/** A rule as the server takes it: the value trimmed, and empty for an operator that takes none. */
export function cleanRule(rule: Rule): Rule {
  const f = fieldOf(rule.field);
  const op = f ? operatorOf(f, rule.op) : undefined;
  return { field: rule.field, op: rule.op, value: op?.unary ? '' : rule.value.trim() };
}

/**
 * "Tag includes vendor", "Last email opened within last 90 days". `nameOf` names a record value (a list, topic or
 * campaign id); without it an id reads `#12`.
 */
export function ruleSentence(rule: Rule, nameOf?: (field: SegmentField, value: string) => string | null | undefined): string {
  const f = fieldOf(rule.field);
  const op = f ? operatorOf(f, rule.op) : undefined;
  const subject = f?.label ?? rule.field.replace(/_/g, ' ');
  const verb = op?.label ?? rule.op.replace(/_/g, ' ');
  if (op?.unary) return `${subject} ${verb}`;
  const v = rule.value.trim();
  let shown = v;
  const kind = f ? valueKind(f, op) : 'text';
  const named = f && v ? nameOf?.(f, v) : null;
  if (named) shown = named;
  else if (kind === 'option') shown = v.replace(/_/g, ' ');
  else if (kind === 'date' && isDay(v)) shown = day(v);
  else if (kind === 'ref' && /^\d+$/.test(v)) shown = `#${v}`;
  return [subject, verb, shown, op?.unit && shown ? op.unit : ''].filter(Boolean).join(' ');
}

/** "4 · all" — a segment's rules in the list. */
export function rulesSummary(rules: readonly Rule[], match: string): string {
  return `${rules.length} · ${match}`;
}

/** The groups none of whose fields is offered yet. */
export function plannedGroup(group: string): boolean {
  const inGroup = FIELDS.filter((f) => f.group === group);
  return inGroup.length > 0 && inGroup.every((f) => f.planned);
}
