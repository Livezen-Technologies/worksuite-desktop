// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({})), apiPut: vi.fn(async () => ({})), apiDelete: vi.fn(async () => ({})) }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: Error) => e.message, isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/access', () => ({ useCanOpen: () => true, useVisibleIds: () => new Set(['chat', 'drive', 'files']) }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
import { apiGet, apiPost, apiPut } from '../../../src/core/api';
import { toast } from '../../../src/core/toasts';
import { ShareDialog } from '../../../src/modules/files/Share';

const access = (over: Record<string, unknown> = {}) => ({
  item: { type: 'folder', id: 9, name: 'CareMe', owner: { id: 1, name: 'Hasarinda Manjula', detail: 'hasarinda@livezentech.com' }, company: { id: 1, name: 'Livezen Technologies' }, inherits: true, shareable: true },
  my_access: { level: 'full', owner: true, capabilities: ['share', 'chat_share'], reason: null },
  may: { share: true, manage: true },
  grants: [{ id: 41, principal: { type: 'user', id: 2, name: 'Dimuthu Anuraj', detail: 'dimuthu@livezentech.com' }, level: 'full', effect: 'allow', can_download: true, expires_at: null, editable: true }],
  inherited: [],
  public_links: { active: 0, shares: 0, download_links: 0, protected: 0, never_expire: 0, next_expiry: null },
  notify_defaults: { chat: true, email: true },
  general: { access: 'restricted', level: null, grant_id: null },
  levels: ['view', 'comment', 'edit', 'full'],
  ...over,
});

const found = {
  results: [
    { type: 'user', id: 5, name: 'Chamudi Gayeshika', detail: 'chamudi@livezentech.com · Sales', kind: 'Person', can_share: true, why: null },
    { type: 'user', id: 6, name: 'Chamudi Gayeshika', detail: 'Payroll record · no WorkSuite sign-in', kind: 'Person', can_share: false, why: 'Can’t share' },
    { type: 'user', id: 7, name: 'Danindu Chamoth Dampathi', detail: 'danindu@livezentech.com · Support', kind: 'Person', can_share: true, why: null },
    { type: 'group', id: 8, name: 'Chamber team', detail: 'Team · 4 people', kind: 'Team', can_share: true, why: null },
  ],
  shareable: true,
};

let info: ReturnType<typeof access>;
const handlers = { onClose: vi.fn(), onSecureLink: vi.fn(), onPublicLink: vi.fn(), onSendToChat: vi.fn() };

beforeEach(() => {
  info = access();
  vi.mocked(apiGet).mockImplementation(async (path: string) => (path.endsWith('/principals') ? found : info) as never);
});
afterEach(() => {
  cleanup();
  vi.mocked(apiPost).mockClear();
  vi.mocked(apiPut).mockClear();
  Object.values(handlers).forEach((h) => h.mockClear());
});

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ShareDialog item={{ type: 'folder', f: { id: 9, name: 'CareMe', parent_id: null, file_count: 24 } } as never} {...handlers} />
    </QueryClientProvider>,
  );

const box = () => screen.findByRole('combobox', { name: 'Add people, teams, departments or companies' });
const type = async (text: string) => {
  const input = await box();
  fireEvent.change(input, { target: { value: text } });
  await screen.findAllByRole('option');
  return input;
};

