import { apiGetMeta, apiPost, apiPut, type Query } from '../../core/api';
import { API } from './api';
import { clean } from './portfolio';

/**
 * The template library on the desktop (worksuite-desktop#337): what New project starts from — a blank project, a
 * copy of an existing project, the company's templates, your own, and the built-in packs — and the Templates page.
 *
 * The contract is WorkSuite's Projects API 2.2 (`/api/projects/template-library`, `/from-library`,
 * `/{id}/save-as-library-template`). A template is named by a key: `pack.website-development`, `tpl.12`,
 * `project.40`. Its plan is one JSON document, the server's TemplateSpec, mirrored below.
 *
 * `schedule()` lays a plan on real dates exactly as the server's TemplatePlan does, so the Preview tab shows what
 * Create project builds. The cases in tests/unit/renderer/projects-templates.test.ts are the server's
 * ProjectTemplatePacksTest cases: change one, change the other.
 */

// ── shapes ─────────────────────────────────────────────────────────────────

export type TemplateGroup = 'pack' | 'company' | 'mine' | 'project';
export type TemplateScope = 'personal' | 'company' | 'organisation' | 'builtin';

export interface TemplateCounts {
  phases: number;
  tasks: number;
  subtasks: number;
  checklist: number;
  dependencies: number;
  roles: number;
  folders: number;
  documents: number;
  budget_lines: number;
  automations: number;
  risks: number;
  weeks: number;
}

export interface LibraryItem {
  key: string;
  kind: 'pack' | 'template' | 'project';
  id: number | null;
  group: TemplateGroup;
  name: string;
  icon: string;
  category: string;
  summary: string;
  /** "8 phases · 29 tasks · 8 weeks" */
  line: string;
  tags: string[];
  scope: TemplateScope;
  version: number;
  status: 'active' | 'archived';
  usage: number;
  owner: string | null;
  org_id: number | null;
  org_name: string | null;
  org_ids?: number[];
  editable: boolean;
  based_on: string | null;
  updated_at: string | null;
  code: string | null;
  anchor: 'start' | 'end';
  anchor_label: string;
  duration_days: number;
  counts: TemplateCounts;
  hours: number;
  budget: number;
}

export interface Placed {
  from: 'start' | 'end';
  start: number;
  days: number;
}

export interface SpecRole {
  key: string;
  name: string;
  member_role: 'lead' | 'member' | 'reviewer' | 'observer';
  rate: number;
  hours_per_week: number;
}

export interface SpecPhase extends Placed {
  key: string;
  name: string;
  description: string;
}

export interface SpecTask extends Placed {
  key: string;
  phase: string | null;
  title: string;
  description: string;
  role: string | null;
  hours: number;
  priority: string;
  depends_on: string[];
  checklist: string[];
  tags: string[];
  subtasks: Array<{ title: string; description: string; role: string | null; hours: number; checklist: string[] }>;
  repeat: { every: 'week' | 'month' | 'quarter' } | null;
}

export interface SpecBudgetLine {
  label: string;
  kind: 'labour' | 'expense';
  role: string | null;
  hours: number;
  rate: number | null;
  amount: number | null;
  note: string;
}

export interface SpecAutomation {
  when: string;
  do: string;
  phase?: string;
  days?: number;
  title?: string;
  role?: string;
}

export interface TemplateSpec {
  schema: number;
  key: string;
  version: number;
  name: string;
  icon: string;
  category: string;
  summary: string;
  tags: string[];
  anchor: 'start' | 'end';
  anchor_label: string;
  duration_days: number;
  roles: SpecRole[];
  phases: SpecPhase[];
  tasks: SpecTask[];
  folders: Array<{ path: string; documents: Array<{ name: string; type: string }> }>;
  budget: SpecBudgetLine[];
  risks: Array<{ title: string; description: string; impact: string; probability: string; mitigation: string }>;
  custom_fields: Array<{ name: string; type: string }>;
  statuses: string[];
  automations: SpecAutomation[];
  portal: Record<string, unknown> | null;
  links: Record<string, unknown>;
  defaults: {
    name_pattern: string;
    category: string;
    priority: string;
    billable: boolean;
    status: 'planning' | 'pending_approval' | 'active';
    estimated_hours: number | null;
    budget: number | null;
    currency: string | null;
    description: string;
  };
}

export interface TemplateVersion {
  version: number;
  name: string | null;
  note: string | null;
  by: string | null;
  at: string | null;
  line: string;
}

