// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
import { ImageNotice } from '../../../src/modules/mail/ImageNotice';
import { MediaSettings, toggleType } from '../../../src/modules/mail/MediaSettings';
import { authFailed, securityVerdict } from '../../../src/modules/mail/model';
import { emailDomain, imageVerdict, isJunkFolder, isRawId, normaliseDomain, ownDomains, readableName, trustedBy, withTrusted, type ImageContext } from '../../../src/modules/mail/images';
import { PLACEHOLDER_SRC, isTrackingPixel, sanitizeMailHtml, withLoadedImages, withProxiedImages } from '../../../src/modules/mail/sanitize';

/**
 * Ask before loading pictures from the web, the Images & media settings, and
 * attachments that are real attachments under readable names
 * (worksuite-desktop#163).
 */

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('remote pictures are held back as tidy placeholders, trackers removed (#163)', () => {
  it('replaces each remote picture with an empty box at the size the email asked for, never a broken icon', () => {
    const c = sanitizeMailHtml('<img src="https://cdn.example/hero.jpg" width="600" height="200" alt="Spring sale"><img src="https://cdn.example/logo.png" style="width:120px;height:40px;border:0"><img src="https://cdn.example/x.png">');
    const doc = new DOMParser().parseFromString(c.html, 'text/html');
    const imgs = [...doc.querySelectorAll('img')];
    expect(imgs).toHaveLength(3);
    for (const img of imgs) {
      expect(img.getAttribute('src')).toBe(PLACEHOLDER_SRC);
      expect(img.hasAttribute('data-ws-ph')).toBe(true);
      expect(img.getAttribute('alt')).toBe('');
    }
    expect(imgs[0]!.getAttribute('style')).toContain('width:600px;height:200px');
    expect(imgs[0]!.getAttribute('title')).toBe('Spring sale');
    expect(imgs[1]!.getAttribute('style')).toContain('width:120px;height:40px');
    expect(imgs[2]!.getAttribute('style')).toContain('width:48px;height:48px');
    expect(c.html).not.toContain('[image blocked]');
    expect(c.html).not.toContain('cdn.example');
    expect(c.blockedImages).toBe(3);
    expect(c.trackers).toBe(0);
  });

  it('removes tracking pixels — 1×1, hidden, or from an open-tracking service — and counts them', () => {
    const c = sanitizeMailHtml(
      '<p>Hi</p><img src="https://news.example/o.png" width="1" height="1"><img src="https://x.example/a.gif" style="display:none">' +
        '<img src="https://mailtrack.io/trace/mail/abc.png"><img src="https://u123.ct.sendgrid.net/wf/open?upn=abc"><img src="https://cdn.example/logo.png" width="120" height="40">',
    );
    expect(c.trackers).toBe(4);
    expect(c.blockedImages).toBe(1);
    expect(c.remoteImages).toEqual(['https://cdn.example/logo.png']);
    expect(c.html).not.toMatch(/mailtrack|sendgrid|news\.example|x\.example/);
  });

  it('tells a tracking pixel from a picture', () => {
    const img = (attrs: string) => new DOMParser().parseFromString(`<img ${attrs}>`, 'text/html').querySelector('img')!;
    expect(isTrackingPixel(img('width="1" height="1"'), 'https://a.example/p.gif')).toBe(true);
    expect(isTrackingPixel(img('width="0"'), 'https://a.example/p.gif')).toBe(true);
    expect(isTrackingPixel(img('style="visibility: hidden"'), 'https://a.example/p.gif')).toBe(true);
    expect(isTrackingPixel(img(''), 'https://t.yesware.com/t/1/x.png')).toBe(true);
    expect(isTrackingPixel(img(''), 'https://list.us1.list-manage.com/track/open.php?u=1')).toBe(true);
    expect(isTrackingPixel(img('width="600" height="200"'), 'https://cdn.example/hero.jpg')).toBe(false);
    expect(isTrackingPixel(img(''), 'https://tracker.example/pixel.gif')).toBe(false);
  });

  it('puts loaded pictures back with the style the email gave them, and only data: pictures', () => {
    const c = sanitizeMailHtml('<img src="https://cdn.example/logo.png" style="width:120px;border:0" alt="Logo"><img src="https://cdn.example/b.png">');
    const shown = withLoadedImages(c.html, c.remoteImages, { 'https://cdn.example/logo.png': PNG, 'https://cdn.example/b.png': 'https://cdn.example/b.png' });
    const imgs = [...new DOMParser().parseFromString(shown, 'text/html').querySelectorAll('img')];
    expect(imgs[0]!.getAttribute('src')).toBe(PNG);
    expect(imgs[0]!.getAttribute('style')).toBe('width:120px;border:0');
    expect(imgs[0]!.getAttribute('alt')).toBe('Logo');
    expect(imgs[0]!.hasAttribute('data-ws-ph')).toBe(false);
    expect(imgs[1]!.getAttribute('src')).toBe(PLACEHOLDER_SRC);
    // The proxy's own links still work as before (DMO-SEC-07).
    expect(withProxiedImages(c.html, c.remoteImages, { 'https://cdn.example/b.png': '/mail-image?t=1&s=2' }, 'https://ws.example')).toContain('src="https://ws.example/mail-image?t=1&amp;s=2"');
  });

  it('shows a picture of the message itself the server could not embed as a placeholder too', () => {
    const c = sanitizeMailHtml('<img src="cid:big@x" width="300" height="100">');
    expect(c.html).toContain(PLACEHOLDER_SRC);
    expect(c.blockedImages).toBe(0);
  });
});

