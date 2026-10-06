// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Visit } from '../../../src/modules/salon/api';
import { DeskContext, type Desk } from '../../../src/modules/salon/parts';
import { SendReceipt } from '../../../src/modules/salon/SendReceipt';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const visit = {
  id: 63,
  number: 'GBL-APT-011563',
  client: { id: 106, name: 'Rukshana Farook', phone: '+94771234567', tier: null, reliability: 'reliable', allergy: null },
} as unknown as Visit;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function server(quiet: boolean) {
  const posts: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') return json(200, { status: 'success', data: { client: { id: 106, name: 'Rukshana Farook', email: 'rukshana@example.com', phone: null, mobile: '+94771234567' } } });
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      posts.push({ url, ...body });
      if (quiet && !body.anyway) return json(409, { status: 'error', message: 'Rukshana Farook asked not to get messages.', errors: { code: 'no_messages' } });
      return json(200, { status: 'success', data: { to: body.to }, message: `Receipt sent to ${String(body.to)}.` });
    }),
  );
  return posts;
}

function dialog(channel: 'whatsapp' | 'email') {
  const onSent = vi.fn();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DeskContext.Provider value={{ may: () => true, desk: { id: 1 }, offline: false } as unknown as Desk}>
        <SendReceipt visit={visit} channel={channel} onClose={onClose} onSent={onSent} />
      </DeskContext.Provider>
    </QueryClientProvider>,
  );
  return { onSent, onClose };
}

describe('the receipt to the client (D07)', () => {
  it('goes to the address on file, by the channel chosen', async () => {
    const posts = server(false);
    const { onSent } = dialog('email');
    await waitFor(() => expect((screen.getByLabelText('Email address') as HTMLInputElement).value).toBe('rukshana@example.com'));

    fireEvent.click(screen.getByRole('button', { name: /Send by email/ }));
    await waitFor(() => expect(onSent).toHaveBeenCalledWith('Receipt sent to rukshana@example.com.'));
    expect(posts[0]).toMatchObject({ url: expect.stringContaining('/visits/63/receipt/send') as string, channel: 'email', to: 'rukshana@example.com', desk: 1 });
  });

  it('to a client who asked for no messages, only when they ask for this one', async () => {
    const posts = server(true);
    const { onSent } = dialog('whatsapp');
    await waitFor(() => expect((screen.getByLabelText('Mobile') as HTMLInputElement).value).toBe('+94771234567'));

    fireEvent.click(screen.getByRole('button', { name: /Send by WhatsApp/ }));
    await screen.findByText('Rukshana Farook asked not to get messages.');
    expect(onSent).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Mobile'), { target: { value: '0779998887' } });
    fireEvent.click(screen.getByRole('button', { name: /They asked for it — send/ }));
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    expect(posts[1]).toMatchObject({ channel: 'whatsapp', to: '0779998887', anyway: true });
  });
});
