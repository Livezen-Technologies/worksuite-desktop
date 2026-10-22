// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CampaignCheck, CampaignDetail, Options, Report } from '../../../src/modules/marketing/types';
import type { Block } from '../../../src/modules/marketing/email-blocks';

/**
 * Marketing › Email (DK06–DK09, R01): the campaigns list with the server's
 * counts per status, the block editor's HTML format (round trip, and an email
 * written before blocks kept as it was), the missing-alt-text warning, a
 * review that will not schedule while the check names a blocker, a report
 * from a server that sends no open quality or deliverability.
 */
const net = vi.hoisted(() => ({ apiGet: vi.fn(), request: vi.fn(), call: vi.fn(), go: vi.fn(), navigate: vi.fn(), toast: vi.fn() }));

vi.mock('../../../src/core/bridge', () => ({ call: net.call, on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux', registerDropped: vi.fn() }));
vi.mock('../../../src/core/api', () => ({
  apiGet: net.apiGet,
  request: net.request,
  ApiError: class extends Error {
    status = 422;
    data = null;
  },
}));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ go: net.go, navigate: net.navigate, query: new URLSearchParams(), path: ['marketing'] }), useTabTitle: () => undefined }));
vi.mock('../../../src/core/toasts', () => ({ toast: net.toast }));

const { default: Campaigns } = await import('../../../src/modules/marketing/Campaigns');
const { default: CampaignView } = await import('../../../src/modules/marketing/CampaignView');
const { BlockEditor } = await import('../../../src/modules/marketing/email-BlockEditor');
const blocks = await import('../../../src/modules/marketing/email-blocks');

const can = {
  dashboard: true, view: true, create: true, edit: true, delete: true, import: true, export: true, convert: true, lists: true, segments: true, suppression: true, settings: true,
  campaigns: true, campaign_create: true, campaign_edit: true, campaign_launch: true, campaign_pause: true, templates: true, analytics: true, calls: true, call_manage: true, call_make: true,
};

const OPTIONS: Options = {
  companies: [{ id: 1, name: 'Livezen Technologies', can, people: [] }],
  statuses: [], sources: [], channels: [], reasons: [], consent_sources: [], segment_fields: [], import_targets: [], import_existing: [], import_limits: { rows: 10_000, bytes: 5_000_000 },
  merge_tags: [{ value: 'first_name', label: 'First name' }, { value: 'company', label: 'Organisation' }, { value: 'unsubscribe_url', label: 'Unsubscribe link' }],
  sending: { route: 'module', route_label: 'Marketing route', priority: 8, pace: 1200, bounce_guard: 5, test_limit: 5 },
};

const campaign = (over: Partial<CampaignDetail> = {}): CampaignDetail => ({
  id: 7, org_id: 1, name: 'Website care packages', objective: null, type: null, type_label: null, tags: [], topic: null, local_at: null, local_time: false, ab: null,
  b: { subject: null, preheader: null, from_name: null }, status: 'draft', status_label: 'Draft', status_note: null, owner: { id: 3, name: 'Hasarinda S.' },
  subject: 'Keep your website fast and secure', preheader: 'Updates, backups, uptime and monthly reports', from_name: 'Livezen Technologies', from_email: 'news@livezen.lk', reply_to: 'hello@livezen.lk',
  audience: { lists: [3], segments: [], exclude_lists: [], exclude_segments: [] }, track_opens: true, track_clicks: true, pace_per_hour: null,
  scheduled_at: null, started_at: null, finished_at: null, recipients: 0, created_at: '2026-10-01 09:00:00', updated_at: '2026-10-06 09:41:00', stats: null,
  body_html: '<div data-block="text"><p>Hi {{first_name | default:"there"}}</p></div>', b_body_html: null,
  can: { edit: true, launch: true, pause: true, create: true, results: true, templates: true },
  ...over,
});

const check = (over: Partial<CampaignCheck> = {}): CampaignCheck => ({
  blockers: [], warnings: [], passed: ['Unsubscribe link and RFC 8058 one-click header present.'], test_limit: 5,
  audience: { named: 2_452, no_email: 10, no_consent: 20, suppressed: 61, opted_out: 27, bounced: 24, final: 2_310, missing: {}, sample: 55 },
  pace: 1200, capacity: { ok: true, left: null, scope: 'module', message: '' }, ab: null,
  ...over,
});

