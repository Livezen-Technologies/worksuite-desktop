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
vi.mock('../../../src/components/DriveFilePicker', () => ({
  DriveFilePicker: ({ title, onChoose }: { title: string; onChoose: (f: Array<{ id: string; name: string }>) => void }) => (
    <button type="button" onClick={() => onChoose([{ id: '11', name: 'Adobe CC Teams Quote.pdf' }, { id: '12', name: 'logo.svg' }])}>{title}</button>
  ),
}));
vi.mock('../../../src/core/app-state', async () => {
  const { createStore } = await import('../../../src/core/store');
  return { app: createStore({ apps: [{ id: 'files' }], transfers: [], bootstrap: { permissions: ['*'] }, auth: { server: { origin: 'https://app.worksuite.lk' } } }) };
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
    // P-04's words: "logo.svg can't be sent to a visitor — use PNG or PDF".
    expect(refuseForVisitor('logo.svg', 1000)).toBe("logo.svg can't be sent to a visitor — use PNG or PDF");
    expect(refuseForVisitor('Makefile', 10)).toBe("Makefile can't be sent to a visitor — use PNG or PDF");
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

function mount(reply: { id: number; sender_name: string; snippet: string } | null = null, onClearReply = () => undefined, maxUploadKb?: number) {
  const ref = { current: null as ComposerHandle | null };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <Composer ref={(h) => void (ref.current = h)} roomId="website-41" roomName="Visitor 4F2A" group={false} reply={reply} onClearReply={onClearReply} website={{ conversationId: 41, replies, maxUploadKb }} />
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

  it('has no @mentions, urgent, sharing or voice; attach offers upload, paste, a photo and a copy from Drive (P-04)', () => {
    mount();
    expect(screen.queryByRole('button', { name: 'Urgent' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Share from WorkSuite' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mention someone' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Record a voice message' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
    const items = screen.getAllByRole('menuitem').map((b) => b.textContent ?? '');
    expect(items).toEqual(['Upload a file', 'Paste a screenshot', 'Take a photo', "From DriveSends a copy — visitors can't open Drive links"]);
    expect(items.some((t) => /Video|Audio|Voice/.test(t))).toBe(false);
    expect(screen.getByText(/for saved and suggested replies/)).toBeTruthy();
  });

  it('shows the first saved replies as chips, and "/" finds one that Enter inserts', () => {
    mount();
    expect(screen.getByRole('button', { name: 'Education discount' })).toBeTruthy();
    const box = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Hello! /edu', selectionStart: 11 } });
    expect(screen.getByRole('listbox', { name: 'Quick actions' })).toBeTruthy();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(box.value).toBe('Hello! Schools get 20% off the first year.');
    expect(screen.queryByRole('listbox', { name: 'Quick actions' })).toBeNull();
  });

  it('sends a reply through the outbox to the widget reply, and tells the visitor it is typing', async () => {
    mount();
    const box = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(box, { target: { value: 'We can help with that.' } });
    expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/api/chat/widget-admin/conversations/41/typing', { state: 'start' });
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' });
    });
    expect(calls).toHaveBeenCalledWith('offline:submit', expect.objectContaining({ module: 'website-chat', entityId: '41', path: '/api/chat/widget-admin/conversations/41/reply', body: { message: 'We can help with that.', client_id: expect.any(String) }, queueIfOffline: true }));
    // Sending stops it at once (LIVE-04).
    expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/api/chat/widget-admin/conversations/41/typing', { state: 'stop' });
    // Never Team Chat's message endpoint.
    expect(calls.mock.calls.filter(([c]) => c === 'offline:submit').map(([, x]) => (x as { path: string }).path)).toEqual(['/api/chat/widget-admin/conversations/41/reply']);
  });

  it('answers one visitor message with a quote of it (RDC-10)', async () => {
    const clear = vi.fn();
    mount({ id: 7, sender_name: 'Visitor 4F2A', snippet: 'And for students?' }, clear);
    // ReplyBar (P-04): "Replying to Visitor 4F2A · And for students?", the name in bold.
    expect(document.querySelector('[data-reply-bar]')?.textContent).toBe('Replying to Visitor 4F2A · And for students?');
    const box = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(box, { target: { value: 'Students get 50% off.' } });
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' });
    });
    expect(calls).toHaveBeenCalledWith('offline:submit', expect.objectContaining({ path: '/api/chat/widget-admin/conversations/41/reply', body: { message: 'Students get 50% off.', reply_to: 7, client_id: expect.any(String) } }));
    expect(clear).toHaveBeenCalled();
  });

  it('sends a Drive file to the visitor as a copy, saying why one is refused (RDC-05)', async () => {
    vi.mocked(apiPost).mockReset().mockImplementation((async (_path: string, body?: { file_id?: number }) => {
      if (body?.file_id === 12) throw new Error("SVG files can't be sent to a visitor.");
      return {};
    }) as never);
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
    fireEvent.click(screen.getAllByRole('menuitem').find((b) => (b.textContent ?? '').startsWith('From Drive'))!);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send a copy to the visitor' }));
    });
    expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/api/chat/widget-admin/conversations/41/attach-drive', { file_id: 11 });
    expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/api/chat/widget-admin/conversations/41/attach-drive', { file_id: 12 });
    expect(vi.mocked(toast)).toHaveBeenCalledWith('error', "logo.svg: Error: SVG files can't be sent to a visitor.");
    // Never Drive's share-a-link endpoint.
    expect(vi.mocked(apiPost).mock.calls.some(([p]) => String(p).startsWith('/api/drive/'))).toBe(false);
  });

  it('a reply written from a saved reply says which, once, so the server counts the use (RDC-03)', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Education discount' }));
    const box = screen.getByRole('textbox', { name: 'Message' });
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' });
    });
    expect(calls).toHaveBeenCalledWith('offline:submit', expect.objectContaining({ body: { message: 'Schools get 20% off the first year.', canned_id: 1, client_id: expect.any(String) } }));
    fireEvent.change(box, { target: { value: 'Anything else?' } });
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' });
    });
    const sent = calls.mock.calls.filter(([c]) => c === 'offline:submit').map(([, x]) => (x as { body: unknown }).body);
    expect(sent).toEqual([{ message: 'Schools get 20% off the first year.', canned_id: 1, client_id: expect.any(String) }, { message: 'Anything else?', client_id: expect.any(String) }]);
    // Each reply its own client id (DLV-01, plan 1.9).
    expect(new Set(sent.map((b) => (b as { client_id: string }).client_id)).size).toBe(2);
  });

  it('holds files to the website\'s own size limit, not a fixed 5 MB (RDC-04)', () => {
    const big = { handle: 'h3', name: 'brochure.pdf', size: 8 * 1024 * 1024 };
    const ref = mount(null, () => undefined, 10_240);
    act(() => ref.current?.stage([big]));
    expect(screen.getByText('brochure.pdf')).toBeTruthy();
    expect(vi.mocked(toast)).not.toHaveBeenCalled();
    cleanup();
    const ref2 = mount();
    act(() => ref2.current?.stage([big]));
    expect(screen.queryByText('brochure.pdf')).toBeNull();
    // Said under the tray, where the file would have been (P-04 AttachmentTray).
    expect(screen.getByRole('alert').textContent).toContain('brochure.pdf is larger than the 5 MB a visitor can receive.');
  });

  it('refuses a dropped file a visitor cannot receive before any upload, and sends the rest to the widget', async () => {
    calls.mockImplementation(async (channel: string) => {
      if (channel === 'offline:getDraft') return null as never;
      if (channel === 'transfers:upload') return [{ id: 't1' }] as never;
      return undefined as never;
    });
    const ref = mount();
    act(() => ref.current?.stage([{ handle: 'h1', name: 'logo.svg', size: 900 }, { handle: 'h2', name: 'quote.pdf', size: 90_000 }]));
    expect(screen.getByText("logo.svg can't be sent to a visitor — use PNG or PDF")).toBeTruthy();
    expect(screen.queryByText('logo.svg')).toBeNull();
    expect(screen.getByText('quote.pdf')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });
    expect(calls).toHaveBeenCalledWith('transfers:upload', { handles: ['h2'], target: { kind: 'website', conversationId: 41 } });
  });
});

