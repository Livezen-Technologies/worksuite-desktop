import { ZodError } from 'zod';
import type { LocalContact, LocalContactInput, LocalItem, LocalItemInput, LocalItemMeta } from '@shared/local-workspace';
import { searchLocalItems } from '@shared/local-workspace';
import { isDesktopError } from '../main/errors';
import type { LocalWorkspace } from './local-workspace';

/**
 * The storage layer of guest mode (#149): the requests Notes, Tasks, Contacts and Calendar make of the WorkSuite API
 * (`/api/notes`, `/api/tasks`, `/api/contacts`, `/api/calendar/events`…), answered from the Local Profile's database
 * in the shapes the server answers with, so the same module screens work signed in and in guest mode. Anything that
 * needs an account (sharing, people, company records, other apps) answers 403 with a sentence that says so.
 *
 * Times: the server's calendar speaks naive wall-clock digits; guest mode's clock is this computer's, so wall times
 * are read and written in the device's own zone and kept as absolute instants (as #86 kept them).
 */
export type LocalApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export interface LocalApiRequest { method: LocalApiMethod; path: string; query?: Record<string, string | number | boolean>; body?: unknown }
export interface LocalApiResponse { status: number; data: unknown; message: string | null }

export const NEEDS_ACCOUNT = 'This needs a WorkSuite account. Sign in to use it.';
export class LocalApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
const needsAccount = () => new LocalApiError(403, NEEDS_ACCOUNT);
const notFound = (what: string) => new LocalApiError(404, `This ${what} is not on this device.`);
type Body = Record<string, unknown>;
type Query = Record<string, string>;

const pad = (n: number) => String(n).padStart(2, '0');
/** An instant as wall-clock digits on this computer: "YYYY-MM-DD HH:MM:SS". */
export function wallOf(instant: string): string {
  const d = new Date(instant);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}
/** "YYYY-MM-DD", "YYYY-MM-DDTHH:MM" (this computer's clock) or an ISO instant → an ISO instant; null for none. */
export function instantOf(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (/(Z|[+-]\d\d:\d\d)$/.test(value)) { const t = Date.parse(value); return Number.isNaN(t) ? null : new Date(t).toISOString(); }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0)).toISOString() : null;
}
/** UTC without a zone, as the server stamps records. */
const utc = (iso: string) => iso.slice(0, 19).replace('T', ' ');
const isDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** A body as HTML: #86 kept plain text. */
export function htmlOf(item: Pick<LocalItem, 'body' | 'meta'>): string {
  if (item.meta?.html) return item.body;
  return item.body ? item.body.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('') : '';
}
/** HTML as words, for excerpts and search. */
export function plainOf(item: Pick<LocalItem, 'body' | 'meta'>): string {
  if (!item.meta?.html) return item.body;
  return item.body.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d|tr)>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim();
}
const str = (v: unknown, max = 500): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const tagsOf = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((t) => String(t).trim().slice(0, 60)).filter(Boolean).slice(0, 50);
const num = (seg: string | undefined): number => {
  if (!seg || !/^\d+$/.test(seg)) throw new LocalApiError(404, 'Not found.');
  return Number(seg);
};
const STATUSES = new Set(['backlog', 'todo', 'in_progress', 'on_hold', 'review', 'changes_requested', 'done', 'cancelled']);
const PRIORITIES = new Set(['urgent', 'high', 'medium', 'low', 'none']);

export class LocalApi {
  constructor(private readonly store: LocalWorkspace, private readonly profileName: () => string) {}

  handle(request: LocalApiRequest): LocalApiResponse {
    try {
      return { status: 200, data: this.route(request), message: null };
    } catch (error) {
      if (error instanceof LocalApiError) return { status: error.status, data: null, message: error.message };
      if (error instanceof ZodError) {
        const issue = error.issues[0];
        const field = String(issue?.path[0] ?? '');
        return { status: 422, data: null, message: field === 'title' ? 'Give it a title.' : field === 'display_name' ? 'Give the contact a name.' : issue?.message ?? 'That is not valid.' };
      }
      if (isDesktopError(error)) return { status: 409, data: null, message: error.message };
      throw error;
    }
  }

