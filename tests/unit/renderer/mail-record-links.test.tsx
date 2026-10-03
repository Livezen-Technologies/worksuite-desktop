// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ navigate: nav.navigate }) }));

import { ApiError, apiDelete, apiGet, apiPost } from '../../../src/core/api';
import { toast } from '../../../src/core/toasts';
import { listMenuSections, type MenuContext } from '../../../src/modules/mail/listActions';
import type { Target } from '../../../src/modules/mail/MessageMenus';
import { LinkRecordDialog, LinkedRecordChips, RecordMail, messageRoute, recordRoute, type LinkItem } from '../../../src/modules/mail/recordLinks';
import type { MessageRow } from '../../../src/modules/mail/types';

const item: LinkItem = { mailbox: 4, folder: 'inbox', uid: '1001', message_id: '<a1@cwb.example>', subject: 'Clarification 2', from_email: 'buyer@cwb.example' };
const link = { id: 9, mailbox: 4, folder: 'inbox', uid: '1001', message_id: '<a1@cwb.example>', subject: 'Clarification 2', from_name: 'CWB Buyer', from_email: 'buyer@cwb.example', received_at: '2026-10-01 09:00:00', record_type: 'tender' as const, record_id: 10, record_name: 'Pump station upgrade' };

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.mocked(apiGet).mockReset();
  vi.mocked(apiPost).mockReset();
  vi.mocked(apiDelete).mockReset();
  vi.mocked(toast).mockReset();
  nav.navigate.mockReset();
});
afterEach(cleanup);

describe('routes', () => {
  it('opens a tender and a deal in the app, a customer nowhere', () => {
    expect(recordRoute('tender', 10)).toBe('/tenders?open=10');
    expect(recordRoute('deal', 5)).toBe('/crm?deal=5');
    expect(recordRoute('customer', 1)).toBeNull();
  });
  it('opens the linked message in its own mailbox and folder', () => {
    expect(messageRoute({ mailbox: 4, folder: 'Archive', uid: '77' })).toBe('/mail?folder=Archive&msg=77&mf=Archive&box=4&mbx=4');
    expect(messageRoute({ mailbox: 0, folder: 'inbox', uid: '5' })).toBe('/mail?folder=inbox&msg=5&mf=inbox');
  });
});

