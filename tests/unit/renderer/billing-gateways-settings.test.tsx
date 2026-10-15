// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as Bridge from '../../../src/core/bridge';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(), request: vi.fn() }));
vi.mock('../../../src/core/bridge', async (orig) => ({ ...(await orig<typeof Bridge>()), call: vi.fn(async () => true) }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;

const { apiGet, apiPost, apiPut, request } = await import('../../../src/core/api');
const { credentialsPayload, initialCredentials, isMasked, missingFields, secretsPatch } = await import('../../../src/modules/billing/admin');
const { Crm, GatewayForm, Gateways } = await import('../../../src/modules/billing/SettingsNative');

/*
 * Native gateway settings (SRS-BIL-001 G-37, W14): a form built from each
 * gateway's credentials spec, where secrets are WRITE-ONLY. The server sends a
 * masked hint and never the secret; the screen must never put the hint — or
 * anything the server said about a secret — into a box, and must never send
 * a secret back unless something new was typed.
 */
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const STRIPE = {
  key: 'stripe',
  name: 'Stripe',
  countries: ['International'],
  currencies: ['USD', 'EUR'],
  capabilities: { checkout: true, webhook: true, refund: true, tokens: true, surcharge: false },
  credentials_spec: [
    { key: 'publishable_key', label: 'Publishable key', type: 'text' as const, required: true },
    { key: 'secret_key', label: 'Secret key', type: 'secret' as const, required: true },
    { key: 'webhook_secret', label: 'Webhook signing secret', type: 'secret' as const },
    { key: 'statement', label: 'Statement descriptor', type: 'text' as const },
  ],
};
const ACCOUNT = {
  id: 7, gateway: 'stripe', name: 'Stripe — CreativeFX', org_id: 2, enabled: true, mode: 'live' as const,
  // As the server's Accounts::shape answers: `credentials` holds each SECRET's masked hint, `settings` the plain fields.
  credentials: { secret_key: '••••4242', webhook_secret: '••••beef' },
  settings: { publishable_key: 'pk_live_123', statement: 'CREATIVEFX' },
  missing: [],
  webhook_url: 'https://ws.example.com/api/billing/gateway-hook/7',
  last_tested_at: null,
  last_test_ok: null,
};
const HINTS = ['••••4242', '••••beef'];

/** Every value any input on the page holds. */
const inputValues = () => Array.from(document.querySelectorAll('input, textarea')).map((el) => (el as HTMLInputElement).value);

describe('billing: gateway credentials are write-only', () => {
  it('starts every secret empty, whatever the server sent for it', () => {
    const v = initialCredentials(STRIPE.credentials_spec, ACCOUNT);
    expect(v).toEqual({ publishable_key: 'pk_live_123', secret_key: '', webhook_secret: '', statement: 'CREATIVEFX' });
    // A masked hint sent among the plain fields is not taken as a value either.
    expect(initialCredentials([{ key: 'k', label: 'K', type: 'text' }], { settings: { k: '••••9999' } })).toEqual({ k: '' });
    expect(initialCredentials([{ key: 'b', label: 'B', type: 'boolean' }], { settings: { b: '1' } })).toEqual({ b: true });
  });

  it('sends a secret only when something new was typed, never a hint', () => {
    const spec = STRIPE.credentials_spec;
    expect(credentialsPayload(spec, { publishable_key: 'pk', secret_key: '', webhook_secret: '••••beef', statement: '' })).toEqual({ publishable_key: 'pk', statement: '' });
    expect(credentialsPayload(spec, { publishable_key: 'pk', secret_key: '  sk_live_new  ', webhook_secret: '' })).toEqual({ publishable_key: 'pk', secret_key: 'sk_live_new' });
    expect(isMasked('••••4242')).toBe(true);
    expect(isMasked('****4242')).toBe(true);
    expect(isMasked('sk_live')).toBe(false);
    expect(secretsPatch({ api_key: '', signing_secret: '••••ab12' })).toEqual({});
    expect(secretsPatch({ api_key: ' new-key ', signing_secret: '' })).toEqual({ api_key: 'new-key' });
  });

  it('counts a required secret as present when one is stored, or typed', () => {
    expect(missingFields(STRIPE.credentials_spec, { publishable_key: '', secret_key: '' }, null)).toEqual(['Publishable key', 'Secret key']);
    expect(missingFields(STRIPE.credentials_spec, { publishable_key: 'pk', secret_key: '' }, ACCOUNT)).toEqual([]);
    expect(missingFields(STRIPE.credentials_spec, { publishable_key: 'pk', secret_key: '••••4242' }, null)).toEqual(['Secret key']);
    expect(missingFields(STRIPE.credentials_spec, { publishable_key: 'pk', secret_key: '' }, { credentials: { secret_key: null } })).toEqual(['Secret key']);
  });
});

describe('billing: the gateway form', () => {
  it('shows the stored hint beside an empty password box, and saving untouched sends no secret', async () => {
    vi.mocked(apiPut).mockResolvedValue({ account: ACCOUNT });
    wrap(<GatewayForm kind={STRIPE} account={ACCOUNT} orgs={[{ id: 2, name: 'CreativeFX' }]} org="2" onClose={vi.fn()} />);

    const secret = screen.getByLabelText('Secret key') as HTMLInputElement;
    expect(secret.type).toBe('password');
    expect(secret.value).toBe('');
    expect(screen.getByText(/Saved \(••••4242\)/)).toBeTruthy();
    // No hint, anywhere, in any box.
    for (const v of inputValues()) for (const h of HINTS) expect(v).not.toContain(h);
    expect((screen.getByLabelText('Publishable key') as HTMLInputElement).value).toBe('pk_live_123');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    const [path, body] = vi.mocked(apiPut).mock.calls[0]! as [string, { credentials: Record<string, unknown> }];
    expect(path).toBe('/api/billing/gateways/7');
    expect(body.credentials).toEqual({ publishable_key: 'pk_live_123', statement: 'CREATIVEFX' });
    expect(JSON.stringify(body)).not.toMatch(/••••|secret_key|webhook_secret/);
  });

  it('sends a newly typed secret, and only that one', async () => {
    vi.mocked(apiPut).mockResolvedValue({ account: ACCOUNT });
    wrap(<GatewayForm kind={STRIPE} account={ACCOUNT} orgs={[]} org="" onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Secret key'), { target: { value: 'sk_live_rotated' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    const body = vi.mocked(apiPut).mock.calls[0]![1] as { credentials: Record<string, unknown>; mode: string };
    expect(body.credentials.secret_key).toBe('sk_live_rotated');
    expect(body.credentials).not.toHaveProperty('webhook_secret');
    expect(body.mode).toBe('live');
  });

  it('will not connect a new account until its required secret is typed', async () => {
    vi.mocked(apiPost).mockResolvedValue({ account: { ...ACCOUNT, id: 9 } });
    wrap(<GatewayForm kind={STRIPE} account={null} orgs={[]} org="" onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Publishable key'), { target: { value: 'pk_test_1' } });
    expect(screen.getByRole('button', { name: 'Connect' })).toHaveProperty('disabled', true);
    expect(screen.getByText(/Still needed: Secret key/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Secret key'), { target: { value: 'sk_test_1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/billing/gateways', expect.objectContaining({ gateway: 'stripe', mode: 'test', credentials: expect.objectContaining({ secret_key: 'sk_test_1', publishable_key: 'pk_test_1' }) })));
  });
});

describe('billing: the gateways section', () => {
  it('lists the catalogue with each company’s accounts, tests one, and never shows a secret', async () => {
    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path === '/api/billing/gateways/catalogue') return { gateways: [STRIPE, { key: 'payhere', name: 'PayHere', countries: ['Sri Lanka'], currencies: ['LKR'], capabilities: { checkout: true, tokens: true }, credentialsSpec: [{ key: 'merchant_id', label: 'Merchant ID', type: 'text' }] }] };
      // The legacy route: its verification keys as `gateways`, the accounts beside them.
      if (path === '/api/billing/gateways') return { gateways: { stripe: { configured: true } }, accounts: [ACCOUNT] };
      if (path === '/api/billing/gateways/settings') return { auto_link: true, print_qr: true, allow_partial: true, expiry_days: 30, surcharge_pct: 0, surcharge_fixed: 0, lankaqr_merchant_id: '', save_cards: true, post_fees: true };
      throw new Error(`unexpected ${path}`);
    });
    vi.mocked(request).mockResolvedValue({ data: { ok: false, message: 'The secret key was refused.', account: ACCOUNT }, offline: false, cachedAt: null, message: 'The secret key was refused.' });
    wrap(<Gateways may org="2" orgs={[{ id: 2, name: 'CreativeFX' }]} />);

    const stripe = await screen.findByText('Stripe');
    expect(apiGet).toHaveBeenCalledWith('/api/billing/gateways', { org_id: '2' }, expect.any(AbortSignal));
    expect(await screen.findByText('Pay-link options')).toBeTruthy();
    const card = stripe.closest('[data-gateway]') as HTMLElement;
    expect(within(card).getByText('Connected')).toBeTruthy();
    expect(within(card).getByText('Saved cards')).toBeTruthy();
    const payhere = screen.getByText('PayHere').closest('[data-gateway]') as HTMLElement;
    expect(within(payhere).getByText('Not connected')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/••••4242|••••beef|sk_live/);

    fireEvent.click(within(card).getByRole('button', { name: 'Test' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/billing/gateways/7/test', { body: {} }));
    expect(await within(card).findByText('The secret key was refused.')).toBeTruthy();

    // Manage opens the form with the secret boxes empty.
    fireEvent.click(within(card).getByRole('button', { name: 'Manage' }));
    expect(((await screen.findByLabelText('Secret key')) as HTMLInputElement).value).toBe('');
    for (const v of inputValues()) for (const h of HINTS) expect(v).not.toContain(h);
  });

  it('keeps a CRM connection’s API key out of the form, and leaves it alone when not retyped', async () => {
    vi.mocked(apiGet).mockResolvedValue({
      connections: [{ id: 3, name: 'Perfex', url: 'https://crm.example.com', org_id: null, enabled: true, auto_apply: false, configured: true, key_hint: '••••a1b2', secret_hint: null, signing_set: false, delivery_url: 'https://ws.example.com/api/crm/hook/3', api_base: '', last_sync_at: null, last_seen_at: null }],
    });
    vi.mocked(request).mockResolvedValue({ data: { connection: {} }, offline: false, cachedAt: null, message: 'Saved.' });
    wrap(<Crm may orgs={[]} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Manage' }));
    expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe('');
    expect(screen.getByText(/Saved \(••••a1b2\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('PUT', '/api/billing/crm/connections/3', expect.anything()));
    const body = vi.mocked(request).mock.calls[0]![2]!.body as Record<string, unknown>;
    expect(body).not.toHaveProperty('api_key');
    expect(body).not.toHaveProperty('signing_secret');
    expect(body).toMatchObject({ enabled: true, auto_apply: false, name: 'Perfex' });
  });
});
