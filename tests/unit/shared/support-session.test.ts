import { describe, expect, it } from 'vitest';
import { SUPPORT_OUTCOMES, codeDisplay, controlLine, expiryLabel, fileState, inviteText, joinLink, readCode, secondsLeft, supportTabs } from '../../../shared/support-session';

/**
 * Remote support's own rules (WS-MEET-ENH-01 RC10, RC11, RC17).
 *
 * The code is the sharp edge here: nine digits that open somebody's support
 * session, once, for ten minutes. So `readCode` accepts nothing else, the
 * expiry never reads as time remaining when it has passed, and the invitation
 * says in plain words what the code does and does not permit.
 */

describe('a support code', () => {
  it('reads in threes, as somebody says it out loud', () => {
    expect(codeDisplay('847291663')).toBe('847 291 663');
  });

  it('accepts what somebody typed with spaces or dashes', () => {
    expect(readCode('847 291 663')).toBe('847291663');
    expect(readCode('847-291-663')).toBe('847291663');
    expect(readCode(' 847291663 ')).toBe('847291663');
  });

  it('is nine digits and nothing else', () => {
    // A meeting's own code can be six to twelve digits; a support code is
    // exactly nine, and treating a near-miss as one would spend a real code.
    expect(readCode('84729166')).toBeNull();
    expect(readCode('8472916634')).toBeNull();
    expect(readCode('abc-defg-hij')).toBeNull();
    expect(readCode('')).toBeNull();
  });
});

describe('the invitation', () => {
  it('points at the web join page, which works without WorkSuite installed', () => {
    expect(joinLink('847291663', 'https://app.worksuite.lk')).toBe('https://app.worksuite.lk/support/join?code=847291663');
  });

  it('does not double a slash the server address already has', () => {
    expect(joinLink('847291663', 'https://app.worksuite.lk/')).toBe('https://app.worksuite.lk/support/join?code=847291663');
  });

  it('says who is asking, the link, the code, and what it does not permit', () => {
    const text = inviteText('847291663', 'https://app.worksuite.lk', 'Hasarinda');

    expect(text).toMatch(/Hasarinda from support/);
    expect(text).toMatch(/app\.worksuite\.lk\/support\/join\?code=847291663/);
    expect(text).toMatch(/847 291 663/);
    expect(text).toMatch(/works once/);
    // The two promises somebody being helped most needs to read.
    expect(text).toMatch(/until you share it/);
    expect(text).toMatch(/until you allow it/);
  });

  it('says Support when the agent has no name to give', () => {
    expect(inviteText('847291663', 'https://x.test', null)).toMatch(/^Support would like/);
  });
});

describe('how long a code has', () => {
  const at = 1_000_000;

  it('counts down in minutes and seconds', () => {
    expect(expiryLabel(at + 600_000, at)).toBe('10:00');
    expect(expiryLabel(at + 298_000, at)).toBe('4:58');
    expect(expiryLabel(at + 65_000, at)).toBe('1:05');
    expect(expiryLabel(at + 9_000, at)).toBe('0:09');
  });

  it('rounds down rather than claiming a second the code does not have', () => {
    // A ten-minute code read a moment after it was made is 9:59, not 10:01.
    expect(expiryLabel(at + 599_400, at)).toBe('9:59');
    expect(expiryLabel(at + 600_600, at)).toBe('10:00');
  });

  it('is expired the moment it has passed, and never negative', () => {
    expect(expiryLabel(at, at)).toBe('expired');
    expect(expiryLabel(at - 60_000, at)).toBe('expired');
    expect(secondsLeft(at - 60_000, at)).toBe(0);
  });
});

describe('what the Session tab says about control', () => {
  const live = { status: 'CONTROL_ACTIVE', caps_label: 'Mouse and keyboard', approved_at: '2026-10-11 10:00:00', approved_by: 'Nadeesha', mfa_passed: true, duration: '15 min' };

  it('says nobody is controlling, rather than leaving a blank to be feared', () => {
    const r = controlLine(null);

    expect(r.state).toBe('none');
    expect(r.text).toMatch(/Nobody is controlling/);
    // And how it would happen, which is the reassuring part.
    expect(r.text).toMatch(/you answer on your own computer, each time/);
  });

  it('names what was allowed, by whom, and the second factor', () => {
    const r = controlLine(live);

    expect(r.state).toBe('live');
    expect(r.text).toBe('Control is active. Mouse and keyboard. Allowed by Nadeesha. Confirmed with a second factor. Asked for 15 min.');
  });

  it('says paused when it is paused, without losing what was allowed', () => {
    const r = controlLine({ ...live, status: 'CONTROL_PAUSED' });

    expect(r.state).toBe('paused');
    expect(r.text).toMatch(/^Control is paused\. Mouse and keyboard\./);
  });

  it('claims no second factor when none was asked for', () => {
    expect(controlLine({ ...live, mfa_passed: false }).text).not.toMatch(/second factor/);
  });
});

describe('a file that changed hands', () => {
  it('says what happened in words, including the two refusals', () => {
    expect(fileState('accepted')).toBe('Accepted');
    expect(fileState('declined')).toBe('Declined');
    expect(fileState('blocked')).toBe('Blocked by policy');
    expect(fileState('infected')).toBe('Refused: the scan found something');
    expect(fileState('offered')).toBe('Waiting for an answer');
  });

  it('passes through a state it does not know rather than inventing one', () => {
    expect(fileState('something_new')).toBe('something_new');
  });
});

describe('the room a support session reduces to', () => {
  const tabs = [{ id: 'People' }, { id: 'Chat' }, { id: 'Q&A' }, { id: 'Polls' }, { id: 'Board' }, { id: 'Notes' }, { id: 'Files' }, { id: 'Info' }, { id: 'Settings' }, { id: 'Session' }];

  it('keeps the conversation, the files and the session, in that order', () => {
    expect(supportTabs(tabs).map((t) => t.id)).toEqual(['Chat', 'Files', 'Session']);
  });

  it('drops what belongs to a meeting with an audience', () => {
    const kept = new Set(supportTabs(tabs).map((t) => t.id));

    for (const gone of ['Q&A', 'Polls', 'Board', 'Notes', 'Settings']) expect(kept.has(gone)).toBe(false);
  });

  it('leaves out a tab this build does not have rather than failing', () => {
    expect(supportTabs([{ id: 'Chat' }]).map((t) => t.id)).toEqual(['Chat']);
  });
});

describe('the outcomes', () => {
  it('are the three the server accepts, each with what it means', () => {
    expect(SUPPORT_OUTCOMES.map((o) => o.id)).toEqual(['resolved', 'unresolved', 'follow_up']);
    expect(SUPPORT_OUTCOMES.every((o) => o.hint.length > 0)).toBe(true);
  });
});
