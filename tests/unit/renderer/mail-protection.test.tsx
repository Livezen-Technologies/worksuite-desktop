// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, hasDesktop: () => true }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import { ApiError, apiGet, apiGetMeta, apiPost, apiPut } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import { TabProvider } from '../../../src/core/tab-context';
import { setRegional } from '../../../src/core/time';
import MailPage from '../../../src/modules/mail/MailPage';
import { MailActionError } from '../../../src/modules/mail/api';
import { QuarantineDetail, quarantineChoice } from '../../../src/modules/mail/protection/QuarantinePage';
import { VerdictBanner } from '../../../src/modules/mail/protection/VerdictBanner';
import { SendBlockedNote } from '../../../src/modules/mail/protection/SendBlocked';
import { readerLinks, registerReaderLinks, tagLinkFrames } from '../../../src/modules/mail/protection/linkContext';
import { allowedActions, attachmentGate, bannerFor, linkVerdictOf, protectionView, sendBlockOf } from '../../../src/modules/mail/protection/verdicts';
import { judgeLink } from '../../../src/modules/mail/LinkGuard';
import type { MessageProtection, QuarantineItem, Verdict } from '../../../src/modules/mail/protection/types';
import { parseSafeLink, safeLinkHref } from '@shared/mail-files';

/**
 * ENH-MAIL-04 Mail protection in the desktop: the verdict banner (P-UI-10) for every verdict, never a Release for
 * malware; attachment chips that gate every way out (P-UI-11); offline Checking and the kept clean verdict (MPR-UX-07);
 * the quarantine's Release against Request release (P-UI-13); the link check (P-UI-12); and a blocked send (P-UI-15).
 */

const wrap = (node: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);
const REF = { uid: '201', folder: 'inbox', mailbox: '3' };

function prot(verdict: Verdict, extra: Partial<MessageProtection> = {}): MessageProtection {
  return { verdict, score: null, path: 'post', action: null, policy: null, reasons: [], banner: null, attachments: [], images_blocked: false, links_as_text: false, quarantine_id: null, release: null, ...extra };
}

afterEach(() => cleanup());

