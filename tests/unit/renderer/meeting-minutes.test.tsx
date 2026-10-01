// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const bridge = vi.hoisted(() => ({ call: vi.fn(), listeners: [] as Array<(e: unknown) => void> }));
vi.mock('../../../src/core/bridge', () => ({
  call: bridge.call,
  on: (_c: string, fn: (e: unknown) => void) => {
    bridge.listeners.push(fn);
    return () => undefined;
  },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/modules/ai/AiTextDialog', () => ({
  AiTextDialog: ({ actions }: { actions: Array<{ label: string; run: (t: string) => void }> }) => (
    <button type="button" onClick={() => actions[0]!.run('AGENDA:\n- Budget\nSUMMARY:\nWe went through the budget.\nDECISIONS:\n- Approve Q4\nACTIONS:\n- Send the plan | Asha | 2026-10-09\n- Book the hall | Someone Else |')}>
      use draft
    </button>
  ),
}));
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
import { MinutesEditor, minutesText } from '../../../src/modules/meetings/minutes/MinutesEditor';
import { cleanHtml, htmlOf, plainText } from '../../../src/modules/meetings/minutes/RichText';
import type { MinutesView } from '../../../src/modules/meetings/minutes/api';

const view = (over: Partial<MinutesView> = {}): MinutesView => ({
  meeting: { id: 9, title: 'Budget review', start_at: '2026-10-01T09:00:00Z', end_at: '2026-10-01T10:00:00Z', when: 'Thursday 1 October 2026, 2:30pm' },
  people: [
    { id: 1, user_id: 5, name: 'Asha', email: 'asha@x.lk', role: 'organizer', attendance: null },
    { id: 2, user_id: 6, name: 'Ben', email: 'ben@x.lk', role: 'required', attendance: null },
  ],
  sections: { agenda: '', discussion: '<p>Started</p>', decisions: '' },
  revs: { agenda: 0, discussion: 2, decisions: 0 },
  edited: { agenda: null, discussion: { id: 6, name: 'Ben', at: '2026-10-01T09:10:00Z' }, decisions: null },
  finalised_at: null,
  shared_at: null,
  actions: [],
  access: { view: 'participants', edit: 'chosen' },
  can: { edit: true, manage: true },
  ...over,
});

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const type = (label: string, html: string) => {
  const box = screen.getByRole('textbox', { name: label });
  box.innerHTML = html;
  fireEvent.input(box);
};

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  bridge.call.mockReset().mockResolvedValue(undefined);
  bridge.listeners.length = 0;
});
afterEach(cleanup);

describe('formatted minutes', () => {
  it('keeps only the formatting the server keeps', () => {
    expect(cleanHtml('<p onclick="x()"><b>Bold</b> <script>bad()</script>ok</p>')).toBe('<p><strong>Bold</strong> ok</p>');
    expect(cleanHtml('<a href="javascript:x()">no</a><a href="https://x.lk">yes</a>')).toBe('no<a href="https://x.lk">yes</a>');
    expect(cleanHtml('<div>line</div>')).toBe('<p>line</p>');
  });

  it('reads as text with lists as lines, and lines make a list', () => {
    expect(plainText('<p>Agreed</p><ul><li>one</li><li>two</li></ul>')).toBe('Agreed\n- one\n- two');
    expect(htmlOf(['a <b>', ' ', 'c'])).toBe('<ul><li>a &lt;b&gt;</li><li>c</li></ul>');
  });

  it('copies with the title, date and people at the top', () => {
    const v = view({ actions: [{ id: 1, title: 'Send the plan', detail: null, assignee_id: 5, assignee: 'Asha', due_date: '2026-10-09', priority: 'normal', status: 'open', task_id: null }] });
    const text = minutesText(v, (s) => v.sections[s]);
    expect(text.startsWith('Budget review\n\nThursday 1 October 2026, 2:30pm\n\nParticipants: Asha, Ben')).toBe(true);
    expect(text).toContain('DISCUSSION\nStarted');
    expect(text).toContain('- Send the plan — Asha — due 2026-10-09');
  });
});