/** The parts New project can leave out. */
export type IncludePart = 'phases' | 'tasks' | 'folders' | 'budget' | 'automations' | 'risks';
export type Include = Record<IncludePart, boolean>;
export const INCLUDE_ALL: Include = { phases: true, tasks: true, folders: true, budget: true, automations: true, risks: true };

export interface BuildReport {
  id: number;
  code: string;
  start_date: string;
  end_date: string;
  template: { key: string; name: string; version: number };
  made: Record<string, number>;
  adapted: Array<{ what: string; why: string }>;
  kept: Array<{ what: string; why: string }>;
}

// ── reads and writes ────────────────────────────────────────────────────────

type Signal = { signal?: AbortSignal };
const LIB = `${API}/template-library`;

export const tk = {
  library: (p: Query) => ['projects', 'template-library', clean(p)] as const,
  one: (key: string) => ['projects', 'template', key] as const,
  versions: (id: number) => ['projects', 'template-versions', id] as const,
  holidays: (from: string, to: string) => ['projects', 'holidays', from, to] as const,
  tenders: ['projects', 'template-tenders'] as const,
};

export const treads = {
  /** q, archived=1, org — every template this person may start from. */
  library: (p: Query = {}, { signal }: Signal = {}) => apiGetMeta<{ templates: LibraryItem[]; can?: { create?: boolean; company?: boolean; organisation?: boolean } }>(LIB, clean(p), signal),
  one: (key: string, { signal }: Signal = {}) => apiGetMeta<{ template: LibraryItem; spec: TemplateSpec; versions?: TemplateVersion[] }>(`${LIB}/${encodeURIComponent(key)}`, undefined, signal),
  versions: (id: number, { signal }: Signal = {}) => apiGetMeta<{ versions: TemplateVersion[]; current: number }>(`${LIB}/${id}/versions`, undefined, signal),
  holidays: (from: string, to: string, { signal }: Signal = {}) => apiGetMeta<{ holidays: Array<{ date: string; name: string }>; working_days: number[] }>(`${API}/holidays`, { from, to }, signal),
  tenders: ({ signal }: Signal = {}) => apiGetMeta<{ available: boolean; tenders: Array<{ id: number; reference: string | null; title: string; closing_date: string | null }> }>(`${LIB}/tenders`, undefined, signal),
  export: (key: string) => apiGetMeta<{ file_name: string; content: unknown }>(`${LIB}/${encodeURIComponent(key)}/export`),
};

export const twrites = {
  /** The whole project from a template in one call; the answer says what was made, adapted and kept. */
  fromLibrary: (body: Record<string, unknown> & { template: string; include: Include; people: Record<string, number> }) => apiPost<BuildReport>(`${API}/from-library`, body),
  saveFromProject: (id: number, body: { name: string; scope: TemplateScope; include: Record<string, boolean>; summary?: string; org_ids?: number[] }) =>
    apiPost<{ template: LibraryItem }>(`${API}/${id}/save-as-library-template`, body),
  create: (body: Record<string, unknown>) => apiPost<{ template: LibraryItem }>(LIB, body),
  importFile: (body: { json: string; scope?: TemplateScope }) => apiPost<{ template: LibraryItem }>(`${LIB}/import`, body),
  update: (id: number, body: Record<string, unknown>) => apiPut<{ version: number; template: LibraryItem }>(`${LIB}/${id}`, body),
  archive: (id: number, archived: boolean) => apiPost(`${LIB}/${id}/archive`, { archived }),
  duplicate: (key: string, body: { name?: string; scope?: TemplateScope } = {}) => apiPost<{ template: LibraryItem }>(`${LIB}/${encodeURIComponent(key)}/duplicate`, body),
  restore: (id: number, version: number) => apiPost<{ version: number }>(`${LIB}/${id}/versions/${version}/restore`),
};

// ── the start-from groups ─────────────────────────────────────────────────────

export const GROUPS: Array<{ group: Exclude<TemplateGroup, 'project'>; title: string; empty: string }> = [
  { group: 'company', title: 'Company templates', empty: 'None yet. An administrator can share one from the Templates page.' },
  { group: 'mine', title: 'My templates', empty: 'Save any project as a template, or duplicate a pack.' },
  { group: 'pack', title: 'Template packs', empty: 'No packs.' },
];