describe('the verdict banner’s words and actions (P-UI-10, MPR-UX-01)', () => {
  const from = { name: 'Dinesh Perera', email: 'dinesh.perera@gmail.com' };
  it('has its own plain words for each verdict, and none for clean or bulk mail', () => {
    expect(bannerFor(prot('SPAM'), from)?.title).toBe('This looks like spam');
    expect(bannerFor(prot('PHISH'), from)?.title).toBe('This message may be trying to steal your password');
    expect(bannerFor(prot('SPOOF'), from)?.title).toBe('This isn’t from Dinesh Perera — the address is dinesh.perera@gmail.com');
    expect(bannerFor(prot('MALWARE'), from)?.title).toBe('Dangerous attachment removed');
    expect(bannerFor(prot('POLICY'), from)?.title).toBe('A file in this message is blocked by your organisation');
    expect(bannerFor(prot('UNSCANNED'), from)?.title).toBe('Not scanned');
    expect(bannerFor(prot('CHECKING'), from)?.title).toBe('Checking this message…');
    expect(bannerFor(prot('CLEAN'), from)).toBeNull();
    expect(bannerFor(prot('BULK'), from)).toBeNull();
    // The server's own words win.
    expect(bannerFor(prot('PHISH', { banner: { tone: 'danger', title: 'Fake Microsoft sign-in', text: 'The link goes to micros0ft-secure.com', actions: ['report_phish'] } }), from)).toMatchObject({ title: 'Fake Microsoft sign-in', actions: ['report_phish'] });
  });

  it('never offers Release for malware, whatever the answer lists; Release only for self-release with an item', () => {
    const all = ['release', 'request_release', 'not_junk', 'junk', 'headers'] as const;
    expect(allowedActions([...all], { verdict: 'MALWARE', release: 'self', quarantine_id: 9 })).toEqual(['junk', 'headers']);
    expect(allowedActions([...all], { verdict: 'HIGH_SPAM', release: 'self', quarantine_id: 9 })).toEqual(['release', 'not_junk', 'junk', 'headers']);
    expect(allowedActions([...all], { verdict: 'HIGH_SPAM', release: 'self', quarantine_id: null })).toEqual(['not_junk', 'junk', 'headers']);
    expect(allowedActions([...all], { verdict: 'PHISH', release: 'self', quarantine_id: 9 })).toEqual(['request_release', 'junk', 'headers']);
    expect(bannerFor(prot('MALWARE', { quarantine_id: 4, release: 'self', banner: { tone: 'warn', title: 'Virus', text: '', actions: ['release', 'request_release', 'headers'] } }), from)).toMatchObject({ tone: 'danger', actions: ['headers'] });
  });

  it('renders each banner with an icon, its words and an accessible name — danger as an alert — and no Release button for malware', () => {
    const cases: Array<[Verdict, string, string]> = [
      ['SPAM', 'status', 'This looks like spam'],
      ['PHISH', 'alert', 'This message may be trying to steal your password'],
      ['SPOOF', 'alert', 'This isn’t from Dinesh Perera — the address is dinesh.perera@gmail.com'],
      ['MALWARE', 'alert', 'Dangerous attachment removed'],
      ['POLICY', 'status', 'A file in this message is blocked by your organisation'],
      ['UNSCANNED', 'status', 'Not scanned'],
      ['CHECKING', 'status', 'Checking this message…'],
    ];
    for (const [verdict, role, title] of cases) {
      const p = prot(verdict, { quarantine_id: 12, release: verdict === 'MALWARE' ? 'never' : verdict === 'SPAM' ? 'self' : 'request', banner: verdict === 'MALWARE' ? { tone: 'danger', title: 'Dangerous attachment removed', text: 'Win.Trojan.Agent', actions: ['release', 'request_release', 'block_sender', 'headers'] } : null });
      wrap(<VerdictBanner model={bannerFor(p, from)!} protection={p} msgRef={REF} from={from} subject="Hi" offline={false} scannable={[]} onHeaders={() => undefined} onReportPhish={() => undefined} onGone={() => undefined} />);
      const banner = screen.getByRole(role, { name: title });
      expect(banner.querySelector('svg')).toBeTruthy();
      const buttons = within(banner).queryAllByRole('button').map((b) => b.textContent);
      if (verdict === 'MALWARE') {
        expect(buttons).not.toContain('Release');
        expect(buttons).not.toContain('Request release');
        expect(buttons).toEqual(['Block sender', 'View headers']);
      }
      if (verdict === 'SPAM') expect(buttons).toContain('Release');
      if (verdict === 'PHISH') expect(buttons).toEqual(expect.arrayContaining(['Request release', 'Report phishing']));
      if (verdict === 'UNSCANNED') expect(buttons).toContain('Scan now');
      cleanup();
    }
  });

  it('waits for the connection: offline, only what works on this computer is offered', () => {
    const p = prot('SPAM', { quarantine_id: 3, release: 'self' });
    wrap(<VerdictBanner model={bannerFor(p, from)!} protection={p} msgRef={REF} from={from} subject="Hi" offline scannable={[]} onHeaders={() => undefined} onReportPhish={() => undefined} onGone={() => undefined} />);
    expect((screen.getByRole('button', { name: 'Not junk' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'View headers' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('attachment gating and offline (P-UI-11, MPR-UX-02, MPR-UX-07)', () => {
  const atts = [
    { ref: '2', name: 'invoice.pdf', size: 100 },
    { ref: '3', name: 'label.zip', size: 200 },
    { ref: '4', name: 'notes.txt', size: 50 },
    { ref: '5', name: 'extra.docx', size: 70 },
  ];
  it('opens only a scanned file; checking, blocked and not scanned stay locked; a file the answer leaves out is not scanned', () => {
    const gate = attachmentGate(prot('UNSCANNED', { attachments: [
      { id: '2', name: 'invoice.pdf', size: 100, sha256: null, status: 'scanned', threat: null, reason: null },
      { id: '3', name: 'label.zip', size: 200, sha256: null, status: 'blocked', threat: 'Win.Trojan.Agent-1123', reason: null },
      { id: '4', name: 'notes.txt', size: 50, sha256: null, status: 'checking', threat: null, reason: null },
    ] }), atts, false)!;
    expect(gate.get('2')).toMatchObject({ status: 'scanned', open: true });
    expect(gate.get('3')).toMatchObject({ status: 'blocked', open: false, reason: 'A virus was found: Win.Trojan.Agent-1123' });
    expect(gate.get('4')).toMatchObject({ status: 'checking', open: false });
    expect(gate.get('5')).toMatchObject({ status: 'unscanned', open: false });
    // No protection service at the server: nothing to go by, the app as before.
    expect(attachmentGate(null, atts, false)).toBeNull();
  });

  it('offline: no verdict here is Checking with files locked until online; a kept clean verdict keeps working; anything else locks scanned files again', () => {
    const offline = protectionView(null, { offline: true, failed: true });
    expect(offline).toMatchObject({ waitingOnline: true, protection: { verdict: 'CHECKING' } });
    expect(attachmentGate(offline.protection, atts, offline.waitingOnline)!.get('2')).toMatchObject({ status: 'checking', open: false, waitingOnline: true });
    const scanned = [{ id: '2', name: 'invoice.pdf', size: 100, sha256: null, status: 'scanned' as const, threat: null, reason: null }];
    const clean = protectionView({ data: prot('CLEAN', { attachments: scanned }), offline: true }, { offline: true, failed: false });
    expect(clean.waitingOnline).toBe(false);
    expect(attachmentGate(clean.protection, atts.slice(0, 1), false)!.get('2')!.open).toBe(true);
    const spam = protectionView({ data: prot('SPAM', { attachments: scanned }), offline: true }, { offline: true, failed: false });
    expect(spam).toMatchObject({ waitingOnline: true, fromCache: true });
    expect(attachmentGate(spam.protection, atts.slice(0, 1), spam.waitingOnline)!.get('2')!.open).toBe(false);
    expect(protectionView({ unavailable: true }, { offline: false, failed: false }).unavailable).toBe(true);
  });
});

/* --------------------------------------------------------------------------
 * In the reader
 * -------------------------------------------------------------------------- */

const DETAIL = {
  id: 201,
  message_id: '<q@x>',
  from_name: 'Microsoft 365',
  from_email: 'security@micros0ft-secure.com',
  subject: 'Your mailbox will be suspended',
  to: ['me@example.test'],
  cc: [],
  body_html: '<p>Sign in <a href="https://micros0ft-secure.com/login">here</a></p>',
  attachments: [
    { ref: '2', name: 'Price list.pdf', mime: 'application/pdf', size: 40_000 },
    { ref: '3', name: 'label.zip', mime: 'application/zip', size: 3_000 },
    { ref: '4', name: 'notes.txt', mime: 'text/plain', size: 300 },
  ],
  is_starred: false,
  created_at: '2026-10-02 10:12:00',
};

function Page({ initial }: { initial: string }) {
  const [route, setRoute] = useState(initial);
  return (
    <TabProvider tabId="t" route={route} active onGo={setRoute}>
      <MailPage active tabId="t" route={route} />
    </TabProvider>
  );
}

describe('the reader with a verdict (P-UI-10, P-UI-11)', () => {
  let protection: (() => unknown) | null = null;
  const setNetwork = (network: 'ONLINE' | 'OFFLINE') =>
    app.set({ status: { network } as never, prefs: { mailCacheDays: 30, moduleNotifications: {}, badgeCount: true, theme: 'light', mailtoHandler: false, mailCacheDaysByMailbox: {} } as never, bootstrap: { user: { id: '9', name: 'Me', email: 'me@example.test' }, permissions: [] } as never, apps: [], auth: { server: { origin: 'https://ws.example.test' } } as never });
  beforeEach(() => {
    setRegional({ timezone: 'UTC', locale: 'en-GB', timeFormat: '24' });
    setNetwork('ONLINE');
    protection = null;
    vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
      if (path === '/api/mail/mailboxes') return { mailboxes: [{ id: 3, email: 'me@example.test', display_name: 'Me', in_unified: true, is_default: true, auth_state: 'ok' }] };
      if (path === '/api/mail/prefs') return { prefs: {} };
      if (path === '/api/mail/views') return { mailboxes: [], views: {}, partial: false, unknown: [] };
      if (path === '/api/mail/folders') return { folders: [] };
      if (path === '/api/mail/labels') return { labels: [] };
      if (path === '/api/mail/sync/status') return { enabled: true, mailboxes: [] };
      if (path.endsWith('/context')) return { sender: null, security: { available: true, spf: 'pass', dkim: 'pass', dmarc: 'pass' } };
      if (path === '/api/mail/security/policy') return { blocked_extensions: [], security_mailbox: false };
      if (path === '/api/mail/quarantine') return { items: [], total: 0, counts: { held: 2, requested: 0, released: 0 } };
      throw new ApiError(404, path, null);
    }) as never);
    vi.mocked(apiGetMeta).mockReset().mockImplementation((async (path: string) => {
      if (path === '/api/mail/messages') return { data: { messages: [], total: 0, has_more: false }, offline: false, cachedAt: null };
      if (path === '/api/mail/messages/201') return { data: DETAIL, offline: false, cachedAt: null };
      if (path === '/api/mail/messages/201/protection' && protection) return protection();
      throw new ApiError(404, path, null);
    }) as never);
    vi.mocked(apiPost).mockReset().mockResolvedValue({ status: 'blocked', threat: null, reason: 'Encrypted archive' } as never);
    vi.mocked(apiPut).mockReset().mockResolvedValue({} as never);
    vi.mocked(call).mockReset().mockImplementation((async (channel: string) => (channel === 'offline:pending' ? [] : channel === 'mail:keptAttachments' ? [] : null)) as never);
  });
  afterEach(() => cleanup());

  const attachments = () => screen.getByLabelText('Attachments');

  it('shows the phishing banner with Request release and no Release; only the scanned file can be opened or downloaded', async () => {
    protection = () => ({
      data: prot('PHISH', {
        quarantine_id: 7,
        release: 'request',
        reasons: [{ code: 'lookalike', text: 'micros0ft-secure.com looks like microsoft.com' }],
        attachments: [
          { id: '2', name: 'Price list.pdf', size: 40_000, sha256: null, status: 'scanned', threat: null, reason: null },
          { id: '3', name: 'label.zip', size: 3_000, sha256: null, status: 'blocked', threat: 'Win.Trojan.Agent-1123', reason: null },
          { id: '4', name: 'notes.txt', size: 300, sha256: null, status: 'unscanned', threat: null, reason: null },
        ],
        links_as_text: true,
      }),
      offline: false,
      cachedAt: null,
    });
    wrap(<Page initial="/mail?box=3&msg=201&mbx=3" />);
    const banner = await screen.findByRole('alert', { name: 'This message may be trying to steal your password' });
    expect(within(banner).getByText('micros0ft-secure.com looks like microsoft.com')).toBeTruthy();
    expect(within(banner).getByRole('button', { name: 'Request release' })).toBeTruthy();
    expect(within(banner).queryByRole('button', { name: 'Release' })).toBeNull();
    // Scanned: a chip, Open and Download. Blocked and not scanned: no way to open, download, save or drag.
    await waitFor(() => expect(within(attachments()).getByText('Scanned')).toBeTruthy());
    expect(within(attachments()).getByRole('button', { name: 'Download Price list.pdf' })).toBeTruthy();
    expect(within(attachments()).queryByRole('button', { name: 'Download label.zip' })).toBeNull();
    expect(within(attachments()).queryByRole('button', { name: 'Download notes.txt' })).toBeNull();
    expect(within(attachments()).queryByRole('button', { name: /label\.zip/ })).toBeNull();
    expect(attachments().querySelector('[data-locked-attachment="blocked"]')?.textContent).toContain('A virus was found: Win.Trojan.Agent-1123');
    expect(attachments().querySelectorAll('[draggable="true"]')).toHaveLength(1);
    // Not scanned: Scan now asks the server.
    fireEvent.click(within(attachments()).getByRole('button', { name: 'Scan now' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/attachments/scan', { mailbox: 3, message: '201', folder: 'inbox', part: '4' }));
    // Only the openable file is fetched ahead to this computer.
    expect(call).toHaveBeenCalledWith('mail:keptAttachments', expect.objectContaining({ items: [expect.objectContaining({ ref: '2' })] }));
    // The body's links name this reader, and it is registered as links-as-text for the click-time check.
    const doc = document.querySelector('iframe[title="Message"]')!.getAttribute('srcdoc')!;
    const href = /href="(app:\/\/bundle\/__mail-link[^"]+)"/.exec(doc)![1]!.replace(/&amp;/g, '&');
    const link = parseSafeLink(href)!;
    expect(link.frame).toBeTruthy();
    expect(readerLinks(link.frame)).toMatchObject({ message: '201', linksAsText: true, verdict: 'PHISH' });
  });

  it('never shows Release for malware in the reader, even when the server’s banner lists it', async () => {
    protection = () => ({ data: prot('MALWARE', { quarantine_id: 9, release: 'never', banner: { tone: 'danger', title: 'Dangerous attachment removed', text: 'Win.Trojan.Agent-1123', actions: ['release', 'request_release', 'headers'] }, attachments: [{ id: '3', name: 'label.zip', size: 3_000, sha256: null, status: 'blocked', threat: 'Win.Trojan.Agent-1123', reason: null }] }), offline: false, cachedAt: null });
    wrap(<Page initial="/mail?box=3&msg=201&mbx=3" />);
    const banner = await screen.findByRole('alert', { name: 'Dangerous attachment removed' });
    expect(within(banner).queryByRole('button', { name: 'Release' })).toBeNull();
    expect(within(banner).queryByRole('button', { name: 'Request release' })).toBeNull();
  });

  it('offline with no verdict on this computer: Checking, and every attachment locked until online (MPR-UX-07)', async () => {
    setNetwork('OFFLINE');
    protection = () => {
      throw new ApiError(0, 'WorkSuite Desktop could not complete the request.', 'NETWORK_UNREACHABLE');
    };
    wrap(<Page initial="/mail?box=3&msg=201&mbx=3" />);
    expect(await screen.findByRole('status', { name: 'Checking this message…' })).toBeTruthy();
    await waitFor(() => expect(attachments().querySelectorAll('[data-locked-attachment="checking"]')).toHaveLength(3));
    expect(within(attachments()).getAllByText('Checking when online')).toHaveLength(3);
    expect(within(attachments()).queryAllByRole('button')).toHaveLength(0);
  });

  it('offline with a clean verdict kept here: the scanned files still open (MPR-UX-07)', async () => {
    setNetwork('OFFLINE');
    // Kept on this computer: offline, a file opens from here.
    vi.mocked(call).mockImplementation((async (channel: string) => (channel === 'offline:pending' ? [] : channel === 'mail:keptAttachments' ? ['2', '3', '4'] : null)) as never);
    protection = () => ({ data: prot('CLEAN', { attachments: DETAIL.attachments.map((a) => ({ id: a.ref, name: a.name, size: a.size, sha256: null, status: 'scanned' as const, threat: null, reason: null })) }), offline: true, cachedAt: '2026-10-02T10:00:00Z' });
    wrap(<Page initial="/mail?box=3&msg=201&mbx=3" />);
    await waitFor(() => expect(within(attachments()).getAllByText('Scanned')).toHaveLength(3));
    expect(screen.queryByRole('status', { name: 'Checking this message…' })).toBeNull();
    expect(attachments().querySelectorAll('[data-locked-attachment]')).toHaveLength(0);
  });

  it('Junk in the reader trains the filter through the protection call (MPR-UX-06)', async () => {
    protection = () => ({ data: prot('CLEAN'), offline: false, cachedAt: null });
    wrap(<Page initial="/mail?box=3&msg=201&mbx=3" />);
    const bar = await screen.findByRole('toolbar', { name: 'Reply and actions' });
    vi.mocked(call).mockImplementation((async (channel: string) => (channel === 'offline:submit' ? { delivered: true, queued: false, id: null, status: 200, data: {}, error: null, code: null } : channel === 'offline:pending' ? [] : null)) as never);
    fireEvent.click(within(bar).getByRole('button', { name: 'Junk' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('offline:submit', expect.objectContaining({ path: '/api/mail/messages/201/junk', body: { folder: 'inbox', mailbox: '3' } })));
  });
});

describe('Mail › Quarantine: Release against Request release (P-UI-13)', () => {
  const item = (verdict: Verdict, extra: Partial<QuarantineItem> = {}): QuarantineItem => ({
    id: 41,
    received_at: '2026-10-02 08:12:00',
    sender: 'offers@bizleads-mail.com',
    sender_name: 'Global Trade Leads',
    recipient: 'me@example.test',
    subject: 'Verified buyer list',
    verdict,
    score: 11.4,
    reasons: [{ code: 'bulk', text: 'Sent to about 3,400 people at once' }, { code: 'spf', text: 'SPF pass' }],
    attachments: [],
    size: 2000,
    path: 'gateway',
    state: 'held',
    expires_at: '2026-11-08',
    release: verdict === 'MALWARE' ? 'never' : verdict === 'HIGH_SPAM' || verdict === 'SPAM' ? 'self' : 'request',
    request: null,
    account: { id: 3, email: 'me@example.test' },
    ...extra,
  });
  beforeEach(() => {
    setRegional({ timezone: 'UTC', locale: 'en-GB', timeFormat: '24' });
    vi.mocked(apiPost).mockReset().mockResolvedValue({} as never);
  });
  afterEach(() => cleanup());

  it('knows what each item allows', () => {
    expect(quarantineChoice(item('HIGH_SPAM'))).toBe('release');
    expect(quarantineChoice(item('PHISH'))).toBe('request');
    expect(quarantineChoice(item('POLICY', { state: 'requested' }))).toBe('requested');
    expect(quarantineChoice(item('MALWARE', { release: 'self' }))).toBe('never');
    expect(quarantineChoice(item('SPAM', { state: 'released' }))).toBe('done');
  });

  it('releases spam by yourself, with the reason and the expiry shown', async () => {
    wrap(<QuarantineDetail item={item('HIGH_SPAM')} offline={false} />);
    expect(screen.getByText('Sent to about 3,400 people at once')).toBeTruthy();
    expect(screen.getByText(/Deleted automatically on/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Release to Inbox' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/quarantine/41/release', {}));
    fireEvent.click(screen.getByRole('button', { name: 'Release and trust sender' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/quarantine/41/release', { trust_sender: true }));
  });

  it('asks an administrator for phishing, with a note — no Release', async () => {
    wrap(<QuarantineDetail item={item('PHISH')} offline={false} />);
    expect(screen.queryByRole('button', { name: 'Release to Inbox' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Request release' }));
    const dialog = await screen.findByRole('dialog', { name: 'Request release' });
    fireEvent.change(within(dialog).getByLabelText('Why you expected it (optional)'), { target: { value: 'Our supplier' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/quarantine/41/request', { note: 'Our supplier' }));
  });

  it('offers nothing for malware: it can’t be released by anyone', () => {
    wrap(<QuarantineDetail item={item('MALWARE', { release: 'self' })} offline={false} />);
    expect(screen.queryByRole('button', { name: /Release/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Request release' })).toBeNull();
    expect(screen.getByText('Malware can’t be released by anyone')).toBeTruthy();
  });

  it('waits for the connection to release', () => {
    wrap(<QuarantineDetail item={item('SPAM')} offline />);
    expect((screen.getByRole('button', { name: 'Release to Inbox' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the click-time link check (P-UI-12)', () => {
  it('reads the server’s answer — dangerous is blocked, suspicious asks, unknown says nothing — and the old shape still', () => {
    expect(linkVerdictOf({ verdict: 'dangerous', reason: 'Reported phishing site', final_url: 'https://evil.test/x', checked_at: '' })).toMatchObject({ verdict: 'blocked', reasonText: 'Reported phishing site' });
    expect(linkVerdictOf({ verdict: 'suspicious', reason: null, final_url: '', checked_at: '' })).toMatchObject({ verdict: 'caution' });
    expect(linkVerdictOf({ verdict: 'unknown', reason: null, final_url: '', checked_at: '' })).toBeNull();
    expect(linkVerdictOf({ verdict: 'blocked', reasons: ['blocked_domain'] })).toMatchObject({ verdict: 'blocked', reasons: ['blocked_domain'] });
    // The server's answer today: `verdict` in the older words (ranked as before), the new words as `safety`.
    expect(linkVerdictOf({ verdict: 'danger', safety: 'dangerous', reason: 'Reported phishing site', final_url: 'https://evil.test/x', reasons: ['blocked_domain'] })).toMatchObject({ verdict: 'danger', reasons: ['blocked_domain'], reasonText: 'Reported phishing site', finalUrl: 'https://evil.test/x' });
    expect(linkVerdictOf({ safety: 'dangerous', reason: null, final_url: '' })).toMatchObject({ verdict: 'blocked' });
    expect(linkVerdictOf({ verdict: 'ok', safety: 'safe', reason: null, final_url: '' })).toMatchObject({ verdict: 'ok' });
  });

  it('sends the message the link came from, and stops on every link of a message shown as text', async () => {
    const frame = 'abcd1234';
    const off = registerReaderLinks(frame, { message: '201', linksAsText: true, verdict: 'SPOOF' });
    const ask = vi.fn(async () => ({ verdict: 'safe' as const, reason: null, final_url: 'https://www.livezen.lk/', checked_at: '' }));
    const j = await judgeLink({ url: 'https://www.livezen.lk/', text: 'livezen.lk', frame }, true, ask);
    expect(ask).toHaveBeenCalledWith('https://www.livezen.lk/', 'livezen.lk', '201');
    expect(j).toMatchObject({ verdict: 'caution', asText: 'SPOOF' });
    off();
    const html = `<a href="${safeLinkHref('https://x.test/', 'x').replace(/&/g, '&amp;')}">x</a>`;
    expect(parseSafeLink(/href="([^"]+)"/.exec(tagLinkFrames(html, frame))![1]!.replace(/&amp;/g, '&'))).toEqual({ url: 'https://x.test/', text: 'x', frame });
    const dangerous = vi.fn(async () => ({ verdict: 'dangerous' as const, reason: 'Known malware host', final_url: 'https://evil.test/payload', checked_at: '' }));
    expect(await judgeLink({ url: 'https://short.example/a', text: '' }, true, dangerous)).toMatchObject({ verdict: 'blocked', reasonText: 'Known malware host', finalUrl: 'https://evil.test/payload' });
  });
});

describe('a send refused by protection (P-UI-15, AC-MPR-11, AC-MPR-12)', () => {
  afterEach(() => cleanup());
  it('tells a malware attachment and a paused mailbox from any other refusal', () => {
    expect(sendBlockOf(new MailActionError('Not sent', 'server', 422, 'MALWARE_ATTACHMENT', { errors: { attachment: 'invoice.docm', threat: 'Doc.Downloader.Emotet' } }))).toEqual({ kind: 'malware', attachment: 'invoice.docm', threat: 'Doc.Downloader.Emotet', message: 'Not sent' });
    expect(sendBlockOf(new ApiError(422, 'Sending paused', null, { code: 'sending_paused', detail: '640 messages in 12 minutes' }))).toMatchObject({ kind: 'paused', reason: '640 messages in 12 minutes' });
    expect(sendBlockOf(new ApiError(422, 'Add a recipient', null, { to: 'required' }))).toBeNull();
  });

  it('says the draft is kept, and removes the infected file', () => {
    const remove = vi.fn();
    wrap(<SendBlockedNote block={{ kind: 'malware', attachment: 'invoice.docm', threat: 'Doc.Downloader.Emotet', message: '' }} attachmentPresent onRemove={remove} onDismiss={() => undefined} />);
    const note = screen.getByRole('alert');
    expect(note.textContent).toContain('Not sent — an attachment contains a virus');
    expect(note.textContent).toContain('invoice.docm was found to contain Doc.Downloader.Emotet. Remove it and send again. Your draft is kept.');
    fireEvent.click(within(note).getByRole('button', { name: 'Remove invoice.docm' }));
    expect(remove).toHaveBeenCalled();
    cleanup();
    wrap(<SendBlockedNote block={{ kind: 'paused', reason: null, message: '' }} attachmentPresent={false} onDismiss={() => undefined} />);
    expect(screen.getByRole('alert').textContent).toContain('Sending is paused for this mailbox');
  });
});
