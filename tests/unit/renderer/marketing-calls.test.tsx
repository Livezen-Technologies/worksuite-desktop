// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('sip.js', () => ({ Invitation: class {}, Inviter: class {}, Registerer: class {}, RegistererState: {}, SessionState: {}, UserAgent: { makeURI: () => undefined } }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => undefined), on: () => () => undefined, hasDesktop: () => false, errorMessage: (e: unknown) => String(e), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/modules/calls/tones', () => ({ playTone: vi.fn(() => ({ stop: vi.fn(), setVolume: vi.fn() })), playOnce: vi.fn(), ringVolume: () => 0.5 }));
const tab = { route: '/marketing/queue', go: vi.fn() };
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => {
    const [path, qs = ''] = tab.route.split('?');
    return { query: new URLSearchParams(qs), path: path!.split('/').filter(Boolean), go: tab.go, navigate: vi.fn(), openInNewTab: vi.fn(), active: true, openLink: vi.fn() };
  },
  useTabTitle: () => undefined,
}));

import { ApiError, apiGet, apiPost } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { toast } from '../../../src/core/toasts';
import { localToUtc } from '../../../src/modules/marketing/lib/format';
import { OUTCOMES, outcomeReady } from '../../../src/modules/marketing/lib/outcomes';
import CallCampaign, { agentStatus, hoursLabel, subOf } from '../../../src/modules/marketing/calls/CallCampaign';
import CallCampaignEditor, { draftOf, inputOf, problemsOf } from '../../../src/modules/marketing/calls/CallCampaignEditor';
import { audienceLabel, callStatus } from '../../../src/modules/marketing/calls/CallCampaigns';
import Queue, { callbackStamp, dueToday, FRESH_WRAP, fillScript, firstName, outcomeInputOf, outcomeMessage, scriptParts } from '../../../src/modules/marketing/calls/Queue';
import { sectionsOf } from '../../../src/modules/marketing/calls/Scripts';
import { setRegional } from '../../../src/core/time';

/**
 * Call campaigns and the agent's workspace (WS-MKT-SRS-001 MKT-CAL, WF-12/13): the ten outcomes, the B-5 refusal
 * without marketing.call.make, one atomic claim for `?next=1` (AC-08), the supervisor's outcome counts and the
 * contacts held back for want of phone consent (AC-12).
 */
const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

const notOffered = () => new ApiError(404, 'The server answered 404.', null);
/** A UTC stamp without a zone, `minutes` from now. */
const stamp = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString().slice(0, 19).replace('T', ' ');

const script = {
  id: 4,
  name: 'Website care',
  version: 3,
  sections: {
    opening: 'Hi {{first_name}}, this is {{agent_name}} from Livezen Technologies. Is now a good time for two minutes?',
    reason: 'You are listed as a vendor with us — we now offer website care packages for suppliers.',
    qualify: 'Does {{organisation}} have a company website today?',
    pitch: 'Plans start with monitoring, daily backups and monthly reports.',
    objections: '“We have an IT person” → we work alongside them…',
    close: 'Can I email a quote and book a 15-minute call?',
  },
  campaigns_count: 2,
  updated_at: '2026-10-01 09:00:00',
};

const contact = {
  id: 41,
  name: 'Nimal Perera',
  first_name: 'Nimal',
  last_name: 'Perera',
  email: 'nimal@ceylonagri.lk',
  phone: '+94771234521',
  organisation_id: 3,
  organisation: 'Ceylon Agri Exports',
  job_title: 'Procurement Manager',
  tags: [],
  owner: null,
  source: 'import',
  time_zone: 'Asia/Colombo',
  email_consent: 'subscribed',
  phone_consent: 'consented',
  email_suppressed: false,
  do_not_call: false,
  created_at: '2026-09-12 10:02:00',
};