/** The items matching a search across name, summary, category and tags. */
export function searchTemplates(items: LibraryItem[], q: string): LibraryItem[] {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((i) => {
    const hay = `${i.name} ${i.summary} ${i.category} ${i.tags.join(' ')}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Built-in packs grouped by category, in the order the server listed them. */
export function byCategory(items: LibraryItem[]): Array<{ category: string; items: LibraryItem[] }> {
  const out: Array<{ category: string; items: LibraryItem[] }> = [];
  for (const i of items) {
    const c = i.category || 'Other';
    const g = out.find((x) => x.category === c);
    if (g) g.items.push(i);
    else out.push({ category: c, items: [i] });
  }
  return out;
}

// ── words and figures (the server's TemplateSpec) ──────────────────────────────

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

/** "{client} website" → "Ceylon Tea Board website"; a missing value leaves no stray braces or dashes. */
export function fillName(pattern: string, values: Record<string, string>): string {
  const out = pattern.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '').replace(/\s+/g, ' ').trim();
  return out.replace(/^[\s—\-·]+|[\s—\-·]+$/g, '');
}

/** "Day 0", "+2 weeks", "5 days before the closing date". */
export function offsetLabel(x: Placed, endWord = 'end'): string {
  if (x.from === 'end') {
    if (x.start === 0) return `On the ${endWord} date`;
    return x.start < 0 ? `${plural(-x.start, 'day')} before the ${endWord}` : `${plural(x.start, 'day')} after the ${endWord}`;
  }
  if (x.start > 0 && x.start % 5 === 0) return `+${plural(x.start / 5, 'week')}`;
  return `Day ${x.start}`;
}

/** Hours the plan asks for: each task's own, or its sub-tasks' when it has them. */
export function planHours(spec: TemplateSpec): number {
  let h = 0;
  for (const t of spec.tasks) {
    const sub = t.subtasks.reduce((a, s) => a + s.hours, 0);
    h += sub > 0 ? sub : t.hours;
  }
  return Math.round(h * 100) / 100;
}

/** The budget lines priced: labour at the line's rate, else its role's. */
export function pricedBudget(spec: TemplateSpec): Array<SpecBudgetLine & { amountDue: number; rateDue: number }> {
  const rates = Object.fromEntries(spec.roles.map((r) => [r.key, r.rate]));
  return spec.budget.map((b) => {
    const rateDue = b.kind === 'labour' ? (b.rate ?? rates[b.role ?? ''] ?? 0) : 0;
    const amountDue = b.kind === 'labour' ? Math.round(b.hours * rateDue * 100) / 100 : Math.round((b.amount ?? 0) * 100) / 100;
    return { ...b, rateDue, amountDue };
  });
}

export function budgetTotal(spec: TemplateSpec): number {
  return Math.round(pricedBudget(spec).reduce((a, b) => a + b.amountDue, 0) * 100) / 100;
}

// ── the calendar and the plan (the server's WorkCalendar and TemplatePlan) ─────────────

const MAX_STEPS = 3660;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shiftDay(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday, 1 = Monday. */
const isoDay = (ymd: string): number => ((new Date(`${ymd}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

export interface WorkCalendar {
  isWorkingDay: (d: string) => boolean;
  onOrAfter: (d: string) => string;
  onOrBefore: (d: string) => string;
  /** Working day number `offset` from the first working day on or after `start`; negative walks back. */
  dateOf: (start: string, offset: number) => string;
  /** Working days passed over from `from` to `to` (Friday → Monday is 1); negative when earlier. */
  between: (from: string, to: string) => number;
}

export function workCalendar(workingDays: number[] = [1, 2, 3, 4, 5], holidays: string[] = []): WorkCalendar {
  const week = new Set(workingDays.filter((d) => d >= 1 && d <= 7));
  if (!week.size) [1, 2, 3, 4, 5].forEach((d) => week.add(d));
  const off = new Set(holidays);
  const isWorkingDay = (d: string) => week.has(isoDay(d)) && !off.has(d);
  const walk = (d: string, step: number) => {
    for (let i = 0; i < MAX_STEPS && !isWorkingDay(d); i++) d = shiftDay(d, step);
    return d;
  };
  return {
    isWorkingDay,
    onOrAfter: (d) => walk(d, 1),
    onOrBefore: (d) => walk(d, -1),
    dateOf(start, offset) {
      let d = walk(start, 1);
      const step = offset < 0 ? -1 : 1;
      let left = Math.abs(offset);
      for (let i = 0; left > 0 && i < MAX_STEPS; i++) {
        d = shiftDay(d, step);
        if (isWorkingDay(d)) left--;
      }
      return d;
    },
    between(from, to) {
      if (from === to) return 0;
      const sign = to > from ? 1 : -1;
      const [a, b] = sign > 0 ? [from, to] : [to, from];
      let n = 0;
      let d = a;
      for (let i = 0; d < b && i < MAX_STEPS; i++) {
        d = shiftDay(d, 1);
        if (isWorkingDay(d)) n++;
      }
      return sign * n;
    },
  };
}

/** The k-th week, month or quarter after a date, as the server counts it (31 Jan + 1 month = 3 Mar). */
export function stepDate(ymd: string, every: 'week' | 'month' | 'quarter', k: number): string {
  if (every === 'week') return shiftDay(ymd, 7 * k);
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const at = new Date(Date.UTC(y, m - 1 + (every === 'quarter' ? 3 * k : k), d, 12));
  return at.toISOString().slice(0, 10);
}

function occurrenceWords(ymd: string, every: string): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return every === 'week' ? `week of ${d} ${MONTHS[m - 1]}` : `${MONTHS[m - 1]} ${y}`;
}

export interface PlannedRow {
  key: string;
  source: string;
  title: string;
  phase: string | null;
  start: string;
  end: string;
  occurrence: number;
}

export interface Plan {
  start: string;
  end: string;
  scale: number;
  days: number;
  phases: Array<{ key: string; name: string; start: string; end: string }>;
  tasks: PlannedRow[];
}

const MAX_REPEATS = 60;

/**
 * The plan on real dates — TemplatePlan::schedule(). Day 0 is the first working day on or after the start; with no
 * end the plan runs its own length; with both, start-anchored parts stretch or squeeze to fit and end-anchored ones
 * keep their place; an end-anchored template given only an end starts that many working days before it.
 */
export function schedule(spec: Pick<TemplateSpec, 'duration_days' | 'anchor' | 'phases' | 'tasks'>, start: string | null, end: string | null, cal: WorkCalendar, today: string): Plan {
  const n = Math.max(1, spec.duration_days || 1);
  if (!start && end && spec.anchor === 'end') start = cal.dateOf(cal.onOrBefore(end), -(n - 1));
  const s0 = cal.onOrAfter(start || today);

  let last: number;
  let endW: string;
  let scale: number;
  let endOut: string;
  if (end && end >= s0) {
    endW = cal.onOrBefore(end);
    last = Math.max(0, cal.between(s0, endW));
    scale = (last + 1) / n;
    endOut = end;
  } else {
    last = n - 1;
    endW = cal.dateOf(s0, last);
    endOut = endW;
    scale = 1;
  }

  const place = (x: Placed): [number, number] => {
    let s = x.start;
    let d = Math.max(1, x.days);
    if (x.from === 'end') {
      s = Math.max(0, last + s);
    } else {
      s = Math.round(s * scale);
      d = Math.max(1, Math.round(d * scale));
      s = Math.min(s, last);
      d = Math.min(d, last - s + 1);
    }
    return [s, d];
  };
  const dates = (x: Placed): [string, string] => {
    const [s, d] = place(x);
    return [cal.dateOf(s0, s), cal.dateOf(s0, s + d - 1)];
  };

  const phases = spec.phases.map((p) => {
    const [a, b] = dates(p);
    return { key: p.key, name: p.name, start: a, end: b };
  });

  const tasks: PlannedRow[] = [];
  for (const t of spec.tasks) {
    const [a, b] = dates(t);
    if (!t.repeat) {
      tasks.push({ key: t.key, source: t.key, title: t.title, phase: t.phase, start: a, end: b, occurrence: 0 });
      continue;
    }
    const len = Math.max(0, cal.between(a, b));
    for (let k = 0; k < MAX_REPEATS; k++) {
      const on = k === 0 ? a : cal.onOrAfter(stepDate(a, t.repeat.every, k));
      if (on > endW) break;
      tasks.push({ key: `${t.key}#${k + 1}`, source: t.key, title: `${t.title} — ${occurrenceWords(on, t.repeat.every)}`, phase: t.phase, start: on, end: cal.dateOf(on, len), occurrence: k + 1 });
    }
  }

  return { start: s0, end: endOut, scale: Math.round(scale * 10000) / 10000, days: last + 1, phases, tasks };
}

/** Where a bar sits on a timeline from `from` to `to`, as percentages of its width. */
export function barOf(start: string, end: string, from: string, to: string): { left: number; width: number } {
  const day = (d: string) => Date.parse(`${d}T12:00:00Z`) / 86_400_000;
  const span = Math.max(1, day(to) - day(from) + 1);
  const left = Math.max(0, Math.min(100, ((day(start) - day(from)) / span) * 100));
  const width = Math.max(0.8, Math.min(100 - left, ((day(end) - day(start) + 1) / span) * 100));
  return { left, width };
}

/** A file name a browser download keeps. */
export function downloadJson(fileName: string, content: unknown): void {
  const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
