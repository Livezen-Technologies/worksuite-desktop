import { describe, expect, it } from 'vitest';
import {
  applyLocal,
  checkOutRefusal,
  copyExpired,
  copyFacts,
  eventsCached,
  dayKeyFor,
  gateEventStatus,
  localDate,
  localView,
  looksLikeQr,
  matchInCopy,
  mergeChanges,
  nextSequence,
  normalizeCode,
  presenceFor,
  provisionalNumber,
  scanId,
  scanRules,
  searchCopy,
  type CopyRow,
  type DeskCopy,
} from '../../../shared/event-desk';

const QR = 'EV1-ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const hashOf = (t: string) => `h:${t}`;
/* 2026-10-20 09:30 in Colombo (UTC+05:30). */
const AT = Date.parse('2026-10-20T04:00:00Z');
const when = (utc: string) => ({ utc, local: '', date: '', time: '', zone: 'Asia/Colombo' });

function row(over: Partial<CopyRow> = {}): CopyRow {
  return {
    id: 101,
    number: 'EVT-REG-000101',
    name: 'Dilani Perera',
    company: 'Lanka Tea',
    ticket_type_id: 1,
    status: 'CONFIRMED',
    payment_due: false,
    hash: hashOf(QR),
    ticket_active: true,
    revoked: null,
    photo_file_id: 55,
    presence: [],
    ...over,
  };
}

function copy(over: Partial<DeskCopy> = {}, rows: CopyRow[] = [row()]): DeskCopy {
  return {
    event: {
      id: 7,
      name: 'Tech Summit',
      status: 'LIVE',
      timezone: 'Asia/Colombo',
      start: when('2026-10-20T03:30:00Z'),
      end: when('2026-10-21T12:30:00Z'),
      checkin_policy: 'ONCE',
      reentry_allowed: true,
      days: [
        { day: 1, date: '2026-10-20', label: 'Day 1', start: null, end: null },
        { day: 2, date: '2026-10-21', label: 'Day 2', start: null, end: null },
      ],
    },
    gate: { id: 3, name: 'Main entrance', direction: 'BOTH', active: true, auto_print: false },
    ticket_types: [
      { id: 1, name: 'General', role: 'ATTENDEE', access_days: null, allowed_gate_ids: null, reentry: true, daily_checkin: false, admitted_here: true },
      { id: 2, name: 'Day 2 only', role: 'ATTENDEE', access_days: [2], allowed_gate_ids: null, reentry: false, daily_checkin: false, admitted_here: true },
      { id: 3, name: 'VIP', role: 'VIP', access_days: null, allowed_gate_ids: [9], reentry: true, daily_checkin: true, admitted_here: false },
    ],
    rules: { duplicate_behavior: 'warn', require_payment: 'block', auto_checkin: false, photo_verification: true, walk_ins: true },
    rows,
    cursor: 40,
    cache_expires: when('2026-10-22T12:30:00Z'),
    generated: null,
    total: rows.length,
    warning: 'Offline, a ticket let in at another gate is only seen when that device syncs: duplicates across devices may show late (EV-OFF-011).',
    ...over,
  };
}

