// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/tabs', () => ({ navigate: vi.fn() }));
vi.mock('../../../src/core/app-state', async () => {
  const { createStore } = await import('../../../src/core/store');
  return { app: createStore({ auth: { user: { id: '5' }, server: { origin: 'https://app.worksuite.lk' } }, transfers: [] }) };
});

import { apiGet, apiPost, apiPut } from '../../../src/core/api';
import { navigate } from '../../../src/core/tabs';
import { MinutesSheet, MinutesView } from '../../../src/modules/tenders/Minutes';
import { parseMinutes, sourceOf, toFollowUp, toReminder, toTask, writeMinutes, type Context } from '../../../src/modules/tenders/minutesText';
import type { Meeting } from '../../../src/modules/tenders/work';

const meeting = (over: Partial<Meeting> = {}): Meeting => ({
  id: 12, kind: 'pre_bid', scheduled_at: '2026-09-30T04:30:00Z', mode: 'physical', venue: 'RDA Head Office', link: null,
  mandatory: true, questions_due_at: null, attended: true, attended_by: 'Hasarinda', minutes: null, ...over,
});
const ctx = (over: Partial<Context> = {}): Context => ({ tenderId: 40, tender: 'Road works, lot 2', meeting: meeting(), day: '2026-09-30', ...over });

describe('the minutes as text', () => {
  it('reads notes and points, and what each point became', () => {
    const m = parseMinutes('Buyer confirmed the BOQ.\n\n- Send the clarification letter [Task #482]\n• Check the bond wording [Reminder 2026-10-03 09:00]\n1. Visit the site again [Follow-up 2026-10-07 10:00]\n* Price the steel');
    expect(m.notes).toBe('Buyer confirmed the BOQ.');
    expect(m.points).toEqual([
      { text: 'Send the clarification letter', done: { kind: 'task', id: 482 } },
      { text: 'Check the bond wording', done: { kind: 'reminder', at: '2026-10-03 09:00' } },
      { text: 'Visit the site again', done: { kind: 'followup', at: '2026-10-07 10:00' } },
      { text: 'Price the steel', done: null },
    ]);
  });
  it('writes them back as the web can read them, and reads its own writing', () => {
    const text = writeMinutes({ notes: '  Buyer confirmed the BOQ. ', points: [{ text: ' Send   the letter ', done: { kind: 'task', id: 482 } }, { text: '', done: null }, { text: 'Price the steel', done: null }] });
    expect(text).toBe('Buyer confirmed the BOQ.\n\n- Send the letter [Task #482]\n- Price the steel');
    expect(writeMinutes(parseMinutes(text))).toBe(text);
    expect(writeMinutes({ notes: '', points: [] })).toBe('');
  });
  it('keeps minutes written before as notes', () => {
    expect(parseMinutes('We went. The buyer said -5% is fine.')).toEqual({ notes: 'We went. The buyer said -5% is fine.', points: [] });
    expect(parseMinutes(null)).toEqual({ notes: '', points: [] });
  });
  it('says where a point came from', () => {
    expect(sourceOf(meeting(), '2026-09-30', 'Road works')).toMatch(/^the pre-bid meeting on .+ for “Road works”$/);
    expect(sourceOf(meeting({ kind: 'other' }), null, null)).toBe('the meeting');
  });
});

