import { ch, none, mutationInputSchema, idString } from './contract-kit';
import { localProfileInput, type LocalStatus, type LocalProfile, type LocalOverview, type RestorePreview, type MoveOffer, type MoveResult } from '../local-workspace';
import { z } from 'zod';
import type { GuestMeetInfo, GuestMeetToken } from '../guest-meet';
import type { OfflineStatus, SubmitResult, OfflineSearchResult } from './contract';
import type { OfflineMutation, MailStoreStats, MailRepairResult, Draft } from '../types';

/** What is kept on this computer — the offline cache and queue, the Local Profile and guest mode: spread into `contract` (shared/ipc/contract.ts; audit D-G13). */
export const offlineContract = {

  // Guest mode runs in the main window (#149): entering it is refused while an account is signed in.
  'local:enter': ch(none, { rate: 4 }),
  'local:leave': ch(none),
  'local:status': ch(none),
  'local:profile': ch(localProfileInput, { rate: 2 }),
  'local:unlock': ch(z.object({ pin: z.string().max(8) }), { rate: 1 }),
  // The module screens' requests, answered from the Local Profile (electron/services/local-api.ts).
  'local:api': ch(z.object({ method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']), path: z.string().regex(/^\/api\/[^\s#\\]*$/).max(1024), query: z.record(z.string().max(64), z.union([z.string().max(2048), z.number(), z.boolean()])).optional(), body: z.unknown().optional() }), { rate: 60 }),
  'local:overview': ch(none),
  'local:export': ch(none, { rate: 2 }),
  'local:restorePreview': ch(none, { rate: 2 }),
  'local:restore': ch(z.object({ token: z.string().uuid() }), { rate: 2 }),
  'local:deleteAll': ch(z.object({ confirmation: z.literal('DELETE LOCAL DATA') }), { rate: 1 }),
  'local:meeting': ch(z.object({ input: z.string().max(2048), server: z.string().max(512) })),
  'local:joinMeeting': ch(z.object({ input: z.string().trim().min(1).max(2048), server: z.string().max(512).optional() }), { rate: 2 }),
  // Signing in from guest mode: what may move into this account, moving it, or keeping it on the device.
  'local:moveOffer': ch(none, { session: true }),
  'local:move': ch(none, { session: true, rate: 1 }),
  'local:keep': ch(none, { session: true }),
  'guest:pending': ch(none),
  'guest:open': ch(z.object({ input: z.string().trim().min(1).max(2048), server: z.string().max(512).optional() }), { rate: 2 }),
  'guest:info': ch(none, { rate: 2 }),
  'guest:join': ch(z.object({ name: z.string().trim().min(1).max(40).regex(/^[^\p{C}]+$/u), pass: z.string().max(128).optional() }), { rate: 2 }),
  'guest:signIn': ch(none),

  'offline:status': ch(none, { session: true }),
  'offline:pending': ch(none, { session: true }),
  /** How much one app's saved answers take on this computer. */
  'offline:moduleBytes': ch(z.object({ module: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/) }), { session: true }),
  /** Remove one app's saved answers from this computer (Mail › Clear). */
  'offline:clearModule': ch(z.object({ module: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/) }), { session: true, sensitive: true, rate: 1 }),
  /** What Mail keeps on this computer, by kind and by mailbox (Settings › Mail). */
  'offline:mailStats': ch(none, { session: true }),
  /**
   * Mail's saved answers for these GET paths, read from this computer without asking the server: the page shows
   * them at once and refreshes from the server behind them (worksuite-desktop#162). Null where nothing is saved.
   */
  'offline:peek': ch(z.strictObject({ paths: z.array(z.string().regex(/^\/api\/mail\/[A-Za-z0-9/_\-.,:@~]*(\?[^\s]*)?$/).max(2048)).min(1).max(12) }), { session: true, rate: 60 }),
  /**
   * Repair local mail data (worksuite-desktop#338): check the database; clear Mail's copy to be downloaded again, or
   * — the check failed — rebuild it on restart. Unsent mail, drafts and settings are kept either way.
   */
  'offline:repairMail': ch(none, { session: true, sensitive: true, rate: 1 }),
  /** Remove one mailbox's saved mail from this computer (the mailbox was removed from the account). */
  'offline:clearMailbox': ch(z.strictObject({ mailbox: z.string().regex(/^\d{1,12}$/) }), { session: true, sensitive: true, rate: 5 }),
  /** Mail search over what this computer keeps (lists and opened messages), for when the server cannot be reached. */
  'offline:mailSearch': ch(z.strictObject({ q: z.string().min(1).max(200) }), { session: true, rate: 30 }),
  /**
   * A folder's list from what this computer keeps (worksuite-desktop#208): every saved page of it, one row per
   * message, newest first, `limit` from `offset`. `mailbox` null is every account (All Accounts, with `role`).
   */
  'offline:mailList': ch(
    z.strictObject({
      mailbox: z.string().regex(/^\d{1,12}$/).nullable(),
      folder: z.string().min(1).max(500),
      role: z.enum(['inbox', 'drafts', 'archive', 'sent', 'trash', 'junk']).nullable().optional(),
      limit: z.number().int().min(1).max(500),
      offset: z.number().int().min(0).max(100_000).optional(),
    }),
    { session: true, rate: 60 },
  ),
  'offline:submit': ch(mutationInputSchema, { session: true, rate: 20 }),
  'offline:retry': ch(z.object({ id: idString }), { session: true }),
  'offline:discard': ch(z.object({ id: idString }), { session: true }),
  // A module's outbox (Support's D-09): a queued change's words and the server's answer, edited before it goes, and
  // the queue sent now.
  'offline:detail': ch(z.object({ id: idString }), { session: true }),
  'offline:edit': ch(z.object({ id: idString, body: z.unknown() }), { session: true, rate: 10 }),
  'offline:replay': ch(none, { session: true, rate: 2 }),
  'offline:saveDraft': ch(
    z.object({ module: z.string().max(64), context: z.string().max(256), content: z.unknown() }),
    { session: true, rate: 20 },
  ),
  'offline:getDraft': ch(z.object({ module: z.string().max(64), context: z.string().max(256) }), { session: true }),
  'offline:listDrafts': ch(z.object({ module: z.string().max(64).optional() }).optional(), { session: true }),
  'offline:deleteDraft': ch(z.object({ module: z.string().max(64), context: z.string().max(256) }), { session: true }),
  'offline:clearCache': ch(none, { session: true, sensitive: true, rate: 1 }),
  'offline:search': ch(z.object({ q: z.string().min(1).max(200) }), { session: true, rate: 10 }),
};

export interface OfflineOutputs {
  'local:enter': LocalStatus;
  'local:leave': void;
  'local:status': LocalStatus;
  'local:profile': LocalProfile;
  'local:unlock': { unlocked: boolean; retryAfter: number };
  'local:api': { status: number; data: unknown; message: string | null };
  'local:overview': LocalOverview;
  'local:export': { saved: boolean };
  'local:restorePreview': RestorePreview | null;
  'local:restore': { added: number; skipped: number };
  'local:deleteAll': void;
  'local:meeting': void;
  'local:joinMeeting': { id: number };
  'local:moveOffer': MoveOffer | null;
  'local:move': MoveResult;
  'local:keep': void;
  'guest:pending': { input: string; server?: string } | null;
  'guest:open': { id: number };
  'guest:info': GuestMeetInfo;
  'guest:join': GuestMeetToken;
  'guest:signIn': void;
  'offline:status': OfflineStatus;
  'offline:pending': OfflineMutation[];
  'offline:moduleBytes': number;
  'offline:clearModule': number;
  'offline:mailStats': MailStoreStats;
  'offline:peek': Array<{ body: string; cachedAt: string } | null>;
  'offline:clearMailbox': number;
  'offline:repairMail': MailRepairResult;
  'offline:mailSearch': Array<Record<string, unknown>>;
  'offline:mailList': { messages: Array<Record<string, unknown>>; total: number };
  'offline:submit': SubmitResult;
  'offline:retry': void;
  'offline:discard': void;
  'offline:detail': { body: unknown; response: unknown } | null;
  'offline:edit': void;
  'offline:replay': { done: number; conflicts: number; failed: number; remaining: number };
  'offline:saveDraft': Draft;
  'offline:getDraft': Draft | null;
  'offline:listDrafts': Draft[];
  'offline:deleteDraft': void;
  'offline:search': OfflineSearchResult[];
  'offline:clearCache': number;
}
