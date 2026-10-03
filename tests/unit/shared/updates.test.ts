import { describe, expect, it } from 'vitest';
import type { DesktopPolicy } from '../../../shared/types';
import {
  acceptsVersion,
  allowPrerelease,
  allowedChannels,
  channelChange,
  channelLockReason,
  effectiveChannel,
  feedName,
  laterUntil,
  lessStable,
  quietReason,
  restartCheck,
  updateCenterChannel,
  versionChannel,
  waitingFor,
} from '../../../shared/updates';

const policy = (p: Partial<DesktopPolicy>) => ({ auto_update: 'user_choice' as const, update_channel: 'stable' as const, ...p });
const busy = (p: Partial<Parameters<typeof restartCheck>[0] & object> = {}) => ({ uploads: 0, downloads: 0, pendingMutations: 0, drafts: 0, activeCall: false, ...p });

describe('update channels (worksuite-desktop#205)', () => {
  it('maps Stable, Beta and Dev to the Update Center and to latest / beta / alpha feeds', () => {
    expect(['stable', 'beta', 'dev', 'org'].map((c) => updateCenterChannel(c as never))).toEqual(['STABLE', 'BETA', 'DEV', null]);
    expect(['stable', 'beta', 'dev'].map((c) => feedName(c as never))).toEqual(['latest', 'beta', 'alpha']);
  });

  it('allows pre-releases on Beta and Dev only', () => {
    expect(allowPrerelease('stable')).toBe(false);
    expect(allowPrerelease('beta')).toBe(true);
    expect(allowPrerelease('dev')).toBe(true);
  });

  it('reads the channel from the version: 0.2.126, 0.2.127-beta.1, 0.2.127-dev.20261003', () => {
    expect(versionChannel('0.2.126')).toBe('stable');
    expect(versionChannel('0.2.127-beta.1')).toBe('beta');
    expect(versionChannel('0.2.127-rc.2')).toBe('beta');
    expect(versionChannel('0.2.127-dev.20261003')).toBe('dev');
    expect(versionChannel('0.2.127-alpha.3')).toBe('dev');
  });

  it('takes stable ⊂ beta ⊂ dev versions, and never a pre-release on Stable', () => {
    expect(acceptsVersion('stable', '0.2.126')).toBe(true);
    expect(acceptsVersion('stable', '0.2.127-beta.1')).toBe(false);
    expect(acceptsVersion('stable', '0.2.127-dev.20261003')).toBe(false);
    expect(acceptsVersion('beta', '0.2.127-beta.1')).toBe(true);
    expect(acceptsVersion('beta', '0.2.127-dev.20261003')).toBe(false);
    expect(acceptsVersion('dev', '0.2.127-dev.20261003')).toBe(true);
    expect(acceptsVersion('dev', '0.2.126')).toBe(true);
    expect(acceptsVersion('org', '0.2.127-dev.1')).toBe(true);
  });

  it('orders channels by stability', () => {
    expect(lessStable('dev', 'beta')).toBe(true);
    expect(lessStable('beta', 'stable')).toBe(true);
    expect(lessStable('stable', 'beta')).toBe(false);
  });
});

