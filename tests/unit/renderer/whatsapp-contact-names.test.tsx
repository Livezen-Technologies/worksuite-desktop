// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * WhatsApp names from Contacts (worksuite-desktop#176): numbers compared in E.164 however they were typed, the name
 * chosen in order (contact, saved name, ~WhatsApp name, number), several contacts on one number, groups by their
 * subject, and names that follow a contact being changed or deleted without a reload.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/access', async (orig) => ({ ...(await orig<object>()), useCanOpen: () => true }));
const tab = { route: '/chat?channel=whatsapp', go: vi.fn() };
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => {
    const [path, qs = ''] = tab.route.split('?');
    return { query: new URLSearchParams(qs), path: path!.split('/').filter(Boolean), go: tab.go };
  },
  useTabTitle: () => undefined,
}));

import { apiGet } from '../../../src/core/api';
import { formatPhone, toE164, waToE164 } from '../../../src/core/phone';
import { buildPhoneIndex, contactsFor, type PhoneContact } from '../../../src/modules/contacts/phones';
import { initialsSource, previewParts, whoIs, whoSent, withMentionNames } from '../../../src/modules/chat/channels/wa-names';
import { whatsappState } from '../../../src/modules/chat/channels/channels';
import { WhatsappChannel } from '../../../src/modules/chat/channels/WhatsappChannel';
import { WaAvatar } from '../../../src/modules/chat/channels/WaContact';
import { avatarTone } from '../../../src/components/ui';
import type { WaAccount, WaChat } from '../../../src/modules/chat/channels/whatsapp';

const person = (o: Partial<PhoneContact>): PhoneContact => ({ id: 1, name: 'Abdul Rahuman', company: 'Konnect BPO', type: 'customer', avatar: null, avatar_color: null, is_favorite: false, updated_at: '2026-09-01 10:00:00', phones: ['+94767793692'], whatsapp: null, ...o });
const account = (o: Partial<WaAccount> = {}): WaAccount => ({ id: 1, name: 'Sales', provider: 'web_js', phone: '94771234567', status: 'connected', status_note: null, is_default: true, can_send: true, can_connect: true, unread: 0, ...o });
const chat = (o: Partial<WaChat>): WaChat => ({
  id: 7, account_id: 1, kind: 'direct', name: '+94767793692', phone: '+94767793692', wa_id: '94767793692', status: 'open', unread: 0, is_pinned: 0, is_muted: 0,
  last_message: 'Is the order ready?', last_message_at: '2026-09-30 09:00:00', last_direction: 'in', awaiting_since: null, waiting_minutes: null, overdue: false, account_name: 'Sales', assigned_name: null,
  display: { name: '~abdul', subtitle: 'Not in contacts', source: 'profile', contact: null, contact_count: 0, contacts: [], in_contacts: false, wa_profile_name: 'abdul', phone_e164: '+94767793692', phone_display: '+94 76 779 3692' },
  phone_e164: '+94767793692', wa_profile_name: 'abdul', ...o,
});

beforeEach(() => {
  localStorage.clear();
  tab.route = '/chat?channel=whatsapp';
  tab.go.mockReset();
  vi.mocked(apiGet).mockReset();
});
afterEach(() => cleanup());

describe('phone numbers', () => {
  it('reads every way a number is written as the same E.164 number', () => {
    for (const raw of ['0767 793 692', '+94 76 779 3692', '076-7793692', '767793692', '94767793692', '0094767793692', '(076) 779 3692']) expect(toE164(raw)).toBe('+94767793692');
    expect(toE164('94767793692@s.whatsapp.net')).toBe('+94767793692');
    expect(toE164('94767793692:12@c.us')).toBe('+94767793692');
    expect(waToE164('94767793692')).toBe('+94767793692');
    expect(waToE164('447911123456')).toBe('+447911123456');
    expect(toE164('+1 (202) 555-0123')).toBe('+12025550123');
    expect(toE164('+94 76 779 3692 ext. 4')).toBe('+94767793692');
    for (const raw of ['', '12', 'hello', '120363041234567890@g.us', 'status@broadcast', null]) expect(toE164(raw)).toBeNull();
    expect(formatPhone('+94767793692')).toBe('+94 76 779 3692');
  });
});