const campaign = {
  id: 7,
  name: 'Vendor follow-up calls',
  status: 'running',
  audience: { kind: 'list', id: 3, name: 'Vendors 2026' },
  contacts_count: 1006,
  in_queue: 214,
  claimed_now: 6,
  reached: 388,
  interested: 47,
  callbacks_due: 9,
  excluded_no_consent: 792,
  requires_phone_consent: true,
  hours: { from: '09:00', to: '17:00', contact_local: true },
  retries: { max_attempts: 3, delay_hours: 24 },
  claim_release_minutes: 20,
  script: { id: 4, name: 'Website care', version: 3 },
  agents: [
    { user_id: 5, name: 'Sanduni K.', status: 'on_call', calls_today: 42, reached: 17, interested: 4, avg_seconds: 192, can_call: true },
    { user_id: 6, name: 'Malsha F.', status: 'idle', idle_minutes: 12, calls_today: 21, reached: 6, interested: 1, avg_seconds: 140, can_call: true },
  ],
  outcomes: { interested: 47, not_interested: 96, callback: 31, no_answer: 172, busy: 28, voicemail: 40, wrong_number: 19, do_not_call: 11, not_decision_maker: 22 },
  created_at: '2026-09-20 09:00:00',
};

const settings = {
  sending: { route: 'marketing', routes: [], hourly_pace: 1200, relay_priority: 8, bounce_guard_percent: 5, max_test_recipients: 5, default_time_zone: 'Asia/Colombo' },
  calls: { hours_from: '09:00', hours_to: '17:00', contact_local: true, max_attempts: 3, retry_delay_hours: 24, claim_release_minutes: 20 },
  consent: { require_phone_consent: true, double_opt_in: false },
  policies: { detect_machine_opens: true, one_click_unsubscribe: true, notify_owner: true },
  can_edit: false,
};

/** What the agent holds after a claim: the server's own queue, read again. */
let held: unknown = null;

beforeEach(() => {
  held = null;
  tab.route = '/marketing/queue';
  tab.go.mockReset();
  vi.mocked(toast).mockReset();
  vi.mocked(apiGet).mockReset();
  vi.mocked(apiPost).mockReset();
  vi.mocked(apiGet).mockImplementation((async (path: string) => {
    switch (path) {
      case '/api/marketing/queue':
        return {
          waiting: 38,
          campaigns: [{ id: 7, name: 'Vendor follow-up calls', waiting: 38 }],
          items: [{ id: 1, contact: { id: 52, name: 'Saman Kumara', organisation: 'Lanka Pack', phone: null }, campaign: { id: 7, name: 'Vendor follow-up calls' }, attempt: 1, max_attempts: 3, reason: 'New', due_at: null }],
          claim: held,
        };
      case '/api/marketing/templates':
        return [{ id: 2, name: 'Care packages quote', kind: 'saved', blocks: [], updated_at: null }];
      case '/api/marketing/call-campaigns/7':
        return campaign;
      case '/api/marketing/settings':
        return settings;
      case '/api/marketing/lists':
        return [{ id: 3, name: 'Vendors 2026', description: null, members_count: 1006, phone_consented_count: 214, created_at: null }];
      case '/api/marketing/segments':
        return [];
      case '/api/marketing/scripts':
        return [script];
      case '/api/marketing/agents':
        return [
          { user_id: 5, name: 'Sanduni K.', can_call: false },
          { user_id: 6, name: 'Ravindu D.', can_call: false },
        ];
      default:
        // The live board, callbacks and anything else this server does not offer yet.
        throw notOffered();
    }
  }) as never);
  app.set({ bootstrap: { permissions: ['marketing.call.make'], organizations: [], user: { name: 'Sanduni Kumari' } } as never, organizationId: '1', apps: [] });
});

afterEach(() => cleanup());

// Dates and times follow the reader's regional settings (core/time); these read as a Sri Lankan, en-GB, 24-hour reader's.
beforeAll(() => setRegional({ locale: 'en-GB', timeFormat: '24', timezone: 'Asia/Colombo' }));
afterAll(() => setRegional({}));

