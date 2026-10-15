// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as Bridge from '../../../src/core/bridge';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(), request: vi.fn() }));
vi.mock('../../../src/core/bridge', async (orig) => ({ ...(await orig<typeof Bridge>()), call: vi.fn(async () => true) }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;

const { apiGet, apiPost, request } = await import('../../../src/core/api');
const { toast } = await import('../../../src/core/toasts');
const { default: SendDialog, defaultMessage } = await import('../../../src/modules/billing/SendDialog');
const { isEmail, sendOutcome, sendProblem, splitAddresses } = await import('../../../src/modules/billing/actions');

/*
 * The Send dialog (W12, SRS-BIL-001 G-05): to and cc, a template, subject and
 * message, the PDF, a pay link and WhatsApp; the server's preview drawn in a
 * sandbox; and the send's answer — which channels went, and its warnings.
 */
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const inv = {
  id: 361, number: 'INV-00361', client: 'Green Leaf Hotels', client_email: 'ap@greenleaf.lk', contact_email: null, client_phone: '+94 77 123 4567',
  currency: 'LKR', due: 171000, total: 342000, due_date: '2026-08-10', status: 'overdue',
} as never;

describe('billing: the send dialog in words', () => {
  it('splits addresses on commas, semicolons and spaces, each once', () => {
    expect(splitAddresses('a@x.lk, b@y.lk;  A@x.lk c@z.lk')).toEqual(['a@x.lk', 'b@y.lk', 'c@z.lk']);
    expect(splitAddresses('  ')).toEqual([]);
    expect(isEmail('ap@greenleaf.lk')).toBe(true);
    expect(isEmail('ap@greenleaf')).toBe(false);
  });

  it('says what stops a send before it goes', () => {
    expect(sendProblem({ to: [], cc: [], subject: 'x', whatsapp: false })).toMatch(/at least one address/);
    expect(sendProblem({ to: [], cc: [], subject: '', whatsapp: true })).toBeNull();
    expect(sendProblem({ to: ['nope'], cc: [], subject: 'x', whatsapp: false })).toMatch(/“nope” is not an email address/);
    expect(sendProblem({ to: ['a@x.lk'], cc: ['bad@'], subject: 'x', whatsapp: false })).toMatch(/bad@/);
    expect(sendProblem({ to: ['a@x.lk'], cc: [], subject: ' ', whatsapp: false })).toMatch(/subject/);
    expect(sendProblem({ to: ['a@x.lk'], cc: [], subject: 'Invoice', whatsapp: false })).toBeNull();
  });

  it('reads the server’s answer: by which channels it went, and nothing sent is an error', () => {
    expect(sendOutcome({ sent: { email: true, whatsapp: true }, warnings: [] })).toEqual({ ok: true, text: 'Sent by email and WhatsApp.', warnings: [] });
    expect(sendOutcome({ sent: { email: true, whatsapp: false }, warnings: ['WhatsApp is not installed.'] }).warnings).toEqual(['WhatsApp is not installed.']);
    expect(sendOutcome({ sent: { email: false, whatsapp: false }, warnings: [] }).ok).toBe(false);
  });

  it('starts the message with the customer, the number and what is owed', () => {
    const m = defaultMessage({ client: 'Green Leaf Hotels', number: 'INV-00361', id: 361, due: 171000, currency: 'LKR', due_date: '2026-08-10' });
    expect(m).toContain('Dear Green Leaf Hotels');
    expect(m).toContain('INV-00361');
    expect(m).toContain('LKR 171,000.00 is outstanding');
  });
});

describe('billing: the send dialog', () => {
  it('starts from the customer’s address, previews in a sandbox, and sends what was chosen', async () => {
    vi.mocked(apiGet).mockResolvedValue({ templates: [{ id: 4, kind: 'invoice', name: 'Invoice — friendly', subject: 'Your invoice {number}', body: 'Hello {customer}', is_default: true }] });
    vi.mocked(apiPost).mockResolvedValue({ subject: 'Invoice INV-00361', html: '<p>Dear Green Leaf Hotels team</p><script>alert(1)</script>' });
    vi.mocked(request).mockResolvedValue({ data: { sent: { email: true, whatsapp: true }, warnings: ['The PDF was sent without the statement.'] }, offline: false, cachedAt: null, message: null });
    const onClose = vi.fn();
    wrap(<SendDialog inv={inv} org="2" onClose={onClose} />);

    expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('ap@greenleaf.lk');
    // The server's preview, a moment after the words settle, drawn with no scripts allowed.
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/billing/invoices/361/send-preview', expect.objectContaining({ attach_pdf: true, include_pay_link: true, whatsapp: false })), { timeout: 2000 });
    const frame = await screen.findByTitle('Email preview');
    expect(frame.getAttribute('sandbox')).toBe('');
    await waitFor(() => expect(frame.getAttribute('srcdoc')).toContain('Green Leaf Hotels team'));

    fireEvent.change(screen.getByLabelText('Cc'), { target: { value: 'finance@greenleaf.lk, finance@greenleaf.lk' } });
    fireEvent.click(screen.getByText('Also send by WhatsApp'));
    fireEvent.click(screen.getByText('Attach the invoice PDF'));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/billing/invoices/361/send', expect.anything()));
    const body = vi.mocked(request).mock.calls[0]![2]!.body as Record<string, unknown>;
    expect(body).toMatchObject({ to: ['ap@greenleaf.lk'], cc: ['finance@greenleaf.lk'], attach_pdf: false, include_pay_link: true, whatsapp: true, subject: 'Invoice INV-00361', template_id: null });
    expect(String(body.message)).toContain('INV-00361');
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
    expect(toast).toHaveBeenCalledWith('success', 'Sent by email and WhatsApp.');
    expect(toast).toHaveBeenCalledWith('error', 'The PDF was sent without the statement.');
  });

  it('will not send to a word that is not an address, and says why', async () => {
    vi.mocked(apiGet).mockResolvedValue({ templates: [] });
    vi.mocked(apiPost).mockResolvedValue({ subject: 's', html: '' });
    wrap(<SendDialog inv={inv} org="" onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('To'), { target: { value: 'accounts at greenleaf' } });
    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', true);
    expect(screen.getByText(/“accounts” is not an email address/)).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
  });

  it('keeps the dialog open when nothing went, with the server’s words', async () => {
    vi.mocked(apiGet).mockResolvedValue({ templates: [] });
    vi.mocked(apiPost).mockResolvedValue({ subject: 's', html: '' });
    vi.mocked(request).mockResolvedValue({ data: { sent: { email: false, whatsapp: false }, warnings: ['The mail server refused it.'] }, offline: false, cachedAt: null, message: null });
    const onClose = vi.fn();
    wrap(<SendDialog inv={inv} org="" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('error', 'The mail server refused it.'));
    expect(toast).toHaveBeenCalledWith('error', 'Nothing was sent.');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('fills subject and message from a chosen template, and sends its id', async () => {
    vi.mocked(apiGet).mockResolvedValue({ templates: [{ id: 4, kind: 'invoice', name: 'Invoice — friendly', subject: 'Your invoice {number}', body: 'Hello {customer}' }] });
    vi.mocked(apiPost).mockResolvedValue({ subject: 's', html: '' });
    vi.mocked(request).mockResolvedValue({ data: { sent: { email: true, whatsapp: false }, warnings: [] }, offline: false, cachedAt: null, message: 'Sent to ap@greenleaf.lk.' });
    wrap(<SendDialog inv={inv} org="2" onClose={vi.fn()} />);
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/billing/message-templates', { org: '2', kind: 'invoice' }, expect.any(AbortSignal)));
    fireEvent.click(screen.getByLabelText('Template'));
    fireEvent.click(await screen.findByText('Invoice — friendly'));
    expect((screen.getByLabelText('Subject') as HTMLInputElement).value).toBe('Your invoice {number}');
    expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('Hello {customer}');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(request).toHaveBeenCalled());
    expect((vi.mocked(request).mock.calls[0]![2]!.body as { template_id: number }).template_id).toBe(4);
    expect(toast).toHaveBeenCalledWith('success', 'Sent to ap@greenleaf.lk.');
  });
});
