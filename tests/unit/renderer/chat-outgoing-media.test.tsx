// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transfer } from '../../../shared/types';
import type { ChatMessage } from '../../../src/modules/chat/types';
import type { Staged } from '../../../src/modules/chat/attach';
import type * as CoreApi from '../../../src/core/api';
const net = vi.hoisted(() => ({ call: vi.fn(), post: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: net.call, on: () => () => undefined, errorMessage: (e: Error) => e.message, isMac: false, hasDesktop: () => true, registerDropped: vi.fn() }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(async () => ({})), apiPost: net.post, request: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/app-state', async () => {
  const { createStore } = await import('../../../src/core/store');
  return { app: createStore({ apps: [], transfers: [], bootstrap: { permissions: ['*'] }, auth: { user: { id: 'u1' }, server: { origin: 'https://ws.example' } } }) };
});
import { app } from '../../../src/core/app-state';
import { busySending } from '../../../src/core/closeGuard';
import { outgoing, queueMedia, outgoingForRoom, cancelMedia, retryMedia, transferPhase } from '../../../src/modules/chat/outgoing';
import { OutgoingMediaBubbles, ChatSendingStatus } from '../../../src/modules/chat/OutgoingMedia';
import { Composer, type ComposerHandle } from '../../../src/modules/chat/Composer';
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
const disk = (name = 'large.mp4'): Staged => ({ key: name, kind: 'disk', file: { handle: 'h1', name, size: 800 * 1024 * 1024 }, transfer: null });
const transfer = (id: string, state: Transfer['state'] = 'running'): Transfer => ({ id: 't1', direction: 'upload', name: 'large.mp4', source: '', destination: 'Chat', bytes: 50, total: 100, state, phase: 'uploading', speed: 0, error: null, createdAt: new Date().toISOString(), chat: { roomId: '12', clientMessageId: id } });
function show(children: React.ReactNode) { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>); }
beforeEach(() => {
  outgoing.set({ jobs: [] }); app.set({ transfers: [] });
  net.post.mockReset().mockResolvedValue({}); net.call.mockReset().mockImplementation(async (channel: string, input?: { name?: string }) => {
    if (channel === 'transfers:prepareMedia') return { handle: 'prepared1', name: input!.name, size: 100 };
    if (channel === 'transfers:upload') return [{ id: 't1', state: 'queued' }];
    if (channel === 'offline:submit') return { delivered: true, queued: false };
    return null;
  });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:preview') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});
afterEach(cleanup);

describe('Instant chat media previews (#83)', () => {
  it('shows a bubble before slow preparation and leaves the composer usable for another message', async () => {
    const prep = deferred<{ handle: string; name: string; size: number }>();
    net.call.mockImplementation(async (channel: string) => channel === 'transfers:prepareMedia' ? prep.promise : channel === 'transfers:upload' ? [{ id: 't1', state: 'queued' }] : channel === 'offline:submit' ? { delivered: true, queued: false } : null);
    const ref = { current: null as ComposerHandle | null };
    show(<><OutgoingMediaBubbles roomId="12" messages={[]} /><Composer ref={(r) => { ref.current = r; }} roomId="12" roomName="Sam" group={false} reply={null} onClearReply={() => {}} /></>);
    act(() => ref.current!.stage([(disk() as Extract<Staged, { kind: 'disk' }>).file]));
    expect(screen.getByLabelText('Original Quality')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByLabelText('Outgoing large.mp4')).toBeTruthy();
    expect(screen.getByText('Preparing…')).toBeTruthy();
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Another message' } });
    expect(screen.getByRole('button', { name: 'Send' })).not.toHaveProperty('disabled', true);
    expect(net.post).not.toHaveBeenCalledWith('/api/chat/messages/attachments', expect.anything());
    prep.resolve({ handle: 'h2', name: 'large.mp4', size: 100 });
    await waitFor(() => expect(net.call).toHaveBeenCalledWith('transfers:upload', expect.anything()));
  });
  it('uses the native transfer for progress and server confirmation, keeping receipts separate', async () => {
    queueMedia('12', [disk()], {}); await waitFor(() => expect(outgoing.get().jobs[0]?.transferId).toBe('t1'));
    const id = outgoing.get().jobs[0]!.id;
    act(() => app.set({ transfers: [transfer(id)] }));
    show(<OutgoingMediaBubbles roomId="12" messages={[]} />);
    expect(screen.getByText('Uploading 50%')).toBeTruthy();
    expect(screen.getByText('50 B of 100 B')).toBeTruthy();
    const bar = () => Number(screen.getByRole('progressbar', { name: 'Sending large.mp4' }).getAttribute('aria-valuenow'));
    expect(bar()).toBe(47);
    act(() => app.set({ transfers: [{ ...transfer(id), bytes: 100, speed: 2048, phase: 'uploading' }] }));
    expect(screen.getByText('100 B of 100 B · 2.0 KB/s')).toBeTruthy();
    const uploaded = bar();
    act(() => app.set({ transfers: [{ ...transfer(id), phase: 'processing' }] }));
    expect(screen.getByText('Checking the file…')).toBeTruthy(); expect(screen.queryByText('Sent')).toBeNull();
    // One bar across every step: the server's check never reads as less done than the bytes were.
    expect(bar()).toBeGreaterThanOrEqual(uploaded);
    act(() => app.set({ transfers: [{ ...transfer(id), phase: 'sending' }] }));
    expect(screen.getByText('Posting…')).toBeTruthy(); expect(screen.queryByText('Sent')).toBeNull();
    act(() => app.set({ transfers: [transfer(id, 'done')] }));
    expect(screen.getByText('Sent')).toBeTruthy(); expect(screen.queryByText('Delivered')).toBeNull(); expect(screen.queryByText('Read')).toBeNull();
  });
  it('retains files for Retry and Cancel without another file selection', async () => {
    queueMedia('12', [disk('file.pdf')], {}); await waitFor(() => expect(outgoing.get().jobs[0]?.transferId).toBe('t1'));
    const id = outgoing.get().jobs[0]!.id;
    act(() => app.set({ transfers: [{ ...transfer(id, 'failed'), error: 'File exceeds this channel’s limit.' }] }));
    show(<OutgoingMediaBubbles roomId="12" messages={[]} />);
    expect(screen.getByRole('alert').textContent).toContain('channel');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(net.call).toHaveBeenCalledWith('transfers:retry', { id: 't1' }));
    act(() => app.set({ transfers: [transfer(id)] }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(net.call).toHaveBeenCalledWith('transfers:cancel', { id: 't1' }));
    expect(net.call).not.toHaveBeenCalledWith('files:pickFiles', expect.anything());
  });
  it('cancels preparing media and can retry from the retained prepared handle', async () => {
    const prep = deferred<{ handle: string; name: string; size: number }>();
    net.call.mockImplementation(async (channel: string) => channel === 'transfers:prepareMedia' ? prep.promise : channel === 'transfers:upload' ? [{ id: 't1', state: 'queued' }] : null);
    queueMedia('12', [disk()], {});
    await waitFor(() => expect(net.call).toHaveBeenCalledWith('transfers:prepareMedia', expect.anything()));
    await cancelMedia(outgoing.get().jobs[0]!);
    prep.resolve({ handle: 'h2', name: 'large.mp4', size: 100 });
    await waitFor(() => expect(outgoing.get().jobs[0]?.prepared?.handle).toBe('h2'));
    expect(net.call).not.toHaveBeenCalledWith('transfers:upload', expect.anything());
    await retryMedia(outgoing.get().jobs[0]!);
    await waitFor(() => expect(net.call).toHaveBeenCalledWith('transfers:upload', expect.objectContaining({ handles: ['h2'] })));
  });
  it('keeps an immediate voice preview and sends duration through the durable queue', async () => {
    const blob = new Blob(['voice'], { type: 'audio/webm' }); Object.assign(blob, { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
    queueMedia('12', [{ key: 'voice', kind: 'blob', blob, name: 'voice.webm', state: 'ready', progress: 0, error: null, extra: null }], { voice: true, durationMs: 1500 }, true);
    expect(outgoing.get().jobs[0]!.preview).toBe('blob:preview');
    await waitFor(() => expect(net.call).toHaveBeenCalledWith('transfers:upload', expect.objectContaining({ target: expect.objectContaining({ voice: true, durationMs: 1500 }) })));
  });
  it('survives unmounting, reconstructs pending sends in other windows, and removes confirmed duplicates', async () => {
    const { unmount } = show(<ChatSendingStatus />);
    act(() => queueMedia('12', [disk()], {}));
    await waitFor(() => expect(screen.getByLabelText('Chat sending status')).toBeTruthy());
    unmount(); await waitFor(() => expect(outgoing.get().jobs[0]?.transferId).toBe('t1'));
    const id = outgoing.get().jobs[0]!.id;
    act(() => app.set({ transfers: [transfer(id, 'done')] }));
    const messages = [{ client_message_id: id }] as ChatMessage[];
    show(<OutgoingMediaBubbles roomId="12" messages={messages} />);
    expect(screen.queryByLabelText('Outgoing large.mp4')).toBeNull();
    await waitFor(() => expect(outgoing.get().jobs).toHaveLength(0));
    expect(outgoingForRoom('12', [transfer('desktop-restored')])[0]?.id).toBe('desktop-restored');
  });
  it('never treats 100% bytes as Sent and maps held/offline transfers to queued', () => {
    expect(transferPhase({ ...transfer('desktop-x'), bytes: 100, phase: 'processing' })).toBe('processing');
    expect(transferPhase({ ...transfer('desktop-x'), state: 'queued', held: 'connection' })).toBe('queued');
  });
  it('holds every queued preparation when a chat window closes, including jobs not yet started', async () => {
    const prep = deferred<{ handle: string; name: string; size: number }>();
    net.call.mockImplementation(async (channel: string) => channel === 'transfers:prepareMedia' ? prep.promise : channel === 'transfers:upload' ? [{ id: 't1', state: 'queued' }] : null);
    queueMedia('12', [disk('first.pdf'), disk('second.pdf')], {});
    expect(busySending()).toBeGreaterThanOrEqual(2);
    prep.resolve({ handle: 'h2', name: 'file.pdf', size: 100 });
    await waitFor(() => expect(outgoing.get().jobs.every((j) => j.transferId)).toBe(true));
    await waitFor(() => expect(busySending()).toBe(0));
  });

});

describe('one progress bar across every step', () => {
  it('fills once from Preparing to Posting, never running backwards', async () => {
    const { sendShare } = await import('../../../src/modules/chat/outgoing');
    const steps = [sendShare('preparing', null), sendShare('queued', null), sendShare('uploading', 0), sendShare('uploading', 0.5), sendShare('uploading', 1), sendShare('processing', null), sendShare('sending', null), sendShare('sent', null)].map((s) => s.share);
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    expect(steps.at(-1)).toBe(1);
    // A step with no measure of its own shimmers; the bytes are measured.
    expect(sendShare('processing', null).moving).toBe(false);
    expect(sendShare('uploading', 0.3).moving).toBe(true);
  });
  it('sums the attachments in the corner by size', () => {
    queueMedia('12', [disk('a.pdf'), disk('b.pdf')], {});
    const [a, b] = outgoing.get().jobs;
    act(() => app.set({ transfers: [
      { ...transfer(a!.id), id: 't-a', name: 'a.pdf', bytes: 100, total: 100, phase: 'processing' },
      { ...transfer(b!.id), id: 't-b', name: 'b.pdf', bytes: 0, total: 100, phase: 'uploading' },
    ] }));
    outgoing.set({ jobs: outgoing.get().jobs.map((j, i) => ({ ...j, transferId: i ? 't-b' : 't-a', size: 100 })) });
    show(<ChatSendingStatus />);
    expect(screen.getByLabelText('Chat sending status').textContent).toMatch(/Sending 2 attachments\s*48%/);
  });
});