describe('ScanRules, as the server has it', () => {
  it('answers in the server’s order and words', () => {
    expect(scanRules({ token_known: false })).toMatchObject({ result: 'INVALID_TICKET', colour: 'red', reason: 'This code is not a ticket for this event.' });
    expect(scanRules({ token_known: true, token_active: false, revoke_reason: 'reissued' }).reason).toBe('A new ticket was issued in its place.');
    expect(scanRules({ token_known: true, token_active: false, revoke_reason: 'odd' }).reason).toBe('This ticket is no longer valid.');
    // A cancelled ticket is not "invalid": it is said as a cancellation, after the event checks.
    expect(scanRules({ token_known: true, token_active: false, revoke_reason: 'cancelled', event_status: 'LIVE', registration_status: 'CANCELLED' }).result).toBe('CANCELLED');
    expect(scanRules({ token_known: true, token_active: true, scope_ok: false, event_status: 'LIVE' }).result).toBe('ACCESS_DENIED');
    expect(scanRules({ token_known: true, token_active: true, event_status: 'PUBLISHED', registration_status: 'CONFIRMED' }).result).toBe('EVENT_NOT_ACTIVE');
    expect(scanRules({ token_known: true, token_active: true, event_status: 'LIVE', registration_status: 'PENDING_PAYMENT' })).toMatchObject({
      result: 'PAYMENT_REQUIRED',
      reason: 'The registration is waiting for its payment: take it to confirm the ticket.',
    });
    expect(scanRules({ token_known: true, token_active: true, event_status: 'LIVE', registration_status: 'WAITLISTED' }).reason).toBe('The registration is not confirmed.');
  });

  it('meets money still owed by the event’s policy', () => {
    const f = { token_known: true, token_active: true, event_status: 'LIVE', registration_status: 'CONFIRMED', payment_settled: false };
    expect(scanRules({ ...f, require_payment: 'block' }).result).toBe('PAYMENT_REQUIRED');
    expect(scanRules({ ...f, require_payment: 'warn' })).toMatchObject({ result: 'VALID', action: 'CHECK_IN', warning: 'Payment is outstanding.' });
    expect(scanRules({ ...f, require_payment: 'off' })).toMatchObject({ result: 'VALID', warning: null });
  });

  it('checks the day, the gate, then presence and the duplicate policy', () => {
    const f = { token_known: true, token_active: true, event_status: 'LIVE', registration_status: 'CONFIRMED' };
    expect(scanRules({ ...f, day_allowed: false, valid_days: [2, 3] }).reason).toBe('This ticket is not valid today (valid: 2, 3).');
    expect(scanRules({ ...f, gate_allowed: false }).result).toBe('ACCESS_DENIED');
    expect(scanRules({ ...f, presence: 'INSIDE', duplicate_behavior: 'warn' })).toMatchObject({ result: 'VALID', action: 'CHECK_IN', warning: 'Already checked in.' });
    expect(scanRules({ ...f, presence: 'INSIDE', duplicate_behavior: 'checkout' })).toMatchObject({ result: 'VALID', action: 'CHECK_OUT' });
    expect(scanRules({ ...f, presence: 'INSIDE', duplicate_behavior: 'block' })).toMatchObject({ result: 'ALREADY_CHECKED_IN', colour: 'amber' });
    expect(scanRules({ ...f, presence: 'OUTSIDE', reentry_allowed: false }).reason).toBe('Re-entry is not allowed on this ticket.');
    expect(scanRules({ ...f, presence: 'OUTSIDE', reentry_allowed: true })).toMatchObject({ result: 'VALID', reason: 'Welcome.' });
  });

  it('refuses a check-out of a ticket not inside', () => {
    expect(checkOutRefusal({ token_known: false })).toBe('This code is not a ticket for this event.');
    expect(checkOutRefusal({ token_known: true, presence: 'OUTSIDE' })).toBe('This ticket is not checked in.');
    expect(checkOutRefusal({ token_known: true, presence: 'INSIDE' })).toBeNull();
  });
});

