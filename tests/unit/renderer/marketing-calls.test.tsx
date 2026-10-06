// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEEP_LINK_RULES } from '@shared/deeplink';
import type { CallCampaignDetail, QueueCard } from '../../../src/modules/marketing/calls';
import type { Options } from '../../../src/modules/marketing/types';

/**
 * Marketing's call screens in WorkSuite Desktop (WS-MKT-SRS-001 §16; D01, W10/DK10, W11/DK11): the D01 queue list
 * that takes nobody, the workspace that claims one contact at a time (and again for each new claim), the wrap-up
 * with its callback and hand-over, click-to-call through the WorkSuite phone, the supervisor's view, and scripts.
 */
const net = vi.hoisted(() => ({ call: vi.fn(), apiGet: vi.fn(), apiPost: vi.fn(), request: vi.fn(), go: vi.fn(), navigate: vi.fn(), toast: vi.fn() }));

vi.mock('../../../src/core/bridge', () => ({ call: net.call, on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux' }));
vi.mock('../../../src/core/api', () => {
  class ApiError extends Error {
    constructor(readonly status: number, message: string, readonly code: string | null = null, readonly data: unknown = null) {
      super(message);
    }
  }
  return { ApiError, apiGet: net.apiGet, apiPost: net.apiPost, request: net.request, apiGetMeta: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() };
});
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ go: net.go, navigate: net.navigate, query: new URLSearchParams(), path: ['marketing'] }), useTabTitle: () => undefined }));
vi.mock('../../../src/core/toasts', () => ({ toast: net.toast }));

const { ApiError } = await import('../../../src/core/api');
const { default: MyQueue } = await import('../../../src/modules/marketing/MyQueue');
const { default: CallCampaignView } = await import('../../../src/modules/marketing/CallCampaignView');
const { default: CallCampaigns } = await import('../../../src/modules/marketing/CallCampaigns');
const { default: Scripts } = await import('../../../src/modules/marketing/Scripts');
const { NEXT_CONTACT_GLOBAL, CLAIM_COMMAND, dueLabel } = await import('../../../src/modules/marketing/calls-parts');
const { DEFAULT_SHORTCUTS, conflicts } = await import('../../../src/core/commands');

const can = { dashboard: true, view: true, create: true, edit: true, delete: true, import: true, export: true, convert: true, lists: true, segments: true, suppression: true, settings: true, calls: true, call_manage: true, call_make: true };
const options = {
  companies: [{ id: 1, name: 'Livezen Technologies', can, people: [{ id: 9, name: 'Sanduni K.' }, { id: 10, name: 'Ravindu D.' }] }],
  statuses: [], sources: [], channels: [], reasons: [], consent_sources: [], segment_fields: [], import_targets: [], import_existing: [], import_limits: { rows: 10000, bytes: 1 },
} as unknown as Options;

const card: QueueCard = {
  queue_id: 501, attempts: 1, callback: null,
  campaign: { id: 3, org_id: 1, name: 'Vendor follow-up calls', objective: 'Book a 15-minute call', max_attempts: 3 },
  script: { id: 4, org_id: 1, name: 'Website care (v3)', language: 'en', archived: false, updated_at: null, sections: { introduction: 'Hi Nimal, this is Sanduni.', qualification: 'Do you have a website?', pitch: 'Monitoring and backups.', objections: '', closing: 'Can I email a quote?', next_action: '' } },
  contact: { id: 77, name: 'Nimal Perera', job_title: 'Owner', company: 'Ceylon Agri Exports', website: null, industry: 'Agriculture', phone: '+94 77 123 4567', whatsapp: null, email: 'nimal@ceylonagri.lk', city: 'Kandy', country: 'LK', status: 'active', crm_lead_id: null },
  calls: [{ id: 1, outcome: 'no_answer', outcome_label: 'No answer', notes: null, by: 'Sanduni K.', campaign: 'Vendor follow-up calls', at: '2026-10-05 09:00:00', follow_up_at: null }],
  timeline: [],
};

