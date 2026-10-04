import { describe, expect, it } from 'vitest';
import type { BusyReport, UpdateDiagnosticCheck, UpdateStatus } from '../../../shared/types';
import {
  channelSource,
  countdown,
  durationLeft,
  failureRef,
  idleInstallDue,
  laterUntil,
  mandatoryView,
  minutesSeconds,
  remindOptions,
  restartImpact,
  restartWaits,
  suggestedFix,
} from '../../../shared/updates';

/** The pure parts of the Updates & License screens: reminders, deadlines, what a restart affects, idle installs. */

const busy = (over: Partial<BusyReport> = {}): BusyReport => ({ uploads: 0, downloads: 0, pendingMutations: 0, drafts: 0, activeCall: false, ...over });

function status(over: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    state: 'IDLE',
    channel: 'stable',
    currentVersion: '2.6.1',
    availableVersion: '2.7.0',
    minimumVersion: '2.5.0',
    required: false,
    critical: false,
    progress: 0,
    error: null,
    lastCheckedAt: null,
    deadline: null,
    signatureVerified: true,
    notesUrl: null,
    installSupported: true,
    installBlockedReason: null,
    ...over,
  };
}

describe('Remind me in 1 hour, 4 hours, Tomorrow', () => {
  it('comes back in four hours, or tomorrow at 9', () => {
    expect(laterUntil('four-hours', new Date(2026, 8, 27, 15, 0))).toEqual(new Date(2026, 8, 27, 19, 0));
    expect(laterUntil('tomorrow', new Date(2026, 8, 27, 15, 45))).toEqual(new Date(2026, 8, 28, 9, 0));
  });

  it('greys out a choice that comes back after the deadline', () => {
    const now = new Date(2026, 8, 27, 15, 46);
    const deadline = new Date(2026, 8, 27, 18, 0);
    expect(remindOptions(now, deadline).map((o) => [o.label, o.pastDeadline])).toEqual([
      ['1 hour', false],
      ['4 hours', true],
      ['Tomorrow', true],
    ]);
    expect(remindOptions(now, null).every((o) => !o.pastDeadline)).toBe(true);
  });
});

describe('a mandatory update', () => {
  const now = new Date('2026-09-27T15:46:00Z');
  const mandatory = (over = {}) => ({ reason: 'minimum' as const, requiredVersion: '2.5.0', since: '2026-09-26T18:00:00Z', deadline: '2026-09-27T18:00:23Z', serverRejected: false, maxDeferrals: 3, ...over });

  it('counts down to its deadline, with the deferrals left', () => {
    const v = mandatoryView(status({ required: true, postponed: 1, mandatory: mandatory() }), now);
    expect(v).toMatchObject({ required: true, locked: false, finalHours: true, maxDeferrals: 3, deferralsLeft: 2 });
    expect(durationLeft(v.msLeft!)).toBe('2 h 14 m');
    expect(countdown(v.msLeft!)).toBe('02:14:23');
  });

  it('locks modules after the deadline, when the server refuses the version, or with no deadline known', () => {
    expect(mandatoryView(status({ required: true, mandatory: mandatory({ deadline: '2026-09-27T15:00:00Z' }) }), now).locked).toBe(true);
    expect(mandatoryView(status({ required: true, mandatory: mandatory({ serverRejected: true }) }), now).locked).toBe(true);
    expect(mandatoryView(status({ required: true }), now).locked).toBe(true);
    expect(mandatoryView(status({ required: false, mandatory: mandatory() }), now)).toMatchObject({ required: false, locked: false });
  });

  it('says the time plainly', () => {
    expect(durationLeft(30_000)).toBe('less than a minute');
    expect(durationLeft(14 * 60_000)).toBe('14 m');
    expect(minutesSeconds(299_000)).toBe('04:59');
  });
});