describe('naming a conversation', () => {
  const index = buildPhoneIndex([person({ phones: ['0767 793 692', '+94 11 234 5678'] })]);

  it('is the contact, with their company, when one has the number however it was saved', () => {
    expect(contactsFor(index, '94767793692@s.whatsapp.net').map((c) => c.name)).toEqual(['Abdul Rahuman']);
    const who = whoIs(chat({}), index);
    expect([who.name, who.subtitle, who.source]).toEqual(['Abdul Rahuman', 'Konnect BPO', 'contact']);
    expect(whoIs(chat({ wa_id: '94112345678', phone_e164: null, display: null }), index).name).toBe('Abdul Rahuman');
  });

  it('falls back to the saved name, then ~their WhatsApp name, then the number — never a bare "+" for initials', () => {
    const empty = buildPhoneIndex([]);
    const saved = whoIs(chat({ display: { ...chat({}).display!, source: 'saved', name: 'Abdul (phone)' } }), empty);
    expect([saved.name, saved.source]).toEqual(['Abdul (phone)', 'saved']);
    const profile = whoIs(chat({}), empty);
    expect([profile.name, profile.subtitle]).toEqual(['~abdul', 'Not in contacts']);
    expect(profile.initialsOf).toBe('abdul');
    const number = whoIs(chat({ wa_profile_name: null, display: { ...chat({}).display!, wa_profile_name: null, source: 'number', name: '+94 76 779 3692' } }), empty);
    expect(number.name).toBe('+94 76 779 3692');
    expect(number.initialsOf).toBe('');
    expect(initialsSource('+94 76 779 3692')).toBe('');
  });

  it('uses the server’s answer until the contacts here have loaded', () => {
    const server = chat({ display: { ...chat({}).display!, source: 'contact', name: 'Abdul Rahuman', subtitle: 'Konnect BPO', contact: { id: 1, name: 'Abdul Rahuman', company: 'Konnect BPO' }, contact_count: 1, in_contacts: true } });
    expect(whoIs(server, undefined).name).toBe('Abdul Rahuman');
    // Loaded and without that contact (deleted since): the WhatsApp name again.
    expect(whoIs(server, buildPhoneIndex([])).name).toBe('~abdul');
  });

  it('prefers the contact marked WhatsApp, then a favourite, then the newest — and says how many share the number', () => {
    const many = buildPhoneIndex([
      person({ id: 1, name: 'Old', updated_at: '2026-01-01 00:00:00' }),
      person({ id: 2, name: 'New', updated_at: '2026-09-01 00:00:00' }),
      person({ id: 3, name: 'Favourite', is_favorite: true, updated_at: '2025-01-01 00:00:00' }),
    ]);
    expect(contactsFor(many, '+94767793692').map((c) => c.name)).toEqual(['Favourite', 'New', 'Old']);
    const withWa = buildPhoneIndex([...many.get('+94767793692')!, person({ id: 4, name: 'On WhatsApp', whatsapp: '+94767793692', updated_at: '2020-01-01 00:00:00' })]);
    const who = whoIs(chat({}), withWa);
    expect(who.name).toBe('On WhatsApp');
    expect(who.candidates.map((c) => c.name)).toEqual(['On WhatsApp', 'Favourite', 'New', 'Old']);
    // Picked by the person: that one, the others still offered.
    expect(whoIs(chat({}), withWa, 2).name).toBe('New');
  });

  it('names a group by its subject and size, never "Group" or its id', () => {
    const g = whoIs(chat({ kind: 'group', wa_id: '120363041234567890@g.us', subject: 'Konnect ops', member_count: 12, display: null }), index);
    expect([g.name, g.subtitle, g.group]).toEqual(['Konnect ops', '12 members', true]);
    expect(whoIs(chat({ kind: 'group', name: 'Group', subject: null, display: null }), index).name).toBe('Unnamed group');
    expect(whoIs(chat({ kind: 'group', name: '120363@g.us', subject: '120363@g.us', display: null }), index).name).toBe('Unnamed group');
  });

  it('names who spoke in a group, and the people mentioned, from Contacts', () => {
    expect(whoSent({ from_wa_id: '94767793692', author_name: '~abdul' }, index)).toEqual({ name: 'Abdul Rahuman', contactId: 1 });
    expect(whoSent({ from_wa_id: '94770000000', author_name: '~nimal' }, index)).toEqual({ name: '~nimal', contactId: null });
    expect(whoSent({ from_wa_id: '94770000000' }, index)!.name).toBe('+94 77 000 0000');
    expect(withMentionNames('Ask @94767793692 please', index)).toBe('Ask @Abdul Rahuman please');
  });

  it('shows a photo in the list as a picture and its caption, not the word', () => {
    expect(previewParts({ last_message: 'Photo — the shelf', last_direction: 'in' })).toEqual({ icon: 'image', text: 'the shelf', you: false });
    expect(previewParts({ last_message: 'Photo', last_direction: 'out' })).toEqual({ icon: 'image', text: 'Photo', you: true });
    expect(previewParts({ last_message: 'See you at 3', last_direction: 'in' })).toEqual({ icon: null, text: 'See you at 3', you: false });
    // #155: a voice message reads as a voice note, by its microphone.
    expect(previewParts({ last_message: 'Voice message', last_direction: 'in' })).toEqual({ icon: 'mic', text: 'Voice note', you: false });
  });

  // #155, reconciled with #176: an unknown number keeps the person icon (never "+"), on the colour that always goes
  // with that number.
  it('draws an unknown number as a person icon on its own colour, the same every time', () => {
    const who = (e164: string) => ({ name: formatPhone(e164), avatars: [], initialsOf: '', group: false, e164 });
    const { container } = render(<><WaAvatar who={who('+94767414854')} /><WaAvatar who={who('+94767414854')} /><WaAvatar who={who('+94771234567')} /></>);
    const [a, b, c] = [...container.querySelectorAll(':scope > span')] as HTMLElement[];
    expect(a!.textContent).toBe('');
    expect(a!.querySelector('svg')).toBeTruthy();
    expect(a!.className).toContain(avatarTone('+94767414854').split(' ')[0]!);
    expect(a!.className).toBe(b!.className);
    expect(c!.className).toContain(avatarTone('+94771234567').split(' ')[0]!);
    expect(a!.className).not.toContain('bg-subtle');
  });

  it('says a number that is starting up is connecting, not broken', () => {
    expect(whatsappState([account({ status: 'connecting', status_note: 'Starting the session.' })]).problem).toBe('Sales is connecting');
    expect(whatsappState([account({ status: 'error' })]).problem).toBe('Sales is not connected');
  });
});

