// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('livekit-client', () => ({ Room: class {}, RoomEvent: {}, Track: { Source: {}, Kind: {} }, VideoPresets: { h720: {} }, DisconnectReason: {}, createLocalTracks: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: vi.fn(() => () => undefined), errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)) }));
const toasts = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('../../../src/core/toasts', () => toasts);
const tones = vi.hoisted(() => ({ playOnce: vi.fn(), playTone: vi.fn() }));
vi.mock('../../../src/modules/calls/tones', () => tones);
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
import { DEFAULT_ROOM_SETTINGS, type MeetActivities, type MeetInfo, type MeetPoll, type MeetQuestion, type RoomSettings } from '../../../src/modules/meet/api';
import { handKey, meet } from '../../../src/modules/meet/session';
import { HandQueue, PollsPanel, QaPanel } from '../../../src/modules/meet/Activities';
import { RoomSettingsFields } from '../../../src/modules/meet/RoomRoles';
import { QaPollsTab } from '../../../src/modules/meetings/QaPollsTab';
import { Tile } from '../../../src/modules/calls/ui/CallWorkspace';
import type { Detail } from '../../../src/modules/meetings/api';
import type { Participant } from 'livekit-client';

const question = (over: Partial<MeetQuestion> = {}): MeetQuestion => ({
  id: 1,
  text: 'When does the budget land?',
  anonymous: false,
  author: 'Kumari',
  author_id: 7,
  guest: false,
  mine: false,
  status: 'open',
  answer: null,
  answered_by: null,
  answered_at: null,
  hidden: false,
  votes: 2,
  voted: false,
  created_at: '2026-10-01 10:00:00',
  ...over,
});

const poll = (over: Partial<MeetPoll> = {}): MeetPoll => ({
  id: 4,
  question: 'Lunch?',
  kind: 'single',
  options: ['Rice', 'Noodles'],
  anonymous: false,
  status: 'live',
  shared: false,
  voters: 3,
  my_choices: null,
  results: null,
  ...over,
});

const state = (over: Partial<MeetActivities> = {}): MeetActivities => ({
  enabled: { qa: true, qa_anonymous: true, polls: true, raise_hand: true },
  me: { who: 'u3', name: 'Nimal', manages: false, guest: false },
  questions: [],
  polls: [],
  hands: [],
  ...over,
});

/** Me in the meeting, with a role and room settings. */
function as(role: 'host' | 'cohost' | 'participant', settings: Partial<RoomSettings> = {}, acts: Partial<MeetActivities> = {}) {
  meet.uuid = 'm-1';
  meet.room = null;
  meet.info = { uuid: 'm-1', role, room_settings: { ...DEFAULT_ROOM_SETTINGS, ...settings } } as MeetInfo;
  meet.activities = state({ me: { who: 'u3', name: 'Nimal', manages: role !== 'participant', guest: false }, ...acts });
}

afterEach(cleanup);
beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  toasts.toast.mockReset();
  tones.playOnce.mockReset();
  api.apiGet.mockImplementation(async () => meet.activities);
});

describe('who is who in the queue', () => {
  it('is the person signed in on any connection, and a guest by their identity', () => {
    expect(handKey({ identity: 'u7-ab12' } as Participant)).toBe('u7');
    expect(handKey({ identity: 'g-9f' } as Participant)).toBe('g-9f');
  });

  it('finds a connection’s raised hand and its place in the queue', () => {
    as('participant', {}, { hands: [{ who: 'g-9f', user_id: null, name: 'Guest', raised_at: 'a', mine: false }, { who: 'u7', user_id: 7, name: 'Kumari', raised_at: 'b', mine: false }] });
    expect(meet.handOf({ identity: 'u7-other-device' } as Participant)?.position).toBe(2);
    expect(meet.handOf({ identity: 'u8-x' } as Participant)).toBeNull();
  });
});