describe('what a restart would affect', () => {
  it('a Meet call BLOCKS, uploads WAIT, drafts and queued changes are SAFE', () => {
    const rows = restartImpact(
      busy({
        uploads: 2,
        drafts: 1,
        pendingMutations: 14,
        activity: { meeting: true, call: false, screenShare: true, remoteControl: false },
        details: {
          calls: [{ kind: 'meet', title: 'Sprint review' }],
          transfers: [
            { name: 'Brand-assets.zip', direction: 'upload', percent: 71.2 },
            { name: 'Q4-quote.pdf', direction: 'upload', percent: 12 },
          ],
          draftModules: { mail: 1 },
        },
      }),
    );
    expect(rows).toEqual([
      { id: 'meeting', verdict: 'blocks', title: 'Meet call in progress', detail: 'Sprint review · screen sharing' },
      { id: 'uploads', verdict: 'waits', title: '2 files uploading', detail: 'Brand-assets.zip 71% · Q4-quote.pdf 12%' },
      { id: 'drafts', verdict: 'safe', title: '1 unsent mail draft', detail: 'Saved locally — will be kept' },
      { id: 'queue', verdict: 'safe', title: '14 offline changes queued', detail: 'Kept in the offline queue and sent after the restart' },
    ]);
    expect(restartWaits(rows)).toBe(true);
  });

  it('leaves out what is not going on, and nothing waits for drafts alone', () => {
    expect(restartImpact(busy())).toEqual([]);
    const rows = restartImpact(busy({ drafts: 2, details: { calls: [], transfers: [], draftModules: { mail: 1, notes: 1 } } }));
    expect(rows.map((r) => r.title)).toEqual(['2 unsent drafts']);
    expect(restartWaits(rows)).toBe(false);
  });
});

describe('Install automatically when idle 02:00–04:00', () => {
  it('only in the window, only when idle, and only with nothing to interrupt', () => {
    expect(idleInstallDue(new Date(2026, 8, 28, 2, 30), 3600, busy({ pendingMutations: 4 }))).toBe(true);
    expect(idleInstallDue(new Date(2026, 8, 28, 4, 0), 3600, busy())).toBe(false);
    expect(idleInstallDue(new Date(2026, 8, 28, 1, 59), 3600, busy())).toBe(false);
    expect(idleInstallDue(new Date(2026, 8, 28, 3, 0), 60, busy())).toBe(false);
    expect(idleInstallDue(new Date(2026, 8, 28, 3, 0), 3600, busy({ uploads: 1 }))).toBe(false);
  });
});

describe('diagnostics and references', () => {
  const check = (id: UpdateDiagnosticCheck['id'], s: UpdateDiagnosticCheck['status'], fix?: string): UpdateDiagnosticCheck => ({ id, label: id, status: s, detail: '', ...(fix ? { fix } : {}) });

  it('suggests the fix for the first failure, before a low one', () => {
    expect(suggestedFix([check('disk', 'low', 'Free 2 GB.'), check('database', 'fail')])).toBe('The local database reported a problem. Restart WorkSuite; if it continues, export this report for support.');
    expect(suggestedFix([check('service', 'pass'), check('disk', 'low', 'Free at least 2.0 GB of disk space, then select Retry.')])).toBe('Free at least 2.0 GB of disk space, then select Retry.');
    expect(suggestedFix([check('service', 'pass')])).toBeNull();
  });

  it('names where the channel comes from', () => {
    expect(channelSource({ auto_update: 'enforced', update_channel_default: 'beta' }, true)).toBe('Set by organization policy');
    expect(channelSource({ auto_update: 'user_choice', update_channel_default: 'beta' }, true)).toBe('Chosen by you');
    expect(channelSource({ auto_update: 'user_choice', update_channel_default: 'beta' }, false)).toBe('Organization default');
    expect(channelSource(null, false)).toBe('Default');
  });

  it('makes a short reference', () => {
    expect(failureRef()).toMatch(/^UA-[0-9A-F]{4}-[0-9A-F]{2}$/);
    expect(failureRef(() => 0.5)).toBe('UA-8888-88');
  });
});