describe('WhatsApp names in Chat', () => {
  let contacts: PhoneContact[] = [];
  function serve(chats: WaChat[]) {
    vi.mocked(apiGet).mockImplementation((async (path: string) => {
      if (path === '/api/whatsapp/chats') return { chats, total: chats.length };
      if (path === '/api/contacts/phone-index') return { region: 'LK', contacts };
      if (path === '/api/whatsapp/settings') return { settings: { whatsapp_new_contact_type: 'customer' }, can_edit: false };
      if (path === '/api/whatsapp/chats/7') return { chat: { ...chats[0], window: { allowed: true, reason: null }, account: account() }, messages: [], has_more: false, can_send: true };
      if (path === '/api/whatsapp/chats/9') return { chat: { ...chats[1], window: { allowed: true, reason: null }, account: account() }, messages: [{ id: 1, direction: 'in', kind: 'text', body: 'Morning @94767793692', caption: null, status: null, error_text: null, sender_name: null, filename: null, created_at: '2026-09-30 09:00:00', sent_at: null, from_wa_id: '94767793692', author_name: '~abdul' }, { id: 2, direction: 'in', kind: 'text', body: '', caption: null, status: null, error_text: null, sender_name: null, filename: null, created_at: '2026-09-30 09:01:00', sent_at: null }], has_more: false, can_send: true };
      if (path === '/api/whatsapp/book-contacts/1') return { contact: { id: 1, name: 'Abdul Rahuman', company: 'Konnect BPO', job_title: 'Director', type: 'customer', work_email: 'abdul@konnect.lk', personal_email: null, avatar: null, labels: ['WhatsApp'], can_edit: true }, phones: [{ field: 'mobile', e164: '+94767793692', display: '+94 76 779 3692' }], records: { deals: [{ id: 3, name: 'Renewal', amount: '1000', currency: 'LKR', stage: 'Proposal' }], invoices: null, tenders: null }, notes: [{ id: 1, body: 'Prefers mornings', pinned: 1, created_at: '2026-09-01' }], activity: [], conversations: [] };
      throw new Error(`unexpected ${path}`);
    }) as never);
  }
  function mount() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><WhatsappChannel accounts={[account()]} loading={false} error={null} retry={() => undefined} onConnect={null} /></QueryClientProvider>);
    return qc;
  }

  it('follows a contact being added, renamed and deleted, without a reload', async () => {
    contacts = [];
    serve([chat({})]);
    const qc = mount();
    const list = await screen.findByRole('complementary', { name: 'WhatsApp conversations' });
    await within(list).findByText('~abdul');

    // Added in Contacts: Contacts invalidates ['contacts'], and the name follows.
    contacts = [person({})];
    await act(async () => void (await qc.invalidateQueries({ queryKey: ['contacts'] })));
    await within(list).findByText('Abdul Rahuman');
    expect(within(list).getByText('· Konnect BPO')).toBeTruthy();

    contacts = [person({ name: 'Abdul R. Rahuman' })];
    await act(async () => void (await qc.invalidateQueries({ queryKey: ['contacts'] })));
    await within(list).findByText('Abdul R. Rahuman');

    contacts = [];
    await act(async () => void (await qc.invalidateQueries({ queryKey: ['contacts'] })));
    await within(list).findByText('~abdul');
  });

  it('offers to add an unknown number to Contacts from its right-click menu', async () => {
    contacts = [];
    serve([chat({})]);
    mount();
    const list = await screen.findByRole('complementary', { name: 'WhatsApp conversations' });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/contacts/phone-index', undefined, expect.anything()));
    fireEvent.contextMenu(await within(list).findByText('~abdul'));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Add to contacts' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: 'Link to existing contact' })).toBeTruthy();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Add to contacts' }));
    // The new-contact form, prefilled with their WhatsApp name, the number and the WhatsApp label.
    const form = await screen.findByRole('dialog', { name: 'New contact' });
    expect((within(form).getByDisplayValue('abdul') as HTMLInputElement).value).toBe('abdul');
    expect(within(form).getAllByDisplayValue('+94 76 779 3692').length).toBeGreaterThan(0);
    expect(within(form).getByDisplayValue('WhatsApp')).toBeTruthy();
  });

  it('names the header from Contacts and opens the contact’s panel from it', async () => {
    contacts = [person({})];
    tab.route = '/chat?channel=whatsapp&wa=7';
    serve([chat({})]);
    mount();
    const header = await screen.findByRole('button', { name: 'About Abdul Rahuman' });
    expect(within(header).getByText('Konnect BPO · +94 76 779 3692 · on Sales')).toBeTruthy();
    fireEvent.click(header);
    const panel = await screen.findByRole('complementary', { name: 'Contact' });
    await within(panel).findByText('abdul@konnect.lk');
    expect(within(panel).getByText('Renewal · Proposal · LKR 1000')).toBeTruthy();
    expect(within(panel).getByText('Prefers mornings')).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Open in Contacts' })).toBeTruthy();
  });

  it('offers Add to contacts in the header of an unknown number', async () => {
    contacts = [];
    tab.route = '/chat?channel=whatsapp&wa=7';
    serve([chat({})]);
    mount();
    await screen.findByRole('button', { name: 'About ~abdul' });
    expect(screen.getByRole('button', { name: 'Add to contacts' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Link to contact' })).toBeTruthy();
  });

  it('shows a group by its name and size, and who said each message', async () => {
    contacts = [person({})];
    tab.route = '/chat?channel=whatsapp&wa=9';
    serve([chat({}), chat({ id: 9, kind: 'group', wa_id: '120363041234567890@g.us', subject: 'Konnect ops', member_count: 5, display: null, phone_e164: null })]);
    mount();
    const header = await screen.findByRole('button', { name: 'About Konnect ops' });
    expect(within(header).getByText('5 members · on Sales')).toBeTruthy();
    expect(screen.queryByText(/@g\.us/)).toBeNull();
    const thread = screen.getByRole('region', { name: 'WhatsApp with Konnect ops' });
    expect(within(thread).getByText('Abdul Rahuman')).toBeTruthy();
    expect(within(thread).getByText('Morning @Abdul Rahuman')).toBeTruthy();
    // An empty notice is not drawn as a message.
    expect(within(thread).getAllByRole('button', { name: 'Reply to message' })).toHaveLength(1);
  });
});
