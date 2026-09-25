import { describe, expect, it } from 'vitest';
import { describeCall, type CallRow } from '../../../src/modules/calls/log';
import { visitorStatus } from '../../../src/modules/chat/website/api';

const call = (over: Partial<CallRow>): CallRow => ({
  uuid: 'u', room_id: 1, room_name: null, caller_name: 'Samali', mode: 'audio', direction: 'incoming', status: 'ended', outcome: 'answered', missed: false, live: false, duration: null, started_at: '2026-09-26 10:00:00',
  ...over,
});

/** The drawer's call log reads each call as ChatDrawerCalls does. */
describe('the call log', () => {
  it('a missed call is missed, and offers to call back', () => {
    expect(describeCall(call({ missed: true }))).toEqual({ kind: 'missed', line: 'Missed voice call', action: 'Call back' });
  });
  it('an answered call says how long it lasted', () => {
    expect(describeCall(call({ direction: 'outgoing', mode: 'video', duration: 720 }))).toEqual({ kind: 'out', line: 'Outgoing video · 12 min', action: 'Call again' });
    expect(describeCall(call({ duration: 240 })).line).toBe('Incoming voice · 4 min');
  });
  it('a call nobody took is not an "outgoing" one', () => {
    expect(describeCall(call({ direction: 'outgoing', outcome: 'cancelled' })).line).toBe('No one joined');
    expect(describeCall(call({ direction: 'outgoing', outcome: 'declined' })).line).toBe('Declined');
  });
  it('a live call is joined', () => {
    expect(describeCall(call({ live: true, mode: 'video' }))).toEqual({ kind: 'live', line: 'Ongoing video call', action: 'Join' });
  });
});

describe('visitors online', () => {
  it('chatting beats active, and two quiet minutes is inactive', () => {
    expect(visitorStatus({ conversation_status: 'open', idle_seconds: 600 })[0]).toBe('Chatting');
    expect(visitorStatus({ conversation_status: 'closed', idle_seconds: 30 })[0]).toBe('Active');
    expect(visitorStatus({ conversation_status: null, idle_seconds: 300 })[0]).toBe('Inactive');
  });
});