describe('organisation policy limits the choice', () => {
  it('offers all three without a policy, and with a policy that names none', () => {
    expect(allowedChannels(null)).toEqual(['stable', 'beta', 'dev']);
    expect(allowedChannels(policy({}))).toEqual(['stable', 'beta', 'dev']);
  });

  it('offers only what the policy allows, in order', () => {
    expect(allowedChannels(policy({ allowed_update_channels: ['beta', 'stable'] }))).toEqual(['stable', 'beta']);
    expect(allowedChannels(policy({ allowed_update_channels: ['nightly' as never] }))).toEqual(['stable', 'beta', 'dev']);
  });

  it('always allows Stable', () => {
    expect(allowedChannels(policy({ allowed_update_channels: ['beta', 'dev'] }))).toEqual(['stable', 'beta', 'dev']);
    expect(allowedChannels(policy({ allowed_update_channels: ['dev'] }))).toEqual(['stable', 'dev']);
  });

  it("follows the person's choice while allowed, else the organisation's default, else the most stable allowed channel", () => {
    const p = policy({ allowed_update_channels: ['stable', 'beta'], update_channel_default: 'beta' });
    expect(effectiveChannel('stable', false, p)).toBe('beta');
    expect(effectiveChannel('stable', true, p)).toBe('stable');
    expect(effectiveChannel('dev', true, p)).toBe('stable');
    expect(effectiveChannel('dev', true, policy({ allowed_update_channels: ['stable'] }))).toBe('stable');
    expect(effectiveChannel('beta', false, policy({ allowed_update_channels: ['stable'], update_channel_default: 'beta' }))).toBe('stable');
    expect(effectiveChannel('dev', true, policy({ auto_update: 'enforced', update_channel: 'beta' }))).toBe('beta');
    expect(effectiveChannel('dev', true, null)).toBe('dev');
  });

  it('locks the channel when updates are enforced', () => {
    const p = policy({ auto_update: 'enforced', update_channel: 'beta' });
    expect(allowedChannels(p)).toEqual(['beta']);
    expect(channelLockReason(p)).toBe('Your organization chooses the update channel.');
    expect(channelLockReason(policy({}))).toBeNull();
  });

  it('refuses a channel the policy does not allow, or any change while locked', () => {
    expect(channelChange('stable', 'dev', ['stable', 'beta'])).toEqual({ ok: false, reason: 'Dev / Nightly: Not allowed by your organisation.' });
    expect(channelChange('stable', 'beta', ['stable'], 'Your organization chooses the update channel.')).toEqual({ ok: false, reason: 'Your organization chooses the update channel.' });
  });

  it('asks before a less stable channel, not before a more stable one', () => {
    const toBeta = channelChange('stable', 'beta', ['stable', 'beta', 'dev']);
    expect(toBeta).toMatchObject({ ok: true, direction: 'less-stable' });
    expect(toBeta.ok && toBeta.confirm).toMatch(/Switch to Beta\?$/);
    const toDev = channelChange('beta', 'dev', ['stable', 'beta', 'dev']);
    expect(toDev.ok && toDev.confirm).toMatch(/may be unstable.*Switch to Dev \/ Nightly\?$/);
    expect(channelChange('dev', 'stable', ['stable', 'beta', 'dev'])).toEqual({ ok: true, direction: 'more-stable', confirm: null });
    expect(channelChange('beta', 'beta', ['beta'])).toEqual({ ok: true, direction: 'same', confirm: null });
  });

  it('waits for a more stable channel to catch up instead of downgrading', () => {
    expect(waitingFor('stable', '0.2.127-beta.1')).toBe('stable');
    expect(waitingFor('beta', '0.2.127-dev.20261003')).toBe('beta');
    expect(waitingFor('stable', '0.2.126')).toBeNull();
    expect(waitingFor('dev', '0.2.127-beta.1')).toBeNull();
  });
});

describe('Later', () => {
  it('comes back in an hour', () => {
    const now = new Date(2026, 9, 3, 10, 0);
    expect(laterUntil('hour', now)).toEqual(new Date(2026, 9, 3, 11, 0));
  });

  it('tonight is 8 pm, or two hours on when it is nearly that already', () => {
    expect(laterUntil('tonight', new Date(2026, 9, 3, 10, 0))).toEqual(new Date(2026, 9, 3, 20, 0));
    expect(laterUntil('tonight', new Date(2026, 9, 3, 19, 45))).toEqual(new Date(2026, 9, 3, 21, 45));
    expect(laterUntil('tonight', new Date(2026, 9, 3, 22, 0))).toEqual(new Date(2026, 9, 4, 0, 0));
  });

  it('on next app launch has no time', () => {
    expect(laterUntil('next-launch', new Date())).toBeNull();
  });
});

describe('do not disturb, and the check before restarting', () => {
  it('names what must not be interrupted', () => {
    expect(quietReason({ meeting: false, call: false, screenShare: false, remoteControl: false })).toBeNull();
    expect(quietReason({ meeting: true, call: false, screenShare: false, remoteControl: false })).toBe('a meeting');
    expect(quietReason({ meeting: false, call: true, screenShare: false, remoteControl: false })).toBe('a call');
    expect(quietReason({ meeting: true, call: false, screenShare: true, remoteControl: false })).toBe('screen sharing');
    expect(quietReason({ meeting: false, call: false, screenShare: false, remoteControl: true })).toBe('a remote control session');
  });

  it('restarts without asking when nothing is waiting (drafts are saved, not asked about)', () => {
    expect(restartCheck(busy({ drafts: 2 }))).toEqual({ waiting: [], question: null, callWarning: null });
  });

  it('asks "3 changes waiting to sync. Restart anyway?"', () => {
    expect(restartCheck(busy({ pendingMutations: 3 })).question).toBe('3 changes waiting to sync. Restart anyway?');
    expect(restartCheck(busy({ pendingMutations: 1, uploads: 2 })).question).toBe('1 change waiting to sync, 2 uploads in progress. Restart anyway?');
  });

  it('warns about a call or meeting in progress', () => {
    expect(restartCheck(busy({ activeCall: true }))).toEqual({ waiting: [], question: 'You are in a call. Restarting will end it. Restart anyway?', callWarning: 'You are in a call. Restarting will end it.' });
    const meeting = restartCheck(busy({ activity: { meeting: true, call: false, screenShare: false, remoteControl: false } }));
    expect(meeting.callWarning).toBe('You are in a meeting. Restarting will end it.');
    const both = restartCheck(busy({ pendingMutations: 3, activeCall: true }));
    expect(both.question).toBe('3 changes waiting to sync. Restart anyway?');
    expect(both.callWarning).toBe('You are in a call. Restarting will end it.');
  });
});
