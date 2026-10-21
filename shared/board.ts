import { z } from 'zod';

/**
 * WorkSuite Board on the desktop (SRS-BOARD-001 v1.2, §9 API at `/api/board`): what the renderer and the main
 * process share — the notification links, the offline pack vault's IPC contract (FR-OFF-01..03, FR-DEV-02/03) and the
 * rules for circular responses recorded offline (FR-VOT-08, FR-CIR-05). The server decides everything; what is
 * checked here only saves a round trip and is checked by the server again.
 */

// ── notifications (§9.2 event bus) ─────────────────────────────────────────

/** Which Board screen each `board.*` event opens. Events the director need not act on open nothing of ours. */
export const BOARD_SCREENS: Readonly<Record<string, string>> = {
  'board.meeting.published': 'agenda',
  'board.meeting.created': 'home',
  'board.meeting.started': 'room',
  'board.agenda.updated': 'agenda',
  'board.pack.published': 'packs',
  'board.pack.revised': 'packs',
  'board.vote.opened': 'room',
  'board.circular.created': 'approvals',
  'board.minutes.submitted': 'approvals',
  'board.action.created': 'actions',
  'board.poll.closed': 'minutes',
};

const id = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : typeof v === 'string' && /^\d{1,12}$/.test(v) ? Number(v) : null);

/** The desktop link for a Board notification, or null when the key is not one of ours. */
export function boardNoticeLink(event: string | null | undefined, data?: unknown): string | null {
  const view = event ? BOARD_SCREENS[event] : undefined;
  if (!view) return null;
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const meeting = id(d.meeting_id);
  if ((view === 'agenda' || view === 'room' || view === 'minutes') && meeting) return `/board?view=${view}&meeting=${meeting}`;
  if (view === 'room' || view === 'agenda' || view === 'minutes') return '/board?view=home';
  const circular = id(d.circular_id);
  if (view === 'approvals' && circular) return `/board?view=approvals&circular=${circular}`;
  return `/board?view=${view}`;
}

/** Board events that end this computer's offline vault (FR-DEV-02, FR-DEV-03). */
export const BOARD_WIPE_EVENTS: ReadonlySet<string> = new Set(['board.device.revoked', 'board.device.blocked']);

/** Server error codes that mean the same as those events, met on any Board request. */
export const BOARD_WIPE_CODES: ReadonlySet<string> = new Set(['DEVICE_REVOKED', 'DEVICE_BLOCKED']);

// ── the offline vault (FR-OFF-01..03) ──────────────────────────────────────

const intId = z.number().int().positive().max(2_147_483_647);

export const boardMeetingRef = z.strictObject({ meetingId: intId });
export const boardCircularRef = z.strictObject({ circularId: intId });

/** Something done offline that waits for the server (FR-OFF-02): an annotation, an acknowledgement or a draft note. */
export const boardQueueInput = z.strictObject({
  kind: z.enum(['annotation', 'ack', 'note']),
  meetingId: intId,
  /** The annotation's or note's own id, client-made, so a later edit replaces the earlier one (last writer wins). */
  ref: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  body: z.record(z.string(), z.unknown()).refine((b) => JSON.stringify(b).length <= 20_000, 'Too large.'),
});

/** A circular response recorded offline (FR-VOT-08): signed with this device's key when it is recorded. */
export const boardOfflineResponseInput = z.strictObject({
  circularId: intId,
  choice: z.enum(['approve', 'reject', 'abstain']),
  comment: z.string().max(2000).optional(),
  /** The circular as the vault kept it, which the rules are checked against again in the main process. */
});

export const boardSearchInput = z.strictObject({ q: z.string().min(2).max(200) });

export type BoardPackState = 'ready' | 'downloading' | 'failed' | 'expired';

export interface BoardPackSummary {
  meetingId: number;
  title: string;
  /** The pack version the copy was made from. */
  version: number;
  pages: number | null;
  /** My notes kept with it. */
  notes: number;
  bytes: number;
  downloadedAt: string;
  /** min(grant expiry, now + max offline days, the meeting's archive date) — FR-OFF-03. */
  expiresAt: string;
  /** The server has published a newer version since. */
  latestVersion: number | null;
  state: BoardPackState;
}

