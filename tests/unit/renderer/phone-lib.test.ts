import { describe, expect, it } from 'vitest';
import { csvField, csvObjects, parseCsv, toCsv } from '../../../src/modules/phone/lib/csv';
import { changeCount, diffLines } from '../../../src/modules/phone/lib/diff';
import { isPattern, matches, rewrite, specificity, splitPatterns, testRoute, type RouteLike, type TrunkLike } from '../../../src/modules/phone/lib/dialpattern';
import { clock, dialable, dispositionLabel, isDialable, isMissed, money, otherParty, parseStamp, prettyNumber, talkTime, when } from '../../../src/modules/phone/lib/format';
import { LK_ROUTES, nationalMobile, operatorOf } from '../../../src/modules/phone/lib/lkroutes';
import { mos, mosFromR, qualityLabel, rFactor, sampleFromStats } from '../../../src/modules/phone/lib/mos';
import { localCheck, RESERVED_CODES } from '../../../src/modules/phone/lib/shortcodes';
import { checkTimeSpec, describeTimeSpec } from '../../../src/modules/phone/lib/timespec';

/** The Phone's pure logic (WS-VOIP-SRS-001): what every screen leans on, tested without a switch. */

describe('numbers and times', () => {
  it('shows timers in the mono clock form', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(252)).toBe('4:12');
    expect(clock(3729)).toBe('1:02:09');
    expect(clock(null)).toBe('0:00');
    expect(clock(-5)).toBe('0:00');
    expect(talkTime(45)).toBe('45s');
    expect(talkTime(6720)).toBe('1h 52m');
  });

  it('dials only + digits * # (NFR-04), dropping what people paste around them', () => {
    expect(dialable(' +94 (77) 312-4408 ')).toBe('+94773124408');
    expect(dialable('*97')).toBe('*97');
    expect(isDialable('1042')).toBe(true);
    expect(isDialable('7')).toBe(false);
    expect(isDialable('abc')).toBe(false);
    expect(isDialable('+94 77 312 4408')).toBe(true);
  });

  it('keeps extensions as typed and shows phone numbers internationally', () => {
    expect(prettyNumber('1042')).toBe('1042');
    expect(prettyNumber('*97')).toBe('*97');
    expect(prettyNumber('0773124408')).toBe('+94 77 312 4408');
    expect(prettyNumber('')).toBe('');
  });

  it('never invents a cost: no rate is a dash, not zero (NFR-10)', () => {
    expect(money(null)).toBe('—');
    expect(money(12, 'LKR', false)).toBe('—');
    expect(money(48210)).toBe('LKR 48.2K');
    expect(money(7.1)).toBe('LKR 7.10');
  });

  it('reads outcomes and the other party of a call', () => {
    expect(isMissed('no_answer')).toBe(true);
    expect(isMissed('answered')).toBe(false);
    expect(dispositionLabel('cancelled')).toBe('Abandoned');
    expect(otherParty({ direction: 'outbound', from: '1042', to: '0771234567' })).toBe('0771234567');
    expect(otherParty({ direction: 'inbound', from: '0771234567', to: '1042' })).toBe('0771234567');
  });

  it('reads server stamps as UTC and says when', () => {
    const d = parseStamp('2026-10-02 10:41:00');
    expect(d?.toISOString()).toBe('2026-10-02T10:41:00.000Z');
    expect(parseStamp('nonsense')).toBeNull();
    const now = new Date(2026, 9, 6, 12, 0);
    const yesterday = new Date(2026, 9, 5, 9, 0);
    expect(when(yesterday.toISOString(), now)).toBe('Yesterday');
  });
});