describe('the picker', () => {
  it('offers the kinds the server allows, suggests the sender’s tender and links it', async () => {
    vi.mocked(apiGet).mockImplementation(async (path: string, q?: unknown) => {
      if (path === '/api/mail/links') return { kinds: ['tender', 'customer'], links: [] };
      if (path === '/api/mail/links/targets') {
        const type = (q as { type: string }).type;
        return type === 'tender'
          ? { items: [{ type: 'tender', id: 10, name: 'Pump station upgrade', sub: 'CWB/2026/14', suggested: true }, { type: 'tender', id: 11, name: 'Office cleaning', sub: null }] }
          : { items: [{ type: 'customer', id: 1, name: 'Ceylon Water Board', sub: 'buyer@cwb.example' }] };
      }
      throw new Error(`unexpected ${path}`);
    });
    vi.mocked(apiPost).mockResolvedValue({ links: [link], record_name: 'Pump station upgrade' });
    const onClose = vi.fn();
    wrap(<LinkRecordDialog items={[item]} onClose={onClose} />);

    expect(await screen.findByRole('tab', { name: /Tender/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Customer/ })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: /Deal/ })).toBeNull();
    expect(await screen.findByText('From this sender')).toBeTruthy();
    // The sender goes with the search, so the server can put their records first.
    expect(vi.mocked(apiGet).mock.calls.find((c) => c[0] === '/api/mail/links/targets')?.[1]).toMatchObject({ type: 'tender', from: 'buyer@cwb.example' });

    fireEvent.click(screen.getByText('Pump station upgrade'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(apiPost).toHaveBeenCalledWith('/api/mail/links', { items: [item], type: 'tender', id: 10 });
    expect(toast).toHaveBeenCalledWith('success', 'Linked to Pump station upgrade.');

    // Another kind.
    cleanup();
    wrap(<LinkRecordDialog items={[item]} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('tab', { name: /Customer/ }));
    expect(await screen.findByText('Ceylon Water Board')).toBeTruthy();
  });

  it('links several messages at once', async () => {
    vi.mocked(apiGet).mockImplementation(async (path: string) => (path === '/api/mail/links' ? { kinds: ['deal'], links: [] } : { items: [{ type: 'deal', id: 5, name: 'Annual maintenance', sub: 'LKR' }] }));
    vi.mocked(apiPost).mockResolvedValue({ links: [], record_name: 'Annual maintenance' });
    const two = [item, { ...item, uid: '1002' }];
    wrap(<LinkRecordDialog items={two} onClose={vi.fn()} />);
    expect(screen.getByText('Link 2 messages')).toBeTruthy();
    fireEvent.click(await screen.findByText('Annual maintenance'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/links', { items: two, type: 'deal', id: 5 }));
    expect(toast).toHaveBeenCalledWith('success', '2 messages linked to Annual maintenance.');
  });

  it('says so when the server is too old, or the person may see no records', async () => {
    vi.mocked(apiGet).mockRejectedValue(new ApiError(404, 'Not found', null, null));
    wrap(<LinkRecordDialog items={[item]} onClose={vi.fn()} />);
    expect(await screen.findByText(/cannot link mail to records yet/)).toBeTruthy();
    cleanup();
    vi.mocked(apiGet).mockResolvedValue({ kinds: [], links: [] });
    wrap(<LinkRecordDialog items={[item]} onClose={vi.fn()} />);
    expect(await screen.findByText(/do not have access to tenders, customers or deals/)).toBeTruthy();
  });
});

describe('the reader', () => {
  it('shows what the message is linked to, opens it and unlinks it', async () => {
    vi.mocked(apiGet).mockResolvedValue({ kinds: ['tender'], links: [link] });
    vi.mocked(apiDelete).mockResolvedValue(null);
    const go = vi.fn();
    wrap(<LinkedRecordChips item={item} navigate={go} />);
    fireEvent.click(await screen.findByText('Pump station upgrade'));
    expect(go).toHaveBeenCalledWith('/tenders?open=10');
    fireEvent.click(screen.getByRole('button', { name: 'Unlink from Pump station upgrade' }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/api/mail/links/9'));
  });

  it('shows nothing offline or without links', async () => {
    wrap(<LinkedRecordChips item={item} navigate={vi.fn()} offline />);
    expect(apiGet).not.toHaveBeenCalled();
    cleanup();
    vi.mocked(apiGet).mockResolvedValue({ kinds: ['tender'], links: [] });
    const { container } = wrap(<LinkedRecordChips item={item} navigate={vi.fn()} />);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="mail-record-link"]')).toBeNull();
  });
});

describe("a tender's Mail tab", () => {
  it('lists the linked mail and opens a message in Mail', async () => {
    vi.mocked(apiGet).mockResolvedValue({ record: { type: 'tender', id: 10, name: 'Pump station upgrade' }, messages: [link] });
    wrap(<RecordMail kind="tender" id={10} />);
    expect(apiGet).toHaveBeenCalledWith('/api/mail/links/record/tender/10', undefined);
    fireEvent.click(await screen.findByText('Clarification 2'));
    expect(nav.navigate).toHaveBeenCalledWith('/mail?folder=inbox&msg=1001&mf=inbox&box=4&mbx=4');
  });
  it('explains how to link when nothing is linked', async () => {
    vi.mocked(apiGet).mockResolvedValue({ record: { type: 'tender', id: 10, name: 'X' }, messages: [] });
    wrap(<RecordMail kind="tender" id={10} />);
    expect(await screen.findByText(/No email is linked yet/)).toBeTruthy();
  });
});

describe('the list menu', () => {
  const row = { id: 1001, subject: 'Clarification 2', from_name: 'CWB', from_email: 'buyer@cwb.example', created_at: '2026-10-01 09:00:00', is_read: true, is_starred: false, has_attachment: false } as unknown as MessageRow;
  const t: Target = { row, mailbox: '4', folder: 'inbox' };
  const base: MenuContext = { run: vi.fn(), keyFor: () => undefined, offline: false, state: [], quickSteps: [] };
  const find = (sections: ReturnType<typeof listMenuSections>) => sections.flatMap((s) => s.items).find((i) => i.id === 'link-record');

  it('offers Link to… for one message and for a selection, and not without access', () => {
    const linkRecord = vi.fn();
    const one = find(listMenuSections([t], { ...base, linkRecord }));
    expect(one?.label).toBe('Link to tender, customer or deal…');
    one?.onSelect?.();
    expect(linkRecord).toHaveBeenCalledWith([t]);
    expect(find(listMenuSections([t, { ...t, row: { ...row, id: 1002 } }], { ...base, linkRecord }))?.label).toBe('Link 2 to tender, customer or deal…');
    expect(find(listMenuSections([t], base))).toBeUndefined();
    expect(find(listMenuSections([t], { ...base, linkRecord, offline: true }))?.disabled).toBe(true);
  });
});
