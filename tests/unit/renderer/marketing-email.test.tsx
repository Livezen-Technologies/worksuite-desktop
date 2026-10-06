// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, hasDesktop: () => false, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const tab = { route: '/marketing/campaigns', go: vi.fn() };
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => {
    const [path, qs = ''] = tab.route.split('?');
    return { query: new URLSearchParams(qs), path: path!.split('/').filter(Boolean), go: tab.go, navigate: vi.fn(), openInNewTab: vi.fn(), active: true, openLink: vi.fn() };
  },
  useTabTitle: () => undefined,
}));

import { ApiError, apiDelete, apiGet, apiPost, apiPut } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { toast } from '../../../src/core/toasts';
import { NOT_OFFERED, type Block, type Campaign, type CheckResult, type Content } from '../../../src/modules/marketing/api';
import Campaigns from '../../../src/modules/marketing/email/Campaigns';
import { when } from '../../../src/modules/marketing/lib/format';
import Editor from '../../../src/modules/marketing/email/Editor';
import NewCampaign from '../../../src/modules/marketing/email/NewCampaign';
import ReviewSend from '../../../src/modules/marketing/email/ReviewSend';
import Templates, { startOptions } from '../../../src/modules/marketing/email/Templates';
import { isEmail, splitEmails } from '../../../src/modules/marketing/email/TestSend';
import { asBlocks, blocksToPlainText, htmlToText, imagesWithoutAlt, insertBlock, markTags, moveBlock, newBlock, safeUrl, sanitize, STARTERS, textsOf } from '../../../src/modules/marketing/lib/blocks';
import { campaignActions } from '../../../src/modules/marketing/lib/consent';
import { MERGE_TAGS, mergeValues, missingRequired, renderMerge, tagsIn, tagText, unknownTags } from '../../../src/modules/marketing/lib/merge';

/**
 * Email campaigns (WS-MKT-SRS-001 §4.5–4.6): the closed merge-tag list, the block model and its sanitiser, the
 * plain-text version, the campaign states, and the review screen keeping Schedule shut while a blocker stands.
 */

describe('merge tags (MKT-EDT-04)', () => {
  it('reads tags with and without a fallback', () => {
    expect(tagsIn('Hi {{first_name|there}}, from {{ sender_name }} and {{organisation|your team}}')).toEqual([
      { tag: 'first_name', fallback: 'there' },
      { tag: 'sender_name', fallback: null },
      { tag: 'organisation', fallback: 'your team' },
    ]);
    expect(tagsIn('no tags { here }')).toEqual([]);
    expect(tagsIn(null)).toEqual([]);
  });

  it('names the tags outside the closed list, once each', () => {
    expect(unknownTags(['Hi {{first_name}} {{firstname}}', '{{coupon_code|none}} {{firstname}}'], MERGE_TAGS)).toEqual(['firstname', 'coupon_code']);
    expect(unknownTags(['{{constructor}}'], ['first_name'])).toEqual(['constructor']);
    expect(unknownTags(['{{first_name|there}} {{unsubscribe_url}}'], MERGE_TAGS)).toEqual([]);
  });

  it('finds the required tags an email is missing', () => {
    const blocks: Block[] = [
      { id: 'a', type: 'text', html: '<p>Hi {{first_name|there}}</p>' },
      { id: 'b', type: 'footer', html: '<p>{{company_address}}</p>' },
    ];
    expect(missingRequired(blocks, MERGE_TAGS)).toEqual(['unsubscribe_url']);
    expect(missingRequired([...blocks, { id: 'c', type: 'button', label: 'Leave', url: '{{unsubscribe_url}}', align: 'left' }], MERGE_TAGS)).toEqual([]);
  });

  it('fills a tag with its value, else its fallback, else nothing', () => {
    const t = 'Hi {{first_name|there}}, {{organisation}}!{{constructor}}';
    expect(renderMerge(t, { first_name: 'Sanduni', organisation: 'Livezen' })).toBe('Hi Sanduni, Livezen!');
    expect(renderMerge(t, { first_name: '  ' })).toBe('Hi there, !');
    expect(renderMerge(t, mergeValues({ first_name: 'කමල්', last_name: null, name: 'කමල් පෙරේරා', email: 'k@x.lk', organisation: null }))).toBe('Hi කමල්, !');
    expect(tagText({ tag: 'first_name', fallback: true })).toBe('{{first_name|there}}');
    expect(tagText({ tag: 'company_address', fallback: false })).toBe('{{company_address}}');
  });
});

