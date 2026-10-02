// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type { MeetingPreset } from '../../../src/modules/meetings/api';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPatch: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/tabs', () => ({ navigate: vi.fn() }));
vi.mock('../../../src/core/app-state', async () => {
  const { createStore } = await import('../../../src/core/store');
  return { app: createStore({ auth: { user: { id: '5' }, server: { origin: 'https://app.worksuite.lk' } }, transfers: [] }) };
});
const canOpen = vi.hoisted(() => ({ apps: new Set(['mail', 'contacts', 'meet']) }));
vi.mock('../../../src/core/access', () => ({ useCanOpen: (id: string) => canOpen.apps.has(id) }));
// The dialog is the Meetings module's; here it only has to say what it was opened with.
vi.mock('../../../src/modules/meetings/ScheduleDialog', () => ({
  ScheduleDialog: ({ preset }: { preset: MeetingPreset }) => (
    <p role="dialog" aria-label="Schedule a meeting">
      {preset.title} · {preset.source_type}:{preset.source_id} · guests {(preset.guests ?? []).join(',')} · {preset.label}
    </p>
  ),
}));

import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from '../../../src/core/api';
import { call } from '../../../src/core/bridge';
import { navigate } from '../../../src/core/tabs';
import ContactPersons from '../../../src/modules/tenders/ContactPersons';
import Workspace from '../../../src/modules/tenders/Workspace';
import { matchesOf, meetingPreset, newPersonBody, roleBody, tabLabel, telUrl } from '../../../src/modules/tenders/persons';

const nadeesha = { id: 100, display_name: 'Nadeesha Fernando', job_title: 'Procurement Manager', company: 'Road Development Authority', email: 'nadeesha@rda.lk', phone: '+94 77 123 4567', org_id: 1 };
const pal = { id: 101, display_name: 'Private Pal', job_title: null, company: 'Pal & Co', email: 'pal@example.com', phone: null, org_id: null };
const link = (over: Record<string, unknown>) => ({ id: 1, contact_id: 100, role: 'PROCUREMENT_OFFICER', role_other: null, role_label: 'Procurement Officer', is_primary: true, missing: false, restricted: false, contact: nadeesha, ...over });

describe('the pieces', () => {
  it('counts contact persons in the tab label', () => {
    expect(tabLabel(3)).toBe('Contact Persons · 3');
    expect(tabLabel(0)).toBe('Contact Persons');
    expect(tabLabel(undefined)).toBe('Contact Persons');
  });
  it('dials the digits, keeping a leading plus', () => {
    expect(telUrl('+94 77 123 4567')).toBe('tel:+94771234567');
    expect(telUrl('(011) 255-0000')).toBe('tel:0112550000');
    expect(telUrl('n/a')).toBeNull();
  });
  it('needs a role, and words for Other', () => {
    expect(roleBody({ role: '', role_other: '' }).error).toMatch(/Choose their role/);
    expect(roleBody({ role: 'OTHER', role_other: '  ' }).error).toMatch(/Say what their role is/);
    expect(roleBody({ role: 'OTHER', role_other: ' Site engineer ' }).body).toEqual({ role: 'OTHER', role_other: 'Site engineer' });
    expect(roleBody({ role: 'TECHNICAL_CONTACT', role_other: 'ignored' }).body).toEqual({ role: 'TECHNICAL_CONTACT' });
  });
  it('needs a name and a readable email for a new contact', () => {
    expect(newPersonBody({ display_name: ' ', job_title: '', company: '', email: '', phone: '' }).error).toMatch(/name is required/);
    expect(newPersonBody({ display_name: 'A', job_title: '', company: '', email: 'nope', phone: '' }).error).toMatch(/email/);
    expect(newPersonBody({ display_name: ' A ', job_title: '', company: 'RDA', email: '', phone: '077' }).body).toEqual({ display_name: 'A', company: 'RDA', phone: '077' });
  });
  it('reads the duplicates a refusal carried', () => {
    expect(matchesOf(new ApiError(409, 'looks like', null, { matches: [{ ...nadeesha, linked: false, matched_on: ['email'] }] }))?.map((m) => [m.id, m.matched_on])).toEqual([[100, ['email']]]);
    expect(matchesOf(new ApiError(409, 'already listed', null, null))).toBeNull();
    expect(matchesOf(new ApiError(422, 'no', null, { matches: [nadeesha] }))).toBeNull();
  });
  it('schedules a meeting about the tender with the contact as an external guest', () => {
    expect(meetingPreset({ id: 7, title: 'Road resurfacing', reference: 'RFQ/7' }, nadeesha)).toEqual({
      title: 'Road resurfacing', type: 'client', source_type: 'tender', source_id: 7, label: 'Tender · RFQ/7 · Road resurfacing', guests: ['nadeesha@rda.lk'],
    });
    expect(meetingPreset({ id: 7, title: 'X' }, { ...nadeesha, email: null }).guests).toBeUndefined();
  });
});

