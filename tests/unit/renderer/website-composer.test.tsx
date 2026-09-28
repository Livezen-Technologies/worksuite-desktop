// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(),
  on: () => () => undefined,
  errorMessage: (e: unknown) => String(e),
  isMac: false,
  registerDropped: vi.fn(async (files: File[]) => files.map((f, i) => ({ handle: `h${i}`, name: f.name, size: f.size }))),
}));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(async () => ({})), apiPost: vi.fn(async () => ({})), request: vi.fn(async () => ({ data: {} })) }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/app-state', async () => {
  const { createStore } = await import('../../../src/core/store');
  return { app: createStore({ apps: [], transfers: [], bootstrap: { permissions: ['*'] }, auth: { server: { origin: 'https://app.worksuite.lk' } } }) };
});

import { apiPost } from '../../../src/core/api';
import { call } from '../../../src/core/bridge';
import { toast } from '../../../src/core/toasts';
import { Composer, type ComposerHandle } from '../../../src/modules/chat/Composer';
import { matchReplies, refuseForVisitor, savedReplyQuery } from '../../../src/modules/chat/website/profile';

const replies = [
  { id: 1, shortcut: 'edu', title: 'Education discount', body: 'Schools get 20% off the first year.' },
  { id: 2, shortcut: 'hours', title: 'Support hours', body: 'We answer 8:30am–5:30pm on weekdays.' },
  { id: 3, shortcut: null, title: 'Thanks', body: 'Thank you for getting in touch!' },
];

describe('the website channel profile (ENH-WCHAT-02)', () => {
  it('refuses what a visitor cannot receive, with the reason (RDC-04)', () => {
    expect(refuseForVisitor('logo.svg', 1000)).toBe("SVG files can't be sent to a visitor.");
    expect(refuseForVisitor('Makefile', 10)).toBe("Files without a type can't be sent to a visitor.");
    expect(refuseForVisitor('quote.PDF', 1000)).toBeNull();
    expect(refuseForVisitor('scan.png', 6 * 1024 * 1024)).toBe('scan.png is larger than the 5 MB a visitor can receive.');
    expect(refuseForVisitor('scan.png', 6 * 1024 * 1024, 10240)).toBeNull();
  });
  it('finds saved replies after "/" at the start of a word (RDC-03)', () => {
    expect(savedReplyQuery('/ed', 3)).toEqual({ start: 0, word: 'ed' });
    expect(savedReplyQuery('Hi /HOURS', 9)).toEqual({ start: 3, word: 'hours' });
    expect(savedReplyQuery('and/or', 6)).toBeNull();
    expect(matchReplies(replies, 'edu').map((r) => r.id)).toEqual([1]);
    expect(matchReplies(replies, 'th').map((r) => r.id)).toEqual([3]);
    expect(matchReplies(replies, '').map((r) => r.id)).toEqual([1, 2, 3]);
  });
});

const calls = vi.mocked(call);

function mount() {
  const ref = { current: null as ComposerHandle | null };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <Composer ref={(h) => void (ref.current = h)} roomId="website-41" roomName="Visitor 4F2A" group={false} reply={null} onClearReply={() => undefined} website={{ conversationId: 41, replies }} />
    </QueryClientProvider>,
  );
  return ref;
}

describe('the website thread on the shared composer (RDC-01/02)', () => {
  beforeEach(() => {
    calls.mockReset();
    calls.mockImplementation(async (channel: string) => {
      if (channel === 'offline:getDraft') return null as never;
      if (channel === 'offline:submit') return { delivered: true, queued: false } as never;
      if (channel === 'files:pickFiles') return [] as never;
      return undefined as never;
    });
    vi.mocked(toast).mockReset();
  });
  afterEach(() => cleanup());

  it('has no @mentions, urgent, sharing or voice; attach offers documents, images and the camera', () => {
    mount();
    expect(screen.queryByRole('button', { name: 'Urgent' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Share from WorkSuite' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
    const items = screen.getAllByRole('menuitem').map((b) => b.textContent ?? '');
    expect(items.some((t) => t.startsWith('Document'))).toBe(true);
    expect(items.some((t) => t.startsWith('Image'))).toBe(true);
    expect(items.some((t) => /Video|Audio|Drive|Voice/.test(t))).toBe(false);
    expect(screen.getByText(/for saved replies/)).toBeTruthy();
  });

  it('shows the first saved replies as chips, and "/" finds one that Enter inserts', () => {
    mount();
    expect(screen.getByRole('button', { name: 'Education discount' })).toBeTruthy();
    const box = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Hello! /edu', selectionStart: 11 } });
    expect(screen.getByRole('listbox', { name: 'Saved replies' })).toBeTruthy();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(box.value).toBe('Hello! Schools get 20% off the first year.');
    expect(screen.queryByRole('listbox', { name: 'Saved replies' })).toBeNull();
  });

  it('sends a reply through the outbox to the widget reply, and tells the visitor it is typing', async () => {
    mount();
    const box = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(box, { target: { value: 'We can help with that.' } });
    expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/api/chat/widget-admin/conversations/41/typing');
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' });
    });
    expect(calls).toHaveBeenCalledWith('offline:submit', expect.objectContaining({ module: 'website-chat', entityId: '41', path: '/api/chat/widget-admin/conversations/41/reply', body: { message: 'We can help with that.' }, queueIfOffline: true }));
    // Never Team Chat's message endpoint.
    expect(calls.mock.calls.filter(([c]) => c === 'offline:submit').map(([, x]) => (x as { path: string }).path)).toEqual(['/api/chat/widget-admin/conversations/41/reply']);
  });

  it('refuses a dropped file a visitor cannot receive before any upload, and sends the rest to the widget', async () => {
    calls.mockImplementation(async (channel: string) => {
      if (channel === 'offline:getDraft') return null as never;
      if (channel === 'transfers:upload') return [{ id: 't1' }] as never;
      return undefined as never;
    });
    const ref = mount();
    act(() => ref.current?.stage([{ handle: 'h1', name: 'logo.svg', size: 900 }, { handle: 'h2', name: 'quote.pdf', size: 90_000 }]));
    expect(vi.mocked(toast)).toHaveBeenCalledWith('error', "SVG files can't be sent to a visitor.");
    expect(screen.queryByText('logo.svg')).toBeNull();
    expect(screen.getByText('quote.pdf')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });
    expect(calls).toHaveBeenCalledWith('transfers:upload', { handles: ['h2'], target: { kind: 'website', conversationId: 41 } });
  });
});
