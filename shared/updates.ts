import type { BusyReport, DesktopPolicy, Preferences, UpdateActivity, UpdateChannel, UpdateDiagnosticCheck, UpdateStatus } from './types';
import { channelAccepts } from './release';
import { parseVersion } from './version';

/**
 * Update channels, what an organisation lets people choose, and the timing rules for update notices
 * (worksuite-desktop#205). Pure functions, shared by the main process (which enforces them) and Settings › About
 * (which explains them).
 *
 *   Stable  tested releases                  Update Center STABLE · feed name "latest" · no pre-releases
 *   Beta    features about 1–2 weeks early   Update Center BETA   · feed name "beta"   · 0.2.127-beta.1
 *   Dev     daily builds, may be unstable    Update Center DEV    · feed name "alpha"  · 0.2.127-dev.20261003
 */

export const USER_CHANNELS = ['stable', 'beta', 'dev'] as const;
export type UserChannel = (typeof USER_CHANNELS)[number];

export const CHANNEL_INFO: Record<UpdateChannel, { label: string; description: string }> = {
  stable: { label: 'Stable', description: 'Tested releases. Recommended.' },
  beta: { label: 'Beta', description: 'New features about 1–2 weeks early.' },
  dev: { label: 'Dev / Nightly', description: 'Daily builds. May be unstable.' },
  org: { label: 'Organization', description: 'The builds your organization chose.' },
};

/**
 * The update switches are three flat preferences: `autoUpdate` (download automatically), `updateNotifications` and
 * `updateInstallOnQuit`. A build of #205 before they were merged kept them as `updates: {autoDownload, notifyReady,
 * installOnQuit}`; those carry over once, and the object goes.
 */
export function migrateUpdatePrefs(stored: Partial<Preferences> & { updates?: { autoDownload?: boolean; notifyReady?: boolean; installOnQuit?: boolean } }): Partial<Preferences> & { updates?: undefined } {
  const old = stored.updates;
  return {
    autoUpdate: stored.autoUpdate ?? old?.autoDownload ?? true,
    updateNotifications: stored.updateNotifications ?? old?.notifyReady ?? true,
    updateInstallOnQuit: stored.updateInstallOnQuit ?? old?.installOnQuit ?? true,
    updates: undefined,
  };
}

/** The Update Center's channel name (it decides; a tenant policy there wins). The organisation channel sends none. */
export function updateCenterChannel(channel: UpdateChannel): 'STABLE' | 'BETA' | 'DEV' | null {
  return channel === 'org' ? null : (channel.toUpperCase() as 'STABLE' | 'BETA' | 'DEV');
}

/** The electron-updater style feed name for each channel (latest.yml, beta.yml, alpha.yml), for release tooling. */
export function feedName(channel: UpdateChannel): 'latest' | 'beta' | 'alpha' {
  return channel === 'beta' ? 'beta' : channel === 'dev' ? 'alpha' : 'latest';
}

/** Whether the channel takes pre-release versions (`-beta.1`, `-dev.20261003`). Stable never does. */
export function allowPrerelease(channel: UpdateChannel): boolean {
  return channel !== 'stable';
}

/** Which channel a version was built for: no pre-release tag → stable; beta/rc → beta; dev/alpha/nightly → dev. */
export function versionChannel(version: string): UserChannel {
  const v = parseVersion(version);
  if (!v || v.pre.length === 0) return 'stable';
  const tag = String(v.pre[0]).toLowerCase();
  if (tag === 'beta' || tag === 'rc') return 'beta';
  return 'dev';
}

/** Whether a computer on `channel` takes this version: stable ⊂ beta ⊂ dev, and the organisation channel takes what it is given. */
export function acceptsVersion(channel: UpdateChannel, version: string): boolean {
  if (channel === 'org') return true;
  if (!allowPrerelease(channel) && versionChannel(version) !== 'stable') return false;
  return channelAccepts(channel, versionChannel(version));
}

const RANK: Record<UpdateChannel, number> = { stable: 0, beta: 1, dev: 2, org: 0 };

/** More unstable than `than`? (Dev is less stable than Beta, which is less stable than Stable.) */
export function lessStable(channel: UpdateChannel, than: UpdateChannel): boolean {
  return RANK[channel] > RANK[than];
}

