// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * Send a contact form (server Communication 1.58.0): the agent picks what to ask for and the visitor fills it in in the
 * chat; while it waits the thread says so, with Withdraw.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiPost: vi.fn(async () => ({})), apiDelete: vi.fn(async () => ({})) }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => []), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import { apiDelete, apiPost } from '../../../src/core/api';
import { ContactFormButton, ContactFormWaiting } from '../../../src/modules/chat/website/ContactForm';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Send a contact form', () => {
  it('sends the fields picked and the message', async () => {
    const done = vi.fn();
    render(<ContactFormButton conversationId={41} waiting={false} onDone={done} />);
    fireEvent.click(screen.getByRole('button', { name: /Contact form/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Phone number' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Company' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send form' }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(apiPost).toHaveBeenCalledWith('/api/chat/widget-admin/conversations/41/contact-form', {
      fields: ['name', 'email', 'company'],
      message: 'Could you share your contact details below? We will use them to follow up with you.',
    });
  });

  it('is not offered again while one waits, and the waiting line withdraws it', async () => {
    render(<ContactFormButton conversationId={41} waiting onDone={vi.fn()} />);
    expect((screen.getByRole('button', { name: /Contact form/ }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();

    const done = vi.fn();
    render(<ContactFormWaiting conversationId={41} onDone={done} form={{ asked_at: '2026-10-08 10:00:00', asked_by: 'Nuwan', fields: ['name', 'phone'], open: true, done_at: null, outcome: null }} />);
    expect(screen.getByRole('status').textContent).toBe("Waiting for the visitor's contact details (name, phone number) · sent by NuwanWithdraw");
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(apiDelete).toHaveBeenCalledWith('/api/chat/widget-admin/conversations/41/contact-form');
  });
});