/** The answers every email screen asks for besides its own. */
function answer(path: string, own: Record<string, unknown>): unknown {
  if (path in own) return own[path];
  if (path === '/api/marketing/lists') return { items: [{ id: 3, org_id: 1, name: 'Customers', description: null, owner: null, members: 1_840, archived: false, created_at: null, updated_at: null }] };
  if (path === '/api/marketing/segments') return { items: [] };
  if (path === '/api/marketing/topics') return { items: [], suggested: [], max: 20 };
  if (path === '/api/marketing/templates') return { items: [], starters: [] };
  if (path === '/api/marketing/campaigns/senders') return { domains: [{ domain: 'livezen.lk', ok: true, reason: null }], default: { from_name: 'Livezen', from_email: 'news@livezen.lk' } };
  if (path === '/api/marketing/images') return { items: [], max_bytes: 3_145_728 };
  throw new Error(`Unexpected GET ${path}`);
}

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const shown = (ui: ReactNode) => render(<QueryClientProvider client={client()}>{ui}</QueryClientProvider>);

beforeEach(() => Object.values(net).forEach((f) => f.mockReset()));
afterEach(cleanup);

describe('Email campaigns (DK06)', () => {
  const sending = { ...campaign({ id: 11, name: 'October service update', status: 'sending', status_label: 'Sending', recipients: 1_840, started_at: '2026-10-06 08:00:00' }), stats: { recipients: 1_840, sent: 1_141, bounced: 0, opened: 400, human: 300, clicked: 20, unsubscribed: 1 } };
  /* From a server a part behind: no `human` in the list, so the report says. */
  const older = { ...campaign({ id: 12, name: 'September newsletter', status: 'sent', status_label: 'Sent', recipients: 3_702, started_at: '2026-09-28 04:30:00', finished_at: '2026-09-28 07:36:00' }), stats: { recipients: 3_702, sent: 3_702, bounced: 41, opened: 1_443, clicked: 143, unsubscribed: 12 } };

  it('shows each status with the server’s count, and the campaign’s progress, audience, pace and human opens', async () => {
    net.apiGet.mockImplementation(async (path: string) =>
      answer(path, {
        '/api/marketing/campaigns': { items: [sending, older], total: 2, counts: { all: 24, draft: 5, scheduled: 2, sending: 1, paused: 1, sent: 14, cancelled: 1 } },
        '/api/marketing/campaigns/12/results': { counts: { opened: 1_443, opened_by_people: 1_091 }, rates: { reached: 3_661, opened: null, clicked: null, unsubscribed: null, bounced: null }, links: [], activity: { unit: 'day', points: [] } },
      }),
    );
    shown(<Campaigns org="" options={OPTIONS} onOpen={vi.fn()} creating={false} onCreating={vi.fn()} />);

    expect(await screen.findByRole('tab', { name: 'All (24)' })).toBeTruthy();
    for (const name of ['Drafts (5)', 'Scheduled (2)', 'Sending (1)', 'Paused (1)', 'Sent (14)', 'Cancelled (1)']) expect(screen.getByRole('tab', { name })).toBeTruthy();
    expect(await screen.findByText('Sending · 62%')).toBeTruthy();
    expect(await screen.findAllByText('Customers (list)')).toHaveLength(2);
    expect(screen.getByText('Now · paced 1,200/h')).toBeTruthy();
    expect(screen.getByText('1,141 / 1,840')).toBeTruthy();
    expect(screen.getByText('Human opens')).toBeTruthy();
    expect(screen.getByText('26.3%')).toBeTruthy();
    expect(await screen.findByText('29.8%')).toBeTruthy();
    // Only the campaign without the list's figure asked for its report.
    expect(net.apiGet).toHaveBeenCalledWith('/api/marketing/campaigns/12/results', undefined, expect.anything());
    expect(net.apiGet).not.toHaveBeenCalledWith('/api/marketing/campaigns/11/results', undefined, expect.anything());

    fireEvent.click(screen.getByRole('tab', { name: 'Drafts (5)' }));
    await waitFor(() => expect(net.apiGet).toHaveBeenCalledWith('/api/marketing/campaigns', expect.objectContaining({ status: 'draft', page: 1 }), expect.anything()));

    fireEvent.click(screen.getByRole('button', { name: /Templates/ }));
    expect(net.go).toHaveBeenCalledWith('/marketing?view=templates');
  });

  it('a server that sends no counts still shows the tabs, without numbers', async () => {
    net.apiGet.mockImplementation(async (path: string) => answer(path, { '/api/marketing/campaigns': { items: [], total: 0 } }));
    shown(<Campaigns org="" options={OPTIONS} onOpen={vi.fn()} creating={false} onCreating={vi.fn()} />);
    expect(await screen.findByText(/No campaigns yet/)).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'All' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Drafts' })).toBeTruthy();
  });

  it('creates a campaign from a starter, then opens it', async () => {
    net.apiGet.mockImplementation(async (path: string) =>
      answer(path, {
        '/api/marketing/campaigns': { items: [], total: 0 },
        '/api/marketing/templates': { items: [], starters: [{ key: 'letter', name: 'A letter', category: 'update', subject: 'A note', preheader: 'Hi', body_html: '<p>Hello</p>' }] },
      }),
    );
    net.request.mockResolvedValue({ data: { id: 31 }, message: 'Saved.' });
    const onOpen = vi.fn();
    const onCreating = vi.fn();
    shown(<Campaigns org="1" options={OPTIONS} onOpen={onOpen} creating onCreating={onCreating} />);

    fireEvent.change(await screen.findByPlaceholderText('October service update'), { target: { value: 'Q4 webinar invite' } });
    fireEvent.click(await screen.findByRole('radio', { name: /A letter/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(31));
    expect(net.request).toHaveBeenCalledWith('POST', '/api/marketing/campaigns', { body: { org_id: 1, name: 'Q4 webinar invite', subject: 'A note', preheader: 'Hi', body_html: '<p>Hello</p>' } });
    expect(onCreating).toHaveBeenCalledWith(false);
  });
});

describe('The block format (email-blocks, the web editor’s to the byte)', () => {
  const strip = (b: Block) => Object.fromEntries(Object.entries(b).filter(([k]) => k !== 'id'));

  it('writes every block with its mark, and reads back exactly the same blocks and HTML', () => {
    const list: Block[] = [
      { id: 'a', type: 'text', html: '<h1>Hi {{first_name | default:"there"}}</h1><p>Our <b>care packages</b> <a href="https://livezen.lk/care">cover updates</a>.</p>' },
      { id: 'b', type: 'image', src: 'https://ws.example/m/i/care-hero.png', alt: 'Dashboard showing uptime', href: 'https://livezen.lk/care', width: 300 },
      { id: 'c', type: 'button', label: 'See packages', href: 'https://livezen.lk/care', color: '#0f766e' },
      { id: 'd', type: 'columns', columns: [{ kind: 'text', html: '<p>Left {{company}}</p>' }, { kind: 'image', src: 'https://ws.example/m/i/x.png', alt: 'X', href: '' }] },
      { id: 'e', type: 'divider', spacing: 24 },
    ];
    const html = blocks.serializeBlocks(list);

    for (const kind of ['text', 'image', 'button', 'columns', 'divider']) expect(html).toContain(`data-block="${kind}"`);
    expect(html).toContain('{{first_name | default:"there"}}');

    const again = blocks.parseBlocks(html);
    expect(again.map(strip)).toEqual(list.map(strip));
    expect(blocks.serializeBlocks(again)).toBe(html);
  });

  it('reads what the web editor writes, and writes it back the same', () => {
    const web =
      '<div data-block="text"><p>Hello {{first_name | default:"there"}},</p></div>'
      + '<div data-block="button" style="margin:8px 0 24px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:6px;background:#2563eb"><a href="https://example.com" style="display:inline-block;padding:12px 24px;font-weight:600;color:#ffffff;text-decoration:none">Find out more</a></td></tr></table></div>'
      + '<div data-block="divider" style="padding:16px 0"><hr style="border:0;border-top:1px solid #e5e7eb;margin:0"></div>'
      + '<div data-block="image" style="margin:0 0 16px"></div>';
    const read = blocks.parseBlocks(web);
    expect(read.map((b) => b.type)).toEqual(['text', 'button', 'divider', 'image']);
    expect(read[1]).toMatchObject({ label: 'Find out more', href: 'https://example.com', color: '#2563eb' });
    expect(blocks.serializeBlocks(read)).toBe(web);
  });

  it('keeps an email written before blocks byte for byte, and turns it into blocks only when asked', () => {
    const legacy =
      '<h1 style="margin:0 0 16px;font-size:26px">Something new</h1>\n<p style="margin:0 0 16px">Hello {{first_name | default:"there"}},</p>'
      + '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px"><tr><td style="border-radius:6px;background:#2563eb"><a href="https://example.com" style="display:inline-block;padding:12px 24px">Find out more</a></td></tr></table>'
      + '<table width="100%"><tr><td>Odd</td><td>layout</td></tr></table><!-- kept --><style>.x{color:red}</style><p>Kind regards</p>';
    const read = blocks.parseBlocks(legacy);

    expect(read).toHaveLength(1);
    expect(read[0]).toMatchObject({ type: 'html', html: legacy });
    expect(blocks.serializeBlocks(read)).toBe(legacy);

    // Turned into blocks on request: text runs, the one-link table as a button, the rest kept as HTML.
    const made = blocks.convertHtml(legacy);
    expect(made.map((b) => b.type)).toEqual(['text', 'button', 'html', 'html', 'text']);
    expect(made[1]).toMatchObject({ type: 'button', label: 'Find out more', href: 'https://example.com' });

    // Loose HTML between marked blocks is kept as written, too.
    const mixed = `<div data-block="text"><p>Hi</p></div><table width="100%"><tbody><tr><td>Odd</td></tr></tbody></table><div data-block="divider" style="padding:8px 0"><hr style="border:0;border-top:1px solid #e5e7eb;margin:0"></div>`;
    const parts = blocks.parseBlocks(mixed);
    expect(parts.map((b) => b.type)).toEqual(['text', 'html', 'divider']);
    expect(blocks.serializeBlocks(parts)).toBe(mixed);
  });

  it('lets only a paragraph’s markup into text, and shows HTML blocks without what could run or restyle the app', () => {
    expect(blocks.sanitizeText('<p style="color:red" class="x" onclick="y()">Hi <img src="a.png" onerror="boom()"><span>there</span> <a href="javascript:alert(1)">x</a></p><script>bad()</script>'))
      .toBe('<p style="color:red">Hi there <a>x</a></p>');
    const shown = blocks.displayHtml('<p onclick="steal()">Hi<img src="x.png" onerror="boom()"></p><script>bad()</script><style>body{display:none}</style>');
    expect(shown).not.toMatch(/onclick|onerror|<script|<style/);
    expect(shown).toContain('<img src="x.png">');
  });

  it('knows the merge tags used, with and without fallbacks, and the ones not on the list', () => {
    const used = blocks.tagsUsed('<p>Hi {{first_name | default:&quot;there&quot;}} from {{company}} and {{frist_name}}</p>');
    expect([...used.entries()]).toEqual([['first_name', true], ['company', false], ['frist_name', false]]);
    expect(blocks.unknownTags(['first_name', 'company'], '{{frist_name}} {{company}}')).toEqual(['frist_name']);
    expect(blocks.tagText('first_name', 'there')).toBe('{{first_name | default:"there"}}');
  });
});

describe('The block editor (DK07)', () => {
  it('warns about a picture without alt text, and the warning goes once it has some', async () => {
    net.apiGet.mockImplementation(async (path: string) => answer(path, {}));
    const onChange = vi.fn();
    shown(
      <BlockEditor
        initial={'<div data-block="image" style="margin:0 0 16px"><img src="https://ws.example/m/i/care-hero.png" alt="" width="536" style="display:block;width:100%;max-width:100%;height:auto;border:0"></div><div data-block="text"><p>Hi</p></div>'}
        onChange={onChange}
        orgId={1}
        mergeTags={OPTIONS.merge_tags!}
        companyName="Livezen Technologies"
      />,
    );

    expect(screen.getByText(/A picture has no alt text/)).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole('group', { name: 'Image block, 1 of 2' }));
    expect(screen.getByRole('heading', { name: 'Image block' })).toBeTruthy();
    expect(screen.getByText(/Add alt text/)).toBeTruthy();
    expect(screen.getByText('care-hero.png')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Alt text'), { target: { value: 'Dashboard showing uptime' } });
    expect(screen.queryByText(/Add alt text/)).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining('alt="Dashboard showing uptime"'));
  });

  it('adds, moves and deletes blocks, shows the footer the server adds, and the server’s plain-text version', async () => {
    const onChange = vi.fn();
    shown(<BlockEditor initial="" onChange={onChange} orgId={1} mergeTags={OPTIONS.merge_tags!} companyName="Livezen Technologies" />);

    fireEvent.click(screen.getByRole('button', { name: 'Add a divider block' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a button block' }));
    expect(screen.getByRole('group', { name: 'Button block, 2 of 2' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Move up' }));
    expect(screen.getByRole('group', { name: 'Button block, 1 of 2' })).toBeTruthy();
    expect(onChange.mock.lastCall?.[0]).toMatch(/^<div data-block="button".*<div data-block="divider"/);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.queryByRole('group', { name: /Button block/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Footer: what WorkSuite adds/ }));
    expect(screen.getByText(/cannot be edited out/)).toBeTruthy();
    expect(screen.getAllByText(/Livezen Technologies/).length).toBeGreaterThan(0);

    net.request.mockResolvedValue({ data: { text: 'Hello\n\nLivezen Technologies · Unsubscribe' }, message: null });
    fireEvent.click(screen.getByRole('tab', { name: /Plain text/ }));
    expect(await screen.findByText(/Livezen Technologies · Unsubscribe/)).toBeTruthy();
    expect(net.request).toHaveBeenCalledWith('POST', '/api/marketing/preview', { body: { org_id: 1, body_html: expect.stringContaining('data-block="divider"') }, signal: expect.anything() });
  });
});

describe('Review & send (DK08)', () => {
  const blocked = check({ blockers: ['Say who it is from: a From address.'], warnings: ['41 recipients have no first name, and {{first_name}} has no fallback, so they will see nothing there. Add one: {{first_name | default:"…"}}.'] });

  it('will not schedule while the check names a blocker, and says why', async () => {
    net.apiGet.mockImplementation(async (path: string) => answer(path, { '/api/marketing/campaigns/7': campaign(), '/api/marketing/campaigns/7/check': blocked }));
    shown(<CampaignView id={7} options={OPTIONS} step="review" onStep={vi.fn()} onBack={vi.fn()} onOpen={vi.fn()} />);

    expect(await screen.findByText(/Blocker · Say who it is from:/)).toBeTruthy();
    expect(screen.getByText('1 blocker')).toBeTruthy();
    expect(screen.getByText(/Warning · 41 recipients have no first name/)).toBeTruthy();
    expect(screen.getByText(/Unsubscribe link and RFC 8058/)).toBeTruthy();
    expect(screen.getAllByText('2,310').length).toBe(2);
    expect(screen.getByText('recipients after exclusions')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Schedule campaign/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Send now' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('schedules once the check is clear, at an instant on the reader’s clock', async () => {
    net.apiGet.mockImplementation(async (path: string) => answer(path, { '/api/marketing/campaigns/7': campaign(), '/api/marketing/campaigns/7/check': check() }));
    net.request.mockResolvedValue({ data: null, message: 'Scheduled.' });
    shown(<CampaignView id={7} options={OPTIONS} step="review" onStep={vi.fn()} onBack={vi.fn()} onOpen={vi.fn()} />);

    expect(await screen.findByText('Ready')).toBeTruthy();
    const schedule = screen.getByRole('button', { name: /Schedule campaign/ }) as HTMLButtonElement;
    expect(schedule.disabled).toBe(false);
    fireEvent.click(schedule);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Schedule' }));
    await waitFor(() => expect(net.request).toHaveBeenCalledWith('POST', '/api/marketing/campaigns/7/send', { body: { at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/) } }));
    expect(net.toast).toHaveBeenCalledWith('success', 'Scheduled.');
  });
});

describe('The campaign report (DK09)', () => {
  const sent = campaign({ id: 9, name: 'September newsletter', status: 'sent', status_label: 'Sent', recipients: 3_702, started_at: '2026-09-28 04:30:00', finished_at: '2026-09-28 07:36:00' });
  const base: Report = {
    counts: { recipients: 3_702, sent: 3_702, bounced: 41, hard_bounced: 29, complained: 0, opened: 1_443, opened_by_people: 1_091, clicked: 143, unsubscribed: 12, waiting: 0 },
    rates: { reached: 3_661, opened: 39.4, clicked: 3.9, unsubscribed: 0.3, bounced: 1.1 },
    links: [{ id: 1, url: 'https://livezen.lk/care', clicks: 90, unique_clicks: 74 }, { id: 2, url: 'https://livezen.lk/tenders', clicks: 50, unique_clicks: 41 }],
    activity: { unit: 'day', points: [] },
    ab: null,
  };

  it('reads a server that sends no open quality or deliverability from the counts it does send', async () => {
    net.apiGet.mockImplementation(async (path: string) => answer(path, { '/api/marketing/campaigns/9': sent, '/api/marketing/campaigns/9/results': base }));
    net.call.mockResolvedValue('/home/me/Downloads/campaign-9-report.csv.txt');
    shown(<CampaignView id={9} options={OPTIONS} step={null} onStep={vi.fn()} onBack={vi.fn()} onOpen={vi.fn()} />);

    expect(await screen.findByText('Human open rate')).toBeTruthy();
    expect(screen.getByText('29.8%')).toBeTruthy();
    expect(screen.getByText('98.9%')).toBeTruthy();
    expect(screen.getByText('3,661 of 3,702')).toBeTruthy();
    expect(screen.getByText('352 opened only by machines, excluded')).toBeTruthy();
    expect(screen.getByText(/does not yet say which machines opened it/)).toBeTruthy();
    expect(screen.getByText('29 · suppressed')).toBeTruthy();
    expect(screen.getByText('12 · retried')).toBeTruthy();
    expect(screen.getByText('livezen.lk/care')).toBeTruthy();
    expect(screen.getByText('64%')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
    await waitFor(() => expect(net.call).toHaveBeenCalledWith('files:saveText', { name: 'campaign-9-report.csv', text: expect.stringContaining('Human opens,1091,29.8') }));
  });

  it('shows open quality and deliverability when the server sends them, and duplicates into a new draft', async () => {
    const full: Report = {
      ...base,
      quality: { human: 1_091, machine_total: 352, machine: [{ client: 'Apple Mail Privacy proxy', opens: 281 }, { client: 'Security scanner (pre-fetch)', opens: 58 }] },
      deliverability: { hard: 29, soft: 12, complaints: 0, suppressed: 29, guard: { threshold: 5, rate: 1.1, triggered: false } },
    };
    net.apiGet.mockImplementation(async (path: string) => answer(path, { '/api/marketing/campaigns/9': sent, '/api/marketing/campaigns/9/results': full }));
    net.request.mockResolvedValue({ data: { id: 40 }, message: 'Copied, as a draft.' });
    const onOpen = vi.fn();
    shown(<CampaignView id={9} options={OPTIONS} step={null} onStep={vi.fn()} onBack={vi.fn()} onOpen={onOpen} />);

    expect(await screen.findByText('Apple Mail Privacy proxy')).toBeTruthy();
    expect(screen.getByText('352 machine opens excluded')).toBeTruthy();
    expect(screen.getByText('Not triggered (1.1%)')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Duplicate/ }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(40));
    expect(net.request).toHaveBeenCalledWith('POST', '/api/marketing/campaigns/9/duplicate', { body: undefined });
  });
});

/* Automation (R01) is built now (WS-C): its screens are tested in marketing-automation.test.tsx. */