let claims = 0;
let answer: () => unknown = () => ({ card, why: null, closed: [] });
const queueList = {
  items: [
    { queue_id: 501, contact_id: 77, name: 'Nimal Perera', company: 'Ceylon Agri Exports', campaign_id: 3, campaign: 'Vendor follow-up calls', attempts: 1, max_attempts: 3, reason: 'retry', last_outcome: 'no_answer', last_outcome_label: 'No answer', note: null, due_at: null },
    { queue_id: 502, contact_id: 78, name: 'Iresha Dias', company: 'Dias Printers', campaign_id: 3, campaign: 'Vendor follow-up calls', attempts: 1, max_attempts: 3, reason: 'callback', last_outcome: 'call_back', last_outcome_label: 'Call back', note: 'Call after 2 pm', due_at: '2099-01-01T14:00:00Z' },
    { queue_id: 503, contact_id: 79, name: 'Saman Kumara', company: null, campaign_id: 3, campaign: 'Vendor follow-up calls', attempts: 0, max_attempts: 3, reason: 'new', last_outcome: null, last_outcome_label: null, note: null, due_at: null },
  ],
  waiting: 38, callbacks_today: 9, held: null,
};

function routeGet(path: string): unknown {
  if (path === '/api/marketing/calls/queue') {
    claims += 1;
    return answer();
  }
  if (path === '/api/marketing/calls/queue/list') return queueList;
  if (path === '/api/marketing/calls/campaigns') return { items: [{ id: 3, org_id: 1, name: 'Vendor follow-up calls', status: 'active', status_label: 'Calling', mine: true, queued: 1006, waiting: 214, calls: 1000, connected: 388 }] };
  if (path === '/api/marketing/calls/callbacks') return { items: [], all: false };
  if (path === '/api/marketing/contacts/77') return { consent: { email: 'granted', phone: 'granted', whatsapp: null }, consent_history: [{ id: 1, channel: 'phone', status: 'granted', source: 'verbal', source_label: 'Verbal', source_ref: null, note: null, by: null, at: '2026-09-30 10:00:00' }], suppressed: [], email: 'nimal@ceylonagri.lk' };
  if (path === '/api/voip/status') return { pbx: { ok: true } };
  if (path === '/api/marketing/calls/scripts') return { items: [] };
  return { items: [] };
}

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
function show(ui: ReactElement, qc = client()) {
  const utils = render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  return { ...utils, qc, again: (next: ReactElement) => utils.rerender(<QueryClientProvider client={qc}>{next}</QueryClientProvider>) };
}

beforeEach(() => {
  Object.values(net).forEach((f) => f.mockReset());
  claims = 0;
  answer = () => ({ card, why: null, closed: [] });
  net.apiGet.mockImplementation(async (path: string) => routeGet(path));
  net.request.mockImplementation(async () => ({ data: null, message: 'Call recorded', offline: false, cachedAt: null }));
  net.apiPost.mockResolvedValue({});
});
afterEach(cleanup);

const queueProps = (over: Partial<Parameters<typeof MyQueue>[0]> = {}) => ({
  options, campaignId: 3 as number | null, tab: 'queue' as const, claim: null as string | null,
  onTab: vi.fn(), onClaimed: vi.fn(), onContact: vi.fn(), onCampaign: vi.fn(), ...over,
});