/**
 * The channels a person may pick. No policy (guest mode, not signed in): all three. An enforced policy: only its
 * channel. Each person's choice: the policy's `allowed_update_channels`, or all three when it names none.
 */
export function allowedChannels(policy: Pick<DesktopPolicy, 'auto_update' | 'update_channel' | 'allowed_update_channels'> | null | undefined): UpdateChannel[] {
  if (!policy) return [...USER_CHANNELS];
  if (policy.auto_update === 'enforced') return [policy.update_channel];
  const listed = (policy.allowed_update_channels ?? []).filter((c): c is UserChannel => (USER_CHANNELS as readonly string[]).includes(c));
  // Stable is always allowed.
  return listed.length ? USER_CHANNELS.filter((c) => c === 'stable' || listed.includes(c)) : [...USER_CHANNELS];
}

/** The note beside a channel the organisation does not allow (Settings › About). */
export const NOT_ALLOWED_NOTE = 'Not allowed by your organisation';

/**
 * The channel a computer follows: the organisation's while enforced; else the person's own choice when they made
 * one and it is still allowed; else the organisation's default; else the most stable allowed channel (Stable).
 */
export function effectiveChannel(
  saved: UpdateChannel,
  chosen: boolean,
  policy: Pick<DesktopPolicy, 'auto_update' | 'update_channel' | 'allowed_update_channels' | 'update_channel_default'> | null | undefined,
): UpdateChannel {
  if (!policy) return saved;
  if (policy.auto_update === 'enforced') return policy.update_channel;
  const allowed = allowedChannels(policy);
  if (chosen && allowed.includes(saved)) return saved;
  if (!chosen && policy.update_channel_default && allowed.includes(policy.update_channel_default)) return policy.update_channel_default;
  return allowed.includes(saved) ? saved : (allowed[0] ?? 'stable');
}

/** Why the channel cannot be changed, or null. */
export function channelLockReason(policy: Pick<DesktopPolicy, 'auto_update'> | null | undefined): string | null {
  return policy?.auto_update === 'enforced' ? 'Your organization chooses the update channel.' : null;
}

export type ChannelChange =
  | { ok: false; reason: string }
  | { ok: true; direction: 'same' | 'less-stable' | 'more-stable'; confirm: string | null };

/**
 * Checks a channel change against what is allowed. Moving to a less stable channel needs the person's
 * confirmation; moving to a more stable one waits for that channel to catch up (no downgrade).
 */
export function channelChange(from: UpdateChannel, to: UpdateChannel, allowed: readonly UpdateChannel[], lockReason: string | null = null): ChannelChange {
  if (from === to) return { ok: true, direction: 'same', confirm: null };
  if (lockReason) return { ok: false, reason: lockReason };
  if (!allowed.includes(to)) return { ok: false, reason: `${CHANNEL_INFO[to].label}: ${NOT_ALLOWED_NOTE}.` };
  if (lessStable(to, from)) {
    return {
      ok: true,
      direction: 'less-stable',
      confirm:
        to === 'dev'
          ? 'Dev / Nightly builds arrive every day and may be unstable or lose work. Switch to Dev / Nightly?'
          : 'Beta builds get new features about 1–2 weeks early and may have problems that Stable does not. Switch to Beta?',
    };
  }
  return { ok: true, direction: 'more-stable', confirm: null };
}

/**
 * Moved to a more stable channel while running a newer build: WorkSuite stays on this build until the channel
 * releases a newer one. Returns the channel being waited for, or null.
 */
export function waitingFor(channel: UpdateChannel, currentVersion: string): UpdateChannel | null {
  if (channel === 'org') return null;
  return acceptsVersion(channel, currentVersion) ? null : channel;
}

// ── Later ────────────────────────────────────────────────────────────────

/** Remind me in 1 hour, 4 hours or tomorrow (the update dialogs); Tonight and the next launch are kept for older callers. */
export type LaterChoice = 'hour' | 'four-hours' | 'tomorrow' | 'tonight' | 'next-launch';
export const LATER_LABELS: Record<LaterChoice, string> = { hour: '1 hour', 'four-hours': '4 hours', tomorrow: 'Tomorrow', tonight: 'Tonight', 'next-launch': 'On next app launch' };
/** What the Later menus offer. */
export const REMIND_CHOICES: readonly LaterChoice[] = ['hour', 'four-hours', 'tomorrow'];
/** "Tonight" is 8 pm local time. */
export const TONIGHT_HOUR = 20;
/** "Tomorrow" is 9 am local time. */
export const TOMORROW_HOUR = 9;

