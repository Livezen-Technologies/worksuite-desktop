// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, hasDesktop: () => true }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
// Pictures are read with the browser's canvas, which jsdom does not have.
vi.mock('../../../src/modules/mail/editor/images', async (orig) => ({ ...(await orig<Record<string, unknown>>()), darkModeRiskOf: vi.fn(async () => false), prepareImage: vi.fn(async () => ({ src: 'data:image/png;base64,iVBORw0KGgo=', width: 120, height: 40, bytes: 8, shrunk: false })) }));

import { ApiError, apiDelete, apiGet, apiPost, apiPut } from '../../../src/core/api';
import { Signatures } from '../../../src/modules/mail/signatures/SignaturesSettings';

/**
 * Settings › Mail › Signatures (worksuite-desktop#166): the list with
 * previews and actions, organisation signatures that people cannot change,
 * the template gallery, the editor's Save and unsaved-changes rules, the
 * HTML source view, and the details the fields are filled from.
 */

const BOXES = [
  { id: 4, email: 'me@livezen.lk', display_name: 'Me', is_default: true, colour: 'blue', auth_state: 'ok' },
  { id: 7, email: 'sales@livezen.lk', display_name: 'Sales', is_default: false, colour: 'teal', auth_state: 'ok' },
];
const VALUES = { name: 'Asha Perera', job_title: 'Engineer', company: 'Livezen', email: 'asha@livezen.lk', phone: '+94 11 234 5678', company_logo: 'https://ws.example/s/logo?inline=1', brand_colour: '#AA2200' };
const DATA = {
  signatures: [
    { id: 1, name: 'Work', html: '<div>{name}</div><div>{job_title}</div>', is_default: true, scope: 'personal', locked: false, editable: true, image_mode: 'hosted' },
    { id: 9, name: 'Livezen standard', html: '<div>{name} · {company}</div>', is_default: false, scope: 'company', locked: true, editable: false },
  ],
  settings: [
    { mailbox: null, new_id: 1, reply_id: 1, placement: 'above_quote' },
    { mailbox: 7, new_id: 9, reply_id: null, placement: 'below_quote' },
  ],
  templates: [{ id: 3, name: 'My old one', html: '<div>{name}</div>', scope: 'personal', editable: true }],
  values: VALUES,
  details: {},
  assets: { social_base: 'https://ws.example/mail-assets/social/', social: [] },
  can_manage_company: false,
};

const wrap = (node: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);

beforeEach(() => {
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
    if (path === '/api/mail/signatures') return DATA;
    if (path === '/api/mail/mailboxes') return { mailboxes: BOXES };
    throw new ApiError(404, path, null);
  }) as never);
  vi.mocked(apiPost).mockReset().mockResolvedValue({ id: 5 } as never);
  vi.mocked(apiPut).mockReset().mockResolvedValue({} as never);
  vi.mocked(apiDelete).mockReset().mockResolvedValue({} as never);
  Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => true) });
});
afterEach(cleanup);

