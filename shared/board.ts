import { z } from 'zod';

/**
 * WorkSuite Board on the desktop (SRS-BOARD-001 v1.2, §9 API at `/api/board`): what the renderer and the main
 * process share — the notification links, the offline pack vault's IPC contract (FR-OFF-01..03, FR-DEV-02/03) and the
 * rules for circular responses recorded offline (FR-VOT-08, FR-CIR-05). The server decides everything; what is
 * checked here only saves a round trip and is checked by the server again.
 */

// ── notifications (the server's Notification Centre keys, category `board`) ──

/**
 * Which Board screen each notification key opens (docs/board/API.md "Notifications"). `data` carries the ids:
 * `board_meeting_id`, `paper_id`, `circular_id`, `action_id`.
 */
export const BOARD_SCREENS: Readonly<Record<string, string>> = {
  'board.meeting.published': 'agenda',
  'board.meeting.updated': 'agenda',
  'board.meeting.cancelled': 'home',
  'board.pack.published': 'agenda',
  'board.pack.revised': 'agenda',
  'board.paper.requested': 'home',
  'board.paper.updated': 'agenda',
  'board.paper.overdue': 'home',
  'board.vote.opened': 'room',
  'board.vote.closing': 'room',
  'board.circular.created': 'approvals',
  'board.circular.reminder': 'approvals',
  'board.approval.requested': 'approvals',
  'board.minutes.review': 'approvals',
  'board.action.assigned': 'actions',
  'board.action.overdue': 'actions',
  'board.member.term_ending': 'home',
  'board.conflict.recorded': 'agenda',
  'board.notice': 'home',
};

const id = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : typeof v === 'string' && /^\d{1,12}$/.test(v) ? Number(v) : null);

/** The desktop link for a Board notification, or null when the key is not one of ours. */
export function boardNoticeLink(event: string | null | undefined, data?: unknown): string | null {
  const view = event ? BOARD_SCREENS[event] : undefined;
  if (!view) return null;
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const meeting = id(d.board_meeting_id) ?? id(d.meeting_id);
  if (view === 'agenda' || view === 'room') return meeting ? `/board?view=${view}&meeting=${meeting}` : '/board?view=home';
  const circular = id(d.circular_id);
  if (view === 'approvals' && circular) return `/board?view=approvals&circular=${circular}`;
  return `/board?view=${view}`;
}

/**
 * The server's refusal of a blocked or revoked device (`X-Board-Device`, FR-DEV-03):
 * `403 {errors: {code: "device_blocked"|"device_revoked", command: "WIPE"}}`.
 */
export const BOARD_WIPE_CODES: ReadonlySet<string> = new Set(['device_blocked', 'device_revoked']);

/** What a Board error tells this device to do: wipe (and why), or nothing. */
export function boardDeviceRefusal(status: number | null | undefined, errors: unknown): 'blocked' | 'revoked' | null {
  if (status !== 403 || !errors || typeof errors !== 'object') return null;
  const e = errors as { code?: unknown; command?: unknown };
  const code = typeof e.code === 'string' ? e.code : '';
  if (BOARD_WIPE_CODES.has(code)) return code === 'device_blocked' ? 'blocked' : 'revoked';
  return e.command === 'WIPE' ? 'revoked' : null;
}

// ── the offline vault (FR-OFF-01..03) ──────────────────────────────────────

const intId = z.number().int().positive().max(2_147_483_647);

export const boardMeetingRef = z.strictObject({ meetingId: intId });
export const boardCircularRef = z.strictObject({ circularId: intId });

/**
 * Something done offline that waits for the server (FR-OFF-02): an annotation (sent through `POST /annotations/sync`,
 * last writer wins by `client_uuid` + `updated_at`) or a pack acknowledgement (`POST /packs/versions/{id}/acknowledge`).
 */
export const boardQueueInput = z.strictObject({
  kind: z.enum(['annotation', 'ack']),
  meetingId: intId,
  /** The annotation's `client_uuid`, client-made, so a later edit replaces the earlier one (last writer wins). */
  ref: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  body: z.record(z.string(), z.unknown()).refine((b) => JSON.stringify(b).length <= 20_000, 'Too large.'),
});