describe('the minutes editor', () => {
  it('shows the meeting, saves a section by itself on the revision it was written on, and says so', async () => {
    api.apiGet.mockResolvedValue(view());
    api.apiPut.mockResolvedValue({ rev: 3, html: '<p>Started and went on</p>', edited: { id: 5, name: 'Asha', at: '2026-10-01T09:12:00Z' } });
    wrap(<MinutesEditor meetingId={9} />);
    expect(await screen.findByText('Budget review')).toBeTruthy();
    expect(screen.getByText(/Participants:/).closest('p')!.textContent).toContain('Asha, Ben');
    type('Discussion', '<p>Started and went on</p>');
    expect(await screen.findByText('Saving…')).toBeTruthy();
    await waitFor(() => expect(api.apiPut).toHaveBeenCalledWith('/api/meetings/9/minutes/sections/discussion', { html: '<p>Started and went on</p>', base_rev: 2 }), { timeout: 3000 });
    expect(await screen.findByText('Saved')).toBeTruthy();
  });

  it('never overwrites what somebody else saved meanwhile: keeping both saves both', async () => {
    api.apiGet.mockResolvedValue(view());
    api.apiPut
      .mockRejectedValueOnce(new ApiError(409, 'Somebody else changed this section.', null, { conflict: true, section: 'discussion', html: '<p>Ben’s point</p>', rev: 3, edited: { id: 6, name: 'Ben', at: '' } }))
      .mockResolvedValueOnce({ rev: 4, html: 'merged', edited: null });
    wrap(<MinutesEditor meetingId={9} />);
    await screen.findByText('Budget review');
    type('Discussion', '<p>My point</p>');
    const alert = await screen.findByRole('alert', {}, { timeout: 3000 });
    expect(alert.textContent).toContain('Ben changed Discussion while you were writing. Nothing has been overwritten.');
    expect(screen.getByText('Needs your check')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep both' }));
    await waitFor(() => expect(api.apiPut).toHaveBeenCalledTimes(2));
    const second = api.apiPut.mock.calls[1]![1] as { html: string; base_rev: number };
    expect(second.base_rev).toBe(3);
    expect(second.html).toContain('Ben’s point');
    expect(second.html).toContain('My point');
  });

  it('offers Retry when a save fails', async () => {
    api.apiGet.mockResolvedValue(view());
    api.apiPut.mockRejectedValueOnce(new ApiError(0, 'offline', null)).mockResolvedValueOnce({ rev: 3, html: '<p>x</p>', edited: null });
    wrap(<MinutesEditor meetingId={9} />);
    await screen.findByText('Budget review');
    type('Discussion', '<p>x</p>');
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }, { timeout: 3000 }));
    await waitFor(() => expect(api.apiPut).toHaveBeenCalledTimes(2));
  });

  it('is read-only for somebody who may only read, and final minutes for everyone', async () => {
    api.apiGet.mockResolvedValue(view({ can: { edit: false, manage: false } }));
    wrap(<MinutesEditor meetingId={9} />);
    expect(await screen.findByText(/You can read these minutes/)).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Discussion' }).getAttribute('contenteditable')).toBe('false');
    expect(screen.queryByRole('button', { name: /Generate with AI/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Finalise' })).toBeNull();
  });

  it('puts an AI draft into the editor without inventing an owner it cannot match', async () => {
    api.apiGet.mockResolvedValue(view());
    api.apiPost.mockResolvedValue({});
    api.apiPut.mockResolvedValue({ rev: 1, html: '', edited: null });
    wrap(<MinutesEditor meetingId={9} />);
    fireEvent.click(await screen.findByRole('button', { name: /Generate with AI/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'use draft' }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledTimes(2));
    expect(api.apiPost).toHaveBeenCalledWith('/api/meetings/9/actions', { title: 'Send the plan', assignee_id: 5, due_date: '2026-10-09', priority: 'normal', status: 'open' });
    expect(api.apiPost).toHaveBeenCalledWith('/api/meetings/9/actions', { title: 'Book the hall', assignee_id: undefined, due_date: undefined, priority: 'normal', status: 'open' });
    // Somebody's words stay: the draft goes under what was written.
    expect(screen.getByRole('textbox', { name: 'Discussion' }).innerHTML).toContain('Started');
    expect(screen.getByRole('textbox', { name: 'Discussion' }).innerHTML).toContain('We went through the budget.');
    expect(screen.getByRole('textbox', { name: 'Decisions' }).innerHTML).toBe('<ul><li>Approve Q4</li></ul>');
  });

  it('shares the final minutes only with the people chosen, and exports them', async () => {
    api.apiGet.mockResolvedValue(view({ finalised_at: '2026-10-01T11:00:00Z' }));
    api.apiPost.mockResolvedValue({ email: 1, inapp: 1 });
    wrap(<MinutesEditor meetingId={9} />);
    fireEvent.click(await screen.findByRole('button', { name: /Share…/ }));
    const send = screen.getByRole('button', { name: /Share with nobody yet/ }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByText('Ben').closest('label')!.querySelector('input')!);
    fireEvent.click(screen.getByRole('button', { name: /Share with 1/ }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledWith('/api/meetings/9/minutes/share', { participant_ids: [2], note: undefined }));

    fireEvent.click(screen.getByRole('button', { name: 'Word' }));
    expect(bridge.call).toHaveBeenCalledWith('transfers:download', { minutesExport: { meeting: 9, format: 'docx' }, name: 'Budget review — minutes.docx' });
  });
});