describe('the block model (MKT-EDT-01)', () => {
  it('sanitises: scripts, handlers and javascript: links go; text and allowed tags stay', () => {
    const dirty =
      '<h1 class="x" onclick="steal()">Hello <b>world</b></h1><script>alert(1)</script><style>p{}</style>' +
      '<p>Read <a href="javascript:alert(1)" target="_blank">this</a> or <a href="https://livezen.lk/care?a=1&b=2" onmouseover="x()">that</a>.</p>' +
      '<div><img src=x onerror="alert(1)">Kept text</div><iframe src="https://evil"></iframe><a href="{{unsubscribe_url}}">Unsubscribe</a>' +
      '<a href="jav&#x61;script:alert(1)">encoded</a><svg><text>gone</text></svg><ul><li>One<li>Two</ul>';
    const clean = sanitize(dirty);
    expect(clean).toBe(
      '<h1>Hello <b>world</b></h1><p>Read <a>this</a> or <a href="https://livezen.lk/care?a=1&amp;b=2">that</a>.</p>Kept text<a href="{{unsubscribe_url}}">Unsubscribe</a><a>encoded</a><ul><li>One</li><li>Two</li></ul>',
    );
    expect(clean).not.toMatch(/script|onclick|onerror|iframe|javascript|style|class=/i);
    expect(sanitize(clean)).toBe(clean);
  });

  it('keeps Sinhala and Tamil as written, and escapes stray markup', () => {
    expect(sanitize('<p>ආයුබෝවන් · வணக்கம் 5 < 6 & 7 > 3</p>')).toBe('<p>ආයුබෝවන් · வணக்கம் 5 &lt; 6 &amp; 7 &gt; 3</p>');
    expect(sanitize('<p>Cut <b')).toBe('<p>Cut </p>');
    expect(safeUrl('mailto:hello@livezen.lk')).toBe('mailto:hello@livezen.lk');
    expect(safeUrl(' java\nscript:alert(1)')).toBeNull();
    expect(safeUrl('{{x}}javascript:alert(1)')).toBeNull();
  });

  it('marks merge tags in text only, never inside a link', () => {
    const html = markTags('<p>Hi {{first_name|there}} {{bogus}} <a href="{{unsubscribe_url}}">x</a></p>', new Set(['first_name', 'unsubscribe_url']));
    expect(html).toContain('<span class="rounded-[4px] bg-selection px-0.5 font-mono text-[0.92em] text-primary">{{first_name|there}}</span>');
    expect(html).toContain('text-danger');
    expect(html).toContain('<a href="{{unsubscribe_url}}">x</a>');
  });

  it('writes the plain-text version', () => {
    const blocks: Block[] = [
      { id: '1', type: 'text', html: '<h1>Website  care</h1><p>Hi {{first_name|there}},<br>our packages:</p><ul><li>Updates</li><li>Backups &amp; <b>uptime</b></li></ul>' },
      { id: '2', type: 'image', src: 'https://x/hero.png', alt: 'Dashboard showing uptime', link: null, width: 'full' },
      { id: '3', type: 'image', src: null, alt: '', link: null, width: 'full' },
      { id: '4', type: 'button', label: 'See packages', url: 'https://livezen.lk/care', align: 'left' },
      { id: '5', type: 'divider' },
      { id: '6', type: 'footer', html: '<p>{{company_address}} · <a href="{{unsubscribe_url}}">Unsubscribe</a></p>' },
    ];
    expect(blocksToPlainText(blocks)).toBe(
      'Website care\n\nHi {{first_name|there}},\nour packages:\n\n- Updates\n- Backups & uptime\n\n[Dashboard showing uptime]\n\nSee packages: https://livezen.lk/care\n\n---\n\n{{company_address}} · Unsubscribe ({{unsubscribe_url}})',
    );
    expect(blocksToPlainText(blocks.slice(0, 1), { first_name: 'Hasarinda' })).toContain('Hi Hasarinda,');
    expect(htmlToText('<ol><li>a</li><li>b</li></ol>')).toBe('1. a\n2. b');
    expect(htmlToText('<p><a href="https://x.lk">https://x.lk</a></p>')).toBe('https://x.lk');
  });

  it('gives every starter a footer with the address, preferences and unsubscribe tags', () => {
    expect(STARTERS.map((s) => s.id)).toEqual(['newsletter', 'announcement', 'plain']);
    for (const s of STARTERS) {
      const footer = s.blocks.find((b) => b.type === 'footer');
      expect(footer, s.id).toBeTruthy();
      const tags = tagsIn(textsOf(footer ? [footer] : []).join(' ')).map((t) => t.tag);
      expect(tags).toEqual(expect.arrayContaining(['company_address', 'preferences_url', 'unsubscribe_url']));
      expect(missingRequired(s.blocks, MERGE_TAGS)).toEqual([]);
      expect(unknownTags(textsOf(s.blocks), MERGE_TAGS)).toEqual([]);
    }
  });

  it('adds, moves and checks blocks', () => {
    const a = newBlock('text');
    const b = newBlock('image');
    const c = newBlock('footer');
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
    let list = insertBlock([a, c], a.id, b);
    expect(list.map((x) => x.type)).toEqual(['text', 'image', 'footer']);
    list = moveBlock(list, b.id, 'up');
    expect(list.map((x) => x.type)).toEqual(['image', 'text', 'footer']);
    expect(moveBlock(list, b.id, 'up')).toEqual(list);
    expect(imagesWithoutAlt(list).map((x) => x.id)).toEqual([b.id]);
    expect(missingRequired(list, MERGE_TAGS)).toEqual([]);
  });
});

