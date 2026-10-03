import type { BusyReport, DesktopPolicy, Preferences, UpdateActivity, UpdateChannel } from './types';
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

export type LaterChoice = 'hour' | 'tonight' | 'next-launch';
export const LATER_LABELS: Record<LaterChoice, string> = { hour: 'In 1 hour', tonight: 'Tonight', 'next-launch': 'On next app launch' };
/** "Tonight" is 8 pm local time. */
export const TONIGHT_HOUR = 20;

/**
 * When a reminder put off with Later comes back: an hour from now; tonight at 8 pm (or two hours from now when
 * it is already later than half past seven); or not again until WorkSuite next starts (null).
 */
export function laterUntil(choice: LaterChoice, now: Date): Date | null {
  if (choice === 'hour') return new Date(now.getTime() + 3600_000);
  if (choice === 'next-launch') return null;
  const tonight = new Date(now);
  tonight.setHours(TONIGHT_HOUR, 0, 0, 0);
  return tonight.getTime() - now.getTime() >= 30 * 60_000 ? tonight : new Date(now.getTime() + 2 * 3600_000);
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
