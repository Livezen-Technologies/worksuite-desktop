import { randomUUID, createHash } from 'node:crypto';
import type { ImportResult, ImportReview, LocalItem } from '@shared/local-workspace';
import { DesktopError } from '../main/errors';
import { type LocalWorkspace, localFingerprint } from './local-workspace';
export interface ImportAccount { key: string; name: string; organization: string; orgId: string | null; timezone: string }
export interface ImportClient { get: (path: string) => Promise<unknown>; post: (path: string, body: unknown, key: string) => Promise<unknown> }
const paths = { note: '/api/notes', task: '/api/tasks', event: '/api/calendar/events' };
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const rich = (text: string) => `<p>${escape(text).replace(/\n/g, '<br>')}</p>`;
/** Server calendar APIs take wall time; task due_at accepts an absolute instant. */
function wall(instant: string | null, timezone: string): string | null {
  if (!instant) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant));
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}
export function importPayload(item: LocalItem, account: ImportAccount): unknown {
  if (item.kind === 'note') return { title: item.title, body: rich(item.body) };
  if (item.kind === 'task') return { title: item.title, description: rich(item.body), status: item.completed ? 'done' : 'todo', due_at: item.due, org_id: account.orgId };
  return { title: item.title, description: item.body, start: wall(item.start, account.timezone), end: wall(item.end, account.timezone), all_day: false, remind_minutes: item.start && item.reminder ? Math.max(0, Math.round((Date.parse(item.start) - Date.parse(item.reminder)) / 60000)) : null };
}
export class LocalWorkspaceImport {
  private reviews = new Map<string, { account: ImportAccount; client: ImportClient; rows: ImportReview['rows']; at: number }>();
  private busy = false;
  constructor(private readonly store: LocalWorkspace, private readonly current: () => ImportAccount | null) {}
  async review(client: ImportClient): Promise<ImportReview> {
    const account = this.current();
    if (!account) throw new DesktopError('NOT_SIGNED_IN', 'Sign in before reviewing an import.');
    const rows: ImportReview['rows'] = [];
    const items = this.store.read().items;
    for (const kind of ['note', 'task', 'event'] as const) {
      if (!items.some((item) => item.kind === kind)) continue;
      let path = paths[kind];
      if (kind === 'task') path += '?include_archived=1';
      if (kind === 'event') {
        const dates = items.filter((item) => item.kind === 'event').map((item) => wall(item.start, account.timezone)!.slice(0, 10)).sort();
        path += `?from=${dates[0]}&to=${dates[dates.length - 1]}`;
      }
      const data = await client.get(path);
      const list = Array.isArray(data) ? data : (data as { tasks?: unknown[]; events?: unknown[] })?.[kind === 'task' ? 'tasks' : 'events'];
      if (!Array.isArray(list)) throw new DesktopError('SERVER_ERROR', 'The account did not return a valid duplicate review. Nothing was imported.');
      let limited = list.length >= (kind === 'note' ? 1000 : kind === 'task' ? 500 : 2000);
      if (kind === 'note') {
        const archived = await client.get('/api/notes?archived=1');
        if (!Array.isArray(archived)) throw new DesktopError('SERVER_ERROR', 'Archived note duplicate review was unavailable. Nothing was imported.');
        limited ||= archived.length >= 1000;
        list.push(...archived);
      }
      const titles = new Set(list.map((item) => String((item as { title?: string }).title ?? '').trim().toLowerCase()));
      for (const item of items.filter((item) => item.kind === kind)) rows.push({ item, duplicate: limited || titles.has(item.title.trim().toLowerCase()), alreadyImported: this.store.wasImported(account.key, item) });
    }
    if (this.current()?.key !== account.key) throw new DesktopError('PERMISSION_DENIED', 'The selected account changed. Review again.');
    const token = randomUUID(); this.reviews.clear(); this.reviews.set(token, { account, client, rows, at: Date.now() });
    return { token, account: account.name, organization: account.organization, rows };
  }
  async run(token: string, ids: string[], copies: boolean): Promise<ImportResult> {
    const review = this.reviews.get(token);
    if (!review || Date.now() - review.at > 600_000 || this.current()?.key !== review.account.key) throw new DesktopError('PERMISSION_DENIED', 'The import review expired or the account changed. Review again.');
    if (this.busy) throw new DesktopError('SERVER_ERROR', 'An import is already running.');
    this.busy = true;
    const result: ImportResult = { imported: 0, skipped: 0, failures: [] };
    try {
      for (const id of new Set(ids)) {
        if (this.current()?.key !== review.account.key) throw new DesktopError('PERMISSION_DENIED', 'Account changed. Remaining items were not uploaded.');
        const row = review.rows.find((entry) => entry.item.id === id);
        const item = this.store.get(id);
        if (!row || !item || item.revision !== row.item.revision) throw new DesktopError('SERVER_ERROR', 'Local data changed after review. Review again.');
        if (this.store.wasImported(review.account.key, item) || (row.duplicate && !copies)) { result.skipped++; continue; }
        try {
          await review.client.post(paths[item.kind], importPayload(item, review.account), `local-import-${createHash('sha256').update(review.account.key + localFingerprint(item)).digest('hex')}`);
          this.store.markImported(review.account.key, item); result.imported++;
        } catch (error) { result.failures.push({ title: item.title, message: (error as Error).message }); }
      }
      return result;
    } finally { this.busy = false; }
  }
}
