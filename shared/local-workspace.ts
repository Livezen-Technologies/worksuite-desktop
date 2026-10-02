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
export const localBackup = z.object({ format: z.literal('worksuite-local'), version: z.literal(1), items: z.array(localItemInput.and(z.object({ firedAt: stamp.default(null) }))).max(10_000), meetingInput: z.string().max(2048).default(''), meetingServer: z.string().max(512).default('') });
export interface ImportReview { token: string; account: string; organization: string; rows: Array<{ item: LocalItem; duplicate: boolean; alreadyImported: boolean }> }
export interface ImportResult { imported: number; skipped: number; failures: Array<{ title: string; message: string }> }
export function isLocalWorkspaceHash(hash: string): boolean {
  return hash.startsWith('#/window/meet?') && new URLSearchParams(hash.split('?').slice(1).join('?')).get('route') === '/guest-workspace';
}
export const LOCAL_CHANNELS = new Set(['local:read', 'local:save', 'local:remove', 'local:export', 'local:restore', 'local:deleteAll', 'local:meeting', 'local:signIn']);