describe('My call queue — the D01 list', () => {
  it('lists who is waiting, without taking anybody, and says which keys take the next contact', async () => {
    const p = queueProps();
    show(<MyQueue {...p} />);
    expect(await screen.findByText('Nimal Perera')).toBeTruthy();
    const row = (name: string) => within(screen.getByText(name).closest('tr')!);
    expect(row('Nimal Perera').getByText('2 / 3')).toBeTruthy();
    expect(row('Nimal Perera').getByText('Retry · no answer')).toBeTruthy();
    expect(row('Nimal Perera').getByText('now')).toBeTruthy();
    expect(row('Iresha Dias').getByText('Callback')).toBeTruthy();
    expect(row('Iresha Dias').getByText('“Call after 2 pm”')).toBeTruthy();
    expect(row('Saman Kumara').getByText('New')).toBeTruthy();
    expect(row('Saman Kumara').getByText('—')).toBeTruthy();
    expect(screen.getByText(/Vendor follow-up calls · 38 waiting · Ctrl\+Shift\+N claims the next contact from any other app · Ctrl\+Alt\+N here/)).toBeTruthy();
    expect(claims).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: /Next contact/ }));
    expect(p.onTab).toHaveBeenCalledWith('work');
    fireEvent.click(screen.getByRole('button', { name: 'Nimal Perera' }));
    expect(p.onContact).toHaveBeenCalledWith(77);
  });

  it('says so on a server that cannot list the queue, and still offers Next contact', async () => {
    net.apiGet.mockImplementation(async (path: string) => {
      if (path === '/api/marketing/calls/queue/list') throw new ApiError(404, 'Not found', null);
      return routeGet(path);
    });
    const p = queueProps();
    show(<MyQueue {...p} />);
    expect(await screen.findByText(/This server does not list the queue yet/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Next contact/ }).length).toBe(2);
  });

  it('shows the callbacks, and Call now rings the number on the WorkSuite phone', async () => {
    net.apiGet.mockImplementation(async (path: string) =>
      path === '/api/marketing/calls/callbacks'
        ? { items: [{ queue_id: 502, at: '2020-01-01 08:00:00', contact_id: 78, name: 'Iresha Dias', phone: '077 123 4567', campaign_id: 3, campaign: 'Vendor follow-up calls', assignee: null, notes: 'Call after 2 pm' }], all: false }
        : routeGet(path),
    );
    const p = queueProps({ tab: 'callbacks' });
    show(<MyQueue {...p} />);
    expect(await screen.findByText('Due now — 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Call now/ }));
    await waitFor(() => expect(net.apiPost).toHaveBeenCalledWith('/api/voip/call', { number: '0771234567' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open in workspace' }));
    expect(net.go).toHaveBeenCalledWith(expect.stringMatching(/^\/marketing\?view=queue&tab=work&call=3&claim=\d+$/));
  });
});

describe('My call queue — the workspace (W11)', () => {
  it('claims once for the shell’s claim, hands it back to the shell, and claims again only for a new one', async () => {
    const p = queueProps({ tab: 'work', claim: '111' });
    const { again } = show(<MyQueue {...p} />);
    expect(await screen.findByRole('button', { name: 'Nimal Perera' })).toBeTruthy();
    expect(net.apiGet).toHaveBeenCalledWith('/api/marketing/calls/queue', { campaign: 3 }, expect.anything());
    await waitFor(() => expect(p.onClaimed).toHaveBeenCalledTimes(1));
    expect(claims).toBe(1);
    // The shell dropped the claim: nothing is taken again.
    again(<MyQueue {...p} claim={null} />);
    await act(async () => undefined);
    expect(claims).toBe(1);
    // The global key pressed again: a new claim.
    again(<MyQueue {...p} claim="222" />);
    await waitFor(() => expect(claims).toBe(2));
    await waitFor(() => expect(p.onClaimed).toHaveBeenCalledTimes(2));
  });

  it('shows the contact, their consent, the script’s six parts and the ten outcomes', async () => {
    show(<MyQueue {...queueProps({ tab: 'work' })} />);
    expect(await screen.findByText(/Ceylon Agri Exports · attempt 2 of 3 · last: no answer/)).toBeTruthy();
    expect(await screen.findByText(/Phone consent · verbal/)).toBeTruthy();
    expect(screen.getByText('Email: subscribed')).toBeTruthy();
    expect(await screen.findByText('Calling via WorkSuite Phone')).toBeTruthy();
    expect(screen.getByText('Script · Website care (v3)')).toBeTruthy();
    for (const part of ['1. Introduction', '2. Qualification questions', '3. Product pitch', '4. Objection handling', '5. Closing', '6. Next action']) expect(screen.getByText(part)).toBeTruthy();
    const outcomes = within(screen.getByRole('radiogroup', { name: 'Outcome' })).getAllByRole('radio').map((b) => b.textContent);
    expect(outcomes).toEqual(['Interested', 'Callback', 'Not interested', 'No answer', 'Busy', 'Voicemail', 'Wrong number', 'Not decision maker', 'Bad number', 'Do not call']);
    expect(screen.getByRole('switch', { name: 'Send follow-up email' })).toHaveProperty('disabled', true);
    expect(screen.getByText('Planned')).toBeTruthy();
  });

  it('saves Interested with the hand-over to CRM, then takes the next contact', async () => {
    show(<MyQueue {...queueProps({ tab: 'work' })} />);
    await screen.findByRole('button', { name: 'Nimal Perera' });
    const handover = screen.getByRole('switch', { name: 'Hand over to CRM as lead' });
    expect(handover).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('radio', { name: 'Interested' }));
    expect(handover).toHaveProperty('disabled', false);
    expect(handover.getAttribute('aria-checked')).toBe('true');
    fireEvent.change(screen.getByLabelText('Call notes'), { target: { value: 'Wants a quote for the Standard plan.' } });
    fireEvent.click(screen.getByRole('button', { name: /Save outcome/ }));
    await waitFor(() => expect(net.request).toHaveBeenCalledWith('POST', '/api/marketing/calls/queue/501/outcome', { body: { outcome: 'interested', notes: 'Wants a quote for the Standard plan.', handover: true } }));
    await waitFor(() => expect(claims).toBe(2));
    expect(net.toast).toHaveBeenCalledWith('success', 'Call recorded');
  });

  it('asks when to call back, and sends the time with who makes it', async () => {
    show(<MyQueue {...queueProps({ tab: 'work' })} />);
    await screen.findByRole('button', { name: 'Nimal Perera' });
    fireEvent.click(screen.getByRole('radio', { name: 'Callback' }));
    fireEvent.click(screen.getByRole('button', { name: /Save outcome/ }));
    expect(await screen.findByText('Say when to call back.')).toBeTruthy();
    expect(net.request).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Call back on'), { target: { value: '2099-01-02' } });
    fireEvent.change(screen.getByLabelText('At'), { target: { value: '14:00' } });
    fireEvent.click(screen.getByRole('button', { name: /Save outcome/ }));
    await waitFor(() => expect(net.request).toHaveBeenCalledTimes(1));
    const body = net.request.mock.calls[0]![2].body as Record<string, unknown>;
    expect(body.outcome).toBe('call_back');
    expect(String(body.follow_up_at)).toMatch(/^2099-01-0[12]T\d{2}:\d{2}:00\.000Z$/);
    expect(body.handover).toBeUndefined();
  });

  it('says so when the contact was let go meanwhile (409), and takes the next one', async () => {
    net.request.mockRejectedValueOnce(new ApiError(409, 'That contact is no longer yours to call: it was finished, or let go after 20 minutes. Take the next one.', null));
    show(<MyQueue {...queueProps({ tab: 'work' })} />);
    await screen.findByRole('button', { name: 'Nimal Perera' });
    fireEvent.click(screen.getByRole('radio', { name: 'No answer' }));
    fireEvent.click(screen.getByRole('button', { name: /Save outcome/ }));
    await waitFor(() => expect(net.toast).toHaveBeenCalledWith('error', expect.stringMatching(/no longer yours to call/)));
    await waitFor(() => expect(claims).toBe(2));
  });

  it('asks before Do not call', async () => {
    show(<MyQueue {...queueProps({ tab: 'work' })} />);
    await screen.findByRole('button', { name: 'Nimal Perera' });
    fireEvent.click(screen.getByRole('radio', { name: 'Do not call' }));
    fireEvent.click(screen.getByRole('button', { name: /Save outcome/ }));
    expect(await screen.findByText('Never call Nimal Perera again?')).toBeTruthy();
    expect(net.request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Do not call' }));
    await waitFor(() => expect(net.request).toHaveBeenCalledWith('POST', '/api/marketing/calls/queue/501/outcome', { body: { outcome: 'do_not_call', notes: '' } }));
  });

  it('calls through the WorkSuite phone, or copies the number when there is none', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    show(<MyQueue {...queueProps({ tab: 'work' })} />);
    await screen.findByRole('button', { name: 'Nimal Perera' });
    expect(screen.getByRole('timer').textContent).toBe('00:00');
    fireEvent.click(screen.getByRole('button', { name: /Call via WorkSuite Phone/ }));
    await waitFor(() => expect(net.apiPost).toHaveBeenCalledWith('/api/voip/call', { number: '+94771234567' }));
    expect(net.toast).toHaveBeenCalledWith('success', 'Calling +94 77 123 4567 on your WorkSuite phone');
    net.apiPost.mockRejectedValueOnce(new ApiError(503, 'No PBX', null));
    fireEvent.click(screen.getByRole('button', { name: /Call via WorkSuite Phone/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('+94 77 123 4567'));
    expect(net.toast).toHaveBeenLastCalledWith('success', 'No WorkSuite phone connected — number copied');
  });

  it('Skip hands the contact back and takes the next; Release hands it back and stops', async () => {
    const p = queueProps({ tab: 'work' });
    show(<MyQueue {...p} />);
    await screen.findByRole('button', { name: 'Nimal Perera' });
    fireEvent.click(screen.getByRole('button', { name: /Skip/ }));
    // Skip: to the back of the queue for a while, so the next claim gives somebody else.
    await waitFor(() => expect(net.request).toHaveBeenCalledWith('POST', '/api/marketing/calls/queue/501/skip', { body: { later: true } }));
    await waitFor(() => expect(claims).toBe(2));
    await screen.findByRole('button', { name: 'Nimal Perera' });
    fireEvent.click(screen.getByRole('button', { name: 'Release' }));
    // Release: anybody may take them at once.
    await waitFor(() => expect(net.request).toHaveBeenLastCalledWith('POST', '/api/marketing/calls/queue/501/skip', { body: {} }));
    await waitFor(() => expect(p.onTab).toHaveBeenCalledWith('queue'));
    expect(claims).toBe(2);
  });

  it('says when the contact was claimed and when it is let go, and times the call from the claim', async () => {
    answer = () => ({ card: { ...card, claimed_at: new Date(Date.now() - 2 * 60_000 - 5_000).toISOString() }, why: null, closed: [] });
    show(<MyQueue {...queueProps({ tab: 'work' })} />);
    expect(await screen.findByText(/Vendor follow-up calls · 38 waiting for you · claimed 2 min ago \(auto-release in 18 min\)/)).toBeTruthy();
    expect(screen.getByRole('timer').textContent).toMatch(/^02:0\d$/);
  });

  it('says why nobody is there, and looks again on request', async () => {
    answer = () => ({ card: null, why: 'Nobody is due yet. The next retry or callback is later.', closed: [{ campaign: 'Vendor follow-up calls', why: 'Outside calling hours (09:00 to 17:00, the company\'s time).' }], next_at: '2099-01-01 09:00:00' });
    show(<MyQueue {...queueProps({ tab: 'work' })} />);
    expect(await screen.findByText('Nobody is due yet. The next retry or callback is later.')).toBeTruthy();
    expect(screen.getByText(/Outside calling hours/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Look again/ }));
    await waitFor(() => expect(claims).toBe(2));
  });
});

const detail: CallCampaignDetail = {
  campaign: {
    id: 3, org_id: 1, name: 'Vendor follow-up calls', objective: null, status: 'active', status_label: 'Calling', audience: { lists: [], segments: [], exclude_lists: [], exclude_segments: [] }, script_id: null,
    priority: 'normal', starts_on: null, ends_on: null, calling_from: '09:00', calling_until: '17:00', max_attempts: 3, retry_hours: 24, owner_id: 9, agents: [9, 10], queued: 1006,
    launched_at: '2026-10-01 08:00:00', completed_at: null, created_at: '2026-09-30 08:00:00', updated_at: '2026-10-01 08:00:00',
  },
  results: {
    queued: 1006, waiting: 214, done: 700, removed: 92, ready_now: 120, callbacks: 31, attempted: 800, calls: 1000, connected: 388, leads: 12,
    outcomes: { interested: 47, qualified: 0, call_back: 31, no_answer: 172, busy: 28, voicemail: 40, not_interested: 96, wrong_number: 19, not_decision_maker: 22, bad_number: 14, do_not_call: 11, converted_to_lead: 0 },
    per_contact: 1.25, agents: [], claimed_now: 6, callbacks_due: 9, handed_over: 31,
    live: [
      { user_id: 9, name: 'Sanduni K.', state: 'on_call', since: null, idle_minutes: null, calls_today: 42, reached_today: 17, interested: 4, holding: 'Nimal Perera' },
      { user_id: 10, name: 'Ravindu D.', state: 'wrap_up', since: null, idle_minutes: null, calls_today: 38, reached_today: 14, interested: 2, holding: null },
      { user_id: 11, name: 'Malsha F.', state: 'idle', since: null, idle_minutes: 12, calls_today: 21, reached_today: 6, interested: 1, holding: null },
    ],
  },
  reach: { total: 1006, callable: 214, no_phone: 0, do_not_call: 0, no_consent: 792 },
  closed: null, consent_required: true, can: { manage: true, call: true },
};

describe('a call campaign — the supervisor’s view (W10)', () => {
  it('shows the five figures, who is on a call, the ten outcomes and the consent hold-back', async () => {
    net.apiGet.mockImplementation(async (path: string) => (path === '/api/marketing/calls/campaigns/3' ? detail : routeGet(path)));
    const onQueue = vi.fn();
    show(<CallCampaignView id={3} options={options} onBack={vi.fn()} onQueue={onQueue} />);
    expect(await screen.findByText('In queue')).toBeTruthy();
    expect(screen.getByText('214', { selector: 'b' })).toBeTruthy();
    expect(screen.getByText('Released after 20 min idle')).toBeTruthy();
    expect(screen.getByText('38.8% of calls made')).toBeTruthy();
    expect(screen.getByText('Created as Tasks')).toBeTruthy();
    expect(screen.getByText('31 handed to CRM')).toBeTruthy();
    expect(screen.getByText('On call')).toBeTruthy();
    expect(screen.getByText('Wrap-up')).toBeTruthy();
    expect(screen.getByText('Idle 12 min')).toBeTruthy();
    expect(screen.getByText('with Nimal Perera')).toBeTruthy();
    expect(screen.getByText('Outcomes · 10 types')).toBeTruthy();
    expect(screen.getByText('Not decision maker')).toBeTruthy();
    expect(screen.getByText(/792 of 1,006 contacts have no phone consent and are held back/)).toBeTruthy();
    expect(screen.getByText('09:00–17:00 company time')).toBeTruthy();
    expect(screen.getByText('No answer / busy · 3 × 24 h')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Work the queue/ }));
    expect(onQueue).toHaveBeenCalledWith(3);
    net.request.mockResolvedValueOnce({ data: null, message: 'Paused' });
    fireEvent.click(screen.getByRole('button', { name: /Pause/ }));
    await waitFor(() => expect(net.request).toHaveBeenCalledWith('POST', '/api/marketing/calls/campaigns/3/pause', { body: {} }));
    expect(net.toast).toHaveBeenCalledWith('success', 'Paused');
  });

  it('asks before finishing, and changes the agents on their own', async () => {
    net.apiGet.mockImplementation(async (path: string) => (path === '/api/marketing/calls/campaigns/3' ? detail : routeGet(path)));
    show(<CallCampaignView id={3} options={options} onBack={vi.fn()} onQueue={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Finish/ }));
    expect(await screen.findByText('Finish “Vendor follow-up calls”?')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Finish' }).at(-1)!);
    await waitFor(() => expect(net.request).toHaveBeenCalledWith('POST', '/api/marketing/calls/campaigns/3/finish', { body: {} }));
    fireEvent.click(screen.getByRole('button', { name: /Agents/ }));
    const sheet = within(screen.getByRole('dialog', { name: 'Agents' }));
    fireEvent.click(sheet.getByLabelText('Ravindu D.'));
    fireEvent.click(sheet.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(net.request).toHaveBeenCalledWith('PUT', '/api/marketing/calls/campaigns/3', { body: { agents: [9] } }));
  });
});

describe('call campaigns and scripts', () => {
  it('lists the campaigns, opens one, and starts a new one as a draft', async () => {
    const onOpen = vi.fn();
    const onQueue = vi.fn();
    net.request.mockResolvedValueOnce({ data: { id: 44 }, message: 'Call campaign saved' });
    show(<CallCampaigns org="" options={options} onOpen={onOpen} onQueue={onQueue} />);
    expect(await screen.findByText('Vendor follow-up calls')).toBeTruthy();
    expect(screen.getByText('You call')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Open queue/ }));
    expect(onQueue).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getByRole('button', { name: /New call campaign/ }));
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'Re-permission calls' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    await waitFor(() => expect(net.request).toHaveBeenCalledWith('POST', '/api/marketing/calls/campaigns', { body: { name: 'Re-permission calls', org_id: 1 } }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(44));
  });

  it('writes a script in its six parts', async () => {
    net.request.mockResolvedValueOnce({ data: { id: 8 }, message: 'Script saved' });
    show(<Scripts options={options} />);
    expect(await screen.findByText(/No scripts yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /New script/ }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Website care' } });
    fireEvent.change(screen.getByLabelText('1. Introduction'), { target: { value: 'Hi, this is Sanduni.' } });
    fireEvent.change(screen.getByLabelText('5. Closing'), { target: { value: 'Can I email a quote?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save script' }));
    await waitFor(() =>
      expect(net.request).toHaveBeenCalledWith('POST', '/api/marketing/calls/scripts', {
        body: { name: 'Website care', language: 'en', org_id: 1, sections: { introduction: 'Hi, this is Sanduni.', qualification: '', pitch: '', objections: '', closing: 'Can I email a quote?', next_action: '' } },
      }),
    );
    expect(net.toast).toHaveBeenCalledWith('success', 'Script saved');
  });
});

