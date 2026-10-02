import { z } from 'zod';
const stamp = z.string().datetime({ offset: true }).nullable();
export const localItemInput = z.object({
  id: z.string().uuid().optional(), revision: z.number().int().nonnegative().optional(),
  kind: z.enum(['note', 'task', 'event']), title: z.string().trim().min(1).max(200),
  body: z.string().max(200_000).default(''), completed: z.boolean().default(false),
  due: stamp.default(null), start: stamp.default(null), end: stamp.default(null), reminder: stamp.default(null),
}).superRefine((item, ctx) => {
  if (item.kind === 'event' && !item.start) ctx.addIssue({ code: 'custom', message: 'An event needs a start time.' });
  if (item.start && item.end && Date.parse(item.end) < Date.parse(item.start)) ctx.addIssue({ code: 'custom', message: 'End time must follow start time.' });
});
export type LocalItemInput = z.output<typeof localItemInput>;
export interface LocalItem extends LocalItemInput { id: string; revision: number; updatedAt: string; firedAt: string | null }
export interface LocalView { items: LocalItem[]; meetingInput: string; meetingServer: string }
/** A small square picture kept with the profile: PNG, JPEG or WebP as a data URL. */
export const LOCAL_PICTURE_MAX = 400_000;
const picture = z.string().max(LOCAL_PICTURE_MAX, 'Choose a picture under 300 KB.').regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, 'Choose a PNG, JPEG or WebP picture.');
const displayName = z.string().trim().min(1, 'Enter a display name.').max(60);
/** First use, and later edits. `pin`: undefined keeps it, null removes it. */
export const localProfileInput = z.object({ name: displayName, picture: picture.nullable().default(null), pin: z.string().regex(/^\d{4,8}$/, 'A PIN is 4 to 8 digits.').nullable().optional() });
export type LocalProfileInput = z.input<typeof localProfileInput>;
/** What the guest window sees of its profile: never the PIN's hash. */
export interface LocalProfile { name: string; picture: string | null; hasPin: boolean; createdAt: string }
export interface LocalStatus { profile: LocalProfile | null; locked: boolean; language: string }
const backupItems = z.array(localItemInput.and(z.object({ firedAt: stamp.default(null) }))).max(10_000);
const backupCommon = { items: backupItems, meetingInput: z.string().max(2048).default(''), meetingServer: z.string().max(512).default('') };
/** Version 1 (#86) had no profile; version 2 adds the display name and picture. A PIN is never exported. */
export const localBackup = z.discriminatedUnion('version', [
  z.object({ format: z.literal('worksuite-local'), version: z.literal(1), ...backupCommon }),
  z.object({ format: z.literal('worksuite-local'), version: z.literal(2), profile: z.object({ name: displayName, picture: picture.nullable().default(null) }).nullable().default(null), ...backupCommon }),
]);
export const LOCAL_BACKUP_VERSION = 2;
export interface RestorePreview { token: string; notes: number; tasks: number; events: number; duplicates: number; profileName: string | null }
/** Search across a list's title and text, case- and accent-insensitive; every word must match. */
export function searchLocalItems(items: LocalItem[], query: string): LocalItem[] {
  const fold = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((item) => { const haystack = fold(`${item.title}\n${item.body}`); return words.every((word) => haystack.includes(word)); });
}
/** Features that need a WorkSuite account: shown locked in a Local Profile, never reachable from it. */
export const ONLINE_ONLY_FEATURES = ['Chat', 'Mail', 'Drive & Files', 'Company records', 'Shared workspaces', 'HR & People', 'CRM & Sales', 'AI Assistant'] as const;
export interface ImportReview { token: string; account: string; organization: string; rows: Array<{ item: LocalItem; duplicate: boolean; alreadyImported: boolean }> }
export interface ImportResult { imported: number; skipped: number; failures: Array<{ title: string; message: string }> }
export function isLocalWorkspaceHash(hash: string): boolean {
  return hash.startsWith('#/window/meet?') && new URLSearchParams(hash.split('?').slice(1).join('?')).get('route') === '/guest-workspace';
}
export const LOCAL_CHANNELS = new Set(['local:status', 'local:profile', 'local:unlock', 'local:read', 'local:save', 'local:remove', 'local:export', 'local:restorePreview', 'local:restore', 'local:deleteAll', 'local:meeting', 'local:joinMeeting', 'local:signIn']);
