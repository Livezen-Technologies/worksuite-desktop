// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as Bridge from '../../../src/core/bridge';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../../src/core/bridge', async (orig) => ({ ...(await orig<typeof Bridge>()), call: vi.fn(async () => true) }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/tabs', () => ({ navigate: vi.fn() }));

window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;

const { apiGet, apiGetMeta, apiPost, ApiError } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { toast } = await import('../../../src/core/toasts');
const { navigate } = await import('../../../src/core/tabs');
const { app } = await import('../../../src/core/app-state');
const { default: Proposals } = await import('../../../src/modules/crm/Proposals');
const { default: Estimates } = await import('../../../src/modules/crm/Estimates');
const { ApprovalsPanel } = await import('../../../src/modules/crm/Approvals');
const { ProposalLiveWatch } = await import('../../../src/modules/crm/LiveWatch');
const { LiveWatcher, nextLiveDelay, liveText, proposalActions, readingTime } = await import('../../../src/modules/crm/proposalLogic');

/*
 * Proposals and estimates (CRM SRS v1.3 §17) against payloads shaped as the
 * contract gives them: the list's engagement columns and status filter, the
 * preview, the "customer is reading" poll announcing each viewing session
 * once, the approver's approve and send back, and an estimate's Convert and
 * Send with the server's 409s.
 */
const get = vi.mocked(apiGet);
const getMeta = vi.mocked(apiGetMeta);
const post = vi.mocked(apiPost);

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function signIn(perms = ['crm.view', 'crm.manage'], network: 'ONLINE' | 'OFFLINE' = 'ONLINE') {
  app.set({
    organizationId: '2',
    status: { network } as never,
    bootstrap: { permissions: perms, organizations: [{ id: '2', name: 'CreativeFX' }], user: { organizationName: 'CreativeFX' } } as never,
  });
}

const can = { edit: true, send: true, approve: false, withdraw: true, accept: true, delete: false };
const row = (over: Record<string, unknown> = {}) => ({
  id: 21, number: 'PRP-0021', org_id: 2, title: 'Cold Room Upgrade', status: 'viewed',
  deal: { id: 7, name: 'Cold Room Upgrade', stage: 'Proposal' }, account: { id: 9, name: 'Highland Traders Holdings' }, contact: { id: 3, name: 'Nadeesha Perera', email: 'n@example.com' },
  template_id: 1, owner: { id: 5, name: 'Amaya E.' }, currency: 'LKR', total: 3181900, valid_until: '2026-10-25', current_version: 2, sent_version: 2, sent_at: '2026-10-12T04:00:00Z', accepted_at: null,
  engagement: { opens: 4, last_opened_at: '2026-10-14T05:11:00Z', viewing_now: true, time_seconds: 750, questions_open: 1 },
  approval: { required: false, status: 'none', rules: [], note: null, decided_by: null }, estimate_id: null, quote_id: null, can, ...over,
});

const detail = (over: Record<string, unknown> = {}) => ({
  ...row(over),
  sections: [
    { id: 1, kind: 'cover', title: 'Cover', body: { html: '<p>For Highland Traders</p>' }, sort: 1 },
    { id: 2, kind: 'text', title: 'Scope', body: { html: '<p>Two cold rooms</p><p>Install and commission</p>' }, sort: 2 },
    { id: 3, kind: 'pricing', title: 'Pricing', body: { source: null, packages: [{ key: 'ess', name: 'Essential', total: 2720000 }, { key: 'rec', name: 'Recommended', total: 2989000, default: true }], lines: [{}, {}], optional: [{}] }, sort: 3 },
    { id: 4, kind: 'terms', title: 'Hidden terms', body: { html: '<p>x</p>' }, hidden: true, sort: 4 },
  ],
  versions: [{ version: 2, sent_at: '2026-10-12T04:00:00Z', sent_by: 'Amaya E.', approved_by: null, pdf_url: null }],
  share_url: 'https://ws.example.com/p/abc',
  ...over,
});