describe('the copy: what a scan matches, and what it says', () => {
  it('matches a QR by its hash, a number as typed, a registration by id', () => {
    const c = copy();
    expect(matchInCopy(c.rows, { code: ` ${QR.toLowerCase()} ` }, hashOf)?.via).toBe('qr');
    expect(matchInCopy(c.rows, { code: 'evt-reg-000101' }, hashOf)).toMatchObject({ via: 'number', row: { id: 101 } });
    expect(matchInCopy(c.rows, { registration_id: 101 }, hashOf)?.via).toBe('registration');
    expect(matchInCopy(c.rows, { code: 'EV1-ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ' }, hashOf)).toBeNull();
    expect(normalizeCode('  ev1-abc ')).toBe('EV1-ABC');
    expect(looksLikeQr(QR)).toBe(true);
    expect(looksLikeQr('EVT-REG-000101')).toBe(false);
  });

  it('says VALID, then — once let in here — warns of the second entry (EV-OFF-011)', () => {
    let c = copy();
    const m = matchInCopy(c.rows, { code: QR }, hashOf);
    expect(scanRules(copyFacts(c, m, AT))).toMatchObject({ result: 'VALID', action: 'CHECK_IN', warning: null });
    c = applyLocal(c, 101, 'CHECK_IN', AT);
    expect(presenceFor(c.rows[0]!, '')).toMatchObject({ state: 'INSIDE', entries: 1, last_gate_id: 3 });
    expect(scanRules(copyFacts(c, matchInCopy(c.rows, { code: QR }, hashOf), AT)).warning).toBe('Already checked in.');
    c = applyLocal(c, 101, 'CHECK_OUT', AT + 1000);
    expect(presenceFor(c.rows[0]!, '').state).toBe('OUTSIDE');
  });

  it('reads the ticket’s days, the gate and daily check-in from the copy', () => {
    const c = copy({}, [row({ ticket_type_id: 2 }), row({ id: 102, number: 'EVT-REG-000102', hash: 'x', ticket_type_id: 3 })]);
    expect(scanRules(copyFacts(c, { row: c.rows[0]!, via: 'qr' }, AT)).reason).toBe('This ticket is not valid today (valid: 2).');
    expect(scanRules(copyFacts(c, { row: c.rows[1]!, via: 'qr' }, AT)).result).toBe('ACCESS_DENIED');
    expect(dayKeyFor(c, c.ticket_types[2]!, AT)).toBe('2026-10-20');
    expect(dayKeyFor(c, c.ticket_types[0]!, AT)).toBe('');
    expect(localDate('Asia/Colombo', Date.parse('2026-10-20T19:00:00Z'))).toBe('2026-10-21');
  });

  it('says CANCELLED for a cancelled registration’s old ticket, and for one picked by number', () => {
    const c = copy({}, [row({ status: 'CANCELLED', ticket_active: false, revoked: 'cancelled' })]);
    expect(scanRules(copyFacts(c, matchInCopy(c.rows, { code: QR }, hashOf), AT)).result).toBe('CANCELLED');
    expect(scanRules(copyFacts(c, matchInCopy(c.rows, { code: 'EVT-REG-000101' }, hashOf), AT)).result).toBe('CANCELLED');
    const re = copy({}, [row({ ticket_active: false, revoked: 'reissued' })]);
    expect(scanRules(copyFacts(re, matchInCopy(re.rows, { code: QR }, hashOf), AT)).result).toBe('INVALID_TICKET');
  });

  it('takes a PUBLISHED event as LIVE once its start has passed, as the sweep does', () => {
    expect(gateEventStatus({ status: 'PUBLISHED', start: when('2026-10-20T03:30:00Z') }, AT)).toBe('LIVE');
    expect(gateEventStatus({ status: 'PUBLISHED', start: when('2026-10-20T05:30:00Z') }, AT)).toBe('PUBLISHED');
    expect(gateEventStatus({ status: 'COMPLETED', start: when('2026-10-20T03:30:00Z') }, AT)).toBe('COMPLETED');
  });

  it('shows the desk’s verdict in the server’s scan-view shape, the photo only with verification on', () => {
    const c = copy();
    const m = matchInCopy(c.rows, { code: QR }, hashOf);
    const v = localView(c, m, scanRules(copyFacts(c, m, AT)), false, AT);
    expect(v).toMatchObject({ result: 'VALID', options: ['check_in'], attendee: { name: 'Dilani Perera', photo_file_id: 55 }, registration: { number: 'EVT-REG-000101', status_label: 'Confirmed' } });
    const off = localView({ ...c, rules: { ...c.rules, photo_verification: false } }, m, scanRules(copyFacts(c, m, AT)), false, AT);
    expect(off.attendee?.photo_file_id).toBeNull();
  });

  it('takes the server’s changes in, and forgets what left the gate', () => {
    const c = mergeChanges(copy(), { items: [row({ status: 'CANCELLED' }), row({ id: 90, number: 'EVT-REG-000090', hash: 'y' })], removed: [], cursor: 44 });
    expect(c.rows.map((r) => r.id)).toEqual([90, 101]);
    expect(c.rows[1]!.status).toBe('CANCELLED');
    expect(c.cursor).toBe(44);
    expect(mergeChanges(c, { items: [], removed: [90], cursor: 41 })).toMatchObject({ cursor: 44, rows: [{ id: 101 }] });
  });

  it('expires the copy when the server said it would', () => {
    expect(copyExpired(copy(), AT)).toBe(false);
    expect(copyExpired(copy(), Date.parse('2026-10-23T00:00:00Z'))).toBe(true);
  });
});

