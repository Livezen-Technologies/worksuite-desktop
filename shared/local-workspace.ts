import { z } from 'zod';
const stamp = z.string().datetime({ offset: true }).nullable();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/**
 * What the module screens keep beside an item's core fields (#149): a note's tags and flags, a task's status, priority
 * and checklist, an event's all-day flag, place and colour. Items saved before #149 have none; every field is optional.
 */
export const localItemMeta = z.object({
  html: z.boolean(), tags: z.array(z.string().trim().min(1).max(60)).max(50), pinned: z.boolean(), favorite: z.boolean(), archived: z.boolean(),
  status: z.enum(['backlog', 'todo', 'in_progress', 'on_hold', 'review', 'changes_requested', 'done', 'cancelled']),
  priority: z.enum(['urgent', 'high', 'medium', 'low', 'none']),
  dueDay: day.nullable(), startDay: day.nullable(), hours: z.number().min(0).max(10_000).nullable(), progress: z.number().int().min(0).max(100),
  checklist: z.array(z.object({ id: z.number().int().positive(), title: z.string().trim().min(1).max(500), done: z.boolean() })).max(200),
  reminderOffset: z.number().int().min(0).max(525_600).nullable(),
  allDay: z.boolean(), location: z.string().max(500).nullable(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(), category: z.string().max(100).nullable(),
}).partial();
export type LocalItemMeta = z.output<typeof localItemMeta>;
export const localItemInput = z.object({
  id: z.string().uuid().optional(), revision: z.number().int().nonnegative().optional(),
  kind: z.enum(['note', 'task', 'event']), title: z.string().trim().min(1).max(200),
  body: z.string().max(200_000).default(''), completed: z.boolean().default(false),
  due: stamp.default(null), start: stamp.default(null), end: stamp.default(null), reminder: stamp.default(null),
  meta: localItemMeta.default({}),
}).superRefine((item, ctx) => {
  if (item.kind === 'event' && !item.start) ctx.addIssue({ code: 'custom', message: 'An event needs a start time.' });
  if (item.start && item.end && Date.parse(item.end) < Date.parse(item.start)) ctx.addIssue({ code: 'custom', message: 'End time must follow start time.' });
});
export type LocalItemInput = z.input<typeof localItemInput>;
export type LocalItemData = z.output<typeof localItemInput>;
export interface LocalItem extends LocalItemData { id: string; revision: number; updatedAt: string; firedAt: string | null }

const text = (max = 255) => z.string().trim().max(max).nullable().default(null);
/** A personal contact kept on this device (#149). Its notes live with it. */
export const localContactInput = z.object({
  id: z.string().uuid().optional(), revision: z.number().int().nonnegative().optional(),
  display_name: z.string().trim().min(1).max(200),
  type: z.enum(['personal', 'employee', 'customer', 'vendor', 'supplier', 'partner', 'organization', 'team', 'emergency', 'shared']).default('personal'),
  first_name: text(), last_name: text(), job_title: text(), department: text(), company: text(),
  work_email: text(), personal_email: text(), mobile: text(60), office_phone: text(60), home_phone: text(60), website: text(500),
  birthday: day.nullable().default(null), gender: text(30), street: text(500), city: text(), state: text(), zip: text(30), country: text(),
  customer_id: text(100), employee_id: text(100), vendor_id: text(100), tax_number: text(100), notes: text(20_000),
  labels: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  social: z.record(z.string().max(30), z.string().max(300)).default({}),
  favorite: z.boolean().default(false), archived: z.boolean().default(false),
  log: z.array(z.object({ id: z.number().int().positive(), body: z.string().max(20_000), pinned: z.boolean().default(false), created_at: z.string().max(40), updated_at: z.string().max(40).nullable().default(null) })).max(500).default([]),
});
export type LocalContactInput = z.input<typeof localContactInput>;
export interface LocalContact extends z.output<typeof localContactInput> { id: string; revision: number; createdAt: string; updatedAt: string }

export interface LocalView { items: LocalItem[]; contacts: LocalContact[]; meetingInput: string; meetingServer: string }
/** A small square picture kept with the profile: PNG, JPEG or WebP as a data URL. */
export const LOCAL_PICTURE_MAX = 400_000;
const picture = z.string().max(LOCAL_PICTURE_MAX, 'Choose a picture under 300 KB.').regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, 'Choose a PNG, JPEG or WebP picture.');
const displayName = z.string().trim().min(1, 'Enter a display name.').max(60);
/** First use, and later edits. `pin`: undefined keeps it, null removes it. */
export const localProfileInput = z.object({ name: displayName, picture: picture.nullable().default(null), pin: z.string().regex(/^\d{4,8}$/, 'A PIN is 4 to 8 digits.').nullable().optional() });
export type LocalProfileInput = z.input<typeof localProfileInput>;
/** What guest mode sees of its profile: never the PIN's hash. */
export interface LocalProfile { name: string; picture: string | null; hasPin: boolean; createdAt: string }
export interface LocalStatus { profile: LocalProfile | null; locked: boolean; language: string }
/** What Settings › Backup & data shows. */
export interface LocalOverview { notes: number; tasks: number; contacts: number; events: number; meetingInput: string; meetingServer: string }
const backupItems = z.array(localItemInput.and(z.object({ firedAt: stamp.default(null) }))).max(10_000);
const backupCommon = { items: backupItems, meetingInput: z.string().max(2048).default(''), meetingServer: z.string().max(512).default('') };
const backupProfile = z.object({ name: displayName, picture: picture.nullable().default(null) }).nullable().default(null);
/** Version 1 (#86) had no profile; version 2 adds the display name and picture; version 3 (#149) adds contacts. A PIN is never exported. */
export const localBackup = z.discriminatedUnion('version', [
  z.object({ format: z.literal('worksuite-local'), version: z.literal(1), ...backupCommon }),
  z.object({ format: z.literal('worksuite-local'), version: z.literal(2), profile: backupProfile, ...backupCommon }),
  z.object({ format: z.literal('worksuite-local'), version: z.literal(3), profile: backupProfile, contacts: z.array(localContactInput).max(10_000).default([]), ...backupCommon }),
]);
export const LOCAL_BACKUP_VERSION = 3;
export interface RestorePreview { token: string; notes: number; tasks: number; events: number; contacts: number; duplicates: number; profileName: string | null }
/** Search across a list's title and text, case- and accent-insensitive; every word must match. */
export function searchLocalItems<T extends { title: string; body: string }>(items: T[], query: string): T[] {
  const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((item) => { const haystack = fold(`${item.title}\n${item.body}`); return words.every((word) => haystack.includes(word)); });
}
/** What signing in from guest mode offers to move into the account (#149): counts only, never the items. */
export interface MoveOffer { notes: number; tasks: number; contacts: number; events: number; total: number }
/** A move's outcome: every item either moved or is named with why; the backup stays until every upload is confirmed. */
export interface MoveResult { moved: number; failures: Array<{ kind: 'note' | 'task' | 'event' | 'contact'; title: string; message: string }>; remaining: number; backupKept: boolean }
export const LOCAL_CHANNELS = new Set(['local:enter', 'local:leave', 'local:status', 'local:profile', 'local:unlock', 'local:api', 'local:overview', 'local:export', 'local:restorePreview', 'local:restore', 'local:deleteAll', 'local:meeting', 'local:joinMeeting']);