  private route({ method, path, query, body }: LocalApiRequest): unknown {
    const url = new URL(path, 'http://local');
    const q: Query = Object.fromEntries(url.searchParams);
    for (const [k, v] of Object.entries(query ?? {})) q[k] = String(v);
    const seg = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean).map(decodeURIComponent);
    const b = (body && typeof body === 'object' ? body : {}) as Body;
    const get = method === 'GET';
    switch (seg[0]) {
      case 'notes': return this.notes(method, seg.slice(1), q, b);
      case 'notebooks': case 'note-sections': if (get && seg.length === 1) return []; break;
      case 'tasks': return this.tasks(method, seg.slice(1), q, b);
      case 'task-lists': if (get && seg.length === 1) return { lists: [] }; break;
      case 'calendar': return this.calendar(method, seg.slice(1), q, b);
      case 'contacts': return this.contacts(method, seg.slice(1), q, b);
      case 'contact-groups': if (get && seg.length === 1) return []; break;
      case 'contact-notes': return this.contactNote(method, num(seg[1]), b);
      case 'data': if (get && seg[1] === 'resources') return { resources: [] }; break;
      // Pickers of people ask for the company directory: a guest has nobody to pick.
      case 'chat': if (get && seg[1] === 'directory') return { users: [] }; break;
      case 'search': if (get && seg[1] === 'global') return { results: [] }; break;
    }
    throw needsAccount();
  }

  // ── items ──────────────────────────────────────────────────────────────
  private item(kind: LocalItem['kind'], n: number, what: string): LocalItem {
    const id = this.store.idOf(n);
    const item = id ? this.store.get(id) : undefined;
    if (!item || item.kind !== kind) throw notFound(what);
    return item;
  }
  private write(previous: LocalItem | null, next: LocalItemInput): LocalItem {
    return this.store.save(previous ? { ...next, id: previous.id, revision: previous.revision } : next);
  }
  private stamps(item: LocalItem) { return { updated_at: utc(item.updatedAt), created_at: utc(item.updatedAt) }; }

  // ── notes ──────────────────────────────────────────────────────────────
  private noteCard(item: LocalItem) {
    const m = item.meta;
    return { id: this.store.numberOf(item.id), notebook_id: null, section_id: null, title: item.title, excerpt: plainOf(item).slice(0, 200) || null, tags: m.tags ?? [], color: null, is_pinned: !!m.pinned, is_favorite: !!m.favorite, is_archived: !!m.archived, ...this.stamps(item) };
  }
  private noteDetail(item: LocalItem) { return { ...this.noteCard(item), body: htmlOf(item), my_role: 'owner', shares: [] }; }
  private newNote(b: Body): number {
    const item = this.store.save({ kind: 'note', title: str(b.title, 200) ?? 'Untitled', body: typeof b.body === 'string' ? b.body : '', meta: { html: true, tags: tagsOf(b.tags) } });
    return this.store.numberOf(item.id);
  }
  private notes(method: LocalApiMethod, seg: string[], q: Query, b: Body): unknown {
    const all = () => this.store.items().filter((item) => item.kind === 'note');
    if (!seg.length && method === 'GET') {
      if (q.notebook || q.section) return [];
      let list = all().filter((item) => !!item.meta.archived === (q.archived === '1'));
      if (q.favorites === '1') list = list.filter((item) => item.meta.favorite);
      if (q.pinned === '1') list = list.filter((item) => item.meta.pinned);
      list = searchLocalItems(list.map((item) => ({ item, title: item.title, body: plainOf(item) })), q.q ?? '').map((x) => x.item);
      return list.sort((a, b) => Number(!!b.meta.pinned) - Number(!!a.meta.pinned) || b.updatedAt.localeCompare(a.updatedAt)).map((item) => this.noteCard(item));
    }
    if (!seg.length && method === 'POST') return { id: this.newNote(b) };
    if (seg[0] === 'shared' && method === 'GET') return [];
    if (seg[0] === 'from' && method === 'POST') return { id: this.newNote(b) };
    if (seg[0] === 'stats' && method === 'GET') {
      const notes = all(); const live = notes.filter((item) => !item.meta.archived);
      return { total: live.length, favorites: live.filter((item) => item.meta.favorite).length, pinned: live.filter((item) => item.meta.pinned).length, archived: notes.length - live.length, notebooks: 0 };
    }
    const note = this.item('note', num(seg[0]), 'note');
    if (seg.length === 1) {
      if (method === 'GET') return this.noteDetail(note);
      if (method === 'DELETE') { this.store.remove(note.id); return null; }
      if (method === 'PUT') {
        const saved = this.write(note, { ...note, title: b.title === undefined ? note.title : str(b.title, 200) ?? 'Untitled', body: typeof b.body === 'string' ? b.body : htmlOf(note), meta: { ...note.meta, html: true, ...(b.tags === undefined ? {} : { tags: tagsOf(b.tags) }) } });
        return this.noteDetail(saved);
      }
    }
    if (method === 'POST' && (seg[1] === 'pin' || seg[1] === 'favorite' || seg[1] === 'archive')) {
      const key = seg[1] === 'pin' ? 'pinned' : seg[1] === 'favorite' ? 'favorite' : 'archived';
      const saved = this.write(note, { ...note, meta: { ...note.meta, [key]: !note.meta[key] } });
      return { is_pinned: !!saved.meta.pinned, is_favorite: !!saved.meta.favorite, is_archived: !!saved.meta.archived };
    }
    if (method === 'POST' && seg[1] === 'duplicate') {
      const copy = this.store.save({ kind: 'note', title: `${note.title} (copy)`.slice(0, 200), body: htmlOf(note), meta: { html: true, tags: note.meta.tags ?? [] } });
      return { id: this.store.numberOf(copy.id) };
    }
    if (method === 'GET' && seg[1] === 'links') return [];
    if (method === 'POST' && seg[1] === 'convert-task') return { task_id: this.newTask({ title: note.title, description: htmlOf(note) }) };
    throw needsAccount();
  }

  // ── tasks ──────────────────────────────────────────────────────────────
  private dueOf(item: LocalItem): string | null {
    return item.due ?? (item.meta.dueDay ? instantOf(`${item.meta.dueDay}T09:00`) : null);
  }
  private task(item: LocalItem) {
    const m = item.meta;
    const status = m.status ?? (item.completed ? 'done' : 'todo');
    const list = m.checklist ?? [];
    return {
      id: this.store.numberOf(item.id), task_key: null, list_id: null, org_id: null, org_name: null, owner_id: 0, assignee_id: null, assignee_name: null,
      title: item.title, description: htmlOf(item) || null, status, priority: m.priority ?? 'none', tags: m.tags ?? [],
      start_date: m.startDay ?? (item.start ? wallOf(item.start).slice(0, 10) : null), start_at: item.start,
      due_date: m.dueDay ?? (item.due ? wallOf(item.due).slice(0, 10) : null), due_at: item.due,
      estimated_hours: m.hours ?? null, progress: status === 'done' ? 100 : m.progress ?? 0, position: 0, archived: !!m.archived,
      completed_at: status === 'done' ? utc(item.updatedAt) : null, ...this.stamps(item),
      checklist_done: list.filter((entry) => entry.done).length, checklist_total: list.length,
    };
  }
  private taskDetail(item: LocalItem) {
    const can = { title: true, status: true, priority: true, assignee_id: false, due_date: true, start_date: true, progress: true, description: true, org_id: false, list_id: false, tags: true, checklist: true, people: false };
    return { ...this.task(item), comments: [], checklist: item.meta.checklist ?? [], can_edit: can };
  }
  /** A due or start date as the screens send it: a day, a day and a time on this computer, or an instant. */
  private when(value: unknown): { at: string | null; day: string | null } {
    if (value === null || value === undefined || value === '') return { at: null, day: null };
    if (isDay(value)) return { at: null, day: value };
    const at = instantOf(value);
    if (!at) throw new LocalApiError(422, 'That date is not valid.');
    return { at, day: null };
  }
  /** A task's reminder follows its due date when it is set as "before due". */
  private remind(item: Pick<LocalItem, 'due' | 'meta'>, offset: number | null | undefined, custom: unknown): string | null {
    if (offset === null || offset === undefined) return custom === undefined ? null : instantOf(custom);
    const due = this.dueOf(item as LocalItem);
    if (!due) throw new LocalApiError(422, 'Set a due date first, or choose a custom time.');
    return new Date(Date.parse(due) - offset * 60_000).toISOString();
  }
  private newTask(b: Body): number {
    const status = STATUSES.has(String(b.status)) ? String(b.status) as NonNullable<LocalItemMeta['status']> : 'todo';
    const due = this.when(b.due_date ?? b.due_at);
    const start = this.when(b.start_date ?? b.start_at);
    const meta: LocalItemMeta = { html: true, status, priority: PRIORITIES.has(String(b.priority)) ? String(b.priority) as NonNullable<LocalItemMeta['priority']> : 'none', tags: tagsOf(b.tags), dueDay: due.day, startDay: start.day, hours: typeof b.estimated_hours === 'number' ? b.estimated_hours : null, progress: 0, checklist: [] };
    const first = Array.isArray(b.reminders) ? (b.reminders[0] as { offset_minutes?: number | null; custom_at?: string } | undefined) : undefined;
    const base = { due: due.at, meta };
    const reminder = first ? this.remind(base as LocalItem, first.offset_minutes, first.custom_at) : null;
    if (first) meta.reminderOffset = first.offset_minutes ?? null;
    const item = this.store.save({ kind: 'task', title: str(b.title, 200) ?? '', body: typeof b.description === 'string' ? b.description : '', completed: status === 'done', due: due.at, start: start.at, reminder, meta });
    return this.store.numberOf(item.id);
  }
  /** One field of a task, as the task screens change it. */
  private taskField(item: LocalItem, field: string, value: unknown): LocalItemInput {
    const next: LocalItemInput = { ...item, meta: { ...item.meta, html: true }, body: htmlOf(item) };
    const meta = next.meta!;
    switch (field) {
      case 'title': next.title = str(value, 200) ?? ''; break;
      case 'description': next.body = typeof value === 'string' ? value : ''; break;
      case 'status':
        if (!STATUSES.has(String(value))) throw new LocalApiError(422, 'That status is not valid.');
        meta.status = String(value) as NonNullable<LocalItemMeta['status']>; next.completed = value === 'done'; break;
      case 'priority':
        if (!PRIORITIES.has(String(value))) throw new LocalApiError(422, 'That priority is not valid.');
        meta.priority = String(value) as NonNullable<LocalItemMeta['priority']>; break;
      case 'progress': meta.progress = Math.max(0, Math.min(100, Math.round(Number(value) || 0))); break;
      case 'tags': meta.tags = tagsOf(value); break;
      case 'archived': meta.archived = !!value; break;
      case 'due_date': {
        const due = this.when(value); next.due = due.at; meta.dueDay = due.day;
        next.reminder = meta.reminderOffset === null || meta.reminderOffset === undefined ? item.reminder : (due.at || due.day) ? this.remind({ due: due.at, meta } as LocalItem, meta.reminderOffset, undefined) : null;
        break;
      }
      case 'start_date': { const start = this.when(value); next.start = start.at; meta.startDay = start.day; break; }
      case 'assignee_id': case 'org_id': case 'list_id': if (value === null || value === undefined || value === '') break; throw needsAccount();
      default: throw needsAccount();
    }
    return next;
  }
  private tasks(method: LocalApiMethod, seg: string[], q: Query, b: Body): unknown {
    if (!seg.length && method === 'GET') {
      if (q.filter === 'shared') return { tasks: [] };
      return { tasks: this.store.items().filter((item) => item.kind === 'task' && (q.include_archived === '1' || !item.meta.archived)).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).map((item) => this.task(item)) };
    }
    if (!seg.length && method === 'POST') return { id: this.newTask(b) };
    if (seg[0] === 'organizations' && method === 'GET') return { organizations: [] };
    const task = this.item('task', num(seg[0]), 'task');
    if (seg.length === 1) {
      if (method === 'GET') return this.taskDetail(task);
      if (method === 'DELETE') { this.store.remove(task.id); return null; }
      if (method === 'PATCH') return this.task(this.write(task, this.taskField(task, String(b.field), b.value)));
      if (method === 'PUT') {
        let next: LocalItemInput = task;
        let current = task;
        for (const [field, value] of Object.entries(b)) {
          next = this.taskField({ ...current, ...next, meta: next.meta ?? {} } as LocalItem, field, value);
          current = { ...current, ...next } as LocalItem;
        }
        return this.task(this.write(task, next));
      }
    }
    switch (seg[1]) {
      case 'move': if (method === 'POST') return this.task(this.write(task, this.taskField(task, 'status', b.status))); break;
      case 'people': if (method === 'GET') return { owner_id: 0, people: [], can_manage: false, following: false }; break;
      case 'attachments': if (method === 'GET' && seg.length === 2) return { attachments: [] }; break;
      case 'activity': if (method === 'GET') return []; break;
      case 'checklist': return this.checklist(method, task, seg[2], b);
      case 'reminders': return this.taskReminders(method, task, b);
    }
    throw needsAccount();
  }
  private checklist(method: LocalApiMethod, task: LocalItem, id: string | undefined, b: Body): unknown {
    const list = [...(task.meta.checklist ?? [])];
    if (method === 'POST' && id === undefined) {
      const title = str(b.title);
      if (!title) throw new LocalApiError(422, 'Give it a title.');
      list.push({ id: Math.max(0, ...list.map((entry) => entry.id)) + 1, title, done: false });
    } else {
      const at = list.findIndex((entry) => entry.id === num(id));
      if (at < 0) throw notFound('checklist item');
      if (method === 'DELETE') list.splice(at, 1);
      else if (method === 'PUT') list[at] = { ...list[at]!, ...(b.title === undefined ? {} : { title: str(b.title) ?? list[at]!.title }), ...(b.done === undefined ? {} : { done: !!b.done }) };
      else throw needsAccount();
    }
    this.write(task, { ...task, meta: { ...task.meta, checklist: list } });
    return null;
  }
  private taskReminders(method: LocalApiMethod, task: LocalItem, b: Body): unknown {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (method === 'GET') {
      const offset = task.meta.reminderOffset ?? null;
      const reminders = task.reminder ? [{ id: 1, offset_minutes: offset, ...(offset === null ? { custom_at: wallOf(task.reminder).slice(0, 16).replace(' ', 'T') } : {}), recipients: [0], timezone: zone, scheduled_at: task.reminder, can_edit: true }] : [];
      return { reminders, recipients: [{ id: 0, name: this.profileName() }], timezone: zone };
    }
    if (method === 'POST' || method === 'PUT') {
      const offset = typeof b.offset_minutes === 'number' ? b.offset_minutes : null;
      const reminder = this.remind(task, offset, b.custom_at ?? null);
      if (!reminder) throw new LocalApiError(422, 'Choose when to be reminded.');
      this.write(task, { ...task, reminder, meta: { ...task.meta, reminderOffset: offset } });
      return { id: 1 };
    }
    if (method === 'DELETE') { this.write(task, { ...task, reminder: null, meta: { ...task.meta, reminderOffset: null } }); return null; }
    throw needsAccount();
  }

  // ── calendar ───────────────────────────────────────────────────────────
  private event(item: LocalItem) {
    const m = item.meta;
    const start = item.start!;
    const allDay = !!m.allDay;
    const wall = (iso: string) => (allDay ? `${wallOf(iso).slice(0, 10)} 00:00:00` : wallOf(iso));
    const remind = m.reminderOffset !== undefined ? m.reminderOffset : item.reminder ? Math.max(0, Math.round((Date.parse(start) - Date.parse(item.reminder)) / 60_000)) : null;
    return {
      source: 'event', id: this.store.numberOf(item.id), title: item.title, description: plainOf(item) || null, category: m.category ?? null, location: m.location ?? null, color: m.color ?? null,
      start_at: wall(start), end_at: item.end ? wall(item.end) : null, all_day: allDay, editable: true, can_manage: true, my_role: null, invited: false,
      remind_minutes: remind, recur_freq: null, recur_until: null, recurring: false,
    };
  }
  private eventInput(b: Body, previous: LocalItem | null): LocalItemInput {
    if (b.recur_freq) throw new LocalApiError(422, 'Repeating events need a WorkSuite account. Add each date as its own event.');
    const meta: LocalItemMeta = { ...(previous?.meta ?? {}) };
    const allDay = b.all_day === undefined ? !!meta.allDay : !!b.all_day;
    meta.allDay = allDay;
    let start = previous?.start ?? null;
    let end = previous?.end ?? null;
    if (b.start !== undefined || b.all_day !== undefined) {
      const s = typeof b.start === 'string' ? b.start : previous ? wallOf(previous.start!).replace(' ', 'T') : '';
      const e = typeof b.end === 'string' && b.end ? b.end : b.end === undefined && previous?.end ? wallOf(previous.end).replace(' ', 'T') : s;
      start = instantOf(allDay ? s.slice(0, 10) : s);
      end = instantOf(allDay ? e.slice(0, 10) : e);
      if (!start) throw new LocalApiError(422, 'An event needs a start time.');
      if (end && Date.parse(end) < Date.parse(start)) throw new LocalApiError(422, 'End time must follow start time.');
    }
    if (b.location !== undefined) meta.location = str(b.location);
    if (b.category !== undefined) meta.category = str(b.category, 100);
    if (b.color !== undefined) meta.color = typeof b.color === 'string' && /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : null;
    if (b.remind_minutes !== undefined) meta.reminderOffset = typeof b.remind_minutes === 'number' ? Math.max(0, Math.round(b.remind_minutes)) : null;
    // An event from before #149 kept only the reminder's instant: it keeps its distance from the start.
    if (meta.reminderOffset === undefined && previous?.reminder && previous.start) meta.reminderOffset = Math.max(0, Math.round((Date.parse(previous.start) - Date.parse(previous.reminder)) / 60_000));
    const offset = meta.reminderOffset;
    const reminder = start && offset !== null && offset !== undefined ? new Date(Date.parse(start) - offset * 60_000).toISOString() : null;
    return {
      kind: 'event', title: b.title === undefined ? previous?.title ?? 'Untitled event' : str(b.title, 200) ?? 'Untitled event',
      body: b.description === undefined ? previous?.body ?? '' : typeof b.description === 'string' ? b.description : '', start, end, reminder, meta: { ...meta, html: false },
    };
  }
  private calendar(method: LocalApiMethod, seg: string[], q: Query, b: Body): unknown {
    if (seg[0] === 'conflicts') {
      if (method === 'POST' && seg.length === 1) return { conflicts: [], duplicates: [], people: [], checked: 0 };
      if (method === 'GET' && seg[1] === 'invitations' && seg.length === 2) return { invitations: [] };
      throw needsAccount();
    }
    if (seg[0] !== 'events') throw needsAccount();
    if (seg.length === 1 && method === 'GET') {
      const from = instantOf(q.from) ?? new Date(0).toISOString();
      const to = q.to ? Date.parse(instantOf(q.to)!) + 86_400_000 : Number.MAX_SAFE_INTEGER;
      const events = this.store.items().filter((item) => item.kind === 'event' && item.start).filter((item) => {
        const start = Date.parse(item.start!);
        const end = item.end ? Date.parse(item.end) + (item.meta.allDay ? 86_400_000 - 1 : 0) : start;
        return start < to && end >= Date.parse(from);
      });
      return { events: events.sort((a, b) => a.start!.localeCompare(b.start!)).map((item) => this.event(item)) };
    }
    if (seg.length === 1 && method === 'POST') return this.event(this.store.save(this.eventInput(b, null)));
    const event = this.item('event', num(seg[1]), 'event');
    if (seg.length === 2) {
      if (method === 'GET') return { ...this.event(event), participants: [] };
      if (method === 'PUT') return this.event(this.write(event, this.eventInput(b, event)));
      if (method === 'DELETE') { this.store.remove(event.id); return null; }
    }
    throw needsAccount();
  }

  // ── contacts ───────────────────────────────────────────────────────────
  private person(n: number): LocalContact {
    const id = this.store.idOf(n);
    const contact = id ? this.store.contact(id) : undefined;
    if (!contact) throw notFound('contact');
    return contact;
  }
  private contactCard(c: LocalContact) {
    return {
      id: this.store.numberOf(c.id), user_id: null, type: c.type, display_name: c.display_name, first_name: c.first_name, last_name: c.last_name, job_title: c.job_title, department: c.department, company: c.company,
      work_email: c.work_email, personal_email: c.personal_email, email: c.work_email ?? c.personal_email, mobile: c.mobile, office_phone: c.office_phone, phone: c.mobile ?? c.office_phone ?? c.home_phone,
      avatar_color: null, labels: c.labels, is_favorite: c.favorite, is_archived: c.archived,
    };
  }
  private contactDetail(c: LocalContact) {
    return {
      ...this.contactCard(c), home_phone: c.home_phone, website: c.website, birthday: c.birthday, gender: c.gender, country: c.country, state: c.state, city: c.city, zip: c.zip, street: c.street,
      customer_id: c.customer_id, employee_id: c.employee_id, vendor_id: c.vendor_id, tax_number: c.tax_number, notes: c.notes, social: c.social, created_at: utc(c.createdAt), groups: [],
    };
  }
  private contactInput(b: Body, previous: LocalContact | null): LocalContactInput {
    const fields = ['first_name', 'last_name', 'job_title', 'department', 'company', 'work_email', 'personal_email', 'mobile', 'office_phone', 'home_phone', 'website', 'gender', 'street', 'city', 'state', 'zip', 'country', 'customer_id', 'employee_id', 'vendor_id', 'tax_number', 'notes'] as const;
    const next: LocalContactInput = { ...(previous ?? { display_name: '' }) };
    for (const key of fields) if (b[key] !== undefined) next[key] = str(b[key], 20_000);
    if (b.display_name !== undefined) next.display_name = str(b.display_name, 200) ?? [next.first_name, next.last_name].filter(Boolean).join(' ');
    if (b.type !== undefined) next.type = b.type as LocalContactInput['type'];
    if (b.birthday !== undefined) next.birthday = isDay(b.birthday) ? b.birthday : null;
    if (b.labels !== undefined) next.labels = tagsOf(b.labels);
    if (b.social !== undefined && b.social && typeof b.social === 'object') next.social = Object.fromEntries(Object.entries(b.social as Record<string, unknown>).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k, String(v).trim()]));
    return next;
  }
  private contacts(method: LocalApiMethod, seg: string[], q: Query, b: Body): unknown {
    const all = () => this.store.contacts();
    if (!seg.length && method === 'GET') {
      if (q.group) return [];
      let list = all().filter((c) => c.archived === (q.archived === '1'));
      if (q.favorites === '1') list = list.filter((c) => c.favorite);
      if (q.type) list = list.filter((c) => c.type === q.type);
      const term = (q.q ?? q.search ?? '').trim().toLowerCase();
      if (term) list = list.filter((c) => [c.display_name, c.company, c.work_email, c.personal_email, c.mobile, c.job_title, ...c.labels].some((v) => v?.toLowerCase().includes(term)));
      return list.sort((a, b) => a.display_name.localeCompare(b.display_name)).map((c) => this.contactCard(c));
    }
    if (!seg.length && method === 'POST') return this.contactDetail(this.store.saveContact(this.contactInput(b, null)));
    if (seg[0] === 'stats' && method === 'GET') {
      const live = all().filter((c) => !c.archived);
      const month = new Date().getMonth() + 1;
      return { total: live.length, employees: live.filter((c) => c.type === 'employee').length, customers: live.filter((c) => c.type === 'customer').length, vendors: live.filter((c) => c.type === 'vendor').length, favorites: live.filter((c) => c.favorite).length, groups: 0, birthdays: live.filter((c) => c.birthday && Number(c.birthday.slice(5, 7)) === month).length };
    }
    if (seg[0] === 'directory') throw needsAccount();
    const contact = this.person(num(seg[0]));
    const save = (patch: Partial<LocalContactInput>) => this.store.saveContact({ ...contact, ...patch, id: contact.id, revision: contact.revision });
    if (seg.length === 1) {
      if (method === 'GET') return this.contactDetail(contact);
      if (method === 'PUT') return this.contactDetail(this.store.saveContact({ ...this.contactInput(b, contact), id: contact.id, revision: contact.revision }));
      if (method === 'DELETE') { this.store.removeContact(contact.id); return null; }
    }
    if (method === 'POST' && seg[1] === 'favorite') return { is_favorite: save({ favorite: !contact.favorite }).favorite };
    if (method === 'POST' && (seg[1] === 'archive' || seg[1] === 'restore')) return { is_archived: save({ archived: seg[1] === 'archive' ? !contact.archived : false }).archived };
    if (seg[1] === 'notes') {
      if (method === 'GET') return [...contact.log].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.created_at.localeCompare(a.created_at));
      if (method === 'POST') {
        const body = str(b.body, 20_000);
        if (!body) throw new LocalApiError(422, 'Write the note first.');
        save({ log: [...contact.log, { id: this.store.nextNumber(), body, pinned: false, created_at: utc(new Date().toISOString()), updated_at: null }] });
        return null;
      }
    }
    if (seg[1] === 'activities' && method === 'GET') return [];
    // What the screens note as done (called, emailed): nothing to keep on this device.
    if (seg[1] === 'log' && method === 'POST') return null;
    throw needsAccount();
  }
  private contactNote(method: LocalApiMethod, n: number, b: Body): unknown {
    const contact = this.store.contacts().find((c) => c.log.some((entry) => entry.id === n));
    if (!contact) throw notFound('note');
    let log = contact.log;
    if (method === 'DELETE') log = log.filter((entry) => entry.id !== n);
    else if (method === 'PUT') log = log.map((entry) => (entry.id === n ? { ...entry, ...(b.body === undefined ? {} : { body: str(b.body, 20_000) ?? entry.body }), ...(b.pinned === undefined ? {} : { pinned: !!b.pinned }), updated_at: utc(new Date().toISOString()) } : entry));
    else throw needsAccount();
    this.store.saveContact({ ...contact, log, id: contact.id, revision: contact.revision });
    return null;
  }
}