describe('the Contact Persons tab', () => {
  let listed: Array<Record<string, unknown>>;
  let manage: boolean;

  beforeEach(() => {
    listed = [link({}), link({ id: 2, contact_id: 101, role: 'OTHER', role_other: 'Site engineer', role_label: 'Site engineer', is_primary: false, contact: pal })];
    manage = true;
    canOpen.apps = new Set(['mail', 'contacts', 'meet']);
    vi.mocked(apiGet).mockReset();
    vi.mocked(apiGet).mockImplementation(async (path: string, query?: Record<string, unknown>) => {
      if (path === '/api/tenders/7/contacts') return { count: listed.length, items: listed, can: { manage } } as never;
      if (path === '/api/tenders/7/contacts/search') return (String(query?.q).startsWith('nad') ? [{ ...nadeesha, id: 300, display_name: 'Nadun Silva', linked: false }, { ...nadeesha, linked: true }] : []) as never;
      throw new Error('unexpected ' + path);
    });
    vi.mocked(apiPost).mockReset();
    vi.mocked(apiPatch).mockReset();
    vi.mocked(apiDelete).mockReset();
    vi.mocked(call).mockReset();
    vi.mocked(navigate).mockReset();
  });
  afterEach(() => cleanup());

  function mount() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ContactPersons tender={{ id: 7, title: 'Road resurfacing', reference: 'RFQ/7' }} />
      </QueryClientProvider>,
    );
  }
  const row = (id: number) => document.querySelector<HTMLElement>(`[data-person="${id}"]`)!;
  const pickRole = (label: string) => {
    fireEvent.click(screen.getByRole('combobox', { name: 'Role on this tender' }));
    fireEvent.click(screen.getByRole('option', { name: label }));
  };

  it('lists each person with their role, the primary marked, and details from Contacts', async () => {
    mount();
    expect(await screen.findByText('2 contact persons')).toBeTruthy();
    expect(within(row(1)).getByText('Primary Contact')).toBeTruthy();
    expect(within(row(1)).getByText('Procurement Officer')).toBeTruthy();
    expect(within(row(1)).getByText('Procurement Manager · Road Development Authority')).toBeTruthy();
    expect(within(row(2)).queryByText('Primary Contact')).toBeNull();
    expect(within(row(2)).getByText('Site engineer')).toBeTruthy();
  });

  it('shows a person it may not read as their role only, with no actions on them', async () => {
    listed = [link({ restricted: true, contact: null })];
    manage = false;
    mount();
    expect(await screen.findByText('A contact you cannot view')).toBeTruthy();
    expect(within(row(1)).queryByRole('button', { name: /Email|Call|Open/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add new contact/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Link existing contact/ })).toBeNull();
  });

  it('marks another person as the Primary Contact', async () => {
    vi.mocked(apiPatch).mockResolvedValue({ link: {} } as never);
    mount();
    await screen.findByText('2 contact persons');
    expect(within(row(1)).queryByRole('button', { name: 'Make primary' })).toBeNull();
    await act(async () => {
      fireEvent.click(within(row(2)).getByRole('button', { name: 'Make primary' }));
    });
    expect(apiPatch).toHaveBeenCalledWith('/api/tenders/7/contacts/2', { is_primary: true });
  });

  it('unlinks only after asking, and says the contact stays in Contacts', async () => {
    vi.mocked(apiDelete).mockResolvedValue({ count: 1, primary_link_id: 2 } as never);
    mount();
    await screen.findByText('2 contact persons');
    fireEvent.click(within(row(1)).getByRole('button', { name: 'Unlink Nadeesha Fernando' }));
    expect(apiDelete).not.toHaveBeenCalled();
    const ask = within(row(1)).getByRole('group', { name: 'Confirm unlink' });
    expect(ask.textContent).toContain('Their record in Contacts stays.');
    await act(async () => {
      fireEvent.click(within(ask).getByRole('button', { name: 'Unlink' }));
    });
    expect(apiDelete).toHaveBeenCalledWith('/api/tenders/7/contacts/1');
  });

  it('opens the contact, writes, calls and schedules from a row', async () => {
    mount();
    await screen.findByText('2 contact persons');
    fireEvent.click(within(row(1)).getByRole('button', { name: 'Open Nadeesha Fernando in Contacts' }));
    expect(navigate).toHaveBeenLastCalledWith('/contacts?open=100');
    fireEvent.click(within(row(1)).getByRole('button', { name: 'Email Nadeesha Fernando' }));
    expect(navigate).toHaveBeenLastCalledWith('/mail?compose=1&to=nadeesha%40rda.lk');
    fireEvent.click(within(row(1)).getByRole('button', { name: 'Call Nadeesha Fernando' }));
    expect(call).toHaveBeenLastCalledWith('app:openExternal', { url: 'tel:+94771234567' });
    expect(within(row(2)).queryByRole('button', { name: /^Call/ })).toBeNull();
    fireEvent.click(within(row(1)).getByRole('button', { name: 'Schedule a meeting with Nadeesha Fernando' }));
    expect(screen.getByRole('dialog', { name: 'Schedule a meeting' }).textContent).toBe('Road resurfacing · tender:7 · guests nadeesha@rda.lk · Tender · RFQ/7 · Road resurfacing');
  });

  it('writes with the computer’s mail program where Mail is not open to the person', async () => {
    canOpen.apps = new Set(['contacts']);
    mount();
    await screen.findByText('2 contact persons');
    fireEvent.click(within(row(1)).getByRole('button', { name: 'Email Nadeesha Fernando' }));
    expect(call).toHaveBeenLastCalledWith('app:openExternal', { url: 'mailto:nadeesha@rda.lk' });
    expect(navigate).not.toHaveBeenCalled();
    expect(within(row(1)).queryByRole('button', { name: /Schedule a meeting/ })).toBeNull();
  });

  it('links an existing contact found by search, with a role', async () => {
    vi.mocked(apiPost).mockResolvedValue({ link: {}, count: 3 } as never);
    mount();
    await screen.findByText('2 contact persons');
    fireEvent.click(screen.getByRole('button', { name: /Link existing contact/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Find in Contacts' }), { target: { value: 'nad' } });
    const found = await screen.findByLabelText('Contacts found');
    await waitFor(() => expect(within(found).getByText('Nadun Silva')).toBeTruthy());
    expect(within(found).getByText('Already listed')).toBeTruthy();
    fireEvent.click(within(found).getByRole('button', { name: 'Choose' }));
    pickRole('Technical Contact');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    });
    expect(apiPost).toHaveBeenCalledWith('/api/tenders/7/contacts', { contact_id: 300, role: 'TECHNICAL_CONTACT' });
  });

  it('suggests the existing contact before creating a duplicate, then links it — or creates anyway', async () => {
    vi.mocked(apiPost).mockImplementation(async (_path: string, body?: unknown) => {
      const b = body as Record<string, unknown>;
      if (!b.contact_id && !b.force) throw new ApiError(409, 'This looks like a contact you already have.', null, { matches: [{ ...nadeesha, id: 300, display_name: 'Nadun Silva', linked: false, matched_on: ['email', 'phone'] }] });
      return { link: {}, count: 3 } as never;
    });
    mount();
    await screen.findByText('2 contact persons');
    fireEvent.click(screen.getByRole('button', { name: /Add new contact/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'N. Silva' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'nadun@rda.lk' } });
    pickRole('Other');
    fireEvent.change(screen.getByRole('textbox', { name: 'Their role' }), { target: { value: 'Site engineer' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    });
    expect(apiPost).toHaveBeenLastCalledWith('/api/tenders/7/contacts', { display_name: 'N. Silva', email: 'nadun@rda.lk', role: 'OTHER', role_other: 'Site engineer' });
    const dupes = screen.getByLabelText('Possible duplicates');
    expect(within(dupes).getByText('same email, same phone')).toBeTruthy();

    // Link the one already in Contacts instead.
    await act(async () => {
      fireEvent.click(within(dupes).getByRole('button', { name: 'Link Nadun Silva' }));
    });
    expect(apiPost).toHaveBeenLastCalledWith('/api/tenders/7/contacts', { contact_id: 300, role: 'OTHER', role_other: 'Site engineer' });
  });

  it('creates the new contact anyway once the suggestion was seen', async () => {
    vi.mocked(apiPost).mockImplementation(async (_path: string, body?: unknown) => {
      if (!(body as Record<string, unknown>).force) throw new ApiError(409, 'looks like', null, { matches: [{ ...nadeesha, linked: true, matched_on: ['name_organization'] }] });
      return { link: {}, count: 3 } as never;
    });
    mount();
    await screen.findByText('2 contact persons');
    fireEvent.click(screen.getByRole('button', { name: /Add new contact/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Nadeesha Fernando' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Organization' }), { target: { value: 'Road Development Authority' } });
    pickRole('Supplier Representative');
    fireEvent.click(screen.getByRole('checkbox'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    });
    expect(within(screen.getByLabelText('Possible duplicates')).getByText('Already listed')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create a new contact anyway' }));
    });
    expect(apiPost).toHaveBeenLastCalledWith('/api/tenders/7/contacts', {
      display_name: 'Nadeesha Fernando', company: 'Road Development Authority', role: 'SUPPLIER_REPRESENTATIVE', is_primary: true, force: true,
    });
  });
});

