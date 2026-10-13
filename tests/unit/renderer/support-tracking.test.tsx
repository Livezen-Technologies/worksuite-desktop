// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import { msg, serveWith } from './support-fixtures';

/**
 * Email tracking on the desktop (worksuite-desktop#335): each emailed reply's latest word on the right of its header
 * ("Opened 12:30 PM · Clicked 1 link"), the timeline it opens, a small click count on each link the requester
 * followed, a bounced reply's reason with Retry and Edit address, the list's "opened the latest reply" mark — honest
 * about image proxies and link scanners — and the calls behind them.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), request: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => undefined), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux', registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({ openWebLink: vi.fn(), useTab: () => ({}), useTabTitle: () => undefined }));

const { request } = await import('../../../src/core/api');
const { Thread } = await import('../../../src/modules/support/Thread');
const { emailStatus, eventLine, latestReplyMark, trackingSummary, withClickCounts, ACCURACY } = await import('../../../src/modules/support/tracking');
const { messageTracking, resendReply, resetApiFamily, setTrackingOptOut, trackingOptOut } = await import('../../../src/modules/support/api');

const tracking = (over: Record<string, unknown> = {}) => ({
  tracked: true, opens_tracked: true, clicks_tracked: true, untracked_reason: null, state: 'sent', sent_at: '2026-10-04T09:12:00+05:30',
  delivered_at: null, bounced_at: null, reason: null, opened_at: null, opens: 0, auto_opened_at: null, auto_opens: 0, last_opened_at: null,
  clicked_at: null, clicks: 0, scans: 0, client: null, device: null, purged: false, links: [], ...over,
});
const guide = { id: 1, url: 'https://help.creativefx.lk/guide', label: 'the guide', kind: 'other', clicks: 2, scans: 1, last_click_at: null };
const faq = { id: 2, url: 'https://help.creativefx.lk/faq', label: 'the FAQ', kind: 'other', clicks: 0, scans: 3, last_click_at: null };
const staff = (id: number, over: Record<string, unknown> = {}) =>
  msg(id, { author: { id: 1, name: 'Ayesha Fernando' }, author_name: 'Ayesha Fernando', from: 'staff', channel: 'reply', delivery_channel: 'email', delivery_status: 'sent', ...over });
const at = () => '12:30 PM';

const row = (id: number) => document.querySelector<HTMLElement>(`[data-message="${id}"]`)!;

let log: ReturnType<typeof serveWith>;
beforeEach(() => {
  resetApiFamily();
  log = serveWith(request, {
    'GET /api/support/v1/meta': {},
    'GET /api/support/v1/tickets/7/messages/2/tracking': {
      message_id: 2, delivery_status: 'delivered', delivery_error: null, tracking: tracking(), note: 'Open and click tracking isn’t always accurate.',
      timeline: [
        { kind: 'queued', at: '2026-10-04T09:12:00+05:30', automatic: false, client: null, device: null, source: 'relay', detail: null, link: null },
        { kind: 'opened', at: '2026-10-04T09:12:04+05:30', automatic: true, client: 'Apple Mail on macOS', device: 'desktop', source: 'pixel', detail: 'Apple Mail Privacy Protection', link: null },
        { kind: 'opened', at: '2026-10-04T10:30:00+05:30', automatic: false, client: 'Outlook on Windows', device: 'desktop', source: 'pixel', detail: null, link: null },
        { kind: 'clicked', at: '2026-10-04T10:31:00+05:30', automatic: false, client: 'Outlook on Windows', device: 'desktop', source: 'link', detail: null, link: { url: guide.url, label: 'the guide' } },
      ],
    },
    'POST /api/support/v1/tickets/7/messages/3/resend': { message: staff(3) },
    'GET /api/support/v1/tickets/7/tracking-optout': { email: 'chamari@customer.lk', opted_out: false },
    'PUT /api/support/v1/tickets/7/tracking-optout': { email: 'chamari@customer.lk', opted_out: true },
  });
});
afterEach(() => cleanup());

describe('what came back about a reply’s email (#335)', () => {
  it('says the latest word: Sending, Sent, Delivered, Opened with the time and the links clicked, Bounced', () => {
    expect(emailStatus({ delivery_status: 'queued', tracking: tracking() as never })?.label).toBe('Sending…');
    expect(emailStatus({ delivery_status: 'sent', tracking: tracking() as never })?.label).toBe('Sent');
    expect(emailStatus({ delivery_status: 'delivered', tracking: tracking({ state: 'delivered', delivered_at: 'x' }) as never })?.label).toBe('Delivered');
    expect(emailStatus({ delivery_status: 'delivered', tracking: tracking({ state: 'opened_auto', auto_opened_at: 'x', auto_opens: 2 }) as never })?.label).toBe('Opened (automatic)');
    const clicked = emailStatus({ delivery_status: 'delivered', tracking: tracking({ state: 'clicked', opened_at: 'x', opens: 1, clicks: 2, scans: 4, links: [guide, faq] }) as never }, at)!;
    expect(clicked).toEqual({ label: 'Opened 12:30 PM · Clicked 1 link', tone: 'good' });
    expect(emailStatus({ delivery_status: 'delivered', tracking: tracking({ state: 'opened', opened_at: 'x', opens: 3 }) as never }, at)?.label).toBe('Opened 12:30 PM (3×)');
    expect(emailStatus({ delivery_status: 'bounced', delivery_error: '550 user unknown', tracking: tracking({ state: 'bounced' }) as never })).toEqual({ label: 'Bounced', tone: 'bad' });
    expect(emailStatus({ delivery_status: 'failed', tracking: null })?.label).toBe('Not delivered');
  });

  it('is honest: a proxy’s open and a scanner’s click are never the requester’s, and it says tracking is not always accurate', () => {
    const s = trackingSummary(tracking({ opened_at: '2026-10-04T10:30:00+05:30', opens: 2, client: 'Outlook on Windows', auto_opens: 1, scans: 3, clicks: 1 }) as never);
    expect(s).toContain('Outlook on Windows');
    expect(s).toContain('Opened (automatic) 1 time — an image proxy or privacy protection, not the requester');
    expect(s).toContain('Scanned 3 times by a link checker');
    expect(s.split('\n').pop()).toBe(ACCURACY());
    expect(trackingSummary(tracking({ tracked: false, untracked_reason: 'internal' }) as never)).toContain('Email between staff is never tracked.');
    expect(eventLine({ kind: 'clicked', at: null, automatic: true, client: null, device: null, source: 'link', detail: 'Every link at once', link: { url: faq.url, label: 'the FAQ' } })).toBe('Scanned the FAQ — Every link at once');
  });

  it('puts the status on the right of the header and opens the timeline from it', async () => {
    const m = staff(2, { delivery_status: 'delivered', tracking: tracking({ state: 'opened', opened_at: '2026-10-04T10:30:00+05:30', opens: 1, client: 'Outlook on Windows' }) });
    render(<Thread messages={[msg(1), m] as never} ticketId={7} />);
    const status = within(row(2)).getByRole('button', { name: /^Opened / });
    expect(status.getAttribute('data-email-status')).toBe('opened');
    expect(status.getAttribute('title')).toContain('Outlook on Windows');
    fireEvent.click(status);
    const box = await within(row(2)).findByRole('dialog', { name: 'Email timeline' });
    await waitFor(() => expect(box.textContent).toContain('Opened (automatic) — Apple Mail Privacy Protection'));
    expect(box.textContent).toContain('Clicked the guide · Outlook on Windows');
    expect(box.textContent).toContain('isn’t always accurate');
    expect(log.some((c) => c.path === '/api/support/v1/tickets/7/messages/2/tracking')).toBe(true);
  });

  it('shows a small click count on each link the requester followed', () => {
    const html = '<p>Read <a href="https://help.creativefx.lk/guide">the guide</a> and <a href="https://help.creativefx.lk/faq">the FAQ</a>.</p>';
    expect(withClickCounts(html, [guide, faq])).toBe('<p>Read <a href="https://help.creativefx.lk/guide">the guide</a><sup data-clicks="2" title="Clicked 2 times">2</sup> and <a href="https://help.creativefx.lk/faq">the FAQ</a>.</p>');
    expect(withClickCounts(html, [])).toBe(html);
    render(<Thread messages={[staff(2, { body_html: html, tracking: tracking({ state: 'clicked', clicks: 2, links: [guide, faq] }) })] as never} ticketId={7} />);
    expect(row(2).querySelector('sup')?.textContent).toBe('2');
  });

  it('says why a reply bounced, with Retry and Edit address for the tab to send it again', () => {
    const onResend = vi.fn();
    const bounced = staff(3, { delivery_status: 'bounced', delivery_error: '550 5.1.1 user unknown', tracking: tracking({ state: 'bounced', bounced_at: 'x', reason: '550 5.1.1 user unknown' }) });
    render(<Thread messages={[bounced] as never} ticketId={7} requesterEmail="chamari@custmer.lk" onResend={onResend} />);
    const bar = row(3).querySelector<HTMLElement>('[data-bounce]')!;
    expect(bar.textContent).toContain('The email bounced · 550 5.1.1 user unknown');
    expect(within(row(3)).getByRole('button', { name: 'Bounced' })).toBeTruthy();
    fireEvent.click(within(bar).getByRole('button', { name: 'Retry' }));
    fireEvent.click(within(bar).getByRole('button', { name: 'Edit address' }));
    const input = within(bar).getByRole('textbox', { name: 'Requester’s email address' }) as HTMLInputElement;
    expect(input.value).toBe('chamari@custmer.lk');
    fireEvent.change(input, { target: { value: 'chamari@customer.lk' } });
    fireEvent.click(within(bar).getByRole('button', { name: 'Send again' }));
    expect(onResend.mock.calls.map(([m, e]) => [m.id, e])).toEqual([[3, undefined], [3, 'chamari@customer.lk']]);
  });

  it('only says why where nothing can send it again, and an older server keeps its own words', () => {
    render(<Thread messages={[staff(3, { delivery_status: 'failed', delivery_error: 'The relay refused it' }), staff(4, { delivery_status: 'sent' })] as never} />);
    expect(row(3).querySelector('[data-bounce]')?.textContent).toContain('The email did not go · The relay refused it');
    expect(within(row(3)).queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(row(4).textContent).toContain('Emailed');
    expect(within(row(4)).queryByRole('button', { name: 'Emailed' })).toBeNull();
  });

  it('marks a ticket whose requester opened or clicked the latest reply, or whose reply bounced', () => {
    expect(latestReplyMark({ latest_reply: null })).toBeNull();
    expect(latestReplyMark({ latest_reply: { state: 'opened_auto', at: null, message_id: 2 } })).toBeNull();
    expect(latestReplyMark({ latest_reply: { state: 'opened', at: null, message_id: 2 } })).toEqual({ label: 'Opened the latest reply', tone: 'good', icon: 'mail-open' });
    expect(latestReplyMark({ latest_reply: { state: 'clicked', at: null, message_id: 2 } })?.icon).toBe('link');
    expect(latestReplyMark({ latest_reply: { state: 'bounced', at: null, message_id: 2 } })?.tone).toBe('bad');
  });

  it('calls the timeline, resend and opt-out addresses', async () => {
    expect((await messageTracking(7, 2)).timeline).toHaveLength(4);
    await resendReply(7, 3, 'chamari@customer.lk');
    await resendReply(7, 3);
    expect(await trackingOptOut(7)).toEqual({ email: 'chamari@customer.lk', opted_out: false });
    await setTrackingOptOut(7, true);
    const sent = log.filter((c) => c.method !== 'GET').map((c) => [c.method, c.path, c.body]);
    expect(sent).toEqual([
      ['POST', '/api/support/v1/tickets/7/messages/3/resend', { email: 'chamari@customer.lk' }],
      ['POST', '/api/support/v1/tickets/7/messages/3/resend', {}],
      ['PUT', '/api/support/v1/tickets/7/tracking-optout', { opted_out: true }],
    ]);
  });
});