/**
 * When a reminder put off with Later comes back: an hour or four hours from now; tomorrow at 9 am; tonight at 8 pm
 * (or two hours from now when it is already later than half past seven); or not again until WorkSuite next starts
 * (null).
 */
export function laterUntil(choice: LaterChoice, now: Date): Date | null {
  if (choice === 'hour') return new Date(now.getTime() + 3600_000);
  if (choice === 'four-hours') return new Date(now.getTime() + 4 * 3600_000);
  if (choice === 'next-launch') return null;
  if (choice === 'tomorrow') {
    const t = new Date(now);
    t.setDate(t.getDate() + 1);
    t.setHours(TOMORROW_HOUR, 0, 0, 0);
    return t;
  }
  const tonight = new Date(now);
  tonight.setHours(TONIGHT_HOUR, 0, 0, 0);
  return tonight.getTime() - now.getTime() >= 30 * 60_000 ? tonight : new Date(now.getTime() + 2 * 3600_000);
}

export interface RemindOption {
  choice: LaterChoice;
  label: string;
  until: Date | null;
  /** It would come back after the install-by deadline, so it cannot be chosen. */
  pastDeadline: boolean;
}

/** The Remind me choices, each greyed out when it would come back after the deadline. */
export function remindOptions(now: Date, deadline: Date | null): RemindOption[] {
  return REMIND_CHOICES.map((choice) => {
    const until = laterUntil(choice, now);
    return { choice, label: LATER_LABELS[choice], until, pastDeadline: !!deadline && (!until || until.getTime() > deadline.getTime()) };
  });
}

// ── Mandatory updates ──────────────────────────────────────────────────────

/** How many times a required update may be put off when the release does not say. */
export const DEFAULT_MAX_DEFERRALS = 3;
/** The countdown card shows in the last hours before the deadline. */
export const FINAL_HOURS_MS = 6 * 3600_000;

export interface MandatoryView {
  required: boolean;
  deadline: Date | null;
  msLeft: number | null;
  /** The deadline passed, there is none, or the server refuses this version: modules are locked. */
  locked: boolean;
  finalHours: boolean;
  maxDeferrals: number;
  deferralsLeft: number;
}

/**
 * Where a required update stands at `now`. Without a deadline (an older main process, or the server refusing this
 * version) it is locked at once, as the Update required screen always was.
 */
export function mandatoryView(u: UpdateStatus | null | undefined, now: Date): MandatoryView {
  const m = u?.mandatory ?? null;
  const maxDeferrals = m?.maxDeferrals ?? DEFAULT_MAX_DEFERRALS;
  if (!u?.required) return { required: false, deadline: null, msLeft: null, locked: false, finalHours: false, maxDeferrals, deferralsLeft: maxDeferrals };
  const deadline = m?.deadline ? new Date(m.deadline) : null;
  const valid = !!deadline && Number.isFinite(deadline.getTime());
  const msLeft = valid ? Math.max(0, deadline!.getTime() - now.getTime()) : null;
  const locked = !m || m.serverRejected || !valid || msLeft === 0;
  return {
    required: true,
    deadline: valid ? deadline : null,
    msLeft,
    locked,
    finalHours: !locked && msLeft !== null && msLeft <= FINAL_HOURS_MS,
    maxDeferrals,
    deferralsLeft: Math.max(0, maxDeferrals - (u.postponed ?? 0)),
  };
}

