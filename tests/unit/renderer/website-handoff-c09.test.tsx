// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebchatHandoff, WebchatRingState } from '@shared/types';
import type * as CoreApi from '../../../src/core/api';

/**
 * Invite, transfer and the invitee's cards (C-09, TEAM-UI-02; TEAM-20…25, TEAM-40…47), as designed: the invite dialog
 * that finds people or departments, the transfer dialog's segmented target and warm / hand over now cards, the
 * INVITATION and TRANSFER TO YOU call cards counting down by the server's clock, and the amber declined notice.
 */
let listeners: Array<(e: unknown) => void> = [];
const realtime = (e: unknown) => listeners.forEach((cb) => cb(e));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), request: vi.fn(async () => ({ data: {} })) }));
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(),
  on: (channel: string, cb: (e: unknown) => void) => {
    if (channel !== 'realtime:event') return () => undefined;
    listeners.push(cb);
    return () => {
      listeners = listeners.filter((x) => x !== cb);
    };
  },
  errorMessage: (e: unknown) => String(e),
  isMac: false,
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/modules/calls/tones', () => ({ playTone: vi.fn(() => ({ stop: vi.fn(), setVolume: vi.fn() })), playOnce: vi.fn() }));

import { apiGet, request } from '../../../src/core/api';
import { call } from '../../../src/core/bridge';
import { RingingBar, WebchatRingWindow, handoffDetail, handoffHeadline, handoffLeft } from '../../../src/modules/chat/website/Ringing';
import { DeclinedNotice, InviteDialog, TransferDialog, useDeclined } from '../../../src/modules/chat/website/Team';
import type { WebsiteTeam } from '../../../src/modules/chat/website/api';

const AGENTS = {
  agents: [
    { id: 3, name: 'Nuwan Silva', email: 'n@x', status: 'available', open_chats: 2, department_id: 1, department: 'Sales', on_staff: true, in_chat: 'owner' },
    { id: 7, name: 'Dilini Perera', email: 'd@x', status: 'available', open_chats: 1, department_id: 1, department: 'Education sales', on_staff: true, in_chat: null },
    { id: 8, name: 'Kasun Jayasinghe', email: 'k@x', status: 'busy', open_chats: 3, department_id: 2, department: 'Support', on_staff: true, in_chat: null },
    { id: 9, name: 'Amal Ranasinghe', email: 'a@x', status: 'offline', open_chats: 0, department_id: null, department: null, on_staff: true, in_chat: null },
  ],
  departments: [{ id: 1, name: 'Education sales', available: 1 }, { id: 2, name: 'Support', available: 0 }],
};

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

beforeEach(() => {
  listeners = [];
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
    if (path === '/api/chat/widget-admin/agents') return AGENTS;
    if (path === '/api/chat/widget-admin/canned') return { responses: [] };
    throw new Error(`unexpected ${path}`);
  }) as never);
  vi.mocked(request).mockReset().mockResolvedValue({ data: {} } as never);
  vi.mocked(call).mockReset();
});
afterEach(() => cleanup());

describe('the invite dialog (C-09, TEAM-20…22, TEAM-25)', () => {
  it('says you stay the owner, shows "Available · 1 chat · Education sales", keeps offline unpickable and invites 1 person with a note', async () => {
    const done = vi.fn();
    wrap(<InviteDialog conversationId={41} me={3} onClose={vi.fn()} onDone={done} />);
    const dialog = await screen.findByRole('dialog', { name: 'Invite to this chat' });
    expect(within(dialog).getByText('They join alongside you. You stay the owner.')).toBeTruthy();
    expect((within(dialog).getByRole('textbox', { name: 'Search people or departments' }) as HTMLInputElement).placeholder).toBe('Search people or departments');

    const status = await within(dialog).findByText('Available · 1 chat · Education sales');
    expect(status.className).toContain('text-success');
    expect(within(dialog).getByText('Busy · 3 chats · Support').className).toContain('text-warning-ink');
    const offline = within(dialog).getByText('Offline').closest('label')!.querySelector('input')! as HTMLInputElement;
    expect(offline.disabled).toBe(true);

    const dilini = within(dialog).getByText('Dilini Perera').closest('label')!;
    fireEvent.click(dilini.querySelector('input')!);
    // Picked: tinted, with the primary bar down its left edge.
    expect(dilini.className).toContain('bg-selection');
    expect(dilini.querySelector('.bg-primary')).toBeTruthy();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Note for them (staff only)' }), { target: { value: 'Education discount for 5 seats — can you quote?' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Invite 1 person' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/chat/widget-admin/conversations/41/invites', { body: { user_ids: [7], note: 'Education discount for 5 seats — can you quote?' } }));
    expect(done).toHaveBeenCalled();
  });

  it('finds departments by the same search; a department with nobody available cannot be picked; one picked is invited as a team', async () => {
    wrap(<InviteDialog conversationId={41} me={7} owner={false} onClose={vi.fn()} onDone={vi.fn()} />);
    const dialog = await screen.findByRole('dialog', { name: 'Invite to this chat' });
    expect(within(dialog).getByText('They join alongside you.')).toBeTruthy();
    await within(dialog).findByText('Kasun Jayasinghe');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Search people or departments' }), { target: { value: 'support' } });
    expect(within(dialog).queryByText('Dilini Perera')).toBeNull();
    expect(within(dialog).getByText('Kasun Jayasinghe')).toBeTruthy();
    expect((within(dialog).getByRole('checkbox', { name: 'The Support team' }) as HTMLInputElement).disabled).toBe(true);
    expect(within(dialog).getByText('Department · nobody available')).toBeTruthy();

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Search people or departments' }), { target: { value: 'education' } });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'The Education sales team' }));
    expect(within(dialog).getByText('Department · 1 available · the first to accept joins')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Invite the Education sales team' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/chat/widget-admin/conversations/41/invites', { body: { department_id: 1 } }));
  });
});