describe('Share dialog (worksuite-desktop#329)', () => {
  it('finds people, teams and the rest in one box, typed, in a floating list; a payroll record is listed but cannot be picked', async () => {
    mount();
    expect(await screen.findByText('Share “CareMe”')).toBeTruthy();
    expect(await screen.findByText('Folder · 24 files · Livezen Technologies')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Share' })).toHaveProperty('disabled', true);
    expect(screen.queryByRole('group', { name: 'Notify by' })).toBeNull();

    const input = await type('cham');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options).toHaveLength(4);
    expect(within(options[0]!).getByText('Person')).toBeTruthy();
    expect(within(options[3]!).getByText('Team')).toBeTruthy();

    // People who can be shared with come first; the payroll record after them, greyed out.
    expect(within(options[1]!).getByText('Danindu Chamoth Dampathi')).toBeTruthy();
    const payroll = options[2]!;
    expect(payroll.getAttribute('aria-disabled')).toBe('true');
    expect(within(payroll).getByText('Payroll record · no WorkSuite sign-in')).toBeTruthy();
    expect(within(payroll).getByText('Can’t share')).toBeTruthy();
    fireEvent.click(payroll);
    expect(screen.queryByRole('button', { name: 'Remove Chamudi Gayeshika' })).toBeNull();

    // The list floats over Who has access: it is not part of its flow.
    expect(screen.getByRole('listbox').parentElement!.className).toContain('absolute');

    fireEvent.click(options[0]!);
    expect(screen.getByRole('button', { name: 'Remove Chamudi Gayeshika' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Share' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('group', { name: 'Notify by' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeTruthy();
    expect(input.getAttribute('placeholder')).toBe('Add more…');
  });

  it('works from the keyboard: arrows, Enter, Backspace removes the last chip, Esc closes the list before the dialog', async () => {
    mount();
    const input = await type('cham');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const first = within(screen.getByRole('listbox')).getAllByRole('option')[0]!;
    expect(input.getAttribute('aria-activedescendant')).toBe(first.id);
    expect(first.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('button', { name: 'Remove Chamudi Gayeshika' })).toBeTruthy();

    // Enter on the payroll record does nothing.
    fireEvent.change(input, { target: { value: 'cham' } });
    await screen.findAllByRole('option');
    // Shareable people come first: Danindu, then the payroll record.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const payroll = within(screen.getByRole('listbox')).getAllByRole('option')[1]!;
    expect(input.getAttribute('aria-activedescendant')).toBe(payroll.id);
    expect(payroll.getAttribute('aria-disabled')).toBe('true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(1);

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(handlers.onClose).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
    expect(screen.getByRole('button', { name: 'Share' })).toHaveProperty('disabled', true);

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('shares with every chip at the chosen level, telling them as chosen, and says so', async () => {
    mount();
    const input = await type('cham');
    fireEvent.click(within(screen.getByRole('listbox')).getAllByRole('option')[0]!);
    fireEvent.change(input, { target: { value: 'cham' } });
    await screen.findAllByRole('option');
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Chamber team'));

    fireEvent.click(screen.getByRole('button', { name: 'Permission: Can edit' }));
    const menu = screen.getByRole('menu', { name: 'Permission' });
    expect(within(menu).getByText('View and add comments')).toBeTruthy();
    expect(within(menu).getByText('Edit, share and manage access')).toBeTruthy();
    fireEvent.click(within(menu).getByText('Can comment'));
    expect(screen.getByRole('button', { name: 'Permission: Can comment' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Email', pressed: true }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'For Monday' } });
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));
    expect(apiPost).toHaveBeenNthCalledWith(1, '/api/drive/access/folder/9/grants', { principal_type: 'user', principal_id: 5, level: 'comment', can_download: true, notify: true, notify_chat: true, notify_email: false, message: 'For Monday' });
    expect(apiPost).toHaveBeenNthCalledWith(2, '/api/drive/access/folder/9/grants', expect.objectContaining({ principal_type: 'group', principal_id: 8, level: 'comment' }));
    expect((await screen.findByRole('status')).textContent).toContain('Shared with Chamudi, Chamber team (can comment) · notified in chat');
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
  });

  it('shares quietly with Chat and Email both off, and keeps a chip the server refused', async () => {
    vi.mocked(apiPost).mockRejectedValueOnce(new Error('Not in this company'));
    mount();
    await type('cham');
    fireEvent.click(within(screen.getByRole('listbox')).getAllByRole('option')[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Chat', pressed: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Email', pressed: true }));
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/drive/access/folder/9/grants', { principal_type: 'user', principal_id: 5, level: 'edit', can_download: true, notify: false }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('error', 'Chamudi Gayeshika: Not in this company'));
    expect(screen.getByRole('button', { name: 'Remove Chamudi Gayeshika' })).toBeTruthy();
  });

  it('lists who has access with role pickers, and the inherited access as a switch', async () => {
    mount();
    expect(await screen.findByText('Who has access · 2')).toBeTruthy();
    expect(screen.getByText('Hasarinda Manjula (you)')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Access for Dimuthu Anuraj: Full access' }));
    const menu = screen.getByRole('menu', { name: 'Access for Dimuthu Anuraj' });
    fireEvent.click(within(menu).getByText('Can view'));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/drive/access/folder/9/grants/41', { principal_type: 'user', principal_id: 2, level: 'view', can_download: true, effect: 'allow' }));

    expect(screen.getByText(/nothing extra comes from above/)).toBeTruthy();
    const sw = screen.getByRole('switch', { name: 'Inherit access from the folder above' });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(sw);
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/drive/access/folder/9/inheritance', { inherit: false, copy: true }));
  });

  it('sets General access, and hands "Anyone with the link" to the public link dialog', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'General access: Restricted' }));
    let menu = screen.getByRole('menu', { name: 'General access' });
    expect(within(menu).getByText('Signed-in staff of this company can open it')).toBeTruthy();
    fireEvent.click(within(menu).getByText('Anyone at Livezen Technologies with the link'));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/drive/access/folder/9/general', { access: 'org', level: 'view' }));

    fireEvent.click(screen.getByRole('button', { name: 'General access: Restricted' }));
    menu = screen.getByRole('menu', { name: 'General access' });
    fireEvent.click(within(menu).getByText('Anyone with the link'));
    expect(handlers.onPublicLink).toHaveBeenCalledTimes(1);
  });

  it('shows company access with its level, and does not list the company rule twice', async () => {
    info = access({
      general: { access: 'org', level: 'comment', grant_id: 50 },
      grants: [...access().grants, { id: 50, principal: { type: 'organization', id: 1, name: 'Livezen Technologies', detail: null }, level: 'comment', effect: 'allow', can_download: true, expires_at: null, editable: true }],
    });
    mount();
    expect(await screen.findByRole('button', { name: 'General access: Anyone at Livezen Technologies with the link' })).toBeTruthy();
    expect(screen.getByText('Who has access · 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Company access: Can comment' }));
    const menu = screen.getByRole('menu', { name: 'Company access' });
    expect(within(menu).queryByText('Full access')).toBeNull();
    fireEvent.click(within(menu).getByText('Can edit'));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/drive/access/folder/9/general', { access: 'org', level: 'edit' }));
  });

  it('copies the link ("Link copied"), sends it in chat, and is done', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mount();
    await screen.findByText('Who has access · 2');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/files?folder=9'));
    expect(await screen.findByRole('button', { name: 'Link copied' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Send in chat' }));
    expect(handlers.onSendToChat).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(handlers.onClose).toHaveBeenCalled();
  });
});