describe('the Next contact keys', () => {
  it('names the global key the main process holds, and the in-app key clashes with nothing', () => {
    // electron/services/marketing-shortcut.ts holds 'CommandOrControl+Shift+N' (pinned in marketing-native.test.ts).
    expect(NEXT_CONTACT_GLOBAL).toBe('Mod+Shift+N');
    expect(DEFAULT_SHORTCUTS[CLAIM_COMMAND]).toBe('Mod+Alt+N');
    expect(conflicts(DEFAULT_SHORTCUTS).filter((c) => c.commands.includes(CLAIM_COMMAND))).toEqual([]);
    // Ctrl+Shift+N stays Move tab to new window inside WorkSuite.
    expect(DEFAULT_SHORTCUTS['move-tab-to-window']).toBe('Mod+Shift+N');
  });

  it('match every worksuite:// link the module’s manifest declares', async () => {
    const { moduleFor } = await import('../../../src/modules/registry');
    const declared = moduleFor('marketing')?.manifest.deepLinks ?? [];
    expect(declared.length).toBeGreaterThan(0);
    for (const p of declared) expect(DEEP_LINK_RULES.some((r) => r.pattern === p && r.module === 'marketing')).toBe(true);
  });

  it('words when a contact is due as the D01 list does', () => {
    expect(dueLabel(null)).toBe('now');
    expect(dueLabel('2000-01-01 08:00:00')).toBe('now');
    expect(dueLabel('2099-01-01 08:00:00')).toMatch(/2099/);
  });
});