describe('the tender’s tabs', () => {
  afterEach(() => cleanup());

  it('names the Contact Persons tab with how many are linked, and opens it', async () => {
    let count = 3;
    vi.mocked(apiGet).mockReset();
    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path === '/api/tenders/7') return { tender: { id: 7, org_id: 1, title: 'Road resurfacing', reference: 'RFQ/7', stage: 'preparing', stage_label: 'Preparing', outcome: 'open', currency: 'LKR' } } as never;
      if (path === '/api/tenders/7/contacts') return { count, items: Array.from({ length: count }, (_, i) => link({ id: i + 1, contact_id: 100 + i, is_primary: i === 0, contact: { ...nadeesha, id: 100 + i, display_name: `Person ${i + 1}` } })), can: { manage: false } } as never;
      throw new Error('unexpected ' + path);
    });
    const onTab = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = (tab: string) => (
      <QueryClientProvider client={qc}>
        <Workspace id={7} bands={[]} canManage={false} canApprove={false} tab={tab} onTab={onTab} onBack={() => undefined} onEdit={() => undefined} />
      </QueryClientProvider>
    );
    const { rerender } = render(view('overview'));
    const tab = await screen.findByRole('tab', { name: 'Contact Persons · 3' });
    fireEvent.click(tab);
    expect(onTab).toHaveBeenCalledWith('contacts');
    rerender(view('contacts'));
    expect(await screen.findByText('3 contact persons')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Contact Persons · 3' }).getAttribute('aria-selected')).toBe('true');

    // Nobody linked: the bare name.
    count = 0;
    await act(async () => {
      await qc.invalidateQueries();
    });
    expect(await screen.findByRole('tab', { name: 'Contact Persons' })).toBeTruthy();
  });
});