describe('outcomes and the wrap-up', () => {
  it('has ten unique outcomes, and a callback needs its time', () => {
    expect(OUTCOMES).toHaveLength(10);
    expect(new Set(OUTCOMES.map((o) => o.id)).size).toBe(10);
    expect(outcomeReady(null, null)).toBe(false);
    expect(outcomeReady('callback', null)).toBe(false);
    expect(outcomeReady('callback', '2026-10-07 04:30:00')).toBe(true);
    expect(outcomeReady('no_answer', null)).toBe(true);
  });

  it('builds what Save outcome sends, and holds it back while something is missing', () => {
    const now = new Date(2026, 9, 6, 9, 0);
    expect(outcomeInputOf(FRESH_WRAP, now)).toBeNull();
    expect(outcomeInputOf({ ...FRESH_WRAP, outcome: 'callback', date: '2026-10-07' }, now)).toBeNull();
    expect(outcomeInputOf({ ...FRESH_WRAP, outcome: 'callback', date: '2026-10-05', time: '10:30' }, now)).toBeNull();
    expect(outcomeInputOf({ ...FRESH_WRAP, outcome: 'callback', date: '2026-10-07', time: '10:30', notes: '  Call after 2 pm ' }, now)).toEqual({
      outcome: 'callback',
      notes: 'Call after 2 pm',
      callback_at: localToUtc('2026-10-07', '10:30'),
      handover: false,
      handover_notes: null,
      follow_up_template_id: null,
    });
    expect(outcomeInputOf({ ...FRESH_WRAP, outcome: 'interested', followUp: true }, now)).toBeNull();
    expect(outcomeInputOf({ ...FRESH_WRAP, outcome: 'interested', handover: true, handoverNotes: ' Wants the Standard plan ', followUp: true, templateId: 2 }, now)).toMatchObject({
      handover: true,
      handover_notes: 'Wants the Standard plan',
      follow_up_template_id: 2,
      callback_at: null,
    });
    expect(callbackStamp('', '10:30', now).problem).toMatch(/day and time/);
    expect(callbackStamp('2026-10-06', '08:00', now).problem).toMatch(/later than now/);
  });

  it('says what saving did', () => {
    const now = new Date(2026, 9, 6, 9, 0);
    expect(outcomeMessage('do_not_call', { saved: true }, now)).toBe('Do not call — the number is suppressed for the whole company.');
    expect(outcomeMessage('callback', { saved: true, task_id: 3 }, now)).toBe('Callback booked as a Task.');
    expect(outcomeMessage('interested', { saved: true, lead: { id: 1, number: 'LD-00412', created: true } }, now)).toBe('Saved: interested. Handed to CRM as lead LD-00412.');
    expect(outcomeMessage('interested', { saved: true, lead: { id: 1, number: 'LD-00412', created: false } }, now)).toMatch(/Already lead LD-00412/);
    expect(outcomeMessage('no_answer', { saved: true, next_attempt_at: localToUtc('2026-10-07', '10:30') }, now)).toBe('No answer. The queue tries again tomorrow 10:30.');
  });

  it('fills a script’s tags and leaves the unknown ones in sight, in any script', () => {
    const vars = { first_name: 'නිමල්', organisation: null, agent_name: 'Sanduni' };
    expect(fillScript('Hi {{first_name}}, this is {{ agent_name }} from Livezen.', vars)).toBe('Hi නිමල්, this is Sanduni from Livezen.');
    expect(scriptParts('Does {{organisation}} have a site?', vars)).toEqual([{ text: 'Does ' }, { tag: '{{organisation}}', value: null }, { text: ' have a site?' }]);
    expect(fillScript('No tags here', vars)).toBe('No tags here');
    expect(firstName('Sanduni Kumari')).toBe('Sanduni');
    expect(firstName('  ')).toBeNull();
    expect(sectionsOf({ opening: 'Hi', close: null })).toEqual({ opening: 'Hi', reason: '', qualify: '', pitch: '', objections: '', close: '' });
  });

  it('lists the callbacks due by tonight, overdue first', () => {
    const now = new Date(2026, 9, 6, 9, 0);
    const cb = (id: number, date: string, time: string) => ({ id, queue_item_id: id, contact: { id, name: `C${id}`, organisation: null, phone: null }, campaign: { id: 7, name: 'x' }, due_at: localToUtc(date, time)!, note: null, task_id: null });
    expect(dueToday([cb(1, '2026-10-06', '14:00'), cb(2, '2026-10-07', '10:30'), cb(3, '2026-10-05', '16:00')], now).map((c) => c.id)).toEqual([3, 1]);
  });
});

