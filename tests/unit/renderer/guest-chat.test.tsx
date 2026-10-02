// @vitest-environment jsdom
import { EventEmitter } from 'node:events';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RoomEvent, type Room } from 'livekit-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GuestChat } from '../../../src/modules/meet/GuestChat';
const person = (role = 'participant', waiting = false) => ({ identity: 'g-visitor', name: 'Verified Visitor', metadata: JSON.stringify({ role, waiting }), permissions: { canPublishData: true }, publishData: vi.fn(async () => undefined) });
afterEach(cleanup);
describe('guest room chat policy', () => {
  it('ignores waiting senders and payload-supplied names, and follows host policy changes', () => {
    const room = Object.assign(new EventEmitter(), { localParticipant: person(), remoteParticipants: new Map() });
    const sender = person();
    const view = render(<GuestChat room={room as unknown as Room} chat="everyone" />);
    const receive = (participant: ReturnType<typeof person>, text: string) => act(() => { room.emit(RoomEvent.DataReceived, new TextEncoder().encode(JSON.stringify({ text, name: 'Fake Host' })), participant, undefined, 'meet.guest-chat'); });
    receive(person('participant', true), 'waiting message');
    expect(screen.queryByText(/waiting message/)).toBeNull();
    receive(sender, 'Allowed message');
    expect(screen.getByText('Verified Visitor · Guest:')).toBeTruthy();
    expect(screen.queryByText('Fake Host')).toBeNull();
    view.rerender(<GuestChat room={room as unknown as Room} chat="hosts" />);
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    receive(sender, 'blocked message');
    expect(screen.queryByText('blocked message')).toBeNull();
    view.rerender(<GuestChat room={room as unknown as Room} chat="off" />);
    expect(screen.getByText('Chat is unavailable.')).toBeTruthy();
    expect(screen.queryByText('Allowed message')).toBeNull();
  });
  it('sends scoped room data only when admitted and permitted', async () => {
    const room = Object.assign(new EventEmitter(), { localParticipant: person() });
    render(<GuestChat room={room as unknown as Room} chat="everyone" />);
    fireEvent.change(screen.getByLabelText('Message to meeting'), { target: { value: 'Hello' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
    const [bytes, options] = room.localParticipant.publishData.mock.calls[0]! as unknown as [Uint8Array, unknown];
    expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual({ text: 'Hello' });
    expect(options).toEqual({ reliable: true, topic: 'meet.guest-chat' });
    expect(screen.getByText('Hello')).toBeTruthy();
  });
});
