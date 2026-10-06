// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * Help & Guide › Contact Support, D-11 (desktop T29; FR-DSK-09, FR-SEC-05, FR-DSK-06/07): a real ticket with its
 * reference; diagnostics the person sees and can untick (version, OS, screen, the last day's redacted log); the
 * window's picture; the exact payload; offline into the outbox; My requests.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiPost: vi.fn(), request: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, errorMessage: (e: unknown) => String(e), hasDesktop: () => true, isMac: false }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const tabs = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('../../../src/core/tabs', async (orig) => ({ ...(await orig<object>()), navigate: tabs.navigate }));
vi.mock('../../../src/core/access', async (orig) => ({ ...(await orig<object>()), canOpen: (id: string) => id === 'support' }));

const { ApiError, apiPost, request } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { app } = await import('../../../src/core/app-state');
const { SupportDialog, MyRequests, mergeRequests, noteMyRequest, readMyRequests, requestPayload, requestForm } = await import('../../../src/modules/ai/help/ContactSupport');

const LOG = { text: '{"t":"2026-10-06T09:00:00Z","msg":"sync"}', lines: 1, bytes: 42 };
let bridge: Array<{ channel: string; input: unknown }>;
beforeEach(() => {
  localStorage.clear();
  bridge = [];
  tabs.navigate.mockReset();
  vi.mocked(apiPost).mockReset();
  vi.mocked(request).mockReset();
  vi.mocked(request).mockRejectedValue(new ApiError(403, 'No', null));
  vi.mocked(call).mockImplementation((async (channel: string, input: unknown) => {
    bridge.push({ channel, input });
    if (channel === 'help:logs') return LOG;
    if (channel === 'help:capture') return { name: 'window-capture.png', data: btoa('PNGDATA'), width: 10, height: 10 };
    if (channel === 'offline:submit') return { queued: true, delivered: false };
    return undefined;
  }) as never);
  app.set({ info: { version: '0.2.190', platform: 'darwin', arch: 'arm64', osVersion: '15.6', channel: 'stable' }, auth: { stage: 'ready', user: { id: '7', email: 'ayesha@cfx.lk', name: 'Ayesha' } } } as never);
});
afterEach(cleanup);

describe('the pieces', () => {
  it('builds the payload from what is ticked, the log inside the message', () => {
    const base = { type: 'feature' as const, subject: 'Dark tray', body: 'Please.', include: { version: true, os: false, screen: false, logs: true }, info: { version: '1', platform: 'darwin', arch: 'arm64', osVersion: '15' }, screen: '/x', language: 'English', logs: 'LOG' };
    const p = requestPayload(base);
    expect(p).toEqual({ kind: 'support', subject: 'Feature request: Dark tray', body: 'Please.\n\n— Recent log (last 24 h, redacted) —\nLOG', details: { version: '1', platform: 'darwin arm64', os: null, screen: null, language: 'English' } });
    expect(requestPayload({ ...base, type: 'problem' }).kind).toBe('issue');
    const form = requestForm(p, { name: 'c.png', blob: new Blob(['x']) });
    expect(form.get('details[version]')).toBe('1');
    expect(form.get('details[os]')).toBeNull();
    expect((form.get('files[]') as File).name).toBe('c.png');
  });

  it('remembers my requests per person, and merges the desk’s copies with their status', () => {
    noteMyRequest('7', { id: 5, reference: 'LZ-5', subject: 'One', at: '2026-10-05T10:00:00Z' });
    noteMyRequest('7', { id: 6, reference: 'LZ-6', subject: 'Two', at: '2026-10-06T10:00:00Z' });
    expect(readMyRequests('7').map((r) => r.reference)).toEqual(['LZ-6', 'LZ-5']);
    expect(readMyRequests('8')).toEqual([]);
    const merged = mergeRequests(readMyRequests('7'), [{ id: 5, reference: 'LZ-5', subject: 'One', status: 'resolved', created_at: '2026-10-05T10:00:00Z' } as never]);
    expect(merged.map((r) => [r.reference, r.status])).toEqual([['LZ-6', null], ['LZ-5', 'resolved']]);
  });
});

describe('the dialog', () => {
  it('shows the diagnostics, lets them be left out, and sends a real ticket whose reference it shows', async () => {
    vi.mocked(apiPost).mockResolvedValue({ id: 214, reference: 'LZ-000214' } as never);
    render(<SupportDialog kind="issue" screen="/support" onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/What happened/), { target: { value: 'Badge does not clear.' } });
    const logs = await screen.findByRole('checkbox', { name: /log of the last 24 h/ });
    fireEvent.click(logs);
    fireEvent.click(screen.getByRole('checkbox', { name: /operating system/ }));
    expect(screen.getByText('View exact payload').closest('details')!.textContent).toContain('Recent log');
    expect(apiPost).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect((await screen.findByRole('status')).textContent).toContain('LZ-000214');
    const body = vi.mocked(apiPost).mock.calls[0]![1] as { kind: string; body: string; details: Record<string, unknown> };
    expect(body.kind).toBe('issue');
    expect(body.body).toContain('"msg":"sync"');
    expect(body.details).toMatchObject({ version: '0.2.190', os: null, screen: '/support' });
    expect(readMyRequests('7')[0]).toMatchObject({ id: 214, reference: 'LZ-000214' });
    fireEvent.click(screen.getByRole('button', { name: 'Open the ticket' }));
    expect(tabs.navigate).toHaveBeenCalledWith('/support/ticket/214');
  });

  it('captures the window as an attachment sent with the request, and says when the server did not keep it', async () => {
    vi.mocked(request).mockImplementation((async (method: string, path: string) => {
      if (method === 'POST' && path === '/api/desktop/support') return { data: { id: 9, reference: 'LZ-9' }, offline: false };
      throw new ApiError(403, 'No', null);
    }) as never);
    render(<SupportDialog kind="support" screen={null} onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText('How can we help?'), { target: { value: 'Help' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Capture this window' }));
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(await screen.findByText('window-capture.png')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect((await screen.findByRole('status')).textContent).toContain('LZ-9');
    const sent = vi.mocked(request).mock.calls.find((c) => c[0] === 'POST')!;
    expect((sent[2] as { body: FormData }).body.get('files[]')).toBeTruthy();
    expect(screen.getByText(/did not keep the window capture/)).toBeTruthy();
  });

  it('offline, puts the request in the outbox instead of offering text to copy', async () => {
    vi.mocked(apiPost).mockRejectedValue(new ApiError(0, 'Offline', 'NETWORK_UNREACHABLE'));
    render(<SupportDialog kind="support" screen={null} onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText('How can we help?'), { target: { value: 'Help' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect((await screen.findByRole('status')).textContent).toContain('outbox');
    expect(bridge.find((b) => b.channel === 'offline:submit')!.input).toMatchObject({ module: 'ai', method: 'POST', path: '/api/desktop/support', queueIfOffline: true });
    expect(readMyRequests('7')[0]).toMatchObject({ queued: true, reference: null });
  });

  it('a refusal (too many an hour) stays in the dialog with its words', async () => {
    vi.mocked(apiPost).mockRejectedValue(new ApiError(429, 'You have sent a lot of requests in the last hour.', null));
    render(<SupportDialog kind="support" screen={null} onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText('How can we help?'), { target: { value: 'Help' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect((await screen.findByRole('alert')).textContent).toContain('a lot of requests');
  });
});

describe('My requests', () => {
  it('lists mine with the desk’s status, and opens one I can read', async () => {
    noteMyRequest('7', { id: 5, reference: 'LZ-5', subject: 'Mail sync slow', at: '2026-10-05T10:00:00Z' });
    vi.mocked(request).mockResolvedValue({ data: { items: [{ id: 5, reference: 'LZ-5', subject: 'Mail sync slow', status: 'resolved', created_at: '2026-10-05T10:00:00Z', requester: { email: 'Ayesha@cfx.lk' } }, { id: 8, reference: 'LZ-8', subject: 'Not mine', status: 'open', created_at: null, requester: { email: 'x@y' } }] }, offline: false } as never);
    render(<MyRequests />);
    const list = await screen.findByRole('region', { name: 'My requests' });
    await waitFor(() => expect(within(list).getByText('Resolved')).toBeTruthy());
    expect(within(list).queryByText('Not mine')).toBeNull();
    expect(vi.mocked(request).mock.calls[0]![2]).toMatchObject({ query: { view: 'all', source: 'desktop', q: 'ayesha@cfx.lk' } });
    fireEvent.click(within(list).getByText('Mail sync slow'));
    expect(tabs.navigate).toHaveBeenCalledWith('/support/ticket/5');
  });
});
