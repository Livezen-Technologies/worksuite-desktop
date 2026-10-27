import type { UpdateState, UpdateChannel } from './types';

/** Updates: their status, releases, the pipeline, busy reports and diagnostics. Re-exported by shared/types.ts (audit D-G13). */

export interface UpdateStatus {
  state: UpdateState;
  channel: UpdateChannel;
  currentVersion: string;
  availableVersion: string | null;
  minimumVersion: string | null;
  required: boolean;
  critical: boolean;
  progress: number;
  error: string | null;
  lastCheckedAt: string | null;
  deadline: string | null;
  signatureVerified: boolean;
  notesUrl: string | null;
  installSupported: boolean;
  /** Why the build cannot install updates itself, when it cannot. */
  installBlockedReason: string | null;
  /** The channels this computer may follow (organisation policy), and why it may not choose, when it may not. */
  allowedChannels?: UpdateChannel[];
  channelLockReason?: string | null;
  /** "What's new" for the version on offer, from the Update Center's signed answer. */
  notes?: ReleaseNotes | null;
  /** A security fix (the Update Center's release type SECURITY or CRITICAL). */
  security?: boolean;
  /** The channel this computer was on is no longer allowed: it follows `to` now, without a downgrade. */
  channelFallback?: { from: UpdateChannel; to: UpdateChannel } | null;
  /** Later: when the reminder comes back (ISO), or 'next-launch'. */
  snoozedUntil?: string | null;
  /** How many times this version was put off. */
  postponed?: number;
  /** A critical update put off more than once installs when WorkSuite next starts. */
  installOnNextLaunch?: boolean;
  /** Moved to a more stable channel: this build is ahead of it until it catches up. */
  waitingForChannel?: { channel: UpdateChannel; version: string } | null;
  /** The offer is an older build, asked for with "Reinstall …" (a downgrade). */
  downgrade?: boolean;
  /** Updated and started: shown once as "Updated to X · What's new". */
  justUpdated?: { version: string; notesUrl: string | null } | null;
  /** The last update failed to start and the previous version came back (or could not). */
  rollback?: { failedVersion: string; restored: boolean; message: string } | null;
  /** Notifications wait while this is going on (a meeting, a call, a screen share, remote control). */
  quietReason?: string | null;
  /** What the Update Center's signed answer says about the version on offer (Settings › Updates, the update dialog). */
  release?: ReleaseInfo | null;
  /** The download in progress: bytes, speed, time left, paused, retrying after a network loss. */
  download?: DownloadProgress | null;
  /** Manifest signature → Download → SHA-256 → Code signature → Stage, each with where it stands. */
  pipeline?: PipelineStep[] | null;
  /** How this copy updates: exe, dmg, appimage, deb or rpm (null: it cannot update itself). worksuite-desktop#345. */
  installKind?: string | null;
  /** This version must be replaced: since when, by when, and whether modules are locked now. */
  mandatory?: MandatoryUpdate | null;
  /** The last update that failed: a code, the rollback state and a reference for support. */
  failure?: UpdateFailure | null;
  /** When the next scheduled check runs (ISO). */
  nextCheckAt?: string | null;
  /** "Restart when work finishes": WorkSuite restarts once nothing would be interrupted. */
  restartWhenFree?: boolean;
  /** A critical release installs after a short grace period (the release's `grace_minutes`, default 5). */
  immediate?: ImmediateUpdate | null;
  /** "What's New in X" after the restart, shown once: the highlights and the local database steps that ran. */
  justUpdatedNotes?: { highlights: string[]; summary: string | null; schema: { from: number; to: number } | null } | null;
}

export interface ReleaseInfo {
  buildNumber: number | null;
  /** When the release was published (ISO), when the Update Center says. */
  publishedAt: string | null;
  /** RECOMMENDED, OPTIONAL, SECURITY, CRITICAL … as the Update Center says. */
  releaseType: string | null;
  /** The Update Center's channel for the answer (stable, beta, dev). */
  channel: string | null;
  packageType: string | null;
  packageSize: number | null;
  /** The key that signed the answer (`key_id`). */
  keyId: string | null;
  /** Who signed the build, when the Update Center says. */
  publisher: string | null;
  securityFixes: number | null;
  knownIssues: string[];
}