/** A circular response recorded offline (FR-VOT-08): signed with this device's Ed25519 key when it is recorded. */
export const boardOfflineResponseInput = z.strictObject({
  circularId: intId,
  choice: z.enum(['approve', 'reject', 'abstain']),
  comment: z.string().max(2000).optional(),
});

export const boardSearchInput = z.strictObject({ q: z.string().min(2).max(200) });

export type BoardPackState = 'ready' | 'downloading' | 'failed' | 'expired';

export interface BoardPackSummary {
  meetingId: number;
  title: string;
  /** The pack version the copy was made from (the grant manifest's `pack_version`). */
  version: number;
  pages: number | null;
  /** My notes kept with it. */
  notes: number;
  bytes: number;
  downloadedAt: string;
  /** The grant's `expires_at`: max offline days or the meeting's archiving, whichever is sooner (FR-OFF-03). */
  expiresAt: string;
  /** The server has published a newer version since. */
  latestVersion: number | null;
  state: BoardPackState;
}

export interface BoardVaultStatus {
  /** The OS keystore holds the key (Keychain, DPAPI, Secret Service); false keeps packs for this session only. */
  keystore: boolean;
  backend: string;
  /** This device's trust as Board last heard it (`POST /devices`, `/devices/check-in`). */
  trust: 'trusted' | 'pending' | 'revoked' | 'blocked' | 'unknown';
  lastSyncAt: string | null;
  packs: BoardPackSummary[];
  queued: number;
  /** Set once after a wipe, until the next sync: what was erased and why. */
  wiped: { at: string; reason: string } | null;
}

/** An offline pack opened from the vault: what was kept for the meeting, and the member's pack rendition. */
export interface BoardOfflinePack {
  summary: BoardPackSummary;
  manifest: BoardKeptManifest;
  file: Uint8Array | null;
}

/** What the vault keeps for a meeting: the server's signed grant manifest and the screens' copies taken with it. */
export interface BoardKeptManifest {
  /** The grant's manifest exactly as the server signed it (`Grant.manifest`). */
  grant: Record<string, unknown>;
  meeting: { id: number; title: string; meeting_number: string | null; body: string | null; starts_at: string | null };
  /** The agenda items this member may read, flattened. */
  agenda: Array<{ id: number; number: string; title: string; depth: number; papers: Array<{ id: number; title: string }> }>;
  /** My annotations (FR-ANN), as `GET /annotations?mine=1` gave them. */
  notes: Array<Record<string, unknown>>;
}

export interface BoardQueued {
  id: string;
  kind: 'annotation' | 'ack' | 'circular';
  meetingId: number | null;
  circularId: number | null;
  ref: string;
  at: string;
  /** Rejected by the server (or by the rules here) with a reason the person sees. */
  error: string | null;
  /** For a circular response: the server's verdict (ACCEPTED / REJECTED). */
  outcome: 'pending' | 'accepted' | 'rejected';
}

export interface BoardSearchHit {
  meetingId: number;
  type: 'agenda' | 'paper' | 'note';
  title: string;
  snippet: string;
  page: number | null;
}

// ── offline circular responses (FR-VOT-08, FR-CIR-05) ──────────────────────

/** The parts of the server's Circular the offline rules read. */
export interface CircularForOffline {
  id: number;
  /** `ISSUED` is open for responses (§6.4). */
  status: string;
  deadline_at: string | null;
  /** The circular allows offline responses (the board's `devices.offline_circular_responses` is checked by the server). */
  allow_offline?: boolean;
  secret?: boolean;
  me?: { eligible?: boolean; response?: string | null } | null;
}

const stamp = (s: string) => Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);

/** Why a response may not be recorded offline, or null when it may (FR-VOT-08; the server checks again on upload). */
export function offlineResponseRefusal(c: CircularForOffline | null | undefined, now = Date.now()): string | null {
  if (!c) return 'This circular is not in the offline vault.';
  if (!c.allow_offline) return "The board's policy does not allow responding offline.";
  if (c.me && c.me.eligible === false) return 'You are not eligible to respond to this circular.';
  if (c.me?.response) return 'You have already responded to this circular.';
  if (String(c.status).toUpperCase() !== 'ISSUED') return 'This circular is closed.';
  if (c.deadline_at) {
    const t = stamp(c.deadline_at);
    if (Number.isFinite(t) && t <= now) return 'The deadline has passed.';
  }
  return null;
}