describe('call campaign helpers', () => {
  it('names states, audiences, agents, hours and the campaign line', () => {
    expect(callStatus('running')).toEqual({ label: 'Running', tone: 'success' });
    expect(callStatus('paused').tone).toBe('warning');
    expect(audienceLabel({ kind: 'segment', id: 1, name: 'Engaged vendors' })).toBe('Segment · Engaged vendors');
    expect(audienceLabel(null)).toBe('—');
    expect(agentStatus({ status: 'idle', idle_minutes: 12 })).toEqual({ label: 'Idle 12 min', tone: 'warning' });
    expect(agentStatus({ status: 'wrap_up' }).label).toBe('Wrap-up');
    expect(hoursLabel({ from: '09:00:00', to: '17:00:00', contact_local: true })).toBe('09:00–17:00 contact local');
    expect(subOf(campaign as never)).toBe('Call campaign · running · 1,006 contacts · retries 3 × every 24 h');
  });

  it('starts a new campaign from the company’s call settings and checks it before saving', () => {
    const d = draftOf(null, settings.calls);
    expect(d).toMatchObject({ name: '', kind: 'list', audienceId: null, from: '09:00', to: '17:00', local: true, attempts: '3', delay: '24', agentIds: [] });
    expect(Object.keys(problemsOf(d)).sort()).toEqual(['audience', 'name']);
    expect(problemsOf({ ...d, name: 'x', audienceId: 3, from: '17:00', to: '09:00', attempts: '6', delay: '0' })).toEqual({ hours: 'Calling must end after it starts.', attempts: 'From 1 to 5 attempts.', delay: 'At least 1 hour.' });
    expect(inputOf({ ...d, name: ' Vendor calls ', audienceId: 3, scriptId: 4, agentIds: [5] })).toEqual({
      name: 'Vendor calls',
      audience: { kind: 'list', id: 3 },
      hours: { from: '09:00', to: '17:00', contact_local: true },
      retries: { max_attempts: 3, delay_hours: 24 },
      script_id: 4,
      agent_ids: [5],
    });
    expect(draftOf(campaign as never, null)).toMatchObject({ name: 'Vendor follow-up calls', audienceId: 3, scriptId: 4, agentIds: [5, 6] });
  });
});

describe('my call queue', () => {
  it('explains B-5 without marketing.call.make and never claims', async () => {
    app.set({ bootstrap: { permissions: [], organizations: [], user: { name: 'Sanduni Kumari' } } as never });
    tab.route = '/marketing/queue?next=1';
    wrap(<Queue />);
    expect(screen.getByText(/so you can’t claim contacts\. Ask an administrator to grant it to the call-agent role\./)).toBeTruthy();
    expect(screen.getByText('marketing.call.make')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 30));
    expect(apiPost).not.toHaveBeenCalled();
    expect(apiGet).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Next contact' })).toBeNull();
  });

  it('claims the next contact once for ?next=1, then drops the parameter', async () => {
    tab.route = '/marketing/queue?next=1';
    vi.mocked(apiPost).mockImplementation((async (path: string) => {
      if (path !== '/api/marketing/queue/next') throw notOffered();
      held = { id: 901, campaign: { id: 7, name: 'Vendor follow-up calls' }, contact, attempt: 2, max_attempts: 3, last_outcome: 'no_answer', claimed_at: stamp(-2), release_at: stamp(18), script, callback_note: null };
      return held;
    }) as never);
    wrap(<Queue />);
    const outcomes = await screen.findByRole('radiogroup', { name: 'Outcome' });
    expect(within(outcomes).getAllByRole('radio')).toHaveLength(10);
    expect(apiPost).toHaveBeenCalledWith('/api/marketing/queue/next', { campaign_id: null }, { org: '1' });
    expect(tab.go).toHaveBeenCalledWith('/marketing/queue');
    // The script, its tags filled from the contact and the agent.
    expect(screen.getByText('Script · Website care (v3)')).toBeTruthy();
    expect(screen.getByText(/Hi Nimal, this is Sanduni from Livezen Technologies\./)).toBeTruthy();
    expect(screen.getByText('Ceylon Agri Exports · attempt 2 of 3 · last: no answer')).toBeTruthy();
    expect(screen.getByText(/Vendor follow-up calls · 38 waiting for you · claimed 2 min ago \(auto-release in 1[89] min\)/)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 60));
    expect(vi.mocked(apiPost).mock.calls.filter(([p]) => p === '/api/marketing/queue/next')).toHaveLength(1);
  });

  it('says so when nobody is waiting', async () => {
    vi.mocked(apiPost).mockResolvedValue(null as never);
    wrap(<Queue />);
    expect(await screen.findByText('Saman Kumara')).toBeTruthy();
    expect(screen.getByText(/All campaigns · 38 waiting for you · Ctrl\+Alt\+N claims the next contact from anywhere/)).toBeTruthy();
    expect(await screen.findByText(/can’t list your callbacks here yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next contact' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('info', 'Nobody is waiting in this queue right now.'));
  });
});