describe('Asterisk dial patterns (route tester, VOIP-TRK-05)', () => {
  it('matches X Z N, classes, . and ! the way the switch does', () => {
    expect(matches('_07XXXXXXXX', '0771234567')).toBe(true);
    expect(matches('_07XXXXXXXX', '077123456')).toBe(false);
    expect(matches('_0[1-689]XXXXXXXX', '0112345678')).toBe(true);
    expect(matches('_0[1-689]XXXXXXXX', '0712345678')).toBe(false);
    expect(matches('_00.', '00447700900123')).toBe(true);
    expect(matches('_00.', '00')).toBe(false);
    expect(matches('_1XX!', '12')).toBe(false);
    expect(matches('_1X!', '12')).toBe(true);
    expect(matches('_NXXX', '1234')).toBe(false);
    expect(matches('_ZXX', '911')).toBe(true);
    expect(matches('119', '119')).toBe(true);
    expect(matches('119', '1190')).toBe(false);
  });

  it('reads FreePBX patterns without the underscore, and splits a list', () => {
    expect(isPattern('07XXXXXXXX')).toBe(true);
    expect(isPattern('1990')).toBe(false);
    expect(matches('07XXXXXXXX', '0761234567')).toBe(true);
    expect(splitPatterns('119 · 110 · 1990')).toEqual(['119', '110', '1990']);
    expect(specificity('119')).toBeGreaterThan(specificity('_1XX'));
  });

  it('rewrites by stripping, then prepending', () => {
    expect(rewrite('0771234567', { strip_digits: 1, prepend: '+94' })).toBe('+94771234567');
    expect(rewrite('9001', { strip_digits: 0, prepend: null })).toBe('9001');
  });

  const trunks: TrunkLike[] = [
    { id: 1, name: 'SLT-PSTN', status: 'registered', enabled: true, max_channels: 1, cost_per_min: 1.8 },
    { id: 2, name: 'DINSTAR-GSM', status: 'registered', enabled: true, max_channels: 4, cost_per_min: 2 },
    { id: 3, name: 'Twilio', status: 'unreachable', enabled: true, max_channels: 10, cost_per_min: null },
  ];
  const route = (p: Partial<RouteLike> & Pick<RouteLike, 'id' | 'name' | 'pattern'>): RouteLike => ({ trunk_id: null, failover_trunk_id: null, strip_digits: 0, prepend: null, priority: 10, kind: 'other', enabled: true, ...p });
  const routes: RouteLike[] = [
    route({ id: 1, name: 'Emergency', pattern: '119', trunk_id: 1, failover_trunk_id: 2, priority: 1, kind: 'emergency' }),
    route({ id: 2, name: 'Sri Lanka mobile', pattern: '_07XXXXXXXX', trunk_id: 2, failover_trunk_id: 1, priority: 2, kind: 'mobile' }),
    route({ id: 4, name: 'International', pattern: '_00.', trunk_id: 3, priority: 4, kind: 'international' }),
    route({ id: 5, name: 'Block premium', pattern: '_09[0-9].', priority: 5 }),
  ];

  it('first match wins, with the trunk, failover and rate', () => {
    const r = testRoute('077 123 4567', routes, trunks);
    expect(r.route?.name).toBe('Sri Lanka mobile');
    expect(r.trunk?.name).toBe('DINSTAR-GSM');
    expect(r.failover?.name).toBe('SLT-PSTN');
    expect(r.cost_per_min).toBe(2);
    expect(r.steps.some((s) => s.text.includes('Estimated cost 2.00'))).toBe(true);
  });

  it('says emergency calls are never blocked', () => {
    const r = testRoute('119', routes, trunks);
    expect(r.route?.kind).toBe('emergency');
    expect(r.steps.some((s) => /never blocked/.test(s.text))).toBe(true);
  });

  it('warns when the trunk is down and there is no failover, and when nothing matches', () => {
    const intl = testRoute('0044123', routes, trunks);
    expect(intl.steps.some((s) => s.tone === 'fail' && /would fail/.test(s.text))).toBe(true);
    expect(intl.cost_per_min).toBeNull();
    const none = testRoute('5555', routes, trunks);
    expect(none.route).toBeNull();
    expect(none.steps[0]?.tone).toBe('fail');
    const blocked = testRoute('0901234567', routes, trunks);
    expect(blocked.route?.name).toBe('Block premium');
    expect(blocked.steps.some((s) => /refused/.test(s.text))).toBe(true);
  });

  it('ships the reference Sri Lankan routes in a working order (§14.11)', () => {
    const seeded: RouteLike[] = LK_ROUTES.map((r, i) => route({ id: i + 1, name: r.name, pattern: r.pattern, priority: r.priority, kind: r.kind, trunk_id: r.primary === 'landline' ? 1 : r.primary === 'gsm' ? 2 : null }));
    expect(testRoute('119', seeded, trunks).route?.name).toBe('EMERGENCY 119');
    expect(testRoute('1990', seeded, trunks).route?.name).toBe('EMERGENCY 1990');
    expect(testRoute('0771234567', seeded, trunks).trunk?.name).toBe('DINSTAR-GSM');
    expect(testRoute('0112345678', seeded, trunks).trunk?.name).toBe('SLT-PSTN');
    expect(testRoute('1212', seeded, trunks).route?.name).toBe('LK-SHORT');
    // International never goes out over the GSM gateway.
    const intl = LK_ROUTES.find((r) => r.kind === 'international')!;
    expect(intl.primary).not.toBe('gsm');
    expect(intl.failover).toBeNull();
  });

  it('knows which SIM port a mobile number uses (§14.10)', () => {
    expect(nationalMobile('+94 77 123 4567')).toBe('0771234567');
    expect(nationalMobile('0094711234567')).toBe('0711234567');
    expect(nationalMobile('0112345678')).toBeNull();
    expect(operatorOf('0771234567')).toEqual({ port: 1, operator: 'Dialog' });
    expect(operatorOf('0701234567')).toEqual({ port: 2, operator: 'Mobitel' });
    expect(operatorOf('0751234567')?.operator).toBe('Airtel');
  });
});