describe('making a point into something', () => {
  beforeEach(() => vi.mocked(apiPost).mockReset());

  it('a task, tagged and linked back to the tender', async () => {
    vi.mocked(apiPost).mockResolvedValue({ id: 482 });
    expect(await toTask('Send the <letter>', ctx(), { assignee: 9, due: '2026-10-02', priority: 'high' })).toEqual({ kind: 'task', id: 482 });
    const [path, body] = vi.mocked(apiPost).mock.calls[0]! as [string, Record<string, unknown>];
    expect(path).toBe('/api/tasks');
    expect(body).toMatchObject({ title: 'Send the <letter>', assignee_id: 9, due_date: '2026-10-02', priority: 'high', tags: ['tender'] });
    expect(body.description).toContain('<p>Send the &lt;letter&gt;</p>');
    expect(body.description).toContain('href="https://app.worksuite.lk/tenders?open=40"');
  });
  it('a reminder in your own calendar, at that time', async () => {
    vi.mocked(apiPost).mockResolvedValue({ id: 77 });
    expect(await toReminder('Check the bond', ctx(), { date: '2026-10-03', time: '09:00' })).toEqual({ kind: 'reminder', at: '2026-10-03 09:00' });
    expect(vi.mocked(apiPost).mock.calls[0]).toEqual(['/api/calendar/events', expect.objectContaining({ title: 'Reminder: Check the bond', start: '2026-10-03T09:00', end: '2026-10-03T09:00', all_day: false, remind_minutes: 0 })]);
  });
  it('a follow-up meeting on the tender, held like this one', async () => {
    vi.mocked(apiPost).mockResolvedValue({ id: 13 });
    expect(await toFollowUp('Visit the site again', ctx(), { date: '2026-10-07', time: '10:00', kind: 'site_visit' })).toEqual({ kind: 'followup', at: '2026-10-07 10:00' });
    const [path, body] = vi.mocked(apiPost).mock.calls[0]! as [string, Record<string, unknown>];
    expect(path).toBe('/api/tenders/40/meetings');
    expect(body).toMatchObject({ kind: 'site_visit', mode: 'physical', venue: 'RDA Head Office', mandatory: false });
    expect(String(body.scheduled_at)).toMatch(/^2026-10-0[67]T\d{2}:\d{2}:00(\.000)?Z$/);
    expect(body.minutes).toMatch(/^Follow-up to the pre-bid meeting on .+: Visit the site again$/);
  });
});

describe('the minutes screen', () => {
  const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
  beforeEach(() => {
    vi.mocked(apiGet).mockReset().mockResolvedValue({ users: [{ id: 5, name: 'Hasarinda' }, { id: 9, name: 'Dinusha Hansani' }] });
    vi.mocked(apiPost).mockReset();
    vi.mocked(apiPut).mockReset().mockResolvedValue({});
    vi.mocked(navigate).mockReset();
  });
  afterEach(cleanup);

  it('shows the points on the meeting, and opens what they became', () => {
    wrap(<MinutesView minutes={'Went well.\n- Send the letter [Task #482]\n- Price the steel'} />);
    expect(screen.getByText('Went well.')).toBeTruthy();
    expect(screen.getByText('Price the steel')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Task #482/ }));
    expect(navigate).toHaveBeenCalledWith('/tasks?task=482');
  });

  it('adds a point, makes it a task, and saves the minutes saying so', async () => {
    const onSaved = vi.fn();
    vi.mocked(apiPost).mockResolvedValue({ id: 482 });
    wrap(<MinutesSheet tenderId={40} tender="Road works" meeting={meeting({ minutes: 'Buyer confirmed the BOQ.' })} onClose={() => undefined} onSaved={onSaved} />);
    const add = screen.getByLabelText('A new point');
    fireEvent.change(add, { target: { value: 'Send the clarification letter' } });
    fireEvent.keyDown(add, { key: 'Enter' });
    expect((screen.getByLabelText('Point 1') as HTMLInputElement).value).toBe('Send the clarification letter');
    fireEvent.click(screen.getByRole('button', { name: /^Task$/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create the task' }));
    });
    expect(vi.mocked(apiPost).mock.calls[0]![0]).toBe('/api/tasks');
    expect(vi.mocked(apiPost).mock.calls[0]![1]).toMatchObject({ title: 'Send the clarification letter', assignee_id: 5 });
    expect(apiPut).toHaveBeenCalledWith('/api/tenders/meetings/12', { minutes: 'Buyer confirmed the BOQ.\n\n- Send the clarification letter [Task #482]' });
    expect(onSaved).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Task #482/ })).toBeTruthy();
    expect(screen.queryByLabelText('Point 1')).toBeNull();
  });

  it('will not set a reminder in the past', () => {
    wrap(<MinutesSheet tenderId={40} tender={null} meeting={meeting({ minutes: '- Check the bond' })} onClose={() => undefined} onSaved={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /^Reminder$/ }));
    fireEvent.change(screen.getByLabelText('Reminder date'), { target: { value: '2020-01-01' } });
    expect(screen.getByText('That is already past.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Set the reminder' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