export interface DownloadProgress {
  received: number;
  total: number;
  bytesPerSecond: number;
  /** Seconds left at the current speed, or null when unknown. */
  secondsLeft: number | null;
  paused: boolean;
  /** Lost the network and trying again (it resumes where it stopped). */
  retrying: boolean;
  /** The server accepts ranges: a pause or a lost connection carries on where it stopped. */
  resumable: boolean;
}

export type PipelineStepId = 'manifest' | 'download' | 'sha256' | 'codesign' | 'stage';
export interface PipelineStep {
  id: PipelineStepId;
  state: 'pending' | 'active' | 'done' | 'failed' | 'skipped';
  detail: string;
}

export interface MandatoryUpdate {
  /** Why: below the policy's minimum version, the release says required, or the server refused this version. */
  reason: 'minimum' | 'release' | 'server';
  /** The lowest version that is still allowed, when known. */
  requiredVersion: string | null;
  since: string;
  /** Install by (ISO): first required + the policy's `forced_update_deadline_hours`, or the release's own date. */
  deadline: string | null;
  /** The server refuses this version on business APIs (UPDATE_REQUIRED): modules lock now, whatever the deadline. */
  serverRejected: boolean;
  /** How many times it may be put off. */
  maxDeferrals: number;
}

export interface UpdateFailure {
  code: string;
  message: string;
  version: string | null;
  /** Rollback state: none needed, put back, could not put back, or not possible on this platform. */
  rollback: 'none' | 'ok' | 'failed' | 'not-possible';
  /** A short reference for support, also in the update history. */
  ref: string;
  at: string;
}

export interface ImmediateUpdate {
  version: string;
  graceMinutes: number;
  graceEndsAt: string;
  /** What was saved before the restart, once it has been. */
  saved: { flushed: boolean; drafts: number; pendingMutations: number } | null;
}

export interface ReleaseNotes {
  version: string;
  summary: string | null;
  highlights: string[];
  url: string | null;
}

/** What would be interrupted by a restart right now. */
export interface UpdateActivity {
  meeting: boolean;
  call: boolean;
  screenShare: boolean;
  remoteControl: boolean;
}

export interface BusyReport {
  uploads: number;
  downloads: number;
  pendingMutations: number;
  drafts: number;
  activeCall: boolean;
  /** A meeting, screen share or remote-control session (worksuite-desktop#205); absent from older callers. */
  activity?: UpdateActivity;
  /** What exactly is going on, for the Update Ready dialog; absent from older callers. */
  details?: BusyDetails;
}

export interface BusyDetails {
  /** Calls and meetings in progress, by their window's title. */
  calls: Array<{ kind: 'call' | 'meet'; title: string }>;
  /** Transfers still running: name, direction and how far along. */
  transfers: Array<{ name: string; direction: 'upload' | 'download'; percent: number }>;
  /** Saved drafts by module (mail, chat, notes …). */
  draftModules: Record<string, number>;
}

/** One check on Settings › Updates › Diagnostics. */
export interface UpdateDiagnosticCheck {
  // repo-*: a .deb/.rpm install's WorkSuite package repository (worksuite-desktop#351).
  id: 'service' | 'version' | 'channel' | 'signature' | 'download' | 'disk' | 'permissions' | 'database' | 'license' | 'repo-file' | 'repo-key' | 'repo-version';
  label: string;
  status: 'pass' | 'low' | 'fail' | 'skip';
  detail: string;
  /** A fix for this check in particular, when the generic one does not fit. */
  fix?: string;
  /** A Fix button next to the check: `fix-repo` rewrites the package source and key through pkexec (`updates:fixRepo`). */
  action?: 'fix-repo';
}

export interface UpdateDiagnostics {
  ranAt: string;
  checks: UpdateDiagnosticCheck[];
}

export interface DiagnosticCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail' | 'skip';
  detail: string;
  ms?: number;
}