describe('the signatures list', () => {
  it('shows each signature with a preview, the accounts it is the default for and its actions', async () => {
    wrap(<Signatures />);
    const list = within(await screen.findByRole('list', { name: 'Your signatures' }));
    const [work, org] = list.getAllByRole('listitem');
    expect(within(work!).getByTitle('Work').getAttribute('srcdoc')).toContain('Asha Perera');
    await waitFor(() => expect(within(work!).getByText('Default for Every account')).toBeTruthy());
    expect(within(org!).getByText('Default for sales@livezen.lk (new mail)')).toBeTruthy();
    expect(within(org!).getByText('Organisation · locked')).toBeTruthy();
    // People use their organisation's signature; they do not change, copy or delete it.
    expect(within(org!).getByRole('button', { name: 'View' })).toBeTruthy();
    expect(within(org!).queryByRole('button', { name: /Delete|Duplicate/ })).toBeNull();
    fireEvent.click(within(work!).getByRole('button', { name: 'Duplicate Work' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/signatures/1/duplicate'));
    fireEvent.click(within(org!).getByRole('button', { name: 'Set Livezen standard as default' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/signatures/9/default'));
    fireEvent.click(within(work!).getByRole('button', { name: 'Delete Work' }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/api/mail/signatures/1'));
  });

  it('sets where the signature goes in a reply, per account', async () => {
    wrap(<Signatures />);
    fireEvent.click(await screen.findByRole('combobox', { name: 'Where it goes in a reply for me@livezen.lk' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Below the quoted message' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/mail/signature-settings', { mailbox: 4, new_id: 1, reply_id: 1, placement: 'below_quote' }));
    // An account with its own choice can go back to the one for every account.
    fireEvent.click(screen.getByRole('button', { name: 'Use every-account choice' }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/api/mail/signature-settings/7'));
  });

  it('saves the details the fields are filled from', async () => {
    wrap(<Signatures />);
    const details = within(await screen.findByRole('region', { name: 'Your details' }));
    const save = details.getByRole('button', { name: 'Save my details' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(details.getByLabelText('Mobile'), { target: { value: '+94 77 123 4567' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/mail/signature-details', { values: expect.objectContaining({ mobile: '+94 77 123 4567' }) }));
  });
});

describe('making and editing a signature', () => {
  it('starts from a template, filled with their details and the company’s colour and logo, and saves it', async () => {
    wrap(<Signatures />);
    fireEvent.click(await screen.findByRole('button', { name: 'New signature' }));
    const gallery = within(await screen.findByRole('dialog'));
    for (const name of ['Simple', 'Classic with logo', 'Photo card', 'Corporate banner', 'Minimal line', 'Social', 'Bilingual', 'Legal footer', 'My old one']) expect(gallery.getByRole('button', { name: `Use ${name}` })).toBeTruthy();
    fireEvent.click(gallery.getByRole('button', { name: 'Use Classic with logo' }));
    const editor = within(await screen.findByRole('dialog', { name: 'New signature' }));
    expect(editor.getByRole('textbox', { name: 'Signature' }).innerHTML).toContain('Asha Perera');
    expect(editor.getByTitle('Signature preview').getAttribute('srcdoc')).toContain('https://ws.example/s/logo?inline=1');
    // The smaller toolbar: no headings, lists or AI here.
    expect(editor.queryByRole('button', { name: /Paragraph style|Bulleted list|Write with AI/ })).toBeNull();
    expect(editor.getByRole('button', { name: /Insert a field/ })).toBeTruthy();
    const save = editor.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        '/api/mail/signatures',
        expect.objectContaining({ name: 'Classic with logo signature', image_mode: 'hosted', dark_logo: null, html: expect.stringMatching(/<table border="0" cellpadding="0" cellspacing="0"[^>]*>.*#AA2200.*Asha Perera/), text: expect.stringContaining('Asha Perera') }),
      ),
    );
  });

  it('turns Save on once there is something to save', async () => {
    wrap(<Signatures />);
    fireEvent.click(await screen.findByRole('button', { name: 'New signature' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Blank/ }));
    const editor = within(await screen.findByRole('dialog', { name: 'New signature' }));
    const save = editor.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    const box = editor.getByRole('textbox', { name: 'Signature' });
    box.innerHTML = '<div>Asha</div>';
    fireEvent.input(box);
    expect(save.disabled).toBe(false);
  });

  it('asks before closing with changes, and only saves an existing one once changed', async () => {
    wrap(<Signatures />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const editor = within(await screen.findByRole('dialog', { name: 'Edit signature' }));
    expect((editor.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    // Unchanged: Cancel just closes.
    fireEvent.click(editor.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const again = within(await screen.findByRole('dialog', { name: 'Edit signature' }));
    fireEvent.change(again.getByLabelText('Name'), { target: { value: 'Work (long)' } });
    expect((again.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(again.getByRole('button', { name: 'Cancel' }));
    const ask = within(await screen.findByRole('dialog', { name: 'Discard your changes?' }));
    fireEvent.click(ask.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('dialog', { name: 'Edit signature' })).toBeTruthy();
    fireEvent.click(again.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/mail/signatures/1', expect.objectContaining({ name: 'Work (long)', html: '<div>{name}</div><div>{job_title}</div>' })));
  });

  it('takes a pasted HTML signature through the source view, cleaned', async () => {
    wrap(<Signatures />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const editor = within(await screen.findByRole('dialog', { name: 'Edit signature' }));
    fireEvent.click(editor.getByRole('button', { name: 'HTML source' }));
    fireEvent.change(editor.getByLabelText('HTML source'), { target: { value: '<div class="sig" onclick="steal()" style="color: #003366">Pasted <a href="tel:+94771234567">call</a><script>alert(1)</script></div>' } });
    fireEvent.click(editor.getByRole('button', { name: 'Editor' }));
    const html = editor.getByRole('textbox', { name: 'Signature' }).innerHTML;
    expect(html).toBe('<div style="color: #003366">Pasted <a href="tel:+94771234567">call</a></div>');
  });

  it('adds a social icon linked to the address they give', async () => {
    wrap(<Signatures />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const editor = within(await screen.findByRole('dialog', { name: 'Edit signature' }));
    fireEvent.click(editor.getByRole('button', { name: /Social icon/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'LinkedIn' }));
    fireEvent.change(editor.getByLabelText('LinkedIn address'), { target: { value: 'linkedin.com/in/asha' } });
    fireEvent.click(editor.getByRole('button', { name: 'Add icon' }));
    expect(document.execCommand).toHaveBeenCalledWith('insertHTML', false, expect.stringContaining('<a href="https://linkedin.com/in/asha"><img src="https://ws.example/mail-assets/social/linkedin.png" alt="LinkedIn" width="24" height="24"'));
  });
});