const EVENTS = {
  events: [],
  sections_time: [{ section_id: 3, title: 'Pricing', seconds: 372 }, { section_id: 2, title: 'Scope', seconds: 185 }],
  viewers: [{ viewer: 'Asanka Dias', device: 'Mac', location: 'Colombo', opens: 2, last_at: '2026-10-14T05:11:00Z' }, { viewer: 'Nadeesha Perera', device: null, location: null, opens: 2, last_at: '2026-10-14T05:01:00Z' }],
  questions: [{ id: 8, body: 'Can install be split into two phases?', viewer: 'Asanka Dias', at: '2026-10-14T05:14:00Z', replies: [{ id: 1, body: 'Yes — see the timeline.', by: 'Amaya E.', at: '2026-10-14T05:20:00Z' }] }],
};

beforeEach(() => {
  vi.clearAllMocks();
  signIn();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Proposals list', () => {
  it('shows each proposal with its engagement and filters by status, reading the envelope meta', async () => {
    getMeta.mockResolvedValue({ data: [row(), row({ id: 20, number: 'PRP-0020', status: 'sent', account: { id: 4, name: 'Orient Textiles' }, engagement: { opens: 0, last_opened_at: null, viewing_now: false, time_seconds: 0, questions_open: 0 } })], offline: false, cachedAt: null, meta: { total: 47, page: 1, per_page: 50, has_more: false, counts: { viewed: 5, sent: 9, pending_approval: 1 }, kpi: { open_value: 12400000, viewed_rate: 64, accepted_rate: 31 } } } as never);
    get.mockResolvedValue([] as never);
    wrap(<Proposals openId={null} onOpen={() => undefined} />);
    const first = await screen.findByText('PRP-0021');
    const r21 = first.closest('[role="row"]') as HTMLElement;
    expect(within(r21).getByText('Viewed')).toBeTruthy();
    expect(within(r21).getByText('4')).toBeTruthy();
    expect(within(r21).getByText('now')).toBeTruthy();
    expect(within(r21).getByText('1')).toBeTruthy();
    const r20 = screen.getByText('PRP-0020').closest('[role="row"]') as HTMLElement;
    expect(within(r20).getByText('not opened')).toBeTruthy();
    expect(within(r20).queryByText('now')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('47 proposals');
    expect(screen.getByRole('status').textContent).toContain('64% viewed');
    expect(getMeta).toHaveBeenCalledWith('/api/crm/proposals', expect.objectContaining({ org_id: 2, page: 1 }), expect.anything());

    fireEvent.click(screen.getByRole('tab', { name: /Awaiting approval/ }));
    await waitFor(() => expect(getMeta).toHaveBeenLastCalledWith('/api/crm/proposals', expect.objectContaining({ status: 'pending_approval', org_id: 2 }), expect.anything()));
  });
});

describe('Proposal preview', () => {
  const routesFor = (d: unknown) =>
    get.mockImplementation(async (path: string) => {
      if (path === '/api/crm/proposals/21') return { proposal: d } as never;
      if (path === '/api/crm/proposals/21/events') return EVENTS as never;
      return [] as never;
    });

  it('shows the sections, pricing, version and engagement, and the actions its can flags allow', async () => {
    getMeta.mockResolvedValue({ data: { proposals: [row()] }, offline: false, cachedAt: null } as never);
    routesFor(detail());
    wrap(<Proposals openId={21} onOpen={() => undefined} />);
    const pane = await screen.findByRole('region', { name: 'Proposal PRP-0021' });
    const p = within(pane);
    expect(p.getByText('v2')).toBeTruthy();
    expect(within(p.getByRole('region', { name: 'Sections' })).getByText('Scope')).toBeTruthy();
    expect(p.getByText(/Two cold rooms\s+Install and commission/)).toBeTruthy();
    expect(p.queryByText('Hidden terms')).toBeNull();
    const pricing = p.getByLabelText('Pricing');
    expect(within(pricing).getByText(/Recommended/)).toBeTruthy();
    expect(within(pricing).getByText('LKR 2,989,000.00')).toBeTruthy();
    expect(pricing.textContent).toContain('2 lines · 1 optional');
    expect(await p.findByText(/Asanka Dias/, { selector: 'span' })).toBeTruthy();
    expect(p.getByText(/2 people/)).toBeTruthy();
    expect(p.getByText('12m 30s')).toBeTruthy();
    expect(p.getByText('6m 12s')).toBeTruthy();
    expect(p.getByText(/Can install be split into two phases\?/)).toBeTruthy();
    expect(p.getByText(/Yes — see the timeline\./)).toBeTruthy();
    expect(p.getByRole('button', { name: /Remind/ })).toBeTruthy();
    expect(p.getByRole('button', { name: /Duplicate/ })).toBeTruthy();
    expect(p.getByRole('button', { name: 'Withdraw' })).toBeTruthy();
    expect(p.queryByRole('button', { name: /Approve/ })).toBeNull();

    post.mockResolvedValue({} as never);
    fireEvent.click(p.getByRole('button', { name: /Remind/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/crm/proposals/21/remind'));
    fireEvent.click(p.getByRole('button', { name: /Edit on web/ }));
    expect(call).toHaveBeenCalledWith('app:openInBrowser', { path: '/crm?view=proposals&proposal=21' });

    fireEvent.click(p.getByRole('button', { name: 'Reply' }));
    fireEvent.change(screen.getByLabelText('Reply to Asanka Dias'), { target: { value: 'Two phases works.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/crm/proposals/21/questions/8/reply', { body: 'Two phases works.' }));
  });

  it('turns the writing actions off offline, and hides what can does not allow', async () => {
    signIn(['crm.view', 'crm.manage'], 'OFFLINE');
    getMeta.mockResolvedValue({ data: [row()], offline: false, cachedAt: null } as never);
    routesFor(detail({ can: { ...can, withdraw: false, edit: false } }));
    wrap(<Proposals openId={21} onOpen={() => undefined} />);
    const pane = await screen.findByRole('region', { name: 'Proposal PRP-0021' });
    const p = within(pane);
    expect((p.getByRole('button', { name: /Remind/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((p.getByRole('button', { name: /Duplicate/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((p.getByRole('button', { name: /Open in web/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(p.queryByRole('button', { name: 'Withdraw' })).toBeNull();
  });

  it('approves or sends back a proposal waiting for approval from its preview', async () => {
    getMeta.mockResolvedValue({ data: [row()], offline: false, cachedAt: null } as never);
    routesFor(detail({ status: 'pending_approval', can: { ...can, approve: true }, approval: { required: true, status: 'pending', rules: [{ id: 1, label: 'Discount over 15%' }], note: null, decided_by: null } }));
    post.mockResolvedValue({} as never);
    wrap(<Proposals openId={21} onOpen={() => undefined} />);
    const pane = await screen.findByRole('region', { name: 'Proposal PRP-0021' });
    expect(within(pane).getByText(/Discount over 15%/)).toBeTruthy();
    fireEvent.click(within(pane).getByRole('button', { name: /Send back/ }));
    const send = screen.getAllByRole('button', { name: 'Send back' }).at(-1) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Bring the discount to 10%.' } });
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/crm/proposals/21/send-back', { note: 'Bring the discount to 10%.' }));
    expect(toast).toHaveBeenCalledWith('success', 'PRP-0021 sent back.');
  });
});

describe('Approvals waiting for me', () => {
  const QUEUE = [
    { id: 1, doc: 'proposal', doc_id: 19, number: 'PRP-0019', title: 'Supermarket chillers', value: 7400000, rule: { id: 2, label: 'Value over LKR 5M' }, requested_by: { id: 5, name: 'Amaya E.' }, requested_at: '2026-10-14T03:00:00Z' },
    { id: 2, doc: 'estimate', doc_id: 31, number: 'EST-00031', title: 'Warehouse racking', value: 900000, rule: 'Discount over 15%', requested_by: 'Kasun P.', requested_at: '2026-10-14T02:00:00Z' },
  ];

  it('approves a proposal with an optional note and sends an estimate back with a required one', async () => {
    signIn(['crm.view', 'crm.proposals.approve']);
    get.mockResolvedValue({ approvals: QUEUE } as never);
    post.mockResolvedValue({} as never);
    const onOpen = vi.fn();
    wrap(<ApprovalsPanel onOpen={onOpen} />);
    expect(await screen.findByText('Waiting for your approval · 2')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/api/crm/approvals', expect.objectContaining({ status: 'pending', org_id: 2 }), expect.anything());

    const prp = screen.getByText(/PRP-0019/).closest('[data-approval]') as HTMLElement;
    fireEvent.click(within(prp).getByRole('button', { name: /Approve/ }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Approve' }).at(-1)!);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/crm/proposals/19/approve', {}));

    const est = screen.getByText(/EST-00031/).closest('[data-approval]') as HTMLElement;
    fireEvent.click(within(est).getByRole('button', { name: 'Send back' }));
    const confirm = screen.getAllByRole('button', { name: 'Send back' }).at(-1) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Margin is too thin.' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/crm/estimates/31/approval', { decision: 'send_back', note: 'Margin is too thin.' }));

    fireEvent.click(screen.getByText(/EST-00031/));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ doc: 'estimate', doc_id: 31 }));
  });

  it('is not shown to somebody who cannot approve', async () => {
    signIn(['crm.view', 'crm.proposals.view']);
    get.mockResolvedValue(QUEUE as never);
    const { container } = wrap(<ApprovalsPanel onOpen={() => undefined} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
    expect(get).not.toHaveBeenCalled();
  });
});

describe('The customer is reading', () => {
  const v = (over: Record<string, unknown> = {}) => ({ proposal_id: 21, number: 'PRP-0021', title: 'Cold Room Upgrade', account: 'Highland Traders', viewer: 'Asanka Dias', section: 'Pricing', since: '2026-10-14T05:10:00Z', ...over });

  it('announces each viewing session once, and again only for a new session', () => {
    const w = new LiveWatcher(5 * 60_000);
    const t = 1_000_000;
    expect(w.update([v()], t)).toHaveLength(1);
    expect(w.update([v({ section: 'Terms' })], t + 30_000)).toHaveLength(0);
    // A missed heartbeat between polls is the same session.
    expect(w.update([], t + 60_000)).toHaveLength(0);
    expect(w.update([v()], t + 90_000)).toHaveLength(0);
    // Gone long enough, then back: the same since stays forgotten only once it has aged out.
    expect(w.update([], t + 10 * 60_000)).toHaveLength(0);
    expect(w.update([v()], t + 11 * 60_000)).toHaveLength(1);
    // A new session (a new since) on the same proposal, and a second proposal.
    expect(w.update([v(), v({ since: '2026-10-14T06:00:00Z' }), v({ proposal_id: 22, number: 'PRP-0022' })], t + 12 * 60_000)).toHaveLength(2);
  });

  it('words the alert and backs off when hidden, offline or failing', () => {
    expect(liveText(v())).toBe('Asanka Dias is reading PRP-0021 — Pricing');
    expect(liveText(v({ viewer: null, section: null }))).toBe('Highland Traders is reading PRP-0021');
    expect(nextLiveDelay({ visible: true, online: true, failures: 0 })).toBe(30_000);
    expect(nextLiveDelay({ visible: false, online: true, failures: 0 })).toBe(120_000);
    expect(nextLiveDelay({ visible: true, online: false, failures: 0 })).toBeNull();
    expect(nextLiveDelay({ visible: true, online: true, failures: 2 })).toBe(120_000);
    expect(nextLiveDelay({ visible: true, online: true, failures: 9 })).toBe(600_000);
    expect(readingTime(750)).toBe('12m 30s');
    expect(readingTime(50)).toBe('50s');
  });

  it('polls every 30 s and toasts a session once; Open goes to the Proposals tab', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    get.mockResolvedValue({ viewing: [v()] } as never);
    render(<ProposalLiveWatch />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(get).toHaveBeenCalledWith('/api/crm/proposals/live');
    expect(toast).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast).mock.calls[0]![1]).toContain('Asanka Dias is reading PRP-0021 — Pricing');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(toast).toHaveBeenCalledTimes(1);
    vi.mocked(toast).mock.calls[0]![2]!.run();
    expect(navigate).toHaveBeenCalledWith('/crm?tab=proposals&proposal=21');

    get.mockResolvedValue({ viewing: [v(), v({ proposal_id: 22, number: 'PRP-0022', viewer: 'Ruwan' })] } as never);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(toast).toHaveBeenCalledTimes(2);
    expect(call).not.toHaveBeenCalledWith('notifications:reminder', expect.anything());
  });

  it('raises the system notification when the window is not in front, and stops for a server without the endpoint', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    get.mockResolvedValueOnce({ viewing: [v()] } as never).mockRejectedValue(new ApiError(404, 'Not found', null));
    render(<ProposalLiveWatch />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(call).toHaveBeenCalledWith('notifications:reminder', expect.objectContaining({ title: 'Asanka Dias is reading PRP-0021 — Pricing', body: 'Highland Traders · Cold Room Upgrade', route: '/crm?tab=proposals&proposal=21' }));
    expect(toast).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(get).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('does not poll offline or without the proposals permission', async () => {
    vi.useFakeTimers();
    signIn(['crm.view'], 'ONLINE');
    const a = render(<ProposalLiveWatch />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    a.unmount();
    signIn(['crm.manage'], 'OFFLINE');
    render(<ProposalLiveWatch />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(get).not.toHaveBeenCalled();
  });
});

describe('proposalActions', () => {
  it('follows can and the status, and nothing writes offline', () => {
    const p = { status: 'viewed' as const, can: { send: true, withdraw: true, approve: false }, approval: null };
    expect(proposalActions(p, { online: true, manage: true })).toMatchObject({ remind: true, withdraw: true, duplicate: true, approve: false, web: true });
    expect(proposalActions(p, { online: false, manage: true })).toMatchObject({ remind: false, withdraw: false, duplicate: false, web: false });
    expect(proposalActions({ status: 'pending_approval', can: { approve: true }, approval: null }, { online: true, manage: false })).toMatchObject({ approve: true, sendBack: true, remind: false, duplicate: false });
  });
});

describe('Estimates', () => {
  const EST = { id: 31, number: 'EST-00031', org_id: 2, title: 'Warehouse racking', mode: 'range', status: 'approved', subject: { type: 'lead', id: 4, label: 'Lahiru Madushanka' }, currency: 'LKR', range_from: 400000, range_to: 600000, confidence_pct: 70, mid: 500000, assumptions: 'Site survey done', valid_until: '2026-11-01', owner: { id: 5, name: 'Amaya E.' }, total: null, cost: 300000, margin: 200000, margin_pct: 40, converted: null, revision: 1, approval: null, can: { edit: true, send: true, approve: false, convert: true, delete: false } };

  it('lists estimates and shows one read-only with Edit on web', async () => {
    getMeta.mockResolvedValue({ data: { estimates: [EST], meta: { total: 1, page: 1, has_more: false, counts: { approved: 1 } } }, offline: false, cachedAt: null } as never);
    const onOpen = vi.fn();
    wrap(<Estimates openId={null} onOpen={onOpen} onOpenQuote={() => undefined} onOpenProposal={() => undefined} />);
    expect(await screen.findByText('EST-00031')).toBeTruthy();
    expect(screen.getByText('LKR 400,000.00 – 600,000.00')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('1 approved');
    fireEvent.click(screen.getByText('EST-00031'));
    expect(onOpen).toHaveBeenCalledWith(31);
  });

  it('converts, converting the lead to a deal when the server asks for it', async () => {
    get.mockResolvedValue({ estimate: { ...EST, subject: { type: 'account', id: 9, label: 'Highland' } } } as never);
    post.mockRejectedValueOnce(new ApiError(409, 'The lead must become a deal first.', 'lead_needs_deal')).mockResolvedValueOnce({ type: 'quote', id: 77, number: 'QUO-0077' } as never);
    const onOpenQuote = vi.fn();
    wrap(<Estimates openId={31} onOpen={() => undefined} onOpenQuote={onOpenQuote} onOpenProposal={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: /Convert/ }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Convert' }).at(-1)!);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/crm/estimates/31/convert', { to: 'quote' }));
    expect(await screen.findByText('Convert the lead to a deal first')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Convert' }).at(-1)!);
    await waitFor(() => expect(post).toHaveBeenLastCalledWith('/api/crm/estimates/31/convert', { to: 'quote', convert_lead: true }));
    await waitFor(() => expect(onOpenQuote).toHaveBeenCalledWith(77));
  });

  it('sends, and says when a rule needs approval first', async () => {
    get.mockResolvedValue({ ...EST, status: 'draft' } as never);
    post.mockRejectedValueOnce(new ApiError(409, 'Approval required', 'approval_required'));
    wrap(<Estimates openId={31} onOpen={() => undefined} onOpenQuote={() => undefined} onOpenProposal={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: /Send/ }));
    fireEvent.change(screen.getByLabelText('To'), { target: { value: 'lahiru@example.com' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Send' }).at(-1)!);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/crm/estimates/31/send', { channel: 'email', to: 'lahiru@example.com' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('info', expect.stringContaining('needs approval first')));
    fireEvent.click(screen.getByRole('button', { name: /Edit on web/ }));
    expect(call).toHaveBeenCalledWith('app:openInBrowser', { path: '/crm?view=estimates&estimate=31' });
  });
});
