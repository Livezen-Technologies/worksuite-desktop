// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('livekit-client', () => ({ Room: class {}, RoomEvent: {}, Track: { Source: {}, Kind: {} }, VideoPresets: { h720: {} }, DisconnectReason: {}, createLocalTracks: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: vi.fn(() => () => undefined), errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)) }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/api', () => {
  class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
      readonly code: string | null = null,
      readonly data: unknown = null,
    ) {
      super(message);
    }
  }
  return { ApiError, ...api, request: vi.fn() };
});

import { ApiError } from '../../../src/core/api';
import { DEFAULT_ROOM_SETTINGS, may } from '../../../src/modules/meet/api';
import { meet, metaOf, roleOf, userIdOf } from '../../../src/modules/meet/session';
import { HostLeaveDialog, RoleBadge, RoomSettingsFields } from '../../../src/modules/meet/RoomRoles';
import type { Participant } from 'livekit-client';

afterEach(cleanup);

const person = (identity: string, metadata: object | null, name = 'Nimal') => ({ identity, name, metadata: metadata ? JSON.stringify(metadata) : undefined }) as unknown as Participant;

describe('what a connection says about itself', () => {
  it('reads the role the server put on it, and an older server’s host flags', () => {
    expect(roleOf(person('u12-ab', { role: 'presenter' }))).toBe('presenter');
    expect(roleOf(person('u12-ab', { host: true }))).toBe('host');
    expect(roleOf(person('u12-ab', { cohost: true }))).toBe('cohost');
    expect(roleOf(person('g-ab', null))).toBe('participant');
    expect(metaOf(person('u1-a', { waiting: true, door: 'no_host' })).door).toBe('no_host');
  });

  it('knows the WorkSuite user behind a connection, and no one behind a guest', () => {
    expect(userIdOf(person('u12-ab3f', null))).toBe(12);
    expect(userIdOf(person('g-ab3f', null))).toBe(0);
  });
});

describe('what each role may do', () => {
  const closed = { ...DEFAULT_ROOM_SETTINGS, present: 'presenters', invite: 'hosts', chat: 'hosts', record: 'hosts', transcripts: 'hosts' } as const;

  it('lets everyone present by default, and only presenters and hosts when the room says so', () => {
    expect(may.present('participant', DEFAULT_ROOM_SETTINGS)).toBe(true);
    expect(may.present('participant', closed)).toBe(false);
    expect(may.present('presenter', closed)).toBe(true);
  });

  it('keeps recording the host’s unless co-hosts are allowed, and never a presenter’s', () => {
    expect(may.record('cohost', DEFAULT_ROOM_SETTINGS)).toBe(false);
    expect(may.record('cohost', closed)).toBe(true);
    expect(may.record('presenter', closed)).toBe(false);
  });

  it('closes chat, invitations and transcripts to participants when asked', () => {
    expect(may.chat('participant', closed)).toBe(false);
    expect(may.chat('host', { ...DEFAULT_ROOM_SETTINGS, chat: 'off' })).toBe(false);
    expect(may.invite('presenter', closed)).toBe(false);
    expect(may.transcripts('cohost', closed)).toBe(true);
    expect(may.manage('presenter')).toBe(false);
  });
});

describe('the role badge', () => {
  it('names the role, and a guest as a guest', () => {
    render(<RoleBadge role="cohost" />);
    expect(screen.getByText('Co-host')).toBeTruthy();
    render(<RoleBadge role="participant" guest />);
    expect(screen.getByText('Guest')).toBeTruthy();
  });
});

describe('the room settings fields', () => {
  it('hands back each change on its own', () => {
    const onChange = vi.fn();
    render(<RoomSettingsFields value={DEFAULT_ROOM_SETTINGS} onChange={onChange} />);
    // The waiting room and "join before the host" are Host controls now (#91): the access mode, and "Host must join first".
    fireEvent.click(screen.getByRole('switch', { name: 'Host must join first' }));
    expect(onChange).toHaveBeenCalledWith({ join_before_host: false });
    expect(screen.getByRole('switch', { name: 'Use their microphone' }).getAttribute('aria-checked')).toBe('true');
  });

  it('cannot be changed by someone who may not', () => {
    render(<RoomSettingsFields value={DEFAULT_ROOM_SETTINGS} onChange={vi.fn()} disabled />);
    expect((screen.getByRole('switch', { name: 'Host must join first' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('radio', { name: /Trusted/ }) as HTMLInputElement).disabled).toBe(true);
  });
});

describe('the host leaving', () => {
  beforeEach(() => {
    api.apiPost.mockReset();
    meet.uuid = 'm-1';
  });

  const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

  it('asks who takes over when there is no co-host, and hands over to the one chosen', async () => {
    api.apiPost.mockRejectedValueOnce(new ApiError(409, 'Choose who runs the meeting after you leave.', null, { needs_replacement: true, candidates: [{ id: 7, name: 'Kumari' }] }));
    api.apiPost.mockResolvedValueOnce({});
    const leave = vi.spyOn(meet, 'leave').mockResolvedValue();
    const onClose = vi.fn();
    wrap(<HostLeaveDialog onClose={onClose} onEndAll={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    await screen.findByText(/Choose who runs the meeting/);
    expect(leave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Make host and leave' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.apiPost).toHaveBeenLastCalledWith('/api/meet/m-1/handover', { user_id: 7 });
    expect(leave).toHaveBeenCalled();
  });

  it('offers ending the meeting for everyone instead', () => {
    const onEndAll = vi.fn();
    wrap(<HostLeaveDialog onClose={vi.fn()} onEndAll={onEndAll} />);
    fireEvent.click(screen.getByRole('button', { name: 'End for everyone' }));
    expect(onEndAll).toHaveBeenCalled();
  });
});
