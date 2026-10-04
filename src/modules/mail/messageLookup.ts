import { ApiError, type Query } from '../../core/api';
import { text } from '../../core/i18n';
import type { MessageRef } from './types';

/**
 * Opening a listed message (worksuite-desktop#209).
 *
 * A message is asked for by its whole identity — account, folder, UID, the
 * UIDVALIDITY the UID belongs to and its Message-ID (or the hash a mirrored
 * list carries) — so the server can find it again when the UID no longer
 * names it: moved on another device, or renumbered by a UIDVALIDITY change.
 * When it cannot be opened, the reader says which of these it is, each with
 * its own way forward, instead of one "Message not found":
 *
 *  - downloading: the body is on its way (the saved header shows meanwhile);
 *  - offline: this computer is offline and only the saved header is here;
 *  - signin: the account's sign-in failed — Fix account;
 *  - gone: deleted or moved where it cannot be found — Refresh folder;
 *  - server: anything else — the technical details, Copy and Retry.
 */

export type LookupProblem = 'offline' | 'signin' | 'gone' | 'server' | 'busy' | 'resync';

/** Where the server says a message went (`moved` on a message it found again). */
export interface MovedTo {
  folder: string;
  uid: number;
  name?: string | null;
}

/** The identity part of a message request. Retry asks for the full lookup (`locate=1`). */
export function identityQuery(ref: MessageRef, locate = false): Query {
  return {
    ...(ref.mid ? { message_id: ref.mid } : ref.midHash ? { mid_hash: ref.midHash } : {}),
    ...(ref.uidvalidity ? { uidvalidity: ref.uidvalidity } : {}),
    ...(locate ? { locate: 1 } : {}),
  };
}

function codeOf(e: unknown): string | null {
  if (!(e instanceof ApiError)) return null;
  const d = e.data as { code?: unknown } | null;
  return typeof d?.code === 'string' ? d.code : e.code;
}

/** Which problem an error is. `networkOffline`: the app knows it is offline. */
export function lookupProblem(e: unknown, networkOffline: boolean): LookupProblem {
  const code = codeOf(e);
  if (code === 'message_gone') return 'gone';
  if (code === 'mail_signin') return 'signin';
  // Every connection to the mail server was busy for ten seconds (#228); or the list row had no server ID.
  if (code === 'mail_busy') return 'busy';
  if (code === 'needs_resync') return 'resync';
  if (networkOffline || code === 'NETWORK_UNREACHABLE' || (e instanceof ApiError && (e.status === 0 || (e.status === 503 && !code)))) return 'offline';
  // An older server answers a message it could not find with a bare 404.
  if (e instanceof ApiError && e.status === 404) return 'gone';
  return 'server';
}

export function problemTitle(p: LookupProblem): string {
  if (p === 'offline') return text('Offline: showing the saved header only');
  if (p === 'signin') return text("Couldn't sign in to the account");
  if (p === 'gone') return text('This email was deleted or moved on another device');
  if (p === 'busy') return text('Timed out waiting for a connection to the mail server');
  if (p === 'resync') return text('This email has no server ID yet. Its folder is being synced again');
  return text('The mail server could not open this email');
}

/** What support needs to see: the request and the server's answer, as plain text for Copy. */
export function problemDetails(e: unknown, ref: MessageRef): string {
  const lines = [`mailbox: ${ref.mailbox ?? '-'}`, `folder: ${ref.folder}`, `uid: ${ref.uid}`, `uidvalidity: ${ref.uidvalidity ?? '-'}`, `message-id: ${ref.mid ?? ref.midHash ?? '-'}`];
  if (e instanceof ApiError) lines.push(`status: ${e.status}`, `code: ${codeOf(e) ?? '-'}`, `server: ${e.message}`);
  else lines.push(`error: ${e instanceof Error ? e.message : String(e)}`);
  return lines.join('\n');
}