/** "2 h 14 m", "14 m", "less than a minute". */
export function durationLeft(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'less than a minute';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h} h ${m} m` : `${m} m`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "02:14:37". */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** "04:59". */
export function minutesSeconds(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

/** Where the channel comes from, in words (Settings › Updates, Diagnostics). */
export function channelSource(policy: Pick<DesktopPolicy, 'auto_update' | 'update_channel_default'> | null | undefined, chosen: boolean): string {
  if (policy?.auto_update === 'enforced') return 'Set by organization policy';
  if (chosen) return 'Chosen by you';
  if (policy?.update_channel_default) return 'Organization default';
  return 'Default';
}

/** A short reference for a failed update ("UA-7F3C-21"), quoted to support and kept in the update history. */
export function failureRef(random: () => number = Math.random): string {
  const hex = (n: number) =>
    Array.from({ length: n }, () => Math.floor(random() * 16).toString(16))
      .join('')
      .toUpperCase();
  return `UA-${hex(4)}-${hex(2)}`;
}

// ── Do not disturb, and what a restart interrupts ──────────────────────────

/** What is going on that an update notice must not interrupt, in words, or null. */
export function quietReason(a: UpdateActivity | null | undefined): string | null {
  if (!a) return null;
  if (a.remoteControl) return 'a remote control session';
  if (a.screenShare) return 'screen sharing';
  if (a.meeting) return 'a meeting';
  if (a.call) return 'a call';
  return null;
}

export interface RestartCheck {
  /** Things to finish or accept before restarting, in words. */
  waiting: string[];
  /** The question to ask, or null when nothing is waiting. */
  question: string | null;
  /** A call or meeting would end. */
  callWarning: string | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Before "Update & restart": changes still to sync, transfers still running, and a call or meeting in progress.
 * Drafts are saved (they do not block); everything else is asked about, e.g. "3 changes waiting to sync.
 * Restart anyway?".
 */
export function restartCheck(b: BusyReport | null | undefined): RestartCheck {
  if (!b) return { waiting: [], question: null, callWarning: null };
  const waiting: string[] = [];
  if (b.pendingMutations > 0) waiting.push(`${plural(b.pendingMutations, 'change')} waiting to sync`);
  if (b.uploads > 0) waiting.push(`${plural(b.uploads, 'upload')} in progress`);
  if (b.downloads > 0) waiting.push(`${plural(b.downloads, 'download')} in progress`);
  const a = b.activity;
  const what = a?.remoteControl ? 'a remote control session' : a?.screenShare ? 'screen sharing' : a?.meeting ? 'a meeting' : b.activeCall || a?.call ? 'a call' : null;
  const callWarning = what ? `You are in ${what}. Restarting will end it.` : null;
  const first = waiting.length ? waiting.join(', ') : null;
  const question = first ? `${first.charAt(0).toUpperCase()}${first.slice(1)}. Restart anyway?` : callWarning ? `${callWarning} Restart anyway?` : null;
  return { waiting, question, callWarning };
}

// ── What a restart would affect (the Update Ready dialog) ──────────────────

export interface RestartImpactRow {
  id: 'meeting' | 'call' | 'share' | 'remote' | 'uploads' | 'downloads' | 'drafts' | 'queue';
  /** Blocks: restarting would end it. Waits: WorkSuite waits for it to finish. Safe: it is kept. */
  verdict: 'blocks' | 'waits' | 'safe';
  title: string;
  detail: string;
}

const MODULE_NAMES: Record<string, string> = { mail: 'mail', chat: 'chat', notes: 'note', tasks: 'task', crm: 'CRM' };

/**
 * What restarting now would affect, from what the app knows: a call or meeting, a screen share or remote control
 * (blocks), transfers still running (waits), drafts and queued offline changes (safe: they are kept). Anything the
 * app does not track is left out.
 */
export function restartImpact(b: BusyReport | null | undefined): RestartImpactRow[] {
  if (!b) return [];
  const rows: RestartImpactRow[] = [];
  const a = b.activity;
  const d = b.details;
  const meets = (d?.calls ?? []).filter((c) => c.kind === 'meet');
  const calls = (d?.calls ?? []).filter((c) => c.kind === 'call');
  if (a?.meeting) {
    const title = meets.map((m) => m.title).filter(Boolean)[0];
    rows.push({ id: 'meeting', verdict: 'blocks', title: 'Meet call in progress', detail: [title, a.screenShare ? 'screen sharing' : null].filter(Boolean).join(' · ') || 'Restarting would end it' });
  } else if (a?.screenShare) {
    rows.push({ id: 'share', verdict: 'blocks', title: 'Screen sharing', detail: 'Restarting would stop it' });
  }
  if (b.activeCall || a?.call) {
    const title = calls.map((c) => c.title).filter(Boolean)[0];
    rows.push({ id: 'call', verdict: 'blocks', title: 'Call in progress', detail: title || 'Restarting would end it' });
  }
  if (a?.remoteControl) rows.push({ id: 'remote', verdict: 'blocks', title: 'Remote control session', detail: 'Restarting would end it' });
  const named = (dir: 'upload' | 'download') =>
    (d?.transfers ?? [])
      .filter((t) => t.direction === dir)
      .slice(0, 3)
      .map((t) => `${t.name} ${Math.round(t.percent)}%`)
      .join(' · ');
  if (b.uploads > 0) rows.push({ id: 'uploads', verdict: 'waits', title: `${plural(b.uploads, 'file')} uploading`, detail: named('upload') || 'WorkSuite waits for them to finish' });
  if (b.downloads > 0) rows.push({ id: 'downloads', verdict: 'waits', title: `${plural(b.downloads, 'file')} downloading`, detail: named('download') || 'WorkSuite waits for them to finish' });
  if (b.drafts > 0) {
    const mods = Object.entries(d?.draftModules ?? {}).filter(([, n]) => n > 0);
    const only = mods.length === 1 ? MODULE_NAMES[mods[0]![0]] : undefined;
    rows.push({ id: 'drafts', verdict: 'safe', title: `${b.drafts} unsent ${only ? `${only} ` : ''}draft${b.drafts === 1 ? '' : 's'}`, detail: 'Saved locally — will be kept' });
  }
  if (b.pendingMutations > 0) rows.push({ id: 'queue', verdict: 'safe', title: `${plural(b.pendingMutations, 'offline change')} queued`, detail: 'Kept in the offline queue and sent after the restart' });
  return rows;
}

/** Something would be interrupted or is still running: restarting now is not free. */
export function restartWaits(rows: RestartImpactRow[]): boolean {
  return rows.some((r) => r.verdict !== 'safe');
}

// ── Install automatically when idle ────────────────────────────────────────

/** Settings › Updates › Install automatically when idle: between 02:00 and 04:00 local time. */
export const IDLE_INSTALL_FROM_HOUR = 2;
export const IDLE_INSTALL_TO_HOUR = 4;
/** Idle at least this long (the system's idle time). */
export const IDLE_INSTALL_MIN_SECONDS = 15 * 60;

/** Whether a downloaded update may install now: in the night window, the computer idle, nothing to interrupt. */
export function idleInstallDue(now: Date, idleSeconds: number, busy: BusyReport | null | undefined): boolean {
  const h = now.getHours();
  if (h < IDLE_INSTALL_FROM_HOUR || h >= IDLE_INSTALL_TO_HOUR) return false;
  if (idleSeconds < IDLE_INSTALL_MIN_SECONDS) return false;
  return !restartWaits(restartImpact(busy));
}

// ── Update diagnostics ────────────────────────────────────────────────────

const FIXES: Record<string, { fail: string; low?: string }> = {
  service: { fail: 'Check the network connection or proxy, then select Run again.' },
  signature: { fail: 'The update answer did not verify. Check the date and time on this computer, then select Run again.' },
  download: { fail: 'The download server could not be reached. Check that your network allows downloads, then select Retry.' },
  disk: { fail: 'Free up disk space, then select Retry.', low: 'Free up some disk space before the next update.' },
  permissions: { fail: 'WorkSuite cannot write to where it is installed. Ask your administrator to reinstall it or to update it for you.' },
  database: { fail: 'The local database reported a problem. Restart WorkSuite; if it continues, export this report for support.' },
  license: { fail: 'Sign in again so your organization can be checked.', low: 'Connect to the internet so your sign-in can be checked again.' },
  channel: { fail: 'Pick a channel your organization allows in Settings › Updates.' },
  version: { fail: 'Install the current version from your organization.' },
};

/** The first problem's fix, in words: a failed check before a low one. */
export function suggestedFix(checks: UpdateDiagnosticCheck[]): string | null {
  for (const level of ['fail', 'low'] as const) {
    for (const c of checks) {
      if (c.status !== level) continue;
      const fix = FIXES[c.id]?.[level];
      if (c.fix) return c.fix;
      if (fix) return fix;
    }
  }
  return null;
}