describe('forwarding time rules (GotoIfTime)', () => {
  it('checks them as the server does', () => {
    expect(checkTimeSpec('09:00-17:00,mon-fri,*,*').ok).toBe(true);
    expect(checkTimeSpec('*,*,24-26,dec').ok).toBe(true);
    expect(checkTimeSpec('').message).toMatch(/needs a time specification/);
    expect(checkTimeSpec('09:00-17:00,mon-fri').message).toMatch(/four parts.*has 2/);
    expect(checkTimeSpec('9am-5pm,mon-fri,*,*').message).toMatch(/not a time range/);
    expect(checkTimeSpec('09:00-17:00;reboot,*,*,*').ok).toBe(false);
  });

  it('describes them in words', () => {
    expect(describeTimeSpec('18:00-23:59,mon-fri,*,*')).toBe('Mon–Fri 18:00–23:59');
    expect(describeTimeSpec('*,*,*,*')).toBe('Any time');
    expect(describeTimeSpec('*,*,24-26,dec')).toBe('24–26 Dec all day');
  });
});

describe('configuration diff (A09)', () => {
  it('marks what applying would add and remove', () => {
    const before = 'exten => 1042,1,NoOp(Hasini)\n same => n,Dial(PJSIP/1042,20)\nexten => 640,1,Goto(rg-640,s,1)';
    const after = 'exten => 1042,1,NoOp(Hasini)\n same => n,MixMonitor(${UNIQUEID}.wav,b)\n same => n,Dial(PJSIP/1042,20)\nexten => 701,1,Goto(dept-finance,s,1)';
    const d = diffLines(before, after);
    expect(d.filter((l) => l.kind === 'add').map((l) => l.text)).toEqual([' same => n,MixMonitor(${UNIQUEID}.wav,b)', 'exten => 701,1,Goto(dept-finance,s,1)']);
    expect(d.filter((l) => l.kind === 'del').map((l) => l.text)).toEqual(['exten => 640,1,Goto(rg-640,s,1)']);
    expect(changeCount(d)).toBe(2);
    expect(changeCount(diffLines('a\nb', 'a\nb'))).toBe(0);
    expect(diffLines('', 'x')).toEqual([{ kind: 'add', text: 'x' }]);
  });
});

describe('call quality (VOIP-SP-10)', () => {
  it('has no number before anything is measured (NFR-10)', () => {
    expect(rFactor({ rttMs: null, jitterMs: null, loss: null })).toBeNull();
    expect(mos({ rttMs: null, jitterMs: null, loss: null })).toBeNull();
    expect(qualityLabel(null)).toBeNull();
  });

  it('scores a clean call high and a lossy one low', () => {
    const clean = mos({ rttMs: 40, jitterMs: 3, loss: 0 })!;
    const lossy = mos({ rttMs: 300, jitterMs: 40, loss: 0.08 })!;
    expect(clean).toBeGreaterThanOrEqual(4.3);
    expect(lossy).toBeLessThan(3.5);
    expect(qualityLabel(clean)).toBe('good');
    expect(mosFromR(0)).toBe(1);
    expect(mosFromR(120)).toBe(4.5);
  });

  it('reads the browser statistics, loss over the interval', () => {
    const stats = [
      { type: 'codec', id: 'c1', mimeType: 'audio/opus' },
      { type: 'inbound-rtp', kind: 'audio', jitter: 0.004, packetsReceived: 1000, packetsLost: 10, codecId: 'c1' },
      { type: 'remote-inbound-rtp', roundTripTime: 0.05 },
    ];
    const first = sampleFromStats(stats);
    expect(first.codec).toBe('opus');
    expect(first.sample.rttMs).toBe(50);
    expect(first.sample.jitterMs).toBe(4);
    expect(first.sample.loss).toBeCloseTo(10 / 1010);
    const later = sampleFromStats([{ type: 'inbound-rtp', kind: 'audio', packetsReceived: 1100, packetsLost: 10 }], first.counters);
    expect(later.sample.loss).toBe(0);
  });
});

describe('CSV (history export, extension import)', () => {
  it('quotes what must be quoted and defuses formulas', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField('+94771234567')).toBe("'+94771234567");
    expect(csvField(null)).toBe('');
    expect(toCsv(['a', 'b'], [[1, 'x']])).toBe('a,b\r\n1,x\r\n');
  });

  it('reads back what it writes', () => {
    const text = toCsv(['extension', 'name', 'caller_id'], [['1043', 'Chamari, Sales', '+94112447000']]);
    expect(parseCsv(text)).toEqual([['extension', 'name', 'caller_id'], ['1043', 'Chamari, Sales', '+94112447000']]);
    expect(csvObjects('﻿Extension,Name\n1044,"Kasun ""K"" Perera"\n\n')).toEqual([{ extension: '1044', name: 'Kasun "K" Perera' }]);
  });
});

describe('short codes (A09)', () => {
  it('refuses Asterisk’s reserved codes and anything not dialable', () => {
    for (const c of RESERVED_CODES) expect(localCheck(c).ok).toBe(false);
    expect(localCheck('*97')).toEqual({ ok: false, reason: '*97 is a reserved feature code on Asterisk.' });
    expect(localCheck('200').ok).toBe(true);
    expect(localCheck('20a').ok).toBe(false);
    expect(localCheck('').ok).toBe(false);
  });
});