describe('the supervisor’s view', () => {
  it('shows every outcome count, and why contacts are held back', async () => {
    tab.route = '/marketing/calls/7';
    wrap(<CallCampaign id={7} />);
    expect(await screen.findByText('Call campaign · running · 1,006 contacts · retries 3 × every 24 h')).toBeTruthy();
    const panel = screen.getByRole('heading', { name: 'Outcomes · 10 types' }).closest('section')!;
    const tiles = within(panel).getAllByRole('listitem').map((li) => li.textContent);
    expect(tiles).toEqual(OUTCOMES.map((o) => `${o.label}${String((campaign.outcomes as Record<string, number>)[o.id] ?? 0)}`));
    expect(tiles).toContain('Bad number0');
    expect(screen.getByText('792 of 1,006 contacts have no phone consent and are held back. Record a lawful basis or collect consent to release them.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Consent ledger' }));
    expect(tab.go).toHaveBeenCalledWith('/marketing/consent?tab=ledger');
    expect(await screen.findByText('Live status needs a newer Marketing module on the server')).toBeTruthy();
    expect(screen.getByText('Idle 12 min')).toBeTruthy();
    expect(screen.getByText('38.6% of contacts')).toBeTruthy();
  });
});

describe('setting up a call campaign', () => {
  it('warns that nobody can claim (B-5), then saves and starts', async () => {
    tab.route = '/marketing/calls/new';
    vi.mocked(apiPost).mockImplementation((async (path: string) => {
      if (path === '/api/marketing/call-campaigns') return { ...campaign, id: 9, status: 'draft' };
      if (path === '/api/marketing/call-campaigns/9/start') return { ...campaign, id: 9 };
      throw notOffered();
    }) as never);
    wrap(<CallCampaignEditor id={null} />);
    expect(await screen.findByText('Nobody holds marketing.call.make — the campaign can start, but nobody can claim from its queue. Grant it to the call-agent role in Roles & permissions.')).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: /Sanduni K\./ }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('Yes (company setting)')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save and start' }));
    expect(await screen.findByText('Give the campaign a name.')).toBeTruthy();
    expect(apiPost).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('textbox', { name: /^Name/ }), { target: { value: 'Vendor follow-up calls' } });
    fireEvent.click(screen.getByRole('combobox', { name: 'List' }));
    fireEvent.click(await screen.findByRole('option', { name: /Vendors 2026/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save and start' }));
    await waitFor(() => expect(tab.go).toHaveBeenCalledWith('/marketing/calls/9'));
    expect(apiPost).toHaveBeenNthCalledWith(
      1,
      '/api/marketing/call-campaigns',
      { name: 'Vendor follow-up calls', audience: { kind: 'list', id: 3 }, hours: { from: '09:00', to: '17:00', contact_local: true }, retries: { max_attempts: 3, delay_hours: 24 }, script_id: null, agent_ids: [] },
      { org: '1' },
    );
    expect(apiPost).toHaveBeenNthCalledWith(2, '/api/marketing/call-campaigns/9/start');
  });
});