describe('the session hears of a change', () => {
  it('tells the hosts a hand went up, with a sound, once even when it comes by both routes', async () => {
    as('host');
    meet.onActivity({ what: 'hands', action: 'raised', who: 'u7', name: 'Kumari' });
    meet.onActivity({ what: 'hands', action: 'raised', who: 'u7', name: 'Kumari' });
    expect(toasts.toast).toHaveBeenCalledTimes(1);
    expect(toasts.toast).toHaveBeenCalledWith('info', 'Kumari raised their hand');
    expect(tones.playOnce).toHaveBeenCalledWith('hand', expect.any(Number));
    await waitFor(() => expect(api.apiGet).toHaveBeenCalledWith('/api/meet/m-1/activities'));
  });

  it('does not tell a participant about somebody else’s hand, but reads the queue again', async () => {
    as('participant');
    meet.onActivity({ what: 'hands', action: 'raised', who: 'u7', name: 'Kumari' });
    expect(toasts.toast).not.toHaveBeenCalled();
    expect(tones.playOnce).not.toHaveBeenCalled();
    await waitFor(() => expect(api.apiGet).toHaveBeenCalled());
  });

  it('tells participants a poll was launched, and me that the host lowered my hand', () => {
    as('participant', {}, { me: { who: 'u3', name: 'Nimal', manages: false, guest: false } });
    meet.onActivity({ what: 'polls', action: 'launched', poll: 4, question: 'Lunch?' });
    expect(toasts.toast).toHaveBeenCalledWith('info', 'New poll: Lunch?');
    meet.onActivity({ what: 'hands', action: 'lowered', who: 'u3', by_host: true });
    expect(toasts.toast).toHaveBeenLastCalledWith('info', 'The host lowered your hand.');
  });

  it('raises a hand without turning the microphone on', async () => {
    as('participant');
    const setMicrophoneEnabled = vi.fn();
    meet.room = { localParticipant: { identity: 'u3-abc', setMicrophoneEnabled, isMicrophoneEnabled: false } } as unknown as typeof meet.room;
    api.apiPost.mockResolvedValueOnce(state({ hands: [{ who: 'u3', user_id: 3, name: 'Nimal', raised_at: 'a', mine: true }] }));
    await meet.raiseHand(true);
    expect(api.apiPost).toHaveBeenCalledWith('/api/meet/m-1/hands/raise', undefined);
    expect(setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(meet.myHand).toBe(true);
    meet.room = null;
  });

  it('says why a change was refused, and reads the state again', async () => {
    as('participant');
    api.apiPost.mockRejectedValueOnce(new ApiError(409, 'You have already voted in this poll.', null));
    expect(await meet.votePoll(4, [0])).toBe(false);
    expect(toasts.toast).toHaveBeenCalledWith('error', 'You have already voted in this poll.');
    await waitFor(() => expect(api.apiGet).toHaveBeenCalled());
  });
});

describe('Q&A', () => {
  it('says before sending whether the question carries my name, and sends it anonymously when asked', async () => {
    as('participant');
    api.apiPost.mockResolvedValueOnce(state({ questions: [question({ id: 9, author: null, anonymous: true, mine: true })] }));
    render(<QaPanel />);
    expect(screen.getByText('Your name is shown with your question.')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask a question' }), { target: { value: 'Is it remote?' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ask anonymously' }));
    expect(screen.getByText(/Your name is hidden from other participants/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledWith('/api/meet/m-1/qa', { text: 'Is it remote?', anonymous: true }));
    expect(await screen.findByText('You · Anonymous')).toBeTruthy();
  });

  it('asks with names only when the host does not allow anonymous questions', () => {
    as('participant', { qa_anonymous: false });
    render(<QaPanel />);
    expect(screen.queryByRole('checkbox', { name: 'Ask anonymously' })).toBeNull();
    expect(screen.getByText(/The host has asked for names/)).toBeTruthy();
  });

  it('upvotes once per press, and shows my upvote as pressed', async () => {
    as('participant', {}, { questions: [question({ voted: true, votes: 3 })] });
    api.apiPost.mockResolvedValueOnce(state({ questions: [question({ voted: false, votes: 2 })] }));
    render(<QaPanel />);
    const up = screen.getByRole('button', { name: /Remove your upvote/ });
    expect(up.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(up);
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledWith('/api/meet/m-1/qa/1/vote', undefined));
    expect((await screen.findByRole('button', { name: /Upvote this question/ })).getAttribute('aria-pressed')).toBe('false');
  });

  it('lets the hosts answer, mark answered and hide; participants only ask and upvote', async () => {
    as('participant', {}, { questions: [question()] });
    const { unmount } = render(<QaPanel />);
    expect(screen.queryByRole('button', { name: 'Hide' })).toBeNull();
    unmount();

    as('cohost', {}, { questions: [question({ anonymous: true, author: 'Kumari' })] });
    api.apiPost.mockImplementation(async () => meet.activities);
    render(<QaPanel />);
    expect(screen.getByText('Kumari')).toBeTruthy();
    expect(screen.getByText('Anonymous')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Write an answer (optional)' }), { target: { value: 'In March.' } });
    fireEvent.click(within(screen.getByRole('listitem')).getAllByRole('button', { name: 'Mark answered' }).at(-1)!);
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledWith('/api/meet/m-1/qa/1/answer', { answered: true, answer: 'In March.' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledWith('/api/meet/m-1/qa/1/hide', { hidden: true }));
  });

  it('says so when the host has turned Q&A off', () => {
    as('participant', { qa: false });
    render(<QaPanel />);
    expect(screen.getByRole('status').textContent).toMatch(/turned Q&A off/);
    expect(screen.queryByRole('textbox', { name: 'Ask a question' })).toBeNull();
  });
});

describe('polls', () => {
  it('says whether the vote is anonymous before voting, takes one vote, and then shows it was counted', async () => {
    as('participant', {}, { polls: [poll({ anonymous: true })] });
    api.apiPost.mockResolvedValueOnce(state({ polls: [poll({ anonymous: true, my_choices: [1], voters: 4 })] }));
    render(<PollsPanel />);
    expect(screen.getByRole('note').textContent).toMatch(/Anonymous: your vote is not linked to your name/);
    const vote = screen.getByRole('button', { name: 'Vote' }) as HTMLButtonElement;
    expect(vote.disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Noodles' }));
    fireEvent.click(vote);
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledWith('/api/meet/m-1/polls/4/vote', { choices: [1] }));
    expect(await screen.findByText('You voted')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Vote' })).toBeNull();
    expect(screen.getByText(/4 voted/)).toBeTruthy();
    expect(screen.getByText('Results show here when the host shares them.')).toBeTruthy();
  });

  it('tells voters on an identified poll that the hosts see their vote, and takes several on a multiple-choice one', async () => {
    as('participant', {}, { polls: [poll({ kind: 'multiple', options: ['a', 'b', 'c'] })] });
    api.apiPost.mockImplementation(async () => meet.activities);
    render(<PollsPanel />);
    expect(screen.getByRole('note').textContent).toMatch(/can see how you voted/);
    fireEvent.click(screen.getByRole('checkbox', { name: 'a' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'c' }));
    fireEvent.click(screen.getByRole('button', { name: 'Vote' }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledWith('/api/meet/m-1/polls/4/vote', { choices: [0, 2] }));
  });

  it('shows shared results to everybody', () => {
    as('participant', {}, { polls: [poll({ status: 'closed', shared: true, results: [1, 2], my_choices: [1] })] });
    render(<PollsPanel />);
    expect(screen.getByLabelText('Noodles: 2 (67%)')).toBeTruthy();
    expect(screen.getByText('Results shared with everyone')).toBeTruthy();
  });

  it('lets the host create and launch a poll', async () => {
    as('host');
    api.apiPost.mockResolvedValueOnce(state({ polls: [poll({ id: 5, status: 'draft' })] })).mockResolvedValueOnce(state({ polls: [poll({ id: 5 })] }));
    render(<PollsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'New poll' }));
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Lunch?' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Option 1' }), { target: { value: 'Rice' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Option 2' }), { target: { value: 'Noodles' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Multiple choice' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Anonymous poll/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledWith('/api/meet/m-1/polls/5/launch', undefined));
    expect(api.apiPost).toHaveBeenCalledWith('/api/meet/m-1/polls', { question: 'Lunch?', kind: 'multiple', options: ['Rice', 'Noodles'], anonymous: true });
  });

  it('lets the host close voting and share the results, and see who voted on an identified poll', async () => {
    as('host', {}, { polls: [poll({ results: [1, 2], ballots: [{ name: 'Kumari', choices: [1] }] })] });
    api.apiPost.mockImplementation(async () => meet.activities);
    render(<PollsPanel />);
    expect(screen.getByText('Who voted (1)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close voting' }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledWith('/api/meet/m-1/polls/4/close', undefined));
    fireEvent.click(screen.getByRole('button', { name: 'Share results' }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledWith('/api/meet/m-1/polls/4/share', { shared: true }));
  });
});

describe('raised hands', () => {
  const hands = [
    { who: 'u7', user_id: 7, name: 'Kumari', raised_at: '10:00:01', mine: false },
    { who: 'g-9f', user_id: null, name: 'Guest Saman', raised_at: '10:00:05', mine: false },
  ];

  it('shows the queue in order; the hosts lower one or all', async () => {
    as('host', {}, { hands });
    api.apiPost.mockImplementation(async () => meet.activities);
    render(<HandQueue />);
    expect(screen.getByText('Raised hands · 2')).toBeTruthy();
    const items = screen.getAllByRole('listitem');
    expect(items[0]!.textContent).toMatch(/1Kumari/);
    expect(items[1]!.textContent).toMatch(/2Guest Saman/);
    fireEvent.click(screen.getByRole('button', { name: 'Lower Guest Saman’s hand' }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledWith('/api/meet/m-1/hands/lower', { who: 'g-9f' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lower all hands' }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledWith('/api/meet/m-1/hands/lower-all', undefined));
  });

  it('lets a participant lower only their own', async () => {
    as('participant', {}, { hands: [...hands, { who: 'u3', user_id: 3, name: 'Nimal', raised_at: '10:00:09', mine: true }] });
    api.apiPost.mockImplementation(async () => meet.activities);
    render(<HandQueue />);
    expect(screen.queryByRole('button', { name: 'Lower all hands' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Lower Kumari/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Lower hand' }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledWith('/api/meet/m-1/hands/lower', undefined));
  });

  it('puts the badge on the tile, with the place in the queue', () => {
    render(<Tile p={{ id: 'u7-a', name: 'Kumari', self: false, speaking: false, micOn: false, camera: null, screen: null, screenPaused: false, hand: { position: 2, label: 'Hand raised · 2' } }} />);
    expect(screen.getByRole('img', { name: 'Hand raised · 2' }).textContent).toBe('2');
  });
});

describe('the host turns each feature on or off', () => {
  it('offers Q&A, anonymous questions, polls and raised hands, all on by default', () => {
    const onChange = vi.fn();
    render(<RoomSettingsFields value={DEFAULT_ROOM_SETTINGS} onChange={onChange} />);
    for (const name of ['Q&A', 'Let people ask anonymously', 'Polls', 'Raise hand']) expect(screen.getByRole('switch', { name }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('switch', { name: 'Raise hand' }));
    expect(onChange).toHaveBeenCalledWith({ raise_hand: false });
  });

  it('cannot allow anonymous questions with Q&A off, and reads a setting an older server leaves out as on', () => {
    render(<RoomSettingsFields value={{ ...DEFAULT_ROOM_SETTINGS, qa: false, polls: undefined }} onChange={vi.fn()} />);
    expect((screen.getByRole('switch', { name: 'Let people ask anonymously' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('switch', { name: 'Polls' }).getAttribute('aria-checked')).toBe('true');
  });
});

describe('the meeting’s details', () => {
  const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
  const d = { meeting: { id: 12, meet_uuid: 'm-1', title: 'Weekly' } } as unknown as Detail;

  it('keeps the questions and polls, without who asked anonymously for a participant', async () => {
    api.apiGet.mockResolvedValueOnce({ full: false, questions: [question({ anonymous: true, author: null, status: 'answered', answer: 'Soon', answered_by: 'Hana' })], polls: [poll({ status: 'closed', shared: true, results: [1, 2] })] });
    wrap(<QaPollsTab d={d} />);
    expect(await screen.findByText('Answered by Hana')).toBeTruthy();
    expect(api.apiGet).toHaveBeenCalledWith('/api/meetings/12/qa-polls', undefined, expect.anything());
    expect(screen.getAllByText('Anonymous').length).toBeGreaterThan(0);
    expect(screen.queryByText('Kumari')).toBeNull();
    expect(screen.getByLabelText('Noodles: 2 (67%)')).toBeTruthy();
    expect(screen.queryByText(/You ran this meeting/)).toBeNull();
  });

  it('shows the people who ran it everything, hidden questions too', async () => {
    api.apiGet.mockResolvedValueOnce({ full: true, questions: [question({ hidden: true })], polls: [] });
    wrap(<QaPollsTab d={d} />);
    expect(await screen.findByText(/You ran this meeting/)).toBeTruthy();
    expect(screen.getByText('Hidden from participants')).toBeTruthy();
  });

  it('has nothing for a meeting not held in Meet', () => {
    wrap(<QaPollsTab d={{ meeting: { id: 3, meet_uuid: null } } as unknown as Detail} />);
    expect(screen.getByText('No Q&A or polls')).toBeTruthy();
  });
});