describe('whether pictures load: settings, trust, Junk and failed authentication (#163)', () => {
  const base: ImageContext = { mode: 'ask', remote: 2, trusted: null, junk: false, authFailed: false, pending: false, asked: false };

  it('asks by default, and offers Show images and Always show from…', () => {
    expect(imageVerdict(base)).toEqual({ load: false, reason: 'ask', canShow: true, canTrust: true });
    expect(imageVerdict({ ...base, asked: true }).load).toBe(true);
    expect(imageVerdict({ ...base, remote: 0 }).reason).toBe('none');
  });

  it('loads for a trusted sender, always in Always, never in Never, only trusted in Only from trusted senders', () => {
    expect(imageVerdict({ ...base, trusted: 'sender' })).toMatchObject({ load: true, reason: 'trusted' });
    expect(imageVerdict({ ...base, mode: 'always' })).toMatchObject({ load: true, reason: 'always' });
    expect(imageVerdict({ ...base, mode: 'never', trusted: 'sender' })).toMatchObject({ load: false, reason: 'never', canShow: false });
    expect(imageVerdict({ ...base, mode: 'trusted' })).toMatchObject({ load: false, reason: 'trusted-only', canShow: false, canTrust: true });
    expect(imageVerdict({ ...base, mode: 'trusted', trusted: 'domain' }).load).toBe(true);
  });

  it('never loads by itself in Junk or in mail that failed its checks — even in Always, even from a trusted sender', () => {
    expect(imageVerdict({ ...base, mode: 'always', junk: true })).toMatchObject({ load: false, reason: 'junk', canTrust: false });
    expect(imageVerdict({ ...base, trusted: 'sender', junk: true }).load).toBe(false);
    expect(imageVerdict({ ...base, mode: 'always', authFailed: true })).toMatchObject({ load: false, reason: 'auth', canTrust: false });
    expect(imageVerdict({ ...base, trusted: 'organisation', authFailed: true }).load).toBe(false);
    // …and waits for the authentication result before loading on its own.
    expect(imageVerdict({ ...base, mode: 'always', pending: true }).load).toBe(false);
    // The reader may still choose to see them for this one message.
    expect(imageVerdict({ ...base, junk: true, asked: true }).load).toBe(true);
    expect(isJunkFolder('spam')).toBe(true);
    expect(isJunkFolder('all:junk')).toBe(true);
    expect(isJunkFolder('inbox')).toBe(false);
  });

  it('a failed check counts as failed authentication', () => {
    expect(authFailed({ available: true, spf: 'pass', dkim: 'none', dmarc: 'fail' })).toBe(true);
    expect(authFailed({ available: true, spf: 'softfail', dkim: 'none', dmarc: 'none' })).toBe(true);
    expect(authFailed({ available: true, spf: 'pass', dkim: 'none', dmarc: 'pass' })).toBe(false);
    expect(authFailed(undefined)).toBe(false);
  });

  it('trusts a sender, a domain (and its subdomains), and the organisation’s own domains unless turned off', () => {
    const own = ownDomains(['me@livezentech.lk', 'me.personal@gmail.com', null]);
    expect(own).toEqual(['livezentech.lk']);
    expect(trustedBy('Ann@News.Example', { imageSenders: ['ann@news.example'] }, own)).toBe('sender');
    expect(trustedBy('x@mail.example.com', { imageDomains: ['example.com'] }, own)).toBe('domain');
    expect(trustedBy('x@badexample.com', { imageDomains: ['example.com'] }, own)).toBeNull();
    expect(trustedBy('dinusha@livezentech.lk', {}, own)).toBe('organisation');
    expect(trustedBy('dinusha@livezentech.lk', { trustOwnDomains: false }, own)).toBeNull();
    expect(withTrusted(['a@x.example', 'b@x.example'], 'a@x.example')).toEqual(['b@x.example', 'a@x.example']);
    expect(normaliseDomain('@Example.COM.')).toBe('example.com');
    expect(normaliseDomain('not a domain')).toBeNull();
    expect(emailDomain('a@B.example')).toBe('b.example');
  });
});