describe('small helpers', () => {
  it('reads addresses for test sends', () => {
    expect(splitEmails('A@x.lk, b@x.lk\nA@x.lk;  c@x.lk ')).toEqual(['a@x.lk', 'b@x.lk', 'c@x.lk']);
    expect(['news@livezen.lk', 'a.b@mail.co.uk'].every(isEmail)).toBe(true);
    expect(['news@', '@livezen.lk', 'news@livezen', 'a b@x.lk'].some(isEmail)).toBe(false);
  });

  it('keeps only blocks the editor can show', () => {
    expect(asBlocks(null)).toEqual([]);
    expect(asBlocks([{ id: 'a', type: 'text', html: '' }, { id: 'b', type: 'video' }, { type: 'divider' }, null]).map((b) => b.id)).toEqual(['a']);
  });

  it('lets the server’s own starter stand in for one of ours, under the same name', () => {
    const options = startOptions([
      { id: 40, name: 'Newsletter', kind: 'starter', blocks: [], updated_at: null },
      { id: 12, name: 'Monthly digest', kind: 'saved', blocks: [], updated_at: null },
    ]);
    expect(options.map((o) => o.key)).toEqual(['starter:announcement', 'starter:plain', 'template:40', 'template:12']);
    expect(options.find((o) => o.key === 'template:40')?.aliases).toEqual(['starter:newsletter']);
  });
});