describe('the desk’s search from its copy', () => {
  const c = copy({}, [
    row(),
    row({ id: 102, number: 'EVT-REG-000102', name: 'Nimal Silva', company: 'Perera Holdings', hash: 'a' }),
    row({ id: 103, number: 'EVT-REG-000010', name: 'Kasun Jayasuriya', company: null, ticket_type_id: 2, hash: 'b' }),
  ]);

  it('finds every word at the start of a name or the company, a number anywhere, a ticket by its name', () => {
    expect(searchCopy(c, 'dilani per').map((h) => h.registration_id)).toEqual([101]);
    expect(searchCopy(c, 'perera').map((h) => h.registration_id)).toEqual([101, 102]);
    expect(searchCopy(c, '00010').map((h) => h.number)).toEqual(['EVT-REG-000101', 'EVT-REG-000010', 'EVT-REG-000102']);
    expect(searchCopy(c, 'EVT-REG-000102')[0]!.registration_id).toBe(102);
    expect(searchCopy(c, 'day 2').map((h) => h.registration_id)).toEqual([103]);
    expect(searchCopy(c, 'd')).toEqual([]);
  });

  it('answers within 150 ms for 20,000 registrations (EV-CHK-050)', () => {
    const rows = Array.from({ length: 20_000 }, (_, i) => row({ id: i + 1, number: `EVT-REG-${String(i + 1).padStart(6, '0')}`, name: `Person ${i} Name${i % 97}`, company: `Company ${i % 300}`, hash: `h${i}` }));
    const big = copy({}, rows);
    const t = performance.now();
    const hits = searchCopy(big, 'person 1999', 20);
    expect(performance.now() - t).toBeLessThan(150);
    expect(hits.length).toBeGreaterThan(0);
  });
});

describe('the queue’s numbers', () => {
  it('counts on from the last, and never below the clock (a counter that restarted is not taken for old scans)', () => {
    expect(nextSequence(5, 1)).toBe(6);
    expect(nextSequence(0, 1_790_000_000_123)).toBe(1_790_000_000_123);
    expect(nextSequence(1_790_000_000_500, 1_790_000_000_123)).toBe(1_790_000_000_501);
  });

  it('makes ids the server takes', () => {
    expect(scanId('dsk')).toMatch(/^[A-Za-z0-9_\-:.]{8,64}$/);
    expect(scanId('batch')).not.toBe(scanId('batch'));
    expect(provisionalNumber(12, 1_790_000_000_123)).toBe('WALKIN-12-000123');
  });
});

describe('what the Events tab keeps for offline reading', () => {
  it('keeps the permissions, the events and their gates — nothing with people in it', () => {
    for (const p of ['/api/events/v1/options?org=5', '/api/events/v1/events?per_page=100&sort=start', '/api/events/v1/events/7', '/api/events/v1/events/7/gates']) expect(eventsCached(p)).toBe(true);
    for (const p of ['/api/events/v1/events/7/registrations', '/api/events/v1/attendees', '/api/events/v1/events/7/checkin/search', '/api/events/v1/events/7/checkin/bootstrap', '/api/events/v1/registrations/101'])
      expect(eventsCached(p)).toBe(false);
  });
});