describe('external channels on the shared composer (#156)', () => {
  afterEach(cleanup);
  function external(refusal: string | null = null, allowBlockedDraft = true, send = vi.fn(async (_text: string, _files: File[]) => true)) {
    calls.mockImplementation(async () => null as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><Composer roomId="whatsapp:7" roomName="Customer" group={false} reply={null} onClearReply={() => undefined} channel={{ draftModule: 'whatsapp', draftContext: 'chat:7', refusal, allowBlockedDraft, maxLength: 4000, voice: false, context: () => [], refuseFile: () => null, send }} /></QueryClientProvider>);
    return send;
  }
  it('keeps a blocked draft and prevents Enter from sending', async () => {
    const send = external('Disconnected');
    const box = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(box, { target: { value: 'Keep this reply' } });
    await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }); });
    expect(send).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    expect((box as HTMLTextAreaElement).value).toBe('Keep this reply');
  });
  it('can disable drafting while blocked', () => {
    external('Disconnected', false);
    expect((screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).disabled).toBe(true);
  });
  it('sends using the channel adapter and retains the existing draft namespace', async () => {
    const send = external();
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Hello' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
    expect(send).toHaveBeenCalledWith('Hello', []);
    expect(calls).toHaveBeenCalledWith('offline:getDraft', { module: 'whatsapp', context: 'chat:7' });
    expect(screen.queryByRole('button', { name: 'Urgent' })).toBeNull();
  });
  it('does not resend delivered attachments when a later upload fails', async () => {
    const send = vi.fn(async (_text: string, _files: File[]) => true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    external(null, true, send);
    const box = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(box, { target: { value: 'Caption' } });
    fireEvent.paste(box, { clipboardData: { files: [new File(['a'], 'first.png', { type: 'image/png' }), new File(['b'], 'second.png', { type: 'image/png' })] } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
    expect(send).toHaveBeenCalledTimes(2);
    expect((box as HTMLTextAreaElement).value).toBe('');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
    expect(send.mock.calls[2]?.[1]?.[0]?.name).toBe('second.png');
    expect(send.mock.calls[2]?.[0]).toBe('');
  });

  it('keeps a newer draft written while a send is pending', async () => {
    let delivered: (v: boolean) => void = () => undefined;
    const send = vi.fn((_text: string, _files: File[]) => new Promise<boolean>((resolve) => { delivered = resolve; }));
    external(null, true, send);
    const box = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(box, { target: { value: 'First reply' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    fireEvent.change(box, { target: { value: 'Next reply' } });
    await act(async () => delivered(true));
    expect((box as HTMLTextAreaElement).value).toBe('Next reply');
    expect(send).toHaveBeenCalledWith('First reply', []);
  });
  it('submits only once when Enter is pressed twice before sending finishes', async () => {
    let delivered: (v: boolean) => void = () => undefined;
    const send = vi.fn((_text: string, _files: File[]) => new Promise<boolean>((resolve) => { delivered = resolve; }));
    external(null, true, send);
    const box = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(box, { target: { value: 'Send once' } });
    await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }); fireEvent.keyDown(box, { key: 'Enter' }); });
    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => delivered(true));
  });

});