describe('the transfer dialog (C-09, TEAM-40…43)', () => {
  it('a person, chosen into the field; warm by default, or hand over now that rings for them; the handover note', async () => {
    wrap(<TransferDialog conversationId={41} me={3} onClose={vi.fn()} onDone={vi.fn()} />);
    const dialog = await screen.findByRole('dialog', { name: 'Transfer this chat' });
    expect(within(dialog).getByText('The new owner answers for it from now on.')).toBeTruthy();
    const to = within(dialog).getByRole('radiogroup', { name: 'Transfer to' });
    expect(within(to).getAllByRole('radio').map((r) => r.textContent)).toEqual(['A person', 'A department', 'Next available']);
    expect(within(to).getByRole('radio', { name: 'A person' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click((await within(dialog).findByText('Dilini Perera')).closest('label')!.querySelector('input')!);
    // The one chosen, as the design's field: "Dilini Perera · Available".
    const field = within(dialog).getByRole('button', { name: 'Transfer to Dilini Perera. Change' });
    expect(field.textContent).toBe('DPDilini Perera · Available');
    expect(within(dialog).queryByRole('group', { name: 'Colleagues' })).toBeNull();

    expect(within(dialog).getByText('Warm — stay until they join')).toBeTruthy();
    expect(within(dialog).getByText('The visitor is never left alone.')).toBeTruthy();
    expect(within(dialog).getByText('You leave at once; it rings for Dilini until they join.')).toBeTruthy();
    fireEvent.click(within(dialog).getByText('Hand over now'));
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Handover note (staff only)' }), { target: { value: 'Wants 5 seats, education discount. Email: ravi@studio.lk' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Transfer' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/chat/widget-admin/conversations/41/transfer', { body: { to_user_id: 7, mode: 'cold', note: 'Wants 5 seats, education discount. Email: ravi@studio.lk' } }));

    // Clicking the field chooses again.
    fireEvent.click(field);
    expect(within(dialog).getByRole('group', { name: 'Colleagues' })).toBeTruthy();
  });

  it('next available needs no choice and says who it rings', async () => {
    wrap(<TransferDialog conversationId={41} me={3} onClose={vi.fn()} onDone={vi.fn()} />);
    const dialog = await screen.findByRole('dialog', { name: 'Transfer this chat' });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Next available' }));
    expect(within(dialog).getByText('You leave at once; it rings for everybody available until someone joins.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Transfer' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/chat/widget-admin/conversations/41/transfer', { body: { any: true, mode: 'warm' } }));
  });
});

const handoff = (over: Partial<WebchatHandoff> = {}): WebchatHandoff => ({
  id: 21, conversationId: 3, kind: 'invite', mode: 'warm', visitor: 'Visitor 4F2A', site: null, page: null, from: 'Nuwan Silva', department: null, toAny: false,
  note: 'Education discount for 5 seats — can you quote?', expiresAt: null, createdAt: null, endsAt: null, ...over,
});
const ring = (handoffs: WebchatHandoff[]): WebchatRingState => ({ chats: [], handoffs, tone: 'normal', volume: 80, outcome: null, hidden: false, shortcut: false });

describe('the invitee\'s cards (C-09, TEAM-23, TEAM-41, TEAM-42)', () => {
  it('INVITATION: "1:40 left" by the server\'s count, whatever this computer\'s clock says; the note quoted; Join chat and Decline', async () => {
    // The server's stamp is an hour out on this computer; its count of 100 seconds is what is shown.
    vi.mocked(call).mockResolvedValue(ring([handoff({ expiresAt: new Date(Date.now() - 3_600_000).toISOString(), endsAt: Date.now() + 100_400 })]) as never);
    wrap(<WebchatRingWindow />);
    const card = await screen.findByRole('region', { name: 'Invitation' });
    expect(within(card).getByText('Invitation').className).toContain('uppercase');
    expect(within(card).getByRole('timer').textContent).toBe('1:40 left');
    expect(within(card).getByText('Nuwan invites you to a chat with Visitor 4F2A')).toBeTruthy();
    expect(within(card).getByText('“Education discount for 5 seats — can you quote?”')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Join chat' }));
    expect(call).toHaveBeenCalledWith('ring:handoff', { id: 21, accept: true });
    fireEvent.click(within(card).getByRole('button', { name: 'Decline' }));
    expect(call).toHaveBeenCalledWith('ring:handoff', { id: 21, accept: false });
  });

  it('TRANSFER TO YOU: "Nuwan is handing you Visitor 4F2A", the handover note, "Warm transfer — Nuwan stays until you join", 0:48, Accept', async () => {
    vi.mocked(call).mockResolvedValue(ring([handoff({ kind: 'transfer', note: 'Wants 5 seats, education discount. Email: ravi@studio.lk', endsAt: Date.now() + 48_300 })]) as never);
    wrap(<WebchatRingWindow />);
    const card = await screen.findByRole('region', { name: 'Transfer request' });
    expect(within(card).getByText('Transfer to you')).toBeTruthy();
    expect(within(card).getByRole('timer').textContent).toBe('0:48');
    expect(within(card).getByText('Nuwan is handing you Visitor 4F2A')).toBeTruthy();
    expect(within(card).getByText('Wants 5 seats, education discount. Email: ravi@studio.lk')).toBeTruthy();
    expect(within(card).getByText('Warm transfer — Nuwan stays until you join')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Accept' }));
    expect(call).toHaveBeenCalledWith('ring:handoff', { id: 21, accept: true });
  });

  it('the bar counts down too, by the same clock', async () => {
    vi.mocked(call).mockResolvedValue(ring([handoff({ endsAt: Date.now() + 75_200 })]) as never);
    wrap(<RingingBar tone={false} />);
    const bar = await screen.findByRole('status', { name: 'Website chat invitation' });
    expect(within(bar).getByLabelText('Rings for 1:15 more')).toBeTruthy();
  });

  it('says what each kind is, in words', () => {
    const now = Date.now();
    expect(handoffHeadline(handoff({ kind: 'transfer', from: null, toAny: true }))).toBe('Visitor 4F2A needs someone — nobody took the chat');
    expect(handoffHeadline(handoff(), true)).toBe('Nuwan invites you to a chat with a website visitor');
    expect(handoffDetail(handoff({ department: 'Sales' }))).toBe('Sent to the Sales team — the first to join takes it');
    expect(handoffDetail(handoff({ kind: 'transfer', mode: 'cold' }))).toBe('Handed over now — Nuwan has left; it rings for you until you join');
    expect(handoffDetail(handoff({ kind: 'transfer', mode: 'cold', from: null, toAny: true }))).toBe('It rings for everybody covering the website until someone joins');
    expect(handoffDetail(handoff())).toBeNull();
    expect(handoffLeft(handoff({ endsAt: now + 30_000 }), now)).toBe(30);
    expect(handoffLeft(handoff({ expiresAt: new Date(now + 20_000).toISOString() }), now)).toBe(20);
    expect(handoffLeft(handoff(), now)).toBeNull();
  });
});

const TEAM = (my_role: WebsiteTeam['my_role']): WebsiteTeam => ({
  people: [], my_role, max: 4, transfer_count: 0,
  pending: [{ id: 51, kind: 'invite', mode: 'warm', from: 3, from_name: 'Nuwan Silva', to: 'Dilini Perera', to_users: [7], note: null, expires_at: null, created_at: null }],
  can: { invite: true, transfer: true, leave: true, remove: false, note: true, monitor: false, join: false, take_over: false },
});

function Notice({ t, retry }: { t: WebsiteTeam; retry: () => void }) {
  const d = useDeclined(41, 3, t);
  return d ? <DeclinedNotice d={d} onRetry={d.retry ? retry : null} /> : null;
}

describe('the declined notice (C-09, TEAM-24)', () => {
  it('amber: "Dilini declined — Visitor 4F2A is still yours." with Try someone else, which opens the picker again and goes', async () => {
    const retry = vi.fn();
    render(<Notice t={TEAM('owner')} retry={retry} />);
    act(() => realtime({ type: 'chat.widget.handoff.resolved', handoff_id: 51, conversation_id: 41, status: 'declined', by: 7, by_name: 'Dilini', visitor: 'Visitor 4F2A' }));
    const notice = await screen.findByRole('status');
    expect(notice.textContent).toBe('Dilini declined — Visitor 4F2A is still yours. Try someone else');
    expect(within(notice).getByText('Visitor 4F2A').tagName).toBe('B');
    expect(notice.className).toContain('bg-warning-bg');
    fireEvent.click(within(notice).getByRole('button', { name: 'Try someone else' }));
    expect(retry).toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('a participant\'s invitation leaves the chat the owner\'s; no answer is said so; Dismiss puts it away', async () => {
    render(<Notice t={TEAM('participant')} retry={vi.fn()} />);
    act(() => realtime({ type: 'chat.widget.handoff.resolved', handoff_id: 51, conversation_id: 41, status: 'expired', by: null, visitor: 'Visitor 4F2A' }));
    const notice = await screen.findByRole('status');
    expect(notice.textContent).toContain("Dilini Perera didn't answer — Visitor 4F2A is still in your chat.");
    fireEvent.click(within(notice).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