describe('campaign states (SRS §6.1)', () => {
  it('allows what each state allows', () => {
    expect(campaignActions('draft')).toMatchObject({ edit: true, schedule: true, cancel: true, pause: false, report: false });
    expect(campaignActions('scheduled')).toMatchObject({ edit: false, unschedule: true, cancel: true });
    expect(campaignActions('sending')).toMatchObject({ pause: true, cancel: false, report: true });
    expect(campaignActions('paused')).toMatchObject({ resume: true, cancel: true, report: true });
    expect(campaignActions('sent')).toMatchObject({ cancel: false, pause: false, resume: false, report: true });
    expect(campaignActions('cancelled')).toMatchObject({ edit: false, cancel: false, schedule: false });
  });
});

/* ------------------------------------------------------------------------ *
 * Screens, against a mocked /api/marketing
 * ------------------------------------------------------------------------ */

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const missing = () => new ApiError(404, 'The server answered 404.', null);

function campaign(over: Partial<Campaign> = {}): Campaign {
  return {
    id: 7,
    name: 'Website care packages',
    status: 'draft',
    topic: { id: 2, name: 'Services news' },
    lists: [{ id: 1, name: 'Customers' }],
    segments: [{ id: 3, name: 'Engaged vendors' }],
    audience_label: null,
    from_name: 'Livezen Technologies',
    from_email: 'news@livezen.lk',
    reply_to: 'hello@livezen.lk',
    subject: 'Keep your website fast and secure',
    preview_text: 'Updates, backups, uptime and monthly reports',
    ab: null,
    local_time: true,
    scheduled_at: null,
    started_at: null,
    finished_at: null,
    recipients_count: 0,
    sent_count: 0,
    delivered_count: 0,
    human_opens: 0,
    clicks: 0,
    unsubscribes: 0,
    bounces: 0,
    bounce_rate: null,
    progress: null,
    paused_reason: null,
    tests_sent: 3,
    owner: { id: 1, name: 'Hasarinda S.' },
    content_saved_at: '2026-10-06 09:41:00',
    created_at: null,
    updated_at: null,
    ...over,
  };
}

const SETTINGS = {
  sending: { route: 'marketing', routes: [], hourly_pace: 1200, relay_priority: 8, bounce_guard_percent: 5, max_test_recipients: 5, default_time_zone: 'Asia/Colombo' },
  calls: {},
  consent: {},
  policies: {},
  can_edit: true,
};
const AUDIENCE = { recipients: 2310, sources: [{ kind: 'segment', id: 3, name: 'Engaged vendors', count: 612 }, { kind: 'list', id: 1, name: 'Customers', count: 1840 }], duplicates_removed: 54, suppressed: 40, unsubscribed: 21, not_in_topic: 27, no_consent: 0 };
const BLOCKED: CheckResult = {
  blockers: [{ code: 'domain', title: 'sender domain not verified for marketing route', detail: 'livezen.lk has no DKIM for the marketing relay route' }],
  warnings: [{ code: 'zones', title: '41 recipients in another time zone', detail: 'They will receive it at 09:00 their local time' }],
  passed: [{ code: 'unsubscribe', title: 'Unsubscribe link and RFC 8058 one-click header present', detail: null }],
};

let check: CheckResult = BLOCKED;
let current: Campaign = campaign();
let content: Content = { blocks: [], plain_text: null, version: 3, saved_at: '2026-10-06 09:41:00' };

