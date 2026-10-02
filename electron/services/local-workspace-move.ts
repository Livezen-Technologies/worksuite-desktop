import { createHash } from 'node:crypto';
import type { LocalContact, LocalItem, MoveOffer, MoveResult } from '@shared/local-workspace';
import { DesktopError } from '../main/errors';
import { htmlOf, plainOf } from './local-api';
import type { LocalWorkspace } from './local-workspace';

/**
 * Moving guest data into an account (#149). Signing in from guest mode asks first; only "Move data" runs this. Each
 * record goes up through the account's own API with an idempotency key made of the account, the record and its
 * revision, and is marked moved (with the account's id for it) as soon as the server takes it, so a move that stops —
 * offline, a refusal, the app closed — resumes with what is left and never creates a second copy. A backup of the
 * whole Local Profile is written before the first upload and kept until the account confirms holding every record;
 * only then are the moved records removed from this device. Failures are reported per record and lose nothing.
 */
export interface MoveAccount { key: string; orgId: string | null; timezone: string }
export interface MoveClient { get: (path: string) => Promise<unknown>; post: (path: string, body: unknown, key: string) => Promise<unknown>; put: (path: string, body: unknown, key: string) => Promise<unknown> }
/** Where the pre-move backup lives until the account confirms the move. */
export interface MoveBackup { exists: () => boolean; write: (text: string) => void; remove: () => void }

type Entry = { kind: 'note' | 'task' | 'event'; item: LocalItem } | { kind: 'contact'; item: LocalContact };
const PATHS = { note: '/api/notes', task: '/api/tasks', event: '/api/calendar/events', contact: '/api/contacts' } as const;

