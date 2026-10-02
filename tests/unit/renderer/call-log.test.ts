import { describe, expect, it } from 'vitest';
import { describeCall, describeCard, type CallRow } from '../../../src/modules/calls/log';
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
  it('a call nobody took is not an "outgoing" one, and says why (worksuite-desktop#113)', () => {
    expect(describeCall(call({ direction: 'outgoing', outcome: 'cancelled' })).line).toBe('Cancelled');
    expect(describeCall(call({ direction: 'outgoing', outcome: 'missed' }))).toEqual({ kind: 'out', line: 'No answer', action: 'Call again' });
    expect(describeCall(call({ direction: 'outgoing', outcome: 'declined' })).line).toBe('Declined');
    expect(describeCall(call({ direction: 'outgoing', outcome: 'declined', decline_reason: 'busy' })).line).toBe('Busy');
    expect(describeCall(call({ direction: 'outgoing', outcome: null, status: 'ended' })).line).toBe('No one joined');
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

describe('a call card in the thread', () => {
  const card = (over: Record<string, unknown>) => ({ sender_name: 'Samali', call_kind: 'call', call_mode: 'audio', call_state: 'ended', call_outcome: null, call_duration: null, ...over });

  it('a live call can be joined by the others, not by whoever started it', () => {
    expect(describeCard(card({ call_state: 'live' }), false)).toMatchObject({ title: 'Samali is calling', action: 'Join', tone: 'live' });
    expect(describeCard(card({ call_state: 'live' }), true).action).toBeNull();
  });

  it('a call nobody took is missed for them, and "No answer" for the caller', () => {
    expect(describeCard(card({ call_outcome: 'missed' }), false)).toMatchObject({ title: 'Missed voice call', action: 'Call back', tone: 'missed' });
    expect(describeCard(card({ call_outcome: 'missed' }), true)).toMatchObject({ title: 'No answer', action: 'Call again' });
  });

  it('a call the caller gave up on is cancelled for them, and still missed for the other side', () => {
    expect(describeCard(card({ call_outcome: 'cancelled' }), false)).toMatchObject({ title: 'Missed voice call', tone: 'missed' });
    expect(describeCard(card({ call_outcome: 'cancelled' }), true)).toMatchObject({ title: 'Cancelled call', action: 'Call again' });
  });

  it('a declined call is not a missed one', () => {
    expect(describeCard(card({ call_outcome: 'declined', call_mode: 'video' }), false)).toMatchObject({ title: 'Declined video call', tone: 'plain', action: 'Call back' });
  });

  it('an answered call says how long it lasted', () => {
    expect(describeCard(card({ call_outcome: 'answered', call_duration: 250, call_mode: 'video' }), false)).toMatchObject({ title: 'Video call', detail: '4 min', action: 'Call back' });
  });

  it('a Meet card is a meeting, joined while live, and says when it is gone', () => {
    expect(describeCard(card({ call_kind: 'meeting', call_state: 'live' }), false)).toMatchObject({ title: 'Samali started a meeting', action: 'Join' });
    expect(describeCard(card({ call_kind: 'meeting', call_state: 'gone' }), false)).toMatchObject({ title: 'Meeting removed', action: null });
  });
});