export interface BoardVaultStatus {
  /** The OS keystore holds the key (Keychain, DPAPI, Secret Service); false keeps packs for this session only. */
  keystore: boolean;
  backend: string;
  /** This device's trust as Board last heard it. */
  trust: 'trusted' | 'revoked' | 'blocked' | 'unknown';
  lastSyncAt: string | null;
  packs: BoardPackSummary[];
  queued: number;
  /** Set once after a wipe, until the next sync: what was erased and why. */
  wiped: { at: string; reason: string } | null;
}

/** An offline pack opened from the vault: the server's manifest as it was given, and the pack file. */
export interface BoardOfflinePack {
  summary: BoardPackSummary;
  manifest: Record<string, unknown>;
  file: Uint8Array | null;
}

export interface BoardQueued {
  id: string;
  kind: 'annotation' | 'ack' | 'note' | 'circular';
  meetingId: number | null;
  circularId: number | null;
  ref: string;
  at: string;
  /** Rejected by the server (or by the rules here) with a reason the person sees. */
  error: string | null;
  /** For a circular response: what the server said when it was uploaded. */
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

export interface CircularForOffline {
  id: number;
  status: string;
  deadline: string | null;
  /** The board's policy allows recording a response offline. */
  offline_responses_allowed?: boolean;
  /** The server says this person may respond. */
  can_respond?: boolean;
  secret?: boolean;
  /** A vote in a live meeting: never offline. */
  live_meeting?: boolean;
}

const stamp = (s: string) => Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);

/** Why a response may not be recorded offline, or null when it may (FR-VOT-08; the server checks again on upload). */
export function offlineResponseRefusal(c: CircularForOffline | null | undefined, now = Date.now()): string | null {
  if (!c) return 'This circular is not in the offline vault.';
  if (c.live_meeting) return 'Votes in a live meeting are online only.';
  if (!c.offline_responses_allowed) return "The board's policy does not allow responding offline.";
  if (c.can_respond === false) return 'You are not eligible to respond to this circular.';
  if (String(c.status).toLowerCase() !== 'open') return 'This circular is closed.';
  if (c.deadline) {
    const t = stamp(c.deadline);
    if (Number.isFinite(t) && t <= now) return 'The deadline has passed.';
  }
  return null;
}

/** Whether others' responses and comments may be shown (FR-CIR-05): set per circular, never for a secret one, and only after my own. */
export function showOthersResponses(c: { show_responses?: boolean; secret?: boolean } | null | undefined, responded: boolean): boolean {
  return !!c && !!c.show_responses && !c.secret && responded;
}

/** What the device signs for an offline response: fixed field order, so the server rebuilds the same bytes. */
export function offlineResponsePayload(r: { circularId: number; choice: string; comment?: string | null; recordedAt: string; deviceId: string }): string {
  return ['ws-board-offline-response-v1', r.circularId, r.choice, r.comment ?? '', r.recordedAt, r.deviceId].join('\n');
}

/** The offline expiry (FR-OFF-03): the soonest of the grant's own end, the policy's max offline days, the archive date. */
export function packExpiry(o: { grantExpiresAt?: string | null; maxOfflineDays?: number | null; archiveAt?: string | null }, now = Date.now()): string {
  const candidates: number[] = [];
  if (o.grantExpiresAt) candidates.push(stamp(o.grantExpiresAt));
  if (o.maxOfflineDays && o.maxOfflineDays > 0) candidates.push(now + o.maxOfflineDays * 86_400_000);
  if (o.archiveAt) candidates.push(stamp(o.archiveAt));
  const finite = candidates.filter(Number.isFinite);
  // Nothing said: a day, not forever.
  return new Date(finite.length ? Math.min(...finite) : now + 86_400_000).toISOString();
}

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