/** An instant as the account's wall clock, "YYYY-MM-DDTHH:MM", as the desktop's own forms send it. */
export function accountWall(instant: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
/** This computer's day of an instant (an all-day event is a day here, whatever the account's zone). */
function deviceDay(instant: string): string {
  const d = new Date(instant);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** What the account's API takes to create a record, as its own screens send it. */
export function movePayload(record: Entry, account: MoveAccount): unknown {
  if (record.kind === 'contact') {
    const { id: _id, revision: _r, createdAt: _c, updatedAt: _u, favorite: _f, archived: _a, log: _l, labels, ...fields } = record.item;
    return { ...fields, labels: labels.join(', ') };
  }
  const item = record.item;
  const m = item.meta ?? {};
  if (record.kind === 'note') return { title: item.title, body: htmlOf(item), tags: m.tags ?? [] };
  if (record.kind === 'task') {
    const status = m.status ?? (item.completed ? 'done' : 'todo');
    return {
      title: item.title, description: htmlOf(item), status, priority: m.priority ?? 'none', tags: m.tags ?? [],
      ...(m.dueDay ? { due_date: m.dueDay } : item.due ? { due_date: accountWall(item.due, account.timezone) } : {}),
      ...(m.startDay ? { start_date: m.startDay } : item.start ? { start_date: accountWall(item.start, account.timezone) } : {}),
      ...(m.hours ? { estimated_hours: m.hours } : {}),
      ...(account.orgId ? { org_id: Number(account.orgId) || account.orgId } : {}),
    };
  }
  const allDay = !!m.allDay;
  const start = item.start!;
  const end = item.end ?? start;
  const remind = m.reminderOffset !== undefined ? m.reminderOffset : item.reminder ? Math.max(0, Math.round((Date.parse(start) - Date.parse(item.reminder)) / 60_000)) : null;
  return {
    title: item.title, description: plainOf(item), category: m.category ?? '', location: m.location ?? '', ...(m.color ? { color: m.color } : {}),
    start: allDay ? deviceDay(start) : accountWall(start, account.timezone), end: allDay ? deviceDay(end) : accountWall(end, account.timezone), all_day: allDay, remind_minutes: remind,
  };
}

const idOf = (response: unknown): string | null => {
  const id = (response as { id?: unknown } | null)?.id;
  return typeof id === 'number' || (typeof id === 'string' && id) ? String(id) : null;
};

export class LocalWorkspaceMove {
  private busy = false;
  constructor(private readonly store: LocalWorkspace, private readonly backup: MoveBackup) {}

  private records(): Entry[] {
    return [...this.store.items().map((item) => ({ kind: item.kind, item }) as Entry), ...this.store.contacts().map((item) => ({ kind: 'contact', item }) as Entry)];
  }
  private pending(account: string): Entry[] { return this.records().filter((r) => this.store.movedRevision(account, r.item.id) !== r.item.revision); }

  /** What is left to move into this account. */
  offer(account: string): MoveOffer {
    const left = this.pending(account);
    const count = (kind: Entry['kind']) => left.filter((r) => r.kind === kind).length;
    return { notes: count('note'), tasks: count('task'), contacts: count('contact'), events: count('event'), total: left.length };
  }

  private key(account: string, ...parts: Array<string | number>): string {
    return `local-move-${createHash('sha256').update(JSON.stringify([account, ...parts])).digest('hex')}`;
  }

  /** Uploads one record and what lives inside it (a task's checklist, a contact's notes); the account's id for it. */
  private async upload(record: Entry, account: MoveAccount, client: MoveClient): Promise<string> {
    const { item } = record;
    const created = idOf(await client.post(PATHS[record.kind], movePayload(record, account), this.key(account.key, item.id, item.revision)));
    if (!created) throw new Error('The account did not confirm this item.');
    if (record.kind === 'task') {
      for (const entry of record.item.meta?.checklist ?? []) {
        const added = await client.post(`/api/tasks/${created}/checklist`, { title: entry.title }, this.key(account.key, item.id, item.revision, 'checklist', entry.id));
        const addedId = idOf(added);
        if (entry.done && addedId) await client.put(`/api/tasks/${created}/checklist/${addedId}`, { done: true }, this.key(account.key, item.id, item.revision, 'done', entry.id));
      }
    }
    if (record.kind === 'contact') {
      for (const note of record.item.log) await client.post(`/api/contacts/${created}/notes`, { body: note.body }, this.key(account.key, item.id, item.revision, 'note', note.id));
    }
    return created;
  }

  async run(account: MoveAccount, client: MoveClient, current: () => string | null): Promise<MoveResult> {
    if (this.busy) throw new DesktopError('SERVER_ERROR', 'Your local data is already moving.');
    this.busy = true;
    const failures: MoveResult['failures'] = [];
    let moved = 0;
    try {
      const pending = this.pending(account.key);
      // The safety copy comes first: until the account confirms every record, it stays.
      if (pending.length && !this.backup.exists()) this.backup.write(this.store.export());
      for (const record of pending) {
        const title = record.kind === 'contact' ? record.item.display_name : record.item.title;
        if (current() !== account.key) { failures.push({ kind: record.kind, title, message: 'The account changed. Sign in to it again to move this.' }); continue; }
        try {
          const remote = await this.upload(record, account, client);
          this.store.markMoved(account.key, record.item.id, record.item.revision, remote);
          moved++;
        } catch (error) { failures.push({ kind: record.kind, title, message: (error as Error).message || 'The account refused this item.' }); }
      }
      // Confirmation: the account must show every record before anything leaves this device.
      if (!failures.length) {
        for (const record of this.records()) {
          const remote = this.store.movedRemote(account.key, record.item.id);
          if (!remote) continue;
          const title = record.kind === 'contact' ? record.item.display_name : record.item.title;
          try { await client.get(`${PATHS[record.kind]}/${encodeURIComponent(remote)}`); }
          catch (error) { failures.push({ kind: record.kind, title, message: `Uploaded, but the account has not confirmed it yet: ${(error as Error).message}` }); }
        }
      }
      if (!failures.length && current() === account.key) {
        this.store.forgetMoved(account.key);
        this.backup.remove();
      }
      const remaining = this.pending(account.key).length;
      return { moved, failures, remaining: failures.length ? Math.max(remaining, failures.length) : remaining, backupKept: this.backup.exists() };
    } finally { this.busy = false; }
  }
}