/** Whether others' responses and comments may be shown (FR-CIR-05): set per circular, never for a secret one, and only after my own. */
export function showOthersResponses(c: { show_responses?: boolean; secret?: boolean } | null | undefined, responded: boolean): boolean {
  return !!c && !!c.show_responses && !c.secret && responded;
}

/** PHP's trim(): the server normalises the comment with it before rebuilding the signed bytes. */
const PHP_TRIM = new Set([' ', '\t', '\n', '\r', '\0', '\v']);
const phpTrim = (s: string) => {
  let a = 0;
  let b = s.length;
  while (a < b && PHP_TRIM.has(s[a]!)) a++;
  while (b > a && PHP_TRIM.has(s[b - 1]!)) b--;
  return s.slice(a, b);
};

/** The comment as the server keeps it (`Board::text($comment, 2000)`): trimmed, null when empty, 2,000 characters. */
export function offlineComment(comment: string | null | undefined): string | null {
  const t = phpTrim(comment ?? '');
  return t ? [...t].slice(0, 2000).join('') : null;
}

/**
 * What the device signs for an offline response — the server's `Circulars::offlinePayload()`: canonical JSON, keys
 * sorted, no spaces, slashes and Unicode unescaped (PHP `json_encode` still escapes U+2028/U+2029):
 * `{"circular_id":12,"comment":null,"device_signed_at":"2026-11-02T07:00:00Z","response":"APPROVE","user_id":4}`.
 * `device_signed_at` is signed exactly as it is sent.
 */
export function offlineResponsePayload(r: { circularId: number; userId: number; response: string; comment: string | null; signedAt: string }): string {
  const json = JSON.stringify({ circular_id: r.circularId, comment: offlineComment(r.comment), device_signed_at: r.signedAt, response: r.response.toUpperCase(), user_id: r.userId });
  return json.replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** The time sent as `device_signed_at`: ISO 8601 UTC to the second, as the server writes times. */
export const signedAtStamp = (ms: number): string => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');

export const packExpired = (expiresAt: string, now = Date.now()): boolean => {
  const t = stamp(expiresAt);
  return !Number.isFinite(t) || t <= now;
};

// ── the IPC contract (spread into shared/ipc/contract.ts) ──────────────────

const none = z.undefined().or(z.null()).optional();

export const boardContract = {
  'board:vaultStatus': { input: none, session: true },
  'board:packDownload': { input: boardMeetingRef, session: true, rate: 2 },
  'board:packOpen': { input: boardMeetingRef, session: true, rate: 10 },
  'board:packRemove': { input: boardMeetingRef, session: true, rate: 5 },
  'board:queueAdd': { input: boardQueueInput, session: true, rate: 30 },
  'board:queueList': { input: none, session: true },
  'board:respondOffline': { input: boardOfflineResponseInput, session: true, rate: 2, sensitive: true },
  'board:sync': { input: none, session: true, rate: 1 },
  'board:search': { input: boardSearchInput, session: true, rate: 10 },
  /** Step-up before signing (FR-SIG-04): the OS's own check where there is one. */
  'board:verify': { input: z.strictObject({ reason: z.string().min(1).max(120) }), session: true, rate: 1, sensitive: true },
};

export interface BoardOutputs {
  'board:vaultStatus': BoardVaultStatus;
  'board:packDownload': BoardPackSummary;
  'board:packOpen': BoardOfflinePack;
  'board:packRemove': BoardVaultStatus;
  'board:queueAdd': BoardQueued;
  'board:queueList': BoardQueued[];
  'board:respondOffline': BoardQueued;
  'board:sync': BoardVaultStatus;
  'board:search': BoardSearchHit[];
  'board:verify': { verified: boolean; method: 'touch-id' | 'none' };
}