beforeEach(() => {
  check = BLOCKED;
  current = campaign();
  content = {
    blocks: [
      { id: 'a', type: 'text', html: '<h1>Hi {{first_name|there}}, keep your website fast</h1><p>Our care packages cover updates.</p>' },
      { id: 'f', type: 'footer', html: '<p>{{company_address}} · <a href="{{unsubscribe_url}}">Unsubscribe</a></p>' },
    ],
    plain_text: null,
    version: 3,
    saved_at: '2026-10-06 09:41:00',
  };
  tab.route = '/marketing/campaigns';
  tab.go.mockReset();
  vi.mocked(toast).mockReset();
  vi.mocked(apiGet).mockReset();
  vi.mocked(apiPost).mockReset();
  vi.mocked(apiPut).mockReset();
  vi.mocked(apiGet).mockImplementation((async (path: string) => {
    if (path === '/api/marketing/settings') return SETTINGS;
    if (path === '/api/marketing/campaigns/7') return current;
    if (path === '/api/marketing/campaigns/7/audience') return AUDIENCE;
    if (path === '/api/marketing/campaigns/7/content') return content;
    if (path === '/api/marketing/images') return [];
    if (path === '/api/marketing/topics' || path === '/api/marketing/lists' || path === '/api/marketing/segments') return [];
    throw missing();
  }) as never);
  vi.mocked(apiPost).mockImplementation((async (path: string) => {
    if (path === '/api/marketing/campaigns/7/check') return check;
    if (path === '/api/marketing/campaigns/7/schedule') return { ...current, status: 'scheduled' };
    throw missing();
  }) as never);
  vi.mocked(apiPut).mockImplementation((async (path: string, body: unknown) => {
    if (path === '/api/marketing/campaigns/7') return { ...current, ...(body as object) };
    if (path === '/api/marketing/campaigns/7/content') return { version: 4, saved_at: '2026-10-06 09:52:00' };
    throw missing();
  }) as never);
  app.set({ bootstrap: { permissions: [] } as never });
});

afterEach(() => cleanup());