describe('the notice bar (#163)', () => {
  const props = { sender: 'dinusha@livezentech.lk', trackers: 0, proxyOff: false, offline: false, onShow: vi.fn(), onTrustSender: vi.fn(), onTrustDomain: vi.fn(), onSettings: vi.fn() };
  afterEach(cleanup);

  it('says images are hidden and offers Show images · Always show from the sender · Always show from the domain', () => {
    render(<ImageNotice {...props} verdict={imageVerdict({ mode: 'ask', remote: 1, trusted: null, junk: false, authFailed: false, pending: false, asked: false })} trackers={1} />);
    expect(screen.getByText('Images are hidden to protect your privacy.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show images' }));
    fireEvent.click(screen.getByRole('button', { name: 'Always show from dinusha@livezentech.lk' }));
    fireEvent.click(screen.getByRole('button', { name: 'Always show from livezentech.lk' }));
    expect(props.onShow).toHaveBeenCalled();
    expect(props.onTrustSender).toHaveBeenCalled();
    expect(props.onTrustDomain).toHaveBeenCalled();
    expect(screen.getByText('1 tracker blocked')).toBeTruthy();
  });

  it('is not there when pictures already show and nothing was tracked, or the message has none', () => {
    const { container, rerender } = render(<ImageNotice {...props} verdict={imageVerdict({ mode: 'always', remote: 3, trusted: null, junk: false, authFailed: false, pending: false, asked: false })} />);
    expect(container.textContent).toBe('');
    rerender(<ImageNotice {...props} verdict={imageVerdict({ mode: 'ask', remote: 0, trusted: null, junk: false, authFailed: false, pending: false, asked: false })} />);
    expect(container.textContent).toBe('');
    // Shown and two trackers removed: only the count.
    rerender(<ImageNotice {...props} trackers={2} verdict={imageVerdict({ mode: 'always', remote: 3, trusted: null, junk: false, authFailed: false, pending: false, asked: false })} />);
    expect(container.textContent).toContain('2 trackers blocked');
    expect(screen.queryByRole('button', { name: 'Show images' })).toBeNull();
  });

  it('offers no “always” in Junk, no domain for a free mail provider, and no buttons offline', () => {
    const junk = imageVerdict({ mode: 'ask', remote: 1, trusted: null, junk: true, authFailed: false, pending: false, asked: false });
    const { rerender } = render(<ImageNotice {...props} verdict={junk} />);
    expect(screen.getByText('Images are hidden: this message is in Junk.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show images' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Always show/ })).toBeNull();
    const ask = imageVerdict({ mode: 'ask', remote: 1, trusted: null, junk: false, authFailed: false, pending: false, asked: false });
    rerender(<ImageNotice {...props} sender="someone@gmail.com" verdict={ask} />);
    expect(screen.getByRole('button', { name: 'Always show from someone@gmail.com' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Always show from gmail.com' })).toBeNull();
    rerender(<ImageNotice {...props} offline verdict={ask} />);
    expect(screen.queryByRole('button', { name: 'Show images' })).toBeNull();
    expect(screen.getByText('Images load when you are back online.')).toBeTruthy();
  });
});

describe('readable attachment names (#163)', () => {
  it('keeps a real name and replaces an identifier with image-1.png, attachment-2.pdf', () => {
    expect(readableName('Quote.pdf', 'application/pdf', 1)).toBe('Quote.pdf');
    expect(readableName('30b74706-778c-4a5d-9b1e-0123456789ab', 'image/png', 1)).toBe('image-1.png');
    expect(readableName('30b74706-778c-4a5d-9b1e-0123456789ab.png', 'image/png', 2)).toBe('image-2.png');
    expect(readableName('', 'application/pdf', 2)).toBe('attachment-2.pdf');
    expect(readableName('attachment', 'application/octet-stream', 3)).toBe('attachment-3');
    expect(readableName('9c1f2e7a', 'image/jpeg', 1)).toBe('image-1.jpg');
    expect(readableName('20261003.pdf', 'application/pdf', 1)).toBe('20261003.pdf');
    expect(isRawId('image001.png@01DA1B2C.3D4E5F60')).toBe(true);
    expect(isRawId('Invoice 4471.pdf')).toBe(false);
  });
});

describe('“Partly verified” (#163)', () => {
  it('reads a DMARC pass as verified though the message was not DKIM-signed, and SPF + DKIM without a DMARC policy too', () => {
    expect(securityVerdict({ available: true, spf: 'pass', dkim: 'none', dmarc: 'pass' })).toMatchObject({ tone: 'success', label: 'Verified · SPF, DMARC' });
    expect(securityVerdict({ available: true, spf: 'pass', dkim: 'pass', dmarc: 'none' })).toMatchObject({ tone: 'success', label: 'Verified · SPF, DKIM' });
    // Truly partial: SPF passed, nothing signed and no DMARC policy — a DNS set-up question for the sender's domain.
    expect(securityVerdict({ available: true, spf: 'pass', dkim: 'none', dmarc: 'none' })).toMatchObject({ tone: 'muted', label: 'Partly verified' });
    expect(securityVerdict({ available: true, spf: 'pass', dkim: 'fail', dmarc: 'pass' })).toMatchObject({ tone: 'warning' });
  });
});

describe('Settings › Mail › Images & media (#163)', () => {
  afterEach(cleanup);

  it('chooses kinds: All alone, or the kinds without it, never none', () => {
    expect(toggleType(['all'], 'pdf', false)).toEqual(['images', 'office']);
    expect(toggleType(['images'], 'pdf', true)).toEqual(['images', 'pdf']);
    expect(toggleType(['images'], 'images', false)).toEqual(['all']);
    expect(toggleType(['images', 'pdf'], 'all', true)).toEqual(['all']);
  });

  it('saves the picture mode and the trusted list with Mail’s settings, and attachments on this computer', async () => {
    let mailPrefs: Record<string, unknown> = { imageSenders: ['ann@news.example'], imageDomains: ['example.com'] };
    vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
      if (path === '/api/mail/prefs') return { prefs: mailPrefs };
      if (path === '/api/mail/mailboxes') return { mailboxes: [{ id: 1, email: 'me@livezentech.lk' }] };
      throw new ApiError(404, path, null);
    }) as never);
    vi.mocked(apiPut).mockReset().mockImplementation((async (_p: string, patch: Record<string, unknown>) => {
      mailPrefs = { ...mailPrefs, ...patch };
      return { prefs: mailPrefs };
    }) as never);
    vi.mocked(call).mockReset().mockImplementation((async (channel: string, input?: unknown) => (channel === 'settings:set' ? { preferences: { ...app.get().prefs, ...(input as object) }, locks: [] } : null)) as never);
    app.set({ prefs: { mailCacheDays: 30, moduleNotifications: {}, drive: { meteredConnection: false } } as never, bootstrap: { user: { id: '9', name: 'Me', email: 'me@livezentech.lk' } } as never });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MediaSettings /></QueryClientProvider>);
    expect(await screen.findByText('ann@news.example')).toBeTruthy();
    expect(screen.getByText('example.com')).toBeTruthy();
    expect(await screen.findByText('Trust my organisation’s domains (livezentech.lk)')).toBeTruthy();
    // Junk: always off, not changeable.
    expect((screen.getByRole('checkbox', { name: /Load images in Junk/ }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Add a sender or domain'), { target: { value: 'Shop.Example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/mail/prefs', { imageDomains: ['example.com', 'shop.example'] }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove ann@news.example' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/mail/prefs', { imageSenders: [] }));
    fireEvent.click(screen.getByRole('checkbox', { name: /PDFs/ }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('settings:set', { mailMedia: expect.objectContaining({ types: ['images', 'office'], autoDownload: '5' }) }));
  });
});

/* -------------------------------------------------------------------------- *
 * In the reader
 * -------------------------------------------------------------------------- */

const DETAIL = {
  id: 201,
  message_id: '<q@x>',
  from_name: 'Dinusha',
  from_email: 'dinusha@partner.example',
  subject: 'Spring offers',
  to: ['me@example.test'],
  cc: [],
  body_html: '<p>Hello</p><img src="https://cdn.partner.example/hero.png" width="600" height="200"><img src="https://mailtrack.io/trace/x.png">',
  attachments: [
    { ref: 'a2', name: '30b74706-778c-4a5d-9b1e-0123456789ab', mime: 'image/png', size: 3000 },
    { ref: 'a3', name: 'Price list.pdf', mime: 'application/pdf', size: 40_000 },
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
const wrap = (node: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);

describe('the reader with pictures and attachments (#163)', () => {
  let prefs: Record<string, unknown> = {};
  let security: Record<string, unknown> = { available: true, spf: 'pass', dkim: 'pass', dmarc: 'pass' };
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-02T10:30:00Z'));
    setRegional({ timezone: 'UTC', locale: 'en-GB', timeFormat: '24' });
    prefs = {};
    security = { available: true, spf: 'pass', dkim: 'pass', dmarc: 'pass' };
    app.set({ status: { network: 'ONLINE' } as never, prefs: { mailCacheDays: 30, moduleNotifications: {}, badgeCount: true, theme: 'light', mailtoHandler: false, mailCacheDaysByMailbox: {} } as never, bootstrap: { user: { id: '9', name: 'Me', email: 'me@example.test' } } as never, apps: [], auth: { server: { origin: 'https://ws.example.test' } } as never });
    vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
      if (path === '/api/mail/mailboxes') return { mailboxes: [{ id: 3, email: 'me@example.test', display_name: 'Me', in_unified: true, is_default: true, auth_state: 'ok' }] };
      if (path === '/api/mail/prefs') return { prefs };
      if (path === '/api/mail/views') return { mailboxes: [], views: {}, partial: false, unknown: [] };
      if (path === '/api/mail/folders') return { folders: [] };
      if (path === '/api/mail/labels') return { labels: [] };
      if (path === '/api/mail/sync/status') return { enabled: true, mailboxes: [] };
      if (path.endsWith('/context')) return { sender: null, security };
      if (path === '/api/mail/security/policy') return { blocked_extensions: [], security_mailbox: false };
      throw new ApiError(404, path, null);
    }) as never);
    vi.mocked(apiGetMeta).mockReset().mockImplementation((async (path: string) => {
      if (path === '/api/mail/messages') return { data: { messages: [], total: 0, has_more: false }, offline: false, cachedAt: null };
      if (path === '/api/mail/messages/201') return { data: DETAIL, offline: false, cachedAt: null };
      throw new ApiError(404, path, null);
    }) as never);
    vi.mocked(apiPost).mockReset().mockResolvedValue({} as never);
    vi.mocked(apiPut).mockReset().mockImplementation((async (_p: string, patch: Record<string, unknown>) => ({ prefs: { ...prefs, ...patch } })) as never);
    vi.mocked(call).mockReset().mockImplementation((async (channel: string) => {
      if (channel === 'offline:pending') return [];
      if (channel === 'mail:images') return { enabled: true, images: { 'https://cdn.partner.example/hero.png': PNG } };
      if (channel === 'mail:keptAttachments') return ['a2'];
      if (channel === 'offline:peek') return [{ body: 'iVBORw0KGgo=', cachedAt: '2026-10-02T10:00:00Z' }];
      return null;
    }) as never);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const frame = () => (document.querySelector('iframe[title="Message"]') as HTMLIFrameElement | null)?.getAttribute('srcdoc') ?? '';

  it('asks first, then shows the pictures from the local store through Show images; the tracker never loads', async () => {
    wrap(<Page initial="/mail?box=3&msg=201&mbx=3" />);
    expect(await screen.findByText('Images are hidden to protect your privacy.')).toBeTruthy();
    expect(screen.getByText('1 tracker blocked')).toBeTruthy();
    expect(frame()).toContain('width:600px;height:200px');
    expect(frame()).not.toContain('mailtrack');
    expect(call).not.toHaveBeenCalledWith('mail:images', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Show images' }));
    await waitFor(() => expect(frame()).toContain(PNG));
    expect(call).toHaveBeenCalledWith('mail:images', { urls: ['https://cdn.partner.example/hero.png'], mailbox: '3', fetch: true });
    expect(screen.queryByText('Images are hidden to protect your privacy.')).toBeNull();
  });

  it('Always show from the domain saves it to the trusted list (synced with Mail’s settings)', async () => {
    wrap(<Page initial="/mail?box=3&msg=201&mbx=3" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Always show from partner.example' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/mail/prefs', { imageDomains: ['partner.example'] }));
  });

  it('loads by itself for a trusted sender, but not when the message failed its checks', async () => {
    prefs = { imageSenders: ['dinusha@partner.example'] };
    wrap(<Page initial="/mail?box=3&msg=201&mbx=3" />);
    await waitFor(() => expect(frame()).toContain(PNG));
    cleanup();
    vi.mocked(call).mockClear();
    security = { available: true, spf: 'fail', dkim: 'none', dmarc: 'fail' };
    wrap(<Page initial="/mail?box=3&msg=201&mbx=3" />);
    expect(await screen.findByText('Images are hidden: this message failed its authentication checks.')).toBeTruthy();
    expect(call).not.toHaveBeenCalledWith('mail:images', expect.anything());
  });

  it('lists attachments under readable names, with a thumbnail when kept, and Open, Download and Save to Files', async () => {
    wrap(<Page initial="/mail?box=3&msg=201&mbx=3" />);
    expect(await screen.findByText('image-1.png')).toBeTruthy();
    expect(screen.queryByText(/30b74706/)).toBeNull();
    expect(screen.getByText('Price list.pdf')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download Price list.pdf' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download image-1.png' })).toBeTruthy();
    await waitFor(() => expect(document.querySelector(`img[src="data:image/png;base64,iVBORw0KGgo="]`)).toBeTruthy());
    expect(call).toHaveBeenCalledWith('mail:keptAttachments', expect.objectContaining({ uid: '201', mailbox: '3', auto: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Download Price list.pdf' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('transfers:download', { mail: { uid: '201', ref: 'a3', folder: 'inbox', mailbox: '3' }, name: 'Price list.pdf' }));
  });
});