describe('Review & send (DK08)', () => {
  it('keeps Schedule shut while the check reports a blocker, and tests can still go (AC-05)', async () => {
    wrap(<ReviewSend id={7} />);
    expect(await screen.findByText('Blocker · sender domain not verified for marketing route')).toBeTruthy();
    expect(screen.getByText('Warning · 41 recipients in another time zone')).toBeTruthy();
    expect(screen.getByText('1 blocker')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Schedule campaign' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Send test' }) as HTMLButtonElement).disabled).toBe(false);
    expect(apiPost).toHaveBeenCalledWith('/api/marketing/campaigns/7/check');
    expect(await screen.findByText('2,310')).toBeTruthy();
    expect(screen.getByText('−54')).toBeTruthy();
    expect(screen.getByText('−61')).toBeTruthy();
  });

  it('schedules once the check is clear: settings first, then the send time in UTC', async () => {
    check = { blockers: [], warnings: [], passed: BLOCKED.passed };
    wrap(<ReviewSend id={7} />);
    const schedule = await screen.findByRole('button', { name: 'Schedule campaign' });
    await waitFor(() => expect((schedule as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(schedule);
    await waitFor(() => expect(tab.go).toHaveBeenCalledWith('/marketing/campaigns'));
    expect(apiPut).toHaveBeenCalledWith('/api/marketing/campaigns/7', expect.objectContaining({ ab: { enabled: false }, local_time: true }));
    const [, body] = vi.mocked(apiPost).mock.calls.find(([p]) => p === '/api/marketing/campaigns/7/schedule')!;
    expect(body).toMatchObject({ local_time: true, send_at: expect.stringMatching(/^\d{4}-\d\d-\d\d \d\d:\d\d:00$/) });
  });

  it('offers approval when the server refuses an author, and says plainly when approval is not offered', async () => {
    check = { blockers: [], warnings: [], passed: [] };
    vi.mocked(apiPost).mockImplementation((async (path: string) => {
      if (path === '/api/marketing/campaigns/7/check') return check;
      if (path === '/api/marketing/campaigns/7/schedule') throw new ApiError(403, 'You may not send marketing campaigns.', null);
      throw missing();
    }) as never);
    wrap(<ReviewSend id={7} />);
    const schedule = await screen.findByRole('button', { name: 'Schedule campaign' });
    await waitFor(() => expect((schedule as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(schedule);
    fireEvent.click(await screen.findByRole('button', { name: 'Request approval' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Request approval' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('info', NOT_OFFERED));
    expect(tab.go).not.toHaveBeenCalled();
  });
});

describe('Email campaigns (DK06)', () => {
  it('lists campaigns by state with what each one is doing', async () => {
    const scheduledAt = '2026-10-06 03:30:00';
    const rows = [
      campaign({ id: 1, name: 'October service update', status: 'sending', progress: 62, recipients_count: 1840, delivered_count: 1141, audience_label: 'Customers (list)' }),
      campaign({ id: 2, name: 'Website care packages', status: 'scheduled', scheduled_at: scheduledAt, local_time: true }),
      campaign({ id: 3, name: 'Vendor re-permission', status: 'paused', paused_reason: 'bounce_guard', bounce_rate: 5.3, recipients_count: 1006, delivered_count: 214 }),
      campaign({ id: 4, name: 'Tender alert launch', status: 'sent', started_at: '2026-09-20 04:30:00', delivered_count: 1126, human_opens: 408, ab: { enabled: true, test_share: 20, window_hours: 4, metric: 'opens', kind: 'subject', subject_b: 'B', winner: 'B' } }),
      campaign({ id: 9, name: 'Q4 webinar invite', status: 'draft' }),
    ];
    vi.mocked(apiGet).mockImplementation((async (path: string) => {
      if (path === '/api/marketing/campaigns') return { data: rows, meta: { current_page: 1, last_page: 1, per_page: 50, total: 24 }, counts: { all: 24, draft: 5, scheduled: 2, sending: 1, paused: 1, sent: 14, cancelled: 1 } };
      if (path === '/api/marketing/settings') return SETTINGS;
      throw missing();
    }) as never);
    wrap(<Campaigns />);
    expect(await screen.findByText('Sending · 62%')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'All (24)' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Drafts (5)' })).toBeTruthy();
    expect(screen.getByText('Now · paced 1,200/h')).toBeTruthy();
    expect(screen.getByText('1,141 / 1,840')).toBeTruthy();
    expect(screen.getByText(`${when(scheduledAt)} · recipient local time`)).toBeTruthy();
    expect(screen.getByText('Paused · bounce guard')).toBeTruthy();
    expect(screen.getByText('Paused at 5.3% bounce')).toBeTruthy();
    expect(screen.getByText(`${when('2026-09-20 04:30:00', false)} · winner B after 4 h`)).toBeTruthy();
    expect(screen.getByText('A/B')).toBeTruthy();
    expect(screen.getByText('36.2%')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Q4 webinar invite' }));
    expect(tab.go).toHaveBeenCalledWith('/marketing/campaigns/9/content');
    fireEvent.click(screen.getByRole('button', { name: 'Website care packages' }));
    expect(tab.go).toHaveBeenCalledWith('/marketing/campaigns/2/review');
  });
});

describe('the editor (DK07)', () => {
  it('shows the closed tag list, adds a block after the chosen one and autosaves with the version it read', async () => {
    tab.route = '/marketing/campaigns/7/content';
    wrap(<Editor id={7} step="content" />);
    expect(await screen.findByText('Email campaign · Draft · autosaved', { exact: false })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Insert First name: \{\{first_name\|there\}\}/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Text block' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Divider' }));
    expect(screen.getByRole('heading', { name: 'Divider block' })).toBeTruthy();
    expect(screen.getByText('Email campaign · Draft · unsaved changes')).toBeTruthy();
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/marketing/campaigns/7/content', expect.anything()), { timeout: 4000 });
    const [, body] = vi.mocked(apiPut).mock.calls.find(([p]) => p === '/api/marketing/campaigns/7/content')!;
    const sent = body as { blocks: Block[]; plain_text: string; version: number };
    expect(sent.version).toBe(3);
    expect(sent.blocks.map((b) => b.type)).toEqual(['text', 'divider', 'footer']);
    expect(sent.plain_text).toContain('Hi {{first_name|there}}, keep your website fast');
    expect(await screen.findByText(/autosaved/)).toBeTruthy();
  });

  it('is read-only past draft, and says why', async () => {
    current = campaign({ status: 'sent' });
    wrap(<Editor id={7} step="content" />);
    expect(await screen.findByText(/its content can’t change/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Text' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Send test' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('a new campaign (WF-06 steps 1–3)', () => {
  const digest: Block[] = [
    { id: 'd1', type: 'text', html: '<p>Hi {{first_name|there}}, this month:</p>' },
    { id: 'd2', type: 'footer', html: '<p>{{company_address}} <a href="{{unsubscribe_url}}">Unsubscribe</a></p>' },
  ];

  beforeEach(() => {
    const base = vi.mocked(apiGet).getMockImplementation()!;
    vi.mocked(apiGet).mockImplementation((async (path: string, ...rest: unknown[]) => {
      if (path === '/api/marketing/templates') return [{ id: 12, name: 'Monthly digest', kind: 'saved', blocks: digest, updated_at: '2026-09-30 08:00:00' }];
      if (path === '/api/marketing/campaigns/31/content') return { blocks: [], plain_text: null, version: 1, saved_at: null };
      return (base as (...a: unknown[]) => Promise<unknown>)(path, ...rest);
    }) as never);
    vi.mocked(apiPost).mockImplementation((async (path: string, body: unknown) => {
      if (path === '/api/marketing/campaigns') return campaign({ id: 31, name: (body as { name: string }).name });
      throw missing();
    }) as never);
    vi.mocked(apiPut).mockImplementation((async () => ({ version: 2, saved_at: '2026-10-06 10:00:00' })) as never);
  });

  it('needs a name before it makes anything', async () => {
    tab.route = '/marketing/campaigns/new';
    wrap(<NewCampaign />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Create draft' }))[0]!);
    expect(await screen.findByText('Give the campaign a name.')).toBeTruthy();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('starts from the template the link names, and lays it into an empty draft', async () => {
    tab.route = '/marketing/campaigns/new?template=12';
    wrap(<NewCampaign />);
    const card = await screen.findByRole('button', { name: /Monthly digest/ });
    expect(card.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /Newsletter/ }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Q4 webinar invite' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Create draft' })[0]!);
    await waitFor(() => expect(tab.go).toHaveBeenCalledWith('/marketing/campaigns/31/content'));
    expect(apiPost).toHaveBeenCalledWith('/api/marketing/campaigns', expect.objectContaining({ name: 'Q4 webinar invite', template_id: 12 }), expect.anything());
    const [path, body] = vi.mocked(apiPut).mock.calls[0]!;
    expect(path).toBe('/api/marketing/campaigns/31/content');
    expect(body).toMatchObject({ version: 1, blocks: [{ type: 'text', html: digest[0]!.type === 'text' ? digest[0]!.html : '' }, { type: 'footer' }] });
  });
});

describe('templates (MKT-EDT-02)', () => {
  it('shows the starters and the saved ones, and deletes a saved one only after asking', async () => {
    const base = vi.mocked(apiGet).getMockImplementation()!;
    vi.mocked(apiGet).mockImplementation((async (path: string, ...rest: unknown[]) => {
      if (path === '/api/marketing/templates') return [{ id: 12, name: 'Monthly digest', kind: 'saved', blocks: [], updated_at: '2026-09-30 08:00:00' }];
      return (base as (...a: unknown[]) => Promise<unknown>)(path, ...rest);
    }) as never);
    vi.mocked(apiDelete).mockReset();
    vi.mocked(apiDelete).mockResolvedValue(undefined as never);
    tab.route = '/marketing/templates';
    wrap(<Templates />);
    const digest = await screen.findByRole('article', { name: 'Monthly digest' });
    expect(screen.getByRole('article', { name: 'Plain letter' })).toBeTruthy();
    expect(within(screen.getByRole('article', { name: 'Newsletter' })).queryByRole('button', { name: 'Delete' })).toBeNull();
    fireEvent.click(within(digest).getByRole('button', { name: 'Use in a new campaign' }));
    expect(tab.go).toHaveBeenCalledWith('/marketing/campaigns/new?template=12');
    fireEvent.click(within(digest).getByRole('button', { name: 'Delete' }));
    expect(apiDelete).not.toHaveBeenCalled();
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete template' }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/api/marketing/templates/12'));
  });
});
